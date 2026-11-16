/**
 * The customer's page, opened from the trader's pay code. No Cashu wallet
 * and no sign-up: pay a Lightning invoice from any wallet, get a receipt
 * that is locked to the trader, show it to the trader.
 *
 * The pending payment is saved before the invoice is shown, and the receipt
 * after, so closing the page or losing signal loses nothing.
 */
import { parsePayLink, type PayLink } from '../../../src/wallet/request.ts';
import { fetchTrustedMint } from '../../../src/wallet/mint-cache.ts';
import { MintApi } from '../../../src/wallet/mint-api.ts';
import { finishPayment, paymentState, pickKeyset, startPayment, type PendingPayment } from '../../../src/wallet/pay.ts';
import { encodeReceipt } from '../../../src/wallet/receipt.ts';
import { fetchRates, fiatToSats, formatFiat } from '../../../src/wallet/rates.ts';
import { normalizeMintUrl } from '../../../src/verify/mint-url.ts';
import type { CachedKeyset } from '../../../src/verify/types.ts';
import { keepOffline } from '../shared/offline.ts';
import { busy, button, explain, h, note, sats, screen, show } from '../shared/dom.ts';
import { animatedQr, qrSvg } from '../shared/qr.ts';
import { MINTS } from '../shared/config.ts';

interface Saved {
  link: PayLink;
  pending: PendingPayment;
  keyset: CachedKeyset;
  receipt?: string;
  paidAt?: number;
  /** the customer chose not to pay this one; kept in case a payment lands after all */
  cancelledAt?: number;
  /** when the mint first called it expired: kept across reloads and rescans */
  expiredAt?: number;
}

const KEY = 'sealpay:payments';
const OLD_KEY = 'sealpay:payment';
const KEEP_MS = 7 * 24 * 3600 * 1000;

/** Every payment on this phone, by quote. One with no receipt yet is never dropped. */
function loadAll(): Saved[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Saved[];
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      list.push(JSON.parse(old) as Saved);
      localStorage.removeItem(OLD_KEY);
    }
    // Receipts are kept a week for disputes; unfinished payments until they finish.
    return list.filter((x) => x?.pending?.quote && (!x.receipt || Date.now() - (x.paidAt ?? 0) < KEEP_MS));
  } catch {
    return [];
  }
}

function save(s: Saved): void {
  try {
    const rest = loadAll().filter((x) => x.pending.quote !== s.pending.quote);
    localStorage.setItem(KEY, JSON.stringify([...rest, s]));
  } catch {
    // storage full or blocked: the page still works while open
  }
}

function forget(quote: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadAll().filter((x) => x.pending.quote !== quote)));
  } catch {
    // fine
  }
}

/** The newest unfinished payment, if any: it comes first, whatever link was opened. */
const unfinished = () => loadAll().filter((x) => !x.receipt && !x.cancelledAt).sort((a, b) => b.pending.createdAt - a.pending.createdAt)[0];
const sameCode = (a: PayLink, b: PayLink) => a.traderPubkey === b.traderPubkey && a.sats === b.sats && a.mint === b.mint && a.made === b.made;

const price = (l: PayLink) => (l.fiat ? formatFiat(l.fiat.amount, l.fiat.currency) : sats(l.sats ?? 0));

function start(): void {
  const parsed = parsePayLink(location.hash);
  const open = unfinished();
  const latest = loadAll().filter((x) => x.receipt).sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0];
  void recheckCancelled();
  if (!parsed.ok) {
    // No valid code opened: pick up an unfinished payment, else the last receipt.
    if (open) return invoice(open);
    if (latest) return receipt(latest);
    return show(screen({ body: [h('h1', {}, 'Ask the trader to show their pay code again.'), note(parsed.error, 'error')] }));
  }
  const link = parsed.link;
  // The same code as an unfinished payment: carry on with it.
  if (open && sameCode(open.link, link)) return invoice(open);
  // The same code just paid: show that receipt (with a way to pay again).
  if (latest && sameCode(latest.link, link) && Date.now() - (latest.paidAt ?? 0) < 30 * 60_000) return receipt(latest);
  // A different code: pay it, and point to the unfinished one without hiding this one.
  payScreen(link, open);
}

/** A cancelled payment that turns out to have been paid after all comes back, so the money is never lost. */
async function recheckCancelled(): Promise<void> {
  for (const s of loadAll().filter((x) => x.cancelledAt && !x.receipt && Date.now() - x.cancelledAt < 86_400_000)) {
    try {
      const state = await paymentState(new MintApi(s.link.mint), s.pending);
      if (state === 'PAID' || state === 'ISSUED') {
        delete s.cancelledAt;
        save(s);
      }
    } catch {
      // try again next time
    }
  }
}

/** "Start a new payment" from a receipt: the same link, a fresh payment. */
function newPayment(): void {
  const parsed = parsePayLink(location.hash);
  if (parsed.ok) payScreen(parsed.link);
  else show(screen({ body: [h('h1', {}, 'Scan the trader’s code to pay again.')] }));
}

function payScreen(link: PayLink, other?: Saved): void {
  generation++;
  if (!MINTS.some((m) => normalizeMintUrl(m.url) === link.mint)) {
    return show(screen({ body: [h('h1', {}, "Sealpay doesn't support this trader's mint yet."), note(link.mint, 'error')] }));
  }
  if (!link.sats) {
    return show(screen({ body: [h('h1', {}, `Ask ${link.shop} to type the price and show the code again.`)] }));
  }
  const msg = h('div');
  // The naira or CFA price on a code is only shown as the price once it matches the sats at today's rate,
  // so a swapped code can't say "₦1,000" while asking for much more.
  const headline = h('p', { class: 'small-amount' }, sats(link.sats));
  const sub = h('p', { class: 'sub' }, link.fiat ? `The trader's price: ${formatFiat(link.fiat.amount, link.fiat.currency)} (checking…)` : 'From any Lightning wallet');
  const pay = button(`Pay ${sats(link.sats)}`, () =>
    void busy(pay, 'Making your invoice…', async () => {
      try {
        const mint = await fetchTrustedMint(link.mint);
        const keyset = pickKeyset(mint.keysets, link.keysetHint);
        const pending = await startPayment(new MintApi(link.mint), keyset, link.traderPubkey, link.sats!);
        const s: Saved = { link, pending, keyset };
        save(s);
        invoice(s);
      } catch (err) {
        msg.replaceChildren(note(explain(err), 'error'));
      }
    }),
  );
  if (link.fiat) {
    const f = link.fiat;
    void fetchRates()
      .then((rates) => {
        const expected = fiatToSats(f.amount, f.currency, rates);
        if (Math.abs(expected - link.sats!) / link.sats! <= 0.05) {
          headline.textContent = formatFiat(f.amount, f.currency);
          sub.textContent = `${sats(link.sats!)}, from any Lightning wallet`;
          pay.textContent = `Pay ${formatFiat(f.amount, f.currency)}`;
        } else {
          sub.textContent = `From any Lightning wallet`;
          msg.replaceChildren(note(`This code says ${formatFiat(f.amount, f.currency)}, but asks for ${sats(link.sats!)}, which is about ${formatFiat(link.sats! * (f.amount / expected), f.currency)} today. Check the price with the trader before you pay.`, 'error'));
        }
      })
      .catch(() => {
        sub.textContent = `The trader's price: ${formatFiat(f.amount, f.currency)}. Check the amount in sats in your wallet before you pay.`;
      });
  }
  show(
    screen({
      top: [h('p', { class: 'shop' }, `Pay ${link.shop}`)],
      body: [
        headline,
        sub,
        h('p', {}, "You'll get a receipt to show the trader. Their phone checks it, so a fake can't pass."),
        link.mint.includes('testnut') ? note('Test mint: fake sats, no real money.') : null,
        other
          ? h('p', { class: 'note' }, `You have an unfinished payment to ${other.link.shop}. `, h('button', { type: 'button', class: 'link', onclick: () => invoice(other) }, 'Go back to it'))
          : null,
        msg,
      ],
      actions: [pay],
    }),
  );
}

let polling = 0;
/** bumped whenever the screen changes, so an old poll never reschedules itself */
let generation = 0;

function invoice(s: Saved): void {
  const mine = ++generation;
  const api = new MintApi(s.link.mint);
  const status = h('p', { class: 'waiting', 'aria-live': 'polite' }, h('span', { class: 'dot' }), 'Waiting for your payment');
  const copy = button('Copy invoice', () => {
    void navigator.clipboard?.writeText(s.pending.invoice).then(() => (copy.textContent = 'Copied'));
  }, 'quiet');
  show(
    screen({
      top: [h('p', { class: 'shop' }, `Pay ${s.link.shop}`)],
      body: [
        h('p', { class: 'small-amount' }, price(s.link)),
        h('p', { class: 'sub' }, `${sats(s.pending.amountSats)}, from any Lightning wallet`),
        h('div', { class: 'qr' }, qrSvg(`lightning:${s.pending.invoice}`, 'Lightning invoice')),
        status,
        s.pending.amountSats > s.pending.priceSats
          ? h('p', { class: 'hint' }, `Includes ${sats(s.pending.amountSats - s.pending.priceSats)} so the trader receives the full price after the mint's fee.`)
          : null,
      ],
      actions: [
        h('a', { class: 'btn', href: `lightning:${s.pending.invoice}` }, 'Open my wallet'),
        copy,
        button("I'm not paying this", () => {
          // Kept, not deleted: if a payment lands after all, it comes back.
          s.cancelledAt = Date.now();
          save(s);
          generation++;
          window.clearTimeout(polling);
          newPayment();
        }, 'quiet'),
      ],
    }),
  );
  window.clearTimeout(polling);
  let expiredSince = s.expiredAt ?? 0;
  const tick = async () => {
    if (mine !== generation) return;
    try {
      const state = await paymentState(api, s.pending);
      if (mine !== generation) return;
      if (state === 'EXPIRED') {
        // Decided by the mint over several minutes, not by this phone's clock: a late payment still counts.
        if (!expiredSince) {
          expiredSince = Date.now();
          s.expiredAt = expiredSince;
          save(s);
        }
        status.textContent = 'This invoice looks expired. Still checking in case your payment arrives late.';
        if (Date.now() - expiredSince > 10 * 60_000) {
          forget(s.pending.quote);
          status.replaceWith(note('This invoice expired and nothing was paid. Scan the trader’s code again.', 'error'));
          return;
        }
      }
      if (state === 'PAID' || state === 'ISSUED') {
        status.textContent = 'Paid. Making your receipt…';
        const token = await finishPayment(api, s.pending, s.keyset);
        s.receipt = encodeReceipt(token);
        s.paidAt = Date.now();
        save(s);
        return receipt(s);
      }
    } catch {
      // weak signal: try again
    }
    if (mine === generation) polling = window.setTimeout(tick, expiredSince ? 15_000 : 2500);
  };
  void tick();
}

function receipt(s: Saved): void {
  generation++;
  const qr = animatedQr(s.receipt!, `Receipt for ${s.link.shop}`);
  show(
    screen({
      top: [h('p', { class: 'shop' }, `Receipt for ${s.link.shop}`)],
      body: [
        h('p', { class: 'small-amount' }, price(s.link)),
        h('p', { class: 'sub' }, 'Show this to the trader'),
        qr.box,
        qr.dots,
        h('p', { class: 'hint' }, 'Hold steady. The code changes as it plays, and the trader’s phone picks up every part.'),
      ],
      actions: [
        h('p', { class: 'hint' }, `Saved on this phone${s.paidAt ? `, paid ${new Date(s.paidAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}. Keep it until the trader’s phone says Paid.`),
        button('Start a new payment', () => {
          qr.stop();
          // Keep the receipt saved (for disputes); just move on.
          history.replaceState(null, '', location.pathname + location.hash);
          newPayment();
        }, 'quiet'),
      ],
    }),
  );
}

keepOffline();
window.addEventListener('hashchange', () => {
  window.clearTimeout(polling);
  generation++;
  start();
});
start();

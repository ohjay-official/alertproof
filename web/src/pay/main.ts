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
import { formatFiat } from '../../../src/wallet/rates.ts';
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
}

const KEY = 'sealpay:payment';

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the page still works while open
  }
}

const price = (l: PayLink) => (l.fiat ? formatFiat(l.fiat.amount, l.fiat.currency) : sats(l.sats ?? 0));

function start(): void {
  const parsed = parsePayLink(location.hash);
  const saved = load();
  if (!parsed.ok) {
    if (saved?.receipt) return receipt(saved);
    return show(screen({ body: [h('h1', {}, 'Ask the trader to show their pay code again.'), note(parsed.error, 'error')] }));
  }
  const link = parsed.link;
  // Coming back to the same payment: pick up where it was.
  if (saved && saved.link.traderPubkey === link.traderPubkey && saved.link.sats === link.sats && saved.link.mint === link.mint) {
    if (saved.receipt) return receipt(saved);
    return invoice(saved);
  }
  if (!MINTS.some((m) => normalizeMintUrl(m.url) === link.mint)) {
    return show(screen({ body: [h('h1', {}, "Sealpay doesn't support this trader's mint yet."), note(link.mint, 'error')] }));
  }
  if (!link.sats) {
    return show(screen({ body: [h('h1', {}, `Ask ${link.shop} to type the price and show the code again.`)] }));
  }
  const msg = h('div');
  const pay = button(`Pay ${price(link)}`, () =>
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
  show(
    screen({
      top: [h('p', { class: 'shop' }, `Pay ${link.shop}`)],
      body: [
        h('p', { class: 'small-amount' }, price(link)),
        h('p', { class: 'sub' }, `${sats(link.sats)}, from any Lightning wallet`),
        h('p', {}, "You'll get a receipt to show the trader. Their phone checks it, so a fake can't pass."),
        link.mint.includes('testnut') ? note('Test mint: fake sats, no real money.') : null,
        msg,
      ],
      actions: [pay],
    }),
  );
}

let polling = 0;

function invoice(s: Saved): void {
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
      actions: [h('a', { class: 'btn', href: `lightning:${s.pending.invoice}` }, 'Open my wallet'), copy],
    }),
  );
  window.clearTimeout(polling);
  const tick = async () => {
    try {
      const state = await paymentState(api, s.pending);
      if (state === 'EXPIRED') {
        localStorage.removeItem(KEY);
        status.replaceWith(note('This invoice expired. Nothing was paid. Scan the trader’s code again.', 'error'));
        return;
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
    polling = window.setTimeout(tick, 2500);
  };
  void tick();
}

function receipt(s: Saved): void {
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
          localStorage.removeItem(KEY);
          start();
        }, 'quiet'),
      ],
    }),
  );
}

keepOffline();
window.addEventListener('hashchange', () => {
  window.clearTimeout(polling);
  start();
});
start();

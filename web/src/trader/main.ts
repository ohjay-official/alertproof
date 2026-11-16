/**
 * The trader's app: set up once online, then take payments with no data.
 *
 *   welcome -> setup (shop, key, recovery code, PIN) -> price -> pay code
 *   -> scan the customer's receipt -> verdict (checked on this phone, offline)
 *   sales -> collect (PIN) -> cash out to a Lightning invoice
 *
 * Demo mode makes a test trader on fake sats and lets one phone play both
 * sides, with a switch that cuts the network to show the check needs none.
 */
import { acceptReceipt, type Proof, type TrustedMint, type Verdict } from '../../../src/verify/index.ts';
import { nobleCurve } from '../../../src/verify/curve-noble.ts';
import { fetchTrustedMint } from '../../../src/wallet/mint-cache.ts';
import { decodeReceipt, encodeReceipt } from '../../../src/wallet/receipt.ts';
import { newSeed, parseRecoveryCode, recoveryCode, traderKey } from '../../../src/wallet/keys.ts';
import { isValidPin, lockSeed, unlockSeed, type LockedSeed } from '../../../src/wallet/pin-lock.ts';
import { payLinkUrl } from '../../../src/wallet/request.ts';
import { fetchRates, fiatToSats, formatFiat, rateAge, satsToFiat, type Currency, type Rates } from '../../../src/wallet/rates.ts';
import { FrameCollector } from '../../../src/wallet/frames.ts';
import { MintApi } from '../../../src/wallet/mint-api.ts';
import { finishPayment, paymentState, pickKeyset, startPayment } from '../../../src/wallet/pay.ts';
import { collect, planCashOut, planCollect, recoverOutputs, runCashOut, settleCashOut, type CollectPlan, type MeltPlan } from '../../../src/wallet/collect.ts';
import { MintError } from '../../../src/wallet/mint-api.ts';
import { sumAmounts } from '../../../src/wallet/ecash.ts';
import { IdbStore, keepStorage, openDb, type Sale } from '../../../src/app/idb-store.ts';
import { keepOffline } from '../shared/offline.ts';
import { busy, button, explain, h, note, sats, screen, show } from '../shared/dom.ts';
import { animatedQr, qrSvg } from '../shared/qr.ts';
import { startScanner } from '../shared/scan.ts';
import { signalNotPaid, signalPaid, unlockAudio } from '../shared/signal.ts';
import { MINTS, TEST_MINT } from '../shared/config.ts';
import { words, type Lang } from '../shared/i18n.ts';

interface Profile {
  v: 1;
  shop: string;
  currency: Currency;
  demo: boolean;
  pub: string;
  locked: LockedSeed;
  mint: TrustedMint;
  rates: Rates | null;
  /** language of the verdict and the spoken result; older profiles have none (English) */
  lang?: Lang;
  /** ids of the mint's active keysets, to collect into (older saved keysets stay for old receipts) */
  activeIds?: string[];
  /** restored from the recovery code only: receipts are confirmed online until a sync */
  needsOnlineCheck?: boolean;
}

/** A step saved before it goes online, so a crash or a lost answer loses nothing. */
type PendingOp =
  | { kind: 'collect'; id: string; saleId: number; plan: CollectPlan; at: number }
  | { kind: 'melt'; id: string; plan: MeltPlan; at: number };

const DEMO_PIN = '1234';
let store: IdbStore;
let profile: Profile | null = null;

// ------------------------------------------------------------ network switch (demo)

const realFetch = window.fetch.bind(window);
let networkOff = false;
let blocked = 0;
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (networkOff) {
    blocked++;
    return Promise.reject(new TypeError('Network is switched off (demo)'));
  }
  return realFetch(input, init);
}) as typeof fetch;

// ------------------------------------------------------------ helpers

const fiat = (n: number) => formatFiat(n, profile?.currency ?? 'NGN');
const speakFiat = (n: number) => `${Math.round(n)} ${words(profile?.lang ?? 'en').unitWord(profile?.currency ?? 'NGN')}`;

async function saveProfile(p: Profile): Promise<void> {
  profile = p;
  await store.set('profile', p);
}

async function wallet(): Promise<Proof[]> {
  return (await store.get<Proof[]>('wallet')) ?? [];
}

async function pendingOps(): Promise<PendingOp[]> {
  return (await store.get<PendingOp[]>('pending')) ?? [];
}

const isTestMint = (p: Profile) => p.mint.url === TEST_MINT;
const collectInto = (p: Profile) => pickKeyset(p.mint.keysets.filter((k) => !p.activeIds || p.activeIds.includes(k.id)));
const opId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function topBar(): HTMLElement[] {
  const p = profile!;
  return [
    h('div', { class: 'topline' }, h('p', { class: 'shop' }, p.shop), h('a', { href: '#sales', class: 'link' }, 'Sales')),
    isTestMint(p) && !p.demo ? h('p', { class: 'test-bar' }, 'Test mint: fake sats, not real money.') : null,
    p.demo
      ? h(
          'p',
          { class: 'demo-bar' },
          'Demo: fake sats. ',
          h(
            'button',
            {
              type: 'button',
              class: `switch${networkOff ? ' off' : ''}`,
              'aria-pressed': String(networkOff),
              onclick: () => {
                networkOff = !networkOff;
                route();
              },
            },
            networkOff ? 'Network: off' : 'Network: on',
          ),
        )
      : null,
  ].filter(Boolean) as HTMLElement[];
}

/** When online: refresh the rate and the mint's keys, and finish any step a crash left halfway. Never blocks the till. */
async function refreshInBackground(): Promise<void> {
  if (!profile || networkOff || !navigator.onLine) return;
  const p = profile;
  try {
    p.rates = await fetchRates();
  } catch {
    // keep the saved rate
  }
  try {
    const fresh = await fetchTrustedMint(p.mint.url);
    const known = new Set(p.mint.keysets.map((k) => k.id));
    p.mint = { ...fresh, keysets: [...p.mint.keysets.filter((k) => !fresh.keysets.some((f) => f.id === k.id)), ...fresh.keysets] };
    p.activeIds = fresh.keysets.map((k) => k.id);
    if (fresh.keysets.some((k) => !known.has(k.id))) console.info('Sealpay: saved new mint keys');
  } catch {
    // keep the saved keys
  }
  await saveProfile(p);
  await settlePending().catch(() => undefined);
}

/** Finish collects and cash-outs that were interrupted. */
async function settlePending(): Promise<void> {
  const p = profile!;
  const api = new MintApi(p.mint.url);
  for (const op of await pendingOps()) {
    if (op.kind === 'collect') {
      const ks = p.mint.keysets.find((k) => k.id === op.plan.outputs[0]?.id);
      const back = ks ? await recoverOutputs(api, op.plan.outputs, ks) : null;
      const rest = (await pendingOps()).filter((o) => o.id !== op.id);
      if (back) {
        await store.apply({ kv: { wallet: [...(await wallet()), ...back], pending: rest }, collected: [op.saleId] });
        continue;
      }
      // The swap never reached the mint: forget the step, the sale can be collected again.
      const sale = (await store.sales()).find((x) => x.id === op.saleId);
      const states = sale ? await api.checkState(sale.ys) : [];
      if (states.every((x) => x === 'UNSPENT')) await store.apply({ kv: { pending: rest } });
      else if (states.every((x) => x === 'SPENT')) await store.apply({ kv: { pending: rest }, problems: { [op.saleId]: 'spent elsewhere' } });
    } else {
      const ks = p.mint.keysets.find((k) => k.id === op.plan.blanks[0]?.id) ?? collectInto(p);
      const r = await settleCashOut(api, op.plan, ks, (x) => nobleCurve.hashToCurve(x));
      if (r.state === 'PENDING') continue;
      const rest = (await pendingOps()).filter((o) => o.id !== op.id);
      const back = r.state === 'PAID' ? r.change : r.proofs;
      await store.apply({ kv: { wallet: [...(await wallet()), ...back], pending: rest } });
    }
  }
}

// ------------------------------------------------------------ welcome and setup

function welcome(): void {
  show(
    screen({
      body: [
        h('p', { class: 'brand' }, 'Sealpay'),
        h('h1', {}, 'Know a payment is real before the goods leave your hand.'),
        h('p', { class: 'lead' }, 'Customers pay from any Lightning wallet. You scan their receipt and your phone checks it, even with no data.'),
      ],
      actions: [button('Set up my shop', () => setupShop()), button('Try the demo', () => void setupDemo(), 'quiet'), h('a', { class: 'link center', href: '#restore' }, 'I have a recovery code')],
    }),
  );
}

function setupShop(restoreSeed?: Uint8Array): void {
  let currency: Currency = 'NGN';
  let lang: Lang = 'en';
  let mintUrl = '';
  const mintChoice = h(
    'div',
    { class: 'choice stack', role: 'radiogroup', 'aria-label': 'Mint' },
    ...MINTS.map((m) =>
      h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(m.url === mintUrl),
        onclick: (e: Event) => {
          mintUrl = m.url;
          for (const b of mintChoice.querySelectorAll('button')) b.setAttribute('aria-checked', String(b === e.currentTarget));
          mintWarn.textContent = m.test
            ? 'Test mint: fake sats for trying Sealpay. Customers pay nothing real, so never hand over real goods on it.'
            : 'Real money: the mint holds it until you cash out. Keep small amounts there and cash out often.';
          mintWarn.hidden = false;
        },
      }, m.label),
    ),
  );
  const mintWarn = h('p', { class: 'hint left', hidden: true }, 'Real money: the mint holds it until you cash out. Keep small amounts there and cash out often.');
  const langChoice = h(
    'div',
    { class: 'choice', role: 'radiogroup', 'aria-label': 'Language' },
    ...(['en', 'fr'] as const).map((l) =>
      h('button', {
        type: 'button',
        role: 'radio',
        'data-lang': l,
        'aria-checked': String(l === lang),
        onclick: () => setLang(l),
      }, l === 'en' ? 'English' : 'Français'),
    ),
  );
  const setLang = (l: Lang) => {
    lang = l;
    for (const b of langChoice.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.getAttribute('data-lang') === l));
  };
  const name = h('input', { id: 'shop', maxlength: '40', autocomplete: 'organization', placeholder: "e.g. Mama Nkechi's Fabrics" });
  const money = h(
    'div',
    { class: 'choice', role: 'radiogroup', 'aria-label': 'Currency' },
    ...(['NGN', 'XOF'] as const).map((c) =>
      h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(c === currency),
        onclick: (e: Event) => {
          currency = c;
          for (const b of money.querySelectorAll('button')) b.setAttribute('aria-checked', String(b === e.currentTarget));
          setLang(c === 'XOF' ? 'fr' : 'en');
        },
      }, c === 'NGN' ? 'Naira (₦)' : 'CFA'),
    ),
  );
  const msg = h('div');
  const next = button('Next', () =>
    void busy(next, 'Getting ready…', async () => {
      const shop = name.value.trim();
      if (!shop) {
        msg.replaceChildren(note('Type your shop name first.', 'error'));
        return;
      }
      if (!mintUrl) {
        msg.replaceChildren(note('Choose a mint: the test mint to try it out, or Minibits for real money.', 'error'));
        return;
      }
      try {
        const [mint, rates] = await Promise.all([fetchTrustedMint(mintUrl), fetchRates().catch(() => null)]);
        const seed = restoreSeed ?? newSeed();
        if (restoreSeed) await choosePin(seed, { shop, currency, mint, rates, lang }, true);
        else showCode(seed, { shop, currency, mint, rates, lang });
      } catch (err) {
        msg.replaceChildren(note(`${explain(err)} Setup needs data once.`, 'error'));
      }
    }),
  );
  show(
    screen({
      top: [h('p', { class: 'shop' }, restoreSeed ? 'Restore your shop' : 'Set up your shop')],
      body: [
        h('label', { for: 'shop' }, 'Shop name, as customers know it'),
        name,
        h('p', { class: 'label' }, 'Prices in'),
        money,
        h('p', { class: 'label' }, 'Language for Paid / Not paid'),
        langChoice,
        h('p', { class: 'label' }, 'Mint (holds the money until you cash out). Choose one'),
        mintChoice,
        mintWarn,
        msg,
      ],
      actions: [next],
    }),
  );
  name.focus();
}

type Draft = { shop: string; currency: Currency; mint: TrustedMint; rates: Rates | null; lang: Lang };

function showCode(seed: Uint8Array, d: Draft): void {
  const check = h('input', { type: 'checkbox', id: 'wrote' });
  const go = button('Next', () => {
    if (check.checked) void choosePin(seed, d);
  });
  show(
    screen({
      top: [h('p', { class: 'shop' }, d.shop)],
      body: [
        h('h2', {}, 'Write this down.'),
        h('p', {}, 'Your recovery code brings your shop key to a new phone, so payments made to you can still be collected. Money already collected lives on this phone: save a backup file from Sales too. Keep the code on paper and never share it.'),
        h('p', { class: 'code', 'aria-label': 'Recovery code' }, recoveryCode(seed)),
        h('label', { class: 'tick', for: 'wrote' }, check, ' I have written it down on paper'),
      ],
      actions: [go],
    }),
  );
}

async function choosePin(seed: Uint8Array, d: Draft, restored = false): Promise<void> {
  const pin = h('input', { id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: '8' });
  const pin2 = h('input', { id: 'pin2', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: '8' });
  const msg = h('div');
  const save = button('Save and start', () =>
    void busy(save, 'Saving…', async () => {
      if (!isValidPin(pin.value)) return void msg.replaceChildren(note('The PIN must be 4 to 8 digits.', 'error'));
      if (pin.value !== pin2.value) return void msg.replaceChildren(note("The two PINs don't match.", 'error'));
      await finishSetup(seed, d, pin.value, false, restored);
    }),
  );
  show(
    screen({
      top: [h('p', { class: 'shop' }, d.shop)],
      body: [
        h('h2', {}, 'Choose a PIN'),
        h('p', {}, "You'll need it to collect and cash out. Checking payments never asks for it."),
        h('label', { for: 'pin' }, 'PIN (4 to 8 digits)'),
        pin,
        h('label', { for: 'pin2' }, 'Type it again'),
        pin2,
        msg,
      ],
      actions: [save],
    }),
  );
  pin.focus();
}

async function finishSetup(seed: Uint8Array, d: Draft, pin: string, demo: boolean, restored = false): Promise<void> {
  const locked = await lockSeed(seed, pin);
  await saveProfile({
    v: 1, shop: d.shop, currency: d.currency, demo, pub: traderKey(seed).pub, locked, mint: d.mint, rates: d.rates, lang: d.lang,
    activeIds: d.mint.keysets.map((k) => k.id),
    ...(restored ? { needsOnlineCheck: true } : {}),
  });
  void keepStorage();
  location.hash = '#price';
  route();
}

async function setupDemo(): Promise<void> {
  unlockAudio();
  show(screen({ body: [h('p', { class: 'lead' }, 'Setting up a demo stall on the test mint…')] }));
  try {
    const [mint, rates] = await Promise.all([fetchTrustedMint(TEST_MINT), fetchRates().catch(() => null)]);
    await finishSetup(newSeed(), { shop: 'Demo Stall', currency: 'NGN', mint, rates, lang: 'en' }, DEMO_PIN, true);
  } catch (err) {
    show(screen({ body: [note(`${explain(err)} The demo needs data to start.`, 'error')], actions: [button('Back', () => welcome())] }));
  }
}

function restore(): void {
  const input = h('input', { id: 'code', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' });
  const msg = h('div');
  show(
    screen({
      top: [h('p', { class: 'shop' }, 'Restore your shop')],
      body: [
        h('label', { for: 'code' }, 'Your recovery code'),
        input,
        h('label', { for: 'file' }, 'Or a backup file (brings your money and sales too)'),
        h('input', { id: 'file', type: 'file', accept: 'application/json,.json', onchange: (e: Event) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) void restoreBackup(f, msg);
        } }),
        msg,
      ],
      actions: [
        button('Next', () => {
          const seed = parseRecoveryCode(input.value);
          if (!seed) return void msg.replaceChildren(note("That code isn't right. Check each character.", 'error'));
          setupShop(seed);
        }),
        button('Back', () => welcome(), 'quiet'),
      ],
    }),
  );
}

// ------------------------------------------------------------ price and pay code

let typed = '';

function priceScreen(): void {
  const p = profile!;
  const amount = h('p', { class: 'amount', 'aria-live': 'polite' });
  const sub = h('p', { class: 'sub' });
  const go = button('Show pay code', () => {
    const v = Number(typed);
    if (v > 0) payCode(v);
  });
  const draw = () => {
    const v = Number(typed || '0');
    if (p.rates) {
      amount.textContent = fiat(v);
      sub.textContent = v > 0 ? sats(fiatToSats(v, p.currency, p.rates)) : 'Type the price';
    } else {
      amount.textContent = sats(v);
      sub.textContent = 'No saved rate yet: price in sats until you go online once';
    }
    go.disabled = !(v > 0);
  };
  const press = (k: string) => {
    unlockAudio();
    if (k === 'del') typed = typed.slice(0, -1);
    else if ((typed + k).replace(/^0+/, '').length <= 9) typed = (typed + k).replace(/^0+/, '');
    draw();
  };
  const keys = h(
    'div',
    { class: 'keys' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'].map((k) =>
      h('button', { type: 'button', 'aria-label': k === 'del' ? 'Delete' : k, onclick: () => press(k) }, k === 'del' ? '⌫' : k),
    ),
  );
  draw();
  show(
    screen({
      top: [...topBar(), h('p', { class: 'net' }, h('b', {}, 'Works with no data.'), p.rates ? ` Rate saved ${rateAge(p.rates)}` : '')],
      body: [amount, sub, keys],
      actions: [go],
    }),
  );
}

function payCode(price: number): void {
  const p = profile!;
  const requested = p.rates ? fiatToSats(price, p.currency, p.rates) : price;
  const shownFiat = p.rates ? price : null;
  const link = payLinkUrl(location.origin, {
    traderPubkey: p.pub,
    mint: p.mint.url,
    shop: p.shop,
    sats: requested,
    ...(shownFiat ? { fiat: { amount: shownFiat, currency: p.currency } } : {}),
    keysetHint: p.mint.keysets[0]?.id.slice(0, 16),
  });
  const box = h('div', { class: 'qr' }, qrSvg(link, `Pay code for ${shownFiat ? fiat(shownFiat) : sats(requested)}`));
  show(
    screen({
      top: topBar(),
      body: [
        h('p', { class: 'small-amount' }, shownFiat ? fiat(shownFiat) : sats(requested)),
        h('p', { class: 'sub' }, sats(requested)),
        box,
        h('p', { class: 'hint' }, 'The customer scans this with their phone camera and pays.'),
      ],
      actions: [
        p.demo ? button('Demo: pay it as the customer', () => void demoCustomer(requested, shownFiat)) : null,
        button('Scan their receipt', () => scanScreen(requested, shownFiat), p.demo ? 'quiet' : 'main'),
        button('Change amount', () => priceScreen(), 'quiet'),
      ],
    }),
  );
}

// ------------------------------------------------------------ scanning and the verdict

function scanScreen(requested: number | null, shownFiat: number | null): void {
  const video = h('video', { class: 'camera', 'aria-label': 'Camera' });
  const status = h('p', { class: 'hint', 'aria-live': 'polite' }, 'Point the camera at the customer’s receipt code.');
  const collector = new FrameCollector();
  let scanner: { stop(): void } | null = null;
  let finished = false;
  const stop = () => {
    finished = true;
    scanner?.stop();
  };
  show(
    screen({
      top: topBar(),
      body: [h('p', { class: 'small-amount' }, shownFiat ? fiat(shownFiat) : requested ? sats(requested) : 'Any amount'), video, status],
      actions: [
        button('Cancel', () => {
          stop();
          priceScreen();
        }, 'quiet'),
      ],
    }),
  );
  startScanner(video, (text) => {
    if (finished) return;
    const r = collector.add(text);
    if (r.done) {
      stop();
      void check(r.text, requested, shownFiat);
    } else if (r.total > 0) {
      status.textContent = `Got ${r.have} of ${r.total} parts. Hold steady.`;
    }
  })
    .then((s) => {
      if (finished) s.stop();
      else scanner = s;
    })
    .catch((err) => status.replaceWith(note(`${explain(err)} Allow the camera for this site and try again.`, 'error')));
}

let lastReceipt = '';
/** set when a restored phone couldn't confirm a receipt because it was offline */
let msgAfterRestore = false;

async function check(text: string, requested: number | null, shownFiat: number | null): Promise<void> {
  const p = profile!;
  lastReceipt = text;
  msgAfterRestore = false;
  const before = blocked;
  const t0 = performance.now();
  const decoded = decodeReceipt(text, p.mint.keysets.map((k) => k.id));
  let v: Verdict;
  if (!decoded.ok) {
    v = { ok: false, code: 'malformed', detail: decoded.detail };
  } else {
    v = await acceptReceipt(decoded.token, { traderPubkey: p.pub, mints: [p.mint] }, requested ? { requestedSats: requested } : {}, nobleCurve, store, {
      requestedSats: requested,
      fiat: shownFiat ? { amount: shownFiat, currency: p.currency } : null,
    });
    // After a restore from the code alone, this phone doesn't know old receipts: ask the mint.
    if ((v.ok || (v.code === 'underpaid' && v.kept)) && p.needsOnlineCheck) {
      const payment = v.ok ? v : v.received!;
      try {
        const states = await new MintApi(p.mint.url).checkState(payment.ys);
        if (states.some((x) => x !== 'UNSPENT')) v = { ok: false, code: 'already_received', detail: 'the mint says this receipt was already spent' };
      } catch {
        v = { ok: false, code: 'unknown_keys', detail: 'restored phone must confirm receipts online' };
        msgAfterRestore = true;
      }
    }
  }
  verdict(v, requested, shownFiat, { ms: Math.round(performance.now() - t0), requests: blocked - before });
}

function verdict(v: Verdict, requested: number | null, shownFiat: number | null, proof: { ms: number; requests: number }): void {
  const p = profile!;
  const lang = p.lang ?? 'en';
  const W = words(lang);
  const again = p.demo && lastReceipt
    ? [
        button('Demo: show it again', () => void check(lastReceipt, requested, shownFiat), 'quiet'),
        button('Demo: try a faked receipt', () => void check(editReceipt(lastReceipt), requested, shownFiat), 'quiet'),
      ]
    : [];
  const offlineLine = p.demo
    ? `Checked on this phone in ${proof.ms} ms${networkOff ? ` with the network off (${proof.requests} requests)` : ''}.`
    : W.checkedOffline;

  if (v.ok) {
    const lands = v.totalSats - v.feeSats;
    const shown = shownFiat ?? (p.rates ? satsToFiat(lands, p.currency, p.rates) : null);
    signalPaid(W.sayPaid(shown ? speakFiat(shown) : `${lands} sats`), lang);
    show(
      screen({
        tone: 'ok',
        body: [
          h('p', { class: 'stamp' }, W.paid),
          h('p', { class: 'v-amount' }, shown ? fiat(shown) : sats(lands)),
          h('p', { class: 'v-line' }, W.lockedToYou(sats(lands))),
          v.overpaidSats > 0 ? h('p', { class: 'v-line' }, W.moreThanAsked(sats(v.overpaidSats))) : null,
          h('p', { class: 'v-note' }, offlineLine),
          isTestMint(p) ? h('p', { class: 'v-note' }, 'Test mint: fake sats, not real money.') : null,
        ],
        actions: [button(W.nextSale, () => { typed = ''; priceScreen(); }), ...again],
      }),
    );
    return;
  }

  if (v.code === 'underpaid' && v.kept && v.received && requested) {
    const lands = v.received.totalSats - v.received.feeSats;
    const shortSats = requested - lands;
    const got = p.rates ? fiat(satsToFiat(lands, p.currency, p.rates)) : sats(lands);
    const short = p.rates ? fiat(satsToFiat(shortSats, p.currency, p.rates)) : sats(shortSats);
    signalNotPaid(W.sayAskMore(p.rates ? speakFiat(satsToFiat(shortSats, p.currency, p.rates)) : `${shortSats} sats`), lang);
    show(
      screen({
        tone: 'part',
        body: [
          h('p', { class: 'stamp' }, W.part),
          h('p', { class: 'v-head' }, W.gotAskMore(got, short)),
          h('p', { class: 'v-line' }, W.partKept),
          h('p', { class: 'v-note' }, offlineLine),
        ],
        actions: [button(W.askRest, () => payCode(Math.max(1, p.rates ? Math.ceil(satsToFiat(shortSats, p.currency, p.rates)) : shortSats))), button(W.done, () => priceScreen(), 'quiet')],
      }),
    );
    return;
  }

  const used = v.code === 'already_received';
  signalNotPaid(used ? W.sayUsed : W.sayNotPaid, lang);
  show(
    screen({
      tone: 'no',
      body: [
        h('p', { class: 'stamp' }, used ? W.used : W.notPaid),
        h('p', { class: 'v-head' }, used ? W.scannedBefore : W.dontRelease),
        h('p', { class: 'v-line' }, msgAfterRestore ? 'This phone was restored: go online once so it can confirm receipts.' : W.reason(v.code)),
        h('p', { class: 'v-note' }, used ? W.cameOnce : W.screenSays),
      ],
      actions: [button(W.scanAgain, () => scanScreen(requested, shownFiat)), button(W.newSale, () => priceScreen(), 'quiet'), ...again],
    }),
  );
}

/** Demo only: change one amount in the receipt, the way a scammer would. */
function editReceipt(text: string): string {
  const d = decodeReceipt(text, profile!.mint.keysets.map((k) => k.id));
  if (!d.ok) return text;
  const proofs = (d.token.proofs as any[]).map((x) => ({ ...x, amount: Number(x.amount) }));
  proofs[0].amount = proofs[0].amount === 1024 ? 2048 : 1024;
  return encodeReceipt({ mint: String(d.token.mint), unit: 'sat', proofs });
}

// ------------------------------------------------------------ demo: the customer's side on the same phone

async function demoCustomer(requested: number, shownFiat: number | null): Promise<void> {
  const p = profile!;
  if (networkOff) {
    networkOff = false;
  }
  show(screen({ top: topBar(), body: [h('p', { class: 'lead' }, 'Customer pays the test mint with fake sats…')] }));
  try {
    const api = new MintApi(p.mint.url);
    const ks = pickKeyset(p.mint.keysets, p.mint.keysets[0]?.id.slice(0, 16));
    const pending = await startPayment(api, ks, p.pub, requested);
    for (let i = 0; (await paymentState(api, pending)) !== 'PAID'; i++) {
      if (i > 20) throw new Error('The test invoice was not paid.');
      await new Promise((r) => setTimeout(r, 1000));
    }
    const token = await finishPayment(api, pending, ks);
    const text = encodeReceipt(token);
    lastReceipt = text;
    const qr = animatedQr(text, 'Customer receipt');
    show(
      screen({
        top: topBar(),
        body: [
          h('p', { class: 'small-amount' }, shownFiat ? fiat(shownFiat) : sats(requested)),
          h('p', { class: 'sub' }, `The customer's receipt (${text.length.toLocaleString('en-US')} characters)`),
          qr.box,
          qr.dots,
          h('p', { class: 'hint' }, 'On a real stall the trader scans this from the customer’s phone. Here, hand it over directly, and switch the network off first to see the check needs none.'),
        ],
        actions: [
          button(networkOff ? 'Check it (network off)' : 'Switch network off and check it', () => {
            qr.stop();
            networkOff = true;
            void check(text, requested, shownFiat);
          }),
          button('Scan it with the camera', () => {
            qr.stop();
            scanScreen(requested, shownFiat);
          }, 'quiet'),
        ],
      }),
    );
  } catch (err) {
    show(screen({ top: topBar(), body: [note(explain(err), 'error')], actions: [button('Back', () => payCode(shownFiat ?? requested))] }));
  }
}

// ------------------------------------------------------------ sales, collect, cash out

async function salesScreen(flash?: string): Promise<void> {
  const p = profile!;
  const all = (await store.sales()).sort((a, b) => b.at - a.at);
  const today = new Date().toDateString();
  const todays = all.filter((s) => new Date(s.at).toDateString() === today);
  const lands = (s: Sale) => s.totalSats - s.feeSats;
  const sold = sumAmounts(todays.map((s) => ({ amount: lands(s) })));
  const pendingNow = await pendingOps();
  const toCollect = all.filter((s) => !s.collected && !s.problem && !pendingNow.some((o) => o.kind === 'collect' && o.saleId === s.id));
  const held = sumAmounts(await wallet());
  const money = (n: number) => (p.rates ? `${fiat(satsToFiat(n, p.currency, p.rates))} (${sats(n)})` : sats(n));
  /** fiat on top, sats underneath; a full-price sale shows the price as typed */
  const amountCell = (n: number, typedFiat?: number | null) =>
    p.rates || typedFiat ? [typedFiat ? fiat(typedFiat) : fiat(satsToFiat(n, p.currency, p.rates!)), h('small', {}, sats(n))] : [sats(n)];
  const saleFiat = (s: Sale) => (s.fiat && !s.part ? s.fiat.amount : null);
  const fiatTotal = (list: Sale[]) => (list.length && list.every((s) => saleFiat(s) !== null) ? list.reduce((n, s) => n + saleFiat(s)!, 0) : null);
  const msg = h('div', {}, flash ? note(flash) : null, pendingNow.length ? note(`${pendingNow.length} step${pendingNow.length === 1 ? ' is' : 's are'} still finishing with the mint. They settle by themselves when you're online.`) : null);

  const collectBtn = button(`Collect ${toCollect.length} payment${toCollect.length === 1 ? '' : 's'}`, () =>
    void withPin(msg, async (key) => {
      const api = new MintApi(p.mint.url);
      const into = collectInto(p);
      let got = 0;
      const failed: string[] = [];
      for (const s of toCollect) {
        try {
          // Save the outputs first: if the phone dies mid-swap, they recover the money.
          const plan = planCollect(s.proofs, key, p.mint.keysets, into);
          const op: PendingOp = { kind: 'collect', id: opId(), saleId: s.id, plan, at: Date.now() };
          await store.set('pending', [...(await pendingOps()), op]);
          const r = await collect(api, s.proofs, key, p.mint.keysets, into, plan);
          await store.apply({ kv: { wallet: [...(await wallet()), ...r.proofs], pending: (await pendingOps()).filter((o) => o.id !== op.id) }, collected: [s.id] });
          got += sumAmounts(r.proofs);
        } catch (e) {
          // The swap may still have happened (a lost answer): settle it, then look at the rest.
          await settlePending().catch(() => undefined);
          if (e instanceof MintError && /spent/i.test(e.message)) {
            const states = await api.checkState(s.ys).catch(() => []);
            const stillPending = (await pendingOps()).some((o) => o.kind === 'collect' && o.saleId === s.id);
            if (!stillPending && states.length && states.every((x) => x === 'SPENT')) await store.apply({ problems: { [s.id]: 'spent elsewhere' } });
          }
          failed.push(explain(e));
        }
      }
      const parts = [got ? `Collected ${money(got)}. The mint confirmed it's real and it's yours.` : ''];
      if (failed.length) parts.push(`${failed.length} payment${failed.length === 1 ? '' : 's'} couldn't be collected now: ${failed[0]}`);
      msg.replaceChildren(note(parts.filter(Boolean).join(' '), failed.length && !got ? 'error' : 'info'));
      void salesScreen(parts.filter(Boolean).join(' '));
    }),
  );
  collectBtn.disabled = toCollect.length === 0;

  const cashBtn = button('Cash out to my Lightning wallet', () => void cashOutScreen(), 'quiet');
  cashBtn.disabled = held === 0;

  const summary = `Sealpay, ${p.shop}, ${new Date().toLocaleDateString('en-GB')}: sold ${money(sold)} in ${todays.length} sale${todays.length === 1 ? '' : 's'}. Still to collect: ${money(sumAmounts(toCollect.map((s) => ({ amount: lands(s) }))))}. Collected and held: ${money(held)}.`;

  show(
    screen({
      top: [h('div', { class: 'topline' }, h('p', { class: 'shop' }, p.shop), h('a', { href: '#price', class: 'link' }, 'New sale'))],
      body: [
        h('h2', {}, 'Today'),
        h('dl', { class: 'totals' },
          h('dt', {}, 'Sold'), h('dd', {}, ...amountCell(sold, fiatTotal(todays))),
          h('dt', {}, 'Still to collect'), h('dd', {}, ...amountCell(sumAmounts(toCollect.map((s) => ({ amount: lands(s) }))), fiatTotal(toCollect))),
          h('dt', {}, 'Collected and held'), h('dd', {}, ...amountCell(held)),
        ),
        msg,
        h('ul', { class: 'sales' }, ...all.slice(0, 50).map((s) =>
          h('li', {},
            h('span', {}, new Date(s.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })),
            h('span', {}, ...amountCell(lands(s), saleFiat(s))),
            h('span', { class: 'tag' }, s.problem ? "can't collect" : s.part ? 'part paid' : s.collected ? 'collected' : 'to collect'),
          ))),
        all.length === 0 ? h('p', { class: 'hint' }, 'No sales yet. Paid receipts show up here.') : null,
        p.demo ? h('p', { class: 'hint' }, `Demo PIN: ${DEMO_PIN}`) : null,
      ],
      actions: [
        collectBtn,
        cashBtn,
        button('Share summary', () => {
          if (navigator.share) void navigator.share({ text: summary }).catch(() => undefined);
          else window.open(`https://wa.me/?text=${encodeURIComponent(summary)}`, '_blank', 'noopener');
        }, 'quiet'),
        button('Save a backup file', () => void saveBackup(), 'quiet'),
        isTestMint(p) ? button(p.demo ? 'Leave the demo' : 'Start over (test mint)', () => void startOver(), 'quiet') : null,
      ],
    }),
  );
}

async function withPin(msg: HTMLElement, work: (key: ReturnType<typeof traderKey>) => Promise<void>): Promise<void> {
  const p = profile!;
  const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '8', 'aria-label': 'PIN' });
  const go = button('Confirm', () =>
    void busy(go, 'Working…', async () => {
      const seed = await unlockSeed(p.locked, pin.value);
      if (!seed) return void err.replaceChildren(note('Wrong PIN.', 'error'));
      try {
        await work(traderKey(seed));
      } catch (e) {
        err.replaceChildren(note(explain(e), 'error'));
      }
    }),
  );
  const err = h('div');
  msg.replaceChildren(h('div', { class: 'pinbox' }, h('p', {}, 'Enter your PIN'), pin, go, err));
  pin.focus();
}

async function cashOutScreen(): Promise<void> {
  const p = profile!;
  const held = await wallet();
  const total = sumAmounts(held);
  const invoice = h('textarea', { id: 'inv', rows: '4', autocomplete: 'off', placeholder: 'lnbc…' });
  const msg = h('div');
  show(
    screen({
      top: [h('p', { class: 'shop' }, p.shop)],
      body: [
        h('h2', {}, 'Cash out'),
        h('p', {}, `You hold ${sats(total)}${p.rates ? ` (${fiat(satsToFiat(total, p.currency, p.rates))})` : ''}. In your own Lightning wallet, make an invoice for a bit less than that (the mint keeps a small fee), then paste it here.`),
        h('label', { for: 'inv' }, 'Lightning invoice'),
        invoice,
        msg,
      ],
      actions: [
        button('Pay this invoice', () => {
          const text = invoice.value.trim();
          if (!/^ln/i.test(text)) return void msg.replaceChildren(note('Paste a Lightning invoice (it starts with ln).', 'error'));
          void withPin(msg, async (key) => {
            const api = new MintApi(p.mint.url);
            const into = collectInto(p);
            const plan = await planCashOut(api, held, key, p.mint.keysets, into, text);
            // Take the money out of the wallet and save the step in one go, before paying.
            const op: PendingOp = { kind: 'melt', id: opId(), plan, at: Date.now() };
            const spent = new Set(plan.proofs.map((x) => x.secret));
            await store.apply({ kv: { wallet: (await wallet()).filter((x) => !spent.has(x.secret)), pending: [...(await pendingOps()), op] } });
            try {
              const out = await runCashOut(api, plan, key, into);
              if (out.state === 'PAID') {
                await store.apply({ kv: { wallet: [...(await wallet()), ...out.change], pending: (await pendingOps()).filter((o) => o.id !== op.id) } });
                msg.replaceChildren(note(`Paid ${sats(out.paidSats)} to your wallet. Fees ${sats(out.feeSats)}. ${sats(sumAmounts(out.change))} still held.`));
              } else {
                msg.replaceChildren(note('The payment is still going through. It settles by itself next time you open Sealpay online.'));
              }
            } catch (e) {
              // Failed outright, or the answer was lost: ask the mint where it stands.
              await settlePending().catch(() => undefined);
              const still = (await pendingOps()).some((o) => o.id === op.id);
              msg.replaceChildren(note(still ? `${explain(e)} The payment may still go through; it settles by itself when you're online.` : explain(e), 'error'));
            }
          });
        }),
        button('Back', () => void salesScreen(), 'quiet'),
      ],
    }),
  );
}

/** Everything on this phone as a file: the key (still PIN-locked), money held, sales and seen receipts. */
async function saveBackup(): Promise<void> {
  const all = await store.exportAll();
  const kv = { profile: await store.get('profile'), wallet: await wallet(), pending: await pendingOps() };
  const blob = new Blob([JSON.stringify({ sealpayBackup: 1, at: new Date().toISOString(), kv, seen: all.seen, sales: all.sales })], { type: 'application/json' });
  const name = `sealpay-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Sealpay backup' }).catch(() => undefined);
    return;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

async function restoreBackup(file: File, msg: HTMLElement): Promise<void> {
  try {
    const data = JSON.parse(await file.text());
    if (data?.sealpayBackup !== 1 || !data.kv?.profile?.pub) throw new Error('This is not a Sealpay backup file.');
    await store.importAll({ kv: data.kv, seen: Array.isArray(data.seen) ? data.seen : [], sales: Array.isArray(data.sales) ? data.sales : [] });
    profile = (await store.get<Profile>('profile')) ?? null;
    location.hash = '#sales';
    route();
  } catch (e) {
    msg.replaceChildren(note(explain(e), 'error'));
  }
}

/** Test mint only: wipe this phone's Sealpay data and start again. */
async function startOver(): Promise<void> {
  if (!profile || !isTestMint(profile)) return;
  if (!window.confirm('Delete this test stall and its fake sats from this phone?')) return;
  store.db.close();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('sealpay');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  location.hash = '';
  location.reload();
}

// ------------------------------------------------------------ routing

function route(): void {
  const hash = location.hash.slice(1);
  if (!profile) {
    if (hash === 'restore') return restore();
    if (hash === 'demo') return void setupDemo();
    return welcome();
  }
  if (hash === 'sales') return void salesScreen();
  return priceScreen();
}

async function boot(): Promise<void> {
  try {
    store = new IdbStore(await openDb());
    profile = (await store.get<Profile>('profile')) ?? null;
  } catch {
    show(screen({ body: [note("This browser can't save data for Sealpay. Turn off private browsing and try again.", 'error')] }));
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  void refreshInBackground();
}

keepOffline();
void boot();

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
import { acceptReceipt, checkLock, checkReceipt, type CachedKeyset, type Proof, type TrustedMint, type Verdict } from '../../../src/verify/index.ts';
import { nobleCurve } from '../../../src/verify/curve-noble.ts';
import { fetchTrustedMint } from '../../../src/wallet/mint-cache.ts';
import { decodeReceipt, encodeReceipt } from '../../../src/wallet/receipt.ts';
import { newSeed, parseRecoveryCode, recoveryCode, traderKey } from '../../../src/wallet/keys.ts';
import { isValidPin, lockSeed, unlockSeed, type LockedSeed } from '../../../src/wallet/pin-lock.ts';
import { MAX_SATS, cleanShopName, payLinkUrl } from '../../../src/wallet/request.ts';
import { fetchRates, fiatToSats, formatFiat, rateAge, satsToFiat, type Currency, type Rates } from '../../../src/wallet/rates.ts';
import { FrameCollector } from '../../../src/wallet/frames.ts';
import { MintApi } from '../../../src/wallet/mint-api.ts';
import { finishPayment, paymentState, pickKeyset, startPayment } from '../../../src/wallet/pay.ts';
import { collect, MeltFailedError, planCashOut, planCollect, recoverOutputs, runCashOut, settleCashOut, type CollectPlan, type MeltPlan } from '../../../src/wallet/collect.ts';
import { MintError } from '../../../src/wallet/mint-api.ts';
import { inputFee, sumAmounts } from '../../../src/wallet/ecash.ts';
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
  /**
   * Restored from the recovery code alone: this phone doesn't know which old
   * receipts it already accepted, so until this time (ms) each receipt is
   * confirmed online with the mint before Paid. Cleared by a backup restore.
   */
  needsOnlineCheckUntil?: number;
  /** wrong PIN tries in a row, and when the last one was (slows down guessing) */
  pinFails?: { n: number; at: number };
}

/** A step saved before it goes online, so a crash or a lost answer loses nothing. */
type PendingOp =
  | { kind: 'collect'; id: string; saleId: number; plan: CollectPlan; at: number; unseenSince?: number }
  | { kind: 'melt'; id: string; plan: MeltPlan; at: number; unseenSince?: number };

/** Steps that look like they never reached the mint are dropped only after this long, in case a late request lands. */
const CONFIRM_FAILED_MS = 10 * 60_000;
const ONLINE_CHECK_DAYS = 14;

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

/** One money step at a time, across tabs: collect, cash out and settling never overlap. */
let localChain: Promise<unknown> = Promise.resolve();
function withWalletLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: { request(name: string, cb: () => Promise<T>): Promise<T> } }).locks;
  if (locks) return locks.request('sealpay-wallet', work);
  const run = localChain.then(work, work);
  localChain = run.catch(() => undefined);
  return run;
}

const needsOnline = (p: Profile) => (p.needsOnlineCheckUntil ?? 0) > Date.now();

/** The camera, if a scan screen has it on: stopped whenever the screen changes. */
let currentScanner: { stop(): void } | null = null;
function stopScanner(): void {
  currentScanner?.stop();
  currentScanner = null;
}

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
  return withWalletLock(settlePendingLocked);
}

async function settlePendingLocked(): Promise<void> {
  const p = profile!;
  const api = new MintApi(p.mint.url);
  for (const op of await pendingOps()) {
    // One stuck step never blocks the others: each is settled on its own.
    try {
      await settleOne(api, p, op);
    } catch {
      // leave it for next time
    }
  }
}

async function settleOne(api: MintApi, p: Profile, op: PendingOp): Promise<void> {
  if (op.kind === 'collect') {
    const ks = p.mint.keysets.find((k) => k.id === op.plan.outputs[0]?.id);
    // A keyset this phone doesn't know yet: never drop the step (its outputs are the only way back to the money).
    if (!ks) return;
    const back = await recoverOutputs(api, op.plan.outputs, ks);
    if (back) {
      await store.apply({ addProofs: back, removePendingId: op.id, collected: [op.saleId] });
      return;
    }
    const sale = (await store.sales()).find((x) => x.id === op.saleId);
    const states = sale ? await api.checkState(sale.ys) : [];
    const unseenLongEnough = op.unseenSince && Date.now() - op.unseenSince > CONFIRM_FAILED_MS;
    if (!op.unseenSince) {
      // Looks like the swap never reached the mint. Wait a while before deciding, in case it lands late.
      await store.apply({ updatePending: { ...op, unseenSince: Date.now() } });
    } else if (unseenLongEnough) {
      if (states.every((x) => x === 'UNSPENT')) await store.apply({ removePendingId: op.id });
      else await store.apply({ removePendingId: op.id, problems: { [op.saleId]: states.every((x) => x === 'SPENT') ? 'spent elsewhere' : 'partly spent elsewhere' } });
    }
    return;
  }
  const ks = p.mint.keysets.find((k) => k.id === op.plan.blanks[0]?.id) ?? (op.plan.blanks.length ? undefined : collectInto(p));
  if (!ks) return;
  const r = await settleCashOut(api, op.plan, ks, (x) => nobleCurve.hashToCurve(x));
  if (r.state === 'PAID') {
    await store.apply({ addProofs: r.change, removePendingId: op.id });
  } else if (r.state === 'FAILED') {
    if (!op.unseenSince) await store.apply({ updatePending: { ...op, unseenSince: Date.now() } });
    else if (Date.now() - op.unseenSince > CONFIRM_FAILED_MS) await store.apply({ addProofs: r.proofs, removePendingId: op.id });
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

async function choosePin(seed: Uint8Array, d: Draft, restored = false, backup?: Awaited<ReturnType<typeof readBackup>>): Promise<void> {
  const pin = h('input', { id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: '8' });
  const pin2 = h('input', { id: 'pin2', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: '8' });
  const msg = h('div');
  const save = button('Save and start', () =>
    void busy(save, 'Saving…', async () => {
      if (!isValidPin(pin.value)) return void msg.replaceChildren(note('The PIN must be 4 to 8 digits.', 'error'));
      if (pin.value !== pin2.value) return void msg.replaceChildren(note("The two PINs don't match.", 'error'));
      await finishSetup(seed, d, pin.value, false, restored, backup);
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

async function finishSetup(seed: Uint8Array, d: Draft, pin: string, demo: boolean, restored = false, backup?: Awaited<ReturnType<typeof readBackup>>): Promise<void> {
  const locked = await lockSeed(seed, pin);
  if (backup) await store.importAll({ kv: { wallet: backup.wallet, pending: backup.pending }, seen: backup.seen, sales: backup.sales });
  await saveProfile({
    v: 1, shop: d.shop, currency: d.currency, demo, pub: traderKey(seed).pub, locked, mint: d.mint, rates: d.rates, lang: d.lang,
    activeIds: d.mint.keysets.map((k) => k.id),
    // Any restore: the old phone may have taken receipts after the last backup, so confirm online for a while.
    ...(restored || backup ? { needsOnlineCheckUntil: Date.now() + ONLINE_CHECK_DAYS * 86_400_000 } : {}),
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
  const file = h('input', { id: 'file', type: 'file', accept: 'application/json,.json' });
  const msg = h('div');
  const next = button('Next', () =>
    void busy(next, 'Checking…', async () => {
      const seed = parseRecoveryCode(input.value);
      if (!seed) return void msg.replaceChildren(note("That code isn't right. Check each character.", 'error'));
      const f = file.files?.[0];
      if (!f) return setupShop(seed);
      try {
        const b = await readBackup(f, seed);
        await choosePin(seed, { ...b.draft, rates: await fetchRates().catch(() => null) }, false, b);
      } catch (e) {
        msg.replaceChildren(note(explain(e), 'error'));
      }
    }),
  );
  show(
    screen({
      top: [h('p', { class: 'shop' }, 'Restore your shop')],
      body: [
        h('label', { for: 'code' }, 'Your recovery code'),
        input,
        h('label', { for: 'file' }, 'Your backup file, if you have one (brings back money and sales)'),
        file,
        h('p', { class: 'hint left' }, 'Restoring needs data once, to fetch the mint’s keys.'),
        msg,
      ],
      actions: [next, button('Back', () => welcome(), 'quiet')],
    }),
  );
}

// ------------------------------------------------------------ price and pay code

let typed = '';

function priceScreen(): void {
  // The demo's network switch only matters for the check itself: leaving the verdict turns it back on.
  networkOff = false;
  stopScanner();
  const p = profile!;
  // The rate as it was when this screen opened: a rate arriving while typing never changes what the digits mean.
  const rates = p.rates;
  const amount = h('p', { class: 'amount', 'aria-live': 'polite' });
  const sub = h('p', { class: 'sub' });
  const go = button('Show pay code', () => {
    const v = Number(typed);
    if (v > 0) payCode(v, !rates, rates);
  });
  const draw = () => {
    const v = Number(typed || '0');
    let satsFor = v;
    if (rates) {
      amount.textContent = fiat(v);
      try {
        satsFor = v > 0 ? fiatToSats(v, p.currency, rates) : 0;
        sub.textContent = v > 0 ? sats(satsFor) : 'Type the price';
      } catch {
        satsFor = Infinity;
      }
    } else {
      amount.textContent = sats(v);
      sub.textContent = 'No saved rate yet: price in sats until you go online once';
    }
    const tooBig = satsFor > MAX_SATS;
    if (tooBig) sub.textContent = `Too large for one payment (most is ${sats(MAX_SATS)})`;
    go.disabled = !(v > 0) || tooBig;
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

function payCode(price: number, inSats = false, rates: Rates | null = profile!.rates): void {
  stopScanner();
  const p = profile!;
  const useRate = !inSats && rates;
  const requested = useRate ? fiatToSats(price, p.currency, rates!) : price;
  const shownFiat = useRate ? price : null;
  const link = payLinkUrl(location.origin, {
    traderPubkey: p.pub,
    mint: p.mint.url,
    shop: p.shop,
    sats: requested,
    ...(shownFiat ? { fiat: { amount: shownFiat, currency: p.currency } } : {}),
    keysetHint: collectInto(p).id.slice(0, 16),
    made: Math.floor(Date.now() / 1000).toString(36),
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
  stopScanner();
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
      else {
        scanner = s;
        currentScanner = s;
      }
    })
    .catch((err) => {
      // After an update, an old page can ask for a decoder file that's gone: reload once into the new version.
      if (/import|module|fetch/i.test(String(err)) && !sessionStorage.getItem('sealpay-reloaded')) {
        sessionStorage.setItem('sealpay-reloaded', '1');
        location.reload();
        return;
      }
      status.replaceWith(note(`${explain(err)} Allow the camera for this site and try again.`, 'error'));
    });
}

let lastReceipt = '';
/** set when a restored phone couldn't confirm a receipt because it was offline */
let msgAfterRestore = false;

async function check(text: string, requested: number | null, shownFiat: number | null): Promise<void> {
  stopScanner();
  const p = profile!;
  lastReceipt = text;
  msgAfterRestore = false;
  const before = blocked;
  const t0 = performance.now();
  const decoded = decodeReceipt(text, p.mint.keysets.map((k) => k.id));
  const ctx = { traderPubkey: p.pub, mints: [p.mint] };
  const opts = requested ? { requestedSats: requested } : {};
  const claim = { requestedSats: requested, fiat: shownFiat ? { amount: shownFiat, currency: p.currency } : null };
  let v: Verdict;
  if (!decoded.ok) {
    // A keyset this phone hasn't saved yet: the fix is going online, not "invalid receipt".
    v = /saved mint keys/.test(decoded.detail)
      ? { ok: false, code: 'unknown_keys', detail: decoded.detail }
      : { ok: false, code: 'malformed', detail: decoded.detail };
  } else if (needsOnline(p)) {
    // Restored from the code alone: this phone doesn't know old receipts, so the mint confirms
    // each one is unspent BEFORE it's recorded. Offline, nothing is recorded and the trader is told why.
    const pre = checkReceipt(decoded.token, ctx, opts, nobleCurve);
    const payment = pre.ok ? pre : pre.code === 'underpaid' ? pre.received : undefined;
    if (!payment) v = pre;
    else {
      try {
        const states = await new MintApi(p.mint.url).checkState(payment.ys);
        v = states.some((x) => x !== 'UNSPENT')
          ? { ok: false, code: 'already_received', detail: 'the mint says this receipt was already spent' }
          : await acceptReceipt(decoded.token, ctx, opts, nobleCurve, store, claim);
      } catch {
        v = { ok: false, code: 'unknown_keys', detail: 'restored phone must confirm receipts online' };
        msgAfterRestore = true;
      }
    }
  } else {
    v = await acceptReceipt(decoded.token, ctx, opts, nobleCurve, store, claim);
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
        h('a', { class: 'link center', href: '#sales' }, 'Sales'),
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
    // The same rounded-up figure everywhere: on screen, spoken, and on the follow-up pay code.
    const shortFiat = p.rates ? Math.ceil(satsToFiat(shortSats, p.currency, p.rates)) : 0;
    const short = shortFiat >= 1 ? fiat(shortFiat) : sats(shortSats);
    signalNotPaid(W.sayAskMore(shortFiat >= 1 ? speakFiat(shortFiat) : `${shortSats} sats`), lang);
    show(
      screen({
        tone: 'part',
        body: [
          h('p', { class: 'stamp' }, W.part),
          h('p', { class: 'v-head' }, W.gotAskMore(got, short)),
          h('p', { class: 'v-line' }, W.partKept),
          h('p', { class: 'v-note' }, offlineLine),
        ],
        actions: [button(W.askRest, () => (shortFiat >= 1 ? payCode(shortFiat) : payCode(shortSats, true))), button(W.done, () => { typed = ''; priceScreen(); }, 'quiet')],
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
        h('p', { class: 'v-line' }, msgAfterRestore ? W.restoredOnline : W.reason(v.code)),
        h('p', { class: 'v-note' }, used ? W.cameOnce : W.screenSays),
      ],
      actions: [button(W.scanAgain, () => scanScreen(requested, shownFiat)), button(W.newSale, () => { typed = ''; priceScreen(); }, 'quiet'), ...again],
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
    const ks = collectInto(p);
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
  networkOff = false;
  stopScanner();
  const p = profile!;
  // Finish anything left halfway, in the background, whenever Sales opens online.
  const pendingAtOpen = (await pendingOps()).length;
  if (navigator.onLine && !flash && pendingAtOpen > 0) {
    void settlePending()
      .then(async () => {
        if (location.hash === '#sales' && (await pendingOps()).length < pendingAtOpen) void salesScreen();
      })
      .catch(() => undefined);
  }
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
      collectBtn.disabled = true;
      const result = await withWalletLock(async () => {
        const api = new MintApi(p.mint.url);
        const into = collectInto(p);
        let got = 0;
        const failed: string[] = [];
        const busyNow = await pendingOps();
        // Re-read inside the lock: another tab may have collected some already.
        const fresh = new Map((await store.sales()).map((x) => [x.id, x]));
        for (const s of toCollect) {
          const now = fresh.get(s.id);
          if (!now || now.collected || now.problem) continue;
          if (busyNow.some((o) => o.kind === 'collect' && o.saleId === s.id)) continue;
          try {
            // Save the outputs first: if the phone dies mid-swap, they recover the money.
            const plan = planCollect(s.proofs, key, p.mint.keysets, into);
            const op: PendingOp = { kind: 'collect', id: opId(), saleId: s.id, plan, at: Date.now() };
            await store.apply({ addPending: op });
            const r = await collect(api, s.proofs, key, p.mint.keysets, into, plan);
            await store.apply({ addProofs: r.proofs, removePendingId: op.id, collected: [s.id] });
            got += sumAmounts(r.proofs);
          } catch (e) {
            if (e instanceof MintError && /spent/i.test(e.message)) {
              const states = await api.checkState(s.ys).catch(() => []);
              if (states.length && states.every((x) => x === 'SPENT')) {
                // Spent before this collect: either an earlier collect whose answer was lost (restore finds it) or elsewhere.
                await settlePendingLocked().catch(() => undefined);
              }
            }
            failed.push(explain(e));
          }
        }
        if (failed.length) await settlePendingLocked().catch(() => undefined);
        return { got, failed };
      });
      const parts = [result.got ? `Collected ${money(result.got)}. The mint confirmed it's real and it's yours.` : ''];
      if (result.failed.length) parts.push(`${result.failed.length} payment${result.failed.length === 1 ? '' : 's'} couldn't be collected now: ${result.failed[0]}`);
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
        button('Save a backup file', () => void saveBackup(msg), 'quiet'),
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
      // Each wrong try in a row after the third makes the next one wait longer.
      const fails = p.pinFails ?? { n: 0, at: 0 };
      const wait = fails.n >= 3 ? Math.min(3600_000, 5_000 * 2 ** (fails.n - 3)) - (Date.now() - fails.at) : 0;
      if (wait > 0) return void err.replaceChildren(note(`Too many wrong PINs. Try again in ${Math.ceil(wait / 1000)} seconds.`, 'error'));
      const seed = await unlockSeed(p.locked, pin.value);
      if (!seed) {
        p.pinFails = { n: fails.n + 1, at: Date.now() };
        await saveProfile(p);
        return void err.replaceChildren(note('Wrong PIN.', 'error'));
      }
      if (p.pinFails) {
        delete p.pinFails;
        await saveProfile(p);
      }
      if (traderKey(seed).pub !== p.pub) return void err.replaceChildren(note("This phone's shop key doesn't match its recovery seed. Restore from your recovery code.", 'error'));
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
  const payBtn = button('Pay this invoice', () => {
    const text = invoice.value.trim();
    if (!/^ln/i.test(text)) return void msg.replaceChildren(note('Paste a Lightning invoice (it starts with ln).', 'error'));
    void withPin(msg, async (key) => {
      payBtn.disabled = true;
      const outcome = await withWalletLock(async () => {
        const api = new MintApi(p.mint.url);
        const into = collectInto(p);
        // Read the wallet now, inside the lock, and leave out anything a saved step already holds.
        const reserved = new Set((await pendingOps()).flatMap((o) => (o.kind === 'melt' ? o.plan.proofs.map((x) => x.secret) : [])));
        const now = (await wallet()).filter((x) => !reserved.has(x.secret));
        if (now.length === 0) throw new Error('Nothing to cash out right now.');
        const plan = await planCashOut(api, now, key, p.mint.keysets, into, text);
        // Take the money out of the wallet and save the step in one go, before paying.
        const op: PendingOp = { kind: 'melt', id: opId(), plan, at: Date.now() };
        await store.apply({ removeSecrets: plan.proofs.map((x) => x.secret), addPending: op });
        try {
          const out = await runCashOut(api, plan, key, into);
          if (out.state === 'PAID') {
            await store.apply({ addProofs: out.change, removePendingId: op.id });
            return `Paid ${sats(out.paidSats)} to your wallet. Fees ${sats(out.feeSats)}. ${sats(sumAmounts(out.change))} still held.`;
          }
          return 'The payment is still going through. It settles by itself next time you open Sealpay online.';
        } catch (e) {
          if (e instanceof MeltFailedError) {
            // The mint itself says nothing was spent: the money goes straight back.
            await store.apply({ addProofs: plan.proofs, removePendingId: op.id });
            return explain(e);
          }
          // The answer was lost: the saved step settles it (money back, or change) once the mint confirms.
          return `${explain(e)} If any money left, it settles by itself when you're online; nothing is lost.`;
        }
      });
      void salesScreen(outcome);
    });
  });
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
        payBtn,
        button('Back', () => void salesScreen(), 'quiet'),
      ],
    }),
  );
}

/** Everything on this phone as a file: the key (still PIN-locked), money held, sales and seen receipts. */
async function saveBackup(msg: HTMLElement): Promise<void> {
  // Behind the PIN, and without the PIN-locked seed: the file alone can't spend anything;
  // restoring needs the recovery code too.
  await withPin(msg, async () => {
    const all = await store.exportAll();
    const { locked: _locked, pinFails: _fails, ...profileNoSeed } = profile!;
    const kv = { profile: profileNoSeed, wallet: await wallet(), pending: await pendingOps() };
    const blob = new Blob([JSON.stringify({ sealpayBackup: 2, at: new Date().toISOString(), kv, seen: all.seen, sales: all.sales })], { type: 'application/json' });
    const name = `sealpay-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sealpay backup' }).catch(() => undefined);
    } else {
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      a.remove();
    }
    msg.replaceChildren(note('Backup saved. To restore it you also need your recovery code.'));
  });
}

const SEEN_RE = /^0[23][0-9a-f]{64}$/;

/**
 * Check a backup file against the recovery code before using any of it: the
 * shop key must come from this code, the mint must be one Sealpay offers, its
 * keys are fetched fresh from the mint (never trusted from the file), and only
 * known fields are read.
 */
async function readBackup(file: File, seed: Uint8Array): Promise<{ draft: Draft; wallet: Proof[]; pending: PendingOp[]; seen: string[]; sales: Sale[] }> {
  if (file.size > 5_000_000) throw new Error('This file is too big to be a Sealpay backup.');
  const data = JSON.parse(await file.text());
  const prof = data?.kv?.profile;
  if (data?.sealpayBackup !== 2 || typeof prof?.pub !== 'string') throw new Error('This is not a Sealpay backup file.');
  if (traderKey(seed).pub !== prof.pub) throw new Error("This backup belongs to a different recovery code.");
  const offered = MINTS.find((m) => m.url === prof.mint?.url);
  if (!offered) throw new Error("This backup uses a mint Sealpay doesn't offer.");
  const mint = await fetchTrustedMint(offered.url);
  const saved = Array.isArray(prof.mint?.keysets) ? prof.mint.keysets : [];
  // Keep older keysets only if the mint still serves exactly those keys.
  // The file's saved keys are never trusted: every keyset its money uses is fetched from the mint itself.
  void saved;
  const lockedTo = (x: Proof) => checkLock(x.secret, prof.pub).ok;
  const walletIn: Proof[] = (Array.isArray(data.kv.wallet) ? data.kv.wallet : []).filter(lockedTo);
  const salesIn: Sale[] = (Array.isArray(data.sales) ? data.sales : []).filter((x: any) => Number.isSafeInteger(x?.id) && Array.isArray(x?.proofs) && x.proofs.every(lockedTo));
  const ids = new Set([...walletIn, ...salesIn.flatMap((x) => x.proofs)].map((x) => x.id).filter((id) => !mint.keysets.some((k) => k.id === id)));
  const older: CachedKeyset[] = [];
  for (const id of ids) {
    try {
      const res = await fetch(`${mint.url}/v1/keys/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
      const entry = (await res.json())?.keysets?.find((k: any) => k?.id === id);
      if (entry?.unit === 'sat' && entry.keys) older.push({ id, unit: 'sat', keys: entry.keys, input_fee_ppk: Number.isSafeInteger(entry.input_fee_ppk) ? entry.input_fee_ppk : 0 });
    } catch {
      // that money stays in the file's sales, collectable once the mint serves its keys
    }
  }
  const merged = { ...mint, keysets: [...older, ...mint.keysets] };
  // Sale totals are recomputed from the proofs, never taken from the file.
  const salesFixed = salesIn.map((x) => {
    const total = x.proofs.reduce((n, pr) => n + (Number.isSafeInteger(pr.amount) ? pr.amount : 0), 0);
    let fee = 0;
    try {
      fee = inputFee(x.proofs, merged.keysets);
    } catch {
      fee = 0;
    }
    return { ...x, totalSats: total, feeSats: fee };
  });
  return {
    draft: {
      shop: cleanShopName(String(prof.shop ?? 'My shop')) || 'My shop',
      currency: prof.currency === 'XOF' ? 'XOF' : 'NGN',
      lang: prof.lang === 'fr' ? 'fr' : 'en',
      mint: merged,
      rates: null,
    },
    wallet: walletIn,
    // Steps that were halfway at backup time are not taken from the file: a crafted step could redirect money.
    pending: [],
    seen: (Array.isArray(data.seen) ? data.seen : []).filter((y: unknown) => typeof y === 'string' && SEEN_RE.test(y)),
    sales: salesFixed,
  };
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
  stopScanner();
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptReceipt, checkReceipt, MAX_PROOFS } from './check.ts';
import { MemorySeenStore } from './seen.ts';
import type { CurveOps, TraderContext, Verdict } from './types.ts';
import {
  fakeCurve,
  lockSecret,
  makeKeyset,
  makeToken,
  makeTrustedMint,
  signProof,
  OTHER_TRADER,
  TRADER,
  MINT_URL,
  hex32,
} from './test/fake-mint.ts';

const KS = makeKeyset('mint-a');
const ctx = (over: Partial<TraderContext> = {}): TraderContext => ({
  traderPubkey: TRADER,
  mints: [makeTrustedMint(MINT_URL, [KS])],
  ...over,
});

function expectCode(v: Verdict, code: string) {
  assert.equal(v.ok, false, `expected ${code}, got ok`);
  if (!v.ok) assert.equal(v.code, code, v.detail);
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test('happy path: a real-looking receipt for exactly the asked amount is green', () => {
  const token = makeToken(1333, { ks: KS });
  const v = checkReceipt(token, ctx(), { requestedSats: 1333 }, fakeCurve);
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.totalSats, 1333);
    assert.equal(v.overpaidSats, 0);
    assert.equal(v.feeSats, 0);
    assert.equal(v.mint, MINT_URL);
    assert.equal(v.ys.length, token.proofs.length);
    assert.equal(v.proofs.length, token.proofs.length);
  }
});

test('overpayment is shown, sticker payments with no amount set pass', () => {
  const token = makeToken(1500, { ks: KS });
  const v = checkReceipt(token, ctx(), { requestedSats: 1333 }, fakeCurve);
  assert.ok(v.ok && v.overpaidSats === 167);
  const sticker = checkReceipt(token, ctx(), {}, fakeCurve);
  assert.ok(sticker.ok && sticker.totalSats === 1500 && sticker.overpaidSats === 0);
});

test('underpaid, but only after every signature checks out', () => {
  const token = makeToken(1000, { ks: KS });
  const v = checkReceipt(token, ctx(), { requestedSats: 1333 }, fakeCurve);
  expectCode(v, 'underpaid');
  assert.ok(!v.ok && v.received?.totalSats === 1000);
  // one sat short is still short
  expectCode(checkReceipt(makeToken(1332, { ks: KS }), ctx(), { requestedSats: 1333 }, fakeCurve), 'underpaid');

  // forged AND short: must say "not signed", never "short by", so the trader
  // doesn't ask for the difference on top of a fake payment
  const forged = clone(token);
  forged.proofs[0]!.C = '02' + hex32();
  expectCode(checkReceipt(forged, ctx(), { requestedSats: 1333 }, fakeCurve), 'bad_signature');
});

test('NUT-02 input fees are reported, rounded up', () => {
  const feeKs = makeKeyset('fee-mint', { fee: 100 });
  const c = ctx({ mints: [makeTrustedMint(MINT_URL, [feeKs])] });
  const token = makeToken(7, { ks: feeKs }); // 3 proofs x 100 ppk = 0.3 sat -> 1
  const v = checkReceipt(token, c, {}, fakeCurve);
  assert.ok(v.ok && v.feeSats === 1);
});

test('edited amount: the signature is per amount key, so it fails', () => {
  const token = makeToken(8, { ks: KS });
  token.proofs[0]!.amount = 1024;
  expectCode(checkReceipt(token, ctx(), {}, fakeCurve), 'bad_signature');
});

test('edited secret, copied signature, swapped DLEQ values all fail', () => {
  const base = makeToken(3, { ks: KS }); // proofs of 1 and 2

  const editedSecret = clone(base);
  editedSecret.proofs[0]!.secret = lockSecret(TRADER);
  expectCode(checkReceipt(editedSecret, ctx(), {}, fakeCurve), 'bad_signature');

  const copiedC = clone(base);
  copiedC.proofs[0]!.C = copiedC.proofs[1]!.C;
  expectCode(checkReceipt(copiedC, ctx(), {}, fakeCurve), 'bad_signature');

  for (const field of ['e', 's', 'r'] as const) {
    const t = clone(base);
    t.proofs[0]!.dleq![field] = hex32();
    expectCode(checkReceipt(t, ctx(), {}, fakeCurve), 'bad_signature');
  }
});

test("a token from an attacker's own mint, relabelled with the trusted URL, fails", () => {
  // same keyset id as the trusted mint, different keys
  const fakeKs = { ...makeKeyset('attacker'), id: KS.id };
  const token = makeToken(500, { ks: fakeKs });
  expectCode(checkReceipt(token, ctx(), {}, fakeCurve), 'bad_signature');
});

test('a token from a mint the trader did not choose fails, in any spelling', () => {
  const token = makeToken(500, { ks: KS, mint: 'https://evil.example.com' });
  expectCode(checkReceipt(token, ctx(), {}, fakeCurve), 'untrusted_mint');
  for (const mint of ['http://nofees.testnut.cashu.space', 'nofees.testnut.cashu.space', '', 'https://x.com?a']) {
    expectCode(checkReceipt({ ...makeToken(1, { ks: KS }), mint }, ctx(), {}, fakeCurve), 'untrusted_mint');
  }
  // harmless spelling differences of the trusted mint still pass
  const ok = checkReceipt({ ...makeToken(1, { ks: KS }), mint: MINT_URL + '/' }, ctx(), {}, fakeCurve);
  assert.equal(ok.ok, true);
});

test("a keyset from another trusted mint doesn't count for this mint", () => {
  const ksB = makeKeyset('mint-b');
  const c = ctx({ mints: [makeTrustedMint(MINT_URL, [KS]), makeTrustedMint('https://mint-b.example.com', [ksB])] });
  const token = makeToken(4, { ks: ksB, mint: MINT_URL });
  expectCode(checkReceipt(token, c, {}, fakeCurve), 'unknown_keys');
});

test('unknown keyset, amount with no key, non-sat keyset', () => {
  const t1 = makeToken(4, { ks: KS });
  t1.proofs[0]!.id = '00ffffffffffffff';
  expectCode(checkReceipt(t1, ctx(), {}, fakeCurve), 'unknown_keys');

  const t2 = makeToken(4, { ks: KS });
  t2.proofs[0]!.amount = 3;
  expectCode(checkReceipt(t2, ctx(), {}, fakeCurve), 'unknown_keys');

  const usd = makeKeyset('usd', { unit: 'usd' });
  const c = ctx({ mints: [makeTrustedMint(MINT_URL, [usd])] });
  expectCode(checkReceipt(makeToken(4, { ks: usd }), c, {}, fakeCurve), 'wrong_unit');
});

test('amount keys are looked up as own properties only', () => {
  const ks = makeKeyset('proto');
  const c = ctx({ mints: [makeTrustedMint(MINT_URL, [ks])] });
  const token = makeToken(4, { ks });
  // an amount whose string form is an inherited property name can't be a number,
  // but make sure inherited keys are never used
  Object.setPrototypeOf(ks.keys, { '8192': ks.keys['4'] });
  token.proofs[0]!.amount = 8192;
  expectCode(checkReceipt(token, c, {}, fakeCurve), 'unknown_keys');
});

test('bigint amounts (cashu-ts v4) are read exactly; too-large ones are refused', () => {
  const token = makeToken(12, { ks: KS }) as unknown as { proofs: Array<{ amount: unknown }> };
  for (const p of token.proofs) p.amount = BigInt(p.amount as number);
  const v = checkReceipt({ ...token, mint: MINT_URL, unit: 'sat' }, ctx(), { requestedSats: 12 }, fakeCurve);
  assert.ok(v.ok && v.totalSats === 12 && typeof v.proofs[0]!.amount === 'number');
  token.proofs[0]!.amount = 2n ** 64n;
  expectCode(checkReceipt({ ...token, mint: MINT_URL, unit: 'sat' }, ctx(), {}, fakeCurve), 'malformed');
  token.proofs[0]!.amount = 0n;
  expectCode(checkReceipt({ ...token, mint: MINT_URL, unit: 'sat' }, ctx(), {}, fakeCurve), 'malformed');
});

test('wrong or missing unit', () => {
  expectCode(checkReceipt(makeToken(4, { ks: KS, unit: 'usd' }), ctx(), {}, fakeCurve), 'wrong_unit');
  const { unit: _unit, ...noUnit } = makeToken(4, { ks: KS });
  expectCode(checkReceipt(noUnit, ctx(), {}, fakeCurve), 'wrong_unit');
});

test('a mint whose cached info lacks NUT-11 or NUT-12 is refused', () => {
  for (const nuts of [
    { '12': { supported: true } },
    { '11': { supported: true } },
    { '11': { supported: 'true' }, '12': { supported: true } },
    { '11': true, '12': { supported: true } },
    {},
  ]) {
    const mint = { ...makeTrustedMint(MINT_URL, [KS]), info: { nuts } };
    expectCode(checkReceipt(makeToken(4, { ks: KS }), ctx({ mints: [mint] }), {}, fakeCurve), 'mint_not_ready');
  }
  const noInfo = { ...makeTrustedMint(MINT_URL, [KS]), info: {} };
  expectCode(checkReceipt(makeToken(4, { ks: KS }), ctx({ mints: [noInfo] }), {}, fakeCurve), 'mint_not_ready');
});

test('lock problems come through with their own codes', () => {
  expectCode(checkReceipt(makeToken(4, { ks: KS, lockTo: OTHER_TRADER }), ctx(), {}, fakeCurve), 'not_locked_to_you');
  expectCode(checkReceipt(makeToken(4, { ks: KS, secret: () => hex32() }), ctx(), {}, fakeCurve), 'not_locked_to_you');
  const refund = (n: number) =>
    JSON.stringify(['P2PK', { nonce: hex32(), data: TRADER, tags: [['locktime', String(n + 1)], ['refund', OTHER_TRADER]] }]);
  expectCode(checkReceipt(makeToken(4, { ks: KS, secret: refund }), ctx(), {}, fakeCurve), 'can_be_taken_back');
  const shared = () => JSON.stringify(['P2PK', { nonce: hex32(), data: TRADER, tags: [['pubkeys', OTHER_TRADER]] }]);
  expectCode(checkReceipt(makeToken(4, { ks: KS, secret: shared }), ctx(), {}, fakeCurve), 'shared_lock');
});

test('one bad proof among good ones spoils the whole receipt', () => {
  const token = makeToken(7, { ks: KS }); // 1 + 2 + 4
  token.proofs[2] = signProof(KS, 4, lockSecret(OTHER_TRADER));
  expectCode(checkReceipt(token, ctx(), {}, fakeCurve), 'not_locked_to_you');
});

test('the same proof twice in one receipt is refused (it would count double)', () => {
  const token = makeToken(4, { ks: KS });
  token.proofs.push(clone(token.proofs[0]!));
  expectCode(checkReceipt(token, ctx(), {}, fakeCurve), 'malformed');
});

test('missing or broken DLEQ', () => {
  const t1 = makeToken(4, { ks: KS });
  delete t1.proofs[0]!.dleq;
  expectCode(checkReceipt(t1, ctx(), {}, fakeCurve), 'missing_dleq');

  const t2 = clone(makeToken(4, { ks: KS })) as unknown as { proofs: Array<Record<string, unknown>> };
  t2.proofs[0]!.dleq = { e: hex32(), s: hex32() };
  expectCode(checkReceipt({ ...t2, mint: MINT_URL, unit: 'sat' }, ctx(), {}, fakeCurve), 'missing_dleq');

  const t3 = makeToken(4, { ks: KS });
  t3.proofs[0]!.dleq!.e = t3.proofs[0]!.dleq!.e.toUpperCase();
  expectCode(checkReceipt(t3, ctx(), {}, fakeCurve), 'malformed');

  const t4 = makeToken(4, { ks: KS });
  t4.proofs[0]!.dleq!.s = 'zz';
  expectCode(checkReceipt(t4, ctx(), {}, fakeCurve), 'malformed');
});

test('broken receipt shapes never throw and never pass', () => {
  const good = makeToken(4, { ks: KS });
  const inputs: unknown[] = [
    null,
    undefined,
    42,
    'cashuB...',
    [],
    {},
    { ...good, proofs: [] },
    { ...good, proofs: 'x' },
    { ...good, proofs: [null] },
    { ...good, proofs: [{ ...good.proofs[0], amount: 0 }] },
    { ...good, proofs: [{ ...good.proofs[0], amount: -4 }] },
    { ...good, proofs: [{ ...good.proofs[0], amount: 4.5 }] },
    { ...good, proofs: [{ ...good.proofs[0], amount: '4' }] },
    { ...good, proofs: [{ ...good.proofs[0], amount: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...good, proofs: [{ ...good.proofs[0], id: 'XYZ' }] },
    { ...good, proofs: [{ ...good.proofs[0], C: 'not hex' }] },
    { ...good, proofs: [{ ...good.proofs[0], C: '04' + hex32() }] },
    { ...good, proofs: [{ ...good.proofs[0], secret: '' }] },
    { ...good, proofs: [{ ...good.proofs[0], secret: 'x'.repeat(5000) }] },
    { ...good, proofs: Array.from({ length: MAX_PROOFS + 1 }, () => good.proofs[0]) },
  ];
  for (const input of inputs) {
    const v = checkReceipt(input, ctx(), {}, fakeCurve);
    assert.equal(v.ok, false, JSON.stringify(input)?.slice(0, 120));
  }
});

test('a curve implementation that throws is treated as a failed check', () => {
  const throwing: CurveOps = {
    hashToCurve: fakeCurve.hashToCurve,
    verifyProofDleq: () => {
      throw new Error('bad point');
    },
  };
  expectCode(checkReceipt(makeToken(4, { ks: KS }), ctx(), {}, throwing), 'bad_signature');
  const badH2c: CurveOps = { ...fakeCurve, hashToCurve: () => 'nope' };
  expectCode(checkReceipt(makeToken(4, { ks: KS }), ctx(), {}, badH2c), 'malformed');
});

test('the curve gets the right key for each amount and the right Y', () => {
  const token = makeToken(3, { ks: KS });
  const calls: Array<{ A: string; Y: string }> = [];
  const spy: CurveOps = {
    hashToCurve: fakeCurve.hashToCurve,
    verifyProofDleq: (p) => {
      calls.push({ A: p.A, Y: p.Y });
      return fakeCurve.verifyProofDleq(p);
    },
  };
  assert.equal(checkReceipt(token, ctx(), {}, spy).ok, true);
  assert.deepEqual(
    calls,
    token.proofs.map((p) => ({ A: KS.keys[String(p.amount)]!, Y: fakeCurve.hashToCurve(p.secret) })),
  );
});

test('the check does not change the receipt it was given', () => {
  const token = makeToken(13, { ks: KS });
  const before = JSON.stringify(token);
  checkReceipt(token, ctx(), { requestedSats: 13 }, fakeCurve);
  assert.equal(JSON.stringify(token), before);
});

test('accepted proofs carry only checked fields', () => {
  const token = makeToken(4, { ks: KS }) as unknown as { proofs: Array<Record<string, unknown>> };
  token.proofs[0]!.witness = '{"signatures":["x"]}';
  token.proofs[0]!.extra = 'y';
  const v = checkReceipt({ ...token, mint: MINT_URL, unit: 'sat' }, ctx(), {}, fakeCurve);
  assert.ok(v.ok);
  if (v.ok) assert.deepEqual(Object.keys(v.proofs[0]!).sort(), ['C', 'amount', 'dleq', 'id', 'secret']);
});

test('bad requested amount from our own code is a programming error', () => {
  for (const requestedSats of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => checkReceipt(makeToken(4, { ks: KS }), ctx(), { requestedSats }, fakeCurve), RangeError);
  }
});

test('replay: the same receipt scanned twice is refused the second time', async () => {
  const store = new MemorySeenStore();
  const token = makeToken(1333, { ks: KS });
  const first = await acceptReceipt(token, ctx(), { requestedSats: 1333 }, fakeCurve, store);
  assert.equal(first.ok, true);
  const again = await acceptReceipt(clone(token), ctx(), { requestedSats: 1333 }, fakeCurve, store);
  expectCode(again, 'already_received');
  assert.equal(store.payments.length, 1);
});

test('replay: a receipt reusing one old proof records nothing new', async () => {
  const store = new MemorySeenStore();
  const old = makeToken(4, { ks: KS });
  assert.equal((await acceptReceipt(old, ctx(), {}, fakeCurve, store)).ok, true);

  const mixed = makeToken(2, { ks: KS });
  mixed.proofs.push(clone(old.proofs[0]!));
  expectCode(await acceptReceipt(mixed, ctx(), {}, fakeCurve, store), 'already_received');
  assert.equal(store.seen.size, 1, 'the fresh proof must not be marked as seen');
  assert.equal(store.payments.length, 1);

  // the fresh part alone still goes through afterwards
  const freshOnly = { ...mixed, proofs: [mixed.proofs[0]!] };
  assert.equal((await acceptReceipt(freshOnly, ctx(), {}, fakeCurve, store)).ok, true);
});

test('replay: a forged or wrongly locked receipt is not recorded', async () => {
  const store = new MemorySeenStore();
  const forged = makeToken(1000, { ks: KS });
  forged.proofs[0]!.C = '02' + hex32();
  expectCode(await acceptReceipt(forged, ctx(), {}, fakeCurve, store), 'bad_signature');
  expectCode(await acceptReceipt(makeToken(8, { ks: KS, lockTo: OTHER_TRADER }), ctx(), {}, fakeCurve, store), 'not_locked_to_you');
  assert.equal(store.seen.size, 0);
  assert.equal(store.payments.length, 0);
});

test('review #1: a receipt already received shows "already received", never "short by"', async () => {
  const store = new MemorySeenStore();
  const token = makeToken(1000, { ks: KS });
  assert.equal((await acceptReceipt(token, ctx(), { requestedSats: 1000 }, fakeCurve, store)).ok, true);
  // shown again for a bigger sale: must not invite "ask for 333 more"
  const again = await acceptReceipt(clone(token), ctx(), { requestedSats: 1333 }, fakeCurve, store);
  expectCode(again, 'already_received');
});

test('review #2: a genuine part payment is kept, so it can be collected and never counted twice', async () => {
  const store = new MemorySeenStore();
  const part = makeToken(1000, { ks: KS });
  const first = await acceptReceipt(part, ctx(), { requestedSats: 1333 }, fakeCurve, store);
  expectCode(first, 'underpaid');
  assert.ok(!first.ok && first.kept === true && first.received?.totalSats === 1000);
  assert.equal(store.payments.length, 1);

  // the rest arrives as a second receipt
  const rest = makeToken(333, { ks: KS });
  assert.equal((await acceptReceipt(rest, ctx(), { requestedSats: 333 }, fakeCurve, store)).ok, true);

  // the first receipt shown again later: already received
  expectCode(await acceptReceipt(clone(part), ctx(), { requestedSats: 1000 }, fakeCurve, store), 'already_received');
  assert.equal(store.payments.length, 2);
});

test('review #5: the amount is what lands after the mint fee', () => {
  const feeKs = makeKeyset('fee-100', { fee: 100 });
  const c = ctx({ mints: [makeTrustedMint(MINT_URL, [feeKs])] });
  // 1333 = 6 proofs, fee ceil(600/1000) = 1, so 1332 lands
  const exact = checkReceipt(makeToken(1333, { ks: feeKs }), c, { requestedSats: 1333 }, fakeCurve);
  expectCode(exact, 'underpaid');
  // 1334 = 6 proofs, fee 1, 1333 lands
  const covered = checkReceipt(makeToken(1334, { ks: feeKs }), c, { requestedSats: 1333 }, fakeCurve);
  assert.ok(covered.ok && covered.feeSats === 1 && covered.overpaidSats === 0);

  // dust: 1-sat proofs that cost a whole sat each to collect are refused
  const dearKs = makeKeyset('fee-1000', { fee: 1000 });
  const dear = ctx({ mints: [makeTrustedMint(MINT_URL, [dearKs])] });
  expectCode(checkReceipt(makeToken(1, { ks: dearKs }), dear, {}, fakeCurve), 'malformed');
});

test('review #6: proofs from an expired keyset are refused', () => {
  const ks = { ...makeKeyset('expiring'), final_expiry: 2_000_000_000 };
  const c = ctx({ mints: [makeTrustedMint(MINT_URL, [ks])] });
  const token = makeToken(4, { ks });
  assert.equal(checkReceipt(token, c, { nowSeconds: 1_999_999_999 }, fakeCurve).ok, true);
  expectCode(checkReceipt(token, c, { nowSeconds: 2_000_000_000 }, fakeCurve), 'unknown_keys');
});

test('review #8: a forged proof with a refund tag says "not signed", not "could take it back"', () => {
  const secret = JSON.stringify(['P2PK', { nonce: hex32(), data: TRADER, tags: [['refund', OTHER_TRADER]] }]);
  const token = makeToken(4, { ks: KS, secret: () => secret });
  expectCode(checkReceipt(token, ctx(), {}, fakeCurve), 'can_be_taken_back'); // genuine: the lock reason
  token.proofs[0]!.C = '02' + hex32();
  expectCode(checkReceipt(token, ctx(), {}, fakeCurve), 'bad_signature'); // forged: only "not signed"
});

test('replay: two scans racing on one phone record it once', async () => {
  const store = new MemorySeenStore();
  const token = makeToken(64, { ks: KS });
  const results = await Promise.all([
    acceptReceipt(token, ctx(), {}, fakeCurve, store),
    acceptReceipt(clone(token), ctx(), {}, fakeCurve, store),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(store.payments.length, 1);
});

/**
 * The whole money path against an in-memory mint with real curve math:
 * customer pays, trader checks offline, trader collects, trader cashes out.
 * Plus the bad-network cases: a lost answer is recovered, never paid twice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMint } from './test/memory-mint.ts';
import { MintApi, MintError } from './mint-api.ts';
import { finishPayment, paymentState, pickKeyset, startPayment } from './pay.ts';
import { cashOut, collect } from './collect.ts';
import { amountWithFee, bitLength, inputFee, splitAmount, sumAmounts } from './ecash.ts';
import { newSeed, parseRecoveryCode, recoveryCode, traderKey } from './keys.ts';
import { decodeReceipt, encodeReceipt } from './receipt.ts';
import { acceptReceipt, checkLock, checkReceipt, MemorySeenStore } from '../verify/index.ts';
import { nobleCurve } from '../verify/curve-noble.ts';

const PRICE = 1333;

function setup(opts: { feePpk?: number; autoPay?: boolean } = {}) {
  const mint = new MemoryMint({ feePpk: opts.feePpk ?? 100 });
  if (opts.autoPay === false) mint.autoPay = false;
  const api = new MintApi(mint.url, mint.fetch);
  const trader = traderKey(newSeed());
  const ks = mint.keyset();
  const ctx = { traderPubkey: trader.pub, mints: [mint.trusted()] };
  return { mint, api, trader, ks, ctx };
}

async function paid(s: ReturnType<typeof setup>, price = PRICE) {
  const p = await startPayment(s.api, s.ks, s.trader.pub, price);
  return { pending: p, token: await finishPayment(s.api, p, s.ks) };
}

test('fee math: the customer pays just enough for the price to land', () => {
  assert.equal(amountWithFee(1333, 100), 1334); // 6 proofs, 600 ppk -> 1 sat
  assert.equal(amountWithFee(1333, 0), 1333);
  assert.equal(amountWithFee(1, 1000), 2);
  assert.deepEqual(splitAmount(1334), [2, 4, 16, 32, 256, 1024]);
  assert.equal(bitLength(332), 9);
  assert.equal(bitLength(0), 0);
});

test('keyset choice: the trader\'s cached keyset if the mint still has it', () => {
  const a = { id: '00aaaaaaaaaaaaaa', unit: 'sat', keys: {}, input_fee_ppk: 100 };
  const b = { id: '00bbbbbbbbbbbbbb', unit: 'sat', keys: {}, input_fee_ppk: 0 };
  assert.equal(pickKeyset([a, b], '00aaaaaa').id, a.id);
  assert.equal(pickKeyset([a, b]).id, b.id); // cheapest otherwise
  assert.equal(pickKeyset([a, b], '00cccccc').id, b.id);
  assert.throws(() => pickKeyset([{ ...a, unit: 'usd' }]));
});

test('customer pays: the receipt is green on the trader\'s phone, offline', async () => {
  const s = setup();
  const { pending, token } = await paid(s);
  assert.equal(pending.amountSats, 1334);
  assert.equal(sumAmounts(token.proofs), 1334);
  for (const p of token.proofs) assert.deepEqual(checkLock(p.secret, s.trader.pub), { ok: true });

  // through the QR text and back, as the trader's camera reads it
  const text = encodeReceipt(token);
  assert.ok(text.startsWith('cashuB'));
  const decoded = decodeReceipt(text, [s.ks.id]);
  assert.equal(decoded.ok, true);
  const v = checkReceipt(decoded.ok ? decoded.token : null, s.ctx, { requestedSats: PRICE }, nobleCurve);
  assert.equal(v.ok, true, v.ok ? '' : `${v.code}: ${v.detail}`);
  if (v.ok) {
    assert.equal(v.feeSats, 1);
    assert.equal(v.overpaidSats, 0);
  }
});

test('the receipt is locked to the trader, not to whoever holds it', async () => {
  const s = setup();
  const { token } = await paid(s);
  const v = checkReceipt(token, { ...s.ctx, traderPubkey: traderKey(newSeed()).pub }, {}, nobleCurve);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.code, 'not_locked_to_you');
});

test('an unpaid invoice gives no receipt, and the mint is not asked to restore', async () => {
  const s = setup({ autoPay: false });
  const p = await startPayment(s.api, s.ks, s.trader.pub, PRICE);
  assert.equal(await paymentState(s.api, p), 'UNPAID');
  await assert.rejects(finishPayment(s.api, p, s.ks), (e: unknown) => e instanceof MintError && e.code === 20001);
  assert.ok(!s.mint.calls.includes('POST /v1/restore'));
  s.mint.pay(p.quote);
  assert.equal(await paymentState(s.api, p), 'PAID');
  const token = await finishPayment(s.api, p, s.ks);
  assert.equal(sumAmounts(token.proofs), p.amountSats);
  assert.equal(await paymentState(s.api, p), 'ISSUED');
});

test('an expired unpaid invoice reads as expired', async () => {
  const s = setup({ autoPay: false });
  const p = await startPayment(s.api, s.ks, s.trader.pub, PRICE);
  assert.equal(await paymentState(s.api, { ...p, expiry: 100 }, () => 200), 'EXPIRED');
});

test('bad network: the mint signed but the answer was lost; the same receipt is recovered', async () => {
  const s = setup();
  const p = await startPayment(s.api, s.ks, s.trader.pub, PRICE);
  s.mint.loseNextAnswer = true;
  const token = await finishPayment(s.api, p, s.ks);
  assert.ok(s.mint.calls.includes('POST /v1/restore'));
  assert.equal(checkReceipt(token, s.ctx, { requestedSats: PRICE }, nobleCurve).ok, true);
});

test('finishing the same payment twice gives the same receipt, not double money', async () => {
  const s = setup();
  const p = await startPayment(s.api, s.ks, s.trader.pub, PRICE);
  const a = await finishPayment(s.api, p, s.ks);
  const b = await finishPayment(s.api, p, s.ks);
  assert.deepEqual(b.proofs.map((x) => x.C), a.proofs.map((x) => x.C));
  const store = new MemorySeenStore();
  assert.equal((await acceptReceipt(a, s.ctx, { requestedSats: PRICE }, nobleCurve, store)).ok, true);
  const again = await acceptReceipt(b, s.ctx, { requestedSats: PRICE }, nobleCurve, store);
  assert.equal(again.ok === false && again.code, 'already_received');
});

test('a mint whose signature proof is wrong never produces a receipt', async () => {
  const s = setup();
  const lying: typeof fetch = async (input, init) => {
    const res = await s.mint.fetch(input, init);
    if (!String(input).endsWith('/v1/mint/bolt11')) return res;
    const j: any = await res.json();
    j.signatures[0].dleq.e = j.signatures[0].dleq.s;
    return new Response(JSON.stringify(j), { status: 200 });
  };
  const api = new MintApi(s.mint.url, lying);
  const p = await startPayment(api, s.ks, s.trader.pub, PRICE);
  await assert.rejects(finishPayment(api, p, s.ks), /DLEQ/);
});

test('the customer cannot take the payment back; only the trader can collect it', async () => {
  const s = setup();
  const { token } = await paid(s);
  const customer = traderKey(newSeed());
  await assert.rejects(collect(s.api, token.proofs, customer, [s.ks], s.ks), /P2PK spend conditions/);

  const got = await collect(s.api, token.proofs, s.trader, [s.ks], s.ks);
  assert.equal(got.feeSats, inputFee(token.proofs, [s.ks]));
  assert.equal(sumAmounts(got.proofs), 1334 - got.feeSats);
  assert.ok(sumAmounts(got.proofs) >= PRICE);
  // collected money stays locked to the trader
  for (const p of got.proofs) assert.deepEqual(checkLock(p.secret, s.trader.pub), { ok: true });
  // and the receipt is now spent at the mint
  const states = await s.api.checkState(token.proofs.map((p) => nobleCurve.hashToCurve(p.secret)));
  assert.ok(states.every((x) => x === 'SPENT'));
  await assert.rejects(collect(s.api, token.proofs, s.trader, [s.ks], s.ks), /already spent/);
});

test('bad network while collecting: the answer is recovered, nothing lost', async () => {
  const s = setup();
  const { token } = await paid(s);
  s.mint.loseNextAnswer = true;
  const got = await collect(s.api, token.proofs, s.trader, [s.ks], s.ks);
  assert.ok(s.mint.calls.includes('POST /v1/restore'));
  assert.equal(sumAmounts(got.proofs), 1334 - got.feeSats);
});

test('cash out pays the invoice and returns the change, locked to the trader', async () => {
  const s = setup();
  const { token } = await paid(s);
  const { proofs } = await collect(s.api, token.proofs, s.trader, [s.ks], s.ks);
  const before = sumAmounts(proofs);
  const out = await cashOut(s.api, proofs, s.trader, [s.ks], s.ks, 'lnfake1000');
  assert.equal(out.state, 'PAID');
  assert.equal(out.paidSats, 1000);
  assert.equal(out.paidSats + out.feeSats + sumAmounts(out.change), before);
  assert.equal(out.feeSats, inputFee(proofs, [s.ks]));
  for (const p of out.change) assert.deepEqual(checkLock(p.secret, s.trader.pub), { ok: true });
});

test('cash out refuses an invoice bigger than the balance, before spending anything', async () => {
  const s = setup();
  const { token } = await paid(s);
  await assert.rejects(cashOut(s.api, token.proofs, s.trader, [s.ks], s.ks, 'lnfake1333'), /Not enough/);
  assert.ok(!s.mint.calls.includes('POST /v1/melt/bolt11'));
});

test('recovery code: written down, typed back, same key', () => {
  const seed = newSeed();
  const code = recoveryCode(seed);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/);
  assert.deepEqual(parseRecoveryCode(code), seed);
  assert.deepEqual(parseRecoveryCode(code.toLowerCase().replace(/-/g, ' ')), seed);
  assert.equal(traderKey(parseRecoveryCode(code)!).pub, traderKey(seed).pub);
  assert.notEqual(traderKey(newSeed()).pub, traderKey(seed).pub);
  for (const bad of ['', code.slice(0, -1), code + 'A', code.replace(/^./, 'U')]) assert.equal(parseRecoveryCode(bad), null);
});

test('recovery code: a mistyped character is caught', () => {
  const seed = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff);
  const code = recoveryCode(seed);
  let caught = 0;
  let tried = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '-') continue;
    for (const ch of ['0', '7', 'M', 'Z']) {
      if (ch === code[i]) continue;
      tried++;
      if (parseRecoveryCode(code.slice(0, i) + ch + code.slice(i + 1)) === null) caught++;
    }
  }
  // a 10-bit check misses about 1 in 1,000 typos; across ~80 typos expect all or nearly all caught
  assert.ok(caught >= tried - 1, `${caught} of ${tried} caught`);
});

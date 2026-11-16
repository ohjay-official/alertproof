/**
 * Money invariants, checked over many random cases against the in-memory mint
 * (real curve math, real lock enforcement, input fees):
 *
 *   1. the customer pays the least amount that still lands the full price
 *   2. a paid receipt is green for its price, and refused when the price is one sat more
 *      (or kept as a part payment, never green)
 *   3. collect: what comes out = what went in - the mint's fee, all locked to the trader
 *   4. cash out: paid + fees + change = what went in; change locked to the trader
 *   5. no proof is ever accepted or spent twice
 *
 * Seeded, so a failure reproduces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMint } from './test/memory-mint.ts';
import { MintApi } from './mint-api.ts';
import { finishPayment, startPayment } from './pay.ts';
import { collect, cashOut } from './collect.ts';
import { amountWithFee, inputFee, splitAmount, sumAmounts } from './ecash.ts';
import { newSeed, traderKey } from './keys.ts';
import { decodeReceipt, encodeReceipt } from './receipt.ts';
import { acceptReceipt, checkLock, checkReceipt, MemorySeenStore } from '../verify/index.ts';
import { nobleCurve } from '../verify/curve-noble.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

test('fee math: the least amount that lands the price, for every price and fee', () => {
  const r = rng(11);
  for (let i = 0; i < 4000; i++) {
    const price = 1 + r(200_000);
    const ppk = [0, 1, 100, 150, 999, 1000, 2500][r(7)]!;
    const x = amountWithFee(price, ppk);
    const fee = (n: number) => Math.ceil((splitAmount(n).length * ppk) / 1000);
    assert.ok(x - fee(x) >= price, `lands ${x - fee(x)} < ${price} at ${ppk} ppk`);
    for (let y = price; y < x; y++) assert.ok(y - fee(y) < price, `${y} would already land ${price} at ${ppk} ppk`);
    assert.ok(x <= price * 2 + 64, 'fee stays bounded');
  }
});

test('end to end, 40 random sales: green for the price, refused above it, money conserved through collect and cash out', async () => {
  const r = rng(2026);
  for (let i = 0; i < 40; i++) {
    const feePpk = [0, 100, 150, 1000][r(4)]!;
    const mint = new MemoryMint({ feePpk, feeReserve: r(5) });
    const api = new MintApi(mint.url, mint.fetch);
    const ks = mint.keyset();
    const trader = traderKey(newSeed());
    const ctx = { traderPubkey: trader.pub, mints: [mint.trusted()] };
    const price = 1 + r(50_000);

    const p = await startPayment(api, ks, trader.pub, price);
    assert.equal(p.amountSats, amountWithFee(price, feePpk));
    const token = await finishPayment(api, p, ks);
    const decoded = decodeReceipt(encodeReceipt(token), [ks.id]);
    assert.ok(decoded.ok);
    const t = decoded.ok ? decoded.token : null;

    const exact = checkReceipt(t, ctx, { requestedSats: price }, nobleCurve);
    assert.ok(exact.ok, `case ${i}: ${exact.ok ? '' : exact.code}`);
    const above = checkReceipt(t, ctx, { requestedSats: price + 1 + (exact.ok ? exact.overpaidSats : 0) }, nobleCurve);
    assert.ok(!above.ok && above.code === 'underpaid', `case ${i}: a higher price must not be green`);

    const store = new MemorySeenStore();
    assert.ok((await acceptReceipt(t, ctx, { requestedSats: price }, nobleCurve, store)).ok);
    const again = await acceptReceipt(t, ctx, { requestedSats: price }, nobleCurve, store);
    assert.ok(!again.ok && again.code === 'already_received');

    const fee = inputFee(token.proofs, [ks]);
    const got = await collect(api, token.proofs, trader, [ks], ks);
    assert.equal(sumAmounts(got.proofs), sumAmounts(token.proofs) - fee, `case ${i}: collect conserves money`);
    assert.ok(sumAmounts(got.proofs) >= price, `case ${i}: the trader keeps at least the price`);
    for (const pr of got.proofs) assert.deepEqual(checkLock(pr.secret, trader.pub), { ok: true });

    const held = sumAmounts(got.proofs);
    const outFee = inputFee(got.proofs, [ks]);
    const maxPay = held - outFee - mint.feeReserve;
    if (maxPay >= 1) {
      const amount = 1 + r(maxPay);
      const out = await cashOut(api, got.proofs, trader, [ks], ks, `lnfake${amount}`);
      assert.equal(out.state, 'PAID');
      assert.equal(out.paidSats + out.feeSats + sumAmounts(out.change), held, `case ${i}: cash out conserves money`);
      assert.equal(out.feeSats, outFee, `case ${i}: only the input fee is kept (this mint's Lightning is free)`);
      for (const pr of out.change) assert.deepEqual(checkLock(pr.secret, trader.pub), { ok: true });
    }
    // Nothing spent twice: every proof the trader received is now spent, exactly once.
    const states = await api.checkState(token.proofs.map((x) => nobleCurve.hashToCurve(x.secret)));
    assert.ok(states.every((x) => x === 'SPENT'));
  }
});

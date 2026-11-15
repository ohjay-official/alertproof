import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATES_URL, XOF_PER_EUR, fetchRates, fiatToSats, formatFiat, rateAge, satsToFiat, type Rates } from './rates.ts';

const rates: Rates = { btc: { NGN: 150_000_000, XOF: 60_000_000 }, at: 1_000_000, source: 'test' };

test('naira to sats rounds up, so the trader is never short', () => {
  assert.equal(fiatToSats(2000, 'NGN', rates), 1334); // 1333.33 -> 1334
  assert.equal(fiatToSats(1500, 'NGN', rates), 1000);
  assert.equal(fiatToSats(0.01, 'NGN', rates), 1);
  assert.equal(fiatToSats(2000, 'XOF', rates), 3334);
  assert.throws(() => fiatToSats(0, 'NGN', rates));
  assert.throws(() => fiatToSats(Number.NaN, 'NGN', rates));
});

test('sats back to naira for display', () => {
  assert.equal(Math.round(satsToFiat(1334, 'NGN', rates)), 2001);
});

test('rate age reads plainly', () => {
  assert.equal(rateAge(rates, rates.at + 10_000), 'just now');
  assert.equal(rateAge(rates, rates.at + 5 * 60_000), '5 min ago');
  assert.equal(rateAge(rates, rates.at + 3 * 3_600_000), '3 h ago');
  assert.equal(rateAge(rates, rates.at + 3 * 86_400_000), '3 days ago');
});

test('money is formatted the way a stall prices it', () => {
  assert.equal(formatFiat(2000, 'NGN'), '₦2,000');
  assert.equal(formatFiat(2000.4, 'XOF'), '2,000 CFA');
});

test('fetches naira and works CFA out from the euro peg', async () => {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ bitcoin: { ngn: 150_000_000, eur: 90_000 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await fetchRates(f, () => 42);
  assert.deepEqual(calls, [RATES_URL]);
  assert.equal(r.btc.NGN, 150_000_000);
  assert.equal(r.btc.XOF, 90_000 * XOF_PER_EUR);
  assert.equal(r.at, 42);
});

test('a bad price answer is an error, never a zero rate', async () => {
  for (const body of [{}, { bitcoin: { ngn: 0, eur: 1 } }, { bitcoin: { ngn: '5', eur: 1 } }, { bitcoin: { ngn: 1 } }]) {
    const f = (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(fetchRates(f));
  }
  const down = (async () => new Response('busy', { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(fetchRates(down), /429/);
});

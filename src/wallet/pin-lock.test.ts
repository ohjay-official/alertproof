import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPin, lockSeed, unlockSeed } from './pin-lock.ts';

const seed = Uint8Array.from({ length: 16 }, (_, i) => i * 7);
const FAST = 1_000; // the real count (600,000) is used by the app; tests stay quick

test('the right PIN unlocks the seed', async () => {
  const locked = await lockSeed(seed, '482915', FAST);
  assert.deepEqual(await unlockSeed(locked, '482915'), seed);
});

test('a wrong PIN or an edited blob unlocks nothing', async () => {
  const locked = await lockSeed(seed, '482915', FAST);
  assert.equal(await unlockSeed(locked, '482916'), null);
  assert.equal(await unlockSeed({ ...locked, data: locked.data.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }, '482915'), null);
  assert.equal(await unlockSeed({ ...locked, iterations: 0 }, '482915'), null);
  assert.equal(await unlockSeed(null as any, '482915'), null);
});

test('the seed is not stored in the clear', async () => {
  const locked = await lockSeed(seed, '1234', FAST);
  assert.ok(!JSON.stringify(locked).includes(Buffer.from(seed).toString('base64')));
  const again = await lockSeed(seed, '1234', FAST);
  assert.notEqual(again.data, locked.data); // fresh salt and IV each time
});

test('PINs are 4 to 8 digits', async () => {
  for (const pin of ['1234', '12345678']) assert.equal(isValidPin(pin), true);
  for (const pin of ['123', '123456789', 'abcd', '12 34', '', 1234]) assert.equal(isValidPin(pin), false);
  await assert.rejects(lockSeed(seed, '12'));
});

test('the real round count takes a moment, not an age', async () => {
  const t0 = performance.now();
  const locked = await lockSeed(seed, '482915');
  assert.equal(locked.iterations, 600_000);
  assert.ok(performance.now() - t0 < 5_000);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameCollector, toFrames } from './frames.ts';

const receipt = 'cashuB' + 'o2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlI'.repeat(40);

test('a short receipt is one plain QR any Cashu wallet can read', () => {
  assert.deepEqual(toFrames('cashuBshort'), ['cashuBshort']);
  const c = new FrameCollector();
  assert.deepEqual(c.add('cashuBshort'), { done: true, text: 'cashuBshort' });
});

test('a long receipt splits into frames and joins back in any order, with repeats', () => {
  const frames = toFrames(receipt, 280);
  assert.equal(frames.length, Math.ceil(receipt.length / 280));
  assert.ok(frames.every((f) => f.length <= 280 + 20));
  const order = [3, 0, 3, 5, 1, 1, 7, 2, 4, 6, 8].filter((i) => i < frames.length);
  for (let i = 0; i < frames.length; i++) if (!order.includes(i)) order.push(i);
  const c = new FrameCollector();
  let last;
  for (const i of order) last = c.add(frames[i]!);
  assert.deepEqual(last, { done: true, text: receipt });
});

test('progress is reported while frames come in', () => {
  const frames = toFrames(receipt, 500);
  const c = new FrameCollector();
  const r = c.add(frames[0]!);
  assert.deepEqual(r, { done: false, have: 1, total: frames.length });
});

test('frames from another receipt start the collection over', () => {
  const a = toFrames(receipt, 300);
  const b = toFrames(receipt.replace('cashuB', 'cashuBx'), 300);
  const c = new FrameCollector();
  c.add(a[0]!);
  c.add(a[1]!);
  const r = c.add(b[0]!);
  assert.deepEqual(r, { done: false, have: 1, total: b.length });
  let last;
  for (const f of b.slice(1)) last = c.add(f);
  assert.deepEqual(last, { done: true, text: receipt.replace('cashuB', 'cashuBx') });
});

test('an edited frame is caught by the check and the receipt is not returned', () => {
  const frames = toFrames(receipt, 300);
  const edited = frames.map((f, i) => (i === 2 ? f.slice(0, -1) + (f.endsWith('A') ? 'B' : 'A') : f));
  const c = new FrameCollector();
  let last;
  for (const f of edited) last = c.add(f);
  assert.equal(last!.done, false);
});

test('nonsense frame numbers are ignored', () => {
  const c = new FrameCollector();
  assert.equal(c.add('AP1:5/3:0123abcd:xx').done, false);
  assert.equal(c.add('AP1:0/3:0123abcd:xx').done, true); // not a frame: handed to the check, which refuses it
});

/** Randomized checks of the pure pieces: conversion, frames, pay links. Runs with plain Node. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiatToSats, satsToFiat, type Rates } from './rates.ts';
import { FrameCollector, toFrames } from './frames.ts';
import { parsePayLink, payLinkUrl } from './request.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

test('naira to sats always covers the price, and never by more than a sat', () => {
  const r = rng(5);
  for (let i = 0; i < 20000; i++) {
    const rates: Rates = { btc: { NGN: 1_000_000 + r(400_000_000), XOF: 1_000_000 + r(100_000_000) }, at: 0, source: 't' };
    const cur = r(2) ? 'NGN' : 'XOF';
    const price = 1 + r(5_000_000) + (r(2) ? r(100) / 100 : 0);
    const s = fiatToSats(price, cur, rates);
    assert.ok(satsToFiat(s, cur, rates) >= price - 1e-6, `${s} sats is less than ${price} ${cur}`);
    if (s > 1) assert.ok(satsToFiat(s - 1, cur, rates) < price + 1e-6, `${s - 1} sats would already cover ${price} ${cur}`);
  }
});

test('animated receipts survive any order, repeats and other receipts mixed in', () => {
  const r = rng(9);
  for (let i = 0; i < 300; i++) {
    const len = 50 + r(6000);
    let text = 'cashuB';
    while (text.length < len) text += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[r(64)];
    const frames = toFrames(text, 120 + r(300));
    const noise = toFrames(text.slice(0, -1) + 'Z', 150);
    const c = new FrameCollector();
    let result: string | null = null;
    const order = frames.map((_, k) => k);
    for (let k = order.length - 1; k > 0; k--) {
      const j = r(k + 1);
      [order[k], order[j]] = [order[j]!, order[k]!];
    }
    for (const k of order) {
      if (r(4) === 0) {
        const rep = c.add(frames[r(frames.length)]!); // a repeat, which may itself complete it
        if (rep.done && result === null) result = rep.text;
      }
      const got = c.add(frames[k]!);
      if (got.done && result === null) result = got.text;
    }
    assert.equal(result, text);
    // a frame from a different receipt never completes this one
    const c2 = new FrameCollector();
    if (frames.length > 1 && noise.length > 1) {
      c2.add(frames[0]!);
      const mixed = c2.add(noise[1]!);
      assert.ok(!mixed.done || mixed.text !== text);
    }
  }
});

test('pay links: anything valid round-trips, anything else is refused without throwing', () => {
  const r = rng(13);
  const hex = () => Array.from({ length: 64 }, () => '0123456789abcdef'[r(16)]).join('');
  for (let i = 0; i < 3000; i++) {
    const link = {
      traderPubkey: (r(2) ? '02' : '03') + hex(),
      mint: 'https://testnut.cashu.space',
      shop: 'Shop ' + r(1000),
      sats: 1 + r(10_000_000),
    };
    const url = payLinkUrl('https://x.example', link);
    const back = parsePayLink(url);
    assert.ok(back.ok && back.link.sats === link.sats && back.link.traderPubkey === link.traderPubkey);
    // one random character changed: either still valid (and different) or refused, never a throw
    const at = r(url.length);
    const edited = url.slice(0, at) + String.fromCharCode(32 + r(95)) + url.slice(at + 1);
    assert.doesNotThrow(() => parsePayLink(edited));
  }
});

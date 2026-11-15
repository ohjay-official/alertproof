import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanShopName, parsePayLink, payLinkUrl, type PayLink } from './request.ts';

const KEY = '02' + 'ab'.repeat(32);
const base: PayLink = {
  traderPubkey: KEY,
  mint: 'https://testnut.cashu.space',
  shop: "Mama Nkechi's Fabrics",
  sats: 1334,
  fiat: { amount: 2000, currency: 'NGN' },
  keysetHint: '017bc604aaa08e9b',
};

test('a pay link round-trips through its URL', () => {
  const url = payLinkUrl('https://sealpay.vercel.app/', base);
  assert.ok(url.startsWith('https://sealpay.vercel.app/pay#k='));
  const r = parsePayLink(url);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.link, base);
});

test('the sticker link has no amount and still parses', () => {
  const { sats, fiat, ...sticker } = base;
  const r = parsePayLink(payLinkUrl('https://x.example', sticker));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.link.sats, undefined);
    assert.equal(r.link.fiat, undefined);
  }
});

test('the link is short enough for an easy QR', () => {
  const url = payLinkUrl('https://sealpay.vercel.app', base);
  assert.ok(url.length < 260, `${url.length} characters`);
});

const bad = (hash: string) => {
  const r = parsePayLink('https://x.example/pay#' + hash);
  assert.equal(r.ok, false, hash);
};

test('refuses a bad key, mint, shop, amount or price', () => {
  const ok = new URL(payLinkUrl('https://x.example', base)).hash.slice(1);
  const with_ = (k: string, v: string | null) => {
    const p = new URLSearchParams(ok);
    if (v === null) p.delete(k);
    else p.set(k, v);
    return p.toString();
  };
  bad(with_('k', null));
  bad(with_('k', '04' + 'ab'.repeat(32)));
  bad(with_('k', KEY.toUpperCase()));
  bad(with_('m', 'http://testnut.cashu.space'));
  bad(with_('m', 'https://user:pw@mint.example'));
  bad(with_('m', null));
  bad(with_('s', '   '));
  bad(with_('a', '0'));
  bad(with_('a', '-5'));
  bad(with_('a', '1.5'));
  bad(with_('a', '99999999'));
  bad(with_('a', '0x10'));
  bad(with_('f', '2000'.replace('2000', 'abc')));
  bad(with_('c', 'USD'));
  bad(with_('c', null));
  bad(with_('h', 'XYZ'));
  bad(ok + '&k=' + KEY);
});

test('shop names are cleaned to plain text', () => {
  assert.equal(cleanShopName('  Tola​  Phones\n\t& more  '), 'Tola Phones & more');
  assert.equal(cleanShopName('a'.repeat(80)).length, 40);
  const r = parsePayLink(payLinkUrl('https://x.example', { ...base, shop: '<script>alert(1)</script>' }));
  // Kept as text: the page puts it in textContent, never HTML.
  assert.equal(r.ok && r.link.shop, '<script>alert(1)</script>'.slice(0, 40));
});

test('a link that is not ours is refused without throwing', () => {
  for (const s of ['', 'hello', '#', 'cashuBabc', 'x'.repeat(5000), '#k=%E0%A4%A']) {
    assert.equal(parsePayLink(s).ok, false);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTrustedMint } from './mint-cache.ts';
import { fakeKey } from '../verify/test/fake-mint.ts';

const URL_ = 'https://mint.example.com';
const V2 = '01' + 'ab'.repeat(32);
const V1 = '00aabbccddeeff00';

function fakeFetch(routes: Record<string, unknown>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (!(url in routes)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[url]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const goodRoutes = () => ({
  [`${URL_}/v1/info`]: { nuts: { '11': { supported: true }, '12': { supported: true } } },
  [`${URL_}/v1/keysets`]: {
    keysets: [
      { id: V2, unit: 'sat', active: true, input_fee_ppk: 100 },
      { id: V1, unit: 'sat', active: false },
      { id: '01' + 'cd'.repeat(32), unit: 'usd', active: true },
    ],
  },
  [`${URL_}/v1/keys/${V2}`]: {
    keysets: [{ id: V2, unit: 'sat', keys: { '1': fakeKey('1'), '2': fakeKey('2'), bad: fakeKey('x'), '4': 'nothex' } }],
  },
});

test('caches info and the active sat keyset, skipping junk keys', async () => {
  const calls: string[] = [];
  const mint = await fetchTrustedMint(URL_ + '/', fakeFetch(goodRoutes(), calls));
  assert.equal(mint.url, URL_);
  assert.equal(mint.keysets.length, 1);
  assert.equal(mint.keysets[0]!.id, V2);
  assert.equal(mint.keysets[0]!.input_fee_ppk, 100);
  assert.deepEqual(Object.keys(mint.keysets[0]!.keys).sort(), ['1', '2']);
  assert.ok(!calls.some((c) => c.includes(V1)), 'inactive keysets are not fetched');
});

test('refuses http, a mint with no active sat keyset, and bad fees', async () => {
  await assert.rejects(fetchTrustedMint('http://mint.example.com', fakeFetch(goodRoutes())), /https/);

  const none = goodRoutes();
  none[`${URL_}/v1/keysets`] = { keysets: [{ id: V2, unit: 'sat', active: false }] };
  await assert.rejects(fetchTrustedMint(URL_, fakeFetch(none)), /no active sat keyset/);

  const badFee = goodRoutes();
  badFee[`${URL_}/v1/keysets`] = { keysets: [{ id: V2, unit: 'sat', active: true, input_fee_ppk: -5 }] };
  await assert.rejects(fetchTrustedMint(URL_, fakeFetch(badFee)), /invalid input fee/);

  await assert.rejects(fetchTrustedMint(URL_, fakeFetch({})), /HTTP 404/);
});

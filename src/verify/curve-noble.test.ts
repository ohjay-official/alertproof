/**
 * The real curve math against the official Cashu test vectors
 * (cashubtc/nuts tests/00-tests and tests/12-tests). Needs @noble/curves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, Point, hashE, hashToCurveBytes, hexToBytes, nobleCurve, verifyBlindDleq, scalarFromHex, N } from './curve-noble.ts';

test('NUT-00 hash_to_curve vectors', () => {
  const vectors: Array<[string, string]> = [
    ['0000000000000000000000000000000000000000000000000000000000000000', '024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725'],
    ['0000000000000000000000000000000000000000000000000000000000000001', '022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf'],
    ['0000000000000000000000000000000000000000000000000000000000000002', '026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f'],
  ];
  for (const [x, Y] of vectors) assert.equal(hashToCurveBytes(hexToBytes(x)).toHex(true), Y);
});

test('NUT-12 hash_e vector', () => {
  const one = Point.fromHex('020000000000000000000000000000000000000000000000000000000000000001');
  const C_ = Point.fromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
  assert.equal(hashE([one, one, one, C_]), 'a4dc034b74338c28c6bc3ea49731f2a24440fc7c4affc08b31a93fc9fbe6401e');
});

test('NUT-12 DLEQ on a BlindSignature vector', () => {
  const A = Point.fromHex('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  const B_ = Point.fromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
  const C_ = Point.fromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
  const e = '9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73d9';
  const s = '9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73da';
  assert.equal(verifyBlindDleq(B_, C_, e, s, A), true);
  assert.equal(verifyBlindDleq(B_, C_, s, e, A), false);
});

test('NUT-12 deterministic nonce vector verifies', () => {
  const A = Point.fromHex('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
  assert.ok(A.equals(G.multiply(2n)));
  const B_ = Point.fromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
  const C_ = Point.fromHex('0244eccfc7a348274458bb38044c7f3c389b3c2086c7ec18b5812d2877ab937787');
  const e = '2a16ffee280aff3c429045607f9b8e0bf8b35910c44c1b20b9dfaf01b263d7b3';
  const s = '9df27731238334718d120d4f74611a7c668233f988e687ac3fb188f0a34a2dab';
  assert.equal(verifyBlindDleq(B_, C_, e, s, A), true);
});

const PROOF = {
  A: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  secret: 'daf4dd00a2b68a0858a80450f52c8a7d2ccf87d375e43e216e0c571f089f63e9',
  C: '024369d2d22a80ecf78f3937da9d5f30c1b9f74f0c32684d583cca0fa6a61cdcfc',
  e: 'b31e58ac6527f34975ffab13e70a48b6d2b0d35abc4b03f0151f09ee1a9763d4',
  s: '8fbae004c59e754d71df67e392b6ae4e29293113ddc2ec86592a0431d16306d8',
  r: 'a6d13fcd7a18442e6076f5e1e7c887ad5de40a019824bdfa9fe740d302e8d861',
};

test('NUT-12 DLEQ on a Proof vector (what the trader checks offline)', () => {
  const Y = nobleCurve.hashToCurve(PROOF.secret);
  assert.equal(nobleCurve.verifyProofDleq({ Y, C: PROOF.C, e: PROOF.e, s: PROOF.s, r: PROOF.r, A: PROOF.A }), true);
});

test('the Proof vector fails with any one value changed', () => {
  const Y = nobleCurve.hashToCurve(PROOF.secret);
  const base = { Y, C: PROOF.C, e: PROOF.e, s: PROOF.s, r: PROOF.r, A: PROOF.A };
  const flip = (hex: string) => hex.slice(0, -1) + (hex.endsWith('0') ? '1' : '0');
  const otherKey = G.multiply(2n).toHex(true);
  const cases = [
    { ...base, Y: nobleCurve.hashToCurve(PROOF.secret + 'x') },
    { ...base, C: G.multiply(3n).toHex(true) },
    { ...base, e: flip(PROOF.e) },
    { ...base, s: flip(PROOF.s) },
    { ...base, r: flip(PROOF.r) },
    { ...base, A: otherKey },
  ];
  for (const c of cases) assert.equal(nobleCurve.verifyProofDleq(c), false);
});

test('invalid points and scalars are false, never a throw', () => {
  const Y = nobleCurve.hashToCurve(PROOF.secret);
  const base = { Y, C: PROOF.C, e: PROOF.e, s: PROOF.s, r: PROOF.r, A: PROOF.A };
  const notOnCurve = '02' + '0'.repeat(63) + '5'; // x = 5: x^3 + 7 = 132 is not a square mod p
  const cases = [
    { ...base, C: notOnCurve },
    { ...base, A: notOnCurve },
    { ...base, Y: notOnCurve },
    { ...base, C: 'zz' },
    { ...base, r: '0'.repeat(64) },
    { ...base, s: N.toString(16) },
    { ...base, e: 'f'.repeat(64) },
  ];
  for (const c of cases) assert.equal(nobleCurve.verifyProofDleq(c), false, JSON.stringify(c));
  assert.equal(scalarFromHex('0'.repeat(64)), null);
  assert.equal(scalarFromHex(N.toString(16)), null);
});

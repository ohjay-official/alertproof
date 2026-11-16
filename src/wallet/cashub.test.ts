import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCashuB, encodeCashuB } from './cashub.ts';
import { decodeReceipt } from './receipt.ts';
import { makeKeyset, makeToken, TRADER } from '../verify/test/fake-mint.ts';

const V2 = '01' + 'ab'.repeat(32);
const ks1 = makeKeyset('mint-a');
const ks2 = makeKeyset('mint-b', { id: V2 });

test('round trip keeps every field, DLEQ included', () => {
  const token = { ...makeToken(1333, { ks: ks1, lockTo: TRADER }), unit: 'sat' };
  const text = encodeCashuB(token);
  assert.ok(text.startsWith('cashuB') && !text.includes('='));
  assert.deepEqual(decodeCashuB(text, [ks1.id]), token);
});

test('v2 keyset ids travel short and come back full from the saved ids', () => {
  const token = { ...makeToken(6, { ks: ks2 }), unit: 'sat' };
  const text = encodeCashuB(token);
  const back = decodeCashuB(text, [ks1.id, V2]);
  assert.equal(back.proofs[0]!.id, V2);
  assert.throws(() => decodeCashuB(text, [ks1.id]), /saved mint keys/);
  assert.ok(text.length < encodeCashuB({ ...token, proofs: token.proofs.map((p) => ({ ...p, id: ks1.id })) }).length + 40);
});

test('large amounts and long secrets survive', () => {
  const token = { mint: 'https://m.example', unit: 'sat', proofs: [{ id: ks1.id, amount: 2 ** 40, secret: 'x'.repeat(500), C: '02' + '11'.repeat(32) }] };
  assert.deepEqual(decodeCashuB(encodeCashuB(token), []), token);
});

test('every single-character edit is refused or decodes to something different, never a throw past decodeReceipt', () => {
  const text = encodeCashuB({ ...makeToken(1333, { ks: ks1 }), unit: 'sat' });
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let rng = 7;
  for (let n = 0; n < 3000; n++) {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    const at = 6 + (rng % (text.length - 6));
    const ch = alphabet[rng % 64]!;
    const edited = text.slice(0, at) + ch + text.slice(at + 1);
    const r = decodeReceipt(edited, [ks1.id]);
    if (r.ok && edited !== text) {
      // decoded: then it must differ somewhere, and the offline check judges it
      assert.notDeepEqual(r.token, decodeCashuB(text, [ks1.id]));
    }
  }
});

test('malformed CBOR is refused with a reason', () => {
  const bad = ['cashuB', 'cashuBAA', 'cashuB' + 'oWFt'.repeat(1), 'cashuB_____', 'cashuBo2FtYXg'];
  for (const t of bad) assert.throws(() => decodeCashuB(t, []));
  // a map with a repeated key
  const dup = 'cashuB' + Buffer.from([0xa2, 0x61, 0x6d, 0x61, 0x78, 0x61, 0x6d, 0x61, 0x79]).toString('base64url');
  assert.throws(() => decodeCashuB(dup, []), /twice/);
  // trailing bytes
  const extra = encodeCashuB({ mint: 'https://m.example', unit: 'sat', proofs: [] }) + 'AA';
  assert.throws(() => decodeCashuB(extra, []));
});

/** Needs @cashu/cashu-ts (runs in CI). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEncodedToken } from '@cashu/cashu-ts';
import { decodeReceipt, MAX_RECEIPT_CHARS } from './receipt.ts';
import { checkReceipt } from '../verify/check.ts';
import { fakeCurve, makeKeyset, makeToken, makeTrustedMint, MINT_URL, TRADER } from '../verify/test/fake-mint.ts';

const KS = makeKeyset('mint-a');
const ctx = { traderPubkey: TRADER, mints: [makeTrustedMint(MINT_URL, [KS])] };

test('a cashuB receipt decodes to something the offline check accepts', () => {
  const token = makeToken(1333, { ks: KS });
  const text = getEncodedToken(token as any);
  for (const scanned of [text, `cashu:${text}`, `  ${text}\n`]) {
    const r = decodeReceipt(scanned, [KS.id]);
    assert.ok(r.ok, r.ok ? '' : r.detail);
    if (r.ok) {
      const v = checkReceipt(r.token, ctx, { requestedSats: 1333 }, fakeCurve);
      assert.ok(v.ok, v.ok ? '' : `${v.code}: ${v.detail}`);
    }
  }
});

test('anything that is not a cashuB token is refused before decoding', () => {
  for (const scanned of [42, '', 'hello', 'cashuA' + 'e'.repeat(40), 'cashuB' + 'a'.repeat(MAX_RECEIPT_CHARS), 'cashuB!!!', 'https://evil.example/cashuB']) {
    assert.equal(decodeReceipt(scanned, [KS.id]).ok, false, String(scanned).slice(0, 40));
  }
});

test('garbage after the prefix is a refusal, not a throw', () => {
  assert.equal(decodeReceipt('cashuBo2Fhb', [KS.id]).ok, false);
});

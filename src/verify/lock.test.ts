import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLock } from './lock.ts';
import { TRADER, OTHER_TRADER, hex32 } from './test/fake-mint.ts';

const nonce = '859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f';
const secret = (body: string) => `["P2PK",{${body}}]`;
const withTags = (tags: string) => secret(`"nonce":"${nonce}","data":"${TRADER}","tags":${tags}`);

function expectOk(s: string) {
  assert.deepEqual(checkLock(s, TRADER), { ok: true }, s);
}
function expectCode(s: string, code: string) {
  const r = checkLock(s, TRADER);
  assert.equal(r.ok, false, s);
  if (!r.ok) assert.equal(r.code, code, `${s}\n${r.detail}`);
}

test('accepts a plain lock to the trader: SIG_INPUTS, empty tags, or no tags', () => {
  expectOk(withTags('[["sigflag","SIG_INPUTS"]]'));
  expectOk(withTags('[]'));
  expectOk(secret(`"nonce":"${nonce}","data":"${TRADER}"`));
  expectOk(JSON.stringify(['P2PK', { nonce: hex32(), data: TRADER, tags: [['sigflag', 'SIG_INPUTS']] }]));
});

test('accepts nutshell-style spacing and any field order', () => {
  expectOk(`["P2PK", {"data": "${TRADER}", "tags": [["sigflag", "SIG_INPUTS"]], "nonce": "${nonce}"}]`);
});

test('refuses a plain secret: anyone holding it can spend it', () => {
  expectCode(hex32(), 'not_locked_to_you');
  expectCode('', 'not_locked_to_you');
});

test('refuses a lock to someone else', () => {
  expectCode(secret(`"nonce":"${nonce}","data":"${OTHER_TRADER}","tags":[]`), 'not_locked_to_you');
});

test('refuses the trader key written another way (uppercase, flipped prefix, x-only)', () => {
  expectCode(secret(`"nonce":"${nonce}","data":"${TRADER.toUpperCase()}"`), 'not_locked_to_you');
  const flipped = (TRADER.startsWith('02') ? '03' : '02') + TRADER.slice(2);
  expectCode(secret(`"nonce":"${nonce}","data":"${flipped}"`), 'not_locked_to_you');
  expectCode(secret(`"nonce":"${nonce}","data":"${TRADER.slice(2)}"`), 'not_locked_to_you');
});

test('refuses other kinds of lock', () => {
  expectCode(`["HTLC",{"nonce":"${nonce}","data":"${TRADER}"}]`, 'not_locked_to_you');
  expectCode(`["p2pk",{"nonce":"${nonce}","data":"${TRADER}"}]`, 'not_locked_to_you');
  expectCode(`["P2PK ",{"nonce":"${nonce}","data":"${TRADER}"}]`, 'not_locked_to_you');
});

test('refuses a duplicate "data" key: a mint might read the other one', () => {
  expectCode(
    secret(`"nonce":"${nonce}","data":"${OTHER_TRADER}","data":"${TRADER}"`),
    'not_locked_to_you',
  );
  expectCode(
    secret(`"nonce":"${nonce}","data":"${TRADER}","data":"${OTHER_TRADER}"`),
    'not_locked_to_you',
  );
});

test('refuses escapes that some mint parsers would read differently', () => {
  expectCode(`["\\u0050\\u0032PK",{"nonce":"${nonce}","data":"${TRADER}"}]`, 'not_locked_to_you');
  expectCode(secret(`"nonce":"\\ud800","data":"${TRADER}"`), 'not_locked_to_you');
});

test('refuses broken NUT-10 shapes', () => {
  expectCode(`{"kind":"P2PK","data":"${TRADER}"}`, 'not_locked_to_you');
  expectCode(`["P2PK"]`, 'not_locked_to_you');
  expectCode(`["P2PK",{"nonce":"${nonce}","data":"${TRADER}"},"extra"]`, 'not_locked_to_you');
  expectCode(`["P2PK",["${TRADER}"]]`, 'not_locked_to_you');
  expectCode(secret(`"data":"${TRADER}"`), 'not_locked_to_you');
  expectCode(secret(`"nonce":"","data":"${TRADER}"`), 'not_locked_to_you');
  expectCode(secret(`"nonce":"${nonce}"`), 'not_locked_to_you');
  expectCode(secret(`"nonce":"${nonce}","data":"${TRADER}","note":"hi"`), 'not_locked_to_you');
  expectCode(secret(`"nonce":"${nonce}","data":"${TRADER}","tags":null`), 'not_locked_to_you');
  expectCode(secret(`"nonce":"${nonce}","data":"${TRADER}",`), 'not_locked_to_you');
});

test('refuses every way for the payer to take it back', () => {
  const future = String(Math.floor(Date.now() / 1000) + 10 * 365 * 86400);
  const past = '1689418329';
  expectCode(withTags(`[["locktime","${future}"]]`), 'can_be_taken_back');
  expectCode(withTags(`[["locktime","${past}"]]`), 'can_be_taken_back');
  expectCode(withTags(`[["locktime","not a time"]]`), 'can_be_taken_back');
  expectCode(withTags(`[["refund","${OTHER_TRADER}"]]`), 'can_be_taken_back');
  expectCode(withTags(`[["locktime","${future}"],["refund","${OTHER_TRADER}"]]`), 'can_be_taken_back');
  expectCode(withTags(`[["n_sigs_refund","1"]]`), 'can_be_taken_back');
  expectCode(withTags(`[["sigflag","SIG_INPUTS"],["locktime","${future}"]]`), 'can_be_taken_back');
});

test('refuses locks other keys could spend or that need more signatures', () => {
  expectCode(withTags(`[["pubkeys","${OTHER_TRADER}"]]`), 'shared_lock');
  expectCode(withTags(`[["pubkeys","${OTHER_TRADER}"],["n_sigs","1"]]`), 'shared_lock');
  expectCode(withTags(`[["n_sigs","1"]]`), 'shared_lock');
  expectCode(withTags(`[["n_sigs","2"]]`), 'shared_lock');
});

test('refuses sigflags and tags we do not accept', () => {
  expectCode(withTags('[["sigflag","SIG_ALL"]]'), 'unsupported_lock');
  expectCode(withTags('[["sigflag","sig_inputs"]]'), 'unsupported_lock');
  expectCode(withTags('[["sigflag","SIG_INPUTS","SIG_ALL"]]'), 'unsupported_lock');
  expectCode(withTags('[["sigflag","SIG_INPUTS"],["sigflag","SIG_INPUTS"]]'), 'unsupported_lock');
  expectCode(withTags('[["memo","hello"]]'), 'unsupported_lock');
  expectCode(withTags('[["sigflag"]]'), 'unsupported_lock');
  expectCode(withTags('[["sigflag",""]]'), 'unsupported_lock');
  expectCode(withTags('[[]]'), 'unsupported_lock');
  expectCode(withTags('["sigflag"]'), 'unsupported_lock');
  expectCode(withTags('"sigflag"'), 'unsupported_lock');
  expectCode(withTags('{}'), 'unsupported_lock');
  expectCode(withTags(JSON.stringify(Array.from({ length: 9 }, () => ['sigflag', 'SIG_INPUTS']))), 'unsupported_lock');
});

test('review #3: the nonce must be 8 to 32 bytes of hex, keeping secrets well inside mint limits', () => {
  for (const n of ['a'.repeat(16), 'A'.repeat(64), 'ab'.repeat(16)]) {
    expectOk(secret(`"nonce":"${n}","data":"${TRADER}"`));
  }
  for (const n of ['abc', 'a'.repeat(66), 'z'.repeat(32), 'nonce-with-dashes-0123456789abcd', 'a'.repeat(600)]) {
    expectCode(secret(`"nonce":"${n}","data":"${TRADER}"`), 'not_locked_to_you');
  }
});

test('refuses everything when our own cached key is broken', () => {
  const r = checkLock(withTags('[]'), 'not a key');
  assert.equal(r.ok, false);
});

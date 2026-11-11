/**
 * Fuzzing: take a genuine receipt, change one thing at random, and check the
 * result is never green and the check never throws. Seeded, so a failure can
 * be replayed with the same seed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReceipt } from './check.ts';
import { checkLock } from './lock.ts';
import { fakeCurve, makeKeyset, makeToken, makeTrustedMint, MINT_URL, TRADER } from './test/fake-mint.ts';
import type { TraderContext } from './types.ts';

const SEED = Number(process.env.FUZZ_SEED ?? 20261111);
const RUNS = Number(process.env.FUZZ_RUNS ?? 3000);

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    // xorshift32
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

const KS = makeKeyset('mint-a');
const ctx: TraderContext = { traderPubkey: TRADER, mints: [makeTrustedMint(MINT_URL, [KS])] };
const PRINTABLE = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~é\u0000\n';

function mutateString(s: string, rand: () => number): string {
  const kind = Math.floor(rand() * 4);
  const at = Math.floor(rand() * (s.length + 1));
  const ch = PRINTABLE[Math.floor(rand() * PRINTABLE.length)]!;
  if (kind === 0) return s.slice(0, at) + ch + s.slice(at); // insert
  if (kind === 1) return s.slice(0, at) + s.slice(at + 1); // delete
  if (kind === 2) return s.slice(0, at) + ch + s.slice(at + 1); // replace
  return s.slice(0, at) + s.slice(at, at + 8).split('').reverse().join('') + s.slice(at + 8); // shuffle a run
}

test(`one random change to a genuine receipt is never green (${RUNS} runs, seed ${SEED})`, () => {
  const rand = rng(SEED);
  const fields = ['secret', 'C', 'e', 's', 'r', 'id', 'amount', 'mint', 'unit'] as const;
  for (let run = 0; run < RUNS; run++) {
    const token = makeToken(1 + Math.floor(rand() * 3000), { ks: KS });
    const n = Math.floor(rand() * token.proofs.length);
    const p = token.proofs[n]!;
    const field = fields[Math.floor(rand() * fields.length)]!;
    let before: string;
    let after: string;
    switch (field) {
      case 'secret':
      case 'C':
      case 'id':
        before = p[field];
        after = mutateString(before, rand);
        p[field] = after;
        break;
      case 'e':
      case 's':
      case 'r':
        before = p.dleq![field];
        after = mutateString(before, rand);
        p.dleq![field] = after;
        break;
      case 'amount': {
        before = String(p.amount);
        const options = [p.amount * 2, p.amount + 1, p.amount - 1, 0, -p.amount, p.amount / 2, 2 ** 40];
        p.amount = options[Math.floor(rand() * options.length)]!;
        after = String(p.amount);
        break;
      }
      case 'mint':
        before = token.mint;
        after = mutateString(before, rand);
        token.mint = after;
        break;
      case 'unit':
        before = token.unit;
        after = mutateString(before, rand);
        token.unit = after;
        break;
    }
    if (before === after) continue;
    // a mint URL change can be harmless (e.g. a trailing slash): that is fine
    let verdict;
    assert.doesNotThrow(() => {
      verdict = checkReceipt(token, ctx, {}, fakeCurve);
    }, `run ${run} field ${field}`);
    const v = verdict as unknown as ReturnType<typeof checkReceipt>;
    if (v.ok) {
      assert.equal(field, 'mint', `run ${run}: ${field} "${before}" -> "${after}" was accepted`);
      assert.equal(v.mint, MINT_URL);
    }
  }
});

test(`random changes to a valid lock never produce a lock to someone else that passes (${RUNS} runs)`, () => {
  const rand = rng(SEED + 1);
  const base = JSON.stringify(['P2PK', { nonce: 'abcd', data: TRADER, tags: [['sigflag', 'SIG_INPUTS']] }]);
  for (let run = 0; run < RUNS; run++) {
    let s = base;
    const edits = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < edits; k++) s = mutateString(s, rand);
    const r = checkLock(s, TRADER);
    if (!r.ok) continue;
    // anything still accepted must parse to exactly our shape with our key
    const parsed = JSON.parse(s) as [string, { data: string; tags?: string[][] }];
    assert.equal(parsed[0], 'P2PK', s);
    assert.equal(parsed[1].data, TRADER, s);
    for (const tag of parsed[1].tags ?? []) assert.deepEqual(tag, ['sigflag', 'SIG_INPUTS'], s);
  }
});

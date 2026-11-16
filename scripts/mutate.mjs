/**
 * Mutation testing for the offline check: break each rule on purpose, run
 * the rule-layer tests, and confirm at least one test fails. A mutation that
 * no test catches is a rule nothing protects. Runs with plain Node, no packages.
 *
 *   node scripts/mutate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const TESTS = ['src/verify/strict-json.test.ts', 'src/verify/lock.test.ts', 'src/verify/mint-url.test.ts', 'src/verify/check.test.ts', 'src/verify/fuzz.test.ts', 'src/wallet/cashub.test.ts', 'src/wallet/frames.test.ts', 'src/wallet/request.test.ts'];

// [file, what it breaks, from, to]
const MUTATIONS = [
  ['src/verify/check.ts', 'skip the DLEQ check', "if (!valid) return refuse('bad_signature'", "if (false) return refuse('bad_signature'"],
  ['src/verify/check.ts', 'skip the trusted-mint check', "if (!mint) return refuse('untrusted_mint'", "if (!mint && false) return refuse('untrusted_mint'"],
  ['src/verify/check.ts', 'skip the NUT-11 support check', "if (!nutSupported(mint, '11'))", "if (false)"],
  ['src/verify/check.ts', 'skip the unit check', "if (own(token, 'unit') !== 'sat')", "if (false)"],
  ['src/verify/check.ts', 'off-by-one on the amount', 'lands < requested', 'lands < requested - 1'],
  ['src/verify/check.ts', 'ignore the collect fee', 'const lands = total - feeSats;', 'const lands = total;'],
  ['src/verify/check.ts', 'allow the same proof twice', "if (seen.has(Y)) return refuse('malformed'", "if (false) return refuse('malformed'"],
  ['src/verify/check.ts', 'skip the lock check', 'if (!lock.ok) return refuse(lock.code', 'if (false) return refuse(lock.code'],
  ['src/verify/check.ts', 'skip keyset expiry', 'now + margin < ks.final_expiry', 'true'],
  ['src/verify/check.ts', 'skip the missing-key check', "if (!isPubkeyHex(A)) return refuse('unknown_keys'", "if (false) return refuse('unknown_keys'"],
  ['src/verify/check.ts', 'allow dust proofs', 'p.amount * 1000 <= ppk', 'false'],
  ['src/verify/check.ts', 'record replays as new', "if (!fresh) return refuse('already_received'", "if (false) return refuse('already_received'"],
  ['src/verify/check.ts', 'accept too many proofs', 'rawProofs.length > MAX_PROOFS', 'false'],
  ['src/verify/lock.ts', 'accept any key', "if (data !== traderPubkey) {", "if (false) {"],
  ['src/verify/lock.ts', 'allow a refund path', "if (PAYER_WAY_BACK.has(key)) {", "if (false) {"],
  ['src/verify/lock.ts', 'allow shared keys', "if (SHARED.has(key)) {", "if (false) {"],
  ['src/verify/lock.ts', 'allow unknown tags', "return refuse('unsupported_lock', `unknown tag", "return { ok: true }; void (`unknown tag"],
  ['src/verify/lock.ts', 'allow SIG_ALL', "tag[1] !== 'SIG_INPUTS'", 'false'],
  ['src/verify/lock.ts', 'allow whitespace around the lock', "secret[0] !== '[' || secret[secret.length - 1] !== ']'", 'false'],
  ['src/verify/lock.ts', 'allow extra fields', "if (!ALLOWED_FIELDS.has(field)) {", "if (false) {"],
  ['src/verify/strict-json.ts', 'allow duplicate keys', 'if (out.has(key)) fail(', 'if (false) fail('],
  ['src/verify/mint-url.ts', 'allow http mints', "if (url.protocol !== 'https:') return null;", ''],
  ['src/wallet/cashub.ts', 'allow trailing bytes', "if (this.at !== this.b.length) throw new Error('extra bytes after the token');", ''],
  ['src/wallet/cashub.ts', 'allow duplicate map keys', "if (out.has(k)) throw new Error(`key \"${k}\" appears twice`);", ''],
  ['src/wallet/frames.ts', 'skip the frame check', "if (check(text) !== sum) return { done: false, have: 0, total };", ''],
  ['src/wallet/request.ts', 'allow uppercase keys', "if (!isPubkeyHex(k))", "if (!/^0[23][0-9a-fA-F]{64}$/.test(k))"],
];

const run = () => spawnSync(process.execPath, ['--test', ...TESTS], { encoding: 'utf8' }).status === 0;
if (!run()) {
  console.log('FAIL: the tests fail before any mutation');
  process.exit(1);
}
let caught = 0;
const missed = [];
for (const [file, what, from, to] of MUTATIONS) {
  const original = readFileSync(file, 'utf8');
  if (!original.includes(from)) {
    missed.push(`${what}: mutation no longer applies (code moved)`);
    console.log(`STALE   ${what}`);
    continue;
  }
  writeFileSync(file, original.replace(from, to));
  try {
    const passed = run();
    if (passed) missed.push(what);
    else caught++;
    console.log(`${passed ? 'MISSED' : 'caught'}  ${what}`);
  } finally {
    writeFileSync(file, original);
  }
}
console.log(`\n${caught} of ${MUTATIONS.length} mutations caught`);
console.log(missed.length ? `FAIL: ${missed.join('; ')}` : 'PASS');
process.exit(missed.length ? 1 : 0);

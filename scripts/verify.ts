/**
 * One command that checks everything and prints PASS or FAIL.
 *
 *   npm run verify
 *
 * 1. types (tsc)
 * 2. unit, adversarial and fuzz tests, plus the official Cashu curve vectors
 * 3. the Go/No-Go run on the Cashu test mint (needs internet; fake sats)
 *
 * Bundle-size budget and the offline browser test join once the app exists.
 */
import { spawnSync } from 'node:child_process';

const checks: Array<{ name: string; cmd: string; args: string[] }> = [
  { name: 'types', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.json'] },
  { name: 'tests and curve vectors', cmd: 'node', args: ['--test', 'src/**/*.test.ts'] },
  { name: 'Go/No-Go on the test mint', cmd: 'node', args: ['scripts/go-no-go.ts'] },
];

let failed = 0;
for (const c of checks) {
  const t0 = Date.now();
  const r = spawnSync(c.cmd, c.args, { stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${c.name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
}
console.log(failed === 0 ? 'PASS' : `FAIL (${failed} of ${checks.length})`);
process.exit(failed === 0 ? 0 : 1);

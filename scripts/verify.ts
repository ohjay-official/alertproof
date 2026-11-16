/**
 * One command that checks everything and prints PASS or FAIL.
 *
 *   npm run verify
 *
 * 1. types (tsc)
 * 2. unit, adversarial and fuzz tests, plus the official Cashu curve vectors,
 *    and mutation testing (each verifier rule broken on purpose must fail a test)
 * 3. the Go/No-Go run on the Cashu test mint (needs internet; fake sats)
 * 4. the app build, with its gzipped size against the 60 KB budget
 * 5. the app in a real browser: the judge's demo on the test mint, offline
 *    open, slow 3G, and data per payment (needs `npx playwright install chromium` once)
 */
import { spawnSync } from 'node:child_process';

const checks: Array<{ name: string; cmd: string; args: string[] }> = [
  { name: 'types', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.json'] },
  { name: 'tests and curve vectors', cmd: 'node', args: ['--test', 'src/**/*.test.ts'] },
  { name: 'mutation testing (every rule guarded by a test)', cmd: 'node', args: ['scripts/mutate.mjs'] },
  { name: 'Go/No-Go on the test mint', cmd: 'node', args: ['scripts/go-no-go.ts'] },
  { name: 'app build and size budget', cmd: 'node', args: ['scripts/build-web.mjs'] },
  { name: 'app in a real browser', cmd: 'node', args: ['scripts/ui-check.mjs', 'ci-out/shots'] },
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

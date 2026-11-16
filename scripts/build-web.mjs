/**
 * Builds the app: web/src -> web/public/assets, with shared code split into
 * chunks so the trader page and the pay page only load what they use.
 * Writes web/public/assets/sizes.json and prints gzipped sizes, so the data
 * budget (first load 60 KB gzipped or less) is measured on every build.
 *
 *   node scripts/build-web.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const out = 'web/public/assets';
rmSync(out, { recursive: true, force: true });

const result = await build({
  entryPoints: { app: 'web/src/trader/main.ts', pay: 'web/src/pay/main.ts' },
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  logLevel: 'warning',
});

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const files = readdirSync(out).filter((f) => f.endsWith('.js'));
const sizes = Object.fromEntries(files.map((f) => [f, { bytes: statSync(join(out, f)).size, gzip: gz(join(out, f)) }]));

/** Everything a page loads before it can be used: its entry and every chunk it imports, not lazy ones. */
function firstLoad(entry) {
  const seen = new Set();
  const walk = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const imp of result.metafile.outputs[path]?.imports ?? []) if (imp.kind === 'import-statement') walk(imp.path);
  };
  walk(`${out}/${entry}`);
  return [...seen].reduce((n, p) => n + gz(p), 0);
}
const css = gz('web/public/app.css');
const html = { app: gz('web/public/app.html'), pay: gz('web/public/pay.html') };
const report = {
  files: sizes,
  firstLoadGzip: {
    trader: firstLoad('app.js') + css + html.app,
    customer: firstLoad('pay.js') + css + html.pay,
  },
  budgetGzip: 60 * 1024,
};
writeFileSync(`${out}/sizes.json`, JSON.stringify(report, null, 2));
for (const [f, s] of Object.entries(sizes)) console.log(`${f.padEnd(28)} ${String(s.bytes).padStart(8)} B  ${String(s.gzip).padStart(7)} B gz`);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`first load, gzipped: trader ${kb(report.firstLoadGzip.trader)}, customer ${kb(report.firstLoadGzip.customer)} (budget ${kb(report.budgetGzip)})`);

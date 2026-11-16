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
import { createHash } from 'node:crypto';
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

// The service worker: everything a trader needs to open the app with no data.
{
  const shell = ['/app', '/pay', '/app.css', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];
  const built = readdirSync(out).filter((f) => f.endsWith('.js')).map((f) => `/assets/${f}`);
  const files = [...shell, ...built];
  const hash = createHash('sha256');
  for (const f of ['web/public/app.html', 'web/public/pay.html', 'web/public/app.css', ...built.map((b) => 'web/public' + b)]) hash.update(readFileSync(f));
  const version = 'sealpay-' + hash.digest('hex').slice(0, 12);
  const sw = readFileSync('web/src/sw-template.js', 'utf8').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files));
  writeFileSync('web/public/sw.js', sw);
  console.log(`service worker ${version}: ${files.length} files`);
}

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
// What each chunk is made of, biggest packages first (bytes before gzip).
report.contents = {};
for (const [file, o] of Object.entries(result.metafile.outputs)) {
  if (!file.endsWith('.js')) continue;
  const byPkg = {};
  for (const [input, v] of Object.entries(o.inputs)) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
    const key = m ? m[1] : input.split('/').slice(0, 2).join('/');
    byPkg[key] = (byPkg[key] ?? 0) + v.bytesInOutput;
  }
  report.contents[file.split('/').pop()] = Object.fromEntries(Object.entries(byPkg).sort((a, b) => b[1] - a[1]).slice(0, 8));
}
writeFileSync(`${out}/sizes.json`, JSON.stringify(report, null, 2));
for (const [f, c] of Object.entries(report.contents)) console.log(f, JSON.stringify(c));
for (const [f, s] of Object.entries(sizes)) console.log(`${f.padEnd(28)} ${String(s.bytes).padStart(8)} B  ${String(s.gzip).padStart(7)} B gz`);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`first load, gzipped: trader ${kb(report.firstLoadGzip.trader)}, customer ${kb(report.firstLoadGzip.customer)} (budget ${kb(report.budgetGzip)})`);

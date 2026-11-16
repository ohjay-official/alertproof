/**
 * The app in a real browser, end to end, the way a judge tries it: demo
 * stall on the test mint (fake sats), type ₦2,000, the customer pays, the
 * receipt is checked with the network switched off, shown again, edited.
 * Serves web/public with the site's real security headers (vercel.json), so
 * a blocked request fails here too. Saves a screenshot of every screen.
 *
 *   node scripts/ui-check.mjs [outDir]
 *
 * Prints PASS or FAIL per step; exits 1 on any failure.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const outDir = process.argv[2] ?? 'ci-out/shots';
mkdirSync(outDir, { recursive: true });
const root = 'web/public';
const vercel = JSON.parse(readFileSync('web/vercel.json', 'utf8'));
const headers = Object.fromEntries(vercel.headers[0].headers.map((x) => [x.key, x.value]));
// The local server is http, so this rule would push requests to https.
headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('; upgrade-insecure-requests', '');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };

const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  let file = join(root, path);
  if (!existsSync(file) && existsSync(file + '.html')) file += '.html';
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { ...headers, 'content-type': 'text/html' });
    return res.end(readFileSync(join(root, '404.html')));
  }
  res.writeHead(200, { ...headers, 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(4173);

const base = 'http://localhost:4173';
const results = [];
const record = (step, pass, note = '') => {
  results.push({ step, pass, note });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}${note ? `  (${note})` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(String(e)));
let n = 0;
const shot = async (name) => page.screenshot({ path: join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`) });

async function step(name, fn) {
  try {
    const note = await fn();
    record(name, true, note ?? '');
  } catch (err) {
    record(name, false, String(err?.message ?? err).split('\n')[0]);
    await shot(`fail-${name.replace(/\W+/g, '-').slice(0, 40)}`).catch(() => undefined);
  }
}

try {
  await step('welcome screen loads', async () => {
    await page.goto(`${base}/app`);
    await page.getByRole('button', { name: 'Try the demo' }).waitFor();
    await shot('welcome');
  });
  await step('demo stall sets up on the test mint', async () => {
    await page.getByRole('button', { name: 'Try the demo' }).click();
    await page.getByText('Works with no data.').waitFor({ timeout: 30_000 });
    await shot('price-empty');
  });
  await step('type ₦2,000 on the keypad', async () => {
    for (const k of ['2', '00', '0']) await page.getByRole('button', { name: k, exact: true }).click();
    await page.locator('.amount').filter({ hasText: '₦2,000' }).waitFor();
    await shot('price-2000');
    return await page.locator('.sub').first().textContent();
  });
  await step('pay code shows a QR', async () => {
    await page.getByRole('button', { name: 'Show pay code' }).click();
    await page.locator('.qr svg').waitFor();
    await shot('pay-code');
  });
  await step('customer pays the test mint and gets a receipt', async () => {
    await page.getByRole('button', { name: 'Demo: pay it as the customer' }).click();
    await page.getByText("The customer's receipt", { exact: false }).waitFor({ timeout: 60_000 });
    await shot('customer-receipt');
    return await page.locator('.sub').first().textContent();
  });
  await step('checked with the network off: Paid', async () => {
    await page.getByRole('button', { name: /network off/i }).click();
    await page.locator('.verdict.ok .stamp').filter({ hasText: 'Paid' }).waitFor({ timeout: 10_000 });
    await shot('verdict-paid');
    return await page.locator('.v-note').textContent();
  });
  await step('same receipt again: Already used', async () => {
    await page.getByRole('button', { name: 'Demo: scan the same receipt again' }).click();
    await page.locator('.verdict.no .stamp').filter({ hasText: 'Already used' }).waitFor();
    await shot('verdict-already-used');
  });
  await step('edited receipt: Not paid', async () => {
    await page.getByRole('button', { name: 'Demo: try an edited receipt' }).click();
    await page.locator('.verdict.no .stamp').filter({ hasText: 'Not paid' }).waitFor();
    await shot('verdict-not-paid');
    return await page.locator('.v-line').first().textContent();
  });
  await step('sales screen lists the sale', async () => {
    await page.goto(`${base}/app#sales`);
    await page.getByRole('heading', { name: 'Today' }).waitFor();
    await page.locator('.sales li').first().waitFor();
    await shot('sales');
  });
  await step('collect with the PIN (network back on)', async () => {
    await page.getByRole('button', { name: /^Collect/ }).click();
    await page.getByLabel('PIN').fill('1234');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.getByText('Collected', { exact: false }).waitFor({ timeout: 30_000 });
    await shot('collected');
  });
  await step('customer pay page opens from a pay link', async () => {
    const key = '02' + 'ab'.repeat(32);
    await page.goto(`${base}/pay#k=${key}&m=https%3A%2F%2Ftestnut.cashu.space&s=Mama+Nkechi%27s+Fabrics&a=2292&f=2000&c=NGN`);
    await page.getByRole('button', { name: 'Pay ₦2,000' }).waitFor();
    await shot('pay-page');
  });
  await step('no console errors', async () => {
    if (problems.length) throw new Error(problems.slice(0, 3).join(' | '));
  });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} steps passed`);
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);

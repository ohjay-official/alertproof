/**
 * Builds the public site from web/site/pages/*.html into web/public, with one
 * shared header, menu, footer and head (title, description, canonical link,
 * share image). Each page starts with a JSON comment:
 *
 *   <!-- {"path": "/how-it-works", "title": "...", "description": "...", "nav": "how"} -->
 *
 * Also writes sitemap.xml. Run by scripts/build-web.mjs.
 */
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const ORIGIN = 'https://sealpay-beta.vercel.app';
const SRC = 'web/site/pages';
const OUT = 'web/public';

const NAV = [
  { key: 'how', href: '/how-it-works', label: 'How it works' },
  { key: 'traders', href: '/traders', label: 'For traders' },
  { key: 'paying', href: '/paying', label: 'Paying' },
  { key: 'security', href: '/security', label: 'Security' },
  { key: 'faq', href: '/faq', label: 'Questions' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function header(active) {
  const link = (n) => `<a href="${n.href}"${n.key === active ? ' aria-current="page"' : ''}>${n.label}</a>`;
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Sealpay home"><img src="/favicon.svg" alt="" width="32" height="32">Sealpay</a>
    <nav class="nav" aria-label="Main">${NAV.map(link).join('')}</nav>
    <span class="head-cta"><a class="btn" href="/app#demo">Try the demo</a></span>
    <details class="menu">
      <summary aria-label="Open the menu">Menu</summary>
      <nav class="menu-panel" aria-label="Main">${[{ key: 'home', href: '/', label: 'Home' }, ...NAV, { key: 'about', href: '/about', label: 'About' }].map(link).join('')}<a class="btn" href="/app#demo">Try the demo</a></nav>
    </details>
  </div>
</header>`;
}

const FOOTER = `<footer class="site-foot">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <a class="brand" href="/"><img src="/favicon.svg" alt="" width="32" height="32">Sealpay</a>
        <p class="small" style="color:#93aa9d"></p>
      </div>
      <div>
        <h2>Product</h2>
        <ul>
          <li><a href="/how-it-works">How it works</a></li>
          <li><a href="/traders">For traders</a></li>
          <li><a href="/paying">Paying with Sealpay</a></li>
          <li><a href="/app#demo">Try the demo</a></li>
          <li><a href="/app">Open the trader app</a></li>
        </ul>
      </div>
      <div>
        <h2>Trust</h2>
        <ul>
          <li><a href="/security">Security</a></li>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/terms">Terms</a></li>
        </ul>
      </div>
      <div>
        <h2>Project</h2>
        <ul>
          <li><a href="/about">About</a></li>
          <li><a href="/faq">Questions</a></li>
          <li><a href="https://github.com/ohjay-official/sealpay">Code on GitHub</a></li>
        </ul>
      </div>
    </div>
    <p class="foot-note">Sealpay is open source under the MIT licence. It is early software: the demo uses fake sats on a public test mint.</p>
  </div>
</footer>`.replace('<p class="small" style="color:#93aa9d"></p>', '<p class="foot-tag">Payments a fake alert can&rsquo;t fake.</p>');

function page(meta, body) {
  const url = ORIGIN + (meta.path === '/' ? '/' : meta.path);
  const title = meta.path === '/' ? meta.title : `${meta.title} | Sealpay`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(meta.description)}">
  <meta name="theme-color" content="#0f3d2e">
  ${meta.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="preload" href="/fonts/adventor-bold.woff" as="font" type="font/woff" crossorigin>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Sealpay">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ORIGIN}/og.png">
  <meta property="og:image:alt" content="Sealpay: payments a fake alert can't fake, with a green Paid stamp">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/site.css">${meta.jsonld ? `\n  <script type="application/ld+json">${meta.jsonld}</script>` : ''}
</head>
<body>
${header(meta.nav)}
<main id="main">
${body.trim()}
</main>
${FOOTER}
</body>
</html>
`;
}

export function buildSite() {
  copyFileSync('web/site/site.css', `${OUT}/site.css`);
  const urls = [];
  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.html')).sort()) {
    const raw = readFileSync(`${SRC}/${file}`, 'utf8');
    const m = /^<!--\s*(\{[\s\S]*?\})\s*-->\n?/.exec(raw);
    if (!m) throw new Error(`${file}: missing the JSON comment at the top`);
    const meta = JSON.parse(m[1]);
    if (meta.path === '/' && !meta.jsonld) {
      meta.jsonld = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Sealpay',
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Android, iOS (web app)',
        url: `${ORIGIN}/`,
        description: meta.description,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      });
    }
    writeFileSync(`${OUT}/${file}`, page(meta, raw.slice(m[0].length)));
    if (!meta.noindex) urls.push(ORIGIN + meta.path);
  }
  urls.push(`${ORIGIN}/app`);
  writeFileSync(
    `${OUT}/sitemap.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`,
  );
  return urls.length;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(`site: ${buildSite()} pages`);

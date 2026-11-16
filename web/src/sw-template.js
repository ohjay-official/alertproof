/*
 * Sealpay's service worker: after one visit, the trader app and the pay
 * page open with no data. Pages come from the cache at once and refresh in
 * the background; built files are named by content, so they're kept as is.
 * Only this site's own files are cached: mint and price calls never are.
 * Built by scripts/build-web.mjs, which fills in the file list.
 */
const VERSION = '__VERSION__';
const FILES = __FILES__;
const PAGES = new Set(['/app', '/pay', '/']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  if (req.mode === 'navigate' || PAGES.has(path)) {
    const key = PAGES.has(path) ? path : null;
    if (!key) return;
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(key);
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(key, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached ?? fresh;
      }),
    );
    return;
  }
  event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(req)));
});

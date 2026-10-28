/* Lectura Veloz service worker.
 * - App shell: cache-first (precached on install).
 * - Google Fonts: stale-while-revalidate.
 * - Other same-origin GET: network-first, falling back to cache.
 * Bump CACHE_VERSION whenever shell files change.
 */
const CACHE_VERSION = 'v13';
const SHELL_CACHE = `lv-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `lv-runtime-${CACHE_VERSION}`;
const FONT_CACHE = `lv-fonts-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/storage.js',
  './js/text.js',
  './js/importers.js',
  './js/training.js',
  './js/speech.js',
  './js/indra.js',
  './js/ocr-worker.js',
  './js/pdfview.js',
  './css/pdfview.css',
  './css/training.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.location).href));
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Add individually so one missing file doesn't abort the whole install.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, FONT_CACHE]);
  event.waitUntil(
    caches.keys()
      // lv-indra-*: modelos del OCR (ocr-worker.js), van por su propia versión.
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k) && !k.startsWith('lv-indra-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    if (FONT_HOSTS.has(url.hostname)) event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return; // other cross-origin requests: browser default
  }

  // Strip query for shell matching (e.g. ./?source=pwa).
  const bare = url.origin + url.pathname;
  if (SHELL_URLS.has(bare)) {
    event.respondWith(cacheFirst(req, bare));
    return;
  }
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req, key) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    return (await cache.match('./index.html')) || Response.error();
  }
}

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (await caches.match(req));
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await caches.match(new URL('./index.html', self.location).href);
      if (shell) return shell;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const update = fetch(req)
    .then((res) => {
      // Opaque responses (status 0) are fine to cache for fonts.
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || update;
}

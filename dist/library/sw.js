// Service worker for the Rav Tzadok Library web app.
// - The app shell is cached on install so the library opens offline.
// - Texts (data/) are served from cache and refreshed in the background.
// - Sefaria API answers (English, connections, quoted sources) are network-first
//   with the last answer kept for offline use; web fonts are cache-first.
const VERSION = 'v4';
const SHELL = `rtl-shell-${VERSION}`;
const DATA = 'rtl-data';
const EXTERNAL = 'rtl-external';
const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png',
  './data/catalog.json', './data/cited/index.json', './vendor/fflate.min.js', './vendor/qrcode.js', './install/',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('rtl-shell-') && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

const timeout = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

async function networkFirst(request, cacheName, ms = 8000) {
  const cache = await caches.open(cacheName);
  try {
    const res = await timeout(ms, fetch(request));
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreVary: true });  // also texts saved by a download pack
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const hit = (await cache.match(request)) || (await caches.match(request));
  const fresh = fetch(request).then(res => { if (res.ok) cache.put(request, res.clone()); return res; });
  if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);

  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    const rel = url.pathname.slice(scope.pathname.length);
    if (request.mode === 'navigate' || rel === '' || rel === 'index.html') {
      // The page itself: newest when online, cached copy offline.
      event.respondWith(networkFirst(request, SHELL, 5000).catch(() => caches.match('./index.html')));
    } else if (rel.startsWith('downloads/')) {
      return; // large zip: straight from the network, not cached
    } else if (rel.startsWith('data/')) {
      event.respondWith(staleWhileRevalidate(request, DATA, event));
    } else {
      event.respondWith(cacheFirst(request, SHELL));
    }
    return;
  }
  if (url.hostname.endsWith('sefaria.org') && url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, EXTERNAL));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, EXTERNAL));
  }
});

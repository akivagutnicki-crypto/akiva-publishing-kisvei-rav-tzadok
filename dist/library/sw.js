// Service worker for the Rav Tzadok Library web app.
// - The app shell is cached on install so the library opens offline.
// - Texts (data/) are served from cache and refreshed in the background.
// - Sefaria API answers (English, connections, quoted sources) are network-first
//   with the last answer kept for offline use; web fonts are cache-first.
const VERSION = '20261016-et-haochel-240-5468b7180d41-20261016-pri-vayera-chayei-footnotes-929';
// Keep this layout refresh when a later publishing step updates the text edition version.
const SHELL = `rtl-shell-${VERSION}-compact-noach-audio-20261016-beit-vayera-complete-20261016-dover-elaboration-sources-20261018-dover-revisions-v1-dover-revisions-v2-dover-title-paragraphs-v1-dover-headings-v1-dover-reviewed-parallels-v3-063a9c0009bc-hebrew-alignment-20261020-reviewed-connections-v4-20261021-pri-shabbos-oral-deferred-v2-preferred-editions-v1-20261019-dew-of-your-youth-pri-toldos-51f1f9d4ea47-pri-shevat-tubishvat-399c2228eea0-pri-seasonal-1407-v1-chanukah25-4f938282f3f2-pri-shabbos-37b00c90ec6dbdbb-appended-parallels-cleanup-3e016f592d716c7b-source-quotations-55503757abcd26c0-pri-shabbos-quotes-f0304d909e67-beit-toldos-0dac5af7d07e-pri-seasonal-quotes-92abce2ff13b-tzidkat-quotes-b8489bff7bf3-dover-kdp-v1-9802990330fd-docx-20261022-divrei-source-audit-584ae0be455e-divrei16-media-20261022-divrei16-page-preview-20261022-reader-ui-20261022-responsive-v1-reader-ui-route-safe-v2-20261022-divrei16-transcript-v2-20261022-share-v1-20261023-mei-volume-ii-v1-20261023-mei-likutei-v1-tzidkat-source-accuracy-aec0a541c2a0-tzidkat-source-attribution-ba0242471e1b-20261023-new-books-v1-20261025-dover-print-v1-20261026-vayeira-mesiras-nefesh-v1-vayeira-interlinear-fonts-v1-20261030-vayeira-blog-shiur-v2-20261030-vayeira-shiur-audio-v3-20261030-vayeira-audio-all-sections-v4`;
const DATA = 'rtl-data';
const EXTERNAL = 'rtl-external';
const SHELL_FILES = [
  './vayeira-study.js?v=20261030-vayeira-audio-all-sections-v4', './studies/vayeira-mesiras-nefesh.json?v=20261026-vayeira-mesiras-nefesh-v1',
  './downloads/vayeira-akeidah-mesiras-nefesh-cover.webp',
  // akiva-dover-print-cache
  '../editions/dover-tzedek-volume-i-front.webp', '../editions/dover-tzedek-volume-ii-front.webp',
  // akiva-new-books-cache
  '../editions/new-books.css?v=20261023-new-books-v1',
  '../editions/pri-tzaddik-rosh-chodesh-front.webp', '../editions/pri-tzaddik-shabbos-front.webp',
// akiva-share-cache-start
  './share.css?v=20261022-share-v1', './share.js?v=20261022-share-v1', './open/',
// akiva-share-cache-end
  './responsive-ui.css?v=20261022-responsive-v1', './responsive-ui.js?v=20261022-responsive-v1',
  './', './index.html', './manifest.webmanifest', './shiur-player.js?v=20261022-divrei16-media', './divrei16-preview.js?v=20261022-divrei16-transcript-v2',
  './sefaria-packs.js?v=20261019-preferred-edition-cache-v4', './data/packs/collections.json',
  './source-connections.js?v=20261021-pri-seasonal-pdf-quotations-v1-92abce2ff13b', './source-connections/catalog.json?v=20261020-reviewed-connections-v4',
  './source-connections/translations.json?v=20261020-reviewed-connections-v4',
  './source-editions.js?v=20261019-preferred-source-editions-v1',
  './connected-ideas.js?v=20261021-pri-shabbos-oral-deferred-v2', './connected-ideas/catalog.json?v=20261021-pri-shabbos-oral-deferred-v2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png',
  './blog/', './blog/even-the-world-to-come/', './blog/even-the-world-to-come/shiur/', './blog/the-alchemy-of-the-soul/', './blog/the-alchemy-of-the-soul/read-pdf/', './blog/pdfs/the-alchemy-of-the-soul.pdf',
  './data/catalog.json', './data/cited/index.json', './vendor/fflate.min.js', './vendor/qrcode.js', './install/',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL)
    .then(c => c.addAll(SHELL_FILES.map(url => new Request(url, {cache: 'reload'}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldShells = keys.filter(k => k.startsWith('rtl-shell-') && k !== SHELL);
    await Promise.all(oldShells.map(k => caches.delete(k)));
    await self.clients.claim();
    // Older installed screens have no update listener. Reload them once when
    // their shell is replaced, preserving their current text URL and packs.
    if (oldShells.length) {
      const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
      await Promise.all(windows.filter(c => c.url.startsWith(self.registration.scope))
        .map(c => c.navigate(c.url).catch(() => {})));
    }
  })());
});

const timeout = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

function hasExplicitEdition(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith('/api/') && (url.searchParams.has('ven') || url.searchParams.has('vhe')
    || url.searchParams.getAll('version').some(version => !['source', 'translation', 'primary'].includes(version)));
}

async function networkFirst(request, cacheName, ms = 8000) {
  const cache = await caches.open(cacheName);
  try {
    const res = await timeout(ms, fetch(request, {cache: 'no-cache'}));
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    // An exact edition request must never receive an older default translation.
    // Prefer current ZIP-installed data before older edition-query entries.
    const canonicalDataUrl = new URL(request.url);
    canonicalDataUrl.search = '';
    const hit = (await cache.match(request, { ignoreVary: true })) ||
      (!hasExplicitEdition(request) && cacheName === DATA ? await cache.match(canonicalDataUrl.href, { ignoreVary: true }) : null) ||
      (!hasExplicitEdition(request) && await cache.match(request, { ignoreVary: true, ignoreSearch: true }));  // also texts saved by a download pack
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
      event.respondWith(networkFirst(request, SHELL, 5000).catch(() => caches.match(request).then(hit => hit || caches.match('./index.html'))));
    } else if (rel.startsWith('downloads/') || rel.startsWith('audio/')) {
      return; // MP3 range requests and large downloads: straight from the network.
      // Never cache a partial audio response as if it were the whole recording.
    } else if (rel.startsWith('source-connections/') || rel === 'source-connections.js'
        || rel.startsWith('connected-ideas/') || rel === 'connected-ideas.js' || rel === 'source-editions.js'
        || rel === 'sefaria-packs.js') {
      event.respondWith(networkFirst(request, DATA));
    } else if (rel.startsWith('data/takanat-hashavin/') || rel.startsWith('data/et-haochel/') || rel === 'data/parallels/et-haochel.json' || /^data\/(?:catalog\.json|files\.json|cited\/index\.json|[^/]+\/toc\.json)$/.test(rel) || /^data\/(?:dover-tzedek|likkutei-maamarim|ohr-zarua-latzadik|peri-tzadik|tiferet-yosef|beit-yaakov-on-torah|mei-ha-shiloach|poked-akarim|sefer-hazikhronot|yisrael-kedoshim|machshavot-charutz|divrei-soferim|tzidkat-hatzadik|toldos-hakohen|meshiv-hata-anah|meshiv-tzedek)\//.test(rel)) {
      // Contents and manifests must reflect newly added editions immediately.
      event.respondWith(networkFirst(request, DATA));
    } else if (rel.startsWith('data/') && (url.searchParams.get('edition') || '').startsWith('20261018-appended-parallels-cleanup-')) {
      // Appended parallel cleanup offline fallback.
      event.respondWith(networkFirst(request, DATA));
    } else if (rel.startsWith('data/') && (url.searchParams.get('edition') === '20261019-source-quotations-55503757abcd26c0' || rel.startsWith('data/divrei-chalomot/') || rel.startsWith('data/divrei-soferim/') || rel.startsWith('data/et-haochel/') || rel.startsWith('data/kometz-haminchah/') || rel.startsWith('data/likkutei-maamarim/') || rel.startsWith('data/machshavot-charutz/') || rel.startsWith('data/meshiv-hata-anah/') || rel.startsWith('data/meshiv-tzedek/') || rel.startsWith('data/ohr-zarua-latzadik/') || rel.startsWith('data/peri-tzadik/') || rel.startsWith('data/poked-akarim/') || rel.startsWith('data/sefer-hazikhronot/') || rel.startsWith('data/sichat-malakhei-hasharet/') || rel.startsWith('data/sichat-shedim/') || rel.startsWith('data/tzidkat-hatzadik/') || rel.startsWith('data/yisrael-kedoshim/'))) {
      // Supplied source quotation network refresh.
      event.respondWith(networkFirst(request, DATA));
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


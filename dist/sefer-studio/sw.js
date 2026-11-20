// Keep this installation's cache separate from other apps on the same host.
const APP_SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `seferstudio-${encodeURIComponent(APP_SCOPE.href)}-`;
const CACHE_NAME = `${CACHE_PREFIX}v9-install-button-20261120`;
const CORE_URLS = [
  './',
  './index.html',
  './kdp-cover.css',
  './kdp-geometry.js',
  './kdp-render.js',
  './kdp-png.js',
  './kdp-cover.js',
  './ocr-session.js?v=2',
  './ocr-header-coverage.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
].map((path) => new URL(path, APP_SCOPE).href);
const CORE_PATHS = new Set(CORE_URLS.map((url) => new URL(url).pathname));
const PUBLIC_DEPENDENCIES = new Set([
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js'
]);
const INDEX_URL = new URL('./index.html', APP_SCOPE).href;
const SHELL_PATHS = new Set([APP_SCOPE.pathname, new URL(INDEX_URL).pathname]);

function isPublicDependency(url) {
  return PUBLIC_DEPENDENCIES.has(url.href) ||
    (url.origin === 'https://fonts.googleapis.com' && /^\/css2?$/.test(url.pathname)) ||
    (url.origin === 'https://fonts.gstatic.com' && url.pathname.startsWith('/s/'));
}

async function remember(cache, request, response) {
  if (!response || (response.status !== 200 && response.type !== 'opaque')) return;
  if (/\bno-store\b/i.test(response.headers.get('cache-control') || '')) return;
  // A full cache must not prevent a document or script from being opened.
  try { await cache.put(request, response.clone()); } catch (_) {}
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_URLS);
    // A blocked or unavailable CDN must not prevent installation of the app.
    await Promise.allSettled([...PUBLIC_DEPENDENCIES].map(async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
        await remember(cache, url, response);
      } finally { clearTimeout(timeout); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    // Older generic OfficeStudio caches may belong to another app. Leave them alone.
    await self.clients.claim();
  })());
});

async function navigate(request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    const url = new URL(request.url);
    if (response.ok && !url.search && SHELL_PATHS.has(url.pathname)) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await remember(cache, APP_SCOPE.href, response);
        await remember(cache, INDEX_URL, response);
      } catch (_) {}
    }
    return response;
  } catch (_) {
    try {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(request) || await cache.match(INDEX_URL) || Response.error();
    } catch (_) { return Response.error(); }
  }
}

async function asset(request) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch (_) {}
  try {
    const response = await fetch(request);
    if (cache) await remember(cache, request, response);
    return response;
  } catch (_) {
    // Never return HTML in place of a missing script, font, PDF, or other asset.
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization') ||
      request.headers.has('range') || request.cache === 'no-store') return;
  const url = new URL(request.url);
  const inScope = url.origin === APP_SCOPE.origin && url.pathname.startsWith(APP_SCOPE.pathname);
  if (request.mode === 'navigate' && inScope) {
    event.respondWith(navigate(request));
    return;
  }
  const localAsset = inScope && ((!url.search && CORE_PATHS.has(url.pathname)) || CORE_URLS.includes(url.href));
  if (localAsset || isPublicDependency(url)) event.respondWith(asset(request));
  // User API calls, MCP connections, cloud documents, and unrelated sites bypass this cache.
});

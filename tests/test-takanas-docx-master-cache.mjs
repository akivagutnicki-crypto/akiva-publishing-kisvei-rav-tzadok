// Targeted service-worker integration using the checked-in worker template,
// native Response/webcrypto, and a small browser-like CacheStorage test double.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PUBLISHER = path.join(REPO, 'scripts/publish-takanas-docx-master.mjs');
// An optional explicit path also tests a retrieved current production worker.
const ORIGINAL = path.resolve(process.argv[2] || path.join(REPO, 'dist/library/sw.js'));
const {patchServiceWorker} = await import(PUBLISHER);
const raw = fs.readFileSync(ORIGINAL, 'utf8');
const sha = x => createHash('sha256').update(x).digest('hex');
const SCOPE = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/';
const STAMP = 'fixture-20261102';
const CHAPTER = 'data/takanat-hashavin/15.json';
const PARALLELS = 'data/parallels/takanat-hashavin.json';
const CATALOG = 'data/catalog.json';
const CITED = 'data/cited/index.json';
const IDEAS = 'connected-ideas/catalog.json';
const OTHER = 'data/tzidkat-hatzadik/1.json';
const current = {
  [CHAPTER]: JSON.stringify([{n: 1, p: [['תְּשׁוּבָה', 'Teshuvah']], footnotes: [{sourceId: 'TK-KDP-II-1095'}]}]),
  [PARALLELS]: JSON.stringify({'Takanat HaShavin 15:1': {q: ['Psalms 51:12']}}),
  [CATALOG]: JSON.stringify([{slug: 'takanat-hashavin', segments: 363}]),
  [CITED]: JSON.stringify(['takanat-hashavin', 'tzidkat-hatzadik']),
  [IDEAS]: JSON.stringify({records: [{id: 'other-book-only', originRef: 'Tzidkat HaTzadik 1:1'}]}),
};
const pins = Object.fromEntries(Object.entries(current).map(([k, v]) => [k, sha(v)]));
const patched = patchServiceWorker(raw, STAMP, pins);

class MockRequest {
  constructor(input, options = {}) {
    this.url = new URL(typeof input === 'string' ? input : input.url, SCOPE).href;
    this.method = options.method || input?.method || 'GET';
    this.mode = options.mode || input?.mode || 'cors';
  }
}
const keyOf = request => new URL(typeof request === 'string' ? request : request.url, SCOPE).href;
const withoutSearch = key => { const u = new URL(key); u.search = ''; return u.href; };
class MockCache {
  constructor(name) { this.name = name; this.entries = new Map(); this.puts = []; this.deletes = []; this.rejectPut = false; }
  async match(request, options = {}) {
    const key = keyOf(request);
    const hit = this.entries.get(key) || (options.ignoreSearch ? [...this.entries].find(([k]) => withoutSearch(k) === withoutSearch(key))?.[1] : null);
    return hit?.clone();
  }
  async put(request, response) {
    if (this.rejectPut) throw new Error('Simulated quota failure');
    const key = keyOf(request); this.puts.push(key); this.entries.set(key, response.clone());
  }
  async keys() { return [...this.entries.keys()].map(url => new MockRequest(url)); }
  async delete(request) { const key = keyOf(request); this.deletes.push(key); return this.entries.delete(key); }
  async addAll() { throw new Error('Install precache is outside this targeted fixture'); }
}
class MockCacheStorage {
  constructor() { this.stores = new Map(); this.deletedStores = []; }
  async open(name) { if (!this.stores.has(name)) this.stores.set(name, new MockCache(name)); return this.stores.get(name); }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { this.deletedStores.push(name); return this.stores.delete(name); }
  async match(request, options) { for (const store of this.stores.values()) { const hit = await store.match(request, options); if (hit) return hit; } }
}

function environment({nextPublisher = false} = {}) {
  const cacheStorage = new MockCacheStorage(), handlers = new Map(), calls = [], claims = [], navigations = [];
  let fetchImpl = async () => { throw new Error('Offline fixture'); };
  const self = {
    registration: {scope: SCOPE},
    addEventListener: (name, fn) => { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); },
    skipWaiting: async () => {},
    clients: {claim: async () => claims.push(true), matchAll: async () => [
      {url: SCOPE + '#/read/Takanat_HaShavin_15', navigate: async url => navigations.push(url)},
      {url: 'https://other.example/app/', navigate: async url => navigations.push(url)},
    ]},
  };
  const timed = (fn, delay, ...args) => { const t = setTimeout(fn, delay, ...args); t.unref(); return t; };
  const context = vm.createContext({self, caches: cacheStorage, URL, Request: MockRequest, Response,
    crypto: webcrypto, Uint8Array, console, setTimeout: timed, clearTimeout,
    fetch: async (request, options) => { calls.push({url: keyOf(request), options}); return fetchImpl(request, options); }});
  const script = nextPublisher ? patched.replace(/(const SHELL = `[^`]+)(`;)/, '$1-next-reviewed-publisher$2') : patched;
  new vm.Script(script, {filename: 'actual-live-sw-plus-takanas-guard.js'}).runInContext(context);
  const shell = vm.runInContext('SHELL', context);
  return {
    context, shell, caches: cacheStorage, calls, claims, navigations,
    setFetch: fn => { fetchImpl = fn; },
    async seed(cacheName, relative, body, options) { const store = await cacheStorage.open(cacheName); await store.put(new MockRequest(relative), new Response(body, options)); return store; },
    async fetch(relative, options) {
      const request = new MockRequest(relative, options); let response; const waits = [];
      const event = {request, respondWith: p => { assert.equal(response, undefined, 'respondWith called twice'); response = Promise.resolve(p); }, waitUntil: p => waits.push(Promise.resolve(p))};
      for (const handler of handlers.get('fetch') || []) handler(event);
      if (!response) return {handled: false};
      const result = await response; await Promise.all(waits); return {handled: true, response: result};
    },
    async activate() { const waits = []; for (const handler of handlers.get('activate') || []) handler({waitUntil: p => waits.push(Promise.resolve(p))}); await Promise.all(waits); },
    protected(relative) { return context.takanasDocxProtected(relative); },
  };
}
async function cacheText(env, cacheName, relative) { const hit = await (await env.caches.open(cacheName)).match(relative); return hit ? hit.text() : null; }

const results = [];
async function test(name, fn) {
  const started = Date.now();
  try { const detail = await fn(); results.push({name, status: 'PASS', milliseconds: Date.now() - started, ...detail}); }
  catch (error) { results.push({name, status: 'FAIL', milliseconds: Date.now() - started, error: error.stack}); }
}

await test('Actual fetch hook validates network bytes and caches both versioned and canonical keys', async () => {
  const env = environment(), query = CHAPTER + '?takanas_docx=' + STAMP;
  env.setFetch(async () => new Response(current[CHAPTER]));
  const result = await env.fetch(query); assert(result.handled); assert.equal(await result.response.text(), current[CHAPTER]);
  assert.equal(await cacheText(env, 'rtl-data', CHAPTER), current[CHAPTER]); assert.equal(await cacheText(env, 'rtl-data', query), current[CHAPTER]);
  assert.equal(env.calls.length, 1); assert.equal(env.calls[0].options.cache, 'no-cache');
  return {canonicalAndVersionedCached: true, usedActualFetchEvent: true};
});

await test('Offline ZIP-installed latest canonical chapter is accepted under a new query', async () => {
  const env = environment(); await env.seed('rtl-data', CHAPTER, current[CHAPTER]);
  const result = await env.fetch(CHAPTER + '?takanas_docx=' + STAMP); assert.equal(await result.response.text(), current[CHAPTER]);
  return {basis: 'Current chapter bytes installed at their canonical URL by the ZIP importer'};
});

await test('Old canonical and all old query variants are rejected offline', async () => {
  const env = environment(); for (const key of [CHAPTER, CHAPTER + '?old=1', CHAPTER + '?old=2']) await env.seed('rtl-data', key, 'old Reader translation');
  await env.seed(env.shell, CHAPTER + '?shell=old', 'old Reader translation');
  await assert.rejects(() => env.fetch(CHAPTER + '?takanas_docx=' + STAMP), /current Takanas edition is not available/);
});

await test('Current shell Connected Ideas query fallback requires the exact expected SHA', async () => {
  const env = environment(); await env.seed('rtl-data', IDEAS, 'retired ideas'); await env.seed(env.shell, IDEAS + '?v=published-install-key', current[IDEAS]);
  const result = await env.fetch(IDEAS + '?takanas_docx=' + STAMP); assert.equal(await result.response.text(), current[IDEAS]);
  const bad = environment(); await bad.seed(bad.shell, IDEAS + '?v=published-install-key', 'retired ideas');
  await assert.rejects(() => bad.fetch(IDEAS + '?takanas_docx=' + STAMP), /current Takanas edition is not available/);
});

await test('Bad network payload never enters either canonical or versioned cache', async () => {
  const env = environment(), query = CHAPTER + '?takanas_docx=' + STAMP; env.setFetch(async () => new Response('wrong new response'));
  await assert.rejects(() => env.fetch(query), /current Takanas edition is not available/);
  assert.equal(await cacheText(env, 'rtl-data', query), null); assert.equal(await cacheText(env, 'rtl-data', CHAPTER), null);
  const withGoodCache = environment(); const store = await withGoodCache.seed('rtl-data', CHAPTER, current[CHAPTER]); const beforePuts = store.puts.length;
  withGoodCache.setFetch(async () => new Response('wrong new response')); const result = await withGoodCache.fetch(query);
  assert.equal(await result.response.text(), current[CHAPTER]); assert.equal(store.puts.length, beforePuts); assert.equal(await cacheText(withGoodCache, 'rtl-data', query), null);
});

await test('A non-OK response cannot satisfy a matching body hash', async () => {
  const env = environment(); env.setFetch(async () => new Response(current[CHAPTER], {status: 404}));
  await assert.rejects(() => env.fetch(CHAPTER), /current Takanas edition is not available/); assert.equal(await cacheText(env, 'rtl-data', CHAPTER), null);
});

await test('Verified online bytes remain readable when CacheStorage quota fails', async () => {
  const env = environment(), data = await env.caches.open('rtl-data'); data.rejectPut = true; env.setFetch(async () => new Response(current[CHAPTER]));
  const result = await env.fetch(CHAPTER); assert.equal(await result.response.text(), current[CHAPTER]); assert.equal(data.entries.size, 0);
});

await test('Actual activation deletes only affected mismatched data while preserving other books', async () => {
  const env = environment();
  const stale = [CHAPTER + '?old=1', CATALOG, IDEAS + '?v=old', 'data/takanat-hashavin/obsolete.json'];
  for (const key of stale) await env.seed('rtl-data', key, 'obsolete');
  await env.seed('rtl-data', CHAPTER, current[CHAPTER]); await env.seed('rtl-data', OTHER, 'other book live data');
  await env.seed(env.shell, IDEAS + '?v=good', current[IDEAS]); await env.seed(env.shell, CATALOG + '?v=bad', 'obsolete'); await env.seed(env.shell, OTHER, 'other book shell data');
  await env.seed('rtl-external', OTHER, 'other external data');
  await env.seed('rtl-shell-old-baseline-cache', './index.html', 'old app shell');
  await env.activate();
  for (const key of stale) assert.equal(await cacheText(env, 'rtl-data', key), null);
  assert.equal(await cacheText(env, 'rtl-data', CHAPTER), current[CHAPTER]); assert.equal(await cacheText(env, 'rtl-data', OTHER), 'other book live data');
  assert.equal(await cacheText(env, env.shell, IDEAS + '?v=good'), current[IDEAS]); assert.equal(await cacheText(env, env.shell, CATALOG + '?v=bad'), null); assert.equal(await cacheText(env, env.shell, OTHER), 'other book shell data');
  assert.equal(await cacheText(env, 'rtl-external', OTHER), 'other external data'); assert.equal(env.claims.length, 1);
  assert(!env.caches.stores.has('rtl-shell-old-baseline-cache')); assert.equal(env.navigations.length, 1);
  return {usedActualActivateEvent: true, originalOldShellCleanupRetained: true, otherBookDataPreserved: true};
});

await test('Latest release pins shared catalogs and Connected Ideas only for its exact SHELL suffix', async () => {
  const env = environment(); assert(env.shell.endsWith('-takanas-docx-' + STAMP)); assert(env.protected(CATALOG)); assert(env.protected(IDEAS)); assert(env.protected(CITED)); assert(env.protected(CHAPTER)); assert(env.protected(PARALLELS)); assert(!env.protected(OTHER));
  const later = environment({nextPublisher: true}); assert(!later.shell.endsWith('-takanas-docx-' + STAMP)); assert(!later.protected(CATALOG)); assert(!later.protected(IDEAS)); assert(!later.protected(CITED)); assert(later.protected(CHAPTER)); assert(later.protected(PARALLELS));
});

await test('A subsequent publisher may update shared global data but cannot bypass Takanas protection', async () => {
  const env = environment({nextPublisher: true}); env.setFetch(async request => new Response(new URL(request.url).pathname.endsWith('catalog.json') ? 'next legitimate global catalog' : 'wrong Takanas body'));
  const result = await env.fetch(CATALOG + '?next=edition'); assert.equal(await result.response.text(), 'next legitimate global catalog'); assert.equal(await cacheText(env, 'rtl-data', CATALOG + '?next=edition'), 'next legitimate global catalog');
  await assert.rejects(() => env.fetch(CHAPTER + '?next=edition'), /current Takanas edition is not available/);
  await env.seed('rtl-data', CHAPTER, 'bad persisted Takanas'); await env.seed('rtl-data', CATALOG, 'future publisher shared cache'); await env.activate();
  assert.equal(await cacheText(env, 'rtl-data', CHAPTER), null); assert.equal(await cacheText(env, 'rtl-data', CATALOG), 'future publisher shared cache');
});

await test('Protection is scoped to the publication origin and GET events', async () => {
  const env = environment(); assert.equal(env.context.takanasDocxRel('https://other.example/library/' + CHAPTER), null); assert.equal((await env.fetch(CHAPTER, {method: 'POST'})).handled, false); assert.equal(env.calls.length, 0);
});

const report = {schemaVersion: 1, status: results.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL',
  scope: 'Targeted service-worker VM integration; supplied or checked-in SW template + exported patch; no deployment, browser disk quota or install precache simulation',
  generatedAt: new Date().toISOString(), serviceWorkerTemplate: ORIGINAL, serviceWorkerTemplateSha256: sha(raw),
  publisher: PUBLISHER, publisherSha256: sha(fs.readFileSync(PUBLISHER)), testSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  patchedServiceWorkerSha256: sha(patched), testCount: results.length, passed: results.filter(r => r.status === 'PASS').length,
  nativeAPIs: ['Response', 'crypto.webcrypto.subtle.digest'], mockedAPIs: ['CacheStorage', 'Cache', 'Request', 'fetch', 'service worker events/clients'],
  timerHandling: '20-second timeout handles are unref-ed; no blocking timer linger', results};
const reportFile = path.join(REPO, 'artifacts/takanas-docx-master/cache-test-verification.json'); fs.mkdirSync(path.dirname(reportFile), {recursive: true}); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({status: report.status, tests: report.testCount, passed: report.passed, reportFile}));
if (report.status !== 'PASS') { console.error(JSON.stringify(results.filter(r => r.status !== 'PASS'), null, 2)); process.exitCode = 1; }

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('dist/library/index.html', 'utf8');
const edition = /\?edition=([^']+)/.exec(html)[1];
const resolver = html.slice(html.indexOf('let CATALOG = []'), html.indexOf('const CAT_COLORS'));
const root = 'dist/library/data/likkutei-maamarim/';
const toc = JSON.parse(fs.readFileSync(root + 'toc.json', 'utf8'));
const refs = toc.toc.children.flatMap(l => l.depth === 1 ? [l.ref]
  : l.shape.map((n, i) => n ? `${l.ref} ${i + 1}` : null).filter(Boolean));

async function reader(oldContents, oldTexts) {
  const contents = structuredClone(toc);
  if (oldContents) for (const l of contents.toc.children) {
    delete l.il1; delete l.ilch; delete l.interlinear;
  }
  const requested = [];
  const context = vm.createContext({
    gematria: String,
    fetch: async url => {
      requested.push(url);
      assert.ok(url.endsWith('?edition=' + edition));
      const path = url.split('?')[0];
      let data = path === 'data/catalog.json' ? [{title: toc.title, he: toc.he,
        slug: 'likkutei-maamarim', version: toc.version}]
        : path.endsWith('toc.json') ? contents
        : JSON.parse(fs.readFileSync('dist/library/' + path, 'utf8'));
      if (oldTexts && Array.isArray(data) && path !== 'data/catalog.json')
        data = data.filter(x => x.p).map(x => x.p.map(p => p[0]).join(' '));
      return {ok: true, json: async () => data};
    }
  });
  vm.runInContext(resolver, context);
  let paragraphs = 0;
  for (const ref of refs) {
    const result = await context.resolveLocal(ref);
    assert.ok(result.he.length, ref);
    assert.ok(result.he.every(x => typeof x === 'string'), ref);
    assert.ok(result.he.every(x => !x.includes('[object Object]')), ref);
    if (oldTexts) assert.equal(result.phrases, null, ref);
    else {
      assert.equal(result.phrases.length, result.he.length, ref);
      assert.ok(result.en.every(x => typeof x === 'string'), ref);
      assert.ok(result.en.some(x => x.trim()), ref);
    }
    paragraphs += result.he.length;
  }
  assert.equal(paragraphs, 171);
  console.log(`Reader passed: ${oldContents ? 'old' : 'current'} contents, ${oldTexts ? 'old' : 'current'} texts; ${paragraphs} paragraphs.`);
}
await reader(true, false);  // The installed-app failure from the screenshot.
await reader(false, true); // An offline pack saved before the new edition.
await reader(false, false);

// Canonical three-level Kometz addresses must still resolve in the new edition.
const kometzContext = vm.createContext({gematria: String, fetch: async url => ({
  ok: true, json: async () => JSON.parse(fs.readFileSync('dist/library/' + url.split('?')[0], 'utf8'))
})});
vm.runInContext(resolver, kometzContext);
let kometzParagraphs = 0;
for (const [volume, chapters] of [[1, 115], [2, 79]]) {
  for (let chapter = 1; chapter <= chapters; chapter++) {
    const result = await kometzContext.resolveLocal(`Kometz HaMinchah ${volume}:${chapter}`);
    assert.ok(result.he.length);
    assert.ok(result.he.every(x => typeof x === 'string' && !x.includes('[object Object]')));
    if (volume === 2 && chapter === 79) {
      assert.equal(result.he.length, 20);
      assert.ok(result.en.every(x => !x));
      assert.equal(result.tables[20][0].rows.length, 49);
    } else assert.ok(result.en.some(x => x.trim()));
    kometzParagraphs += result.he.length;
  }
}
assert.equal(kometzParagraphs, 214);
assert.equal((await kometzContext.resolveLocal('Kometz HaMinchah 1:115')).next, 'Kometz HaMinchah 2:1');
assert.equal((await kometzContext.resolveLocal('Kometz HaMinchah 2:79:20')).highlight, 'Kometz HaMinchah 2:79:20');
for (const [source, download] of [['Kometz_HaMincha_Part_1.docx', 'kometz-haminchah-part-1.docx'],
  ['Kometz_Hamincha_Part_2.docx', 'kometz-haminchah-part-2.docx']])
  assert.deepEqual(fs.readFileSync('sources/akiva/docx/' + source), fs.readFileSync('dist/library/downloads/' + download));
console.log('Kometz passed: 214 paragraphs, canonical navigation, 49 sources, exact Word downloads.');

const sw = fs.readFileSync('dist/library/sw.js', 'utf8');
const workerVersion = /const VERSION = '([^']+)'/.exec(sw)[1];
async function worker(upgrade) {
  const events = {}, deleted = [], navigated = [], requests = [];
  const scope = 'https://example.test/library/';
  const offlineResponse = {saved: true};
  const cache = {addAll: async files => {
    assert.ok(files.every(f => f.cache === 'reload'));
  }, put: async () => {}, match: async () => offlineResponse};
  const context = vm.createContext({URL, Request: class {
    constructor(url, opts) { this.url = new URL(url, scope).href; Object.assign(this, opts); }
  }, setTimeout: () => 0, fetch: async (request, options) => {
    requests.push(options);
    if (request.offline) throw Error('offline');
    return {ok: true, clone() { return this; }};
  }, caches: {open: async () => cache, keys: async () =>
    [upgrade ? 'rtl-shell-v8' : 'rtl-shell-' + workerVersion, 'rtl-data', 'rtl-pack-library', 'rtl-meta'],
    delete: async name => deleted.push(name)}, self: {
    registration: {scope}, skipWaiting: async () => {},
    addEventListener: (type, fn) => events[type] = fn,
    clients: {claim: async () => {}, matchAll: async () =>
      [scope + '#/read/Likkutei_Maamarim', 'https://example.test/other/'].map(url =>
        ({url, navigate: async next => navigated.push(next)}))}
  }});
  vm.runInContext(sw, context);
  for (const type of ['install', 'activate']) {
    let pending;
    events[type]({waitUntil(p) { pending = p; }});
    await pending;
  }
  assert.deepEqual(deleted, upgrade ? ['rtl-shell-v8'] : []);
  assert.deepEqual(navigated, upgrade ? [scope + '#/read/Likkutei_Maamarim'] : []);
  await context.networkFirst({}, 'rtl-data');
  assert.equal(requests[0].cache, 'no-cache');
  assert.equal(await context.networkFirst({offline: true}, 'rtl-data'), offlineResponse);
  console.log(`Worker passed: ${upgrade ? 'upgrade refresh' : 'first install'}; offline packs preserved.`);
}
await worker(true);
await worker(false);

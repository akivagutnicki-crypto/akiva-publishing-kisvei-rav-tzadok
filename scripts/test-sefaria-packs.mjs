import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../dist/library/sefaria-packs.js');
const { Zip, ZipDeflate, unzipSync } = require('../dist/library/vendor/fflate.min.js');
const snapshot = JSON.parse(gunzipSync(fs.readFileSync('sources/akiva/packs/catalog.json.gz')));
const expected = {
  tanakh: ['Genesis', 'Rashi on Genesis', 'Ramban on Genesis', 'Ibn Ezra on Genesis'],
  shas: ['Berakhot', 'Shabbat', 'Rashi on Berakhot', 'Tosafot on Berakhot'],
  yerushalmi: ['Jerusalem Talmud Berakhot', 'Penei Moshe on Jerusalem Talmud Berakhot', 'Korban HaEdah on Jerusalem Talmud Shabbat'],
  midrash: ['Bereshit Rabbah', 'Mekhilta DeRabbi Yishmael', 'Matnot Kehunah on Bereshit Rabbah', 'Etz Yosef on Bereishit Rabbah'],
};
for (const collection of core.COLLECTIONS) {
  const books = core.collectionBooks(snapshot.books, collection.id);
  for (const title of expected[collection.id]) assert.ok(books.some(b => b.title === title), `${collection.id}: ${title}`);
  const native = snapshot.books.filter(b => collection.path.every((part, i) => b.categories[i] === part));
  for (const book of native) assert.ok(books.some(b => b.title === book.title), 'Dropped available title: ' + book.title);
  assert.ok(books.some(b => b.dependence), 'Missing all commentaries');
  console.log(`${collection.id}: ${books.length} works, ${books.filter(b => b.dependence).length} meforshim/Targum; every catalog title retained.`);
}
const schema = { schema: { nodes: [
  { titles: [{ lang: 'en', primary: true, text: 'Introduction' }], depth: 1 },
  { default: true, depth: 2 },
  { titles: [{ lang: 'en', primary: true, text: 'Appendix' }], depth: 2 },
] } };
assert.deepEqual(core.leafRefs(schema, 'Complex Work'), ['Complex Work, Introduction', 'Complex Work', 'Complex Work, Appendix']);
assert.equal(core.validWholeText({ref: 'Genesis 1', sections: [1], he: ['preview']}, 'Genesis'), false);
const daf = { ref: 'Rashi on Berakhot', textDepth: 3, addressTypes: ['Talmud', 'Integer', 'Integer'],
  he: [[], [], [['first', 'second']], [['next amud']]], text: [[], [], [['one', 'two']], [['next']]] };
assert.equal(core.sliceText(daf, 'Rashi on Berakhot 2a:1:2').he, 'second');
assert.equal(core.sliceText(daf, 'Rashi on Berakhot 2a').next, 'Rashi on Berakhot 2b');
assert.deepEqual(core.sliceText(daf, 'Rashi on Berakhot 2a:1:1-2').he, ['first', 'second']);
assert.notEqual(core.archivePath('https://www.sefaria.org/api/texts/A%3AB'), core.archivePath('https://www.sefaria.org/api/texts/A_B'));

class SavedCache {
  values = new Map();
  async match(url) { const r = this.values.get(url); return r?.clone(); }
  async put(url, response) { this.values.set(url, response.clone()); }
}
const cache = new SavedCache();
const books = [{title: 'Base Work', categories: ['Tanakh'], dependence: ''},
  {title: 'Commentary Work', categories: ['Tanakh'], dependence: 'Commentary', base_text_titles: ['Base Work']},
  {title: 'Complex Work', categories: ['Tanakh'], dependence: 'Commentary', base_text_titles: ['Base Work']}];
const originals = new Map(), requests = [], checkpoints = [];
for (const book of books) {
  const index = book.title === 'Complex Work' ? schema : {schema: {depth: 2, addressTypes: ['Integer', 'Integer']}};
  originals.set(core.indexUrl(book.title), index);
  originals.set(core.shapeUrl(book.title), [{title: book.title, chapters: [2, 2]}]);
  for (const ref of core.leafRefs(index, book.title)) originals.set(core.wholeTextUrl(ref), {
    ref, sections: [], textDepth: 2, addressTypes: ['Integer', 'Integer'], he: [['הַתְחָלָה', 'אֶמְצַע'], ['סוֹף הַסֵּפֶר']],
    text: [['Beginning', 'Middle'], ['END OF THE COMPLETE WORK']], heLicense: 'Public Domain', license: 'CC-BY',
    heVersionTitle: 'Original', versionTitle: 'English', heVersionSource: 'source', versionSource: 'translation',
  });
}
// A cached preview must be rejected and fetched again as a complete work.
await cache.put(core.wholeTextUrl('Base Work'), new Response(JSON.stringify({ref: 'Base Work 1', sections: [1], he: ['preview']})));
const fetcher = async url => { requests.push(url); assert.ok(originals.has(url), url); return new Response(JSON.stringify(originals.get(url))); };
const manifest = await core.prepare({id: 'tanakh', books, cache, fetcher, checkpoint: async m => checkpoints.push(m)});
assert.equal(manifest.complete, true);
assert.equal(manifest.books.filter(b => b.dependence).length, 2);
assert.equal(manifest.books[2].nodes.length, 3);
assert.ok(requests.includes(core.wholeTextUrl('Base Work')));
requests.length = 0;
const resumed = await core.prepare({id: 'tanakh', books, cache, fetcher});
assert.equal(resumed.complete, true);
assert.equal(requests.length, 0, 'Resume redownloaded saved complete works');
await core.prepare({id: 'tanakh', books, cache, fetcher, refresh: true});
assert.ok(requests.includes(core.wholeTextUrl('Commentary Work')), 'Update did not refresh commentary text');
const aborted = new AbortController(); aborted.abort();
assert.equal((await core.prepare({id: 'tanakh', books, cache, fetcher, signal: aborted.signal})).complete, false);
const meta = new SavedCache();
await meta.put('packs/tanakh.json', new Response(JSON.stringify(manifest)));
globalThis.caches = {open: async name => name === 'rtl-meta' ? meta : cache};
const offline = await core.offlineJSON('/api/v3/texts/Commentary%20Work%202%3A1?version=source&version=translation');
assert.equal(offline.versions[0].text, 'סוֹף הַסֵּפֶר');
assert.equal(offline.versions[1].text, 'END OF THE COMPLETE WORK');
assert.equal(offline.versions[1].license, 'CC-BY');
delete globalThis.caches;

// Test the actual reader's ZIP builder against the cache, not a second exporter.
const html = fs.readFileSync('dist/library/index.html', 'utf8');
const zipper = html.slice(html.indexOf('function zipPathFor('), html.indexOf('async function zipPack('));
let blob, clicks = 0;
class DownloadURL extends URL {
  static createObjectURL(value) { blob = value; return 'blob:fixture'; }
  static revokeObjectURL() {}
}
const context = vm.createContext({window: {SefariaPacks: core}, location: {href: 'https://example.test/library/'},
  caches: {open: async () => cache}, loadFflate: async () => ({Zip, ZipDeflate}), URL: DownloadURL,
  TextEncoder, Uint8Array, Blob, Date, setTimeout: () => 0,
  document: {body: {appendChild() {}}, createElement: () => ({click() {clicks++;}, remove() {}})} });
vm.runInContext(zipper, context);
const status = {textContent: '', appendChild() {}};
await context.zipSaved([[manifest.cache, manifest.urls]], 'complete-fixture', status, {manifest});
assert.equal(clicks, 1);
const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
assert.ok(archive['README.txt']);
const zippedManifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']));
assert.equal(zippedManifest.complete, true);
for (const url of manifest.urls) {
  const file = core.archivePath(url);
  assert.ok(archive[file], file);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(archive[file])), originals.get(url), 'Truncated source or commentary: ' + file);
}
// Missing cached files and incomplete collections must never yield a ZIP labeled complete.
// Exercise the disk-backed writer branch used for large mobile archives.
const writes = []; let writerClosed = false;
const directory = {getDirectoryHandle: async () => directory, removeEntry: async () => {}, getFileHandle: async () => ({
  createWritable: async () => ({write: async bytes => writes.push(bytes), close: async () => {writerClosed = true;}, abort: async () => {}}),
  // Real OPFS File objects have no MIME type; the exporter must add it.
  getFile: async () => {assert.ok(writerClosed); return new Blob(writes);}
})};
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {storage: {getDirectory: async () => directory}}});
await context.zipSaved([[manifest.cache, manifest.urls]], 'disk-fixture', status, {manifest});
assert.ok(writerClosed && writes.length > 1);
assert.equal(blob.type, 'application/zip');
assert.ok(unzipSync(new Uint8Array(await blob.arrayBuffer()))['manifest.json']);
if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
else delete globalThis.navigator;
assert.equal(clicks, 2);
cache.values.delete(core.wholeTextUrl('Commentary Work'));
await assert.rejects(context.zipSaved([[manifest.cache, manifest.urls]], 'incomplete', status, {manifest}), /not saved/);
await assert.rejects(context.zipSaved([[manifest.cache, manifest.urls]], 'incomplete', status, {manifest: {...manifest, complete: false}}), /incomplete/);
assert.equal(clicks, 2);
console.log('PASS complete commentary ZIPs: all complex nodes, final passages, licenses, offline lookup, cache resume, Update, Stop, disk-backed ZIPs and rejection of incomplete archives.');

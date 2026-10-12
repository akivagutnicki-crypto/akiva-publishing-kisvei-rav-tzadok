// Reproduce a saved citation pack with missing files, as reported by the reader.
// Verify the reader's actual exporter produces a valid, honestly labeled archive.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../dist/library/sefaria-packs.js');
const {Zip, ZipDeflate, unzipSync} = require('../dist/library/vendor/fflate.min.js');
const html = fs.readFileSync('dist/library/index.html', 'utf8');
const exporter = html.slice(html.indexOf('function zipPathFor('), html.indexOf('async function exportZip('));
const sourceUrl = ref => `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}?version=source&version=translation`;
const original = ref => ({ref, sections: [1], versions: [
  {language: 'he', languageFamilyName: 'hebrew', direction: 'rtl', text: ['בְּרֵאשִׁית', 'סוֹף הַפָּסוּק'], license: 'Public Domain'},
  {language: 'en', direction: 'ltr', text: ['FIRST SOURCE TEXT', 'LAST SOURCE TEXT'], license: 'CC-BY', versionTitle: 'Source edition'},
]});
let currentCache, currentList, download, clicks = 0;
class DownloadURL extends URL {
  static createObjectURL(blob) {download = {blob}; return 'blob:source-zip-test';}
  static revokeObjectURL() {}
}
const context = vm.createContext({window: {SefariaPacks: core}, location: {href: 'https://example.test/library/'},
  caches: {open: async () => currentCache}, loadFflate: async () => ({Zip, ZipDeflate}), URL: DownloadURL,
  TextEncoder, TextDecoder, Uint8Array, Blob, Date,
  setTimeout: (callback, delay) => delay === 3600000 ? 0 : setTimeout(callback, delay),
  CORPUS_IDS: new Set(['tanakh', 'shas', 'yerushalmi', 'midrash']),
  PACKS: [{id: 'sources', title: 'Sources cited in the library'}], packList: async () => currentList,
  document: {body: {appendChild() {}}, createElement: () => ({click() {clicks++; download.filename = this.download;}, remove() {}})},
});
vm.runInContext(exporter, context);
vm.runInContext(html.slice(html.indexOf('async function saveUrls('), html.indexOf('// Each pack\'s file list')), context);
const status = {textContent: '', appendChild() {}};
const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));
const unpack = async () => unzipSync(new Uint8Array(await download.blob.arrayBuffer()));

const first = sourceUrl('Genesis 1:1'), last = sourceUrl('Psalms 150:6'), missing = sourceUrl('Berakhot 2a');
const files = new Map([[first, JSON.stringify(original('Genesis 1:1'))], [last, JSON.stringify(original('Psalms 150:6'))]]);
currentCache = {match: async url => files.has(url) ? new Response(files.get(url)) : undefined};
currentList = {cache: 'rtl-external', urls: [first, missing, last]};
const getButton = {disabled: false}, zipButton = {disabled: false, closest: () => ({querySelector: () => getButton})};
await context.zipPack('sources', zipButton, status);
let archive = await unpack(), manifest = decode(archive['manifest.json']);
assert.equal(download.blob.type, 'application/zip');
assert.match(download.filename, /^rav-tzadok-sources-partial-\d{4}-\d{2}-\d{2}\.zip$/);
assert.equal(manifest.complete, false);
assert.equal(manifest.expectedFiles, 3);
assert.equal(manifest.includedFiles, 2);
assert.equal(manifest.missing.length, 1);
assert.equal(manifest.missing[0].url, missing);
assert.equal(manifest.missing[0].ref, 'Berakhot 2a');
assert.ok(archive['missing-sources.txt']);
for (const url of [first, last]) assert.equal(new TextDecoder().decode(archive[core.archivePath(url)]), files.get(url), 'Source text or license changed');
assert.match(status.textContent, /2 saved files.*1 missing sources/);
assert.equal(getButton.disabled, false);
assert.equal(zipButton.disabled, false);

// Sefaria can return a JSON error with HTTP 200. List it as missing, not as text.
files.set(missing, JSON.stringify({error: 'Invalid source reference'}));
await context.zipPack('sources', zipButton, status);
archive = await unpack(); manifest = decode(archive['manifest.json']);
assert.equal(manifest.includedFiles, 2);
assert.equal(manifest.missing[0].reason, 'Invalid source reference');
assert.equal(archive[core.archivePath(missing)], undefined);
files.set(missing, JSON.stringify(original('Berakhot 2a')));
await context.zipPack('sources', zipButton, status);
archive = await unpack(); manifest = decode(archive['manifest.json']);
assert.equal(manifest.complete, true);
assert.equal(manifest.includedFiles, 3);
assert.equal(archive['missing-sources.txt'], undefined);
assert.match(download.filename, /^rav-tzadok-sources-\d{4}-\d{2}-\d{2}\.zip$/);

// Complete collection exports remain strict; the source-pack exception cannot
// accidentally publish an incomplete meforshim collection as complete.
files.delete(missing);
const beforeFailure = clicks;
await assert.rejects(context.zipSaved([[currentList.cache, currentList.urls]], 'complete-pack', status), /not saved/);
assert.equal(clicks, beforeFailure);
currentCache = {match: async () => undefined};
await context.zipPack('sources', zipButton, status);
assert.equal(clicks, beforeFailure);
assert.match(status.textContent, /Nothing is saved yet/);

// Retrying Download must replace a cached HTTP-200 error response, while
// reusing genuine saved texts and refusing to count new API errors as texts.
files.set(missing, JSON.stringify({error: 'Old unavailable response'}));
const unavailable = sourceUrl('Unavailable source'), fetched = [];
currentCache = {
  match: async url => files.has(url) ? new Response(files.get(url)) : undefined,
  put: async (url, response) => files.set(url, await response.text()),
};
context.fetch = async url => {
  fetched.push(url);
  return new Response(JSON.stringify(url === missing ? original('Berakhot 2a') : {error: 'Source unavailable'}));
};
const failed = await context.saveUrls([first, missing, unavailable], 'rtl-external', {validateSources: true, progress() {}});
assert.equal(failed, 1);
assert.deepEqual(new Set(fetched), new Set([missing, unavailable]));
assert.deepEqual(JSON.parse(files.get(missing)), original('Berakhot 2a'));
assert.equal(files.has(unavailable), false);

// Reproduce the exact counts from the user's screenshot. A few unavailable
// references must not block exporting thousands of successfully saved texts.
const total = 9026, saved = 8915;
const urls = Array.from({length: total}, (_, i) => sourceUrl('Saved source ' + (i + 1)));
currentCache = {match: async url => {
  const ref = decodeURIComponent(new URL(url).pathname.split('/').pop());
  return +ref.split(' ').pop() <= saved ? new Response(JSON.stringify(original(ref))) : undefined;
}};
currentList = {cache: 'rtl-external', urls};
await context.zipPack('sources', zipButton, status);
archive = await unpack(); manifest = decode(archive['manifest.json']);
assert.equal(manifest.expectedFiles, total);
assert.equal(manifest.includedFiles, saved);
assert.equal(manifest.missing.length, 111);
assert.equal(manifest.complete, false);
assert.equal(Object.keys(archive).filter(path => path.startsWith('sefaria/texts/')).length, saved);
assert.deepEqual(decode(archive[core.archivePath(urls[0])]), original('Saved source 1'));
assert.deepEqual(decode(archive[core.archivePath(urls[saved - 1])]), original('Saved source 8915'));
assert.ok(archive['missing-sources.txt']);
assert.equal(download.blob.type, 'application/zip');
if (process.argv.includes('--write-fixture')) fs.writeFileSync('/tmp/akiva-source-zip-regression.zip', new Uint8Array(await download.blob.arrayBuffer()));
console.log('PASS cited-source ZIPs: 8,915 saved texts exported with 111 missing sources listed; original text and licenses, proper ZIP MIME/name, invalid-response retry, complete exports, empty-cache handling and strict commentary coverage preserved.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('dist/library/index.html', 'utf8');
const editionDataUrl = vm.runInNewContext(/const editionDataUrl = ([^\n]+);/.exec(html)[1]);
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
      assert.equal(url, editionDataUrl(url.split('?')[0]));
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
      assert.ok(result.phrases, ref);
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
      assert.ok(result.en.every(x => x.trim()));
      assert.equal(result.tables[20][0].rows.length, 49);
    } else assert.ok(result.en.some(x => x.trim()));
    kometzParagraphs += result.he.length;
  }
}
assert.equal(kometzParagraphs, 214);
assert.equal((await kometzContext.resolveLocal('Kometz HaMinchah 1:115')).next, 'Kometz HaMinchah 2:1');
assert.equal((await kometzContext.resolveLocal('Kometz HaMinchah 2:79:20')).highlight, 'Kometz HaMinchah 2:79:20');
for (const [source, download] of [['Kometz_HaMincha_Part_1.docx', 'kometz-haminchah-part-1.docx'],
  ['Kometz_Part2_Complete.docx', 'kometz-haminchah-part-2.docx']])
  assert.deepEqual(fs.readFileSync('sources/akiva/docx/' + source), fs.readFileSync('dist/library/downloads/' + download));
console.log('Kometz passed: 214 translated paragraphs, canonical navigation, 49 sources, exact Word downloads.');

let resiseiParagraphs = 0, resiseiNotes = 0;
for (let siman = 1; siman <= 58; siman++) {
  const result = await kometzContext.resolveLocal(`Resisei Layla ${siman}`);
  assert.ok(result.he.length && result.en.some(x => x.trim()));
  assert.ok(result.he.every(x => typeof x === 'string' && !x.includes('[object Object]')));
  resiseiParagraphs += result.he.length;
  resiseiNotes += result.phrases.flat().reduce((n, pair) => n + pair.join('').split('class="footnote-marker"').length - 1, 0);
}
assert.equal(resiseiParagraphs, 149);
assert.equal(resiseiNotes, 1359);
assert.equal((await kometzContext.resolveLocal('Resisei Layla 58:7')).highlight, 'Resisei Layla 58:7');
assert.deepEqual(fs.readFileSync('sources/akiva/docx/Resisei_Layla_Interlinear.docx'),
  fs.readFileSync('dist/library/downloads/resisei-layla-interlinear.docx'));
console.log('Resisei passed: 58 simanim, 149 seifim, 1359 expandable footnotes, exact Word download.');

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

// Imported Markdown and parenthetical glosses must stay out of the Hebrew field.
let machParagraphs = 0, machPhrases = 0;
for (let chapter = 1; chapter <= 21; chapter++) {
  const result = await kometzContext.resolveLocal(`Machshavot Charutz ${chapter}`);
  assert.ok(result.phrases);
  result.phrases.forEach((phrases, i) => {
    if (!result.en[i].trim()) return; // The original title and publication notices.
    machParagraphs++; machPhrases += phrases.length;
    for (const [he, en] of phrases) {
      assert.ok(he.trim() && en.trim(), `Machshavot ${chapter}:${result.nums[i]}`);
      assert.ok(!/[A-Za-z]{3}/.test(he.replace(/<[^>]+>/g, '')), he);
      assert.ok(!/https?:\/\/|\]\(/.test(he + en), he);
    }
  });
}
assert.equal(machParagraphs, 203);
assert.equal(machPhrases, 8555);
const mach2 = await kometzContext.resolveLocal('Machshavot Charutz 2');
assert.equal(mach2.phrases[0][0][1], 'Faith is the primary service of man');
assert.ok(mach2.phrases[0].some(([he]) => he.includes('data-ref="Makkot 23b"')));
const yisrael4 = await kometzContext.resolveLocal('Yisrael Kedoshim 4:1');
assert.equal(yisrael4.phrases[0].length, 77);
assert.equal(yisrael4.highlight, 'Yisrael Kedoshim 4:1');
assert.equal(yisrael4.nums[1], 2);
assert.ok(yisrael4.en[0].includes('if Yehudah were alive'));
assert.ok(editionDataUrl('data/yisrael-kedoshim/0-4.json').endsWith('?edition=20261006-yisrael-4-opening'));
assert.ok(editionDataUrl('data/machshavot-charutz/0-2.json').endsWith('?edition=20261006-machshavot-format'));
console.log('Machshavot passed: 21 chapters, 203 translated paragraphs, 8555 phrase pairs, clean language fields and source links. Yisrael opening retained.');

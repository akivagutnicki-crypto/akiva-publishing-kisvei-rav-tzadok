import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('dist/library/index.html', 'utf8');
const resolver = html.slice(html.indexOf('let CATALOG = []'), html.indexOf('const CAT_COLORS'));
const ctx = vm.createContext({gematria: String, fetch: async url => ({ok: true,
  json: async () => JSON.parse(fs.readFileSync('dist/library/' + url.split('?')[0], 'utf8'))})});
vm.runInContext(resolver, ctx);
const src = JSON.parse(fs.readFileSync('sources/akiva/Tzidkat_HaTzadik.json', 'utf8'));
const canonical = JSON.parse(fs.readFileSync('sources/sefaria/Tzidkat_HaTzadik.json', 'utf8'));
const links = JSON.parse(fs.readFileSync('dist/library/data/tzidkat-hatzadik/links.json', 'utf8'));
const catalog = JSON.parse(fs.readFileSync('dist/library/data/catalog.json', 'utf8'));
assert.equal(catalog.filter(b => b.title === src.title).length, 1);
assert.equal(catalog.find(b => b.title === src.title).interlinear, true);
const linkFunctions = html.slice(html.indexOf('const slugify = t =>'), html.indexOf('async function loadLinkCounts'));
vm.runInContext(linkFunctions, ctx);
let paragraphs = 0, connections = 0;
for (let siman = 1; siman <= 264; siman++) {
  const ref = `Tzidkat HaTzadik ${siman}`;
  const d = await ctx.resolveLocal(ref);
  assert.ok(d.local && d.phrases && d.chapterLinks, ref);
  assert.equal(d.he.length, canonical.text[siman - 1].length, ref);
  assert.ok(d.en.every(t => t.trim()), ref);
  assert.ok(d.he.every(t => typeof t === 'string' && !t.includes('[object Object]')), ref);
  assert.equal(d.prev, siman > 1 ? `Tzidkat HaTzadik ${siman - 1}` : null);
  assert.equal(d.next, siman < 264 ? `Tzidkat HaTzadik ${siman + 1}` : null);
  assert.equal(d.title.en, src.sections[siman - 1].en);
  for (let n = 1; n <= d.he.length; n++) {
    assert.equal((await ctx.resolveLocal(`${ref}:${n}`)).highlight, `${ref}:${n}`);
    const own = await ctx.libraryLinks(d, `${ref}:${n}`, false);
    const expected = (links[ref] || []).filter(l => l.a === `${ref}:${n}`);
    for (const l of expected) assert.ok(own.some(o => o.sourceRef === l.r));
    connections += expected.length;
  }
  paragraphs += d.he.length;
}
assert.equal(paragraphs, 271);
assert.ok(connections >= src.importInfo.sefariaTargets);
assert.deepEqual(fs.readFileSync('sources/akiva/docx/Tzidkas_HaTzaddik_Complete.docx'),
  fs.readFileSync('dist/library/downloads/tzidkas-hatzaddik-complete.docx'));
const reverse = JSON.parse(fs.readFileSync('dist/library/data/cited/proverbs.json', 'utf8'));
assert.ok(reverse['Proverbs 10:6'].includes('Tzidkat HaTzadik 2:1'));
assert.ok(links['Tzidkat HaTzadik 242'].some(l => l.r === 'Zohar, Lech Lecha 26:286'));
assert.ok(links['Tzidkat HaTzadik 257'].some(l => l.r === 'Zohar, Sifra DiTzniuta 5:53'));
for (const chapter of Object.keys(links)) for (const l of links[chapter]) {
  assert.match(l.a, /^Tzidkat HaTzadik \d+:\d+$/);
  assert.ok(!/\.\d/.test(l.r), l.r);
  assert.ok(l.c && l.r.trim());
}
const worker = fs.readFileSync('dist/library/sw.js', 'utf8');
assert.ok(worker.includes('tzidkat-hatzadik'));
assert.ok(worker.includes("const DATA = 'rtl-data'"));
assert.ok(worker.includes("const EXTERNAL = 'rtl-external'"));
console.log(`Tzidkas passed: 264 Simanim, ${paragraphs} canonical paragraphs, ${connections} source connections, source headings, precise navigation, and exact Word download.`);

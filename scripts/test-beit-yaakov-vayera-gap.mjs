// Run after build-library.mjs, and again with --zips after the final ZIP build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readBeitYaakovDocuments } from './beit-yaakov-documents.mjs';
import { readBeitYaakovVayeraGap } from './beit-yaakov-vayera-gap.mjs';
import { categoryOf, normalizeRef } from './citations.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const library = path.join(root, 'dist/library');
const data = path.join(library, 'data');
const slug = 'beit-yaakov-on-torah';
const bookDir = path.join(data, slug);
const title = 'Beit Yaakov on Torah';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

// Captured from ../beit-reader-import/expected-publication.json for the passing
// 2891cf2 publication. Hash the 281 "id:sha256\n" records in numeric ID order.
// These constants keep the CI check independent of local scratch files.
const oldChaptersHash = '280996fb1b6505782bda7dcb5d048a3f91de857a23af31a0b792571db5159e74';
const oldLinksHash = '1ae97ae814ff21589efa35b2979b46e2a317e4bd768260ca5ef1df57fa6e1cbd';
const oldChapters = range(0, 280).map(id =>
  `${id}:${sha256(fs.readFileSync(path.join(bookDir, `${id}.json`)))}\n`).join('');
assert.equal(sha256(oldChapters), oldChaptersHash,
  'One of the 281 previously published chapter files changed');

const pack = readBeitYaakovVayeraGap();
assert.equal(pack.book, title);
assert.equal(pack.schemaVersion, 1);
assert.deepEqual(pack.sections.map(section => section.key), range(22, 26).map(n => `Vayera ${n}`));
const original = read('sources/akiva/Beit_Yaakov_on_Torah.json');
const oldKeys = [...original.sections, ...readBeitYaakovDocuments().sections].map(section => section.key);
assert.equal(oldKeys.length, 281, 'Published source prefix changed');
const expectedIds = new Map(oldKeys.map((key, id) => [`${title}, ${key}`, id]));
for (const n of range(22, 26)) expectedIds.set(`${title}, Vayera ${n}`, 281 + n - 22);

const { toc } = read(path.join(bookDir, 'toc.json'));
const leavesOf = node => node.children ? node.children.flatMap(leavesOf) : [node];
const leaves = leavesOf(toc);
assert.equal(leaves.length, 286);
const leafByRef = new Map(leaves.map(leaf => [leaf.ref, leaf]));
assert.equal(leafByRef.size, 286, 'Duplicate section reference in the TOC');
for (const leaf of leaves) assert.equal(leaf.id, expectedIds.get(leaf.ref), 'Stable ID changed: ' + leaf.ref);
assert.equal(new Set(leaves.map(leaf => leaf.id)).size, 286, 'Duplicate chapter ID in the TOC');
assert.deepEqual(fs.readdirSync(bookDir).filter(file => /^\d+\.json$/.test(file))
  .map(file => Number(file.slice(0, -5))).sort((a, b) => a - b), range(0, 285));
const vayera = toc.children[3];
assert.equal(vayera.en, 'Vayera · 63 Osiyos');
assert.deepEqual(vayera.children.map(leaf => leaf.ref), range(1, 63).map(n => `${title}, Vayera ${n}`),
  'Vayera must appear in numerical reading order without moving chapter IDs');
for (const n of range(21, 26)) {
  const position = leaves.findIndex(leaf => leaf.ref === `${title}, Vayera ${n}`);
  assert.equal(leaves[position + 1]?.ref, `${title}, Vayera ${n + 1}`,
    'Reader next-section sequence skips a supplied teaching');
}

const entities = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:'\u00a0',
  ndash:'–', mdash:'—', hellip:'…', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”',
  laquo:'«', raquo:'»', thinsp:'\u2009', ensp:'\u2002', emsp:'\u2003',
  lrm:'\u200e', rlm:'\u200f', zwnj:'\u200c', zwj:'\u200d', shy:'\u00ad' };
function decode(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, name) => {
    if (name[0] === '#') {
      const n = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 0x10ffff, 'Invalid entity: ' + entity);
      return String.fromCodePoint(n);
    }
    assert.ok(Object.hasOwn(entities, name), 'Unknown entity: ' + entity);
    return entities[name];
  });
}
const plain = value => decode(String(value).replace(/<[^>]*>/g, ''));
function anchors(html) {
  return [...String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].flatMap(match => {
    const target = /\bdata-ref\s*=\s*(["'])([\s\S]*?)\1/i.exec(match[1]);
    return target ? [{ref:normalizeRef(decode(target[2])), text:plain(match[2]),
      offset:plain(String(html).slice(0, match.index)).length}] : [];
  });
}
function noFootnotes(value) {
  if (Array.isArray(value)) return value.forEach(noFootnotes);
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assert.doesNotMatch(key, /^footnotes?$/i, 'Supplement acquired source-footnote metadata');
      noFootnotes(nested);
    }
  } else if (typeof value === 'string')
    assert.doesNotMatch(value, /<(?:a|span|sup)\b[^>]*(?:footnote|doc-noteref)/i,
      'Supplement acquired an embedded footnote');
}
const metadata = ({p, keepPairs, ...rest}) => rest;
const links = read(path.join(bookDir, 'links.json'));
const oldRefs = new Set(oldKeys.map(key => `${title}, ${key}`));
const oldLinks = Object.fromEntries(Object.entries(links).filter(([ref]) => oldRefs.has(ref)));
assert.equal(sha256(JSON.stringify(oldLinks)), oldLinksHash, 'Existing paragraph connections changed');
const reverseIndex = new Set(read(path.join(data, 'cited/index.json')));
const reverseCache = new Map();
function reverse(ref) {
  const sourceSlug = ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  assert.ok(reverseIndex.has(sourceSlug), 'Reverse citation index missing: ' + sourceSlug);
  if (!reverseCache.has(sourceSlug)) reverseCache.set(sourceSlug, read(path.join(data, 'cited', sourceSlug + '.json')));
  return reverseCache.get(sourceSlug)[ref] || [];
}

let paragraphs = 0, pairs = 0, inlineHeadings = 0, suppliedAnchors = 0;
const expectedPairCounts = [147, 61, 63, 44, 133];
for (const [sectionIndex, section] of pack.sections.entries()) {
  const ref = `${title}, ${section.key}`;
  const leaf = leafByRef.get(ref);
  assert.equal(leaf.id, 281 + sectionIndex);
  assert.equal(leaf.en, section.en);
  assert.equal(leaf.he, section.he);
  assert.equal(leaf.sep, ':');
  assert.equal(leaf.interlinear, true);
  assert.equal(leaf.depth, 1);
  assert.equal(leaf.downloadDocx, undefined, 'Original Word file does not contain the supplied gap text');
  const items = read(path.join(bookDir, leaf.id + '.json'));
  noFootnotes(items);
  assert.equal(items.length, section.items.length, 'Item boundaries changed: ' + ref);
  const indexed = new Set((links[ref] || []).map(link => `${link.a}\0${link.r}`));
  assert.equal(indexed.size, (links[ref] || []).length, 'Duplicate paragraph source connection: ' + ref);
  const expectedLinks = new Set();
  let sectionParagraphs = 0, sectionPairs = 0;
  for (const [itemIndex, originalItem] of section.items.entries()) {
    const item = items[itemIndex];
    assert.deepEqual(metadata(item), metadata(originalItem), 'Heading or paragraph metadata changed: ' + ref);
    assert.equal(Object.hasOwn(item, 'p'), Object.hasOwn(originalItem, 'p'));
    if (!originalItem.p) continue;
    sectionParagraphs++; paragraphs++;
    assert.equal(item.n, 1);
    assert.equal(item.keepPairs, true);
    assert.equal(item.p.length, originalItem.p.length, 'Phrase boundaries changed: ' + ref);
    for (const heading of originalItem.inlineHeadings || []) {
      assert.ok(Number.isInteger(heading.phraseIndex) && heading.phraseIndex >= 0 && heading.phraseIndex < item.p.length);
      inlineHeadings++;
    }
    for (const [phraseIndex, originalPair] of originalItem.p.entries()) {
      const pair = item.p[phraseIndex];
      assert.equal(pair.length, 2);
      for (const language of [0, 1]) {
        assert.equal(plain(pair[language]), plain(originalPair[language]),
          `Supplied text changed: ${ref}, phrase ${phraseIndex + 1}, language ${language}`);
        const published = anchors(pair[language]);
        for (const anchor of anchors(originalPair[language])) {
          assert.ok(published.some(candidate => candidate.ref === anchor.ref &&
            candidate.text === anchor.text && candidate.offset === anchor.offset), 'Supplied source anchor changed: ' + ref);
          suppliedAnchors++;
        }
        for (const anchor of published) expectedLinks.add(`${ref}:1\0${anchor.ref}`);
      }
      assert.match(plain(pair[0]), /[א-ת]/);
      assert.match(plain(pair[1]), /[A-Za-z]/);
      assert.doesNotMatch(plain(pair[1]), /^\s*\[/, 'Outer English brackets returned');
      pairs++; sectionPairs++;
    }
    for (const connection of originalItem.connections || [])
      expectedLinks.add(`${ref}:1\0${normalizeRef(connection.ref)}`);
  }
  assert.equal(sectionParagraphs, 1, 'Original source paragraph split or omitted: ' + ref);
  assert.equal(leaf.shape, sectionParagraphs);
  assert.equal(sectionPairs, expectedPairCounts[sectionIndex]);
  assert.ok(expectedLinks.size > 0, 'No linked sources for supplied section: ' + ref);
  for (const expected of expectedLinks) assert.ok(indexed.has(expected), 'Missing paragraph connection: ' + expected);
  for (const link of links[ref] || []) {
    assert.equal(link.a, `${ref}:1`);
    assert.equal(link.c, categoryOf(link.r));
    assert.ok(reverse(link.r).includes(link.a), 'Reverse citation missing: ' + link.r);
  }
}
assert.equal(paragraphs, 5);
assert.equal(pairs, 448);
assert.ok(suppliedAnchors > 0, 'Supplied verified source anchors were not preserved');
const book = read(path.join(data, 'catalog.json')).find(book => book.slug === slug);
assert.equal(book.segments, leaves.reduce((sum, leaf) => sum + leaf.shape, 0));

if (process.argv.includes('--zips')) {
  const manifest = read(path.join(library, 'downloads/index.json'));
  const { unzipSync } = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
  for (const entry of [manifest.library, manifest.books.find(book => book.slug === slug)]) {
    assert.ok(entry, 'Published Beit Yaakov ZIP missing');
    const contents = unzipSync(fs.readFileSync(path.join(library, entry.file)));
    for (const chapter of ['toc', 'links', ...range(281, 285)]) {
      const file = `data/${slug}/${chapter}.json`;
      assert.ok(contents[file], 'Supplement omitted from ZIP: ' + file);
      assert.equal(sha256(contents[file]), sha256(fs.readFileSync(path.join(library, file))), 'Stale ZIP text: ' + file);
    }
  }
  console.log('PASS Vayera 22–26 included byte for byte in both final library and sefer ZIPs');
}
console.log(`PASS Vayera 22–26: all 281 old chapter files unchanged; new IDs 281–285, 5 exact paragraphs, 448 exact pairs, ${inlineHeadings} inline headings, ${suppliedAnchors} preserved source anchors, bidirectional connections, and numerical reading order 1–63`);

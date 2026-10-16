// Run after build-library.mjs; add --zips after build-library-zips.mjs.
// The supplied document pack is the authority for every new phrase and heading.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readBeitYaakovDocuments } from './beit-yaakov-documents.mjs';
import { normalizeRef, categoryOf } from './citations.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// The adapter reads source paths relative to the repository root.
process.chdir(root);
const library = path.join(root, 'dist/library');
const data = path.join(library, 'data');
const slug = 'beit-yaakov-on-torah';
const bookDir = path.join(data, slug);
const bookTitle = 'Beit Yaakov on Torah';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

// Captured from the original canonical source and an exact HEAD-builder run
// before the document import. The chapter digest hashes "id:sha256\n" for 0–182.
const originalSourceHash = '70580367fdc0f7c6b73c1f73839357a6244c68f6bf42e420022a208501e8bb89';
const originalChaptersHash = '5c7b0056d34fdd4d2e53a4f376eed54d3e75e657b1fcd226193a5eef5e59509a';
const sourcePath = path.join(root, 'sources/akiva/Beit_Yaakov_on_Torah.json');
assert.equal(sha256(fs.readFileSync(sourcePath)), originalSourceHash,
  'The canonical 183-section source must remain byte-for-byte unchanged');
assert.equal(read(sourcePath).sections.length, 183);
const baseline = range(0, 182).map(id => `${id}:${sha256(fs.readFileSync(path.join(bookDir, `${id}.json`)))}\n`).join('');
assert.equal(sha256(baseline), originalChaptersHash,
  'An original generated chapter (0–182) changed from the pre-import HEAD build');

// Decode once, after removing markup; preserve all source whitespace and nikkud.
const namedEntities = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003',
  lrm: '\u200e', rlm: '\u200f', zwnj: '\u200c', zwj: '\u200d', shy: '\u00ad',
};
function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, name) => {
    if (name[0] === '#') {
      const n = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 0x10ffff, `Invalid entity ${entity}`);
      return String.fromCodePoint(n);
    }
    assert.ok(Object.hasOwn(namedEntities, name), `Unsupported named entity ${entity}`);
    return namedEntities[name];
  });
}
const plain = value => decodeEntities(String(value).replace(/<[^>]*>/g, ''));
function anchors(html) {
  const result = [];
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const ref = /\bdata-ref\s*=\s*(["'])([\s\S]*?)\1/i.exec(match[1]);
    if (!ref) continue;
    result.push({ ref: normalizeRef(decodeEntities(ref[2])), text: plain(match[2]),
      offset: plain(String(html).slice(0, match.index)).length });
  }
  return result;
}
function noFootnotes(value, context) {
  if (Array.isArray(value)) return value.forEach(item => noFootnotes(item, context));
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assert.ok(!/^footnotes?$/i.test(key), `Unexpected footnote metadata in ${context}`);
      noFootnotes(item, context);
    }
  } else if (typeof value === 'string') {
    assert.doesNotMatch(value, /<(?:a|span|sup)\b[^>]*(?:footnote|doc-noteref)/i,
      `Unexpected embedded footnote in ${context}`);
  }
}

const pack = readBeitYaakovDocuments();
assert.equal(pack.book, bookTitle);
assert.equal(pack.schemaVersion, 1);
const groups = [
  { node: 'Bereshit', label: 'Bereishit', numbers: range(1, 77), first: 0 },
  { node: 'Noach', label: 'Noach', numbers: range(1, 55), first: 77 },
  { node: 'Lech Lecha', label: 'Lech Lecha', numbers: [...range(1, 24), ...range(31, 57)], first: 132 },
  { node: 'Vayera', label: 'Vayera', numbers: range(1, 63),
    ids: [...range(183, 203), ...range(281, 285), ...range(204, 240)] },
  { node: 'Chayei Sara', label: 'Chayei Sarah', numbers: range(1, 40), first: 241 },
];
// The original DOCX pack remains frozen; the five supplied gap sections are
// separately appended files and only appear between these leaves in the TOC.
const expectedKeys = [
  ...[...range(1, 21), ...range(27, 63)].map(n => `Vayera ${n}`),
  ...range(1, 40).map(n => `Chayei Sara ${n}`),
];
assert.deepEqual(pack.sections.map(section => section.key), expectedKeys,
  'The 98 supplied sections must retain original numbers and order');
const catalog = read(path.join(data, 'catalog.json'));
const book = catalog.find(entry => entry.title === bookTitle);
assert.ok(book?.akiva && book.interlinear && book.slug === slug, 'Bilingual catalog metadata missing');
const { toc, version } = read(path.join(bookDir, 'toc.json'));
assert.deepEqual(book.version, version, 'Catalog and TOC version metadata differ');
assert.equal(toc.children.length, 5, 'Expected exactly five parashah groups');
const leaves = [];
for (const [index, group] of groups.entries()) {
  const published = toc.children[index];
  assert.equal(published.children.length, group.numbers.length, `${group.node} TOC count changed`);
  assert.equal(published.en, `${group.label} · ${group.numbers.length} Osiyos`, 'TOC group title/count changed');
  for (const [offset, number] of group.numbers.entries()) {
    const leaf = published.children[offset];
    assert.equal(leaf.id, group.ids ? group.ids[offset] : group.first + offset,
      `Stable reader ID changed in ${group.node}`);
    assert.equal(leaf.ref, `${bookTitle}, ${group.node} ${number}`, 'Canonical section numbering changed');
    assert.equal(leaf.interlinear, true);
    assert.equal(leaf.depth, 1);
    leaves.push(leaf);
  }
}
assert.equal(leaves.length, 286);
const leafByRef = new Map(leaves.map(leaf => [leaf.ref, leaf]));
assert.equal(leafByRef.size, leaves.length, 'Duplicate reader section reference');
assert.deepEqual(fs.readdirSync(bookDir).filter(file => /^\d+\.json$/.test(file)).map(file => Number(file.slice(0, -5))).sort((a, b) => a - b),
  range(0, 285), 'Generated chapter files must be exactly IDs 0–285');

const links = read(path.join(bookDir, 'links.json'));
const reverseIndex = new Set(read(path.join(data, 'cited/index.json')));
const reverseCache = new Map();
const citedSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function reverse(ref) {
  const target = citedSlug(ref);
  assert.ok(reverseIndex.has(target), `Reverse citation index missing ${target}`);
  if (!reverseCache.has(target)) reverseCache.set(target, read(path.join(data, 'cited', `${target}.json`)));
  return reverseCache.get(target)[ref] || [];
}

let paragraphs = 0, pairs = 0, sourceAnchors = 0, headings = 0, connections = 0;
for (const section of pack.sections) {
  const leaf = leafByRef.get(`${bookTitle}, ${section.key}`);
  assert.ok(leaf, 'Original supplied document section missing: ' + section.key);
  assert.equal(leaf.en, section.en, `Main title changed: ${section.key}`);
  assert.equal(leaf.he, section.he, `Hebrew label changed: ${section.key}`);
  assert.equal(leaf.sep, ':', `Paragraph reference separator changed: ${section.key}`);
  if (section.sourceUrl) assert.equal(leaf.sourceUrl, section.sourceUrl);
  if (section.downloadDocx) assert.equal(leaf.downloadDocx, section.downloadDocx);
  const items = read(path.join(bookDir, `${leaf.id}.json`));
  noFootnotes(items, leaf.ref);
  assert.equal(items.length, section.items.length, `Item/heading boundaries changed: ${section.key}`);
  let sectionParagraphs = 0;
  const expectedLinks = new Set();
  for (const [itemIndex, original] of section.items.entries()) {
    const actual = items[itemIndex];
    const context = `${section.key}, item ${itemIndex + 1}`;
    const metadata = ({ p, keepPairs, ...rest }) => rest;
    assert.deepEqual(metadata(actual), metadata(original), `Item metadata or boundaries changed: ${context}`);
    assert.equal(Object.hasOwn(actual, 'p'), Object.hasOwn(original, 'p'), `Paragraph boundary changed: ${context}`);
    assert.equal(actual.h, original.h, `Heading text or boundary changed: ${context}`);
    assert.deepEqual(actual.inlineHeadings, original.inlineHeadings, `Inline heading text/phrase boundary changed: ${context}`);
    headings += (original.h ? 1 : 0) + (original.inlineHeadings?.length || 0);
    if (!original.p) continue;
    paragraphs++;
    sectionParagraphs++;
    assert.equal(actual.n, original.n, `Paragraph numbering changed: ${context}`);
    assert.equal(actual.p.length, original.p.length, `Phrase boundary changed: ${context}`);
    assert.deepEqual(actual.connections, original.connections, `Supplied connection metadata changed: ${context}`);
    const paragraphRef = `${leaf.ref}:${original.n}`;
    for (const [phraseIndex, originalPair] of original.p.entries()) {
      const actualPair = actual.p[phraseIndex];
      assert.equal(actualPair.length, 2, `Invalid pair: ${context}, phrase ${phraseIndex + 1}`);
      for (const language of [0, 1]) {
        const where = `${context}, phrase ${phraseIndex + 1}, ${language === 0 ? 'Hebrew' : 'English'}`;
        assert.equal(plain(actualPair[language]), plain(originalPair[language]), `Document text changed: ${where}`);
        const publishedAnchors = anchors(actualPair[language]);
        for (const anchor of anchors(originalPair[language])) {
          const index = publishedAnchors.findIndex(candidate => candidate.ref === anchor.ref &&
            candidate.text === anchor.text && candidate.offset === anchor.offset);
          assert.ok(index >= 0, `Supplied citation anchor changed: ${where}: ${anchor.ref}`);
          publishedAnchors.splice(index, 1);
          sourceAnchors++;
        }
        for (const anchor of anchors(actualPair[language])) expectedLinks.add(`${paragraphRef}\0${anchor.ref}`);
      }
      assert.ok(!/^\s*\[/.test(plain(actualPair[1])), `English brackets returned: ${context}`);
      pairs++;
    }
    for (const connection of original.connections || []) {
      expectedLinks.add(`${paragraphRef}\0${normalizeRef(connection.ref)}`);
      connections++;
    }
  }
  assert.equal(leaf.shape, sectionParagraphs, `TOC paragraph shape changed: ${section.key}`);
  const actualLinks = links[leaf.ref] || [];
  const indexed = new Set(actualLinks.map(link => `${link.a}\0${link.r}`));
  for (const expected of expectedLinks) assert.ok(indexed.has(expected), `Source missing from links.json: ${expected.replace('\0', ' → ')}`);
  for (const link of actualLinks) {
    assert.ok(new RegExp(`^${leaf.ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+$`).test(link.a),
      `Connection has an invalid paragraph anchor: ${link.a}`);
    const number = Number(link.a.slice(link.a.lastIndexOf(':') + 1));
    assert.ok(number >= 1 && number <= sectionParagraphs, `Connection points outside section: ${link.a}`);
    assert.equal(link.c, categoryOf(link.r), `Connection category changed: ${link.r}`);
    assert.ok(reverse(link.r).includes(link.a), `Reverse citation missing: ${link.a} → ${link.r}`);
  }
}
assert.equal(paragraphs, 397, 'Supplied original paragraph count changed');
assert.equal(pairs, 4669, 'Supplied Hebrew-English phrase count changed');
assert.ok(headings > 0 && sourceAnchors > 0 && connections > 0, 'Document headings or source metadata absent');
const totalParagraphs = leaves.reduce((sum, leaf) => sum + leaf.shape, 0);
assert.equal(book.segments, totalParagraphs, 'Catalog paragraph count differs from the TOC');

const { unzipSync } = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
assert.equal(pack.documents.length, 2);
assert.equal(book.downloads?.length, 2, 'Catalog must list both supplied documents exactly once');
for (const document of pack.documents) {
  const metadata = book.downloads?.find(download => download.file === document.file);
  assert.deepEqual(metadata, { file: document.file, label: document.label }, `Catalog DOCX metadata changed: ${document.file}`);
  const bytes = fs.readFileSync(path.join(library, document.file));
  assert.equal(sha256(Buffer.from(document.base64, 'base64')), document.sha256, `Source DOCX hash mismatch: ${document.file}`);
  assert.equal(sha256(bytes), document.sha256, `Published DOCX differs from supplied document: ${document.file}`);
  const contents = unzipSync(bytes);
  assert.ok(contents['[Content_Types].xml'] && contents['word/document.xml'], `Invalid DOCX: ${document.file}`);
  assert.doesNotMatch(new TextDecoder().decode(contents['word/document.xml']), /<w:footnoteReference\b/,
    `Embedded source footnotes found in ${document.file}`);
}

if (process.argv.includes('--zips')) {
  const manifest = read(path.join(library, 'downloads/index.json'));
  const single = manifest.books.find(entry => entry.slug === slug);
  assert.ok(single, 'Beit Yaakov download ZIP missing from manifest');
  for (const entry of [manifest.library, single]) {
    const contents = unzipSync(fs.readFileSync(path.join(library, entry.file)));
    for (const document of pack.documents) {
      assert.ok(contents[document.file], `${entry.file} omits ${document.file}`);
      assert.equal(sha256(contents[document.file]), document.sha256, `${entry.file} has a stale DOCX`);
    }
    for (const chapter of ['toc', 'links', ...leaves.map(leaf => leaf.id)]) {
      const file = `data/${slug}/${chapter}.json`;
      assert.ok(contents[file], `${entry.file} omits ${file}`);
      assert.equal(sha256(contents[file]), sha256(fs.readFileSync(path.join(library, file))), `${entry.file} has stale reader text: ${file}`);
    }
  }
  console.log('PASS Beit Yaakov ZIPs: both supplied DOCX files and all 286 reader chapters included byte for byte');
}
console.log(`PASS Beit Yaakov documents: original 183 chapters unchanged; TOC 77/55/51/63/40; 98 original document sections, ${paragraphs} original paragraphs, ${pairs} exact phrase pairs, ${headings} exact headings, ${sourceAnchors} preserved source anchors, ${connections} paragraph connections, reverse citations, two exact DOCX downloads`);

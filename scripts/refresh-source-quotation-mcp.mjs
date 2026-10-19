#!/usr/bin/env node
// Refresh only the final MCP citations from the source-quotation edition.
// Historical reader link files and all library/data preimages stay unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const options = process.argv.slice(2);
const option = (name, fallback) => {
  const index = options.indexOf(name);
  return index < 0 ? fallback : options[index + 1];
};
for (let index = 0; index < options.length; index += 2) {
  assert(['--root', '--mcp-root', '--payload'].includes(options[index]) && options[index + 1], 'Unknown or incomplete option');
}
const root = path.resolve(option('--root', 'dist/library'));
const out = path.resolve(option('--mcp-root', 'dist/mcp-data'));
const payloadPath = path.resolve(option('--payload', 'sources/akiva/overlays/source-quotations-20261019.json.gz'));
const sha = value => createHash('sha256').update(value).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const serial = value => JSON.stringify(value);
const RELEASE = '20261019-source-quotations';
const report = read(path.join(root, 'supplied-source-footnotes-report.json'));
const compressed = fs.readFileSync(payloadPath);
const payload = JSON.parse(gunzipSync(compressed));
assert.equal(report.release, RELEASE);
assert.equal(payload.release, RELEASE);
assert.equal(sha(compressed), report.payloadSha256, 'MCP citations must come from the published immutable payload');
assert.deepEqual([...payload.books].sort(), Object.keys(report.books).sort());
assert(payload.books.every(book => !payload.excludedBooks.includes(book)), 'An excluded book entered the MCP refresh');

const catalogFile = path.join(out, 'catalog.json');
const catalog = read(catalogFile);
const manifest = read(path.join(root, 'data/files.json'));
assert.equal(catalog.version, manifest.version, 'Rebuild the MCP index after rebuilding final downloads');
const citedFile = path.join(out, 'cited.json');
const cited = read(citedFile);
const excludedBookTextSha256 = Object.fromEntries(payload.excludedBooks.map(slug =>
  [slug, sha(fs.readFileSync(path.join(out, 'text', slug + '.json')))]));
const beforeBlocks = new Map();
for (const entry of payload.files) {
  assert.equal(sha(fs.readFileSync(path.join(root, entry.path))), entry.afterSha256, 'MCP refresh received a different source chapter');
  for (const block of entry.blocks) beforeBlocks.set(entry.path + '\0' + block.path.join('/'), block.before);
}

const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ', zwnj: '\u200c', zwj: '\u200d', lrm: '', rlm: ''};
const plain = value => String(value ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? match;
    const hex = /x/i.test(entity[1]);
    const codepoint = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(codepoint) ? String.fromCodePoint(codepoint) : match;
  }).replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const leaves = node => node.children ? node.children.flatMap(leaves) : [node];
const sections = leaf => {
  if (leaf.depth === 1) return leaf.shape > 0 ? [[]] : [];
  const walk = (shape, prefix = []) => shape.flatMap((value, index) => Array.isArray(value)
    ? walk(value, [...prefix, index + 1]) : value ? [[...prefix, index + 1]] : []);
  return walk(leaf.shape);
};
const sourceRefs = notes => new Set(notes.flatMap(note => (note.sources || []).map(source => source.ref)).filter(Boolean));
const affected = new Map();
const removals = new Map();
const additions = new Map();
const addPair = (map, source, owner) => {
  if (!map.has(source)) map.set(source, new Set());
  map.get(source).add(owner);
};
const audit = {schemaVersion: 1, release: RELEASE, payloadSha256: report.payloadSha256,
  dataVersion: manifest.version, sourceNotesVerified: 0, sourceCitationsVerified: 0, books: {}, excludedBookTextSha256};

for (const slug of payload.books) {
  const filename = path.join(out, 'text', slug + '.json');
  const document = read(filename);
  const book = catalog.books.find(book => book.slug === slug);
  assert(book && document.slug === slug, 'The final MCP index omits a supplied book: ' + slug);
  const toc = read(path.join(root, 'data', slug, 'toc.json'));
  const paragraphsBySection = new Map();
  for (const paragraph of document.paras) {
    const section = book.sections[paragraph.s];
    if (!section?.il || !paragraph.p) continue;
    const key = section.ref + '\0' + paragraph.n;
    if (!paragraphsBySection.has(key)) paragraphsBySection.set(key, []);
    paragraphsBySection.get(key).push(paragraph);
  }
  const stats = {sourceNotes: 0, sourceCitations: 0, paragraphs: 0};
  const seenOwners = new Set();
  const chapters = new Map();
  for (const leaf of leaves(toc.toc)) for (const address of sections(leaf)) {
    const sectionRef = address.length ? leaf.ref + ' ' + address.join(':') : leaf.ref;
    const name = leaf.id + (leaf.depth === 1 ? '' : '-' + address[0]) + '.json';
    const relative = 'data/' + slug + '/' + name;
    if (!chapters.has(relative)) chapters.set(relative, read(path.join(root, relative)));
    let items = chapters.get(relative);
    for (const index of address.slice(1)) items = items[index - 1];
    if (!Array.isArray(items)) continue;
    let paragraphIndex = 0;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item || !Array.isArray(item.p)) continue;
      paragraphIndex++;
      if (!item.footnotes?.length) continue;
      const blockPath = [...address.slice(1).map(index => index - 1), index];
      const ownerKey = relative + '\0' + blockPath.join('/');
      // The same data leaf may have aliases in the contents; index each owner once.
      if (seenOwners.has(ownerKey)) continue;
      seenOwners.add(ownerKey);
      const number = item.n || paragraphIndex;
      const expectedPairs = item.p.map(pair => pair.map(plain));
      const candidates = paragraphsBySection.get(sectionRef + '\0' + number) || [];
      const matching = candidates.filter(paragraph => serial(paragraph.p) === serial(expectedPairs));
      assert.equal(matching.length, 1, 'Cannot identify exact MCP source paragraph: ' + relative + ' ' + sectionRef + ':' + number);
      const paragraph = matching[0];
      const notes = item.footnotes;
      for (const note of notes) {
        const text = note.paragraphs.map(value => plain(value.text ?? value)).filter(Boolean).join('\n');
        assert(paragraph.f?.some(entry => entry[0] === String(note.number) && entry[1] === text),
          'Final MCP source quotation differs from its reader note: ' + relative + ' ' + note.placementId);
      }
      const currentRefs = sourceRefs(notes);
      const previousRefs = sourceRefs(beforeBlocks.get(ownerKey) || notes);
      const inlineRefs = new Set(Object.entries(paragraph.a || {}).filter(([, place]) => place[0] !== 'n').map(([ref]) => ref));
      const literalBody = item.p.flatMap(pair => pair.map(plain)).join(' ').toLowerCase();
      for (const ref of previousRefs) if (literalBody.includes(ref.toLowerCase())) inlineRefs.add(ref);
      // Remove a replaced note reference only when neither an inline body anchor
      // nor another surviving note in this exact paragraph still cites it.
      const obsolete = new Set([...previousRefs].filter(ref => !currentRefs.has(ref) && !inlineRefs.has(ref)));
      paragraph.c = (paragraph.c || []).filter(([ref]) => !obsolete.has(ref));
      for (const ref of obsolete) addPair(removals, ref, paragraph.r);
      for (const note of notes) for (const source of note.sources || []) {
        if (!paragraph.c.some(([ref]) => ref === source.ref)) paragraph.c.push([source.ref, '']);
        paragraph.a ||= {};
        if (!paragraph.a[source.ref]) paragraph.a[source.ref] = ['n', String(note.number)];
        addPair(additions, source.ref, paragraph.r);
        stats.sourceCitations++;
      }
      for (const ref of obsolete) if (paragraph.a?.[ref]?.[0] === 'n') delete paragraph.a[ref];
      stats.sourceNotes += notes.length;
      stats.paragraphs++;
    }
  }
  assert.equal(stats.sourceNotes, report.books[slug].notesAfter, 'Final MCP source-note coverage is incomplete: ' + slug);
  affected.set(slug, {filename, document});
  audit.sourceNotesVerified += stats.sourceNotes;
  audit.sourceCitationsVerified += stats.sourceCitations;
  audit.books[slug] = stats;
}

// A second edition can share a paragraph ref with the interlinear edition.
// Retain the reverse connection if any surviving paragraph still cites it.
const retained = new Map();
for (const book of catalog.books) {
  const document = affected.get(book.slug)?.document || read(path.join(out, 'text', book.slug + '.json'));
  for (const paragraph of document.paras) for (const [ref] of paragraph.c || []) addPair(retained, ref, paragraph.r);
}
let removedPairs = 0;
for (const [source, owners] of removals) {
  if (!cited[source]) continue;
  cited[source] = cited[source].filter(owner => {
    const remove = owners.has(owner) && !retained.get(source)?.has(owner);
    if (remove) removedPairs++;
    return !remove;
  });
  if (!cited[source].length) delete cited[source];
}
for (const [source, owners] of additions) {
  cited[source] ||= [];
  for (const owner of owners) if (!cited[source].includes(owner)) cited[source].push(owner);
}
for (const [source, owners] of additions) for (const owner of owners)
  assert(cited[source].includes(owner) && retained.get(source)?.has(owner), 'Final forward/reverse source citation mismatch');
for (const [source, owners] of removals) for (const owner of owners)
  assert(retained.get(source)?.has(owner) || !cited[source]?.includes(owner), 'Obsolete note-only reverse citation remains');

for (const [slug, {filename, document}] of affected) {
  const contents = serial(document);
  fs.writeFileSync(filename, contents);
  audit.books[slug].textSha256 = sha(contents);
}
for (const [slug, digest] of Object.entries(excludedBookTextSha256))
  assert.equal(sha(fs.readFileSync(path.join(out, 'text', slug + '.json'))), digest, 'An excluded MCP book was changed');
fs.writeFileSync(citedFile, serial(cited));
audit.removedUnsupportedReverseCitations = removedPairs;
audit.citedSha256 = sha(fs.readFileSync(citedFile));
audit.catalogSha256 = sha(fs.readFileSync(catalogFile));
audit.assertions = {completeFinalSourceNotes: true, forwardAndReverseSourcesAgree: true,
  inlineBodyCitationsRetained: true, unrelatedConnectionsRetained: true, excludedBookTextsUnchanged: true};
fs.writeFileSync(path.join(out, 'source-quotations.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({ok: true, release: RELEASE, books: affected.size,
  sourceNotesVerified: audit.sourceNotesVerified, sourceCitationsVerified: audit.sourceCitationsVerified,
  removedUnsupportedReverseCitations: removedPairs}));

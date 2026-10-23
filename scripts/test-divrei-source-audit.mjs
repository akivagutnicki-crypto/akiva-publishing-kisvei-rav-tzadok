// Independent publication checks for every reviewed Divrei source note.
// The sealed pack records the reviewed content; these checks also verify the
// reader schema, source graph, popup extraction, and generated exports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {RELEASE, REPORT, readPack, sha, bodyDigest, plain} from './publish-divrei-source-audit.mjs';

const args = process.argv.slice(2);
const valueOptions = new Set(['--root', '--url', '--pack', '--mcp-root']);
const flags = new Set(['--mcp', '--zips']);
const options = {};
for (let i = 0; i < args.length; i++) {
  const argument = args[i];
  if (valueOptions.has(argument)) {
    assert(args[i + 1] && !args[i + 1].startsWith('--'), 'Missing value for ' + argument);
    options[argument] = args[++i];
  } else assert(flags.has(argument), 'Unknown option: ' + argument);
}
const root = path.resolve(options['--root'] || 'dist/library');
const base = options['--url'] ? new URL(options['--url'].replace(/\/?$/, '/')) : null;
if (base) assert(base.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(base.hostname), 'Public verification requires HTTPS');
const pack = readPack(options['--pack']);
const require = createRequire(import.meta.url);
const engine = require(path.join(root, 'source-connections.js'));
const cache = new Map();
const bytes = async file => {
  if (!cache.has(file)) cache.set(file, (async () => {
    if (!base) return fs.readFileSync(path.join(root, file));
    const url = new URL(file, base);
    url.searchParams.set('divrei-audit-check', pack.packageSha256.slice(0, 12));
    const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(30000)});
    assert(response.ok, file + ': HTTP ' + response.status);
    return Buffer.from(await response.arrayBuffer());
  })());
  return cache.get(file);
};
const json = async file => JSON.parse(await bytes(file));
const eachLimited = async (values, action, limit = 8) => {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, values.length)}, async () => {
    while (next < values.length) await action(values[next++]);
  }));
};
const sectionFile = section => `data/divrei-soferim/${section}.json`;
const sourceSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const key = (owner, ref) => JSON.stringify([owner, ref]);
const isOwner = ref => /^Divrei Soferim(?:\s\d|, Introduction)/.test(ref);
const report = await json(REPORT);
assert.equal(report.release, RELEASE);
assert.equal(report.packageSha256, pack.packageSha256);
assert.equal(report.payloadSha256, pack.manifest.payloadSha256);
assert.equal(report.authorTextPreserved, true);
assert.equal(report.existingNoteIdentitiesPreserved, true);
assert.equal(report.excludedParallelDataPreserved, true);
assert.deepEqual(report.counts, pack.counts);
assert.deepEqual(await json('divrei-source-audit-ledger.json'), pack.audit, 'Public audit ledger differs from sealed review');

const chapters = new Map(), finalFiles = new Map();
await eachLimited(pack.files, async file => {
  const raw = await bytes(file.path);
  assert.equal(sha(raw), file.afterSha256, 'Published postimage differs: ' + file.path);
  assert.equal(raw.toString('utf8'), file.afterText, 'Published text differs: ' + file.path);
  finalFiles.set(file.path, raw);
  if (file.bodySha256) {
    const rows = JSON.parse(raw);
    assert(Array.isArray(rows), 'Chapter must be an array: ' + file.path);
    assert.equal(bodyDigest(rows), file.bodySha256, 'Author text or structure changed: ' + file.path);
    chapters.set(Number(path.basename(file.path, '.json')), rows);
  }
});
assert.equal(chapters.size, 38, 'Every regular section must be covered');
const toc = await json('data/divrei-soferim/toc.json');
const leaves = toc.toc.children;
assert.equal(leaves.length, 39, 'Introduction and38 regular sections');
const sectionRefs = new Map(leaves.map(leaf => [Number(leaf.id), leaf.ref]));
assert.equal(sectionRefs.get(16), 'Divrei Soferim 16');
chapters.set(0, await json(sectionFile(0)));

const actualNotes = new Map(), placements = new Set(), expectedEdges = new Set();
for (const [section, rows] of chapters) {
  let paragraphIndex = 0;
  for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
    const row = rows[itemIndex];
    if (!row.p) continue;
    paragraphIndex++;
    const owner = sectionRefs.get(section) + ':' + (row.n || paragraphIndex);
    for (const pair of row.p) for (const side of pair)
      for (const match of String(side).matchAll(/\bdata-ref="([^"]+)"/g)) expectedEdges.add(key(owner, plain(match[1])));
    for (const note of row.footnotes || []) {
      assert(!actualNotes.has(note.number), 'Duplicate note number: ' + note.number);
      assert(!placements.has(note.placementId), 'Duplicate marker identity: ' + note.placementId);
      placements.add(note.placementId);
      actualNotes.set(note.number, {note, row, section, itemIndex, owner});
      for (const source of note.sources || []) expectedEdges.add(key(owner, source.ref));
    }
  }
}
assert.deepEqual([...actualNotes.keys()].sort((a, b) => a - b), Array.from({length: 718}, (_, i) => i + 1));
const auditByNumber = new Map(pack.audit.notes.map(record => [record.number, record]));
let quotations = 0, markers = 0, popupQuotations = 0;
for (const record of pack.audit.notes) {
  const {note, row, section, itemIndex} = actualNotes.get(record.number);
  assert.equal(note.sourceId, record.sourceId, 'Source identity changed: ' + record.number);
  if (record.number <= 717) {
    // Printed numbers were compacted in an older edition; stable source IDs
    // intentionally retain their original numbering and are not regenerated.
    assert.match(record.sourceId, /^DS-\d{4}$/);
    assert.equal(note.placementId, record.sourceId + '-1');
    assert(record.before, 'Existing note lacks its predecessor location');
  } else {
    assert.equal(record.number, 718);
    assert.equal(record.before, null);
    assert.equal(note.sourceId, 'DS-AUDIT-0718');
    assert.equal(note.placementId, 'DS-AUDIT-0718-1');
    assert.equal(section, 16);
    assert.equal(record.quotes[0].ref, 'Zohar, Vayechi 25:194');
  }
  assert.deepEqual({section, itemIndex, phraseIndex: note.phraseIndex}, record.after, 'Wrong destination for note ' + record.number);
  assert.equal(note.verificationStatus, 'verified');
  assert.equal(note.quotationOnly, true);
  assert.equal(note.provenance?.sourceAudit?.release, RELEASE);
  assert(!note.provenance?.sourceQuotationRelease, 'Superseded proof retained: ' + record.number);
  assert.equal(note.nativeConnections.length, 0, 'Unreviewed note-level connection remains');
  const pair = row.p[note.phraseIndex];
  assert(pair && pair.length === 2, 'Missing bilingual phrase at note ' + record.number);
  for (const [side, offset, prefix] of [[0, 'heCharOffset', 'heAnchorPrefix'], [1, 'enCharOffset', 'enAnchorPrefix']]) {
    assert(Number.isSafeInteger(note[offset]) && note[offset] >= 0 && note[offset] <= plain(pair[side]).length, 'Invalid marker offset at ' + record.number);
    assert.equal(plain(pair[side]).slice(0, note[offset]), note[prefix], 'Marker prefix differs at ' + record.number);
  }
  markers++;
  assert.equal(note.paragraphs.length, record.quotes.length, 'Every quotation must have one complete paragraph');
  assert.equal(note.sources.length, record.quotes.length, 'Every quotation must have an exact source');
  assert.equal(note.reviewedSourceExcerpts.length, record.quotes.length);
  for (let i = 0; i < record.quotes.length; i++) {
    const quote = record.quotes[i], paragraph = note.paragraphs[i], source = note.sources[i], evidence = note.reviewedSourceExcerpts[i];
    const expected = `${quote.ref}: “${quote.en}”`;
    assert.match(quote.he, /[א-ת]/, 'Missing retained primary Hebrew');
    assert.match(quote.en, /[A-Za-z]/, 'Missing English translation');
    assert(!/[א-ת]/.test(quote.en), 'Hebrew entered the displayed English translation');
    assert.equal(paragraph.language, 'en');
    assert.equal(paragraph.text, expected, 'A reviewed translation was shortened or changed: ' + record.number);
    assert.equal(paragraph.rich.map(run => run.text).join(''), expected, 'Rich text differs from the complete translation');
    assert.equal(paragraph.rich[0].text, quote.ref);
    assert.equal(paragraph.rich[0].bold, true, 'Citation must be bold');
    assert.equal(paragraph.rich[0].href, quote.url, 'Citation must be linked to its precise source');
    assert.equal(source.ref, quote.ref);
    assert.equal(source.url, quote.url);
    assert.equal(source.role, 'primary-source');
    assert.equal(engine.normalizeRef(engine.sourceRefFromUrl(quote.url)), engine.normalizeRef(quote.ref), 'URL does not identify the quoted source');
    assert.deepEqual(evidence, {ref: quote.ref, he: quote.he, en: quote.en, scope: 'selected-source-excerpt', evidenceSha256: quote.evidence.responseSha256});
    const popup = engine.sourceQuotationFromNote(note, {ref: quote.ref});
    assert(popup, 'Reader source popup cannot recover quote ' + record.number + ' / ' + quote.ref);
    assert.equal(popup.ref, engine.normalizeRef(quote.ref));
    assert.equal(popup.en, quote.en, 'Source popup truncated the displayed quote');
    assert.equal(popup.coverage, 'excerpt', 'Selected excerpt must not claim to translate a whole source unit');
    assert(!popup.he, 'Undisplayed evidence Hebrew entered an English-only popup');
    quotations++; popupQuotations++;
  }
}
assert.equal(markers, 718);
for (const move of pack.audit.moves) {
  const record = auditByNumber.get(move.number);
  assert.deepEqual(move.to, record.after);
  assert.deepEqual(move.from, {section: record.before.section, itemIndex: record.before.itemIndex, phraseIndex: record.before.phraseIndex});
  assert.deepEqual(actualNotes.get(move.number).note.provenance.sourceAudit.previousLocation, move.from);
}
for (const change of pack.audit.inlineLinkChanges) {
  const side = change.language === 'he' ? 0 : 1;
  const html = chapters.get(change.section)[change.itemIndex].p[change.phraseIndex][side];
  const refs = [...html.matchAll(/\bdata-ref="([^"]+)"/g)].map(match => plain(match[1]));
  assert(refs.includes(change.after), 'Reviewed inline source destination missing');
}

const links = await json('data/divrei-soferim/links.json');
const actualEdges = new Set();
for (const [sectionRef, edges] of Object.entries(links)) for (const edge of edges) {
  assert(edge.a.startsWith(sectionRef + ':'), 'Source edge assigned to a different section');
  const edgeKey = key(edge.a, edge.r);
  assert(!actualEdges.has(edgeKey), 'Duplicate source relationship');
  actualEdges.add(edgeKey);
}
assert.deepEqual([...actualEdges].sort(), [...expectedEdges].sort(), 'Source graph differs from final body anchors and source notes');
assert.equal(report.sourceConnections, actualEdges.size);

// Check both new and retired source titles. Local verification also scans every
// reverse index, detecting any unrelated stale owner left by an earlier build.
const citedNames = await json('data/cited/index.json');
const requiredNames = new Set([...expectedEdges].map(item => sourceSlug(JSON.parse(item)[1])));
for (const record of pack.audit.notes) for (const ref of record.before?.refs || []) requiredNames.add(sourceSlug(ref));
for (const name of [...expectedEdges].map(item => sourceSlug(JSON.parse(item)[1]))) assert(citedNames.includes(name), 'Missing reverse source index: ' + name);
const inspectNames = base ? citedNames.filter(name => requiredNames.has(name)) : citedNames;
const reverseEdges = new Set();
await eachLimited(inspectNames, async name => {
  const index = await json(`data/cited/${name}.json`);
  for (const [ref, owners] of Object.entries(index)) for (const owner of owners) if (isOwner(owner)) {
    assert(expectedEdges.has(key(owner, ref)), 'Stale reverse Divrei source connection: ' + owner + ' / ' + ref);
    reverseEdges.add(key(owner, ref));
  }
});
assert.deepEqual([...reverseEdges].sort(), [...expectedEdges].sort(), 'Reverse citation graph omitted a reviewed source');
const translations = await json('source-connections/translations.json');
for (const translation of translations.translations) for (const evidence of translation.evidence?.publishedNotes || [])
  assert(!/^data\/divrei-soferim\//.test(evidence.path), 'A superseded Divrei quotation is still promoted to a complete-source translation');

if (args.includes('--mcp')) {
  let mcp;
  if (base) {
    const url = new URL('../mcp-data/text/divrei-soferim.json', base);
    url.searchParams.set('divrei-audit-check', pack.packageSha256.slice(0, 12));
    const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(30000)});
    assert(response.ok, 'Published MCP text: HTTP ' + response.status);
    mcp = await response.json();
  } else {
    mcp = JSON.parse(fs.readFileSync(path.join(options['--mcp-root'] || 'dist/mcp-data', 'text/divrei-soferim.json'), 'utf8'));
  }
  const byRef = new Map(mcp.paras.filter(paragraph => paragraph.p).map(paragraph => [paragraph.r, paragraph]));
  for (const {note, owner} of actualNotes.values()) {
    const paragraph = byRef.get(owner);
    assert(paragraph, 'MCP paragraph missing: ' + owner);
    const matches = (paragraph.f || []).filter(item => item[0] === String(note.number));
    assert.equal(matches.length, 1, 'MCP duplicated or omitted note ' + note.number);
    assert.equal(matches[0][1], note.paragraphs.map(p => p.text).join('\n'), 'MCP shortened a quotation');
    assert.equal(matches[0][2], note.phraseIndex, 'MCP note points to a different phrase');
    for (const source of note.sources) assert(paragraph.c?.some(link => link[0] === source.ref), 'MCP omitted an exact source');
  }
}
if (args.includes('--zips')) {
  const {unzipSync} = require(path.join(root, 'vendor/fflate.min.js'));
  const index = await json('downloads/index.json');
  const book = index.books.find(item => item.slug === 'divrei-soferim');
  assert(book, 'Divrei source archive missing');
  for (const filename of [book.file, index.library.file]) {
    const entries = unzipSync(await bytes(filename));
    for (const [file, raw] of finalFiles) {
      assert(entries[file], 'Offline archive omitted ' + file);
      assert.equal(sha(entries[file]), sha(raw), 'Offline archive has a stale reviewed file: ' + file);
    }
    for (const file of ['data/divrei-soferim/0.json', 'data/divrei-soferim/toc.json'])
      assert.equal(sha(entries[file]), sha(await bytes(file)), 'Offline introduction or contents differ');
  }
}
assert((await bytes('index.html')).toString().includes(report.revision), 'Reader lacks current data-cache revision');
assert((await bytes('sw.js')).toString().includes('-divrei-source-audit-' + pack.packageSha256.slice(0, 12)), 'Service worker retains the old cache identity');
console.log(JSON.stringify({ok: true, release: RELEASE, publiclyVerified: !!base, reviewedExistingNotes: 717, newNotes: 1,
  exactNotes: markers, exactQuotations: quotations, exactPopupQuotations: popupQuotations, checkedPostimages: finalFiles.size,
  authorTextPreserved: true, exactMarkerPrefixes: true, reviewedMoves: pack.audit.moves.length,
  reviewedInlineLinkChanges: pack.audit.inlineLinkChanges.length, sourceEdges: actualEdges.size,
  reverseSourceIndexes: inspectNames.length, noStaleDivreiTranslationEvidence: true,
  mcpVerified: args.includes('--mcp'), offlineDownloadsVerified: args.includes('--zips')}, null, 2));

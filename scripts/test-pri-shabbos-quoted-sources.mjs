// Verify the exact successor, restore every predecessor note, and check exports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {RELEASE, REPORT, readPack, sha, digest, body, plain} from './publish-pri-shabbos-quoted-sources.mjs';

const args = process.argv.slice(2), option = name => {const at = args.indexOf(name); return at < 0 ? null : args[at + 1];};
const root = path.resolve(option('--root') || 'dist/library'), base = option('--url');
const pack = readPack(), sourceConnections = createRequire(import.meta.url)('../dist/library/source-connections.js');
const bytes = async file => {
  if (!base) return fs.readFileSync(path.join(root, file));
  const url = new URL(file, base); url.searchParams.set('quoted-source-check', String(Date.now()));
  const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(60000)});
  assert(response.ok, file + ': HTTP ' + response.status); return Buffer.from(await response.arrayBuffer());
};
const json = async file => JSON.parse(await bytes(file));
const report = await json(REPORT);
assert.equal(report.release, RELEASE); assert.equal(report.packageSha256, pack.packageSha256);
assert.equal(report.authorTextPreserved, true); assert.equal(report.existingNotesPreservedExceptReviewedOperations, true);
const finalFiles = new Map(); let notes = 0, exactAnchors = 0;
for (const file of pack.files) {
  const raw = await bytes(file.path), rows = JSON.parse(raw), restored = structuredClone(rows);
  assert.equal(sha(raw), file.afterSha256, 'Published chapter differs from the reviewed output');
  assert.equal(digest(body(rows)), file.bodySha256, 'Author text changed');
  finalFiles.set(file.path, raw);
  const operations = pack.operations.filter(operation => operation.path === file.path);
  for (const operation of operations) {
    const row = rows.find(row => row.p && row.n === operation.paragraph);
    const note = row.footnotes.find(note => note.placementId === operation.placementId);
    if (operation.action === 'remove') {assert(!note, 'An unrelated competing quotation remains'); continue;}
    assert.deepEqual(note, operation.after, 'A quotation was shortened or changed');
    const phrase = row.p[note.phraseIndex];
    assert.equal(plain(phrase[0]).slice(0, note.heCharOffset), note.heAnchorPrefix, 'Incorrect Hebrew phrase placement');
    assert.equal(plain(phrase[1]).slice(0, note.enCharOffset), note.enAnchorPrefix);
    assert.equal(note.paragraphs.length, 1); assert.equal(note.paragraphs[0].language, 'en');
    assert.equal(note.paragraphs[0].text, `${operation.quotation.ref}: “${operation.quotation.en}”`);
    const quote = sourceConnections.sourceQuotationFromNote(note, {ref:operation.quotation.ref});
    assert(quote, 'The source popup cannot recover its exact English quotation');
    assert.equal(quote.ref, sourceConnections.normalizeRef(operation.quotation.ref));
    assert.equal(quote.en, operation.quotation.en); assert(!quote.he, 'The English reader footnote acquired an undisplayed quotation');
    notes++; exactAnchors++;
  }
  // Reverse the reviewed operations. Every older note and every other field
  // must reconstruct the baseline, including array order and Hebrew offsets.
  for (const operation of [...operations].reverse()) {
    const row = restored.find(row => row.p && row.n === operation.paragraph);
    const at = row.footnotes.findIndex(note => note.placementId === operation.placementId);
    if (operation.action === 'add') {assert(at >= 0); row.footnotes.splice(at, 1);}
    else if (operation.action === 'replace') {assert(at >= 0); row.footnotes[at] = structuredClone(operation.before);}
    else {assert.equal(at, -1); row.footnotes.splice(operation.beforeNoteIndex, 0, structuredClone(operation.before));}
    if (!operation.beforeHadFootnotes && !row.footnotes.length) delete row.footnotes;
  }
  assert.equal(digest(restored), file.beforeObjectSha256, 'An unreviewed note or field changed');
}
const links = await json('data/peri-tzadik/links.json');
for (const operation of pack.operations.filter(operation => operation.after))
  assert((links[operation.sectionRef] || []).some(edge => edge.a === operation.originRef && edge.r === operation.quotation.ref), 'Missing exact source relationship');
if (args.includes('--mcp')) {
  const mcp = JSON.parse(fs.readFileSync('dist/mcp-data/text/peri-tzadik.json', 'utf8'));
  for (const operation of pack.operations.filter(operation => operation.after)) {
    const matches = mcp.paras.filter(paragraph => paragraph.r === operation.originRef && paragraph.p);
    const expected = operation.after.paragraphs.map(paragraph => paragraph.text).join('\n');
    assert(matches.some(paragraph => paragraph.f?.some(note => note[0] === String(operation.after.number) && note[1] === expected)), 'MCP omitted a complete quotation');
    assert(matches.some(paragraph => paragraph.c?.some(link => link[0] === operation.quotation.ref)), 'MCP omitted an exact citation');
  }
}
if (args.includes('--zips')) {
  const {unzipSync} = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
  const index = await json('downloads/index.json');
  for (const file of [index.books.find(book => book.slug === 'peri-tzadik').file, index.library.file]) {
    const entries = unzipSync(await bytes(file));
    for (const [chapter, raw] of finalFiles) assert.equal(sha(entries[chapter]), sha(raw), 'Offline download has a stale chapter');
  }
}
assert((await bytes('index.html')).toString().includes(report.revision), 'Installed reader lacks the current data revision');
console.log(JSON.stringify({ok:true, release:RELEASE, publiclyVerified:!!base, files:pack.files.length,
  quotations:notes, exactHebrewAnchors:exactAnchors, counts:pack.counts, allPredecessorNotesReconstructed:true,
  authorTextPreserved:true, englishQuotationOnly:true, exactSourcePopupQuotations:true,
  mcpVerified:args.includes('--mcp'), offlineDownloadsVerified:args.includes('--zips')}, null, 2));

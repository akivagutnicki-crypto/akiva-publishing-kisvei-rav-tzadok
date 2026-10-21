// Verify the exact successor, restore every predecessor note, and check exports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {RELEASE, REPORT, readPack, sha, digest, body, plain, restoreHistoricalRows} from './publish-pri-seasonal-quoted-sources.mjs';

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
assert.equal(report.authorTextPreservedExceptListedCorrections, true); assert.equal(report.existingNotesPreservedExceptReviewedOperations, true);
const finalFiles = new Map(); let notes = 0, exactAnchors = 0;
for (const file of pack.files) {
  const raw = await bytes(file.path), rows = JSON.parse(raw);
  assert.equal(sha(raw), file.afterSha256, 'Published chapter differs from the reviewed output');
  assert.equal(digest(body(rows)), file.afterBodySha256, 'Text differs from the reviewed edition');
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
    assert.equal(note.paragraphs[0].text, `${operation.quotation.citation || operation.quotation.ref}: “${operation.quotation.en}”`);
    const quote = sourceConnections.sourceQuotationFromNote(note, {ref:operation.quotation.ref});
    assert(quote, 'The source popup cannot recover its exact English quotation');
    assert.equal(quote.ref, sourceConnections.normalizeRef(operation.quotation.ref));
    assert.equal(quote.en, operation.quotation.en); assert(!quote.he, 'The English reader footnote acquired an undisplayed quotation');
    notes++; exactAnchors++;
  }
  // Reverse the reviewed operations. Every older note and every other field
  // must reconstruct the baseline, including array order and Hebrew offsets.
  const restored=restoreHistoricalRows(file.path,rows,pack);
  assert.equal(digest(restored), file.beforeObjectSha256, 'An unreviewed note or field changed');
}
for (const document of pack.documents) {
  const raw=await bytes(document.downloadPath);
  assert.equal(raw.length,document.bytes);assert.equal(sha(raw),document.sha256,'Print download differs from reviewed master');
}
const walk=node=>[node,...(node.children || []).flatMap(walk)];
const toc=await json('data/peri-tzadik/toc.json');
const allIds=new Set([105,106,...Array.from({length:31},(_,i)=>128+i),...Array.from({length:12},(_,i)=>191+i)]);
const leaves=walk(toc.toc).filter(leaf=>leaf.interlinear && allIds.has(leaf.id));
assert.equal(leaves.length,45);
for (const leaf of leaves) {
  assert.equal(leaf.downloadDocx,pack.documents.find(document=>document.format==='docx').downloadPath);
  assert.equal(leaf.downloadPdf,pack.documents.find(document=>document.format==='pdf').downloadPath);
}
const links = await json('data/peri-tzadik/links.json');
for (const record of pack.retiredSourceEdges || [])
  assert(!(links[record.sectionRef] || []).some(edge=>digest(edge)===digest(record.edge)),'A retired supplied-note citation remains visible');
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
    for (const document of pack.documents) assert.equal(sha(entries[document.downloadPath]),document.sha256,'Offline print master is stale');
  }
}
assert((await bytes('index.html')).toString().includes(report.revision), 'Installed reader lacks the current data revision');
console.log(JSON.stringify({ok:true, release:RELEASE, publiclyVerified:!!base, files:pack.files.length,
  quotations:notes, exactHebrewAnchors:exactAnchors, counts:pack.counts, allPredecessorNotesReconstructed:true,
  authorTextPreservedExceptListedCorrections:true, bodyCorrections:pack.bodyCorrections.length,
  englishQuotationOnly:true, exactSourcePopupQuotations:true, printDownloadsVerified:true, printDownloadSections:45,
  mcpVerified:args.includes('--mcp'), offlineDownloadsVerified:args.includes('--zips')}, null, 2));

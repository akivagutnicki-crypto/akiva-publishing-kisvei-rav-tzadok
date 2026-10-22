// Verify every reviewed quotation, every older chapter, exact numbering, and exports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {RELEASE,REPORT,SLUG,readPack,sha,digest,body,plain,restoreHistoricalRows} from './publish-tzidkat-quoted-sources.mjs';
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const root=path.resolve(option('--root') || 'dist/library'),base=option('--url'),pack=readPack(),cache=new Map();
const sourceConnections=createRequire(import.meta.url)(path.join(root,'source-connections.js'));
const bytes=async file=>{
  if (!cache.has(file)) cache.set(file,(async()=>{
    if (!base) return fs.readFileSync(path.join(root,file));
    const url=new URL(file,base);url.searchParams.set('tzidkat-quotation-check',String(Date.now()));
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(60000)});
    assert(response.ok,file+': HTTP '+response.status);return Buffer.from(await response.arrayBuffer());
  })());
  return cache.get(file);
};
const json=async file=>JSON.parse(await bytes(file));
const report=await json(REPORT);
assert.equal(report.release,RELEASE);assert.equal(report.packageSha256,pack.packageSha256);
assert(report.authorTextPreserved && report.missing74Preserved && report.existingNotesPreservedExceptReviewedOperations);
assert.equal(sha(await bytes(`data/${SLUG}/toc.json`)),pack.tocSha256,'Contents changed');
assert.equal(sha(await bytes(`data/${SLUG}/73.json`)),pack.missing74Sha256,'Missing-Siman-74 notice changed');
const finalFiles=new Map(),nativeNumbers=new Set(); let notes=0,exactAnchors=0,nativeCount=0;
for (const file of pack.baselineFiles) {
  const changed=pack.files.find(changed=>changed.path===file.path),raw=await bytes(file.path),rows=JSON.parse(raw);
  assert.equal(sha(raw),changed?.afterSha256 || file.sha256,'Unreviewed chapter change: '+file.path);
  for (const note of rows.flatMap(row=>row.footnotes || [])) {
    assert(!nativeNumbers.has(note.number),'Repeated native number');nativeNumbers.add(note.number);nativeCount++;
  }
  if (!changed) continue;
  const historicalRows=restoreHistoricalRows(file.path,rows,pack);
  finalFiles.set(file.path,raw);assert.equal(digest(body(historicalRows)),changed.bodySha256,'Unreviewed canonical text or headings changed');
  for (const operation of pack.operations.filter(operation=>operation.path===file.path)) {
    const row=rows.find(row=>row.p && row.n===operation.paragraph),note=row.footnotes.find(note=>note.placementId===operation.placementId);
    if (operation.action==='remove') {assert(!note,'A reviewed duplicate remains');continue;}
    assert.deepEqual(note,operation.after,'Quotation or placement changed');
    const phrase=row.p[note.phraseIndex];
    assert.equal(plain(phrase[0]).slice(0,note.heCharOffset),note.heAnchorPrefix,'Wrong Hebrew marker');
    assert.equal(plain(phrase[1]).slice(0,note.enCharOffset),note.enAnchorPrefix);
    const expected=`${operation.quotation.citation || operation.quotation.ref}: “${operation.quotation.en}”`;
    assert.equal(note.paragraphs.length,1);assert.equal(note.paragraphs[0].text,expected);
    const quote=sourceConnections.sourceQuotationFromNote(note,{ref:operation.quotation.ref});
    assert(quote,'Source popup cannot recover the complete source translation');
    assert.equal(quote.en,operation.quotation.en);assert(!quote.he,'A reader footnote gained additional undisplayed source text');
    notes++;exactAnchors++;
  }
  assert.equal(digest(historicalRows),changed.beforeObjectSha256,'Existing notes were not preserved exactly');
}
assert.equal(nativeCount,pack.counts.finalNativeFootnotes);
for (const pinned of pack.numbering.connectionNotes) assert(!nativeNumbers.has(pinned.number),'A new note collides with an existing supplemental marker');
const links=await json(`data/${SLUG}/links.json`);
for (const operation of pack.operations.filter(operation=>operation.after))
  assert((links[operation.sectionRef] || []).some(edge=>edge.a===operation.originRef && edge.r===operation.quotation.ref),'Missing exact citation relationship');
for (const operation of pack.operations) for (const correction of operation.inlineCorrections || []) {
  const rows=JSON.parse(await bytes(operation.path)),row=rows.find(row=>row.p && row.n===operation.paragraph);
  assert.deepEqual(row.p[correction.phraseIndex],correction.after,'Reviewed inline locator was not corrected');
  assert(!(links[operation.sectionRef] || []).some(edge=>edge.a===operation.originRef && edge.r===correction.obsoleteRef),
    'The obsolete inline citation remains in the source graph');
}
if (args.includes('--connections')) {
  const catalog=await json('connected-ideas/catalog.json'),byId=new Map(catalog.records.map(record=>[record.id,record]));
  for (const pinned of pack.numbering.connectionNotes) assert.equal(byId.get(pinned.id)?.[pinned.field],pinned.number,'An older supplemental number moved');
}
if (args.includes('--mcp')) {
  const mcp=JSON.parse(fs.readFileSync(path.join(option('--mcp-root') || 'dist/mcp-data','text',SLUG+'.json'),'utf8'));
  for (const operation of pack.operations.filter(operation=>operation.after)) {
    const matches=mcp.paras.filter(paragraph=>paragraph.r===operation.originRef && paragraph.p);
    assert(matches.some(paragraph=>paragraph.f?.some(note=>note[0]===String(operation.after.number) && note[1]===operation.after.paragraphs[0].text)),'MCP lost source quotation');
    assert(matches.some(paragraph=>paragraph.c?.some(link=>link[0]===operation.quotation.ref)),'MCP lost precise citation');
    for (const correction of operation.inlineCorrections || [])
      assert(!matches.some(paragraph=>paragraph.c?.some(link=>link[0]===correction.obsoleteRef)),'MCP retains the obsolete inline citation');
  }
}
if (args.includes('--zips')) {
  const {unzipSync}=createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js'),index=await json('downloads/index.json');
  for (const filename of [index.books.find(book=>book.slug===SLUG).file,index.library.file]) {
    const entries=unzipSync(await bytes(filename));
    for (const file of pack.baselineFiles) assert.equal(sha(entries[file.path]),sha(await bytes(file.path)),'Offline Tzidkat chapter differs from live data');
  }
}
assert((await bytes('index.html')).toString().includes(report.revision),'Reader lacks current cache revision');
console.log(JSON.stringify({ok:true,release:RELEASE,publiclyVerified:!!base,reviewedAvailableSimanim:263,missing74Preserved:true,
  checkedChapterFiles:pack.baselineFiles.length,affectedSections:pack.files.length,quotations:notes,exactHebrewAnchors:exactAnchors,counts:pack.counts,
  allPredecessorNotesReconstructed:true,authorTextPreserved:true,englishQuotationOnly:true,
  reviewedInlineLocatorCorrections:pack.operations.reduce((count,operation)=>count+(operation.inlineCorrections?.length || 0),0),
  existingSupplementalNumbersPreserved:args.includes('--connections'),mcpVerified:args.includes('--mcp'),offlineDownloadsVerified:args.includes('--zips')},null,2));

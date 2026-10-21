// Install independently collated quotations after the historical source-note checks.
// The immutable package names exact before/after notes; author text is never edited.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {categoryOf} from './citations.mjs';

export const RELEASE = '20261021-pri-seasonal-pdf-quotations-v1';
export const PACK = 'sources/akiva/overlays/pri-seasonal-quoted-sources-20261021.json';
export const REPORT = 'pri-seasonal-quoted-sources-publication.json';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => sha(JSON.stringify(canonical(value)));
export const body = value => Array.isArray(value) ? value.map(body) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'footnotes').map(([key, item]) => [key, body(item)])) : value;
export const plain = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key) => {
  if (key[0] === '#') return String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)));
  return {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '}[key.toLowerCase()] || all;
});
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const serial = value => JSON.stringify(value);
const filesUnder = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory()
  ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]).sort();
const sourceSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const allowed = /^Peri Tzadik, (?:Rosh Chodesh \(manuscript\)|Rosh Chodesh Cheshvan|Rosh Chodesh Kislev [1-7]|Chanukah (?:[1-9]|1\d|2[0-5])|Rosh Chodesh Shvat [1-6]|Tu BiShvat [1-5])(?::\d+)?$/;
const permittedFiles = new Set([105,106,...Array.from({length:31},(_,i)=>128+i),...Array.from({length:12},(_,i)=>191+i)].map(id=>`data/peri-tzadik/${id}.json`));
const walk = node => [node,...(node.children || []).flatMap(walk)];

export function readPack(filename = PACK) {
  const bytes = fs.readFileSync(filename), pack = JSON.parse(bytes);
  assert.equal(pack.schemaVersion, 1); assert.equal(pack.release, RELEASE);
  assert(pack.files.length && pack.operations.length, 'Empty quotation release');
  for (const file of pack.files) assert(permittedFiles.has(file.path), 'Unauthorized chapter path');
  const ids = new Set(), quotations = new Set();
  for (const operation of pack.operations) {
    assert(allowed.test(operation.originRef), 'Outside the authorized works');
    assert.equal(operation.originRef, operation.sectionRef + ':' + operation.paragraph);
    assert(['add', 'replace', 'remove'].includes(operation.action));
    assert(pack.files.some(file => file.path === operation.path));
    assert(!ids.has(operation.placementId), 'Repeated placement operation'); ids.add(operation.placementId);
    assert(operation.reviewed === true && operation.reason, 'Unreviewed editorial operation');
    if (operation.action === 'remove') {assert(operation.before && !operation.after); continue;}
    const note = operation.after, quote = operation.quotation;
    assert(note.quotationOnly === true && note.verificationStatus === 'verified');
    assert.equal(note.placementId, operation.placementId);
    assert(quote && /[א-ת]/.test(quote.he) && /[A-Za-z]/.test(quote.en));
    assert(typeof quote.url === 'string' && (quote.url.startsWith('#/read/') || /^https:\/\/(?:www\.)?(?:sefaria\.org|chabad\.org|hebrewbooks\.org|nli\.org\.il|he\.wikisource\.org)\//.test(quote.url)), 'Unsupported source URL');
    if (quote.url.startsWith('#/read/')) assert.equal(decodeURIComponent(quote.url.slice(7)).replace(/_/g, ' '), quote.ref, 'Internal source link identifies another passage');
    assert.equal(note.sources.length, 1); assert.equal(note.sources[0].ref, quote.ref);
    assert.equal(note.sources[0].url, quote.url);
    assert.equal(note.paragraphs.length, 1, 'A quotation must not acquire commentary');
    const citation=quote.citation || quote.ref;
    if (quote.citation) {assert(quote.citation.startsWith(quote.ref+' ('),'Qualified citation must retain its exact canonical reference'); assert.equal(note.sources[0].citation,citation); assert.equal(note.reviewedSourceExcerpt.citation,citation);}
    const paragraph = note.paragraphs[0], expected = `${citation}: “${quote.en}”`;
    assert.equal(paragraph.language, 'en'); assert.equal(paragraph.text, expected);
    assert.equal(paragraph.rich.map(run => run.text).join(''), expected);
    assert.deepEqual(paragraph.rich[0], {text:citation, bold:true, href:quote.url});
    assert.equal(note.reviewedSourceExcerpt.he, quote.he); assert.equal(note.reviewedSourceExcerpt.en, quote.en);
    assert.equal(note.reviewedSourceExcerpt.ref, quote.ref);
    const key = quote.he.normalize('NFKD').replace(/[\u0591-\u05c7\s\p{P}\p{S}]/gu, '');
    assert(!quotations.has(key), 'Repeated quotation in release'); quotations.add(key);
    assert(note.provenance.quotedSourceRelease === RELEASE);
    if (operation.action === 'replace') {
      assert.equal(note.number, operation.before.number, 'An existing footnote number moved');
      assert.equal(note.sourceId, operation.before.sourceId, 'An existing source identity moved');
    } else assert(!operation.before, 'New note has a predecessor');
  }
  for (const change of pack.bodyCorrections || []) {
    assert(permittedFiles.has(change.path)); assert(change.reviewed && change.reason && change.evidence);
    assert([0,1].includes(change.column)); assert(change.before !== change.after);
    if (change.column === 0) assert.equal(plain(change.before),plain(change.after),'A source-link correction must retain the exact Hebrew wording');
  }
  for (const record of pack.retiredSourceEdges || []) {
    assert(allowed.test(record.sectionRef));assert(record.edge.a.startsWith(record.sectionRef+':'));
    assert.equal(record.edge.c,'Source Notes');assert.equal(record.edge.kind,'Supplied source translation');
    assert(pack.operations.some(operation=>operation.placementId===record.placementId && operation.before));assert(record.reason);
  }
  assert.equal(pack.documents.length,2);
  assert.deepEqual(pack.documents.map(document=>document.format).sort(),['docx','pdf']);
  for (const document of pack.documents) {
    assert.match(document.sourcePath,/^sources\/akiva\/editions\/pri-seasonal-20261021\/[a-z0-9-]+\.(?:docx|pdf)$/);
    assert.match(document.downloadPath,/^downloads\/[a-z0-9-]+\.(?:docx|pdf)$/);
    assert.match(document.sha256,/^[a-f0-9]{64}$/); assert(document.bytes > 0);
  }
  return {...pack, packageSha256:sha(bytes)};
}

export function applyOperations(original, operations, bodyCorrections = []) {
  const result = structuredClone(original);
  for (const change of bodyCorrections) {
    const row = result.find(row=>row.p && row.n===change.paragraph);
    assert.equal(row?.p[change.phraseIndex]?.[change.column],change.before,'The reviewed translation or link changed');
    row.p[change.phraseIndex][change.column]=change.after;
  }
  for (const operation of operations) {
    const item = result.find(row => row.p && row.n === operation.paragraph);
    assert(item, 'Missing canonical paragraph: ' + operation.originRef);
    const notes = item.footnotes || [], at = notes.findIndex(note => note.placementId === operation.placementId);
    if (operation.action === 'add') {
      assert.equal(at, -1, 'A new note already exists');
      assert(!notes.some(note => note.number === operation.after.number), 'Duplicate number in paragraph');
      notes.push(structuredClone(operation.after));
    } else {
      assert(at >= 0, 'Missing predecessor note');
      assert.deepEqual(notes[at], operation.before, 'The predecessor note changed');
      if (operation.action === 'remove') notes.splice(at, 1);
      else notes[at] = structuredClone(operation.after);
    }
    item.footnotes = notes;
    if (operation.after) {
      const note = operation.after, pair = item.p[note.phraseIndex];
      assert(pair && Number.isSafeInteger(note.heCharOffset));
      assert(note.heCharOffset > 0 && note.heCharOffset <= plain(pair[0]).length, 'Hebrew offset outside its phrase');
      assert(Number.isSafeInteger(note.enCharOffset) && note.enCharOffset >= 0 && note.enCharOffset <= plain(pair[1]).length, 'English offset outside its phrase');
      assert.equal(plain(pair[0]).slice(0, note.heCharOffset), note.heAnchorPrefix, 'Hebrew marker no longer matches its phrase');
      assert.equal(plain(pair[1]).slice(0, note.enCharOffset), note.enAnchorPrefix, 'English phrase context moved');
    }
  }
  const expectedBody=structuredClone(original);
  for (const change of bodyCorrections) expectedBody.find(row=>row.p && row.n===change.paragraph).p[change.phraseIndex][change.column]=change.after;
  assert.deepEqual(body(result), body(expectedBody), 'Unreviewed author text or heading changed');
  return result;
}

// Only the exact reviewed successor can reconstruct the historical edition.
// Unknown changes still fail the earlier preservation proofs.
export function restoreHistoricalRows(relative, rows, pack = readPack()) {
  const file=pack.files.find(file=>file.path===relative);
  if (!file || sha(JSON.stringify(rows))!==file.afterSha256) return rows;
  const restored=structuredClone(rows);
  const operations=pack.operations.filter(operation=>operation.path===relative);
  for (const operation of operations.filter(operation=>operation.after).reverse()) {
    const row=restored.find(row=>row.p && row.n===operation.paragraph);
    const at=row.footnotes.findIndex(note=>note.placementId===operation.placementId);
    if (operation.after) {assert(at>=0);assert.deepEqual(row.footnotes[at],operation.after);}
    if (operation.action==='add') row.footnotes.splice(at,1);
    else if (operation.action==='replace') row.footnotes[at]=structuredClone(operation.before);
  }
  // These indexes refer to the original row. Reinsert removed notes from
  // left to right after undoing additions and replacements, so multiple
  // removals from one paragraph reconstruct the original order exactly.
  for (const operation of operations.filter(operation=>operation.action==='remove').sort((a,b)=>a.paragraph-b.paragraph || a.beforeNoteIndex-b.beforeNoteIndex)) {
    const row=restored.find(row=>row.p && row.n===operation.paragraph);
    assert(!row.footnotes.some(note=>note.placementId===operation.placementId));
    row.footnotes.splice(operation.beforeNoteIndex,0,structuredClone(operation.before));
  }
  for (const operation of operations) {
    const row=restored.find(row=>row.p && row.n===operation.paragraph);
    if (!operation.beforeHadFootnotes && !row.footnotes?.length) delete row.footnotes;
  }
  for (const change of (pack.bodyCorrections || []).filter(change=>change.path===relative).reverse()) {
    const row=restored.find(row=>row.p && row.n===change.paragraph);
    assert.equal(row.p[change.phraseIndex][change.column],change.after);
    row.p[change.phraseIndex][change.column]=change.before;
  }
  assert.equal(digest(restored),file.beforeObjectSha256,'Historical reconstruction is incomplete');
  return restored;
}

export function publish(library = 'dist/library', filename = PACK) {
  const pack = readPack(filename), data = path.join(library, 'data');
  const reportPath = path.join(library, REPORT);
  const allAfter = pack.files.every(file => sha(fs.readFileSync(path.join(library, file.path))) === file.afterSha256);
  if (allAfter) {
    const report = read(reportPath);
    assert.equal(report.packageSha256, pack.packageSha256, 'Another release occupies the same output');
    return {...report, mode:'already-applied'};
  }
  const planned = [], touched = new Set(pack.files.map(file => path.join(library, file.path)));
  const protectedFiles = filesUnder(data).filter(file => !touched.has(file));
  const protectedSha256 = digest(protectedFiles.map(file => [path.relative(data, file), sha(fs.readFileSync(file))]));
  for (const file of pack.files) {
    const target = path.join(library, file.path), bytes = fs.readFileSync(target);
    assert.equal(sha(bytes), file.beforeSha256, 'Current reader differs from reviewed baseline: ' + file.path);
    const original = JSON.parse(bytes);
    assert.equal(digest(body(original)), file.bodySha256);
    const updated = applyOperations(original, pack.operations.filter(operation => operation.path === file.path),(pack.bodyCorrections || []).filter(change=>change.path===file.path));
    const after = serial(updated);
    assert.equal(sha(after), file.afterSha256, 'Prepared quotation output differs: ' + file.path);
    planned.push([target, after]);
  }
  for (const document of pack.documents) {
    const bytes=fs.readFileSync(document.sourcePath);
    assert.equal(bytes.length,document.bytes);assert.equal(sha(bytes),document.sha256,'Print edition changed after review');
  }
  // Preflight all note operations before any file is written. Source links in
  // existing paragraphs are retained; each new quotation adds its exact edge.
  const linksFile = path.join(data, 'peri-tzadik/links.json'), links = read(linksFile);
  for (const record of pack.retiredSourceEdges || []) {
    const list=links[record.sectionRef];const at=list.findIndex(edge=>digest(edge)===digest(record.edge));
    assert(at>=0,'Retired source-note citation changed after review');list.splice(at,1);
  }
  const additions = [];
  for (const operation of pack.operations.filter(operation => operation.after)) {
    const list = links[operation.sectionRef] || (links[operation.sectionRef] = []);
    const ref = operation.quotation.ref;
    if (!list.some(link => link.a === operation.originRef && link.r === ref)) {
      const edge = {a:operation.originRef, r:ref, c:categoryOf(ref)};
      list.push(edge); additions.push(edge);
    }
  }
  for (const [file, contents] of planned) fs.writeFileSync(file, contents);
  // This first preservation proof covers every non-target data file, including
  // all other books and historical citation files, before additive links.
  assert.equal(digest(protectedFiles.map(file => [path.relative(data, file), sha(fs.readFileSync(file))])), protectedSha256);
  fs.writeFileSync(linksFile, serial(links));
  const cited = path.join(data, 'cited'), catalog = read(path.join(data, 'catalog.json'));
  const sourceNames = new Set(read(path.join(cited, 'index.json')));
  for (const {sectionRef,edge} of pack.retiredSourceEdges || []) {
    if ((links[sectionRef] || []).some(current=>current.a===edge.a && current.r===edge.r)) continue;
    const filename=path.join(cited,sourceSlug(edge.r)+'.json');
    if (!fs.existsSync(filename)) continue;
    const index=read(filename);
    if (!index[edge.r]) continue;
    index[edge.r]=index[edge.r].filter(owner=>owner!==edge.a);
    if (!index[edge.r].length) delete index[edge.r];
    fs.writeFileSync(filename,serial(index));
  }
  for (const edge of additions) {
    const slug = sourceSlug(edge.r), filename = path.join(cited, slug + '.json');
    const index = fs.existsSync(filename) ? read(filename) : {};
    const owners = index[edge.r] || (index[edge.r] = []);
    if (!owners.includes(edge.a)) owners.push(edge.a);
    fs.writeFileSync(filename, serial(index)); sourceNames.add(slug);
  }
  fs.writeFileSync(path.join(cited, 'index.json'), serial([...sourceNames].sort()));
  const sourcesFile = path.join(data, 'packs/sources.json'), sources = read(sourcesFile);
  const external = additions.map(edge => edge.r).filter(ref => !catalog.some(book => ref === book.title || ref.startsWith(book.title + ' ') || ref.startsWith(book.title + ',')));
  sources.refs = [...new Set([...sources.refs, ...external])].sort(); fs.writeFileSync(sourcesFile, serial(sources));
  const tocFile=path.join(data,'peri-tzadik/toc.json'), toc=read(tocFile);
  const docx=pack.documents.find(document=>document.format==='docx'),pdf=pack.documents.find(document=>document.format==='pdf');
  for (const leaf of walk(toc.toc).filter(leaf=>leaf.interlinear && allowed.test(leaf.ref))) {
    leaf.downloadDocx=docx.downloadPath;leaf.downloadDocxLabel='Rosh Chodesh to Tu BiShvat · Revised 7×10 Word edition';
    leaf.downloadPdf=pdf.downloadPath;leaf.downloadPdfLabel='Rosh Chodesh to Tu BiShvat · Revised 7×10 print PDF';
  }
  fs.writeFileSync(tocFile,serial(toc));
  const book=catalog.find(book=>book.slug==='peri-tzadik');
  book.downloads=[...(book.downloads || []).filter(item=>![docx.downloadPath,pdf.downloadPath].includes(item.file)),
    {file:docx.downloadPath,label:'Rosh Chodesh to Tu BiShvat · Revised 7×10 Word edition'},
    {file:pdf.downloadPath,label:'Rosh Chodesh to Tu BiShvat · Revised 7×10 print PDF'}];
  fs.writeFileSync(path.join(data,'catalog.json'),serial(catalog));
  for (const document of pack.documents) fs.copyFileSync(document.sourcePath,path.join(library,document.downloadPath));
  const revision = RELEASE + '-' + pack.packageSha256.slice(0, 12);
  const htmlFile = path.join(library, 'index.html'); let html = fs.readFileSync(htmlFile, 'utf8');
  const marker = 'const editionDataUrl = url => '; assert.equal(html.split(marker).length, 2);
  html = html.replace(/\/\* Pri seasonal quoted sources revision \*\/[^\n]*\n/g, '');
  html = html.replace(marker, marker + `/* Pri seasonal quoted sources revision */ (url.startsWith('data/peri-tzadik/') || url.startsWith('data/cited/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition=${revision}' :\n`);
  assert.match(html,/source-connections\.js\?v=[^"]+/);
  html=html.replace(/source-connections\.js\?v=[^"]+/g,'source-connections.js?v='+revision);
  const downloadMarker='  const numberOfNotes = Object.values(d.annotations || {}).reduce';
  assert.equal(html.split(downloadMarker).length,2);
  html=html.replace(downloadMarker,'  if (d.downloadPdf) html += `<div class="section-docx-link"><a href="${esc(d.downloadPdf)}" target="_blank" rel="noopener">${esc(d.downloadPdfLabel || "Download the print PDF")} ↗</a></div>`;\n'+downloadMarker);
  const leafMarker='downloadDocxLabel: leaf.downloadDocxLabel || null,';
  assert.equal(html.split(leafMarker).length,2);
  html=html.replace(leafMarker,leafMarker+' downloadPdf: leaf.downloadPdf || null, downloadPdfLabel: leaf.downloadPdfLabel || null,');
  fs.writeFileSync(htmlFile, html);
  const swFile = path.join(library, 'sw.js'); let sw = fs.readFileSync(swFile, 'utf8');
  assert.match(sw, /const SHELL = `[^`]+`;/);
  sw=sw.replace(/source-connections\.js\?v=[^']+/g,'source-connections.js?v='+revision);
  sw = sw.replace(/-pri-seasonal-quotes-[a-f0-9]+/g, '').replace(/const SHELL = `([^`]+)`;/, `const SHELL = \`$1-pri-seasonal-quotes-${pack.packageSha256.slice(0,12)}\`;`);
  fs.writeFileSync(swFile, sw);
  const report = {schemaVersion:1, release:RELEASE, revision, packageSha256:pack.packageSha256,
    counts:pack.counts, files:pack.files, protectedDataFiles:protectedFiles.length, protectedDataSha256:protectedSha256,
    authorTextPreservedExceptListedCorrections:true, bodyCorrections:pack.bodyCorrections || [],
    existingNotesPreservedExceptReviewedOperations:true, exactSourceLinksAdded:additions,retiredSourceEdges:pack.retiredSourceEdges || [],
    documents:pack.documents, printParity:pack.printParity, historicalSourceManuscriptsPreserved:true};
  fs.writeFileSync(reportPath, serial(report));
  return {...report, mode:'applied'};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const at = process.argv.indexOf('--root');
  console.log(JSON.stringify(publish(at < 0 ? 'dist/library' : process.argv[at + 1]), null, 2));
}

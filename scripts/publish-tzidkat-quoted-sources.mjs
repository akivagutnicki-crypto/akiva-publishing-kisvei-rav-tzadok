// Apply only the individually reviewed source quotations selected from the
// supplied Tzidkat editions. The canonical body and every unrelated note stay exact.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {categoryOf} from './citations.mjs';
import {sha, digest, body, plain, applyOperations as applyNoteOperations} from './publish-pri-shabbos-quoted-sources.mjs';

export {sha, digest, body, plain};
export const RELEASE = '20261022-tzidkat-pdf-quotations-v1';
export const PACK = 'sources/akiva/overlays/tzidkat-quoted-sources-20261022.json';
export const REPORT = 'tzidkat-quoted-sources-publication.json';
export const SLUG = 'tzidkat-hatzadik';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const filesUnder = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory()
  ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]).sort();
const sourceSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const quoteKey = value => value.normalize('NFKD').replace(/[\u0591-\u05c7\s\p{P}\p{S}]/gu, '');
const numberFields = ['footnoteNumber', 'reverseFootnoteNumber'];

// A reviewed source locator may be corrected with its quotation. Both exact
// phrase pairs are retained so historical preservation remains reversible.
export function applyInlineCorrections(rows, operations, reverse = false) {
  const result = structuredClone(rows);
  for (const operation of operations) for (const correction of operation.inlineCorrections || []) {
    const row = result.find(row => row.p && row.n === operation.paragraph);
    assert(row, 'Missing paragraph for reviewed inline correction');
    const before = reverse ? correction.after : correction.before;
    const after = reverse ? correction.before : correction.after;
    assert.deepEqual(row.p[correction.phraseIndex], before, 'Reviewed inline locator predecessor changed');
    row.p[correction.phraseIndex] = structuredClone(after);
  }
  return result;
}

export function applyOperations(rows, operations) {
  return applyNoteOperations(applyInlineCorrections(rows, operations), operations);
}

export function readPack(filename = PACK) {
  const bytes = fs.readFileSync(filename), pack = JSON.parse(bytes);
  assert.equal(pack.schemaVersion, 1); assert.equal(pack.release, RELEASE);
  assert(pack.files.length && pack.operations.length, 'Empty quotation release');
  assert.deepEqual(pack.coverage.reviewedSimanim, Array.from({length:264}, (_,i)=>i+1).filter(n=>n!==74), 'The whole available sefer must be reviewed');
  assert.deepEqual(pack.coverage.excludedSimanim.map(item=>item.siman), [74]);
  assert(pack.coverage.excludedSimanim[0].reason, 'The absent siman needs its actual explanation');
  assert(pack.sourcePDFs.length === 4 && pack.sourcePDFs.every(item=>item.filename && /^[a-f0-9]{64}$/.test(item.sha256)), 'The four supplied editions must be identified');
  const files = new Set();
  for (const file of pack.files) {
    const match = file.path.match(/^data\/tzidkat-hatzadik\/(\d+)\.json$/);
    assert(match && +match[1] < 264 && +match[1] !== 73, 'Outside existing Tzidkat sections');
    assert(!files.has(file.path), 'Repeated chapter'); files.add(file.path);
    for (const field of ['beforeSha256','afterSha256','bodySha256','beforeObjectSha256']) assert.match(file[field], /^[a-f0-9]{64}$/);
  }
  assert.match(pack.missing74Sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(pack.baselineFiles.map(file=>file.path).sort(),Array.from({length:264},(_,i)=>`data/${SLUG}/${i}.json`).sort());
  for (const file of pack.baselineFiles) assert.match(file.sha256,/^[a-f0-9]{64}$/);
  assert.match(pack.tocSha256,/^[a-f0-9]{64}$/);
  const identities = new Set(), quotations = new Set(), numbers = new Set();
  for (const pinned of pack.numbering.connectionNotes) {
    assert(pinned.id && numberFields.includes(pinned.field));
    assert(Number.isSafeInteger(pinned.number) && pinned.number > 0);
    assert(!numbers.has(pinned.number), 'Legacy supplemental footnote collision'); numbers.add(pinned.number);
    assert(pinned.originRef.startsWith('Tzidkat HaTzadik ') && pinned.targetRef);
  }
  assert.equal(pack.numbering.maximumExistingNumber, Math.max(pack.numbering.maximumNativeNumber, ...numbers));
  for (const operation of pack.operations) {
    const match = operation.sectionRef.match(/^Tzidkat HaTzadik (\d+)$/);
    assert(match && +match[1] >= 1 && +match[1] <= 264 && +match[1] !== 74, 'Invalid siman');
    assert.equal(operation.path, `data/${SLUG}/${+match[1]-1}.json`);
    assert.equal(operation.originRef, operation.sectionRef + ':' + operation.paragraph);
    assert(Number.isSafeInteger(operation.paragraph) && operation.paragraph > 0);
    assert(['add','replace','remove'].includes(operation.action)); assert(files.has(operation.path));
    assert(!identities.has(operation.placementId), 'Repeated note operation'); identities.add(operation.placementId);
    assert(operation.reviewed === true && operation.reason, 'Unreviewed selection');
    assert(operation.dedupReviewed === true && operation.dedupReason, 'An explicit duplicate review is required');
    assert(operation.sourceEvidence?.length, 'Missing source evidence');
    for (const evidence of operation.sourceEvidence) {
      assert(pack.sourcePDFs.some(pdf=>pdf.filename===evidence.pdf));
      assert(Number.isSafeInteger(evidence.page) && evidence.page > 0, 'PDF page numbers are one-based');
    }
    if (operation.action === 'remove') {assert(operation.before && !operation.after); continue;}
    const note = operation.after, quote = operation.quotation;
    for (const correction of operation.inlineCorrections || []) {
      assert.equal(operation.sectionRef, 'Tzidkat HaTzadik 15');
      assert.equal(operation.paragraph, 1); assert.equal(operation.action, 'replace');
      assert.equal(note.number, 46); assert.equal(correction.phraseIndex, 1);
      assert.equal(correction.obsoleteRef, 'Mishnah Peah 3:8');
      assert.equal(correction.correctedRef, 'Tosefta Peah 3:13'); assert(correction.reason);
      assert.equal(correction.before.length, 2); assert.equal(correction.after.length, 2);
      const oldTarget = 'data-ref="Mishnah Peah 3:8"', newTarget = 'data-ref="Tosefta Peah 3:13"';
      assert.equal(correction.before[0].split(oldTarget).length - 1, 2);
      assert.equal(correction.before[1].split(oldTarget).length - 1, 1);
      assert.deepEqual(correction.after, [correction.before[0].replaceAll(oldTarget, newTarget),
        correction.before[1].replaceAll(oldTarget, newTarget).replace('>Peah 3:8</a>', '>Peah 3:13</a>')]);
      assert.equal(plain(correction.before[0]), plain(correction.after[0]), 'Canonical Hebrew changed');
    }
    assert(note.quotationOnly === true && note.verificationStatus === 'verified');
    assert.equal(note.placementId, operation.placementId);
    assert(quote?.ref && /[א-ת]/.test(quote.he) && /[A-Za-z]/.test(quote.en));
    if (quote.url) {
      assert(quote.url.startsWith('#/read/') || /^https:\/\/(?:www\.)?(?:sefaria\.org|chabad\.org|hebrewbooks\.org|nli\.org\.il|he\.wikisource\.org|wiki\.jewishbooks\.org\.il)\//.test(quote.url), 'Unverified source-link host');
      if (quote.url.startsWith('#/read/')) assert.equal(decodeURIComponent(quote.url.slice(7)).replace(/_/g, ' '), quote.ref);
    }
    const citation = quote.citation || quote.ref;
    if (quote.citation) assert(quote.citation.startsWith(quote.ref+' ('),'Qualified citation must retain the exact canonical reference');
    assert.equal(note.sources.length, 1); assert.equal(note.sources[0].ref, quote.ref);
    assert.equal(note.sources[0].url || null, quote.url || null);
    assert.equal(note.paragraphs.length, 1, 'No added explanatory paragraphs');
    const paragraph = note.paragraphs[0], expected = `${citation}: “${quote.en}”`;
    assert.equal(paragraph.language, 'en'); assert.equal(paragraph.text, expected);
    assert.equal(paragraph.rich.map(run=>run.text).join(''), expected);
    assert.deepEqual(paragraph.rich[0], {text:citation, bold:true, ...(quote.url ? {href:quote.url} : {})});
    assert.deepEqual(note.reviewedSourceExcerpt, {schemaVersion:1, ref:quote.ref, he:quote.he, en:quote.en, ...(quote.citation ? {citation:quote.citation} : {}),
      coverage:'excerpt', provenance:'Akiva Publishing · Original English translation checked against the quoted Hebrew or Aramaic source.'});
    assert(!quotations.has(quoteKey(quote.he)), 'Duplicate selected source quotation'); quotations.add(quoteKey(quote.he));
    assert.equal(note.provenance.quotedSourceRelease, RELEASE);
    if (operation.action === 'replace') {
      assert.equal(note.number, operation.before.number); assert.equal(note.sourceId, operation.before.sourceId);
    } else {
      assert(!operation.before, 'An addition has a predecessor');
      assert(note.number > pack.numbering.maximumExistingNumber, 'New notes must follow every existing manuscript and supplemental number');
    }
  }
  return {...pack, packageSha256:sha(bytes)};
}

// Undo only the exact approved successor. A changed/unlisted note cannot pass
// an older release's preservation proof through this reconstruction.
export function restoreHistoricalRows(relative, rows, pack = readPack()) {
  const file = pack.files.find(file=>file.path===relative);
  if (!file || sha(JSON.stringify(rows)) !== file.afterSha256) return rows;
  let restored = structuredClone(rows);
  const operations = pack.operations.filter(operation=>operation.path===relative);
  for (const operation of operations.filter(operation=>operation.after).reverse()) {
    const row = restored.find(row=>row.p && row.n===operation.paragraph);
    const at = row.footnotes.findIndex(note=>note.placementId===operation.placementId);
    assert(at >= 0); assert.deepEqual(row.footnotes[at], operation.after);
    if (operation.action==='add') row.footnotes.splice(at, 1);
    else row.footnotes[at] = structuredClone(operation.before);
  }
  for (const operation of operations.filter(operation=>operation.action==='remove').sort((a,b)=>a.paragraph-b.paragraph || a.beforeNoteIndex-b.beforeNoteIndex)) {
    const row = restored.find(row=>row.p && row.n===operation.paragraph);
    assert(!row.footnotes.some(note=>note.placementId===operation.placementId));
    row.footnotes.splice(operation.beforeNoteIndex, 0, structuredClone(operation.before));
  }
  for (const operation of operations) {
    const row = restored.find(row=>row.p && row.n===operation.paragraph);
    if (!operation.beforeHadFootnotes && !row.footnotes?.length) delete row.footnotes;
  }
  restored = applyInlineCorrections(restored, operations, true);
  assert.equal(digest(restored), file.beforeObjectSha256, 'The predecessor was not reconstructed exactly');
  return restored;
}

export function historicalBytes(relative, raw, pack = readPack()) {
  const file = pack.files.find(file=>file.path===relative);
  if (!file || sha(raw) === file.beforeSha256) return raw;
  assert.equal(sha(raw), file.afterSha256, 'Unreviewed successor: ' + relative);
  const text = JSON.stringify(restoreHistoricalRows(relative, JSON.parse(raw), pack));
  const original = Buffer.from(sha(text)===file.beforeSha256 ? text : text+'\n');
  assert.equal(sha(original), file.beforeSha256, 'Historical byte serialization changed');
  return original;
}

export function publishedNumbering(root = 'dist/library') {
  const reportPath = path.join(root, REPORT);
  if (!fs.existsSync(reportPath)) return null;
  const report = read(reportPath), pack = readPack();
  assert.equal(report.release, RELEASE); assert.equal(report.packageSha256, pack.packageSha256);
  return pack.numbering;
}

// Existing supplemental numbers are immutable; novel records, if later added,
// receive unused numbers above both the manuscript and the pinned catalog.
export function stableNumberAllocator(nativeNumbers, numbering) {
  const used = new Set(nativeNumbers), pinned = new Map();
  let maximum = Math.max(0, ...used);
  for (const item of numbering?.connectionNotes || []) {
    const key = item.id + ':' + item.field;
    assert(!pinned.has(key) && !used.has(item.number), 'A new native note collides with a published supplemental number');
    pinned.set(key, item); used.add(item.number); maximum = Math.max(maximum, item.number);
  }
  const visited = new Set();
  return {
    take(id, field, originRef, targetRef) {
      const key = id + ':' + field; assert(!visited.has(key), 'A supplemental record appears twice'); visited.add(key);
      const prior = pinned.get(key);
      if (prior) {assert.equal(prior.originRef, originRef); assert.equal(prior.targetRef, targetRef); return prior.number;}
      while (used.has(++maximum)) {} used.add(maximum); return maximum;
    },
    verify() {for (const key of pinned.keys()) assert(visited.has(key), 'A previously published supplemental note disappeared: ' + key);}
  };
}

function refreshReader(library,pack) {
  const revision=RELEASE+'-'+pack.packageSha256.slice(0,12),htmlFile=path.join(library,'index.html');
  let html=fs.readFileSync(htmlFile,'utf8'); const marker='const editionDataUrl = url => '; assert.equal(html.split(marker).length,2);
  html=html.replace(/\/\* Tzidkat quoted sources revision \*\/[^\n]*\n/g,'');
  html=html.replace(marker,marker+`/* Tzidkat quoted sources revision */ (url.startsWith('data/tzidkat-hatzadik/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition=${revision}' :\n`);
  // The reader's existing primary-source filter predates the verified Ya'arot
  // Devash edition. Permit only the exact reviewed JewishBooks URL(s).
  const verifiedURLs=[...new Set(pack.operations.filter(operation=>operation.after).map(operation=>operation.quotation.url)
    .filter(url=>url && /^https:\/\/wiki\.jewishbooks\.org\.il\//.test(url)))].sort();
  const urlMarker='const safeFootnoteUrl = url => '; assert.equal(html.split(urlMarker).length,2);
  html=html.replace(/\/\* Tzidkat reviewed source URLs \*\/[^\n]*\n/g,'');
  if(verifiedURLs.length)html=html.replace(urlMarker,urlMarker+`/* Tzidkat reviewed source URLs */ ${JSON.stringify(verifiedURLs)}.includes(String(url || '')) ||\n`);
  fs.writeFileSync(htmlFile,html);
  const swFile=path.join(library,'sw.js'); let sw=fs.readFileSync(swFile,'utf8'); assert.match(sw,/const SHELL = `[^`]+`;/);
  sw=sw.replace(/-tzidkat-quotes-[a-f0-9]+/g,'').replace(/const SHELL = `([^`]+)`;/,`const SHELL = \`$1-tzidkat-quotes-${pack.packageSha256.slice(0,12)}\`;`);
  fs.writeFileSync(swFile,sw);
  return revision;
}

export function publish(library = 'dist/library', filename = PACK) {
  const pack = readPack(filename), data = path.join(library, 'data'), reportPath = path.join(library, REPORT);
  assert.equal(sha(fs.readFileSync(path.join(data,SLUG,'toc.json'))),pack.tocSha256,'The contents changed after review');
  assert.equal(sha(fs.readFileSync(path.join(data, SLUG, '73.json'))), pack.missing74Sha256, 'The missing-Siman-74 notice changed');
  if (pack.files.every(file=>sha(fs.readFileSync(path.join(library,file.path)))===file.afterSha256)) {
    const report = read(reportPath); assert.equal(report.packageSha256, pack.packageSha256);
    assert.equal(refreshReader(library,pack),report.revision);
    return {...report, mode:'already-applied'};
  }
  const planned = [], touched = new Set(pack.files.map(file=>path.join(library,file.path)));
  for (const file of pack.baselineFiles) assert.equal(sha(fs.readFileSync(path.join(library,file.path))),file.sha256,'A Tzidkat section changed after review: '+file.path);
  const protectedFiles = filesUnder(data).filter(file=>!touched.has(file));
  const protectedSha256 = digest(protectedFiles.map(file=>[path.relative(data,file),sha(fs.readFileSync(file))]));
  for (const file of pack.files) {
    const target = path.join(library,file.path), bytes = fs.readFileSync(target), original = JSON.parse(bytes);
    assert.equal(sha(bytes),file.beforeSha256,'Reader baseline changed: '+file.path);
    assert.equal(digest(body(original)),file.bodySha256);
    const updated = applyOperations(original,pack.operations.filter(operation=>operation.path===file.path));
    const after = JSON.stringify(updated); assert.equal(sha(after),file.afterSha256);
    planned.push([target,after]);
  }
  const allNotes = filesUnder(path.join(data,SLUG)).filter(file=>/\/\d+\.json$/.test(file))
    .flatMap(file=>read(file)).flatMap(row=>row.footnotes || []);
  assert.equal(Math.max(...allNotes.map(note=>note.number)),pack.numbering.maximumNativeNumber);
  const existingNumbers = new Set(allNotes.map(note=>note.number));
  for (const operation of pack.operations.filter(operation=>operation.action==='add')) {
    assert(!existingNumbers.has(operation.after.number),'Repeated native footnote number'); existingNumbers.add(operation.after.number);
  }
  const linksFile=path.join(data,SLUG,'links.json'),links=read(linksFile),additions=[],removedLinks=[];
  for (const operation of pack.operations) for (const correction of operation.inlineCorrections || []) {
    links[operation.sectionRef] = (links[operation.sectionRef] || []).filter(edge => {
      if (edge.a !== operation.originRef || edge.r !== correction.obsoleteRef) return true;
      removedLinks.push({...edge, sectionRef:operation.sectionRef}); return false;
    });
  }
  for (const operation of pack.operations.filter(operation=>operation.after)) {
    const list=links[operation.sectionRef] || (links[operation.sectionRef]=[]), ref=operation.quotation.ref;
    if (!list.some(edge=>edge.a===operation.originRef && edge.r===ref)) {
      const edge={a:operation.originRef,r:ref,c:categoryOf(ref)}; list.push(edge); additions.push(edge);
    }
  }
  for (const [file,contents] of planned) fs.writeFileSync(file,contents);
  assert.equal(digest(protectedFiles.map(file=>[path.relative(data,file),sha(fs.readFileSync(file))])),protectedSha256);
  fs.writeFileSync(linksFile,JSON.stringify(links));
  const cited=path.join(data,'cited'),catalog=read(path.join(data,'catalog.json'));
  const sourceNames=new Set(read(path.join(cited,'index.json')));
  for (const edge of removedLinks) {
    const filename=path.join(cited,sourceSlug(edge.r)+'.json');
    if (!fs.existsSync(filename)) continue;
    const index=read(filename);
    const otherSectionCitation=(links[edge.sectionRef] || []).some(other=>other.r===edge.r);
    const owners=(index[edge.r] || []).filter(owner=>owner!==edge.a && (owner!==edge.sectionRef || otherSectionCitation));
    if (owners.length) index[edge.r]=owners; else delete index[edge.r];
    fs.writeFileSync(filename,JSON.stringify(index));
  }
  for (const edge of additions) {
    const slug=sourceSlug(edge.r),filename=path.join(cited,slug+'.json'),index=fs.existsSync(filename)?read(filename):{};
    const owners=index[edge.r] || (index[edge.r]=[]); if (!owners.includes(edge.a)) owners.push(edge.a);
    fs.writeFileSync(filename,JSON.stringify(index)); sourceNames.add(slug);
  }
  fs.writeFileSync(path.join(cited,'index.json'),JSON.stringify([...sourceNames].sort()));
  const sourcesFile=path.join(data,'packs/sources.json'),sources=read(sourcesFile);
  const external=additions.map(edge=>edge.r).filter(ref=>!catalog.some(book=>ref===book.title || ref.startsWith(book.title+' ') || ref.startsWith(book.title+',')));
  sources.refs=[...new Set([...sources.refs,...external])].sort(); fs.writeFileSync(sourcesFile,JSON.stringify(sources));
  const revision=refreshReader(library,pack);
  const report={schemaVersion:1,release:RELEASE,revision,packageSha256:pack.packageSha256,counts:pack.counts,coverage:pack.coverage,
    files:pack.files,protectedDataFiles:protectedFiles.length,protectedDataSha256:protectedSha256,sourcePDFs:pack.sourcePDFs,
    authorTextPreserved:true,missing74Preserved:true,existingNotesPreservedExceptReviewedOperations:true,
    originalManuscriptNumbersPreserved:true,existingSupplementalNumbersPreserved:true,exactSourceLinksAdded:additions,
    reviewedInlineLocatorCorrections:pack.operations.reduce((count,operation)=>count+(operation.inlineCorrections?.length || 0),0),
    obsoleteSourceLinksRemoved:removedLinks};
  fs.writeFileSync(reportPath,JSON.stringify(report)); return {...report,mode:'applied'};
}

if (process.argv[1] && path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)) {
  const at=process.argv.indexOf('--root'); console.log(JSON.stringify(publish(at<0?'dist/library':process.argv[at+1]),null,2));
}

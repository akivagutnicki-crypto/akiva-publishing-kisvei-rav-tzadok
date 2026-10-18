// Publication checks for Dover's translated opening and revised source footnotes.
// node scripts/test-dover-revisions.mjs [--data-only] [--url https://…/library/] [--zips]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {checkDoverSourceLinks} from './check-dover-source-links.mjs';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
assert.ok(urlIndex < 0 || args[urlIndex + 1], '--url requires a library URL');
const publicBase = urlIndex < 0 ? null : new URL(args[urlIndex + 1]);
if (publicBase && !publicBase.pathname.endsWith('/')) publicBase.pathname += '/';
if (publicBase) publicBase.hash = '';
const release = '20261018-dover-reviewed-parallels-v3';
const root = path.resolve('dist/library');
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const byteHash = value => createHash('sha256').update(value).digest('hex');
const entity = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
const visible = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, key) => {
  if (key[0] === '#') return String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : +key.slice(1));
  return entity[key] ?? all;
});
const norm = value => visible(value).normalize('NFC').replace(/\s+/g, ' ').trim();
const bareHebrew = value => visible(value).replace(/[^\u05d0-\u05ea]/g, '');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const nonnotes = rows => rows.map(row=>row && typeof row === 'object' && !Array.isArray(row) ?
  Object.fromEntries(Object.entries(row).filter(([key])=>key!=='footnotes')) : row);
const bodyFingerprint = rows => hash(stable(nonnotes(rows)));
const read = async file => {
  if (!publicBase) return fs.readFileSync(path.join(root, file));
  const url = new URL(file, publicBase); url.searchParams.set('dover-revision-check', String(Date.now()));
  const response = await fetch(url, {cache:'no-store'});
  assert.ok(response.ok, `${file}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const json = async file => JSON.parse((await read(file)).toString('utf8'));
const report = await json('dover-revisions-report.json');
assert.equal(report.release, release, 'Unexpected Dover revisions release');
const cleanBytes = gunzipSync(fs.readFileSync('sources/akiva/overlays/dover-clean-base-20261018.json.gz'));
const clean = JSON.parse(cleanBytes.toString('utf8'));
const approvedBytes = fs.readFileSync('sources/akiva/footnotes/Dover_Tzedek_Approved_Parallels.json');
const approved = JSON.parse(approvedBytes.toString('utf8'));
assert.equal(approved.book, 'Dover Tzedek');
assert.equal(approved.release, release);
assert.equal(approved.presentation,'english-only','New footnote additions must be English only');
assert.equal(approved.quoteLayout,'one-paragraph-per-source','Reviewed source citations must not repeat between excerpts');
assert.equal(report.parallelPresentation,'english-only','Published addition presentation changed');
const bodyLinkBytes=fs.readFileSync('sources/akiva/overlays/dover-reviewed-body-links-20261018.json');
const bodyLinkReview=JSON.parse(bodyLinkBytes.toString('utf8'));
assert.equal(approved.bodyLinkReviewSha256,byteHash(bodyLinkBytes),'Body-link review requires a current edition revision');
assert.equal(report.bodyLinkReviewSha256,byteHash(bodyLinkBytes),'Published body-link review changed');
const correctionBytes=fs.readFileSync('sources/akiva/overlays/dover-verified-text-corrections-20261018.json');
const correctionPack=JSON.parse(correctionBytes.toString('utf8'));
assert.equal(correctionPack.book,'Dover Tzedek');
assert.equal(correctionPack.release,'20261018-dover-verified-text-corrections-v1');
assert.equal(approved.verifiedTextCorrectionsSha256,byteHash(correctionBytes),'Text repairs require a current reader edition revision');
assert.equal(report.verifiedTextCorrectionsSha256,byteHash(correctionBytes),'Published text-repair proof changed');
assert.ok(correctionPack.corrections?.length,'Verified text-correction list is empty');
assert.equal(correctionPack.sections?.length,clean.sections.length,'Every original body section needs an exact preservation fingerprint');
assert.deepEqual(correctionPack.sections.map(section=>section.file).sort(),clean.sections.map(section=>section.file).sort(),'Exact preservation fingerprints must cover all and only original sections');
const correctionsByLocation=new Map();
for(const correction of correctionPack.corrections) {
  const key=JSON.stringify([correction.file,correction.rowN,correction.phraseIndex]);
  assert.ok(!correctionsByLocation.has(key),'Duplicate verified phrase repair');correctionsByLocation.set(key,correction);
  assert.ok(correction.file!=='0.json'&&clean.sections.some(section=>section.file===correction.file),'A text repair must be in a declared body chapter');
  assert.ok(Number.isInteger(correction.phraseIndex)&&correction.phraseIndex>=0&&correction.reason?.trim(),'Incomplete verified repair location/reason');
  for(const field of ['beforePair','afterPair'])assert.ok(Array.isArray(correction[field])&&correction[field].length===2&&correction[field].every(cell=>typeof cell==='string'),'A verified repair must preserve the phrase-pair schema');
  assert.notDeepEqual(correction.beforePair,correction.afterPair,'Unchanged phrase in repair manifest');
  const [he,en]=correction.afterPair.map(visible);
  assert.ok(he.trim()&&en.trim(),'A repaired phrase has an empty language field');
  if(correction.beforePair[0]!==correction.afterPair[0])assert.ok(![...he].some(char=>/\p{Letter}/u.test(char)&&!/[\u0590-\u05ff\ufb1d-\ufb4f]/u.test(char)),'A repaired Hebrew phrase retains foreign letters');
  assert.ok(!/^[\s\u0590-\u05ff]*[ETl][\s\u0590-\u05ff]*$/u.test(en),'A repaired English field is still an orphan E/T/l fragment');
  assert.ok(!/\(\s*\)|out of\s+being the majority|yielding\s*;/u.test(en),'A repaired mathematical phrase is still incomplete');
  if(correction.beforePair[1]!==correction.afterPair[1])assert.ok(!/[\u0590-\u05ff\ufb1d-\ufb4f]/u.test(en),'A repaired English field retains Hebrew fragments');
  const evidence=correction.primaryEvidence;
  assert.ok(/^sources\/verified\/dover\//.test(evidence?.sourcePath||'')&&!evidence.sourcePath.split('/').includes('..'),'A verified repair needs a repository primary source');
  const proofBytes=fs.readFileSync(evidence.sourcePath);
  assert.equal(byteHash(proofBytes),evidence.sourceSha256,'Verified repair primary proof checksum changed');
  assert.ok(evidence.jsonPointer?.startsWith('/'),'Verified repair needs an exact primary source pointer');
  let proof=JSON.parse(proofBytes.toString('utf8'));
  for(const token of evidence.jsonPointer.slice(1).split('/'))proof=proof[token.replace(/~1/g,'/').replace(/~0/g,'~')];
  const textOf=value=>typeof value==='string'?value:Array.isArray(value)?value.map(textOf).join(' '):assert.fail('Primary proof pointer must resolve to full text');
  assert.ok(bareHebrew(evidence.exactHebrewExcerpt)&&bareHebrew(textOf(proof)).includes(bareHebrew(evidence.exactHebrewExcerpt)),'Verified repair excerpt is absent from its full primary proof');
}
const anchorUpdates=new Map();
for(const update of correctionPack.anchorUpdates||[]) {
  assert.ok(!anchorUpdates.has(update.sourceId),'Duplicate corrected English anchor');anchorUpdates.set(update.sourceId,update);
  for(const field of ['before','after'])assert.deepEqual(Object.keys(update[field]||{}).sort(),['enAnchorPrefix','enCharOffset'],'A repair may change only exact English anchor fields');
  assert.equal(update.after.enAnchorPrefix.length,update.after.enCharOffset,'Corrected English anchor prefix/offset disagree');
}
assert.ok(approved.replacements.length, 'No individually reviewed replacements supplied');
assert.equal(report.cleanedSourceSha256, byteHash(cleanBytes), 'Clean source checksum changed');
assert.equal(report.approvedSourcesSha256, byteHash(approvedBytes), 'Approved source checksum changed');
assert.deepEqual(report.reviewedParallels, approved.replacements, 'Publication differs from the reviewed Hebrew, translation or source context');
const original = new Map(clean.notes.map(entry => [entry.note.number, entry]));
const quarantined = new Map(clean.quarantinedNotes.map(entry => [entry.note.number, entry]));
assert.equal(original.size, clean.notes.length, 'Duplicate retained baseline note');
assert.equal(quarantined.size, clean.quarantinedNotes.length, 'Duplicate quarantined note');
assert.ok([...original.keys()].every(number => !quarantined.has(number)), 'A quarantined note remains in the clean baseline');
// Reviewed sources may need a Hebrew anchor the original edition never had. Such anchors take
// fresh numbers above the 2,698 original notes and never move or reuse an original number.
const created = new Map((approved.newPlacements||[]).map(record => [record.number, {file:record.file, paragraph:record.paragraph, note:record}]));
assert.equal(created.size, (approved.newPlacements||[]).length, 'Duplicate new placement number');
const takenAnchors = new Set([...clean.notes, ...clean.quarantinedNotes].map(entry => JSON.stringify([entry.file, entry.paragraph, entry.note.phraseIndex, entry.note.heWord])));
for (const [number, entry] of created) {
  assert.ok(Number.isInteger(number) && number > 2698 && !original.has(number) && !quarantined.has(number), 'A new placement reuses an original note number');
  assert.equal(entry.note.sourceId, 'DT-'+String(number).padStart(4,'0'), 'Invalid new placement source ID');
  assert.equal(entry.note.placementId, entry.note.sourceId+'-1', 'Invalid new placement ID');
  assert.ok(String(entry.note.reason||'').trim(), 'A new placement must state its reason');
  const key = JSON.stringify([entry.file, entry.paragraph, entry.note.phraseIndex, entry.note.heWord]);
  assert.ok(!takenAnchors.has(key), 'A new placement duplicates an existing Hebrew anchor');
  takenAnchors.add(key);
}
const replacements = new Map(), canonicalRefs = new Set(), quoteKeys = new Set(), approvedIds = new Set();
const refKey = value => String(value).normalize('NFC').toLowerCase().replace(/[\s_]+/g,' ').trim();
const expectedAdditions = replacement => {
  const label = `${replacement.corpus} — ${replacement.displayCitation || replacement.sourceRef}`;
  const passages = replacement.excerpts || [replacement];
  return [{text:`${label}: “${passages.map(passage=>passage.englishQuote).join(' […] ')}”`, language:'en', approvedParallelId:replacement.id}];
};
for (const replacement of approved.replacements) {
  assert.ok(replacement.id && !approvedIds.has(replacement.id), 'Duplicate approved replacement ID');
  approvedIds.add(replacement.id);
  assert.match(replacement.targetSourceId, /^DT-\d{4}$/);
  assert.equal(replacement.targetPlacementId, replacement.targetSourceId+'-1');
  const number = +replacement.targetSourceId.slice(3);
  assert.ok(original.has(number) || quarantined.has(number) || created.has(number), 'Approved replacement has no Hebrew anchor');
  const key = refKey(replacement.canonicalRef);
  assert.ok(key && !canonicalRefs.has(key), 'A canonical source passage is used more than once');
  canonicalRefs.add(key);
  assert.ok(replacement.contextAssessment?.trim(), 'Approved source has no contextual assessment');
  assert.ok(replacement.explanatoryValue?.trim(),'Approved source does not explain what it adds');
  assert.ok(replacement.evidence?.sourceHebrew?.trim(), 'Approved source has no complete Hebrew context');
  assert.equal(hash(replacement.evidence.sourceHebrew), replacement.evidence.sourceHebrewSha256, 'Approved Hebrew context checksum changed');
  let cursor = 0;
  const sourceText = bareHebrew(replacement.evidence.sourceHebrew);
  for (const passage of replacement.excerpts || [replacement]) {
    assert.ok(passage.hebrewQuote?.trim() && passage.englishQuote?.trim(), 'Approved passage needs complete Hebrew and English');
    const quote = bareHebrew(passage.hebrewQuote), position = sourceText.indexOf(quote, cursor);
    assert.ok(quote && position >= cursor, 'Approved Hebrew quotation is not an exact ordered excerpt of its supplied source context');
    cursor = position + quote.length;
    assert.ok(!quoteKeys.has(quote), 'A Hebrew source quotation is repeated');
    quoteKeys.add(quote);
  }
  (replacements.get(number) || replacements.set(number, []).get(number)).push(replacement);
}
const finalNumbers = new Set([...original.keys(), ...replacements.keys()]);
assert.ok([...created.keys()].every(number=>replacements.has(number)), 'A new placement has no approved source');
const finalQuarantined = [...quarantined.keys()].filter(number=>!replacements.has(number));
assert.deepEqual([...report.quarantinedNumbers].sort((a,b)=>a-b), finalQuarantined.sort((a,b)=>a-b), 'Final quarantine manifest changed');
const expected = new Map(report.expectedNotes.map(note => [note.number,note]));
assert.equal(expected.size, report.expectedNotes.length, 'Duplicate final stable footnote number');
assert.deepEqual([...expected.keys()].sort((a,b)=>a-b), [...finalNumbers].sort((a,b)=>a-b), 'Final note set differs from clean baseline and approved restorations');
assert.equal(report.notes, finalNumbers.size);
assert.equal(report.counts.retainedBaseNotes, original.size);
assert.equal(report.counts.quarantinedNotes, finalQuarantined.length);
assert.equal(report.counts.restoredNotes, [...replacements.keys()].filter(number=>quarantined.has(number)).length);
assert.equal(report.counts.newPlacements ?? 0, created.size, 'New placement count changed');
assert.equal(report.counts.retainedBaseParagraphs, clean.notes.reduce((count,entry)=>count+entry.note.paragraphs.length,0));
assert.equal(report.counts.approvedReplacements, approved.replacements.length);
const rejectedHashes = new Set(clean.rejectedTextHashes);
assert.ok(clean.rejectedTextHashes.length > 5000, 'Historical rejected-paragraph manifest is incomplete');
assert.ok([...rejectedHashes].every(value=>/^[a-f0-9]{64}$/.test(value)), 'Invalid rejected paragraph checksum');
assert.equal(report.counts.rejectedParagraphsRemoved, clean.removedParagraphCount);
assert.equal(report.counts.contentSections, 15);
assert.equal(report.counts.addedHebrewLinks,bodyLinkReview.counts.legacyHebrewLinksAddedAfter);
assert.equal(report.counts.removedUnsupportedBodyLinks,bodyLinkReview.removeWrappers.length);
assert.equal(report.counts.bodyChanges,correctionPack.corrections.length);
assert.equal(report.sections.length, 16);
assert.equal(clean.sections.length, 16, 'Clean source must anchor every chapter body');
const reviewedSourceGraph=await json('data/dover-tzedek/links.json');
for(const {sectionRef,edge} of bodyLinkReview.graph.existingV2EdgeUnsupportedAfterUnwrap)
  assert.ok(!(reviewedSourceGraph[sectionRef]||[]).some(item=>item.a===edge.a&&item.r===edge.r&&item.source===edge.source),'An unsupported body-link connection survived');
for(const {sectionRef,edge} of bodyLinkReview.graph.otherV2EdgesRetainIndependentPrimaryEvidence)
  assert.ok((reviewedSourceGraph[sectionRef]||[]).some(item=>item.a===edge.a&&item.r===edge.r&&item.source===edge.source),'A connection supported by a retained primary quotation was removed');
const toc = await json('data/dover-tzedek/toc.json');
assert.equal(toc.revisedFootnotes.release, release);
assert.equal(toc.revisedFootnotes.notes, finalNumbers.size);
assert.equal(toc.revisedFootnotes.report, 'dover-revisions-report.json');
const headingPack=JSON.parse(fs.readFileSync('sources/akiva/headings/Dover_Tzedek.json','utf8'));
const headingReview=JSON.parse(gunzipSync(fs.readFileSync('editorial/dover-kdp-headings-review.json.gz')).toString());
assert.equal(headingPack.book,'Dover Tzedek');
assert.equal(headingPack.outline,true,'Dover contents must include sections and subsections');
const leavesOf=node=>node.children?node.children.flatMap(leavesOf):[node];
const leaves=new Map(leavesOf(toc.toc).map(leaf=>[leaf.ref,leaf]));
const miscellanyNames=['Ki Savo','Vayeishev','Avodah Zarah','Acharei Mos'];
const miscellany=leaves.get('Dover Tzedek, Miscellany');
assert.ok(miscellany,'Canonical Miscellany reference must remain available');
assert.equal(miscellany.id,5,'Canonical Miscellany file ID changed');
assert.equal(miscellany.en,'Additional Teachings');
assert.deepEqual(miscellany.chapterTitles,miscellanyNames);
assert.equal(miscellany.chapterTitleDisplay,true);
for(const [node,titles] of Object.entries(headingPack.chapterTitles||{})) {
  const leaf=leaves.get('Dover Tzedek, '+node);
  assert.ok(leaf,'Heading pack references missing node '+node);
  assert.deepEqual(leaf.chapterTitles,titles,'Chapter display titles changed '+node);
  assert.equal(leaf.chapterTitleDisplay,true,'Chapter display title flag missing '+node);
}
for(const [node,title] of Object.entries(headingPack.nodeTitles||{}))
  assert.equal(leaves.get('Dover Tzedek, '+node)?.en,title,'Node display title changed '+node);
const titlePack = JSON.parse(fs.readFileSync('sources/akiva/parts/Dover_Tzedek_Title_Page.json','utf8'));
const titleCanonical = JSON.parse(fs.readFileSync('sources/sefaria/Dover_Tzedek.json','utf8')).text['Title Page'];
assert.equal(titlePack.presentation,'paragraphs','Opening must be translated paragraph by paragraph');
assert.deepEqual(titlePack.sourceParagraphs,titleCanonical,'Original opening Hebrew source changed');
assert.equal(titlePack.chapters['1'].length,9,'Opening translation must retain nine paragraphs');
const titleLeaf = toc.toc.children[0];
assert.equal(titleLeaf.ref,'Dover Tzedek, Title Page','Opening must precede Eruvin');
assert.equal(titleLeaf.id,0);
assert.equal(titleLeaf.shape,9);
assert.equal(titleLeaf.presentation,'paragraphs');
assert.equal(titleLeaf.bi1,true);
assert.ok(!titleLeaf.il1,'Opening must not be labelled interlinear');
assert.equal(report.titleTranslation.release,'20261018-dover-title-paragraphs-v1');
assert.equal(report.titleTranslation.presentation,'paragraphs');
assert.equal(report.titleTranslation.paragraphs,9);
assert.equal(report.titleTranslation.sourceHebrewSha256,hash(titleCanonical.map(norm)));
assert.deepEqual(toc.titleTranslation,report.titleTranslation);
const sections = new Map();
const seen = new Set();
const rejected = /Context and connection to Dover Tzedek:|Connection to this note:|Extended English quotation from Akiva interlinear:/i;
let retainedParagraphs = 0, linksAdded = 0, quoteParagraphs = 0, approvedParagraphs = 0;
for (const entry of report.sections) {
  assert.ok(/^\d+(?:-\d+)?\.json$/.test(entry.file), 'Invalid Dover chapter path');
  const baselineSection = clean.sections.find(section=>section.file===entry.file);
  assert.ok(baselineSection, 'No independent body baseline for '+entry.file);
  assert.equal(entry.ref,baselineSection.ref,'Clean section reference changed '+entry.file);
  for (const [key,baselineKey] of [['heSha256','baselineHeSha256'],['enSha256','baselineEnSha256']])
    assert.equal(entry[baselineKey], baselineSection[key], 'Original body baseline changed '+entry.file+': '+key);
  const removedBodyLinks=bodyLinkReview.removeWrappers.filter(record=>record.file===entry.file);
  assert.equal(entry.heLinks,baselineSection.heLinks-removedBodyLinks.filter(record=>record.languageIndex===0).length,'Wrong reviewed Hebrew link count');
  assert.equal(entry.enLinks,baselineSection.enLinks-removedBodyLinks.filter(record=>record.languageIndex===1).length,'Wrong reviewed English link count');
  const rows = await json('data/dover-tzedek/' + entry.file);
  const sectionCorrections=correctionPack.corrections.filter(record=>record.file===entry.file);
  assert.equal(entry.bodyChanges,sectionCorrections.length,'Wrong verified phrase-repair count '+entry.file);
  const fingerprint=correctionPack.sections.find(section=>section.file===entry.file);
  assert.equal(bodyFingerprint(rows),fingerprint.afterNonNotesSha256,'An undeclared body/header field changed '+entry.file);
  const originalRows=structuredClone(rows);
  for(const correction of sectionCorrections) {
    const matches=originalRows.filter(row=>row?.p&&row.n===correction.rowN);
    assert.equal(matches.length,1,'Verified phrase repair row moved');
    assert.deepEqual(matches[0].p[correction.phraseIndex],correction.afterPair,'A finite verified phrase repair is missing or altered');
    matches[0].p[correction.phraseIndex]=structuredClone(correction.beforePair);
  }
  assert.equal(bodyFingerprint(originalRows),fingerprint.beforeNonNotesSha256,'Fields beyond the finite phrase repairs changed '+entry.file);
  for(const record of removedBodyLinks) {
    const row=rows[record.rowIndex];assert.equal(row.n,record.rowN,'Reviewed body-link row moved');
    const cell=row.p[record.phraseIndex][record.languageIndex];
    assert.equal(hash(cell),record.outputCellSha256,'Unsupported guessed body link remains');
    assert.ok(cell.includes(record.innerHTML),'Source words lost when removing an unsupported link');
  }
  for(const record of bodyLinkReview.retainExplicitNamedWrappers.filter(record=>record.file===entry.file))
    assert.ok(rows[record.rowIndex].p[record.phraseIndex][record.languageIndex].includes(record.outerHTML),'A directly named source link was removed');
  sections.set(entry.file, {entry,rows});
  for (const [language,key] of [[0,'heSha256'],[1,'enSha256']]) {
    const normalized = rows.filter(row=>row.p).map(row=>[row.n,row.p.map(pair=>norm(pair[language]))]);
    assert.equal(hash(normalized), entry[key], `Body text changed: ${entry.file}, language ${language}`);
    const restored=originalRows.filter(row=>row.p).map(row=>[row.n,row.p.map(pair=>norm(pair[language]))]);
    assert.equal(hash(restored),baselineSection[key],`Text beyond verified repairs changed: ${entry.file}, language ${language}`);
  }
  const anchors = language => rows.filter(row=>row.p).flatMap(row=>row.p.map(pair=>pair[language])).reduce((count,text)=>count+(String(text).match(/data-ref=["']/gi)||[]).length,0);
  assert.equal(anchors(0),entry.heLinks, 'Hebrew link count '+entry.file);
  assert.equal(anchors(1),entry.enLinks, 'English link count '+entry.file);
  assert.equal(entry.heLinks-entry.baselineHeLinks,entry.addedHebrewLinks,'Added Hebrew link count '+entry.file);
  assert.equal(entry.enLinks,entry.baselineEnLinks,'English source links changed '+entry.file);
  linksAdded += entry.addedHebrewLinks;
  for (const item of rows) for (const note of item.footnotes || []) {
    const label = `${entry.file}, footnote ${note.number}`;
    assert.ok(!seen.has(note.number), 'Duplicate '+label); seen.add(note.number);
    const source = expected.get(note.number), baseline = original.get(note.number);
    const anchor = baseline || quarantined.get(note.number) || created.get(note.number);
    const old = anchor?.note;
    assert.ok(source && old, 'Unknown stable number '+label);
    assert.equal(source.file, entry.file, 'Wrong chapter '+label);
    assert.equal(source.paragraph, item.n, 'Wrong reader paragraph '+label);
    assert.equal(anchor.file, entry.file, 'Clean baseline chapter changed '+label);
    assert.equal(anchor.paragraph, item.n, 'Clean baseline paragraph changed '+label);
    for (const key of ['phraseIndex','heWord','heWordText','heCharOffset','heAnchorPrefix','enCharOffset','enAnchorPrefix','sourceId','placementId'])
      assert.equal(note[key],source[key],`Changed ${key}: ${label}`);
    for (const key of ['phraseIndex','heWord','heWordText','heCharOffset','heAnchorPrefix'])
      assert.equal(note[key],old[key],`Clean Hebrew anchor changed ${key}: ${label}`);
    const anchorUpdate=anchorUpdates.get(note.sourceId);
    for(const key of ['enCharOffset','enAnchorPrefix']) {
      if(anchorUpdate)assert.equal(anchorUpdate.before[key],old[key],'Original English repair anchor differs from the clean source '+label);
      assert.equal(note[key],anchorUpdate?anchorUpdate.after[key]:old[key],'English anchor changed beyond the finite verified updates '+label);
    }
    if(anchorUpdate) {
      assert.ok(correctionsByLocation.has(JSON.stringify([entry.file,item.n,note.phraseIndex])),'Updated English anchor has no declared phrase repair '+label);
      assert.equal(visible(item.p[note.phraseIndex][1]).slice(0,note.enCharOffset),note.enAnchorPrefix,'Repaired English anchor misses its exact phrase '+label);
    }
    assert.equal(note.sourceId, 'DT-'+String(note.number).padStart(4,'0'), 'Changed stable source ID '+label);
    assert.equal(note.placementId,note.sourceId+'-1', 'Changed stable placement ID '+label);
    assert.deepEqual(note.paragraphs,source.paragraphs, 'Incomplete published quotation '+label);
    const baselineParagraphs = baseline?.note.paragraphs || [];
    assert.deepEqual(source.baselineParagraphs, baselineParagraphs, 'Retained baseline report changed '+label);
    assert.equal(source.originalParagraphCount,baselineParagraphs.length, 'Retained paragraph count '+label);
    assert.deepEqual(note.paragraphs.slice(0,baselineParagraphs.length),baselineParagraphs,'Lost or changed retained quotation '+label);
    retainedParagraphs += baselineParagraphs.length;
    const additions = note.paragraphs.slice(baselineParagraphs.length);
    const approvedForNote = replacements.get(note.number) || [];
    assert.deepEqual(note.reviewedParallelIds || [], approvedForNote.map(replacement=>replacement.id), 'Wrong approved passage IDs '+label);
    assert.deepEqual(additions.map(({text,language,approvedParallelId})=>({text,language,approvedParallelId})),
      approvedForNote.flatMap(expectedAdditions), 'Approved English translation or context changed '+label);
    approvedParagraphs += additions.length;
    for (const paragraph of additions) {
      assert.ok(approvedIds.has(paragraph.approvedParallelId), 'Unapproved paragraph '+label);
      assert.equal(paragraph.language,'en','New additions must be English only '+label);
      assert.ok(!/[\u0590-\u05ff\ufb1d-\ufb4f]/u.test(paragraph.text),'Added Hebrew remains in footnote '+label);
      if (paragraph.text!=='[…]') {
        const replacement=approvedForNote.find(item=>item.id===paragraph.approvedParallelId);
        const labelText=`${replacement.corpus} — ${replacement.displayCitation || replacement.sourceRef}`;
        const url=new URL(replacement.sourceUrl);
        const href=url.hostname==='akivagutnicki-crypto.github.io' && url.hash.startsWith('#/read/') ? url.hash : replacement.sourceUrl;
        assert.equal(paragraph.rich?.[0]?.text,labelText,'Incorrect approved source label '+label);
        assert.equal(paragraph.rich?.[0]?.bold,true,'Approved citation must be bold '+label);
        assert.equal(paragraph.rich?.[0]?.href,href,'Approved source link changed '+label);
        assert.equal(paragraph.rich?.length,2,'Approved citation and quotation must remain distinct '+label);
        assert.equal(paragraph.rich[1].text,paragraph.text.slice(labelText.length),'Approved quotation run changed '+label);
        assert.ok(!paragraph.rich[1].bold,'Approved quotation must use regular type '+label);
      }
    }
    const phrase = item.p?.[note.phraseIndex]?.[0];
    assert.ok(typeof phrase === 'string', 'Missing Hebrew phrase '+label);
    const text = visible(phrase), words = text.split(/\s+/).filter(Boolean);
    assert.ok(note.heWord >= 1 && note.heWord <= words.length,'No Hebrew word '+label);
    if (old.heWordText) assert.equal(bareHebrew(words[note.heWord-1]),old.heWordText,'Moved Hebrew word '+label);
    if (Number.isInteger(note.heCharOffset)) {
      assert.ok(note.heCharOffset > 0 && note.heCharOffset <= text.length,'Invalid Hebrew character position '+label);
      assert.equal(text.slice(0,note.heCharOffset),note.heAnchorPrefix,'Changed Hebrew prefix '+label);
    }
    for (const paragraph of note.paragraphs) {
      assert.ok(paragraph.text?.trim(), 'Empty quotation '+label);
      assert.ok(!rejected.test(paragraph.text) && !/^Sources:\s/.test(paragraph.text), 'Editorial boilerplate '+label);
      assert.ok(!rejectedHashes.has(hash(norm(paragraph.text))), 'A rejected historical paragraph returned '+label);
      assert.ok(!/^(?:Kisvei Rav Tzadok Parallel\b|Kisvei Beis Ishbitz[–— -]*Radzin Parallel\b|Parallel:)/.test(paragraph.text), 'An unreviewed historical parallel returned '+label);
      if (paragraph.rich?.length) assert.equal(paragraph.rich.map(run=>run.text||'').join(''),paragraph.text,'Rich text differs from full quotation '+label);
      quoteParagraphs++;
    }
  }
}
assert.ok([...anchorUpdates.keys()].every(sourceId=>seen.has(+sourceId.slice(3))),'A declared English anchor correction was not published');
const titleSection=sections.get('0.json');
assert.equal(titleSection.rows.length,9,'Opening lost an original paragraph');
for(const [index,row] of titleSection.rows.entries()) {
  assert.equal(row.n,index+1,'Opening paragraph order');
  assert.equal(row.paragraphTranslation,true,'Opening paragraph presentation flag');
  assert.equal(row.p.length,1,'Opening paragraph must not be split into phrase pairs');
  assert.ok(!row.footnotes?.length,'Opening must not change Dover footnote numbering');
  assert.equal(norm(row.p[0][0]),norm(titleCanonical[index]),'Opening Hebrew changed '+row.n);
  assert.equal(norm(row.p[0][1]),norm(titlePack.chapters['1'][index].p[0][1]),'Incomplete opening English '+row.n);
  assert.ok(norm(row.p[0][1]),'Missing opening English '+row.n);
}
for(const key of ['heSha256','enSha256']) assert.equal(report.titleTranslation[key],titleSection.entry[key]);
let kdpParagraphHeadings=0,kdpInlineHeadings=0;
for(const [node,byParagraph] of Object.entries(headingPack.headings||{})) {
  for(const [location,text] of Object.entries(byParagraph)) {
    const [chapter,paragraph]=location.split(':').map(Number);
    const section=[...sections.values()].find(section=>section.entry.ref===`Dover Tzedek, ${node} ${chapter}`);
    assert.ok(section,'Missing headed Dover chapter '+node+' '+chapter);
    const position=section.rows.findIndex(row=>row.p&&row.n===paragraph);
    assert.ok(position>=0,'Missing headed Dover paragraph '+node+' '+location);
    const preceding=[];
    for(let index=position-1;index>=0&&section.rows[index].h;index--) preceding.push(section.rows[index].h);
    assert.ok(preceding.includes(text),'KDP heading moved or missing '+node+' '+location+': '+text);
    assert.ok(/[A-Za-z]/.test(text),'KDP heading must contain English '+location);
    const anchor=headingPack.anchors?.[node]?.[location];
    if(anchor) assert.ok(bareHebrew(section.rows[position].p.map(pair=>pair[0]).join(' ')).startsWith(bareHebrew(anchor)),'KDP heading paragraph anchor changed '+node+' '+location);
    kdpParagraphHeadings++;
  }
}
for(const [node,byParagraph] of Object.entries(headingPack.inlineHeadings||{})) {
  for(const [location,headings] of Object.entries(byParagraph)) {
    const [chapter,paragraph]=location.split(':').map(Number);
    const section=[...sections.values()].find(section=>section.entry.ref===`Dover Tzedek, ${node} ${chapter}`);
    const row=section?.rows.find(row=>row.p&&row.n===paragraph);
    assert.ok(row,'Missing KDP subheading paragraph '+node+' '+location);
    for(const heading of headings) {
      assert.ok(row.inlineHeadings?.some(actual=>actual.phraseIndex===heading.phraseIndex&&actual.text===heading.text&&(actual.kind||'topic')===(heading.kind||'topic')),'KDP inline subheading moved or missing '+node+' '+location);
      assert.ok(Number.isInteger(heading.phraseIndex)&&row.p[heading.phraseIndex],'KDP subheading phrase missing '+location);
      if(heading.anchor) assert.ok(bareHebrew(row.p[heading.phraseIndex][0]).startsWith(bareHebrew(heading.anchor)),'KDP subheading phrase anchor changed '+node+' '+location);
      kdpInlineHeadings++;
    }
  }
}
for(const section of sections.values()) if(section.entry.file!=='0.json')
  assert.ok(section.rows.some(row=>row.h||row.inlineHeadings?.length),'Dover chapter has no English headings '+section.entry.ref);
assert.ok(kdpParagraphHeadings+kdpInlineHeadings>15,'KDP headings must cover the full Dover text');
let outlineChapters=0,outlineTopics=0;
for(const [nodeRef,leaf] of leaves) if(leaf.depth===2) {
  const node=nodeRef.replace('Dover Tzedek, ','');
  assert.equal(leaf.chapterOutlines?.length,leaf.shape.length,'Missing chapter contents '+nodeRef);
  for(let chapter=1;chapter<=leaf.shape.length;chapter++) {
    const expected=[];
    for(const [location,text] of Object.entries(headingPack.headings?.[node]||{})) {
      const [ch,paragraph]=location.split(':').map(Number);
      if(ch===chapter) expected.push({paragraph,entry:{title:text.replace(/^§ /,''),ref:`${nodeRef} ${chapter}:${paragraph}`,kind:text.startsWith('§ ')?'section':'topic'}});
    }
    for(const [location,headings] of Object.entries(headingPack.inlineHeadings?.[node]||{})) {
      const [ch,paragraph]=location.split(':').map(Number);
      if(ch===chapter) for(const heading of headings) expected.push({paragraph,entry:{title:heading.text,ref:`${nodeRef} ${chapter}:${paragraph}`,kind:heading.kind||'topic',phraseIndex:heading.phraseIndex}});
    }
    expected.sort((a,b)=>a.paragraph-b.paragraph||(a.entry.phraseIndex??-1)-(b.entry.phraseIndex??-1));
    assert.ok(expected.length,'Chapter outline must contain its KDP topics '+nodeRef+' '+chapter);
    assert.deepEqual(leaf.chapterOutlines[chapter-1],expected.map(item=>item.entry),'Contents topics do not match their actual KDP heading locations '+nodeRef+' '+chapter);
    outlineChapters++;outlineTopics+=expected.length;
  }
}
assert.equal(outlineChapters,15,'All Dover content chapters need section contents');
assert.equal(outlineTopics,kdpParagraphHeadings+kdpInlineHeadings,'Lost or duplicated contents heading');
assert.equal(outlineTopics,headingReview.counts.headingsAndSubheadings,'Contents do not cover the reviewed KDP headings and adaptations');
assert.equal(headingReview.counts.kdpTopics,333,'Expected all KDP source headlines');
const readerHtml=(await read('index.html')).toString();
const editionUrlDeclaration=readerHtml.match(/^const editionDataUrl = [\s\S]*?;\s*(?=const catalogReady)/m)?.[0];
assert.ok(editionUrlDeclaration,'Reader edition URL resolver missing');
const doverEditionUrl=vm.runInNewContext(editionUrlDeclaration+"\neditionDataUrl('data/dover-tzedek/toc.json')");
const doverEditionKey=new URL(doverEditionUrl,'https://reader.example/library/').searchParams.get('edition');
const approvedCacheRevision=report.approvedSourcesSha256.slice(0,12);
const reviewedCacheRevisions=key=>[...(key||'').matchAll(/-dover-reviewed-parallels-v3(?:-([0-9a-f]{12}))?(?=-|$)/g)].map(match=>match[1]);
assert.deepEqual(reviewedCacheRevisions(doverEditionKey),[approvedCacheRevision],'Dover edition URL must refresh for the current approved source content');
const shellVersion=(await read('sw.js')).toString().match(/^const SHELL = `([^`]+)`;/m)?.[1];
assert.ok(shellVersion?.includes('-dover-title-paragraphs-v1'),'Opening app refresh version missing');
assert.ok(shellVersion?.includes('-dover-headings-v1'),'Dover headings app refresh version missing');
assert.deepEqual(reviewedCacheRevisions(shellVersion),[approvedCacheRevision],'Dover shell cache must refresh for the current approved source content');
// Installed readers may retain the old contents file while receiving new text.
// The row flag must still select paragraph presentation in that mixed state.
const localResolver=readerHtml.slice(readerHtml.indexOf('let CATALOG = []'),readerHtml.indexOf('const CAT_COLORS'));
for(const oldContents of [false,true]) {
  const contents=structuredClone(toc);
  if(oldContents) {delete contents.toc.children[0].presentation;delete contents.toc.children[0].bi1;}
  const context=vm.createContext({gematria:String,fetch:async url=>({ok:true,json:async()=>{
    const file=url.split('?')[0];
    if(file==='data/catalog.json') return [{title:toc.title,he:toc.he,slug:'dover-tzedek',version:toc.version}];
    if(file==='data/dover-tzedek/toc.json') return contents;
    return json(file);
  }})});
  vm.runInContext(localResolver,context);
  const resolved=await context.resolveLocal(titleLeaf.ref);
  assert.equal(resolved.paragraphTranslation,true,'Opening presentation with '+(oldContents?'saved':'current')+' contents');
  assert.equal(resolved.he.length,9);
  assert.equal(resolved.en.length,9);
  assert.equal(resolved.next,'Dover Tzedek, Kuntres Dover Tzedek, Eruvin 1','Opening next section');
  assert.equal(resolved.prev,null,'Opening must remain first');
  assert.equal(resolved.versions[0].title,'Akiva Publishing paragraph translation');
  for(const [index,title] of miscellanyNames.entries()) {
    const ref='Dover Tzedek, Miscellany '+(index+1);
    const resolved=await context.resolveLocal(ref);
    assert.equal(resolved.sectionRef,ref,'Named section changed canonical reference');
    assert.equal(resolved.studyHeading,title,'Named section heading');
    assert.equal(resolved.displayTitle,'Dover Tzedek — '+title,'Named section reader title');
    assert.equal(resolved.he.length,miscellany.shape[index],'Named section paragraph count changed');
  }
}
assert.equal(seen.size,finalNumbers.size,'Some clean or approved Dover footnotes are missing');
assert.equal(retainedParagraphs,report.counts.retainedBaseParagraphs,'Lost retained baseline quotations');
assert.equal(approvedParagraphs,approved.replacements.flatMap(expectedAdditions).length,'Lost approved English paragraphs');
assert.equal(linksAdded,bodyLinkReview.counts.legacyHebrewLinksAddedAfter,'Missing verified Hebrew hyperlinks');
console.log(`PASS Dover reviewed data${publicBase?' publicly verified':''}: ${seen.size} anchored notes, ${retainedParagraphs} retained quotation paragraphs, ${approved.replacements.length} distinct approved sources with verified Hebrew evidence and English-only additions; ${correctionPack.corrections.length} finite primary-verified phrase repairs; every other body/header field, opening and contents preserved (${quoteParagraphs} quotation paragraphs).`);
if(!publicBase) await checkDoverSourceLinks();

if (args.includes('--zips')) {
  const {unzipSync} = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
  const downloads = await json('downloads/index.json');
  const entry = downloads.books.find(book=>book.slug==='dover-tzedek');
  assert.ok(entry,'Dover ZIP missing from download manifest');
  const bytes = await read(entry.file);
  assert.equal(bytes.length,entry.bytes,'Dover ZIP byte count');
  const contents = unzipSync(bytes);
  for (const {entry:section,rows} of sections.values()) {
    const file = 'data/dover-tzedek/'+section.file;
    assert.ok(contents[file],'Dover ZIP lacks '+file);
    assert.deepEqual(JSON.parse(Buffer.from(contents[file]).toString()),rows,'Dover ZIP has stale '+file);
  }
  assert.deepEqual(JSON.parse(Buffer.from(contents['data/dover-tzedek/toc.json']).toString()),toc,'Dover ZIP has stale contents');
  const sourceLinks=await json('data/dover-tzedek/links.json');
  assert.deepEqual(JSON.parse(Buffer.from(contents['data/dover-tzedek/links.json']).toString()),sourceLinks,'Dover ZIP has stale source connections');
  console.log('PASS downloadable Dover ZIP contains the current full quotations, anchors and Hebrew hyperlinks.');
}
if (args.includes('--data-only')) process.exit(0);

let playwright;
try { playwright = await import('playwright'); }
catch (error) {
  const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  if (!modules) throw error;
  playwright = await import(pathToFileURL(path.join(modules,'playwright/index.mjs')).href);
}
let server,base = publicBase?.href;
if (!base) {
  server = http.createServer((req,res)=>{
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file = path.resolve(root,'./'+pathname.replace(/^\/library\//,''));
    if (file !== root && !file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
      res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'})[path.extname(file)]||'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}/library/`;
}
const chapterHash = ref => '#/read/'+encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const topicHash=entry=>{
  const params=new URLSearchParams({heading:entry.title});
  if(Number.isInteger(entry.phraseIndex)) params.set('topic',entry.phraseIndex);
  return chapterHash(entry.ref)+'?'+params;
};
const outlineEntries=[...leaves.values()].flatMap(leaf=>leaf.chapterOutlines?.flat()||[]);
const assertHeadingInViewport=async(page,selector,message)=>{
  let ready=true;
  try {
    await page.waitForFunction(selector=>[...document.querySelectorAll('#text '+selector)].some(element=>{
      const box=element.getBoundingClientRect();return element.classList.contains('flash')&&box.height>0&&box.top>=-1&&box.bottom<=innerHeight+1;
    }),selector,{timeout:10000});
  } catch {ready=false;}
  const bounds=await page.locator('#text '+selector).evaluateAll(elements=>elements.map(element=>{
    const box=element.getBoundingClientRect();
    return {top:box.top,bottom:box.bottom,height:box.height,viewportHeight:innerHeight,viewportWidth:innerWidth,
      scrollY,fonts:document.fonts?.status,jumpApplied:element.classList.contains('flash')};
  }));
  const visible=ready&&bounds.some(box=>box.jumpApplied&&box.height>0&&box.top>=-1&&box.bottom<=box.viewportHeight+1);
  if(!visible) {
    const directory='dover-reader-verification',name='heading-jump-'+Date.now();
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify({message,url:page.url(),bounds},null,2));
    await page.screenshot({path:path.join(directory,name+'.png'),fullPage:false});
  }
  assert.ok(visible,message+': '+JSON.stringify(bounds));
};
const targets = [];
const walk = node => {
  if (node.children) node.children.forEach(walk);
  else if (node.ref && node.id !== 0) {
    const ref = node.ref+' 1';
    const target = [...sections.values()].find(section=>section.entry.ref===ref);
    assert.ok(target,'TOC chapter missing from revision report '+ref);
    targets.push(target);
  }
};
walk(toc.toc);
assert.equal(targets.length,5,'Expected the five Dover content nodes');
const tocTargets=[...targets];
const largest=[...sections.values()].filter(section=>section.entry.file!=='0.json').sort((a,b)=>
  b.rows.reduce((n,row)=>n+(row.footnotes?.length||0),0)-a.rows.reduce((n,row)=>n+(row.footnotes?.length||0),0)).slice(0,2);
for(const section of largest) if(!targets.some(target=>target.entry.file===section.entry.file)) targets.push(section);
for(let chapter=1;chapter<=4;chapter++) {
  const section=sections.get('5-'+chapter+'.json');
  if(!targets.some(target=>target.entry.file===section.entry.file)) targets.push(section);
}
const browser = await playwright.chromium.launch({headless:true});
try {
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    const mobile = viewport.width < 500;
    const context = await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    const page = await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));});
    await page.goto(base+'#/book/Dover_Tzedek');
    await page.locator(`#toc a[href="${chapterHash(tocTargets[0].entry.ref)}"]`).first().waitFor({state:'visible',timeout:45000});
    for(const target of tocTargets)
      assert.ok(await page.locator(`#toc a[href="${chapterHash(target.entry.ref)}"]`).count(),'Missing TOC chapter link '+target.entry.ref);
    assert.ok((await page.locator('#toc').textContent()).includes('Additional Teachings'),'Named additional-teachings contents group');
    assert.equal(await page.locator('#toc details.chapter-outline').count(),15,'Expandable chapter outlines');
    assert.equal(await page.locator('#toc a[data-topic-link]').count(),outlineTopics,'All sections and subsections must appear in contents');
    assert.ok(await page.locator('#toc details.toc-topic-group').count(),'Contents must group subsections under section headings');
    for(const entry of outlineEntries)
      assert.ok(await page.locator(`#toc a[data-topic-link][href="${topicHash(entry)}"]`).count(),'Contents topic link missing '+entry.title);
    for(const [index,title] of miscellanyNames.entries()) {
      const link=page.locator(`#toc a[href="${chapterHash('Dover Tzedek, Miscellany '+(index+1))}"]`).first();
      assert.ok((await link.textContent()).includes(title),'Named contents link missing '+title);
    }
    const adaptedReview=headingReview.volume2.review.find(entry=>entry.source==='editorial adaptation');
    const adapted=outlineEntries.find(entry=>entry.title===adaptedReview?.text&&entry.ref==='Dover Tzedek, '+adaptedReview.readerNode+' '+adaptedReview.readerKey);
    assert.ok(adapted,'No reviewed adapted paragraph subheading in contents');
    const adaptedOutline=page.locator('#toc details.chapter-outline').filter({has:page.locator(`a[data-topic-link][href="${topicHash(adapted)}"]`)}).first();
    await adaptedOutline.locator(':scope > summary').click();
    await page.locator(`#toc a[data-topic-link][href="${topicHash(adapted)}"]`).first().click();
    await page.waitForURL(url=>url.hash===topicHash(adapted),{timeout:45000});
    const adaptedSelector=await page.evaluate(entry=>`.subhead[data-topic-ref="${CSS.escape(entry.ref)}"][data-topic-title="${CSS.escape(entry.title)}"]`,adapted);
    await page.locator('#text '+adaptedSelector+'.flash').first().waitFor({state:'visible',timeout:45000});
    assert.equal(await page.locator('#panel').isVisible(),false,'Contents jump must leave the reading area open');
    await assertHeadingInViewport(page,adaptedSelector,'Paragraph subsection link did not scroll to the adapted heading');
    await page.locator('#tocBtn').click();
    await page.locator('#toc a[data-topic-link]').first().waitFor({state:'attached',timeout:45000});
    // Follow a subsection link to its actual phrase heading, then exercise the
    // same heading and source notes in every reading layout and language.
    const topic=outlineEntries.find(entry=>Number.isInteger(entry.phraseIndex)&&entry.phraseIndex>0);
    assert.ok(topic,'No within-paragraph KDP subsection to navigate');
    const topicLink=page.locator(`#toc a[data-topic-link][href="${topicHash(topic)}"]`).first();
    const outline=page.locator('#toc details.chapter-outline').filter({has:page.locator(`a[data-topic-link][href="${topicHash(topic)}"]`)}).first();
    await outline.locator(':scope > summary').click();
    await topicLink.click();
    await page.waitForURL(url=>url.hash===topicHash(topic),{timeout:45000});
    const topicSelector=await page.evaluate(entry=>`.subhead[data-topic-ref="${CSS.escape(entry.ref)}"][data-topic-title="${CSS.escape(entry.title)}"][data-topic-phrase-index="${entry.phraseIndex}"]`,topic);
    await page.locator('#text '+topicSelector+'.flash').first().waitFor({state:'visible',timeout:45000});
    assert.equal(await page.locator('#panel').isVisible(),false,'Within-paragraph contents jump must leave the reading area open');
    await assertHeadingInViewport(page,topicSelector,'Subsection link did not scroll to its actual phrase heading');
    const topicParagraph=page.locator(`.seg[data-ref="${topic.ref}"]`).first();
    const topicSectionRef=topic.ref.replace(/:\d+$/,'');
    const topicRow=[...sections.values()].find(section=>section.entry.ref===topicSectionRef)?.rows.find(row=>row.p&&topic.ref.endsWith(':'+row.n));
    assert.ok(topicRow,'Subsection target source paragraph');
    await page.locator('#setBtn').click();
    for(const [language,layout] of [['bi','inter'],['bi','stack'],['bi','side'],['he','stack'],['en','stack']]) {
      await page.locator(`#settings [data-pref="lang"] button[data-v="${language}"]`).click();
      await page.locator(`#settings [data-pref="layout"] button[data-v="${layout}"]`).click();
      assert.ok(await topicParagraph.locator(topicSelector).evaluateAll(elements=>elements.some(element=>element.getClientRects().length)),'Subsection heading hidden in '+language+'/'+layout);
      const columns=language==='bi'?['he','en']:[language];
      for(const column of columns) {
        const selector=layout==='inter'&&language==='bi'?'.seg-il .ph-'+column:'.seg-'+column;
        const rendered=await topicParagraph.locator(selector).evaluateAll(elements=>elements.map(element=>{
          const clone=element.cloneNode(true);clone.querySelectorAll('.subhead,.source-note-trigger,.reader-footnote').forEach(element=>element.remove());return clone.textContent;
        }).join(' '));
        assert.equal(norm(rendered),norm(topicRow.p.map(pair=>pair[column==='he'?0:1]).join(' ')),'Heading changed original '+column+' text in '+language+'/'+layout);
      }
      if(language!=='en'&&topicRow.footnotes?.length) {
        const scope=language==='bi'&&layout==='inter'?'.seg-il .ph-he':'.seg-he';
        assert.equal(await topicParagraph.locator(scope+' .source-note-trigger').count(),topicRow.footnotes.length,'Headed paragraph lost Hebrew notes in '+language+'/'+layout);
        const note=topicRow.footnotes[0];
        const trigger=topicParagraph.locator(`${scope} .source-note-trigger[data-note-key="${note.placementId}"]`).first();
        const card=topicParagraph.locator(`${language==='bi'&&layout==='inter'?'.seg-il':'.segment-annotations'} .reader-footnote[data-note-key="${note.placementId}"]`).first();
        await trigger.click();await card.waitFor({state:'visible'});
        assert.deepEqual(await card.locator('.annotation-text').allTextContents(),note.paragraphs.map(paragraph=>paragraph.text),'Headed paragraph truncated source note in '+language+'/'+layout);
        await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'false','Headed paragraph source note failed to close');
      }
      assert.equal(await topicParagraph.locator('.seg-en .source-note-trigger').count(),0,'Headed paragraph added English-side note markers');
    }
    await page.locator('#settings [data-pref="lang"] button[data-v="bi"]').click();
    await page.locator('#settings [data-pref="layout"] button[data-v="inter"]').click();
    await page.goto(base+'#/book/Dover_Tzedek');
    await page.locator(`#toc a[href="${chapterHash(titleLeaf.ref)}"]`).first().waitFor({state:'visible',timeout:45000});
    const openingLink=page.locator(`#toc a[href="${chapterHash(titleLeaf.ref)}"]`).first();
    assert.ok((await openingLink.textContent()).includes('English translation'),'Opening TOC translation label');
    assert.ok(!(await openingLink.textContent()).includes('interlinear'),'Opening wrongly labelled interlinear');
    await openingLink.click();
    const opening=page.locator('#text > .sec.paragraph-translation').filter({has:page.locator('.seg[data-ref="Dover Tzedek, Title Page 1"]')}).first();
    await opening.locator('.seg-en').first().waitFor({state:'visible',timeout:45000});
    assert.equal(await opening.locator('.seg').count(),9,'Opening paragraph count in browser');
    assert.equal(await opening.locator('.seg-il,.ph').count(),0,'Opening must not render phrase interlinear text');
    const rendered=await opening.locator('.seg').evaluateAll(elements=>elements.map(element=>({
      he:element.querySelector('.seg-he').textContent,en:element.querySelector('.seg-en').textContent
    })));
    for(const [index,row] of titleSection.rows.entries()) {
      assert.equal(norm(rendered[index].he),norm(row.p[0][0]),'Complete opening Hebrew in browser '+row.n);
      assert.equal(norm(rendered[index].en),norm(row.p[0][1]),'Complete opening English in browser '+row.n);
    }
    await page.locator('#setBtn').click();
    for(const layout of ['inter','stack','side']) {
      await page.locator(`#settings [data-pref="layout"] button[data-v="${layout}"]`).click();
      const ordered=await opening.locator('.seg').evaluateAll(elements=>elements.every(element=>{
        const he=element.querySelector('.seg-he'),en=element.querySelector('.seg-en');
        const h=he.getBoundingClientRect(),e=en.getBoundingClientRect();
        return h.height>0 && e.height>0 && h.bottom<=e.top+1 && +getComputedStyle(en).fontWeight>=600;
      }));
      assert.ok(ordered,'Complete Hebrew must precede English in opening under '+layout+' setting');
    }
    for(const language of ['he','en']) {
      await page.locator(`#settings [data-pref="lang"] button[data-v="${language}"]`).click();
      assert.equal(await opening.locator('.seg-'+language).first().isVisible(),true,'Opening language toggle '+language);
      assert.equal(await opening.locator('.seg-'+(language==='he'?'en':'he')).first().isVisible(),false,'Opening language toggle hides other language');
    }
    await page.locator('#settings [data-pref="lang"] button[data-v="bi"]').click();
    await page.locator('#settings [data-pref="layout"] button[data-v="inter"]').click();
    await page.locator('#setBtn').click();
    await page.locator('#nextBtn').click();
    await page.waitForURL(url=>url.hash===chapterHash(tocTargets[0].entry.ref),{timeout:45000});
    await page.locator('#prevBtn').waitFor({state:'visible'});
    await page.locator('#text > .sec.il .seg-il .source-note-trigger').first().waitFor({state:'visible',timeout:45000});
    await page.locator('#prevBtn').click();
    await page.waitForURL(url=>url.hash===chapterHash(titleLeaf.ref),{timeout:45000});
    await page.locator('#text > .sec.paragraph-translation .seg-en').first().waitFor({state:'visible',timeout:45000});
    for (const target of targets) {
      const ref = target.entry.ref;
      const chapterNotes = target.rows.flatMap(row=>row.footnotes||[]);
      await page.goto(base+chapterHash(ref));
      const section = page.locator('#text > .sec').filter({has:page.locator(`.source-note-trigger[data-note-key="${chapterNotes[0].placementId}"]`)}).first();
      await section.locator('.seg-il .ph-he .source-note-trigger').first().waitFor({state:'visible',timeout:45000});
      const nodeRef=ref.replace(/ \d+$/,''),chapter=+ref.match(/ (\d+)$/)[1];
      const displayTitle=leaves.get(nodeRef)?.chapterTitles?.[chapter-1];
      if(displayTitle) {
        assert.ok((await page.locator('#rTitle').textContent()).includes(displayTitle),'Named reader title missing '+ref);
        assert.ok((await section.locator('.sec-head').textContent()).includes(displayTitle),'Named section header missing '+ref);
        assert.equal(new URL(page.url()).hash,chapterHash(ref),'Named section changed its bookmark URL');
      }
      const node=nodeRef.replace('Dover Tzedek, ','');
      const expectedHeadings=Object.entries(headingPack.headings?.[node]||{}).filter(([location])=>+location.split(':')[0]===chapter).map(([,text])=>text.replace(/^§ /,''));
      const expectedInline=Object.entries(headingPack.inlineHeadings?.[node]||{}).filter(([location])=>+location.split(':')[0]===chapter).flatMap(([,headings])=>headings.map(heading=>heading.text));
      const renderedHeadings=await section.locator('.subhead').allTextContents();
      for(const text of [...expectedHeadings,...expectedInline]) assert.ok(renderedHeadings.includes(text),'Full KDP English heading not rendered '+ref+': '+text);
      assert.equal(await section.locator('.seg-il .ph-he .source-note-trigger').count(),chapterNotes.length,'Hebrew marker count '+ref);
      assert.equal(await section.locator('.seg-il .ph-en .source-note-trigger').count(),0,'English marker duplicate '+ref);
      const markers = await section.evaluate(element=>[...element.querySelectorAll('.seg-il .ph-he')].flatMap(he=>{
        const found=[],walker=document.createTreeWalker(he,NodeFilter.SHOW_TEXT);let node,prefix='';
        while ((node=walker.nextNode())) {
          const marker=node.parentElement?.closest('.source-note-trigger');
          if(marker) found.push({id:marker.dataset.noteKey,number:+marker.textContent,prefix});
          else if(!node.parentElement?.closest('.reader-footnote')) prefix+=node.textContent;
        }
        return found;
      }));
      for (const note of chapterNotes) {
        const marker=markers.find(mark=>mark.id===note.placementId);
        assert.ok(marker,'Missing rendered marker '+note.sourceId);
        assert.equal(marker.number,note.number,'Rendered footnote number');
        assert.equal(marker.prefix,note.heAnchorPrefix,'Rendered Hebrew placement '+note.sourceId);
      }
      const cards=await section.locator('.seg-il .reader-footnote[data-source-note]').evaluateAll(elements=>elements.map(element=>({id:element.dataset.noteKey,paragraphs:[...element.querySelectorAll('.annotation-text')].map(p=>p.textContent)})));
      assert.equal(cards.length,chapterNotes.length,'Missing source card '+ref);
      for(const note of chapterNotes) assert.deepEqual(cards.find(card=>card.id===note.placementId)?.paragraphs,note.paragraphs.map(p=>p.text),'Truncated browser quotation '+note.sourceId);
      const first=chapterNotes.find(note=>note.paragraphs.some(p=>p.rich?.some(run=>run.bold && run.href)));
      assert.ok(first,'No linked source citation '+ref);
      const trigger=section.locator(`.ph-he .source-note-trigger[data-note-key="${first.placementId}"]`);
      const card=section.locator(`.seg-il .reader-footnote[data-note-key="${first.placementId}"]`);
      await trigger.click();
      await card.waitFor({state:'visible'});
      assert.equal(await trigger.getAttribute('aria-expanded'),'true','Footnote did not open');
      const style=await card.evaluate(element=>{
        const strong=element.querySelector('.annotation-text strong');
        const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node,normal=false;
        while((node=walker.nextNode())) if(node.textContent.trim().length>15 && node.parentElement.closest('.annotation-text') && !node.parentElement.closest('strong') && +getComputedStyle(node.parentElement).fontWeight<600)normal=true;
        return {bold:!!strong && +getComputedStyle(strong).fontWeight>=600,normal};
      });
      assert.ok(style.bold && style.normal,'Source must be bold and quotation regular '+ref);
      await trigger.click();
      assert.equal(await trigger.getAttribute('aria-expanded'),'false','Footnote did not close');
      assert.ok(!(await card.isVisible()),'Closed source card still visible');
    }
    // Exercise a real internal parallel link, including navigation back to Dover.
    const parallel=[...expected.values()].find(note=>note.paragraphs.slice(note.originalParagraphCount).some(p=>p.rich?.some(run=>run.href?.startsWith('#/read/'))));
    assert.ok(parallel,'No internal parallel-source link was published');
    const sourceSection=sections.get(parallel.file);
    await page.goto(base+chapterHash(sourceSection.entry.ref));
    const marker=page.locator(`.ph-he .source-note-trigger[data-note-key="${parallel.placementId}"]`).first();
    await marker.waitFor({state:'visible',timeout:45000});await marker.click();
    const card=page.locator(`.reader-footnote[data-note-key="${parallel.placementId}"]`).first();
    const link=card.locator('a[href^="#/read/"]').first();
    const href=await link.getAttribute('href');
    const popupPromise=context.waitForEvent('page',{timeout:3000}).catch(()=>null);
    await link.click();
    const popup=await popupPromise;
    const destination=popup||page;
    await destination.waitForURL(url=>url.hash===href,{timeout:45000});
    const destinationRef=decodeURIComponent(href.slice('#/read/'.length)).replace(/_/g,' ');
    await destination.waitForFunction(ref=>[...document.querySelectorAll('#text > .sec')].some(section=>ref===section.dataset.ref||ref.startsWith(section.dataset.ref+':')||ref.startsWith(section.dataset.ref+' ')),destinationRef,{timeout:45000});
    await destination.locator('#text .sec .seg').first().waitFor({state:'visible',timeout:45000});
    if(popup) await popup.close();
    else {await page.goBack();await marker.waitFor({state:'visible',timeout:45000});}
    assert.deepEqual(errors,[],'Reader JavaScript errors');
    await context.close();
    console.log(`PASS Dover ${mobile?'mobile':'desktop'} browser: nine complete Hebrew-then-English opening paragraphs; KDP English headings and all four named additional teachings at their original URLs; ${targets.length} chapters, exact Hebrew markers, complete expandable quotations, source typography and internal parallel navigation.`);
  }
} finally {
  await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
}

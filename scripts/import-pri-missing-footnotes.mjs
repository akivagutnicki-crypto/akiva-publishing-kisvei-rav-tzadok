// Add the supplied source notes only to the 26 interlinear sections that had
// no annotations. The current reader text is never replaced by an archive.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {categoryOf} from './citations.mjs';
import {publishedChanukah25} from './pri-chanukah25.mjs';

export const PACK = 'sources/akiva/overlays/pri-missing-footnotes-20261019.json.gz.b64';
export const PACK_SHA = '5fb370969f43a3dbcace775eb6217b117313b3c40d1c8fe91752f1762a5c7c6f';
export const RELEASE = '20261019-pri-missing-footnotes-v1';
export const REPORT = 'pri-missing-footnotes-report.json';
export const MISSING_FOOTNOTE_COUNT = 2299;
const sha = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const canonicalHash = value => sha(JSON.stringify(canonical(value)));
const bodyOf = items => items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'footnotes')));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const notesOf = items => items.flatMap(item => item?.footnotes || []);
const leaves = node => node.children ? node.children.flatMap(leaves) : [node];
const sourceKey = value => String(value).replace(/\s*\(§\s*\d+\)$/u, '').trim();
export const sourceSlug = ref => sourceKey(ref).replace(/\s+\d[\da-z:.\-–]*$/i, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const plain = value => String(value).replace(/<[^>]*>/g, '')
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x'
      ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()] ?? match;
  });
let cachedPack;
export function readMissingFootnotes() {
  if (cachedPack) return cachedPack;
  const bytes = Buffer.from(fs.readFileSync(PACK, 'utf8').trim(), 'base64');
  assert.equal(sha(bytes), PACK_SHA, 'Supplied missing-footnote package checksum');
  const pack = JSON.parse(gunzipSync(bytes));
  assert.equal(pack.schemaVersion, 1);
  assert.equal(pack.book, 'Peri Tzadik');
  assert.equal(pack.release, RELEASE);
  assert.equal(pack.noteCount, MISSING_FOOTNOTE_COUNT);
  assert.equal(pack.targets.length, 26);
  assert.equal(new Set(pack.targets.map(target => target.file)).size, 26);
  assert.equal(new Set(pack.targets.map(target => target.ref)).size, 26);
  const numbers = [];
  for (const target of pack.targets) {
    assert.match(target.file, /^\d+(?:-\d+)?\.json$/);
    assert.ok([' ', ':'].includes(target.separator));
    assert.equal(target.noteCount, target.notesByItem.reduce((total, item) => total + item.footnotes.length, 0));
    for (const item of target.notesByItem) for (const note of item.footnotes) {
      numbers.push(note.number);
      assert.equal(note.sourceId, 'PT-' + String(note.number).padStart(4, '0'));
      assert.equal(note.placementId, note.sourceId + '-1');
      assert.equal(note.provenance.section, target.ref);
      assert.equal(note.provenance.sourceFile, target.file);
      assert.equal(note.provenance.item, item.n);
    }
  }
  assert.deepEqual(numbers.sort((a,b) => a-b), Array.from({length:MISSING_FOOTNOTE_COUNT}, (_,i) => 3254+i));
  cachedPack = pack;
  return pack;
}
export const getTarget = ref => readMissingFootnotes().targets.find(target => target.ref === ref);
export function normalizeSuppliedNote(note) {
  return structuredClone(readMissingFootnotes().correctionsBySourceId[note.sourceId] || note);
}
export function hasImportedNotes(items, ref) {
  const target = getTarget(ref);
  if (!target) return false;
  const wanted = new Set(target.notesByItem.flatMap(item => item.footnotes.map(note => note.sourceId)));
  return notesOf(items).some(note => wanted.has(note.sourceId));
}

// Historic Word-edition tests recover their precise original items only after
// checking every added note against the frozen, source-corrected package.
export function recoverOriginalItems(items, ref) {
  const target = getTarget(ref);
  if (!target) return items;
  assert.equal(canonicalHash(bodyOf(items)), target.baseBodySha256, 'Original body changed: ' + ref);
  if (!notesOf(items).length) {
    assert.equal(sha(JSON.stringify(items)), target.baseItemsSha256, 'Original item structure changed: ' + ref);
    return items;
  }
  const restored = structuredClone(items), byNumber = new Map();
  for (const item of restored) if (Array.isArray(item.p)) {
    assert.ok(!byNumber.has(item.n), 'Ambiguous paragraph: ' + ref);
    byNumber.set(item.n, item);
  }
  let count = 0;
  const expectedNumbers = new Set(target.notesByItem.map(item => item.n));
  for (const item of restored) if (item.footnotes?.length)
    assert.ok(expectedNumbers.has(item.n), 'Unexpected existing note in target section: ' + ref);
  for (const source of target.notesByItem) {
    const item = byNumber.get(source.n);
    assert.ok(item, 'Missing paragraph: ' + ref + target.separator + source.n);
    const wanted = source.footnotes.map(normalizeSuppliedNote);
    assert.deepEqual(item.footnotes, wanted, 'Missing, changed or duplicate imported footnotes: ' + ref + target.separator + source.n);
    count += wanted.length;
    if (source.originalFootnotesPresent) item.footnotes = [];
    else delete item.footnotes;
  }
  assert.equal(count, target.noteCount);
  assert.equal(sha(JSON.stringify(restored)), target.baseItemsSha256, 'Only imported footnotes may change: ' + ref);
  return restored;
}

export function importedSourceLinks(ref) {
  const target = getTarget(ref);
  if (!target) return [];
  const result = [], seen = new Set();
  for (const item of target.notesByItem) for (const supplied of item.footnotes)
    for (const source of normalizeSuppliedNote(supplied).sources) {
      const a = ref + target.separator + item.n, r = sourceKey(source.ref), key = a + '\0' + r;
      assert.ok(r && sourceSlug(r), 'Unusable supplied source: ' + supplied.sourceId);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({a,r,c:categoryOf(r)});
      }
    }
  return result;
}

function validateNote(note, item, ref) {
  assert.ok(Number.isInteger(note.phraseIndex) && note.phraseIndex >= 0);
  const pair = item.p[note.phraseIndex];
  assert.ok(pair?.length === 2, 'Missing phrase: ' + note.sourceId);
  for (const [side, offset, prefix] of [[0,'heCharOffset','heAnchorPrefix'],[1,'enCharOffset','enAnchorPrefix']]) {
    const text = plain(pair[side]);
    assert.ok(Number.isInteger(note[offset]) && note[offset] > 0 && note[offset] <= text.length, 'Invalid offset: ' + note.sourceId);
    assert.equal(text.slice(0, note[offset]), note[prefix], 'Exact text anchor: ' + note.sourceId);
  }
  assert.equal(note.paragraphs.length, 1, 'Only the primary source paragraph may be imported');
  assert.equal(note.sources.length, 1);
  assert.equal(note.sources[0].role, 'primary-source');
  assert.deepEqual(note.nativeConnections, []);
  const paragraph = note.paragraphs[0];
  assert.ok(paragraph.text && /[A-Za-z]/.test(paragraph.text));
  assert.equal(paragraph.rich.map(run => run.text).join(''), paragraph.text, 'Rich/plain source text differs: ' + note.sourceId);
  const safe = url => /^https:\/\/(?:www\.)?sefaria\.org\/[^<>\s"']+$/i.test(url)
    || /^#\/read\/Resisei_Layla_\d+:\d+$/.test(url);
  assert.ok(safe(note.sources[0].url), 'Unresolved source URL: ' + note.sourceId);
  for (const run of paragraph.rich) if (run.href) assert.ok(safe(run.href), 'Unresolved rich source link: ' + note.sourceId);
  assert.equal(note.provenance.section, ref);
}

function filesIn(directory) {
  return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory()
    ? filesIn(path.join(directory, entry.name)) : [path.join(directory, entry.name)]).sort();
}
function existingRecords(directory, excluded) {
  return fs.readdirSync(directory).filter(file => /^\d+(?:-\d+)*\.json$/.test(file) && !excluded.has(file)).sort()
    .flatMap(file => read(path.join(directory,file)).flatMap(item => (item?.footnotes || []).map(note => [file,item.n,note])));
}
function stageJSON(staged, filename, value, formatted = false) {
  const bytes = Buffer.from(JSON.stringify(value, null, formatted ? 2 : undefined) + (formatted ? '\n' : ''));
  const before = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
  if (before && before.equals(bytes)) return;
  // Other publishers use a different JSON key order and final newline. Do
  // not rewrite already-equivalent indexes during an idempotent import.
  if (before && canonicalHash(JSON.parse(before)) === canonicalHash(value)) return;
  staged.set(filename, {before, after:bytes});
}

export function importMissingFootnotes(library = 'dist/library') {
  const pack = readMissingFootnotes(), root = path.resolve(library), data = path.join(root,'data');
  const directory = path.join(data,'peri-tzadik');
  assert.equal(Object.keys(pack.correctionsBySourceId).length, 47, 'All source-reference corrections must be completed before importing');
  const toc = read(path.join(directory,'toc.json')), allLeaves = leaves(toc.toc);
  const excluded = new Set(pack.targets.map(target => target.file));
  // Preserve the exact historical upload scope. The only allowed successor is
  // independently validated in full; it remains in beforeFiles protection.
  const successor = publishedChanukah25(root);
  const historicalExcluded = new Set([...excluded,...(successor?[successor.file]:[])]);
  const originals = existingRecords(directory, historicalExcluded);
  assert.equal(originals.length, 3240, 'Run the original seasonal importer before adding these notes');
  assert.equal(new Set(originals.map(record => record[2].number)).size, 3240);
  assert.ok(originals.every(record => record[2].number < 3254), 'A supplied note number would collide with an existing note');
  const oldDigest = canonicalHash(originals);
  const existingNoteMetadataSha256 = canonicalHash(originals.map(([file,n,note]) => [file,n,
    Object.fromEntries(Object.entries(note).filter(([key]) => !['paragraphs','sources'].includes(key)))]));
  assert.equal(existingNoteMetadataSha256,'7d34fe5bc33790aaa9f3c9ddeefae42f7399cc47c4979753f9edf9cc5f00cd63',
    'Existing Pri footnote identities, anchors and provenance must remain exact');
  const beforeFiles = new Map(filesIn(data).filter(file => {
    const relative = path.relative(data,file).split(path.sep).join('/');
    return /^peri-tzadik\/\d+(?:-\d+)*\.json$/.test(relative) && !excluded.has(path.basename(file))
      || (!relative.startsWith('peri-tzadik/') && !relative.startsWith('cited/') && !relative.startsWith('packs/'));
  }).map(file => [file,sha(fs.readFileSync(file))]));
  const protectedDoverFiles = Object.fromEntries(fs.readdirSync(path.join(data,'dover-tzedek')).filter(file => file.endsWith('.json')).sort()
    .map(file => [file,sha(fs.readFileSync(path.join(data,'dover-tzedek',file)))]));
  assert.equal(Object.keys(protectedDoverFiles).length,18);
  const staged = new Map(), summaries = [], existingNumbers = new Set(originals.map(record => record[2].number));
  let newlyAdded = 0, alreadyPresent = 0;
  for (const target of pack.targets) {
    const leafMatches = allLeaves.filter(leaf => leaf.interlinear && (leaf.depth === 1
      ? leaf.ref === target.ref && String(leaf.id)+'.json' === target.file
      : Array.isArray(leaf.shape) && leaf.shape.some((_,index) => leaf.ref+' '+(index+1) === target.ref
        && String(leaf.id)+'-'+(index+1)+'.json' === target.file)));
    assert.equal(leafMatches.length,1,'Exactly one current interlinear target: '+target.ref);
    const file = path.join(directory,target.file), items = read(file);
    const recovered = recoverOriginalItems(items,target.ref);
    const active = hasImportedNotes(items,target.ref), fresh = active ? items : structuredClone(recovered);
    const byNumber = new Map(fresh.filter(item => item.p).map(item => [item.n,item]));
    for (const source of target.notesByItem) {
      const item = byNumber.get(source.n);
      assert.ok(item, 'Missing target paragraph: '+target.ref);
      const notes = source.footnotes.map(normalizeSuppliedNote);
      for (const note of notes) {
        validateNote(note,item,target.ref);
        assert.ok(!existingNumbers.has(note.number),'Duplicate note number: '+note.number);
        existingNumbers.add(note.number);
      }
      if (!active) {
        assert.ok(!item.footnotes?.length, 'An existing annotation would be overwritten');
        item.footnotes = notes;
      }
    }
    assert.deepEqual(recoverOriginalItems(fresh,target.ref),recovered,'Import changed existing reader text');
    if (active) alreadyPresent += target.noteCount;
    else newlyAdded += target.noteCount;
    stageJSON(staged,file,fresh);
    summaries.push({file:target.file,ref:target.ref,noteCount:target.noteCount,
      baseBodySha256:target.baseBodySha256,baseItemsSha256:target.baseItemsSha256,sha256:sha(JSON.stringify(fresh))});
  }
  assert.equal(newlyAdded+alreadyPresent,MISSING_FOOTNOTE_COUNT);
  assert.equal(existingNumbers.size,5539);
  const linksFile = path.join(directory,'links.json'), links = read(linksFile);
  const priorLinks = structuredClone(links), reverse = new Map();
  const citedIndexFile = path.join(data,'cited/index.json'), citedIndex = new Set(read(citedIndexFile));
  const searchFile = path.join(data,'cited/search.json'), search = read(searchFile), searchRefs = new Set(search.search);
  const packsFile = path.join(data,'packs/sources.json'), sourcesPack = read(packsFile), primaryRefs = new Set(sourcesPack.refs);
  const catalog = read(path.join(data,'catalog.json'));
  let addedLinks = 0, addedBacklinks = 0;
  for (const target of pack.targets) {
    const list = links[target.ref] ||= [], seen = new Set(list.map(link => link.a+'\0'+link.r));
    for (const link of importedSourceLinks(target.ref)) {
      const key = link.a+'\0'+link.r;
      if (!seen.has(key)) {list.push(link);seen.add(key);addedLinks++;}
      const slug = sourceSlug(link.r), file = path.join(data,'cited',slug+'.json');
      if (!reverse.has(file)) reverse.set(file,fs.existsSync(file)?read(file):{});
      const refs = reverse.get(file), anchors = refs[link.r] ||= [];
      if (!anchors.includes(link.a)) {anchors.push(link.a);addedBacklinks++;}
      citedIndex.add(slug);
      const internal = catalog.some(book => link.r === book.title || link.r.startsWith(book.title+' ') || link.r.startsWith(book.title+','));
      if (internal) searchRefs.add(link.r);
      else primaryRefs.add(link.r);
    }
  }
  const targetRefs = new Set(pack.targets.map(target => target.ref));
  for (const [ref,value] of Object.entries(priorLinks)) {
    if (!targetRefs.has(ref)) assert.deepEqual(links[ref],value,'Unrelated links changed: '+ref);
    else assert.deepEqual(links[ref].slice(0,value.length),value,'An existing source connection was replaced: '+ref);
  }
  stageJSON(staged,linksFile,canonical(links));
  for (const [file,value] of reverse) stageJSON(staged,file,canonical(value));
  stageJSON(staged,citedIndexFile,[...citedIndex].sort());
  search.search = [...searchRefs].sort();
  stageJSON(staged,searchFile,canonical(search));
  sourcesPack.refs = [...primaryRefs].sort();
  stageJSON(staged,packsFile,canonical(sourcesPack));
  // Leave all TOC hierarchy and existing editorial metadata intact.
  const tocStructure = JSON.stringify(toc.toc);
  toc.missingInterlinearFootnotes = {release:RELEASE,sections:26,addedNotes:MISSING_FOOTNOTE_COUNT,
    previousNotes:3240,totalNotes:5539,correctedResiseiNotes:47,
    source:'Uploaded Pri Tzaddik expanded footnotes; original reader text and existing notes retained.'};
  assert.equal(JSON.stringify(toc.toc),tocStructure);
  stageJSON(staged,path.join(directory,'toc.json'),canonical(toc));
  const expectedFinalExistingNotesSha256 = '5d2dad24c05f1203af6ede7592fa5748cd5e04c17236d74a0c2f80c5c6222f1b';
  const report = {
    schemaVersion:1,release:RELEASE,sourcePackageSha256:PACK_SHA,
    addedNotes:MISSING_FOOTNOTE_COUNT,sectionCount:26,totalBookNotes:5539,existingNotes:3240,
    newlyAddedThisRun:newlyAdded,alreadyPresentThisRun:alreadyPresent,
    existingNotesBeforeSha256:oldDigest,existingNotesAfterSha256:oldDigest,
    expectedFinalExistingNotesSha256,existingNotesSha256:expectedFinalExistingNotesSha256,existingNoteMetadataSha256,
    protectedDoverFiles,sections:summaries,correctedResiseiNotes:47,
    addedPrimaryConnections:addedLinks,addedReverseConnections:addedBacklinks,
    originalBodyPreserved:true,existingAnnotationsPreserved:true,otherBooksPreserved:true,
    sourceVerification:'Every imported Hebrew and English placement checked against current reader text. Supplied source wording retained except 47 Resisei Layla quotations corrected against the intended published paragraphs.',
    publicationStage:'before-final-cleanup',
  };
  const reportFile = path.join(root,REPORT), previousReport = fs.existsSync(reportFile) ? read(reportFile) : null;
  // A repeated verification must not rewrite the report or duplicate notes.
  if (previousReport && !newlyAdded) {
    assert.equal(previousReport.release,RELEASE);
    assert.equal(previousReport.sourcePackageSha256,PACK_SHA);
    assert.deepEqual(previousReport.sections,summaries);
    assert.deepEqual(previousReport.protectedDoverFiles,protectedDoverFiles);
  } else stageJSON(staged,reportFile,report,true);
  assert.equal(canonicalHash(existingRecords(directory,historicalExcluded)),oldDigest,'Existing source notes changed during preparation');
  for (const [file,digest] of beforeFiles) assert.equal(sha(fs.readFileSync(file)),digest,'Unrelated data changed during preparation: '+file);
  // Prepare every output and check the preimage before the first replacement.
  const prepared = [];
  try {
    for (const [file,change] of staged) {
      assert.ok(!fs.existsSync(file) || fs.lstatSync(file).isFile(), 'Unsafe output path');
      const current = fs.existsSync(file)?fs.readFileSync(file):null;
      assert.deepEqual(current,change.before,'Reader data changed concurrently: '+file);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      const temporary = file+'.pri-missing.tmp';
      assert.ok(!fs.existsSync(temporary),'Unexpected pending import file');
      fs.writeFileSync(temporary,change.after,{flag:'wx'});
      prepared.push({file,temporary,change});
    }
    const committed = [];
    try {
      for (const entry of prepared) {fs.renameSync(entry.temporary,entry.file);committed.push(entry);}
      for (const [file,digest] of beforeFiles) assert.equal(sha(fs.readFileSync(file)),digest,'Unrelated file changed: '+file);
      assert.equal(canonicalHash(existingRecords(directory,historicalExcluded)),oldDigest,'Existing annotations were changed');
      for (const target of pack.targets) recoverOriginalItems(read(path.join(directory,target.file)),target.ref);
    } catch (error) {
      for (const entry of committed.reverse()) {
        if (entry.change.before === null) fs.unlinkSync(entry.file);
        else fs.writeFileSync(entry.file,entry.change.before);
      }
      throw error;
    }
  } finally {
    for (const {temporary} of prepared) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  console.log('PASS Pri Tzaddik missing footnotes: '+MISSING_FOOTNOTE_COUNT+' notes in 26 sections; 3240 existing notes preserved; '+newlyAdded+' added this run, '+alreadyPresent+' already present.');
  return previousReport && !newlyAdded ? previousReport : report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--root');
  importMissingFootnotes(at >= 0 ? process.argv[at+1] : 'dist/library');
}

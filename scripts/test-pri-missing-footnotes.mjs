// Independently verify the missing-section import against frozen upload evidence,
// the current published edition, and the actual referenced Resisei paragraphs.
// No importer matching or normalization helper is used to derive expectations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RELEASE = '20261019-pri-missing-footnotes-v1';
export const REPORT = 'pri-missing-footnotes-report.json';
const PACKAGE_SHA = '5fb370969f43a3dbcace775eb6217b117313b3c40d1c8fe91752f1762a5c7c6f';
const UPLOADED_NOTES_SHA = 'cc435027a7f944725df7e62df6b8d9fee9aa43032b66ef78844d78ffcef175fc';
const CORRECTIONS_SHA = 'c86da561f6ed694170cbf78847ea08d8e0c7c71995b7edb7e7843bd19f51da88';
const ORIGINAL_BODIES_SHA = 'acb205055ec3ab3920df8717f897a154d7669904a0f01f35569b64e0eed738fd';
const ORIGINAL_NOTES_SHA = '5d2dad24c05f1203af6ede7592fa5748cd5e04c17236d74a0c2f80c5c6222f1b';
const ORIGINAL_NOTE_METADATA_SHA = '7d34fe5bc33790aaa9f3c9ddeefae42f7399cc47c4979753f9edf9cc5f00cd63';
const DOVER_FILES_SHA = '9b0c608915d776cca7c993a534b1a187d5c1ed7e3d9b2ce818d542abf9823790';
const COUNTS = new Map([
  ...[25,22,29,19,12,11,15,27,16,19,4,4].map((count,i)=>[`${177+i}.json`,count]),
  ...[96,102,148,250,127,168,925].map((count,i)=>[`189-${i+1}.json`,count]),
  ...[91,30,4,23,54,48,30].map((count,i)=>[`190-${i+1}.json`,count]),
]);
const DOVER_FILES = ['0.json','1-1.json','1-2.json','1-3.json','1-4.json','2-1.json','2-2.json','2-3.json',
  '3-1.json','3-2.json','4-1.json','4-2.json','5-1.json','5-2.json','5-3.json','5-4.json','links.json','toc.json'];
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])) : value;
export const canonical = value => JSON.stringify(ordered(value));
export const plain = value => String(value).replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(match,entity)=>{
  if(entity[0]==='#') return String.fromCodePoint(entity[1].toLowerCase()==='x' ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10));
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()] ?? match;
});
const body = rows => rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='footnotes')));
const walk = node => [...(node?.ref ? [node] : []),...(node?.children || []).flatMap(walk)];
const canonicalSource = ref => String(ref).replace(/\s*\(§\s*\d+\)$/u,'').trim();
const sourceSlug = ref => canonicalSource(ref).replace(/\s+\d[\da-z:.\-–]*$/i,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const isSafeSource = href => /^https:\/\/(?:www\.)?sefaria\.org\/[^<>\s"']+$/i.test(href)
  || /^#\/read\/Resisei_Layla_\d+:\d+$/.test(href);
export const toHash = ref => encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');

let expectedFixture;
export function readExpectedMissingFootnotes() {
  if(expectedFixture) return expectedFixture;
  const compressed = Buffer.from(fs.readFileSync(path.join(REPO,'sources/akiva/overlays/pri-missing-footnotes-20261019.json.gz.b64'),'utf8').trim(),'base64');
  assert.equal(sha(compressed),PACKAGE_SHA,'Frozen missing-footnote package');
  const pack = JSON.parse(gunzipSync(compressed));
  assert.equal(pack.schemaVersion,1); assert.equal(pack.release,RELEASE); assert.equal(pack.noteCount,2299);
  assert.deepEqual(pack.targets.map(target=>target.file).sort(),[...COUNTS.keys()].sort(),'Only the 26 formerly empty files');
  assert.equal(new Set(pack.targets.map(target=>target.ref)).size,26);
  const sortedTargets = [...pack.targets].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
  const rawRecords = sortedTargets.flatMap(target=>target.notesByItem.flatMap(item=>item.footnotes.map(note=>[target.file,item.n,note])));
  assert.equal(sha(canonical(rawRecords)),UPLOADED_NOTES_SHA,'All 2,299 original uploaded note objects');
  assert.equal(sha(canonical(sortedTargets.map(target=>[target.file,target.baseBodySha256]))),ORIGINAL_BODIES_SHA,'Frozen original reader bodies');
  assert.equal(Object.keys(pack.correctionsBySourceId).length,47);
  assert.equal(sha(canonical(pack.correctionsBySourceId)),CORRECTIONS_SHA,'Independently reviewed 47-note source correction manifest');
  const rawById = new Map(rawRecords.map(([, ,note])=>[note.sourceId,note]));
  for(const [sourceId,corrected] of Object.entries(pack.correctionsBySourceId)) {
    const original = rawById.get(sourceId); assert.ok(original,'Correction must refer to a supplied target note');
    const proof = corrected.provenance.sourceExcerptCorrection;
    assert.equal(proof.originalUploadedNoteCanonicalSha256,sha(canonical(original)),'Archived original note '+sourceId);
    assert.deepEqual(proof.originalParagraphs,original.paragraphs);
    assert.deepEqual(proof.originalSources,original.sources);
    for(const key of Object.keys(original).filter(key=>!['paragraphs','sources','provenance'].includes(key)))
      assert.deepEqual(corrected[key],original[key],'Correction moved original metadata: '+sourceId+' '+key);
    assert.deepEqual(Object.fromEntries(Object.entries(corrected.provenance).filter(([key])=>key!=='sourceExcerptCorrection')),original.provenance);
  }
  const targets = pack.targets.map(target=>{
    assert.equal(target.noteCount,COUNTS.get(target.file));
    const expectedItems = target.notesByItem.map(item=>{
      assert.equal(item.originalFootnotesPresent,false,'These source paragraphs originally had no footnotes');
      return {...item,footnotes:item.footnotes.map(note=>structuredClone(pack.correctionsBySourceId[note.sourceId] || note))};
    });
    return {...target,expectedItems};
  });
  expectedFixture = {pack,targets,correctedIds:new Set(Object.keys(pack.correctionsBySourceId))};
  return expectedFixture;
}

async function parallelMap(values,worker,limit=8) {
  const results = new Array(values.length); let next=0;
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{
    while(next<values.length) {const index=next++; results[index]=await worker(values[index],index);}
  }));
  return results;
}

function allFiles(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()
    ? allFiles(path.join(directory,entry.name)) : [path.join(directory,entry.name)]).sort();
}

function verifyRepeatAndRejection(library) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'pri-missing-footnotes-test-'));
  try {
    fs.cpSync(path.join(library,'data'),path.join(temporary,'data'),{recursive:true});
    fs.copyFileSync(path.join(library,REPORT),path.join(temporary,REPORT));
    const snapshot = () => allFiles(temporary).map(file=>[path.relative(temporary,file),sha(fs.readFileSync(file))]);
    const invoke = () => spawnSync(process.execPath,[path.join(REPO,'scripts/import-pri-missing-footnotes.mjs'),'--root',temporary],
      {cwd:REPO,encoding:'utf8',maxBuffer:1024*1024});
    const before = snapshot(), repeated = invoke();
    assert.equal(repeated.status,0,'Repeated import failed: '+repeated.stderr.slice(0,2000));
    assert.deepEqual(snapshot(),before,'A repeated import changed data or rewrote its report');
    const first = readExpectedMissingFootnotes().targets[0];
    const file = path.join(temporary,'data/peri-tzadik',first.file), rows = JSON.parse(fs.readFileSync(file,'utf8'));
    const row = rows.find(item=>item.footnotes?.length); row.footnotes.push(structuredClone(row.footnotes[0]));
    fs.writeFileSync(file,JSON.stringify(rows));
    const rejectedBefore = snapshot(), rejected = invoke();
    assert.notEqual(rejected.status,0,'An unexpected duplicate note was silently accepted');
    assert.deepEqual(snapshot(),rejectedBefore,'A rejected import partly changed the reader');
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
}

export async function verifyMissingFootnotes(options={}) {
  const {targets,correctedIds} = readExpectedMissingFootnotes();
  const root = path.resolve(options.root || path.join(REPO,'dist/library'));
  const live = options.url ? options.url.replace(/\/?$/,'/') : null;
  const afterCleanup = Boolean(options.afterCleanup || options.zips || live);
  const cache = new Map();
  const bytes = file => {
    if(!cache.has(file)) cache.set(file,(async()=>{
      if(!live) return fs.readFileSync(path.join(root,file));
      const response = await fetch(new URL(file+'?verify='+RELEASE,live),{cache:'no-store',signal:AbortSignal.timeout(60000)});
      assert.ok(response.ok,'HTTP '+response.status+' '+file); return Buffer.from(await response.arrayBuffer());
    })());
    return cache.get(file);
  };
  const read = async file => JSON.parse(await bytes(file));
  const [report,toc,links,citedIndex,resiseiToc] = await Promise.all([
    read(REPORT),read('data/peri-tzadik/toc.json'),read('data/peri-tzadik/links.json'),
    read('data/cited/index.json'),read('data/resisei-layla/toc.json'),
  ]);
  assert.equal(report.schemaVersion,1); assert.equal(report.release,RELEASE);
  assert.equal(report.sourcePackageSha256,PACKAGE_SHA); assert.equal(report.addedNotes,2299);
  assert.equal(report.sectionCount,26); assert.equal(report.totalBookNotes,5539); assert.equal(report.existingNotes,3240);
  assert.equal(report.correctedResiseiNotes,47);
  assert.equal(report.existingNotesBeforeSha256,report.existingNotesAfterSha256,'Importer changed previously annotated notes');
  assert.equal(report.existingNotesSha256,ORIGINAL_NOTES_SHA);
  assert.equal(report.expectedFinalExistingNotesSha256,ORIGINAL_NOTES_SHA);
  assert.equal(report.existingNoteMetadataSha256,ORIGINAL_NOTE_METADATA_SHA);
  assert.equal(report.sections.length,26);
  const leaves = walk(toc.toc).filter(leaf=>leaf.interlinear);
  const interlinearFiles = leaves.flatMap(leaf=>leaf.depth===1 ? [String(leaf.id)+'.json']
    : (leaf.ilch || []).map(chapter=>leaf.id+'-'+chapter+'.json')).sort();
  assert.equal(interlinearFiles.length,124); assert.equal(new Set(interlinearFiles).size,124);
  const records = await parallelMap(interlinearFiles,async file=>({file,rows:await read('data/peri-tzadik/'+file)}));
  const rowsByFile = new Map(records.map(record=>[record.file,record.rows]));
  const allNotes = records.flatMap(({file,rows})=>rows.flatMap(row=>(row.footnotes || []).map(note=>[file,row.n,note])));
  assert.equal(allNotes.length,5539);
  assert.ok(records.every(({rows})=>rows.some(row=>row.footnotes?.length)),'An interlinear section still has no notes');
  for(const field of ['number','sourceId','placementId'])
    assert.equal(new Set(allNotes.map(([, ,note])=>note[field])).size,5539,'Duplicate book-wide '+field);
  const legacy = allNotes.filter(([, ,note])=>note.number<=3240);
  assert.equal(legacy.length,3240);
  const legacyMetadata = legacy.map(([file,n,note])=>[file,n,Object.fromEntries(Object.entries(note).filter(([key])=>!['paragraphs','sources'].includes(key)))]);
  assert.equal(sha(canonical(legacyMetadata)),ORIGINAL_NOTE_METADATA_SHA,'Existing identities, Hebrew placement and provenance');
  if(afterCleanup) assert.equal(sha(canonical(legacy)),ORIGINAL_NOTES_SHA,'All 3,240 existing notes must remain exact after cleanup');
  else assert.equal(sha(canonical(legacy)),report.existingNotesAfterSha256,'Existing pre-cleanup notes differ from the import snapshot');
  const newIds = allNotes.filter(([, ,note])=>note.number>3240).map(([, ,note])=>note.number).sort((a,b)=>a-b);
  assert.deepEqual(newIds,Array.from({length:2299},(_,i)=>i+3254),'Do not import the 13 out-of-scope additions');
  // Pages omits the legacy empty-slug dotfile. Every new note must still have
  // a nonempty source slug and its exact reverse connection, checked below.
  const citedSlugs = [...new Set(citedIndex)].filter(slug=>slug!=='');
  const [reverseFiles,doverRecords] = await Promise.all([
    parallelMap(citedSlugs,async slug=>[slug,await read('data/cited/'+slug+'.json')]),
    parallelMap(DOVER_FILES,async file=>[file,sha(await bytes('data/dover-tzedek/'+file))]),
  ]);
  assert.equal(sha(canonical(doverRecords)),DOVER_FILES_SHA,'All 18 current Dover files must remain byte-for-byte unchanged');
  assert.deepEqual(report.protectedDoverFiles,Object.fromEntries(doverRecords),'Dover preservation report');
  const backlinks = new Map();
  for(const [slug,index] of reverseFiles) for(const [ref,anchors] of Object.entries(index)) {
    if(!backlinks.has(ref)) backlinks.set(ref,[]);
    backlinks.get(ref).push({slug,anchors});
  }
  const sourceFilesUsed = new Set(), reverseFilesUsed = new Set();
  let checkedNotes=0,sourceConnections=0,correctedSources=0;
  for(const target of targets) {
    const current = rowsByFile.get(target.file); assert.ok(current,'Missing interlinear target '+target.ref);
    const rowByNumber = new Map(current.filter(item=>item.p).map(item=>[item.n,item]));
    assert.equal(rowByNumber.size,current.filter(item=>item.p).length,'Ambiguous paragraph number '+target.ref);
    assert.equal(sha(canonical(body(current))),target.baseBodySha256,'Original Hebrew, English, markup, headings and breaks '+target.ref);
    const recovered = structuredClone(current), recoveredByNumber = new Map(recovered.filter(item=>item.p).map(item=>[item.n,item]));
    const expectedNumbers = new Set(target.expectedItems.map(item=>item.n));
    for(const row of current) if(row.footnotes?.length) assert.ok(expectedNumbers.has(row.n),'Unexpected annotated paragraph '+target.ref);
    let sectionCount=0;
    for(const expected of target.expectedItems) {
      const row = rowByNumber.get(expected.n); assert.ok(row,'Missing paragraph '+target.ref+target.separator+expected.n);
      assert.deepEqual(row.footnotes,expected.footnotes,'Complete source-corrected note objects '+target.ref+target.separator+expected.n);
      delete recoveredByNumber.get(expected.n).footnotes;
      for(const note of row.footnotes) {
        checkedNotes++; sectionCount++;
        assert.equal(note.sourceId,'PT-'+String(note.number).padStart(4,'0'));
        assert.equal(note.placementId,note.sourceId+'-1');
        assert.ok(Number.isInteger(note.phraseIndex)&&note.phraseIndex>=0&&note.phraseIndex<row.p.length);
        for(const [index,language] of [[0,'he'],[1,'en']]) {
          const text=plain(row.p[note.phraseIndex][index]),offset=note[language+'CharOffset'];
          assert.ok(Number.isInteger(offset)&&offset>0&&offset<=text.length,'Valid '+language+' offset '+note.sourceId);
          assert.equal(text.slice(0,offset),note[language+'AnchorPrefix'],'Exact '+language+' text prefix '+note.sourceId);
        }
        assert.equal(note.paragraphs.length,1); assert.equal(note.sources.length,1);
        assert.equal(note.sources[0].role,'primary-source');
        assert.deepEqual(note.nativeConnections,[]);
        for(const paragraph of note.paragraphs) {
          assert.equal(paragraph.rich.map(run=>run.text).join(''),paragraph.text,'Exact rich source text '+note.sourceId);
          assert.ok(paragraph.text.length>20);
          for(const run of paragraph.rich) if(run.href) assert.ok(isSafeSource(run.href),'Renderable source URL '+note.sourceId);
        }
        const ref=canonicalSource(note.sources[0].ref),anchor=target.ref+target.separator+row.n;
        assert.ok(sourceSlug(ref),'New note requires a nonempty cited-source slug: '+note.sourceId+' '+ref);
        assert.ok(isSafeSource(note.sources[0].url));
        assert.ok((links[target.ref] || []).some(link=>link.a===anchor&&link.r===ref),'Missing forward source connection '+note.sourceId);
        const reverse=(backlinks.get(ref) || []).filter(entry=>entry.anchors.includes(anchor));
        assert.ok(reverse.length,'Missing reverse source connection '+note.sourceId);
        for(const entry of reverse) reverseFilesUsed.add('data/cited/'+entry.slug+'.json');
        sourceConnections++;
        if(correctedIds.has(note.sourceId)) {
          const proof=note.provenance.sourceExcerptCorrection;
          assert.equal(note.sources[0].ref,proof.verifiedRef);
          const [section,number]=proof.verifiedRef.split(':'),leaf=walk(resiseiToc.toc).find(entry=>entry.ref===section);
          assert.ok(leaf,'Resolve corrected source via its actual TOC reference');
          const sourceFile='data/resisei-layla/'+leaf.id+'.json'; sourceFilesUsed.add(sourceFile);
          assert.equal(sourceFile,proof.verifiedSourceFile,'No zero-based chapter inference');
          const sourceRaw=await bytes(sourceFile),source=JSON.parse(sourceRaw).find(item=>item.n===Number(number)&&item.p);
          assert.ok(source,'Corrected source paragraph number '+proof.verifiedRef);
          assert.equal(sha(sourceRaw),proof.verifiedSourceFileSha256);
          assert.equal(sha(await bytes('data/resisei-layla/toc.json')),proof.verifiedTocSha256);
          const english=source.p.map(pair=>plain(pair[1]).trim()).join(' ');
          assert.equal(sha(english),proof.verifiedEnglishTextSha256);
          assert.equal(note.paragraphs[0].text,proof.verifiedRef+': ‘'+english+'’','Corrected quotation is the entire intended source paragraph');
          assert.equal(note.paragraphs[0].rich[0].href,'#/read/'+toHash(proof.verifiedRef));
          correctedSources++;
        }
      }
    }
    assert.equal(sectionCount,target.noteCount);
    assert.equal(sha(JSON.stringify(recovered)),target.baseItemsSha256,'Only footnote fields were added '+target.ref);
    const entry=report.sections.find(section=>section.file===target.file);
    assert.ok(entry); assert.equal(entry.noteCount,target.noteCount); assert.equal(entry.baseBodySha256,target.baseBodySha256);
    assert.equal(entry.sha256,sha(await bytes('data/peri-tzadik/'+target.file)),'Published chapter checksum '+target.ref);
  }
  assert.equal(checkedNotes,2299); assert.equal(correctedSources,47);
  if(options.zips) {
    const required = new Set([REPORT,'data/peri-tzadik/toc.json','data/peri-tzadik/links.json',
      ...interlinearFiles.map(file=>'data/peri-tzadik/'+file),...reverseFilesUsed,
      'data/resisei-layla/toc.json',...sourceFilesUsed,...DOVER_FILES.map(file=>'data/dover-tzedek/'+file)]);
    const {unzipSync}=createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
    for(const archive of ['downloads/books/peri-tzadik.zip','downloads/rav-tzadok-library.zip']) {
      const selected = new Set([...required].filter(file=>archive.includes('/books/')
        ? file.startsWith('data/peri-tzadik/') : file!==REPORT));
      const contents=unzipSync(await bytes(archive),{filter:entry=>selected.has(entry.name)});
      for(const file of selected) {
        assert.ok(contents[file],'Missing offline file '+archive+' '+file);
        assert.equal(sha(contents[file]),sha(await bytes(file)),'Offline archive differs from published data: '+archive+' '+file);
      }
    }
  }
  if(options.idempotency) {
    assert.ok(!live,'Idempotency checks use an isolated local copy only');
    verifyRepeatAndRejection(root);
  }
  const result={status:'pass',release:RELEASE,source:live || root,afterParallelCleanup:afterCleanup,
    sections:26,addedNotes:checkedNotes,allInterlinearSections:124,totalBookNotes:5539,
    originalNotesPreserved:3240,doverFilesPreserved:18,correctedResiseiSourceNotes:correctedSources,
    checkedSourceConnections:sourceConnections,offlineArchives:Boolean(options.zips),idempotency:Boolean(options.idempotency)};
  return result;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const value = flag => {const index=process.argv.indexOf(flag);return index<0?undefined:process.argv[index+1];};
  const result=await verifyMissingFootnotes({root:value('--root'),url:value('--url'),
    afterCleanup:process.argv.includes('--after-parallel-cleanup'),zips:process.argv.includes('--zips'),
    idempotency:process.argv.includes('--idempotency')});
  console.log('PASS '+JSON.stringify(result));
}

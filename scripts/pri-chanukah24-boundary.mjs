// Correct the imported boundary only after the historical publication checks.
// The original chapter and every displaced note remain in the audit evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validatePublishedChanukah25} from './pri-chanukah25.mjs';

const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const CHANUKAH24_BOUNDARY_RELEASE='20261020-chanukah24-authoritative-boundary-v1';
export const CHANUKAH24_BOUNDARY_REPORT='pri-chanukah24-boundary.json';
export const CHANUKAH24_BOUNDARY_MANIFEST_SHA256='0e7df29b7ff69361e247e267d14bc4aeaa16282386c16eb543bd5959e90b920f';
export const boundaryCanonical=value=>JSON.stringify((function ordered(v){return Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;})(value));
export const boundarySha=value=>createHash('sha256').update(value).digest('hex');
const parse=bytes=>JSON.parse(bytes.toString('utf8'));
const encode=value=>Buffer.from(JSON.stringify(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const body=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='footnotes')));
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
const allFiles=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?allFiles(path.join(directory,entry.name)):[path.join(directory,entry.name)]).sort();
const REF='Peri Tzadik, Chanukah 24';
const CHAPTER='data/peri-tzadik/158.json';
const reportAllowed=relative=>['data/peri-tzadik/158.json','data/peri-tzadik/toc.json','data/peri-tzadik/links.json','data/catalog.json','data/files.json','data/packs/sources.json'].includes(relative)||/^data\/cited\/[a-z0-9-]+\.json$/.test(relative);

export function readChanukah24BoundaryManifest(){
  const bytes=fs.readFileSync(path.join(REPO,'sources/akiva/chanukah24/boundary.json'));
  assert.equal(boundarySha(bytes),CHANUKAH24_BOUNDARY_MANIFEST_SHA256,'The reviewed boundary manifest changed');
  const pack=parse(bytes);assert.equal(pack.release,CHANUKAH24_BOUNDARY_RELEASE);
  assert.equal(boundarySha(boundaryCanonical(pack.beforeBody)),pack.beforeBodySha256);
  assert.equal(boundarySha(boundaryCanonical(pack.afterBody)),pack.afterBodySha256);
  return pack;
}

export function retainedChanukah24Rows(rows,pack=readChanukah24BoundaryManifest()){
  assert.deepEqual(body(rows),pack.beforeBody,'Chanukah24 differs from the exactly reviewed imported body');
  const originals=rows.filter(row=>Array.isArray(row.p));
  assert.deepEqual(originals.map(row=>row.p.length),[48,26,35,22,24,7]);
  assert.equal(originals[2].p[14][0],pack.boundary.lastRetainedHebrew);
  assert.equal(originals[2].p[15][0],pack.boundary.firstDisplacedHebrew);
  const result=[];
  for(const row of rows){
    if(row.n===3){const kept=clone(row);kept.p=kept.p.slice(0,15);kept.footnotes=(kept.footnotes||[]).filter(note=>note.phraseIndex<15);result.push(kept);break;}
    result.push(clone(row));
  }
  result.push(...clone(rows.filter(row=>row.related)));
  assert.deepEqual(body(result),pack.afterBody);
  assert.deepEqual(result.flatMap(row=>row.footnotes||[]).map(note=>note.number),[1656,1657]);
  return result;
}

function legacyIdentity(row,note){return {sourceId:note.sourceId,placementId:note.placementId,number:note.number,
  uploadedNumber:note.provenance.uploadedNumber,fromRef:REF+':'+row.n};}

function verifyTransferredNotes(prior,chapter25){
  const displaced=prior.flatMap(row=>(row.footnotes||[]).filter(note=>note.number>=1658&&note.number<=1665).map(note=>({originRef:REF+':'+row.n,note,legacyIdentity:legacyIdentity(row,note)})));
  assert.deepEqual(displaced.map(item=>item.note.number),[1658,1659,1660,1661,1662,1663,1664,1665]);
  const notes=chapter25.flatMap(row=>row.footnotes||[]);assert.equal(notes.length,36,'The corrected chapter25 needs all36 independently reviewed source notes');
  assert.equal(new Set(notes.map(note=>note.number)).size,36);assert.ok(notes.every(note=>note.number>=5553));
  const migrations=[];
  for(const item of displaced.slice(0,7)){
    const matches=notes.filter(note=>note.provenance?.legacyIdentity?.number===item.note.number);
    assert.equal(matches.length,1,'A displaced source needs one exact destination: '+item.note.number);
    const target=matches[0];assert.deepEqual(target.provenance.legacyIdentity,item.legacyIdentity);
    assert.equal(target.provenance.section,'Peri Tzadik, Chanukah 25');assert.equal(target.provenance.item,6);
    assert.equal(target.verificationStatus,'verified');assert.ok(target.reviewedSourceExcerpt?.en);
    assert.equal(target.paragraphs.length,1,'Displaced sources must retain the English quotation-only popup');
    assert.equal(target.paragraphs[0].language,'en');
    migrations.push({legacyIdentity:item.legacyIdentity,destinationSourceId:target.sourceId,destinationNumber:target.number,
      destinationRef:'Peri Tzadik, Chanukah 25:6',destinationSourceRef:target.sources[0].ref,destinationPhraseIndex:target.phraseIndex});
  }
  assert.ok(!notes.some(note=>note.provenance?.legacyIdentity?.number===1665),'Invalid Lamentations4:100 note must not be duplicated');
  return {displaced,migrations};
}

function planBoundary(root,readBefore){
  const pack=readChanukah24BoundaryManifest(),read=relative=>parse(readBefore(relative)),changes=new Map();
  const stage=(relative,value)=>{const bytes=encode(value);if(!readBefore(relative).equals(bytes))changes.set(relative,bytes);};
  assert.equal(boundarySha(readBefore(pack.sourceEvidence.raw24File)),pack.sourceEvidence.raw24Sha256);
  assert.equal(boundarySha(readBefore(pack.sourceEvidence.raw25File)),pack.sourceEvidence.raw25Sha256);
  const prior=read(CHAPTER),kept=retainedChanukah24Rows(prior,pack);
  const toc=read('data/peri-tzadik/toc.json'),leaf=walk(toc.toc).find(node=>node.ref===REF&&node.interlinear);
  assert.equal(leaf.id,158);assert.equal(leaf.shape,6);assert.ok(!leaf.chanukah24Boundary);
  const leaf25=walk(toc.toc).find(node=>node.ref==='Peri Tzadik, Chanukah 25'&&node.interlinear);
  assert.ok(leaf25&&leaf25.id>201&&leaf25.shape===6&&leaf25.chanukah25Edition);
  const chapter25Path=`data/peri-tzadik/${leaf25.id}.json`,chapter25=read(chapter25Path),transfer=verifyTransferredNotes(prior,chapter25);
  validatePublishedChanukah25(leaf25,chapter25);
  stage(CHAPTER,kept);leaf.shape=3;leaf.chanukah24Boundary=CHANUKAH24_BOUNDARY_RELEASE;
  stage('data/peri-tzadik/toc.json',toc);
  const links=read('data/peri-tzadik/links.json');assert.ok(Array.isArray(links[REF]));
  const invalidAnchor=(anchor,source)=>anchor.startsWith(REF+':')&&(Number(anchor.slice((REF+':').length))>=4||(anchor===REF+':3'&&/^Bava Batra 172a(?::|$)/.test(source)));
  links[REF]=links[REF].filter(link=>!invalidAnchor(link.a,link.r));stage('data/peri-tzadik/links.json',links);
  const catalog=read('data/catalog.json'),book=catalog.find(item=>item.slug==='peri-tzadik');
  assert.ok(Number.isSafeInteger(book.segments)&&book.segments>3);book.segments-=3;stage('data/catalog.json',catalog);
  const citedDirectory=path.join(root,'data/cited');let invalidVerseStillCited=false;
  for(const filename of fs.readdirSync(citedDirectory).filter(name=>name.endsWith('.json')&&!['index.json','search.json'].includes(name))){
    const relative='data/cited/'+filename,refs=read(relative);if(!refs||Array.isArray(refs)||typeof refs!=='object')continue;
    let modified=false;
    for(const [ref,anchors]of Object.entries(refs)){
      if(!Array.isArray(anchors))continue;
      const retained=anchors.filter(anchor=>!invalidAnchor(anchor,ref));
      if(retained.length!==anchors.length){modified=true;if(retained.length)refs[ref]=retained;else delete refs[ref];}
    }
    if(refs['Lamentations 4:100']?.length)invalidVerseStillCited=true;
    if(modified)stage(relative,refs);
  }
  const sourcePack=read('data/packs/sources.json');
  if(!invalidVerseStillCited&&sourcePack.refs.includes('Lamentations 4:100')){
    sourcePack.refs=sourcePack.refs.filter(ref=>ref!=='Lamentations 4:100');stage('data/packs/sources.json',sourcePack);
  }
  const data=path.join(root,'data'),files=allFiles(data).map(file=>path.relative(data,file).split(path.sep).join('/')).filter(file=>file!=='files.json').sort();
  const hash=createHash('sha256'),priorHash=createHash('sha256');let bytes=0,priorBytes=0;
  for(const file of files){const original=readBefore('data/'+file),value=changes.get('data/'+file)||original;
    hash.update(file).update('\0').update(value);bytes+=value.length;
    priorHash.update(file).update('\0').update(original);priorBytes+=original.length;}
  assert.deepEqual(read('data/files.json'),{version:priorHash.digest('hex').slice(0,16),bytes:priorBytes,files},
    'Boundary predecessor offline manifest does not identify the full historical data');
  stage('data/files.json',{version:hash.digest('hex').slice(0,16),bytes,files});
  return {pack,changes,prior,kept,chapter25Path,chapter25Sha256:boundarySha(readBefore(chapter25Path)),...transfer};
}

export function readChanukah24Boundary(root='dist/library'){
  root=path.resolve(root);const file=path.join(root,CHANUKAH24_BOUNDARY_REPORT);if(!fs.existsSync(file))return null;
  const report=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(report.schemaVersion,1);assert.equal(report.release,CHANUKAH24_BOUNDARY_RELEASE);
  assert.equal(report.sourceManifestSha256,CHANUKAH24_BOUNDARY_MANIFEST_SHA256);
  assert.ok(Array.isArray(report.files)&&report.files.length>=5&&report.files.length<30);
  const historicalFiles=new Map();
  for(const entry of report.files){
    assert.ok(reportAllowed(entry.path)&&!historicalFiles.has(entry.path),'Invalid or duplicated correction path');
    assert.equal(typeof entry.beforeUtf8,'string');assert.equal(typeof entry.afterUtf8,'string');
    const before=Buffer.from(entry.beforeUtf8),after=Buffer.from(entry.afterUtf8);
    assert.equal(boundarySha(before),entry.beforeSha256);assert.equal(boundarySha(after),entry.afterSha256);
    assert.deepEqual(fs.readFileSync(path.join(root,entry.path)),after,'Boundary successor changed: '+entry.path);
    historicalFiles.set(entry.path,before);
  }
  const readBefore=relative=>historicalFiles.get(relative)||fs.readFileSync(path.join(root,relative));
  const plan=planBoundary(root,readBefore);
  assert.deepEqual([...plan.changes.keys()].sort(),[...historicalFiles.keys()].sort(),'Correction inventory differs from exact planned changes');
  for(const [relative,bytes]of plan.changes)assert.deepEqual(fs.readFileSync(path.join(root,relative)),bytes);
  assert.deepEqual(report.chapter24,{path:CHAPTER,beforeBodySha256:plan.pack.beforeBodySha256,
    afterBodySha256:plan.pack.afterBodySha256,retainedPairCounts:[48,26,15],retainedNoteNumbers:[1656,1657]});
  assert.equal(report.chapter25.path,plan.chapter25Path);assert.equal(report.chapter25.sha256,plan.chapter25Sha256);
  assert.deepEqual(report.migrations,plan.migrations);assert.deepEqual(report.archivedNotes,plan.displaced);
  assert.deepEqual(report.supersededNotes,plan.pack.supersededNotes);
  assert.equal(report.removedNoteCount,8);assert.equal(report.removedPhrasePairs,73);
  return {report,historicalFiles,files:report.files.map(({path,beforeSha256,afterSha256})=>({path,beforeSha256,afterSha256})),removedNoteCount:8};
}

export function publishChanukah24Boundary(root='dist/library'){
  root=path.resolve(root);const existing=readChanukah24Boundary(root);if(existing)return existing;
  const readBefore=relative=>fs.readFileSync(path.join(root,relative)),plan=planBoundary(root,readBefore);
  const files=[...plan.changes].map(([relative,after])=>{const before=readBefore(relative);return {path:relative,beforeSha256:boundarySha(before),afterSha256:boundarySha(after),beforeUtf8:before.toString('utf8'),afterUtf8:after.toString('utf8')};});
  const report={schemaVersion:1,release:CHANUKAH24_BOUNDARY_RELEASE,sourceManifestSha256:CHANUKAH24_BOUNDARY_MANIFEST_SHA256,
    chapter24:{path:CHAPTER,beforeBodySha256:plan.pack.beforeBodySha256,afterBodySha256:plan.pack.afterBodySha256,retainedPairCounts:[48,26,15],retainedNoteNumbers:[1656,1657]},
    chapter25:{path:plan.chapter25Path,sha256:plan.chapter25Sha256},removedPhrasePairs:73,removedNoteCount:8,
    migrations:plan.migrations,archivedNotes:plan.displaced,supersededNotes:plan.pack.supersededNotes,files};
  for(const entry of files)assert.equal(boundarySha(readBefore(entry.path)),entry.beforeSha256,'Concurrent source change');
  const reportFile=path.join(root,CHANUKAH24_BOUNDARY_REPORT);
  try{for(const [relative,bytes]of plan.changes)fs.writeFileSync(path.join(root,relative),bytes);
    fs.writeFileSync(reportFile,JSON.stringify(report));const checked=readChanukah24Boundary(root);
    console.log(JSON.stringify({release:report.release,paragraphs:3,phrasePairs:89,removedDuplicatedPairs:73,migratedSources:7,supersededInvalidSource:1665,changedDataFiles:files.length}));return checked;
  }catch(error){for(const entry of files)fs.writeFileSync(path.join(root,entry.path),entry.beforeUtf8);if(fs.existsSync(reportFile))fs.unlinkSync(reportFile);throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const at=process.argv.indexOf('--root'),root=at>=0?process.argv[at+1]:'dist/library';
  if(process.argv.includes('--verify')){const result=readChanukah24Boundary(root);assert.ok(result,'Boundary correction is not published');console.log(JSON.stringify({status:'verified',files:result.files,removedNoteCount:result.removedNoteCount}));}
  else publishChanukah24Boundary(root);
}

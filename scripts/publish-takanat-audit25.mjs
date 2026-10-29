// Controlled publication of audited Simanim 14–15 against the last verified Pages artifact.
// This script never modifies Simanim 1–13, original manuscripts, or another book.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {planPublication,sectionEdges,dataManifest,ARCHIVES} from './takanat-publication-plan.mjs';
import {sha,json,projectRows,TITLE} from './takanat-review-core.mjs';
import {info,fileInfo,inventory,sourceSlug} from './pri-parsha-review-core.mjs';
const REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const ROOT=path.resolve(process.env.AKIVA_ROOT||'dist');
const PAYLOAD='sources/akiva/overlays/takanat-part2-cp25-20261029.base64.txt';
const RECONCILIATION='sources/akiva/overlays/takanat-part2-cp25-20261029-reconciliation.json';
const RECONCILIATION_SHA='a4c780ff80b4c7b5d99660f3acf16312f091f4f5314bafccf7ca66a550188f91';
const DATA='library/data/takanat-hashavin/';
const REPORT='library/takanat-reader-review-20261026.json';
const PROOF='artifacts/takanat-part2-cp25/proof.json';
const STAGE='artifacts/takanat-part2-cp25/prepared.json';
const STAGE2='artifacts/takanat-part2-cp25/changed-files.json';
const EXPECT_COMPRESSED='9ddcda20391ecebf66cf63a8b49362a4a8599829375a93f31a906baa2be01395';
const EXPECT_RAW='e83503d1a2adbada1edf3b3446cc8382de490855b49900471d576bd423b253ea';
const PREVIOUS_PACK='f6c24cbf27eae86701d595f6c1e2bfe9c0242a8708dd762bc459b9c39d9a04e7';
const VERSION='20261029-takanat-part2-scholarly-audit25';
const expectedSHA=sha(Buffer.from(VERSION+'\n'+EXPECT_RAW));
const read=(n)=>JSON.parse(fs.readFileSync(path.join(ROOT,n),'utf8'));
const bytes=(n)=>fs.readFileSync(path.join(ROOT,n));
const save=(n,b)=>{const q=path.join(ROOT,n);fs.mkdirSync(path.dirname(q),{recursive:true});fs.writeFileSync(q,Buffer.isBuffer(b)?b:json(b));};
const artifact=(n,obj)=>{fs.mkdirSync(path.dirname(n),{recursive:true});fs.writeFileSync(n,JSON.stringify(obj,null,2)+'\n');};
function payload(){
 const encoded=fs.readFileSync(PAYLOAD,'utf8').replace(/\s+/g,'');
 const compressed=Buffer.from(encoded,'base64');assert.equal(sha(compressed),EXPECT_COMPRESSED,'Incomplete scholarly overlay');
 const raw=brotliDecompressSync(compressed);assert.equal(sha(raw),EXPECT_RAW);
 const pack=JSON.parse(raw);assert.equal(pack.metadata.release,'20261029-takanat-scholar-audit25-reader');
 assert.equal(pack.metadata.baselineCommit,'cedda55ddd2a26043ca25e80ed47d499fdf4741d');
 assert.equal(pack.metadata.baselineArtifactId,12775554669);
 for(const id of ['14','15'])assert(Array.isArray(pack.sections[id]));
 const n=id=>pack.sections[id].flatMap(r=>r.footnotes||[]);
 assert.equal(n('14').length,26);assert.equal(n('15').length,740);
 const ids=n('14').concat(n('15')).map(x=>x.sourceId);assert.equal(new Set(ids).size,766);
 return pack;
}
function snapshot(pack){
 const r=read(REPORT);assert.equal(r.packSha256,PREVIOUS_PACK,'The published pack has advanced');
 const sections=Array.from({length:16},(_,id)=>{
  const name=DATA+id+'.json';const before=read(name);
  if(id>=14)assert.equal(sha(bytes(name)),pack.metadata.baselineSections[id],'The published chapter changed: '+id);
  const after=id<14?structuredClone(before):pack.sections[String(id)];
  return{id,path:name,sectionRef:id?TITLE+' '+id:TITLE+', Introduction',before,after};
 });
 const originalNotes=new Map(sections.slice(14).flatMap(s=>s.before.flatMap(r=>r.footnotes||[])).map(n=>[n.sourceId,n]));
 const newNotesAll=sections.slice(14).flatMap(s=>s.after.flatMap(r=>r.footnotes||[]));
 assert.equal(originalNotes.size,766);assert.equal(newNotesAll.length,766);
 for(const n of newNotesAll){const o=originalNotes.get(n.sourceId);assert(o,'Unknown source note '+n.sourceId);for(const k of ['number','legacyNumber','sourceId','placementId','originRef'])assert.equal(n[k],o[k],k+' note ID changed');}
 for(const section of sections.slice(14)){
  assert.equal(section.before.length,section.after.length,'Reader paragraph coverage changed');
  for(let j=0;j<section.before.length;j++){
   const a=section.before[j],b=section.after[j];assert.equal(a.n,b.n);assert.equal(a.h,b.h);
   if(!a.p)continue;
   assert.equal(a.p.length,b.p.length);
   for(let k=0;k<a.p.length;k++)assert.equal(a.p[k][0],b.p[k][0],'Rav Tzadok Hebrew changed');
   const newNotes=(b.footnotes||[]);
   for(const n of newNotes){
    assert(n.phraseIndex>=0&&n.phraseIndex<b.p.length);
    const text=b.p[n.phraseIndex][0].replace(/<[^>]*>/g,'').replaceAll('&amp;','&');
    assert.equal(text.substring(0,n.heCharOffset).endsWith(n.heAnchorPrefix),true,'Invalid Hebrew marker '+n.number);
    assert(n.paragraphs.every(p=>p.rich.map(x=>x.text).join('')===p.text),'Stale styled quotation '+n.number);
   }
  }
 }
 return{sections,report:r};
}
function reconciliation(pack){
 const raw=fs.readFileSync(RECONCILIATION);
 assert.equal(sha(raw),RECONCILIATION_SHA,'Published reconciliation dispositions changed');
 const r=JSON.parse(raw);
 assert.equal(r.resolvedFormattingOperations,20);
 assert.equal(r.distinctSourceRecords,17);
 assert.equal(r.unresolvedFormattingOperations,0);
 assert.equal(r.sourceNoteChangesFromPreviouslyPreparedCandidate,0);
 assert.equal(r.records.length,20);
 const notes=new Map(Object.values(pack.sections).flatMap(rows=>rows.flatMap(row=>row.footnotes||[])).map(n=>[n.sourceId,n]));
 for(const row of r.records){
  const note=notes.get(row.sourceId);
  assert(note&&note.legacyNumber===row.legacyNumber,'Reconciled note identity missing');
  assert.equal(row.decision,'SUPERSEDED_BY_REVIEWED_SOURCE_NOTE');
  assert(!note.paragraphs.some(p=>p.text.includes(row.oldQuoteFragment)),'Old quoted witness unexpectedly reappeared');
 }
 return r;
}
function preflight(){const pack=payload();const resolutions=reconciliation(pack);assert.equal(expectedSHA.length,64);artifact(STAGE,{validated:true,release:VERSION,readerSections:[14,15],notes:766,verifiedBaseline:pack.metadata.baselineSections,successorPackSha256:expectedSHA,sourceHistoricPrintedWitnessCertified:false,quotedSourceFormattingConflictsResolved:resolutions.resolvedFormattingOperations});console.log('Prepared audited 766-note Part 2 overlay');}
function apply(){
 const pack=payload();reconciliation(pack);
 const{sections,report:prior}=snapshot(pack),baseline=inventory(ROOT);
 const prepared={pack:{sections,publicationBaseSections:sections.map(s=>s.before),upgradeFromPackSha256:PREVIOUS_PACK,excludedSectionIds:Array.from({length:14},(_,i)=>i)},packSha256:expectedSHA,counts:{originalDecisions:776,nativeNotesPart2:766,scholarlyNotesReviewed:766}};
 const plan=planPublication(ROOT,prepared);
 for(const[n,data]of plan.changes)save(n,data);
 const newFileIndex=new Map(prior.changedFiles.map(x=>[x.path,x]));
 for(const[n,data]of plan.changes)newFileIndex.set(n,{path:n,...info(data)});
 const records={...prior,successorRelease:VERSION,packSha256:expectedSHA,version:plan.version,counts:{...prior.counts,nativeNotesPart2:766,scholarlyNotesReviewed:766,addedConnections:plan.counts.addedConnections,removedConnections:plan.counts.removedConnections,parallelCandidates:plan.counts.parallelCandidates},changedFiles:[...newFileIndex.values()],archives:plan.archives,scholarlyAudit:{checkpoint:25,reviewedNotes:766,sourceCertifications: 'Individual editorial reviews; uncollated historical editions retain qualifications',publishedHebrewChanged:false,publishedEarlierChaptersChanged:false,wordFilesChanged:false,siman10Changed:false,independentExistingSupplementalCorrectionsPreservedWhereApplicable:true},verification:{...prior.verification,checkpoint25Applied:true,sourceHistoricityNotIndependentlyCertified:true,quotedSourceFormattingConflictsResolved:20,exactMarkersChecked:true}};
 save(REPORT,records);
 const after=inventory(ROOT);assert.deepEqual(Object.keys(after).sort(),[...new Set([...Object.keys(baseline),...plan.changes.keys()])].sort(),'Unexpected publication file appeared or disappeared');
 for(const[n,was]of Object.entries(baseline))if(n!==REPORT&&!plan.changes.has(n))assert.deepEqual(after[n],was,'Unrelated reader file changed: '+n);
 artifact(STAGE2,{release:VERSION,priorVersion:prior.version,newVersion:plan.version,publicPreimageGuard:Object.fromEntries(['library/index.html','library/data/files.json','library/data/takanat-hashavin/14.json','library/data/takanat-hashavin/15.json','library/connected-ideas/catalog.json','library/sw.js','library/downloads/index.json'].map(n=>[n,baseline[n].sha256])),changedFiles:[...plan.changes].map(([n,b])=>({path:n,before:baseline[n],after:info(b)})),archives:plan.archives,connections:plan.counts});
 verify();
 console.log(JSON.stringify({applied:true,release:VERSION,changedFiles:plan.changes.size,version:plan.version}));
}
function verify(){
 const pack=payload();reconciliation(pack);
 const{sections}=snapshotVerified(pack),r=read(REPORT),changed=new Map(r.changedFiles.map(f=>[f.path,f]));
 assert.equal(r.packSha256,expectedSHA);assert.equal(r.successorRelease,VERSION);
 let notes=0;for(const section of sections){if(section.id<14){assert.deepEqual(section.before,section.after);}const id=section.id,p=DATA+id+'.json';if(id>=14)assert.deepEqual(read(p),pack.sections[String(id)]);notes+=section.after.flatMap(x=>x.footnotes||[]).length;}
 assert.equal(sections[14].after.flatMap(x=>x.footnotes||[]).length+sections[15].after.flatMap(x=>x.footnotes||[]).length,766);assert.equal(notes,2618);
 const links=read('library/data/takanat-hashavin/links.json'),mcp=read('mcp-data/text/takanat-hashavin.json');
 for(const section of sections){assert.deepEqual(links[section.sectionRef],sectionEdges(section),'Citation index mismatch '+section.sectionRef);assert.deepEqual(mcp.paras.filter(x=>x.s===section.id),projectRows(section,section.id,links),'MCP data mismatch '+section.sectionRef);}
 const unzip=createRequire(import.meta.url)(path.join(ROOT,'library/vendor/fflate.min.js')).unzipSync;
 for(const name of ARCHIVES){const zip=unzip(bytes(name));for(const s of [14,15]){assert.equal(sha(zip['data/takanat-hashavin/'+s+'.json']),sha(bytes(DATA+s+'.json')),'Offline reader archive was not updated');}const f=zip['data/takanat-hashavin/links.json'];assert.equal(sha(f),sha(bytes('library/data/takanat-hashavin/links.json')));}
 for(const[n,pin]of changed)assert.deepEqual(fileInfo(path.join(ROOT,n)),{bytes:pin.bytes,sha256:pin.sha256},'Published artifact drift '+n);
 const proof={ok:true,release:VERSION,packSha256:expectedSHA,notesPart2:766,allNativeNotes:2618,unchangedEarlierSimanim:true,downloadArchivesSynchronized:ARCHIVES,reviewedSourceLimitationsRemain:true,version:r.version};artifact(PROOF,proof);return proof;
}
function snapshotVerified(pack){
 const sections=Array.from({length:16},(_,id)=>{const after=read(DATA+id+'.json');return{id,path:DATA+id+'.json',sectionRef:id?TITLE+' '+id:TITLE+', Introduction',before:after,after};});
 for(let id=14;id<=15;id++)assert.deepEqual(sections[id].after,pack.sections[String(id)]);
 return{sections};
}
async function guard(){
 reconciliation(payload());
 const api=await fetch('https://api.github.com/repos/'+REPO+'/git/ref/heads/main',{headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN}}).then(r=>r.json());
 assert.equal(api.object.sha,process.env.GITHUB_SHA,'Main branch advanced during publication');
 const base='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
 const filePins=JSON.parse(fs.readFileSync(STAGE2)).publicPreimageGuard;
 for(const [name,expected] of Object.entries(filePins)){const url=base+name+'?cp25verify='+Date.now();const res=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(70000)});assert(res.ok,name+': HTTP '+res.status);assert.equal(sha(Buffer.from(await res.arrayBuffer())),expected,'Production changed before deploy: '+name);}
 console.log('Current live publication and main branch verified');
}
async function live(){
 const proof=verify();const changed=JSON.parse(fs.readFileSync(STAGE2)).changedFiles;
 const key=changed.filter(x=>['library/data/takanat-hashavin/14.json','library/data/takanat-hashavin/15.json','library/data/takanat-hashavin/links.json','library/data/files.json','library/index.html','library/sw.js','library/downloads/books/takanat-hashavin.zip','library/downloads/rav-tzadok-library.zip'].includes(x.path));
 for(const file of key){const res=await fetch('https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'+file.path+'?cp25-live='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(180000)});assert(res.ok,file.path+' HTTP '+res.status);assert.equal(sha(Buffer.from(await res.arrayBuffer())),file.after.sha256,'Live mismatch: '+file.path);}
 artifact('artifacts/takanat-part2-cp25/live.json',{...proof,live:true,checked:key.length,verifiedAt:new Date().toISOString()});console.log(JSON.stringify({live:true,verified:key.length}));
}
const mode=process.argv[2];if(mode==='--prepare')preflight();else if(mode==='--apply')apply();else if(mode==='--verify'){console.log(JSON.stringify(verify()));}else if(mode==='--guard')await guard();else if(mode==='--live')await live();else throw Error('Use --prepare, --apply, --verify, --guard or --live');

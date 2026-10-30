// Scoped final Reader publication: only audited Takanas HaShavin Simanim 1-9,
// their citations, indexes and downloadable archives. Preserve latest Part 2.
// The last successful Pages artifact is restored before --apply.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {planPublication, sectionEdges, ARCHIVES} from './takanat-publication-plan.mjs';
import {sha, json, splitNotes, projectRows, TITLE} from './takanat-review-core.mjs';
import {inventory, info, fileInfo} from './pri-parsha-review-core.mjs';

const ROOT=path.resolve(process.env.AKIVA_ROOT||'dist');
const STAGE=path.resolve(process.env.RUNNER_TEMP||'artifacts','takanas-final-staged');
const SOURCE='sources/akiva/Takanat_HaShavin.json';
const SOURCE_SHA='bea64136f6cdfbcce4d41098ea92715be6f1f42554872f02d59401d6c68d5958';
const AUDIT='editorial/takanas-reader-final-applied-audit.json';
const REPORT='library/takanat-reader-review-20261026.json';
const DATA='library/data/takanat-hashavin/';
const PROOF='artifacts/takanas-scoped-reader-final/proof.json';
const PREP='artifacts/takanas-scoped-reader-final/staged.json';
const RELEASE='20261029-takanas-scoped-reader-final-1-13';
const PUBLISH_SHA=sha(Buffer.from(RELEASE+'\n'+SOURCE_SHA));
const MODIFIED=[1,2,3,4,5,6,7,8,9];
const EXCLUDED=[0,10,11,12,13,14,15];
const SOURCE_PIN=fs.readFileSync(SOURCE);
const read=n=>JSON.parse(fs.readFileSync(path.join(ROOT,n),'utf8'));
const bytes=n=>fs.readFileSync(path.join(ROOT,n));
const save=(name,data)=>{const file=path.join(ROOT,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.isBuffer(data)?data:json(data));};
const artifact=(name,value)=>{fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,JSON.stringify(value,null,2)+'\n');};
const expectSource=()=>{
 assert.equal(sha(SOURCE_PIN),SOURCE_SHA,'The audited Takanas source changed');
 const audit=JSON.parse(fs.readFileSync(AUDIT,'utf8'));
 assert.equal(audit.output_sha256,SOURCE_SHA);
 assert.equal(audit.total_operation_count,36);
 assert.equal(audit.edited_notes,29);
 assert.equal(audit.operations.filter(op=>op[0]==='move').length,10);
 return audit;
};
const expectedStage=()=>JSON.parse(fs.readFileSync(path.join(STAGE,'hashes.json'),'utf8'));
const verifyStage=()=>{
 expectSource();
 const pins=expectedStage(), names=[...MODIFIED.map(n=>DATA+n+'.json'),DATA+'links.json'];
 assert.deepEqual(Object.keys(pins).sort(),names.sort(),'Unexpected prepared file scope');
 for(const [name,pin]of Object.entries(pins)){
   assert(/^[a-f0-9]{64}$/.test(pin),'Invalid prepared digest');
   assert.equal(sha(fs.readFileSync(path.join(STAGE,path.basename(name)))),pin,'Prepared Reader chapter drift: '+name);
 }
 return pins;
};
const markers=rows=>rows.flatMap(row=>(row.p||[]).flatMap(pair=>pair.flatMap(text=>[...String(text).matchAll(/<sup class="footnote-marker">([^<]+)<\/sup>/g)].map(match=>match[1])))).sort();
const readingText=html=>splitNotes(String(html||'')).text;
function mergeSectionPreservingNative(before,candidate,id){
 assert.equal(before.length,candidate.length,'Structure differs in Siman '+id);
 const merged=structuredClone(before);
 const withoutPairsAndNative=row=>Object.fromEntries(Object.entries(row).filter(([k])=>k!=='p'&&k!=='footnotes'));
 for(let j=0;j<before.length;j++){
  const a=before[j],b=candidate[j];
  // Original published native footnotes are an independent, later edition
  // and must never be overwritten by a source-only inline footnote patch.
  assert.deepEqual(withoutPairsAndNative(a),withoutPairsAndNative(b),'Unapproved metadata change in '+id+':'+j);
  assert.equal(Boolean(a.p),Boolean(b.p),'Paragraph changed at '+id+':'+j);
  if(!a.p)continue;
  assert.equal(a.p.length,b.p.length,'Phrase count changed at '+id+':'+j);
  for(let k=0;k<a.p.length;k++){
   assert.equal(a.p[k][0],b.p[k][0],'Original Hebrew changed at '+id+':'+j+':'+k);
   assert.equal(readingText(a.p[k][1]),readingText(b.p[k][1]),'English outside source notes changed at '+id+':'+j+':'+k);
   merged[j].p[k][1]=b.p[k][1];
  }
  assert.deepEqual(merged[j].footnotes,a.footnotes,'Existing native Reader footnotes were altered at '+id+':'+j);
 }
 assert.deepEqual(markers(before),markers(merged),'Footnote marker identity changed in Siman '+id);
 for(let j=0;j<merged.length;j++){
  if(!merged[j].p)continue;
  for(let k=0;k<merged[j].p.length;k++)assert.deepEqual(merged[j].p[k],candidate[j].p[k],'Audited inline edition not applied at '+id+':'+j+':'+k);
 }
 return merged;
}
const nativeFingerprint=rows=>sha(json(rows.map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>k!=='p')))));

function sectionsForPlan(){
 const pinned=verifyStage();
 const sections=Array.from({length:16},(_,id)=>{
  const name=DATA+id+'.json';
  const before=read(name);
  const candidate=MODIFIED.includes(id)?JSON.parse(fs.readFileSync(path.join(STAGE,id+'.json'),'utf8')):null;
  const after=candidate?mergeSectionPreservingNative(before,candidate,id):structuredClone(before);
  return{id,path:name,sectionRef:id?TITLE+' '+id:TITLE+', Introduction',before,after};
 });
 let footnoteCount=0,hebrewCount=0;
 for(const section of sections.slice(1,14))for(const row of section.after)for(const pair of row.p||[]){
  for(let lang=0;lang<2;lang++){
   const count=[...String(pair[lang]).matchAll(/<sup class="footnote-marker">([^<]+)<\/sup>/g)].length;
   footnoteCount+=count;
   if(lang===0)hebrewCount+=count;
  }
 }
 assert.equal(footnoteCount,1891,'Simanim 1-13 marker inventory differs');
 assert.equal(hebrewCount,31,'The Hebrew-side source markers changed');
 for(const id of EXCLUDED)assert.deepEqual(sections[id].before,sections[id].after,'Protected section changed: '+id);
 return {sections,pinned};
}
function preflight(){
 const pins=verifyStage();artifact(PREP,{release:RELEASE,sourceSha256:SOURCE_SHA,preparedFiles:pins,footnoteCorrections:36,distinctFootnotes:29,relocations:10});
 console.log('PASS final Reader source and 10 staged file checksums');
}
function apply(){
 const{sections,pinned}=sectionsForPlan();
 const original=inventory(ROOT),prior=read(REPORT);
 assert.match(prior.packSha256,/^[a-f0-9]{64}$/,'Missing authenticated previous Takanas publication');
 assert(prior.successorRelease==='20261029-takanat-part2-scholarly-audit25','Not the last verified 14-15 publication');
 const prepared={pack:{
   sections,
   publicationBaseSections:sections.map(x=>x.before),
   upgradeFromPackSha256:prior.packSha256,
   excludedSectionIds:EXCLUDED,
 },packSha256:PUBLISH_SHA,counts:{...prior.counts,correctedNotes:29,correctionOperations:36,relocations:10}};
 const plan=planPublication(ROOT,prepared);
 const allowedReader=new Set([...MODIFIED.map(n=>DATA+n+'.json'),DATA+'links.json']);
 for(const [name]of plan.changes){
   if(name.startsWith(DATA))assert(allowedReader.has(name),'Protected Reader chapter unexpectedly changed: '+name);
 }
 for(const [name,data]of plan.changes)save(name,data);
 const after=inventory(ROOT);
 assert.deepEqual(Object.keys(original).sort(),Object.keys(after).sort(),'Scoped publication added or removed files');
 for(const [name,record]of Object.entries(original)){
  if(name===REPORT||plan.changes.has(name))continue;
  assert.deepEqual(after[name],record,'Unrelated published file changed: '+name);
 }
 const fullIndex=new Map((prior.changedFiles||[]).map(x=>[x.path,x]));
 for(const [name,data]of plan.changes)fullIndex.set(name,{path:name,...info(data)});
 const report={...prior,
   predecessorPackSha256:prior.packSha256,
   predecessorSuccessorRelease:prior.successorRelease,
   successorRelease:RELEASE,packSha256:PUBLISH_SHA,version:plan.version,
   counts:{...prior.counts,correctedNotes:29,correctionOperations:36,relocations:10,
     addedConnections:plan.counts.addedConnections,removedConnections:plan.counts.removedConnections},
   changedFiles:[...fullIndex.values()],archives:plan.archives,
   finalReaderAudit:{sourceSha256:SOURCE_SHA,sourceFile:SOURCE,modifiedSimanim:MODIFIED,
     unchangedSimanim:EXCLUDED,stagedHashes:pinned,strictTextAndMarkerValidation:true,
     unresolvedClusters:186,allSourceNotesIndependentlyCertified:false},
   verification:{...prior.verification,finalReaderSimanim1to9Applied:true,
     finalReaderSimanim10to15Preserved:true,readerZipsSynchronized:true}
 };
 save(REPORT,report);
 const afterReport=inventory(ROOT);
 for(const [name,record]of Object.entries(original)){
  if(name===REPORT||plan.changes.has(name))continue;
  assert.deepEqual(afterReport[name],record,'An unrelated file changed after report update: '+name);
 }
 const guardFiles=[
  'library/data/takanat-hashavin/1.json','library/data/takanat-hashavin/14.json',
  'library/data/takanat-hashavin/15.json','library/data/takanat-hashavin/links.json',
  'library/index.html','library/sw.js','library/downloads/index.json',
  'library/connected-ideas/catalog.json'
 ];
 artifact(PROOF,{release:RELEASE,sourceSha256:SOURCE_SHA,packSha256:PUBLISH_SHA,
  previousPackSha256:prior.packSha256,baselineArtifact:12895046269,baselineRun:40868225572,
  originalPins:Object.fromEntries(guardFiles.map(n=>[n,original[n]?.sha256])),
  protectedHashes:Object.fromEntries(EXCLUDED.map(id=>[DATA+id+'.json',original[DATA+id+'.json']?.sha256])),
  preservedNativeMetadataHashes:Object.fromEntries(MODIFIED.map(id=>[DATA+id+'.json',nativeFingerprint(sections[id].before)])),
  mergedReaderHashes:Object.fromEntries(MODIFIED.map(id=>[DATA+id+'.json',sha(bytes(DATA+id+'.json'))])),
  changedFiles:[...plan.changes].map(([name,data])=>({path:name,before:original[name],after:info(data)})),
  archives:plan.archives,version:plan.version,stagedHashes:pinned});
 verify();
 console.log(JSON.stringify({applied:true,release:RELEASE,modifiedSections:MODIFIED,changedFiles:plan.changes.size,version:plan.version}));
}
function verify(){
 const proof=JSON.parse(fs.readFileSync(PROOF,'utf8')), report=read(REPORT);
 assert.equal(proof.packSha256,PUBLISH_SHA);
 assert.equal(report.packSha256,PUBLISH_SHA);
 assert.equal(read('library/data/files.json').version,proof.version);
 assert.equal(read('library/downloads/index.json').version,proof.version);
 assert.equal(read('mcp-data/catalog.json').version,proof.version);
 for(const[id,digest]of Object.entries(proof.protectedHashes))assert.equal(sha(bytes(id)),digest,'Excluded section changed: '+id);
 for(const id of MODIFIED){
  const file=DATA+id+'.json',rows=read(file),candidate=JSON.parse(fs.readFileSync(path.join(STAGE,id+'.json'),'utf8'));
  assert.equal(sha(bytes(file)),proof.mergedReaderHashes[file],'Merged Reader chapter changed: '+id);
  assert.equal(nativeFingerprint(rows),proof.preservedNativeMetadataHashes[file],'Existing native footnotes changed: '+id);
  assert.equal(rows.length,candidate.length,'Reader structure drift: '+id);
  for(let j=0;j<rows.length;j++)if(rows[j].p)assert.deepEqual(rows[j].p,candidate[j].p,'Audited inline text differs: '+id+':'+j);
 }
 const links=read(DATA+'links.json'),mcp=read('mcp-data/text/takanat-hashavin.json');
 for(let id=0;id<16;id++){
  const section={id,sectionRef:id?TITLE+' '+id:TITLE+', Introduction',after:read(DATA+id+'.json')};
  assert.deepEqual(links[section.sectionRef],sectionEdges(section),'Reader links mismatch for Siman '+id);
  assert.deepEqual(mcp.paras.filter(x=>x.s===id),projectRows(section,id,links),'MCP mismatch for Siman '+id);
 }
 const unzip=createRequire(import.meta.url)(path.join(ROOT,'library/vendor/fflate.min.js')).unzipSync;
 for(const file of ARCHIVES){
  const entries=unzip(bytes(file));
  for(const id of MODIFIED)assert.equal(sha(entries['data/takanat-hashavin/'+id+'.json']),sha(bytes(DATA+id+'.json')),'Stale offline chapter '+id);
  assert.equal(sha(entries['data/takanat-hashavin/links.json']),sha(bytes(DATA+'links.json')),'Stale offline links');
  for(const id of EXCLUDED)assert.equal(sha(entries['data/takanat-hashavin/'+id+'.json']),sha(bytes(DATA+id+'.json')),'Protected offline section changed');
 }
 for(const row of proof.changedFiles)assert.deepEqual(fileInfo(path.join(ROOT,row.path)),row.after,'Changed output drift: '+row.path);
 assert(fs.readFileSync(path.join(ROOT,'library/index.html'),'utf8').includes(PUBLISH_SHA.slice(0,12)),'Reader cache edition not refreshed');
 assert(fs.readFileSync(path.join(ROOT,'library/sw.js'),'utf8').includes('-takanat-'+PUBLISH_SHA.slice(0,12)),'Installed Reader cache not refreshed');
 return{ok:true,release:RELEASE,sourceSha256:SOURCE_SHA,updatedSimanim:MODIFIED,unchangedSimanim:EXCLUDED,archives:ARCHIVES,version:proof.version};
}
async function remote(file,token,limit=90000){
 const url='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'+file+'?takanasFinal='+token;
 const res=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(limit)});
 assert(res.ok,'Live HTTP '+res.status+': '+file);
 return Buffer.from(await res.arrayBuffer());
}
async function guard(){
 const proof=JSON.parse(fs.readFileSync(PROOF,'utf8'));
 const api=await fetch('https://api.github.com/repos/akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok/git/ref/heads/main',
   {headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN},signal:AbortSignal.timeout(30000)}).then(r=>r.json());
 assert.equal(api.object.sha,process.env.GITHUB_SHA,'Main advanced during scoped publication');
 for(const [name,pin]of Object.entries(proof.originalPins))assert.equal(sha(await remote(name,'baseline',90000)),pin,'Live predecessor advanced: '+name);
 console.log('PASS main branch and latest published Pages baseline unchanged');
}
async function live(){
 const proof=JSON.parse(fs.readFileSync(PROOF,'utf8'));
 const critical=new Set([...MODIFIED.map(n=>DATA+n+'.json'),DATA+'links.json',
   'library/data/files.json','library/downloads/books/takanat-hashavin.zip','library/index.html','library/sw.js']);
 const verified=verify();
 for(const row of proof.changedFiles.filter(x=>critical.has(x.path)))
   assert.equal(sha(await remote(row.path,'published',180000)),row.after.sha256,'Public Reader bytes mismatch: '+row.path);
 artifact('artifacts/takanas-scoped-reader-final/live.json',{...verified,live:true,verifiedAt:new Date().toISOString(),verifiedFiles:[...critical]});
 console.log(JSON.stringify({live:true,verified:critical.size,release:RELEASE,version:proof.version}));
}
const mode=process.argv[2];
if(mode==='--prepare')preflight();
else if(mode==='--apply')apply();
else if(mode==='--verify')console.log(JSON.stringify(verify()));
else if(mode==='--guard')await guard();
else if(mode==='--live')await live();
else throw Error('Use --prepare, --apply, --verify, --guard, or --live');

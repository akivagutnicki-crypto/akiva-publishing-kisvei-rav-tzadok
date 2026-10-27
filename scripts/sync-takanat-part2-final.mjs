// Integrate the checksum-pinned, already-tested reconciliation without new editorial edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
import {sha,json,projectRows,RELEASE,TITLE} from './takanat-review-core.mjs';
import {planPublication,dataManifest,sectionEdges,ARCHIVES} from './takanat-publication-plan.mjs';
import {info,fileInfo,inventory,sourceSlug} from './pri-parsha-review-core.mjs';
const ROOT=path.resolve(process.env.AKIVA_ROOT||'dist'),R='library/takanat-reader-review-20261026.json',B='takanat-hashavin';
const CFG='reconciliation/final-release.json',META=JSON.parse(fs.readFileSync(CFG)),PIN=sha(fs.readFileSync(CFG));
const read=n=>JSON.parse(fs.readFileSync(path.join(ROOT,n))),bytes=n=>fs.readFileSync(path.join(ROOT,n));
const write=(n,b)=>{const p=path.join(ROOT,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.isBuffer(b)?b:json(b));};
function prep(){
 assert.equal(sha(fs.readFileSync('reconciliation/recipe.json')),META.recipeSha256);
 assert.equal(sha(fs.readFileSync('reconciliation/apply_reconciliation.py')),META.applyScriptSha256);
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'takanat-final-'));
 for(const n of Object.keys(META.expectedCorrectedFiles)){const p=path.join(work,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes(n));}
 execFileSync('python3',['reconciliation/apply_reconciliation.py','--root',work,'--recipe','reconciliation/recipe.json','--report','reconciliation/reconciliation-applied.json'],{stdio:'inherit'});
 for(const[n,pin]of Object.entries(META.expectedCorrectedFiles))assert.equal(sha(fs.readFileSync(path.join(work,n))),pin,n);
 const sections=Array.from({length:16},(_,id)=>{const p=`library/data/${B}/${id}.json`,before=read(p),after=id<14?structuredClone(before):JSON.parse(fs.readFileSync(path.join(work,p)));return{id,path:p,sectionRef:id?TITLE+' '+id:TITLE+', Introduction',before,after};});
 const prepared={pack:{sections,publicationBaseSections:sections.map(s=>s.before),upgradeFromPackSha256:META.priorCandidatePackSha256,excludedSectionIds:Array.from({length:14},(_,i)=>i)},packSha256:PIN,counts:{originalDecisions:META.originalDecisions,nativeNotesPart2:766,supplementalChangedNotes:37}};
 const plan=planPublication(ROOT,prepared);
 const oldVersion=RELEASE+'-'+META.priorCandidatePackSha256.slice(0,12),newVersion=RELEASE+'-'+PIN.slice(0,12);
 let html=fs.readFileSync(path.join(work,'library/index.html'),'utf8');assert(html.includes(oldVersion));html=html.split(oldVersion).join(newVersion);
 const planned=plan.changes.get('library/index.html').toString(),recipe=JSON.parse(fs.readFileSync('reconciliation/recipe.json'));
 const oldAllow=JSON.stringify([recipe.previousAllowedPdfUrl]),newAllow=JSON.stringify([recipe.previousAllowedPdfUrl,recipe.exactPdfUrl]);
 assert.equal(planned.split('/* Exact reviewed Part 2 external source URLs */ '+oldAllow).length,2);
 assert.equal(planned.replace('/* Exact reviewed Part 2 external source URLs */ '+oldAllow,'/* Exact reviewed Part 2 external source URLs */ '+newAllow),html,'Only the tested PDF allowlist change may supplement the generated cache refresh');
 plan.changes.set('library/index.html',Buffer.from(html));
 for(const id of [14,15])assert.equal(sha(plan.changes.get(`library/data/${B}/${id}.json`)),META.expectedCorrectedFiles[`library/data/${B}/${id}.json`]);
 fs.rmSync(work,{recursive:true});return{plan,sections};
}
function archiveDisparities(){
 const {unzipSync}=createRequire(import.meta.url)(path.join(ROOT,'library/vendor/fflate.min.js'));const result=[];
 for(const archive of ARCHIVES){const members=unzipSync(bytes(archive));for(const[key,data]of Object.entries(members)){
  if(!key.startsWith('data/')||key==='data/files.json'||key==='data/catalog.json'&&archive.includes('/books/'))continue;
  const n='library/'+key,reader=bytes(n),storedSha256=sha(data),readerSha256=sha(reader);
  if(storedSha256!==readerSha256){assert(!key.startsWith('data/'+B+'/')&&key!=='data/parallels/'+B+'.json','Unreconciled Takanat ZIP preimage');result.push({archive,member:key,storedSha256,readerSha256});}
 }}return result;
}
function verify({complete=true}={}){
 const r=read(R);assert.equal(r.packSha256,PIN);assert.equal(r.successorRelease,META.release);
 const changed=new Map(r.changedFiles.map(f=>[f.path,{bytes:f.bytes,sha256:f.sha256}]));assert.equal(changed.size,r.changedFiles.length);
 if(complete){const actual=inventory(ROOT);assert.deepEqual(Object.keys(actual).sort(),[...new Set([...Object.keys(r.baselineFiles),...changed.keys(),R])].sort());for(const[n,p]of Object.entries(r.baselineFiles))assert.deepEqual(actual[n],changed.get(n)||p,'Unrelated publication file changed: '+n);}
 for(const[n,p]of changed)assert.deepEqual(fileInfo(path.join(ROOT,n)),p,'Sealed output changed: '+n);
 const links=read(`library/data/${B}/links.json`),mcp=read(`mcp-data/text/${B}.json`),reverse=read('mcp-data/cited.json'),checks=[];let total=0;
 for(let id=0;id<16;id++){
  const n=`library/data/${B}/${id}.json`,rows=read(n),section={id,sectionRef:id?TITLE+' '+id:TITLE+', Introduction',after:rows};
  if(id<14)assert.deepEqual(fileInfo(path.join(ROOT,n)),r.baselineFiles[n],'Earlier section changed');else assert.equal(sha(bytes(n)),META.expectedCorrectedFiles[n]);
  assert.deepEqual(links[section.sectionRef],sectionEdges(section),'Citation index differs from actual section');
  assert.deepEqual(mcp.paras.filter(p=>p.s===id),projectRows(section,id,links),'MCP text/footnote projection differs');
  for(const e of links[section.sectionRef]){assert(reverse[e.r]?.includes(e.a),'Reverse citation missing: '+e.r);const rev=read('library/data/cited/'+sourceSlug(e.r)+'.json');assert(rev[e.r]?.includes(e.a),'Reader reverse citation missing: '+e.r);}
  const notes=rows.flatMap(x=>x.footnotes||[]);total+=notes.length;checks.push({id,notes:notes.length,readerAndMcpAgree:true,forwardAndReverseCitationsAgree:true});
 }
 assert.equal(total,2618);assert.equal(checks[14].notes+checks[15].notes,766);
 const entries={}; // The manifest is computed from actual data bytes.
 const walk=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,prefix+e.name+'/');else entries[prefix+e.name]=fs.readFileSync(p);}};walk(path.join(ROOT,'library/data'),'data/');
 assert.deepEqual(read('library/data/files.json'),dataManifest(entries),'Reader cache manifest stale');
 const {unzipSync}=createRequire(import.meta.url)(path.join(ROOT,'library/vendor/fflate.min.js'));const archives=[];
 for(const n of ARCHIVES){const members=unzipSync(bytes(n));let compared=0;for(const [key,data]of Object.entries(members)){if(!key.startsWith('data/'))continue;if(key==='data/files.json'){assert.deepEqual(JSON.parse(Buffer.from(data)),dataManifest(members));continue;}if(key==='data/catalog.json'&&n.includes('/books/')){assert.deepEqual(JSON.parse(Buffer.from(data)),[read('library/data/catalog.json').find(b=>b.slug===B)]);continue;}if(sha(data)!==sha(bytes('library/'+key))){const inherited=(r.inheritedArchiveDisparities||[]).find(x=>x.archive===n&&x.member===key);assert(inherited,'New ZIP/reader discrepancy: '+n+' '+key);assert.equal(sha(data),inherited.storedSha256);assert.equal(sha(bytes('library/'+key)),inherited.readerSha256);assert(!key.startsWith('data/'+B+'/')&&key!=='data/parallels/'+B+'.json');}else compared++;}archives.push({path:n,comparedDataFiles:compared,inheritedUnrelatedDisparities:(r.inheritedArchiveDisparities||[]).filter(x=>x.archive===n).length,...fileInfo(path.join(ROOT,n))});}
 assert.equal(read('mcp-data/catalog.json').version,read('library/data/files.json').version);
 const dl=read('library/downloads/index.json');assert.equal(dl.version,read('library/data/files.json').version);for(const a of archives){const item=a.path.includes('/books/')?dl.books.find(x=>x.slug===B):dl.library;assert.equal(item.bytes,a.bytes);}
 const proof={ok:true,release:META.release,packSha256:PIN,predecessorPackSha256:META.priorCandidatePackSha256,completePublicationPreservationChecked:complete,counts:r.counts,sections:checks,archives,version:dl.version,changedFiles:r.changedFiles.length,limitations:META.limitations};
 fs.writeFileSync('takanat-part2-final-verification.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({ok:true,release:META.release,changedFiles:r.changedFiles.length,version:dl.version,allNativeNotes:total,completePublicationPreservationChecked:complete}));return proof;
}
function apply({localOnly=false}={}){
 const previous=read(R);assert.equal(previous.packSha256,META.priorCandidatePackSha256);
 const before=inventory(ROOT),inheritedArchiveDisparities=archiveDisparities(),{plan}=prep();
 for(const d of inheritedArchiveDisparities)assert(!plan.changes.has('library/'+d.member),'A generated update must not carry forward a stale archive copy: '+d.member);
 for(const[n,b]of plan.changes)write(n,b);
 const cumulative=new Map(previous.changedFiles.map(f=>[f.path,f]));for(const[n,b]of plan.changes)cumulative.set(n,{path:n,...info(b)});
 const changedFiles=[...cumulative.values()];const report={...previous,successorRelease:META.release,packSha256:PIN,counts:{...previous.counts,connections:plan.counts.connections,supplementalChangedNotes:37,supplementalAddedConnections:plan.counts.addedConnections,supplementalRemovedConnections:plan.counts.removedConnections},archives:plan.archives,version:plan.version,changedFiles,inheritedArchiveDisparities,supplementalReconciliation:{...META,manifestSha256:PIN,independentPriorRun:40592180610,noAdditionalEditorialEdits:true,priorCandidatePackSha256:previous.packSha256,derivedRepresentationSynchronization:plan.counts,previousArchiveEvidence:previous.archives},verification:{...previous.verification,takanatReaderMcpAndDownloadsSynchronized:true,inheritedUnrelatedArchiveDisparitiesPreserved:true,unconfirmedWordParagraphStillExcluded:true}};
 write(R,report);
 // An exact supplemental file allowlist; no files outside the generated plan may differ.
 const after=inventory(ROOT);assert.deepEqual(Object.keys(before).sort(),Object.keys(after).sort());for(const[n,p]of Object.entries(before))if(n!==R&&!plan.changes.has(n))assert.deepEqual(after[n],p,'Unexpected supplemental change: '+n);
 fs.writeFileSync('reconciliation/final-synchronization.json',JSON.stringify({release:META.release,manifestSha256:PIN,changes:[...plan.changes].map(([n,b])=>({path:n,before:before[n],after:info(b)})),connectedRemapping:plan.connectedRemapping,archives:plan.archives,counts:plan.counts},null,2)+'\n');
 return verify({complete:!localOnly});
}
async function live(){
 const proof=verify();const report=read(R),site='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
 const files=[...report.changedFiles,{path:R,...fileInfo(path.join(ROOT,R))},...Array.from({length:14},(_,id)=>{const n=`library/data/${B}/${id}.json`;return{path:n,...fileInfo(path.join(ROOT,n))};})];let next=0;const checked=[];
 await Promise.all(Array.from({length:4},async()=>{for(;;){const i=next++;if(i>=files.length)return;const f=files[i];let err;for(let attempt=0;attempt<5;attempt++){try{const url=new URL(f.path,site);url.searchParams.set('release_verify',PIN.slice(0,12)+'-'+Date.now());const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(120000)});assert(response.ok,'HTTP '+response.status);const b=Buffer.from(await response.arrayBuffer());assert.deepEqual(info(b),{bytes:f.bytes,sha256:f.sha256});checked.push({path:f.path,...info(b)});err=null;break;}catch(e){err=e;await new Promise(r=>setTimeout(r,3000*(attempt+1)));}}if(err)throw new Error(f.path+': '+err.message);}}));
 fs.writeFileSync('takanat-part2-final-live-verification.json',JSON.stringify({...proof,live:true,checkedFiles:checked.length,files:checked,verifiedAt:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify({live:true,checkedFiles:checked.length,release:META.release}));
}
const mode=process.argv[2];if(mode==='--apply')apply();else if(mode==='--local-apply')apply({localOnly:true});else if(mode==='--verify')verify();else if(mode==='--live')await live();else throw new Error('Use --apply, --verify, --live or --local-apply (local subset only)');

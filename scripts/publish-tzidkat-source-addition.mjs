// Prepare and apply exactly one independently reviewed source note, without
// altering the 18 immutable batch packs/reports or any existing author/note text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {planPublication} from './publish-tzidkat-batch-review.mjs';
import {SOURCE_RELEASE,SOURCE_PACK,SOURCE_DESCRIPTOR,SOURCE_CHAPTER,SOURCE_REF,SOURCE_ALLOWED,
  sourceFileInfo,validateSourceAdditionPack,loadSourceAddition} from './tzidkat-source-addition-transition.mjs';

const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const mode=args[0],root=path.resolve(option('--root','.tzidkat-download-refresh-site'));
const candidate=path.resolve(option('--candidate','.tzidkat-source-addition-candidate'));
const evidence=path.resolve(option('--evidence','tzidkat-download-refresh-evidence'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),digest=value=>sha(JSON.stringify(value));
const json=value=>Buffer.from(JSON.stringify(value)),info=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const FINAL_REPORT='library/tzidkat-batch-review-256-264-20261025.json';
const FINAL_REPORT_SHA='742cf6899188bb20080fadfda85bee0ca9f732049e38bb49c318d1cdb507db40';
const FINAL_PACK_SHA='3bc345df5b4c9c9060fab8265de26f9692b0b618580521d3cabdec9103691c61';
const read=(directory,name)=>JSON.parse(fs.readFileSync(path.join(directory,name)));
function write(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
function pin(file,bytes){write(file,bytes);write(file+'.sha256',sha(bytes)+'\n');}
function baseInventory(directory){
  const raw=fs.readFileSync(path.join(directory,FINAL_REPORT));assert.equal(sha(raw),FINAL_REPORT_SHA);
  const report=JSON.parse(raw);assert.equal(report.packSha256,FINAL_PACK_SHA);
  const inventory={...report.baselineFiles};
  for(const item of report.changedFiles)inventory[item.path]={bytes:item.bytes,sha256:item.sha256};
  inventory[FINAL_REPORT]=info(raw);return inventory;
}
function inventory(directory,prefix='',result={}){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){assert(!entry.isSymbolicLink());const name=prefix+entry.name,file=path.join(directory,entry.name);if(entry.isDirectory())inventory(file,name+'/',result);else result[name]=sourceFileInfo(file);}return result;
}
function checkInputs(directory,full=false){
  const expected=baseInventory(directory),actual=inventory(directory);
  for(const [name,value] of Object.entries(actual))assert.deepEqual(value,expected[name],'Input differs from the sealed live publication: '+name);
  if(full)assert.deepEqual(actual,expected,'Publication must use the complete latest artifact');return expected;
}
function archiveProof(directory,changes,name){
  const {unzipSync}=createRequire(import.meta.url)(path.join(directory,'library/vendor/fflate.min.js'));
  const before=unzipSync(fs.readFileSync(path.join(directory,name))),after=unzipSync(changes.get(name));
  const oldNames=Object.keys(before),newNames=Object.keys(after);
  assert(oldNames.every(n=>Object.hasOwn(after,n)),'An existing ZIP member was removed');
  const changed=newNames.filter(n=>!before[n]||sha(before[n])!==sha(after[n]));
  const allowed=new Set([...changes.keys()].filter(n=>n.startsWith('library/data/')).map(n=>n.slice(8)));
  if(name.includes('/books/')){for(const n of allowed)if(!n.startsWith('data/tzidkat-hatzadik/'))allowed.delete(n);}
  else allowed.add('data/files.json');
  for(const n of changed)assert(allowed.has(n),'Source addition changes an unrelated archive member: '+n);
  return {path:name,before:sourceFileInfo(path.join(directory,name)),after:info(changes.get(name)),
    entriesBefore:oldNames.length,entriesAfter:newNames.length,preservedEntries:oldNames.filter(n=>sha(before[n])===sha(after[n])).length,
    changedMembers:changed.map(n=>({path:n,before:before[n]?info(before[n]):null,after:info(after[n])}))};
}
function plan(directory,prepared){
  const before=checkInputs(directory),result=planPublication(directory,prepared,
    {publicationNames:{ledger:null},zipMtime:new Date(2026,9,25,0,0,0)});
  for(const name of result.changes.keys())assert(SOURCE_ALLOWED.has(name),'One-note addition changes an unrelated file: '+name);
  const descriptor={schemaVersion:1,release:SOURCE_RELEASE,packSha256:prepared.packSha256,
    predecessor:{path:FINAL_REPORT,sha256:FINAL_REPORT_SHA,packSha256:FINAL_PACK_SHA,batches:18},
    files:[...result.changes].map(([name,bytes])=>({path:name,before:before[name]||null,after:info(bytes)})),
    archives:['library/downloads/books/tzidkat-hatzadik.zip','library/downloads/rav-tzadok-library.zip'].map(name=>archiveProof(directory,result.changes,name)),
    version:result.version,note:{section:6,row:1,phraseIndex:8,heCharOffset:91,number:4031,placementId:prepared.additions[0].note.placementId,ref:SOURCE_REF},
    verification:{authorTextUnchanged:true,allExistingNotesUnchanged:true,all18HistoricalReportsUnchanged:true,
      oneApprovedNewNote:true,exactSourceEvidence:true,archiveUnrelatedMembersUnchanged:true}};
  return {...result,descriptor};
}

if(mode==='--make-pack'){
  checkInputs(root);const input=JSON.parse(fs.readFileSync(path.resolve(option('--note',''))));
  assert.equal(input.schemaVersion,1);assert.equal(input.review.status,'verified');assert.equal(input.row,1);
  const before=read(root,SOURCE_CHAPTER),after=structuredClone(before),row=after.find(row=>row.n===1);assert(row);
  (row.footnotes??=[]).push(input.note);
  const addition={sectionRef:'Tzidkat HaTzadik 6',originRef:'Tzidkat HaTzadik 6:1',row:1,note:input.note};
  const linksBefore={'Tzidkat HaTzadik 6':read(root,'library/data/tzidkat-hatzadik/links.json')['Tzidkat HaTzadik 6']};
  const linksAfter=structuredClone(linksBefore);
  if(!linksAfter['Tzidkat HaTzadik 6'].some(e=>e.a===addition.originRef&&e.r===SOURCE_REF))
    linksAfter['Tzidkat HaTzadik 6'].push({a:addition.originRef,r:SOURCE_REF,c:input.note.sources[0].category||'Other',kind:'Verified original-source quotation'});
  const pack={schemaVersion:1,release:SOURCE_RELEASE,
    request:'Add the explicitly cited Tosafot source at ois 6 with its Sefaria hyperlink',
    chapters:[{path:SOURCE_CHAPTER,before,beforeSha256:digest(before),after}],additions:[addition],linksBefore,linksAfter,
    audit:{completeReview:true,scope:'One user-requested original-source quotation at ois 6',entries:[{
      placementId:input.note.placementId,status:'verified',sourceEvidence:input.sourceEvidence,review:input.review}]}};
  validateSourceAdditionPack(pack);const bytes=gzipSync(json(pack),{level:9});pin(path.join(REPO,SOURCE_PACK),bytes);
  console.log(JSON.stringify({ok:true,pack:SOURCE_PACK,packSha256:sha(bytes),newNote:4031}));
}else if(mode==='--plan'){
  const prepared=loadSourceAddition(REPO,{requireDescriptor:false});assert(prepared);
  const result=plan(root,prepared);assert(!fs.existsSync(candidate),'Candidate source stage must be new');
  fs.cpSync(root,candidate,{recursive:true});for(const [name,bytes]of result.changes)write(path.join(candidate,name),bytes);
  pin(path.join(REPO,SOURCE_DESCRIPTOR),json(result.descriptor));
  write(path.join(evidence,'source-plan.json'),json({ok:true,descriptorSha256:digest(result.descriptor),...result.descriptor}));
  console.log(JSON.stringify({ok:true,sourcePackSha256:prepared.packSha256,descriptorSha256:digest(result.descriptor),changedFiles:result.descriptor.files,archives:result.descriptor.archives}));
}else if(mode==='--apply'){
  const prepared=loadSourceAddition();assert(prepared);checkInputs(root,true);
  const result=plan(root,prepared);assert.deepEqual(result.descriptor,prepared.descriptor,'Source addition differs from its reviewed deterministic plan');
  for(const [name,bytes]of result.changes)write(path.join(root,name),bytes);
  const expected=baseInventory(root);for(const file of prepared.descriptor.files)expected[file.path]=file.after;
  assert.deepEqual(inventory(root),expected,'Source addition changed an unrelated published file');
  write(path.join(evidence,'source-verification.json'),json({ok:true,release:SOURCE_RELEASE,packSha256:prepared.packSha256,
    descriptorSha256:prepared.descriptorSha256,files:prepared.descriptor.files,preservedFiles:Object.keys(expected).length-result.changes.size,
    existingNotesUnchanged:true,authorTextUnchanged:true,historicalReportsUnchanged:true}));
  console.log(JSON.stringify({ok:true,newNote:4031,changedFiles:result.changes.size,preservedFiles:Object.keys(expected).length-result.changes.size}));
}else throw Error('Use --make-pack, --plan, or --apply');

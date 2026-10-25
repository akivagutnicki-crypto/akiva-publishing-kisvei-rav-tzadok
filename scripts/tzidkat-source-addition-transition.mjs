// Exact, separately reviewed note 4031 at ois 6, after the 18 immutable batches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const SOURCE_RELEASE = '20261025-tzidkat-source-addition-006-v1';
export const SOURCE_PACK = 'sources/akiva/addenda/tzidkat-source-addition-006-20261025.json.gz';
export const SOURCE_DESCRIPTOR = 'sources/akiva/addenda/tzidkat-source-addition-006-transition-20261025.json';
export const SOURCE_CHAPTER = 'library/data/tzidkat-hatzadik/5.json';
export const SOURCE_REF = 'Tosafot on Berakhot 14b:16:1';
export const SOURCE_URL = 'https://www.sefaria.org/Tosafot_on_Berakhot.14b.16.1';
const FINAL_REPORT = 'library/tzidkat-batch-review-256-264-20261025.json';
const FINAL_REPORT_SHA = '742cf6899188bb20080fadfda85bee0ca9f732049e38bb49c318d1cdb507db40';
const FINAL_PACK_SHA = '3bc345df5b4c9c9060fab8265de26f9692b0b618580521d3cabdec9103691c61';
const LINKS = 'library/data/tzidkat-hatzadik/links.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(JSON.stringify(value));
const onlyInfo = value => ({bytes:value.bytes,sha256:value.sha256});
export const SOURCE_ALLOWED = new Set([SOURCE_CHAPTER,LINKS,'mcp-data/text/tzidkat-hatzadik.json',
  'mcp-data/cited.json','mcp-data/catalog.json','library/data/cited/tosafot-on-berakhot.json',
  'library/data/cited/index.json','library/data/packs/sources.json','library/data/files.json',
  'library/index.html','library/sw.js','library/downloads/index.json',
  'library/downloads/books/tzidkat-hatzadik.zip','library/downloads/rav-tzadok-library.zip']);
function local(directory,name) {
  assert(typeof name === 'string' && name && !path.isAbsolute(name) && !name.includes('\\')
    && name.split('/').every(part => part && part !== '.' && part !== '..'),'Unsafe source-addition path');
  const base=path.resolve(directory),file=path.resolve(base,name); assert(file.startsWith(base+path.sep)); return file;
}
export function sourceFileInfo(file) {
  const fd=fs.openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let bytes=0;
  try { assert(fs.fstatSync(fd).isFile()); for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;bytes+=n;hash.update(buffer.subarray(0,n));} }
  finally { fs.closeSync(fd); } return {bytes,sha256:hash.digest('hex')};
}
function pinnedJson(repo,name,gzip=false) {
  const file=local(repo,name),bytes=fs.readFileSync(file),pin=fs.readFileSync(file+'.sha256','utf8').trim();
  assert.match(pin,/^[a-f0-9]{64}$/);assert.equal(sha(bytes),pin,'Immutable source-addition file changed');
  return {value:JSON.parse(gzip?gunzipSync(bytes):bytes),sha256:pin,bytes:bytes.length};
}
function plainAnchor(text) {
  return String(text).replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
export function validateSourceAdditionPack(pack) {
  assert.equal(pack.schemaVersion,1);assert.equal(pack.release,SOURCE_RELEASE);
  assert.equal(pack.request,'Add the explicitly cited Tosafot source at ois 6 with its Sefaria hyperlink');
  assert.equal(pack.chapters.length,1);assert.equal(pack.additions.length,1);
  const file=pack.chapters[0],item=pack.additions[0],note=item.note;
  assert.equal(file.path,SOURCE_CHAPTER);assert.equal(file.beforeSha256,digest(file.before));
  assert.equal(item.sectionRef,'Tzidkat HaTzadik 6');assert.equal(item.originRef,'Tzidkat HaTzadik 6:1');assert.equal(item.row,1);
  assert.equal(note.number,4031);assert.equal(note.phraseIndex,8);assert.equal(note.heCharOffset,91);
  assert.equal(note.placementId,'TZ-4031-1');assert.equal(note.sourceId,'TZ-4031');
  const old=file.before.flatMap(row=>row.footnotes||[]),after=file.after.flatMap(row=>row.footnotes||[]);
  assert(old.every(n=>n.number!==4031&&n.placementId!==note.placementId&&n.sourceId!==note.sourceId),'Source addition reuses an existing identity');
  assert.equal(after.length,old.length+1);
  const stripped=structuredClone(file.after);let removed=0;
  for(const row of stripped)if(row.footnotes){row.footnotes=row.footnotes.filter(n=>{if(n.placementId!==note.placementId)return true;assert.equal(row.n,1);assert.deepEqual(n,note);removed++;return false;});
    if(!row.footnotes.length&&!Object.hasOwn(file.before.find(r=>r.n===row.n)||{},'footnotes'))delete row.footnotes;}
  assert.equal(removed,1);assert.deepEqual(stripped,file.before,'Source addition changes author text or an existing footnote');
  const row=file.before.find(row=>row.n===1);assert(row?.p?.[8]);
  assert.equal(note.heAnchorPrefix,plainAnchor(row.p[8][0]));assert.equal(note.heAnchorPrefix.length,91);
  assert.equal(note.enAnchorPrefix,plainAnchor(row.p[8][1]));assert.equal(note.enCharOffset,111);assert.equal(note.enAnchorPrefix.length,111);
  assert.equal(note.sources.length,1);assert.equal(note.sources[0].ref,SOURCE_REF);assert.equal(note.sources[0].url,SOURCE_URL);
  assert(!note.sources[0].citationOnly && !note.sources[0].readerRef,'The exact original Tosafot ref must remain the destination');
  assert(note.paragraphs?.length && note.paragraphs.every(p=>p.text && (!p.rich || p.rich.map(r=>r.text).join('')===p.text)));
  assert(note.paragraphs.some(p=>(p.rich||[]).some(r=>r.bold&&r.text===SOURCE_REF&&r.href===SOURCE_URL)),'Missing exact linked source heading');
  const evidence=pack.audit?.entries?.[0];assert.equal(pack.audit.entries.length,1);assert.equal(evidence.status,'verified');
  assert.equal(evidence.placementId,note.placementId);assert.equal(evidence.sourceEvidence.length,1);
  const source=evidence.sourceEvidence[0];assert.equal(source.ref,SOURCE_REF);assert.equal(source.url,SOURCE_URL);
  assert.equal(sha(source.he),'16f03d1534c6ed3fe7f840f0fb2aaf03f03dbb7ddabab91ea4b04f6af2bf93b3','Primary Hebrew comment differs');
  assert.equal(note.reviewedSourceExcerpt?.ref,SOURCE_REF);assert.equal(note.reviewedSourceExcerpt.he,source.he);assert.equal(note.reviewedSourceExcerpt.en,source.en);
  assert(note.paragraphs.some(p=>p.text.includes(source.en)),'Complete approved English quotation missing');
  assert.deepEqual(Object.keys(pack.linksBefore),['Tzidkat HaTzadik 6']);
  assert(Array.isArray(pack.linksBefore['Tzidkat HaTzadik 6']));
  const expectedLinks=structuredClone(pack.linksBefore['Tzidkat HaTzadik 6']);
  if(!expectedLinks.some(edge=>edge.a===item.originRef&&edge.r===SOURCE_REF))expectedLinks.push({a:item.originRef,r:SOURCE_REF,c:note.sources[0].category||'Other',kind:'Verified original-source quotation'});
  assert.deepEqual(pack.linksAfter,{'Tzidkat HaTzadik 6':expectedLinks});
  return item;
}
export function loadSourceAddition(repo=REPO,{requireDescriptor=true}={}) {
  if(!fs.existsSync(local(repo,SOURCE_PACK)))return null;
  const loaded=pinnedJson(repo,SOURCE_PACK,true),pack=loaded.value;validateSourceAdditionPack(pack);
  const result={pack,packSha256:loaded.sha256,additions:pack.additions};
  if(!requireDescriptor)return result;
  const sealed=pinnedJson(repo,SOURCE_DESCRIPTOR),descriptor=sealed.value;
  assert.equal(descriptor.schemaVersion,1);assert.equal(descriptor.release,SOURCE_RELEASE);assert.equal(descriptor.packSha256,result.packSha256);
  assert.deepEqual(descriptor.predecessor,{path:FINAL_REPORT,sha256:FINAL_REPORT_SHA,packSha256:FINAL_PACK_SHA,batches:18});
  assert(descriptor.files.length && new Set(descriptor.files.map(f=>f.path)).size===descriptor.files.length);
  for(const file of descriptor.files){assert(SOURCE_ALLOWED.has(file.path),'Source addition claims unrelated path');for(const value of [file.before,file.after])if(value){assert(Number.isSafeInteger(value.bytes)&&value.bytes>=0);assert.match(value.sha256,/^[a-f0-9]{64}$/);}}
  const chapter=descriptor.files.find(f=>f.path===SOURCE_CHAPTER);assert(chapter);
  assert.deepEqual(chapter.after,{bytes:Buffer.byteLength(JSON.stringify(pack.chapters[0].after)),sha256:digest(pack.chapters[0].after)});
  return {...result,descriptor,descriptorSha256:sealed.sha256};
}

// Prepare only authenticated expectations. Actual shared exports are checked
// after the optional, independently pinned DOCX/ZIP successor has been composed.
export function prepareSourceAdditionTransition({directory,batches,terminalFiles,independentFiles,repo=REPO}) {
  const prepared=loadSourceAddition(repo);if(!prepared)return null;
  const {pack,descriptor,packSha256,descriptorSha256}=prepared;
  const actual=JSON.parse(fs.readFileSync(local(directory,SOURCE_CHAPTER)));
  if(digest(actual)===pack.chapters[0].beforeSha256)return null;
  assert.deepEqual(actual,pack.chapters[0].after,'Ois 6 is neither the exact predecessor nor the one approved source addition');
  assert.equal(batches.length,18);assert.equal(batches.at(-1).prepared.packSha256,FINAL_PACK_SHA);
  assert.equal(sourceFileInfo(local(directory,FINAL_REPORT)).sha256,FINAL_REPORT_SHA,'Historical final report was rewritten');
  const original=batches.flatMap(b=>b.prepared.pack.chapters).find(f=>f.path===SOURCE_CHAPTER);assert(original);
  assert.deepEqual(original.after,pack.chapters[0].before,'Source addition does not follow the exact reviewed ois 6');
  for(const file of descriptor.files){
    const prior=terminalFiles.get(file.path)||batches.at(-1).report.baselineFiles[file.path];
    assert.deepEqual(prior?onlyInfo(prior):null,file.before,'Unrecognized source-addition predecessor: '+file.path);
    terminalFiles.set(file.path,{path:file.path,...file.after});independentFiles.set(file.path,file.after);
  }
  return {pack,packSha256,descriptor,descriptorSha256,additions:pack.additions,
    chapterAfters:new Map([[SOURCE_CHAPTER,pack.chapters[0].after]]),
    chapterPreimages:new Map([[SOURCE_CHAPTER,descriptor.files.find(f=>f.path===SOURCE_CHAPTER).before]]),
    linkAfters:new Map(Object.entries(pack.linksAfter)),
    proof:{release:SOURCE_RELEASE,packSha256,descriptorSha256,newNotes:1,section:6,number:4031,
      existingNotesUnchanged:true,authorTextUnchanged:true,historicalReportsUnchanged:true}};
}

export function verifySourceAdditionTerminal({directory,sourcePublication,terminalFiles}) {
  if(!sourcePublication)return;
  for(const file of sourcePublication.descriptor.files){
    assert.deepEqual(sourceFileInfo(local(directory,file.path)),onlyInfo(terminalFiles.get(file.path)),
      'Source-addition terminal file differs: '+file.path);
  }
  const {pack}=sourcePublication,note=pack.additions[0].note;
  const links=JSON.parse(fs.readFileSync(local(directory,LINKS)));
  assert.deepEqual(links['Tzidkat HaTzadik 6'],pack.linksAfter['Tzidkat HaTzadik 6']);
  const mcp=JSON.parse(fs.readFileSync(local(directory,'mcp-data/text/tzidkat-hatzadik.json')));
  const row=mcp.paras.find(p=>p.r==='Tzidkat HaTzadik 6:1');assert(row);
  const found=(row.f||[]).filter(n=>String(n[0])==='4031');assert.equal(found.length,1);
  assert.equal(found[0][1],note.paragraphs.map(p=>p.text).join('\n'));assert.equal(found[0][2],8);assert.equal(found[0][3],'h');assert.equal(found[0][4],91);
  assert(row.c?.some(edge=>edge[0]===SOURCE_REF));assert(row.a?.[SOURCE_REF]);
  for(const name of ['mcp-data/cited.json','library/data/cited/tosafot-on-berakhot.json'])
    assert(JSON.parse(fs.readFileSync(local(directory,name)))[SOURCE_REF]?.includes('Tzidkat HaTzadik 6:1'));
}

// Publish only the approved reader quotation successor; preserve all downloads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {loadEnglishReplacement,validateEnglishApproval,constructEnglishAfterNote} from './tzidkat-english-replacement-transition.mjs';

const REPO_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const PUBLIC='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
export const PACK='sources/akiva/addenda/tzidkat-reader-json-20261025.json.gz';
export const DESCRIPTOR='sources/akiva/addenda/tzidkat-reader-json-transition-20261025.json';
const PRI_REPORT='library/pri-parsha-source-review-20261025.json';
const PRI_REPORT_SHA='93bccec2b410430f16b522c6a0fa10a506733d24135e5c7f03cc93eb8768e703';
const RELEASE='20261025-tzidkat-reader-json-v1';
const LINKS='library/data/tzidkat-hatzadik/links.json';
const MCP='mcp-data/text/tzidkat-hatzadik.json';
const NEW_REF='Shabbat 118b:14-119a:1', ORIGIN='Tzidkat HaTzadik 49:1';
const SPECIAL=[MCP,LINKS,'mcp-data/cited.json','library/data/cited/shabbat.json','library/data/packs/sources.json',
  'library/data/files.json','mcp-data/catalog.json','library/index.html','library/sw.js'];
const bytes=value=>Buffer.from(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
const info=value=>({bytes:value.length,sha256:sha(value)});
const fileInfo=file=>info(fs.readFileSync(file));
const local=(root,name)=>{assert(name&&!path.isAbsolute(name)&&!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'));const f=path.resolve(root,name);assert(f.startsWith(path.resolve(root)+path.sep));return f;};
const read=(root,name)=>JSON.parse(fs.readFileSync(local(root,name)));
const write=(root,name,value)=>{const f=local(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,Buffer.isBuffer(value)?value:bytes(value));};
export function inventory(root,prefix='',result={}){
  for(const e of fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    assert(!e.isSymbolicLink());const n=prefix+e.name;if(e.isDirectory())inventory(root,n+'/',result);else result[n]=fileInfo(local(root,n));
  }return result;
}
function pinned(name){const raw=fs.readFileSync(local(REPO_ROOT,name));assert.equal(sha(raw),fs.readFileSync(local(REPO_ROOT,name+'.sha256'),'utf8').trim(),'Changed sealed input: '+name);return raw;}
export function loadPack(){
  const raw=pinned(PACK),pack=JSON.parse(gunzipSync(raw));assert.equal(pack.release,RELEASE);
  assert.equal(pack.originalPackSha256,'13a903209ded068b018cb09e3b4655f6d5e5f595f7c76fc5872053dc5792ff3d');
  validateEnglishApproval(pack.approval);assert.equal(pack.chapters.length,256);
  assert.deepEqual(pack.chapters.map(c=>c.path).sort(),[...new Set(pack.approval.records.map(r=>r.chapterPath))].sort());
  for(const c of pack.chapters){assert.match(c.beforeSha256,/^[a-f0-9]{64}$/);assert.match(c.afterSha256,/^[a-f0-9]{64}$/);}
  for(const e of pack.approval.reviewEvidence){assert(e.path.startsWith('sources/akiva/addenda/evidence/'));assert.deepEqual(fileInfo(local(REPO_ROOT,e.path)),{bytes:e.bytes,sha256:e.sha256});}
  assert.equal(pack.predecessor.finalReportSha256,'742cf6899188bb20080fadfda85bee0ca9f732049e38bb49c318d1cdb507db40');
  assert.equal(pack.predecessor.sourceDescriptorSha256,'4e142189d24ab4996c4919d05605917f74e6a24f4a66a5d21c1af9fe6aa06971');
  return {pack,packSha256:sha(raw)};
}
export function baselineInventory(root){
  const raw=fs.readFileSync(local(root,PRI_REPORT));assert.equal(sha(raw),PRI_REPORT_SHA,'Unknown current publication');
  const report=JSON.parse(raw),d=JSON.parse(pinned('sources/akiva/overlays/pri-parsha-transition-20261025.json'));
  assert.equal(report.descriptorSha256,sha(bytes(d)));assert.equal(report.packSha256,d.packSha256);assert.equal(report.verification.ok,true);
  assert.equal(sha(bytes(report.baselineFiles)),d.baselineInventorySha256);
  const before=structuredClone(report.baselineFiles);
  for(const f of d.files){assert.deepEqual(before[f.path]||null,f.before);before[f.path]=f.after;}
  before[PRI_REPORT]=info(raw);assert(Object.keys(before).length>5000);return before;
}
function dataManifest(root,changes){
  const names=Object.keys(inventory(local(root,'library/data'))).filter(n=>n!=='files.json').sort();
  const h=createHash('sha256');let total=0;
  for(const name of names){const raw=changes.get('library/data/'+name)||fs.readFileSync(local(root,'library/data/'+name));h.update(name);h.update('\0');h.update(raw);total+=raw.length;}
  return {version:h.digest('hex').slice(0,16),bytes:total,files:names};
}
export function plan(root){
  const prepared=loadPack(),{pack}=prepared,before=baselineInventory(root),changes=new Map();
  const put=(name,value)=>{const raw=Buffer.isBuffer(value)?value:bytes(value);assert(before[name]);assert.deepEqual(fileInfo(local(root,name)),before[name],'Preimage differs: '+name);assert.notEqual(sha(raw),before[name].sha256);changes.set(name,raw);};
  for(const c of pack.chapters){
    assert.equal(fileInfo(local(root,c.path)).sha256,c.beforeSha256);const rows=read(root,c.path);
    for(const r of pack.approval.records.filter(r=>r.chapterPath===c.path)){
      assert.deepEqual(rows[r.rowIndex]?.footnotes?.[r.noteIndex],r.beforeNote);rows[r.rowIndex].footnotes[r.noteIndex]=constructEnglishAfterNote(r.beforeNote,r);
    }
    assert.equal(sha(bytes(rows)),c.afterSha256,'Approved chapter output differs: '+c.path);put(c.path,rows);
  }
  const mcp=read(root,MCP),numbers=new Map();
  for(const p of mcp.paras)for(const n of p.f||[]){assert(!numbers.has(Number(n[0])));numbers.set(Number(n[0]),{p,n});}
  for(const r of pack.approval.records){const {p,n}=numbers.get(r.number)||{};assert(n);assert(p.r.startsWith('Tzidkat HaTzadik '+r.ois+':'));assert.equal(n[1],r.beforeNote.paragraphs.map(p=>p.text).join('\n'));assert.equal(n[2],r.beforeNote.phraseIndex);n[1]=r.afterNote.paragraphs.map(p=>p.text).join('\n');}
  const origin=mcp.paras.find(p=>p.r===ORIGIN);assert(!origin.a[NEW_REF]&&!origin.c.some(c=>c[0]===NEW_REF));origin.a[NEW_REF]=['n','166'];origin.c.push([NEW_REF,'Talmud']);put(MCP,mcp);
  const links=read(root,LINKS);assert.deepEqual(links['Tzidkat HaTzadik 49'],pack.linksBefore['Tzidkat HaTzadik 49']);
  const edges=structuredClone(pack.linksBefore['Tzidkat HaTzadik 49']);edges.push({a:ORIGIN,r:NEW_REF,c:'Talmud',kind:'Verified complete original-source quotation'});assert.deepEqual(edges,pack.linksAfter['Tzidkat HaTzadik 49']);links['Tzidkat HaTzadik 49']=edges;put(LINKS,links);
  for(const name of ['mcp-data/cited.json','library/data/cited/shabbat.json']){const cited=read(root,name);assert(!cited[NEW_REF]);cited[NEW_REF]=[ORIGIN];put(name,cited);}
  const sources=read(root,'library/data/packs/sources.json');assert(!sources.refs.includes(NEW_REF));sources.refs.push(NEW_REF);sources.refs.sort();put('library/data/packs/sources.json',sources);
  const manifest=dataManifest(root,changes);put('library/data/files.json',manifest);
  const catalog=read(root,'mcp-data/catalog.json');catalog.version=manifest.version;put('mcp-data/catalog.json',catalog);
  let html=fs.readFileSync(local(root,'library/index.html'),'utf8');const marker='const editionDataUrl = url => ';assert.equal(html.split(marker).length,2);assert(!html.includes('/* '+RELEASE+' */'));
  html=html.replace(marker,marker+"/* "+RELEASE+" */ (url.startsWith('data/tzidkat-hatzadik/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?reader="+prepared.packSha256.slice(0,12)+"' :\n");put('library/index.html',Buffer.from(html));
  let sw=fs.readFileSync(local(root,'library/sw.js'),'utf8');assert.equal([...sw.matchAll(/const SHELL = `([^`]+)`;/g)].length,1);sw=sw.replace(/const SHELL = `([^`]+)`;/,(_,v)=>'const SHELL = `'+v+'-tzidkat-reader-'+prepared.packSha256.slice(0,12)+'`;');put('library/sw.js',Buffer.from(sw));
  assert.deepEqual([...changes.keys()].sort(),[...pack.chapters.map(c=>c.path),...SPECIAL].sort());
  assert([...changes.keys()].every(n=>!n.startsWith('library/downloads/')&&!/\.(docx|pdf|zip)$/.test(n)));
  const descriptor={schemaVersion:1,release:RELEASE,packSha256:prepared.packSha256,baselineInventorySha256:sha(bytes(before)),
    baselinePublication:{runId:40163351937,artifactId:12587057832,headSha:'cde6919f7a28c122ec0417bee7b9cd6a0e0eee23',digest:'sha256:c02948f5a5fca014547595b329f94a2c1b1706031aca38d7ba1cc636f833cfde'},
    files:[...changes].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([n,raw])=>({path:n,before:before[n],after:info(raw)})),
    counts:{reviewedSections:264,updatedSections:256,replacedQuotations:1369,nativeNotes:3684,connectedNotes:347,totalNotes:4031},version:manifest.version,
    preservation:{authorText:true,noteNumbers:true,hebrewAnchors:true,tosafot4031:true,allOtherNotes:true,otherBooks:true,allDownloads:true}};
  return {prepared,before,changes,descriptor};
}
function loadDescriptor(){return JSON.parse(pinned(DESCRIPTOR));}
export function verify(root,{full=false}={}){
  const prepared=loadPack(),d=loadDescriptor(),before=baselineInventory(root);assert.equal(d.packSha256,prepared.packSha256);assert.equal(d.baselineInventorySha256,sha(bytes(before)));
  const expected=new Map(d.files.map(f=>[f.path,f.after]));
  for(const c of prepared.pack.chapters)assert.equal(fileInfo(local(root,c.path)).sha256,c.afterSha256);
  for(const f of d.files)assert.deepEqual(fileInfo(local(root,f.path)),f.after,'Published file differs: '+f.path);
  if(full){const actual=inventory(root);assert.deepEqual(Object.keys(actual).sort(),Object.keys(before).sort());for(const [n,i]of Object.entries(before))assert.deepEqual(actual[n],expected.get(n)||i,'Unrelated publication changed: '+n);}
  return {ok:true,release:RELEASE,...d.counts,changedFiles:d.files.length,completePublicationPreserved:full,downloadsUnchanged:true};
}
async function github(route){const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;const r=await fetch('https://api.github.com/repos/'+REPO+route,{headers,signal:AbortSignal.timeout(60000)});assert(r.ok,'GitHub '+r.status+' '+route);return r.json();}
async function publicBytes(name){const u=new URL(name,PUBLIC);u.searchParams.set('tzidkat_reader_verify',Date.now());for(let i=0;i<4;i++)try{const r=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(60000)});assert(r.ok,'Public '+r.status+' '+name);return Buffer.from(await r.arrayBuffer());}catch(e){if(i===3)throw e;}}
async function mapLimited(items,fn){let next=0;await Promise.all(Array.from({length:6},async()=>{for(;;){const i=next++;if(i>=items.length)break;await fn(items[i]);}}));}
async function guard(){
  const d=loadDescriptor();assert.match(process.env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.equal((await github('/git/ref/heads/main')).object.sha,process.env.GITHUB_SHA,'Main advanced');
  assert.equal(sha(await publicBytes(PRI_REPORT)),PRI_REPORT_SHA);await mapLimited(d.files,async f=>assert.deepEqual(info(await publicBytes(f.path)),f.before,'Live baseline advanced: '+f.path));
  const artifact=await github('/actions/artifacts/'+d.baselinePublication.artifactId);assert.equal(artifact.expired,false);assert.equal(artifact.digest,d.baselinePublication.digest);assert.equal(artifact.workflow_run.id,d.baselinePublication.runId);
  // An active newer Pages deployment must stop this pinned-artifact publication.
  const deployments=await github('/deployments?environment=github-pages&per_page=20');
  for(const dep of deployments){const statuses=await github('/deployments/'+dep.id+'/statuses?per_page=1');const s=statuses[0];if(s?.state==='success'){assert.equal(dep.sha,d.baselinePublication.headSha,'A newer Pages publication is active');break;}}
  return {ok:true,baselineFilesChecked:d.files.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,root='dist',candidate]=process.argv.slice(2);
  if(mode==='--prepare'){const {pack,packSha256}=loadPack();console.log(JSON.stringify({ok:true,packSha256,records:pack.approval.records.length}));}
  else if(mode==='--plan'){const p=plan(root);write(REPO_ROOT,DESCRIPTOR,p.descriptor);fs.writeFileSync(local(REPO_ROOT,DESCRIPTOR+'.sha256'),sha(bytes(p.descriptor))+'\n');if(candidate){assert(!fs.existsSync(candidate));fs.cpSync(root,candidate,{recursive:true});for(const [n,v]of p.changes)write(candidate,n,v);console.log(JSON.stringify(verify(candidate)));}else console.log(JSON.stringify({ok:true,changedFiles:p.changes.size}));}
  else if(mode==='--apply'){const p=plan(root),d=loadDescriptor();assert.deepEqual(p.descriptor,d,'Recomputed reader plan differs');assert.deepEqual(inventory(root),p.before,'Complete current artifact required');for(const [n,v]of p.changes)write(root,n,v);console.log(JSON.stringify(verify(root,{full:true})));}
  else if(mode==='--verify')console.log(JSON.stringify(verify(root,{full:true})));
  else if(mode==='--guard')console.log(JSON.stringify(await guard()));
  else if(mode==='--metadata'){await guard();const d=loadDescriptor();if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`artifact=${d.baselinePublication.artifactId}\nrun=${d.baselinePublication.runId}\n`);console.log(JSON.stringify({ok:true,...d.baselinePublication}));}
  else if(mode==='--live'){const d=loadDescriptor();await mapLimited(d.files,async f=>assert.deepEqual(info(await publicBytes(f.path)),f.after,'Live reader differs: '+f.path));write(REPO_ROOT,'artifacts/tzidkat-reader-json/live-verification.json',{ok:true,...d.counts,publicFilesChecked:d.files.length,downloadsUnchanged:true});console.log(JSON.stringify({ok:true,...d.counts,publicFilesChecked:d.files.length}));}
  else throw Error('Use --prepare, --plan ROOT [CANDIDATE], --apply ROOT, --verify ROOT, --metadata, --guard or --live');
}

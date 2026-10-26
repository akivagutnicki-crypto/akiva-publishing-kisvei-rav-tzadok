// Apply the exact reviewed Takanat HaShavin text to the actual current complete publication.
// Every published file outside the explicit, verified change set is preserved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {RELEASE,PACK,REPORT,loadPack,validatePack,REPO_ROOT,sha} from './takanat-review-core.mjs';
import {planPublication} from './takanat-publication-plan.mjs';
import {info,local,fileInfo,inventory,read,write} from './pri-parsha-review-core.mjs';

export {RELEASE,PACK,REPORT,loadPack,validatePack,planPublication};
const BOOK='takanat-hashavin';
const LINKS='library/data/'+BOOK+'/links.json',MCP='mcp-data/text/'+BOOK+'.json';
const ARCHIVES=['library/downloads/rav-tzadok-library.zip','library/downloads/books/'+BOOK+'.zip'];
const REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const SITE='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const META='takanat-reader-review-publication.json',STATE='takanat-reader-review-baseline.json';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const root=path.resolve(option('--root','dist'));

function preimages(directory,{pack}){
  for(const section of pack.sections)assert.deepEqual(read(directory,section.path),section.before,'Reviewed section source changed: '+section.path);
}

export function verifyPublication(directory,prepared=loadPack()){
  const report=read(directory,REPORT);assert.equal(report.schemaVersion,1);assert.equal(report.release,RELEASE);assert.equal(report.packSha256,prepared.packSha256,'Published review pack differs');
  assert(report.baselineFiles&&Array.isArray(report.changedFiles),'Missing complete publication preservation evidence');
  assert.equal(new Set(report.changedFiles.map(f=>f.path)).size,report.changedFiles.length,'Duplicate changed-file evidence');
  assert(!report.changedFiles.some(f=>f.path===REPORT),'Publication report cannot include itself in its change set');
  assert.deepEqual(Object.keys(inventory(directory)).sort(),[...new Set([...Object.keys(report.baselineFiles),...report.changedFiles.map(f=>f.path),REPORT])].sort(),'Unrelated publication file added or removed');
  const changed=new Set(report.changedFiles.map(f=>f.path));
  for(const f of report.changedFiles)assert.deepEqual(fileInfo(local(directory,f.path)),{bytes:f.bytes,sha256:f.sha256},'Published file changed: '+f.path);
  for(const[name,entry]of Object.entries(report.baselineFiles))if(!changed.has(name))assert.deepEqual(fileInfo(local(directory,name)),entry,'Unrelated published file changed: '+name);
  for(const section of prepared.pack.sections)assert.deepEqual(read(directory,section.path),section.after,'Reviewed reader section differs: '+section.sectionRef);
  const{unzipSync}=createRequire(import.meta.url)(local(directory,'library/vendor/fflate.min.js'));
  for(const archive of ARCHIVES){
    const members=unzipSync(fs.readFileSync(local(directory,archive)),{filter:f=>f.name.startsWith('data/'+BOOK+'/')});
    for(const section of prepared.pack.sections){
      const member=section.path.slice('library/'.length);assert(members[member],'Missing reviewed chapter in '+archive+': '+member);
      assert.deepEqual(JSON.parse(Buffer.from(members[member])),section.after,'Reviewed archive chapter differs: '+archive+' '+member);
      assert.deepEqual(Buffer.from(members[member]),fs.readFileSync(local(directory,section.path)),'Archive and reader chapter bytes differ: '+archive+' '+member);
    }
  }
  return{ok:true,release:RELEASE,...report.counts,changedFiles:report.changedFiles.length,unrelatedFilesPreserved:Object.keys(report.baselineFiles).length-report.changedFiles.filter(f=>report.baselineFiles[f.path]).length,archives:ARCHIVES.length};
}

function apply(directory,prepared,state){
  const before=inventory(directory);if(state.files)assert.deepEqual(before,state.files,'Publication changed after capture');
  const plan=planPublication(directory,prepared);assert(plan.changes instanceof Map);assert(!plan.changes.has(REPORT),'Plan must leave publication evidence to the wrapper');
  for(const[name,bytes]of plan.changes){assert(Buffer.isBuffer(bytes),'Publication plan must provide exact Buffer bytes: '+name);write(directory,name,bytes);}
  write(directory,REPORT,{schemaVersion:1,release:RELEASE,packSha256:prepared.packSha256,counts:plan.counts,archives:plan.archives,version:plan.version,baselineFiles:before,baselineArtifact:state.publication||null,changedFiles:[...plan.changes].map(([name,bytes])=>({path:name,...info(bytes)})),verification:{reviewedContentMatchesPack:true,allSixteenSectionsReviewed:true,unrelatedFilesPreserved:true,unrelatedArchiveEntriesPreserved:true}});
  return verifyPublication(directory,prepared);
}

async function github(route){const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;const r=await fetch('https://api.github.com/repos/'+REPO+route,{headers,signal:AbortSignal.timeout(30000)});assert(r.ok,'GitHub '+r.status+' '+route);return r.json();}
async function mapLimited(items,callback,concurrency=4){let next=0;const results=[];await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)break;results[i]=await callback(items[i],i);}}));return results;}
async function bytesPublic(name){for(let n=0;n<4;n++){try{const url=new URL(name,SITE);url.searchParams.set('takanat_verify',String(Date.now()));const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(60000)});assert(r.ok,'Public '+r.status+' '+name);return Buffer.from(await r.arrayBuffer());}catch(error){if(n===3)throw error;}}}
async function currentPublication(){
  const publishers=new Map();for(const name of fs.readdirSync(path.join(REPO_ROOT,'.github/workflows')).filter(n=>n.endsWith('.yml'))){let label='';const labels=[];for(const line of fs.readFileSync(path.join(REPO_ROOT,'.github/workflows',name),'utf8').split('\n')){if(line.trimStart().startsWith('- name:'))label=line.split('- name:')[1].trim();if(line.includes('uses: actions/deploy-pages@')){assert(label);labels.push(label);}}if(labels.length)publishers.set('.github/workflows/'+name,labels);}
  const candidates=[];for(let page=1;page<=3&&!candidates.length;page++){const runs=(await github('/actions/runs?branch=main&per_page=100&page='+page)).workflow_runs;await mapLimited(runs.filter(r=>((String(r.id)!==process.env.GITHUB_RUN_ID)||(String(r.id)===process.env.GITHUB_RUN_ID&&Number(process.env.GITHUB_RUN_ATTEMPT)>1))&&r.conclusion!=='skipped'&&publishers.has(r.path)),async run=>{const jobs=(await github('/actions/runs/'+run.id+'/jobs?filter=all&per_page=100')).jobs;const steps=jobs.filter(j=>String(run.id)!==process.env.GITHUB_RUN_ID||j.run_attempt<Number(process.env.GITHUB_RUN_ATTEMPT)).flatMap(j=>j.steps||[]).filter(s=>publishers.get(run.path).includes(s.name)&&s.conclusion==='success');if(steps.length)candidates.push({run,completedAt:steps.map(s=>s.completed_at).sort().at(-1)});});}
  assert(candidates.length,'No actual complete Pages publication found');candidates.sort((a,b)=>b.completedAt.localeCompare(a.completedAt));const{run,completedAt}=candidates[0],all=(await github('/actions/runs/'+run.id+'/artifacts?per_page=100')).artifacts;const artifact=all.filter(a=>a.name==='github-pages'&&!a.expired&&a.created_at<=completedAt).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];assert(artifact);return{runId:run.id,headSha:run.head_sha,artifactId:artifact.id,digest:artifact.digest,bytes:artifact.size_in_bytes,deployedAt:completedAt};
}
async function branchGuard(expected){assert.match(expected||'',/^[a-f0-9]{40}$/);assert.equal((await github('/git/ref/heads/main')).object.sha,expected,'Main advanced; preserve intervening work');}
async function guard(state){
  await branchGuard(state.expectedHead);assert.equal((await currentPublication()).artifactId,state.publication.artifactId,'Newer complete publication exists');
  const paths=['index.html','library/index.html','library/sw.js','library/data/files.json',LINKS,MCP,'mcp-data/cited.json','mcp-data/catalog.json','library/connected-ideas/catalog.json',...loadPack().pack.sections.map(s=>s.path)];
  await mapLimited(paths,async name=>{assert(state.files[name],'Captured public baseline missing: '+name);assert.equal(sha(await bytesPublic(name)),state.files[name].sha256,'Public baseline changed: '+name);});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=args[0]||'--prepare';
  if(mode==='--prepare'){const p=loadPack();console.log(JSON.stringify({ok:true,release:RELEASE,packSha256:p.packSha256,...p.counts}));}
  else if(mode==='--metadata'){const p=loadPack();await branchGuard(process.env.GITHUB_SHA);const publication=await currentPublication();write(REPO_ROOT,META,{expectedHead:process.env.GITHUB_SHA,publication,packSha256:p.packSha256});if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'artifact='+publication.artifactId+'\nrun='+publication.runId+'\n');console.log(JSON.stringify(publication));}
  else if(mode==='--capture'){const state=read(REPO_ROOT,META),p=loadPack();assert.equal(state.packSha256,p.packSha256);state.files=inventory(root);state.alreadyPublished=fs.existsSync(local(root,REPORT));if(state.alreadyPublished)verifyPublication(root,p);else preimages(root,p);await guard(state);write(REPO_ROOT,STATE,state);console.log(JSON.stringify({capturedFiles:Object.keys(state.files).length,alreadyPublished:state.alreadyPublished}));}
  else if(mode==='--guard')await guard(read(REPO_ROOT,STATE));
  else if(mode==='--apply'){const state=read(REPO_ROOT,STATE),p=loadPack();assert.equal(state.packSha256,p.packSha256);console.log(JSON.stringify(state.alreadyPublished?verifyPublication(root,p):apply(root,p,state)));}
  else if(mode==='--rebuild'){const p=loadPack();console.log(JSON.stringify(fs.existsSync(local(root,REPORT))?verifyPublication(root,p):apply(root,p,{})));}
  else if(mode==='--verify')console.log(JSON.stringify(verifyPublication(root)));
  else if(mode==='--live'){const proof=verifyPublication(root),report=read(root,REPORT);await mapLimited([...report.changedFiles,{path:REPORT,...fileInfo(local(root,REPORT))}],async f=>assert.equal(sha(await bytesPublic(f.path)),f.sha256,'Public bytes differ: '+f.path));write(REPO_ROOT,'takanat-reader-review-live-verification.json',{...proof,verifiedAt:new Date().toISOString()});console.log(JSON.stringify(proof));}
  else throw Error('Unknown mode '+mode);
}

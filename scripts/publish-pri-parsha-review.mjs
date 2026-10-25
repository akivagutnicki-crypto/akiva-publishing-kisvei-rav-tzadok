import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {REPO_ROOT,RELEASE,PACK,DESCRIPTOR,REPORT,LEDGER,LINKS,MCP,SUPPLEMENT,ARCHIVES,sha,digest,json,info,onlyInfo,local,fileInfo,inventory,read,write,plain,notesOf,sourceSlug,navigates,readerRef,noteProjection,permitted,loadPack,checkPreimages,verifyPublication} from './pri-parsha-review-core.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const root=path.resolve(option('--root','dist'));
const REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const SITE='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const META='pri-parsha-publication.json',STATE='pri-parsha-baseline.json';

function dataEntries(directory){const out={};const walk=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){assert(!e.isSymbolicLink());const f=path.join(dir,e.name),key=prefix+e.name;if(e.isDirectory())walk(f,key+'/');else out[key]=fs.readFileSync(f);}};walk(local(directory,'library/data'),'data/');return out;}
function dataManifest(entries){const names=Object.keys(entries).filter(n=>n.startsWith('data/')&&n!=='data/files.json').sort(),hash=createHash('sha256');let bytes=0;for(const name of names){hash.update(name.slice(5)).update('\0').update(entries[name]);bytes+=entries[name].length;}return{version:hash.digest('hex').slice(0,16),bytes,files:names.map(n=>n.slice(5))};}
const edgeKey=e=>JSON.stringify([e.a,e.r]);
function citationPlaces(row){const a={};row.p.forEach((pair,k)=>pair.forEach((html,side)=>{for(const m of String(html).matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g)){const ref=plain(m[1]);a[ref]??=[k,side?'e':'h',plain(html.slice(0,m.index)).trim().length];}}));for(const note of row.footnotes||[])for(const source of note.sources||[])if(navigates(source))a[readerRef(source)]??=['n',String(note.number)];return a;}

/** Deterministic complete plan; all bytes are checked before any publication write. */
export function planPublication(directory,prepared,{baselineFiles=null}={}){
  checkPreimages(directory,prepared);const {pack}=prepared,changes=new Map();
  const put=(name,value)=>{const bytes=value instanceof Uint8Array?Buffer.from(value):json(value),f=local(directory,name);assert(permitted(name,pack));if(!fs.existsSync(f)||sha(fs.readFileSync(f))!==sha(bytes))changes.set(name,bytes);};
  for(const c of pack.chapters)if(digest(c.after)!==c.beforeSha256)put(c.path,c.after);
  put(SUPPLEMENT,Object.fromEntries(pack.supplementalSections.map(s=>[s.sectionRef,s.annotations])));
  const links=read(directory,LINKS);for(const [ref,edges]of Object.entries(pack.linksAfter))links[ref]=edges;put(LINKS,links);
  const beforeEdges=new Map(Object.values(pack.linksBefore).flat().map(e=>[edgeKey(e),e])),afterEdges=new Map(Object.values(pack.linksAfter).flat().map(e=>[edgeKey(e),e]));
  const removed=[...beforeEdges].filter(([key])=>!afterEdges.has(key)).map(([,e])=>e),added=[...afterEdges].filter(([key])=>!beforeEdges.has(key)).map(([,e])=>e);
  const reverse=read(directory,'mcp-data/cited.json'),reverseFiles=new Map();
  function reverseFile(ref){const name='library/data/cited/'+sourceSlug(ref)+'.json';assert(sourceSlug(ref));if(!reverseFiles.has(name))reverseFiles.set(name,fs.existsSync(local(directory,name))?read(directory,name):{});return reverseFiles.get(name);}
  for(const edge of removed)for(const obj of [reverse,reverseFile(edge.r)])if(obj[edge.r]){obj[edge.r]=obj[edge.r].filter(origin=>origin!==edge.a);if(!obj[edge.r].length)delete obj[edge.r];}
  for(const edge of added)for(const obj of [reverse,reverseFile(edge.r)]){const owners=obj[edge.r]??=[];if(!owners.includes(edge.a))owners.push(edge.a);}
  for(const [name,obj]of reverseFiles)put(name,obj);put('mcp-data/cited.json',reverse);
  const index=read(directory,'library/data/cited/index.json');put('library/data/cited/index.json',[...new Set([...index,...[...reverseFiles.keys()].map(n=>path.basename(n,'.json'))])].sort());
  const sourcePack=read(directory,'library/data/packs/sources.json');sourcePack.refs=[...new Set([...sourcePack.refs,...added.map(e=>e.r)])].sort();put('library/data/packs/sources.json',sourcePack);
  const mcp=read(directory,MCP);
  for(const c of pack.chapters)for(const row of c.after.filter(r=>r.n&&r.p)){
    const origin=c.sectionRef+':'+row.n,para=mcp.paras.find(p=>p.r===origin&&p.p);assert(para,'Interlinear MCP paragraph missing: '+origin);
    para.p=row.p.map(pair=>pair.map(plain));const notes=(row.footnotes||[]).map(noteProjection);if(notes.length)para.f=notes;else delete para.f;
    const anchors=citationPlaces(row);if(Object.keys(anchors).length)para.a=anchors;else delete para.a;
    const edges=pack.linksAfter[c.sectionRef].filter(e=>e.a===origin).map(e=>[e.r,e.c||'']);if(edges.length)para.c=edges;else delete para.c;
  }
  for(const s of pack.supplementalSections)s.annotations.forEach((notes,i)=>{
    const origin=s.sectionRef+':'+(i+1),para=mcp.paras.find(p=>p.r===origin&&!p.p);assert(para);assert.equal(para.t,plain(s.before[i]));
    para.f=notes.map(noteProjection);para.a={...(para.a||{})};for(const n of notes)for(const source of n.sources||[])if(navigates(source))para.a[readerRef(source)]=['n',String(n.number)];
    para.c=pack.linksAfter[s.sectionRef].filter(e=>e.a===origin).map(e=>[e.r,e.c||'']);
  });
  put(MCP,mcp);
  const marker='const editionDataUrl = url => ',revision=RELEASE+'-'+prepared.packSha256.slice(0,12);
  let html=fs.readFileSync(local(directory,'library/index.html'),'utf8');assert.equal(html.split(marker).length,2);assert(!html.includes('/* '+RELEASE+' */'));
  html=html.replace(marker,marker+'/* '+RELEASE+" */ (url.startsWith('data/peri-tzadik/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?parsha="+revision+"' :\n");
  const externalUrls=[...new Set([...prepared.additions,...prepared.replacements].flatMap(op=>op.after.sources.filter(source=>source.openExternal).map(source=>source.url)))].sort();
  for(const url of externalUrls)assert(pack.sourceEvidence.some(e=>e.url===url&&e.verified),'External link lacks reviewed primary-source evidence');
  const safeUrlMarker='const safeFootnoteUrl = url => ';assert.equal(html.split(safeUrlMarker).length,2);
  html=html.replace(safeUrlMarker,safeUrlMarker+'/* Exact reviewed Pri parsha source URLs */ '+JSON.stringify(externalUrls)+".includes(String(url || '')) || ");
  const projectionCall='const notes=connectedIdeas.footnotesForSection({...data,he:flatten(data.he),en:flatten(data.en)},records);';assert.equal(html.split(projectionCall).length,2);
  const projection=`const priParshaNoteNumbers=${JSON.stringify(pack.connected.numbers)};\nfunction priParshaQuotedConnection(note,sectionRef){\n  const numbers=priParshaNoteNumbers[sectionRef];if(!numbers)return note;\n  const number=numbers[note.connectionIdeaId];if(!Number.isInteger(number))return note;\n  const paragraph=note.paragraphs.find(p=>p.text.includes(note.sourceExcerpt.en));\n  if(!paragraph)throw new Error('Reviewed Kisvei quotation is missing');\n  return {...note,number,quotationOnly:true,paragraphs:[paragraph]};\n}\n`;
  const mountMarker='async function mountConnectedIdeas(';assert.equal(html.split(mountMarker).length,2);html=html.replace(mountMarker,projection+mountMarker);
  html=html.replace(projectionCall,projectionCall.slice(0,-1)+'.map(note=>priParshaQuotedConnection(note,data.sectionRef));');
  const returnMarker='  return {\n    local: true, ref: sectionRef, sectionRef, heRef:';assert.equal(html.split(returnMarker).length,2);
  const supplement=`  if(!il && /^Peri Tzadik, Vayera (?:8|9|10)$/.test(sectionRef)){\n    const extra=await loadFile('data/peri-tzadik/vayera-original-source-notes.json');\n    const rows=extra[sectionRef];if(rows){\n      annotations=Object.fromEntries(rows.map((notes,i)=>[i,notes]));\n      phrases=he.map(value=>[[value,'']]);nums=he.map((_,i)=>i+1);\n    }\n  }\n`;
  html=html.replace(returnMarker,supplement+returnMarker);put('library/index.html',Buffer.from(html));
  let sw=fs.readFileSync(local(directory,'library/sw.js'),'utf8');assert.equal((sw.match(/const SHELL = `[^`]+`;/g)||[]).length,1);sw=sw.replace(/const SHELL = `([^`]+)`;/,(_all,key)=>'const SHELL = `'+key+'-pri-parsha-'+prepared.packSha256.slice(0,12)+'`;');put('library/sw.js',Buffer.from(sw));
  const data=dataEntries(directory);for(const [name,bytes]of changes)if(name.startsWith('library/data/'))data[name.slice(8)]=bytes;const manifest=dataManifest(data);put('library/data/files.json',manifest);
  const {zipSync,unzipSync}=createRequire(import.meta.url)(local(directory,'library/vendor/fflate.min.js')),archives=[];
  for(const name of ARCHIVES){
    const original=unzipSync(fs.readFileSync(local(directory,name))),next={...original},book=name.includes('/books/');
    for(const [filename,bytes]of changes)if(filename.startsWith('library/data/')){const key=filename.slice(8);if(!book||key.startsWith('data/peri-tzadik/'))next[key]=bytes;}
    if(!book)next['data/files.json']=json(dataManifest(next));
    const output=zipSync(next,{level:6,mtime:new Date('2026-10-25T00:00:00Z')}),check=unzipSync(output);assert.deepEqual(Object.keys(check).sort(),Object.keys(next).sort());
    for(const [key,bytes]of Object.entries(next))assert.equal(sha(check[key]),sha(bytes));
    const changedMembers=Object.keys(next).filter(n=>!original[n]||sha(original[n])!==sha(next[n])).map(n=>({path:n,before:original[n]?info(original[n]):null,after:info(next[n])}));
    for(const member of changedMembers)assert(member.path==='data/files.json'&&!book||changes.has('library/'+member.path),'Unrelated ZIP entry changed');
    assert(Object.keys(original).every(n=>Object.hasOwn(next,n)),'Archive member removed');
    archives.push({path:name,before:fileInfo(local(directory,name)),after:info(output),entriesBefore:Object.keys(original).length,entriesAfter:Object.keys(next).length,preservedEntries:Object.keys(original).length-changedMembers.filter(m=>m.before).length,changedMembers,dataFiles:Object.keys(next).filter(n=>n.startsWith('data/')).length});put(name,output);
  }
  const downloads=read(directory,'library/downloads/index.json');downloads.version=manifest.version;
  for(const archive of archives){const entry=archive.path.includes('/books/')?downloads.books.find(b=>b.slug==='peri-tzadik'):downloads.library;assert(entry);entry.bytes=archive.after.bytes;entry.dataFiles=archive.dataFiles;}put('library/downloads/index.json',downloads);
  const catalog=read(directory,'mcp-data/catalog.json');catalog.version=manifest.version;put('mcp-data/catalog.json',catalog);put(LEDGER,pack.audit);
  const before=baselineFiles||inventory(directory),predecessors=Object.keys(before).filter(name=>/^library\/(?:tzidkat-batch-review-\d+-\d+-\d+|tzidkat-source-accuracy-\d+|tzidkat-source-attribution-\d+|pri-seasonal-quoted-sources-publication|pri-shabbos-quoted-sources-publication)\.json$/.test(name)).sort().map(name=>({path:name,...before[name]}));
  const counts={reviewedSections:pack.chapters.length+pack.supplementalSections.length,originalNotes:pack.audit.originalNoteCount,replacedNotes:prepared.replacements.length,formattedNotes:pack.formatCorrections.length,removedRedundantOrUnrelatedNotes:prepared.removals.length,newNotes:prepared.additions.length,existingKisveiNotes:pack.connected.entries.length,finalNotes:pack.audit.originalNoteCount-prepared.removals.length+prepared.additions.length,attributionCorrections:(pack.bodyCorrections||[]).filter(c=>c.kind==='verified-attribution').length};
  const descriptor={schemaVersion:1,release:RELEASE,packSha256:prepared.packSha256,baselineInventorySha256:digest(before),files:[...changes].map(([name,bytes])=>({path:name,before:before[name]||null,after:info(bytes)})),predecessors,archives,counts,version:manifest.version,verification:{hebrewAuthorTextUnchanged:true,exactReviewedOperations:true,existingNoteIdentitiesPreserved:true,unrelatedFilesUnchanged:true,unrelatedArchiveEntriesUnchanged:true}};
  return{changes,descriptor};
}
function writePin(name,value){const bytes=json(value);write(REPO_ROOT,name,bytes);fs.writeFileSync(local(REPO_ROOT,name)+'.sha256',sha(bytes)+'\n');}
function apply(directory,prepared,state){
  const before=inventory(directory);assert.deepEqual(before,state.files,'Publication changed after capture');assert.equal(digest(before),prepared.descriptor.baselineInventorySha256,'Current full publication differs from reviewed plan');
  const plan=planPublication(directory,prepared,{baselineFiles:before});assert.deepEqual(plan.descriptor,prepared.descriptor,'Publication differs from deterministic reviewed plan');
  for(const [name,bytes]of plan.changes)write(directory,name,bytes);
  write(directory,REPORT,{schemaVersion:1,release:RELEASE,packSha256:prepared.packSha256,descriptorSha256:prepared.descriptorSha256,counts:prepared.descriptor.counts,completeReview:true,baselineArtifact:state.publication||null,baselineFiles:before,changedFiles:prepared.descriptor.files.map(f=>({path:f.path,...f.after})),verification:{ok:true,...prepared.descriptor.verification}});
  return verifyPublication({directory,prepared,verifyAllBaseline:true}).proof;
}

async function github(route){const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;const r=await fetch('https://api.github.com/repos/'+REPO+route,{headers,signal:AbortSignal.timeout(30000)});assert(r.ok,'GitHub '+r.status+' '+route);return r.json();}
async function mapLimited(items,callback,concurrency=4){let next=0;const results=[];await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)break;results[i]=await callback(items[i],i);}}));return results;}
async function bytesPublic(name){for(let n=0;n<4;n++){try{const url=new URL(name,SITE);url.searchParams.set('pri_source_verify',String(Date.now()));const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(45000)});assert(r.ok,'Public '+r.status+' '+name);return Buffer.from(await r.arrayBuffer());}catch(error){if(n===3)throw error;}}}
async function currentPublication(){
  const publishers=new Map();for(const name of fs.readdirSync(path.join(REPO_ROOT,'.github/workflows')).filter(n=>n.endsWith('.yml'))){let label='';const labels=[];for(const line of fs.readFileSync(path.join(REPO_ROOT,'.github/workflows',name),'utf8').split('\n')){if(line.trimStart().startsWith('- name:'))label=line.split('- name:')[1].trim();if(line.includes('uses: actions/deploy-pages@')){assert(label);labels.push(label);}}if(labels.length)publishers.set('.github/workflows/'+name,labels);}
  const candidates=[];for(let page=1;page<=3&&!candidates.length;page++){const runs=(await github('/actions/runs?branch=main&per_page=100&page='+page)).workflow_runs;await mapLimited(runs.filter(r=>((String(r.id)!==process.env.GITHUB_RUN_ID&&r.status==='completed')||(String(r.id)===process.env.GITHUB_RUN_ID&&Number(process.env.GITHUB_RUN_ATTEMPT)>1))&&r.conclusion!=='skipped'&&publishers.has(r.path)),async run=>{const jobs=(await github('/actions/runs/'+run.id+'/jobs?filter=all&per_page=100')).jobs;const steps=jobs.filter(j=>String(run.id)!==process.env.GITHUB_RUN_ID||j.run_attempt<Number(process.env.GITHUB_RUN_ATTEMPT)).flatMap(j=>j.steps||[]).filter(s=>publishers.get(run.path).includes(s.name)&&s.conclusion==='success');if(steps.length)candidates.push({run,completedAt:steps.map(s=>s.completed_at).sort().at(-1)});});}
  assert(candidates.length,'No actual complete Pages publication found');candidates.sort((a,b)=>b.completedAt.localeCompare(a.completedAt));const {run,completedAt}=candidates[0],all=(await github('/actions/runs/'+run.id+'/artifacts?per_page=100')).artifacts;const artifact=all.filter(a=>a.name==='github-pages'&&!a.expired&&a.created_at<=completedAt).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];assert(artifact);return{runId:run.id,headSha:run.head_sha,artifactId:artifact.id,digest:artifact.digest,bytes:artifact.size_in_bytes,deployedAt:completedAt};
}
async function branchGuard(expected){assert.match(expected||'',/^[a-f0-9]{40}$/);assert.equal((await github('/git/ref/heads/main')).object.sha,expected,'Main advanced; preserve intervening work');}
const liveGuards=pack=>['index.html','library/index.html','library/sw.js','library/data/files.json',LINKS,'mcp-data/catalog.json','library/connected-ideas/catalog.json',...pack.chapters.map(c=>c.path),...pack.supplementalSections.map(s=>s.path)];
async function guard(state){await branchGuard(state.expectedHead);const now=await currentPublication();assert.equal(now.artifactId,state.publication.artifactId,'Newer publication exists');await mapLimited(liveGuards(loadPack().pack),async name=>assert.equal(sha(await bytesPublic(name)),state.files[name].sha256,'Public baseline changed: '+name));console.log('Exact current branch, publication artifact, and reviewed chapter preimages verified.');}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=args[0]||'--prepare';
  if(mode==='--prepare'){const p=loadPack({requireDescriptor:fs.existsSync(local(REPO_ROOT,DESCRIPTOR))});console.log(JSON.stringify({ok:true,release:RELEASE,packSha256:p.packSha256,add:p.additions.length,replace:p.replacements.length,remove:p.removals.length}));}
  else if(mode==='--plan'){const p=loadPack(),before=inventory(root),result=planPublication(root,p,{baselineFiles:before});writePin(DESCRIPTOR,result.descriptor);const candidate=path.resolve(option('--candidate','pri-parsha-candidate'));assert(!fs.existsSync(candidate));fs.cpSync(root,candidate,{recursive:true});const sealed=loadPack({requireDescriptor:true});console.log(JSON.stringify(apply(candidate,sealed,{files:before})));}
  else if(mode==='--metadata'){const p=loadPack({requireDescriptor:true});await branchGuard(process.env.GITHUB_SHA);const publication=await currentPublication();write(REPO_ROOT,META,{expectedHead:process.env.GITHUB_SHA,publication,packSha256:p.packSha256});if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'artifact='+publication.artifactId+'\nrun='+publication.runId+'\n');console.log(JSON.stringify({publication,...p.descriptor.counts}));}
  else if(mode==='--capture'){const state=read(REPO_ROOT,META),p=loadPack({requireDescriptor:true});assert.equal(state.packSha256,p.packSha256);state.files=inventory(root);state.alreadyPublished=fs.existsSync(local(root,REPORT));if(state.alreadyPublished)verifyPublication({directory:root,prepared:p,verifyAllBaseline:true});else{checkPreimages(root,p);assert.equal(digest(state.files),p.descriptor.baselineInventorySha256);}await guard(state);write(REPO_ROOT,STATE,state);console.log(JSON.stringify({capturedFiles:Object.keys(state.files).length,alreadyPublished:state.alreadyPublished}));}
  else if(mode==='--guard')await guard(read(REPO_ROOT,STATE));
  else if(mode==='--apply'){const state=read(REPO_ROOT,STATE),p=loadPack({requireDescriptor:true});assert.equal(state.packSha256,p.packSha256);console.log(JSON.stringify(state.alreadyPublished?verifyPublication({directory:root,prepared:p,verifyAllBaseline:true}).proof:apply(root,p,state)));}
  else if(mode==='--verify')console.log(JSON.stringify(verifyPublication({directory:root,verifyAllBaseline:true}).proof));
  else if(mode==='--rebuild'){
    const p=loadPack({requireDescriptor:true});if(fs.existsSync(local(root,REPORT)))console.log(JSON.stringify(verifyPublication({directory:root,prepared:p,verifyAllBaseline:true}).proof));
    else console.log(JSON.stringify(apply(root,p,{files:inventory(root)})));
  }else if(mode==='--live'){
    const v=verifyPublication({directory:root,verifyAllBaseline:true});const files=[...v.descriptor.files.map(f=>({path:f.path,...f.after})),{path:REPORT,...fileInfo(local(root,REPORT))}];
    await mapLimited(files,async f=>assert.equal(sha(await bytesPublic(f.path)),f.sha256,'Published bytes differ: '+f.path));
    write(REPO_ROOT,'pri-parsha-live-verification.json',{ok:true,...v.proof,verifiedFiles:files.length,verifiedAt:new Date().toISOString()});console.log(JSON.stringify({ok:true,...v.proof,verifiedFiles:files.length}));
  }else throw Error('Unknown mode '+mode);
}

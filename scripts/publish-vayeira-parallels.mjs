// Add reviewed Vayeira parallels to the actual current complete publication.
// The author's text and every file outside the explicit change set are preserved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {REPO_ROOT,sha,digest,json,info,local,fileInfo,inventory,read,write,plain,norm,notesOf,sourceSlug,navigates,readerRef,noteProjection} from './pri-parsha-review-core.mjs';

export const RELEASE='20261026-vayeira-general-parallels-v2';
export const PACK='sources/akiva/overlays/vayeira-general-parallels-20261026.json.gz';
const REPORT='library/vayeira-general-parallels-20261026.json';
const LINKS='library/data/peri-tzadik/links.json',MCP='mcp-data/text/peri-tzadik.json';
const SUPPLEMENT='library/data/peri-tzadik/vayera-original-source-notes.json';
const ARCHIVES=['library/downloads/rav-tzadok-library.zip','library/downloads/books/peri-tzadik.zip'];
const REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const SITE='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const META='vayeira-general-parallels-publication.json',STATE='vayeira-general-parallels-baseline.json';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const root=path.resolve(option('--root','dist'));
const edgeKey=e=>JSON.stringify([e.a,e.r]);
const allNotes=pack=>[...pack.sections.flatMap(s=>notesOf(s.after).map(x=>({...x,sectionRef:s.sectionRef,originRef:s.sectionRef+':'+x.row.n}))),...Object.entries(pack.supplement.after).flatMap(([sectionRef,rows])=>rows.flatMap((notes,i)=>notes.map(note=>({note,row:{n:i+1},sectionRef,originRef:sectionRef+':'+(i+1)}))))];
const noteId=n=>n.placementId||n.sourceId;

const COORDINATES=['phraseIndex','heCharOffset','heAnchorPrefix','heWord','enCharOffset','enAnchorPrefix'];
const ROLES={'parallel-rav-tzadok':'Rav Tzadok','parallel-ishbitz-radzin':'Ishbitz–Radzin','parallel-chassidus':'Chassidus','parallel-kabbalah':'Kabbalah','parallel-machshava':'Machshavah','parallel-mussar':'Mussar'};
const withoutCoordinates=note=>Object.fromEntries(Object.entries(note).filter(([key])=>!COORDINATES.includes(key)));
function validateAnchor(entry){
  const n=entry.note;assert(Number.isInteger(n.phraseIndex)&&n.phraseIndex>=0);assert(Number.isInteger(n.heCharOffset)&&n.heCharOffset>0);assert(typeof n.heAnchorPrefix==='string');
  if(entry.row?.p){assert(entry.row.p[n.phraseIndex],'New Hebrew anchor phrase does not exist');const he=plain(entry.row.p[n.phraseIndex][0]);assert.equal(he.slice(0,n.heCharOffset),n.heAnchorPrefix,'Exact Hebrew anchor mismatch');assert(n.heCharOffset<=he.length);}
}
export function validatePack(pack){
  assert.equal(pack.schemaVersion,1);assert.equal(pack.release,RELEASE);
  assert.deepEqual(pack.sections.map(s=>s.sectionRef),Array.from({length:7},(_,i)=>'Peri Tzadik, Vayera '+(i+1)));
  assert.equal(pack.supplement.path,SUPPLEMENT);
  assert(Array.isArray(pack.reanchors),'Exact reviewed reanchors audit is required');
  assert(pack.reanchors.every(x=>x.placementId&&typeof x.reason==='string'&&x.reason.trim()),'Reanchor requires its reviewed reason');
  assert.equal(new Set(pack.reanchors.map(x=>x.placementId)).size,pack.reanchors.length,'Repeated reanchor audit');
  const changes=[],reanchors=[],beforeNotes=[];
  function compare(note,prior,entry){
    if(!prior){changes.push({...entry,note});return;}
    const moved=prior.originRef!==entry.originRef;
    if(!moved&&isDeepStrictEqual(note,prior.note))return;
    assert(pack.reanchors.some(x=>x.placementId===noteId(note)),'An existing note changed without an exact reviewed reanchor');
    assert.deepEqual(withoutCoordinates(note),withoutCoordinates(prior.note),'Reanchoring changed an existing quote, source, identity or provenance');
    validateAnchor({...entry,note});reanchors.push({...entry,note,before:prior.note,beforeOriginRef:prior.originRef});
  }
  for(const[i,s]of pack.sections.entries()){
    assert.equal(s.path,'library/data/peri-tzadik/'+(159+i)+'.json');
    const body=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='footnotes')));
    assert.deepEqual(body(s.after),body(s.before),'Author text, translation or headings changed');
    const old=new Map(notesOf(s.before).map(x=>[noteId(x.note),{note:x.note,originRef:s.sectionRef+':'+x.row.n}]));beforeNotes.push(...[...old.values()].map(x=>x.note));
    for(const row of s.after)for(const note of row.footnotes||[])compare(note,old.get(noteId(note)),{sectionRef:s.sectionRef,row,originRef:s.sectionRef+':'+row.n});
  }
  assert.deepEqual(Object.keys(pack.supplement.before).sort(),[8,9,10].map(n=>'Peri Tzadik, Vayera '+n).sort());
  assert.deepEqual(Object.keys(pack.supplement.after).sort(),Object.keys(pack.supplement.before).sort());
  for(const[ref,rows]of Object.entries(pack.supplement.before)){
    const next=pack.supplement.after[ref];assert.equal(next.length,rows.length);
    const old=new Map(rows.flatMap((notes,i)=>notes.map(note=>[noteId(note),{note,originRef:ref+':'+(i+1)}])));beforeNotes.push(...[...old.values()].map(x=>x.note));
    next.forEach((notes,i)=>{for(const note of notes)compare(note,old.get(noteId(note)),{sectionRef:ref,paragraph:i+1,originRef:ref+':'+(i+1)});});
  }
  assert.deepEqual(reanchors.map(x=>noteId(x.note)).sort(),pack.reanchors.map(x=>x.placementId).sort(),'Reanchor audit must match every exact placement change');
  const seen=new Set(),numbers=new Set(),sourceIds=new Set();
  for(const{note}of allNotes(pack)){assert(noteId(note));assert(!seen.has(noteId(note)),'Duplicate placement');seen.add(noteId(note));assert(!numbers.has(note.number),'Duplicate Vayeira number');numbers.add(note.number);assert(!sourceIds.has(note.sourceId),'Duplicate Vayeira source identity');sourceIds.add(note.sourceId);}
  for(const entry of changes){
    const n=entry.note,q=n.reviewedSourceExcerpt;assert(q?.ref&&q.url&&q.he&&q.en,'Missing bilingual verified source evidence');
    assert(/^https:\/\/www\.sefaria\.org\//.test(q.url),'Parallel requires the verified exact Sefaria source URL');
    assert(n.quotationOnly===true&&n.verificationStatus==='verified');assert.equal(n.sources.length,1);assert.equal(n.sources[0].ref,q.ref);assert.equal(n.sources[0].url,q.url);assert(Object.hasOwn(ROLES,n.sources[0].role),'Unreviewed parallel category');
    assert(!beforeNotes.some(old=>old.number===n.number||old.sourceId===n.sourceId||noteId(old)===noteId(n)),'New note identity collision');
    assert(!beforeNotes.some(old=>(old.sources||[]).some(source=>source.ref===q.ref)),'Parallel repeats a source already quoted in the Vayeira notes');
    const evidence=(pack.sourceEvidence||[]).find(e=>e.ref===q.ref&&e.url===q.url&&e.verified===true&&norm(e.he).includes(norm(q.he)));
    assert(evidence,'New quotation lacks primary source evidence');if(evidence.sha256)assert.equal(evidence.sha256,sha(evidence.he));
    const label=q.citation||q.ref,expected=label+': “'+q.en+'”';
    assert.deepEqual(n.paragraphs,[{language:'en',text:expected,rich:[{text:label,bold:true,href:q.url},{text:': “'+q.en+'”'}]}],'Visible note must contain only source citation and complete translation');validateAnchor(entry);
  }
  const refs=new Set();for(const{note}of allNotes(pack))for(const source of note.sources||[]){if(!source.role?.startsWith('parallel-')&&!/Tzidkat HaTzadik|Resisei Layla|Mei HaShiloach|Poked Akarim/.test(source.ref))continue;assert(!refs.has(source.ref),'Repeated parallel source '+source.ref);refs.add(source.ref);}
  const retainedIds=new Set(allNotes(pack).map(x=>noteId(x.note))),removedNotes=beforeNotes.filter(n=>!retainedIds.has(noteId(n)));
  assert(Array.isArray(pack.removals),'Exact reviewed removals audit is required');assert.deepEqual(pack.removals.map(x=>x.placementId).sort(),removedNotes.map(noteId).sort(),'A note deletion was not explicitly reviewed');assert(pack.removals.every(x=>typeof x.reason==='string'&&x.reason.trim()),'Removal requires its reviewed reason');
  for(const removed of removedNotes)assert((removed.sources||[]).length===1&&refs.has(removed.sources[0].ref),'Only a repeated parallel source may be removed');
  assert.equal(pack.audit?.reviewedSections,10);assert.equal(pack.audit?.newNotes,changes.length,'New-note audit count differs');assert.equal(pack.audit?.reanchoredNotes,reanchors.length,'Reanchor audit count differs');assert(Array.isArray(pack.suppressConnectionIds||[]));
  return{pack,additions:changes,reanchors};
}
export function loadPack(){const raw=fs.readFileSync(local(REPO_ROOT,PACK)),pin=fs.readFileSync(local(REPO_ROOT,PACK+'.sha256'),'utf8').trim();assert.match(pin,/^[a-f0-9]{64}$/);assert.equal(sha(raw),pin,'Reviewed pack changed');return{...validatePack(JSON.parse(gunzipSync(raw))),packSha256:sha(raw)};}
function preimages(directory,{pack,additions}){
  for(const s of pack.sections)assert.deepEqual(read(directory,s.path),s.before,'Vayeira source changed: '+s.path);
  assert.deepEqual(read(directory,SUPPLEMENT),pack.supplement.before,'Hebrew-only note source changed');
  for(const [ref,rows]of Object.entries(pack.supplement.after)){
    const hebrew=read(directory,'library/data/peri-tzadik/9-'+ref.split(' ').at(-1)+'.json');assert.equal(rows.length,hebrew.length);
    rows.forEach((notes,i)=>{for(const n of notes){assert.equal(n.phraseIndex,0);const he=plain(hebrew[i]);assert.equal(he.slice(0,n.heCharOffset),n.heAnchorPrefix,'Supplement Hebrew marker changed');assert(n.heCharOffset<=he.length);}});
  }
  for(const name of fs.readdirSync(local(directory,'library/data/peri-tzadik')).filter(n=>/^\d+\.json$/.test(n)&&!pack.sections.some(s=>s.path.endsWith('/'+n)))){
    const rows=read(directory,'library/data/peri-tzadik/'+name);if(!Array.isArray(rows))continue;
    for(const{note:old}of notesOf(rows))for(const{note:n}of additions)assert(old.number!==n.number&&old.sourceId!==n.sourceId&&noteId(old)!==noteId(n),'New note identity collides with another Pri Tzaddik section');
  }
}
function dataEntries(directory){const out={};function walk(dir,prefix){for(const e of fs.readdirSync(dir,{withFileTypes:true})){assert(!e.isSymbolicLink());const f=path.join(dir,e.name),key=prefix+e.name;if(e.isDirectory())walk(f,key+'/');else out[key]=fs.readFileSync(f);}}walk(local(directory,'library/data'),'data/');return out;}
function dataManifest(entries){const names=Object.keys(entries).filter(n=>n.startsWith('data/')&&n!=='data/files.json').sort(),hash=createHash('sha256');let bytes=0;for(const name of names){hash.update(name.slice(5)).update('\0').update(entries[name]);bytes+=entries[name].length;}return{version:hash.digest('hex').slice(0,16),bytes,files:names.map(n=>n.slice(5))};}
function citationPlaces(row){const a={};row.p.forEach((pair,k)=>pair.forEach((html,side)=>{for(const m of String(html).matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g)){const ref=plain(m[1]);a[ref]??=[k,side?'e':'h',plain(html.slice(0,m.index)).trim().length];}}));for(const note of row.footnotes||[])for(const source of note.sources||[])if(navigates(source))a[readerRef(source)]??=['n',String(note.number)];return a;}
export function planPublication(directory,prepared){
  preimages(directory,prepared);const{pack}=prepared,changes=new Map();
  const put=(name,value)=>{const bytes=value instanceof Uint8Array?Buffer.from(value):json(value),file=local(directory,name);if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==sha(bytes))changes.set(name,bytes);};
  for(const s of pack.sections)put(s.path,s.after);put(SUPPLEMENT,pack.supplement.after);
  const links=read(directory,LINKS),oldEdges=new Map(),nextEdges=new Map();
  const oldByRef=new Map(pack.sections.map(s=>[s.sectionRef,s.before.flatMap(r=>(r.footnotes||[]).map(note=>({note,originRef:s.sectionRef+':'+r.n})))]));
  for(const [ref,rows]of Object.entries(pack.supplement.before))oldByRef.set(ref,rows.flatMap((notes,i)=>notes.map(note=>({note,originRef:ref+':'+(i+1)}))));
  for(const [ref,oldNotes]of oldByRef){
    const original=links[ref]||[];for(const edge of original)oldEdges.set(edgeKey(edge),edge);
    const notes=allNotes(pack).filter(x=>x.sectionRef===ref),nextById=new Map(notes.map(x=>[noteId(x.note),x]));
    const removedSources=oldNotes.filter(x=>!nextById.has(noteId(x.note))||nextById.get(noteId(x.note)).originRef!==x.originRef).flatMap(x=>(x.note.sources||[]).filter(navigates).map(s=>({a:x.originRef,r:readerRef(s)})));
    const next=original.filter(edge=>!removedSources.some(s=>edgeKey(s)===edgeKey(edge))||notes.some(x=>x.originRef===edge.a&&(x.note.sources||[]).some(s=>readerRef(s)===edge.r)));
    for(const x of [...prepared.additions,...prepared.reanchors].filter(x=>x.sectionRef===ref))for(const source of x.note.sources||[])if(navigates(source)&&!next.some(e=>e.a===x.originRef&&e.r===readerRef(source))){
      const previous=x.beforeOriginRef&&original.find(e=>e.a===x.beforeOriginRef&&e.r===readerRef(source));
      next.push(previous?{...previous,a:x.originRef}:{a:x.originRef,r:readerRef(source),c:'Parallel Sources',kind:'Reviewed parallel · '+(ROLES[source.role]||'Source')});
    }
    links[ref]=next;for(const edge of next)nextEdges.set(edgeKey(edge),edge);
  }
  put(LINKS,links);
  const removed=[...oldEdges].filter(([key])=>!nextEdges.has(key)).map(([,e])=>e),added=[...nextEdges].filter(([key])=>!oldEdges.has(key)).map(([,e])=>e);
  const reverse=read(directory,'mcp-data/cited.json'),reverseFiles=new Map();
  function reverseFile(ref){const name='library/data/cited/'+sourceSlug(ref)+'.json';assert(sourceSlug(ref));if(!reverseFiles.has(name))reverseFiles.set(name,fs.existsSync(local(directory,name))?read(directory,name):{});return reverseFiles.get(name);}
  for(const edge of removed)for(const obj of [reverse,reverseFile(edge.r)])if(obj[edge.r]){obj[edge.r]=obj[edge.r].filter(origin=>origin!==edge.a);if(!obj[edge.r].length)delete obj[edge.r];}
  for(const edge of added)for(const obj of [reverse,reverseFile(edge.r)]){const origins=obj[edge.r]??=[];if(!origins.includes(edge.a))origins.push(edge.a);}
  for(const[name,obj]of reverseFiles)put(name,obj);put('mcp-data/cited.json',reverse);
  put('library/data/cited/index.json',[...new Set([...read(directory,'library/data/cited/index.json'),...[...reverseFiles.keys()].map(n=>path.basename(n,'.json'))])].sort());
  const citationSearch=read(directory,'library/data/cited/search.json');citationSearch.search=[...new Set([...citationSearch.search,...added.map(e=>e.r)])].sort();put('library/data/cited/search.json',citationSearch);
  const sourcePack=read(directory,'library/data/packs/sources.json');sourcePack.refs=[...new Set([...sourcePack.refs,...added.map(e=>e.r)])].sort();put('library/data/packs/sources.json',sourcePack);
  const mcp=read(directory,MCP);
  for(const s of pack.sections)for(const row of s.after.filter(r=>r.n&&r.p)){
    const origin=s.sectionRef+':'+row.n,para=mcp.paras.find(p=>p.r===origin&&p.p);assert(para);assert.deepEqual(para.p,row.p.map(pair=>pair.map(plain)),'MCP author text differs');
    const notes=(row.footnotes||[]).map(noteProjection);if(notes.length)para.f=notes;else delete para.f;
    const anchors=citationPlaces(row);if(Object.keys(anchors).length)para.a=anchors;else delete para.a;
    const edges=links[s.sectionRef].filter(e=>e.a===origin).map(e=>[e.r,e.c||'']);if(edges.length)para.c=edges;else delete para.c;
  }
  for(const[ref,rows]of Object.entries(pack.supplement.after))rows.forEach((notes,i)=>{
    const origin=ref+':'+(i+1),para=mcp.paras.find(p=>p.r===origin&&!p.p);assert(para);para.f=notes.map(noteProjection);para.a={...(para.a||{})};
    for(const n of notes)for(const source of n.sources||[])if(navigates(source))para.a[readerRef(source)]=['n',String(n.number)];
    for(const [source,anchor]of Object.entries(para.a))if(anchor[0]==='n'&&!notes.some(n=>String(n.number)===anchor[1]))delete para.a[source];
    para.c=links[ref].filter(e=>e.a===origin).map(e=>[e.r,e.c||'']);
  });put(MCP,mcp);
  let html=fs.readFileSync(local(directory,'library/index.html'),'utf8');const marker='const editionDataUrl = url => ';assert.equal(html.split(marker).length,2);
  html=html.replace(marker,marker+'/* '+RELEASE+" */ (url.startsWith('data/peri-tzadik/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?vayeira="+prepared.packSha256.slice(0,16)+"' :\n");
  const safe='const safeFootnoteUrl = url => ';assert.equal(html.split(safe).length,2);const urls=[...new Set(prepared.additions.flatMap(x=>x.note.sources.filter(s=>s.openExternal).map(s=>s.url)))];if(urls.length)html=html.replace(safe,safe+JSON.stringify(urls)+'.includes(String(url || \'\')) || ');
  if(pack.suppressConnectionIds?.length){const proposed='const proposed=connectedIdeas.forSection(catalog.records,data.sectionRef);';assert.equal(html.split(proposed).length,2);html=html.replace(proposed,'const proposed=connectedIdeas.forSection(catalog.records,data.sectionRef).filter(record=>!'+JSON.stringify(pack.suppressConnectionIds)+'.includes(record.id));');}
  put('library/index.html',Buffer.from(html));
  let sw=fs.readFileSync(local(directory,'library/sw.js'),'utf8');assert.equal((sw.match(/const SHELL = `[^`]+`;/g)||[]).length,1);sw=sw.replace(/const SHELL = `([^`]+)`;/,(_all,key)=>'const SHELL = `'+key+'-vayeira-'+prepared.packSha256.slice(0,12)+'`;');put('library/sw.js',Buffer.from(sw));
  const data=dataEntries(directory);for(const[name,bytes]of changes)if(name.startsWith('library/data/'))data[name.slice(8)]=bytes;const manifest=dataManifest(data);put('library/data/files.json',manifest);
  const {zipSync,unzipSync}=createRequire(import.meta.url)(local(directory,'library/vendor/fflate.min.js')),archives=[];
  for(const name of ARCHIVES){
    const original=unzipSync(fs.readFileSync(local(directory,name))),next={...original},book=name.includes('/books/');
    for(const[filename,bytes]of changes)if(filename.startsWith('library/data/')){const key=filename.slice(8);if(!book||key.startsWith('data/peri-tzadik/'))next[key]=bytes;}
    if(!book)next['data/files.json']=json(dataManifest(next));
    const output=zipSync(next,{level:6,mtime:new Date(2026,9,26,0,0,0)}),check=unzipSync(output);assert.deepEqual(Object.keys(check).sort(),Object.keys(next).sort());
    for(const[key,bytes]of Object.entries(next))assert.equal(sha(check[key]),sha(bytes));assert(Object.keys(original).every(n=>Object.hasOwn(next,n)));
    const changedMembers=Object.keys(next).filter(n=>!original[n]||sha(original[n])!==sha(next[n]));for(const member of changedMembers)assert(member==='data/files.json'&&!book||changes.has('library/'+member),'Unrelated ZIP entry changed');
    archives.push({path:name,bytes:output.length,dataFiles:Object.keys(next).filter(n=>n.startsWith('data/')).length,changedMembers,preservedEntries:Object.keys(original).length-changedMembers.filter(n=>original[n]).length});put(name,output);
  }
  const downloads=read(directory,'library/downloads/index.json');downloads.version=manifest.version;for(const archive of archives){const entry=archive.path.includes('/books/')?downloads.books.find(b=>b.slug==='peri-tzadik'):downloads.library;assert(entry);entry.bytes=archive.bytes;entry.dataFiles=archive.dataFiles;}put('library/downloads/index.json',downloads);
  const catalog=read(directory,'mcp-data/catalog.json');catalog.version=manifest.version;put('mcp-data/catalog.json',catalog);
  return{changes,archives,version:manifest.version,counts:{reviewedSections:10,newNotes:prepared.additions.length,reanchoredNotes:prepared.reanchors.length,removedNotes:[...oldByRef.values()].flat().length-allNotes(pack).length+prepared.additions.length,finalNotes:allNotes(pack).length,suppressedConnections:pack.suppressConnectionIds?.length||0}};
}
export function verifyPublication(directory,prepared=loadPack()){
  const report=read(directory,REPORT);assert.equal(report.release,RELEASE);assert.equal(report.packSha256,prepared.packSha256);
  assert.deepEqual(Object.keys(inventory(directory)).sort(),[...new Set([...Object.keys(report.baselineFiles),...report.changedFiles.map(f=>f.path),REPORT])].sort(),'Unrelated publication file added or removed');
  for(const f of report.changedFiles)assert.deepEqual(fileInfo(local(directory,f.path)),{bytes:f.bytes,sha256:f.sha256},'Published file changed: '+f.path);
  for(const[name,entry]of Object.entries(report.baselineFiles))if(!report.changedFiles.some(f=>f.path===name))assert.deepEqual(fileInfo(local(directory,name)),entry,'Unrelated published file changed: '+name);
  for(const s of prepared.pack.sections)assert.deepEqual(read(directory,s.path),s.after);assert.deepEqual(read(directory,SUPPLEMENT),prepared.pack.supplement.after);
  const{unzipSync}=createRequire(import.meta.url)(local(directory,'library/vendor/fflate.min.js'));
  for(const archive of ARCHIVES){const members=unzipSync(fs.readFileSync(local(directory,archive)),{filter:f=>f.name.startsWith('data/peri-tzadik/')});for(const s of prepared.pack.sections)assert.deepEqual(JSON.parse(Buffer.from(members[s.path.slice(8)])),s.after);assert.deepEqual(JSON.parse(Buffer.from(members[SUPPLEMENT.slice(8)])),prepared.pack.supplement.after);}
  return{ok:true,release:RELEASE,...report.counts,changedFiles:report.changedFiles.length,unrelatedFilesPreserved:Object.keys(report.baselineFiles).length-report.changedFiles.filter(f=>report.baselineFiles[f.path]).length,archives:2};
}
function apply(directory,prepared,state){
  const before=inventory(directory);if(state.files)assert.deepEqual(before,state.files,'Publication changed after capture');
  const plan=planPublication(directory,prepared);for(const[name,bytes]of plan.changes)write(directory,name,bytes);
  write(directory,REPORT,{schemaVersion:1,release:RELEASE,packSha256:prepared.packSha256,counts:plan.counts,archives:plan.archives,version:plan.version,baselineFiles:before,baselineArtifact:state.publication||null,changedFiles:[...plan.changes].map(([name,bytes])=>({path:name,...info(bytes)})),verification:{authorTextAndTranslationsUnchanged:true,exactHebrewAnchors:true,unrelatedFilesPreserved:true,unrelatedArchiveEntriesPreserved:true}});
  return verifyPublication(directory,prepared);
}
async function github(route){const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;const r=await fetch('https://api.github.com/repos/'+REPO+route,{headers,signal:AbortSignal.timeout(30000)});assert(r.ok,'GitHub '+r.status+' '+route);return r.json();}
async function mapLimited(items,callback,concurrency=4){let next=0;const results=[];await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)break;results[i]=await callback(items[i],i);}}));return results;}
async function bytesPublic(name){for(let n=0;n<4;n++){try{const url=new URL(name,SITE);url.searchParams.set('vayeira_verify',String(Date.now()));const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(60000)});assert(r.ok,'Public '+r.status+' '+name);return Buffer.from(await r.arrayBuffer());}catch(error){if(n===3)throw error;}}}
async function currentPublication(){
  const publishers=new Map();for(const name of fs.readdirSync(path.join(REPO_ROOT,'.github/workflows')).filter(n=>n.endsWith('.yml'))){let label='';const labels=[];for(const line of fs.readFileSync(path.join(REPO_ROOT,'.github/workflows',name),'utf8').split('\n')){if(line.trimStart().startsWith('- name:'))label=line.split('- name:')[1].trim();if(line.includes('uses: actions/deploy-pages@')){assert(label);labels.push(label);}}if(labels.length)publishers.set('.github/workflows/'+name,labels);}
  const candidates=[];for(let page=1;page<=3&&!candidates.length;page++){const runs=(await github('/actions/runs?branch=main&per_page=100&page='+page)).workflow_runs;await mapLimited(runs.filter(r=>((String(r.id)!==process.env.GITHUB_RUN_ID)||(String(r.id)===process.env.GITHUB_RUN_ID&&Number(process.env.GITHUB_RUN_ATTEMPT)>1))&&r.conclusion!=='skipped'&&publishers.has(r.path)),async run=>{const jobs=(await github('/actions/runs/'+run.id+'/jobs?filter=all&per_page=100')).jobs;const steps=jobs.filter(j=>String(run.id)!==process.env.GITHUB_RUN_ID||j.run_attempt<Number(process.env.GITHUB_RUN_ATTEMPT)).flatMap(j=>j.steps||[]).filter(s=>publishers.get(run.path).includes(s.name)&&s.conclusion==='success');if(steps.length)candidates.push({run,completedAt:steps.map(s=>s.completed_at).sort().at(-1)});});}
  assert(candidates.length,'No actual complete Pages publication found');candidates.sort((a,b)=>b.completedAt.localeCompare(a.completedAt));const{run,completedAt}=candidates[0],all=(await github('/actions/runs/'+run.id+'/artifacts?per_page=100')).artifacts;const artifact=all.filter(a=>a.name==='github-pages'&&!a.expired&&a.created_at<=completedAt).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];assert(artifact);return{runId:run.id,headSha:run.head_sha,artifactId:artifact.id,digest:artifact.digest,bytes:artifact.size_in_bytes,deployedAt:completedAt};
}
async function branchGuard(expected){assert.match(expected||'',/^[a-f0-9]{40}$/);assert.equal((await github('/git/ref/heads/main')).object.sha,expected,'Main advanced; preserve intervening work');}
async function guard(state){await branchGuard(state.expectedHead);assert.equal((await currentPublication()).artifactId,state.publication.artifactId,'Newer complete publication exists');const paths=['index.html','library/index.html','library/sw.js','library/data/files.json',LINKS,MCP,'mcp-data/catalog.json','library/connected-ideas/catalog.json',...loadPack().pack.sections.map(s=>s.path),SUPPLEMENT];await mapLimited(paths,async name=>assert.equal(sha(await bytesPublic(name)),state.files[name].sha256,'Public baseline changed: '+name));}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=args[0]||'--prepare';
  if(mode==='--prepare'){const p=loadPack();console.log(JSON.stringify({ok:true,release:RELEASE,packSha256:p.packSha256,newNotes:p.additions.length,reanchoredNotes:p.reanchors.length}));}
  else if(mode==='--metadata'){const p=loadPack();await branchGuard(process.env.GITHUB_SHA);const publication=await currentPublication();write(REPO_ROOT,META,{expectedHead:process.env.GITHUB_SHA,publication,packSha256:p.packSha256});if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'artifact='+publication.artifactId+'\nrun='+publication.runId+'\n');console.log(JSON.stringify(publication));}
  else if(mode==='--capture'){const state=read(REPO_ROOT,META),p=loadPack();assert.equal(state.packSha256,p.packSha256);state.files=inventory(root);state.alreadyPublished=fs.existsSync(local(root,REPORT));if(state.alreadyPublished)verifyPublication(root,p);else preimages(root,p);await guard(state);write(REPO_ROOT,STATE,state);console.log(JSON.stringify({capturedFiles:Object.keys(state.files).length,alreadyPublished:state.alreadyPublished}));}
  else if(mode==='--guard')await guard(read(REPO_ROOT,STATE));
  else if(mode==='--apply'){const state=read(REPO_ROOT,STATE),p=loadPack();assert.equal(state.packSha256,p.packSha256);console.log(JSON.stringify(state.alreadyPublished?verifyPublication(root,p):apply(root,p,state)));}
  else if(mode==='--rebuild'){const p=loadPack();console.log(JSON.stringify(fs.existsSync(local(root,REPORT))?verifyPublication(root,p):apply(root,p,{})));}
  else if(mode==='--verify')console.log(JSON.stringify(verifyPublication(root)));
  else if(mode==='--live'){const proof=verifyPublication(root),report=read(root,REPORT);await mapLimited([...report.changedFiles,{path:REPORT,...fileInfo(local(root,REPORT))}],async f=>assert.equal(sha(await bytesPublic(f.path)),f.sha256,'Public bytes differ: '+f.path));write(REPO_ROOT,'vayeira-general-parallels-live-verification.json',{...proof,verifiedAt:new Date().toISOString()});console.log(JSON.stringify(proof));}
  else throw Error('Unknown mode '+mode);
}

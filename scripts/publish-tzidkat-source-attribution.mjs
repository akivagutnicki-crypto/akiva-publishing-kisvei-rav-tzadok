// Focused successor for the current published Tzidkat HaTzadik reader.
// It never rebuilds unrelated sefarim or replays historical imports.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

export const REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
export const SITE='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
export const DEFAULT_PACK='sources/akiva/overlays/tzidkat-source-attribution-20261023.json.gz';
export const RELEASE='20261023-tzidkat-source-accuracy-v2';
export const PACK_SHA256='ba0242471e1b8ff47042342dbe031aa6ea5bc1e99934ecf3c796af40f3856c88';
const ACCURACY_PACK_SHA256='aec0a541c2a094262f6f9e66215d89ca2ccb4e0048cc8672e12ba79d96d5192a';
export const REPORT='library/tzidkat-source-attribution-20261023.json';
const LEDGER='library/tzidkat-source-attribution-ledger.json';
const TARGET='Tzidkat HaTzadik ',SLUG='tzidkat-hatzadik';
const argv=process.argv.slice(2),option=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
const root=path.resolve(option('--root','dist')),packFile=option('--pack',DEFAULT_PACK),baselineFile=option('--baseline','tzidkat-source-attribution-baseline.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const jbytes=value=>Buffer.from(JSON.stringify(value));
const digest=value=>sha(jbytes(value));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,value)=>{const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,jbytes(value));};
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',thinsp:' ',ensp:' ',emsp:' ',zwnj:'‌',zwj:'‍',lrm:'',rlm:''};
export const decode=s=>String(s??'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,e)=>e[0]==='#'?String.fromCodePoint(parseInt(e.slice(e[1]?.toLowerCase()==='x'?2:1),e[1]?.toLowerCase()==='x'?16:10)):entities[e.toLowerCase()]??m);
export const plain=s=>decode(String(s??'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'')).replace(/[ \t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const stripMarkup=s=>decode(String(s??'').replace(/<[^>]*>/g,''));
const chapterPath=i=>'library/data/'+SLUG+'/'+i+'.json';
const sectionFor=name=>TARGET+(Number(name.match(/\/(\d+)\.json$/)[1])+1);
const rowsOf=chapter=>chapter.filter(row=>Array.isArray(row.p));
const notesOf=chapter=>rowsOf(chapter).flatMap(row=>(row.footnotes||[]).map(note=>({row:row.n,note})));
const identity=note=>[note.placementId,note.sourceId,Number(note.number)];
const sortedIdentities=items=>items.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const noteIdentities=chapter=>sortedIdentities(notesOf(chapter).map(({note})=>identity(note)));
function checkIdentities(before,after,additions,scope){
  const prior=new Map(before.map(v=>[v[0],v])),current=new Map(after.map(v=>[v[0],v]));assert.equal(current.size,after.length,'Duplicate note placement: '+scope);
  const declared=new Map(additions.map(n=>[n.placementId,[n.placementId,n.sourceId,Number(n.number)]]));
  for(const[id,old]of prior)assert.deepEqual(current.get(id),old,'Existing note identity/number changed: '+id);
  const oldNumbers=new Set(before.map(v=>v[2])),oldSources=new Set(before.map(v=>v[1]));
  for(const[id,now]of current)if(!prior.has(id)){assert.deepEqual(now,declared.get(id),'Undeclared new note: '+id);assert(!oldNumbers.has(now[2]),'New note number collides: '+id);assert(!oldSources.has(now[1]),'New source ID collides: '+id);}
  for(const[id,wanted]of declared){assert(!prior.has(id),'Declared addition already exists: '+id);assert.deepEqual(current.get(id),wanted,'Declared new note absent: '+id);}
}
function assetFile(filename,asset){assert(typeof asset.sourcePath==='string'&&!path.isAbsolute(asset.sourcePath)&&!asset.sourcePath.split(/[\\/]/).includes('..'),'Invalid evidence asset source');return path.resolve(path.dirname(filename),asset.sourcePath);}
function isEvidenceAssetSource(source,pack){return (pack.assets||[]).some(asset=>source.url===asset.path||source.url===new URL(asset.path,SITE).href);}
const readerRefOf=source=>source.readerRef||source.ref;
const localNavigationSource=(source,pack)=>!source.citationOnly&&!source.openExternal&&!isEvidenceAssetSource(source,pack);
function projectedIdentities(pack){const changes=new Map(pack.chapters.map(f=>[f.path,f.after]));return Array.from({length:264},(_,i)=>notesOf(changes.get(chapterPath(i))||read(chapterPath(i))).map(({note})=>identity(note))).flat();}

const sourceSlug=ref=>ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function authorProjection(chapter){return chapter.map(row=>{const copy=structuredClone(row);delete copy.footnotes;if(copy.p)copy.p=copy.p.map(pair=>pair.map(stripMarkup));return copy;});}
function inventory(directory=root,prefix='',out={}){for(const item of fs.readdirSync(directory,{withFileTypes:true})){const name=prefix+item.name,f=path.join(directory,item.name);assert(!item.isSymbolicLink(),'Unexpected site symlink '+name);if(item.isDirectory())inventory(f,name+'/',out);else{const b=fs.readFileSync(f);out[name]={sha256:sha(b),bytes:b.length};}}return out;}
function excerpts(note){const out=[];for(const value of [note.reviewedSourceExcerpt,note.reviewedSourceExcerpts,note.sourceExcerptReview?.evidence]){if(Array.isArray(value))out.push(...value);else if(value)out.push(value);}if(out.length)return out;const value=note.sourceExcerpt;return Array.isArray(value)?value:value?[value]:[];}
function validateNote(row,note){
  assert(Number.isSafeInteger(note.phraseIndex)&&row.p[note.phraseIndex],'Missing Hebrew anchor phrase: '+note.placementId);
  const text=stripMarkup(row.p[note.phraseIndex][0]);
  if(note.heAnchorPrefix!==undefined){assert(text.startsWith(note.heAnchorPrefix),'Hebrew anchor prefix differs: '+note.placementId);assert.equal(note.heCharOffset,note.heAnchorPrefix.length,'Hebrew anchor offset differs: '+note.placementId);}
  else assert(Number.isInteger(note.heCharOffset)&&note.heCharOffset>=0&&note.heCharOffset<=text.length,'Invalid Hebrew offset: '+note.placementId);
  assert(note.paragraphs?.length&&note.paragraphs.every(p=>typeof p.text==='string'&&p.text.trim()),'Incomplete note text '+note.placementId);
  for(const p of note.paragraphs)if(p.rich)assert.equal(p.rich.map(x=>x.text).join(''),p.text,'Rich note text differs '+note.placementId);
  assert(note.sources?.length&&note.sources.every(s=>s.ref&&(s.url||s.citationOnly===true)),'Missing primary-source citation '+note.placementId);
  for(const source of note.sources)if(source.citationOnly){assert.equal(source.citationOnly,true);for(const key of['url','readerRef','openExternal','connectionsUrl'])assert(!Object.hasOwn(source,key),'Citation-only source must not navigate: '+key);const headings=note.paragraphs.flatMap(p=>p.rich||[]).filter(run=>run.text===source.ref);assert(headings.length&&headings.every(run=>run.bold&&!run.href),'Citation-only heading must remain bold plain text');}
  for(const p of note.paragraphs){assert.doesNotMatch(p.text,/Biur\s*(?:Me|Mi)shulav|Neim(?:ot|os|us|ut)(?:\s*HaTzedek)?|linked\s+(?:PDF|scan)|source\s+attachment/i,'Secondary edition attribution remains visible');for(const run of p.rich||[])assert(!/\.pdf(?:[?#]|$)/i.test(run.href||''),'Public PDF source link remains');}
  for(const source of note.sources){assert(!source.readerRef||typeof source.readerRef==='string'&&/\s\d/.test(source.readerRef),'Invalid local source reference '+note.placementId);assert(!(source.readerRef&&source.openExternal),'Ambiguous source navigation '+note.placementId);}
  const q=excerpts(note);assert(q.length&&q.every(s=>s.ref&&/[א-ת]/.test(s.he||'')&&/[A-Za-z]/.test(s.en||'')),'Missing checked bilingual source excerpt '+note.placementId);
}
let accuracyBase;
function loadAccuracyBase(){
  if(accuracyBase)return accuracyBase;
  const filename=option('--accuracy-pack',path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../sources/akiva/overlays/tzidkat-source-accuracy-20261023.json.gz'));
  const bytes=fs.readFileSync(filename);assert.equal(sha(bytes),ACCURACY_PACK_SHA256,'Original accuracy package changed');
  accuracyBase=JSON.parse(gunzipSync(bytes));assert.equal(accuracyBase.release,'20261023-tzidkat-source-accuracy-v1');return accuracyBase;
}
export function loadPack(filename=packFile){
  const bytes=fs.readFileSync(filename);assert.equal(sha(bytes),PACK_SHA256,'Frozen attribution package changed');
  const pack=JSON.parse(gunzipSync(bytes));assert.equal(pack.schemaVersion,1);assert.equal(pack.release,RELEASE);assert.equal(pack.audit?.completeReview,true);
  const pin=pack.baseline;assert(pin&&/^[a-f0-9]{40}$/.test(pin.commit)&&Number.isSafeInteger(pin.runId)&&Number.isSafeInteger(pin.artifactId)&&Number.isSafeInteger(pin.bytes));assert.match(pin.digest,/^sha256:[a-f0-9]{64}$/);assert(Object.keys(pin.pins||{}).length>=3);
  assert(Array.isArray(pack.chapters)&&pack.chapters.length&&Array.isArray(pack.operations)&&pack.operations.length);assert(Array.isArray(pack.audit.entries));
  for(const field of['ideaChanges','linkChanges','addedNotes'])assert.deepEqual(pack[field],[],'Attribution release cannot alter '+field);
  const prior=loadAccuracyBase(),names=new Set();
  for(const file of pack.chapters){assert.match(file.path,/^library\/data\/tzidkat-hatzadik\/\d+\.json$/);assert(!names.has(file.path));names.add(file.path);assert(Array.isArray(file.before)&&Array.isArray(file.after));assert.equal(digest(file.before),file.beforeSha256,'Attribution preimage differs');const first=prior.chapters.find(item=>item.path===file.path);assert(first&&digest(first.after)===file.beforeSha256,'Attribution preimage is not the reviewed v1 state');}
  const assets=new Set();for(const a of pack.assets||[]){assert.match(a.path,/^library\/data\/tzidkat-hatzadik\/source-evidence\/[A-Za-z0-9_-]+\.(pdf|png|jpg|jpeg|webp)$/);assert(!assets.has(a.path));assets.add(a.path);assert.match(a.sha256,/^[a-f0-9]{64}$/);assert.equal(sha(fs.readFileSync(assetFile(filename,a))),a.sha256,'Private source evidence changed');}
  return {pack,packSha256:sha(bytes)};
}
function compareChapters(before,after,file,pack){
  assert.deepEqual(authorProjection(after),authorProjection(before),'Author text or editorial structure changed: '+file);
  assert.deepEqual(after.map(({footnotes,...body})=>body),before.map(({footnotes,...body})=>body),'Author markup changed: '+file);
  checkIdentities(noteIdentities(before),noteIdentities(after),(pack.addedNotes||[]).filter(n=>n.sectionRef===sectionFor(file)),file);
  const prior=new Map(notesOf(before).map(({row,note})=>[note.placementId,{row,note}]));
  const changed=[];for(const row of rowsOf(after))for(const note of row.footnotes||[]){const old=prior.get(note.placementId);assert(old&&old.row===row.n,'Attribution cannot move/add a note');for(const key of['phraseIndex','heCharOffset','enCharOffset','heAnchorPrefix','enAnchorPrefix','heWord'])assert.deepEqual(note[key],old.note[key],'Attribution changed marker '+key);if(digest(old.note)===digest(note))continue;validateNote(row,note);const entry=pack.audit.entries.find(e=>e.placementId===note.placementId);assert(entry?.status==='verified','Correction lacks a verified audit entry: '+note.placementId);assert(entry.sourceEvidence?.length&&entry.sourceEvidence.every(e=>e.ref&&e.url&&/[א-ת]/.test(e.he||'')&&/[A-Za-z]/.test(e.en||'')),'Correction lacks direct source evidence: '+note.placementId);changed.push({sectionRef:sectionFor(file),originRef:sectionFor(file)+':'+row.n,placementId:note.placementId,number:note.number,sourceId:note.sourceId,beforeParagraph:old?.row??null,paragraph:row.n,before:old?.note??null,after:note,addition:!old});}
  return changed;
}
function declaredOperations(pack){
  const derived=pack.chapters.flatMap(file=>compareChapters(file.before,file.after,file.path,pack));
  assert.equal(derived.length,pack.operations.length,'Declared operation count differs');
  for(const operation of derived){const declared=pack.operations.find(item=>item.placementId===operation.placementId);assert(declared,'Missing declared operation');for(const key of['sectionRef','originRef','placementId','number','sourceId','beforeParagraph','paragraph','addition'])assert.deepEqual(operation[key],declared[key],'Declared operation differs '+key);}
  assert.equal(new Set(pack.operations.map(item=>item.placementId)).size,pack.operations.length);return derived;
}
function noteProjection(note,pack){
  const locations=(note.sources||[]).flatMap(source=>source.citationOnly?[]:isEvidenceAssetSource(source,pack)?['Source document: '+source.url]:source.readerRef?['Reader location: '+source.readerRef+'; original source citation: '+source.ref+' — '+source.url]:source.openExternal?['Original source: '+source.url]:[]);
  return[String(note.number),note.paragraphs.map(p=>plain(p.text)).concat(locations).join('\n'),note.phraseIndex,'h',note.heCharOffset];
}
function expectedAnchors(row,section,links,pack){
  const anchors={},valid=new Set((links[section]||[]).filter(edge=>edge.a===section+':'+row.n).map(edge=>edge.r));
  row.p.forEach((pair,i)=>pair.forEach((text,side)=>{for(const match of text.matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g)){const ref=decode(match[1]);if(valid.has(ref))anchors[ref]??=[i,side?'e':'h',plain(text.slice(0,match.index)).length];}}));
  for(const note of row.footnotes||[])for(const source of note.sources||[])if(localNavigationSource(source,pack))anchors[readerRefOf(source)]??=['n',String(note.number)];return anchors;
}
function checkTargetState(pack,{allowBefore=false,offline=false}={}){
  declaredOperations(pack);const links=read('library/data/'+SLUG+'/links.json'),base=loadAccuracyBase(),mcp=read('mcp-data/text/'+SLUG+'.json');let before=0,after=0;
  for(const file of pack.chapters){const actual=read(file.path),current=digest(actual),isBefore=current===file.beforeSha256,isAfter=current===digest(file.after);assert(isAfter||(allowBefore&&isBefore),'Unknown targeted chapter state: '+file.path);if(isAfter)after++;else before++;
    const section=sectionFor(file.path),priorLinks=base.linkChanges.find(item=>item.sectionRef===section);assert(priorLinks,'Missing immutable predecessor citation proof');assert.equal(digest(links[section]),digest(priorLinks.after),'Target citation list changed: '+section);
    for(const row of rowsOf(file.after)){const oldRow=rowsOf(file.before).find(item=>item.n===row.n),para=mcp.paras.find(p=>p.r===section+':'+row.n);assert(para,'Missing target MCP paragraph');assert.deepEqual(para.p,row.p.map(pair=>pair.map(plain)),'Target MCP author text changed');const numbers=new Set((row.footnotes||[]).map(note=>String(note.number))),actualNotes=(para.f||[]).filter(note=>numbers.has(String(note[0]))),wanted=(row.footnotes||[]).map(note=>noteProjection(note,pack)),previous=(oldRow.footnotes||[]).map(note=>noteProjection(note,pack));assert(digest(actualNotes)===digest(wanted)||(allowBefore&&digest(actualNotes)===digest(previous)),'Unknown targeted MCP footnotes: '+para.r);assert.deepEqual(para.a||{},expectedAnchors(row,section,links,pack),'Target MCP anchors changed: '+para.r);const citations=(links[section]||[]).filter(edge=>edge.a===para.r).map(edge=>[edge.r,edge.c||'']);assert.deepEqual(para.c||[],citations,'Target MCP citations changed: '+para.r);}
    // Removing a PDF witness must not create a local citation for its plain label.
    assert.deepEqual(linkPairs([{path:file.path,rows:file.before}],pack),linkPairs([{path:file.path,rows:file.after}],pack),'Attribution changed local source navigation');
  }
  for(const asset of pack.assets||[])assert.equal(sha(fs.readFileSync(path.join(root,asset.path))),asset.sha256,'Existing source evidence asset changed');
  if(offline)checkOfflineState(pack,{allowBefore});return {before,after};
}
function checkOfflineState(pack,{allowBefore=false}={}){
  const require=createRequire(import.meta.url),{unzipSync}=require(path.resolve(root,'library/vendor/fflate.min.js'));
  for(const name of['library/downloads/rav-tzadok-library.zip','library/downloads/books/'+SLUG+'.zip']){const archive=unzipSync(fs.readFileSync(path.join(root,name)));for(const file of pack.chapters){const bytes=archive[file.path.slice('library/'.length)];assert(bytes,'Missing targeted offline chapter '+file.path);const value=digest(JSON.parse(Buffer.from(bytes).toString()));assert(value===digest(file.after)||(allowBefore&&value===file.beforeSha256),'Unknown targeted offline chapter: '+name+' '+file.path);}}
}
function snapshot(pack,packSha256,files,rebuild){
  const sections=new Set(pack.chapters.map(file=>sectionFor(file.path))),mcp=read('mcp-data/text/'+SLUG+'.json');
  return {packSha256,files,rebuild,protectedBookText:mcp.paras.map(p=>[p.r,p.p||p.t]),mcpOutsideTargetsSha256:digest({...mcp,paras:mcp.paras.filter(p=>![...sections].some(section=>p.r.startsWith(section+':')))}),chapterAuthorHashes:Object.fromEntries(Array.from({length:264},(_,i)=>[chapterPath(i),digest(authorProjection(read(chapterPath(i))))])),nativeNoteIdentities:Array.from({length:264},(_,i)=>notesOf(read(chapterPath(i))).map(({note})=>identity(note))).flat(),ideas:read('library/connected-ideas/catalog.json').records.map(r=>({id:r.id,originRef:r.originRef,targetRef:r.targetRef,footnoteNumber:r.footnoteNumber,reverseFootnoteNumber:r.reverseFootnoteNumber}))};
}
function capture(rebuild=false){
  const {pack,packSha256}=loadPack(),hasReport=fs.existsSync(path.join(root,REPORT));assert(rebuild||!hasReport,'Attribution report already exists; use --rebuild for verified no-op');if(hasReport){reportIdentity(pack,packSha256);checkCache(pack,packSha256);}const files=inventory();
  if(!rebuild)for(const[name,hash]of Object.entries(pack.baseline.pins))assert.equal(files[name]?.sha256,hash,'Wrong live artifact '+name);
  const state=checkTargetState(pack,{allowBefore:!hasReport,offline:true});if(!rebuild)assert.equal(state.before,pack.chapters.length,'Focused publication requires every exact before chapter');
  fs.writeFileSync(baselineFile,jbytes(snapshot(pack,packSha256,files,rebuild)));console.log(JSON.stringify({ok:true,mode:rebuild?'capture-rebuild':'capture',...state}));
}
function linkPairs(chapters,pack){return chapters.flatMap(({path:name,rows})=>notesOf(rows).flatMap(({row,note})=>(note.sources||[]).filter(s=>s.ref&&localNavigationSource(s,pack)).map(s=>sectionFor(name)+':'+row+'\0'+readerRefOf(s)))).sort();}
function updateLinks(pack,priorChapters){
  const file='library/data/'+SLUG+'/links.json',before=read(file),after=structuredClone(before);
  for(const change of pack.linkChanges||[]){assert.equal(digest(before[change.sectionRef]||[]),change.beforeSha256,'Citation list changed '+change.sectionRef);for(const e of change.after)assert(e.a?.startsWith(change.sectionRef+':')&&e.r,'Invalid new citation owner');after[change.sectionRef]=change.after;}
  const oldPairs=linkPairs(priorChapters,pack),newPairs=linkPairs(pack.chapters.map(f=>({path:f.path,rows:f.after})),pack);
  const oldSet=new Set(oldPairs),newSet=new Set(newPairs),modified=[...oldSet].filter(x=>!newSet.has(x)).concat([...newSet].filter(x=>!oldSet.has(x)));
  for(const pair of modified){const owner=pair.split('\0')[0],section=owner.replace(/:\d+$/,'');assert((pack.linkChanges||[]).some(x=>x.sectionRef===section),'Changed source/paragraph requires explicit linkChanges for '+section);}
  if(digest(before)!==digest(after))write(file,after);
  // Preserve all reverse-citation owners outside the explicitly changed sections.
  const sections=new Set((pack.linkChanges||[]).map(x=>x.sectionRef));if(!sections.size)return after;
  const affected=owner=>[...sections].some(section=>owner===section||owner.startsWith(section+':'));
  const maps=new Map(),dir=path.join(root,'library/data/cited');
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.json')&&n!=='index.json')){const p='library/data/cited/'+name,original=read(p),next={};for(const[ref,owners]of Object.entries(original)){const keep=owners.filter(o=>!affected(o));if(keep.length)next[ref]=keep;}maps.set(name,{path:p,original,next});}
  const mcpOriginal=read('mcp-data/cited.json'),mcp={};for(const[ref,owners]of Object.entries(mcpOriginal)){const keep=owners.filter(o=>!affected(o));if(keep.length)mcp[ref]=keep;}
  const refs=[];for(const section of sections)for(const edge of after[section]||[]){const slug=sourceSlug(edge.r);assert(slug,'Malformed source slug '+edge.r);const name=slug+'.json';if(!maps.has(name))maps.set(name,{path:'library/data/cited/'+name,original:{},next:{}});const index=maps.get(name).next;for(const target of[index,mcp]){const list=target[edge.r]??=[];if(!list.includes(edge.a))list.push(edge.a);}refs.push(edge.r);}
  for(const item of maps.values())if(digest(item.original)!==digest(item.next))write(item.path,item.next);
  const indexFile='library/data/cited/index.json',index=read(indexFile),next=[...new Set([...index,...[...maps.keys()].map(n=>n.slice(0,-5))])].sort();if(digest(index)!==digest(next))write(indexFile,next);
  if(digest(mcpOriginal)!==digest(mcp))write('mcp-data/cited.json',mcp);
  const sourcesFile='library/data/packs/sources.json',sources=read(sourcesFile);sources.refs=[...new Set([...sources.refs,...refs])].sort();write(sourcesFile,sources);
  return after;
}
function updateMcp(pack){
  const name='mcp-data/text/'+SLUG+'.json',mcp=read(name);
  for(const file of pack.chapters)for(const row of rowsOf(file.after)){const ref=sectionFor(file.path)+':'+row.n,para=mcp.paras.find(p=>p.r===ref);assert(para);const numbers=new Set((row.footnotes||[]).map(note=>String(note.number)));para.f=[...(para.f||[]).filter(note=>!numbers.has(String(note[0]))),...(row.footnotes||[]).map(note=>noteProjection(note,pack))];}
  write(name,mcp);
}
function updateIdeas(pack){if(!(pack.ideaChanges||[]).length)return;const file='library/connected-ideas/catalog.json',catalog=read(file);for(const change of pack.ideaChanges){const at=catalog.records.findIndex(r=>r.id===change.id);assert(at>=0,'Missing supplemental record '+change.id);const old=catalog.records[at],next=change.after;assert.equal(digest(old),change.beforeSha256,'Supplemental record changed '+change.id);assert(old.originRef.startsWith(TARGET),'Only forward Tzidkat records may be modified by this interface; reverse records need explicit scope review');for(const field of['id','footnoteNumber','reverseFootnoteNumber'])assert.equal(next[field],old[field],'Supplemental identity/number changed '+change.id);assert(next.originRef.startsWith(TARGET)&&next.reviewed===true);for(const field of['originHebrew','originEnglish','targetRef','targetHebrew','targetEnglish','explanation','translationProvenance'])assert(next[field]?.trim(),'Incomplete supplemental record '+field);catalog.records[at]=next;}catalog.contentSha256=digest(catalog.records);catalog.version=catalog.contentSha256.slice(0,16);catalog.accuracyReview=pack.release;write(file,catalog);}
function sourceNavigationHtml(html,pack){
  if(!pack.chapters.some(f=>notesOf(f.after).some(({note})=>(note.sources||[]).some(s=>s.readerRef||s.openExternal))))return html;
  const replace=(needle,replacement)=>{assert.equal(html.split(needle).length,2,'Reader source navigation baseline differs');html=html.replace(needle,replacement);};
  const rich=`if (isSefaria(run.href)) segment = '<a href="' + esc(run.href) + '"'`;
  replace(rich,`const source = (note.sources || []).find(item => item.url === run.href);
      const readerRef = run.readerRef || source?.readerRef;
      const external = run.openExternal || source?.openExternal;
      if (isSefaria(run.href)) segment = '<a href="' + esc(run.href) + '"' + (readerRef ? ' data-reader-ref="' + esc(readerRef) + '"' : '') + (external ? ' data-source-external="true"' : '')`);
  replace(`&& window.AkivaSourceConnections?.sourceRefFromUrl(sourceAnchor.getAttribute('href'));`,`&& !sourceAnchor.hasAttribute('data-source-external')
      && (sourceAnchor.dataset.readerRef || window.AkivaSourceConnections?.sourceRefFromUrl(sourceAnchor.getAttribute('href')));`);
  replace(`{note:l.note || '', kind:l.kind || ''}`,`{note:l.note || '', kind:l.kind || '', canonicalRef:l.canonicalRef || '', sourceUrl:l.sourceUrl || ''}`);
  replace(`openSourceStudy(cite.dataset.ref, sourceContext(cite));`,`const target = readerCitationTarget(cite.dataset.ref, cite);
      if (target.openExternal) window.open(target.sourceUrl, '_blank', 'noopener');
      else openSourceStudy(target.ref, sourceContext(cite), target.sourceUrl);`);
  replace(`function footnoteSourceQuote(anchor) {`,`function readerCitationTarget(ref, element) {
  const seg = element?.closest('.seg');
  if (!seg?.dataset.ref?.startsWith('Tzidkat HaTzadik ')) return {ref, sourceUrl:''};
  const section = R.sections.find(item => item.sectionRef === seg.closest('.sec')?.dataset.ref);
  const matches = (section?.annotations?.[Number(seg.dataset.k)] || []).flatMap(note => note.sources || [])
    .filter(source => (source.readerRef || source.openExternal)
      && sourceConnections.normalizeRef(source.ref) === sourceConnections.normalizeRef(ref));
  const unique = new Map(matches.map(source => [(source.readerRef || '') + '|' + (source.openExternal ? source.url : ''), source]));
  if (unique.size !== 1) return {ref, sourceUrl:''};
  const source = [...unique.values()][0];
  return {ref:source.readerRef || source.ref, sourceUrl:source.url, openExternal:source.openExternal === true};
}
function footnoteSourceQuote(anchor) {`);
  return html;
}
export function attributionCacheBranch(pack,packSha256){const revision=pack.release+'-'+packSha256.slice(0,12);return `/* Tzidkat source attribution */ (url.startsWith('data/tzidkat-hatzadik/') || url === 'data/files.json') ? url + '?attribution=${revision}' :\n`;}
function planReader(pack,packSha256){
  const htmlFile=path.join(root,'library/index.html'),marker='const editionDataUrl = url => ';let html=fs.readFileSync(htmlFile,'utf8');assert.equal(html.split(marker).length,2);const branch=attributionCacheBranch(pack,packSha256),existing=/\/\* Tzidkat source attribution \*\/ \(url\.startsWith\('data\/tzidkat-hatzadik\/'\) \|\| url === 'data\/files\.json'\) \? url \+ '\?attribution=[^']+' :\n/g;const matches=html.match(existing)||[];assert(matches.length<=1,'Duplicate attribution cache branch');if(matches.length){assert.equal(matches[0],branch,'Unexpected attribution cache release');}else html=html.replace(marker,marker+branch);
  const swFile=path.join(root,'library/sw.js');let sw=fs.readFileSync(swFile,'utf8');assert.equal((sw.match(/const SHELL = `[^`]+`;/g)||[]).length,1);const suffix='-tzidkat-source-attribution-'+packSha256.slice(0,12);sw=sw.replace(/const SHELL = `([^`]+)`;/,(whole,key)=>{const matches=key.match(/-tzidkat-source-attribution-[a-f0-9]{12}/g)||[];assert(matches.length<=1,'Duplicate attribution cache suffix');if(matches.length){assert.equal(matches[0],suffix,'Unexpected attribution cache suffix');return whole;}return 'const SHELL = `'+key+suffix+'`;';});return {htmlFile,html,swFile,sw};
}
function refreshReader(plan){
  fs.writeFileSync(plan.htmlFile,plan.html);fs.writeFileSync(plan.swFile,plan.sw);
}
function checkCache(pack,packSha256){const html=fs.readFileSync(path.join(root,'library/index.html'),'utf8'),branch=attributionCacheBranch(pack,packSha256);assert.equal(html.split(branch).length,2,'Attribution cache revision is absent or duplicated');const sw=fs.readFileSync(path.join(root,'library/sw.js'),'utf8');assert.equal(sw.split('-tzidkat-source-attribution-'+packSha256.slice(0,12)).length,2,'Attribution service worker revision is absent or duplicated');}
function publish(){
  const {pack,packSha256}=loadPack(),baseline=JSON.parse(fs.readFileSync(baselineFile));assert.equal(baseline.packSha256,packSha256);const hasReport=fs.existsSync(path.join(root,REPORT));assert(baseline.rebuild||!hasReport,'Attribution report already exists; use --rebuild for verified no-op');if(hasReport)reportIdentity(pack,packSha256);
  const state=checkTargetState(pack,{allowBefore:!hasReport,offline:true});if(!baseline.rebuild)assert.equal(state.before,pack.chapters.length,'Focused publication preimage changed');const readerPlan=planReader(pack,packSha256);
  // Validate all targets and both existing archives before the first site write.
  const current=inventory();for(const [name,info]of Object.entries(baseline.files))assert.equal(current[name]?.sha256,info.sha256,'Publication changed after capture: '+name);assert.deepEqual(Object.keys(current).sort(),Object.keys(baseline.files).sort(),'Publication file inventory changed after capture');
  for(const file of pack.chapters)if(digest(read(file.path))!==digest(file.after))write(file.path,file.after);
  updateMcp(pack);refreshReader(readerPlan);
  write(REPORT,{schemaVersion:1,release:pack.release,packSha256,changedChapters:pack.chapters.length,changedNativeNotes:pack.operations.length,addedNativeNotes:0,sourceEvidenceAssets:0,retainedEvidenceAssets:(pack.assets||[]).length,changedSupplementalNotes:0,operations:pack.operations,completeReview:true,auditSummary:pack.audit.summary,baselineArtifact:pack.baseline,rebuild:baseline.rebuild===true});
  write(LEDGER,pack.audit);console.log(JSON.stringify({ok:true,mode:'published',release:pack.release,changedChapters:pack.chapters.length,changedNativeNotes:pack.operations.length,...state}));
}
function manifest(entries){const names=Object.keys(entries).filter(n=>n.startsWith('data/')&&n!=='data/files.json').sort(),h=createHash('sha256');let bytes=0;for(const name of names){h.update(name.slice(5)).update('\0').update(entries[name]);bytes+=entries[name].length;}return {version:h.digest('hex').slice(0,16),bytes,files:names.map(n=>n.slice(5))};}
function offline(){
  const {pack}=loadPack(),require=createRequire(import.meta.url),{zipSync,unzipSync}=require(path.resolve(root,'library/vendor/fflate.min.js'));
  const baseline=JSON.parse(fs.readFileSync(baselineFile)),report=read(REPORT),data={};
  function walk(dir,prefix){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,item.name),n=prefix+item.name;if(item.isDirectory())walk(f,n+'/');else if(n!=='data/files.json')data[n]=fs.readFileSync(f);}}
  walk(path.join(root,'library/data'),'data/');const liveManifest=manifest(data);write('library/data/files.json',liveManifest);data['data/files.json']=jbytes(liveManifest);
  const results=[];for(const zipName of['library/downloads/rav-tzadok-library.zip','library/downloads/books/'+SLUG+'.zip']){
    const zipPath=path.join(root,zipName),raw=fs.readFileSync(zipPath);assert.equal(sha(raw),baseline.files[zipName]?.sha256,'Offline input is not exact current publication '+zipName);const old=unzipSync(raw),next={...old};
    for(const[name,bytes]of Object.entries(data))if(zipName.includes('/books/')?name.startsWith('data/'+SLUG+'/'):true)next[name]=bytes;
    // Retain every existing archive-only entry, including Pages-omitted .json files.
    if(!zipName.includes('/books/'))next['data/files.json']=jbytes(manifest(next));
    if((pack.ideaChanges||[]).length)next['connected-ideas/catalog.json']=fs.readFileSync(path.join(root,'library/connected-ideas/catalog.json'));
    const output=zipSync(next,{level:6});const check=unzipSync(output);assert.deepEqual(Object.keys(check).sort(),Object.keys(next).sort());for(const[name,bytes]of Object.entries(next))assert.equal(sha(check[name]),sha(bytes),'Offline archive mismatch '+name);for(const name of Object.keys(old))assert(Object.hasOwn(check,name),'Existing archive entry lost '+name);fs.writeFileSync(zipPath,output);results.push({path:zipName,bytes:output.length,sha256:sha(output),dataFiles:Object.keys(next).filter(n=>n.startsWith('data/')).length,archiveOnlyPreserved:Object.keys(old).filter(n=>n.startsWith('data/')&&!Object.hasOwn(data,n)).length});
  }
  const index=read('library/downloads/index.json');index.version=liveManifest.version;index.library.bytes=results[0].bytes;index.library.dataFiles=results[0].dataFiles;const book=index.books.find(b=>b.slug===SLUG);assert(book);book.bytes=results[1].bytes;book.dataFiles=results[1].dataFiles;write('library/downloads/index.json',index);
  const catalog=read('mcp-data/catalog.json');catalog.version=liveManifest.version;write('mcp-data/catalog.json',catalog);report.offline=results;write(REPORT,report);console.log(JSON.stringify({ok:true,offline:results,version:liveManifest.version}));
}
function allowed(name,pack){return pack.chapters.some(file=>file.path===name)||[REPORT,LEDGER,'library/index.html','library/sw.js','library/data/files.json','mcp-data/catalog.json','mcp-data/text/'+SLUG+'.json','library/downloads/index.json','library/downloads/rav-tzadok-library.zip','library/downloads/books/'+SLUG+'.zip'].includes(name);}
function finalSemantics(pack,packSha256){
  checkTargetState(pack,{offline:true});checkCache(pack,packSha256);const data={};function walk(dir,prefix){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,item.name),name=prefix+item.name;if(item.isDirectory())walk(f,name+'/');else if(name!=='data/files.json')data[name]=fs.readFileSync(f);}}walk(path.join(root,'library/data'),'data/');const expected=manifest(data),actual=read('library/data/files.json');assert.deepEqual(actual,expected,'Live data manifest is stale');const index=read('library/downloads/index.json');assert.equal(index.version,expected.version);assert.equal(read('mcp-data/catalog.json').version,expected.version);const report=read(REPORT);assert.equal(report.packSha256,packSha256);assert.deepEqual(report.operations,pack.operations);assert.equal(report.release,pack.release);assert(report.offline?.length===2,'Attribution offline verification is missing');for(const item of report.offline){const bytes=fs.readFileSync(path.join(root,item.path));assert.equal(sha(bytes),item.sha256,'Sealed offline bytes changed');assert.equal(bytes.length,item.bytes);const entry=item.path.includes('/books/')?index.books.find(book=>book.slug===SLUG):index.library;assert.equal(entry.bytes,item.bytes);assert.equal(entry.dataFiles,item.dataFiles);}return expected;
}
function reportIdentity(pack,packSha256){const report=read(REPORT);assert.equal(report.release,pack.release);assert.equal(report.packSha256,packSha256);assert.equal(report.completeReview,true);assert.deepEqual(report.operations,pack.operations);assert(report.verification?.ok&&report.changedFiles?.length,'Attribution publication is not sealed');assert.equal(report.verification.release,pack.release);assert.equal(report.verification.packSha256,packSha256);assert.deepEqual((report.offline||[]).map(item=>item.path).sort(),['library/downloads/books/'+SLUG+'.zip','library/downloads/rav-tzadok-library.zip'].sort());const seen=new Set();for(const file of report.changedFiles){assert(allowed(file.path,pack)&&!seen.has(file.path),'Unexpected or repeated attribution seal path');seen.add(file.path);assert.match(file.sha256,/^[a-f0-9]{64}$/);assert(Number.isSafeInteger(file.bytes)&&file.bytes>=0);}return report;}
function verifyReportSeal(pack,packSha256){const report=reportIdentity(pack,packSha256);for(const file of report.changedFiles)if(file.path!==REPORT){const bytes=fs.readFileSync(path.join(root,file.path));assert.equal(sha(bytes),file.sha256,'Sealed attribution file changed '+file.path);assert.equal(bytes.length,file.bytes);}return report;}
function verify(seal=false){
  const {pack,packSha256}=loadPack(),baseline=JSON.parse(fs.readFileSync(baselineFile)),current=inventory(),report=read(REPORT);assert.equal(baseline.packSha256,packSha256);assert.equal(report.packSha256,packSha256);finalSemantics(pack,packSha256);const changed=[];
  for(const[name,info]of Object.entries(baseline.files)){assert(current[name],'Published file disappeared '+name);if(current[name].sha256!==info.sha256){assert(allowed(name,pack),'Unrelated publication file changed '+name);changed.push({path:name,...current[name]});}}for(const[name,info]of Object.entries(current))if(!baseline.files[name]){assert(allowed(name,pack),'Unexpected published file '+name);changed.push({path:name,...info});}
  for(let i=0;i<264;i++){const name=chapterPath(i);assert.equal(digest(authorProjection(read(name))),baseline.chapterAuthorHashes[name],'Canonical text changed '+name);}const numbers=Array.from({length:264},(_,i)=>notesOf(read(chapterPath(i))).map(({note})=>identity(note))).flat();checkIdentities(baseline.nativeNoteIdentities,numbers,[],'all published notes');
  const mcp=read('mcp-data/text/'+SLUG+'.json'),sections=new Set(pack.chapters.map(file=>sectionFor(file.path)));assert.deepEqual(mcp.paras.map(p=>[p.r,p.p||p.t]),baseline.protectedBookText,'MCP author words changed');assert.equal(digest({...mcp,paras:mcp.paras.filter(p=>![...sections].some(section=>p.r.startsWith(section+':')))}),baseline.mcpOutsideTargetsSha256,'Unrelated MCP paragraphs changed');
  const result={ok:true,release:pack.release,packSha256,protectedFiles:Object.keys(baseline.files).length-changed.length,changedFiles:changed.length,nativePlacements:numbers.length,supplementalRecords:baseline.ideas.length,all264AuthorTextsPreserved:true,allNativeAndSupplementalNumbersPreserved:true,allMarkersPreserved:true,canonicalSourceLabelsOnly:true};
  if(seal){report.changedFiles=changed;report.verification=result;write(REPORT,report);}else verifyReportSeal(pack,packSha256);console.log(JSON.stringify(result));return {changed,result};
}
function rebuild(){
  const {pack,packSha256}=loadPack();if(fs.existsSync(path.join(root,REPORT))){reportIdentity(pack,packSha256);checkTargetState(pack,{offline:true});checkCache(pack,packSha256);let unchanged=false;try{finalSemantics(pack,packSha256);verifyReportSeal(pack,packSha256);unchanged=true;}catch(error){console.log('Refreshing the attribution seal against this build after exact target-state verification: '+error.message);}if(unchanged){console.log(JSON.stringify({ok:true,mode:'already-applied',release:pack.release,siteBytesWritten:0}));return;}}
  capture(true);publish();offline();verify(true);console.log(JSON.stringify({ok:true,mode:'rebuilt',release:pack.release,operations:pack.operations.length}));
}
async function github(route){const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;const r=await fetch('https://api.github.com/repos/'+REPO+route,{headers,signal:AbortSignal.timeout(30000)});assert(r.ok,'GitHub metadata '+r.status+' '+route);return r.json();}
async function liveBytes(name){const url=new URL(name,SITE);url.searchParams.set('tzidkat-source-accuracy',String(Date.now()));const r=await fetch(url,{cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(60000)});assert(r.ok,'Public file '+r.status+' '+name);return Buffer.from(await r.arrayBuffer());}
async function liveBaseline(){const {pack}=loadPack();if(process.env.GITHUB_SHA){assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.equal((await github('/git/ref/heads/main')).object.sha,process.env.GITHUB_SHA,'Main advanced: preserve the intervening publication');}for(const[name,hash]of Object.entries(pack.baseline.pins))assert.equal(sha(await liveBytes(name)),hash,'Live publication changed '+name);console.log('Exact current live publication verified.');}
async function metadata(){const {pack}=loadPack();assert.equal(pack.audit.completeReview,true,'Publication requires the complete sealed source review');const p=pack.baseline,[artifact,run]=await Promise.all([github('/actions/artifacts/'+p.artifactId),github('/actions/runs/'+p.runId)]);assert.equal(artifact.expired,false);assert.equal(artifact.name,'github-pages');assert.equal(artifact.size_in_bytes,p.bytes);assert.equal(artifact.digest,p.digest);assert.equal(artifact.workflow_run.head_sha,p.commit);assert.equal(artifact.workflow_run.id,p.runId);assert.equal(run.head_sha,p.commit);assert.equal(run.conclusion,'success');await liveBaseline();fs.writeFileSync('tzidkat-source-attribution-artifact.json',jbytes({artifact,run:{id:run.id,head_sha:run.head_sha,conclusion:run.conclusion}}));}
async function live(){const {pack,packSha256}=loadPack();finalSemantics(pack,packSha256);const report=verifyReportSeal(pack,packSha256);for(const file of report.changedFiles){if(file.path===REPORT)continue;assert.equal(sha(await liveBytes(file.path)),file.sha256,'Published file differs '+file.path);}assert.equal(sha(await liveBytes(REPORT)),sha(fs.readFileSync(path.join(root,REPORT))));fs.writeFileSync('tzidkat-source-attribution-live.json',jbytes({ok:true,release:report.release,verifiedFiles:report.changedFiles.length,verifiedAt:new Date().toISOString()}));console.log('All changed public files match the sealed release.');}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=argv[0]||'--prepare';if(mode==='--prepare'){const {pack,packSha256}=loadPack();assert.equal(pack.audit.completeReview,true,'Publication requires the complete sealed source review');console.log(JSON.stringify({ok:true,release:pack.release,packSha256,chapters:pack.chapters.length,ideas:(pack.ideaChanges||[]).length}));}
  else if(mode==='--metadata')await metadata();else if(mode==='--capture')capture();else if(mode==='--capture-rebuild')capture(true);else if(mode==='--rebuild')rebuild();else if(mode==='--publish')publish();else if(mode==='--offline')offline();else if(mode==='--seal')verify(true);else if(mode==='--verify')verify();else if(mode==='--live-baseline')await liveBaseline();else if(mode==='--live')await live();else throw Error('Unknown mode '+mode);
}

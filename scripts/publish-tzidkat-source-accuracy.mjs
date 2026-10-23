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
export const DEFAULT_PACK='sources/akiva/overlays/tzidkat-source-accuracy-20261023.json.gz';
export const DEFAULT_PREIMAGES='sources/akiva/overlays/tzidkat-source-accuracy-preimages-20261023.json.gz';
export const REPORT='library/tzidkat-source-accuracy-20261023.json';
const TARGET='Tzidkat HaTzadik ',SLUG='tzidkat-hatzadik';
const argv=process.argv.slice(2),option=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
const root=path.resolve(option('--root','dist')),packFile=option('--pack',DEFAULT_PACK),baselineFile=option('--baseline','tzidkat-source-accuracy-baseline.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const jbytes=value=>Buffer.from(JSON.stringify(value));
const digest=value=>sha(jbytes(value));
let plannedWrites=null;
const readBytes=name=>plannedWrites?.get(name)??fs.readFileSync(path.join(root,name));
const writeBytes=(name,value)=>{const bytes=Buffer.from(value);if(plannedWrites){plannedWrites.set(name,bytes);return;}const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,bytes);};
const read=name=>JSON.parse(readBytes(name));
const write=(name,value)=>writeBytes(name,jbytes(value));
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
  assert(note.sources?.length&&note.sources.every(s=>s.ref&&(s.url||s.citationOnly===true)),'Missing exact primary source citation '+note.placementId);
  for(const source of note.sources)if(source.citationOnly)assert(!source.url&&!source.readerRef&&!source.openExternal,'Citation-only source cannot create navigation '+note.placementId);
  for(const source of note.sources){assert(!source.readerRef||typeof source.readerRef==='string'&&/\s\d/.test(source.readerRef),'Invalid local source reference '+note.placementId);assert(!(source.readerRef&&source.openExternal),'Ambiguous source navigation '+note.placementId);}
  const q=excerpts(note);assert(q.length&&q.every(s=>s.ref&&/[א-ת]/.test(s.he||'')&&/[A-Za-z]/.test(s.en||'')),'Missing checked bilingual source excerpt '+note.placementId);
}
export function loadPack(filename=packFile){
  const bytes=fs.readFileSync(filename),pack=JSON.parse(bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes);assert.equal(pack.schemaVersion,1);assert.match(pack.release,/^\d{8}-tzidkat-source-accuracy-v\d+$/);
  const pin=pack.baseline;assert(pin&&/^[a-f0-9]{40}$/.test(pin.commit)&&Number.isSafeInteger(pin.runId)&&Number.isSafeInteger(pin.artifactId)&&Number.isSafeInteger(pin.bytes));assert.match(pin.digest,/^sha256:[a-f0-9]{64}$/);assert(Object.keys(pin.pins||{}).length>=3,'Pin current manifest, HTML and MCP catalog at minimum');
  assert(Array.isArray(pack.chapters)&&Array.isArray(pack.ideaChanges||[])&&Array.isArray(pack.linkChanges||[]));
  const names=new Set();for(const file of pack.chapters){assert.match(file.path,/^library\/data\/tzidkat-hatzadik\/\d+\.json$/);assert(+file.path.match(/\/(\d+)\.json$/)[1]<264);assert(!names.has(file.path));names.add(file.path);assert.match(file.beforeSha256,/^[a-f0-9]{64}$/);assert(Array.isArray(file.after));}
  assert(pack.chapters.length||(pack.ideaChanges||[]).length,'No reviewed corrections in package');
  assert(pack.audit&&Array.isArray(pack.audit.entries),'Missing source-review ledger');
  for(const item of pack.ideaChanges||[])assert(item.id&&item.after?.id===item.id&&/^[a-f0-9]{64}$/.test(item.beforeSha256));
  for(const item of pack.linkChanges||[])assert(item.sectionRef.startsWith(TARGET)&&Array.isArray(item.after)&&/^[a-f0-9]{64}$/.test(item.beforeSha256));
  assert(Array.isArray(pack.addedNotes||[])&&Array.isArray(pack.assets||[]));
  const addedIds=new Set(),addedNumbers=new Set(),addedSources=new Set();for(const n of pack.addedNotes||[]){assert(n.placementId&&n.sourceId&&Number.isSafeInteger(n.number)&&n.number>0&&/^Tzidkat HaTzadik \d+$/.test(n.sectionRef),'Malformed declared note addition');assert(!addedIds.has(n.placementId)&&!addedNumbers.has(n.number)&&!addedSources.has(n.sourceId),'Duplicate declared note addition');addedIds.add(n.placementId);addedNumbers.add(n.number);addedSources.add(n.sourceId);}
  const assets=new Set();for(const a of pack.assets||[]){assert.match(a.path,/^library\/data\/tzidkat-hatzadik\/source-evidence\/[A-Za-z0-9_-]+\.(pdf|png|jpg|jpeg|webp)$/);assert(!assets.has(a.path),'Duplicate evidence asset');assets.add(a.path);assert.match(a.sha256,/^[a-f0-9]{64}$/);assert.equal(sha(fs.readFileSync(assetFile(filename,a))),a.sha256,'Evidence asset differs '+a.path);}

  return {pack,packSha256:sha(bytes)};
}
function compareChapters(before,after,file,pack){
  assert.deepEqual(authorProjection(after),authorProjection(before),'Author text or editorial structure changed: '+file);
  checkIdentities(noteIdentities(before),noteIdentities(after),(pack.addedNotes||[]).filter(n=>n.sectionRef===sectionFor(file)),file);
  const prior=new Map(notesOf(before).map(({row,note})=>[note.placementId,{row,note}]));
  const changed=[];for(const row of rowsOf(after))for(const note of row.footnotes||[]){const old=prior.get(note.placementId);if(old&&digest(old.note)===digest(note)&&old.row===row.n)continue;validateNote(row,note);const entry=pack.audit.entries.find(e=>e.placementId===note.placementId);assert(entry?.status==='verified','Correction lacks a verified audit entry: '+note.placementId);assert(entry.sourceEvidence?.length&&entry.sourceEvidence.every(e=>e.ref&&e.url&&/[א-ת]/.test(e.he||'')&&/[A-Za-z]/.test(e.en||'')),'Correction lacks direct source evidence: '+note.placementId);changed.push({sectionRef:sectionFor(file),originRef:sectionFor(file)+':'+row.n,placementId:note.placementId,number:note.number,sourceId:note.sourceId,beforeParagraph:old?.row??null,paragraph:row.n,before:old?.note??null,after:note,addition:!old});}
  return changed;
}
function capture(){const {pack,packSha256}=loadPack();const files=inventory();const originalIdentities=Array.from({length:264},(_,i)=>notesOf(read(chapterPath(i))).map(({note})=>identity(note))).flat();checkIdentities(originalIdentities,projectedIdentities(pack),pack.addedNotes||[],'all Tzidkat notes');for(const a of pack.assets||[])assert(!files[a.path]||files[a.path].sha256===a.sha256,'Evidence asset would replace an existing file '+a.path);for(const n of pack.addedNotes||[])for(const r of read('library/connected-ideas/catalog.json').records){if(r.originRef?.startsWith(TARGET))assert.notEqual(n.number,r.footnoteNumber,'New number collides with supplemental note');if(r.targetRef?.startsWith(TARGET))assert.notEqual(n.number,r.reverseFootnoteNumber,'New number collides with reverse supplemental note');}for(const[name,hash]of Object.entries(pack.baseline.pins))assert.equal(files[name]?.sha256,hash,'Wrong live artifact '+name);for(const file of pack.chapters){assert.equal(files[file.path]?.sha256,file.beforeSha256,'Chapter changed since source review: '+file.path);compareChapters(read(file.path),file.after,file.path,pack);}fs.writeFileSync(baselineFile,jbytes({packSha256,files,protectedBookText:read('mcp-data/text/'+SLUG+'.json').paras.map(p=>[p.r,p.p||p.t]),chapterAuthorHashes:Object.fromEntries(Array.from({length:264},(_,i)=>[chapterPath(i),digest(authorProjection(read(chapterPath(i))))])),nativeNoteIdentities:Array.from({length:264},(_,i)=>notesOf(read(chapterPath(i))).map(({note})=>identity(note))).flat(),ideas:read('library/connected-ideas/catalog.json').records.map(r=>({id:r.id,originRef:r.originRef,targetRef:r.targetRef,footnoteNumber:r.footnoteNumber,reverseFootnoteNumber:r.reverseFootnoteNumber}))}));console.log('Captured exact complete current publication.');}
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
function updateMcp(pack,links,priorChapters){
  const name='mcp-data/text/'+SLUG+'.json',mcp=read(name),paras=new Map(mcp.paras.map(p=>[p.r,p]));
  const affected=new Set(pack.chapters.map(f=>sectionFor(f.path)));
  for(const file of pack.chapters)for(const row of rowsOf(file.after)){
    const ref=sectionFor(file.path)+':'+row.n,para=paras.get(ref);assert(para,'Missing MCP paragraph '+ref);assert.deepEqual(para.p,row.p.map(pair=>pair.map(plain)),'MCP author text differs '+ref);
    const old=priorChapters.find(f=>f.path===file.path).rows.find(p=>p.n===row.n),oldNumbers=new Set([...(old.footnotes||[]),...(row.footnotes||[])].map(n=>String(n.number)));
    const preserved=(para.f||[]).filter(f=>!oldNumbers.has(String(f[0])));
    const notes=(row.footnotes||[]).map(n=>{const sources=n.sources||[],locations=sources.flatMap(s=>isEvidenceAssetSource(s,pack)?['Source document: '+s.url]:s.readerRef?['Reader location: '+s.readerRef+'; original source citation: '+s.ref+' — '+s.url]:s.openExternal?['Original source: '+s.url]:[]);const sourceText=n.paragraphs.map(p=>plain(p.text)).concat(locations).join('\n');return[String(n.number),sourceText,n.phraseIndex,'h',n.heCharOffset];});
    if(preserved.length||notes.length)para.f=[...preserved,...notes];else delete para.f;
    const currentRefs=new Set((row.footnotes||[]).flatMap(n=>(n.sources||[]).filter(s=>localNavigationSource(s,pack)).map(readerRefOf))),replacedRefs=new Set((old.footnotes||[]).flatMap(n=>(n.sources||[]).map(readerRefOf)).filter(ref=>!currentRefs.has(ref)));
    const anchors={};row.p.forEach((pair,i)=>pair.forEach((text,side)=>{for(const match of text.matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g)){const target=decode(match[1]);if(replacedRefs.has(target))continue;anchors[target]??=[i,side?'e':'h',plain(text.slice(0,match.index)).length];}}));
    for(const n of row.footnotes||[])for(const s of n.sources||[])if(s.ref&&localNavigationSource(s,pack))anchors[readerRefOf(s)]??=['n',String(n.number)];
    if(Object.keys(anchors).length)para.a=anchors;else delete para.a;
    const citations=(links[sectionFor(file.path)]||[]).filter(e=>e.a===ref).map(e=>[e.r,e.c||'']);if(citations.length)para.c=citations;else delete para.c;
  }
  for(const section of (pack.linkChanges||[]).map(x=>x.sectionRef))if(!affected.has(section))for(const para of mcp.paras.filter(p=>p.r.startsWith(section+':'))){const c=(links[section]||[]).filter(e=>e.a===para.r).map(e=>[e.r,e.c||'']);if(c.length)para.c=c;else delete para.c;}
  write(name,mcp);
}
function updateIdeas(pack){if(!(pack.ideaChanges||[]).length)return;const file='library/connected-ideas/catalog.json',catalog=read(file);for(const change of pack.ideaChanges){const at=catalog.records.findIndex(r=>r.id===change.id);assert(at>=0,'Missing supplemental record '+change.id);const old=catalog.records[at],next=change.after;assert.equal(digest(old),change.beforeSha256,'Supplemental record changed '+change.id);assert(old.originRef.startsWith(TARGET),'Only forward Tzidkat records may be modified by this interface; reverse records need explicit scope review');for(const field of['id','footnoteNumber','reverseFootnoteNumber'])assert.equal(next[field],old[field],'Supplemental identity/number changed '+change.id);assert(next.originRef.startsWith(TARGET)&&next.reviewed===true);for(const field of['originHebrew','originEnglish','targetRef','targetHebrew','targetEnglish','explanation','translationProvenance'])assert(next[field]?.trim(),'Incomplete supplemental record '+field);catalog.records[at]=next;}catalog.contentSha256=digest(catalog.records);catalog.version=catalog.contentSha256.slice(0,16);catalog.accuracyReview=pack.release;write(file,catalog);}
function sourceNavigationHtml(html,pack){
  if(!pack.chapters.some(f=>notesOf(f.after).some(({note})=>(note.sources||[]).some(s=>s.readerRef||s.openExternal))))return html;
  const replace=(needle,replacement)=>{if(html.includes(replacement)){assert.equal(html.split(replacement).length,2,'Duplicate reviewed reader source navigation');return;}assert.equal(html.split(needle).length,2,'Reader source navigation baseline differs');html=html.replace(needle,replacement);};
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
function refreshReader(pack,packSha256,successor=null){
  const htmlFile='library/index.html',marker='const editionDataUrl = url => ';let html=readBytes(htmlFile).toString('utf8');assert.equal(html.split(marker).length,2);const revision=pack.release+'-'+packSha256.slice(0,12);
  const attribution=successor?`/* Tzidkat source attribution */ (url.startsWith('data/tzidkat-hatzadik/') || url === 'data/files.json') ? url + '?attribution=${successor.release}-${successor.packSha256.slice(0,12)}' :\n`:null;
  let preserveAttribution=false;if(html.includes('/* Tzidkat source attribution */')){assert(attribution&&html.includes(marker+attribution)&&html.split(attribution).length===2,'Unrecognized attribution cache hook');html=html.replace(marker+attribution,marker);preserveAttribution=true;}
  const insert=(needle,replacement,label)=>{if(html.includes(replacement)){assert.equal(html.split(replacement).length,2,'Duplicate '+label);return;}assert.equal(html.split(needle).length,2,'Reader baseline differs: '+label);html=html.replace(needle,replacement);};
  const accuracy=marker+`/* Tzidkat source accuracy */ (url.startsWith('data/tzidkat-hatzadik/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition=${revision}' :\n`;
  assert(!html.includes('/* Tzidkat source accuracy */')||html.includes(accuracy),'Unrecognized later accuracy cache hook');insert(marker,accuracy,'Tzidkat cache hook');
  if((pack.assets||[]).length){const allowed=(pack.assets||[]).flatMap(a=>[a.path,new URL(a.path,SITE).href]),needle='const safeFootnoteUrl = url => ',replacement=needle+'/* Reviewed source image witnesses */ '+JSON.stringify(allowed)+".includes(String(url || '')) || ";assert(!html.includes('/* Reviewed source image witnesses */')||html.includes(replacement),'Unrecognized source witness allowlist');insert(needle,replacement,'source witness allowlist');}
  html=sourceNavigationHtml(html,pack);
  if((pack.ideaChanges||[]).length){const needle="fetch('connected-ideas/catalog.json?v=' + connectedIdeas.VERSION)";insert(needle,`fetch('connected-ideas/catalog.json?v=' + connectedIdeas.VERSION + '&accuracy=${revision}')`,'connected ideas cache hook');}
  if(preserveAttribution)html=html.replace(marker,marker+attribution);writeBytes(htmlFile,html);const swFile='library/sw.js';let sw=readBytes(swFile).toString('utf8');assert.equal((sw.match(/const SHELL = `[^`]+`;/g)||[]).length,1);const suffix='-tzidkat-source-accuracy-'+packSha256.slice(0,12),attributionSuffix=successor?'-tzidkat-source-attribution-'+successor.packSha256.slice(0,12):null;let shell=sw.match(/const SHELL = `([^`]+)`;/)[1],preserveSuffix='';if(shell.includes('-tzidkat-source-attribution-')){assert(attributionSuffix&&shell.endsWith(attributionSuffix)&&shell.split(attributionSuffix).length===2,'Unrecognized attribution service worker revision');preserveSuffix=attributionSuffix;shell=shell.slice(0,-attributionSuffix.length);}assert(!shell.includes('-tzidkat-source-accuracy-')||shell.endsWith(suffix)&&shell.split(suffix).length===2,'Unrecognized or duplicated service worker revision');if(!shell.endsWith(suffix))shell+=suffix;sw=sw.replace(/const SHELL = `[^`]+`;/,`const SHELL = \`${shell}${preserveSuffix}\`;`);writeBytes(swFile,sw);
}
function publish(){
  const {pack,packSha256}=loadPack(),baseline=JSON.parse(fs.readFileSync(baselineFile));assert.equal(baseline.packSha256,packSha256);
  if(fs.existsSync(path.join(root,REPORT))){const r=read(REPORT);assert.equal(r.packSha256,packSha256,'A different source accuracy release exists');for(const f of pack.chapters)assert.equal(digest(read(f.path)),digest(f.after),'Applied chapter changed');console.log(JSON.stringify({ok:true,mode:'already-applied',release:pack.release}));return;}
  const previous=[],operations=[];for(const file of pack.chapters){const raw=fs.readFileSync(path.join(root,file.path));assert.equal(sha(raw),file.beforeSha256,'Chapter changed since review '+file.path);const before=JSON.parse(raw);operations.push(...compareChapters(before,file.after,file.path,pack));previous.push({path:file.path,rows:before});}
  // Complete all preimage checks before the first author-data write.
  const links=read('library/data/'+SLUG+'/links.json');for(const change of pack.linkChanges||[])assert.equal(digest(links[change.sectionRef]||[]),change.beforeSha256);
  const ideaRecords=read('library/connected-ideas/catalog.json').records;for(const change of pack.ideaChanges||[]){const old=ideaRecords.find(r=>r.id===change.id);assert(old&&digest(old)===change.beforeSha256,'Supplemental preimage changed before publication '+change.id);}
  for(const a of pack.assets||[]){const dest=path.join(root,a.path);assert(!fs.existsSync(dest)||sha(fs.readFileSync(dest))===a.sha256,'Evidence asset would overwrite existing file');}
  for(const file of pack.chapters)write(file.path,file.after);
  for(const a of pack.assets||[]){const dest=path.join(root,a.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(assetFile(packFile,a),dest);}
  const nextLinks=updateLinks(pack,previous);updateMcp(pack,nextLinks,previous);updateIdeas(pack);refreshReader(pack,packSha256);
  write(REPORT,{schemaVersion:1,release:pack.release,packSha256,changedChapters:pack.chapters.length,changedNativeNotes:operations.length,addedNativeNotes:operations.filter(o=>o.addition).length,sourceEvidenceAssets:(pack.assets||[]).length,changedSupplementalNotes:(pack.ideaChanges||[]).length,operations:operations.map(({before,after,...op})=>op),completeReview:pack.audit.completeReview===true,auditSummary:pack.audit.summary||null,baselineArtifact:pack.baseline});
  write('library/tzidkat-source-accuracy-ledger.json',pack.audit);
  console.log(JSON.stringify({ok:true,mode:'published',release:pack.release,changedChapters:pack.chapters.length,changedNativeNotes:operations.length,addedNativeNotes:operations.filter(o=>o.addition).length,sourceEvidenceAssets:(pack.assets||[]).length,changedSupplementalNotes:(pack.ideaChanges||[]).length}));
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
function allowed(name,pack){return (pack.assets||[]).some(a=>a.path===name)||pack.chapters.some(f=>f.path===name)||[REPORT,'library/tzidkat-source-accuracy-ledger.json','library/data/'+SLUG+'/links.json','library/index.html','library/sw.js','library/data/files.json','library/data/packs/sources.json','library/data/cited/index.json','mcp-data/catalog.json','mcp-data/cited.json','mcp-data/text/'+SLUG+'.json','library/downloads/index.json','library/downloads/rav-tzadok-library.zip','library/downloads/books/'+SLUG+'.zip'].includes(name)||(/^library\/data\/cited\/[^/]+\.json$/.test(name))||((pack.ideaChanges||[]).length&&name==='library/connected-ideas/catalog.json');}
function verify(seal=false){const {pack,packSha256}=loadPack(),baseline=JSON.parse(fs.readFileSync(baselineFile)),current=inventory(),report=read(REPORT);assert.equal(packSha256,report.packSha256);const changed=[];for(const[name,info]of Object.entries(baseline.files)){assert(current[name],'Published file disappeared '+name);if(current[name].sha256!==info.sha256){assert(allowed(name,pack),'Unrelated published file changed '+name);changed.push({path:name,...current[name]});}}for(const[name,info]of Object.entries(current))if(!baseline.files[name]){assert(allowed(name,pack),'Unexpected published file '+name);changed.push({path:name,...info});}
  for(let i=0;i<264;i++){const name=chapterPath(i);assert.equal(digest(authorProjection(read(name))),baseline.chapterAuthorHashes[name],'Canonical text changed '+name);}
  const numbers=Array.from({length:264},(_,i)=>notesOf(read(chapterPath(i))).map(({note})=>identity(note))).flat();checkIdentities(baseline.nativeNoteIdentities,numbers,baseline.pendingAdditions??pack.addedNotes??[],'all published notes');for(const a of pack.assets||[])assert.equal(current[a.path]?.sha256,a.sha256,'Published evidence asset differs '+a.path);
  assert.deepEqual(read('mcp-data/text/'+SLUG+'.json').paras.map(p=>[p.r,p.p||p.t]),baseline.protectedBookText,'MCP author words changed');
  const ideas=read('library/connected-ideas/catalog.json').records;for(const old of baseline.ideas){const now=ideas.find(r=>r.id===old.id);assert(now,'Existing supplemental footnote disappeared');assert.equal(now.footnoteNumber,old.footnoteNumber);assert.equal(now.reverseFootnoteNumber,old.reverseFootnoteNumber);}
  const result={ok:true,release:pack.release,packSha256,protectedFiles:Object.keys(baseline.files).length-changed.length,changedFiles:changed.length,nativePlacements:numbers.length,supplementalRecords:ideas.length,all264AuthorTextsPreserved:true,allNativeAndSupplementalNumbersPreserved:true};if(seal){report.changedFiles=changed;report.verification=result;write(REPORT,report);}else if(report.changedFiles){for(const f of report.changedFiles.filter(f=>f.path!==REPORT))assert.equal(current[f.path]?.sha256,f.sha256,'Sealed file changed '+f.path);}console.log(JSON.stringify(result));return {changed,result};}
async function github(route){const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;const r=await fetch('https://api.github.com/repos/'+REPO+route,{headers,signal:AbortSignal.timeout(30000)});assert(r.ok,'GitHub metadata '+r.status+' '+route);return r.json();}
async function liveBytes(name){const url=new URL(name,SITE);url.searchParams.set('tzidkat-source-accuracy',String(Date.now()));const r=await fetch(url,{cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(60000)});assert(r.ok,'Public file '+r.status+' '+name);return Buffer.from(await r.arrayBuffer());}
async function liveBaseline(){const {pack}=loadPack();if(process.env.GITHUB_SHA){assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.equal((await github('/git/ref/heads/main')).object.sha,process.env.GITHUB_SHA,'Main advanced: preserve the intervening publication');}for(const[name,hash]of Object.entries(pack.baseline.pins))assert.equal(sha(await liveBytes(name)),hash,'Live publication changed '+name);console.log('Exact current live publication verified.');}
async function metadata(){const {pack}=loadPack();assert.equal(pack.audit.completeReview,true,'Publication requires the complete sealed source review');const p=pack.baseline,[artifact,run]=await Promise.all([github('/actions/artifacts/'+p.artifactId),github('/actions/runs/'+p.runId)]);assert.equal(artifact.expired,false);assert.equal(artifact.name,'github-pages');assert.equal(artifact.size_in_bytes,p.bytes);assert.equal(artifact.digest,p.digest);assert.equal(artifact.workflow_run.head_sha,p.commit);assert.equal(artifact.workflow_run.id,p.runId);assert.equal(run.head_sha,p.commit);assert.equal(run.conclusion,'success');await liveBaseline();fs.writeFileSync('tzidkat-source-accuracy-artifact.json',jbytes({artifact,run:{id:run.id,head_sha:run.head_sha,conclusion:run.conclusion}}));}
async function verifySuccessor(){const {verifyTzidkatSourceAccuracySuccessor}=await import('./tzidkat-source-accuracy-successor.mjs');return verifyTzidkatSourceAccuracySuccessor({directory:root,packFile:path.resolve(packFile),attributionPackFile:path.resolve(option('--successor-pack','sources/akiva/overlays/tzidkat-source-attribution-20261023.json.gz'))});}
async function live(){
  if(argv.includes('--successor-pack')){const verified=await verifySuccessor(),files=[...verified.filesByPath.values(),...[REPORT,'library/tzidkat-source-attribution-20261023.json'].map(name=>({path:name,sha256:sha(fs.readFileSync(path.join(root,name)))}))];for(let at=0;at<files.length;at+=4)await Promise.all(files.slice(at,at+4).map(async file=>assert.equal(sha(await liveBytes(file.path)),file.sha256,'Terminal published file differs '+file.path)));fs.writeFileSync('tzidkat-source-accuracy-live.json',jbytes({ok:true,release:verified.report.release,successor:verified.attribution,verifiedFiles:files.length,verifiedAt:new Date().toISOString()}));console.log('All terminal successor files match their sealed release chain.');return;}
  const report=read(REPORT);assert(report.verification?.ok&&report.changedFiles?.length,'Publication must be sealed');for(const file of report.changedFiles){if(file.path===REPORT)continue;assert.equal(sha(await liveBytes(file.path)),file.sha256,'Published file differs '+file.path);}assert.equal(sha(await liveBytes(REPORT)),sha(fs.readFileSync(path.join(root,REPORT))));fs.writeFileSync('tzidkat-source-accuracy-live.json',jbytes({ok:true,release:report.release,verifiedFiles:report.changedFiles.length,verifiedAt:new Date().toISOString()}));console.log('All changed public files match the sealed release.');
}

// A rebuild uses this build's tree as its preservation boundary. Historical pins
// authenticate only the frozen per-target fixture, never the current whole site.
export function loadRebuildPreimages(pack,packSha256,filename=option('--preimages',DEFAULT_PREIMAGES)){
  const bytes=fs.readFileSync(filename),fixture=JSON.parse(gunzipSync(bytes));assert.equal(fixture.schemaVersion,1);assert.equal(fixture.packSha256,packSha256);
  assert.deepEqual(Object.keys(fixture.chapters).sort(),pack.chapters.map(f=>f.path).sort());
  assert.deepEqual(Object.keys(fixture.links).sort(),(pack.linkChanges||[]).map(f=>f.sectionRef).sort());
  assert.deepEqual(Object.keys(fixture.ideas).sort(),(pack.ideaChanges||[]).map(f=>f.id).sort());
  for(const f of pack.chapters)assert.equal(sha(fixture.chapters[f.path]),f.beforeSha256,'Unauthenticated chapter preimage '+f.path);
  for(const f of pack.linkChanges||[])assert.equal(digest(fixture.links[f.sectionRef]),f.beforeSha256,'Unauthenticated link preimage '+f.sectionRef);
  for(const f of pack.ideaChanges||[])assert.equal(digest(fixture.ideas[f.id]),f.beforeSha256,'Unauthenticated idea preimage '+f.id);
  for(const f of['library/index.html','library/sw.js'])assert.equal(sha(fixture[f]),pack.baseline.pins[f],'Unauthenticated renderer test fixture '+f);
  return fixture;
}
export function composeRebuildSuccessor(pack,packSha256){
  const filename=option('--successor-pack','');if(!filename)return {effective:pack,successor:null};
  const next=loadPack(filename);assert.equal(next.pack.audit.completeReview,true,'Successor source review is incomplete');assert.notEqual(next.packSha256,packSha256);
  assert.equal((next.pack.addedNotes||[]).length,0,'This explicitly reviewed successor may not renumber or add notes');
  const effective=structuredClone(pack),prior=new Map(pack.chapters.map(f=>[f.path,f]));
  for(const f of next.pack.chapters){const old=prior.get(f.path);assert(old,'Successor is outside the reviewed target scope '+f.path);assert.equal(f.beforeSha256,digest(old.after),'Successor chapter does not follow the reviewed release '+f.path);compareChapters(old.after,f.after,f.path,next.pack);effective.chapters.find(x=>x.path===f.path).after=f.after;}
  for(const f of next.pack.linkChanges||[]){const old=effective.linkChanges.find(x=>x.sectionRef===f.sectionRef);assert(old,'Successor citation scope is not explicitly covered '+f.sectionRef);assert.equal(f.beforeSha256,digest(old.after),'Successor citations do not follow the reviewed release');old.after=f.after;}
  assert.equal((next.pack.ideaChanges||[]).length,0,'Supplemental successor needs a separate explicit review');
  for(const f of next.pack.assets||[]){const old=effective.assets.find(x=>x.path===f.path);assert(old&&old.sha256===f.sha256,'New successor evidence assets require explicit scope');}
  return {effective,successor:{release:next.pack.release,packSha256:next.packSha256,packPath:filename,chapters:next.pack.chapters.map(f=>f.path)}};
}
function planOffline(pack){
  const require=createRequire(import.meta.url),{zipSync,unzipSync}=require(path.resolve(root,'library/vendor/fflate.min.js')),data={};
  const walk=(dir,prefix)=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,item.name),name=prefix+item.name;if(item.isDirectory())walk(f,name+'/');else if(name!=='data/files.json')data[name]=readBytes('library/'+name);}};
  walk(path.join(root,'library/data'),'data/');for(const[name,bytes]of plannedWrites)if(name.startsWith('library/data/')&&name!=='library/data/files.json')data[name.slice(8)]=bytes;
  const liveManifest=manifest(data);write('library/data/files.json',liveManifest);data['data/files.json']=jbytes(liveManifest);
  const results=[];for(const name of['library/downloads/rav-tzadok-library.zip','library/downloads/books/'+SLUG+'.zip']){
    const raw=fs.readFileSync(path.join(root,name)),old=unzipSync(raw),next={...old},book=name.includes('/books/');
    for(const[file,bytes]of Object.entries(data))if(!book||file.startsWith('data/'+SLUG+'/'))next[file]=bytes;
    if(!book)next['data/files.json']=jbytes(manifest(next));
    if((pack.ideaChanges||[]).length)next['connected-ideas/catalog.json']=readBytes('library/connected-ideas/catalog.json');
    const different=Object.keys(next).length!==Object.keys(old).length||Object.entries(next).some(([file,bytes])=>!old[file]||!Buffer.from(old[file]).equals(bytes));
    const output=different?Buffer.from(zipSync(next,{level:6})):raw;
    if(different){const check=unzipSync(output);assert.deepEqual(Object.keys(check).sort(),Object.keys(next).sort());for(const[file,bytes]of Object.entries(next))assert.equal(sha(check[file]),sha(bytes),'Offline archive differs '+file);writeBytes(name,output);}
    results.push({path:name,bytes:output.length,sha256:sha(output),dataFiles:Object.keys(next).filter(n=>n.startsWith('data/')).length,archiveOnlyPreserved:Object.keys(old).filter(n=>n.startsWith('data/')&&!Object.hasOwn(data,n)).length});
  }
  const index=read('library/downloads/index.json');index.version=liveManifest.version;index.library.bytes=results[0].bytes;index.library.dataFiles=results[0].dataFiles;const book=index.books.find(b=>b.slug===SLUG);assert(book);book.bytes=results[1].bytes;book.dataFiles=results[1].dataFiles;write('library/downloads/index.json',index);
  const catalog=read('mcp-data/catalog.json');catalog.version=liveManifest.version;write('mcp-data/catalog.json',catalog);return results;
}
function rebuild(){
  const {pack,packSha256}=loadPack(),fixture=loadRebuildPreimages(pack,packSha256),{effective,successor}=composeRebuildSuccessor(pack,packSha256);
  assert.equal(pack.audit.completeReview,true);const currentFiles=inventory(),currentIdeas=read('library/connected-ideas/catalog.json'),currentLinks=read('library/data/'+SLUG+'/links.json');
  const originalIdentities=Array.from({length:264},(_,i)=>notesOf(read(chapterPath(i))).map(({note})=>identity(note))).flat(),existingIds=new Set(originalIdentities.map(n=>n[0])),pendingAdditions=(pack.addedNotes||[]).filter(n=>!existingIds.has(n.placementId));
  assert.equal(new Set(originalIdentities.map(n=>n[2])).size,originalIdentities.length,'Duplicate current native footnote number');
  for(const n of pack.addedNotes||[])for(const r of currentIdeas.records){if(r.originRef?.startsWith(TARGET))assert.notEqual(n.number,r.footnoteNumber,'Reviewed native number collides with a supplemental note');if(r.targetRef?.startsWith(TARGET))assert.notEqual(n.number,r.reverseFootnoteNumber,'Reviewed native number collides with a reverse supplemental note');}
  const beforeChapters=pack.chapters.map(f=>({path:f.path,rows:JSON.parse(fixture.chapters[f.path])})),operations=beforeChapters.flatMap(f=>compareChapters(f.rows,pack.chapters.find(x=>x.path===f.path).after,f.path,pack)).map(({before,after,...op})=>op);
  const states={chapters:{},links:{},ideas:{}};
  // No site writes occur until every target, renderer, asset and derived archive
  // has been planned and checked. Unknown subsequent edits are never overwritten.
  for(const f of effective.chapters){const now=read(f.path),original=pack.chapters.find(x=>x.path===f.path),before=JSON.parse(fixture.chapters[f.path]),hash=digest(now);const state=hash===digest(f.after)?'after':hash===digest(original.after)?'reviewed-before-successor':hash===digest(before)?'before':null;assert(state,'Unrecognized later Tzidkat chapter edit: '+f.path);states.chapters[f.path]=state;}
  for(const f of effective.linkChanges||[]){const now=currentLinks[f.sectionRef]||[],original=pack.linkChanges.find(x=>x.sectionRef===f.sectionRef),hash=digest(now);const state=hash===digest(f.after)?'after':hash===digest(original.after)?'reviewed-before-successor':hash===original.beforeSha256?'before':null;assert(state,'Unrecognized later Tzidkat citation edit: '+f.sectionRef);states.links[f.sectionRef]=state;}
  for(const f of pack.ideaChanges||[]){const now=currentIdeas.records.find(r=>r.id===f.id),hash=now&&digest(now),state=hash===digest(f.after)?'after':hash===f.beforeSha256?'before':null;assert(state,'Unrecognized later supplemental edit: '+f.id);states.ideas[f.id]=state;}
  for(const a of pack.assets||[])assert(!currentFiles[a.path]||currentFiles[a.path].sha256===a.sha256,'Unrecognized source asset edit: '+a.path);
  checkIdentities(originalIdentities,projectedIdentities(effective),pendingAdditions,'rebuild target identities');
  const baseline={mode:'target-preimages-rebuild-v1',packSha256,files:currentFiles,pendingAdditions,protectedBookText:read('mcp-data/text/'+SLUG+'.json').paras.map(p=>[p.r,p.p||p.t]),chapterAuthorHashes:Object.fromEntries(Array.from({length:264},(_,i)=>[chapterPath(i),digest(authorProjection(read(chapterPath(i))))])),nativeNoteIdentities:originalIdentities,ideas:currentIdeas.records.map(r=>({id:r.id,originRef:r.originRef,targetRef:r.targetRef,footnoteNumber:r.footnoteNumber,reverseFootnoteNumber:r.reverseFootnoteNumber})),states,successor};
  const priorReport=currentFiles[REPORT]?read(REPORT):null;
  if(priorReport){assert.equal(priorReport.packSha256,packSha256,'Unrecognized accuracy release report');assert.deepEqual(priorReport.operations,operations,'Accuracy report operation identities changed');}
  const terminalReportPath='library/tzidkat-source-attribution-20261023.json',terminalReport=successor&&currentFiles[terminalReportPath]?read(terminalReportPath):null;
  if(terminalReport)assert.equal(terminalReport.packSha256,successor.packSha256,'Unrecognized terminal attribution report');
  const ledger='library/tzidkat-source-accuracy-ledger.json';if(currentFiles[ledger])assert.equal(digest(read(ledger)),digest(pack.audit),'Unrecognized later source audit ledger');
  plannedWrites=new Map();try{
    for(const f of effective.chapters)write(f.path,f.after);
    for(const a of pack.assets||[])writeBytes(a.path,fs.readFileSync(assetFile(packFile,a)));
    const linkedPack={...effective,linkChanges:effective.linkChanges.map(f=>({...f,beforeSha256:digest(currentLinks[f.sectionRef]||[])}))};
    const links=updateLinks(linkedPack,beforeChapters);updateMcp(effective,links,beforeChapters);
    const ideasPack={...pack,ideaChanges:(pack.ideaChanges||[]).map(f=>({...f,beforeSha256:digest(currentIdeas.records.find(r=>r.id===f.id))}))};updateIdeas(ideasPack);
    refreshReader(pack,packSha256,successor);write(ledger,pack.audit);const offline=planOffline(pack);
    for(const f of effective.chapters)assert.equal(digest(read(f.path)),digest(f.after));
    const numbers=Array.from({length:264},(_,i)=>notesOf(read(chapterPath(i))).map(({note})=>identity(note))).flat();checkIdentities(originalIdentities,numbers,pendingAdditions,'all rebuilt notes');
    for(let i=0;i<264;i++){const name=chapterPath(i);assert.equal(digest(authorProjection(read(name))),baseline.chapterAuthorHashes[name],'Rebuild changed canonical author text '+name);}
    assert.deepEqual(read('mcp-data/text/'+SLUG+'.json').paras.map(p=>[p.r,p.p||p.t]),baseline.protectedBookText,'Rebuild changed MCP author words');
    const changes=()=>[...plannedWrites].filter(([name,bytes])=>!currentFiles[name]||currentFiles[name].sha256!==sha(bytes));
    const projectedHash=name=>plannedWrites.has(name)?sha(plannedWrites.get(name)):currentFiles[name]?.sha256;
    const terminalFiles=new Map((terminalReport?.changedFiles||[]).map(f=>[f.path,f]));
    const terminalSealValid=terminalReport?.completeReview===true&&terminalReport.verification?.ok===true&&terminalReport.verification?.packSha256===successor?.packSha256&&terminalReport.verification?.release===successor?.release&&terminalFiles.size>0&&[...terminalFiles.values()].every(f=>f.path===terminalReportPath||projectedHash(f.path)===f.sha256);
    const staleSeal=priorReport?.changedFiles?.some(f=>f.path!==REPORT&&projectedHash(f.path)!==(terminalSealValid?terminalFiles.get(f.path)?.sha256??f.sha256:f.sha256));
    const requiredSealPaths=[...effective.chapters.map(f=>f.path),...(pack.assets||[]).map(f=>f.path),'library/data/'+SLUG+'/links.json','library/data/packs/sources.json','library/data/cited/index.json','mcp-data/text/'+SLUG+'.json','mcp-data/catalog.json','mcp-data/cited.json','library/connected-ideas/catalog.json','library/index.html','library/sw.js','library/data/files.json','library/downloads/index.json','library/downloads/rav-tzadok-library.zip','library/downloads/books/'+SLUG+'.zip',ledger];
    const sealedPaths=new Set((priorReport?.changedFiles||[]).map(f=>f.path));
    const incompleteSeal=!priorReport?.completeReview||priorReport.verification?.ok!==true||priorReport.verification?.packSha256!==packSha256||priorReport.verification?.release!==pack.release||requiredSealPaths.some(name=>!sealedPaths.has(name));
    const needsReport=!priorReport||changes().length>0||staleSeal||incompleteSeal||successor&&!terminalSealValid&&priorReport.successor?.packSha256!==successor.packSha256;
    if(needsReport){
      const report={...(priorReport||{}),schemaVersion:1,release:pack.release,packSha256,changedChapters:pack.chapters.length,changedNativeNotes:operations.length,addedNativeNotes:operations.filter(o=>o.addition).length,sourceEvidenceAssets:(pack.assets||[]).length,changedSupplementalNotes:(pack.ideaChanges||[]).length,operations,completeReview:true,auditSummary:pack.audit.summary||null,baselineArtifact:pack.baseline,offline,rebuild:{scope:'target-preimages-v1',currentTreeSha256:digest(currentFiles),recognizedChapters:Object.values(states.chapters).reduce((out,state)=>(out[state]=(out[state]||0)+1,out),{}),predecessorIdeasSha256:currentFiles['library/connected-ideas/catalog.json'].sha256}};
      if(successor)report.successor=successor;
      const paths=new Set([...(priorReport?.changedFiles||[]).map(f=>f.path),...requiredSealPaths,...changes().map(([name])=>name),REPORT]);
      report.changedFiles=[...paths].sort().map(name=>({path:name,sha256:projectedHash(name)||sha(jbytes(report)),bytes:plannedWrites.get(name)?.length??currentFiles[name]?.bytes??0}));
      report.verification={ok:true,release:pack.release,packSha256,protectedFiles:Object.keys(currentFiles).length-changes().length,changedFiles:report.changedFiles.length,nativePlacements:numbers.length,supplementalRecords:read('library/connected-ideas/catalog.json').records.length,all264AuthorTextsPreserved:true,allNativeAndSupplementalNumbersPreserved:true,rebuildScope:'target-preimages-v1'};write(REPORT,report);
    }
    const actual=changes();for(const[name]of actual)assert(allowed(name,pack),'Unrelated rebuild output planned: '+name);
    // Persist the capture outside the published tree only after all preflight checks.
    fs.writeFileSync(baselineFile,jbytes(baseline));
    const result={ok:true,mode:actual.length?'rebuilt':'already-applied',release:pack.release,packSha256,successor:successor?.packSha256??null,plannedFiles:actual.length,protectedFiles:Object.keys(currentFiles).length-actual.filter(([name])=>currentFiles[name]).length,operations:operations.length,pendingAdditions:pendingAdditions.length,recognizedChapters:states.chapters};
    if(!argv.includes('--check-only'))for(const[name,bytes]of actual){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
    fs.writeFileSync(option('--rebuild-receipt','tzidkat-source-accuracy-rebuild.json'),jbytes(result));console.log(JSON.stringify({...result,recognizedChapters:Object.values(states.chapters).reduce((out,state)=>(out[state]=(out[state]||0)+1,out),{})}));return result;
  }finally{plannedWrites=null;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=argv[0]||'--prepare';if(mode==='--prepare'){const {pack,packSha256}=loadPack();assert.equal(pack.audit.completeReview,true,'Publication requires the complete sealed source review');console.log(JSON.stringify({ok:true,release:pack.release,packSha256,chapters:pack.chapters.length,ideas:(pack.ideaChanges||[]).length}));}
  else if(mode==='--verify-successor')console.log(JSON.stringify((await verifySuccessor()).proof));else if(mode==='--rebuild')rebuild();else if(mode==='--metadata')await metadata();else if(mode==='--capture')capture();else if(mode==='--publish')publish();else if(mode==='--offline')offline();else if(mode==='--seal')verify(true);else if(mode==='--verify')verify();else if(mode==='--live-baseline')await liveBaseline();else if(mode==='--live')await live();else throw Error('Unknown mode '+mode);
}

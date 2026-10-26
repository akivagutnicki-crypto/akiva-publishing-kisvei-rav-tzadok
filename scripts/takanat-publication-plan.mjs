// Plan an exact Takanat successor against a complete, current Pages artifact.
// This module has no file-writing or network side effects.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {BOOK,TITLE,RELEASE,REPORT,sha,json,plain,projectRows} from './takanat-review-core.mjs';
import {categoryOf} from './citations.mjs';
import {local,read,fileInfo,info,sourceSlug} from './pri-parsha-review-core.mjs';
import {computeTakanatParallels} from './takanat-parallels.mjs';

export const LINKS='library/data/'+BOOK+'/links.json',MCP='mcp-data/text/'+BOOK+'.json';
export const ARCHIVES=['library/downloads/rav-tzadok-library.zip','library/downloads/books/'+BOOK+'.zip'];
const CONNECTED='library/connected-ideas/catalog.json',TOC='library/data/'+BOOK+'/toc.json';
const canonical=value=>JSON.stringify(value,(_,item)=>item&&!Array.isArray(item)&&typeof item==='object'?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const content=p=>p.p?p.p.map(pair=>pair[0]).join(' '):p.t||'';
const edgeKey=e=>JSON.stringify([e.a,e.r]);

export function dataManifest(entries){
 const files=Object.keys(entries).filter(n=>n.startsWith('data/')&&n!=='data/files.json').sort(),hash=createHash('sha256');let bytes=0;
 for(const name of files){hash.update(name.slice(5)).update('\0').update(entries[name]);bytes+=entries[name].length;}
 return{version:hash.digest('hex').slice(0,16),bytes,files:files.map(n=>n.slice(5))};
}
function dataEntries(directory){const out={};const walk=(dir,prefix)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){assert(!e.isSymbolicLink());const f=path.join(dir,e.name),key=prefix+e.name;if(e.isDirectory())walk(f,key+'/');else out[key]=fs.readFileSync(f);}};walk(local(directory,'library/data'),'data/');return out;}

export function sectionEdges(section,which='after'){
 const edges=[];for(const row of section[which]){if(!row.p)continue;const refs=new Set();for(const pair of row.p)for(const value of pair)for(const m of String(value).matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g))refs.add(plain(m[1]));
  for(const source of row.connections||[])if(source.ref)refs.add(source.readerRef||source.ref);
  for(const note of row.footnotes||[])for(const source of note.sources||[])if(source.ref&&!source.citationOnly&&!source.openExternal)refs.add(source.readerRef||source.ref);
  const origin=section.sectionRef+(section.id?':':' ')+row.n;for(const ref of refs)edges.push({a:origin,r:ref,c:categoryOf(ref)});
 }return edges;
}

// Remap only an already-reviewed, unchanged quotation, uniquely in the same
// stable paragraph. The old pins must match the exact publication preimage.
export function remapConnectedCatalog(directory,beforeMcp,afterMcp,beforeBook,afterBook,{revisions=[]}={}){
 const original=read(directory,CONNECTED),catalog=structuredClone(original),require=createRequire(import.meta.url);
 const normalize=require(local(directory,'library/source-connections.js')).normalizedHebrew;
 const changed=[],failures=[];
 function anchor(data,book,ref,quote){
  const matches=data.paras.map((p,i)=>({p,i})).filter(x=>x.p.r===ref);assert.equal(matches.length,1,'Stable paragraph is not unique: '+ref);const{p,i}=matches[0],section=book.sections[p.s];assert(section);
  const full=normalize(content(p)),selected=normalize(quote),hay=' '+full+' ',needle=' '+selected+' ',start=hay.indexOf(needle);assert(selected&&start>=0&&start===hay.lastIndexOf(needle),'Reviewed quotation no longer matches uniquely: '+ref);
  let cursor=0,first=-1,last=-1;for(const[pairIndex,pair]of(p.p||[[p.t,'']]).entries()){const length=normalize(pair[0]).length;if(!length)continue;if(start>=cursor&&start<cursor+length)first=pairIndex;if(start+selected.length>cursor&&start+selected.length<=cursor+length)last=pairIndex;cursor+=length+1;}
  assert(first>=0&&last>=first,'Exact quotation phrase boundaries unavailable: '+ref);
  const sectionText=data.paras.slice(section.first,section.first+section.count).map(content).join(' ');
  return{section,paragraph:p,phraseIndex:first,phraseEnd:last,paragraphOrder:i-section.first,quoteStart:start,paragraphPin:sha(full),sectionPin:sha(normalize(sectionText))};
 }
 for(const record of catalog.records||[])for(const side of ['origin','target']){
  const ref=record[side+'Ref'];if(!ref?.startsWith(TITLE+' ')&&!ref?.startsWith(TITLE+','))continue;
  try{
   let old,next;try{old=anchor(beforeMcp,beforeBook,ref,record[side+'Hebrew']);}catch(error){throw new Error('Existing publication: '+error.message);}
   const revisionsHere=revisions.filter(r=>r.id===record.id&&r.side===side);assert(revisionsHere.length<=1,'Duplicate reviewed conceptual-quotation revision');const revision=revisionsHere[0];
   if(revision){assert(revision.reviewed===true&&revision.reason&&Array.isArray(revision.evidence)&&revision.evidence.length,'Quotation revision lacks scholarly review');assert.equal(record[side+'Hebrew'],revision.before.he);assert.equal(record[side+'English'],revision.before.en);assert(/[א-ת]/.test(revision.after.he)&&/[A-Za-z]/.test(revision.after.en));record[side+'Hebrew']=revision.after.he;record[side+'English']=revision.after.en;}
   try{next=anchor(afterMcp,afterBook,ref,record[side+'Hebrew']);}catch(error){throw new Error('Restored publication: '+error.message);}
   const capital=side[0].toUpperCase()+side.slice(1),paragraphKey='reviewed'+capital+'HebrewSha256',sectionKey='reviewed'+capital+'SectionHebrewSha256';
   assert.equal(record[paragraphKey],old.paragraphPin,'Existing reviewed paragraph pin is stale: '+record.id+' '+side);
   if(record[sectionKey])assert.equal(record[sectionKey],old.sectionPin,'Existing reviewed section pin is stale: '+record.id+' '+side);
   const before={pin:record[paragraphKey],sectionPin:record[sectionKey],phraseIndex:record.placement[side+'PhraseIndex'],phraseEnd:record.placement[side+'PhraseEnd'],paragraphOrder:record.placement[side+'ParagraphOrder']};
   record[paragraphKey]=next.paragraphPin;if(record[sectionKey])record[sectionKey]=next.sectionPin;
   Object.assign(record.placement,{[side+'SectionRef']:next.section.ref,[side+'PhraseIndex']:next.phraseIndex,[side+'PhraseEnd']:next.phraseEnd,[side+'ParagraphOrder']:next.paragraphOrder});
   if(record.evidence?.[side])Object.assign(record.evidence[side],{textSha256:sha(json(afterMcp)),paragraphSha256:sha(canonical(next.paragraph)),fullHebrewSha256:next.paragraphPin,sectionHebrewSha256:next.sectionPin,quoteStart:next.quoteStart});
   if(record.evidence&&revision){record.evidence[side+'EnglishSha256']=sha(record[side+'English']);record.evidence.takanatScholarlyQuotationRevisions=[...(record.evidence.takanatScholarlyQuotationRevisions||[]),{release:RELEASE,side,reason:revision.reason,evidence:revision.evidence,hebrewSha256:sha(revision.after.he),englishSha256:sha(revision.after.en)}];}
   const after={pin:record[paragraphKey],sectionPin:record[sectionKey],phraseIndex:record.placement[side+'PhraseIndex'],phraseEnd:record.placement[side+'PhraseEnd'],paragraphOrder:record.placement[side+'ParagraphOrder']};
   changed.push({id:record.id,side,ref,quotationSha256:sha(record[side+'Hebrew']),quotationUnchanged:!revision,scholarlyRevision:revision||undefined,uniqueExactNormalizedMatch:true,before,after});
  }catch(error){failures.push({id:record.id,side,ref,error:error.message});}
 }
 assert.equal(failures.length,0,'Connected quotation remapping requires review: '+JSON.stringify(failures));
 assert.equal(revisions.length,changed.filter(r=>r.scholarlyRevision).length,'Unused conceptual-quotation revision');
 if(changed.length){catalog.takanatTextRemapping={release:RELEASE,unchangedReviewedQuotations:!revisions.length,records:changed};catalog.contentSha256=sha(canonical({release:catalog.release,records:catalog.records,coverage:catalog.coverage,provenance:catalog.provenance,takanatTextRemapping:catalog.takanatTextRemapping}));catalog.version=catalog.release+'-'+catalog.contentSha256.slice(0,16);}
 return{catalog,remapping:changed};
}

export function planPublication(directory,prepared,{parallelComputer=computeTakanatParallels}={}){
 const{pack}=prepared;assert.equal(pack.sections.length,16);const changes=new Map();
 const allowed=name=>pack.sections.some(s=>s.path===name)||/^library\/data\/cited\/[^/]+\.json$/.test(name)||[LINKS,MCP,TOC,CONNECTED,'mcp-data/cited.json','mcp-data/catalog.json','library/data/catalog.json','library/data/packs/sources.json','library/data/files.json','library/data/parallels/'+BOOK+'.json','library/data/parallels/words.json','library/downloads/index.json','library/index.html','library/sw.js',...ARCHIVES].includes(name);
 const put=(name,value)=>{assert(allowed(name),'Outside reviewed publication scope: '+name);const bytes=value instanceof Uint8Array?Buffer.from(value):json(value),file=local(directory,name);if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==sha(bytes))changes.set(name,bytes);};
 for(const s of pack.sections){assert.deepEqual(read(directory,s.path),s.before,'Reviewed chapter preimage changed: '+s.path);put(s.path,s.after);}
 const links=read(directory,LINKS),beforeLinks=structuredClone(links);
 for(const section of pack.sections){
  assert.deepEqual(new Set((links[section.sectionRef]||[]).map(edgeKey)),new Set(sectionEdges(section,'before').map(edgeKey)),'Baseline citation index does not describe exact chapter: '+section.sectionRef);
  links[section.sectionRef]=sectionEdges(section);
 }put(LINKS,links);
 const beforeEdges=new Map(Object.values(beforeLinks).flat().map(e=>[edgeKey(e),e])),afterEdges=new Map(Object.values(links).flat().map(e=>[edgeKey(e),e]));
 const removed=[...beforeEdges].filter(([key])=>!afterEdges.has(key)).map(([,e])=>e),added=[...afterEdges].filter(([key])=>!beforeEdges.has(key)).map(([,e])=>e),reverse=read(directory,'mcp-data/cited.json'),reverseFiles=new Map();
 const reverseFile=ref=>{const slug=sourceSlug(ref);assert(slug);const name='library/data/cited/'+slug+'.json';if(!reverseFiles.has(name))reverseFiles.set(name,fs.existsSync(local(directory,name))?read(directory,name):{});return reverseFiles.get(name);};
 for(const e of removed)for(const obj of[reverse,reverseFile(e.r)])if(obj[e.r]){obj[e.r]=obj[e.r].filter(r=>r!==e.a);if(!obj[e.r].length)delete obj[e.r];}
 for(const e of added)for(const obj of[reverse,reverseFile(e.r)]){const list=obj[e.r]??=[];if(!list.includes(e.a))list.push(e.a);}
 for(const[name,obj]of reverseFiles)put(name,obj);put('mcp-data/cited.json',reverse);
 const citedIndex=read(directory,'library/data/cited/index.json');put('library/data/cited/index.json',[...new Set([...citedIndex,...[...reverseFiles.keys()].map(n=>path.basename(n,'.json'))])].sort());
 const sourcePack=read(directory,'library/data/packs/sources.json');sourcePack.refs=[...new Set([...sourcePack.refs,...added.map(e=>e.r)])].sort();put('library/data/packs/sources.json',sourcePack);
 const mcp=read(directory,MCP),beforeMcp=structuredClone(mcp),catalog=read(directory,'mcp-data/catalog.json'),book=catalog.books.find(b=>b.slug===BOOK);assert(book?.sections.length===16);const beforeBook=structuredClone(book);mcp.paras=[];
 for(const section of pack.sections){const meta=book.sections[section.id];assert.equal(meta.ref,section.sectionRef);meta.first=mcp.paras.length;const paras=projectRows(section,section.id,links);meta.count=paras.length;mcp.paras.push(...paras);}book.paragraphs=mcp.paras.length;put(MCP,mcp);
 const toc=read(directory,TOC);for(const section of pack.sections){const leaf=toc.toc.children.find(l=>l.id===section.id);assert(leaf?.ref===section.sectionRef);leaf.shape=Math.max(...section.after.filter(r=>r.p).map(r=>r.n));}put(TOC,toc);
 const readerCatalog=read(directory,'library/data/catalog.json'),readerBook=readerCatalog.find(b=>b.slug===BOOK);assert(readerBook);readerBook.segments=mcp.paras.length;put('library/data/catalog.json',readerCatalog);
 const connected=remapConnectedCatalog(directory,beforeMcp,mcp,beforeBook,book,{revisions:pack.connectedQuotationRevisions||[]});put(CONNECTED,connected.catalog);
 const parallels=parallelComputer(directory,{mcpOverride:mcp});put('library/data/parallels/'+BOOK+'.json',parallels.parallels);const words=read(directory,'library/data/parallels/words.json');for(const[key,value]of Object.entries(parallels.wordAdditions))words[key]=value;put('library/data/parallels/words.json',words);
 const revision=RELEASE+'-'+prepared.packSha256.slice(0,12),marker='const editionDataUrl = url => ';let html=fs.readFileSync(local(directory,'library/index.html'),'utf8');assert.equal(html.split(marker).length,2);assert(!html.includes('/* '+RELEASE+' */'));
 html=html.replace(marker,marker+'/* '+RELEASE+" */ (url.startsWith('data/"+BOOK+"/') || url.startsWith('data/cited/') || url.startsWith('data/parallels/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?takanat="+revision+"' :\n");
 // Connected records use a separate catalog fetch, so refresh that URL too.
 html=html.replace(/(connected-ideas\/catalog\.json)(\?[^'"`\s]*)?/g,'$1?takanat='+revision);put('library/index.html',Buffer.from(html));
 let sw=fs.readFileSync(local(directory,'library/sw.js'),'utf8');assert.equal((sw.match(/const SHELL = `[^`]+`;/g)||[]).length,1);sw=sw.replace(/const SHELL = `([^`]+)`;/,(_all,key)=>'const SHELL = `'+key+'-takanat-'+prepared.packSha256.slice(0,12)+'`;');put('library/sw.js',Buffer.from(sw));
 const entries=dataEntries(directory);for(const[name,bytes]of changes)if(name.startsWith('library/data/'))entries[name.slice(8)]=bytes;const manifest=dataManifest(entries);put('library/data/files.json',manifest);catalog.version=manifest.version;put('mcp-data/catalog.json',catalog);
 const{zipSync,unzipSync}=createRequire(import.meta.url)(local(directory,'library/vendor/fflate.min.js')),archives=[];
 for(const archive of ARCHIVES){
  const original=unzipSync(fs.readFileSync(local(directory,archive))),next={...original},bookArchive=archive.includes('/books/');
  for(const[name,bytes]of changes){
   if(name.startsWith('library/data/')){const member=name.slice(8);if(!bookArchive||member.startsWith('data/'+BOOK+'/')||member==='data/parallels/'+BOOK+'.json'||Object.hasOwn(original,member))next[member]=bytes;}
   else if(name===CONNECTED&&Object.hasOwn(original,'connected-ideas/catalog.json'))next['connected-ideas/catalog.json']=bytes;
  }
  if(bookArchive&&next['data/catalog.json'])next['data/catalog.json']=json([readerBook]);
  if(!bookArchive)next['data/files.json']=json(dataManifest(next));
  const output=zipSync(next,{level:6,mtime:new Date(2026,9,26,0,0,0)}),check=unzipSync(output);assert.deepEqual(Object.keys(check).sort(),Object.keys(next).sort());assert(Object.keys(original).every(n=>Object.hasOwn(next,n)),'Archive member removed');
  const changedMembers=[];for(const[name,bytes]of Object.entries(next)){assert.equal(sha(check[name]),sha(bytes));if(!original[name]||sha(original[name])!==sha(bytes)){assert(name==='data/files.json'&&!bookArchive||name==='data/catalog.json'&&bookArchive||changes.has('library/'+name),'Unrelated archive member changed: '+name);changedMembers.push({path:name,before:original[name]?info(original[name]):null,after:info(bytes)});}}
  archives.push({path:archive,before:fileInfo(local(directory,archive)),after:info(output),entriesBefore:Object.keys(original).length,entriesAfter:Object.keys(next).length,preservedEntries:Object.keys(original).length-changedMembers.filter(m=>m.before).length,changedMembers,dataFiles:Object.keys(next).filter(n=>n.startsWith('data/')).length});put(archive,output);
 }
 const downloads=read(directory,'library/downloads/index.json');downloads.version=manifest.version;for(const archive of archives){const entry=archive.path.includes('/books/')?downloads.books.find(b=>b.slug===BOOK):downloads.library;assert(entry);entry.bytes=archive.after.bytes;entry.dataFiles=archive.dataFiles;}put('library/downloads/index.json',downloads);
 return{changes,counts:{...prepared.counts,connections:Object.values(links).flat().length,addedConnections:added.length,removedConnections:removed.length,remappedUnchangedConceptualQuotations:connected.remapping.filter(r=>r.quotationUnchanged).length,revisedConceptualQuotations:connected.remapping.filter(r=>!r.quotationUnchanged).length,parallelCandidates:parallels.pairs},archives,version:manifest.version,connectedRemapping:connected.remapping};
}

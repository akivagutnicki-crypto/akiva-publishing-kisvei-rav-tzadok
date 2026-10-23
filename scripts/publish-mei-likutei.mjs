// A scoped successor to the current publication: Likutei Mei HaShiloach only.
// Historical releases remain immutable and are checked before this successor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {visible} from './publish-reader-docx-import.mjs';
import {categoryOf} from './citations.mjs';
import {loadPack as loadVolumeII, REPORT as VOLUME_II_REPORT} from './publish-mei-volume-ii.mjs';
import {verifyTzidkatIdeasSuccessor, verifyTzidkatSourceAccuracySuccessor} from './tzidkat-source-accuracy-successor.mjs';

export const RELEASE = '20261023-mei-likutei-v1';
export const PACK = 'sources/akiva/overlays/mei-likutei-20261023.json.gz.b64';
export const REPORT = 'library/mei-likutei-20261023.json';
const REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const SITE = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const MEI = 'library/data/mei-ha-shiloach/';
export const TARGET = 'Mei HaShiloach, Mei HaShiloach Anthology, ';
const PIN = {run:39903065250, artifact:12479627850, commit:'6d264f8c525997eaeb079673f2128939d9f64c43', bytes:718763061, digest:'sha256:4a678c37fd3ef1966152a7d5bc6ae6a9eb5c198c6e813239c5b1d1a32625561e'};
const PINS = {
  "library/index.html": "50d008a9dac546d17b2f871395700323d3b10e5ad8384dce14515d64a6f6eda1",
  "library/sw.js": "577fb753a64e81fee1c120899bd0dcb387c05306e31449ac913c2aa1c0258f48",
  "library/data/mei-ha-shiloach/interlinear.json": "c8d8bbac3a4a0467a7dc6628424c86bc0829a7614c6b5022bd5a1a2d65e80c41",
  "library/data/mei-ha-shiloach/headings.json": "ac3d67190d3ed83f8a3a6310be8750a11012f194236822f691c11927c502fd52",
  "library/data/mei-ha-shiloach/study-contents.json": "e2ad445a964ff32e2d6cc7c6e377e07354d88803eaa196eb49675272a70d6421",
  "library/data/mei-ha-shiloach/links.json": "fcf5fb186922d79757dd3a5301f136f58265b2d0a40fb078ee9e781336e2f05d",
  "library/data/files.json": "04f2482bdf067af3aefe7b488ddc685c02b5b6b1a032d6d9c5e5bec08d9241c4",
  "mcp-data/catalog.json": "429d4b1087a582725b792b74681bec6ee4aa167b80ff8e78afb7b147bec6152f",
  "mcp-data/text/mei-hashiloach.json": "ea53b29a95cf4570b7a937fd7dbe49afaece9ee59cc41511669672f8bfdc79a3",
  "library/connected-ideas/catalog.json": "f1376121d0f9d4a0a3023280e9aaa71fd7f1fd27cacbac269233a9289b7e1045",
  "library/source-connections/catalog.json": "c0251a254d46c44cfd516b4c5452c6edf386d7a51ea1f27a0bdfe4f667de1fb3",
  "library/source-connections/translations.json": "1b95e7d7f8a800abe417a68079381f9899d140a474d10566bbbcdf5ec37edb32",
  "library/connected-ideas/review-progress.json": "ca4f9f6489db6d8c2829e8859cbe153d0fb83e8bbe6f45efffb2fa54aa0c99a7",
  "library/share.js": "c81bd5dfd50047ce2ee6dc16c04bfcb1535c57747357d18f87103bf5b061cb27",
  "library/share.css": "53e5b2db820f488937c4fd6d46e00af593192c03b56a79f8755b864c731b9155",
  "library/downloads/rav-tzadok-library.zip": "4dababc66b78fcd30cce706d749407d0506fa0518cd393e7c65faf7092e2be9b",
  "library/mei-volume-ii-20261023.json": "031d7e756e37e7b5d474c716a620e4e7dfc2dd805e16d24bce18d601705b33d0"
};
const sha = value => createHash('sha256').update(value).digest('hex');
const hashObject = value => sha(JSON.stringify(value));
const canonical = value => JSON.stringify(value,(_,item)=>item&&!Array.isArray(item)&&typeof item==='object'
  ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const paragraphHebrew = paragraph => paragraph.p ? paragraph.p.map(pair=>pair[0]).join(' ') : paragraph.t||'';
const paragraphEnglish = paragraph => paragraph.p ? paragraph.p.map(pair=>pair[1]).join(' ') : '';
const IDEAS = 'library/connected-ideas/catalog.json';
const SOURCE_CONNECTIONS = 'library/source-connections/catalog.json';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file,value) => {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const outsideAnthology = object => Object.fromEntries(Object.entries(object).filter(([ref])=>!ref.startsWith(TARGET)));
const flatten = node => node.children ? node.children.flatMap(flatten) : [node];
const citedSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const paragraphRef = (section,n) => section.ref+section.sep+n;
const option = (name,fallback) => {const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root = option('--root','dist');
const baselineFile = option('--baseline','mei-likutei-baseline.json');

const escape = text => String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const sourceUrl = ref => 'https://www.sefaria.org/'+encodeURIComponent(ref.replace(/ /g,'_')).replace(/%2C/g,',').replace(/%3A/g,':');
function renderSpans(text,spans){
  let cursor=0,result='';
  for(const span of [...spans].sort((a,b)=>a.start-b.start)){
    assert(Number.isInteger(span.start)&&Number.isInteger(span.end)&&span.start>=cursor&&span.end>span.start&&span.end<=text.length,'Overlapping or invalid supplied hyperlink span');
    assert(typeof span.ref==='string'&&span.ref.trim());const url=new URL(span.url);assert.equal(url.protocol,'https:');assert(['www.sefaria.org','sefaria.org'].includes(url.hostname),'Unexpected supplied source host');
    if(span.label!==undefined)assert.equal(text.slice(span.start,span.end),span.label,'Supplied hyperlink label changed');
    result+=escape(text.slice(cursor,span.start))+'<a data-ref="'+escape(span.ref)+'" href="'+escape(span.url)+'">'+escape(text.slice(span.start,span.end))+'</a>';cursor=span.end;
  }
  return result+escape(text.slice(cursor));
}
export function loadPack(filename=PACK){
  const bytes=fs.readFileSync(filename),pack=JSON.parse(filename.endsWith('.gz.b64')?gunzipSync(Buffer.from(bytes.toString().trim(),'base64')):bytes);
  assert.equal(pack.schemaVersion,1);assert.equal(pack.book,'Mei HaShiloach');assert.equal(pack.targetPrefix,TARGET);
  assert(pack.release===RELEASE||(path.resolve(filename)!==path.resolve(PACK)&&pack.release==='20261023-mei-anthology-draft-v1'),'Unexpected Anthology release');
  assert(Array.isArray(pack.sections)&&pack.sections.length);const refs=new Set();let anchors=0,bodyBlocks=0,attributionBlocks=0;
  const sections=pack.sections.map(input=>{
    assert(input.ref.startsWith(TARGET)&&!refs.has(input.ref),'Unexpected or repeated Anthology reference '+input.ref);refs.add(input.ref);
    const section={...input,sep:input.sep||(/\d[ab]?(?::\d+)*$/.test(input.ref)?':':' '),sourceUrl:input.sourceUrl||sourceUrl(input.ref)};
    assert([' ',':'].includes(section.sep));assert.equal(section.items.length,section.canonicalParagraphCount);
    section.heHtml=renderSpans(section.he||'',section.headingCitationSpans||[]);anchors+=(section.headingCitationSpans||[]).length;
    const edges=[],seen=new Set();
    const addEdge=(n,ref)=>{const a=paragraphRef(section,n),key=a+'\0'+ref;if(!seen.has(key)){seen.add(key);edges.push({a,r:ref,c:categoryOf(ref)});}};
    section.items=section.items.map((item,index)=>{
      assert.equal(item.n,index+1,'Nonconsecutive canonical paragraph '+section.ref);assert.equal(item.canonicalRef,paragraphRef(section,item.n));assert(item.p.length);
      for(const notes of [item.transcriptionNotes,item.sourceNotes])if(notes!==undefined)assert(Array.isArray(notes)&&notes.every(note=>typeof note==='string'&&note.trim()),'Source notes must be nonempty text strings');
      const blocks=item.blocks||[];assert(blocks.length,'Missing manuscript block boundaries');let cursor=0;const attributionPairs=new Set();
      for(const block of blocks){assert(['body','attribution'].includes(block.kind));assert.equal(block.pairStart,cursor);assert(block.pairEnd>cursor&&block.pairEnd<=item.p.length);assert.deepEqual(block.p,item.p.slice(cursor,block.pairEnd),'Block text and phrase array differ');if(block.kind==='attribution'){attributionBlocks++;for(let j=cursor;j<block.pairEnd;j++)attributionPairs.add(j);}else bodyBlocks++;cursor=block.pairEnd;}
      assert.equal(cursor,item.p.length);const starts=blocks.map(block=>block.pairStart);assert.deepEqual(item.blockStartPairIndexes,starts);assert.deepEqual(item.paragraphBreaks,starts.filter(n=>n>0));
      const spans=item.citationSpans||[];for(const span of spans){assert(Number.isInteger(span.pairIndex)&&span.pairIndex>=0&&span.pairIndex<item.p.length);assert([0,1].includes(span.side));addEdge(item.n,span.ref);}
      const p=item.p.map((pair,j)=>{assert(Array.isArray(pair)&&pair.length===2&&pair.every(x=>typeof x==='string'));assert.match(pair[0],/[א-ת]/);assert(pair[1].match(/[A-Za-z]/)||(attributionPairs.has(j)&&!pair[1]&&pack.editorialStage!=='reviewed'),'Missing English '+paragraphRef(section,item.n)+' pair '+j);assert.doesNotMatch(pair[1],/[\[\]]/);assert.doesNotMatch(pair[1],/^(?:TODO|TBD|translation pending)\b/i);return pair.map((text,side)=>{assert.doesNotMatch(text,/<\/?[a-z][^>]*>/i);const links=spans.filter(span=>span.pairIndex===j&&span.side===side);anchors+=links.length;return renderSpans(text,links);});});
      for(const source of item.connections||[])addEdge(item.n,source.ref);
      return {...item,p};
    });section.edges=edges;return section;
  });
  const headingAnchors=sections.reduce((n,section)=>n+(section.headingCitationSpans?.length||0),0);
  const counts={sections:sections.length,paragraphs:sections.reduce((n,s)=>n+s.items.length,0),phrasePairs:sections.reduce((n,s)=>n+s.items.reduce((m,p)=>m+p.p.length,0),0),sourceHeadings:sections.length,sourceBodyParagraphs:bodyBlocks,sourceAttributionParagraphs:attributionBlocks,sourceNonemptyParagraphs:sections.length+bodyBlocks+attributionBlocks,sourceNotes:sections.reduce((n,s)=>n+s.items.reduce((m,item)=>m+(item.sourceNotes?.length||0),0),0),inlineAnchors:anchors-headingAnchors,headingAnchors};
  for(const [key,value]of Object.entries(pack.expectedCounts||{}))assert.equal(counts[key],value,'Pack count mismatch '+key);
  assert.deepEqual(pack.anthologyOrder,sections.map(s=>s.ref));return {pack,sections,counts,anchors,packSha256:sha(bytes)};
}

async function inventory(dir=root,prefix='',out={}) {
  for(const entry of fs.readdirSync(path.join(dir,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=prefix?prefix+'/'+entry.name:entry.name;assert(!entry.isSymbolicLink(),'Publication symlink: '+name);
    if(entry.isDirectory())await inventory(dir,name,out);else {assert(entry.isFile());const digest=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(path.join(dir,name))){digest.update(chunk);bytes+=chunk.length;}out[name]={bytes,sha256:digest.digest('hex')};}
  }return out;
}
const allowed = name => name===REPORT||[MEI+'interlinear.json',MEI+'headings.json',MEI+'study-contents.json',MEI+'links.json',
  'library/index.html','library/sw.js','library/data/files.json','library/data/packs/sources.json',
  'library/downloads/rav-tzadok-library.zip','library/downloads/index.json','mcp-data/catalog.json','mcp-data/cited.json','mcp-data/text/mei-hashiloach.json'].includes(name)||/^library\/data\/cited\/[a-z0-9-]+\.json$/.test(name);
const changedOrigin = (ref,sections) => sections.some(s=>ref.startsWith(s.ref+s.sep)&&/^\d+$/.test(ref.slice((s.ref+s.sep).length)));
function withoutOrigins(index,sections) {
  // Preserve pre-existing empty entries and their ordering. Remove a key only
  // when this successor actually removes its final originating paragraph.
  return Object.fromEntries(Object.entries(index).flatMap(([ref,list])=>{
    const remaining=list.filter(a=>!changedOrigin(a,sections));
    return remaining.length||list.length===0?[[ref,remaining]]:[];
  }));
}

function captureSemanticState(sections) {
  const load=name=>read(path.join(root,name));
  const mei=load(MEI+'interlinear.json'),heads=load(MEI+'headings.json'),links=load(MEI+'links.json');
  const catalog=load('mcp-data/catalog.json'),text=load('mcp-data/text/mei-hashiloach.json');
  const reverse={};for(const name of fs.readdirSync(path.join(root,'library/data/cited')).filter(n=>n.endsWith('.json')&&n!=='index.json'))reverse[name]=hashObject(withoutOrigins(load('library/data/cited/'+name),sections));
  return {retainedPhrases:hashObject(outsideAnthology(mei)),retainedHeadings:hashObject(outsideAnthology(heads)),retainedLinks:hashObject(outsideAnthology(links)),
    retainedContents:hashObject(load(MEI+'study-contents.json').toc.children.filter(node=>node.en!=='Mei HaShiloach Anthology')),
    otherMcpBooks:hashObject(catalog.books.filter(b=>b.slug!=='mei-hashiloach')),
    retainedMeiSections:hashObject(catalog.books.find(b=>b.slug==='mei-hashiloach').sections.filter(s=>!s.ref.startsWith(TARGET)).map(({first,...section})=>section)),
    retainedMeiParagraphs:hashObject(text.paras.filter(p=>!p.r.startsWith(TARGET)).map(({s,...p})=>p)),
    mcpCitations:hashObject(withoutOrigins(load('mcp-data/cited.json'),sections)),reverse,citedSources:load('library/data/cited/index.json'),
    unaffectedIdeaRecords:hashObject(load(IDEAS).records.filter(row=>!changedOrigin(row.targetRef,sections))),
    ideaRecordIds:load(IDEAS).records.map(row=>row.id),
    sourceRefs:load('library/data/packs/sources.json').refs};
}

function updateReverseIndexes(sections) {
  const directory=path.join(root,'library/data/cited'), maps=new Map(),originals=new Map();
  for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json')&&n!=='index.json')){const original=read(path.join(directory,name));originals.set(name,hashObject(original));maps.set(name,withoutOrigins(original,sections));}
  const mcpFile=path.join(root,'mcp-data/cited.json'),mcp=withoutOrigins(read(mcpFile),sections);
  for(const edge of sections.flatMap(s=>s.edges)){
    const name=citedSlug(edge.r)+'.json';if(!maps.has(name))maps.set(name,{});const map=maps.get(name);
    for(const target of [map,mcp]){const list=target[edge.r]??=[];if(!list.includes(edge.a))list.push(edge.a);}
  }
  for(const [name,value] of maps)if(originals.get(name)!==hashObject(value))write(path.join(directory,name),value);
  const indexFile=path.join(directory,'index.json'),previousIndex=read(indexFile),index=[...new Set([...previousIndex,...[...maps.keys()].map(name=>name.slice(0,-5))])].sort();if(hashObject(previousIndex)!==hashObject(index))write(indexFile,index);write(mcpFile,mcp);
  const sourceFile=path.join(root,'library/data/packs/sources.json'),sources=read(sourceFile);
  sources.refs=[...new Set([...sources.refs,...sections.flatMap(s=>[...s.edges.map(e=>e.r),...(s.headingCitationSpans||[]).map(span=>span.ref)])])].sort();write(sourceFile,sources);
}

function mcpParagraph(section,item,index) {
  const p={r:paragraphRef(section,item.n),s:index,n:item.n,p:item.p.map(pair=>pair.map(visible))},anchors={};
  item.p.forEach((pair,k)=>pair.forEach((html,side)=>{for(const m of html.matchAll(/<a\b[^>]*data-ref="([^"]+)"[^>]*>/g)){const ref=visible(m[1]);anchors[ref]??=[k,side?'e':'h',visible(html.slice(0,m.index)).length];}}));
  if(Object.keys(anchors).length)p.a=anchors;
  const citations=section.edges.filter(e=>e.a===p.r).map(e=>[e.r,e.c]);if(citations.length)p.c=citations;
  if(item.heading)p.h=[item.heading];if(item.paragraphBreaks?.length)p.paragraphBreaks=[...item.paragraphBreaks];if(item.blocks?.length)p.sourceBlocks=item.blocks.map(({kind,sourceParagraphIndex,pairStart,pairEnd})=>({kind,sourceParagraphIndex,pairStart,pairEnd}));const notes=[...(item.transcriptionNotes||[]),...(item.sourceNotes||[])];if(notes.length)p.x=notes;
  return p;
}

function updateMcp(sections,order,heads) {
  const catalogFile=path.join(root,'mcp-data/catalog.json'),catalog=read(catalogFile),book=catalog.books.find(b=>b.slug==='mei-hashiloach');assert(book);
  const textFile=path.join(root,'mcp-data/text/mei-hashiloach.json'),old=read(textFile),oldSections=new Map(book.sections.map(s=>[s.ref,s])),updated=new Map(sections.map(s=>[s.ref,s]));
  const extras=book.sections.filter(s=>!order.includes(s.ref));assert(extras.every(s=>!updated.has(s.ref)));
  const refs=[...order,...extras.map(s=>s.ref)],paras=[],next=[];
  for(const ref of refs){
    const section=updated.get(ref),previous=oldSections.get(ref),index=next.length,first=paras.length;
    if(section){const info=heads[ref],parts=ref.split(', ');const list=section.items.map(item=>mcpParagraph(section,item,index));paras.push(...list);next.push({ref,he:info.he,title:parts.slice(1).join(', '),heTitle:info.he,path:parts.slice(1,-1).join(' › '),il:true,first,count:list.length,...(info.title?{heading:info.title}:{})});}
    else {assert(previous,'Missing retained MCP section '+ref);const list=old.paras.slice(previous.first,previous.first+previous.count).map(p=>({...p,s:index}));paras.push(...list);next.push({...previous,first,count:list.length});}
  }
  book.sections=next;book.paragraphs=paras.length;book.interlinear=true;
  book.edition='Akiva Publishing interlinear translation; Volumes I and II and the Mei HaShiloach Anthology';
  catalog.built=new Date().toISOString();write(textFile,{slug:'mei-hashiloach',paras});write(catalogFile,catalog);
}

function connectionContext(directory=root) {
  const require=createRequire(import.meta.url),normalize=require(path.resolve(directory,'library/source-connections.js')).normalizedHebrew;
  const textBytes=fs.readFileSync(path.join(directory,'mcp-data/text/mei-hashiloach.json')),text=JSON.parse(textBytes);
  const book=read(path.join(directory,'mcp-data/catalog.json')).books.find(b=>b.slug==='mei-hashiloach');assert(book);
  const paragraphs=new Map(text.paras.map((paragraph,index)=>[paragraph.r,{paragraph,index,section:book.sections[paragraph.s]}]));
  return {normalize,text,book,paragraphs,textSha256:sha(textBytes)};
}

function targetEvidence(record,context) {
  const {normalize,text,paragraphs,textSha256}=context,match=paragraphs.get(record.targetRef);assert(match,'Existing connection target disappeared '+record.targetRef);
  const full=paragraphHebrew(match.paragraph),norm=normalize(full),quote=normalize(record.targetHebrew);
  const start=(' '+norm+' ').indexOf(' '+quote+' ');
  assert(quote&&start>=0,'Reviewed quotation is no longer contiguous in '+record.id+' → '+record.targetRef);
  assert.equal(start,(' '+norm+' ').lastIndexOf(' '+quote+' '),'Ambiguous quotation in '+record.id);
  let cursor=0,first=-1,last=-1;for(const [index,pair] of (match.paragraph.p||[[full,'']]).entries()){
    const length=normalize(pair[0]).length;if(!length)continue;
    if(start>=cursor&&start<cursor+length)first=index;
    if(start+quote.length>cursor&&start+quote.length<=cursor+length)last=index;
    cursor+=length+1;
  }
  assert(first>=0&&last>=first,'Quotation has no precise phrase range in '+record.id);
  const sectionHash=sha(normalize(text.paras.slice(match.section.first,match.section.first+match.section.count).map(paragraphHebrew).join(' ')));
  return {placement:{targetSectionRef:match.section.ref,targetPhraseIndex:first,targetPhraseEnd:last,targetParagraphOrder:match.index-match.section.first},
    evidence:{book:'mei-hashiloach',ref:record.targetRef,sectionRef:match.section.ref,edition:match.section.il?'interlinear':'hebrew',
      textSha256,paragraphSha256:sha(canonical(match.paragraph)),fullHebrewSha256:sha(norm),sectionHebrewSha256:sectionHash,quoteStart:start}};
}

export function verifyReviewedConnectionsPreserved({directory=root,afterTzidkatSourceAccuracy=false}={}){
  const successor=afterTzidkatSourceAccuracy?verifyTzidkatIdeasSuccessor({directory}):null;
  const prior=read(path.join(directory,VOLUME_II_REPORT)),proof=prior.connectedIdeas,context=connectionContext(directory),catalog=successor?.predecessorCatalog||read(path.join(directory,IDEAS));
  assert.equal(prior.packSha256,loadVolumeII().packSha256);assert.equal(sha(successor?.predecessorBytes||fs.readFileSync(path.join(directory,IDEAS))),proof.afterSha256,'Reviewed idea catalog changed');
  assert.deepEqual(catalog.records.map(row=>row.id),proof.recordIds);const amended=new Set(proof.amendedRecords.map(row=>row.id));assert.equal(hashObject(catalog.records.filter(row=>!amended.has(row.id))),proof.preservedRecordsSha256);
  const predecessorTextSha256=prior.changedFiles.find(file=>file.path==='mcp-data/text/mei-hashiloach.json')?.sha256;assert(predecessorTextSha256);
  for(const entry of proof.amendedRecords){const row=catalog.records.find(row=>row.id===entry.id);assert.equal(hashObject(row),entry.afterSha256);assert.equal(row.evidence.target.textSha256,predecessorTextSha256);const derived=targetEvidence(row,context);assert.deepEqual({...row.evidence.target,textSha256:context.textSha256},derived.evidence,'Previously reviewed context changed '+row.id);for(const[key,value]of Object.entries(derived.placement))assert.equal(row.placement[key],value);assert.equal(row.reviewedTargetHebrewSha256,derived.evidence.fullHebrewSha256);if(row.reverseExplanation)assert.equal(row.reviewedTargetSectionHebrewSha256,derived.evidence.sectionHebrewSha256);assert.equal(row.evidence.targetEnglishSha256,sha(row.targetEnglish));}
  for(const[name,hash]of Object.entries(prior.preservedConnectionFiles))assert.equal(sha(fs.readFileSync(path.join(directory,name))),hash,'Prior reviewed-source metadata changed '+name);
  let affected=0;for(const file of[IDEAS,SOURCE_CONNECTIONS])for(const row of read(path.join(directory,file)).records){if([row.originRef,row.targetRef].some(ref=>ref?.startsWith(TARGET)))affected++;if(file===SOURCE_CONNECTIONS&&row.targetRef.startsWith('Mei HaShiloach,')){const match=context.paragraphs.get(row.targetRef);assert(match);const full=context.normalize(paragraphHebrew(match.paragraph));assert.equal(sha(full),row.reviewedTargetHebrewSha256);assert((' '+full+' ').includes(' '+context.normalize(row.targetHebrew)+' '));}}
  assert.equal(affected,0,'Existing reviewed records target the Anthology and require explicit contextual review');
  return {unchanged:!successor,records:catalog.records.length,priorVolumeIIReviews:proof.amendedRecords.length,affectedAnthologyRecords:affected,predecessorTextSha256,currentTextSha256:context.textSha256,catalogSha256:successor?.proof.currentCatalogSha256||proof.afterSha256,...(successor?{tzidkatSourceAccuracySuccessor:successor.proof}:{})};
}
function verifyVolumeII(directory=root){
  const prepared=loadVolumeII(),prior=read(path.join(directory,VOLUME_II_REPORT)),mei=read(path.join(directory,MEI+'interlinear.json')),heads=read(path.join(directory,MEI+'headings.json'));
  assert.equal(prior.packSha256,prepared.packSha256);for(const section of prepared.sections){assert.equal(hashObject(mei[section.ref]),prior.sectionHashes[section.ref]);assert.deepEqual(mei[section.ref],section.items.map(item=>item.p));assert.deepEqual(heads[section.ref].headings,section.items.map(item=>item.heading||''));}return {packSha256:prepared.packSha256,sections:prepared.sections.length};
}
function assertPriorLinks(sections,links,replacements=[]){
  const reviewed=new Map(),used=new Set();
  for(const replacement of replacements){
    const {originRef,previousRef,replacementRef,primarySource}=replacement,key=originRef+'\0'+previousRef;
    assert.equal(replacement.reviewed,true,'Prior link replacement lacks editorial review');assert(originRef?.startsWith(TARGET));assert(previousRef&&replacementRef&&previousRef!==replacementRef);assert(!reviewed.has(key),'Repeated prior link replacement');assert(replacement.reason?.trim());
    assert.equal(primarySource?.ref,replacementRef);assert.match(primarySource.hebrew,/[א-ת]/);assert(primarySource.hebrew.length>15,'Missing primary-source quotation for changed link');const url=new URL(primarySource.url);assert.equal(url.protocol,'https:');assert(['www.sefaria.org','sefaria.org'].includes(url.hostname));
    reviewed.set(key,replacement);
  }
  for(const section of sections)for(const edge of links[section.ref]||[]){
    const key=edge.a+'\0'+edge.r,replacement=reviewed.get(key),expected=replacement?.replacementRef||edge.r;
    assert(section.edges.some(next=>next.a===edge.a&&next.r===expected),'Earlier citation disappeared: '+edge.a+' → '+edge.r);
    if(replacement){const item=section.items.find(item=>paragraphRef(section,item.n)===edge.a);assert(item?.citationSpans?.some(span=>span.ref===expected),'Reviewed replacement has no visible hyperlink in '+edge.a);used.add(key);}
  }
  assert.equal(used.size,reviewed.size,'A reviewed replacement does not correspond to an existing citation');
}

export function publish({preview=false}={}) {
  const filename=option('--pack',PACK),prepared=loadPack(filename),{pack,sections,counts,anchors,packSha256}=prepared;
  if(!preview)assert.equal(pack.editorialStage,'reviewed','Production Likutei pack has not completed editorial review');
  else assert.notEqual(path.resolve(filename),path.resolve(PACK),'Preview requires an explicit nonproduction pack');
  const reportFile=path.join(root,REPORT);
  if(fs.existsSync(reportFile)){const report=read(reportFile);assert.equal(report.release,RELEASE);assert.equal(report.packSha256,packSha256);console.log(JSON.stringify({ok:true,mode:'already-applied',release:RELEASE}));return report;}
  const meiFile=path.join(root,MEI+'interlinear.json'),mei=read(meiFile),heads=read(path.join(root,MEI+'headings.json')),links=read(path.join(root,MEI+'links.json'));
  const oldOrder=Object.keys(mei),oldAnthology=oldOrder.filter(ref=>ref.startsWith(TARGET)),anthologyOrder=pack.anthologyOrder;assertPriorLinks(sections,links,pack.priorLinkReplacements||[]);
  const preservedConnectionFiles=Object.fromEntries([SOURCE_CONNECTIONS,'library/source-connections/translations.json','library/connected-ideas/review-progress.json']
    .map(name=>[name,sha(fs.readFileSync(path.join(root,name)))]));
  assert.equal(new Set(anthologyOrder).size,anthologyOrder.length);assert(anthologyOrder.every(ref=>ref.startsWith(TARGET)));
  for(const ref of new Set([...oldAnthology,...sections.map(s=>s.ref)]))assert(anthologyOrder.includes(ref),'Canonical Anthology order omitted '+ref);
  const preserved={phrases:hashObject(outsideAnthology(mei)),heads:hashObject(outsideAnthology(heads)),links:hashObject(outsideAnthology(links))};
  for(const section of sections){
    mei[section.ref]=section.items.map(item=>item.p);heads[section.ref]={title:section.title||section.ref.split(', ').at(-1),he:section.he||'',sourceUrl:section.sourceUrl,heHtml:section.heHtml,sep:section.sep,
      paragraphBreaks:Object.fromEntries(section.items.map((item,i)=>[i,item.paragraphBreaks]).filter(([,breaks])=>breaks.length)),
      headings:section.items.map(item=>item.heading||''),phraseHeadings:section.phraseHeadings||{},...(section.items.some(item=>item.transcriptionNotes?.length)?{transcriptionNotes:Object.fromEntries(section.items.map((item,i)=>[i,item.transcriptionNotes||[]]).filter(([,v])=>v.length))}:{}),...(section.items.some(item=>item.sourceNotes?.length)?{sourceNotes:Object.fromEntries(section.items.map((item,i)=>[i,item.sourceNotes||[]]).filter(([,v])=>v.length))}:{})};links[section.ref]=section.edges;
  }
  assert(anthologyOrder.every(ref=>Object.hasOwn(mei,ref)),'Canonical Anthology order includes unpublished text');
  const order=[...oldOrder.filter(ref=>!ref.startsWith(TARGET)),...anthologyOrder];
  assert.equal(order.length,Object.keys(mei).length,'Reader order lost a section');
  const study=read(path.join(root,MEI+'study-contents.json')),oldNode=study.toc.children.findIndex(node=>node.en==='Mei HaShiloach Anthology');assert(oldNode>=0);
  const node={en:'Mei HaShiloach Anthology',he:'ליקוטים',children:[]};
  for(const ref of anthologyOrder){const parts=ref.split(', '),category=parts.slice(2,-1).join(' · ');let target=node;if(category){target=node.children.find(x=>x.en===category);if(!target)node.children.push(target={en:category,he:'',children:[]});}target.children.push({ref,en:heads[ref]?.title||parts.at(-1),he:heads[ref]?.he||'',depth:1,shape:mei[ref].length,interlinear:true,sep:heads[ref]?.sep||' '});}
  study.toc.children[oldNode]=node;study.anthologyRelease=RELEASE;
  write(meiFile,Object.fromEntries(order.map(ref=>[ref,mei[ref]])));write(path.join(root,MEI+'headings.json'),heads);write(path.join(root,MEI+'study-contents.json'),study);write(path.join(root,MEI+'links.json'),links);
  assert.equal(hashObject(outsideAnthology(mei)),preserved.phrases);assert.equal(hashObject(outsideAnthology(heads)),preserved.heads);assert.equal(hashObject(outsideAnthology(links)),preserved.links);
  updateReverseIndexes(sections);updateMcp(sections,order,heads);const connections=verifyReviewedConnectionsPreserved();verifyVolumeII();
  const htmlFile=path.join(root,'library/index.html');let html=fs.readFileSync(htmlFile,'utf8');assert.equal((html.match(/const meiStudyRefs = new Set\(/g)||[]).length,1);
  html=html.replace(/const meiStudyRefs = new Set\(\[[\s\S]*?\]\);/,'const meiStudyRefs = new Set('+JSON.stringify(order,null,2)+');');
  const description='Volumes I and II, with selections from the anthology.';assert.equal(html.split(description).length,2);
  html=html.replace(description,'Volumes I and II, with the Mei HaShiloach Anthology.');
  const metadata='transcriptionNotes:headingInfo?.transcriptionNotes || {},';assert.equal(html.split(metadata).length,2);html=html.replace(metadata,metadata+' sourceNotes:headingInfo?.sourceNotes || {}, paragraphBreaks:headingInfo?.paragraphBreaks || d.paragraphBreaks, heRefHtml:headingInfo?.heHtml || null,');
  const hebrewHeading='${d.heRef ? `<span class="he" lang="he">${esc(d.heRef)}</span>`';assert.equal(html.split(hebrewHeading).length,2);html=html.replace(hebrewHeading,'${d.heRef ? `<span class="he" lang="he">${d.heRefHtml ? clean(d.heRefHtml) : esc(d.heRef)}</span>`');
  const noteInsertion='    if (d.transcriptionNotes?.[i]) html += ';assert.equal(html.split(noteInsertion).length,2);
  const sourceNoteRenderer='    if (d.sourceNotes?.[i]?.length) html += `<details class="transcription-note source-reference-note"><summary><span class="note-en">Source reference notes</span><span class="note-he" lang="he">הֶעָרוֹת לַמְּקוֹרוֹת</span></summary>${d.sourceNotes[i].map(note=>`<p>${esc(note)}</p>`).join("")}</details>`;\n';
  html=html.replace(noteInsertion,sourceNoteRenderer+noteInsertion);
  const cachePrefix='const editionDataUrl = url => ';assert.equal(html.split(cachePrefix).length,2);
  html=html.replace(cachePrefix,cachePrefix+`(url.startsWith('data/mei-ha-shiloach/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition=${RELEASE}' :\n`);fs.writeFileSync(htmlFile,html);
  const swFile=path.join(root,'library/sw.js'),sw=fs.readFileSync(swFile,'utf8');assert(/const SHELL = `([^`]+)`;/.test(sw));fs.writeFileSync(swFile,sw.replace(/const SHELL = `([^`]+)`;/,'const SHELL = `$1-'+RELEASE+'`;'));
  const report={schemaVersion:1,release:RELEASE,packSha256,editorialStage:pack.editorialStage,preview,counts,sourceReferenceNotes:sections.reduce((n,s)=>n+s.items.reduce((m,item)=>m+(item.sourceNotes?.length||0),0),0),sourceAnchors:anchors,sourceConnections:sections.reduce((n,s)=>n+s.edges.length,0),canonicalOrder:order,anthologyOrder,
    replacedSections:sections.filter(s=>oldAnthology.includes(s.ref)).map(s=>s.ref),addedSections:sections.filter(s=>!oldAnthology.includes(s.ref)).map(s=>s.ref),preservedNonAnthology:preserved,
    sectionHashes:Object.fromEntries(sections.map(s=>[s.ref,hashObject(mei[s.ref])])),connections,preservedConnectionFiles,priorLinkReplacements:pack.priorLinkReplacements||[],
    scope:'Supplied Likutei manuscript, with body and attribution blocks; Volumes I and II, reviewed catalogs and other works preserved'};
  write(reportFile,report);console.log(JSON.stringify({ok:true,mode:'published',...counts,sourceAnchors:anchors,sourceConnections:report.sourceConnections}));return report;
}

async function githubGet(route){const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;const response=await fetch('https://api.github.com/repos/'+REPO+route,{headers,signal:AbortSignal.timeout(30000)});assert(response.ok,'GitHub metadata '+response.status+' '+route);return response.json();}
async function verifyHead(){assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.match(process.env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.equal((await githubGet('/git/ref/heads/main')).object.sha,process.env.GITHUB_SHA,'Main advanced; stop before overwriting intervening work');}
async function liveBytes(name){const url=new URL(name,SITE);url.searchParams.set('mei-likutei-check',String(Date.now()));const response=await fetch(url,{headers:{'Cache-Control':'no-cache'},cache:'no-store',signal:AbortSignal.timeout(60000)});assert(response.ok,'Public asset '+response.status+' '+name);return Buffer.from(await response.arrayBuffer());}
async function liveBaseline(){await verifyHead();for(const [name,hash] of Object.entries(PINS))assert.equal(sha(await liveBytes(name)),hash,'Live publication changed: '+name);}
async function verifyPublished(){
  const report=read(path.join(root,REPORT));assert.equal(report.editorialStage,'reviewed');assert.equal(report.preview,false);assert(report.changedFiles?.length,'Publication was not sealed');
  assert.equal(report.release,RELEASE);assert.equal(report.packSha256,loadPack().packSha256);
  const successor=process.argv.includes('--after-tzidkat-source-accuracy')?verifyTzidkatSourceAccuracySuccessor({directory:root}):null;
  let successorOverlaps=0;
  const files=[...report.changedFiles.map(file=>{
    const replacement=file.path!==REPORT&&successor?.filesByPath.get(file.path);
    if(!replacement)return file;successorOverlaps++;return {...file,sha256:replacement.sha256,bytes:replacement.bytes};
  }),{path:REPORT,sha256:sha(fs.readFileSync(path.join(root,REPORT)))}];
  for(let first=0;first<files.length;first+=4)await Promise.all(files.slice(first,first+4).map(async file=>{
    for(let attempt=1;attempt<=6;attempt++)try{assert.equal(sha(await liveBytes(file.path)),file.sha256,'Published bytes differ '+file.path);return;}
    catch(error){if(attempt===6)throw error;console.log('Waiting for public asset refresh ('+attempt+'/6): '+file.path);await new Promise(resolve=>setTimeout(resolve,10000));}
  }));
  write('mei-likutei-live-verification.json',{ok:true,release:RELEASE,files:files.length,...(successor?{successorOverlaps,tzidkatSourceAccuracySuccessor:successor.proof}:{})});console.log('Verified all published changed files against the checked release.');
}

async function verify(){
  const {pack,sections,packSha256,counts}=loadPack(option('--pack',PACK)),baseline=read(baselineFile),current=await inventory(),report=read(path.join(root,REPORT));assert.equal(report.packSha256,packSha256);assert.deepEqual(report.counts,counts);assert.deepEqual(report.priorLinkReplacements,pack.priorLinkReplacements||[]);
  let protectedFiles=0;for(const [name,before] of Object.entries(baseline.files)){assert(current[name],'Existing file deleted: '+name);if(!allowed(name)){assert.equal(current[name].sha256,before.sha256,'Unrelated publication file changed: '+name);protectedFiles++;}}
  for(const name of Object.keys(current))assert(baseline.files[name]||allowed(name),'Unexpected new publication file '+name);
  const state=captureSemanticState(sections);for(const key of ['retainedPhrases','retainedHeadings','retainedLinks','retainedContents','otherMcpBooks','retainedMeiSections','retainedMeiParagraphs','mcpCitations','unaffectedIdeaRecords'])assert.equal(state[key],baseline.semantic[key],'Unrelated semantic content changed: '+key);
  assert.deepEqual(state.ideaRecordIds,baseline.semantic.ideaRecordIds,'Existing connection identities changed');
  for(const [name,hash] of Object.entries(baseline.semantic.reverse))assert.equal(state.reverse[name],hash,'Other citing passages changed: '+name);
  assert(baseline.semantic.citedSources.every(slug=>state.citedSources.includes(slug)),'Existing reverse-citation source key lost');
  assert(baseline.semantic.sourceRefs.every(ref=>state.sourceRefs.includes(ref)),'Existing offline source reference lost');
  for(const ref of sections.flatMap(s=>[...s.edges.map(e=>e.r),...(s.headingCitationSpans||[]).map(span=>span.ref)]))assert(state.sourceRefs.includes(ref),'Imported source is absent from the offline source pack: '+ref);
  const mei=read(path.join(root,MEI+'interlinear.json')),toc=read(path.join(root,MEI+'study-contents.json'));assert.deepEqual(flatten(toc.toc).map(x=>x.ref),report.canonicalOrder);
  for(const section of sections)assert.equal(hashObject(mei[section.ref]),hashObject(section.items.map(item=>item.p)),'Imported phrase pairs changed '+section.ref);
  const mcp=read(path.join(root,'mcp-data/text/mei-hashiloach.json')),book=read(path.join(root,'mcp-data/catalog.json')).books.find(b=>b.slug==='mei-hashiloach');
  assert.equal(new Set(mcp.paras.map(p=>p.r)).size,mcp.paras.length,'Duplicate canonical MCP paragraph');
  const heads=read(path.join(root,MEI+'headings.json'));
  for(const section of sections){const index=book.sections.findIndex(s=>s.ref===section.ref),entry=book.sections[index];assert(entry?.il);assert.equal(entry.count,section.items.length);assert.equal(heads[section.ref].he,section.he);assert.equal(heads[section.ref].heHtml,section.heHtml);assert.equal(heads[section.ref].sourceUrl,section.sourceUrl);assert.deepEqual(heads[section.ref].headings,section.items.map(item=>item.heading||''));const rows=mcp.paras.slice(entry.first,entry.first+entry.count);for(const [i,row] of rows.entries()){assert.equal(row.s,index);assert.equal(row.r,paragraphRef(section,i+1));assert.deepEqual(row.p,section.items[i].p.map(pair=>pair.map(visible)),'MCP lost or altered a phrase in '+row.r);assert.deepEqual(row.h||[],section.items[i].heading?[section.items[i].heading]:[],'MCP heading differs in '+row.r);assert.deepEqual(row.paragraphBreaks||[],section.items[i].paragraphBreaks);assert.deepEqual(row.sourceBlocks,section.items[i].blocks.map(({kind,sourceParagraphIndex,pairStart,pairEnd})=>({kind,sourceParagraphIndex,pairStart,pairEnd})));assert.deepEqual(row.x||[],[...(section.items[i].transcriptionNotes||[]),...(section.items[i].sourceNotes||[])]);assert.deepEqual(heads[section.ref].paragraphBreaks[i]||[],section.items[i].paragraphBreaks);assert.deepEqual(heads[section.ref].sourceNotes?.[i]||[],section.items[i].sourceNotes||[]);assert.deepEqual(heads[section.ref].transcriptionNotes?.[i]||[],section.items[i].transcriptionNotes||[]);}}
  const manifest=read(path.join(root,'library/data/files.json'));for(const name of ['mei-ha-shiloach/interlinear.json','mei-ha-shiloach/headings.json','mei-ha-shiloach/study-contents.json','mei-ha-shiloach/links.json'])assert(manifest.files.includes(name),'Missing offline data '+name);
  verifyReviewedConnectionsPreserved();verifyVolumeII();
  const changed=Object.entries(current).filter(([name,record])=>name!==REPORT&&baseline.files[name]?.sha256!==record.sha256).map(([name,record])=>({path:name,...record}));
  const result={ok:true,release:RELEASE,protectedFiles,changedFiles:changed.length,...counts};write('mei-likutei-verification.json',result);console.log(JSON.stringify(result));return {changed,result};
}

function rebuildOffline(){
  // Keep every other sefer ZIP byte-for-byte. Repacking those archives merely
  // to refresh a timestamp would exceed this release's publication scope.
  const require=createRequire(import.meta.url),{zipSync,unzipSync}=require(path.resolve(root,'library/vendor/fflate.min.js'));
  const baseline=read(baselineFile),reportFile=path.join(root,REPORT),report=read(reportFile);
  assert.equal(baseline.release,RELEASE);assert.equal(report.packSha256,baseline.packSha256);
  const dataDir=path.join(root,'library/data'),files=[];
  const walk=(directory,prefix='')=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const name=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())walk(path.join(directory,entry.name),name);else if(name!=='files.json'){assert(entry.isFile());files.push(name);}}};walk(dataDir);files.sort();
  const data=Object.fromEntries(files.map(name=>['data/'+name,fs.readFileSync(path.join(dataDir,name))]));
  for(const name of Object.keys(baseline.files).filter(name=>name.startsWith('library/data/')))
    assert(name==='library/data/files.json'?fs.existsSync(path.join(root,name)):Object.hasOwn(data,name.slice('library/'.length)),'Baseline offline data unexpectedly removed '+name);
  const zipName='library/downloads/rav-tzadok-library.zip',zipFile=path.join(root,zipName),zipBytes=fs.readFileSync(zipFile),inputSha256=sha(zipBytes),baselineZipSha256=baseline.files[zipName]?.sha256;
  assert(baselineZipSha256,'Missing baseline archive proof');
  if(inputSha256!==baselineZipSha256){assert.equal(report.offlineArchive?.baselineZipSha256,baselineZipSha256,'Unverified input archive');assert.equal(inputSha256,report.offlineArchive.zipSha256,'Input archive changed since verification');}
  const old=unzipSync(zipBytes),archiveOnly=Object.fromEntries(Object.entries(old).filter(([name])=>name.startsWith('data/')&&name!=='data/files.json'&&!Object.hasOwn(data,name)));
  // Pages artifacts omit hidden files, while their pre-existing ZIP can retain
  // them. Only entries already absent from the captured site may stay ZIP-only.
  for(const name of Object.keys(archiveOnly))assert(!Object.hasOwn(baseline.files,'library/'+name),'Offline data unexpectedly removed '+name);
  const archivedProofs=Object.fromEntries(Object.entries(archiveOnly).map(([name,value])=>[name,{bytes:value.length,sha256:sha(value)}]));
  if(inputSha256!==baselineZipSha256)assert.deepEqual(archivedProofs,report.offlineArchive.preservedArchiveOnly,'Archive-only data changed');
  const manifestFor=entries=>{const names=Object.keys(entries).filter(name=>name.startsWith('data/')&&name!=='data/files.json').sort(),hash=createHash('sha256');let bytes=0;for(const name of names){hash.update(name.slice(5)).update('\0').update(entries[name]);bytes+=entries[name].length;}return {version:hash.digest('hex').slice(0,16),bytes,files:names.map(name=>name.slice(5))};};
  const manifest=manifestFor(data),entries={...old,...data},zipManifest=manifestFor(entries);
  // The HTTP manifest advertises only real site files. The archive manifest
  // separately lists every retained archive file, so neither invents URLs.
  entries['data/files.json']=Buffer.from(JSON.stringify(zipManifest));
  const result=zipSync(entries,{level:6}),checked=unzipSync(result);
  assert.deepEqual(Object.keys(checked).sort(),Object.keys(entries).sort(),'Offline ZIP entry set changed');
  for(const [name,value] of Object.entries(entries))assert.equal(sha(checked[name]),sha(value),'Offline ZIP data mismatch '+name);
  write(path.join(dataDir,'files.json'),manifest);fs.writeFileSync(zipFile,result);
  const indexFile=path.join(root,'library/downloads/index.json'),index=read(indexFile);index.version=manifest.version;index.library.bytes=result.length;index.library.dataFiles=zipManifest.files.length+1;write(indexFile,index);
  report.offlineArchive={baselineZipSha256,zipSha256:sha(result),preservedArchiveOnly:archivedProofs,onlineVersion:manifest.version,archiveVersion:zipManifest.version};write(reportFile,report);
  console.log(JSON.stringify({ok:true,offlineFiles:files.length,archiveDataFiles:zipManifest.files.length+1,preservedArchiveOnly:Object.keys(archiveOnly).length,version:manifest.version,archiveVersion:zipManifest.version,zipBytes:result.length}));
}

async function browserCheck(){
  let playwright;try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
  let server;let base=option('--url','');if(!base){const dir=path.resolve(root);server=http.createServer((req,res)=>{let file=path.resolve(dir,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(dir+path.sep)){res.writeHead(403).end();return;}try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/library/';}base=base.replace(/\/?$/,'/');
  const {pack,sections}=loadPack(option('--pack',PACK)),report=read(path.join(root,REPORT));
  const sampleRef=option('--sample-ref',''),citationRef=option('--citation-ref',''),requested=sections.find(s=>s.ref===sampleRef);
  if(sampleRef)assert(requested,'Requested browser sample is not in the reviewed pack: '+sampleRef);
  if(citationRef)assert(pack.references[citationRef],'Requested browser citation is absent: '+citationRef);
  const mei=read(path.join(root,MEI+'interlinear.json')),headings=read(path.join(root,MEI+'headings.json'));
  const preservedSamples=['Mei HaShiloach, Volume I, Introduction','Mei HaShiloach, Volume II, Introduction'].map(ref=>({ref,he:headings[ref].he,sep:headings[ref].sep||' ',items:mei[ref].map((p,i)=>({n:i+1,p,heading:headings[ref].headings[i]}))}));
  const samples=[...new Set([requested,sections[0],sections.at(-1),...['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Five Scrolls','Prophets','Writings','Talmud','Collectanea'].map(category=>sections.find(s=>s.ref.includes(', '+category+', '))),sections[Math.floor(sections.length/2)],...preservedSamples].filter(Boolean))];
  const hash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
  const browser=await playwright.chromium.launch({headless:true,...(process.env.READER_CHROMIUM_EXECUTABLE?{executablePath:process.env.READER_CHROMIUM_EXECUTABLE}:{})});fs.mkdirSync('artifacts/mei-likutei',{recursive:true});
  try{for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));});
    await context.route('https://www.sefaria.org/**',route=>route.fulfill({status:200,contentType:'application/json',body:route.request().url().includes('/api/links/')?'[]':'{"he":[],"text":[],"versions":[]}'}));
    await page.goto(base+'#/book/Mei_HaShiloach');const toc=page.locator('#toc .study-entry a[href^="#/read/Mei_HaShiloach,"]');await toc.last().waitFor();assert.equal(await toc.count(),report.canonicalOrder.length);
    for(const section of samples){await page.goto(base+'#/read/'+hash(section.ref));const element=page.locator('#text > .sec').filter({has:page.locator('.seg[data-ref="'+paragraphRef(section,1)+'"]')}).first();await element.locator('.ph-he').first().waitFor();const expected=section.items.flatMap(item=>item.p);assert.deepEqual((await element.locator('.ph-he').allTextContents()).map(s=>s.trim()),expected.map(p=>visible(p[0]).trim()));assert.deepEqual((await element.locator('.ph-en').allTextContents()).map(s=>s.trim()),expected.map(p=>visible(p[1]).trim()));assert.deepEqual((await element.locator(':scope > .subhead').allTextContents()).map(s=>s.trim()),section.items.flatMap(item=>(item.heading||'').split('\n').filter(Boolean).map(title=>title.startsWith('§ ')?title.slice(2):title)),'Displayed topical headings differ in '+section.ref);assert.doesNotMatch((await element.locator('.ph-en').allTextContents()).join(''),/[\[\]]/);for(const item of section.items.filter(item=>item.blocks)){const seg=element.locator('.seg[data-ref=\"'+paragraphRef(section,item.n)+'\"]');assert.equal(await seg.locator('.seg-il > .source-paragraph').count(),item.blocks.length>1?item.blocks.length:0,'Manuscript paragraph breaks lost');}assert.equal((await element.locator('.sec-head .he').textContent()).trim(),section.he.trim());assert.deepEqual(await element.locator('.source-reference-note p').allTextContents(),section.items.flatMap(item=>item.sourceNotes||[]),'Source reference notes changed');if(section.headingCitationSpans)assert.equal(await element.locator('.sec-head .he a.cite').count(),section.headingCitationSpans.length,'Supplied heading hyperlink missing');if(section.items.some(item=>item.sourceNotes?.length)){const note=element.locator('.source-reference-note').first();await note.locator('summary').click();await note.locator('p').first().waitFor({state:'visible'});}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Horizontal overflow '+section.ref);}
    const sourceSection=samples.find(s=>s.items.some(item=>item.p.flat().some(text=>citationRef?text.includes('data-ref="'+citationRef+'"'):/<a\b[^>]*data-ref=/.test(text))));
    if(citationRef)assert(sourceSection,'Requested citation is absent from the browser samples');
    if(sourceSection){
      await page.goto(base+'#/read/'+hash(sourceSection.ref));
      const sources=page.locator('#text > .sec').first().locator('.seg-il a.cite[data-ref'+(citationRef?'='+JSON.stringify(citationRef):'')+']'),source=sources.first();await source.waitFor();
      const target=await source.getAttribute('data-ref');
      if(citationRef){const expected=sourceSection.items.flatMap(item=>item.p.flat()).reduce((n,text)=>n+text.split('data-ref="'+citationRef+'"').length-1,0);assert.equal(await sources.count(),expected);for(const link of await sources.all())assert.equal(await link.getAttribute('href'),'#/read/'+hash(citationRef));}
      await source.click();await page.locator('#panel').waitFor({state:'visible'});await page.waitForFunction(ref=>document.querySelector('#panel .ttl')?.textContent===ref,target);
      const external=page.locator('#panel .link-item .acts a[href^="https://www.sefaria.org/"]').first();await external.waitFor();
      if(citationRef)assert([pack.references[citationRef].url,'https://www.sefaria.org/'+hash(citationRef)+'?lang=bi'].includes(await external.getAttribute('href')),'Source popup opened a different canonical citation');
      await page.locator('#pClose').click();
    }
    const first=sections[0],next=report.canonicalOrder[report.canonicalOrder.indexOf(first.ref)+1];await page.goto(base+'#/read/'+hash(paragraphRef(first,1)));await page.locator('.seg[data-ref="'+paragraphRef(first,1)+'"] .ph-he').first().waitFor();if(next){await page.locator('#nextBtn').click();await page.waitForURL(base+'#/read/'+hash(next));await page.locator('#text .ph-he').first().waitFor();}
    await page.locator('#akivaShareButton').waitFor({state:'visible'});await page.screenshot({path:'artifacts/mei-likutei/reader-'+viewport.width+'.png',fullPage:false});assert.deepEqual(errors,[]);await context.close();console.log(JSON.stringify({ok:true,viewport,sampledSections:samples.length,contents:report.canonicalOrder.length,sourcePopup:!!sourceSection,...(citationRef?{checkedCitation:citationRef,citationUrl:pack.references[citationRef].url}:{}),deepLink:true}));
  }}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]||'--publish';
  if(mode==='--metadata'){assert.equal(loadPack().pack.editorialStage,'reviewed');const [artifact,run]=await Promise.all([githubGet('/actions/artifacts/'+PIN.artifact),githubGet('/actions/runs/'+PIN.run)]);assert.equal(artifact.name,'github-pages');assert.equal(artifact.expired,false);assert.equal(artifact.size_in_bytes,PIN.bytes);assert.equal(artifact.digest,PIN.digest);assert.equal(artifact.workflow_run.head_sha,PIN.commit);assert.equal(run.head_sha,PIN.commit);assert.equal(run.conclusion,'success');await liveBaseline();write('mei-likutei-artifact.json',{pin:PIN,artifact,run:{id:run.id,conclusion:run.conclusion,head_sha:run.head_sha}});console.log('Verified current published baseline and branch head.');}
  else if(mode==='--capture'||mode==='--capture-rebuild'){
    const {sections,packSha256}=loadPack(option('--pack',PACK)),files=await inventory();
    if(mode==='--capture')for(const [name,hash] of Object.entries(PINS))assert.equal(files[name]?.sha256,hash,'Wrong published baseline '+name);
    else {
      verifyVolumeII();verifyReviewedConnectionsPreserved();const prior=read(path.join(root,VOLUME_II_REPORT)),mei=read(path.join(root,MEI+'interlinear.json'));
      assert.deepEqual(Object.keys(mei),prior.canonicalOrder,'Unexpected pre-Anthology reader order');
      assert.equal(hashObject(Object.fromEntries(Object.entries(mei).filter(([ref])=>!ref.startsWith('Mei HaShiloach, Volume II, ')))),prior.preservedNonVolumeII.phrases,'Earlier Volume I or Anthology text changed before rebuild');
    }
    write(baselineFile,{release:RELEASE,mode,packSha256,files,semantic:captureSemanticState(sections)});console.log(JSON.stringify({ok:true,baselineFiles:Object.keys(files).length}));
  }
  else if(mode==='--prepare'){const {counts,anchors}=loadPack(option('--pack',PACK));console.log(JSON.stringify({ok:true,...counts,anchors}));}
  else if(mode==='--check-connections')console.log(JSON.stringify(verifyReviewedConnectionsPreserved({afterTzidkatSourceAccuracy:process.argv.includes('--after-tzidkat-source-accuracy')})));
  else if(mode==='--publish')publish();
  else if(mode==='--preview')publish({preview:true});
  else if(mode==='--offline')rebuildOffline();
  else if(mode==='--seal'){const catalogFile=path.join(root,'mcp-data/catalog.json'),catalog=read(catalogFile);catalog.version=read(path.join(root,'library/data/files.json')).version;write(catalogFile,catalog);const {changed,result}=await verify(),report=read(path.join(root,REPORT));report.changedFiles=changed;report.verification=result;write(path.join(root,REPORT),report);}
  else if(mode==='--verify')await verify();
  else if(mode==='--live-baseline')await liveBaseline();
  else if(mode==='--browser')await browserCheck();
  else if(mode==='--live')await verifyPublished();
  else throw new Error('Unknown mode '+mode);
}


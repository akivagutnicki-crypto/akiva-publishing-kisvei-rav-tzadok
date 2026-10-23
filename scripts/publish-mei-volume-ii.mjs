// A scoped successor to the current publication: Mei HaShiloach Volume II only.
// Historical releases remain immutable and are checked before this successor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {linkPhrase, visible} from './publish-reader-docx-import.mjs';
import {categoryOf} from './citations.mjs';

export const RELEASE = '20261023-mei-volume-ii-v1';
export const PACK = 'sources/akiva/overlays/mei-volume-ii-20261023.json.gz.b64';
export const REPORT = 'library/mei-volume-ii-20261023.json';
const REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
const SITE = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const MEI = 'library/data/mei-ha-shiloach/';
const II = 'Mei HaShiloach, Volume II, ';
const PIN = {run:39896984684, artifact:12477077790,
  commit:'936abff90441b9b94c0e2bf386d37b335ebd104f', bytes:716855520,
  digest:'sha256:0f5247a3dd8861baa539f5c8edb9a0005277f17c18a0b299addfd7af97a95531'};
const PINS = {
  'library/index.html':'0c0c5128319fb356cc8695410e117bc88ace88429d6de3bb1f5aef39e3b873c5',
  'library/sw.js':'97cfdc1539f8fb44a3676550c04578c474f40108f2a7bddf8636f6f5985cc712',
  'library/data/mei-ha-shiloach/interlinear.json':'1785055c1cb2ecfaddca7092d34bb007cfc5b69358077f0d657a17be44af5bd2',
  'library/data/mei-ha-shiloach/headings.json':'a9441a9d2ead98605028e075c2a31348aa5876e83be6907df6dfe960e73c922b',
  'library/data/mei-ha-shiloach/study-contents.json':'a24bc4c5032239d85246fd65a3da240685a3c6fb9f451bfc7b71d50b79314353',
  'library/data/mei-ha-shiloach/links.json':'4c65de71b9617a449bd478f68732533a2e59de361405f36044daebfc784fd731',
  'library/data/files.json':'a502b61b9cdb178e7e66b20d85eb5c450037914b9b7d5e081740b4e7086fc4b2',
  'mcp-data/catalog.json':'a8658f7ad02d4f9f358e49828602003160d98e884cc25e1fdd15ec89f6f116ae',
  'mcp-data/text/mei-hashiloach.json':'1b4fa3e295eb8f0ff511d5fd2cd00d4a6ce8695e17aa618296c5424778cafc5f',
  'library/share.js':'c81bd5dfd50047ce2ee6dc16c04bfcb1535c57747357d18f87103bf5b061cb27',
  'library/share.css':'53e5b2db820f488937c4fd6d46e00af593192c03b56a79f8755b864c731b9155'
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
const noII = object => Object.fromEntries(Object.entries(object).filter(([ref])=>!ref.startsWith(II)));
const flatten = node => node.children ? node.children.flatMap(flatten) : [node];
const citedSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const paragraphRef = (section,n) => section.ref+section.sep+n;
const option = (name,fallback) => {const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root = option('--root','dist');
const baselineFile = option('--baseline','mei-volume-ii-baseline.json');

export function loadPack(filename=PACK) {
  const bytes=fs.readFileSync(filename), pack=JSON.parse(filename.endsWith('.gz.b64') ? gunzipSync(Buffer.from(bytes.toString().trim(),'base64')) : bytes);
  assert.equal(pack.schemaVersion,1);assert.equal(pack.release,RELEASE);assert.equal(pack.book,'Mei HaShiloach');
  assert(Array.isArray(pack.sections)&&pack.sections.length,'Missing Volume II sections');
  assert(pack.references&&typeof pack.references==='object','Missing verified reference registry');
  const refs=new Set(), appliedOverrides=new Set();let anchors=0;
  const sections=pack.sections.map(input=>{
    const section={...input,sep:input.sep||(/\d[ab]?(?::\d+)*$/.test(input.ref)?':':' ')};
    assert(section.ref.startsWith(II)&&!refs.has(section.ref),'Unexpected or repeated Volume II reference: '+section.ref);refs.add(section.ref);
    assert([' ',':'].includes(section.sep));assert(Array.isArray(section.items)&&section.items.length);
    if(section.canonicalParagraphCount!==undefined)assert.equal(section.items.length,section.canonicalParagraphCount,'Canonical paragraph coverage mismatch '+section.ref);
    const canonical=pack.references[section.ref];assert(canonical?.verified&&canonical.ref===section.ref,'Unverified canonical section '+section.ref);
    assert.match(canonical.url,/^https:\/\/www\.sefaria\.org\//);
    const edges=[],seen=new Set();
    const addEdge=(n,ref)=>{const proof=pack.references[ref];assert(proof?.verified,'Unverified source '+ref);const a=paragraphRef(section,n),key=a+'\0'+proof.ref;if(!seen.has(key)){seen.add(key);edges.push({a,r:proof.ref,c:categoryOf(proof.ref)});}};
    section.items=section.items.map((item,index)=>{
      assert.equal(item.n,index+1,'Nonconsecutive canonical paragraph '+section.ref);assert(Array.isArray(item.p)&&item.p.length);
      const pairs=item.p.map(pair=>{
        assert(Array.isArray(pair)&&pair.length===2&&pair.every(s=>typeof s==='string'));
        assert.match(pair[0],/[א-ת]/);assert.match(pair[1],/[A-Za-z]/);assert.doesNotMatch(pair[1],/[\[\]]/);
        assert.doesNotMatch(pair[1],/^(?:TODO|TBD|translation pending|not yet translated)\b/i);
        return pair.map(text=>{
          assert.doesNotMatch(text,/<\/?[a-z][^>]*>/i,'Pack phrases must be plain text');
          const linked=linkPhrase(text,pack.references,pack.citationOverrides||[],{sectionRef:section.ref,sourceParagraphIndex:item.sourceParagraphIndex});
          anchors+=linked.anchors;linked.appliedOverrides.forEach(n=>appliedOverrides.add(n));
          for(const m of linked.html.matchAll(/data-ref="([^"]+)"/g))addEdge(item.n,visible(m[1]));
          return linked.html;
        });
      });
      for(const source of item.connections||[])addEdge(item.n,source.ref);
      return {...item,p:pairs};
    });
    section.edges=edges;return section;
  });
  for(const [i,override] of (pack.citationOverrides||[]).entries())if(override.required!==false)assert(appliedOverrides.has(i),'Citation correction did not apply: '+JSON.stringify(override));
  const counts={sections:sections.length,paragraphs:sections.reduce((n,s)=>n+s.items.length,0),phrasePairs:sections.reduce((n,s)=>n+s.items.reduce((m,p)=>m+p.p.length,0),0)};
  for(const [key,value] of Object.entries(pack.expectedCounts||{}))assert.equal(counts[key],value,'Pack count mismatch: '+key);
  return {pack,sections,counts,anchors,packSha256:sha(bytes)};
}

async function inventory(dir=root,prefix='',out={}) {
  for(const entry of fs.readdirSync(path.join(dir,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=prefix?prefix+'/'+entry.name:entry.name;assert(!entry.isSymbolicLink(),'Publication symlink: '+name);
    if(entry.isDirectory())await inventory(dir,name,out);else {assert(entry.isFile());const digest=createHash('sha256');let bytes=0;for await(const chunk of fs.createReadStream(path.join(dir,name))){digest.update(chunk);bytes+=chunk.length;}out[name]={bytes,sha256:digest.digest('hex')};}
  }return out;
}
const allowed = name => name===REPORT||[MEI+'interlinear.json',MEI+'headings.json',MEI+'study-contents.json',MEI+'links.json',
  'library/index.html','library/sw.js','library/data/files.json','library/data/packs/sources.json',
  'library/downloads/rav-tzadok-library.zip','library/downloads/index.json','mcp-data/catalog.json','mcp-data/cited.json','mcp-data/text/mei-hashiloach.json',IDEAS].includes(name)||/^library\/data\/cited\/[a-z0-9-]+\.json$/.test(name);
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
  return {nonVolumeIIPhrases:hashObject(noII(mei)),nonVolumeIIHeadings:hashObject(noII(heads)),nonVolumeIILinks:hashObject(noII(links)),
    nonVolumeIIContents:hashObject(load(MEI+'study-contents.json').toc.children.filter(node=>node.en!=='Volume II')),
    otherMcpBooks:hashObject(catalog.books.filter(b=>b.slug!=='mei-hashiloach')),
    otherMeiSections:hashObject(catalog.books.find(b=>b.slug==='mei-hashiloach').sections.filter(s=>!s.ref.startsWith(II)).map(({first,...section})=>section)),
    otherMeiParagraphs:hashObject(text.paras.filter(p=>!p.r.startsWith(II)).map(({s,...p})=>p)),
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
  sources.refs=[...new Set([...sources.refs,...sections.flatMap(s=>s.edges.map(e=>e.r))])].sort();write(sourceFile,sources);
}

function mcpParagraph(section,item,index) {
  const p={r:paragraphRef(section,item.n),s:index,n:item.n,p:item.p.map(pair=>pair.map(visible))},anchors={};
  item.p.forEach((pair,k)=>pair.forEach((html,side)=>{for(const m of html.matchAll(/<a\b[^>]*data-ref="([^"]+)"[^>]*>/g)){const ref=visible(m[1]);anchors[ref]??=[k,side?'e':'h',visible(html.slice(0,m.index)).length];}}));
  if(Object.keys(anchors).length)p.a=anchors;
  const citations=section.edges.filter(e=>e.a===p.r).map(e=>[e.r,e.c]);if(citations.length)p.c=citations;
  if(item.heading)p.h=[item.heading];if(item.transcriptionNotes?.length)p.x=item.transcriptionNotes;
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
  book.edition='Akiva Publishing interlinear translation (published sections); Volume II revised October 2026';
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

function reviseConnections(prepared) {
  const {pack,sections,packSha256}=prepared,filename=path.join(root,IDEAS),beforeBytes=fs.readFileSync(filename),catalog=JSON.parse(beforeBytes);
  const context=connectionContext(),overrides=new Map(),affected=[],preserved=[];
  for(const review of pack.reviewedConnectionOverrides||[]){
    assert(review.reviewed===true&&typeof review.reviewNote==='string'&&review.reviewNote.trim(),'Missing explicit contextual review');
    assert(typeof review.id==='string'&&!overrides.has(review.id),'Repeated connection review '+review.id);overrides.set(review.id,review);
  }
  for(const row of catalog.records){
    if(!changedOrigin(row.targetRef,sections)){assert(!overrides.has(row.id),'Connection review lies outside this release '+row.id);preserved.push(row);continue;}
    const before=structuredClone(row),review=overrides.get(row.id);
    if(review){
      assert.equal(review.targetRef,row.targetRef);assert.equal(review.previousHebrewSha256,row.reviewedTargetHebrewSha256);
      assert.equal(review.previousQuoteHebrew,row.targetHebrew);assert.equal(review.previousQuoteEnglish,row.targetEnglish);
      assert.equal(review.expectedExplanation,row.explanation,'Connection claim differs from the reviewed predecessor '+row.id);
      assert.match(review.reviewedHebrewSha256,/^[a-f0-9]{64}$/);assert.match(review.targetHebrew,/[א-ת]/);assert.match(review.targetEnglish,/[A-Za-z]/);assert.doesNotMatch(review.targetEnglish,/[\[\]]/);
      row.targetHebrew=review.targetHebrew;row.targetEnglish=review.targetEnglish;row.reviewedTargetHebrewSha256=review.reviewedHebrewSha256;
      for(const key of ['explanation','translationProvenance'])if(review[key]!==undefined){assert(typeof review[key]==='string'&&review[key].trim());row[key]=review[key];}
      if(row.reverseExplanation){assert.match(review.reviewedTargetSectionHebrewSha256||'',/^[a-f0-9]{64}$/);row.reviewedTargetSectionHebrewSha256=review.reviewedTargetSectionHebrewSha256;}
      overrides.delete(row.id);
    }
    const derived=targetEvidence(row,context);
    assert.equal(derived.evidence.fullHebrewSha256,row.reviewedTargetHebrewSha256,'Changed full context requires explicit editorial review: '+row.id);
    if(row.reverseExplanation)assert.equal(derived.evidence.sectionHebrewSha256,row.reviewedTargetSectionHebrewSha256,'Changed reciprocal section requires full editorial review: '+row.id);
    Object.assign(row.placement,derived.placement);row.evidence.target=derived.evidence;row.evidence.targetEnglishSha256=sha(row.targetEnglish);
    row.evidence.meiVolumeIIReview={release:RELEASE,packSha256,kind:review?'explicit-contextual-review':'unchanged-reviewed-context',
      ...(review?{reviewNote:review.reviewNote}:{}),previousTargetHebrewSha256:before.reviewedTargetHebrewSha256};
    affected.push({id:row.id,ref:row.targetRef,beforeSha256:hashObject(before),afterSha256:hashObject(row),contextualReview:!!review});
  }
  assert.equal(overrides.size,0,'Unknown connection review IDs: '+[...overrides.keys()].join(', '));
  if(affected.length){
    const coverage=catalog.coverage.find(book=>book.book==='Mei HaShiloach');assert(coverage);coverage.sections=new Set(context.book.sections.map(s=>s.ref)).size;
    catalog.provenance.meiVolumeII={release:RELEASE,packSha256,textSha256:context.textSha256,reviewedRecordIds:affected.map(x=>x.id)};
    catalog.contentSha256=sha(canonical({release:catalog.release,records:catalog.records,coverage:catalog.coverage,provenance:catalog.provenance}));
    catalog.version=catalog.release+'-'+catalog.contentSha256.slice(0,16);fs.writeFileSync(filename,JSON.stringify(catalog,null,2)+'\n');
  }
  return {beforeSha256:sha(beforeBytes),afterSha256:sha(fs.readFileSync(filename)),preservedRecordsSha256:hashObject(preserved),recordIds:catalog.records.map(row=>row.id),amendedRecords:affected};
}

export function verifyConnectedIdeasSuccessor({directory=root,packFile=option('--pack',PACK)}={}) {
  const prepared=loadPack(packFile),report=read(path.join(directory,REPORT)),proof=report.connectedIdeas;assert(proof,'Missing scoped Connected Ideas proof');
  assert.equal(report.release,RELEASE);
  assert.equal(report.packSha256,prepared.packSha256);assert.equal(sha(fs.readFileSync(path.join(directory,IDEAS))),proof.afterSha256);
  const catalog=read(path.join(directory,IDEAS)),ids=new Set(proof.amendedRecords.map(row=>row.id));
  assert.deepEqual(catalog.records.map(row=>row.id),proof.recordIds,'Connection records added, removed or reordered');
  assert.equal(hashObject(catalog.records.filter(row=>!ids.has(row.id))),proof.preservedRecordsSha256,'Unrelated connection record changed');
  const context=connectionContext(directory);
  for(const entry of proof.amendedRecords){
    const row=catalog.records.find(row=>row.id===entry.id);assert(row&&changedOrigin(row.targetRef,prepared.sections));assert.equal(hashObject(row),entry.afterSha256);
    const derived=targetEvidence(row,context);assert.deepEqual(row.evidence.target,derived.evidence);
    for(const [key,value] of Object.entries(derived.placement))assert.equal(row.placement[key],value);
    assert.equal(row.reviewedTargetHebrewSha256,derived.evidence.fullHebrewSha256);
    if(row.reverseExplanation)assert.equal(row.reviewedTargetSectionHebrewSha256,derived.evidence.sectionHebrewSha256);
    assert.equal(row.evidence.targetEnglishSha256,sha(row.targetEnglish));
    const review=prepared.pack.reviewedConnectionOverrides?.find(r=>r.id===row.id);
    assert.equal(entry.contextualReview,!!review);if(review){assert.equal(row.targetHebrew,review.targetHebrew);assert.equal(row.targetEnglish,review.targetEnglish);assert.equal(row.reviewedTargetHebrewSha256,review.reviewedHebrewSha256);}
  }
  return {release:RELEASE,catalogSha256:proof.afterSha256,amendedRecords:proof.amendedRecords.length,preservedRecords:catalog.records.length-proof.amendedRecords.length};
}

export function verifySourceConnectionsPreserved({directory=root}={}) {
  const report=read(path.join(directory,REPORT));assert.equal(report.release,RELEASE);
  assert.equal(report.packSha256,loadPack(option('--pack',PACK)).packSha256);
  for(const [name,hash] of Object.entries(report.preservedConnectionFiles||{}))assert.equal(sha(fs.readFileSync(path.join(directory,name))),hash,'Unrelated source-connection evidence changed '+name);
  assert(report.preservedConnectionFiles?.[SOURCE_CONNECTIONS],'Missing predecessor source-connection proof');
  const context=connectionContext(directory);
  for(const row of read(path.join(directory,SOURCE_CONNECTIONS)).records)if(row.targetRef.startsWith('Mei HaShiloach,')){
    const match=context.paragraphs.get(row.targetRef);assert(match);const full=context.normalize(paragraphHebrew(match.paragraph));
    assert.equal(sha(full),row.reviewedTargetHebrewSha256,'Earlier reviewed source context changed '+row.id);
    assert((' '+full+' ').includes(' '+context.normalize(row.targetHebrew)+' '),'Earlier reviewed source quote disappeared '+row.id);
  }
  return {release:RELEASE,preservedConnectionFiles:Object.keys(report.preservedConnectionFiles).length};
}

function connectionReview() {
  const prepared=loadPack(option('--pack',PACK)),context=connectionContext(),sections=new Map(prepared.sections.map(s=>[s.ref,s])),changes=[];
  const records=read(path.join(root,IDEAS)).records;
  for(const row of records){
    const old=context.paragraphs.get(row.targetRef);if(!old||!sections.has(old.section.ref))continue;
    const section=sections.get(old.section.ref),item=section.items.find(item=>paragraphRef(section,item.n)===row.targetRef);assert(item,'Reviewed target is absent from the new pack '+row.targetRef);
    const next=mcpParagraph(section,item,old.paragraph.s),oldHebrew=paragraphHebrew(old.paragraph),newHebrew=paragraphHebrew(next),oldFullHash=sha(context.normalize(oldHebrew)),newFullHash=sha(context.normalize(newHebrew));
    const oldSection=context.text.paras.slice(old.section.first,old.section.first+old.section.count),newSection=section.items.map(item=>mcpParagraph(section,item,old.paragraph.s));
    const oldSectionHash=sha(context.normalize(oldSection.map(paragraphHebrew).join(' '))),newSectionHash=sha(context.normalize(newSection.map(paragraphHebrew).join(' ')));
    if(oldFullHash===newFullHash&&(!row.reverseExplanation||oldSectionHash===newSectionHash))continue;
    changes.push({id:row.id,targetRef:row.targetRef,sectionRef:section.ref,oldFullHebrewSha256:oldFullHash,newFullHebrewSha256:newFullHash,
      oldSectionHebrewSha256:oldSectionHash,newSectionHebrewSha256:newSectionHash,reciprocal:!!row.reverseExplanation,
      oldFullHebrew:oldHebrew,newFullHebrew:newHebrew,oldFullEnglish:paragraphEnglish(old.paragraph),newFullEnglish:paragraphEnglish(next),
      oldPhrasePairs:old.paragraph.p||null,newPhrasePairs:next.p,record:row,
      ...(row.reverseExplanation?{oldFullSection:oldSection,newFullSection:newSection}:{}),
      reviewRequirement:'Read the full new context and the original connection claim. Confirm or revise the exact Hebrew excerpt and its English translation; a reciprocal connection also requires review of the complete new target section. The publisher does not approve these changes automatically.'});
  }
  const output=option('--output','mei-volume-ii-connection-review.json');fs.writeFileSync(output,JSON.stringify({packSha256:prepared.packSha256,changedRecords:changes.length,records:changes},null,2)+'\n');
  console.log(JSON.stringify({ok:true,changedRecords:changes.length,output}));
}

function verifyExistingConnections() {
  const require=createRequire(import.meta.url),normal=require(path.resolve(root,'library/source-connections.js')).normalizedHebrew;
  const mcp=read(path.join(root,'mcp-data/text/mei-hashiloach.json')),paragraphs=new Map(mcp.paras.map(p=>[p.r,p]));
  const conflicts=[];
  for(const file of ['library/connected-ideas/catalog.json','library/source-connections/catalog.json']){
    if(!fs.existsSync(path.join(root,file)))continue;
    for(const row of read(path.join(root,file)).records||[])for(const role of ['origin','target']){
      const ref=row[role+'Ref'];if(!ref?.startsWith(II))continue;const paragraph=paragraphs.get(ref);assert(paragraph,'Existing connection reference disappeared '+ref);
      const full=paragraph.p?paragraph.p.map(pair=>pair[0]).join(' '):paragraph.t;
      const pin=row['reviewed'+role[0].toUpperCase()+role.slice(1)+'HebrewSha256'];
      if(pin&&pin!==sha(normal(full)))conflicts.push({id:row.id,ref,role,reason:'Full Hebrew context changed and requires editorial re-review'});
    }
  }
  assert.equal(conflicts.length,0,'Existing approved connections need contextual review: '+JSON.stringify(conflicts));
}

export function publish() {
  const filename=option('--pack',PACK),prepared=loadPack(filename),{pack,sections,counts,anchors,packSha256}=prepared;
  if(path.resolve(filename)===path.resolve(PACK))assert.equal(pack.editorialStage,'reviewed','Production Volume II pack has not completed editorial review');
  const reportFile=path.join(root,REPORT);
  if(fs.existsSync(reportFile)){const report=read(reportFile);assert.equal(report.release,RELEASE);assert.equal(report.packSha256,packSha256);console.log(JSON.stringify({ok:true,mode:'already-applied',release:RELEASE}));return report;}
  const meiFile=path.join(root,MEI+'interlinear.json'),mei=read(meiFile),heads=read(path.join(root,MEI+'headings.json')),links=read(path.join(root,MEI+'links.json'));
  const oldOrder=Object.keys(mei),oldII=oldOrder.filter(ref=>ref.startsWith(II)),volumeIIOrder=pack.volumeIIOrder||sections.map(s=>s.ref);
  const preservedConnectionFiles=Object.fromEntries([SOURCE_CONNECTIONS,'library/source-connections/translations.json','library/connected-ideas/review-progress.json']
    .map(name=>[name,sha(fs.readFileSync(path.join(root,name)))]));
  assert.equal(new Set(volumeIIOrder).size,volumeIIOrder.length);assert(volumeIIOrder.every(ref=>ref.startsWith(II)));
  for(const ref of new Set([...oldII,...sections.map(s=>s.ref)]))assert(volumeIIOrder.includes(ref),'Canonical Volume II order omitted '+ref);
  const preserved={phrases:hashObject(noII(mei)),heads:hashObject(noII(heads)),links:hashObject(noII(links))};
  for(const section of sections){
    mei[section.ref]=section.items.map(item=>item.p);heads[section.ref]={title:section.title||section.ref.split(', ').at(-1),he:section.he||'',sourceUrl:pack.references[section.ref].url,sep:section.sep,
      headings:section.items.map(item=>item.heading||''),phraseHeadings:section.phraseHeadings||{},...(section.items.some(item=>item.transcriptionNotes?.length)?{transcriptionNotes:Object.fromEntries(section.items.map((item,i)=>[i,item.transcriptionNotes||[]]).filter(([,v])=>v.length))}:{})};links[section.ref]=section.edges;
  }
  assert(volumeIIOrder.every(ref=>Object.hasOwn(mei,ref)),'Canonical Volume II order includes unpublished text');
  const order=[...oldOrder.filter(ref=>ref.startsWith('Mei HaShiloach, Volume I, ')),...volumeIIOrder,...oldOrder.filter(ref=>!ref.startsWith('Mei HaShiloach, Volume I, ')&&!ref.startsWith(II))];
  assert.equal(order.length,Object.keys(mei).length,'Reader order lost a section');
  const study=read(path.join(root,MEI+'study-contents.json')),oldNode=study.toc.children.findIndex(node=>node.en==='Volume II');assert(oldNode>=0);
  const node={en:'Volume II',he:'חלק ב',children:[]};
  for(const ref of volumeIIOrder){const parts=ref.split(', '),category=parts.slice(2,-1).join(' · ');let target=node;if(category){target=node.children.find(x=>x.en===category);if(!target)node.children.push(target={en:category,he:'',children:[]});}target.children.push({ref,en:heads[ref]?.title||parts.at(-1),he:heads[ref]?.he||'',depth:1,shape:mei[ref].length,interlinear:true,sep:heads[ref]?.sep||' '});}
  study.toc.children[oldNode]=node;study.volumeIIRelease=RELEASE;
  write(meiFile,Object.fromEntries(order.map(ref=>[ref,mei[ref]])));write(path.join(root,MEI+'headings.json'),heads);write(path.join(root,MEI+'study-contents.json'),study);write(path.join(root,MEI+'links.json'),links);
  assert.equal(hashObject(noII(mei)),preserved.phrases);assert.equal(hashObject(noII(heads)),preserved.heads);assert.equal(hashObject(noII(links)),preserved.links);
  updateReverseIndexes(sections);updateMcp(sections,order,heads);const connectedIdeas=reviseConnections(prepared);verifyExistingConnections();
  const htmlFile=path.join(root,'library/index.html');let html=fs.readFileSync(htmlFile,'utf8');assert.equal((html.match(/const meiStudyRefs = new Set\(/g)||[]).length,1);
  html=html.replace(/const meiStudyRefs = new Set\(\[[\s\S]*?\]\);/,'const meiStudyRefs = new Set('+JSON.stringify(order,null,2)+');');
  const description='Volume I teachings, with selections from Volume II and the anthology.';assert.equal(html.split(description).length,2);
  html=html.replace(description,'Volumes I and II, with selections from the anthology.');
  const cachePrefix='const editionDataUrl = url => ';assert.equal(html.split(cachePrefix).length,2);
  html=html.replace(cachePrefix,cachePrefix+`(url.startsWith('data/mei-ha-shiloach/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition=${RELEASE}' :\n`);fs.writeFileSync(htmlFile,html);
  const swFile=path.join(root,'library/sw.js'),sw=fs.readFileSync(swFile,'utf8');assert(/const SHELL = `([^`]+)`;/.test(sw));fs.writeFileSync(swFile,sw.replace(/const SHELL = `([^`]+)`;/,'const SHELL = `$1-'+RELEASE+'`;'));
  const report={schemaVersion:1,release:RELEASE,packSha256,counts,sourceAnchors:anchors,sourceConnections:sections.reduce((n,s)=>n+s.edges.length,0),canonicalOrder:order,volumeIIOrder,
    replacedSections:sections.filter(s=>oldII.includes(s.ref)).map(s=>s.ref),addedSections:sections.filter(s=>!oldII.includes(s.ref)).map(s=>s.ref),preservedNonVolumeII:preserved,
    sectionHashes:Object.fromEntries(sections.map(s=>[s.ref,hashObject(mei[s.ref])])),connectedIdeas,preservedConnectionFiles,
    scope:'Uploaded and reviewed Volume II interlinear edition; other volumes and works preserved'};
  write(reportFile,report);console.log(JSON.stringify({ok:true,mode:'published',...counts,sourceAnchors:anchors,sourceConnections:report.sourceConnections}));return report;
}

async function githubGet(route){const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;const response=await fetch('https://api.github.com/repos/'+REPO+route,{headers,signal:AbortSignal.timeout(30000)});assert(response.ok,'GitHub metadata '+response.status+' '+route);return response.json();}
async function verifyHead(){assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.match(process.env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.equal((await githubGet('/git/ref/heads/main')).object.sha,process.env.GITHUB_SHA,'Main advanced; stop before overwriting intervening work');}
async function liveBytes(name){const url=new URL(name,SITE);url.searchParams.set('mei-volume-ii-check',String(Date.now()));const response=await fetch(url,{headers:{'Cache-Control':'no-cache'},cache:'no-store',signal:AbortSignal.timeout(60000)});assert(response.ok,'Public asset '+response.status+' '+name);return Buffer.from(await response.arrayBuffer());}
async function liveBaseline(){await verifyHead();for(const [name,hash] of Object.entries(PINS))assert.equal(sha(await liveBytes(name)),hash,'Live publication changed: '+name);}
async function verifyPublished(){
  const report=read(path.join(root,REPORT));assert(report.changedFiles?.length,'Publication was not sealed');
  const files=[...report.changedFiles,{path:REPORT,sha256:sha(fs.readFileSync(path.join(root,REPORT)))}];
  for(let first=0;first<files.length;first+=4)await Promise.all(files.slice(first,first+4).map(async file=>{
    for(let attempt=1;attempt<=6;attempt++)try{assert.equal(sha(await liveBytes(file.path)),file.sha256,'Published bytes differ '+file.path);return;}
    catch(error){if(attempt===6)throw error;console.log('Waiting for public asset refresh ('+attempt+'/6): '+file.path);await new Promise(resolve=>setTimeout(resolve,10000));}
  }));
  write('mei-volume-ii-live-verification.json',{ok:true,release:RELEASE,files:files.length});console.log('Verified all published changed files against the checked release.');
}

async function verify(){
  const {sections,packSha256,counts}=loadPack(option('--pack',PACK)),baseline=read(baselineFile),current=await inventory(),report=read(path.join(root,REPORT));assert.equal(report.packSha256,packSha256);assert.deepEqual(report.counts,counts);
  let protectedFiles=0;for(const [name,before] of Object.entries(baseline.files)){assert(current[name],'Existing file deleted: '+name);if(!allowed(name)){assert.equal(current[name].sha256,before.sha256,'Unrelated publication file changed: '+name);protectedFiles++;}}
  for(const name of Object.keys(current))assert(baseline.files[name]||allowed(name),'Unexpected new publication file '+name);
  const state=captureSemanticState(sections);for(const key of ['nonVolumeIIPhrases','nonVolumeIIHeadings','nonVolumeIILinks','nonVolumeIIContents','otherMcpBooks','otherMeiSections','otherMeiParagraphs','mcpCitations','unaffectedIdeaRecords'])assert.equal(state[key],baseline.semantic[key],'Unrelated semantic content changed: '+key);
  assert.deepEqual(state.ideaRecordIds,baseline.semantic.ideaRecordIds,'Existing connection identities changed');
  for(const [name,hash] of Object.entries(baseline.semantic.reverse))assert.equal(state.reverse[name],hash,'Other citing passages changed: '+name);
  assert(baseline.semantic.citedSources.every(slug=>state.citedSources.includes(slug)),'Existing reverse-citation source key lost');
  assert(baseline.semantic.sourceRefs.every(ref=>state.sourceRefs.includes(ref)),'Existing offline source reference lost');
  const mei=read(path.join(root,MEI+'interlinear.json')),toc=read(path.join(root,MEI+'study-contents.json'));assert.deepEqual(flatten(toc.toc).map(x=>x.ref),report.canonicalOrder);
  for(const section of sections)assert.equal(hashObject(mei[section.ref]),hashObject(section.items.map(item=>item.p)),'Imported phrase pairs changed '+section.ref);
  const mcp=read(path.join(root,'mcp-data/text/mei-hashiloach.json')),book=read(path.join(root,'mcp-data/catalog.json')).books.find(b=>b.slug==='mei-hashiloach');
  assert.equal(new Set(mcp.paras.map(p=>p.r)).size,mcp.paras.length,'Duplicate canonical MCP paragraph');
  const heads=read(path.join(root,MEI+'headings.json'));
  for(const section of sections){const index=book.sections.findIndex(s=>s.ref===section.ref),entry=book.sections[index];assert(entry?.il);assert.equal(entry.count,section.items.length);assert.deepEqual(heads[section.ref].headings,section.items.map(item=>item.heading||''));const rows=mcp.paras.slice(entry.first,entry.first+entry.count);for(const [i,row] of rows.entries()){assert.equal(row.s,index);assert.equal(row.r,paragraphRef(section,i+1));assert.deepEqual(row.p,section.items[i].p.map(pair=>pair.map(visible)),'MCP lost or altered a phrase in '+row.r);assert.deepEqual(row.h||[],section.items[i].heading?[section.items[i].heading]:[],'MCP heading differs in '+row.r);}}
  const manifest=read(path.join(root,'library/data/files.json'));for(const name of ['mei-ha-shiloach/interlinear.json','mei-ha-shiloach/headings.json','mei-ha-shiloach/study-contents.json','mei-ha-shiloach/links.json'])assert(manifest.files.includes(name),'Missing offline data '+name);
  verifyExistingConnections();verifyConnectedIdeasSuccessor();verifySourceConnectionsPreserved();
  const changed=Object.entries(current).filter(([name,record])=>name!==REPORT&&baseline.files[name]?.sha256!==record.sha256).map(([name,record])=>({path:name,...record}));
  const result={ok:true,release:RELEASE,protectedFiles,changedFiles:changed.length,...counts};write('mei-volume-ii-verification.json',result);console.log(JSON.stringify(result));return {changed,result};
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
  if(citationRef)assert(pack.references[citationRef]?.verified,'Requested browser citation is not verified: '+citationRef);
  const samples=[...new Set([requested,sections[0],sections.at(-1),...['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Prophets','Writings','Talmud'].map(category=>sections.find(s=>s.ref.includes(', '+category+', '))),sections[Math.floor(sections.length/2)]].filter(Boolean))];
  const hash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
  const browser=await playwright.chromium.launch({headless:true,...(process.env.READER_CHROMIUM_EXECUTABLE?{executablePath:process.env.READER_CHROMIUM_EXECUTABLE}:{})});fs.mkdirSync('artifacts/mei-volume-ii',{recursive:true});
  try{for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));});
    await context.route('https://www.sefaria.org/**',route=>route.fulfill({status:200,contentType:'application/json',body:route.request().url().includes('/api/links/')?'[]':'{"he":[],"text":[],"versions":[]}'}));
    await page.goto(base+'#/book/Mei_HaShiloach');const toc=page.locator('#toc .study-entry a[href^="#/read/Mei_HaShiloach,"]');await toc.last().waitFor();assert.equal(await toc.count(),report.canonicalOrder.length);
    for(const section of samples){await page.goto(base+'#/read/'+hash(section.ref));const element=page.locator('#text > .sec').filter({has:page.locator('.seg[data-ref="'+paragraphRef(section,1)+'"]')}).first();await element.locator('.ph-he').first().waitFor();const expected=section.items.flatMap(item=>item.p);assert.deepEqual((await element.locator('.ph-he').allTextContents()).map(s=>s.trim()),expected.map(p=>visible(p[0]).trim()));assert.deepEqual((await element.locator('.ph-en').allTextContents()).map(s=>s.trim()),expected.map(p=>visible(p[1]).trim()));assert.deepEqual((await element.locator(':scope > .subhead').allTextContents()).map(s=>s.trim()),section.items.flatMap(item=>(item.heading||'').split('\n').filter(Boolean).map(title=>title.startsWith('§ ')?title.slice(2):title)),'Displayed topical headings differ in '+section.ref);assert.doesNotMatch((await element.locator('.ph-en').allTextContents()).join(''),/[\[\]]/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Horizontal overflow '+section.ref);}
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
    await page.locator('#akivaShareButton').waitFor({state:'visible'});await page.screenshot({path:'artifacts/mei-volume-ii/reader-'+viewport.width+'.png',fullPage:false});assert.deepEqual(errors,[]);await context.close();console.log(JSON.stringify({ok:true,viewport,sampledSections:samples.length,contents:report.canonicalOrder.length,sourcePopup:!!sourceSection,...(citationRef?{checkedCitation:citationRef,citationUrl:pack.references[citationRef].url}:{}),deepLink:true}));
  }}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2]||'--publish';
  if(mode==='--metadata'){const [artifact,run]=await Promise.all([githubGet('/actions/artifacts/'+PIN.artifact),githubGet('/actions/runs/'+PIN.run)]);assert.equal(artifact.name,'github-pages');assert.equal(artifact.expired,false);assert.equal(artifact.size_in_bytes,PIN.bytes);assert.equal(artifact.digest,PIN.digest);assert.equal(artifact.workflow_run.head_sha,PIN.commit);assert.equal(run.head_sha,PIN.commit);assert.equal(run.conclusion,'success');await liveBaseline();write('mei-volume-ii-artifact.json',{pin:PIN,artifact,run:{id:run.id,conclusion:run.conclusion,head_sha:run.head_sha}});console.log('Verified current published baseline and branch head.');}
  else if(mode==='--capture'||mode==='--capture-rebuild'){
    const {sections,packSha256}=loadPack(option('--pack',PACK)),files=await inventory();
    if(mode==='--capture')for(const [name,hash] of Object.entries(PINS))assert.equal(files[name]?.sha256,hash,'Wrong published baseline '+name);
    else {
      // A future full build has already run the predecessor's own proof gates.
      // Verify its complete Mei identity again without requiring unrelated
      // generated timestamps to match the previously deployed Pages artifact.
      const prior=read(path.join(root,'library/reader-docx-import-20261022.json')),mei=read(path.join(root,MEI+'interlinear.json'));
      assert.equal(prior.release,'20261022-reader-docx-import-v1');assert.deepEqual(Object.keys(mei),prior.canonicalOrder);
      const pins={...prior.previousMeiSectionSha256,...Object.fromEntries(prior.sections.filter(s=>s.book==='Mei HaShiloach').map(s=>[s.ref,s.sha256]))};
      assert.equal(Object.keys(pins).length,Object.keys(mei).length,'Incomplete predecessor Mei proofs');
      for(const [ref,hash] of Object.entries(pins))assert.equal(hashObject(mei[ref]),hash,'Predecessor Mei text changed '+ref);
    }
    write(baselineFile,{release:RELEASE,mode,packSha256,files,semantic:captureSemanticState(sections)});console.log(JSON.stringify({ok:true,baselineFiles:Object.keys(files).length}));
  }
  else if(mode==='--prepare'){const {counts,anchors}=loadPack(option('--pack',PACK));console.log(JSON.stringify({ok:true,...counts,anchors}));}
  else if(mode==='--connection-review')connectionReview();
  else if(mode==='--publish')publish();
  else if(mode==='--offline')rebuildOffline();
  else if(mode==='--seal'){const catalogFile=path.join(root,'mcp-data/catalog.json'),catalog=read(catalogFile);catalog.version=read(path.join(root,'library/data/files.json')).version;write(catalogFile,catalog);const {changed,result}=await verify(),report=read(path.join(root,REPORT));report.changedFiles=changed;report.verification=result;write(path.join(root,REPORT),report);}
  else if(mode==='--verify')await verify();
  else if(mode==='--live-baseline')await liveBaseline();
  else if(mode==='--browser')await browserCheck();
  else if(mode==='--live')await verifyPublished();
  else throw new Error('Unknown mode '+mode);
}

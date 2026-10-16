// Reviewed uploaded Word text. Run the publisher AFTER the archive/headline passes.
// Preserve the supplied original; explicitly record verified quotation repairs.
// No Sefaria body is substituted and no phrase is merged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {categoryOf, normalizeRef} from './citations.mjs';

export const PACK_PATH='sources/akiva/overlays/pri-shevat-tubishvat.json.gz.b64';
// Filled with the checksum of the final reviewed, compressed package before release.
export const PACK_SHA256='399c2228eea0a0cfc6a750a4b35410e2da32a2b869d19af8ba58d8175e007fc1';
export const SOURCE_DOCX_SHA256='9df2f893409a04329e83f67fdcbb5f2d03dc893bb07546da886685dc19250d3b';
export const SOURCE_BODY_SHA256='8ab30016f6ddc9d0a8e6f603a22e1519d9fc130c8084cbc808109a49c8494f54';
export const BOOK='Peri Tzadik', SLUG='peri-tzadik';
export const GROUPS=[
  {node:'Rosh Chodesh Shvat',en:'Rosh Chodesh Shevat · 6 teachings',he:'ראש חודש שבט',count:6},
  {node:'Tu BiShvat',en:'Tu BiShvat · 5 teachings',he:'ט״ו בשבט',count:5},
];
export const sectionRef=section=>`${BOOK}, ${section.node} ${section.chapter}`;
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const leavesOf=node=>node.children?node.children.flatMap(leavesOf):[node];
export const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const compact=value=>String(value).replace(/\s/gu,'');
const expected=GROUPS.flatMap(group=>Array.from({length:group.count},(_,i)=>`${group.node} ${i+1}`));
const sourceIndexes=[[1],[3,4],[6],[8],[10],[12,13],[16,17],[19,20],[22],[24],[26]];

function verified(source){
  assert.ok(typeof source.ref==='string'&&source.ref.trim()&&normalizeRef(source.ref)===source.ref,'Noncanonical source ref');
  const url=new URL(source.url);
  assert.equal(url.origin,'https://www.sefaria.org','A source must point to the verified Sefaria text');
  assert.ok(url.pathname.length>1&&!/^\/(?:search|topics|sheets|api)(?:\/|$)/i.test(url.pathname),'Source is not a text reference');
  return source;
}
function noFootnotes(value){
  if(Array.isArray(value))return value.forEach(noFootnotes);
  if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
    if(/^footnotes?$/i.test(key))assert.ok(!item?.length,'The uploaded text has no source footnotes');
    noFootnotes(item);
  }
  else if(typeof value==='string')assert.doesNotMatch(value,/<(?:a|span|sup)\b[^>]*(?:footnote|doc-noteref)/i);
}

// Each exact anchor is escaped only after its position is found in the plain pair.
// This preserves every visible character and fails instead of guessing an anchor.
export function linkedText(text,links,language){
  const key=language==='hebrew'?'hebrewText':'englishText',spans=[];
  for(const link of links||[]){
    verified(link);
    if(!link[key])continue;
    const anchor=link[key],at=text.indexOf(anchor);
    assert.ok(at>=0,`Missing ${language} anchor: ${anchor}`);
    assert.equal(text.indexOf(anchor,at+anchor.length),-1,`Ambiguous ${language} anchor: ${anchor}`);
    const duplicate=spans.find(s=>s.at===at&&s.end===at+anchor.length&&s.ref===link.ref);
    if(!duplicate)spans.push({at,end:at+anchor.length,ref:link.ref,url:link.url});
  }
  spans.sort((a,b)=>a.at-b.at);
  let at=0,out='';
  for(const span of spans){
    assert.ok(span.at>=at,'Overlapping source anchors');
    out+=escapeHtml(text.slice(at,span.at))+`<a data-ref="${escapeHtml(span.ref)}" href="${escapeHtml(span.url)}">${escapeHtml(text.slice(span.at,span.end))}</a>`;
    at=span.end;
  }
  return out+escapeHtml(text.slice(at));
}

export function readPriShevatTuBiShvat(){
  const bytes=Buffer.from(fs.readFileSync(PACK_PATH,'utf8').replace(/\s/g,''),'base64');
  assert.equal(sha256(bytes),PACK_SHA256,'Reviewed Shevat/Tu BiShvat source package checksum changed');
  const pack=JSON.parse(gunzipSync(bytes).toString('utf8'));
  assert.equal(pack.book,BOOK);assert.equal(pack.schemaVersion,1);
  assert.equal(pack.source?.source?.sha256,SOURCE_DOCX_SHA256,'Uploaded Word source changed');
  assert.equal(pack.source?.audit?.bodyTextSha256,SOURCE_BODY_SHA256,'Uploaded Hebrew source changed');
  assert.equal(sha256(pack.source.sections.flatMap(section=>section.paragraphs).join('')),SOURCE_BODY_SHA256,
    'Source paragraph bytes no longer match the uploaded Word extraction');
  assert.deepEqual(pack.source.sections.map(s=>`${s.node} ${s.chapter}`),expected);
  assert.deepEqual(pack.sections.map(s=>`${s.node} ${s.chapter}`),expected,'Publish all eleven teachings in order');
  assert.equal(pack.source.audit.bodyParagraphCount??pack.source.audit.sourceBodyParagraphs??
    pack.source.sections.reduce((n,s)=>n+s.paragraphs.length,0),15);
  let paragraphs=0;
  for(const [index,section]of pack.sections.entries()){
    const original=pack.source.sections[index];
    assert.equal(original.canonicalRef,sectionRef(section));
    assert.deepEqual(original.paragraphIndexes,sourceIndexes[index]);
    assert.ok(section.title&&/[A-Za-z]/.test(section.title),'English teaching headline required');
    assert.ok(section.sourceLabel&&/[א-ת]/.test(section.sourceLabel),'Hebrew source label required');
    assert.equal(section.paragraphs.length,original.paragraphs.length,'Uploaded paragraph boundaries changed');
    assert.ok(section.connections?.length,'Every teaching needs verified Sefaria connections');
    section.connections.forEach(connection=>{verified(connection);assert.ok(connection.label);});
    for(const [p,paragraph]of section.paragraphs.entries()){
      paragraphs++;
      assert.equal(paragraph.sourceParagraphIndex,original.paragraphIndexes[p]);
      assert.equal(paragraph.original,original.paragraphs[p],'Uploaded source paragraph changed');
      assert.ok(paragraph.pairs?.length,'Empty interlinear paragraph');
      assert.equal(compact(paragraph.pairs.map(pair=>pair.original).join('')),compact(paragraph.original),
        'Original phrase coverage must match the uploaded source exactly apart from whitespace');
      let last=-1;
      for(const heading of paragraph.headings||[]){
        assert.ok(Number.isInteger(heading.phraseIndex)&&heading.phraseIndex>last&&heading.phraseIndex<paragraph.pairs.length,'Subheading phrase boundary changed');
        assert.ok(heading.text&&/[A-Za-z]/.test(heading.text));last=heading.phraseIndex;
      }
      for(const pair of paragraph.pairs){
        assert.equal(typeof pair.original,'string');
        assert.match(pair.hebrew,/[א-ת]/);assert.match(pair.hebrew,/[\u05b0-\u05bc\u05c1\u05c2\u05c7]/,'Hebrew must have nikkud');
        assert.match(pair.english,/[A-Za-z]/);
        assert.doesNotMatch(pair.hebrew+pair.english,/<[^>]*>|[\u0600-\u06ff\ufffd]/,'Plain pair contains markup or corrupted letters');
        assert.doesNotMatch(pair.english,/[\[\]]/,'English brackets returned');
        for(const link of pair.links||[])verified(link);
        linkedText(pair.hebrew,pair.links,'hebrew');linkedText(pair.english,pair.links,'english');
      }
    }
    assert.ok(section.paragraphs.some(p=>p.headings?.length),'English in-text subheadings required');
    noFootnotes(section.paragraphs);
  }
  assert.equal(paragraphs,15);
  const documentFiles=new Set();
  for(const document of pack.documents||[]){
    assert.match(document.file,/^downloads\/pri-tzaddik-[a-z0-9-]+\.docx$/);
    assert.ok(!documentFiles.has(document.file),'Duplicate Word asset');documentFiles.add(document.file);
    assert.ok(document.label);assert.equal(sha256(Buffer.from(document.base64,'base64')),document.sha256,'Word asset checksum changed');
  }
  return pack;
}

export function compilePriShevatSection(section){
  const items=[{h:section.title}],links=[],seen=new Set();
  // A section connection may also be cited in a later source paragraph. Keep
  // that source at its actual pair instead of duplicating it at paragraph one.
  const pairedRefs=new Set(section.paragraphs.flatMap(paragraph=>paragraph.pairs)
    .flatMap(pair=>pair.links||[]).map(source=>source.ref));
  section.paragraphs.forEach((paragraph,index)=>{
    const n=index+1,connections=new Map(),anchor=`${sectionRef(section)}:${n}`;
    const record=source=>{
      verified(source);connections.set(source.ref,{ref:source.ref,url:source.url,label:source.label||source.ref});
      const key=anchor+'\0'+source.ref;
      if(!seen.has(key)){seen.add(key);links.push({a:anchor,r:source.ref,c:categoryOf(source.ref)});}
    };
    for(const pair of paragraph.pairs)for(const source of pair.links||[])record(source);
    if(index===0)for(const source of section.connections||[])if(!pairedRefs.has(source.ref))record(source);
    items.push({n,p:paragraph.pairs.map(pair=>[
      linkedText(pair.hebrew,pair.links,'hebrew'),linkedText(pair.english,pair.links,'english')]),
      keepPairs:true,...(paragraph.headings?.length?{inlineHeadings:structuredClone(paragraph.headings)}:{}),
      ...(connections.size?{connections:[...connections.values()]}:{})});
  });
  return {items,links};
}

function filesIn(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()
    ?filesIn(path.join(dir,entry.name)): [path.join(dir,entry.name)]).sort();
}
export function hashFiles(dir,files){
  return sha256(files.map(file=>`${file}\0${sha256(fs.readFileSync(path.join(dir,file)))}\n`).join(''));
}
function refreshManifest(data){
  const files=filesIn(data).map(file=>path.relative(data,file).split(path.sep).join('/')).filter(file=>file!=='files.json').sort();
  const hash=createHash('sha256');let bytes=0;
  for(const file of files){const body=fs.readFileSync(path.join(data,file));hash.update(file).update('\0').update(body);bytes+=body.length;}
  write(path.join(data,'files.json'),{version:hash.digest('hex').slice(0,16),bytes,files});
}

export function publishPriShevatTuBiShvat(library='dist/library'){
  const pack=readPriShevatTuBiShvat(),data=path.join(library,'data'),dir=path.join(data,SLUG);
  const tocFile=path.join(dir,'toc.json'),toc=read(tocFile),catalogFile=path.join(data,'catalog.json');
  const catalog=read(catalogFile),book=catalog.find(book=>book.slug===SLUG);
  assert.equal(book?.title,BOOK);
  const catalogOthers=JSON.stringify(catalog.filter(book=>book.slug!==SLUG));
  const study=toc.toc.children[0];
  assert.equal(study.en,'Akiva Publishing — Interlinear Study Edition');
  const targets=new Set(pack.sections.map(sectionRef)),allLeaves=leavesOf(toc.toc);
  const own=allLeaves.filter(leaf=>leaf.interlinear&&targets.has(leaf.ref));
  assert.equal(new Set(own.map(leaf=>leaf.ref)).size,own.length,'Duplicate published teaching refs');
  const ownFiles=new Set(own.map(leaf=>`${leaf.id}.json`));
  const protectedFiles=fs.readdirSync(dir).filter(file=>file.endsWith('.json')&&!['toc.json','links.json'].includes(file)&&!ownFiles.has(file)).sort();
  const protectedSha256=hashFiles(dir,protectedFiles);
  const oldLinks=read(path.join(dir,'links.json'));
  const protectedLinks=JSON.stringify(Object.fromEntries(Object.entries(oldLinks).filter(([ref])=>!targets.has(ref))));
  const otherBookFiles=catalog.filter(book=>book.slug!==SLUG).flatMap(book=>
    filesIn(path.join(data,book.slug)).map(file=>path.relative(data,file))).sort();
  const otherBooksSha256=hashFiles(data,otherBookFiles);
  // IDs are append-only, including files no longer visible in an editorial TOC.
  let nextId=1+Math.max(...allLeaves.map(leaf=>leaf.id||0),...fs.readdirSync(dir).flatMap(file=>/^\d+(?:-\d+)*\.json$/.test(file)?[Number(file.split(/[-.]/)[0])]:[]));
  const oldParagraphs=own.reduce((n,leaf)=>n+leaf.shape,0),newLeaves=[];
  const groups=GROUPS.map(group=>({...group,children:[]}));
  const oldStudy=study.children.filter(child=>!child.shevatTuBiShvatEdition&&!targets.has(child.ref));
  const protectedToc=JSON.stringify(oldStudy);
  let paragraphs=0,pairs=0,headings=0,anchors=0;
  for(const [index,section]of pack.sections.entries()){
    const original=pack.source.sections[index],ref=sectionRef(section),existing=own.find(leaf=>leaf.ref===ref);
    const id=existing?.id??nextId++,compiled=compilePriShevatSection(section),file=path.join(dir,`${id}.json`);
    // A later source-note import must never be silently discarded by a republish.
    if(existing&&fs.existsSync(file)){
      const prior=read(file).filter(item=>item.p),fresh=compiled.items.filter(item=>item.p);
      for(const [p,item]of prior.entries())if(item.footnotes?.length){
        assert.deepEqual(item.p,fresh[p]?.p,'Existing footnotes require explicit remapping after a text change');
        fresh[p].footnotes=structuredClone(item.footnotes);
      }
    }
    write(file,compiled.items);oldLinks[ref]=compiled.links;
    const download=section.downloadDocx||(pack.documents?.length===1?pack.documents[0].file:null);
    if(download)assert.ok(pack.documents.some(document=>document.file===download));
    const leaf={en:section.title,he:section.sourceLabel,id,depth:1,shape:section.paragraphs.length,
      il1:true,interlinear:true,ref,heRef:`פרי צדיק, ${section.sourceLabel}`,sep:':',parashah:section.node,ois:section.chapter,
      sourceUrl:original.sourceUrl,...(download?{downloadDocx:download,downloadDocxLabel:'Download the complete interlinear Word edition (DOCX)'}:{})};
    groups.find(group=>group.node===section.node).children.push(leaf);newLeaves.push(leaf);
    paragraphs+=section.paragraphs.length;
    for(const paragraph of section.paragraphs){pairs+=paragraph.pairs.length;headings+=paragraph.headings?.length||0;}
    anchors+=compiled.items.flatMap(item=>item.p||[]).flat().reduce((n,text)=>n+(text.match(/<a data-ref=/g)||[]).length,0);
  }
  study.children=[...oldStudy,...groups.map(({node,count,...group})=>({...group,shevatTuBiShvatEdition:true}))];
  // Keep original files/metadata; suppress only the duplicate original TOC entries.
  for(const node of toc.toc.children.slice(1))if(GROUPS.some(group=>node.ref===`${BOOK}, ${group.node}`))node.coveredByInterlinear=true;
  book.segments=book.segments-oldParagraphs+paragraphs;book.akiva=true;book.ilParts=true;
  for(const document of pack.documents||[]){
    fs.mkdirSync(path.join(library,'downloads'),{recursive:true});
    fs.writeFileSync(path.join(library,document.file),Buffer.from(document.base64,'base64'));
    book.downloads=[...(book.downloads||[]).filter(entry=>entry.file!==document.file),{file:document.file,label:document.label}];
  }
  write(tocFile,toc);write(path.join(dir,'links.json'),oldLinks);write(catalogFile,catalog);
  // Remove only the selected teachings' outgoing reverse anchors. Other books
  // citing these teachings retain their original reverse connections.
  const isOwnAnchor=anchor=>[...targets].some(ref=>anchor.startsWith(ref+':'));
  const citedDir=path.join(data,'cited'),reverse=new Map();
  for(const file of fs.readdirSync(citedDir).filter(file=>file.endsWith('.json')&&!['index.json','search.json'].includes(file))){
    const refs=read(path.join(citedDir,file));let changed=false;
    for(const [ref,values]of Object.entries(refs)){
      const kept=values.filter(anchor=>!isOwnAnchor(anchor));
      if(kept.length!==values.length){changed=true;if(kept.length)refs[ref]=kept;else delete refs[ref];}
    }
    reverse.set(file,{refs,changed});
  }
  const slugOfRef=ref=>ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  for(const leaf of newLeaves)for(const link of oldLinks[leaf.ref]){
    const file=slugOfRef(link.r)+'.json';
    if(!reverse.has(file))reverse.set(file,{refs:{},changed:true});
    const entry=reverse.get(file),values=entry.refs[link.r]??=[];
    if(!values.includes(link.a)){values.push(link.a);entry.changed=true;}
  }
  for(const [file,entry]of reverse)if(entry.changed)write(path.join(citedDir,file),entry.refs);
  const indexFile=path.join(citedDir,'index.json');
  write(indexFile,[...new Set([...read(indexFile),...[...reverse.keys()].map(file=>file.slice(0,-5))])].sort());
  const sourcePackFile=path.join(data,'packs/sources.json'),sourcePack=read(sourcePackFile);
  const external=pack.sections.flatMap(section=>oldLinks[sectionRef(section)]).map(link=>link.r)
    .filter(ref=>!catalog.some(book=>ref===book.title||ref.startsWith(book.title+' ')||ref.startsWith(book.title+',')));
  sourcePack.refs=[...new Set([...sourcePack.refs,...external])].sort();write(sourcePackFile,sourcePack);
  const edition='20261016-pri-shevat-tubishvat-'+PACK_SHA256.slice(0,12);
  const htmlFile=path.join(library,'index.html');let html=fs.readFileSync(htmlFile,'utf8');
  const start='const editionDataUrl = url => ';
  assert.equal(html.split(start).length,2);
  html=html.replace(/\(url\.startsWith\('data\/peri-tzadik\/'\) \|\| url === 'data\/catalog\.json' \|\| url\.startsWith\('data\/cited\/'\) \|\| url === 'data\/packs\/sources\.json' \|\| url === 'data\/files\.json'\) \? url \+ '\?edition=20261016-pri-shevat-tubishvat-[a-f0-9]+' : /g,'');
  html=html.replace(start,start+`(url.startsWith('data/peri-tzadik/') || url === 'data/catalog.json' || url.startsWith('data/cited/') || url === 'data/packs/sources.json' || url === 'data/files.json') ? url + '?edition=${edition}' : `);
  fs.writeFileSync(htmlFile,html);
  const swFile=path.join(library,'sw.js');let sw=fs.readFileSync(swFile,'utf8');
  assert.match(sw,/const SHELL = `[^`]+`;/);
  sw=sw.replace(/-pri-shevat-tubishvat-[a-f0-9]+/g,'').replace(/const SHELL = `([^`]+)`;/,`const SHELL = \`$1-pri-shevat-tubishvat-${PACK_SHA256.slice(0,12)}\`;`);
  fs.writeFileSync(swFile,sw);
  refreshManifest(data);
  assert.equal(hashFiles(dir,protectedFiles),protectedSha256,'An existing Pri Tzaddik chapter or footnote changed');
  assert.equal(hashFiles(data,otherBookFiles),otherBooksSha256,'An unrelated book changed');
  assert.equal(JSON.stringify(catalog.filter(book=>book.slug!==SLUG)),catalogOthers);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(oldLinks).filter(([ref])=>!targets.has(ref)))),protectedLinks,'Other Pri connections changed');
  assert.equal(JSON.stringify(study.children.filter(child=>!child.shevatTuBiShvatEdition)),protectedToc,'Existing Pri TOC changed');
  const report={book:BOOK,revision:pack.revision||1,
    restorations:pack.sections.flatMap(section=>(section.audit?.restorations||[]).map(repair=>({ref:sectionRef(section),...repair}))),
    sections:11,paragraphs,phrasePairs:pairs,inlineHeadings:headings,sourceAnchors:anchors,
    sourceDocxSha256:SOURCE_DOCX_SHA256,sourceBodySha256:SOURCE_BODY_SHA256,packSha256:PACK_SHA256,edition,
    chapters:newLeaves.map(leaf=>({ref:leaf.ref,id:leaf.id,paragraphs:leaf.shape,sha256:sha256(fs.readFileSync(path.join(dir,`${leaf.id}.json`)))})),
    protectedFiles,protectedSha256,protectedLinksSha256:sha256(protectedLinks),
    otherBookFileCount:otherBookFiles.length,otherBooksPreserved:true,existingPriChaptersPreserved:true,
    documents:(pack.documents||[]).map(({base64,...document})=>document)};
  write(path.join(library,'pri-shevat-tubishvat-publication.json'),report);
  console.log(`PASS Pri Tzaddik Shevat/Tu BiShvat publication: 11 teachings, ${paragraphs} original paragraphs, ${pairs} exact phrase pairs; all prior Pri chapters and other books preserved.`);
  return report;
}

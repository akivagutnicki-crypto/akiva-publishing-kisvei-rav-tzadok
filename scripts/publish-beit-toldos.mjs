// Publish the supplied Bais Yaakov Toldos document after historical edition checks.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {linkCitations, linkHebrewCitations, normalizeRef, categoryOf} from './citations.mjs';

export const PACK='sources/akiva/overlays/beit-yaakov-toldos.json.gz.b64';
export const PACK_SHA='0dac5af7d07eebcf016009763ee45116a7fcd75564217166133b7499a64ae93b';
export const RELEASE='20261021-beit-yaakov-toldos-'+PACK_SHA.slice(0,12);
export const BOOK='Beit Yaakov on Torah', SLUG='beit-yaakov-on-torah';
export const digest=x=>createHash('sha256').update(x).digest('hex');
export const leaves=n=>n.children?n.children.flatMap(leaves):[n];
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,x)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(x));};
const escape=x=>x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const visible=x=>x.replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#x27;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const compact=x=>x.replace(/\s/gu,'');
const allFiles=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?allFiles(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]);
const citedSlug=r=>r.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export function readPack(){
  const encoded=fs.readFileSync(PACK);assert.equal(digest(encoded),PACK_SHA);
  const p=JSON.parse(gunzipSync(Buffer.from(encoded.toString().trim(),'base64')));
  assert.equal(p.schemaVersion,1);assert.equal(p.book,BOOK);
  assert.deepEqual(p.sections.map(s=>s.chapter),Array.from({length:52},(_,i)=>i+1));
  const items=p.sections.flatMap(s=>s.items);
  assert.equal(items.length,82);assert.equal(items.reduce((n,i)=>n+i.p.length,0),2407);
  assert.equal(digest(items.map(i=>i.sourceText).join('')),p.source.bodyTextSha256);
  for(const s of p.sections)for(const [index,item]of s.items.entries()){
    assert.equal(item.n,index+1);
    assert.equal(compact(item.p.flat().join('')),compact(item.sourceText),'A supplied word or punctuation mark was omitted');
    for(const [he,en]of item.p){assert.match(he,/[א-ת]/);assert.match(en,/[A-Za-z]/);assert.doesNotMatch(he+en,/[\[\]]/);}
  }
  assert.equal(digest(Buffer.from(p.document.base64,'base64')),p.document.sha256);
  return p;
}

export function publish(library='dist/library'){
  const p=readPack(),data=path.join(library,'data'),dir=path.join(data,SLUG);
  const toc=read(path.join(dir,'toc.json')),catalog=read(path.join(data,'catalog.json'));
  const book=catalog.find(b=>b.title===BOOK);assert.ok(book?.interlinear);
  if(toc.toldosEdition?.release===RELEASE){console.log('Bais Yaakov Toldos already published; no changes.');return;}
  assert.equal(leaves(toc.toc).filter(l=>l.ref?.startsWith(BOOK+', Toldot ')).length,0,'An existing Toldos edition needs reconciliation');
  const protectedTextSha256=Object.fromEntries(allFiles(data).filter(f=>/^[^/]+\/\d+(?:-\d+)*\.json$/.test(f)).map(f=>[f,digest(fs.readFileSync(path.join(data,f)))]));
  const oldCatalog=JSON.stringify(catalog.filter(b=>b.title!==BOOK)),oldToc=JSON.stringify(toc.toc.children);
  const links=read(path.join(dir,'links.json')),oldLinks=JSON.stringify(links);
  const next=1+Math.max(...leaves(toc.toc).map(l=>l.id));
  const verified=read('sources/verified/beit-toldos-links.json').references;
  const linked=html=>html.replace(/<a\b[^>]*data-ref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,(_,raw,words)=>{
    const proof=verified[visible(raw)];
    return proof?.verified?`<a data-ref="${escape(proof.ref)}" href="${escape(proof.url)}">${words}</a>`:words;
  });
  const children=[],newLinks={},reverse=new Map();let sourceAnchors=0;
  for(const [offset,s]of p.sections.entries()){
    const ref=`${BOOK}, Toldot ${s.chapter}`,id=next+offset,rows=[{h:s.title,editorialHeading:true}],edges=[],seen=new Set();
    if(s.editorialNote)rows.push({h:s.editorialNote,editorialHeading:true});
    for(const original of s.items){
      const pairs=original.p.map(([he,en])=>[linked(linkHebrewCitations(linkCitations(escape(he)))),linked(linkCitations(escape(en)))]);
      for(const [i,pair]of pairs.entries())assert.deepEqual(pair.map(visible),original.p[i],'Automatic citation linking changed supplied text');
      rows.push({h:original.heading,editorialHeading:true});
      rows.push({n:original.n,p:pairs,keepPairs:true,inlineHeadings:original.inlineHeadings});
      for(const text of pairs.flat())for(const m of text.matchAll(/data-ref="([^"]+)"/g)){
        sourceAnchors++;const r=normalizeRef(visible(m[1])),key=original.n+'\0'+r;
        if(!seen.has(key)){seen.add(key);edges.push({a:`${ref}:${original.n}`,r,c:categoryOf(r)});}
      }
    }
    write(path.join(dir,`${id}.json`),rows);newLinks[ref]=edges;
    children.push({en:`Toldos · Ois ${s.chapter} — ${s.title}`,he:s.sourceHeading,id,depth:1,shape:s.items.length,interlinear:true,
      ref,heRef:`בית יעקב על התורה, ${s.sourceHeading}`,sourceUrl:verified[ref].url,sep:':',parashah:'Toldot',ois:s.chapter,downloadDocx:p.document.file});
  }
  toc.toc.children.push({en:'Toldos · 52 Osiyos',he:'תולדות',children});
  toc.toldosEdition={release:RELEASE,sourceSha256:p.source.sha256,cleanedSha256:p.source.cleanedSha256,
    sections:52,paragraphs:82,phrasePairs:2407,absentSectionNumbers:p.source.absentSectionNumbers,
    editorialHeadlines:p.source.editorialHeadlines,editorialSubheadings:p.source.editorialSubheadings};
  book.segments+=82;book.downloads=[...(book.downloads||[]),{file:p.document.file,label:p.document.label}];
  fs.mkdirSync(path.join(library,'downloads'),{recursive:true});
  fs.writeFileSync(path.join(library,p.document.file),Buffer.from(p.document.base64,'base64'));
  Object.assign(links,newLinks);
  write(path.join(dir,'toc.json'),toc);write(path.join(dir,'links.json'),links);write(path.join(data,'catalog.json'),catalog);
  const citedDir=path.join(data,'cited');
  for(const edge of Object.values(newLinks).flat()){
    const file=citedSlug(edge.r)+'.json';
    if(!reverse.has(file))reverse.set(file,fs.existsSync(path.join(citedDir,file))?read(path.join(citedDir,file)):{});
    const refs=reverse.get(file),anchors=refs[edge.r]??=[];if(!anchors.includes(edge.a))anchors.push(edge.a);
  }
  for(const [file,refs]of reverse)write(path.join(citedDir,file),refs);
  write(path.join(citedDir,'index.json'),[...new Set([...read(path.join(citedDir,'index.json')),...[...reverse.keys()].map(f=>f.slice(0,-5))])].sort());
  const sourcesFile=path.join(data,'packs/sources.json'),sources=read(sourcesFile);
  const external=Object.values(newLinks).flat().map(e=>e.r).filter(r=>!catalog.some(b=>r===b.title||r.startsWith(b.title+' ')||r.startsWith(b.title+',')));
  sources.refs=[...new Set([...sources.refs,...external])].sort();write(sourcesFile,sources);
  const htmlFile=path.join(library,'index.html');let html=fs.readFileSync(htmlFile,'utf8');
  const prefix='const editionDataUrl = url => ';assert.equal(html.split(prefix).length,2);
  html=html.replace(prefix,prefix+`/* Bais Yaakov Toldos data revision */ (url.startsWith('data/${SLUG}/') || url === 'data/catalog.json' || url.startsWith('data/cited/') || url === 'data/packs/sources.json' || url === 'data/files.json') ? url + '?edition=${RELEASE}' :\n`);
  fs.writeFileSync(htmlFile,html);
  const swFile=path.join(library,'sw.js');let sw=fs.readFileSync(swFile,'utf8');
  sw=sw.replace(/const SHELL = `([^`]+)`;/,`const SHELL = \`$1-beit-toldos-${PACK_SHA.slice(0,12)}\`;`);fs.writeFileSync(swFile,sw);
  for(const [file,sha]of Object.entries(protectedTextSha256))assert.equal(digest(fs.readFileSync(path.join(data,file))),sha,'An existing chapter changed: '+file);
  assert.equal(JSON.stringify(toc.toc.children.slice(0,-1)),oldToc,'An earlier TOC group changed');
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(links).filter(([r])=>!Object.hasOwn(newLinks,r)))),oldLinks,'Existing source links changed');
  assert.equal(JSON.stringify(catalog.filter(b=>b.title!==BOOK)),oldCatalog,'Another book changed');
  const report={...toc.toldosEdition,sourceAnchors,bracketCharactersRemoved:p.source.bracketCharactersRemoved,
    excludedChatIntroductions:p.source.excludedChatIntroductions.length,protectedTextSha256,
    chapters:children.map(l=>({ref:l.ref,id:l.id,paragraphs:l.shape,sha256:digest(fs.readFileSync(path.join(dir,`${l.id}.json`)))}))};
  write(path.join(library,'beit-toldos-publication.json'),report);
  console.log(`PASS Bais Yaakov Toldos: 52 sections, 82 paragraphs, 2407 exact phrase pairs; ${sourceAnchors} verified citation anchors; every earlier chapter preserved.`);
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))publish();

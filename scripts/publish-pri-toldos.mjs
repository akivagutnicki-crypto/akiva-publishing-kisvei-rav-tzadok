// Publish only the uploaded Toldos edition after archive imports and before indexes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {categoryOf} from './citations.mjs';

export const PACK='sources/akiva/overlays/pri-toldos.json.gz.b64';
export const PACK_SHA='51f1f9d4ea47ed1215fac366f74e56c359eae3f9c891951bf71944d6360e31fa';
export const SOURCE_SHA='9e4dab2dd15fd3e6386f6ce222e708175c0653b537363d9f2858987b630f8330';
export const leavesOf=node=>node.children?node.children.flatMap(leavesOf):[node];
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
// Python annotation imports canonicalize every index key. Use that same order
// now so their later idempotent pass does not change preservation snapshots.
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const decode=text=>text.replace(/&quot;/g,'"').replace(/&#x27;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export const plain=text=>decode(String(text).replace(/<[^>]*>/g,''));
const compact=text=>text.replace(/\s/gu,'');
export const refOf=section=>`Peri Tzadik, Toldot ${section.chapter}`;

export function readToldos(){
  const bytes=Buffer.from(fs.readFileSync(PACK,'utf8').trim(),'base64');
  assert.equal(digest(bytes),PACK_SHA,'Toldos source package checksum');
  const pack=JSON.parse(gunzipSync(bytes));
  assert.equal(pack.book,'Peri Tzadik');assert.equal(pack.source.sha256,SOURCE_SHA);
  assert.deepEqual(pack.sections.map(s=>s.chapter),[1,2,3,4,5,6,7,8,9,10]);
  const paragraphs=pack.sections.flatMap(s=>s.items.filter(i=>i.p));
  assert.equal(paragraphs.length,40);assert.equal(paragraphs.reduce((n,i)=>n+i.p.length,0),1266);
  assert.equal(digest(paragraphs.map(i=>i.sourceText).join('')),pack.source.bodyTextSha256);
  for(const item of paragraphs){
    assert.equal(compact(item.p.flat().map(plain).join('')),compact(item.sourceText),'A source paragraph was omitted or changed');
    for(const [he,en]of item.p){assert.match(plain(he),/[א-ת]/);assert.match(plain(en),/[A-Za-z]/);}
  }
  return pack;
}

export function publishToldos(library='dist/library'){
  const pack=readToldos(),data=path.join(library,'data'),dir=path.join(data,'peri-tzadik');
  const toc=read(path.join(dir,'toc.json')),catalog=read(path.join(data,'catalog.json'));
  const book=catalog.find(b=>b.slug==='peri-tzadik'),links=read(path.join(dir,'links.json'));
  assert.equal(book.title,'Peri Tzadik');
  const study=toc.toc.children.find(n=>n.en==='Akiva Publishing — Interlinear Study Edition');
  assert.ok(study,'Pri Tzaddik study edition missing');
  const targets=new Set(pack.sections.map(refOf)),old=leavesOf(study).filter(l=>targets.has(l.ref));
  const ownFiles=new Set(old.map(l=>`${l.id}.json`));
  const protectedFiles=fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&!['toc.json','links.json'].includes(f)&&!ownFiles.has(f));
  const before=new Map(protectedFiles.map(file=>[file,digest(fs.readFileSync(path.join(dir,file)))]));
  const protectedLinks=JSON.stringify(Object.fromEntries(Object.entries(links).filter(([ref])=>!targets.has(ref))));
  const others=JSON.stringify(catalog.filter(b=>b.slug!=='peri-tzadik'));
  let next=1+Math.max(...fs.readdirSync(dir).flatMap(f=>/^\d+(?:-\d+)*\.json$/.test(f)?[Number(f.split(/[-.]/)[0])]:[]));
  const children=[];let sourceAnchors=0;
  for(const section of pack.sections){
    const ref=refOf(section),prior=old.find(l=>l.ref===ref),id=prior?.id??next++;
    const items=[{h:section.title}],sectionLinks=[],seen=new Set();
    for(const source of section.items){
      if(source.h){items.push({h:source.h});continue;}
      items.push({h:source.heading},{n:source.n,p:source.p,keepPairs:true});
      const item=items.at(-1);
      // Repeated publishing must retain later editorial source notes.
      if(prior){
        const previous=read(path.join(dir,`${id}.json`)).find(i=>i.n===source.n&&i.p);
        if(previous?.footnotes?.length){assert.deepEqual(previous.p,item.p);item.footnotes=previous.footnotes;}
      }
      for(const text of source.p.flat())for(const match of text.matchAll(/data-ref="([^"]+)"/g)){
        sourceAnchors++;
        const r=decode(match[1]),key=source.n+'\0'+r;
        if(!seen.has(key)){seen.add(key);sectionLinks.push({a:`${ref}:${source.n}`,r,c:categoryOf(r)});}
      }
    }
    write(path.join(dir,`${id}.json`),items);links[ref]=sectionLinks;
    children.push({en:section.title,he:section.sourceHeading,id,depth:1,shape:section.items.filter(i=>i.p).length,
      il1:true,interlinear:true,ref,heRef:`פרי צדיק, תולדות ${section.chapter}`,sep:':',parashah:'Toldot',ois:section.chapter,
      sourceUrl:`https://www.sefaria.org/Peri_Tzadik,_Toldot.${section.chapter}`,editorialHeadings:true});
  }
  study.children=study.children.filter(c=>!c.toldosEdition&&!targets.has(c.ref));
  const afterChayei=study.children.findLastIndex(c=>c.parashah==='Chayei Sara');
  study.children.splice(afterChayei+1,0,{en:'Toldos · 10 teachings',he:'תולדות',toldosEdition:true,children});
  for(const original of toc.toc.children)if(original.ref==='Peri Tzadik, Toldot')original.coveredByInterlinear=true;
  book.segments=book.segments-old.reduce((n,l)=>n+l.shape,0)+40;book.akiva=true;book.ilParts=true;
  write(path.join(dir,'toc.json'),toc);write(path.join(dir,'links.json'),canonical(links));write(path.join(data,'catalog.json'),catalog);
  const citedDir=path.join(data,'cited'),reverse=new Map();
  // Replace only these teachings' outgoing reverse anchors; preserve incoming
  // citations from every other passage and from every other book.
  for(const file of fs.readdirSync(citedDir).filter(f=>f.endsWith('.json')&&!['index.json','search.json'].includes(f))){
    const refs=read(path.join(citedDir,file));let changed=false;
    for(const [ref,anchors]of Object.entries(refs)){
      const kept=anchors.filter(a=>![...targets].some(t=>a.startsWith(t+':')));
      if(kept.length!==anchors.length){changed=true;if(kept.length)refs[ref]=kept;else delete refs[ref];}
    }
    if(changed)reverse.set(file,refs);
  }
  for(const section of pack.sections)for(const link of links[refOf(section)]){
    const slug=link.r.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const file=slug+'.json';
    if(!reverse.has(file))reverse.set(file,fs.existsSync(path.join(citedDir,file))?read(path.join(citedDir,file)):{});
    const refs=reverse.get(file),anchors=refs[link.r]??=[];
    if(!anchors.includes(link.a))anchors.push(link.a);
  }
  for(const [file,refs]of reverse)write(path.join(citedDir,file),refs);
  write(path.join(citedDir,'index.json'),[...new Set([...read(path.join(citedDir,'index.json')),...[...reverse.keys()].map(f=>f.slice(0,-5))])].sort());
  const sourcesFile=path.join(data,'packs/sources.json'),sources=read(sourcesFile);
  const external=pack.sections.flatMap(s=>links[refOf(s)]).map(l=>l.r)
    .filter(ref=>!catalog.some(b=>ref===b.title||ref.startsWith(b.title+' ')||ref.startsWith(b.title+',')));
  sources.refs=[...new Set([...sources.refs,...external])].sort();write(sourcesFile,sources);
  const revision='20261016-pri-toldos-'+PACK_SHA.slice(0,12);
  const htmlFile=path.join(library,'index.html');let html=fs.readFileSync(htmlFile,'utf8');
  html=html.replace(/\/\* Toldos data revision \*\/[^\n]*\n/g,'');
  const prefix="const editionDataUrl = url => ";assert.equal(html.split(prefix).length,2);
  // A new query key also refreshes data on already installed app clients.
  html=html.replace(prefix,prefix+`/* Toldos data revision */ (url.startsWith('data/peri-tzadik/') || url === 'data/catalog.json' || url.startsWith('data/cited/') || url === 'data/packs/sources.json' || url === 'data/files.json') ? url + '?edition=${revision}' :\n`);
  fs.writeFileSync(htmlFile,html);
  const swFile=path.join(library,'sw.js');let sw=fs.readFileSync(swFile,'utf8');
  sw=sw.replace(/-pri-toldos-[a-f0-9]+/g,'').replace(/const SHELL = `([^`]+)`;/,`const SHELL = \`$1-pri-toldos-${PACK_SHA.slice(0,12)}\`;`);fs.writeFileSync(swFile,sw);
  const filesIn=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesIn(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const files=filesIn(data).map(f=>path.relative(data,f).split(path.sep).join('/')).filter(f=>f!=='files.json').sort();
  const hash=createHash('sha256');let bytes=0;
  for(const file of files){const body=fs.readFileSync(path.join(data,file));hash.update(file).update('\0').update(body);bytes+=body.length;}
  write(path.join(data,'files.json'),{version:hash.digest('hex').slice(0,16),bytes,files});
  for(const [file,hash]of before)assert.equal(digest(fs.readFileSync(path.join(dir,file))),hash,'Unrelated text changed: '+file);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(links).filter(([ref])=>!targets.has(ref)))),protectedLinks);
  assert.equal(JSON.stringify(catalog.filter(b=>b.slug!=='peri-tzadik')),others);
  const report={revision,sections:10,paragraphs:40,phrasePairs:1266,sourceAnchors,sourceSha256:SOURCE_SHA,packSha256:PACK_SHA,
    originalBodySha256:pack.source.bodyTextSha256,otherPriChaptersPreserved:true,
    chapters:children.map(l=>({ref:l.ref,id:l.id,shape:l.shape,sha256:digest(fs.readFileSync(path.join(dir,`${l.id}.json`)))}))};
  write(path.join(library,'pri-toldos-publication.json'),report);
  console.log(`PASS Toldos publication: 10 teachings, 40 paragraphs, 1266 Hebrew-English pairs, ${sourceAnchors} source-link anchors.`);
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))publishToldos();

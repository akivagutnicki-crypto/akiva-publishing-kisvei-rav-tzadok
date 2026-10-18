// Install the checked Word edition after archive imports and before preservation snapshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {categoryOf} from './citations.mjs';

export const PACK='sources/akiva/overlays/pri-shabbos.json.gz.b64';
export const SOURCE_SHA='4b6b53ff3490275c0a11a6a3ed78cfc38106234f9db731913ea36708fe18674d';
export const SLUG='peri-tzadik';
export const BOOK='Peri Tzadik';
export const REPORT='pri-shabbos-publication.json';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const leavesOf=node=>node.children?node.children.flatMap(leavesOf):[node];
export const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
export const plain=value=>String(value).replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(match,entity)=>{
  if(entity[0]==='#')return String.fromCodePoint(entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10));
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()]??match;
});
const compact=value=>plain(value).replace(/\s/gu,'');
export const sectionRef=(node,chapter)=>node.depth===1?node.ref:`${node.ref} ${chapter.number}`;
export const segmentRef=(node,chapter,n)=>sectionRef(node,chapter)+(node.depth===1?' ':':')+n;
const fileFor=(node,chapter)=>`${node.id}${node.depth===1?'':'-'+chapter.number}.json`;
const allFiles=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()
  ?allFiles(path.join(directory,entry.name)):[path.join(directory,entry.name)]).sort();
export const hashFiles=(directory,files)=>digest(files.map(file=>`${file}\0${digest(fs.readFileSync(path.join(directory,file)))}\n`).join(''));

export function readShabbos(){
  const bytes=Buffer.from(fs.readFileSync(PACK,'utf8').trim(),'base64');
  const pack=JSON.parse(gunzipSync(bytes));
  assert.equal(pack.book,BOOK);assert.equal(pack.source.sha256,SOURCE_SHA);
  assert.deepEqual(pack.nodes.map(node=>node.ref),[
    'Peri Tzadik, Title','Peri Tzadik, Introduction',
    'Peri Tzadik, Sefer Kedushat Shabbat','Peri Tzadik, Kuntres Shvitat Shabbat']);
  assert.deepEqual(pack.nodes.map(node=>node.chapters.map(chapter=>chapter.items.filter(item=>item.p).length)),
    [[9],[3],[8,8,9,12,9,9,33],[14,7,1,2,11,9,6]]);
  const reconstructed=new Map();let pairs=0,anchors=0,headings=0;
  for(const node of pack.nodes)for(const chapter of node.chapters){
    const paragraphs=chapter.items.filter(item=>item.p);
    assert.deepEqual(paragraphs.map(item=>item.n),paragraphs.map((_,i)=>i+1),'Canonical paragraph numbering');
    for(const item of chapter.items){
      if(item.h){assert.ok(!/[א-ת]/.test(item.h));headings++;continue;}
      assert.ok(item.p?.length);assert.equal(item.p.length,item.sourceParagraphs.length);
      for(const [index,pair]of item.p.entries()){
        assert.equal(pair.length,2);assert.match(plain(pair[0]),/[א-ת]/);assert.match(plain(pair[1]),/[A-Za-z]/);
        const key=String(item.sourceParagraphs[index]);
        reconstructed.set(key,(reconstructed.get(key)||'')+compact(pair.join('')));pairs++;
        for(const html of pair)for(const match of html.matchAll(/<a\b[^>]*data-ref="([^"]+)"[^>]*>/g)){
          assert.ok(plain(match[1]).trim());assert.match(match[0],/href="https:\/\/www\.sefaria\.org\//);anchors++;
        }
      }
      let last=-1;
      for(const heading of item.inlineHeadings||[]){
        assert.ok(Number.isInteger(heading.phraseIndex)&&heading.phraseIndex>=0&&heading.phraseIndex<item.p.length);
        assert.ok(heading.phraseIndex>=last);last=heading.phraseIndex;
        assert.ok(heading.text&&!/[א-ת]/.test(heading.text));headings++;
      }
      assert.deepEqual(item.paragraphBreaks||[],[...new Set(item.paragraphBreaks||[])].sort((a,b)=>a-b));
      for(const index of item.paragraphBreaks||[])assert.ok(index>0&&index<item.p.length);
    }
  }
  assert.equal(reconstructed.size,661,'Every original Word paragraph is retained');
  assert.deepEqual([...reconstructed.keys()],pack.source.paragraphs.map(p=>String(p.index)),'Word paragraph sequence');
  for(const source of pack.source.paragraphs)assert.equal(digest(reconstructed.get(String(source.index))),source.compactSha256,'Word paragraph '+source.index);
  assert.equal(pairs,pack.counts.phrasePairs);assert.equal(anchors,2789,'All Word body hyperlink occurrences');
  assert.equal(anchors,pack.counts.bodyHyperlinks);assert.equal(headings,pack.counts.inTextHeadings);
  assert.equal(digest(Buffer.from(pack.document.base64,'base64')),SOURCE_SHA,'Exact downloadable Word document');
  assert.match(pack.document.file,/^downloads\/pri-tzaddik-[a-z0-9-]+\.docx$/);
  return {...pack,packageSha256:digest(bytes)};
}

export function publishShabbos(library='dist/library'){
  const pack=readShabbos(),data=path.join(library,'data'),directory=path.join(data,SLUG);
  const toc=read(path.join(directory,'toc.json')),catalog=read(path.join(data,'catalog.json'));
  const book=catalog.find(book=>book.slug===SLUG);assert.equal(book?.title,BOOK);
  const study=toc.toc.children.find(node=>node.en==='Akiva Publishing — Interlinear Study Edition');
  assert.ok(study,'Pri Tzadik study edition missing');
  const existing=leavesOf(study).filter(node=>node.shabbosEdition),ownFiles=new Set();
  for(const node of existing)for(let chapter=1;chapter<=(node.depth===1?1:node.shape.length);chapter++)ownFiles.add(`${node.id}${node.depth===1?'':'-'+chapter}.json`);
  const protectedFiles=fs.readdirSync(directory).filter(file=>file.endsWith('.json')&&!['toc.json','links.json'].includes(file)&&!ownFiles.has(file)).sort();
  const protectedSha256=hashFiles(directory,protectedFiles);
  const otherCatalog=JSON.stringify(catalog.filter(book=>book.slug!==SLUG));
  const otherBookFiles=catalog.filter(book=>book.slug!==SLUG).flatMap(book=>allFiles(path.join(data,book.slug)).map(file=>path.relative(data,file))).sort();
  const otherBooksSha256=hashFiles(data,otherBookFiles);
  const oldStudy=study.children.filter(node=>!node.shabbosEdition),protectedToc=JSON.stringify(oldStudy);
  const targetRefs=new Set(pack.nodes.flatMap(node=>node.chapters.map(chapter=>sectionRef(node,chapter))));
  const links=read(path.join(directory,'links.json'));
  const unrelatedLinks=value=>canonical(Object.fromEntries(Object.entries(value).filter(([ref])=>!targetRefs.has(ref))));
  const protectedLinksSha256=digest(JSON.stringify(unrelatedLinks(links)));
  let nextId=1+Math.max(...leavesOf(toc.toc).map(node=>Number(node.id)||0),...fs.readdirSync(directory).flatMap(file=>/^\d+(?:-\d+)*\.json$/.test(file)?[Number(file.split(/[-.]/)[0])]:[]));
  const nodes=[],chapters=[];
  for(const sourceNode of pack.nodes){
    const prior=existing.find(node=>node.ref===sourceNode.ref),id=prior?.id??nextId++;
    const node={en:sourceNode.title,he:sourceNode.he,ref:sourceNode.ref,heRef:sourceNode.heRef,id,depth:sourceNode.depth,
      shape:sourceNode.depth===1?sourceNode.chapters[0].items.filter(item=>item.p).length:sourceNode.chapters.map(chapter=>chapter.items.filter(item=>item.p).length),
      interlinear:true,shabbosEdition:true,editorialHeadings:true,downloadDocx:pack.document.file,
      downloadDocxLabel:'Download Kedushas Shabbos and Kuntres Shevisas Shabbos (Word)',
      sourceUrl:sourceNode.sourceUrl,...(sourceNode.depth===1?{il1:true}:{ilch:[1,2,3,4,5,6,7],chapterTitleDisplay:true,
        chapterTitles:sourceNode.chapters.map(chapter=>chapter.title),sourceUrls:sourceNode.chapters.map(chapter=>chapter.sourceUrl),chapterOutlines:[]})};
    for(const chapter of sourceNode.chapters){
      const ref=sectionRef(sourceNode,chapter),file=fileFor(node,chapter),items=structuredClone(chapter.items);
      if(prior&&fs.existsSync(path.join(directory,file))){
        const previous=read(path.join(directory,file));
        for(const item of previous)if(item.footnotes?.length){
          const fresh=items.find(candidate=>candidate.n===item.n&&candidate.p);
          assert.deepEqual(fresh?.p,item.p,'Existing footnotes require explicit remapping');fresh.footnotes=structuredClone(item.footnotes);
        }
      }
      const sectionLinks=[],seen=new Set(),outline=[];
      for(const item of items){
        if(item.h)continue;
        const anchor=segmentRef(sourceNode,chapter,item.n);
        for(const text of item.p.flat())for(const match of text.matchAll(/<a\b[^>]*data-ref="([^"]+)"/g)){
          const target=plain(match[1]),key=anchor+'\0'+target;
          if(!seen.has(key)){seen.add(key);sectionLinks.push({a:anchor,r:target,c:categoryOf(target)});}
        }
        for(const heading of item.inlineHeadings||[])outline.push({title:heading.text,ref:anchor,phraseIndex:heading.phraseIndex,...(heading.kind?{kind:heading.kind}:{})});
      }
      if(node.depth===2)node.chapterOutlines.push(outline);
      write(path.join(directory,file),items);links[ref]=sectionLinks;
      chapters.push({ref,id,file,paragraphs:items.filter(item=>item.p).length,sha256:digest(JSON.stringify(items))});
    }
    nodes.push(node);
  }
  study.children=[...nodes,...oldStudy];
  for(const original of toc.toc.children.slice(1))if(pack.nodes.some(node=>node.ref===original.ref))original.coveredByInterlinear=true;
  const count=node=>Array.isArray(node.shape)?node.shape.reduce((a,b)=>a+b,0):node.shape;
  book.segments=book.segments-existing.reduce((n,node)=>n+count(node),0)+150;book.akiva=true;book.ilParts=true;
  book.downloads=[...(book.downloads||[]).filter(item=>item.file!==pack.document.file),{file:pack.document.file,label:pack.document.label}];
  fs.mkdirSync(path.dirname(path.join(library,pack.document.file)),{recursive:true});
  fs.writeFileSync(path.join(library,pack.document.file),Buffer.from(pack.document.base64,'base64'));
  write(path.join(directory,'toc.json'),toc);write(path.join(directory,'links.json'),canonical(links));write(path.join(data,'catalog.json'),catalog);
  const isOwnAnchor=anchor=>pack.nodes.some(node=>node.chapters.some(chapter=>anchor.startsWith(sectionRef(node,chapter)+(node.depth===1?' ':':'))));
  const citedDir=path.join(data,'cited'),reverse=new Map();
  for(const file of fs.readdirSync(citedDir).filter(file=>file.endsWith('.json')&&!['index.json','search.json'].includes(file))){
    const refs=read(path.join(citedDir,file));let changed=false;
    for(const [ref,anchors]of Object.entries(refs)){
      const remaining=anchors.filter(anchor=>!isOwnAnchor(anchor));
      if(remaining.length!==anchors.length){changed=true;if(remaining.length)refs[ref]=remaining;else delete refs[ref];}
    }
    reverse.set(file,{refs,changed});
  }
  const sourceSlug=ref=>ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  for(const ref of targetRefs)for(const link of links[ref]){
    const file=sourceSlug(link.r)+'.json';if(!reverse.has(file))reverse.set(file,{refs:{},changed:true});
    const entry=reverse.get(file),anchors=entry.refs[link.r]??=[];
    if(!anchors.includes(link.a)){anchors.push(link.a);entry.changed=true;}
  }
  for(const [file,entry]of reverse)if(entry.changed)write(path.join(citedDir,file),entry.refs);
  write(path.join(citedDir,'index.json'),[...new Set([...read(path.join(citedDir,'index.json')),...[...reverse.keys()].map(file=>file.slice(0,-5))])].sort());
  const sources=read(path.join(data,'packs/sources.json'));
  const external=[...targetRefs].flatMap(ref=>links[ref].map(link=>link.r)).filter(ref=>!catalog.some(book=>ref===book.title||ref.startsWith(book.title+' ')||ref.startsWith(book.title+',')));
  sources.refs=[...new Set([...sources.refs,...external])].sort();write(path.join(data,'packs/sources.json'),sources);
  assert.equal(hashFiles(directory,protectedFiles),protectedSha256,'An unrelated Pri chapter changed');
  assert.equal(hashFiles(data,otherBookFiles),otherBooksSha256,'An unrelated book changed');
  assert.equal(JSON.stringify(catalog.filter(book=>book.slug!==SLUG)),otherCatalog);
  assert.equal(digest(JSON.stringify(unrelatedLinks(links))),protectedLinksSha256,'Other Pri source connections changed');
  assert.equal(JSON.stringify(study.children.filter(node=>!node.shabbosEdition)),protectedToc,'Other Pri contents changed');
  const report={book:BOOK,sourceDocxSha256:SOURCE_SHA,packageSha256:pack.packageSha256,workOis:14,canonicalWorkParagraphs:138,
    canonicalFrontMatterParagraphs:12,sourceDocumentParagraphs:661,phrasePairs:pack.counts.phrasePairs,bodyHyperlinks:pack.counts.bodyHyperlinks,
    originalDocumentHeadings:220,inTextHeadings:pack.counts.inTextHeadings,chapters,protectedFiles,protectedSha256,protectedLinksSha256,
    otherBooksPreserved:true,existingPriChaptersPreserved:true,originalHebrewFilesPreserved:true,document:{file:pack.document.file,sha256:SOURCE_SHA}};
  write(path.join(library,REPORT),report);
  console.log(`PASS Pri Shabbos publication: 14 ois, 138 canonical passages and complete front matter; 661 Word paragraphs, ${report.phrasePairs} phrase pairs, 2789 body hyperlinks.`);
  return report;
}

export function finalizeShabbos(library='dist/library'){
  const pack=readShabbos(),directory=path.join(library,'data',SLUG),report=read(path.join(library,REPORT));
  assert.equal(report.sourceDocxSha256,SOURCE_SHA);
  // Include all final Pri data, so later editions cannot reuse a stale key.
  const files=allFiles(directory).map(file=>path.relative(directory,file));
  const edition='20261018-pri-shabbos-'+hashFiles(directory,files).slice(0,16);
  const htmlFile=path.join(library,'index.html');let html=fs.readFileSync(htmlFile,'utf8');
  const marker='const editionDataUrl = url => ';assert.equal(html.split(marker).length,2);
  html=html.replace(/\/\* Pri Shabbos final data revision \*\/[^\n]*\n/g,'');
  html=html.replace(marker,marker+`/* Pri Shabbos final data revision */ (url.startsWith('data/peri-tzadik/') || url.startsWith('data/cited/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json' || url.startsWith('data/parallels/')) ? url + '?edition=${edition}' :\n`);
  fs.writeFileSync(htmlFile,html);
  const swFile=path.join(library,'sw.js');let sw=fs.readFileSync(swFile,'utf8');assert.match(sw,/const SHELL = `[^`]+`;/);
  sw=sw.replace(/-pri-shabbos-[a-f0-9]+/g,'').replace(/const SHELL = `([^`]+)`;/,`const SHELL = \`$1-pri-shabbos-${edition.split('-').at(-1)}\`;`);
  fs.writeFileSync(swFile,sw);report.edition=edition;write(path.join(library,REPORT),report);
  console.log('PASS Pri Shabbos final installed-reader cache revision: '+edition);
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
  if(process.argv.includes('--finalize-only'))finalizeShabbos();else publishShabbos();
}

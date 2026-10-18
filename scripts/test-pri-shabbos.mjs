// Verify exact Word content, canonical addresses, navigation, source links and downloads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {readShabbos,leavesOf,sectionRef,segmentRef,plain,digest,SOURCE_SHA,REPORT} from './publish-pri-shabbos.mjs';

const at=process.argv.indexOf('--url'),base=at>=0?process.argv[at+1]:null;
const loadBytes=async file=>{
  if(!base)return fs.readFileSync('dist/library/'+file);
  const response=await fetch(new URL(file+'?shabbosVerify='+Date.now(),base),{signal:AbortSignal.timeout(60000)});
  assert.ok(response.ok,'HTTP '+response.status+' '+file);return Buffer.from(await response.arrayBuffer());
};
const load=async file=>JSON.parse(await loadBytes(file));
const pack=readShabbos();
const [toc,links,catalog,manifest,report]=await Promise.all([
  load('data/peri-tzadik/toc.json'),load('data/peri-tzadik/links.json'),load('data/catalog.json'),load('data/files.json'),load(REPORT)]);
const study=toc.toc.children.find(node=>node.en==='Akiva Publishing — Interlinear Study Edition');
assert.ok(study);assert.equal(report.sourceDocxSha256,SOURCE_SHA);assert.equal(report.packageSha256,pack.packageSha256);
assert.equal(report.existingPriChaptersPreserved,true);assert.equal(report.otherBooksPreserved,true);
assert.equal(report.originalHebrewFilesPreserved,true);assert.ok(report.edition,'Final installed-reader cache key');
const nodes=leavesOf(study).filter(node=>node.shabbosEdition);assert.equal(nodes.length,4);
assert.deepEqual(nodes.map(node=>node.ref),pack.nodes.map(node=>node.ref));
const originals=toc.toc.children.slice(1).filter(node=>pack.nodes.some(source=>source.ref===node.ref));
assert.equal(originals.length,4);assert.ok(originals.every(node=>node.coveredByInterlinear));
let paragraphs=0,pairs=0,anchors=0,headings=0,breaks=0;
const seenAnchors=new Set(),expectedFiles=[];
for(const sourceNode of pack.nodes){
  const node=nodes.find(node=>node.ref===sourceNode.ref);
  assert.equal(node.en,sourceNode.title);assert.equal(node.interlinear,true);assert.equal(node.downloadDocx,pack.document.file);
  assert.equal(node.depth,sourceNode.depth);
  if(node.depth===2){
    assert.deepEqual(node.shape,sourceNode.chapters.map(chapter=>chapter.items.filter(item=>item.p).length));
    assert.deepEqual(node.chapterTitles,sourceNode.chapters.map(chapter=>chapter.title));
    assert.deepEqual(node.sourceUrls,sourceNode.chapters.map(chapter=>chapter.sourceUrl));
    assert.equal(node.chapterTitleDisplay,true);assert.equal(node.chapterOutlines.length,7);
  }
  for(const chapter of sourceNode.chapters){
    const ref=sectionRef(sourceNode,chapter),file=`peri-tzadik/${node.id}${node.depth===1?'':'-'+chapter.number}.json`;
    expectedFiles.push(file);assert.ok(manifest.files.includes(file),'Offline manifest omitted '+ref);
    const items=await load('data/'+file),actual=items.filter(item=>item.p),expected=chapter.items.filter(item=>item.p);
    assert.equal(actual.length,expected.length);paragraphs+=actual.length;
    const expectedConnections=new Set();
    for(const [index,item]of actual.entries()){
      const source=expected[index];assert.equal(item.n,source.n);assert.deepEqual(item.p,source.p,'Exact Hebrew, English, nikkud and links: '+ref+':'+item.n);
      assert.deepEqual(item.inlineHeadings||[],source.inlineHeadings||[]);assert.deepEqual(item.paragraphBreaks||[],source.paragraphBreaks||[]);
      assert.deepEqual(item.sourceParagraphs,source.sourceParagraphs);assert.equal(item.keepPairs,true);
      pairs+=item.p.length;headings+=(item.inlineHeadings||[]).length;breaks+=(item.paragraphBreaks||[]).length;
      const anchor=segmentRef(sourceNode,chapter,item.n);assert.ok(!seenAnchors.has(anchor));seenAnchors.add(anchor);
      for(const html of item.p.flat())for(const match of html.matchAll(/<a\b[^>]*data-ref="([^"]+)"/g)){
        anchors++;expectedConnections.add(anchor+'\0'+plain(match[1]));
      }
    }
    assert.deepEqual(new Set((links[ref]||[]).map(link=>link.a+'\0'+link.r)),expectedConnections,'Exact canonical source connections for '+ref);
    assert.equal(digest(JSON.stringify(items)),report.chapters.find(row=>row.ref===ref)?.sha256,'Published chapter checksum '+ref);
    const actualHeadings=items.filter(item=>item.h).map(item=>item.h);
    assert.deepEqual(actualHeadings,chapter.items.filter(item=>item.h).map(item=>item.h));headings+=actualHeadings.length;
    if(node.depth===2){
      const outline=node.chapterOutlines[chapter.number-1];
      assert.equal(outline.length,actual.reduce((count,item)=>count+(item.inlineHeadings?.length||0),0));
      for(const entry of outline){
        const item=actual.find(item=>segmentRef(sourceNode,chapter,item.n)===entry.ref);
        assert.ok(item?.inlineHeadings?.some(heading=>heading.text===entry.title&&heading.phraseIndex===entry.phraseIndex),'Contents topic target');
        assert.ok(!/[א-ת]/.test(entry.title),'English contents');
      }
    }
  }
}
assert.equal(paragraphs,150);assert.equal(pairs,pack.counts.phrasePairs);assert.equal(anchors,2789);
assert.equal(pairs,9468,'Every original Word phrase pair is retained');
assert.equal(headings,202,'All 202 topical headings are retained');
const titleHeadings=nodes.length+nodes.filter(node=>node.depth===2).reduce((count,node)=>count+node.chapterTitles.length,0);
assert.equal(titleHeadings,18);assert.equal(headings+titleHeadings,220,'All topical, node and ois headings are retained');
assert.equal(headings,pack.counts.inTextHeadings);assert.ok(breaks>400,'Original manuscript paragraph divisions missing');
const book=catalog.find(book=>book.slug==='peri-tzadik');assert.ok(book.downloads.some(document=>document.file===pack.document.file));
assert.equal(digest(await loadBytes(pack.document.file)),SOURCE_SHA,'The public Word file differs from the checked manuscript');
const html=(await loadBytes('index.html')).toString();assert.ok(html.includes(report.edition));assert.ok(html.includes('paragraphBreaks'));
if(!base){
  const mcp=JSON.parse(fs.readFileSync('dist/mcp-data/text/peri-tzadik.json','utf8'));
  const mcpCatalog=JSON.parse(fs.readFileSync('dist/mcp-data/catalog.json','utf8'));
  const mcpBook=mcpCatalog.books.find(book=>book.slug==='peri-tzadik');assert.ok(mcpBook,'Pri Tzadik missing from MCP');
  const mcpPlain=html=>plain(String(html).replace(/<br\s*\/?>/gi,'\n')).replace(/[ \t\u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  let mcpSections=0,mcpParagraphs=0,mcpPairs=0,mcpInlineHeadings=0,mcpHeadings=0,mcpBreaks=0;
  for(const sourceNode of pack.nodes)for(const chapter of sourceNode.chapters){
    const ref=sectionRef(sourceNode,chapter);
    const candidates=mcpBook.sections.map((section,index)=>({section,index})).filter(({section})=>section.ref===ref&&section.il);
    assert.equal(candidates.length,1,'Exactly one MCP interlinear section for '+ref);
    const {section,index:sectionIndex}=candidates[0],expected=chapter.items.filter(item=>item.p);
    assert.equal(section.title,chapter.title,'MCP descriptive section title for '+ref);
    if(sourceNode.depth===2)assert.equal(section.chapterDisplayTitle,chapter.title,'MCP descriptive ois title metadata for '+ref);
    assert.equal(section.count,expected.length,'MCP canonical paragraph count for '+ref);
    const actual=mcp.paras.slice(section.first,section.first+section.count);
    assert.equal(actual.length,expected.length);assert.ok(actual.every(item=>item.s===sectionIndex));
    assert.deepEqual(actual.map(item=>item.n),expected.map(item=>item.n),'MCP canonical numbering for '+ref);
    const headingsByNumber=new Map();let pending=[];
    for(const item of chapter.items){
      if(item.h){pending.push(mcpPlain(item.h));continue;}
      if(item.p){headingsByNumber.set(item.n,[...pending,...(item.inlineHeadings||[]).map(heading=>mcpPlain(heading.text))]);pending=[];}
    }
    assert.equal(pending.length,0,'Unexpected trailing heading in source '+ref);
    for(const [index,item]of actual.entries()){
      const source=expected[index],anchor=segmentRef(sourceNode,chapter,source.n);
      assert.equal(item.r,anchor,'MCP canonical paragraph reference');
      assert.deepEqual(item.p,source.p.map(pair=>pair.map(mcpPlain)),'MCP exact Hebrew and English phrase pairs: '+anchor);
      assert.deepEqual(item.inlineHeadings||[],(source.inlineHeadings||[]).map(heading=>({...heading,text:mcpPlain(heading.text)})),'MCP inline heading positions: '+anchor);
      assert.deepEqual(item.paragraphBreaks||[],source.paragraphBreaks||[],'MCP original Word paragraph divisions: '+anchor);
      assert.deepEqual(item.h||[],headingsByNumber.get(source.n),'MCP searchable English headings: '+anchor);
      const expectedPlaces={};
      source.p.forEach((pair,phraseIndex)=>pair.forEach((html,side)=>{
        for(const match of html.matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g)){
          const target=plain(match[1]);
          if(!expectedPlaces[target])expectedPlaces[target]=[phraseIndex,side?'e':'h',mcpPlain(html.slice(0,match.index)).length];
        }
      }));
      assert.deepEqual(item.a||{},expectedPlaces,'MCP source-link phrase anchors: '+anchor);
      assert.deepEqual(new Set((item.c||[]).map(link=>link[0])),new Set((links[ref]||[]).filter(link=>link.a===anchor).map(link=>link.r)),'MCP cited source references: '+anchor);
      mcpParagraphs++;mcpPairs+=item.p.length;mcpInlineHeadings+=(item.inlineHeadings||[]).length;
      mcpHeadings+=(item.h||[]).length;mcpBreaks+=(item.paragraphBreaks||[]).length;
    }
    mcpSections++;
  }
  assert.equal(mcpSections,16);assert.equal(mcpParagraphs,150);assert.equal(mcpPairs,9468);
  assert.equal(mcpInlineHeadings,202);assert.equal(mcpHeadings,202);assert.equal(mcpBreaks,breaks);
  if(process.argv.includes('--zips')){
    const {unzipSync}=createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
    for(const archive of ['downloads/books/peri-tzadik.zip','downloads/rav-tzadok-library.zip']){
      const contents=unzipSync(fs.readFileSync('dist/library/'+archive));
      for(const file of expectedFiles)assert.equal(digest(contents['data/'+file]),digest(fs.readFileSync('dist/library/data/'+file)),'Archive chapter '+file);
      assert.equal(digest(contents[pack.document.file]),SOURCE_SHA,'Word edition in '+archive);
    }
  }
}
console.log(`PASS ${base?'LIVE ':''}Pri Shabbos: 14 ois, 150 canonical items including front matter, 661 preserved Word paragraphs, ${pairs} phrase pairs, ${anchors} body links, ${headings} topical headings, ${breaks} internal paragraph divisions.`);

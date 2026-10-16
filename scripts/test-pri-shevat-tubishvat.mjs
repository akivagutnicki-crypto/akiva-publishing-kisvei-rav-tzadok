// Run after publication and again after the final ZIP build with --zips.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {categoryOf} from './citations.mjs';
import {readPriShevatTuBiShvat,BOOK,SLUG,GROUPS,PACK_SHA256,sectionRef,leavesOf,sha256,hashFiles} from './pri-shevat-tubishvat.mjs';

const library='dist/library',data=library+'/data',dir=data+'/'+SLUG;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const pack=readPriShevatTuBiShvat(),report=read(library+'/pri-shevat-tubishvat-publication.json');
const toc=read(dir+'/toc.json'),leaves=leavesOf(toc.toc),study=toc.toc.children[0];
const links=read(dir+'/links.json'),catalog=read(data+'/catalog.json'),book=catalog.find(book=>book.slug===SLUG);
const manifest=read(data+'/files.json');
const decode=value=>String(value).replace(/&(#\d+|amp|lt|gt|quot|apos);/g,(whole,key)=>key[0]==='#'
  ?String.fromCodePoint(Number(key.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[key]);
const plain=value=>decode(String(value).replace(/<[^>]*>/g,''));
const anchors=html=>[...html.matchAll(/<a data-ref="([^"]+)" href="([^"]+)">([\s\S]*?)<\/a>/g)]
  .map(match=>({ref:decode(match[1]),url:decode(match[2]),text:plain(match[3]),offset:plain(html.slice(0,match.index)).length}));
assert.equal(report.packSha256,PACK_SHA256);assert.equal(report.sections,11);assert.equal(report.paragraphs,15);
assert.equal(hashFiles(dir,report.protectedFiles),report.protectedSha256,'An earlier Pri chapter or source footnote changed');
const targetRefs=new Set(pack.sections.map(sectionRef));
const protectedLinks=Object.fromEntries(Object.entries(links).filter(([ref])=>!targetRefs.has(ref)));
assert.equal(sha256(JSON.stringify(protectedLinks)),report.protectedLinksSha256,'Existing Pri connection index changed');
assert.equal(report.otherBooksPreserved,true);
const ids=new Set(),reverseIndex=new Set(read(data+'/cited/index.json')),reverseCache=new Map();
let paragraphs=0,pairs=0,headingCount=0,anchorCount=0;
for(const group of GROUPS){
  const actual=study.children.find(child=>child.shevatTuBiShvatEdition&&child.en===group.en);
  assert.ok(actual,'Missing English TOC group '+group.en);
  assert.deepEqual(actual.children.map(leaf=>leaf.ref),Array.from({length:group.count},(_,i)=>`${BOOK}, ${group.node} ${i+1}`));
  const original=toc.toc.children.find(child=>child.ref===`${BOOK}, ${group.node}`&&!child.interlinear);
  assert.ok(original?.coveredByInterlinear,'Original Hebrew node must be retained without duplicate visible TOC links');
  assert.deepEqual(original.shape,pack.source.sections.filter(section=>section.node===group.node).map(section=>section.paragraphs.length));
  for(let i=1;i<=group.count;i++)assert.ok(fs.existsSync(path.join(dir,`${original.id}-${i}.json`)),'Original Hebrew file was removed');
}
const reading=leaves.filter(leaf=>leaf.interlinear).map(leaf=>leaf.ref);
const positions=pack.sections.map(section=>reading.indexOf(sectionRef(section)));
assert.ok(positions[0]>=0);
assert.deepEqual(positions,positions.map((_,i)=>positions[0]+i),'Canonical next/previous sequence must preserve teaching order');
for(const [sectionIndex,section]of pack.sections.entries()){
  const ref=sectionRef(section),matches=leaves.filter(leaf=>leaf.ref===ref);
  assert.equal(matches.length,1,'Duplicate canonical teaching leaf '+ref);
  const leaf=matches[0];
  assert.ok(!ids.has(leaf.id),'Duplicate storage ID');ids.add(leaf.id);
  assert.equal(leaf.en,section.title);assert.equal(leaf.he,section.sourceLabel);
  assert.equal(leaf.depth,1);assert.equal(leaf.interlinear,true);assert.equal(leaf.sep,':');
  assert.equal(leaf.shape,section.paragraphs.length);
  assert.equal(leaf.sourceUrl,pack.source.sections[sectionIndex].sourceUrl);
  assert.equal(leaf.downloadDocx,section.downloadDocx||(pack.documents?.length===1?pack.documents[0].file:undefined));
  const file=`${leaf.id}.json`,items=read(dir+'/'+file),body=items.filter(item=>item.p);
  assert.equal(items[0].h,section.title);assert.equal(items.length,body.length+1,'Artificial paragraph/heading records added');
  assert.equal(body.length,section.paragraphs.length);
  assert.ok(manifest.files.includes(SLUG+'/'+file),'Teaching missing from offline file manifest');
  assert.equal(sha256(fs.readFileSync(dir+'/'+file)),report.chapters.find(chapter=>chapter.ref===ref).sha256);
  const expectedConnections=new Set();
  const pairedRefs=new Set(section.paragraphs.flatMap(paragraph=>paragraph.pairs)
    .flatMap(pair=>pair.links||[]).map(link=>link.ref));
  for(const [p,paragraph]of section.paragraphs.entries()){
    const item=body[p],anchor=`${ref}:${p+1}`;paragraphs++;
    assert.equal(item.n,p+1);assert.equal(item.keepPairs,true);
    assert.equal(item.p.length,paragraph.pairs.length,'Phrase boundaries changed');
    assert.deepEqual(item.inlineHeadings||[],paragraph.headings||[],'Inline subheading offsets changed');
    headingCount+=(paragraph.headings||[]).length;
    assert.ok(!item.footnotes?.length,'A source footnote was introduced');
    for(const [k,pair]of paragraph.pairs.entries()){
      assert.deepEqual(item.p[k].map(plain),[pair.hebrew,pair.english],'Published phrase text differs from reviewed translation');pairs++;
      for(const [side,language,anchorKey]of [[0,'hebrew','hebrewText'],[1,'english','englishText']]){
        const actualAnchors=anchors(item.p[k][side]);
        const expectedAnchors=(pair.links||[]).filter(link=>link[anchorKey]);
        const unique=new Map(expectedAnchors.map(link=>[link.ref+'\0'+link[anchorKey],link]));
        assert.equal(actualAnchors.length,unique.size,'Missing or invented inline citation');
        for(const link of unique.values()){
          assert.ok(actualAnchors.some(a=>a.ref===link.ref&&a.url===link.url&&a.text===link[anchorKey]&&a.offset===pair[language].indexOf(link[anchorKey])),
            'Verified source link moved or changed: '+link.ref);anchorCount++;
        }
      }
      for(const link of pair.links||[])expectedConnections.add(anchor+'\0'+link.ref);
      assert.doesNotMatch(plain(item.p[k][1]),/[\[\]]/,'English brackets returned');
    }
    if(p===0)for(const connection of section.connections)if(!pairedRefs.has(connection.ref))
      expectedConnections.add(anchor+'\0'+connection.ref);
    for(const connection of item.connections||[]){
      assert.ok(expectedConnections.has(anchor+'\0'+connection.ref),'Invented paragraph connection');
      assert.ok(connection.url&&connection.label);
    }
  }
  const actualConnections=new Set((links[ref]||[]).map(link=>link.a+'\0'+link.r));
  assert.equal(actualConnections.size,links[ref].length,'Duplicate outward source connection');
  assert.deepEqual([...actualConnections].sort(),[...expectedConnections].sort(),'Missing or invented source connection');
  assert.ok(actualConnections.size,'Teaching has no verified Sefaria sources');
  for(const link of links[ref]){
    assert.equal(link.c,categoryOf(link.r));
    const sourceSlug=link.r.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    assert.ok(reverseIndex.has(sourceSlug),'Reverse source index missing');
    if(!reverseCache.has(sourceSlug))reverseCache.set(sourceSlug,read(`${data}/cited/${sourceSlug}.json`));
    assert.ok(reverseCache.get(sourceSlug)[link.r]?.includes(link.a),'Reverse citation missing: '+link.r);
  }
}
assert.equal(paragraphs,15);assert.equal(pairs,report.phrasePairs);assert.equal(headingCount,report.inlineHeadings);
assert.equal(anchorCount,report.sourceAnchors);assert.ok(anchorCount>0);
for(const document of pack.documents||[]){
  assert.equal(sha256(fs.readFileSync(path.join(library,document.file))),document.sha256);
  assert.ok(book.downloads.some(entry=>entry.file===document.file&&entry.label===document.label),'Word download missing from catalog');
}
const html=fs.readFileSync(library+'/index.html','utf8'),sw=fs.readFileSync(library+'/sw.js','utf8');
assert.ok(html.includes(report.edition),'Peri and reverse citation caches were not refreshed');
assert.ok(sw.includes('-pri-shevat-tubishvat-'+PACK_SHA256.slice(0,12)),'Shell cache suffix was overwritten by a later publisher');
assert.match(html,/filter\(n => !n\.coveredByInterlinear\)/);
for(const node of ['Rosh_Chodesh_Shvat','Tu_BiShvat'])assert.ok(html.includes(`href="#/read/Peri_Tzadik,_${node}_1"`));
if(process.argv.includes('--final')){
  const indexedBook=read('dist/mcp-data/catalog.json').books.find(book=>book.slug===SLUG);
  const indexedText=read('dist/mcp-data/text/'+SLUG+'.json').paras;
  const tidy=text=>text.replace(/[ \t\u00a0]+/g,' ').trim();
  for(const section of pack.sections){
    const ref=sectionRef(section),indexedSection=indexedBook.sections.filter(s=>s.ref===ref&&s.il);
    assert.equal(indexedSection.length,1,'Canonical interlinear section missing from MCP index');
    assert.equal(indexedSection[0].count,section.paragraphs.length);
    for(const [p,paragraph]of section.paragraphs.entries()){
      const indexedParagraph=indexedText.find(item=>item.r===`${ref}:${p+1}`&&item.p);
      assert.ok(indexedParagraph,'Interlinear paragraph missing from MCP search text');
      assert.deepEqual(indexedParagraph.p,paragraph.pairs.map(pair=>[tidy(pair.hebrew),tidy(pair.english)]));
      const actualSources=new Set((indexedParagraph.c||[]).map(([source])=>source));
      const expectedSources=new Set(links[ref].filter(link=>link.a===`${ref}:${p+1}`).map(link=>link.r));
      assert.deepEqual([...actualSources].sort(),[...expectedSources].sort(),
        'MCP connection is missing or attached to the wrong source paragraph');
    }
    for(const connection of section.connections)assert.ok(indexedText.some(item=>
      item.p&&item.r.startsWith(ref+':')&&(item.c||[]).some(([source])=>source===connection.ref)),
      'Section connection is missing from its correct MCP paragraph');
  }
}
if(process.argv.includes('--zips')){
  const {unzipSync}=createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
  for(const zipName of ['downloads/rav-tzadok-library.zip',`downloads/books/${SLUG}.zip`]){
    const zip=unzipSync(fs.readFileSync(path.join(library,zipName)));
    for(const file of ['toc.json','links.json',...report.protectedFiles,...report.chapters.map(chapter=>chapter.id+'.json')])
      assert.deepEqual(Buffer.from(zip[`data/${SLUG}/${file}`]||[]),fs.readFileSync(dir+'/'+file),'Offline ZIP changed/omitted '+file);
    for(const document of pack.documents||[])assert.equal(sha256(Buffer.from(zip[document.file]||[])),document.sha256,'Word document missing from '+zipName);
  }
}
console.log(`PASS Shevat/Tu BiShvat: 11 canonical chapters, ${paragraphs} exact uploaded paragraphs, ${pairs} exact phrase pairs, ${headingCount} subheadings, ${anchorCount} verified inline links; previous Pri chapters and connections unchanged${process.argv.includes('--zips')?'; exact text and Word assets in both ZIPs':''}.`);

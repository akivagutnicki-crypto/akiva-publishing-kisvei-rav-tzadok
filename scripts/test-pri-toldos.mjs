// Check all ten canonical routes, exact Word phrase text, links, and navigation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readToldos,leavesOf,refOf,plain,digest} from './publish-pri-toldos.mjs';

const at=process.argv.indexOf('--url'),base=at>=0?process.argv[at+1]:null;
const load=async file=>{
  if(!base)return JSON.parse(fs.readFileSync('dist/library/'+file,'utf8'));
  const response=await fetch(new URL(file+'?toldosVerify='+Date.now(),base));
  assert.ok(response.ok,'HTTP '+response.status+' '+file);return response.json();
};
const pack=readToldos(),toc=await load('data/peri-tzadik/toc.json');
const study=toc.toc.children.find(n=>n.en==='Akiva Publishing — Interlinear Study Edition');
const all=leavesOf(study),links=await load('data/peri-tzadik/links.json'),manifest=await load('data/files.json');
const report=await load('pri-toldos-publication.json');
assert.equal(report.sourceSha256,pack.source.sha256);assert.equal(report.otherPriChaptersPreserved,true);
let paragraphs=0,pairs=0,anchors=0;
for(const section of pack.sections){
  const ref=refOf(section),matches=all.filter(l=>l.ref===ref);
  assert.equal(matches.length,1,'One interlinear TOC entry for '+ref);
  const leaf=matches[0],file=`peri-tzadik/${leaf.id}.json`,items=await load('data/'+file);
  assert.ok(leaf.interlinear&&leaf.il1);assert.equal(leaf.en,section.title);
  assert.ok(manifest.files.includes(file),'Offline manifest omitted '+ref);
  const expected=section.items.filter(i=>i.p),actual=items.filter(i=>i.p);
  assert.equal(actual.length,expected.length);assert.equal(leaf.shape,expected.length);
  assert.deepEqual(actual.map(i=>i.p),expected.map(i=>i.p),'Exact uploaded Hebrew, English, nikkud, links: '+ref);
  assert.deepEqual(actual.map(i=>i.n),expected.map(i=>i.n),'Paragraph numbering');
  assert.ok(items.some(i=>i.h===section.title));
  assert.ok(items.filter(i=>i.h).every(i=>!/[א-ת]/.test(i.h)),'English navigation headings');
  if(section.chapter===10)assert.ok(items.some(i=>i.h==='After Havdalah'),'After Havdalah subsection omitted');
  const expectedLinks=new Set();
  for(const item of actual)for(const html of item.p.flat())for(const m of html.matchAll(/data-ref="([^"]+)"/g)){
    anchors++;expectedLinks.add(item.n+'\0'+plain(m[1]));
  }
  assert.deepEqual(new Set(links[ref].map(l=>l.a.split(':').at(-1)+'\0'+l.r)),expectedLinks,'Paragraph source connections');
  assert.equal(digest(JSON.stringify(items)),report.chapters.find(c=>c.ref===ref).sha256);
  paragraphs+=actual.length;pairs+=actual.reduce((n,i)=>n+i.p.length,0);
}
assert.equal(paragraphs,40);assert.equal(pairs,1266);assert.equal(anchors,report.sourceAnchors);
if(!base){
  const index=fs.readFileSync('dist/library/index.html','utf8');
  assert.ok(index.includes(report.revision),'Installed app data revision missing');
  const mcp=JSON.parse(fs.readFileSync('dist/mcp-data/catalog.json','utf8'));
  assert.ok(JSON.stringify(mcp).includes('Peri Tzadik, Toldot 10'),'MCP index omitted Toldos');
}
console.log(`PASS ${base?'LIVE ':''}Toldos: ${paragraphs} exact Word paragraphs, ${pairs} phrase pairs, ${anchors} source anchors and all ten canonical TOC entries.`);

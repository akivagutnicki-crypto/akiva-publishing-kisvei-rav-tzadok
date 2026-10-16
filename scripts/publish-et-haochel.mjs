// Verify Et HaOchel after archive imports, retain its curated parallels, and refresh reader caches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sourcePath='sources/akiva/Et_HaOchel.json';
const sourceBytes=fs.readFileSync(sourcePath);
const source=JSON.parse(sourceBytes);
const root='dist/library';
const data=path.join(root,'data/et-haochel');
const plain=s=>String(s).replace(/<[^>]*>/g,'').replace(/&(?:quot|amp|apos|lt|gt|nbsp|#39|#x27);/g,
 t=>({'&quot;':'"','&amp;':'&','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[t]));
assert.equal(source.title,'Et HaOchel');
assert.equal(source.sections.length,16);
const notes=new Map(),placements=new Set(),parallelRefs=new Set(),curated={};
let pairs=0,paragraphs=0,placed=0;
for(const section of source.sections){
 const built=JSON.parse(fs.readFileSync(path.join(data,`${section.n-1}.json`),'utf8'));
 assert.equal(built.length,section.items.length);
 let parallelCount=0;
 for(let i=0;i<built.length;i++){
  const item=built[i],original=section.items[i];paragraphs++;
  assert.deepEqual(item.footnotes||[],original.footnotes||[],'Footnote payload changed in ois '+section.n);
  assert.equal(item.p.length,original.p.length);
  for(let j=0;j<item.p.length;j++){
   assert.equal(plain(item.p[j][0]),plain(original.p[j][0]));
   assert.equal(plain(item.p[j][1]),plain(original.p[j][1]));pairs++;
  }
  const ref=`Et HaOchel ${section.n}:${item.n||i+1}`;
  const parallels=[];
  for(const note of item.footnotes||[]){
   assert.match(note.sourceId,/^EH-\d{4}$/);
   assert.equal(note.number,Number(note.sourceId.slice(3)));
   assert.ok(!placements.has(note.placementId),'Duplicate placement '+note.placementId);
   placements.add(note.placementId);placed++;
   assert.equal(plain(item.p[note.phraseIndex][0]).slice(0,note.heCharOffset),note.heAnchorPrefix);
   assert.ok(!('enCharOffset' in note)&&!('enWord' in note),'English note marker');
   assert.equal(note.sources.length,1);
   assert.match(note.sources[0].url,/^https:\/\/www\.sefaria\.org\//);
   assert.ok(note.paragraphs.length>=1);
   assert.ok(note.paragraphs[0].rich.some(r=>r.bold&&r.href===note.sources[0].url));
   for(const p of note.paragraphs){
    assert.equal(p.rich.map(r=>r.text).join(''),p.text);
    assert.ok(!/[\u0590-\u05ff]/.test(p.text),'Footnote is not English');
   }
   const canonical=JSON.stringify({number:note.number,kind:note.kind,paragraphs:note.paragraphs,sources:note.sources});
   if(notes.has(note.sourceId))assert.equal(notes.get(note.sourceId),canonical);
   else notes.set(note.sourceId,canonical);
   if(note.kind==='parallel'){
    const other=note.sources[0].ref;
    assert.ok(!parallelRefs.has(other),'Repeated parallel '+other);
    parallelRefs.add(other);parallelCount++;
    // These are editorially selected thematic parallels, not a shared-citation score.
    parallels.push([other,1,[],[]]);
   }
  }
  curated[ref]={p:parallels,reviewedParallels:true};
 }
 assert.equal(parallelCount,2,'Expected two distinct parallels in ois '+section.n);
}
assert.equal(paragraphs,17);assert.equal(pairs,303);assert.equal(placed,248);assert.equal(notes.size,230);assert.equal(parallelRefs.size,32);
assert.deepEqual([...notes.keys()].sort(),Array.from({length:230},(_,i)=>`EH-${String(i+1).padStart(4,'0')}`));
for(const dir of ['dist/library/data/parallels','dist/mcp-data/parallels']){
 const file=path.join(dir,'et-haochel.json');
 const old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 const selected={};
 for(const [ref,entry] of Object.entries(curated))selected[ref]={...(old[ref]?.q?{q:old[ref].q}:{}),...entry};
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify(selected));
 const indexFile=path.join(dir,'index.json');
 if(fs.existsSync(indexFile)){
  const index=JSON.parse(fs.readFileSync(indexFile,'utf8'));
  if(!index.includes('et-haochel'))index.push('et-haochel');
  fs.writeFileSync(indexFile,JSON.stringify(index.sort()));
 }
}
const sourceHash=createHash('sha256').update(sourceBytes).digest('hex');
const tag='20261016-et-haochel-230-'+sourceHash.slice(0,12);
const htmlFile=path.join(root,'index.html');
if(fs.existsSync(htmlFile)){
 let html=fs.readFileSync(htmlFile,'utf8');
 const start='const editionDataUrl = url => ';
 if(!html.includes(tag)){
  assert.equal(html.split(start).length,2,'Reader data URL function missing');
  html=html.replace(start,start+`(url.startsWith('data/et-haochel/') || url === 'data/parallels/et-haochel.json') ? url + '?edition=${tag}' : `);
  fs.writeFileSync(htmlFile,html);
 }
}
const swFile=path.join(root,'sw.js');
if(fs.existsSync(swFile)){
 let sw=fs.readFileSync(swFile,'utf8');
 assert.match(sw,/const VERSION = '[^']+';/);
 sw=sw.replace(/const VERSION = '[^']+';/,`const VERSION = '${tag}';`);
 if(!sw.includes("rel.startsWith('data/et-haochel/')")){
  const before='} else if (/^data';
  assert.ok(sw.includes(before),'Service worker data route missing');
  sw=sw.replace(before,"} else if (rel.startsWith('data/et-haochel/') || rel === 'data/parallels/et-haochel.json' || /^data");
 }
 fs.writeFileSync(swFile,sw);
}
const report={title:source.title,sections:16,paragraphs,phrasePairs:pairs,uniqueFootnotes:notes.size,
 footnotePlacements:placed,distinctParallelPassages:parallelRefs.size,englishMarkers:0,hebrewPreserved:true,
 sourceSha256:sourceHash,edition:tag};
fs.writeFileSync(path.join(root,'et-haochel-publication.json'),JSON.stringify(report,null,2)+'\n');
console.log('PASS Et HaOchel publication: all 16 oisiyos, 230 English notes, 248 Hebrew-only anchors, 32 nonrepeated parallels; updated reader cache version.');

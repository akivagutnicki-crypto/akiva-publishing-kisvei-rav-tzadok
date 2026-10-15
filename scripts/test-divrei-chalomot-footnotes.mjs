// Verify every Divrei Chalomot source note in the generated GitHub Pages reader.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {addDivreiChalomotFootnotes} from './import-divrei-chalomot-footnotes.mjs';
const book=JSON.parse(fs.readFileSync('sources/akiva/Divrei_Chalomot.json','utf8'));
assert.equal(addDivreiChalomotFootnotes(book),true);
const expected=book.sections.flatMap(s=>s.items.flatMap(i=>i.footnotes||[]));
assert.equal(expected.length,242);
const dir='dist/library/data/divrei-chalomot/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
assert.equal(toc.toc.children.length,28);
const bare=s=>String(s??'').replace(/<[^>]*>/g,'')
 .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,(_,key)=>({
  amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"
 }[key]));
let got=[],touched=new Set(),sourceLinks=0;
for(let s=0;s<28;s++){
 const file=dir+s+'.json';
 assert.ok(fs.existsSync(file),'Missing Divrei Chalomot section '+s);
 const arr=JSON.parse(fs.readFileSync(file,'utf8'));
 const secNotes=arr.flatMap(i=>(i.footnotes||[]).filter(n=>n.sourceId?.startsWith('DC-')));
 assert.ok(secNotes.length>0,'Missing annotations in section '+s);
 for(const [ii,item] of arr.entries()){
  for(const note of (item.footnotes||[]).filter(n=>n.sourceId?.startsWith('DC-'))){
   const phrase=item.p?.[note.phraseIndex];
   assert.ok(phrase,'Divrei Chalomot note without a phrase '+note.sourceId);
   assert.equal(bare(phrase[0]).slice(0,note.heCharOffset),note.heAnchorPrefix,
      'Note shifted in Hebrew '+note.sourceId);
   assert.equal(bare(phrase[1]).slice(0,note.enCharOffset),note.enAnchorPrefix,
      'Note shifted in English '+note.sourceId);
   assert.equal(note.placementId,note.sourceId+'-1');
   assert.equal(note.paragraphs.length,4,'Source + parallels must be intact '+note.sourceId);
   for(const para of note.paragraphs)assert.equal(para.rich.map(run=>run.text).join(''),para.text,
      'Truncated source translation '+note.sourceId);
   assert.equal(note.sources.length,3,'Missing original source+parallel links '+note.sourceId);
   assert.ok(note.sources.every(x=>x.url.startsWith('https://www.sefaria.org/')),
      'Missing Sefaria link '+note.sourceId);
   sourceLinks+=note.sources.length;
   assert.deepEqual(note.nativeConnections,[],'Unwanted duplicate Sefaria connections '+note.sourceId);
   got.push(note);touched.add(s+':'+ii);
  }
 }
}
assert.equal(touched.size,30);
assert.equal(got.length,242);
assert.equal(sourceLinks,726);
assert.equal(new Set(got.map(n=>n.placementId)).size,242);
assert.deepEqual(got.map(n=>n.number),Array.from({length:242},(_,i)=>i+1));
for(let i=0;i<242;i++){
 assert.equal(got[i].sourceId,expected[i].sourceId);
 assert.deepEqual(got[i].paragraphs,expected[i].paragraphs);
}
console.log('PASS Divrei Chalomot: 242 full source notes, 28 interlinear sections, 30 text items, Hebrew-only anchors, 726 source/parallel links, Sefaria-rich English source translations.');

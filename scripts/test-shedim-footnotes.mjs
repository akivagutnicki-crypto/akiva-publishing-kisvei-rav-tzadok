// Validate all submitted Sichat Shedim notes in the generated reader.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {addShedimFootnotes} from './import-shedim-footnotes.mjs';
const path='sources/akiva/parts/';
const names=['Sichat_Shedim.json'];
const parts=new Map();
for(const name of names){
 const part=JSON.parse(fs.readFileSync(path+name,'utf8'));
 parts.set(part.book+'|'+part.node,part);
}
assert.deepEqual(addShedimFootnotes(parts),{notes:116,sections:2,items:14});
const dir='dist/library/data/sichat-shedim/';
const files=['0-1.json','0-2.json'];
const clean=s=>String(s??'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,
 (_,k)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"}[k]));
const got=[],touched=new Set();
for(const [section,filename] of files.entries()){
 const filenamePath=dir+filename;
 assert.ok(fs.existsSync(filenamePath),'Reader section not generated: '+filename);
 const items=JSON.parse(fs.readFileSync(filenamePath,'utf8'));
 const sectionNotes=items.flatMap(i=>(i.footnotes||[]).filter(n=>n.sourceId?.startsWith('SS-')));
 assert.ok(sectionNotes.length>0,'No source footnotes in '+filename);
 for(const item of items){
  for(const note of (item.footnotes||[]).filter(n=>n.sourceId?.startsWith('SS-'))){
   const pair=item.p?.[note.phraseIndex];
   assert.ok(pair,'Footnote points to missing interlinear phrase '+note.sourceId);
   assert.equal(clean(pair[0]).slice(0,note.heCharOffset),note.heAnchorPrefix,
     'Hebrew footnote moved '+note.sourceId);
   assert.equal(clean(pair[1]).slice(0,note.enCharOffset),note.enAnchorPrefix,
     'English side shifted '+note.sourceId);
   assert.equal(note.placementId,note.sourceId+'-1');
   assert.equal(note.paragraphs.length,3,'Missing source or two parallel translations '+note.sourceId);
   for(const p of note.paragraphs){
    assert.equal(p.rich.map(run=>run.text).join(''),p.text,
      'Truncated English source or parallel '+note.sourceId);
   }
   assert.ok(note.sources?.[0]?.url?.startsWith('https://www.sefaria.org/'),
     'Missing clickable source '+note.sourceId);
   touched.add(filename+':'+item.n);
   got.push(note);
  }
 }
}
assert.equal(touched.size,14);
assert.equal(got.length,116);
assert.deepEqual(got.map(x=>x.number),Array.from({length:116},(_,i)=>i+1));
assert.equal(new Set(got.map(x=>x.placementId)).size,116);
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
assert.equal(toc.title,'Sichat Shedim');
console.log('PASS Sichat Shedim: 116 continuous Hebrew-only notes, two reader sections, 14 paragraphs, complete English source translations, Rav Tzadok / Ishbitz parallels and Sefaria source links');

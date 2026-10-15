// Check every published Kometz HaMinchah English source note and Hebrew marker.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root='dist/library/data/kometz-haminchah/';
const toc=JSON.parse(fs.readFileSync(root+'toc.json','utf8'));
const leaves=(function flatten(nodes){return nodes.flatMap(n=>n.children?flatten(n.children):[n]);})(toc.toc.children);
const visible=s=>String(s??'').replace(/<[^>]*>/g,'')
 .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,(_,key)=>({
 amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"
 }[key]));
assert.equal(leaves.length,194,'Expected all 194 original Kometz study sections');
let number=0,itemsWithNotes=0,parallelRefs=0,primaryLinks=0;
for(const leaf of leaves){
 const data=JSON.parse(fs.readFileSync(root+leaf.id+'.json','utf8'));
 let local=0;
 for(const item of data){
  if(!item.p || !item.footnotes?.length)continue;
  itemsWithNotes++;
  for(const note of item.footnotes){
   number++; local++;
   assert.equal(note.number,number,'Continuous book-wide footnote numbers');
   assert.equal(note.sourceId,'KH-'+String(number).padStart(4,'0'));
   assert.equal(note.placementId,note.sourceId+'-1');
   const pair=item.p[note.phraseIndex];
   assert.ok(pair,'Missing interlinear pair at '+note.sourceId);
   const he=visible(pair[0]),en=visible(pair[1]);
   assert.ok(note.heCharOffset>0 && note.heCharOffset<=he.length);
   assert.equal(he.slice(0,note.heCharOffset),note.heAnchorPrefix,'Hebrew marker moved '+note.sourceId);
   assert.equal(en.slice(0,note.enCharOffset),note.enAnchorPrefix,'English phrase changed '+note.sourceId);
   assert.equal(note.paragraphs?.length,3,'One full English source and two different parallels');
   for(const p of note.paragraphs){
    assert.ok(p.text.length>50,'Short/truncated source '+note.sourceId);
    assert.equal(p.rich.map(r=>r.text).join(''),p.text,'Rich text mismatch '+note.sourceId);
    assert.ok(!p.text.startsWith('Sources: '),'Redundant source review paragraph');
   }
   assert.equal(note.sources?.length,1);
   assert.match(note.sources[0].url,/^https:\/\/www\.sefaria\.org\//);
   assert.ok(note.paragraphs[0].rich.some(r=>r.href===note.sources[0].url));
   assert.equal(note.nativeConnections?.length,2);
   assert.notEqual(note.nativeConnections[0],note.nativeConnections[1]);
   primaryLinks++;parallelRefs+=2;
  }
 }
 assert.ok(local>0,'Unannotated Kometz section '+leaf.ref);
}
assert.equal(number,1619);
assert.equal(itemsWithNotes,210);
assert.equal(primaryLinks,1619);
assert.equal(parallelRefs,3238);
console.log('PASS Kometz HaMinchah: 1,619 numbered Hebrew-word markers in 194 sections / 210 items, 1,619 English linked sources, 3,238 distinct-per-note Chassidic parallels.');

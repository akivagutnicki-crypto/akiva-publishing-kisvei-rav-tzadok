// Validate the uploaded Likkutei Maamarim note overlay and built reader data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addLikkuteiFootnotes } from './import-likkutei-footnotes.mjs';
const parts=new Map();
for(const node of ['On Book of Joshua','Compositions on the Festivals','On Shimshon','Upon Completion of Talmud']){
  const file='sources/akiva/parts/Likkutei_Maamarim_'+node.replace(/[^A-Za-z0-9]+/g,'_')+'.json';
  const part=JSON.parse(fs.readFileSync(file,'utf8'));
  parts.set(part.book+'|'+part.node,part);
}
const stats=addLikkuteiFootnotes(parts);
assert.deepEqual(stats,{notes:3169,sections:19,items:164});
const names=['0.json',...Array.from({length:16},(_,i)=>'1-'+(i+1)+'.json'),'2.json','3.json'];
const all=[];
for (const name of names) {
  const file='dist/library/data/likkutei-maamarim/'+name;
  assert.ok(fs.existsSync(file),'Reader file missing '+name);
  const items=JSON.parse(fs.readFileSync(file,'utf8'));
  const notes=items.flatMap(i=>i.footnotes||[]).filter(n=>n.sourceId?.startsWith('LM-'));
  assert.ok(notes.length>0,'No notes in '+name);
  for(const item of items){
    for(const note of (item.footnotes||[]).filter(n=>n.sourceId?.startsWith('LM-'))){
      const pair=item.p[note.phraseIndex];
      assert.ok(pair,'Note points outside interlinear phrase '+note.sourceId);
      const text=String(pair[0]).replace(/<[^>]*>/g,'').replace(/&amp;/g,'&');
      assert.equal(text.slice(0,note.heCharOffset),note.heAnchorPrefix,'Hebrew anchor moved '+note.sourceId);
      assert.ok(note.paragraphs.length>=3,'English source and parallels missing '+note.sourceId);
      assert.ok(note.sources?.[0]?.url?.startsWith('https://www.sefaria.org/'));
      assert.equal(note.placementId,note.sourceId+'-1');
      all.push(note);
    }
  }
}
assert.equal(all.length,3169);
assert.deepEqual(all.map(n=>n.number),Array.from({length:3169},(_,i)=>i+1));
assert.equal(new Set(all.map(n=>n.placementId)).size,3169);
console.log('Likkutei Maamarim passed: 19 reader sections, 3,169 continuous Hebrew-word notes, all Sefaria source links present.');

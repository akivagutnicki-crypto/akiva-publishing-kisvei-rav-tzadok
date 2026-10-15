// Verify that all submitted Poked Akarim notes land in the built reader,
 // once, with exact Hebrew words and original complete English commentary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {addPokedFootnotes} from './import-poked-footnotes.mjs';
const src=JSON.parse(fs.readFileSync('sources/akiva/Poked_Akarim.json','utf8'));
assert.equal(addPokedFootnotes(src),true);
assert.equal(src.footnoteImportInfo.notes,925);
const expected=src.sections.flatMap(sec=>sec.items.flatMap(item=>(item.footnotes||[]).filter(n=>n.sourceId?.startsWith('PA-'))));
assert.equal(expected.length,925);
const dir='dist/library/data/poked-akarim/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
const got=[];
function plain(v){
 return String(v||'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,
  (_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"}[key]));
}
for(let k=0;k<6;k++){
  const file=k+'.json';
  assert.ok(fs.existsSync(dir+file),'Missing Poked reader section '+file);
  const items=JSON.parse(fs.readFileSync(dir+file,'utf8'));
  const notes=items.flatMap(item=>(item.footnotes||[]).filter(n=>n.sourceId?.startsWith('PA-')));
  assert.ok(notes.length,'No Poked footnotes in '+file);
  for(const item of items){
    for(const note of (item.footnotes||[]).filter(n=>n.sourceId?.startsWith('PA-'))){
      const phrase=item.p?.[note.phraseIndex];
      assert.ok(phrase,'Missing Poked phrase '+note.sourceId);
      assert.equal(plain(phrase[0]).slice(0,note.heCharOffset),note.heAnchorPrefix,'Hebrew anchor moved '+note.sourceId);
      assert.equal(plain(phrase[1]).slice(0,note.enCharOffset),note.enAnchorPrefix,'English phrase moved '+note.sourceId);
      assert.equal(note.paragraphs.length,3,'Missing full source and two parallels '+note.sourceId);
      for(const paragraph of note.paragraphs)
        assert.equal(paragraph.rich.map(v=>v.text).join(''),paragraph.text,'Footnote truncated '+note.sourceId);
      assert.ok(/^https:\/\/www\.sefaria\.org\//.test(note.sources[0]?.url),'Broken source URL format '+note.sourceId);
      assert.equal(note.placementId,note.sourceId+'-1');
      got.push(note);
    }
  }
}
assert.equal(got.length,925);
assert.deepEqual(got.map(n=>n.number),Array.from({length:925},(_,i)=>i+1));
assert.equal(new Set(got.map(n=>n.placementId)).size,925);
for(let i=0;i<got.length;i++){
  assert.equal(got[i].sourceId,expected[i].sourceId);
  assert.deepEqual(got[i].paragraphs,expected[i].paragraphs);
}
assert.equal(toc.toc.children.length,6);
console.log('PASS Poked Akarim: six complete sections, 925 exact Hebrew-word footnotes, full English translations, Sefaria source links, and uninterrupted global numbering');

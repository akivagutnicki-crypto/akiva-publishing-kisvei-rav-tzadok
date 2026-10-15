// Check the entire imported Ohr Zarua LaTzadik corpus against every reader leaf.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {addOhrZaruaFootnotes} from './import-ohr-zarua-footnotes.mjs';
const book=JSON.parse(fs.readFileSync('sources/akiva/Ohr_Zarua_LaTzadik.json','utf8'));
assert.equal(addOhrZaruaFootnotes(book),true);
const expected=book.sections.flatMap(s=>s.items.flatMap(i=>i.footnotes||[]));
assert.equal(expected.length,1687);
const directory='dist/library/data/ohr-zarua-latzadik/';
const toc=JSON.parse(fs.readFileSync(directory+'toc.json','utf8'));
assert.equal(toc.toc.children.length,59);
const clean=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,
 (_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"}[key]));
const found=[];let paragraphs=new Set();
for(let section=0;section<59;section++){
 const path=directory+section+'.json';
 assert.ok(fs.existsSync(path),'Missing Ohr Zarua reader section '+section);
 const items=JSON.parse(fs.readFileSync(path,'utf8'));
 const notes=items.flatMap(i=>(i.footnotes||[]).filter(n=>n.sourceId?.startsWith('OZ-')));
 assert.ok(notes.length>0,'Missing Ohr Zarua footnotes in section '+section);
 for(const item of items){
   for(const note of (item.footnotes||[]).filter(n=>n.sourceId?.startsWith('OZ-'))){
    const phrase=item.p?.[note.phraseIndex];
    assert.ok(phrase,'Unmatched Ohr Zarua phrase '+note.sourceId);
    assert.equal(clean(phrase[0]).slice(0,note.heCharOffset),note.heAnchorPrefix,
       'Hebrew source note marker moved '+note.sourceId);
    assert.equal(clean(phrase[1]).slice(0,note.enCharOffset),note.enAnchorPrefix,
       'English source note anchor moved '+note.sourceId);
    assert.equal(note.paragraphs.length,4,'Full English source+parallel paragraphs missing '+note.sourceId);
    for(const p of note.paragraphs)
      assert.equal(p.rich.map(run=>run.text).join(''),p.text,'Truncated source passage '+note.sourceId);
    assert.ok(note.sources?.[0]?.url?.startsWith('https://www.sefaria.org/'),
      'Sefaria link not present '+note.sourceId);
    assert.equal(note.placementId,note.sourceId+'-1');
    found.push(note);
    paragraphs.add(section+':'+item.n);
   }
 }
}
assert.equal(found.length,1687);
assert.equal(paragraphs.size,341);
assert.equal(new Set(found.map(n=>n.placementId)).size,1687);
assert.deepEqual(found.map(n=>n.number),Array.from({length:1687},(_,i)=>i+1));
for(let i=0;i<1687;i++){
 assert.equal(found[i].sourceId,expected[i].sourceId);
 assert.deepEqual(found[i].paragraphs,expected[i].paragraphs);
}
console.log('PASS Ohr Zarua: 59 interlinear sections; 1,687 continuous Hebrew-anchored popup notes in 341 paragraphs; unabridged English source translations, R. Tzadok & Ishbitz–Radzin parallels, clickable Sefaria citations.');

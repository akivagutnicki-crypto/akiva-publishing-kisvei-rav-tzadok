import assert from 'node:assert/strict';
import fs from 'node:fs';
const orig=JSON.parse(fs.readFileSync('sources/akiva/annotations/Peri_Tzadik_Bereshit_3_Commentary.json','utf8'));
const toc=JSON.parse(fs.readFileSync('dist/library/data/peri-tzadik/toc.json','utf8'));
const leaves=[];function walk(x){if(x?.ref)leaves.push(x);for(const y of x?.children||[])walk(y);}walk(toc.toc);
const leaf=leaves.find(x=>x.ref==='Peri Tzadik, Bereshit 3'&&x.interlinear);
assert.ok(leaf,'Missing genuine interlinear Bereshis Ois 3');
const items=JSON.parse(fs.readFileSync('dist/library/data/peri-tzadik/'+leaf.id+'.json','utf8')).filter(x=>x.p);
assert.equal(items.flatMap(i=>i.p).length,135,'Original interlinear phrases changed');
const all=items.flatMap((p,i)=>(p.footnotes||[]).map(note=>({p,index:i,note})));
const original=all.filter(x=>!x.note.provenance?.reviewSource);
const added=all.filter(x=>x.note.provenance?.reviewSource);
assert.equal(original.length,17,'Lost one of the 17 original Word footnotes');
assert.ok(added.length>=20,'Expanded primary sources were not added');
assert.equal(all.length,original.length+added.length);
assert.deepEqual(all.map(x=>x.note.number),Array.from({length:all.length},(_,i)=>i+1),'Markers must be numbered in Hebrew reading order');
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
for(const n of orig.notes){
 const x=original.find(y=>y.index===n.topicIndex&&y.note.phraseIndex===n.phraseIndex);
 assert.ok(x,'Original Word footnote shifted or erased '+n.number);
 assert.equal(x.note.heCharOffset,plain(x.p.p[x.note.phraseIndex][0]).length);
 assert.ok(x.note.paragraphs[0].text.length>=180);
 assert.ok(x.note.paragraphs[0].rich?.some(q=>q.href?.startsWith('https://www.sefaria.org/')));
}
for(const {p,note} of added){
 assert.equal(plain(p.p[note.phraseIndex][0]).slice(0,note.heCharOffset),note.heAnchorPrefix);
 assert.equal(plain(p.p[note.phraseIndex][1]).slice(0,note.enCharOffset),note.enAnchorPrefix);
 assert.ok(note.paragraphs[0].rich?.some(r=>r.href?.startsWith('https://www.sefaria.org/')) || note.sources.length===0);
 assert.ok(!note.paragraphs[0].text.includes('Context and connection to Pri Tzaddik:'));
}
console.log('PASS Bereishis 3: 135 phrase pairs, all 17 original scholarly Word notes intact, '+added.length+' new anchored source notes and orderly marker numbering.');

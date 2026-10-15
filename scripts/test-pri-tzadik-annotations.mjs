// Confirm the original 31 Word annotations survive the selective expansion.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='dist/library/data/peri-tzadik/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
const leaves=[];function walk(x){if(x?.ref)leaves.push(x);for(const y of x?.children||[])walk(y);}walk(toc.toc);
const strip=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
let originalCount=0,expandedCount=0,all=[];
for(const [ois,expectedNotes,expectedPhrases] of [[5,15,158],[6,16,194]]){
 const ref='Peri Tzadik, Noach '+ois;
 const leaf=leaves.find(x=>x.ref===ref&&x.interlinear);assert.ok(leaf);
 const data=JSON.parse(fs.readFileSync(dir+leaf.id+'.json','utf8'));
 const ps=data.filter(i=>i.p);
 assert.equal(ps.flatMap(x=>x.p).length,expectedPhrases,'Original phrase count changed');
 assert.ok(ps.every(i=>i.p.every(([he,en])=>/[\u0591-\u05c7]/.test(he)&&en&&!/\s{2,}/.test(en))));
 const notes=ps.flatMap(i=>(i.footnotes||[]).map(n=>({item:i,n})));
 const preserved=notes.filter(x=>!x.n.provenance?.reviewSource);
 const expanded=notes.filter(x=>x.n.provenance?.reviewSource);
 assert.equal(preserved.length,expectedNotes,'Original Word-footnote omitted');
 for(const {item,n} of preserved){
  assert.equal(n.heCharOffset,strip(item.p[n.phraseIndex][0]).length,'Original Word anchor moved');
  assert.equal(n.paragraphs.length,6,'Original commentary material rewritten');
  assert.ok(n.paragraphs.some(p=>/English translation/i.test(p.text)));
  assert.ok(n.paragraphs.flatMap(p=>p.links||[]).filter(l=>/^https:\/\/www\.sefaria\.org\//.test(l.url)).length>=2);
 }
 for(const {item,n} of expanded){
  assert.equal(strip(item.p[n.phraseIndex][0]).slice(0,n.heCharOffset),n.heAnchorPrefix);
  assert.equal(strip(item.p[n.phraseIndex][1]).slice(0,n.enCharOffset),n.enAnchorPrefix);
  assert.equal(n.paragraphs.length,1,'Unwanted duplicate Source Review paragraphs');
 }
 originalCount+=preserved.length;expandedCount+=expanded.length;
 all.push(...notes.map(x=>x.n.number));
}
assert.equal(originalCount,31);
assert.equal(expandedCount,8);
assert.deepEqual(all,Array.from({length:39},(_,i)=>i+1));
console.log('PASS Noach Ois 5–6: all 31 reviewed Word notes preserved; 8 targeted new citations; 39 continuous Hebrew footnote numbers.');

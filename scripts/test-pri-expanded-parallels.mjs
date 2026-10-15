// Assert Hebrew markers, original English sources, and relevant, non-repeated
// expanded Rav Tzadok / Izhbitz-Radzin quotations in all 69 Pri Tzaddik sections.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const DIR='dist/library/data/peri-tzadik/';
const toc=JSON.parse(fs.readFileSync(DIR+'toc.json','utf8'));
const e=toc.expandedFootnoteParallels;
assert.equal(e.uploaded,1586);
assert.equal(e.reviewedPreserved,162);
assert.equal(e.matchedUnreviewed,1424);
assert.equal(e.unmatched,0);
assert.ok(e.selectedParallels>=20);
const leaves=[];function walk(x){if(x?.ref)leaves.push(x);for(const c of x?.children||[])walk(c);}walk(toc.toc);
const specials=new Set([92,105,106,111,112]),seenParallels=new Set();
let protectedNotes=0,primary=0,extra=0,withExtra=0;
for(const leaf of leaves.filter(x=>x.interlinear&&x.id>=90&&x.id<=158)){
 const items=JSON.parse(fs.readFileSync(DIR+leaf.id+'.json','utf8'));
 for(const item of items){
  for(const note of item.footnotes||[]){
   if(specials.has(leaf.id)){protectedNotes++;continue;}
   primary++;
   assert.ok(item.p[note.phraseIndex],'Original phrase missing '+note.sourceId);
   assert.ok(note.paragraphs[0].rich.some(r=>r.href?.startsWith('https://www.sefaria.org/')),'Original Sefaria primary citation lost '+note.sourceId);
   assert.ok(!note.paragraphs.some(p=>p.text.startsWith('Sources: ')),'Duplicate source summary in '+note.sourceId);
   assert.ok(note.paragraphs.length<=5,'More than 4 total parallels '+note.sourceId);
   if(note.sourceId==='PT-0002')assert.equal(note.paragraphs.length,1,'Do not reintroduce off-topic RH 32a parallels');
   if(note.paragraphs.some(p=>p.expansion==='pri-2026-reviewed'))withExtra++;
   for(const p of note.paragraphs.slice(1).filter(p=>p.expansion==='pri-2026-reviewed')){
    assert.match(p.text,/^Kisvei (Rav Tzadok|Ishbitz–Radzin) — /,'Unknown parallel');
    assert.equal(p.rich.map(z=>z.text).join(''),p.text,'Truncated English source passage '+note.sourceId);
    const sourceKey=p.text.split(': ')[0];
    assert.ok(!seenParallels.has(sourceKey),'Repeated parallel source across the sefer: '+sourceKey);
    seenParallels.add(sourceKey);extra++;
   }
  }
 }
}
assert.equal(primary,1424);
assert.equal(protectedNotes,162);
assert.equal(extra,e.selectedParallels);
assert.ok(withExtra>0);
console.log('PASS all 69 Pri Tzaddik interlinear sections:',primary,'source footnotes,',protectedNotes,'reviewed originals,',extra,'non-repeating expanded parallels; no duplicate Sefaria source summary.');

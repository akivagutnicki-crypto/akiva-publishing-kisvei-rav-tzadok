import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=JSON.parse(fs.readFileSync('sources/akiva/Tzidkat_HaTzadik.json','utf8'));
const root='dist/library/data/tzidkat-hatzadik/';
const toc=JSON.parse(fs.readFileSync(root+'toc.json','utf8'));
const links=JSON.parse(fs.readFileSync(root+'links.json','utf8'));
const ids=new Set(),placements=new Set(),pending=new Set();let count=0;
const textOf=s=>String(s).replace(/<[^>]*>/g,'').replace(/&(?:quot|amp|apos|lt|gt|nbsp|#39|#x27);/g,
 t=>({'&quot;':'"','&amp;':'&','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[t]));
for(const section of source.sections){
 const ref='Tzidkat HaTzadik '+section.n;
 const leaf=toc.toc.children.find(l=>l.ref===ref);assert.ok(leaf,ref);
 const published=JSON.parse(fs.readFileSync(root+leaf.id+'.json','utf8'));
 const numbers=new Map();
 for(const item of section.items.filter(i=>i.p)){
  const actual=published.find(i=>i.n===item.n&&i.p);assert.ok(actual,ref+':'+item.n);
  const expected=item.footnotes||[];assert.equal((actual.footnotes||[]).length,expected.length);
  for(const note of actual.footnotes||[]){
   count++;ids.add(note.sourceId);assert.ok(!placements.has(note.placementId));placements.add(note.placementId);
   const original=expected.find(n=>n.placementId===note.placementId);assert.deepEqual(note,original,'Incomplete note '+note.sourceId);
   const pair=actual.p[note.phraseIndex];assert.ok(pair);
   assert.equal(textOf(pair[0]).slice(0,note.heCharOffset),note.heAnchorPrefix,'Wrong Hebrew boundary '+note.placementId);
   assert.equal(textOf(pair[1]).slice(0,note.enCharOffset),note.enAnchorPrefix,'Wrong English boundary '+note.placementId);
   assert.ok(note.heCharOffset>0&&note.enCharOffset>0);
   assert.ok(!/[א-ת]/.test(note.paragraphs[0].text),'Footnote translation must be English');
   for(const p of note.paragraphs)assert.equal(p.rich.map(r=>r.text).join(''),p.text,'Truncated rich text '+note.sourceId);
   assert.ok(note.sources.length);
   for(const s of note.sources){
    assert.ok(/^https:\/\/www\.sefaria\.org\//.test(s.url));
    assert.ok(s.connectionsUrl.includes('?with=all'));
    assert.ok((links[ref]||[]).some(l=>l.a===ref+':'+item.n&&l.r===s.ref),'Source absent from paragraph connections '+s.ref);
   }
   if(numbers.has(note.sourceId))assert.equal(numbers.get(note.sourceId),note.number);
   numbers.set(note.sourceId,note.number);
   if(note.verificationStatus.includes('requires collation'))pending.add(note.sourceId);
   if(note.sourceId==='TZ-0093')assert.ok(note.paragraphs[0].text.includes('hires him for eight'));
   if(note.sourceId==='TZ-0255')assert.ok(note.paragraphs[0].text.includes('The letter tet is the illumination'));
   if(note.sourceId==='TZ-0251'){
    assert.equal(note.crossReference.ref,'Tzidkat HaTzadik 228:1');
    assert.ok(note.paragraphs[0].text.includes('section 228'));
    assert.equal(note.printedCrossReference,'See note 9 to section 224.');
   }
  }
 }
 assert.deepEqual([...new Set(numbers.values())].sort((a,b)=>a-b),Array.from({length:numbers.size},(_,i)=>i+1),'Numbering must restart in '+ref);
}
assert.equal(count,279);assert.equal(ids.size,269);assert.equal(placements.size,279);assert.equal(pending.size,6);
assert.deepEqual([...ids].sort(),Array.from({length:269},(_,i)=>'TZ-'+String(i+1).padStart(4,'0')));
assert.equal(source.footnoteImportInfo.sectionsWithNotes,165);
console.log('PASS Tzidkat footnotes: 269 complete English notes, 279 exact bilingual anchors, 165 simanim, six explicitly flagged edition checks, and linked paragraph sources.');

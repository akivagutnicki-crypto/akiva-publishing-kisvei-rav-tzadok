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
   const original=expected.find(n=>n.placementId===note.placementId);const canonical=structuredClone(original);canonical.number=Number(note.sourceId.slice(3));
   if(canonical.crossReference?.placementId)canonical.crossReference.number=Number(canonical.crossReference.placementId.slice(3,7));
   assert.deepEqual(note,canonical,'Incomplete note '+note.sourceId);
   assert.equal(note.number,Number(note.sourceId.slice(3)),'Continuous source-note number');
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
   if(note.crossReference?.placementId)assert.match(note.crossReference.placementId,/^TZ-\d{4}-\d+$/);
  }
 }
 assert.equal(numbers.size,new Set(numbers.values()).size,'Each source ID receives one book-wide number in '+ref);
}
const expected=source.footnoteImportInfo;
assert.equal(count,expected.placements,'Published source placements');
assert.equal(ids.size,expected.notes,'Published unique sources');
assert.equal(placements.size,expected.placements,'Distinct note placements');
assert.deepEqual([...ids].sort(),Array.from({length:ids.size},(_,i)=>'TZ-'+String(i+1).padStart(4,'0')),'Book-wide numbering is continuous');
const countedSections=source.sections.filter(s=>s.items.some(i=>(i.footnotes||[]).length)).length;
assert.equal(countedSections,expected.sectionsWithNotes);
assert.equal(pending.size,0,'The supplied reviewed edition has no pending collation notices');
console.log('PASS Tzidkat footnotes: '+ids.size+' complete English notes, '+count+' exact bilingual anchors, '+countedSections+' simanim, with book-wide numbering and linked paragraph sources.');

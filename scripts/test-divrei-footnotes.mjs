import fs from 'node:fs';
import assert from 'node:assert/strict';
const book = JSON.parse(fs.readFileSync('sources/akiva/Divrei_Soferim.json','utf8'));
const root = 'dist/library/data/divrei-soferim/';
const toc = JSON.parse(fs.readFileSync(root+'toc.json','utf8'));
const links = JSON.parse(fs.readFileSync(root+'links.json','utf8'));
const plain = s => String(s).replace(/<[^>]*>/g,'').replace(/&(?:quot|amp|apos|lt|gt|nbsp|#39|#x27);/g,
 m=>({'&quot;':'"','&amp;':'&','&apos':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[m]));
assert.equal(toc.toc.children.length,39,'38 chapters and introduction');
let count=0,linked=0,harBracha=0,expanded=0;
for(const s of book.sections){
 const ref=s.key?'Divrei Soferim, '+s.key:'Divrei Soferim '+s.n;
 const leaf=toc.toc.children.find(l=>l.ref===ref);
 assert.ok(leaf && leaf.interlinear, 'Missing interlinear leaf '+ref);
 const published=JSON.parse(fs.readFileSync(root+leaf.id+'.json','utf8'));
 const originalParagraphs=s.items.filter(x=>x.p),publishedParagraphs=published.filter(x=>x.p);
 assert.equal(publishedParagraphs.length,originalParagraphs.length,'Original bilingual paragraphs preserved '+ref);
 for(let i=0;i<originalParagraphs.length;i++){
  const original=originalParagraphs[i],actual=publishedParagraphs[i];
  assert.equal((actual.footnotes||[]).length,(original.footnotes||[]).length,ref+':'+i);
  const expectation=original.footnotes||[];
  for(let j=0;j<expectation.length;j++){
   const note=actual.footnotes[j];count++;
   assert.equal(note.number,count,'Book-wide numbering');
   assert.equal(note.sourceId,'DS-'+String(count).padStart(4,'0'));
   assert.equal(note.placementId,note.sourceId+'-1');
   const pair=actual.p[note.phraseIndex];
   assert.ok(pair,'Missing phrase '+note.sourceId);
   assert.equal(plain(pair[0]).slice(0,note.heCharOffset),note.heAnchorPrefix,'Incorrect Hebrew marker '+note.sourceId);
   assert.equal(plain(pair[1]).slice(0,note.enCharOffset),note.enAnchorPrefix,'Incorrect translation anchor '+note.sourceId);
   assert.equal(note.paragraphs.length,1,'Duplicate sources in '+note.sourceId);
   assert.equal(note.paragraphs[0].rich.map(x=>x.text).join(''),note.paragraphs[0].text);
   assert.ok(note.paragraphs[0].text.length>20,'English footnote missing '+note.sourceId);
   assert.ok(note.sources.length,'Do not discard source note');
   if(note.provenance.edition==='Har Bracha Edition')harBracha++;
   else if(note.provenance.edition==='Akiva Publishing Source Expansion')expanded++;
   for(const source of note.sources){
    if(!source.url?.startsWith('https://www.sefaria.org/'))continue;
    linked++;
    assert.ok(note.paragraphs[0].rich.some(x=>x.href===source.url),'Hyperlink not in text '+note.sourceId);
    assert.ok((links[ref]||[]).some(x=>x.r===source.ref&&x.a===ref+':'+(i+1)),'Source absent from reader connections '+note.sourceId);
   }
  }
 }
}
assert.equal(count,491);
assert.equal(linked,491);
assert.equal(harBracha,156);
assert.equal(expanded,335);
assert.equal(book.footnoteImportInfo.notes,491);
console.log('PASS Divrei Soferim: 491 preserved and anchored English footnotes, 491 Sefaria links, 39 sections and continuous numbering.');

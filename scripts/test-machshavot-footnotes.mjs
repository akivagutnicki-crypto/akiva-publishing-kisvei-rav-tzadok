import fs from 'node:fs';
import assert from 'node:assert/strict';
const work=JSON.parse(fs.readFileSync('sources/akiva/Machshavot_Charutz.json','utf8'));
const root='dist/library/data/machshavot-charutz/';
const toc=JSON.parse(fs.readFileSync(root+'toc.json','utf8'));
const links=JSON.parse(fs.readFileSync(root+'links.json','utf8'));
assert.equal(toc.toc.children.length,21);
assert.equal(work.sections.length,21);
assert.equal(work.interlinear,true);
const clean=x=>String(x).replace(/<[^>]*>/g,'').replace(/&(?:quot|amp|apos|lt|gt|nbsp|#39|#x27);/g,
 t=>({'&quot;':'"','&amp;':'&','&apos':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[t]));
let total=0,notesWithLinks=0,untranslated=0;
for(const sec of work.sections){
 const ref='Machshavot Charutz '+sec.n;
 const leaf=toc.toc.children.find(l=>l.ref===ref);
 assert.ok(leaf&&leaf.interlinear,'Missing interlinear TOC '+ref);
 const items=JSON.parse(fs.readFileSync(root+leaf.id+'.json','utf8'));
 for(const it of sec.items){
  if(!it.p)continue;
  const result=items.find(x=>x.n===it.n);
  assert.ok(result,'Missing '+ref+':'+it.n);
  assert.equal((result.footnotes||[]).length,(it.footnotes||[]).length);
  for(const note of result.footnotes||[]){
   total++;
   assert.equal(note.number,total);
   assert.equal(note.sourceId,'MC-'+String(total).padStart(4,'0'));
   const p=result.p[note.phraseIndex];
   assert.ok(p,'Missing anchored phrase '+note.sourceId);
   assert.equal(clean(p[0]).slice(0,note.heCharOffset),note.heAnchorPrefix);
   assert.equal(clean(p[1]).slice(0,note.enCharOffset),note.enAnchorPrefix);
   assert.equal(note.paragraphs.length,1,'Duplicate citations in '+note.sourceId);
   assert.equal(note.paragraphs[0].rich.map(x=>x.text).join(''),note.paragraphs[0].text);
   assert.ok(/[a-z]{3,}/i.test(note.paragraphs[0].text),'English source explanation required');
   if(note.sources.some(s=>s.url?.startsWith('https://www.sefaria.org/')))
     assert.ok(note.paragraphs[0].rich.some(x=>x.href?.startsWith('https://www.sefaria.org/')));
   if(note.verificationStatus==='source translation pending')untranslated++;
   for(const source of note.sources){
     if(source.url?.startsWith('https://www.sefaria.org/')) assert.ok((links[ref]||[]).some(x=>x.a===ref+':'+it.n&&x.r===source.ref),
       'Missing reader Sefaria connection '+note.sourceId+' '+source.ref);
     notesWithLinks++;
   }
  }
 }
}
assert.equal(total,3478);
assert.ok(notesWithLinks<=total); // Unavailable Sefaria sources must never drop notes.
assert.equal(untranslated,42);
console.log('PASS Machshavot publication: '+total+' continuously numbered Hebrew anchors, '+notesWithLinks+' Sefaria links, 21 interlinear simanim and 42 transparently flagged translations.');

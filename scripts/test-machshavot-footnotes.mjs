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
let total=0,notesWithLinks=0,untranslated=0,parallelCount=0;
const nearbyParallels=new Map();
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
   assert.ok(note.paragraphs.length>=1&&note.paragraphs.length<=3,'Incorrect popup paragraph count '+note.sourceId);
   for(const part of note.paragraphs)
     assert.equal(part.rich.map(x=>x.text).join(''),part.text,'Truncated rich popup '+note.sourceId);
   for(const part of note.paragraphs.slice(1)){
     assert.match(part.text,/^Kisvei (Rav Tzadok|Ishbitz–Radzin) — /,'Unidentified parallel passage '+note.sourceId);
     const label=part.text.split(': ')[0];
     const old=nearbyParallels.get(label);
     if(old!==undefined)assert.ok(note.number-old>=16,'Repeated same parallel within nearby footnotes '+label);
     nearbyParallels.set(label,note.number);
     parallelCount++;
   }
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
assert.equal(untranslated,work.footnoteImportInfo.sourceTranslationsAwaitingVerification);
assert.equal(work.footnoteImportInfo.expandedCsvNotes,3478);
assert.equal(work.footnoteImportInfo.matchedNotes,3478);
assert.equal(parallelCount,work.footnoteImportInfo.addedParallels);
assert.ok(parallelCount>=30,'Uploaded source parallels not imported');
console.log('PASS Machshavot publication: '+total+' Hebrew-anchored footnotes, 21 interlinear simanim, '+parallelCount+' selected expanded parallels and '+untranslated+' unverified source translations.');

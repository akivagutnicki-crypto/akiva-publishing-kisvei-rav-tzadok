// Coverage and precise Hebrew placement for all 69 interlinear Pri Tzaddik sections.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dir='dist/library/data/peri-tzadik/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
const leaves=[];function walk(n){if(n?.ref)leaves.push(n);for(const c of n?.children||[])walk(c);}walk(toc.toc);
const relevant=leaves.filter(n=>n.interlinear&&typeof n.id==='number'&&n.id>=90&&n.id<=158);
assert.equal(relevant.length,69,'Incomplete five-group interlinear Pri Tzaddik');
const exp=toc.expandedFootnotes;
assert.equal(exp.suppliedNotes,1580);
assert.equal(exp.newHebrewAnchoredNotes,1424);
assert.equal(exp.originalReviewedPreserved,162);
assert.equal(exp.totalPublishedNotes,1586);
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,token=>({
 '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&#39;':"'",'&#x27;':"'"
}[token]));
const byChapter=new Map(exp.countsBySection.map(s=>[s.id,s]));
const special=new Map([[92,42],[105,33],[106,48],[111,19],[112,20]]);
let sum=0,imported=0,reviewed=0,sourceLinks=0;
const groupCount=new Map();
for(const leaf of relevant){
 const data=JSON.parse(fs.readFileSync(dir+leaf.id+'.json','utf8'));
 const notes=data.filter(i=>i.p).flatMap(item=>(item.footnotes||[]).map(n=>({item,n})));
 const info=byChapter.get(leaf.id);
 assert.ok(info,'No reporting for chapter '+leaf.ref);
 assert.equal(notes.length,info.reviewed+info.imported,'Missing citations '+leaf.ref);
 assert.ok(notes.length>0,'No Hebrew footnotes visible in '+leaf.ref);
 if(special.has(leaf.id)){
  assert.equal(info.imported,0,'Existing Word edition overridden '+leaf.ref);
  assert.equal(notes.length,special.get(leaf.id),'Reviewed Word count changed '+leaf.ref);
 }else{
  assert.equal(info.reviewed,0,'Unexpected older notes in '+leaf.ref);
  assert.equal(info.imported,info.supplied,'Dropped uploaded sources '+leaf.ref);
 }
 for(const {item,n} of notes){
  // PT-0002 source correctness regression: the cited sugya must actually
  // explain "Bereishit nami ma'amar hu", not the unrelated blessing-order debate.
  if(n.sourceId==='PT-0002'){
    assert.equal(n.sources?.[0]?.ref,'Rosh Hashanah 32a:18-19','Wrong sugya citation for PT-0002');
    assert.equal(n.sources?.[0]?.url,'https://www.sefaria.org/Rosh_Hashanah.32a.18-19','Not linked to the exact sugya');
    assert.match(n.paragraphs[0].text,/ten utterances/i,'Missing ten utterances discussion');
    assert.match(n.paragraphs[0].text,/Bereishit.{0,24}utterance/i,'Missing the Gemara\'s actual answer');
    assert.doesNotMatch(n.paragraphs[0].text,/Rabban Shimon ben Gamliel/i,'Off-topic Gemara excerpt reintroduced');
    assert.equal(n.paragraphs.length,1,'Unverified or irrelevant parallels must not be added');
    assert.equal(n.sources.length,1,'Spurious cross-references must not be added');
  }
  assert.ok(n.paragraphs?.length,'Empty source note '+leaf.ref);
  assert.ok(Number.isInteger(n.phraseIndex) && item.p[n.phraseIndex],'Bad phrase index '+leaf.ref);
  const pair=item.p[n.phraseIndex];
  const he=plain(pair[0]),en=plain(pair[1]);
  assert.ok(n.heCharOffset>0&&n.heCharOffset<=he.length,'Hebrew marker outside actual words '+leaf.ref);
  assert.ok(!String(n.paragraphs[0].text).startsWith('Sources:'),'Redundant source summary '+leaf.ref);
  if(!special.has(leaf.id)){
   assert.ok(n.sourceId.startsWith('PT-') && !n.provenance?.reviewSource,'Incorrect expanded note ID '+leaf.ref);
   assert.equal(he.slice(0,n.heCharOffset),n.heAnchorPrefix,'Hebrew marker misaligned '+n.sourceId);
   assert.equal(en.slice(0,n.enCharOffset),n.enAnchorPrefix,'English insertion offset altered '+n.sourceId);
   assert.ok(n.paragraphs[0].text.length>15,'Empty translation '+n.sourceId);
   assert.ok(n.paragraphs[0].rich?.[0]?.href?.startsWith('https://www.sefaria.org/'),'No Sefaria source link '+n.sourceId);
   assert.ok(n.sources?.[0]?.url?.startsWith('https://www.sefaria.org/'),'Missing source metadata '+n.sourceId);
   sourceLinks++;imported++;
  }else reviewed++;
 }
 const group=leaf.id<105?'Bereishis':leaf.id<107?'Mar Cheshvan':leaf.id<117?'Noach':leaf.id<128?'Lech Lecha':leaf.id<135?'Kislev':'Chanukah';
 groupCount.set(group,(groupCount.get(group)||0)+1);
 sum+=notes.length;
}
assert.equal(sum,1586);assert.equal(imported,1424);assert.equal(reviewed,162);assert.equal(sourceLinks,1424);
assert.deepEqual(Object.fromEntries(groupCount),{Bereishis:15,'Mar Cheshvan':2,Noach:10,'Lech Lecha':11,Kislev:7,Chanukah:24});
const noach9=byChapter.get(115);assert.equal(noach9.imported,9);
const kislev1=byChapter.get(128);assert.equal(kislev1.imported,26);
const chanukah1=byChapter.get(135);assert.equal(chanukah1.imported,52);
console.log('PASS Full Pri Tzaddik reader: all 69 sections, 1,586 Hebrew-anchored notes including 1,424 imported linked sources and 162 preserved Word notes. Noach Ois 9 has all 9.');

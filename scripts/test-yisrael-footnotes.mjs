import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='dist/library/data/yisrael-kedoshim/';
const strip=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,x=>({
 '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&#39;':"'",'&#x27;':"'"
}[x]));
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
assert.equal(toc.footnoteImportInfo.notes,2097);
assert.equal(toc.footnoteImportInfo.sectionsWithNotes,10);
let total=0,primaryLinked=0,parallelLinked=0,active=0,perChapter=[];
const cited=JSON.parse(fs.readFileSync(dir+'links.json','utf8'));
for(let ch=1;ch<=10;ch++){
 const items=JSON.parse(fs.readFileSync(dir+'0-'+ch+'.json','utf8'));
 let here=0;
 for(const item of items)for(const note of item.footnotes||[]){
  here++;total++;
  const id='YK-'+String(total).padStart(4,'0');
  assert.equal(note.number,total,'No restart within book');
  assert.equal(note.sourceId,id);
  assert.equal(note.placementId,id+'-1');
  assert.equal(note.paragraphs.length,3,'One primary + two unique English parallels');
  assert.equal(note.nativeConnections.length,2);
  assert.equal(note.sources.length,1);
  const pair=item.p[note.phraseIndex];
  assert.ok(pair,'Missing original Hebrew/English pair '+id);
  assert.equal(strip(pair[0]).slice(0,note.heCharOffset),note.heAnchorPrefix,'Incorrect Hebrew marker '+id);
  assert.equal(strip(pair[1]).slice(0,note.enCharOffset),note.enAnchorPrefix,'Incorrect English anchor '+id);
  assert.ok(note.heWord>=1);
  for(let i=0;i<3;i++){
   const p=note.paragraphs[i];
   assert.equal(p.text,p.rich.map(r=>r.text).join(''),'Rich text corrupt '+id);
   assert.ok(p.text.length>(i===0?10:60),'Truncated translation '+id);
   assert.ok(!p.text.startsWith('Sources:'),'Redundant source list '+id);
   if(i>0&&p.rich[0].href)parallelLinked++;
   if(i>0&&p.rich[0].href)assert.ok(!p.rich[0].href.includes('/topics/'),'Generic parallel erroneously hyperlinked');
  }
  const source=note.sources[0];
  assert.ok(source.url?.startsWith('https://www.sefaria.org/'),'Lost Sefaria link '+id);
  if(/\d/.test(source.url.slice('https://www.sefaria.org/'.length)))assert.equal(note.paragraphs[0].rich[0].href,source.url,'Missing exact source link '+id);
  assert.ok((cited['Yisrael Kedoshim '+ch]||[]).some(l=>l.r===source.ref && l.a==='Yisrael Kedoshim '+ch+':'+item.n),'Missing indexed connection '+id);
  primaryLinked++;
 }
 assert.ok(here>0,'Section '+ch+' contains no notes');
 perChapter.push(here);
}
assert.equal(total,2097);
assert.equal(primaryLinked,2097);
assert.equal(toc.footnoteImportInfo.sourceLinks,2097);
assert.equal(parallelLinked,toc.footnoteImportInfo.exactParallelLinks);
assert.equal(perChapter.reduce((a,b)=>a+b),2097);
console.log('PASS REPLACED Yisrael Kedoshim: 2097 continuously numbered Hebrew markers, 2097 primary Sefaria citations, exact positions across 10 sections and 2 English parallels per note.');

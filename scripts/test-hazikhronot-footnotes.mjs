import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT='dist/library/data/sefer-hazikhronot/';
const toc=JSON.parse(fs.readFileSync(ROOT+'toc.json','utf8'));
const links=JSON.parse(fs.readFileSync(ROOT+'links.json','utf8'));
const leaves=(function flat(nodes){return nodes.flatMap(n=>n.children?flat(n.children):[n]);})(toc.toc.children);
const visible=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:quot|amp|lt|gt|nbsp|#39|#x27);/g,
 t=>({'&quot;':'"','&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[t]));

let total=0,sourceLinks=0,parallels=0;
for(let ch=1;ch<=35;ch++){
  const ref='Sefer HaZikhronot '+ch;
  const leaf=leaves.find(l=>l.ref===ref);
  assert.ok(leaf?.interlinear,'Missing interlinear leaf '+ref);
  const data=JSON.parse(fs.readFileSync(ROOT+leaf.id+'.json','utf8'));
  let chapterNotes=0;
  for(const item of data){
    if(!item.p)continue;
    for(const note of item.footnotes||[]){
      chapterNotes++;total++;
      assert.equal(note.number,total,'Broken continuous numbering at '+ref);
      assert.equal(note.sourceId,'SZ-'+String(total).padStart(4,'0'));
      assert.equal(note.placementId,note.sourceId+'-1');
      const pair=item.p[note.phraseIndex];
      assert.ok(pair,'Footnote not attached to a phrase: '+note.sourceId);
      assert.equal(visible(pair[0]).slice(0,note.heCharOffset),note.heAnchorPrefix);
      assert.equal(visible(pair[1]).slice(0,note.enCharOffset),note.enAnchorPrefix);
      assert.equal(note.paragraphs?.length,3,'Original source + two full parallels required');
      for(const para of note.paragraphs){
        assert.ok(para.text.length>35,'Truncated translation '+note.sourceId);
        assert.equal(para.rich.map(x=>x.text).join(''),para.text,'Rich text truncated');
        assert.ok(!para.text.startsWith('Sources: '),'Duplicate source-list paragraph');
      }
      assert.equal(note.sources?.length,1);
      for(const source of note.sources){
        if(source.url?.startsWith('https://www.sefaria.org/')){
          sourceLinks++;
          assert.ok(note.paragraphs[0].rich.some(run=>run.href===source.url),'Sefaria hyperlink not in source paragraph');
          assert.ok((links[ref]||[]).some(l=>l.r===source.ref&&l.a.startsWith(ref+':')),
            'Primary source not in paragraph connections: '+source.ref);
        }
      }
      assert.equal(note.nativeConnections?.length,2,'Lost Rav Tzadok / Ishbitz–Radzin parallels');
      for(const local of note.nativeConnections){
        parallels++;
        assert.ok((links[ref]||[]).some(x=>x.r===local),
          'Native parallel not indexed: '+local);
      }
    }
  }
  assert.ok(chapterNotes>0,'Lost footnotes from '+ref);
}
assert.equal(total,769,'All uploaded footnotes must survive');
assert.equal(sourceLinks,769,'All supplied Sefaria URLs must survive');
assert.equal(parallels,1538,'Two scholarly parallels per note');
console.log('PASS Sefer HaZikhronot: 769 continuous Hebrew note markers, linked English translations and 1,538 Rav Tzadok/Ishbitz parallels.');

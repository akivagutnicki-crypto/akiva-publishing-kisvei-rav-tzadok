import fs from 'node:fs';
import assert from 'node:assert/strict';
const base='dist/library/data/yisrael-kedoshim/';
const strip=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|quot|apos|lt|gt|nbsp|#39|#x27);/g,
 m=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[m]));
const toc=JSON.parse(fs.readFileSync(base+'toc.json'));
assert.equal(toc.footnoteImportInfo.notes,2658);
let total=0,sourceLinks=0,hb=0;
for(let c=1;c<=10;c++){
  const arr=JSON.parse(fs.readFileSync(base+'0-'+c+'.json'));
  let count=0,lastRav='',lastIsh='';
  for(const item of arr)for(const n of item.footnotes||[]){
    if(!n.sourceId?.startsWith('YK-'))continue;
    count++;total++;
    assert.equal(n.number,total,'Footnote numbering gap');
    assert.equal(n.sourceId,'YK-'+String(total).padStart(4,'0'));
    assert.equal(n.placementId,n.sourceId+'-1');
    const p=item.p[n.phraseIndex];
    assert.ok(p,'Missing phrase '+n.sourceId);
    assert.equal(strip(p[0]).slice(0,n.heCharOffset),n.heAnchorPrefix,'Hebrew anchor mismatch '+n.sourceId);
    assert.equal(strip(p[1]).slice(0,n.enCharOffset),n.enAnchorPrefix,'English anchor mismatch '+n.sourceId);
    assert.ok(n.paragraphs.length>=1);
    for(const para of n.paragraphs){
      assert.equal(para.rich.map(x=>x.text).join(''),para.text);
      assert.ok(!para.text.startsWith('Sources:'),'Redundant source list '+n.sourceId);
      if(para.text.startsWith('Beit Yaakov')||para.text.startsWith('Mei HaShiloach')){assert.notEqual(para.text,lastIsh,'Repeated adjacent Ishbitz source');lastIsh=para.text;}
      if(para.text.startsWith('Tzidkat ')||para.text.startsWith('Resisei ')||para.text.startsWith('Kometz ')){assert.notEqual(para.text,lastRav,'Repeated adjacent Rav Tzadok source');lastRav=para.text;}
    }
    assert.ok(n.sources?.length===1);
    if(n.sources[0].role==='har-bracha-footnote'){
      hb++;assert.ok(!n.sources[0].url,'Misleading Har Bracha link');
    } else {
      assert.ok(n.sources[0].url?.startsWith('https://www.sefaria.org/'));
      assert.equal(n.paragraphs[0].rich[0].href,n.sources[0].url);
      sourceLinks++;
    }
  }
  assert.ok(count>0,'No notes in section '+c);
}
assert.equal(total,2658);assert.equal(hb,327);assert.equal(sourceLinks,2331);
console.log('PASS Yisrael Kedoshim: 2658 continuous anchored Hebrew footnotes, 327 printed Har Bracha notes, 2331 Sefaria-linked source notes.');

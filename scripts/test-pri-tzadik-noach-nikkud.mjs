// Prevent regressions in the vocalized Pri Tzaddik, Noach 7/8/9 reader.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='dist/library/data/peri-tzadik/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
const edition=JSON.parse(fs.readFileSync('sources/akiva/editions/Peri_Tzadik_Bereshit_Cheshvan_Noach_Study_Edition.json','utf8'));
const overlay=JSON.parse(fs.readFileSync('sources/akiva/nikud/Peri_Tzadik_Noach_7-9.json','utf8'));
const leaves=[];
function collect(n){if(n?.ref)leaves.push(n);for(const c of n?.children||[])collect(c);}
collect(toc.toc);
const strip=s=>s.replace(/[\u0591-\u05bd\u05bf-\u05c7]/g,'');
let total=0;
for(const [ois,number] of [[7,75],[8,55],[9,19]]){
  const sec=edition.sections.find(x=>x.node==='Noach'&&x.chapter===ois);
  const original=sec.topics.flatMap(t=>t.pairs);
  const pointed=overlay.sections.find(x=>x.node==='Noach'&&x.chapter===ois)?.phrases;
  const leaf=leaves.find(x=>x.ref==='Peri Tzadik, Noach '+ois&&x.interlinear);
  assert.ok(leaf&&pointed,'Missing Noach interlinear leaf / niqqud for '+ois);
  const data=JSON.parse(fs.readFileSync(dir+leaf.id+'.json','utf8'));
  const pairs=data.filter(x=>x.p).flatMap(x=>x.p);
  assert.equal(pairs.length,number);
  assert.equal(pointed.length,number);
  assert.equal(original.length,number);
  for(let i=0;i<number;i++){
    assert.equal(strip(pointed[i]),original[i][0],'Nikkud changed source consonants or punctuation');
    assert.equal(pairs[i][0].replace(/<\/?a\b[^>]*>/g,''),pointed[i],'Published reader lost niqqud for '+ois+' phrase '+i);
    assert.ok(pairs[i][1].length>10,'English interlinear missing in Ois '+ois);
    if(original[i][0].length>60)
      assert.ok((pointed[i].match(/[\u0591-\u05bd\u05bf-\u05c7]/g)||[]).length>5,
        'Long Hebrew phrase unpointed in '+ois+':'+i);
  }
  const text=pointed.join(' ');
  const points=(text.match(/[\u0591-\u05bd\u05bf-\u05c7]/g)||[]).length;
  const letters=(text.match(/[\u05d0-\u05ea]/g)||[]).length;
  assert.ok(points/letters>.55,'Poor nikkud coverage for Noach '+ois+': '+points+'/'+letters);
  total+=pairs.length;
  console.log('PASS Noach Ois '+ois+': '+pairs.length+' vocalized interlinear phrases; '+points+' vowel marks; consonants exact.');
}
assert.equal(total,149);
console.log('PASS Noach Ois 7–9: all 149 pointed phrases preserved.');

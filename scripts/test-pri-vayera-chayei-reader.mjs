// Regression check for the published Vayera and Chayei Sara interlinear reader chapters.
// Verify build-generated reader JSON, source citations and visible navigation links.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root='dist/library/';
const slug='peri-tzadik';
const toc=JSON.parse(fs.readFileSync(root+'data/'+slug+'/toc.json','utf8'));
const html=fs.readFileSync(root+'index.html','utf8');
const sw=fs.readFileSync(root+'sw.js','utf8');
const leaves=[];
function walk(n){if(n?.ref)leaves.push(n);for(const c of n?.children||[])walk(c);}
walk(toc.toc);
let totalPairs=0, cited=0;
for(const [name,count] of [['Vayera',7],['Chayei Sara',11]]){
 for(let ois=1;ois<=count;ois++){
  const ref='Peri Tzadik, '+name+' '+ois;
  const leaf=leaves.find(x=>x.ref===ref&&x.interlinear);
  assert.ok(leaf,'Missing public interlinear TOC chapter '+ref);
  assert.equal(leaf.depth,1,'Unexpected chapter depth '+ref);
  assert.ok(leaf.shape>0,'Empty chapter '+ref);
  const path=root+'data/'+slug+'/'+leaf.id+'.json';
  const data=JSON.parse(fs.readFileSync(path,'utf8'));
  const pairs=data.flatMap(item=>item.p||[]);
  assert.equal(data.filter(item=>Array.isArray(item.p)).length,leaf.shape,'Missing interlinear paragraph '+ref);
  assert.ok(pairs.length>=5,'Too few interlinear phrases '+ref);
  for(const pair of pairs){
   assert.ok(Array.isArray(pair)&&pair.length===2,'Missing Hebrew-English pair '+ref);
   assert.match(String(pair[0]),/[\u05d0-\u05ea]/,'Missing Hebrew phrase '+ref);
   assert.match(String(pair[1]),/[A-Za-z]/,'Missing English translation '+ref);
   cited+=(String(pair[0])+String(pair[1])).match(/data-ref=/g)?.length||0;
  }
  assert.ok(data.some(item=>item.h),'Missing teaching headline '+ref);
  totalPairs+=pairs.length;
 }
 const link='#/read/Peri_Tzadik,_'+name.replace(/ /g,'_')+'_1';
 assert.ok(html.includes('href="'+link+'"'),'Missing prominent reader navigation '+link);
}
assert.equal(totalPairs,1268,'Original translation phrase count changed');
assert.ok(cited>=10,'Sefaria source citation links were not generated');
assert.match(sw,/v(?:59-pri-vayera-chayei|61-akiva-expanded-13-vayera-chayei)/,'Reader service worker cache was not refreshed');
if(process.argv.includes('--after-archive')){
 assert.equal(toc.restoredVayeraChayeiSara?.chapters,18,'Archive installer removed or failed to restore new chapters');
 assert.equal(toc.restoredVayeraChayeiSara?.phrasePairs,1268,'Restored phrase count metadata missing');
 const linkIndex=JSON.parse(fs.readFileSync(root+'data/'+slug+'/links.json','utf8'));
 for(const name of ['Vayera 1','Chayei Sara 1'])
  assert.ok(Array.isArray(linkIndex['Peri Tzadik, '+name]),'Missing source-link index after archive: '+name);
}
assert.ok(html.includes('20261016-pri-vayera-chayei-sara-live-v2'),'Reader JSON cache was not refreshed');
console.log('PASS published Pri Tzaddik Vayera 1-7 and Chayei Sara 1-11:',totalPairs,'phrase pairs;',cited,'linked source references; all direct navigation links.');

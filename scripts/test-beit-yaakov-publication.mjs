import fs from 'node:fs';
import path from 'node:path';
const root = 'dist/library/data';
const catalog = JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));
const book = catalog.find(b=>b.title==='Beit Yaakov on Torah');
if(!book || !book.interlinear) throw Error('Beit Yaakov bilingual edition missing');
const bookRoot=path.join(root,book.slug);
const {toc}=JSON.parse(fs.readFileSync(path.join(bookRoot,'toc.json'),'utf8'));
if(toc.children.length!==2)throw Error('Expected two parashah groups in TOC');
const [bereshit,noach]=toc.children;
if(!bereshit.en.includes('Bereishit')||bereshit.children.length!==77)throw Error('Expected 77 Bereshit osiyos');
if(!noach.en.includes('Noach')||noach.children.length!==55)throw Error('Expected 55 Noach osiyos');
let pairs=0, nikkud=0;
for(const [node,group] of [['Bereshit',bereshit],['Noach',noach]]){
 for(const [ix,leaf] of group.children.entries()){
  const n=ix+1;
  if(leaf.ref!==`Beit Yaakov on Torah, ${node} ${n}`)throw Error('Bad ois numbering '+leaf.ref);
  if(!leaf.interlinear || leaf.shape<1 || !/אות/.test(leaf.he))throw Error('Missing interlinear metadata for '+leaf.ref);
  const items=JSON.parse(fs.readFileSync(path.join(bookRoot,leaf.id+'.json'),'utf8'));
  const ps=items.filter(it=>it.p);
  if(ps.length!==leaf.shape)throw Error('Segment count mismatch: '+leaf.ref);
  for(const p of ps)for(const [he,en]of p.p){
   if(!/[א-ת]/.test(he) || !/[A-Za-z]/.test(en))throw Error('Missing Hebrew or English: '+leaf.ref);
   pairs++;
   nikkud+=(he.match(/[\u0591-\u05c7]/g)||[]).length;
  }
 }
}
if(pairs!==3889)throw Error('Expected 3889 bilingual phrases, found '+pairs);
if(nikkud<200000)throw Error('Hebrew nikkud was lost: '+nikkud);
const links=JSON.parse(fs.readFileSync(path.join(bookRoot,'links.json'),'utf8'));
const linkCount=Object.values(links).flat().length;
if(linkCount<60)throw Error('Not enough source links/connections: '+linkCount);
console.log(`PASS Beit Yaakov on Torah: 77 Bereishit + 55 Noach osiyos; ${pairs} exact Word Hebrew-English pairs; ${nikkud} nikkud marks; ${linkCount} Sefaria connections`);

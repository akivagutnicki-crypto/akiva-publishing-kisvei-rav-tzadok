import fs from 'node:fs';
import path from 'node:path';
const root = 'dist/library/data';
const catalog = JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));
const book = catalog.find(b=>b.title==='Beit Yaakov on Torah');
if(!book || !book.interlinear) throw Error('Beit Yaakov bilingual edition missing');
const bookRoot=path.join(root,book.slug);
const {toc}=JSON.parse(fs.readFileSync(path.join(bookRoot,'toc.json'),'utf8'));
if(toc.children.length!==5)throw Error('Expected Bereshit, Noach, Lech Lecha, Vayera and Chayei Sarah groups in TOC');
const [bereshit,noach,lech]=toc.children;
if(!bereshit.en.includes('Bereishit')||bereshit.children.length!==77)throw Error('Expected 77 Bereshit osiyos');
if(!noach.en.includes('Noach')||noach.children.length!==55)throw Error('Expected 55 Noach osiyos');
if(!lech.en.includes('Lech Lecha')||lech.children.length!==51)throw Error('Expected 51 Lech Lecha osiyos');
let pairs=0, nikkud=0, lechPairs=0, lechHeads=0;
for(const [node,group] of [['Bereshit',bereshit],['Noach',noach],['Lech Lecha',lech]]){
 for(const [ix,leaf] of group.children.entries()){
  const n=node==='Lech Lecha' ? (ix<24 ? ix+1 : ix+7) : ix+1;
  if(leaf.ref!==`Beit Yaakov on Torah, ${node} ${n}`)throw Error('Bad ois numbering '+leaf.ref);
  if(!leaf.interlinear || leaf.shape<1 || !/אות/.test(leaf.he.replace(/[\u0591-\u05c7]/g,'')))throw Error('Missing interlinear metadata for '+leaf.ref);
  const items=JSON.parse(fs.readFileSync(path.join(bookRoot,leaf.id+'.json'),'utf8'));
  const ps=items.filter(it=>it.p);
  if(node==='Lech Lecha')lechHeads+=items.reduce((n,it)=>n+(it.h?1:0)+(it.inlineHeadings?.length||0),0);
  if(ps.length!==leaf.shape)throw Error('Segment count mismatch: '+leaf.ref);
  for(const p of ps)for(const [he,en]of p.p){
   if(!/[א-ת]/.test(he) || !/[A-Za-z]/.test(en))throw Error('Missing Hebrew or English: '+leaf.ref);
   if(node==='Lech Lecha')lechPairs++;
   else {pairs++;
   nikkud+=(he.match(/[\u0591-\u05c7]/g)||[]).length;}
  }
 }
}
if(pairs!==3889)throw Error('Expected 3889 bilingual phrases, found '+pairs);
if(nikkud<200000)throw Error('Hebrew nikkud was lost: '+nikkud);
if(lechPairs!==4171 || lechHeads<325)throw Error('Lech Lecha heading/phrase coverage changed (Word headlines include a continuation of Ois 1): '+lechPairs+' / '+lechHeads);
const links=JSON.parse(fs.readFileSync(path.join(bookRoot,'links.json'),'utf8'));
const linkCount=Object.values(links).flat().length;
if(linkCount<60)throw Error('Not enough source links/connections: '+linkCount);
console.log(`PASS Beit Yaakov on Torah: 77 Bereishit + 55 Noach + 51 Lech Lecha osiyos; ${pairs} exact Word Hebrew-English pairs; ${nikkud} nikkud marks; ${linkCount} Sefaria connections`);

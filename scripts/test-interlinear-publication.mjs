import fs from 'node:fs';
import path from 'node:path';
const out='dist/library/data';
const catalog=JSON.parse(fs.readFileSync(path.join(out,'catalog.json'),'utf8'));
const books=[
  {title:'Peri Tzadik',minPairs:3000,minLinks:40,required:'Peri Tzadik, Noach 1'},
  {title:'Tiferet Yosef',minPairs:100,minLinks:10,required:'Tiferet Yosef, Bereshit 1'}
];
for(const b of books){
  const info=catalog.find(x=>x.title===b.title);
  if(!info)throw new Error('Book absent from catalog: '+b.title);
  const directory=path.join(out,info.slug);
  const {toc}=JSON.parse(fs.readFileSync(path.join(directory,'toc.json'),'utf8'));
  const edition=toc.children?.find(x=>x.en==='Akiva Publishing — Interlinear Study Edition');
  if(!edition || toc.children[0]!==edition)throw new Error('Interlinear edition must be the first reading option: '+b.title);
  let count=0,segments=0,heads=0,refs=[];
  for(const leaf of edition.children){
    refs.push(leaf.ref);
    if(!leaf.interlinear||!leaf.il1)throw new Error('Interlinear metadata missing: '+leaf.ref);
    const items=JSON.parse(fs.readFileSync(path.join(directory,leaf.id+'.json'),'utf8'));
    for(const item of items){
      if(item.h)heads++;
      if(!item.p)continue;
      segments++;
      if(item.p.length<1)throw new Error('Empty translated paragraph '+leaf.ref);
      for(const [he,en] of item.p){
        if(typeof he!=='string'||!/[א-ת]/.test(he) || typeof en!=='string'||!/[A-Za-z]/.test(en))
          throw new Error('Missing Hebrew or English phrase in '+leaf.ref+': '+String(en).slice(0,40));
        count++;
      }
    }
  }
  if(!refs.includes(b.required))throw new Error('Missing required translated section: '+b.required);
  if(count<b.minPairs)throw new Error('Too few bilingual pairs: '+b.title+' ('+count+')');
  if(heads<edition.children.length*2)throw new Error('Missing study edition headings: '+b.title);
  const linksFile=path.join(directory,'links.json');
  const links=fs.existsSync(linksFile)?JSON.parse(fs.readFileSync(linksFile,'utf8')):{};
  const linkCount=Object.values(links).flat().length;
  if(linkCount<b.minLinks)throw new Error('Too few Sefaria source connections: '+b.title+' ('+linkCount+')');
  console.log('PASS '+b.title+': '+edition.children.length+' sections, '+segments+' paragraphs, '+count+' Hebrew-English pairs, '+linkCount+' source connections');
}

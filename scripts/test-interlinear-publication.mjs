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
  let count=0,segments=0,heads=0,refs=[],hebrewLetters=0,vowelledLetters=0;
  for(const leaf of edition.children){
    refs.push(leaf.ref);
    if(!leaf.interlinear||!leaf.il1)throw new Error('Interlinear metadata missing: '+leaf.ref);
    // The number in the canonical section ref is the original ois, not the
    // running position in the translated TOC. Some ois are not translated.
    const numbered = leaf.ref.match(/, (Bereshit|Noach) (\d+)$/);
    if(numbered){
      const [, parashah, number] = numbered;
      if(leaf.parashah!==parashah || leaf.ois!==Number(number))
        throw new Error('Wrong parashah / ois metadata: '+leaf.ref);
      if(!/אות\s+[א-ת][א-ת׳״]*/u.test(leaf.he))
        throw new Error('Hebrew אות label missing: '+leaf.ref);
      if(!leaf.heRef.includes(leaf.he))
        throw new Error('Reader Hebrew heading lacks ois: '+leaf.ref);
    }
    if (leaf.ref === 'Peri Tzadik, Bereshit 15' && leaf.he !== 'בראשית · אות ט״ו')
      throw new Error('Ois 15 must use ט״ו, not a sequential label');
    if (leaf.ref === 'Peri Tzadik, Noach 10' && leaf.ois !== 10)
      throw new Error('Noach Ois 10 must not be renumbered to Ois 7');

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
        hebrewLetters += (he.match(/[\u05d0-\u05ea]/g) || []).length;
        vowelledLetters += (he.match(/[\u0591-\u05bd\u05bf-\u05c7]/g) || []).length;
      }
    }
  }
  if(!refs.includes(b.required))throw new Error('Missing required translated section: '+b.required);
  if(count<b.minPairs)throw new Error('Too few bilingual pairs: '+b.title+' ('+count+')');
  if(heads<edition.children.length*2)throw new Error('Missing study edition headings: '+b.title);
  // Catch regressions where the canonical Hebrew inadvertently replaces the
  // vocalized Hebrew, even though interlinear translations still load.
  const minNikkudRatio = b.title === 'Peri Tzadik' ? 0.48 : 0.34;
  if (vowelledLetters / Math.max(1,hebrewLetters) < minNikkudRatio)
    throw new Error('Nikkud missing from published interlinear Hebrew in '+b.title+
      ': '+vowelledLetters+'/'+hebrewLetters+' marks');
  const linksFile=path.join(directory,'links.json');
  const links=fs.existsSync(linksFile)?JSON.parse(fs.readFileSync(linksFile,'utf8')):{};
  const linkCount=Object.values(links).flat().length;
  if(linkCount<b.minLinks)throw new Error('Too few Sefaria source connections: '+b.title+' ('+linkCount+')');
  console.log('PASS '+b.title+': '+edition.children.length+' sections, '+segments+' paragraphs, '+count+' Hebrew-English pairs, '+vowelledLetters+' nikkud marks, '+linkCount+' source connections');
}

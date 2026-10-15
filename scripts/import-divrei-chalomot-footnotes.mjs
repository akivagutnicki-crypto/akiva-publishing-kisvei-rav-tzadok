// Add the uploaded Divrei Chalomot expanded sources to the existing interlinear
// book without replacing a single Hebrew/English passage. The six overlays
// preserve the user's 242 full source translations, links, and parallel notes.
import fs from 'node:fs';
import path from 'node:path';
const DIRECTORY='sources/akiva/overlays/divrei-chalomot';
const bare=s=>String(s??'').replace(/<[^>]*>/g,'')
  .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,(_,key)=>({
    amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"
  }[key]));
export function addDivreiChalomotFootnotes(src){
 if(src.title!=='Divrei Chalomot')return false;
 if(!src.interlinear||src.sections?.length!==28)throw Error('Divrei Chalomot: expected 28 interlinear sections');
 let count=0;
 const sections=new Set(),placements=new Set(),items=new Set();
 for(let shard=1;shard<=6;shard++){
  const file=path.join(DIRECTORY,'notes-'+String(shard).padStart(2,'0')+'.json');
  const units=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(units))throw Error('Divrei Chalomot: invalid overlay '+file);
  for(const unit of units){
   const si=unit.sectionIndex,section=src.sections[si];
   if(!section||si<0||si>27)throw Error('Divrei Chalomot: missing section '+si);
   for(const entry of unit.items){
    const ii=entry.itemIndex,item=section.items?.[ii];
    if(!item?.p||!Array.isArray(entry.footnotes))throw Error('Divrei Chalomot: missing interlinear item '+si+'/'+ii);
    for(const fn of entry.footnotes){
     ++count;
     const id='DC-'+String(count).padStart(4,'0');
     if(fn.number!==count||fn.sourceId!==id||fn.placementId!==id+'-1')
      throw Error('Divrei Chalomot: incorrect note order '+id);
     const pi=fn.phraseIndex,pair=item.p?.[pi];
     if(!pair)throw Error('Divrei Chalomot: missing original phrase '+id);
     const he=bare(pair[0]),en=bare(pair[1]);
     const tokens=[...he.matchAll(/\S+/g)];
     const pos=fn.heCharOffset,word=tokens[fn.heWord-1];
     if(!word||!Number.isInteger(pos)||pos<=word.index||pos>word.index+word[0].length
        ||he.slice(0,pos)!==fn.heAnchorPrefix
        ||en.slice(0,fn.enCharOffset)!==fn.enAnchorPrefix)
      throw Error('Divrei Chalomot: Hebrew/English word anchor changed under '+id);
     if(!Array.isArray(fn.paragraphs)||fn.paragraphs.length!==4)
      throw Error('Divrei Chalomot: expected four complete paragraphs '+id);
     for(const p of fn.paragraphs){
      if(!p.text||!Array.isArray(p.rich)||p.rich.map(r=>r.text).join('')!==p.text)
       throw Error('Divrei Chalomot: corrupted translated source paragraph '+id);
     }
     if(fn.sources?.length!==3||!fn.sources.every(s=>s.ref&&/^https:\/\/www\.sefaria\.org\/\S+$/.test(s.url)))
      throw Error('Divrei Chalomot: incomplete source/parallel links '+id);
     if(placements.has(fn.placementId))throw Error('Divrei Chalomot: duplicate '+fn.placementId);
     placements.add(fn.placementId);
     const note={...fn,nativeConnections:[],
       verificationStatus:'Uploaded English source note; original Hebrew and English anchors checked, external quotations not independently collated',
       verificationNote:'Retained the supplied source translations and parallel references as provided',
       provenance:{...(fn.provenance||{}),edition:'Akiva Publishing uploaded Divrei Chalomot expanded source edition'}};
     item.footnotes=(item.footnotes||[]).filter(n=>n.sourceId!==id);
     item.footnotes.push(note);
     sections.add(si);items.add(si+':'+ii);
    }
   }
  }
 }
 if(count!==242||sections.size!==28||items.size!==30||placements.size!==242)
  throw Error('Divrei Chalomot: incomplete coverage '+JSON.stringify({count,sections:sections.size,items:items.size,placements:placements.size}));
 src.footnoteImportInfo={
   edition:'Akiva Publishing Interlinear Study Edition — English Source Translations and Rav Tzadok / Ishbitz-Radzin Parallels',
   notes:242,placements:242,sectionsWithNotes:28,itemsWithNotes:30,sourceLinks:726,
   numbering:'Continuous 1–242 across all 28 sections, markers anchored in Hebrew only',
   provenance:'Uploaded Divrei Chalomot expanded-footnote edition; source quotations preserved as supplied'
 };
 console.log('Divrei Chalomot: imported 242 Hebrew-anchored full English footnotes across 28 sections and 30 text items');
 return true;
}

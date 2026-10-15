// Add supplied 1,619 English-source footnotes to the original Kometz HaMinchah
// interlinear edition. The five CSV shards are the reviewed upload in row order.
// This overlay never changes the original Hebrew/English text.
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'sources/akiva/overlays/kometz-haminchah';
function parseCsv(s) {
  let rows = [], row = [], value = '', quoted = false;
  for (let i=0; i<s.length; i++) {
    const ch=s[i];
    if (quoted) {
      if (ch==='"' && s[i+1]==='"') {value+='"'; i++;}
      else if (ch==='"') quoted=false;
      else value+=ch;
    } else if (ch==='"') quoted=true;
    else if (ch===',') {row.push(value);value='';}
    else if (ch==='\n') {row.push(value);value='';if(row.some(Boolean))rows.push(row);row=[];}
    else if (ch!=='\r') value+=ch;
  }
  if (quoted) throw Error('Unclosed Kometz CSV quoted field');
  if (row.length || value) {row.push(value); rows.push(row);}
  const header=rows.shift()?.map(s=>s.replace(/^\uFEFF/,''));
  if (!header?.includes('Anchored_Hebrew_Word') || !header.includes('Primary_Source_URL'))
    throw Error('Wrong Kometz expanded footnote headers');
  return rows.map((cols,i)=>{
    if(cols.length!==header.length)throw Error('Malformed Kometz CSV row '+(i+2));
    return Object.fromEntries(header.map((key,j)=>[key,cols[j]]));
  });
}
const visible=s=>String(s??'').replace(/<[^>]*>/g,'')
 .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,(_,key)=>({
  amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"
 }[key]));
const int=(v,field)=>{
 const n=Number(v);
 if(!Number.isInteger(n)||n<0)throw Error('Invalid Kometz '+field+': '+v);
 return n;
};
const extraSpace=new Set([1591,1597,1602,1608,1610,1615]);
function paragraph(heading,body,href='',preserveFull=false) {
 let text=preserveFull?body:heading+': '+body;
 const rich=preserveFull && !text.startsWith(heading)
   ?[{text:heading,bold:true,...(href?{href}:{})},{text:': '+body}]
   :[{text:heading,bold:true,...(href?{href}:{})},{text:preserveFull?text.slice(heading.length):': '+body}];
 if(preserveFull&&!text.startsWith(heading))text=heading+': '+body;
 if(rich.map(x=>x.text).join('')!==text)throw Error('Truncated Kometz source paragraph');
 return {text,rich};
}
export function addKometzFootnotes(source) {
 if(source.title!=='Kometz HaMinchah') return false;
 if(!source.interlinear||source.sections?.length!==194) throw Error('Unexpected Kometz interlinear source layout');
 const rows=[];
 for(let i=1;i<=5;i++){
   const name=path.join(DIR,'notes-'+String(i).padStart(2,'0')+'.csv');
   rows.push(...parseCsv(fs.readFileSync(name,'utf8')));
 }
 if(rows.length!==1619)throw Error('Incomplete Kometz annotated CSV: '+rows.length+' of 1619');
 let previous=0;
 for(const r of rows){
  const number=int(r.Footnote_Number,'note number'),sourceId='KH-'+String(number).padStart(4,'0');
  if(number!==++previous||r.Source_ID!==sourceId)throw Error('Noncontinuous Kometz footnotes at '+number);
  const sectionIndex=int(r.Section_File.replace(/\.json$/,''),'section file');
  const sec=source.sections[sectionIndex];
  if(!sec||sec.en!==r.Section_Ref.replace('Kometz HaMinchah ','Section '))
   throw Error('Kometz section changed at '+sourceId);
  const itemNumber=int(r.Item_Number,'item'),items=sec.items.filter(x=>x.n===itemNumber);
  if(items.length!==1)throw Error('Ambiguous Kometz item at '+sourceId);
  const item=items[0],phraseIndex=int(r.Phrase_Index,'phrase index'),pair=item.p?.[phraseIndex];
  if(!pair)throw Error('Missing Kometz interlinear phrase '+sourceId);
  const he=visible(pair[0]),en=visible(pair[1]),heWord=int(r.Hebrew_Word_Index,'Hebrew word');
  const token=[...he.matchAll(/\S+/g)][heWord-1];
  const anchor=r.Anchored_Hebrew_Word;
  if(!token||!token[0].includes(anchor))throw Error('Hebrew insertion word changed '+sourceId);
  const heCharOffset=token.index+token[0].indexOf(anchor)+anchor.length+
   (extraSpace.has(number)?1:0);
  const primary=r.Primary_Source_Ref,url=r.Primary_Source_URL;
  const rav=r.Kisvei_Rav_Tzadok_Parallel_Ref,ish=r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref;
  if(!primary||!/^https:\/\/www\.sefaria\.org\/[^<>"\s]+$/i.test(url)
    ||!rav||!ish||!r.Kisvei_Rav_Tzadok_Parallel_Translation
    ||!r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
   throw Error('Source / parallel missing at '+sourceId);
  const note={
   number,sourceId,placementId:sourceId+'-1',phraseIndex,heWord,
   heCharOffset,enCharOffset:en.length,heAnchorPrefix:he.slice(0,heCharOffset),enAnchorPrefix:en,
   paragraphs:[
    paragraph(primary,r.Primary_Source_Translation_And_Context,url,true),
    paragraph('Kisvei Rav Tzadok Parallel — '+rav,r.Kisvei_Rav_Tzadok_Parallel_Translation),
    paragraph('Kisvei Beis Ishbitz–Radzin Parallel — '+ish,r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
   ],
   sources:[{ref:primary,url,connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(primary)+'?with=all',role:'source'}],
   nativeConnections:[rav,ish],
   verificationStatus:'Uploaded English source with Hebrew word matching the original interlinear edition',
   provenance:{edition:'Akiva Publishing expanded Kometz HaMinchah sources',sectionFile:r.Section_File,
      sectionRef:r.Section_Ref,item:itemNumber,printedNumber:number}
  };
  item.footnotes=(item.footnotes||[]).filter(x=>x.sourceId!==sourceId);
  item.footnotes.push(note);
 }
 const all=source.sections.flatMap(s=>s.items.flatMap(item=>item.footnotes||[]));
 if(all.length!==1619||all.some((n,i)=>n.number!==i+1))
  throw Error('Footnotes missing, duplicated, or out of order in Kometz HaMinchah');
 const sectionsWithNotes=source.sections.filter(s=>s.items.some(i=>i.footnotes?.length)).length;
 if(sectionsWithNotes!==194)throw Error('Kometz section footnote coverage incomplete');
 source.footnoteImportInfo={edition:'Akiva Publishing English source translations and Rav Tzadok/Ishbitz parallels',
   notes:1619,placements:1619,sectionsWithNotes:194,
   itemsWithNotes:source.sections.flatMap(s=>s.items).filter(i=>i.footnotes?.length).length,
   sourceLinks:1619,ravTzadokParallels:1619,ishbitzRadzinParallels:1619,
   numbering:'Continuous 1–1619, Hebrew-word insertion only'};
 console.log('Kometz HaMinchah: imported 1,619 English source notes anchored in Hebrew in all 194 sections');
 return true;
}
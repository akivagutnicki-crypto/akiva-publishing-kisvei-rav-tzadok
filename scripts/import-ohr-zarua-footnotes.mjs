// Import 1,687 submitted Ohr Zarua LaTzadik English source notes without
// replacing or truncating the existing interlinear text. The fifteen CSV
// shards reproduce the uploaded, reviewed source-footnote CSV in row order.
import fs from 'node:fs';
import path from 'node:path';
const DIR='sources/akiva/overlays/ohr-zarua-latzadik';
function csvRows(s){
  const records=[];let row=[],value='',quoted=false;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(quoted){
      if(ch==='"'&&s[i+1]==='"'){value+='"';i++;}
      else if(ch==='"')quoted=false;
      else value+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','){row.push(value);value='';}
    else if(ch==='\n'){row.push(value);if(row.some(Boolean))records.push(row);row=[];value='';}
    else if(ch!=='\r')value+=ch;
  }
  if(quoted)throw Error('Ohr Zarua CSV: unterminated quoted field');
  if(row.length||value){row.push(value);records.push(row);}
  const header=records.shift()?.map(x=>x.replace(/^\uFEFF/,''));
  if(!header?.includes('Hebrew_Anchor_Word')||!header?.includes('English_Source_Translation_And_Context'))
    throw Error('Ohr Zarua CSV headings are not the uploaded edition');
  return records.map((cols,index)=>{
    if(cols.length!==header.length)throw Error('Ohr Zarua malformed CSV row '+(index+2));
    return Object.fromEntries(header.map((name,j)=>[name,cols[j]]));
  });
}
const visible=s=>String(s??'').replace(/<[^>]*>/g,'')
 .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,(_,x)=>({
  amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"
 }[x]));
function int(v,what){const n=Number(v);if(!Number.isInteger(n)||n<0)throw Error('Invalid '+what+' '+v);return n;}
function sourceParagraph(ref,body,url){
 const text=body.startsWith(ref)?body:ref+': '+body;
 return {text,rich:[{text:ref,bold:true,href:url},{text:text.slice(ref.length)}]};
}
function parallelParagraph(kind,ref,body){
 const heading=kind+' — '+ref;
 const text=heading+': '+body;
 return {text,rich:[{text:heading,bold:true},{text:': '+body}]};
}
export function addOhrZaruaFootnotes(src){
 if(src.title!=='Ohr Zarua LaTzadik')return false;
 if(!src.interlinear||src.sections?.length!==59)throw Error('Ohr Zarua expected 59 interlinear sections');
 const csv=Array.from({length:15},(_,i)=>fs.readFileSync(path.join(DIR,'notes-'+String(i+1).padStart(2,'0')+'.csv'),'utf8')).join('\n')+'\n';
 const rows=csvRows(csv);
 if(rows.length!==1687)throw Error('Ohr Zarua incomplete CSV: '+rows.length+'/1687');
 const sections=new Set(),itemsWithNotes=new Set();
 let previous=0;
 for(const r of rows){
  const number=int(r.Footnote_Number,'footnote number'),sourceId='OZ-'+String(number).padStart(4,'0');
  if(number!==++previous||r.Source_ID!==sourceId)throw Error('Ohr Zarua notes out of order '+sourceId);
  const secIndex=int(r.Section_File.replace(/\.json$/,''),'section file');
  const section=src.sections[secIndex];
  if(!section||r.Section_File!==secIndex+'.json'||!r.Section_Ref.startsWith('Ohr Zarua LaTzadik'))
    throw Error('Ohr Zarua missing section '+sourceId);
  const itemNumber=int(r.Item_Number,'item');
  const matches=section.items.filter(i=>i.p&&i.n===itemNumber);
  if(matches.length!==1)throw Error('Ohr Zarua missing/ambiguous paragraph '+sourceId);
  const item=matches[0],phraseIndex=int(r.Phrase_Index,'phrase index');
  const phrase=item.p[phraseIndex];
  if(!phrase)throw Error('Ohr Zarua missing Hebrew/English pair '+sourceId);
  const he=visible(phrase[0]),en=visible(phrase[1]),heWord=int(r.Hebrew_Word_Index,'Hebrew word');
  const token=[...he.matchAll(/\S+/g)][heWord-1],anchor=r.Hebrew_Anchor_Word;
  if(!token||!anchor||!token[0].includes(anchor))
    throw Error('Ohr Zarua Hebrew phrase changed under note '+sourceId+' ('+r.Section_File+')');
  const heCharOffset=token.index+token[0].indexOf(anchor)+anchor.length;
  const ref=r.Primary_Source_Ref,url=r.Primary_Source_URL;
  const rav=r.Kisvei_Rav_Tzadok_Parallel_Ref,ish=r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref;
  if(!ref||!/^https:\/\/www\.sefaria\.org\/[^<>"\s]+$/i.test(url)||
     !r.English_Source_Translation_And_Context||!rav||!ish||
     !r.Kisvei_Rav_Tzadok_Parallel_Translation||
     !r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
    throw Error('Ohr Zarua incomplete original source and English parallel '+sourceId);
  const note={
    number,sourceId,placementId:sourceId+'-1',phraseIndex,heWord,heCharOffset,
    enCharOffset:en.length,heAnchorPrefix:he.slice(0,heCharOffset),enAnchorPrefix:en,
    paragraphs:[
      sourceParagraph(ref,r.English_Source_Translation_And_Context,url),
      parallelParagraph('Kisvei Rav Tzadok Parallel',rav,r.Kisvei_Rav_Tzadok_Parallel_Translation),
      parallelParagraph('Kisvei Beis Ishbitz–Radzin Parallel',ish,r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation),
      {text:'Sources: '+ref+' | Parallels: '+rav+'; '+ish+'.',rich:[
        {text:'Sources: ',bold:true},{text:ref,bold:true,href:url},
        {text:' | Parallels: ',bold:true},{text:rav+'; '+ish+'.'}]}
    ],
    sources:[{ref,url,connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(ref)+'?with=all',role:'source'}],
    nativeConnections:[],
    provenance:{edition:'Akiva Publishing uploaded Ohr Zarua LaTzadik source expansion',
      sectionFile:r.Section_File,sectionRef:r.Section_Ref,item:itemNumber,printedNumber:number},
    verificationStatus:'CSV source and Hebrew anchor checked; referenced text not independently collated'
  };
  item.footnotes=(item.footnotes||[]).filter(n=>n.sourceId!==sourceId);
  item.footnotes.push(note);
  sections.add(r.Section_File);itemsWithNotes.add(r.Section_File+':'+itemNumber);
 }
 if(sections.size!==59||itemsWithNotes.size!==341)
  throw Error('Ohr Zarua source note coverage incomplete: '+sections.size+' sections '+itemsWithNotes.size+' items');
 src.footnoteImportInfo={edition:'Akiva Publishing source translations with Rav Tzadok and Ishbitz–Radzin parallels',
    notes:1687,placements:1687,sectionsWithNotes:59,itemsWithNotes:341,sourceLinks:1687,
    numbering:'Continuous 1–1687 across all 59 sections; note marker in the Hebrew only'};
 console.log('Ohr Zarua LaTzadik: 1,687 source notes, 59 sections, 341 paragraphs, Hebrew-word anchors');
 return true;
}

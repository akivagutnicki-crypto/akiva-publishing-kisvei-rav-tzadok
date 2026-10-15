// Import the supplied Poked Akarim source translations without modifying
// the original interlinear Hebrew or English. The original CSV is committed
// in seven lossless, sequential shards, each containing complete CSV rows.
import fs from 'node:fs';
import path from 'node:path';

const DIR='sources/akiva/overlays/poked-akarim';
function parseCsv(text) {
  const records=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','){row.push(cell);cell='';}
    else if(ch==='\n'){row.push(cell);if(row.some(Boolean))records.push(row);row=[];cell='';}
    else if(ch!=='\r')cell+=ch;
  }
  if(quoted)throw Error('Unterminated Poked Akarim CSV quotation');
  if(row.length||cell){row.push(cell);records.push(row);}
  const headers=records.shift()?.map(h=>h.replace(/^\uFEFF/,''));
  if(!headers?.includes('Anchored_Hebrew_Word')||!headers.includes('Primary_Source_Translation_And_Context'))
    throw Error('Unexpected Poked Akarim CSV columns');
  return records.map((values,i)=>{
    if(values.length!==headers.length)throw Error('Malformed Poked Akarim CSV row '+(i+2));
    return Object.fromEntries(headers.map((k,j)=>[k,values[j]]));
  });
}
const plain=s=>String(s??'').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,
  (_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"}[key]));
const integer=(value,desc)=>{
  const n=Number(value);if(!Number.isInteger(n)||n<0)throw Error('Invalid '+desc+': '+value);
  return n;
};
function primaryParagraph(ref,text,url){
  const full=text.startsWith(ref)?text:ref+': '+text;
  return {text:full,rich:[{text:ref,bold:true,href:url},{text:full.slice(ref.length)}]};
}
function parallelParagraph(label,reference,translation){
  const heading=label+' — '+reference;
  const text=heading+': '+translation;
  return {text,rich:[{text:heading,bold:true},{text:': '+translation}]};
}
export function addPokedFootnotes(src){
  if(src.title!=='Poked Akarim')return false;
  if(!src.interlinear||src.sections?.length!==6)throw Error('Unexpected Poked Akarim edition layout');
  const input=Array.from({length:7},(_,i)=>path.join(DIR,'notes-'+String(i+1).padStart(2,'0')+'.csv'));
  const csv=input.map(f=>fs.readFileSync(f,'utf8')).join('\n')+'\n';
  const rows=parseCsv(csv);
  if(rows.length!==925)throw Error('Incomplete Poked Akarim notes: '+rows.length+'/925');
  const coverage=new Set(),touched=new Set();
  let previous=0;
  for(const r of rows){
    const number=integer(r.Footnote_Number,'Poked footnote number');
    const sourceId='PA-'+String(number).padStart(4,'0');
    if(number!==++previous||r.Source_ID!==sourceId)throw Error('Discontinuous Poked footnote '+sourceId);
    const sectionIndex=integer(r.Section_File.replace(/\.json$/,''),'section file');
    const section=src.sections[sectionIndex];
    if(!section||r.Section_File!==sectionIndex+'.json'||r.Section_Ref!=='Poked Akarim '+(sectionIndex+1))
      throw Error('Poked Akarim section mismatch '+sourceId);
    const itemNumber=integer(r.Item_Number,'item number');
    const matches=section.items.filter(item=>item.p&&item.n===itemNumber);
    if(matches.length!==1)throw Error('Poked Akarim item missing/ambiguous '+sourceId);
    const item=matches[0];
    const phraseIndex=integer(r.Phrase_Index,'phrase index');
    const pair=item.p[phraseIndex];
    if(!pair)throw Error('Poked Akarim phrase missing '+sourceId);
    const he=plain(pair[0]),en=plain(pair[1]);
    const heWord=integer(r.Hebrew_Word_Index,'Hebrew word index');
    const token=[...he.matchAll(/\S+/g)][heWord-1];
    const anchor=r.Anchored_Hebrew_Word;
    if(!anchor||!token||!token[0].includes(anchor))
      throw Error('Poked Akarim Hebrew anchor shifted '+sourceId);
    const heCharOffset=token.index+token[0].indexOf(anchor)+anchor.length;
    const primary=r.Primary_Source_Ref,url=r.Primary_Source_URL;
    const rav=r.Kisvei_Rav_Tzadok_Parallel_Ref;
    const ish=r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref;
    if(!primary||!/^https:\/\/www\.sefaria\.org\/[^<>"\s]+$/i.test(url)||
       !r.Primary_Source_Translation_And_Context||!rav||!ish||
       !r.Kisvei_Rav_Tzadok_Parallel_Translation||
       !r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
      throw Error('Missing source or English translated parallel '+sourceId);
    const note={
      number,sourceId,placementId:sourceId+'-1',phraseIndex,heWord,heCharOffset,
      enCharOffset:en.length,heAnchorPrefix:he.slice(0,heCharOffset),enAnchorPrefix:en,
      paragraphs:[
        primaryParagraph(primary,r.Primary_Source_Translation_And_Context,url),
        parallelParagraph('Kisvei Rav Tzadok Parallel',rav,r.Kisvei_Rav_Tzadok_Parallel_Translation),
        parallelParagraph('Kisvei Beis Ishbitz–Radzin Parallel',ish,r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
      ],
      sources:[{ref:primary,url,connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(primary)+'?with=all',role:'source'}],
      nativeConnections:[rav,ish],
      verificationStatus:'Imported from submitted CSV; Hebrew anchor and Sefaria URL format checked, source text not independently verified',
      provenance:{edition:'Akiva Publishing Interlinear Study Edition — supplied annotated sources',
        sectionFile:r.Section_File,sectionRef:r.Section_Ref,item:itemNumber,printedNumber:number}
    };
    item.footnotes=(item.footnotes||[]).filter(n=>n.sourceId!==sourceId);
    item.footnotes.push(note);
    coverage.add(r.Section_File);
    touched.add(r.Section_File+':'+itemNumber);
  }
  if(coverage.size!==6||touched.size!==58)throw Error('Poked Akarim note coverage incomplete');
  src.footnoteImportInfo={edition:'Akiva Publishing annotated Poked Akarim',
    notes:925,placements:925,sectionsWithNotes:6,itemsWithNotes:58,sourceLinks:925,
    numbering:'Continuous 1–925 across 6 sections, markers only on exact Hebrew words'};
  console.log('Poked Akarim: imported 925 Hebrew-word anchored English source notes across 6 sections and 58 paragraphs');
  return true;
}

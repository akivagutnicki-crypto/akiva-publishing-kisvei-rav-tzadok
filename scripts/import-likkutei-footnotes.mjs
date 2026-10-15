// Import the supplied Likkutei Maamarim English source-footnote CSV, without
// replacing the interlinear Hebrew or translation from the reviewed study edition.
// The 22 committed CSV shards preserve the original 3,169 uploaded rows.
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'sources/akiva/overlays/likkutei-maamarim';
function csvRows(text) {
  const lines=[]; let row=[], field='', quoted=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (quoted) {
      if (c==='"' && text[i+1]==='"') {field+='"';i++;}
      else if (c==='"') quoted=false;
      else field+=c;
    } else if (c==='"') quoted=true;
    else if (c===',') {row.push(field);field='';}
    else if (c==='\n') {row.push(field);if(row.some(Boolean))lines.push(row);row=[];field='';}
    else if (c!=='\r') field+=c;
  }
  if (quoted) throw Error('Unterminated Likkutei CSV quote');
  if (row.length || field) {row.push(field);lines.push(row);}
  const headers=lines.shift().map(x=>x.replace(/^\uFEFF/,''));
  if (!headers.includes('Anchored_Hebrew_Word') || !headers.includes('Primary_Source_Translation_And_Context'))
    throw Error('Wrong Likkutei source footnote headers');
  return lines.map((columns,i)=>{
    if(columns.length!==headers.length)throw Error('Malformed Likkutei CSV row '+(i+2));
    return Object.fromEntries(headers.map((key,j)=>[key,columns[j]]));
  });
}
const visible=s=>String(s||'').replace(/<[^>]*>/g,'')
  .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,(_,k)=>({
    amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"
  }[k]));
const integer=(value,label)=>{
  const n=Number(value);
  if(!Number.isInteger(n)||n<0)throw Error('Invalid Likkutei '+label+': '+value);
  return n;
};
function paragraph(label, body, href) {
  const text=label+': '+body;
  const rich=[{text:label,bold:true,...(href?{href}:{})},{text:': '+body}];
  return {text,rich};
}
function primaryParagraph(ref,body,url) {
  const full=body.startsWith(ref)?body:ref+': '+body;
  const rich=[{text:ref,bold:true,href:url},{text:full.slice(ref.length)}];
  return {text:full,rich};
}
function targetFromFile(file) {
  if(file==='0.json')return ['On Book of Joshua','1'];
  if(file==='2.json')return ['On Shimshon','1'];
  if(file==='3.json')return ['Upon Completion of Talmud','1'];
  const m=/^1-(\d+)\.json$/.exec(file);
  if(m && Number(m[1])>=1 && Number(m[1])<=16)return ['Compositions on the Festivals',m[1]];
  throw Error('Unexpected Likkutei section filename '+file);
}
export function addLikkuteiFootnotes(parts) {
  const inputs=Array.from({length:22},(_,i)=>path.join(DIR,'notes-'+String(i+1).padStart(2,'0')+'.csv'));
  const csv=inputs.map(f=>fs.readFileSync(f,'utf8')).join('\n')+'\n';
  const rows=csvRows(csv);
  if(rows.length!==3169)throw Error('Incomplete Likkutei source CSV: '+rows.length+' of 3169');
  let prev=0; const coverage=new Set(); const touched=new Set();
  for(const r of rows) {
    const number=integer(r.Footnote_Number,'footnote number');
    const sourceId='LM-'+String(number).padStart(4,'0');
    if(number!==++prev||r.Source_ID!==sourceId)throw Error('Noncontinuous Likkutei note '+sourceId);
    const [node,chapter]=targetFromFile(r.Section_File);
    const part=parts.get('Likkutei Maamarim|'+node);
    if(!part)throw Error('Likkutei study edition missing '+node);
    const itemNumber=integer(r.Item_Number,'item number');
    const matches=(part.chapters[chapter]||[]).filter(i=>i.p && i.n===itemNumber);
    if(matches.length!==1)throw Error('Missing or ambiguous Likkutei item '+sourceId);
    const item=matches[0];
    const phraseIndex=integer(r.Phrase_Index,'phrase index');
    const pair=item.p[phraseIndex];
    if(!pair)throw Error('Missing Likkutei phrase '+sourceId);
    const he=visible(pair[0]),en=visible(pair[1]);
    const heWord=integer(r.Hebrew_Word_Index,'Hebrew word index');
    const token=[...he.matchAll(/\S+/g)][heWord-1];
    const anchor=r.Anchored_Hebrew_Word;
    if(!token||!anchor||!token[0].includes(anchor))
      throw Error('Likkutei Hebrew word anchor changed '+sourceId);
    const heCharOffset=token.index+token[0].indexOf(anchor)+anchor.length+(number===1503?1:0);
    const primary=r.Primary_Source_Ref, url=r.Primary_Source_URL;
    const rav=r.Kisvei_Rav_Tzadok_Parallel_Ref;
    const ish=r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref;
    if(!primary||!/^https:\/\/www\.sefaria\.org\/[^<>"\s]+$/i.test(url)||
       !rav||!ish||!r.Primary_Source_Translation_And_Context||
       !r.Kisvei_Rav_Tzadok_Parallel_Translation||
       !r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
      throw Error('Missing Likkutei English source/parallel '+sourceId);
    const note={
      number,sourceId,placementId:sourceId+'-1',phraseIndex,heWord,heCharOffset,
      enCharOffset:en.length,heAnchorPrefix:he.slice(0,heCharOffset),enAnchorPrefix:en,
      paragraphs:[
        primaryParagraph(primary,r.Primary_Source_Translation_And_Context,url),
        paragraph('Kisvei Rav Tzadok Parallel — '+rav,r.Kisvei_Rav_Tzadok_Parallel_Translation),
        paragraph('Kisvei Beis Ishbitz–Radzin Parallel — '+ish,r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
      ],
      sources:[{ref:primary,url,connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(primary)+'?with=all',role:'source'}],
      nativeConnections:[],
      verificationStatus:'Uploaded source translation, matched to its Hebrew word',
      provenance:{edition:'Akiva Publishing Interlinear Study Edition with expanded English sources',
        sectionFile:r.Section_File,sectionRef:r.Section_Ref,item:itemNumber,printedNumber:number}
    };
    item.footnotes=(item.footnotes||[]).filter(n=>n.sourceId!==sourceId);
    item.footnotes.push(note);
    coverage.add(r.Section_File);
    touched.add(r.Section_File+':'+itemNumber);
  }
  if(coverage.size!==19 || touched.size!==164)throw Error('Incomplete Likkutei coverage: '+coverage.size+' sections, '+touched.size+' paragraphs');
  console.log('Likkutei Maamarim: 3,169 Hebrew-anchored English source notes, 19 sections, 164 items');
  return {notes:rows.length,sections:coverage.size,items:touched.size};
}

// Import the 729 Sichat Malakhei HaSharet source-note CSV entries into the
// existing Akiva interlinear PARTS (never replace the translated book).
// Seven sequential CSV shards preserve every source and parallel translation.
import fs from 'node:fs';
import path from 'node:path';

const DIR='sources/akiva/overlays/sichat-malakhei-hasharet';
function csvRows(text){
 const raw=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){
   if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
   else if(c==='"')quoted=false;
   else field+=c;
  }else if(c==='"')quoted=true;
  else if(c===','){row.push(field);field='';}
  else if(c==='\n'){row.push(field);if(row.some(Boolean))raw.push(row);row=[];field='';}
  else if(c!=='\r')field+=c;
 }
 if(quoted)throw Error('Unclosed Sichat CSV quoted field');
 if(row.length||field){row.push(field);raw.push(row);}
 const headers=raw.shift()?.map(x=>x.replace(/^\uFEFF/,''));
 if(!headers?.includes('Hebrew_Anchor_Word')||!headers.includes('English_Source_Translation_And_Context'))
  throw Error('Unexpected Sichat Malakhei HaSharet footnote CSV');
 return raw.map((cols,i)=>{
  if(cols.length!==headers.length)throw Error('Malformed Sichat CSV row '+(i+2));
  return Object.fromEntries(headers.map((key,j)=>[key,cols[j]]));
 });
}
const bare=s=>String(s??'').replace(/<[^>]*>/g,'')
 .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,(_,key)=>({
  amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"
 }[key]));
function number(s,what){
 const n=Number(s);if(!Number.isInteger(n)||n<0)throw Error('Invalid Sichat '+what+': '+s);
 return n;
}
function target(file){
 const m=/^0-([1-4])\.json$/.exec(file);
 if(m)return ['',m[1]];
 const map={
  '1.json':['From Yerushalmi','1'],
  '2.json':['From Tanchuma','1'],
  '3.json':['From Zohar','1'],
  '4.json':["A Note on Angels' Names",'1']
 };
 if(!map[file])throw Error('Unexpected Sichat section file '+file);
 return map[file];
}
function primary(ref,body,url){
 const text=body.startsWith(ref)?body:ref+': '+body;
 return {text,rich:[{text:ref,bold:true,href:url},{text:text.slice(ref.length)}]};
}
function parallel(label,ref,translation){
 const heading=label+' — '+ref;
 return {text:heading+': '+translation,
  rich:[{text:heading,bold:true},{text:': '+translation}]};
}
export function addSichatFootnotes(parts){
 const csv=Array.from({length:7},(_,i)=>fs.readFileSync(path.join(DIR,
   'notes-'+String(i+1).padStart(2,'0')+'.csv'),'utf8')).join('\n')+'\n';
 const rows=csvRows(csv);
 if(rows.length!==729)throw Error('Incomplete Sichat source CSV: '+rows.length+'/729');
 let last=0;
 const sections=new Set(),items=new Set(),anchors=new Set();
 for(const r of rows){
  const n=number(r.Footnote_Number,'footnote number');
  const sourceId='SM-'+String(n).padStart(4,'0');
  if(n!==++last||r.Source_ID!==sourceId)throw Error('Sichat source numbering discontinuity '+sourceId);
  const [node,chapter]=target(r.Section_File);
  const part=parts.get('Sichat Malakhei HaSharet|'+node);
  if(!part)throw Error('Missing Sichat interlinear part '+node);
  const itemNumber=number(r.Item_Number,'item');
  const matches=(part.chapters[chapter]||[]).filter(item=>item.p&&item.n===itemNumber);
  if(matches.length!==1)throw Error('Missing/ambiguous Sichat item '+sourceId);
  const item=matches[0],phraseIndex=number(r.Phrase_Index,'phrase index');
  const pair=item.p[phraseIndex];
  if(!pair)throw Error('Sichat phrase missing '+sourceId);
  const he=bare(pair[0]),en=bare(pair[1]);
  const heWord=number(r.Hebrew_Word_Index,'Hebrew word index');
  const token=[...he.matchAll(/\S+/g)][heWord-1],anchor=r.Hebrew_Anchor_Word;
  if(!token||!anchor||!token[0].includes(anchor))
   throw Error('Sichat Hebrew-word anchor shifted '+sourceId);
  const heCharOffset=token.index+token[0].indexOf(anchor)+anchor.length;
  const ref=r.Primary_Source_Ref,url=r.Primary_Source_URL;
  const rav=r.Kisvei_Rav_Tzadok_Parallel_Ref;
  const ish=r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref;
  if(!ref||!/^https:\/\/www\.sefaria\.org\/[^<>"\s]+$/i.test(url)||
     !rav||!ish||!r.English_Source_Translation_And_Context||
     !r.Kisvei_Rav_Tzadok_Parallel_Translation||
     !r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
   throw Error('Missing complete English source or parallel '+sourceId);
  const pos=r.Section_File+':'+itemNumber+':'+phraseIndex+':'+heWord+':'+ref;
  if(anchors.has(pos))throw Error('Duplicate Sichat source placement '+sourceId);
  anchors.add(pos);
  const note={
   number:n,sourceId,placementId:sourceId+'-1',phraseIndex,heWord,heCharOffset,
   enCharOffset:en.length,heAnchorPrefix:he.slice(0,heCharOffset),enAnchorPrefix:en,
   paragraphs:[
    primary(ref,r.English_Source_Translation_And_Context,url),
    parallel('Kisvei Rav Tzadok Parallel',rav,r.Kisvei_Rav_Tzadok_Parallel_Translation),
    parallel('Kisvei Beis Ishbitz–Radzin Parallel',ish,r.Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation)
   ],
   sources:[{ref,url,connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(ref)+'?with=all',role:'source'}],
   nativeConnections:[],
   verificationStatus:'Uploaded annotations, Hebrew-word anchors checked against existing text',
   provenance:{edition:'Akiva Publishing expanded English source-footnote edition',
    sectionFile:r.Section_File,sectionRef:r.Section_Ref,item:itemNumber,printedNumber:n}
  };
  item.footnotes=(item.footnotes||[]).filter(f=>f.sourceId!==sourceId);
  item.footnotes.push(note);
  sections.add(r.Section_File);
  items.add(r.Section_File+':'+itemNumber);
 }
 if(sections.size!==8||items.size!==148)throw Error('Sichat coverage incomplete: '+sections.size+' sections '+items.size+' items');
 console.log('Sichat Malakhei HaSharet: 729 continuous Hebrew-word source notes, 8 sections, 148 paragraphs');
 return {notes:rows.length,sections:sections.size,items:items.size};
}

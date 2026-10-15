// Replace (do not append to) Yisrael Kedoshim's old footnotes, from the
// updated 2,097-note Akiva Publishing reviewed CSV, validated against its JSON.
// Keep the existing published original Hebrew and interlinear English intact.
import fs from 'node:fs';
import path from 'node:path';
const BASE='dist/library/data';
const DIR=path.join(BASE,'yisrael-kedoshim');
const INPUT='sources/akiva/overlays/yisrael-kedoshim';
const PARTS=Array.from({length:11},(_,i)=>path.join(INPUT,'reviewed-'+String(i+1).padStart(2,'0')+'.csv'));
const PRIMARY='Primary Source / Har Bracha Translation (English Only)';
const RAV='Kisvei Rav Tzadok Parallel (English Only)';
const ISH='Kisvei Beis Ishbitz-Radzin Parallel (English Only)';
const strip=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,x=>({
 '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&#39;':"'",'&#x27;':"'"
}[x]));
const sourceUrl=u=>/^https:\/\/www\.sefaria\.org\/[^<>"\s]+$/.test(u||'');
const precise=u=>sourceUrl(u)&&!u.includes('/topics/')&&/\d/.test(u.slice('https://www.sefaria.org/'.length));
function parseCsv(s){
 const out=[];let row=[],v='',quoted=false;
 for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(quoted){if(ch==='"'&&s[i+1]==='"'){v+='"';i++;}
    else if(ch==='"')quoted=false; else v+=ch;}
  else if(ch==='"')quoted=true;
  else if(ch===','){row.push(v);v='';}
  else if(ch==='\n'){row.push(v);v='';if(row.some(Boolean))out.push(row);row=[];}
  else if(ch!=='\r')v+=ch;
 }
 if(quoted)throw Error('Unclosed CSV quote');
 if(row.length||v){row.push(v);out.push(row);}
 const keys=out.shift()?.map(x=>x.replace(/^\uFEFF/,''));
 if(!keys||!keys.includes('heAnchorPrefix')||!keys.includes('Sefaria URL')||!keys.includes(ISH))throw Error('Wrong Yisrael CSV columns');
 return out.map((cells,n)=>{
  if(cells.length!==keys.length)throw Error('Bad reviewed CSV row '+(n+2)+': '+cells.length+'/'+keys.length);
  return Object.fromEntries(keys.map((k,i)=>[k,cells[i]]));
 });
}
const raw=PARTS.map(p=>fs.readFileSync(p,'utf8')).join('\n');
const rows=parseCsv(raw);
if(rows.length!==2097)throw Error('Expected exactly 2,097 replacement footnotes, found '+rows.length);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,data)=>fs.writeFileSync(p,JSON.stringify(data)+'\n','utf8');
const linksFile=path.join(DIR,'links.json'),links=read(linksFile);
const tocPath=path.join(DIR,'toc.json'),toc=read(tocPath);
const reverse=new Map();
function connect(ref,section,item) {
 if(!ref)return;
 const anchor=section+':'+item.n;
 const arr=links[section]??(links[section]=[]);
 if(!arr.some(x=>x.a===anchor&&x.r===ref))arr.push({a:anchor,r:ref,c:'Other'});
 const book=ref.replace(/\s+\d[\dab:\-–]*$/,'');
 const slug=book.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 if(!slug)return;
 const file=path.join(BASE,'cited',slug+'.json');
 const data=reverse.get(file)|| (fs.existsSync(file)?read(file):{});
 const list=data[ref]??(data[ref]=[]);
 if(!list.includes(anchor))list.push(anchor);
 reverse.set(file,data);
}
function paragraph(label,body,url=''){
 const text=label+': '+body;
 const rich=[{text:label,bold:true,...(precise(url)?{href:url}:{})},{text:': '+body}];
 if(rich.map(x=>x.text).join('')!==text)throw Error('Rich footnote discrepancy');
 return {text,rich};
}
function translatedParallel(label,raw,ref,url){
 if(!ref||!raw)throw Error('Missing reviewed parallel '+label);
 const trimmed=raw.trim();
 const prefix=ref+': ';
 const body=trimmed.startsWith(prefix)?trimmed.slice(prefix.length):trimmed;
 return paragraph(label+' — '+ref,body,url);
}
const bySection=new Map();
let last=0,sourceLinks=0,parallelLinks=0,genericParallelLinks=0,hebrewItems=0;
for(const row of rows){
 const chapter=Number(row['Section File'].replace(/^0-/,''));
 const number=Number(row['Footnote #']);
 const id='YK-'+String(number).padStart(4,'0');
 if(number!==++last||row['Source ID']!==id)throw Error('Gap / duplication at '+id);
 if(!(chapter>=1&&chapter<=10))throw Error('Unexpected chapter '+chapter);
 const arr=bySection.get(chapter)||[];arr.push(row);bySection.set(chapter,arr);
}
if(bySection.size!==10)throw Error('Missing a Yisrael Kedoshim section');
for(let chapter=1;chapter<=10;chapter++){
 const name=path.join(DIR,'0-'+chapter+'.json');
 const items=read(name);
 // Eliminate previous 2,658-note edition and any other old book-footnotes.
 for(const item of items)if(item.p)delete item.footnotes;
 const sectionRef='Yisrael Kedoshim '+chapter;
 for(const row of bySection.get(chapter)){
  const number=Number(row['Footnote #']),id='YK-'+String(number).padStart(4,'0');
  const num=Number(row['Item #']),pi=Number(row['Phrase Index']);
  const eligible=items.filter(item=>item.n===num&&Array.isArray(item.p));
  if(eligible.length!==1)throw Error('Cannot uniquely match item '+chapter+':'+num+' for '+id);
  const item=eligible[0],pair=item.p[pi];
  if(!pair)throw Error('Bad phrase index for '+id);
  const he=strip(pair[0]),en=strip(pair[1]);
  const ho=Number(row.heCharOffset),eo=Number(row.enCharOffset);
  if(!Number.isInteger(ho)||!Number.isInteger(eo)||ho<=0||eo<=0 ||
     he.slice(0,ho)!==row.heAnchorPrefix || en.slice(0,eo)!==row.enAnchorPrefix)
    throw Error('Exact Hebrew or English insertion anchor changed: '+id+' in '+chapter+':'+num);
  if(!row['Hebrew Anchor Suffix']||!he.includes(row['Hebrew Anchor Suffix']))
    throw Error('Hebrew anchor suffix missing: '+id);
  const ref=row['Primary Source Ref'],url=row['Sefaria URL'];
  if(!ref||!sourceUrl(url))throw Error('Primary Sefaria reference missing '+id);
  const header=row['Display Source Ref']||ref;
  const note={
   number,sourceId:id,placementId:id+'-1',phraseIndex:pi,
   heCharOffset:ho,enCharOffset:eo,heAnchorPrefix:row.heAnchorPrefix,
   enAnchorPrefix:row.enAnchorPrefix,heWord:Number(row.heWord),
   paragraphs:[
    paragraph(header,row[PRIMARY],url),
    translatedParallel('Kisvei Rav Tzadok Parallel',row[RAV],row['Kisvei Rav Tzadok Parallel Ref'],row['Kisvei Rav Tzadok Parallel URL']),
    translatedParallel('Kisvei Beis Ishbitz–Radzin Parallel',row[ISH],row['Kisvei Beis Ishbitz-Radzin Parallel Ref'],row['Kisvei Beis Ishbitz-Radzin Parallel URL'])
   ],
   sources:[{ref,url,connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(ref)+'?with=all',role:'source'}],
   nativeConnections:[row['Kisvei Rav Tzadok Parallel Ref'],row['Kisvei Beis Ishbitz-Radzin Parallel Ref']],
   verificationStatus:'Supplied source link; parallel links restricted to passage-level URLs',
   provenance:{edition:'Akiva Publishing reviewed replacement, 2026-10-14',
     section:chapter,item:num,printedNumber:number,origin:row['Origin Type']}
  };
  if(note.paragraphs.some(p=>p.rich.map(x=>x.text).join('')!==p.text ||
      p.text.startsWith('Sources: ')))throw Error('Redundant/truncated text in '+id);
  if(!Number.isInteger(note.heWord)||note.heWord<=0)throw Error('Missing Hebrew word anchor '+id);
  (item.footnotes??=[]).push(note);
  sourceLinks++;connect(ref,sectionRef,item);
  for(let k=1;k<3;k++){
   const u=k===1?row['Kisvei Rav Tzadok Parallel URL']:row['Kisvei Beis Ishbitz-Radzin Parallel URL'];
   if(precise(u))parallelLinks++;else genericParallelLinks++;
  }
 }
 hebrewItems+=items.filter(i=>i.footnotes?.length).length;
 const notes=items.flatMap(i=>i.footnotes||[]);
 if(notes.length!==bySection.get(chapter).length)throw Error('Unreplaced Yisrael footnotes in section '+chapter);
 write(name,items);
}
write(linksFile,links);
for(const [file,data] of reverse)write(file,data);
toc.footnoteImportInfo={
 edition:'Har Bracha and Akiva Publishing reviewed replacement with Rav Tzadok / Ishbitz parallels',
 notes:2097,placements:2097,sectionsWithNotes:10,itemsWithNotes:hebrewItems,
 sourceLinks,ravTzadokParallels:2097,ishbitzRadzinParallels:2097,
 exactParallelLinks:parallelLinks,unlinkedGenericParallelReferences:genericParallelLinks,
 numbering:'Continuous 1–2097 across the entire sefer',
 editorialStatus:'Old notes replaced; no extra Sources blocks; general topic URLs not represented as exact parallel links.'
};
write(tocPath,toc);
console.log('Yisrael Kedoshim REPLACED: 2,097 continuous footnotes, 10 chapters, '+
 sourceLinks+' Sefaria primary URLs, '+parallelLinks+' passage-level parallel links, '+
 genericParallelLinks+' general parallel URLs intentionally not linked.');

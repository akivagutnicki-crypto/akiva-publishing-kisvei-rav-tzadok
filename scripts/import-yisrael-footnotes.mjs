// Import the supplied Yisrael Kedoshim expanded-footnote CSV into the
// already-built interlinear reader. Preserve existing Hebrew/English text.
import fs from 'node:fs';
import path from 'node:path';

const ROOT='dist/library/data';
const BOOK=path.join(ROOT,'yisrael-kedoshim');
const INPUT='sources/akiva/overlays/yisrael-kedoshim';
const PARTS=Array.from({length:8},(_,i)=>path.join(INPUT,'part-'+String(i+1).padStart(2,'0')+'.csv'));
const HEAD='Primary Source / Har Bracha Translation (English Only)';
const RAV='Kisvei Rav Tzadok Parallel (English Only)';
const ISH='Kisvei Beis Ishbitz-Radzin Parallel (English Only)';
function parseCsv(s){
  const rows=[];let row=[],field='',q=false;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(q){if(ch==='"'&&s[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')q=false;else field+=ch;}
    else if(ch==='"')q=true;
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'){row.push(field);field='';if(row.some(Boolean))rows.push(row);row=[];}
    else if(ch!=='\r')field+=ch;
  }
  if(q)throw Error('Unclosed CSV quotation');
  if(field||row.length){row.push(field);rows.push(row);}
  const keys=rows.shift();
  if(!keys||!keys.includes('Hebrew Anchor Suffix')||!keys.includes(HEAD))throw Error('Wrong Yisrael CSV');
  return rows.map((r,i)=>{
    if(r.length!==keys.length)throw Error('Malformed CSV row '+(i+2)+': '+r.length);
    return Object.fromEntries(keys.map((k,n)=>[k.replace(/^\uFEFF/,''),r[n]]));
  });
}
const decode=s=>String(s||'').replace(/&(?:amp|quot|apos|lt|gt|nbsp|#39|#x27);/g,m=>({
  '&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"
}[m]));
const visible=s=>decode(String(s||'').replace(/<[^>]*>/g,''));
const allowedUrl=s=>/^https:\/\/www\.sefaria\.org\/[^\s<>"']+$/i.test(s||'');
const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
const stop=new Set(('shall have into through with from that their this there which where when whose while these those such many more most other than also itself himself herself being been were because unto them only like upon even about regarding together above below without would could should under after before among between being lord god hashem rabbi sages said says taught holy holiness israel israelite israels sanctity sacred commandment commandments blessed divine source text passage cited states acts words does indeed they torah talmud book chapter written life world person people earth every things').split(' '));
const words=s=>new Set((String(s||'').toLowerCase().match(/[a-z]{4,}/g)||[]).filter(w=>!stop.has(w)));
const common=(a,b)=>{const A=words(a),B=words(b);let n=0;for(const w of A)if(B.has(w))n++;return n;};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,o)=>fs.writeFileSync(p,JSON.stringify(o)+'\n','utf8');
const csv=PARTS.map(p=>fs.readFileSync(p,'utf8')).join('');
const rows=parseCsv(csv);
if(rows.length!==2658)throw Error('Expected 2,658 uploaded footnotes, found '+rows.length);
const countHB=rows.filter(r=>r['Origin Type']==='Har Bracha PDF Footnote').length;
if(countHB!==327)throw Error('Expected 327 Har Bracha notes, found '+countHB);
let n=0,linked=0,parallels=0,unmatched=0,withoutExactEnglish=0;
const chapterCounts=new Map();
const lastUsed={rav:new Map(),ish:new Map()};
const linksFile=path.join(BOOK,'links.json');
const links=read(linksFile);
const citedChanged=new Map();
const tocFile=path.join(BOOK,'toc.json');
const toc=read(tocFile);
function connect(ref,sectionRef,item){
  const anchor=sectionRef+':'+item.n;
  if(!((links[sectionRef]||[]).some(x=>x.a===anchor&&x.r===ref))){
    (links[sectionRef]??=[]).push({a:anchor,r:ref,c:'Other'});
  }
  const book=ref.replace(/\s+\d[\dab:\-–]*$/,'');
  const slug=book.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if(!slug)return;
  const p=path.join(ROOT,'cited',slug+'.json');
  const data=citedChanged.get(p)|| (fs.existsSync(p)?read(p):{});
  const list=data[ref]??=[];
  if(!list.includes(anchor))list.push(anchor);
  data[ref]=list;citedChanged.set(p,data);
}
function bodyParagraph(label,translation,url=''){
  const text=label+': '+normalize(translation);
  const rich=[{text:label,bold:true,...(allowedUrl(url)?{href:url}:{})},{text:': '+normalize(translation)}];
  if(rich.map(x=>x.text).join('')!==text)throw Error('Paragraph text mismatch');
  return {text,rich};
}
function candidateParallel(row,col,kind,context,ch){
  const raw=normalize(row[col]||'');
  const split=raw.indexOf(': ‘');
  if(split<1)return null;
  const title=raw.slice(0,split),quotation=raw.slice(split+2);
  // Do not repeat the identical citation in nearby footnotes. Only include a
  // parallel with at least three substantive terms shared with the passage.
  if(title.startsWith('Yisrael Kedoshim '))return null;
  if(common(context,quotation)<3)return null;
  const key=title+'|'+kind;
  const prev=lastUsed[kind].get(key);
  if(prev!==undefined&&ch===prev.chapter&&n-prev.note<20)return null;
  lastUsed[kind].set(key,{note:n,chapter:ch});
  return bodyParagraph(title,quotation);
}
for(let ch=1;ch<=10;ch++){
  const file=path.join(BOOK,'0-'+ch+'.json');
  if(!fs.existsSync(file))throw Error('Missing generated reader section '+file);
  const items=read(file);
  const rowset=rows.filter(r=>r['Section File']==='0-'+ch);
  for(const row of rowset){
    n++;
    const id='YK-'+String(n).padStart(4,'0');
    if(Number(row['Footnote #'])!==n||row['Source ID']!==id)
      throw Error('Out-of-sequence or duplicate note '+id);
    const itemNumber=Number(row['Item #']),expected=Number(row['Phrase Index']);
    const matches=items.filter(i=>i.n===itemNumber&&Array.isArray(i.p));
    if(matches.length!==1)throw Error('Yisrael chapter '+ch+': ambiguous item '+itemNumber+' for '+id);
    const item=matches[0],suffix=row['Hebrew Anchor Suffix'];
    // Require the literal Hebrew insertion suffix to be present. Never silently
    // move a note to a different Hebrew paragraph.
    const preferred=item.p[expected]&&visible(item.p[expected][0]).includes(suffix)?[expected]:[];
    const alternatives=item.p.map((p,i)=>visible(p[0]).includes(suffix)?i:-1).filter(i=>i>=0);
    const choices=preferred.length?preferred:alternatives;
    if(choices.length!==1)throw Error('Cannot precisely locate Hebrew anchor for '+id+' at '+ch+':'+itemNumber+' (matches '+choices.length+')');
    const pi=choices[0],he=visible(item.p[pi][0]),en=visible(item.p[pi][1]);
    const heOffset=he.lastIndexOf(suffix)+suffix.length;
    if(heOffset<1)throw Error('Invalid Hebrew insertion for '+id);
    const enSuffix=row['English Anchor Suffix'];
    const enPos=en.lastIndexOf(enSuffix);
    if(enPos<0)withoutExactEnglish++;
    const enOffset=enPos<0?en.length:enPos+enSuffix.length;
    const ref=normalize(row['Primary Source Ref']);
    const uploadedUrl=row['Sefaria URL']||'';
    // The printed Har Bracha note number does NOT point to a Sefaria
    // passage. Do not imply that the general book URL verifies its citation.
    const isHB=row['Origin Type']==='Har Bracha PDF Footnote';
    const url=(!isHB&&allowedUrl(uploadedUrl))?uploadedUrl:'';
    const lead=isHB?('Har Bracha Edition Note '+row['Har Bracha #']):ref;
    const paragraphs=[bodyParagraph(lead,row[HEAD],url)];
    const context=en+' '+row[HEAD];
    const rav=candidateParallel(row,RAV,'rav',context,ch);
    const ish=candidateParallel(row,ISH,'ish',context,ch);
    if(rav){paragraphs.push(rav);parallels++;}
    if(ish){paragraphs.push(ish);parallels++;}
    const wordCount=he.slice(0,heOffset).split(/\s+/).filter(Boolean).length;
    const note={
      number:n,sourceId:id,placementId:id+'-1',phraseIndex:pi,
      heCharOffset:heOffset,enCharOffset:enOffset,
      heAnchorPrefix:he.slice(0,heOffset),enAnchorPrefix:en.slice(0,enOffset),
      heWord:wordCount,paragraphs,
      sources:[{ref,role:isHB?'har-bracha-footnote':'source',
        ...(url?{url,connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(ref)+'?with=all'}:{})}],
      nativeConnections:[],
      verificationStatus:url?'source URL supplied':'no precise Sefaria link supplied',
      provenance:{edition:isHB?'Har Bracha printed edition':'Sefaria-referenced source',
        siman:ch,item:itemNumber,printedNumber:n,
        ...(isHB?{harBrachaNumber:Number(row['Har Bracha #'])}:{})}
    };
    (item.footnotes??=[]).push(note);
    if(url){linked++;connect(ref,'Yisrael Kedoshim '+ch,item);}
  }
  const notes=items.flatMap(i=>i.footnotes||[]);
  if(notes.length<rowset.length)throw Error('Lost notes in chapter '+ch);
  chapterCounts.set(ch,rowset.length);
  write(file,items);
}
write(linksFile,links);
for(const [p,obj] of citedChanged)write(p,obj);
if(n!==2658||chapterCounts.size!==10)throw Error('Incomplete Yisrael Kedoshim footnote import');
toc.footnoteImportInfo={notes:n,harBrachaNotes:countHB,sefariaLinkedNotes:linked,
  sectionsWithNotes:chapterCounts.size,selectedNonRepeatingParallels:parallels,
  editorialStatus:'Links supplied in source spreadsheet; topical parallels filtered for relevance and repetition'};
write(tocFile,toc);
console.log('Yisrael Kedoshim: '+n+' continuous Hebrew markers, '+countHB+
  ' Har Bracha notes, '+linked+' precise Sefaria URLs, '+parallels+
  ' selected nonrepeating parallels across '+chapterCounts.size+
  ' sections. English suffix fallback='+withoutExactEnglish+'.');

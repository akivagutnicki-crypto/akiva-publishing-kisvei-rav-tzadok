// Comprehensive Pri Tzaddik source importer: 1,580 supplied citations across
// Bereishis, Noach, Lech Lecha, Mar Cheshvan, Kislev and Chanukah.
// Preserve the 162 existing, more thoroughly Word-reviewed footnotes.
import fs from 'node:fs';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const DIR='dist/library/data/peri-tzadik';
const INPUT='sources/akiva/overlays/pri-all';
const PROTECTED=new Map([[92,42],[105,33],[106,48],[111,19],[112,20]]);
const sizes=new Map([[90,15],[107,10],[117,11],[128,7],[135,24]]);
const strip=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,token=>({
 '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&#39;':"'",'&#x27;':"'"
}[token]));
function parse(line){
 let cells=[],cell='',q=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];if(q){if(c==='"'&&line[i+1]==='"'){cell+='"';i++;}
  else if(c==='"')q=false;else cell+=c;}
  else if(c==='"')q=true;
  else if(c===','){cells.push(cell);cell='';}
  else cell+=c;
 }
 if(q)throw Error('Unclosed CSV quote');
 cells.push(cell);
 return cells;
}
const csv=Array.from({length:16},(_,i)=>fs.readFileSync(
 path.join(INPUT,'part-'+String(i+1).padStart(2,'0')+'.csv'),'utf8')).join('');
const lines=csv.trimEnd().split('\n');
const headers=parse(lines.shift().replace(/^\uFEFF/,''));
if(!headers.includes('Primary_Source_URL')||!headers.includes('Phrase_Index')||
 !headers.includes('Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation'))
 throw Error('Wrong Pri Tzaddik CSV schema');
const notes=lines.map((line,i)=>{
 const cols=parse(line);if(cols.length!==headers.length)
  throw Error('CSV row '+(i+2)+' has '+cols.length+' columns instead of '+headers.length);
 return Object.fromEntries(headers.map((h,j)=>[h,cols[j]]));
});
if(notes.length!==1580)throw Error('Expected 1580 citations, got '+notes.length);
for(let i=0;i<notes.length;i++){
 if(Number(notes[i].Footnote_Number)!==i+1||notes[i].Source_ID!=='PT-'+String(i+1).padStart(4,'0'))
  throw Error('Source row order/ID mismatch '+(i+1));
}
const b64=Array.from({length:6},(_,i)=>fs.readFileSync(
 path.join(INPUT,'anchors-'+String(i+1).padStart(2,'0')+'.txt'),'utf8')).join('');
if(b64.length!==5072)throw Error('Source anchor map size mismatch');
const anchors=inflateSync(Buffer.from(b64,'base64'));
const sha=createHash('sha256').update(anchors).digest('hex');
if(anchors.length!==6320||sha!=='14629a60ee2a52ad7e0f34f2f4d513924511d04d5766c2b1d9bd988973224a33')
 throw Error('Hebrew/English offset map is corrupted');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x)+'\n','utf8');
const tocPath=path.join(DIR,'toc.json'),toc=read(tocPath);
const leaves=[];
function walk(x){if(x?.ref)leaves.push(x);for(const y of x?.children||[])walk(y);}
walk(toc.toc);
const covered=new Map();
for(const [start,count] of sizes){
 for(let chapter=start;chapter<start+count;chapter++)covered.set(chapter,[]);
}
covered.set(105,[]);covered.set(106,[]);
if(covered.size!==69)throw Error('Expected exactly 69 interlinear chapters');
const blacklist=new Set(['torah','rav','tzadok','tzedek','holy','shabbat','shabbos','sabbath','words','people','lord','god','hashem','said','says','teaches','taught','written','world','creation','truth','person','divine','israel','jewish','source','context','teaching','parallel','commentary','reference','this','these','that','there','their','with','from','which','when','what','where','while','more','most','also','them','into','through','before','after','against','because','about','this','every','other','never','always','therefore','even','only','will','would','could','should','have','they','were','been','unto','upon','becomes','already','really']);
const keyWords=s=>new Set((String(s).toLowerCase().match(/[a-z]{5,}/g)||[]).filter(x=>!blacklist.has(x)));
const relevance=(a,b)=>{
 const A=keyWords(a),B=keyWords(b);let n=0;for(const word of A)if(B.has(word))n++;return n;
};
const precise=url=>/^https:\/\/www\.sefaria\.org\/[^\s<>\"]+$/i.test(url||'')&&!url.includes('/topics/');
function excerpt(text,label=''){
 let s=String(text||'').split(/\s+Context and connection to Pri Tzaddik:/i)[0].trim();
 s=s.replace(/\s*Connection to this note:[\s\S]*$/,'').trim();
 if(label&&s.startsWith(label+':'))s=s.slice(label.length+1).trim();
 return s;
}
const counts=new Map(),recent=new Map();
let validAnchors=0,primaryLinked=0,parallelIncluded=0,missingText=0;
const parsedByChapter=new Map();
for(let i=0;i<notes.length;i++){
 const r=notes[i],id=Number(r.Section_File.replace(/\.json$/,''));
 if(!covered.has(id))throw Error('Row outside interlinear 69: '+r.Source_ID);
 covered.get(id).push({row:r,offsets:[anchors.readUInt16BE(i*4),anchors.readUInt16BE(i*4+2)]});
}
const lineSkip=/no reliable source text|not found|not available/i;
for(const [chapter,rows] of covered){
 const leaf=leaves.find(x=>x.id===chapter&&x.interlinear);
 if(!leaf)throw Error('Missing live interlinear section '+chapter);
 const file=path.join(DIR,chapter+'.json');
 const items=read(file);
 const base=items.flatMap(item=>item.footnotes||[]).length;
 const expected=PROTECTED.get(chapter);
 if(expected!==undefined){
  if(base!==expected)throw Error('Reviewed source notes changed for '+leaf.ref+': '+base+' expected '+expected);
  counts.set(chapter,{ref:leaf.ref,reviewed:base,imported:0,supplied:rows.length});
  continue;
 }
 let imported=0,refs=new Set();
 for(const {row,offsets:[heOff,enOff]} of rows){
  const matches=items.filter(item=>Array.isArray(item.p)&&String(item.n)===row.Item_Number);
  if(matches.length!==1)throw Error('Ambiguous item '+row.Source_ID+' '+leaf.ref+':'+row.Item_Number);
  const item=matches[0],idx=Number(row.Phrase_Index),p=item.p[idx];
  if(!p)throw Error('Missing phrase '+row.Source_ID+' '+leaf.ref+' index '+idx);
  const he=strip(p[0]),en=strip(p[1]);
  if(heOff<1||enOff<1||heOff>he.length||enOff>en.length)
   throw Error('Exact Hebrew/English placement impossible: '+row.Source_ID+' '+leaf.ref+' '+heOff+'/'+he.length+' '+enOff+'/'+en.length);
  const ref=row.Primary_Source_Ref||'Primary source',url=row.Primary_Source_URL||'';
  const body=excerpt(row.Primary_Source_Translation_And_Context,ref);
  if(!body){missingText++;throw Error('Missing original source translation '+row.Source_ID);}
  if(lineSkip.test(body)&&body.length<55)throw Error('Unverified text '+row.Source_ID);
  if(!precise(url))throw Error('No valid Sefaria primary source link '+row.Source_ID+' '+url);
  // Keep the supplied Hebrew-word offsets from Peri_Tzadik.json, rather
  // than assuming that references always follow the last word of a phrase.
  const label=ref.trim(),lead=label+': '+body;
  const paragraphs=[{text:lead,rich:[{text:label,bold:true,href:url},{text:': '+body}]}];
  const seenKey=chapter+'|'+row.Item_Number+'|'+idx+'|'+heOff+'|'+ref;
  if(refs.has(seenKey))throw Error('Duplicate source marker '+row.Source_ID);
  refs.add(seenKey);
  for(const [kind,refCol,textCol] of [
   ['rav','Kisvei_Rav_Tzadok_Parallel_Ref','Kisvei_Rav_Tzadok_Parallel_Translation'],
   ['ish','Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref','Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation']]){
   const other=String(row[refCol]||'').trim();
   const quote=excerpt(row[textCol],other);
   if(!other||quote.length<70||relevance(en,quote)<3)continue;
   const last=recent.get(kind+'|'+other);
   const sourceNumber=Number(row.Footnote_Number);
   if(last!==undefined&&sourceNumber-last<20)continue;
   recent.set(kind+'|'+other,sourceNumber);
   const header=(kind==='rav'?'Kisvei Rav Tzadok':'Izhbitz–Radzin')+' — '+other;
   paragraphs.push({text:header+': '+quote,rich:[{text:header,bold:true},{text:': '+quote}]});
   parallelIncluded++;
  }
  const n=Number(row.Footnote_Number);
  const note={
    number:n,sourceId:row.Source_ID,placementId:row.Source_ID+'-1',
    phraseIndex:idx,heCharOffset:heOff,enCharOffset:enOff,
    heAnchorPrefix:he.slice(0,heOff),enAnchorPrefix:en.slice(0,enOff),
    heWord:Math.max(1,he.slice(0,heOff).trim().split(/\s+/).length),
    paragraphs,sources:[{ref:label,url,role:'primary-source',
      connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(label)+'?with=all'}],
    nativeConnections:[],
    verificationStatus:'Imported from expanded Pri Tzaddik source; original textual anchor confirmed',
    provenance:{edition:'Akiva Publishing expanded 2026-10-15',
      sourceId:row.Source_ID,section:leaf.ref,sourceFile:row.Section_File}
  };
  (item.footnotes??=[]).push(note);imported++;primaryLinked++;validAnchors++;
 }
 for(const item of items)if(item.footnotes)
  item.footnotes.sort((a,b)=>a.phraseIndex-b.phraseIndex||a.heCharOffset-b.heCharOffset||a.number-b.number);
 const final=items.flatMap(item=>item.footnotes||[]);
 if(final.length!==rows.length+base)
  throw Error('Missing/displaced notes '+leaf.ref+': '+final.length+' expected '+(rows.length+base));
 if(rows.length>0&&final.length===0)throw Error('Unannotated interlinear chapter '+leaf.ref);
 write(file,items);
 counts.set(chapter,{ref:leaf.ref,reviewed:base,imported,supplied:rows.length});
 parsedByChapter.set(chapter,items);
}
const total=[...counts.values()].reduce((n,v)=>n+v.reviewed+v.imported,0);
const reviewed=[...counts.values()].reduce((n,v)=>n+v.reviewed,0);
const newCount=[...counts.values()].reduce((n,v)=>n+v.imported,0);
if(counts.size!==69||newCount!==1424||reviewed!==162||total!==1586||validAnchors!==1424)
 throw Error('Incomplete 69-section import '+JSON.stringify({size:counts.size,newCount,reviewed,total,validAnchors}));
if(counts.get(115).imported!==9)throw Error('Noach Ois 9 still lacks nine citations');
const chapterInfo=[...counts.entries()].map(([id,detail])=>({id,...detail}));
toc.expandedFootnotes={
 dataset:'User supplied peri-tzadik-expanded.zip and peri_tzadik_expanded_footnotes.csv',
 suppliedNotes:1580,interlinearSections:69,originalReviewedPreserved:162,
 newHebrewAnchoredNotes:newCount,totalPublishedNotes:total,
 primarySefariaLinks:primaryLinked,selectedRelevantParallels:parallelIncluded,
 sourceAnchorChecksum:sha,
 countsBySection:chapterInfo,
 detail:'Better existing annotations retained; missing sections populated from supplied source citations.'
};
write(tocPath,toc);
console.log('FULL PRI TZADDIK COVERAGE:',JSON.stringify({sections:counts.size,reviewed,added:newCount,total,primaryLinked,parallels:parallelIncluded,noach9:counts.get(115),missingText}));

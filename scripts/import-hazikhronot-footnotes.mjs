// Expand the reviewed Sefer HaZikhronot source-apparatus CSV at build time.
// Never depend on Sefaria availability to include an annotated footnote.
import fs from 'node:fs';
import crypto from 'node:crypto';

const definitions={
 'Sefer HaZikhronot':{path:'sources/akiva/overlays/sefer-hazikhronot/footnotes.csv',count:769,prefix:'SZ',chapters:35},
};
function parseCsv(str){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<str.length;i++){
   const c=str[i];
   if(quoted){
     if(c==='"'&&str[i+1]==='"'){cell+='"';i++;}
     else if(c==='"')quoted=false;else cell+=c;
   }else{
     if(c==='"')quoted=true;
     else if(c===','){row.push(cell);cell='';}
     else if(c==='\n'){row.push(cell);cell='';if(row.some(Boolean))rows.push(row);row=[];}
     else if(c!=='\r')cell+=c;
   }
 }
 if(quoted)throw Error('Unclosed quoted CSV field');
 if(cell||row.length){row.push(cell);rows.push(row);}
 const heading=rows.shift()?.map((h,i)=>i===0?h.replace(/^\uFEFF/,''):h);
 if(!heading?.includes('source_reference')||!heading.includes('phraseIndex'))throw Error('Wrong reviewed footnote CSV headers');
 return rows.map((cols,n)=>{
  if(cols.length!==heading.length)throw Error('Malformed reviewed CSV row '+(n+2)+': '+cols.length+'/'+heading.length);
  return Object.fromEntries(heading.map((key,i)=>[key,cols[i]]));
 });
}
const textOf=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g,
 m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[m]));
const sefaria=url=>/^https:\/\/www\.sefaria\.org\/[^<>"\s]+$/i.test(url||'');
const numeric=(value,name)=>{const n=Number(value);if(!Number.isInteger(n)||n<0)throw Error('Bad '+name+': '+value);return n;};
function paragraph(text,url=''){
 text=String(text||'');
 if(!text.trim())return null;
 // Source title is bold, Sefaria-linked where the supplied URL is valid.
 const lead=/:\s[“‘"]/.exec(text),cut=lead?lead.index+1:-1;
 const rich=cut>0 ? [
  {text:text.slice(0,cut),bold:true,...(sefaria(url)?{href:url}:{})},
  {text:text.slice(cut)}
 ]:[{text}];
 if(rich.map(x=>x.text).join('')!==text)throw Error('Footnote rich text truncated');
 return {text,rich};
}
export function addReviewedFootnotes(src){
 const config=definitions[src.title];
 if(!config)return false;
 if(!src.interlinear || !Array.isArray(src.sections))throw Error('Expected existing interlinear '+src.title);
 const csv=fs.readFileSync(config.path,'utf8');
 const sha=crypto.createHash('sha256').update(csv).digest('hex');
 if(sha!=='11ac95e3c2b8f9b889f04531a4cc70335431fb66d442852950cc9b4d120dd324')throw Error('Reviewed Sefer HaZikhronot CSV checksum mismatch: '+sha);
 const rows=parseCsv(csv);
 if(rows.length!==config.count)throw Error('Missing '+src.title+' reviewed footnotes: '+rows.length+'/'+config.count);
 const countBySection=new Map();let last=0,links=0,parallels=0;
 for(const row of rows){
  const number=numeric(row.number,'number');
  if(number!==++last||row.id!==config.prefix+'-'+String(number).padStart(4,'0'))
    throw Error('Numbering gap or duplicate in '+src.title+' footnote '+number);
  const chapter=numeric(row.chapter??row.section,'section');
  const sec=src.sections.find(x=>x.n===chapter);
  if(!sec||chapter<1||chapter>config.chapters)throw Error('Missing '+src.title+' chapter '+chapter);
  const pi=numeric(row.phraseIndex,'phraseIndex');
  const offset=numeric(row.heCharOffset,'heCharOffset'),enOffset=numeric(row.enCharOffset,'enCharOffset');
  let matches;
  if(config.prefix==='DS'){
    // Match both ORIGINAL Hebrew and English, not just a guessed paragraph number.
    matches=sec.items.filter(item=>{
      const p=item.p?.[pi];
      return p&&textOf(p[0]).slice(0,offset)===row.heAnchorPrefix
        &&textOf(p[1]).slice(0,enOffset)===row.enAnchorPrefix;
    });
  }else{
    const itemNum=numeric(row.item,'item');
    // The source has manuscript headings interleaved with numbered text items.
    // Prefer the original paragraph's printed n over its array position.
    const byN=sec.items.filter(item=>item.n===itemNum && item.p?.[pi]);
    matches=byN.length?byN:sec.items.filter((item,i)=>i+1===itemNum && item.p?.[pi]);
  }
  if(matches.length!==1)throw Error('Ambiguous Hebrew footnote position '+config.prefix+' '+number+' chapter '+chapter);
  const item=matches[0],pair=item.p[pi];
  const he=textOf(pair[0]),en=textOf(pair[1]);
  if(offset>he.length||enOffset>en.length)throw Error('Footnote offset outside phrase '+config.prefix+' '+number);
  const ref=String(row.source_reference||'').trim(),url=String(row.sefaria_url||'').trim();
  const validLink=sefaria(url);
  const primary=paragraph(row.english_footnote_full || row.english_source_translation,url);
  if(!primary)throw Error('Empty English source note '+config.prefix+' '+number);
  const paras=[primary];
  if(config.prefix==='SZ'){
    for(const col of ['kisvei_rav_tzadok_parallel','kisvei_ishbitz_radzin_parallel']){
      const parallel=paragraph(row[col]);
      if(parallel){paras.push(parallel);parallels++;}
    }
  }
  const local=[row.kisvei_rav_tzadok_parallel_ref,row.kisvei_ishbitz_radzin_parallel_ref].filter(Boolean);
  const source={
    ref:ref||'Unindexed source',role:'source',
    ...(validLink?{url,connectionsUrl:'https://www.sefaria.org/api/links/'+encodeURIComponent(ref)+'?with=all'}:{})
  };
  const note={
    number,sourceId:row.id,placementId:row.id+'-1',phraseIndex:pi,
    heCharOffset:offset,enCharOffset:enOffset,
    heAnchorPrefix:he.slice(0,offset),enAnchorPrefix:en.slice(0,enOffset),
    heWord:numeric(row.heWord,'heWord'),
    paragraphs:paras,sources:[source],nativeConnections:local,
    verificationStatus:validLink?'supplied source link':'no Sefaria link supplied',
    provenance:{edition:row.edition,siman:chapter,printedNumber:number,
      ...(row.original_hb_number?{harBrachaNumber:row.original_hb_number}:{})}
  };
  if(config.prefix==='DS' && (note.heAnchorPrefix!==row.heAnchorPrefix||note.enAnchorPrefix!==row.enAnchorPrefix))
     throw Error('Divrei footnote anchor changed '+number);
  (item.footnotes??=[]).push(note);
  countBySection.set(chapter,(countBySection.get(chapter)||0)+1);
  if(validLink)links++;
 }
 if(countBySection.size!==config.chapters)throw Error('Section coverage differs: '+src.title+' '+countBySection.size);
 // Preserve text and paragraph structure. No redundant "Sources:" blocks.
 console.log('REVIEWED '+src.title+': '+last+' continuous Hebrew note numbers in '+countBySection.size+
  ' chapters, '+links+' supplied Sefaria links, '+parallels+' in-note parallels. No note discarded.');
 return true;
}
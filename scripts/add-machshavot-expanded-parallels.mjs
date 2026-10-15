// Merge user-uploaded Machshavot Charutz annotations without changing Hebrew anchors.
// Adds only plausibly relevant, non-repeating parallel passages; does not invent
// Sefaria URLs or overwrite stronger existing source translations.
import fs from 'node:fs';
import path from 'node:path';

const CSV_DIR='sources/akiva/overlays/machshavot-charutz-csv';
const STOP=new Set(('about above after again against along already also among another around because before being below between could different divine every example first found further given great hashem itself jewish learned matter other others passage person people rabbi righteous saying shall should since source sources taught teachings their there these those through throughout together toward under understanding until which while within without would world holy house god torah lord israel verse verses says saying stated according cannot relevant particular light blessed heavens highest human heart indeed comes came doing still very more much many each such only into from than them that this with what when have been were will your they said made time meaning spoke above upon next here part explanation explains explained source corresponding whom our his her was are and the for you one two three four five six seven eight nine ten').split(/\s+/));
function parse(line){
  const cells=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];if(quoted){if(ch==='"'&&line[i+1]==='"'){value+='"';i++;}else if(ch==='"'){quoted=false;}else value+=ch;}
    else if(ch==='"')quoted=true;
    else if(ch===','){cells.push(value);value='';}else value+=ch;
  }
  if(quoted)throw Error('Unclosed CSV cell');cells.push(value);return cells;
}
const strip=x=>String(x||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|quot|lt|gt|nbsp|#39);/g,m=>({'&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'"}[m]||m));
const words=s=>new Set((strip(s).toLowerCase().match(/[a-z]{5,}/g)||[]).filter(w=>!STOP.has(w)));
function common(a,b){let n=0;for(const w of a)if(b.has(w))n++;return n;}
function excerpt(s){return String(s||'').split(/\s+Context and connection to Machshavot Charutz:/i)[0].replace(/\s*Connection to this note:[\s\S]*$/i,'').trim();}
export function addMachshavotExpandedParallels(work,{root=CSV_DIR}={}){
  const files=Array.from({length:14},(_,i)=>path.join(root,'part-'+String(i+1).padStart(2,'0')+'.csv'));
  if(!files.every(p=>fs.existsSync(p)))throw Error('Machshavot expanded CSV part missing; publication halted');
  const lines=files.map(p=>fs.readFileSync(p,'utf8')).join('\n').trim().split(/\r?\n/);
  const headers=parse(lines.shift().replace(/^\uFEFF/,''));
  for(const field of ['Footnote_Number','Source_ID','Section_File','Section_Ref','Item_Number','Phrase_Index','English_Source_Translation_And_Context','Kisvei_Rav_Tzadok_Parallel_Ref','Kisvei_Rav_Tzadok_Parallel_Translation','Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref','Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation'])
    if(!headers.includes(field))throw Error('Machshavot CSV field missing: '+field);
  if(lines.length!==3478)throw Error('Incomplete 3478-row Machshavot upload: '+lines.length);
  const byId=new Map();
  for(const sec of work.sections||[])for(const item of sec.items||[])for(const note of item.footnotes||[]){
    if(byId.has(note.sourceId))throw Error('Duplicate original note: '+note.sourceId);
    byId.set(note.sourceId,{sec,item,note});
  }
  if(byId.size!==3478)throw Error('Existing Hebrew note markers missing: '+byId.size);
  const seen=new Set(),recent=new Map();
  const stats={sourceRows:0,matchedNotes:0,expandedPrimary:0,addedParallels:0,ravTzadokParallels:0,ishbitzRadzinParallels:0,repeatedParallelsSkipped:0,weakParallelsSkipped:0};
  for(let i=0;i<lines.length;i++){
    const cells=parse(lines[i]);if(cells.length!==headers.length)throw Error('Malformed Machshavot CSV row '+(i+2));
    const row=Object.fromEntries(headers.map((k,j)=>[k,cells[j]]));
    const id=row.Source_ID,n=Number(row.Footnote_Number);
    if(id!=='MC-'+String(i+1).padStart(4,'0')||n!==i+1||seen.has(id))throw Error('CSV note order/ID mismatch '+id);
    seen.add(id);stats.sourceRows++;
    const found=byId.get(id);if(!found)throw Error('Missing Hebrew word note '+id);
    const {sec,item,note}=found;
    if(row.Section_File!==sec.file || row.Section_Ref!==sec.ref || Number(row.Item_Number)!==Number(item.n) || Number(row.Phrase_Index)!==note.phraseIndex)
      throw Error('Supplied citation refers to different Hebrew phrase: '+id);
    stats.matchedNotes++;
    const english=strip(item.p?.[note.phraseIndex]?.[1]);if(!english)throw Error('Empty English interlinear phrase '+id);
    const primary=excerpt(row.English_Source_Translation_And_Context);
    if(note.verificationStatus==='source translation pending' && primary.length>90 &&
       !/Primary source reference in|translation awaiting textual verification|not available/i.test(primary)){
      const ref=row.Primary_Source_Ref;
      const source=note.sources?.find(s=>s.ref===ref&&/^https:\/\/www\.sefaria\.org\//.test(s.url||''));
      const body=primary.startsWith(ref+':')?primary.slice(ref.length+1).trim():primary;
      note.paragraphs=[{text:ref+': '+body,rich:[{text:ref,bold:true,...(source?{href:source.url}:{})},{text:': '+body}]}];
      note.verificationStatus='supplied source excerpt; verification pending';
      stats.expandedPrimary++;
    }
    const context=words(english+' '+(note.paragraphs?.[0]?.text||'').slice(0,700));
    for(const [kind,refField,textField] of [
      ['rav','Kisvei_Rav_Tzadok_Parallel_Ref','Kisvei_Rav_Tzadok_Parallel_Translation'],
      ['ish','Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref','Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation']
    ]){
      const ref=String(row[refField]||'').trim(),quote=excerpt(row[textField]);
      if(!ref||quote.length<75||/not available|unable to locate|could not verify|placeholder/i.test(quote)||common(context,words(quote))<2){
        stats.weakParallelsSkipped++;continue;
      }
      const key=kind+'|'+ref,last=recent.get(key);
      if(last!==undefined&&n-last<16){stats.repeatedParallelsSkipped++;continue;}
      if(note.paragraphs.some(p=>p.text.includes(ref+': '))){stats.repeatedParallelsSkipped++;continue;}
      const heading=(kind==='rav'?'Kisvei Rav Tzadok':'Kisvei Ishbitz–Radzin')+' — '+ref;
      const link=note.sources?.find(s=>s.ref===ref&&/^https:\/\/www\.sefaria\.org\//.test(s.url||'')&&!s.url.includes('/topics/'));
      note.paragraphs.push({text:heading+': '+quote,rich:[{text:heading,bold:true,...(link?{href:link.url}:{})},{text:': '+quote}]});
      recent.set(key,n);stats.addedParallels++;
      if(kind==='rav')stats.ravTzadokParallels++;else stats.ishbitzRadzinParallels++;
    }
    if(note.paragraphs.length>1){
      note.provenance??={};
      note.provenance.expandedParallelsSource='User-supplied Machshavot Charutz expanded CSV';
      note.provenance.parallelReview='Parallel passages suggested; sources not independently collated';
    }
  }
  if(stats.matchedNotes!==3478||stats.addedParallels<30)throw Error('Machshavot expansion not applied '+JSON.stringify(stats));
  work.footnoteImportInfo={...work.footnoteImportInfo,expandedCsvNotes:3478,parallelReview:'Suggested textual parallels; verify before academic citation',...stats};
  return stats;
}

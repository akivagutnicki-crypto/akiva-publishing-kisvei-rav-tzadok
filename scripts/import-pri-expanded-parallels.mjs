// Apply uploaded Pri Tzaddik expanded source parallels to the 69 interlinear
// sections, retaining every stronger Word-reviewed note and every Hebrew anchor.
// The supplied CSV contains 1,586 annotated citations; its six extra rows in
// original protected chapters never replace the 162 Word-reviewed source notes.
import fs from 'node:fs';
import path from 'node:path';
const DIR='dist/library/data/peri-tzadik';
const INPUT='sources/akiva/overlays/pri-expanded-reviewed';
const PROTECTED=new Set([92,105,106,111,112]);
const strip=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g,t=>({
 '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&#39;':"'",'&#x27;':"'"
}[t]||t));
function parse(line){
 const a=[];let q=false,s='';
 for(let i=0;i<line.length;i++){
   let c=line[i];if(q){if(c==='"'&&line[i+1]==='"'){s+='"';i++;}else if(c==='"')q=false;else s+=c;}
   else if(c==='"')q=true;else if(c===','){a.push(s);s='';}else s+=c;
 }
 if(q)throw Error('Invalid quoted CSV input');a.push(s);return a;
}
const stop=new Set(("about above after again against already also among another around because before being below between blessed cannot creation creations could created divine every from given god gods great hashem have having here into israel itself jewish jews just holy heaven heavens human indeed inner light lord made many more most much other others our over people rabbi rav right saying says said shall should since source sources spiritual still taught teach teaching teaches their there therefore these those through together torah tzadok under upon which while with within without would world written yours your where when they them what whose this that faith these them using such very").split(/\s+/));
function lex(s){
 return new Set((strip(s).toLowerCase().match(/[a-z]{5,}/g)||[]).filter(w=>!stop.has(w)));
}
function overlap(a,b){let n=0;for(const w of a)if(b.has(w))n++;return n;}
function excerpt(text){
 return String(text||'').split(/\s+Context and connection to (?:Peri|Pri) Tzaddik:/i)[0]
 .replace(/\s+Connection to this note:[\s\S]*$/i,'').trim();
}
function refKey(s){return String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');}
const tocFile=path.join(DIR,'toc.json'),toc=JSON.parse(fs.readFileSync(tocFile,'utf8'));
const leaves=[];function walk(x){if(x?.ref)leaves.push(x);for(const c of x?.children||[])walk(c);}walk(toc.toc);
const byRef=new Map(leaves.filter(x=>x.interlinear&&typeof x.id==='number').map(x=>[x.ref,x]));
const content=new Map();
for(const l of byRef.values())if(l.id>=90&&l.id<=158)
 content.set(l.id,JSON.parse(fs.readFileSync(path.join(DIR,l.id+'.json'),'utf8')));
if([...content.keys()].length!==69)throw Error('Missing Pri Tzaddik interlinear sections');
const files=Array.from({length:8},(_,i)=>path.join(INPUT,'part-'+String(i+1).padStart(2,'0')+'.csv'));
const lines=files.map(p=>fs.readFileSync(p,'utf8')).join('\n').trim().split(/\r?\n/);
const heads=parse(lines.shift().replace(/^\uFEFF/,''));
for(const key of ['Source_ID','Section_File','Section_Ref','Item_Number','Phrase_Index','Primary_Source_Ref','English_Source_Translation_And_Context','Kisvei_Rav_Tzadok_Parallel_Ref','Kisvei_Rav_Tzadok_Parallel_Translation','Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref','Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation'])
 if(!heads.includes(key))throw Error('Wrong expanded Pri CSV schema: '+key);
if(lines.length!==1586)throw Error('Uploaded Pri CSV should have 1586 citations: '+lines.length);
const seenNotes=new Set(),seenParallelRefs=new Set(),stats={
 uploaded:1586,reviewedPreserved:0,matchedUnreviewed:0,
 selectedParallels:0,selectedRavTzadok:0,selectedIshbitzRadzin:0,
 duplicatesAvoided:0,weakParallelsExcluded:0,
 primaryTextsPreserved:0,unmatched:0
};
// Existing importer already supplies a small set of source parallels. Respect
// those citations, too, when filtering repetition throughout the new overlay.
for(const [ch,items] of content)if(!PROTECTED.has(ch))
  for(const item of items)for(const note of item.footnotes||[])for(const p of (note.paragraphs||[]).slice(1)){
    const m=String(p.text||'').match(/^(Kisvei Rav Tzadok|Izhbitz–Radzin) — (.+?): /);
    if(m)seenParallelRefs.add((m[1]==='Kisvei Rav Tzadok'?'rav':'ish')+'|'+refKey(m[2]));
  }
for(let index=0;index<lines.length;index++){
 const cells=parse(lines[index]);
 if(cells.length!==heads.length)throw Error('CSV column count changed on row '+(index+2));
 const row=Object.fromEntries(heads.map((k,j)=>[k,cells[j]]));
 const chapter=Number(row.Section_File.replace(/\.json$/,'')),leaf=byRef.get(row.Section_Ref);
 if(!leaf||leaf.id!==chapter||!content.has(chapter))throw Error('Wrong section in CSV '+row.Source_ID);
 const items=content.get(chapter),item=items.find(i=>Array.isArray(i.p)&&String(i.n)===row.Item_Number);
 if(!item||!item.p[Number(row.Phrase_Index)])throw Error('Source row missing interlinear phrase '+row.Source_ID);
 if(PROTECTED.has(chapter)){stats.reviewedPreserved++;continue;}
 const candidates=(item.footnotes||[]).filter(n=>n.phraseIndex===Number(row.Phrase_Index));
 let matches=candidates.filter(n=>refKey(n.sources?.[0]?.ref)===refKey(row.Primary_Source_Ref));
 let note=matches.length===1?matches[0]:candidates.length===1?candidates[0]:null;
 if(!note){stats.unmatched++;continue;}
 if(seenNotes.has(note.placementId))throw Error('Multiple source rows mapped to one note '+row.Source_ID);
 seenNotes.add(note.placementId);stats.matchedUnreviewed++;stats.primaryTextsPreserved++;
 if(!note.paragraphs?.[0]?.rich||!note.paragraphs[0].text)throw Error('Lost primary source text '+row.Source_ID);
 if(note.sourceId==='PT-0002')continue; // preserve independently verified RH 32a source and its regression test
 const pair=item.p[note.phraseIndex],local=lex(strip(pair[1]));
 const primary=lex(excerpt(note.paragraphs[0].text).slice(0,900));
 for(const [kind,refCol,translationCol] of [
   ['rav','Kisvei_Rav_Tzadok_Parallel_Ref','Kisvei_Rav_Tzadok_Parallel_Translation'],
   ['ish','Kisvei_Beis_Ishbitz_Radzin_Parallel_Ref','Kisvei_Beis_Ishbitz_Radzin_Parallel_Translation']
 ]){
   const parallelRef=String(row[refCol]||'').trim(),quote=excerpt(row[translationCol]);
   if(!parallelRef||quote.length<65||/source not available|could not locate|not found|source review|translation pending/i.test(quote)){
     stats.weakParallelsExcluded++;continue;
   }
   const refToken=kind+'|'+refKey(parallelRef);
   if(seenParallelRefs.has(refToken)){stats.duplicatesAvoided++;continue;}
   const quoteWords=lex(quote);
   const localOverlap=overlap(local,quoteWords),primaryOverlap=overlap(primary,quoteWords);
   // No generic parallel just because it repeats "Torah", "Hashem", "creation" etc.
   if(!(localOverlap>=2||(localOverlap>=1&&primaryOverlap>=3)||primaryOverlap>=4)){
     stats.weakParallelsExcluded++;continue;
   }
   const header=(kind==='rav'?'Kisvei Rav Tzadok':'Kisvei Ishbitz–Radzin')+' — '+parallelRef;
   const paragraph={text:header+': '+quote,rich:[{text:header,bold:true},{text:': '+quote}],expansion:'pri-2026-reviewed'};
   if((note.paragraphs||[]).some(p=>p.text===paragraph.text)){stats.duplicatesAvoided++;continue;}
   (note.paragraphs??=[]).push(paragraph);
   seenParallelRefs.add(refToken);
   note.provenance??={};
   note.provenance.expandedParallels='User-uploaded 1586-row Pri Tzaddik expanded CSV';
   note.provenance.parallelVerification='Context screened; original text has not been independently verified';
   stats.selectedParallels++;
   if(kind==='rav')stats.selectedRavTzadok++;else stats.selectedIshbitzRadzin++;
 }
}
if(stats.reviewedPreserved!==162||stats.matchedUnreviewed!==1424||stats.unmatched!==0)
 throw Error('Source notes unmatched or Word notes changed: '+JSON.stringify(stats));
if(stats.selectedParallels<20)throw Error('Expanded Pri Tzaddik parallels not imported: '+JSON.stringify(stats));
for(const [chapter,items] of content)if(!PROTECTED.has(chapter))
 fs.writeFileSync(path.join(DIR,chapter+'.json'),JSON.stringify(items)+'\n');
toc.expandedFootnoteParallels={
 ...stats, source:'User-uploaded peri_tzadik_expanded_footnotes (1).csv',
 rule:'Keep Word-reviewed source passages; one Hebrew marker per primary citation; omit duplicate or weakly related parallel quotations.',
 status:'Paragraph anchors validated; parallels require scholarly review for exact text'
};
fs.writeFileSync(tocFile,JSON.stringify(toc)+'\n');
console.log('PASS PRI EXPANDED PARALLELS:',JSON.stringify(stats));

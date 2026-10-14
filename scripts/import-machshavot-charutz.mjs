// Reproduce the reviewed, uploaded Machshavot Charutz interlinear edition.
// Five UTF-8 fragments preserve the exact original JSON; SHA-256 protects against
// missing text, damaged nikkud, or accidentally out-of-order fragments.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT='sources/akiva/overlays/machshavot-charutz';
const OUTPUT='sources/akiva/Machshavot_Charutz.json';
const EXPECTED_SHA256='821c005a26b9176aede3a1f40e0875b9f08581dee70f2a748e87348f04621e41';
const parts=Array.from({length:5},(_,i)=>path.join(ROOT,'part-'+String(i+1).padStart(2,'0')+'.txt'));
const original=parts.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n';
const hash=crypto.createHash('sha256').update(original,'utf8').digest('hex');
if(hash!==EXPECTED_SHA256)throw new Error('Uploaded Machshavot edition source SHA-256 mismatch: '+hash);
const work=JSON.parse(original);
if(work.title!=='Machshavot Charutz' || work.sections?.length!==21 || work.footnoteImportInfo?.placements!==3478)
  throw new Error('Wrong Machshavot source or incomplete sections');
work.interlinear=true;
work.versionTitle='Akiva Publishing — Interlinear Study Edition with Expanded English Source Footnotes';
work.versionSource='Akiva Publishing editorial source expansion, 2026';
work.categories=['Chasidut','Rav Tzadok HaKohen'];
const decode=s=>String(s).replace(/<[^>]*>/g,'').replace(/&(?:quot|amp|apos|lt|gt|nbsp|#39|#x27);/g,
  t=>({'&quot;':'"','&amp;':'&','&apos':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[t]));
const numbers=new Set();let count=0,removed=0,pending=0,linked=0;
for(let n=1;n<=21;n++){
 const section=work.sections[n-1];
 if(section.n!==n||!Array.isArray(section.items))throw Error('Missing siman '+n);
 section.en='Siman '+n;section.he='סימן '+n;
 for(const item of section.items){
  if(!Array.isArray(item.p))continue;
  for(const note of item.footnotes||[]){
   count++;
   if(note.number!==count || note.sourceId!=='MC-'+String(count).padStart(4,'0') ||
       note.placementId!==note.sourceId+'-1' || numbers.has(note.number))
     throw Error('Non-continuous or duplicate note '+n+':'+item.n);
   numbers.add(note.number);
   const pair=item.p[note.phraseIndex];
   if(!pair || decode(pair[0]).slice(0,note.heCharOffset)!==note.heAnchorPrefix ||
       decode(pair[1]).slice(0,note.enCharOffset)!==note.enAnchorPrefix)
     throw Error('Footnote anchor mismatch '+note.sourceId+' at '+n+':'+item.n);
   // A missing or unavailable Sefaria text NEVER removes an English footnote.
   // Keep even notes whose source has not been indexed on Sefaria.
   if(!Array.isArray(note.sources))note.sources=[];
   linked+=note.sources.filter(s=>s.ref&&s.url?.startsWith('https://www.sefaria.org/')).length;
   // The clickable source is already bold within the translated quotation;
   // the second "Sources:" paragraph duplicates the same link in the popup.
   if(note.paragraphs?.[1]?.text?.startsWith('Sources: ')){
     note.paragraphs=note.paragraphs.slice(0,1);removed++;
   }
   // Do not advertise generic generator filler as a verified quotation.
   if(note.paragraphs?.[0]?.text?.includes('Primary source reference in ')){
     pending++;
     const ref=note.sources[0]?.ref || 'Unverified citation';
     note.paragraphs=[{
       text:ref+': English source translation awaiting textual verification.',
       rich:[
         {text:ref,bold:true,...(note.sources[0]?.url?.startsWith('https://www.sefaria.org/') ? {href:note.sources[0].url} : {})},
         {text:': English source translation awaiting textual verification.'}
       ]
     }];
     note.verificationStatus='source translation pending';
     note.verificationNote='The uploaded annotation had a non-quotational placeholder; text must be collated against the cited edition.';
   }
   if(!note.paragraphs?.length || note.paragraphs.some(p=>!p.text || p.rich?.map(x=>x.text).join('')!==p.text))
     throw Error('Incomplete note text '+note.sourceId);
  }
 }
}
if(count!==3478 || pending!==42 || removed!==3478)
  throw Error('Unexpected editorial import counts: '+JSON.stringify({count,linked,pending,removed}));
work.footnoteImportInfo={
 ...work.footnoteImportInfo,
 sourceTranslationsAwaitingVerification:pending,
 redundantSourcesParagraphsRemoved:removed,
 numbering:'Continuous 1-3478 across all 21 simanim; Hebrew-only footnote markers'
};
fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
fs.writeFileSync(OUTPUT,JSON.stringify(work)+'\n');
console.log('PASS Machshavot import:',count,'exact bilingual footnote placements,',
  linked,'Sefaria links;',removed,'redundant source paragraphs removed;',
  pending,'placeholders flagged for source translation review.');

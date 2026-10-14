import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SOURCE = 'sources/akiva/Tzidkat_HaTzadik.json';
const PARTS = 'sources/akiva/overlays/tzidkat-2141';
const EXPECTED_SHA256 = '936942c8ee6a98d9655d9249d9d11401ca82221466079a0f4454beca858595fb';
const partFiles = Array.from({length:8}, (_,i) => path.join(PARTS, 'part-' + String(i+1).padStart(2,'0') + '.txt'));
const bytes = partFiles.map(p => fs.readFileSync(p,'utf8')).join('\n') + '\n';
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
if (digest !== EXPECTED_SHA256) throw new Error('Tzidkat uploaded source SHA256 mismatch: '+digest);
const supplied = JSON.parse(bytes);
if (supplied.sections?.length !== 264 || supplied.footnoteImportInfo?.notes !== 2141) {
 throw new Error('Expected exactly 2,141 source notes in 264 sections');
}
const original = JSON.parse(fs.readFileSync(SOURCE,'utf8'));
const strip = x => String(x||'').replace(/<[^>]+>/g,'').replace(/&(?:amp|quot|lt|gt|nbsp|#39);/g,m=>({
 '&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'"
}[m]||m));
const canon = s => String(s||'').replace(/\.(\d+)\.(\d+)\b/g,' $1:$2').replace(/\.(\d+[ab]?)\b/g,' $1');
const refs = note => new Set((note.sources||[]).map(s=>canon(s.ref)));
const cloned = obj => structuredClone(obj);
let duplicates=0, legacyAdded=0, reviewedAdded=0, placeholder=0;
const oldPlacementToNewIdentity = new Map();
const assigned = new Map();
const placementCounts = new Map();
const pendingCrossReferences=[];
let num=0, placements=0, sourceLinks=0;
const newSections=[];

for(const suppliedSec of supplied.sections){
 const oldSec = original.sections.find(x=>x.n===suppliedSec.n);
 if(!oldSec) throw new Error('Missing original siman '+suppliedSec.n);
 const items=[];
 for(const suppliedItem of suppliedSec.items){
  const oldItem=oldSec.items.find(x=>x.n===suppliedItem.n);
  if(!oldItem)throw new Error('Missing original paragraph '+suppliedSec.n+':'+suppliedItem.n);
  const imported=(suppliedItem.footnotes||[]).map(n=>{
   const out=cloned(n);
   out._origin='A';
   out._sourceKey='A:'+n.sourceId;
   out._placementKey='A:'+n.placementId;
   if(out.paragraphs?.[1]?.text?.startsWith('Sources: '))out.paragraphs=out.paragraphs.slice(0,1);
   if(out.paragraphs?.[0]?.text?.includes('See '+out.sources?.[0]?.ref+' for the primary source background')){
    out.verificationStatus='requires source translation';
    out.verificationNote='Original supplied spreadsheet has no translated quotation for this source.';
    placeholder++;
   }
   reviewedAdded++;
   return out;
  });
  const legacy=[];
  for(const raw of oldItem.footnotes||[]){
    const have=refs(raw);
    const found=imported.find(n=>n.phraseIndex===raw.phraseIndex&&[...refs(n)].some(r=>have.has(r)));
    if(found){
      duplicates++;
      oldPlacementToNewIdentity.set('L:'+raw.placementId,found._placementKey);
      if(String(raw.verificationStatus||'').includes('requires collation')){
        found.verificationStatus=raw.verificationStatus;
        found.verificationNote=raw.verificationNote;
      }
      continue;
    }
    const n=cloned(raw);
    n._origin='L';n._sourceKey='L:'+raw.sourceId;n._placementKey='L:'+raw.placementId;
    legacy.push(n);legacyAdded++;
  }
  const all=[...imported,...legacy].sort((a,b)=>
   (a.phraseIndex-b.phraseIndex) || (a.heCharOffset-b.heCharOffset) || (a._origin==='A'?-1:1));
  for(const n of all){
   const pair=suppliedItem.p[n.phraseIndex];
   if(!pair)throw new Error('No text pair for footnote '+n._placementKey);
   const he=strip(pair[0]), en=strip(pair[1]);
   if(he.slice(0,n.heCharOffset)!==n.heAnchorPrefix){
     const pos=he.indexOf(n.heAnchorPrefix);
     if(pos!==0)throw new Error('Misaligned Hebrew footnote '+n._placementKey+' in '+suppliedSec.n+':'+suppliedItem.n);
     n.heCharOffset=n.heAnchorPrefix.length;
   }
   if(en.slice(0,n.enCharOffset)!==n.enAnchorPrefix){
     const pos=en.indexOf(n.enAnchorPrefix);
     if(pos!==0)throw new Error('Misaligned English footnote '+n._placementKey+' in '+suppliedSec.n+':'+suppliedItem.n);
     n.enCharOffset=n.enAnchorPrefix.length;
   }
   if(!assigned.has(n._sourceKey))assigned.set(n._sourceKey,++num);
   const number=assigned.get(n._sourceKey);
   const id='TZ-'+String(number).padStart(4,'0');
   const ordinal=(placementCounts.get(id)||0)+1;placementCounts.set(id,ordinal);
   const placementId=id+'-'+ordinal;
   pendingCrossReferences.push({note:n,originalPlacement:n._placementKey});
   n.number=number;n.sourceId=id;n.placementId=placementId;
   n.provenance={...(n.provenance||{}),edition: n._origin==='A'?'Akiva Publishing Expanded English Sources':'Preserved original editorial footnote',
     siman:suppliedSec.n,printedNumber:number};
   placements++;sourceLinks+=(n.sources||[]).length;
  }
  items.push({...oldItem,...suppliedItem,footnotes:all});
 }
 newSections.push({...oldSec,...suppliedSec,items});
}
const finalPlacementMap = new Map(pendingCrossReferences.map(({note,originalPlacement})=>[originalPlacement,note.placementId]));
for(const {note} of pendingCrossReferences){
 if(note.crossReference?.placementId){
   const dest=finalPlacementMap.get('L:'+note.crossReference.placementId) ||
     finalPlacementMap.get(oldPlacementToNewIdentity.get('L:'+note.crossReference.placementId)||'');
   if(dest){note.crossReference.placementId=dest;note.crossReference.number=Number(dest.slice(3,7));}
   else throw new Error('Lost legacy cross-reference '+note.crossReference.placementId);
 }
 delete note._origin;delete note._sourceKey;delete note._placementKey;
}
original.sections=newSections;
original.footnoteImportInfo={
 ...(original.footnoteImportInfo||{}),
 ...supplied.footnoteImportInfo,
 notes:num,
 placements,
 sourceLinks,
 sectionsWithNotes:newSections.filter(s=>s.items.some(i=>i.footnotes?.length)).length,
 reviewedEnglishSources:reviewedAdded,
 preservedEditorialNotes:legacyAdded,
 overlapsConsolidated:duplicates,
 sourceTranslationsToReview:placeholder,
 numbering:'Continuous book-wide numbers across 264 simanim; one canonical note per source at each phrase.'
};
fs.writeFileSync(SOURCE,JSON.stringify(original,null,2)+'\n');
console.log('IMPORTED REVIEWED TZIDKAT FOOTNOTES: '+reviewedAdded+' supplied, '+legacyAdded+
 ' separate earlier notes preserved, '+duplicates+' overlapping source markers consolidated, '+num+
 ' numbered notes, '+placements+' placements, '+placeholder+' source-text placeholders flagged.');

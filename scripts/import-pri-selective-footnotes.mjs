// Selective Pri Tzaddik scholarly footnote upgrade.
// Original Word-verified notes always win. Adds only genuinely new, located
// sources from the supplied expanded manuscript without overwriting text.
import fs from 'node:fs';
import path from 'node:path';
const DIR='dist/library/data/peri-tzadik';
const IN='sources/akiva/overlays/pri-reviewed';
const refs=[
 {ref:'Peri Tzadik, Bereshit 3',input:'bereshit-3.json'},
 {ref:'Peri Tzadik, Noach 5',input:'noach-5.json'},
 {ref:'Peri Tzadik, Noach 6',input:'noach-6.json'}
];
const selectedNoach=new Set([
 'PT-0476','PT-0482','PT-0487','PT-0488',
 'PT-0494','PT-0495','PT-0496','PT-0512'
]);
const decode=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|nbsp|apos|#39|#x27);/g,m=>({
 '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&nbsp;':' ','&apos;':"'",'&#39;':"'",'&#x27;':"'"
}[m]));
const load=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,obj)=>fs.writeFileSync(p,JSON.stringify(obj)+'\n','utf8');
const preciseUrl=url=>/^https:\/\/www\.sefaria\.org\/[^\s<>"']+$/i.test(url||'')&&!url.includes('/topics/');
const toc=load(path.join(DIR,'toc.json'));
const leafs=[];function walk(node){if(node?.ref)leafs.push(node);for(const v of node?.children||[])walk(v);}walk(toc.toc);
const edited=new Map();
const summaries=[];
function noteText(record){
 let body=String(record.primary||'').trim();
 // The expanded dataset repeats this broad, template-style explanation in
 // every note. Keep the actual source excerpt; never call it a verified full
 // translation when the supplied passage is abbreviated.
 body=body.split(/\s+Context and connection to Pri Tzaddik:/i)[0].trim();
 const source=String(record.ref||'').trim();
 if(source&&body.startsWith(source+':'))body=body.slice(source.length+1).trim();
 if(!body||body.length<50)throw Error('Insufficient new source excerpt: '+record.sourceId);
 const label=source||'Primary source';
 const linked=preciseUrl(record.url);
 const text=label+': '+body;
 return {paragraph:{text,rich:[
   {text:label,bold:true,...(linked?{href:record.url}:{})},
   {text:': '+body}
 ]},linked};
}
for(const target of refs){
 const leaf=leafs.find(x=>x.ref===target.ref&&x.interlinear);
 if(!leaf)throw Error('Missing verified interlinear section '+target.ref);
 const file=path.join(DIR,leaf.id+'.json');
 const items=load(file);
 const src=load(path.join(IN,target.input));
 if(src.section!==target.ref)throw Error('Overlay mismatch for '+target.ref);
 const base=items.reduce((n,i)=>n+(i.footnotes?.length||0),0);
 const expected=target.ref.endsWith('Bereshit 3')?17:target.ref.endsWith('Noach 5')?15:16;
 if(base!==expected)throw Error('Original reviewed notes changed for '+target.ref+': '+base+' versus '+expected);
 const originalSignature=items.flatMap(i=>i.footnotes||[]).map(n=>n.paragraphs.map(p=>p.text).join('\n'));
 let added=0,combined=0,skipped=0;
 for(const incoming of src.notes){
  if(!target.ref.endsWith('Bereshit 3')&&!selectedNoach.has(incoming.sourceId)){skipped++;continue;}
  const segments=items.filter(i=>i.n===incoming.item&&Array.isArray(i.p));
  if(segments.length!==1)throw Error('Ambiguous item '+target.ref+' '+incoming.item);
  const item=segments[0],pair=item.p[incoming.phraseIndex];
  if(!pair)throw Error('Phrase absent '+incoming.sourceId);
  const he=decode(pair[0]),en=decode(pair[1]);
  if(he.slice(0,incoming.heCharOffset)!==incoming.heAnchorPrefix ||
     en.slice(0,incoming.enCharOffset)!==incoming.enAnchorPrefix)
    throw Error('Source anchor does not match original Hebrew/English: '+incoming.sourceId);
  const {paragraph,linked}=noteText(incoming);
  const same=(item.footnotes||[]).find(n=>n.phraseIndex===incoming.phraseIndex &&
   n.heCharOffset===incoming.heCharOffset);
  if(same){
   if(!(same.paragraphs||[]).some(p=>p.text===paragraph.text || p.text.startsWith(incoming.ref+':'))){
    (same.paragraphs??=[]).push(paragraph);
    if(linked)(same.sources??=[]).push({ref:incoming.ref,url:incoming.url,role:'reviewed-source-expansion'});
    combined++;
   }else skipped++;
   continue;
  }
  const id='PT-UPGRADE-'+incoming.sourceId.replace(/^PT-/,'');
  const note={
    number:0,sourceId:id,placementId:id+'-1',
    phraseIndex:incoming.phraseIndex,
    heCharOffset:incoming.heCharOffset,enCharOffset:incoming.enCharOffset,
    heAnchorPrefix:incoming.heAnchorPrefix,enAnchorPrefix:incoming.enAnchorPrefix,
    heWord:Math.max(1,he.slice(0,incoming.heCharOffset).trim().split(/\s+/).length),
    paragraphs:[paragraph],
    sources:linked?[{ref:incoming.ref,url:incoming.url,role:'primary-source'}]:[],
    nativeConnections:[],
    verificationStatus:'Citation and excerpt supplied; text anchor confirmed locally',
    provenance:{reviewSource:'uploaded-pri-expanded',sourceId:incoming.sourceId,
      edition:'Akiva Publishing selective source upgrade',section:target.ref}
  };
  (item.footnotes??=[]).push(note);
  added++;
 }
 const found=items.flatMap(i=>i.footnotes||[]);
 for(const oldText of originalSignature)if(!found.some(n=>n.paragraphs.map(p=>p.text).join('\n').includes(oldText)))
  throw Error('Prior authored note was lost or rewritten in '+target.ref);
 edited.set(target.ref,{file,items,base,added,combined,skipped});
 summaries.push({section:target.ref,base,added,combined,skipped});
}
// Reassign the numeric markers in reading order but never replace the
// original English annotations, link metadata, or Word documents.
let noachIndex=0;
for(const [ref,data] of edited){
 const withCh=ref.endsWith('Bereshit 3');
 let n=withCh?0:noachIndex;
 for(const item of data.items){
  if(!item.footnotes)continue;
  item.footnotes.sort((a,b)=>a.phraseIndex-b.phraseIndex||a.heCharOffset-b.heCharOffset);
  for(const note of item.footnotes){
   note.number=++n;
   // Unchanged source identifiers survive for all original Word notes.
  }
 }
 if(!withCh)noachIndex=n;
 save(data.file,data.items);
}
if(noachIndex!==39)throw Error('Expected 39 combined Noach notes, found '+noachIndex);
const berCount=edited.get('Peri Tzadik, Bereshit 3').items.flatMap(i=>i.footnotes||[]).length;
if(berCount<37||berCount>44)throw Error('Unexpected Bereshit Ois 3 note count '+berCount);
const marchLeaf=leafs.find(x=>x.ref==='Peri Tzadik, Rosh Chodesh Cheshvan'&&x.interlinear);
const marchCount=load(path.join(DIR,marchLeaf.id+'.json')).flatMap(i=>i.footnotes||[]).length;
if(marchCount!==48)throw Error('Existing reviewed Mar Cheshvan footnotes unexpectedly changed');
toc.footnoteUpgradeInfo={
 editor:'Selective comparison with user supplied Pri Tzaddik expanded sources',
 bereshit3Notes:berCount,noach5and6Notes:noachIndex,
 marcheshvanPreservedNotes:marchCount,originalWordFootnotesPreserved:17+31+48,
 date:'2026-10-15',sources:'Sefaria URLs supplied; not individually checked against Sefaria API'
};
save(path.join(DIR,'toc.json'),toc);
console.log('Selective Pri Tzaddik upgraded:',JSON.stringify(summaries),
 'Bereishis Ois 3=',berCount,'Noach Ois 5–6=',noachIndex,
 'Mar Cheshvan untouched=',marchCount);

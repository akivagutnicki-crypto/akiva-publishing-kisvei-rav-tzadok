import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',thinsp:' ',ensp:' ',emsp:' ',zwnj:'‌',zwj:'‍',lrm:'‎',rlm:'‏'};
const decode=value=>String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,key)=>{
 if(key[0]==='#'){const point=/^#x/i.test(key)?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return Number.isInteger(point)&&point>=0&&point<=0x10ffff?String.fromCodePoint(point):all;}
 return ENTITIES[key.toLowerCase()]??all;
});
const tidy=value=>String(value).replace(/[ \t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
export const markerPlain=value=>decode(String(value??'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'')).trim();
const attributes=tag=>Object.fromEntries([...String(tag).matchAll(/\b([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3])]));
const hasClass=(tag,name)=>String(attributes(tag).class||'').split(/\s+/).includes(name);

function inlineBlocks(value){
 const html=String(value??''),blocks=[],SOURCE_MARKER=/<sup\b[^>]*>[\s\S]*?<\/sup>/gi;let marker;
 while((marker=SOURCE_MARKER.exec(html))){
  if(!hasClass(marker[0],'footnote-marker'))continue;
  const numberText=markerPlain(marker[0]);assert(/^\d+$/.test(numberText)&&Number(numberText)>0,'A legacy source marker needs a positive integer number');
  const suffix=html.slice(SOURCE_MARKER.lastIndex),open=suffix.match(/^\s*(<i\b[^>]*>)/i);assert(open&&hasClass(open[1],'footnote'),'A legacy marker has no complete adjacent source note');
  const innerStart=SOURCE_MARKER.lastIndex+open[0].length;let depth=1,innerEnd=-1,end=-1;const italics=/<(\/?)i\b[^>]*>/gi;italics.lastIndex=innerStart;let tag;
  while((tag=italics.exec(html))){depth+=tag[1]?-1:1;if(!depth){innerEnd=tag.index;end=italics.lastIndex;break;}}
  assert(depth===0,'Unclosed legacy source note');
  const raw=html.slice(marker.index,end),innerHtml=html.slice(innerStart,innerEnd);blocks.push({start:marker.index,end,number:Number(numberText),raw,innerHtml,sha256:sha(raw),innerHtmlSha256:sha(innerHtml),text:markerPlain(innerHtml),targets:sourceTargets(innerHtml)});SOURCE_MARKER.lastIndex=end;
 }
 return blocks;
}
function withoutNotes(value){let out='',cursor=0;const html=String(value??'');for(const block of inlineBlocks(html)){out+=html.slice(cursor,block.start);cursor=block.end;}return out+html.slice(cursor);}
export const markerAuthorPlain=value=>markerPlain(withoutNotes(value));
function sourceTargets(value){
 return[...String(value).matchAll(/<a\b[^>]*>/gi)].map(m=>{const attrs=attributes(m[0]);return{...(attrs['data-ref']?{ref:attrs['data-ref']}:{}),...(attrs['data-reader-ref']?{readerRef:attrs['data-reader-ref']}:{}),...(attrs.href?{url:attrs.href}:{})};}).filter(t=>t.ref||t.readerRef||t.url);
}
const authorPhrase=pair=>pair.map(value=>markerPlain(withoutNotes(value)));
const editable=id=>Number.isInteger(id)&&id>=0&&id<=13;
function paragraph(section,n){const rows=section.after.filter(row=>row.p&&row.n===n);assert.equal(rows.length,1,'A stable paragraph must occur exactly once');return rows[0];}

/** Read-only inventory: every legacy block, including excluded sections 14–15. */
export function inventoryInlineNotes(sections){
 const inventory=[];
 for(const section of sections){assert(Number.isInteger(section.id)&&Array.isArray(section.after),'Invalid reader section');for(const row of section.after){if(!row.p)continue;row.p.forEach((pair,pairIndex0)=>{
  assert(Array.isArray(pair)&&pair.length===2&&pair.every(value=>typeof value==='string'),'Invalid reader phrase pair');pair.forEach((value,side)=>{
   for(const block of inlineBlocks(value))inventory.push({kind:'inline',noteKey:'',sectionId:section.id,sectionRef:section.sectionRef,paragraph1:row.n,pairIndex0,language:side?'en':'he',side,number:String(block.number),editable:editable(section.id),excluded:!editable(section.id),sourceBlockHtml:block.raw,sourceBlockSha256:block.sha256,raw:block.raw,rawSha256:block.sha256,noteText:block.text,sourceRefs:[...new Set(block.targets.map(t=>t.ref).filter(Boolean))],start0:block.start,end0:block.end,readerRef:section.sectionRef+(section.id?':':' ')+row.n,currentHebrewPair:authorPhrase(pair)[0],currentEnglishPair:authorPhrase(pair)[1],innerHtml:block.innerHtml,innerHtmlSha256:block.innerHtmlSha256,text:block.text,sourceTargets:block.targets,sourceStart:block.start,sourceEnd:block.end,authorPhrase:{he:authorPhrase(pair)[0],en:authorPhrase(pair)[1]},previousPhrase:pairIndex0?{he:authorPhrase(row.p[pairIndex0-1])[0],en:authorPhrase(row.p[pairIndex0-1])[1]}:null,nextPhrase:pairIndex0+1<row.p.length?{he:authorPhrase(row.p[pairIndex0+1])[0],en:authorPhrase(row.p[pairIndex0+1])[1]}:null});
  });
 });}}
 const numberCounts=new Map();for(const item of inventory){const key=item.sectionId+':'+item.number;numberCounts.set(key,(numberCounts.get(key)||0)+1);}
 const occurrences=new Map();for(const item of inventory){const key=[item.sectionId,item.paragraph1,item.number].join(':');occurrences.set(key,(occurrences.get(key)||0)+1);item.noteKey=key+':'+occurrences.get(key);item.sectionNumberOccurrences=numberCounts.get(item.sectionId+':'+item.number);}
 return inventory;
}

function validateSources(item,note,op){
 assert(Array.isArray(note.sources),'The native note must explicitly list its reviewed source links');
 const representations=[...note.sources.map(source=>({ref:source.ref,readerRef:source.readerRef,url:source.url,citationOnly:source.citationOnly===true||source.printedCitationOnly===true,printedCitation:source.printedCitation||source.text||source.ref})),...note.paragraphs.flatMap(p=>(p.rich||[]).filter(run=>run.href).map(run=>({ref:run.ref||run.sourceRef,readerRef:run.readerRef,url:run.href})))];
 const verified=op.verifiedSourceTargets||[];assert(Array.isArray(verified),'Invalid verified-source target ledger');
 for(const target of verified){assert(target.ref&&target.url&&target.verified===true&&Array.isArray(target.evidence)&&target.evidence.length,'An added native source URL requires explicit prior verification');assert(item.sourceTargets.some(old=>old.ref===target.ref||old.readerRef===target.ref),'The placement operation cannot invent an additional source reference');assert(/^https:\/\//.test(target.url)||/^#\/read\//.test(target.url),'Invalid verified source URL');}
 for(const old of item.sourceTargets){
  if(old.ref)assert(representations.some(r=>r.ref===old.ref||r.readerRef===old.ref||(old.url&&r.url===old.url)),'A native note lost an exact legacy source reference: '+old.ref);
  if(old.readerRef)assert(representations.some(r=>r.ref===old.readerRef||r.readerRef===old.readerRef),'A native note lost an exact legacy reader reference: '+old.readerRef);
  if(old.url)assert(representations.some(r=>r.url===old.url),'A native note lost an exact legacy hyperlink');
 }
 for(const representation of representations){
  if(representation.citationOnly&&!representation.url){assert(typeof representation.printedCitation==='string'&&representation.printedCitation.trim(),'A printed source needs its preserved citation text');assert(item.text.includes(representation.printedCitation)||item.sourceTargets.some(old=>old.ref===representation.ref||old.readerRef===representation.ref),'A printed citation cannot be invented by a marker move');continue;}
  assert(typeof representation.url==='string'&&representation.url,'A native source link needs its exact verified URL');
  assert(item.sourceTargets.some(old=>old.url===representation.url)||verified.some(v=>v.url===representation.url&&(v.ref===representation.ref||v.ref===representation.readerRef||!representation.ref&&!representation.readerRef)),'A placement operation introduced an unverified hyperlink');
  for(const ref of[representation.ref,representation.readerRef].filter(Boolean))assert(item.sourceTargets.some(old=>old.ref===ref||old.readerRef===ref)||verified.some(v=>v.ref===ref),'A native source link changed its legacy reference');
 }
}

/** Apply only reviewed placements. This function never chooses target positions. */
function applySingleReviewedMarkerPlacements(inputSections,operations){
 assert(Array.isArray(inputSections)&&Array.isArray(operations),'Sections and reviewed placements must be arrays');
 const sections=structuredClone(inputSections),inventory=inventoryInlineNotes(inputSections),audit=[],usedSources=new Set(),newPlacements=new Set(),newSources=new Set();
 const originalAuthor=inputSections.map(section=>({id:section.id,rows:section.after.map(row=>row.p?{n:row.n,p:row.p.map(pair=>pair.map(withoutNotes))}:structuredClone(row))}));
 const originalNative=inputSections.flatMap(section=>section.after.flatMap(row=>(row.footnotes||[]).map(note=>({sectionId:section.id,paragraph1:row.n,note}))));
 for(const[operationIndex,op]of operations.entries()){
  assert(op&&op.reviewed===true&&typeof op.reason==='string'&&op.reason.trim()&&typeof op.placementRationale==='string'&&op.placementRationale.trim()&&Array.isArray(op.evidence)&&op.evidence.length,'Every marker move requires a completed-point placement review and source evidence');
  const source=op.source,target=op.target,note=structuredClone(op.note);assert(source&&target&&note,'A marker move needs exact source, target, and native note objects');assert(editable(source.sectionId),'Sections 14 and 15 are excluded from marker changes');assert(['he','en'].includes(source.language));assert(Number.isInteger(source.pairIndex0)&&source.pairIndex0>=0);assert(Number.isInteger(source.paragraph1)&&source.paragraph1>0);assert(/^\d+$/.test(String(source.number))&&Number(source.number)>0);const sourceNumber=Number(source.number);assert(target.sectionId===undefined||target.sectionId===source.sectionId,'Cross-section marker moves require a separate scholarly change');
  const key=[source.sectionId,source.paragraph1,source.pairIndex0,source.language,source.number].join('|');assert(!usedSources.has(key),'Duplicate reviewed source marker operation');usedSources.add(key);
  const matches=inventory.filter(item=>item.sectionId===source.sectionId&&item.paragraph1===source.paragraph1&&item.pairIndex0===source.pairIndex0&&item.language===source.language&&Number(item.number)===sourceNumber);assert.equal(matches.length,1,'The original marker is missing or duplicated at its exact source');const item=matches[0];if(op.noteKey!==undefined)assert.equal(op.noteKey,item.noteKey,'The authoritative noteKey differs');assert.equal(item.sectionNumberOccurrences,1,'The legacy source number is duplicated within this section and needs explicit resolution');assert.equal(op.sourceBlockHtml,item.sourceBlockHtml,'The reviewed source block differs');assert.equal(op.sourceBlockSha256,item.sourceBlockSha256,'The reviewed source block hash differs');assert.match(op.sourceBlockSha256,/^[a-f0-9]{64}$/);
  const section=sections.find(s=>s.id===source.sectionId);assert(section,'Unknown source section');const sourceRow=paragraph(section,source.paragraph1),targetParagraph=target.paragraph1??source.paragraph1,targetRow=paragraph(section,targetParagraph),sourceSide=source.language==='he'?0:1;assert(sourceRow.p[source.pairIndex0]);assert(Number.isInteger(target.pairIndex0)&&target.pairIndex0>=0&&targetRow.p[target.pairIndex0],'The reviewed Hebrew target phrase is missing');
  const he=markerPlain(withoutNotes(targetRow.p[target.pairIndex0][0]));assert(Number.isInteger(target.heCharOffset)&&target.heCharOffset>0&&target.heCharOffset<=he.length,'The reviewed Hebrew marker must follow actual Hebrew text');assert(typeof target.heAnchorPrefix==='string'&&target.heAnchorPrefix===he.slice(0,target.heCharOffset),'The reviewed Hebrew prefix or character offset differs');
  assert(typeof note.sourceId==='string'&&note.sourceId.trim()&&typeof note.placementId==='string'&&note.placementId.trim(),'Native source and placement identities must be stable and explicit');assert(!newSources.has(note.sourceId)&&!originalNative.some(entry=>entry.note.sourceId===note.sourceId),'Duplicate native source identity');assert(!newPlacements.has(note.placementId)&&!originalNative.some(entry=>entry.note.placementId===note.placementId),'Duplicate native placement identity');newSources.add(note.sourceId);newPlacements.add(note.placementId);
  assert.equal(note.number,sourceNumber,'Moving a marker cannot renumber its source');assert.equal(note.phraseIndex,target.pairIndex0);assert.equal(note.heCharOffset,target.heCharOffset);assert.equal(note.heAnchorPrefix,target.heAnchorPrefix);assert(note.enCharOffset===undefined&&note.enAnchorPrefix===undefined,'The source marker must occur in Hebrew only');
  assert(Array.isArray(note.paragraphs)&&note.paragraphs.length&&note.paragraphs.every(p=>p.language==='en'&&typeof p.text==='string'),'The native note must retain all English source paragraphs');assert.equal(note.paragraphs.map(p=>p.text).join('\n'),item.text,'The marker move cannot change or truncate the full source quotation');for(const p of note.paragraphs)if(p.rich!==undefined){assert(Array.isArray(p.rich)&&p.rich.every(run=>typeof run.text==='string'));assert.equal(p.rich.map(run=>run.text).join(''),p.text,'Rich source runs differ from the full source text');}
  validateSources(item,note,op);assert(!originalNative.some(entry=>entry.sectionId===source.sectionId&&entry.note.number===note.number),'The source number already has a native marker in this section');
  const old=sourceRow.p[source.pairIndex0][sourceSide];assert.equal(old.split(item.sourceBlockHtml).length,2,'The exact legacy source block must occur once before removal');sourceRow.p[source.pairIndex0][sourceSide]=old.replace(item.sourceBlockHtml,'');(targetRow.footnotes??=[]).push(note);
  audit.push({operationIndex,source:structuredClone(source),target:{paragraph1:targetParagraph,pairIndex0:target.pairIndex0,heCharOffset:target.heCharOffset,heAnchorPrefix:target.heAnchorPrefix},sourceBlockSha256:item.sourceBlockSha256,nativeSourceId:note.sourceId,nativePlacementId:note.placementId,number:note.number,fullSourceTextSha256:sha(item.text),sourceTargetsPreserved:true,authorTextPreserved:true,reason:op.reason,placementRationale:op.placementRationale,evidence:structuredClone(op.evidence)});
 }
 const finalAuthor=sections.map(section=>({id:section.id,rows:section.after.map(row=>row.p?{n:row.n,p:row.p.map(pair=>pair.map(withoutNotes))}:structuredClone(row))}));assert.deepEqual(finalAuthor,originalAuthor,'A marker move changed or reordered author text');
 for(const section of inputSections.filter(s=>!editable(s.id)))assert.equal(JSON.stringify(sections.find(s=>s.id===section.id)),JSON.stringify(section),'An excluded section changed');
 for(const original of originalNative)assert.deepEqual(paragraph(sections.find(s=>s.id===original.sectionId),original.paragraph1).footnotes.find(note=>note.placementId===original.note.placementId),original.note,'An existing native note changed');
 assert.equal(inventoryInlineNotes(sections).length,inventory.length-operations.length,'A marker move lost or duplicated a legacy source note');
 assert.equal(sections.flatMap(s=>s.after.flatMap(row=>row.footnotes||[])).length,originalNative.length+operations.length,'A marker move lost or duplicated a native source note');
 return{sections,audit};
}


/** Reviewed splits are explicit scholarly replacements, never automatic truncations. */
export function applyReviewedMarkerPlacements(inputSections, operations) {
 assert(Array.isArray(inputSections)&&Array.isArray(operations),'Sections and reviewed placements must be arrays');
 let sections=structuredClone(inputSections);const audit=[];let expectedChildren=0;
 const originalNativeCount=inputSections.flatMap(s=>s.after.flatMap(row=>row.footnotes||[])).length;
 const originalInlineCount=inventoryInlineNotes(inputSections).length;const usedOperations=new Set();
 const singles=operations.map((op,operationIndex)=>({op,operationIndex})).filter(x=>x.op.decision!=='split');
 if(singles.length){const applied=applySingleReviewedMarkerPlacements(sections,singles.map(x=>x.op));sections=applied.sections;audit.push(...applied.audit.map(entry=>({...entry,operationIndex:singles[entry.operationIndex].operationIndex})));expectedChildren+=singles.length;}
 for(const [operationIndex,op] of operations.entries()) {
  const operationKey=JSON.stringify(op.source);assert(!usedOperations.has(operationKey),'Duplicate reviewed source marker operation');usedOperations.add(operationKey);
  if(op.decision!=='split') {
   continue;
  }
  assert(op.reviewed===true&&typeof op.reason==='string'&&op.reason.trim()&&Array.isArray(op.evidence)&&op.evidence.length,'A split requires a reviewed scholarly reason and evidence');
  const provenance=op.replacementProvenance;
  assert(provenance&&provenance.reviewed===true&&typeof provenance.reviewer==='string'&&provenance.reviewer.trim()&&provenance.originalBlockSha256===op.sourceBlockSha256&&Array.isArray(provenance.evidence)&&provenance.evidence.length,'A split requires explicit reviewed replacement provenance for the exact original block');
  assert(Array.isArray(op.replacementNotes)&&op.replacementNotes.length>=2,'A split needs at least two complete reviewed replacement notes');
  const inventory=inventoryInlineNotes(sections),item=inventory.find(n=>n.noteKey===op.noteKey);
  assert(item,'The exact original split note must still exist');assert.equal(item.raw,op.sourceBlockHtml);assert.equal(item.rawSha256,op.sourceBlockSha256);
  const childIds=new Set(),placementIds=new Set(),numbers=new Set(),positions=new Set(),validated=[];
  for(const [childIndex,child]of op.replacementNotes.entries()) {
   assert(child&&typeof child.newInnerHtml==='string'&&child.newInnerHtml.trim()&&typeof child.placementRationale==='string'&&child.placementRationale.trim()&&Array.isArray(child.evidence)&&child.evidence.length,'Each split child needs its complete reviewed HTML, evidence, and completed-point rationale');
   assert(!/<(?:sup|i)\b[^>]*class=["'][^"']*footnote/i.test(child.newInnerHtml),'A split child cannot nest another source block');
   const target=child.target,note=structuredClone(child.note);assert(target&&note,'Each split child needs its explicit target and native note');
   assert(target.sectionId===undefined||target.sectionId===item.sectionId,'Cross-section split placements are forbidden');
   assert(editable(item.sectionId),'Sections 14 and 15 are excluded from marker changes');
   const section=sections.find(s=>s.id===item.sectionId),targetParagraph=target.paragraph1??item.paragraph1,row=paragraph(section,targetParagraph);
   assert(Number.isInteger(target.pairIndex0)&&target.pairIndex0>=0&&row.p[target.pairIndex0],'The split Hebrew target phrase is missing');
   const he=markerPlain(withoutNotes(row.p[target.pairIndex0][0]));assert(Number.isInteger(target.heCharOffset)&&target.heCharOffset>0&&target.heCharOffset<=he.length&&target.heAnchorPrefix===he.slice(0,target.heCharOffset),'The split Hebrew prefix or character offset differs');
   assert(typeof note.sourceId==='string'&&note.sourceId.trim()&&typeof note.placementId==='string'&&note.placementId.trim(),'Split child identities must be stable');
   const native=sections.flatMap(s=>s.after.flatMap(r=>r.footnotes||[]));
   assert(!childIds.has(note.sourceId)&&!native.some(n=>n.sourceId===note.sourceId),'Duplicate split source identity');childIds.add(note.sourceId);
   assert(!placementIds.has(note.placementId)&&!native.some(n=>n.placementId===note.placementId),'Duplicate split placement identity');placementIds.add(note.placementId);
   assert((Number.isInteger(note.number)&&note.number>0)||(typeof note.number==='string'&&/^[1-9]\d*[a-z]+$/.test(note.number)),'A split child needs a positive number or an explicit legacy suffix');
   const sectionNative=section.after.flatMap(r=>r.footnotes||[]);assert(!numbers.has(String(note.number))&&!sectionNative.some(n=>String(n.number)===String(note.number)),'Duplicate split child number');numbers.add(String(note.number));
   const position=[targetParagraph,target.pairIndex0,target.heCharOffset].join(':');assert(!positions.has(position),'Split children need distinct reviewed targets');positions.add(position);
   assert.equal(note.phraseIndex,target.pairIndex0);assert.equal(note.heCharOffset,target.heCharOffset);assert.equal(note.heAnchorPrefix,target.heAnchorPrefix);assert(note.enCharOffset===undefined&&note.enAnchorPrefix===undefined,'Split source markers must occur in Hebrew only');
   const reviewedText=markerPlain(child.newInnerHtml);
   assert(Array.isArray(note.paragraphs)&&note.paragraphs.length&&note.paragraphs.every(p=>p.language==='en'&&typeof p.text==='string'),'A split child needs its full English source text');
   assert.equal(note.paragraphs.map(p=>p.text).join('\n'),reviewedText,'A split child lost or truncated its reviewed replacement quotation');
   for(const p of note.paragraphs)if(p.rich!==undefined){assert(Array.isArray(p.rich)&&p.rich.every(run=>typeof run.text==='string'));assert.equal(p.rich.map(run=>run.text).join(''),p.text,'Split rich source runs differ from its full text');}
   const reviewedItem={...item,text:reviewedText,sourceTargets:sourceTargets(child.newInnerHtml)};
   validateSources(reviewedItem,note,{verifiedSourceTargets:child.verifiedSourceTargets||[]});
   note.legacyNumber=Number(item.number);
   note.splitProvenance={originalNoteKey:item.noteKey,originalBlockSha256:item.rawSha256,replacementInnerHtmlSha256:sha(child.newInnerHtml),reviewer:provenance.reviewer,childIndex,childCount:op.replacementNotes.length};
   validated.push({row,note,target:{paragraph1:targetParagraph,pairIndex0:target.pairIndex0,heCharOffset:target.heCharOffset,heAnchorPrefix:target.heAnchorPrefix},child});
  }
  // Reuse the ordinary move's exact source/author guards, then replace only its temporary native popup.
  const first=validated[0],temporary={...structuredClone(first.note),sourceId:first.note.sourceId+'__split_guard',placementId:first.note.placementId+'__split_guard',number:Number(item.number),paragraphs:[{language:'en',text:item.text}],sources:item.sourceTargets.map(t=>t.url?{...t}:{...t,citationOnly:true})};
  const guarded=applySingleReviewedMarkerPlacements(sections,[{...op,decision:undefined,target:first.target,note:temporary,placementRationale:first.child.placementRationale}]);sections=guarded.sections;
  const temporaryRow=paragraph(sections.find(s=>s.id===item.sectionId),first.target.paragraph1);temporaryRow.footnotes=temporaryRow.footnotes.filter(n=>n.placementId!==temporary.placementId);
  for(const child of validated){const row=paragraph(sections.find(s=>s.id===item.sectionId),child.target.paragraph1);(row.footnotes??=[]).push(child.note);audit.push({operationIndex,decision:'split',source:structuredClone(op.source),target:child.target,sourceBlockSha256:item.rawSha256,nativeSourceId:child.note.sourceId,nativePlacementId:child.note.placementId,number:child.note.number,legacyNumber:Number(item.number),fullSourceTextSha256:sha(child.note.paragraphs.map(p=>p.text).join('\n')),authorTextPreserved:true,reason:op.reason,placementRationale:child.child.placementRationale,evidence:structuredClone(child.child.evidence),replacementProvenance:structuredClone(provenance),splitProvenance:child.note.splitProvenance});}
  expectedChildren+=validated.length;
 }
 assert.equal(inventoryInlineNotes(sections).length,originalInlineCount-operations.length,'Reviewed operations lost or duplicated legacy source blocks');
 assert.equal(sections.flatMap(s=>s.after.flatMap(row=>row.footnotes||[])).length,originalNativeCount+expectedChildren,'Reviewed operations lost or duplicated native children');
 return {sections,audit};
}

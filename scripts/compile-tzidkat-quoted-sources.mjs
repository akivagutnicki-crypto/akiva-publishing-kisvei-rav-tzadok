// Compile accepted editorial records into exact, reversible reader operations.
// This script does not choose passages or translate sources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {RELEASE, PACK, SLUG, sha, digest, body, plain, applyInlineCorrections, applyOperations, readPack} from './publish-tzidkat-quoted-sources.mjs';
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const input=option('--input'); assert(input,'Pass --input with the accepted editorial JSON');
const library=path.resolve(option('--baseline') || '.local-baseline/library');
const output=path.resolve(option('--out') || PACK),pdfRoot=path.resolve(option('--pdf-root') || '../upload');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const accepted=read(input),records=Array.isArray(accepted)?accepted:accepted.records;
assert(Array.isArray(records) && records.length,'No accepted quotation records');
const toc=read(path.join(library,'data',SLUG,'toc.json'));
const bySection=new Map(toc.toc.children.map(leaf=>[leaf.ref,leaf]));
const originals=new Map(toc.toc.children.map(leaf=>{
  const file=`data/${SLUG}/${leaf.id}.json`,bytes=fs.readFileSync(path.join(library,file));
  return [file,{bytes,rows:JSON.parse(bytes)}];
}));
const nativeNotes=[...originals.values()].flatMap(value=>value.rows).flatMap(row=>row.footnotes || []);
assert.equal(new Set(nativeNotes.map(note=>note.number)).size,nativeNotes.length,'Baseline native numbers collide');
const maximumNativeNumber=Math.max(...nativeNotes.map(note=>note.number));
const catalog=read(path.join(library,'connected-ideas/catalog.json')),connectionNotes=[];
for (const record of catalog.records) {
  if (record.originRef.startsWith('Tzidkat HaTzadik ') && record.footnoteNumber)
    connectionNotes.push({id:record.id,field:'footnoteNumber',number:record.footnoteNumber,originRef:record.originRef,targetRef:record.targetRef});
  if (record.targetRef.startsWith('Tzidkat HaTzadik ') && record.reverseFootnoteNumber)
    connectionNotes.push({id:record.id,field:'reverseFootnoteNumber',number:record.reverseFootnoteNumber,originRef:record.targetRef,targetRef:record.originRef});
}
connectionNotes.sort((a,b)=>a.number-b.number);
const maximumExistingNumber=Math.max(maximumNativeNumber,...connectionNotes.map(note=>note.number));
let nextNumber=maximumExistingNumber;
const numbering={maximumNativeNumber,maximumExistingNumber,connectionNotes,
  connectionCatalogSha256:sha(fs.readFileSync(path.join(library,'connected-ideas/catalog.json')))};

function anchorLocation(row, record) {
  const anchor=record.hebrewAnchor || record.anchor;
  assert(typeof anchor==='string' && /[א-ת]{2}/.test(anchor.replace(/[\u0591-\u05c7]/g,'')),'An exact Hebrew anchor is required: '+record.id);
  const normalized=plain(anchor).replace(/[^א-ת]/g,''),positions=[];
  let paragraph='';
  for (const [phraseIndex,pair] of row.p.entries()) {
    if (Number.isSafeInteger(record.phraseIndex) && phraseIndex!==record.phraseIndex) continue;
    const text=plain(pair[0]);
    for (let index=0;index<text.length;index++) if (/[א-ת]/.test(text[index])) {
      paragraph+=text[index]; positions.push({phraseIndex,index});
    }
  }
  const matches=[];let at=-1;
  while ((at=paragraph.indexOf(normalized,at+1))>=0) matches.push(at);
  assert(matches.length,'Anchor absent from reader: '+record.id+' '+anchor);
  const occurrence=record.anchorOccurrence;
  if (matches.length>1) assert(Number.isSafeInteger(occurrence) && occurrence>=1 && occurrence<=matches.length,'Anchor is ambiguous: '+record.id);
  const end=positions[matches[(occurrence || 1)-1]+normalized.length-1],text=plain(row.p[end.phraseIndex][0]);
  let offset=end.index+1;
  while (offset<text.length && /[\p{M}״׳'".,;:!?…\u200b-\u200f]/u.test(text[offset])) offset++;
  const en=plain(row.p[end.phraseIndex][1]),prefix=text.slice(0,offset);
  return {phraseIndex:end.phraseIndex,heCharOffset:offset,enCharOffset:en.length,
    heAnchorPrefix:prefix,enAnchorPrefix:en,heWord:prefix.trim().split(/\s+/).length-1};
}

const operations=[],ids=new Set();
for (const record of [...records].sort((a,b)=>Number(a.sectionRef.match(/\d+$/)?.[0])-Number(b.sectionRef.match(/\d+$/)?.[0]) || a.paragraph-b.paragraph || a.id.localeCompare(b.id))) {
  assert(record.reviewed===true,'Unreviewed editorial record: '+record.id);
  assert(record.id && !ids.has(record.id),'Missing or repeated editorial id');ids.add(record.id);
  const leaf=bySection.get(record.sectionRef);assert(leaf && leaf.id!==73,'Invalid or missing siman: '+record.sectionRef);
  const filename=`data/${SLUG}/${leaf.id}.json`,original=originals.get(filename).rows;
  const row=original.find(row=>row.p && row.n===record.paragraph);assert(row,'Paragraph absent: '+record.id);
  const notes=row.footnotes || [],action=record.action || 'add';
  const beforeIndex=notes.findIndex(note=>note.placementId===record.existingPlacementId),before=beforeIndex<0?null:notes[beforeIndex];
  if (action!=='add') assert(before,'Existing note does not match the reviewed paragraph: '+record.id);
  else assert(!record.existingPlacementId,'An addition must not name a predecessor');
  const sourceEvidence=record.sourceEvidence || (record.pdf && record.page ? [{pdf:record.pdf,page:record.page}] : []);
  const op={action,editorialId:record.id,placementId:before?.placementId || `TZQ-${record.id}-1`,
    originRef:record.sectionRef+':'+record.paragraph,sectionRef:record.sectionRef,paragraph:record.paragraph,path:filename,
    reviewed:true,reason:record.reason,dedupReviewed:record.dedupReviewed===true,dedupReason:record.dedupReason,
    sourceEvidence,before,beforeNoteIndex:beforeIndex,beforeHadFootnotes:Object.hasOwn(row,'footnotes'),after:null};
  if (record.inlineCorrections?.length) op.inlineCorrections=structuredClone(record.inlineCorrections);
  if (action!=='remove') {
    const quote=structuredClone(record.quotation); assert(quote?.ref && quote.he && quote.en,'Missing selected source text: '+record.id);
    if (!quote.url) delete quote.url; if (quote.citation===quote.ref) delete quote.citation;
    const citation=quote.citation || quote.ref,text=`${citation}: “${quote.en}”`,number=before?.number || ++nextNumber;
    op.quotation=quote;op.requestedHebrewAnchor=record.hebrewAnchor || record.anchor;
    const anchorRow=op.inlineCorrections ? applyInlineCorrections([row],[op])[0] : row;
    op.after={number,sourceId:before?.sourceId || `TZQ-${record.id}`,placementId:op.placementId,...anchorLocation(anchorRow,record),
      quotationOnly:true,verificationStatus:'verified',paragraphs:[{language:'en',text,
        rich:[{text:citation,bold:true,...(quote.url?{href:quote.url}:{})},{text:': “'+quote.en+'”'}]}],
      sources:[{ref:quote.ref,...(quote.url?{url:quote.url}:{}),...(quote.citation?{citation:quote.citation}:{}),role:'primary-source'}],nativeConnections:[],
      reviewedSourceExcerpt:{schemaVersion:1,ref:quote.ref,he:quote.he,en:quote.en,...(quote.citation?{citation:quote.citation}:{}),
        coverage:'excerpt',provenance:'Akiva Publishing · Original English translation checked against the quoted Hebrew or Aramaic source.'},
      provenance:{edition:'Akiva Publishing · quotations from the supplied Tzidkat source editions',quotedSourceRelease:RELEASE,
        sourceId:before?.sourceId || `TZQ-${record.id}`,section:record.sectionRef,sourceFile:`${leaf.id}.json`,item:record.paragraph,
        originalEnglishTranslation:true,sourceEvidence,editorialId:record.id}};
  }
  operations.push(op);
}
const files=[];
for (const filename of [...new Set(operations.map(operation=>operation.path))].sort((a,b)=>Number(a.match(/\/(\d+)\.json$/)[1])-Number(b.match(/\/(\d+)\.json$/)[1]))) {
  const original=originals.get(filename),updated=applyOperations(original.rows,operations.filter(operation=>operation.path===filename));
  files.push({path:filename,beforeSha256:sha(original.bytes),afterSha256:sha(JSON.stringify(updated)),
    bodySha256:digest(body(original.rows)),beforeObjectSha256:digest(original.rows)});
}
const selectedPDFs=accepted.sourcePDFs?.map(item=>typeof item==='string'?item:item.filename) || fs.readdirSync(pdfRoot).filter(file=>file.toLowerCase().endsWith('.pdf')).sort();
const sourcePDFs=selectedPDFs.map(filename=>{
  const file=path.join(pdfRoot,filename),expected=fs.statSync(file).size,fd=fs.openSync(file,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);
  let bytes=0;
  try { while (bytes<expected) { const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,expected-bytes),bytes); assert(count>0,'Incomplete PDF read: '+filename); hash.update(buffer.subarray(0,count)); bytes+=count; } }
  finally { fs.closeSync(fd); }
  assert.equal(bytes,expected,'PDF byte count mismatch: '+filename);
  return {filename,sha256:hash.digest('hex'),bytes};
});
const counts={additions:operations.filter(operation=>operation.action==='add').length,replacements:operations.filter(operation=>operation.action==='replace').length,
  removals:operations.filter(operation=>operation.action==='remove').length,quotations:operations.filter(operation=>operation.after).length,affectedSections:files.length,
  originalNativeFootnotes:nativeNotes.length,preservedSupplementalFootnotes:connectionNotes.length};
counts.finalNativeFootnotes=nativeNotes.length+counts.additions-counts.removals;
const pack={schemaVersion:1,release:RELEASE,date:'2026-10-22',editorialScope:'All available simanim of Tzidkat HaTzadik; Siman74 is absent',
  selectionPolicy:'Only verified source quotations with original faithful English translations, exact Hebrew anchors, and no duplicate selected passages. Preserve all unrelated text, notes, and published numbers.',
  sourcePDFs,coverage:accepted.coverage,numbering,missing74Sha256:sha(originals.get(`data/${SLUG}/73.json`).bytes),
  tocSha256:sha(fs.readFileSync(path.join(library,'data',SLUG,'toc.json'))),
  baselineFiles:[...originals].map(([filename,value])=>({path:filename,sha256:sha(value.bytes)})),files,operations,counts};
fs.mkdirSync(path.dirname(output),{recursive:true});
const temporary=output+'.pending';
try {
  fs.writeFileSync(temporary,JSON.stringify(pack,null,2)+'\n');
  readPack(temporary);
  fs.renameSync(temporary,output);
} finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
console.log(JSON.stringify({ok:true,output,release:RELEASE,counts,maximumExistingNumber,firstNewNumber:counts.additions?maximumExistingNumber+1:null},null,2));

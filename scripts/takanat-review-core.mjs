import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {applyReviewedMarkerPlacements,inventoryInlineNotes,markerAuthorPlain} from './takanat-marker-placements.mjs';
export const REPO_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const RELEASE='20261026-takanat-reader-review-v1';
export const PACK='sources/akiva/overlays/takanat-reader-review-20261026.json.gz';
export const REPORT='library/takanat-reader-review-20261026.json';
export const BOOK='takanat-hashavin',TITLE='Takanat HaShavin';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const json=value=>Buffer.from(JSON.stringify(value));
export const sideOf=language=>{assert(['he','en'].includes(language));return language==='he'?0:1;};
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ', zwnj: '‌', zwj: '‍', lrm: '', rlm: '' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const tidy = s => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
export const plain = html => tidy(decode(String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')));

// Reconstruction retains the original scholarly preimage. An explicitly pinned
// successor publishes from the already-reviewed predecessor's visible rows.
export function publicationSections(pack){
 const upgrading=pack.upgradeFromPackSha256!==undefined||pack.publicationBaseSections!==undefined;
 if(!upgrading)return pack.sections;
 assert.match(pack.upgradeFromPackSha256||'',/^[a-f0-9]{64}$/,'A publication upgrade needs the exact predecessor pack hash');assert(Array.isArray(pack.publicationBaseSections)&&pack.publicationBaseSections.length===16,'A publication upgrade needs all sixteen predecessor sections');
 const excluded=pack.excludedSectionIds||[];assert(Array.isArray(excluded)&&new Set(excluded).size===excluded.length&&excluded.every(id=>Number.isInteger(id)&&id>=0&&id<16),'Invalid excluded section scope');
 return pack.sections.map((section,index)=>{const rows=pack.publicationBaseSections[index];assert(Array.isArray(rows),'Invalid predecessor section rows');const numbers=new Set();for(const row of rows){assert(row&&typeof row==='object'&&(typeof row.h==='string'||Array.isArray(row.p)),'Invalid predecessor row');if(row.p){assert(Number.isInteger(row.n)&&row.n>0&&!numbers.has(row.n),'Invalid predecessor paragraph identity');numbers.add(row.n);for(const pair of row.p)assert(Array.isArray(pair)&&pair.length===2&&pair.every(s=>typeof s==='string'),'Invalid predecessor phrase pair');}}if(excluded.includes(section.id))assert.deepEqual(section.after,rows,'An excluded published section changed');return{...section,before:rows};});
}

// Citations are marked <a data-ref="Berakhot 6b">…</a>; returns each ref with its offset in the plain text.
export function anchorsOf(html) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g)) {
    out.push({ ref: decode(m[1]), at: plain(html.slice(0, m.index)).length });
  }
  return out;
}

// Footnotes are written inline: <sup class="footnote-marker">N</sup><i class="footnote">…</i>, and the note
// itself may contain <i>…</i>. Returns the text without the notes and each note with its character offset,
// plus the citations marked in the text and in each note.
export function splitNotes(html) {
  const s = String(html ?? '');
  const notes = [];
  let out = '', i = 0;
  const MARK = /<sup class="footnote-marker">([^<]*)<\/sup>\s*<i class="footnote">/g;
  for (let m; (m = MARK.exec(s)); ) {
    out += s.slice(i, m.index);
    let depth = 1, j = MARK.lastIndex;
    const TAG = /<(\/?)i\b[^>]*>/g;
    TAG.lastIndex = j;
    let end = s.length, closeEnd = s.length;
    for (let t; (t = TAG.exec(s)); ) {
      depth += t[1] ? -1 : 1;
      if (!depth) { end = t.index; closeEnd = TAG.lastIndex; break; }
    }
    notes.push({ n: plain(m[1]), html: s.slice(j, end), raw: out.length });
    i = closeEnd;
    MARK.lastIndex = closeEnd;
  }
  out += s.slice(i);
  // Offsets are measured in the plain text before the marker, after cleanup.
  const text = plain(out);
  return {
    text,
    anchors: anchorsOf(out),
    notes: notes.map(x => ({ n: x.n, text: plain(x.html), at: Math.min(plain(out.slice(0, x.raw)).length, text.length), anchors: anchorsOf(x.html).map(a => a.ref) })),
  };
}

// First place each cited ref is marked in a paragraph: [phrase index or -1, 'h'|'e', offset] in the text,
// or ['n', note number] in a note.
function citationPlaces(parts) {
  const a = {};
  for (const { k, side, split } of parts) for (const x of split.anchors) if (!a[x.ref]) a[x.ref] = [k, side, x.at];
  for (const { split } of parts) for (const n of split.notes) for (const ref of n.anchors) if (!a[ref]) a[ref] = ['n', n.n];
  return Object.keys(a).length ? a : null;
}


export function footnoteBlocks(value){
 const s=String(value),out=[];const mark=/<sup class="footnote-marker">([^<]*)<\/sup>\s*<i class="footnote">/g;
 for(let m;(m=mark.exec(s));){let depth=1,end=s.length;const tag=/<(\/?)i\b[^>]*>/g;tag.lastIndex=mark.lastIndex;for(let t;(t=tag.exec(s));){depth+=t[1]?-1:1;if(!depth){end=tag.lastIndex;break;}}assert(!depth,'Unclosed inline source note');out.push({start:m.index,end,raw:s.slice(m.index,end),number:plain(m[1])});mark.lastIndex=end;}return out;
}
// Materialize only the dynamic notes already displayed by the published
// connection catalog. Their full popup is preserved; the reviewed Hebrew
// endpoint replaces the catalog's approximate start-phrase placement.
export function applyReviewedDynamicMarkers(inputSections,operations=[]){
 const sections=structuredClone(inputSections),used=new Set();
 for(const op of operations){
  assert(op.reviewed===true&&op.sectionId>=0&&op.sectionId<=13&&op.placementRationale&&Array.isArray(op.evidence)&&op.evidence.length,'A dynamic marker needs an in-scope scholarly placement review');
  assert(op.connectionIdeaId&&!used.has(op.connectionIdeaId),'Duplicate dynamic source marker');used.add(op.connectionIdeaId);
  const prior=op.priorNativeNote,note=structuredClone(op.note),target=op.target;assert(prior&&note&&target);assert.equal(sha(json(prior)),op.priorNativeNoteSha256,'The published dynamic popup preimage differs');assert.equal(prior.connectionIdeaId,op.connectionIdeaId);assert.equal(note.connectionIdeaId,op.connectionIdeaId);
  const section=sections.find(s=>s.id===op.sectionId),row=section?.after.find(r=>r.p&&r.n===target.paragraph1),he=splitNotes(row?.p[target.pairIndex0]?.[0]).text;
  assert(row&&he&&Number.isInteger(target.heCharOffset)&&target.heCharOffset>0&&target.heCharOffset<=he.length&&he.slice(0,target.heCharOffset)===target.heAnchorPrefix,'The dynamic marker exact Hebrew prefix differs');
  assert.equal(note.phraseIndex,target.pairIndex0);assert.equal(note.heCharOffset,target.heCharOffset);assert.equal(note.heAnchorPrefix,target.heAnchorPrefix);assert(note.enCharOffset===undefined&&note.enAnchorPrefix===undefined,'Dynamic markers must occur only in Hebrew');
  let expected=prior;if(op.formattingRevision){const revision=op.formattingRevision;assert(revision.reviewed===true&&revision.policy==='english-plain-hebrew-parentheses'&&revision.reason&&Array.isArray(revision.evidence)&&revision.evidence.length,'Unreviewed dynamic source formatting');assert.equal(revision.beforePopupSha256,sha(json(prior)),'Dynamic formatting original popup differs');expected=formatDynamicPopup(prior);assert.equal(revision.formattedPopupSha256,sha(json(expected)),'Dynamic formatting replacement differs');}
  const placementOnly=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['phraseIndex','heCharOffset','heAnchorPrefix','paragraphOrder'].includes(key)));assert.deepEqual(placementOnly(note),placementOnly(expected),'Dynamic marker placement changed its full published popup');
  assert.equal(note.originRef,section.sectionRef+(section.id?':':' ')+row.n,'Dynamic marker moved to an unrelated paragraph');
  const existing=sections.flatMap(s=>s.after.flatMap(r=>r.footnotes||[]));assert(!existing.some(n=>n.placementId===note.placementId||n.sourceId===note.sourceId||n.connectionIdeaId===note.connectionIdeaId),'Dynamic source note is already materialized');
  (row.footnotes??=[]).push(note);
 }
 return sections;
}
export function formatDynamicPopup(value){const note=structuredClone(value);for(const p of note.paragraphs||[]){const normalize=text=>p.language==='he'?String(text).replace(/\[/g,'(').replace(/\]/g,')'):String(text).replace(/[\[\]]/g,'');p.text=normalize(p.text);for(const run of p.rich||[])run.text=normalize(run.text);}return note;}
export function normalizeBrackets(value,side){
 // Only text nodes change; source-reference attributes and hyperlinks stay intact.
 return String(value).split(/(<[^>]*>)/g).map(part=>part.startsWith('<')?part:side===0?part.replace(/\[/g,'(').replace(/\]/g,')'):part.replace(/[\[\]]/g,'')).join('');
}
// A second, fully pinned review is applied to the restored reader corpus. Its
// coordinates describe that corpus; the historical reconstruction stays intact.
export function applyAuditBodyPatches(inputSections,operations=[]){
 const sections=structuredClone(inputSections),edits=new Map();
 for(const op of operations){reason(op);assert(op.reviewed===true&&op.auditId&&op.sectionId>=0&&op.sectionId<=13,'Unreviewed or excluded audit body correction');const row=para(inputSections,op.sectionId,op.paragraph1),side=sideOf(op.language),raw=row.p[op.pairIndex0]?.[side];assert(typeof raw==='string');assert.equal(sha(raw),op.cellSha256,'Audited body cell preimage differs');const edit=authorFragmentEdit(raw,op),key=[op.sectionId,op.paragraph1,op.pairIndex0,side].join('|'),list=edits.get(key)||[];list.push(edit);edits.set(key,list);}
 for(const[key,list]of edits){const[id,n,k,side]=key.split('|').map(Number),row=para(sections,id,n);list.sort((a,b)=>b.start-a.start);for(let i=1;i<list.length;i++)assert(list[i-1].start>=list[i].end,'Audited body corrections overlap');for(const edit of list)row.p[k][side]=row.p[k][side].slice(0,edit.start)+edit.newValue+row.p[k][side].slice(edit.end);}
 return sections;
}
export function applyAuditedSourceOperations(inputSections,operations=[]){
 const sections=structuredClone(inputSections),inventory=inventoryInlineNotes(inputSections),used=new Set();
 for(const op of operations){reason(op);assert(op.reviewed===true&&op.noteKey&&!used.has(op.noteKey),'Duplicate or unreviewed source-content audit');used.add(op.noteKey);const item=inventory.find(n=>n.noteKey===op.noteKey);assert(item&&item.editable,'Audited source block is missing or excluded');assert.deepEqual(op.source,{sectionId:item.sectionId,paragraph1:item.paragraph1,pairIndex0:item.pairIndex0,language:item.language,number:item.number},'Audited source coordinates differ');assert.equal(op.sourceBlockHtml,item.raw);assert.equal(op.sourceBlockSha256,item.rawSha256);assert(['repair','remove'].includes(op.action));const row=para(sections,item.sectionId,item.paragraph1),side=sideOf(item.language),raw=row.p[item.pairIndex0][side];assert.equal(raw.split(item.raw).length,2,'Audited source block must occur exactly once');let replacement='';
  if(op.action==='repair'){assert(typeof op.newInnerHtml==='string'&&op.newInnerHtml.trim()&&op.newInnerHtml!==item.innerHtml,'An audited replacement needs complete changed source HTML');assert(!/<(?:sup|i)\b[^>]*class=["'][^"']*footnote/i.test(op.newInnerHtml),'An audited replacement nests a source note');assert.equal(sha(op.newInnerHtml),op.newInnerHtmlSha256,'Audited source replacement hash differs');const at=item.raw.indexOf(item.innerHtml);assert(at>=0);replacement=item.raw.slice(0,at)+op.newInnerHtml+item.raw.slice(at+item.innerHtml.length);}else assert.equal(op.removalBasis,'reviewed-inaccuracy-irrelevance-or-duplication','Source availability alone cannot authorize removal');
  row.p[item.pairIndex0][side]=raw.replace(item.raw,replacement);assert.equal(splitNotes(raw).text,splitNotes(row.p[item.pairIndex0][side]).text,'A source-content audit changed author text');
 }
 return sections;
}
export function applyAuditBodyLinks(inputSections,operations=[]){
 const sections=structuredClone(inputSections),used=new Set();for(const op of operations){reason(op);assert(op.reviewed===true&&op.auditId&&!used.has(op.auditId)&&op.sectionId>=0&&op.sectionId<=13,'Unreviewed, duplicate, or excluded author citation repair');used.add(op.auditId);safeHref(op.url);const row=para(sections,op.sectionId,op.paragraph1),side=sideOf(op.language),raw=row.p[op.pairIndex0]?.[side];assert.equal(sha(raw),op.cellSha256,'Audited author citation cell differs');const blocks=footnoteBlocks(raw),matches=[...raw.matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g)].filter(m=>decode(m[1])===op.fromRef&&!blocks.some(b=>m.index>=b.start&&m.index<b.end));assert.equal(matches.length,1,'Audited author citation must occur once outside source notes');const m=matches[0],end=raw.indexOf('</a>',m.index+m[0].length);assert(end>=0&&plain(raw.slice(m.index+m[0].length,end))===op.newVisibleText,'Audited author citation label differs');let tag=m[0].replace(/\bdata-ref="[^"]+"/,'data-ref="'+op.toRef.replace(/"/g,'&quot;')+'"').replace(/\s+href="[^"]*"/g,'');tag=tag.slice(0,-1)+' href="'+safeHref(op.url)+'">';const next=raw.slice(0,m.index)+tag+raw.slice(m.index+m[0].length);assert.equal(authorTextMap(next).text,authorTextMap(raw).text,'An author citation repair changed visible words');assert.deepEqual(footnoteBlocks(next).map(n=>n.raw),blocks.map(n=>n.raw),'An author citation repair changed source notes');row.p[op.pairIndex0][side]=next;}return sections;
}
export function applyAuditBodyCitationPatches(inputSections,operations=[]){
 const sections=structuredClone(inputSections),edits=new Map(),used=new Set();for(const op of operations){reason(op);assert(op.reviewed===true&&op.auditId&&!used.has(op.auditId)&&op.sectionId>=0&&op.sectionId<=13,'Unreviewed, duplicate, or excluded author source anchor');used.add(op.auditId);const row=para(inputSections,op.sectionId,op.paragraph1),pair=row.p[op.pairIndex0];assert(pair,'Author source anchor phrase missing');assert.equal(pair[0],op.pairPreimages.he,'Author source anchor Hebrew context differs');assert.equal(pair[1],op.pairPreimages.en,'Author source anchor English context differs');assert.equal(sha(pair[0]),op.pairPreimages.heSha256);assert.equal(sha(pair[1]),op.pairPreimages.enSha256);const side=sideOf(op.language),raw=pair[side];assert.equal(sha(raw),op.cellSha256,'Author source anchor cell differs');assert(op.old&&op.new&&op.canonicalRef&&op.new.includes('data-ref="'+op.canonicalRef+'"'),'Author source anchor needs its exact canonical target');assert(!/<(?:script|iframe|style)\b|\bon\w+\s*=|javascript:/i.test(op.new),'Unsafe author source anchor HTML');const blocks=footnoteBlocks(raw),hits=[];for(let at=0;(at=raw.indexOf(op.old,at))>=0;at+=op.old.length)if(!blocks.some(b=>at<b.end&&at+op.old.length>b.start))hits.push(at);assert.equal(hits.length,1,'Author source anchor fragment must occur once outside notes');const key=[op.sectionId,op.paragraph1,op.pairIndex0,side].join('|'),list=edits.get(key)||[];list.push({start:hits[0],end:hits[0]+op.old.length,newValue:op.new});edits.set(key,list);}
 for(const[key,list]of edits){const[id,n,k,side]=key.split('|').map(Number),row=para(sections,id,n),raw=row.p[k][side];list.sort((a,b)=>b.start-a.start);for(let i=1;i<list.length;i++)assert(list[i-1].start>=list[i].end,'Author source anchors overlap');let next=raw;for(const op of list)next=next.slice(0,op.start)+op.newValue+next.slice(op.end);assert.equal(authorTextMap(next).text,authorTextMap(raw).text,'An author source anchor changed visible wording');assert.deepEqual(footnoteBlocks(next).map(n=>n.raw),footnoteBlocks(raw).map(n=>n.raw),'An author source anchor changed a source note');row.p[k][side]=next;}for(const section of inputSections)for(const row of section.after.filter(r=>r.p))assert.equal(JSON.stringify(para(sections,section.id,row.n).footnotes||[]),JSON.stringify(row.footnotes||[]),'An author source anchor changed a native source popup');return sections;
}
const reason=op=>assert(typeof op.reason==='string'&&op.reason.trim()&&Array.isArray(op.evidence)&&op.evidence.length,'Every content operation requires a reviewed reason and source evidence');
const para=(sections,id,n)=>{const s=sections.find(x=>x.id===id);assert(s,'Unknown section');const row=s.after.find(x=>x.n===n&&x.p);assert(row,'Unknown stable paragraph number');return row;};
function normalizedNoteText(value,side){return splitNotes(normalizeBrackets(value,side)).notes.map(n=>[n.n,n.text]);}
function authorTextMap(value){
 const blocks=footnoteBlocks(value),chars=[],positions=[];let node=0;
 const parts=String(value).split(/(<[^>]*>)/g);let cursor=0;
 for(const part of parts){const start=cursor;cursor+=part.length;if(part.startsWith('<'))continue;node++;for(let k=0;k<part.length;){const at=start+k;if(blocks.some(b=>at>=b.start&&at<b.end)){k++;continue;}const entity=part.slice(k).match(/^&(?:#x[0-9a-f]+|#\d+|[a-z]+);/i),raw=entity?.[0]||part[k],text=entity?decode(raw):raw;for(const ch of text){chars.push(ch);positions.push({start:at,end:at+raw.length,node});}k+=raw.length;}}
 return{text:chars.join(''),positions};
}
function styledReplacement(value,at,oldText,newText,map){
 const old=[...oldText],next=[...newText],m=old.length,n=next.length,table=Array.from({length:m+1},()=>new Uint16Array(n+1));
 for(let i=m-1;i>=0;i--)for(let j=n-1;j>=0;j--)table[i][j]=old[i]===next[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
 const assigned=new Map();const put=(index,ch)=>{const p=map.positions[at+Math.min(index,m-1)],list=assigned.get(p.node)||[];list.push(ch);assigned.set(p.node,list);};let i=0,j=0;
 while(i<m||j<n){if(i<m&&j<n&&old[i]===next[j]){put(i,next[j]);i++;j++;}else if(j<n&&(i===m||table[i][j+1]>=table[i+1][j])){put(i,next[j]);j++;}else i++;}
 const covered=new Map();for(let k=at;k<at+m;k++){const p=map.positions[k],range=covered.get(p.node)||{start:p.start,end:p.end};range.end=p.end;covered.set(p.node,range);}
 let raw=value;for(const[node,range]of[...covered].sort((a,b)=>b[1].start-a[1].start)){const text=(assigned.get(node)||[]).join('').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');raw=raw.slice(0,range.start)+text+raw.slice(range.end);}
 const start=map.positions[at].start,end=map.positions[at+m-1].end;const delta=raw.length-value.length;return{start,end,newValue:raw.slice(start,end+delta)};
}
function authorFragmentEdit(value,op){
 reason(op);assert(op.old&&typeof op.new==='string');const blocks=footnoteBlocks(value),tags=[...value.matchAll(/<[^>]*>/g)].map(m=>[m.index,m.index+m[0].length]);const hits=[];
 for(let at=0;(at=value.indexOf(op.old,at))>=0;at+=op.old.length){const end=at+op.old.length;if(!blocks.some(b=>at<b.end&&end>b.start)&&!tags.some(([a,b])=>at>=a&&at<b))hits.push(at);}
 let edit;if(hits.length===1){const i=hits[0];edit={start:i,end:i+op.old.length,newValue:op.new};}else{
  const map=authorTextMap(value);const at=map.text.indexOf(op.old);assert(at>=0&&map.text.indexOf(op.old,at+1)<0,'Reviewed author fragment must occur exactly once outside source notes');edit=styledReplacement(value,at,op.old,op.new,map);
 }
 const next=value.slice(0,edit.start)+edit.newValue+value.slice(edit.end);assert.deepEqual(footnoteBlocks(next).map(n=>n.raw),blocks.map(n=>n.raw),'An author correction changed inline source notes');assert.equal(authorTextMap(next).text,authorTextMap(value).text.replace(op.old,op.new),'HTML-preserving author correction changed unreviewed words');return{...edit,op,kind:'body'};
}
function assertBoundary(base,index,before,after){
 assert(typeof before==='string'&&typeof after==='string','Insertion requires exact neighboring Hebrew anchors');
 const left=index?splitNotes(base[index-1][0]).text:'',right=index<base.length?splitNotes(base[index][0]).text:'';
 assert(index?before&&left.endsWith(before):before==='','Pre-insertion Hebrew boundary changed');assert(index<base.length?after&&right.startsWith(after):after==='','Post-insertion Hebrew boundary changed');
}
function safeHref(url){assert(/^https:\/\/www\.sefaria\.org\//.test(url),'Only verified Sefaria HTTPS URLs may be inserted');return url.replace(/&/g,'&amp;').replace(/"/g,'&quot;');}
function editLinks(sections,operations){
 for(const op of operations){reason(op);assert(op.fromRef&&op.toRef);safeHref(op.url);let count=0;
  for(const section of sections){if(op.sectionId!==undefined&&section.id!==op.sectionId)continue;for(const row of section.after){if(!row.p||(op.paragraph1!==undefined&&row.n!==op.paragraph1))continue;row.p=row.p.map((pair,k)=>pair.map((value,side)=>{if(op.pairIndex0!==undefined&&op.pairIndex0!==k||op.language&&side!==sideOf(op.language))return value;return value.replace(/<a\b([^>]*\bdata-ref="([^"]+)"[^>]*)>/g,(all,attrs,ref)=>{if(decode(ref)!==op.fromRef)return all;count++;let next=attrs.replace(/\bdata-ref="[^"]+"/,'data-ref="'+op.toRef.replace(/"/g,'&quot;')+'"').replace(/\s+href="[^"]*"/g,'');if(op.readerRef){next=next.replace(/\s+data-reader-ref="[^"]*"/g,'')+' data-reader-ref="'+op.readerRef.replace(/"/g,'&quot;')+'"';}return '<a'+next+' href="'+safeHref(op.url)+'">';});}));}}
  assert.equal(count,op.expectedOccurrences??1,'Reviewed source-link occurrence count changed: '+op.fromRef);
 }
}
function assertFootnotesRetained(oldPairs,newPairs,op){
 let old=oldPairs.flatMap(pair=>pair.flatMap((value,side)=>footnoteBlocks(value).map(n=>[n.number,n.raw]))),next=newPairs.flatMap(pair=>pair.flatMap((value,side)=>footnoteBlocks(value).map(n=>[n.number,n.raw])));
 const pool=next.map(x=>JSON.stringify(x));
 for(const repair of op.modifiedInlineNotes||[]){assert(repair.sectionId===10&&repair.paragraph1===31&&repair.number===247&&repair.reason,'Unreviewed inline source correction');const at=old.findIndex(x=>x[0]==='247'&&x[1]===repair.oldBlock);assert(at>=0,'Original note247 differs');old.splice(at,1);const nextAt=pool.indexOf(JSON.stringify(['247',repair.newBlock]));assert(nextAt>=0,'Corrected note247 is missing');pool.splice(nextAt,1);}
 for(const move of op.movedOut||[]){const at=old.findIndex(x=>x[0]===String(move.number)&&x[1]===move.oldBlock);assert(at>=0,'Moved source note original differs');old.splice(at,1);}
 for(const move of op.movedIn||[]){const at=pool.indexOf(JSON.stringify([String(move.number),move.oldBlock]));assert(at>=0,'Moved source note destination differs');pool.splice(at,1);}
 for(const group of op.editorialNoteGroups||[]){reason(group);assert(group.editorialRelatedSource===true&&JSON.stringify(group.oldNumbers)==='[249,250]'&&group.number===249&&group.sectionId===10&&group.paragraph1===31,'Unreviewed source-note regrouping');assert(group.newBlock.includes('data-editorial-related-source="true"')&&group.newBlock.includes('Related Gemara passages (editorial)')&&group.newBlock.includes('data-merged-note-numbers="249,250"'),'Editorial source group is not clearly labeled');assert.equal(group.oldBlocks.length,2);for(let i=0;i<2;i++){const block=group.oldBlocks[i],at=old.findIndex(x=>x[0]===String(group.oldNumbers[i])&&x[1]===block);assert(at>=0,'Editorial group original block differs');const marker='<i class="footnote">',begin=block.indexOf(marker);assert(begin>=0&&block.endsWith('</i>'));let inner=block.slice(begin+marker.length,-4);const repair=(op.sourceNoteRepairs||[]).find(r=>r.number===group.oldNumbers[i]);if(repair){assert.equal(sha(inner),repair.oldInnerSha256);assert.equal(sha(repair.newInnerHtml),repair.newInnerSha256);assert.equal(inner.split(repair.exactOld).length,2);assert.equal(inner.replace(repair.exactOld,repair.exactNew),repair.newInnerHtml);assert(repair.reason);inner=repair.newInnerHtml;}assert.equal(group.newBlock.split(inner).length,2,'Editorial regrouping changed or duplicated an original quotation');old.splice(at,1);}const at=pool.indexOf(JSON.stringify([String(group.number),group.newBlock]));assert(at>=0,'Reviewed editorial source group is missing');pool.splice(at,1);}
 for(const entry of old){const at=pool.indexOf(JSON.stringify(entry));assert(at>=0,'Restoration lost or changed an existing source note');pool.splice(at,1);}assert.equal(pool.length,(op.newInlineNotes||[]).length,'Every additional inserted source note requires its own provenance audit');
 for(const extra of op.newInlineNotes||[]){assert(extra.raw&&extra.reason&&extra.source);const at=pool.indexOf(JSON.stringify([extra.number,extra.raw]));assert(at>=0,'Inserted source-note audit differs');pool.splice(at,1);}assert.equal(pool.length,0);
}
export function reconstructSections(pack){
 assert.equal(pack.schemaVersion,1);assert.equal(pack.release,RELEASE);assert.equal(pack.bracketPolicy,'english-plain-hebrew-parentheses');assert.equal(pack.sections.length,16);
 const sections=pack.sections.map((s,id)=>{assert.equal(s.id,id);assert.equal(s.path,'library/data/'+BOOK+'/'+id+'.json');assert.equal(s.sectionRef,id?TITLE+' '+id:TITLE+', Introduction');return{...s,after:structuredClone(s.before)};});
 const ranges=pack.pairReplacements||[],baseSections=pack.sections.map(s=>({...s,after:s.before})),cellEdits=new Map(),sourceEdits=[];
 const keyOf=(section,n,k,side)=>[section,n,k,side].join('|');
 const addEdit=(section,n,k,side,edit)=>{const key=keyOf(section,n,k,side);const list=cellEdits.get(key)||[];list.push(edit);cellEdits.set(key,list);};
 const occurrence=(value,fragment,nth)=>{assert(fragment);let at=-1;for(let n=0;n<=nth;n++){at=value.indexOf(fragment,at+1);assert(at>=0,'Reviewed source fragment occurrence changed');}return at;};
 for(const op of pack.sourceOperations||[]){
  assert(op.reason&&op.auditId&&typeof op.oldFragment==='string'&&typeof op.newFragment==='string');const row=para(baseSections,op.section,op.paragraph),raw=row.p[op.phraseIndex]?.[op.column];assert(typeof raw==='string');assert.equal(sha(raw),op.cellSha256,'Source-review base cell differs');
  if(op.sourceURL)assert(/^(?:https:\/\/www\.sefaria\.org\/|https:\/\/akivagutnicki-crypto\.github\.io\/akiva-publishing-kisvei-rav-tzadok\/library\/#\/read\/)/.test(op.sourceURL),'Unverified source-review URL');
  if(op.textChange===false)assert.equal(plain(op.oldFragment),plain(op.newFragment),'Source-link operation changed unreviewed visible words');
  const start=occurrence(raw,op.oldFragment,op.occurrenceIndex||0),edit={start,end:start+op.oldFragment.length,newValue:op.newFragment,op,kind:'source'};
  if(op.type==='repair-misattributed-source-note'){assert(op.fullOriginalEnglishTranslation===true&&[569,739].includes(op.footnoteNumber)&&op.sourceEvidenceRef&&op.sourceURL,'Unreviewed source-note replacement');}
  addEdit(op.section,op.paragraph,op.phraseIndex,op.column,edit);Object.assign(edit,{sectionId:op.section,paragraph1:op.paragraph,pairIndex0:op.phraseIndex,side:op.column});sourceEdits.push(edit);
 }
 const superseded=new Set();
 for(const op of pack.bodyPatches||[]){
  const row=para(baseSections,op.sectionId,op.paragraph1);assert(row.p[op.pairIndex0]);const side=sideOf(op.language),raw=row.p[op.pairIndex0][side],edit=authorFragmentEdit(raw,op),rangeIndex=ranges.findIndex(r=>r.sectionId===op.sectionId&&r.paragraph1===op.paragraph1&&op.pairIndex0>=r.startPairIndex0&&op.pairIndex0<=r.endPairIndex0);
  const overlappingSources=sourceEdits.filter(e=>e.sectionId===op.sectionId&&e.paragraph1===op.paragraph1&&e.pairIndex0===op.pairIndex0&&e.side===side&&edit.start<e.end&&edit.end>e.start);let overlappingSource=overlappingSources[0];
  if(rangeIndex<0&&overlappingSources.length&&overlappingSources.every(e=>e.start>=edit.start&&e.end<=edit.end&&edit.newValue.split(e.op.oldFragment).length===2)){for(const e of overlappingSources){edit.newValue=edit.newValue.replace(e.op.oldFragment,e.newValue);e.coveredByBody=true;}overlappingSource=null;}
  if(rangeIndex>=0||overlappingSource){
   const proof=(pack.supersededBodyPatches||[]).find(x=>['sectionId','paragraph1','pairIndex0','language','old','new'].every(k=>x[k]===op[k]));assert(proof,'Overlapping reviewed correction requires explicit verified-correct supersession');reason(proof);
   let text;if(rangeIndex>=0){assert.equal(proof.restorationIndex,rangeIndex);const pair=ranges[rangeIndex].newPairs[proof.newPairIndex0];assert(pair);text=splitNotes(pair[side]).text;}else{assert.equal(proof.sourceAuditId,overlappingSource.op.auditId);text=plain(overlappingSource.newValue);}
   assert(op.new&&text.split(op.new).length===2,'Superseded correction is not exactly present once in the reviewed replacement');superseded.add(proof);continue;
  }
  addEdit(op.sectionId,op.paragraph1,op.pairIndex0,side,edit);
 }
 assert.equal(superseded.size,(pack.supersededBodyPatches||[]).length,'Unused superseded-correction audit');
 for(const[key,allEdits]of cellEdits){const edits=allEdits.filter(e=>!e.coveredByBody);const[id,n,k,side]=key.split('|').map(Number),row=para(sections,id,n);let value=row.p[k][side];edits.sort((a,b)=>b.start-a.start);for(let i=1;i<edits.length;i++)assert(edits[i-1].start>=edits[i].end,'Reviewed fragment operations overlap; merge explicitly');for(const e of edits)value=value.slice(0,e.start)+e.newValue+value.slice(e.end);row.p[k][side]=value;}
 function transferReviewedSourceEdits(op,payload){
  const original=para(baseSections,op.sectionId,op.paragraph1).p,corrected=para(sections,op.sectionId,op.paragraph1).p;
  for(let k=op.startPairIndex0;k<=op.endPairIndex0;k++)for(let side=0;side<2;side++){
   const oldNotes=footnoteBlocks(original[k][side]),newNotes=footnoteBlocks(corrected[k][side]);assert.equal(oldNotes.length,newNotes.length,'Source review changed note marker count');
   oldNotes.forEach((note,i)=>{if(note.raw===newNotes[i].raw)return;let matches=[];payload.forEach((pair,pairIndex)=>pair.forEach((value,s)=>{let at=-1;while((at=value.indexOf(note.raw,at+1))>=0)matches.push({pairIndex,side:s,at});}));assert.equal(matches.length,1,'Copied source note cannot be identified uniquely for verified link/quote corrections');const m=matches[0],value=payload[m.pairIndex][m.side];payload[m.pairIndex][m.side]=value.slice(0,m.at)+newNotes[i].raw+value.slice(m.at+note.raw.length);});
  }
  for(const e of sourceEdits.filter(e=>e.sectionId===op.sectionId&&e.paragraph1===op.paragraph1&&e.pairIndex0>=op.startPairIndex0&&e.pairIndex0<=op.endPairIndex0)){
   const raw=original[e.pairIndex0][e.side];if(footnoteBlocks(raw).some(n=>e.start>=n.start&&e.end<=n.end))continue;
   const hits=[];payload.forEach((pair,k)=>pair.forEach((value,side)=>{if(value.includes(e.op.oldFragment))hits.push({k,side});}));
   if(hits.length===1){const h=hits[0];payload[h.k][h.side]=payload[h.k][h.side].replace(e.op.oldFragment,e.newValue);}else assert(payload.some(pair=>pair.some(value=>value.includes(e.newValue))),'Restored main-text citation needs an explicit verified source-link merge: '+e.op.auditId);
  }
  return payload;
 }
 const operations=[];
 for(let op of ranges){reason(op);const base=para(pack.sections.map(s=>({...s,after:s.before})),op.sectionId,op.paragraph1).p;assert(op.startPairIndex0>=0&&op.endPairIndex0>=op.startPairIndex0&&op.endPairIndex0<base.length);assert.deepEqual(base.slice(op.startPairIndex0,op.endPairIndex0+1),op.oldPairs,'Original restored span changed');assertBoundary(base,op.startPairIndex0,op.beforeHebrewAnchor,op.oldPairs[0][0]===undefined?'':splitNotes(base[op.startPairIndex0][0]).text);const last=op.endPairIndex0+1;assert(last<base.length?op.afterHebrewAnchor&&splitNotes(base[last][0]).text.startsWith(op.afterHebrewAnchor):op.afterHebrewAnchor==='','Post-restoration Hebrew anchor differs');op={...op,editorialNoteGroups:(pack.editorialNoteGroups||[]).filter(g=>g.sectionId===op.sectionId&&g.paragraph1===op.paragraph1),modifiedInlineNotes:(pack.modifiedInlineNotes||[]).filter(g=>g.sectionId===op.sectionId&&g.paragraph1===op.paragraph1),sourceNoteRepairs:(pack.sourceNoteRepairs||[]).filter(g=>g.sectionId===op.sectionId&&g.paragraph1===op.paragraph1),movedOut:(pack.movedInlineNotes||[]).filter(m=>m.from.sectionId===op.sectionId&&m.from.paragraph1===op.paragraph1&&m.from.pairIndex0>=op.startPairIndex0&&m.from.pairIndex0<=op.endPairIndex0),movedIn:(pack.movedInlineNotes||[]).filter(m=>m.to.sectionId===op.sectionId&&m.to.paragraph1===op.paragraph1)};const payload=transferReviewedSourceEdits(op,structuredClone(op.newPairs)),corrected=para(sections,op.sectionId,op.paragraph1).p.slice(op.startPairIndex0,op.endPairIndex0+1);assertFootnotesRetained(corrected,payload,op);operations.push({...op,index:op.startPairIndex0,deleteCount:op.oldPairs.length,payload});}
 for(const op of pack.pairInsertions||[]){reason(op);const index=op.beforePairIndex0??op.afterPairIndex0+1,payload=op.pairs||op.newPairs;assert(Number.isInteger(index));const base=para(pack.sections.map(s=>({...s,after:s.before})),op.sectionId,op.paragraph1).p;assert(index>=0&&index<=base.length);assertBoundary(base,index,op.beforeHebrewAnchor,op.afterHebrewAnchor);assert(Array.isArray(payload)&&payload.length);assertFootnotesRetained([],payload,op);operations.push({...op,index,deleteCount:0,payload});}
 operations.sort((a,b)=>a.sectionId-b.sectionId||a.paragraph1-b.paragraph1||b.index-a.index||b.deleteCount-a.deleteCount);
 for(let i=0;i<operations.length;i++){const op=operations[i],same=operations.filter(x=>x!==op&&x.sectionId===op.sectionId&&x.paragraph1===op.paragraph1);assert(!same.some(x=>x.deleteCount&&op.index>x.index&&op.index<x.index+x.deleteCount),'Restoration ranges overlap');const row=para(sections,op.sectionId,op.paragraph1);row.p.splice(op.index,op.deleteCount,...structuredClone(op.payload));}
 for(const op of pack.paragraphInsertions||[]){reason(op);const section=sections.find(s=>s.id===op.sectionId),source=pack.sections.find(s=>s.id===op.sectionId),row=op.newParagraph;assert(section&&row&&Number.isInteger(row.n)&&Array.isArray(row.p)&&row.p.length);assert(!source.before.some(r=>r.n===row.n),'New paragraph changed an existing stable ID');assert(!section.after.some(r=>r.n===row.n),'Repeated inserted paragraph ID');const existingMax=Math.max(...source.before.filter(r=>r.n).map(r=>r.n));assert(row.n>existingMax,'New paragraph ID must follow all existing stable IDs');const before=op.beforeParagraph1==null?null:section.after.findIndex(r=>r.n===op.beforeParagraph1),after=op.afterParagraph1==null?null:section.after.findIndex(r=>r.n===op.afterParagraph1);assert(before!==-1&&after!==-1);assert(before!==null||after!==null);const index=after!==null?after+1:before;const preceding=after!==null?section.after[after]:null,following=before!==null?section.after[before]:null;assert(preceding?op.beforeHebrewAnchor&&preceding.p.map(p=>splitNotes(p[0]).text).join(' ').endsWith(op.beforeHebrewAnchor):!op.beforeHebrewAnchor);assert(following?op.afterHebrewAnchor&&following.p.map(p=>splitNotes(p[0]).text).join(' ').startsWith(op.afterHebrewAnchor):!op.afterHebrewAnchor);assertFootnotesRetained([],row.p,op);section.after.splice(index,0,structuredClone(row));}
 for(const move of pack.movedInlineNotes||[]){assert([142,143,144,145].includes(move.number)&&move.from.sectionId===3&&move.from.paragraph1===3&&move.to.sectionId===3&&move.to.paragraph1===4&&move.reason,'Unreviewed cross-paragraph source-note move');const from=para(baseSections,move.from.sectionId,move.from.paragraph1);assert.equal(from.p[move.from.pairIndex0].join('').split(move.oldBlock).length,2);const target=para(sections,move.to.sectionId,move.to.paragraph1);assert.equal(target.p.flat().join('').split(move.oldBlock).length,2,'Moved source note was lost or duplicated');}
 editLinks(sections,pack.verifiedLinks||[]);
 const refs=new Map();for(const ref of pack.verifiedReferences||[]){assert(ref.verified===true&&ref.ref);safeHref(ref.url);assert(!refs.has(ref.ref),'Repeated verified-reference entry');refs.set(ref.ref,ref.url);}
 for(const section of sections)for(const row of section.after){if(row.p)row.p=row.p.map(pair=>pair.map((value,side)=>normalizeBrackets(value,side).replace(/<a\b([^>]*\bdata-ref="([^"]+)"[^>]*)>/g,(all,attrs,ref)=>{const url=refs.get(decode(ref));if(!url||/\bhref=/.test(attrs))return all;return '<a'+attrs+' href="'+safeHref(url)+'">';})));if(typeof row.h==='string')row.h=normalizeBrackets(row.h,/[א-ת]/.test(row.h)?0:1);}
 const auditBody=applyAuditBodyLinks(applyAuditBodyPatches(sections,pack.auditBodyPatches||[]),pack.auditBodyLinkOperations||[]),audited=applyAuditedSourceOperations(auditBody,pack.auditedSourceOperations||[]);
 if(pack.sourceAuditManifest){const manifest=pack.sourceAuditManifest;assert(manifest.complete===true&&manifest.expectedNotes===1896,'The primary-source audit is incomplete');const original=inventoryInlineNotes(sections).filter(n=>n.editable),keys=new Set(original.map(n=>n.noteKey));assert.equal(keys.size,1896);assert.equal(sha(json(original.map(n=>({noteKey:n.noteKey,rawSha256:n.rawSha256})))),manifest.originalInventorySha256,'The audited note inventory differs');const decisions=manifest.decisions;assert(Array.isArray(decisions)&&decisions.length===1896&&new Set(decisions.map(d=>d.noteKey)).size===1896&&decisions.every(d=>keys.has(d.noteKey)),'Every original source note requires exactly one audit decision');const expected=decisions.filter(d=>d.decision!=='remove').map(d=>d.noteKey).sort();assert.deepEqual((pack.markerPlacements||[]).map(op=>op.noteKey).sort(),expected,'The native marker ledger does not cover all retained audited sources');assert.deepEqual((pack.auditedSourceOperations||[]).map(op=>op.noteKey).sort(),decisions.filter(d=>['repair','remove'].includes(d.decision)).map(d=>d.noteKey).sort(),'A source-content decision lacks its exact operation');}
 let placed=pack.markerPlacements?.length?applyReviewedMarkerPlacements(audited,pack.markerPlacements).sections:audited;
 if(pack.sourceAuditManifest){for(const d of pack.sourceAuditManifest.decisions){const source=(pack.auditedSourceOperations||[]).find(op=>op.noteKey===d.noteKey),placement=(pack.markerPlacements||[]).find(op=>op.noteKey===d.noteKey);if(['repair','remove'].includes(d.decision))assert.equal(source?.action,d.decision,'The source-content action differs from its reviewed decision');if(d.decision!=='remove')assert.equal(placement?.decision==='split',d.decision==='split','The native split differs from its reviewed decision');}assert.equal(inventoryInlineNotes(placed).filter(n=>n.editable).length,0,'An in-scope source marker remains inline after the complete audit');}
 placed=applyReviewedDynamicMarkers(placed,pack.dynamicMarkerPlacements||[]);
 placed=applyAuditBodyCitationPatches(placed,pack.auditBodyCitationPatches||[]);
 return placed;
}
export function validatePack(pack){
 publicationSections(pack);
 const sections=reconstructSections(pack);for(let i=0;i<sections.length;i++)assert.deepEqual(sections[i].after,pack.sections[i].after,'Unexplained reader content change in '+i);
 const satisfied=new Set();for(const audit of pack.restorationSatisfiedDeletions||[]){
  reason(audit);assert(audit.auditId&&!satisfied.has(audit.auditId),'Repeated restoration-satisfied deletion audit');satisfied.add(audit.auditId);assert.equal(audit.new,'');assert(audit.old,'A deletion needs its exact original editorial words');
  const side=sideOf(audit.language),section=pack.sections.find(s=>s.id===audit.sectionId),before=section?.before.find(r=>r.n===audit.paragraph1&&r.p),after=section?.after.find(r=>r.n===audit.paragraph1&&r.p),range=pack.pairReplacements?.[audit.restorationIndex];assert(before&&after&&range,'Deletion restoration coordinates are missing');assert.equal(range.sectionId,audit.sectionId);assert.equal(range.paragraph1,audit.paragraph1);assert(audit.pairIndex0>=range.startPairIndex0&&audit.pairIndex0<=range.endPairIndex0,'Deletion is not covered by its reviewed restoration');
  assert.equal(splitNotes(before.p[audit.pairIndex0][side]).text.split(audit.old).length,2,'Exact deleted editorial words must occur once in the original author cell');assert(!after.p.map(p=>splitNotes(p[side]).text).join(' ').includes(audit.old),'Restored paragraph still contains the deleted editorial synthesis');
 }
 const count=rows=>({paragraphs:rows.filter(r=>r.p).length,pairs:rows.reduce((n,r)=>n+(r.p?.length||0),0),notes:rows.reduce((n,r)=>n+(r.p||[]).reduce((m,p)=>m+p.reduce((x,s)=>x+footnoteBlocks(s).length,0),0),0),nativeNotes:rows.reduce((n,r)=>n+(r.footnotes?.length||0),0)});
 const before=pack.sections.map(s=>count(s.before)),after=sections.map(s=>count(s.after));
 assert.equal(before.reduce((n,s)=>n+s.paragraphs,0),362);assert.equal(before.reduce((n,s)=>n+s.pairs,0),5510);
 return{pack,sections,counts:{reviewedSections:16,bodyPatches:(pack.bodyPatches||[]).length,sourceOperations:(pack.sourceOperations||[]).length,auditedSourceNotes:(pack.sourceAuditManifest?.decisions||[]).length,auditedSourceRepairs:(pack.auditedSourceOperations||[]).filter(op=>op.action==='repair').length,auditedSourceRemovals:(pack.auditedSourceOperations||[]).filter(op=>op.action==='remove').length,auditedSourceSplits:(pack.markerPlacements||[]).filter(op=>op.decision==='split').length,auditBodyPatches:(pack.auditBodyPatches||[]).length,auditBodyLinkOperations:(pack.auditBodyLinkOperations||[]).length,auditBodyCitationPatches:(pack.auditBodyCitationPatches||[]).length,dynamicMarkerPlacements:(pack.dynamicMarkerPlacements||[]).length,restorationSatisfiedDeletions:(pack.restorationSatisfiedDeletions||[]).length,pairReplacements:(pack.pairReplacements||[]).length,pairInsertions:(pack.pairInsertions||[]).length,paragraphInsertions:(pack.paragraphInsertions||[]).length,paragraphs:after.reduce((n,s)=>n+s.paragraphs,0),phrasePairs:after.reduce((n,s)=>n+s.pairs,0),inlineNotes:after.reduce((n,s)=>n+s.notes,0),nativeSourceNotes:after.reduce((n,s)=>n+s.nativeNotes,0),sourceNotesTotal:after.reduce((n,s)=>n+s.notes+s.nativeNotes,0),verifiedLinkOperations:(pack.verifiedLinks||[]).length,verifiedReferences:(pack.verifiedReferences||[]).length}};
}
export function loadPack(packPath=path.join(REPO_ROOT,PACK)){const bytes=fs.readFileSync(packPath),pin=fs.readFileSync(packPath+'.sha256','utf8').trim();assert.equal(sha(bytes),pin,'Reviewed Takanat pack checksum differs');return{...validatePack(JSON.parse(gunzipSync(bytes))),packSha256:sha(bytes)};}
export function projectRows(section,sectionIndex,links){
 const paras=[];let pending=[];
 for(const row of section.after){
  if(typeof row.h==='string'){const h=plain(row.h);if(h)pending.push(h);continue;}if(!row.p)continue;
  const p=[],f=[],parts=[];row.p.forEach((pair,k)=>{const he=splitNotes(pair[0]),en=splitNotes(pair[1]);p.push([he.text,en.text]);parts.push({k,side:'h',split:he},{k,side:'e',split:en});for(const n of he.notes)f.push([n.n,n.text,k,'h',n.at]);for(const n of en.notes)f.push([n.n,n.text,k,'e',n.at]);});
  const a=citationPlaces(parts)||{};
  for(const note of row.footnotes||[]){
   assert(Number.isInteger(note.phraseIndex)&&p[note.phraseIndex],'Native source note has no exact phrase');const originalHebrew=markerAuthorPlain(row.p[note.phraseIndex][0]);assert(Number.isInteger(note.heCharOffset)&&note.heCharOffset>0&&originalHebrew.slice(0,note.heCharOffset)===note.heAnchorPrefix,'Native source note Hebrew anchor differs');const projectedPrefix=plain(note.heAnchorPrefix);assert(p[note.phraseIndex][0].startsWith(projectedPrefix),'Native source note projected Hebrew anchor differs');
   const text=(note.paragraphs||[]).map(part=>plain(part.text)).join('\n');assert(text,'Native source note is empty');f.push([String(note.number),text,note.phraseIndex,'h',projectedPrefix.length]);
   for(const source of note.sources||[])if(source.ref&&!source.openExternal)a[source.readerRef||source.ref]??=['n',String(note.number)];
  }
  const r=section.sectionRef+(section.id?':':' ')+row.n,para={r,s:sectionIndex,n:row.n,p};if(f.length)para.f=f;if(Object.keys(a).length)para.a=a;if(pending.length){para.h=pending;pending=[];}const c=(links[section.sectionRef]||[]).filter(e=>e.a===r).map(e=>[e.r,e.c||'']);if(c.length)para.c=c;paras.push(para);
 }
 if(pending.length){assert(paras.length);paras.at(-1).h2=pending;}return paras;
}

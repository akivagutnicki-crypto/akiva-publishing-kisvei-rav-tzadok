import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const work=path.dirname(fileURLToPath(import.meta.url));
const base=path.dirname(work), repo=path.join(base,'akiva-repo');
const {validatePack}=await import(path.join(repo,'scripts/publish-tzidkat-batch-review.mjs'));
const [first,last,startNumber]=process.argv.slice(2).map(Number);
assert(Number.isSafeInteger(first)&&Number.isSafeInteger(last)&&Number.isSafeInteger(startNumber));
const stamp='20261023', pad=n=>String(n).padStart(3,'0');
const release=`${stamp}-tzidkat-batch-${pad(first)}-${pad(last)}-v1`;
const target=path.join(repo,`sources/akiva/overlays/tzidkat-batch-review-${pad(first)}-${pad(last)}-${stamp}.json.gz`);
assert(!fs.existsSync(target),'Never overwrite an immutable package');
const hash=x=>createHash('sha256').update(x).digest('hex');
const digest=x=>hash(JSON.stringify(x));
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',thinsp:' ',ensp:' ',emsp:' ',lrm:'',rlm:''};
const strip=x=>String(x??'').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,e)=>e[0]==='#'?String.fromCodePoint(parseInt(e.slice(e[1]?.toLowerCase()==='x'?2:1),e[1]?.toLowerCase()==='x'?16:10)):entities[e.toLowerCase()]??m);
const baseline=fs.existsSync(path.join(base,'live-baseline/library/data/tzidkat-hatzadik/links.json'))?path.join(base,'live-baseline/library/data/tzidkat-hatzadik'):path.join(base,'live-baseline');
const links=JSON.parse(fs.readFileSync(path.join(baseline,'links.json'),'utf8'));
const proposals=[];
for(let n=first;n<=last;n+=5){const p=path.join(work,`ois-${n}-${Math.min(n+4,last)}.json`);proposals.push(JSON.parse(fs.readFileSync(p,'utf8')));}
const entries=proposals.flatMap(p=>p.entries||[]).sort((a,b)=>a.section-b.section||a.rowN-b.rowN||a.phraseIndex-b.phraseIndex||a.heAnchorPrefix.length-b.heAnchorPrefix.length||a.id.localeCompare(b.id));
const chapters=[],auditEntries=[],coverage=[],linksBefore={};let number=startNumber;
for(let section=first;section<=last;section++){
 const before=JSON.parse(fs.readFileSync(path.join(baseline,`${section-1}.json`),'utf8')),after=structuredClone(before);
 const selected=entries.filter(e=>e.section===section);
 assert(![40,74,154].includes(section)||selected.length===0,'Completed or absent ois must remain unchanged');
 for(const e of selected){
  const row=after.find(r=>r.n===e.rowN);assert(row?.p?.[e.phraseIndex]);
  const he=strip(row.p[e.phraseIndex][0]),en=strip(row.p[e.phraseIndex][1]);
  assert(he.startsWith(e.heAnchorPrefix)&&e.heAnchorPrefix.length>0,`Inexact Hebrew anchor ${section}/${e.id}`);
  assert(e.sourceEvidence?.length&&e.he&&e.en&&e.context,`Missing source evidence or context ${e.id}`);
  const sourceId=`TZB-${pad(section)}-${e.id}`,placementId=sourceId+'-1';
  const source={ref:e.ref,role:'primary-source'};
  let url=e.url;
  const internal=typeof url==='string'&&(url.startsWith('#/read/')||url.startsWith('https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/'));
  if(e.citationOnly){source.citationOnly=true;url=undefined;}
  else if(internal){url='#/read/'+(e.readerRef||e.ref).replace(/ /g,'_');source.url=url;if(e.readerRef)source.readerRef=e.readerRef;}
  else {assert(/^https:\/\//.test(url||''));source.url=url;source.openExternal=true;}
  if(e.category)source.category=e.category;
  const rich=[{text:e.ref,bold:true,...(url?{href:url}:{})},{text:': “'+e.en+'”'}];
  const note={number,sourceId,placementId,phraseIndex:e.phraseIndex,heCharOffset:e.heAnchorPrefix.length,enCharOffset:en.length,heAnchorPrefix:e.heAnchorPrefix,enAnchorPrefix:en,heWord:e.heAnchorPrefix.trim().split(/\s+/).length,quotationOnly:true,verificationStatus:'verified',paragraphs:[{language:'en',text:rich.map(r=>r.text).join(''),rich},{language:'en',text:'Context: '+e.context,rich:[{text:'Context: ',bold:true},{text:e.context}]}],sources:[source],nativeConnections:[],reviewedSourceExcerpt:{schemaVersion:1,ref:e.ref,he:e.he,en:e.en,coverage:'selected complete source passage',provenance:'Original English translation checked against the original Hebrew or Aramaic source.'},provenance:{quotedSourceRelease:release,sourceId,section:`Tzidkat HaTzadik ${section}`,sourceFile:`${section-1}.json`,item:e.rowN,originalEnglishTranslation:true,editorialId:e.id}};
  if(internal){const ev=e.sourceEvidence[0];note.reviewedSourceExcerpts=[{ref:e.ref,scope:'selected-source-excerpt',en:e.en,evidenceSha256:digest({ref:ev.ref,he:ev.he,en:ev.en})}];note.provenance.sourceAudit={release};}
  (row.footnotes??=[]).push(note);
  auditEntries.push({sectionRef:`Tzidkat HaTzadik ${section}`,placementId,number,status:'verified',phraseIndex:e.phraseIndex,heAnchorPrefix:e.heAnchorPrefix,sourceEvidence:e.sourceEvidence,reviewEvidence:e.reviewEvidence});number++;
 }
 const secRef=`Tzidkat HaTzadik ${section}`;
 assert(Array.isArray(links[secRef]),`Missing exact links preimage ${secRef}`);linksBefore[secRef]=links[secRef];
 chapters.push({path:`library/data/tzidkat-hatzadik/${section-1}.json`,beforeSha256:digest(before),before,after});
 const supplied=proposals.flatMap(p=>Array.isArray(p.coverage)?p.coverage:[]).find(c=>c.section===section)||{};
 coverage.push({...supplied,section,status:[40,154].includes(section)?'previously-completed-preserved':section===74?'absent-preserved':selected.length?'reviewed-additions':'reviewed-no-addition',additions:selected.map(e=>e.id),existingNotes:'Every native note and existing connected-source quotation preserved unchanged.'});
}
const pack={schemaVersion:1,release,reviewedSections:Array.from({length:last-first+1},(_,i)=>first+i),chapters,linksBefore,audit:{completeReview:true,reviewedAt:'2026-10-23',method:'Original source quotations, original English translations, exact Hebrew anchors, and unchanged existing notes.',coverage,entries:auditEntries}};
const added=validatePack(pack);const bytes=gzipSync(Buffer.from(JSON.stringify(pack)),{level:9});
fs.writeFileSync(target,bytes);fs.writeFileSync(target+'.sha256',hash(bytes)+'\n');
console.log(JSON.stringify({release,path:target,notes:added.length,firstNumber:startNumber,lastNumber:number-1,sha256:hash(bytes),counts:coverage.map(c=>[c.section,c.additions.length])},null,2));

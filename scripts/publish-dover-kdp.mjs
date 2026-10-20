// The two current KDP manuscripts are the authoritative Dover reader edition.
// Run after historical edition checks and before final indexes and ZIP downloads.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {linkCitations,linkHebrewCitations,findCitations,normalizeRef,categoryOf} from './citations.mjs';

const ROOT=path.resolve('dist/library'),DATA=path.join(ROOT,'data'),BOOK=path.join(DATA,'dover-tzedek');
const RELEASE='20261020-dover-kdp-manuscripts-v1';
const hash=x=>createHash('sha256').update(x).digest('hex');
const serial=x=>JSON.stringify(x);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,d)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,serial(d)+'\n');};
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const decode=x=>String(x).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>e[0]==='#'?String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):+e.slice(1)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[e]);
const visible=x=>decode(String(x).replace(/<[^>]*>/g,''));
const normalized=x=>visible(x).replace(/\s+/g,' ').trim();
const leaves=n=>n.children?n.children.flatMap(leaves):[n];
const slug=x=>x.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const files=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]);
const catalog=read(path.join(DATA,'catalog.json'));
const localTitles=catalog.map(b=>b.title).sort((a,b)=>b.length-a.length);
const localRef=r=>localTitles.some(t=>r===t||r.startsWith(t+' ')||r.startsWith(t+','));
const reviewFile='sources/verified/dover/kdp-link-target-review-20261020.json';
const review=fs.existsSync(reviewFile)?read(reviewFile):{corrections:{},unlinked:[]};
const verifiedFile='sources/verified/dover/kdp-sefaria-links-20261020.json.gz';
const verified=fs.existsSync(verifiedFile)?JSON.parse(gunzipSync(fs.readFileSync(verifiedFile))).references:{};
function urlRef(value) {
  try {
    const u=new URL(value,'https://reader.example/library/');
    if(u.hash.startsWith('#/read/'))return decodeURIComponent(u.hash.slice(7)).replace(/_/g,' ');
    if(!/^(www\.)?sefaria\.org$/.test(u.hostname))return null;
    let r=decodeURIComponent(u.pathname.slice(1)).replace(/_/g,' ');
    const m=/^(.*?)[. ](\d+[ab]?(?:[.:]\d+[ab]?)*(?:[-–]\d+[ab]?(?:[.:]\d+[ab]?)*)?)$/.exec(r);
    return normalizeRef(m?m[1]+' '+m[2].replace(/\./g,':'):r);
  }catch{return null;}
}
function resolved(ref) {
  ref=normalizeRef(ref);
  if(Object.hasOwn(review.corrections,ref))return review.corrections[ref];
  if(localRef(ref))return[{ref,url:'#/read/'+ref.replace(/ /g,'_')}];
  const e=verified[ref];
  if(e?.isRef)return[{ref:e.ref||ref,url:'https://www.sefaria.org/'+e.url}];
  if(e)return[];
  throw Error('A new Sefaria reference still needs verification: '+ref);
}
function sourceUrl(ref) {
  return resolved(ref)[0]?.url||null;
}
function repairHref(href) {
  const ref=urlRef(href);return ref?sourceUrl(ref):href;
}
function repairHtml(value) {
  return value.replace(/<a\b([^>]*\bdata-ref="([^"]+)"[^>]*)>([\s\S]*?)<\/a>/g,(_,attrs,ref,text)=>{
    const r=resolved(decode(ref))[0];return r?'<a data-ref="'+esc(r.ref)+'" href="'+esc(r.url)+'">'+text+'</a>':text;
  });
}
function linkNoteParagraph(p) {
  const candidates=findCitations(p.text).map(c=>({...c,ref:normalizeRef(c.ref)}));
  const rich=[];let cursor=0;
  for(const run of p.rich) {
    const end=cursor+run.text.length;
    const cuts=[cursor,end,...candidates.flatMap(c=>[c.index,c.index+c.length]).filter(k=>cursor<k&&k<end)].sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++){
      const [a,b]=[cuts[i-1],cuts[i]];if(a===b)continue;
      const c=candidates.find(c=>c.index<=a&&b<=c.index+c.length);
      const oldHref=run.href?repairHref(run.href):null;
      const newHref=c&&(!oldHref||Object.hasOwn(review.corrections,urlRef(run.href||'')))?sourceUrl(c.ref):oldHref;
      const {href:discarded,...flags}=run;
      rich.push({...flags,text:run.text.slice(a-cursor,b-cursor),...(newHref?{href:newHref}:{})});
    }
    cursor=end;
  }
  assert.equal(rich.map(r=>r.text).join(''),p.text,'Footnote linking changed its words');
  return {...p,rich};
}

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dover-kdp-'));
let extracted;
try{
  const out=path.join(temp,'source.json');
  execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',['scripts/dover-kdp-docx.py','--out',out],{stdio:['ignore','pipe','inherit']});
  extracted=read(out);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
const sourceSignature=hash(serial(extracted.volumes)+serial(review));
const toc=read(path.join(BOOK,'toc.json'));
if(toc.manuscriptEdition?.sourceSignature===sourceSignature){
  console.log('Dover latest KDP manuscripts already published; no content rewritten.');
  process.exit(0);
}
const protectedTextSha256=Object.fromEntries(files(DATA).filter(f=>/^[^/]+\/\d+(?:-\d+)*\.json$/.test(f)&&!f.startsWith('dover-tzedek/')).map(f=>[f,hash(fs.readFileSync(path.join(DATA,f)))]));
const staged=new Map(),connections={},sectionProof=[],alignment=extracted.alignmentChanges;
const tocLeaves=leaves(toc.toc);
let totalPairs=0,totalNotes=0,totalHeads=0;
const noteSequence={I:[],II:[]};
const edges=new Map();
function addRef(section,number,ref,noteNumber=null) {
  if(!ref)return;
  ref=normalizeRef(ref);const anchor=section+':'+number,key=anchor+'|'+ref;
  if(!edges.has(key))edges.set(key,{a:anchor,r:ref,c:categoryOf(ref),source:RELEASE,...(noteNumber?{footnotes:[noteNumber]}:{})});
  else if(noteNumber){const e=edges.get(key);e.footnotes=[...new Set([...(e.footnotes||[]),noteNumber])];}
}
for(const [file,section] of Object.entries(extracted.sections)) {
  const [id,chapter]=file.slice(0,-5).split('-').map(Number),leaf=tocLeaves.find(l=>l.id===id);
  assert.ok(leaf,'Unrecognized Dover reader section '+file);
  const ref=leaf.ref+' '+chapter,byN=new Map();
  section.pairs.forEach((pair,index)=>{
    const n=section.canonicalNumbers[index];
    if(!byN.has(n))byN.set(n,{n,p:[],keepPairs:true,sourceVolume:section.volume});
    const row=byN.get(n),pi=row.p.length;
    const ph=[repairHtml(linkHebrewCitations(linkCitations(pair.heHtml))),repairHtml(linkCitations(pair.enHtml))];
    assert.deepEqual(ph.map(normalized),[pair.he,pair.en].map(normalized),'Linking changed a source phrase');
    row.p.push(ph);
    if(pair.paragraphStart&&pi)(row.paragraphBreaks??=[]).push(pi);
    for(const h of pair.heads){(row.inlineHeadings??=[]).push({text:h.text,phraseIndex:pi,kind:h.level===3?'section':'subsection',source:'Word manuscript'});totalHeads++;}
    for(const value of ph)for(const m of value.matchAll(/data-ref="([^"]+)"/g))addRef(ref,n,decode(m[1]));
    for(const original of pair.notes){
      const paragraphs=original.paragraphs.map(linkNoteParagraph);
      const sources=[...new Set(paragraphs.flatMap(p=>p.rich.map(r=>r.href).filter(Boolean)))].flatMap(url=>{const r=urlRef(url);return r?[{ref:r,url}]:[];});
      const note={...original,paragraphs,phraseIndex:pi,heCharOffset:pair.he.length,heAnchorPrefix:pair.he,
        enCharOffset:pair.en.length,enAnchorPrefix:pair.en,sources};
      (row.footnotes??=[]).push(note);noteSequence[section.volume].push(note.number);totalNotes++;
      for(const s of sources)addRef(ref,n,s.ref,note.number);
    }
    totalPairs++;
  });
  const rows=[...byN.values()];
  const before=fs.readFileSync(path.join(BOOK,file));
  staged.set(file,rows);
  const he=rows.flatMap(r=>r.p.map(p=>visible(p[0]))),en=rows.flatMap(r=>r.p.map(p=>visible(p[1])));
  sectionProof.push({file,ref,volume:section.volume,paragraphs:rows.length,phrases:he.length,notes:rows.reduce((n,r)=>n+(r.footnotes?.length||0),0),
    beforeSha256:hash(before),heSha256:hash(serial(he)),enSha256:hash(serial(en)),sha256:hash(serial(rows)+'\n')});
  leaf.shape[chapter-1]=rows.length;
  leaf.chapterOutlines??=[];leaf.chapterOutlines[chapter-1]=rows.flatMap(row=>(row.inlineHeadings||[]).map(h=>({title:h.text,ref:ref+':'+row.n,phraseIndex:h.phraseIndex,kind:h.kind})));
}
for(const volume of ['I','II'])assert.deepEqual(noteSequence[volume],Array.from({length:extracted.volumes[volume].notes},(_,i)=>i+1),'Word footnote numbering changed in volume '+volume);
assert.equal(totalPairs,7405);assert.equal(totalNotes,2796);
const title=extracted.volumes.I.title;
const opening=Array.from({length:9},(_,i)=>({n:i+1,p:[[esc(title[2*i]),esc(title[2*i+1])]],paragraphTranslation:true}));
staged.set('0.json',opening);
for(const e of edges.values()){const section=e.a.replace(/:\d+$/,'');(connections[section]??=[]).push(e);}

// Replace Dover's contributions to each reverse source index, retaining all
// citations contributed by other books byte-for-byte at the record level.
const citedDir=path.join(DATA,'cited');
const cited=new Map(fs.readdirSync(citedDir).filter(f=>f.endsWith('.json')&&f!=='index.json').map(f=>[f,read(path.join(citedDir,f))]));
for(const refs of cited.values())for(const [r,anchors]of Object.entries(refs))refs[r]=anchors.filter(a=>!a.startsWith('Dover Tzedek'));
for(const e of edges.values()){
  const name=slug(e.r.replace(/\s+\d[\dab:\-–]*$/,''))+'.json';
  if(!cited.has(name))cited.set(name,{});
  const refs=cited.get(name);refs[e.r]=[...new Set([...(refs[e.r]||[]),e.a])];
}
for(const [name,refs]of cited){for(const r of Object.keys(refs))if(!refs[r].length)delete refs[r];write(path.join(citedDir,name),refs);}
write(path.join(citedDir,'index.json'),[...cited.keys()].map(f=>f.slice(0,-5)).sort());
for(const [file,rows]of staged)write(path.join(BOOK,file),rows);
write(path.join(BOOK,'links.json'),connections);
const downloads=['I','II'].map(v=>({label:`Volume ${v} · Revised KDP Word manuscript`,file:`downloads/dover-tzedek-volume-${v.toLowerCase()}-latest-kdp.docx`,volume:v}));
for(const d of downloads)fs.copyFileSync(path.join('sources/akiva/docx',extracted.volumes[d.volume].name),path.join(ROOT,d.file));
const book=catalog.find(b=>b.slug==='dover-tzedek');
book.downloads=downloads;book.interlinear=true;book.version={title:'Akiva Publishing revised KDP interlinear edition',source:'Akiva Publishing',license:'© Akiva Publishing'};
toc.version=book.version;toc.manuscriptEdition={release:RELEASE,sourceSignature,phrases:totalPairs,notes:totalNotes,wordSources:extracted.volumes};
toc.revisedFootnotes={release:RELEASE,notes:totalNotes,report:'dover-kdp-reader-report.json'};
write(path.join(BOOK,'toc.json'),toc);write(path.join(DATA,'catalog.json'),catalog);
const report={release:RELEASE,book:'Dover Tzedek',sourceSignature,wordSources:extracted.volumes,
  phrases:totalPairs,notes:totalNotes,headlines:totalHeads,sections:sectionProof,connections:edges.size,
  uniqueSources:new Set([...edges.values()].map(e=>e.r)).size,alignmentChanges:alignment,
  sourceLinkReviewSha256:fs.existsSync(reviewFile)?hash(fs.readFileSync(reviewFile)):null,unlinkedCitations:review.unlinked,
  protectedTextSha256,downloads};
write(path.join(ROOT,'dover-kdp-reader-report.json'),report);
for(const [f,digest]of Object.entries(protectedTextSha256))assert.equal(hash(fs.readFileSync(path.join(DATA,f))),digest,'Another work changed: '+f);
const suffix='-dover-kdp-v1-'+sourceSignature.slice(0,12);
for(const f of ['index.html','sw.js']){
  const p=path.join(ROOT,f);let text=fs.readFileSync(p,'utf8');
  if(f==='index.html')text=text.replace(/(url\.startsWith\('data\/dover-tzedek\/'\) \? url \+ '\?edition=)([^']+)(')/,(_,a,b,c)=>a+b.replace(/-dover-kdp-v1-[a-f0-9]+/g,'')+suffix+c);
  else text=text.replace(/^(const SHELL = `)([^`]+)(`;)/m,(_,a,b,c)=>a+b.replace(/-dover-kdp-v1-[a-f0-9]+/g,'')+suffix+c);
  assert.ok(text.includes(suffix),'Latest Dover cache version missing in '+f);fs.writeFileSync(p,text);
}
console.log(JSON.stringify({release:RELEASE,phrases:totalPairs,notes:totalNotes,headlines:totalHeads,connections:edges.size,uniqueSources:report.uniqueSources}));

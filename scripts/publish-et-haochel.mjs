// Verify Et HaOchel after archive imports, retain its curated parallels, and refresh reader caches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sourcePath='sources/akiva/Et_HaOchel.json';
const sourceBytes=fs.readFileSync(sourcePath);
const source=JSON.parse(sourceBytes);
const root='dist/library';
const data=path.join(root,'data/et-haochel');
const plain=s=>String(s).replace(/<[^>]*>/g,'').replace(/&(?:quot|amp|apos|lt|gt|nbsp|#39|#x27);/g,
 t=>({'&quot;':'"','&amp;':'&','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[t]));
assert.equal(source.title,'Et HaOchel');
assert.equal(source.sections.length,16);
const notes=new Map(),placements=new Set(),parallelRefs=new Set(),curated={};
let pairs=0,paragraphs=0,placed=0;
for(const section of source.sections){
 const records=JSON.parse(fs.readFileSync(path.join(data,`${section.n-1}.json`),'utf8'));
 // The editorial heading importer adds standalone heading records before the text.
 // Validate every text paragraph and leave those headings in place.
 const built=records.filter(item=>Array.isArray(item.p));
 const originals=section.items.filter(item=>Array.isArray(item.p));
 assert.ok(records.every(item=>Array.isArray(item.p)||!item.footnotes),'Footnotes outside a text paragraph');
 assert.equal(built.length,originals.length);
 let parallelCount=0;
 for(let i=0;i<built.length;i++){
  const item=built[i],original=originals[i];paragraphs++;
  assert.deepEqual(item.footnotes||[],original.footnotes||[],'Footnote payload changed in ois '+section.n);
  assert.equal(item.p.length,original.p.length);
  for(let j=0;j<item.p.length;j++){
   assert.equal(plain(item.p[j][0]),plain(original.p[j][0]));
   assert.equal(plain(item.p[j][1]),plain(original.p[j][1]));pairs++;
  }
  const ref=`Et HaOchel ${section.n}:${item.n||i+1}`;
  const parallels=[];
  for(const note of item.footnotes||[]){
   assert.match(note.sourceId,/^EH-\d{4}$/);
   assert.equal(note.number,Number(note.sourceId.slice(3)));
   assert.ok(!placements.has(note.placementId),'Duplicate placement '+note.placementId);
   placements.add(note.placementId);placed++;
   assert.equal(plain(item.p[note.phraseIndex][0]).slice(0,note.heCharOffset),note.heAnchorPrefix);
   assert.ok(!('enCharOffset' in note)&&!('enWord' in note),'English note marker');
   if(section.n!==8)assert.equal(note.sources.length,1);
   if(!note.sources.length){
    assert.equal(section.n,8);assert.equal(note.kind,'editorial');
    assert.ok(note.paragraphs[0].text.startsWith('Explanatory note: '));
   }
   for(const cited of note.sources){
    assert.ok(/^https:\/\/www\.sefaria\.org\//.test(cited.url) || [
     'https://voices.sefaria.org/sheets/554271?lang=bi',
     'https://www.chabad.org/library/tanya/tanya_cdo/aid/6088199/jewish/Kuntres-Acharon-Essay-3-Part-1.htm'
    ].includes(cited.url),'Unverified source location');
    assert.ok(note.paragraphs.some(p=>p.rich.some(r=>r.bold&&r.href===cited.url)),
     'Source label or hyperlink missing: '+cited.ref);
   }
   assert.ok(note.paragraphs.length>=1);
   for(const p of note.paragraphs){
    assert.equal(p.rich.map(r=>r.text).join(''),p.text);
    assert.ok(!/[\u0590-\u05ff]/.test(p.text),'Footnote is not English');
   }
   const canonical=JSON.stringify({number:note.number,kind:note.kind,paragraphs:note.paragraphs,sources:note.sources});
   if(notes.has(note.sourceId))assert.equal(notes.get(note.sourceId),canonical);
   else notes.set(note.sourceId,canonical);
   if(note.kind==='parallel'){
    const other=note.sources[0].ref;
    assert.ok(!parallelRefs.has(other),'Repeated parallel '+other);
    parallelRefs.add(other);parallelCount++;
    // These are editorially selected thematic parallels, not a shared-citation score.
    parallels.push([other,1,[],[]]);
   }
  }
  curated[ref]={p:parallels,reviewedParallels:true};
 }
 assert.equal(parallelCount,section.n===8?3:2,'Unexpected distinct parallels in ois '+section.n);
}
assert.equal(paragraphs,17);assert.equal(pairs,303);assert.equal(placed,258);assert.equal(notes.size,240);assert.equal(parallelRefs.size,33);
assert.deepEqual([...notes.keys()].sort(),Array.from({length:240},(_,i)=>`EH-${String(i+1).padStart(4,'0')}`));
// Audit the original sheet and record sources deliberately omitted as
// redundant during the user's requested editorial trimming.
const sourceAudit=JSON.parse(fs.readFileSync('editorial/et-haochel-8-sources-554271.json','utf8'));
assert.equal(sourceAudit.coverage.length,39);
assert.equal(sourceAudit.coverage.filter(x=>x.status==='already present').length,8);
assert.equal(Object.keys(sourceAudit.images).length,25);
assert.ok(Object.values(sourceAudit.images).every(x=>x.length));
const ois8=source.sections.find(s=>s.n===8).items.flatMap(i=>i.footnotes||[]);
assert.equal(ois8.length,20);
const ois8Sources=ois8.flatMap(n=>n.sources);
assert.equal(ois8Sources.length,39);
assert.equal(new Set(ois8Sources.map(s=>s.ref)).size,39,'Duplicate source in ois 8');
assert.equal(ois8.flatMap(n=>n.paragraphs).filter(p=>p.text.startsWith('Explanatory note: ')).length,2);
assert.ok(!/Biurei\s+HaChassidus|ביאורי\s+החסידות/i.test(JSON.stringify(ois8)),
 'Unattributed explanation still names Biurei HaChassidus');
assert.equal(sourceAudit.consolidation.length,20);
for(const group of sourceAudit.consolidation){
 const note=ois8.find(n=>n.sourceId===group.sourceId);
 assert.ok(note,'Consolidated note missing: '+group.title);
 assert.deepEqual(note.sources.map(s=>s.ref),group.retainedSources);
 assert.equal(note.heAnchorPrefix,group.heAnchorPrefix);
}
const omitted=new Map(sourceAudit.trimming.removedSources.map(s=>[s.ref,s.reason]));
assert.equal(omitted.size,10);
for(const [ref,reason] of omitted){
 assert.ok(reason.length>20,'Missing reason for source omission');
 assert.ok(!ois8Sources.some(s=>s.ref===ref),'Redundant source returned: '+ref);
}
for(const entry of sourceAudit.coverage){
 if(entry.status==='omitted as redundant')assert.ok(omitted.has(entry.coveredBy)&&entry.reason);
 else assert.ok(ois8Sources.some(s=>s.ref===entry.coveredBy),'Missing supplied source '+entry.ref);
}
const ois8Words=ois8.flatMap(n=>n.paragraphs).reduce((count,p)=>count+p.text.trim().split(/\s+/).length,0);
assert.equal(ois8Words,sourceAudit.trimming.currentWords);
assert.ok(ois8Words<sourceAudit.trimming.previousWords*0.7,'Repetitive wording was not trimmed');
for(const dir of ['dist/library/data/parallels','dist/mcp-data/parallels']){
 const file=path.join(dir,'et-haochel.json');
 const old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 const selected={};
 for(const [ref,entry] of Object.entries(curated))selected[ref]={...(old[ref]?.q?{q:old[ref].q}:{}),...entry};
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify(selected));
 const indexFile=path.join(dir,'index.json');
 if(fs.existsSync(indexFile)){
  const index=JSON.parse(fs.readFileSync(indexFile,'utf8'));
  if(!index.includes('et-haochel'))index.push('et-haochel');
  fs.writeFileSync(indexFile,JSON.stringify(index.sort()));
 }
}
const sourceHash=createHash('sha256').update(sourceBytes).digest('hex');
const tag='20261016-et-haochel-240-'+sourceHash.slice(0,12);
const htmlFile=path.join(root,'index.html');
if(fs.existsSync(htmlFile)){
 let html=fs.readFileSync(htmlFile,'utf8');
 const start='const editionDataUrl = url => ';
 if(!html.includes(tag)){
  assert.equal(html.split(start).length,2,'Reader data URL function missing');
  html=html.replace(start,start+`(url.startsWith('data/et-haochel/') || url === 'data/parallels/et-haochel.json') ? url + '?edition=${tag}' : `);
  fs.writeFileSync(htmlFile,html);
 }
}
const swFile=path.join(root,'sw.js');
if(fs.existsSync(swFile)){
 let sw=fs.readFileSync(swFile,'utf8');
 assert.match(sw,/const VERSION = '[^']+';/);
 sw=sw.replace(/const VERSION = '[^']+';/,`const VERSION = '${tag}';`);
 if(!sw.includes("rel.startsWith('data/et-haochel/')")){
  const before='} else if (/^data';
  assert.ok(sw.includes(before),'Service worker data route missing');
  sw=sw.replace(before,"} else if (rel.startsWith('data/et-haochel/') || rel === 'data/parallels/et-haochel.json' || /^data");
 }
 fs.writeFileSync(swFile,sw);
}
const report={title:source.title,sections:16,paragraphs,phrasePairs:pairs,uniqueFootnotes:notes.size,
 footnotePlacements:placed,distinctParallelPassages:parallelRefs.size,englishMarkers:0,hebrewPreserved:true,
 ois8Footnotes:ois8.length,ois8AttributedSources:ois8Sources.length,ois8ExplanatoryPassages:2,ois8FootnoteWords:ois8Words,
 sourceSha256:sourceHash,edition:tag};
fs.writeFileSync(path.join(root,'et-haochel-publication.json'),JSON.stringify(report,null,2)+'\n');
console.log('PASS Et HaOchel publication: all 16 oisiyos, 240 English notes, 258 Hebrew-only anchors, 33 nonrepeated parallels; Ois 8 trimmed to 20 notes and '+ois8Words+' words, with 39 attributed sources and 2 unattributed explanations.');

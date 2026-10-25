// Checked quotation revisions for the complete Bereishit–Chayei Sarah reader.
// The immutable pack reconstructs every chapter from exact note operations and
// explicitly reviewed link/attribution corrections. No author Hebrew is edited.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const REPO_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const RELEASE='20261025-pri-parsha-quoted-sources-v1';
export const PACK='sources/akiva/overlays/pri-parsha-quoted-sources-20261025.json.gz';
export const DESCRIPTOR='sources/akiva/overlays/pri-parsha-transition-20261025.json';
export const REPORT='library/pri-parsha-source-review-20261025.json';
export const LEDGER='library/pri-parsha-source-review-ledger.json';
export const LINKS='library/data/peri-tzadik/links.json';
export const MCP='mcp-data/text/peri-tzadik.json';
export const SUPPLEMENT='library/data/peri-tzadik/vayera-original-source-notes.json';
export const CONNECTED='library/connected-ideas/catalog.json';
export const ARCHIVES=['library/downloads/rav-tzadok-library.zip','library/downloads/books/peri-tzadik.zip'];
export const CHAPTER_IDS=[...Array.from({length:15},(_,i)=>90+i),...Array.from({length:21},(_,i)=>107+i),...Array.from({length:18},(_,i)=>159+i)];
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const digest=value=>sha(JSON.stringify(value));
export const json=value=>Buffer.from(JSON.stringify(value));
export const info=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
export const onlyInfo=value=>({bytes:value.bytes,sha256:value.sha256});
export function local(directory,name){
  assert(typeof name==='string'&&name&&!path.isAbsolute(name)&&!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unsafe publication path');
  const root=path.resolve(directory),file=path.resolve(root,name);assert(file.startsWith(root+path.sep));return file;
}
export function fileInfo(file){
  const fd=fs.openSync(file,'r'),hash=createHash('sha256'),buf=Buffer.allocUnsafe(1024*1024);let bytes=0;
  try{assert(fs.fstatSync(fd).isFile());for(;;){const n=fs.readSync(fd,buf,0,buf.length,null);if(!n)break;bytes+=n;hash.update(buf.subarray(0,n));}}finally{fs.closeSync(fd);}
  return{bytes,sha256:hash.digest('hex')};
}
export function inventory(directory,prefix='',out={}){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){assert(!entry.isSymbolicLink());const name=prefix+entry.name,file=path.join(directory,entry.name);if(entry.isDirectory())inventory(file,name+'/',out);else out[name]=fileInfo(file);}return out;
}
export const read=(directory,name)=>JSON.parse(fs.readFileSync(local(directory,name)));
export function write(directory,name,value){const f=local(directory,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value instanceof Uint8Array?value:json(value));}
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',thinsp:' ',ensp:' ',emsp:' ',lrm:'',rlm:''};
export const plain=value=>String(value??'').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,e)=>e[0]==='#'?String.fromCodePoint(parseInt(e.slice(e[1]?.toLowerCase()==='x'?2:1),e[1]?.toLowerCase()==='x'?16:10)):entities[e.toLowerCase()]??all);
export const norm=value=>plain(value).normalize('NFKD').replace(/[^א-ת]/g,'').replace(/ך/g,'כ').replace(/ם/g,'מ').replace(/ן/g,'נ').replace(/ף/g,'פ').replace(/ץ/g,'צ');
export const sectionOf=name=>{const i=Number(name.match(/\/(\d+)\.json$/)[1]);return i<=104?'Peri Tzadik, Bereshit '+(i-89):i<=116?'Peri Tzadik, Noach '+(i-106):i<=127?'Peri Tzadik, Lech Lecha '+(i-116):i<=165?'Peri Tzadik, Vayera '+(i-158):'Peri Tzadik, Chayei Sara '+(i-165);};
export const notesOf=rows=>rows.flatMap(row=>(row.footnotes||[]).map(note=>({row,note})));
export const sourceSlug=ref=>ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const navigates=source=>!source.citationOnly&&!source.openExternal&&source.ref;
export const readerRef=source=>source.readerRef||source.ref;
export const noteProjection=note=>[String(note.number),note.paragraphs.map(p=>plain(p.text)).concat((note.sources||[]).filter(s=>s.readerRef||s.openExternal).map(s=>s.readerRef?'Reader location: '+s.readerRef+'; original source citation: '+s.ref+' — '+s.url:'Original source: '+s.url)).join('\n'),note.phraseIndex,'h',note.heCharOffset];
const within=name=>CHAPTER_IDS.some(i=>name==='library/data/peri-tzadik/'+i+'.json');
export function permitted(name,pack){return within(name)||/^library\/data\/cited\/[^/]+\.json$/.test(name)||[LINKS,MCP,SUPPLEMENT,REPORT,LEDGER,'mcp-data/cited.json','mcp-data/catalog.json','library/data/packs/sources.json','library/data/files.json','library/downloads/index.json','library/index.html','library/sw.js',...ARCHIVES].includes(name);}
function sourceQuote(quote,pack){
  assert(quote&&quote.ref&&quote.url&&/[א-ת]/.test(quote.he)&&/[A-Za-z]/.test(quote.en),'Missing bilingual primary-source quotation');
  assert(/^https:\/\/(?:www\.)?(?:sefaria\.org|he\.wikisource\.org|wiki\.jewishbooks\.org\.il|hebrewbooks\.org|chabad\.org|nli\.org\.il|ybt\.org|search\.orhasulam\.org)\//.test(quote.url),'Unreviewed source host');
  const evidence=pack.sourceEvidence.find(e=>e.ref===quote.ref&&e.url===quote.url&&norm(e.he).includes(norm(quote.he)));
  assert(evidence?.verified===true,'Quotation lacks the inspected primary text');assert.equal(evidence.sha256,sha(evidence.he),'Primary source text changed');
}
export function validatePack(pack){
  assert.equal(pack.schemaVersion,1);assert.equal(pack.release,RELEASE);assert.equal(pack.audit?.completeReview,true);
  assert.deepEqual(pack.chapters.map(c=>c.path).sort(),CHAPTER_IDS.map(i=>'library/data/peri-tzadik/'+i+'.json').sort());
  assert.equal(pack.audit.originalNoteCount,1716);assert.equal(pack.audit.entries.length,1716);
  const ids=new Set(),oldIds=new Set(),additions=[],replacements=[],removals=[];
  const changes=new Map(pack.chapters.map(c=>[c.path,structuredClone(c.before)]));
  const beforeNotes=pack.chapters.flatMap(c=>notesOf(c.before).map(x=>({...x,path:c.path,sectionRef:sectionOf(c.path)})));
  assert.equal(beforeNotes.length,1716);assert.equal(new Set(beforeNotes.map(x=>x.note.placementId)).size,1716);
  for(const c of pack.chapters){assert.equal(c.beforeSha256,digest(c.before));assert.equal(c.sectionRef,sectionOf(c.path));}
  for(const op of pack.operations){
    assert(within(op.path)&&op.reviewed===true&&op.reason);assert.equal(op.sectionRef,sectionOf(op.path));assert.equal(op.originRef,op.sectionRef+':'+op.paragraph);
    assert(!ids.has(op.placementId),'Duplicate operation');ids.add(op.placementId);
    const rows=changes.get(op.path),row=rows.find(r=>r.n===op.paragraph);assert(row,'Unknown paragraph');
    assert(['add','replace','remove'].includes(op.action));const at=(row.footnotes||[]).findIndex(n=>n.placementId===op.placementId);
    if(op.action==='add'){assert.equal(at,-1);assert(!op.before);assert(!beforeNotes.some(x=>x.note.number===op.after.number||x.note.placementId===op.after.placementId||x.note.sourceId===op.after.sourceId),'New identity collision');additions.push(op);}
    else{assert(at>=0);assert.deepEqual(row.footnotes[at],op.before,'Exact existing note differs');oldIds.add(op.placementId);}
    if(op.action==='remove'){assert(!op.after);row.footnotes.splice(at,1);removals.push(op);continue;}
    const note=op.after,quote=op.quotation;sourceQuote(quote,pack);
    assert.equal(note.placementId,op.placementId);assert.equal(note.quotationOnly,true);assert.equal(note.verificationStatus,'verified');
    assert.equal(note.provenance.quotedSourceRelease,RELEASE);assert.equal(note.sources.length,1);assert.equal(note.sources[0].ref,quote.ref);assert.equal(note.sources[0].url,quote.url);
    assert.deepEqual(note.reviewedSourceExcerpt,quote);assert.equal(note.paragraphs.length,1);const citation=quote.citation||quote.ref,expected=citation+': “'+quote.en+'”';
    assert.deepEqual(note.paragraphs,[{language:'en',text:expected,rich:[{text:citation,bold:true,href:quote.url},{text:': “'+quote.en+'”'}]}],'Visible note must contain only the source label and quotation');
    assert(Number.isInteger(note.phraseIndex)&&row.p[note.phraseIndex]);const he=plain(row.p[note.phraseIndex][0]);
    assert(note.heCharOffset>0&&note.heCharOffset<=he.length,'Hebrew marker outside phrase');
    if(op.action==='add'){
      assert.equal(he.slice(0,note.heCharOffset),note.heAnchorPrefix,'New Hebrew anchor differs');
      assert(!(row.footnotes||[]).some(n=>(n.sources||[]).some(s=>s.ref===quote.ref)&&n.phraseIndex===note.phraseIndex),'Duplicate source added at the same phrase');
      (row.footnotes??=[]).push(note);
    }else{
      for(const k of ['number','sourceId','placementId'])assert.equal(note[k],op.before[k],'Existing identity changed');
      row.footnotes[at]=note;replacements.push(op);
    }
  }
  for(const change of pack.bodyCorrections||[]){
    assert(within(change.path)&&change.reviewed===true&&change.reason&&change.evidence);assert([0,1].includes(change.column));
    const row=changes.get(change.path).find(r=>r.n===change.paragraph);assert(row?.p[change.phraseIndex]);assert.equal(row.p[change.phraseIndex][change.column],change.before);
    if(change.column===0)assert.equal(plain(change.before),plain(change.after),'Author Hebrew changed');
    else if(plain(change.before)!==plain(change.after))assert(change.kind==='verified-attribution'||change.kind==='verified-reference-label','Unreviewed translation change');
    row.p[change.phraseIndex][change.column]=change.after;
  }
  for(const f of pack.formatCorrections||[]){
    assert(within(f.path)&&f.reviewed&&f.reason&&!ids.has(f.placementId));ids.add(f.placementId);
    const row=changes.get(f.path).find(r=>r.n===f.paragraph),i=row?.footnotes?.findIndex(n=>n.placementId===f.placementId);assert(i>=0);assert.deepEqual(row.footnotes[i],f.before);assert.equal(f.before.paragraphs.length,1);
    const before=structuredClone(f.before),after=structuredClone(f.after);delete before.paragraphs;delete before.quotationOnly;delete after.paragraphs;delete after.quotationOnly;assert.deepEqual(before,after);
    if(f.kind==='source-quotation-spacing'){
      const expected=structuredClone(f.before.paragraphs),space=value=>value.replace(/([.!?])(?=[A-Z])/g,'$1 ');
      for(const paragraph of expected){paragraph.text=space(paragraph.text);for(const run of paragraph.rich||[])run.text=space(run.text);}
      assert.notDeepEqual(expected,f.before.paragraphs,'Spacing correction must repair a missing sentence boundary');
      assert.deepEqual(f.after.paragraphs,expected,'Spacing correction changed source words');
      assert.equal(f.after.quotationOnly,true);row.footnotes[i]=f.after;continue;
    }
    const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),prefix=new RegExp('^'+escape(f.ref).replace(/ /g,'\\s+').replace(/:/g,':\\s*')+'[:.]\\s*(?:English translation of source:\\s*)?','i');
    let text=f.before.paragraphs[0].text,count=0;
    while(prefix.test(text)){text=text.replace(prefix,'').trim();count++;for(let j=0;j<4;j++){if(['‘’','“”','""',"''"].includes(text[0]+text.at(-1)))text=text.slice(1,-1).trim();else break;}}
    assert(count>=2);assert.equal(text,f.extractedQuotation,'Source words changed during formatting');
    assert.deepEqual(f.after.paragraphs,[{language:'en',text:f.ref+': “'+text+'”',rich:[{text:f.ref,bold:true,href:f.before.sources[0].url},{text:': “'+text+'”'}]}],'Formatting must preserve the full source-only visible paragraph');
    assert.equal(f.after.quotationOnly,true);row.footnotes[i]=f.after;
  }
  for(const c of pack.chapters){
    // Source operations never alter headings, paragraph order, or author text.
    assert.deepEqual(changes.get(c.path),c.after,'Chapter is not reconstructed by the exact reviewed operations');
    assert.deepEqual(c.before.map(r=>r.p?.map(p=>plain(p[0]))),c.after.map(r=>r.p?.map(p=>plain(p[0]))),'Hebrew body differs');
  }
  for(const old of beforeNotes){
    const entries=pack.audit.entries.filter(e=>e.placementId===old.note.placementId);assert.equal(entries.length,1);const entry=entries[0];assert(entry.reviewed&&entry.reason);assert.equal(entry.beforeSha256,digest(old.note));
    const op=pack.operations.find(o=>o.placementId===old.note.placementId),formatted=pack.formatCorrections?.some(f=>f.placementId===old.note.placementId);assert.equal(entry.status,op?op.action:formatted?'formatted':'retained');
  }
  // Preserve the independently corrected sugya, identity, and exact placement.
  // The present source-only review removes its earlier editorial explanation.
  const b1=pack.chapters.find(c=>c.path.endsWith('/90.json')),b2=rows=>notesOf(rows).find(x=>x.note.number===2)?.note,before2=b2(b1.before),after2=b2(b1.after);
  assert(before2&&after2);for(const key of ['number','sourceId','placementId','phraseIndex','heCharOffset','heAnchorPrefix','enCharOffset','enAnchorPrefix'])assert.deepEqual(after2[key],before2[key]);
  assert.equal(after2.sources.length,1);for(const key of ['ref','url'])assert.equal(after2.sources[0][key],before2.sources[0][key]);
  assert.equal(after2.sources[0].ref,'Rosh Hashanah 32a:18-19');assert(after2.reviewedSourceExcerpt&&norm(after2.reviewedSourceExcerpt.he).includes(norm('בראשית נמי מאמר הוא')));
  assert.equal(after2.paragraphs.length,1);assert.doesNotMatch(after2.paragraphs[0].text,/Context for Pri Tzaddik|Rabban Shimon ben Gamliel/i);
  assert.deepEqual(pack.supplementalSections.map(s=>s.sectionRef),[8,9,10].map(n=>'Peri Tzadik, Vayera '+n));
  for(const s of pack.supplementalSections){
    assert.equal(s.path,'library/data/peri-tzadik/9-'+s.sectionRef.split(' ').at(-1)+'.json');assert.equal(s.beforeSha256,digest(s.before));
    assert(Array.isArray(s.before)&&s.before.every(p=>typeof p==='string'));assert.equal(s.annotations.length,s.before.length);
    for(let i=0;i<s.annotations.length;i++)for(const note of s.annotations[i]){
      const op=pack.supplementalOperations.find(o=>o.placementId===note.placementId);assert(op&&op.reviewed&&op.reason);assert.equal(op.sectionRef,s.sectionRef);assert.equal(op.paragraph,i+1);assert.equal(op.originRef,s.sectionRef+':'+(i+1));assert.equal(op.action,'add');assert.deepEqual(op.after,note);assert(!ids.has(note.placementId));ids.add(note.placementId);
      sourceQuote(op.quotation,pack);const q=op.quotation,label=q.citation||q.ref;
      assert.deepEqual(note.paragraphs,[{language:'en',text:label+': “'+q.en+'”',rich:[{text:label,bold:true,href:q.url},{text:': “'+q.en+'”'}]}]);assert.equal(note.quotationOnly,true);assert.deepEqual(note.reviewedSourceExcerpt,q);assert.equal(note.phraseIndex,0);assert(note.heCharOffset>0);assert.equal(plain(s.before[i]).slice(0,note.heCharOffset),note.heAnchorPrefix);assert(!beforeNotes.some(x=>x.note.number===note.number||x.note.sourceId===note.sourceId));additions.push(op);
    }
  }
  assert.equal(pack.supplementalOperations.length,pack.supplementalSections.flatMap(s=>s.annotations.flat()).length);
  assert.equal(new Set(additions.map(o=>o.after.number)).size,additions.length,'Duplicate new note number');
  const allSections=[...pack.chapters,...pack.supplementalSections].map(c=>c.sectionRef);
  assert.deepEqual(Object.keys(pack.linksBefore).sort(),allSections.sort());assert.deepEqual(Object.keys(pack.linksAfter).sort(),Object.keys(pack.linksBefore).sort());
  assert.match(pack.connected.catalogSha256,/^[a-f0-9]{64}$/);assert.equal(pack.connected.entries.length,157);
  assert.deepEqual(Object.keys(pack.connected.numbers).sort(),pack.chapters.map(c=>c.sectionRef).sort());
  for(const e of pack.connected.entries){assert(e.reviewed&&e.contextMatched&&e.primaryTextMatched);assert.equal(pack.connected.numbers[e.sectionRef][e.id],e.number);assert.equal(e.quotationParagraph.text,(e.school==='Ishbitz–Radzin'?'Kisvei Ishbitz–Radzin':e.school)+' · '+e.ref+': “'+e.en+'”');}
  for(const op of [...additions,...replacements])for(const s of op.after.sources.filter(navigates))assert(pack.linksAfter[op.sectionRef].some(e=>e.a===op.originRef&&e.r===readerRef(s)),'Reviewed source missing from links');
  return{additions,replacements,removals};
}
function pinned(name,gzip=false,repo=REPO_ROOT){const f=local(repo,name),raw=fs.readFileSync(f),pin=fs.readFileSync(f+'.sha256','utf8').trim();assert.match(pin,/^[a-f0-9]{64}$/);assert.equal(sha(raw),pin,'Immutable review file changed');return{value:JSON.parse(gzip?gunzipSync(raw):raw),sha256:pin};}
export function loadPack({requireDescriptor=false,repo=REPO_ROOT}={}){
  const loaded=pinned(PACK,true,repo),pack=loaded.value,result={pack,packSha256:loaded.sha256,...validatePack(pack)};
  if(requireDescriptor){const sealed=pinned(DESCRIPTOR,false,repo);result.descriptor=sealed.value;result.descriptorSha256=sealed.sha256;assert.equal(result.descriptor.release,RELEASE);assert.equal(result.descriptor.packSha256,result.packSha256);for(const f of result.descriptor.files){assert(permitted(f.path,pack));for(const value of [f.before,f.after])if(value){assert(Number.isSafeInteger(value.bytes));assert.match(value.sha256,/^[a-f0-9]{64}$/);}}}
  return result;
}
export function checkPreimages(directory,prepared){
  const links=read(directory,LINKS);for(const c of prepared.pack.chapters){assert.deepEqual(read(directory,c.path),c.before,'Reviewed chapter changed since review: '+c.path);assert.deepEqual(links[c.sectionRef],prepared.pack.linksBefore[c.sectionRef],'Reviewed links changed since review');}
  for(const s of prepared.pack.supplementalSections){assert.deepEqual(read(directory,s.path),s.before,'Original Hebrew teaching changed');assert.deepEqual(links[s.sectionRef]||[],prepared.pack.linksBefore[s.sectionRef]);}
  assert.equal(fileInfo(local(directory,CONNECTED)).sha256,prepared.pack.connected.catalogSha256,'Existing Kisvei source catalogue changed');
  const added=prepared.additions.map(o=>o.after),all=[];for(const name of fs.readdirSync(local(directory,'library/data/peri-tzadik'))){if(/^\d+\.json$/.test(name)){const rows=read(directory,'library/data/peri-tzadik/'+name);if(Array.isArray(rows))all.push(...notesOf(rows).map(x=>x.note));}}
  for(const n of added)assert(!all.some(x=>x.number===n.number||x.sourceId===n.sourceId||x.placementId===n.placementId),'New note identity already used in Pri Tzaddik');
}
export function verifyPublication({directory,prepared=loadPack({requireDescriptor:true}),verifyAllBaseline=false}={}){
  const {pack,descriptor}=prepared;const report=read(directory,REPORT);assert.equal(report.release,RELEASE);assert.equal(report.packSha256,prepared.packSha256);assert.equal(report.descriptorSha256,prepared.descriptorSha256);assert.equal(report.verification?.ok,true);
  assert.deepEqual(report.counts,descriptor.counts);assert.deepEqual(report.changedFiles,descriptor.files.map(f=>({path:f.path,...f.after})));
  for(const f of descriptor.files)assert.deepEqual(fileInfo(local(directory,f.path)),f.after,'Reviewed terminal file differs: '+f.path);
  for(const c of pack.chapters)assert.deepEqual(read(directory,c.path),c.after);assert.deepEqual(read(directory,LEDGER),pack.audit);
  assert.deepEqual(read(directory,SUPPLEMENT),Object.fromEntries(pack.supplementalSections.map(s=>[s.sectionRef,s.annotations])));assert.equal(fileInfo(local(directory,CONNECTED)).sha256,pack.connected.catalogSha256);
  const links=read(directory,LINKS),mcp=read(directory,MCP),cited=read(directory,'mcp-data/cited.json');
  for(const c of pack.chapters){assert.deepEqual(links[c.sectionRef],pack.linksAfter[c.sectionRef]);for(const row of c.after.filter(r=>r.n)){
    const para=mcp.paras.find(p=>p.r===c.sectionRef+':'+row.n&&p.p);assert(para);assert.deepEqual(para.p,row.p.map(pair=>pair.map(plain)),'MCP body differs');assert.deepEqual(para.f||[],(row.footnotes||[]).map(noteProjection),'MCP notes differ');
  }}
  for(const s of pack.supplementalSections){assert.deepEqual(read(directory,s.path),s.before);assert.deepEqual(links[s.sectionRef],pack.linksAfter[s.sectionRef]);s.annotations.forEach((notes,i)=>{const para=mcp.paras.find(p=>p.r===s.sectionRef+':'+(i+1)&&!p.p);assert(para);assert.equal(para.t,plain(s.before[i]));assert.deepEqual(para.f||[],notes.map(noteProjection));});}
  for(const op of [...prepared.additions,...prepared.replacements])for(const s of op.after.sources.filter(navigates)){
    const ref=readerRef(s);assert(cited[ref]?.includes(op.originRef));assert(read(directory,'library/data/cited/'+sourceSlug(ref)+'.json')[ref]?.includes(op.originRef));
  }
  for(const predecessor of descriptor.predecessors)assert.deepEqual(fileInfo(local(directory,predecessor.path)),onlyInfo(predecessor),'Historical publication report changed');
  assert.equal(digest(report.baselineFiles),descriptor.baselineInventorySha256,'Baseline inventory differs from the sealed descriptor');
  if(verifyAllBaseline){const after=inventory(directory),before=report.baselineFiles,changed=new Map(descriptor.files.map(f=>[f.path,f.after]));assert(before&&Object.keys(before).length>1000);for(const [name,value]of Object.entries(before))assert.deepEqual(after[name],changed.get(name)||value,'Unrelated published file changed: '+name);for(const name of Object.keys(after))assert(before[name]||changed.has(name)||name===REPORT,'Unexpected publication file');}
  return{...prepared,report,proof:{release:RELEASE,packSha256:prepared.packSha256,descriptorSha256:prepared.descriptorSha256,...descriptor.counts,hebrewAuthorTextUnchanged:true,unrelatedFilesUnchanged:true}};
}
// A precise independent successor for earlier book-preservation gates. Each
// overlap is bound to its authenticated predecessor before exposing new hashes.
export function preparePriParshaTransition({directory,batches,terminalFiles,independentFiles}){
  if(!fs.existsSync(local(directory,REPORT)))return null;
  const verified=verifyPublication({directory});const {descriptor}=verified;
  for(const f of descriptor.files){const prior=terminalFiles.get(f.path)||batches.at(-1).report.baselineFiles[f.path];if(prior)assert.deepEqual(onlyInfo(prior),f.before,'Unknown Pri review predecessor: '+f.path);else assert.equal(f.before,null,'Unrecognized pre-existing Pri publication path');terminalFiles.set(f.path,{path:f.path,...f.after});independentFiles.set(f.path,f.after);}
  independentFiles.set(REPORT,fileInfo(local(directory,REPORT)));
  return verified;
}

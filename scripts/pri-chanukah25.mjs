// A new, independently reviewed edition of the six original paragraphs.
// Publish after the historical uploaded-note imports, before the cleanup seal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {categoryOf, normalizeRef} from './citations.mjs';
import {linkedText} from './pri-shevat-tubishvat.mjs';

export const CHANUKAH25_REF = 'Peri Tzadik, Chanukah 25';
export const CHANUKAH25_RELEASE = '20261020-chanukah25-interlinear-v1';
export const CHANUKAH25_REPORT = 'pri-chanukah25-publication.json';
export const CHANUKAH25_FIRST_NOTE = 5553; // after the complete, unchanged uploaded series
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(REPO, 'sources/akiva/chanukah25');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const letters = text => String(text).normalize('NFD').replace(/[^א-ת]/gu, '');
const filesIn = directory => fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory()
  ? filesIn(path.join(directory,entry.name)) : [path.join(directory,entry.name)]).sort();
const plain = value => String(value).replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key) => {
  if (key[0] === '#') return String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1)));
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[key.toLowerCase()] ?? all;
});
const safeSource = source => {
  assert.equal(normalizeRef(source.ref),source.ref,'Noncanonical verified reference: '+source.ref);
  const url = new URL(source.url);
  assert.equal(url.origin,'https://www.sefaria.org');
  assert.doesNotMatch(url.pathname,/^\/(?:api|search|topics|sheets)(?:\/|$)/i);
  assert.ok(url.pathname.length>1);
};
const body = rows => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key])=>key!=='footnotes')));
export const canonical = value => JSON.stringify((function ordered(v){return Array.isArray(v)?v.map(ordered):v&&typeof v==='object'
  ?Object.fromEntries(Object.keys(v).sort().map(key=>[key,ordered(v[key])])):v;})(value));

export function readChanukah25() {
  const paragraphs = Array.from({length:6},(_,index)=>{
    const file=path.join(SOURCE,`paragraph-${index+1}.json`),bytes=fs.readFileSync(file),p=JSON.parse(bytes);
    assert.equal(p.schemaVersion,1);assert.equal(p.sectionRef,CHANUKAH25_REF);
    assert.equal(p.ref,`${CHANUKAH25_REF}:${index+1}`);assert.equal(p.paragraphNumber,index+1);
    assert.equal(sha256(p.source.originalHtml),p.source.originalHtmlSha256);
    assert.equal(sha256(p.source.originalText),p.source.originalTextSha256);
    assert.equal(plain(p.source.originalHtml).replace(/\s+/gu,' ').trim(),p.source.originalText);
    assert.equal(p.source.versionTitle,'Pri Tzaddik, Lublin, 1901');
    assert.equal(p.phraseCount,p.phrases.length);assert.ok(p.phrases.length>0);
    let offset=0;
    for (const [i,phrase] of p.phrases.entries()) {
      assert.equal(phrase.id,`chanukah-25-${index+1}-${String(i+1).padStart(3,'0')}`);
      assert.equal(phrase.sourceStart,offset);assert.ok(phrase.sourceEnd>offset);
      assert.equal(phrase.source,p.source.originalText.slice(offset,phrase.sourceEnd));offset=phrase.sourceEnd;
      assert.match(phrase.he,/[א-ת]/);assert.match(phrase.he,/[\u05b0-\u05bc\u05c1\u05c2\u05c7]/);
      assert.match(phrase.en,/[A-Za-z]/);assert.doesNotMatch(phrase.he+phrase.en,/<[^>]*>|[\ufffd\u0600-\u06ff]/);
      assert.doesNotMatch(phrase.en,/[\[\]]/,'English body brackets must be removed without losing meaning');
      let expected='',cursor=phrase.sourceStart;
      for (const adjustment of phrase.adjustments || []) {
        assert.ok(['abbreviation-expansion','proposed-ocr-correction','source-spacing-repair'].includes(adjustment.type));
        assert.ok(adjustment.sourceStart>=cursor && adjustment.sourceEnd<=phrase.sourceEnd);
        assert.equal(p.source.originalText.slice(adjustment.sourceStart,adjustment.sourceEnd),adjustment.source);
        assert.ok(adjustment.replacement && adjustment.status);
        if (adjustment.type==='proposed-ocr-correction') {
          assert.ok(adjustment.note,'Every proposed correction needs a visible explanation');
          assert.ok(phrase.en.includes(adjustment.source),'English must disclose the original reading');
        }
        expected+=p.source.originalText.slice(cursor,adjustment.sourceStart)+adjustment.replacement;
        cursor=adjustment.sourceEnd;
      }
      expected+=p.source.originalText.slice(cursor,phrase.sourceEnd);
      assert.equal(letters(phrase.he),letters(expected),'Unaccounted consonantal change: '+phrase.id);
    }
    assert.equal(offset,p.source.originalText.length,'Incomplete original paragraph');
    assert.equal(p.phrases.map(x=>x.source).join(''),p.source.originalText);
    return {...p,fileSha256:sha256(bytes)};
  });
  const editorialBytes=fs.readFileSync(path.join(SOURCE,'editorial.json'));
  const editorial=JSON.parse(editorialBytes),review=read(path.join(SOURCE,'independent-review.json'));
  assert.equal(editorial.schemaVersion,1);assert.equal(editorial.ref,CHANUKAH25_REF);
  assert.equal(review.schemaVersion,1);assert.equal(review.ref,CHANUKAH25_REF);
  assert.equal(review.status,'independently-reviewed');
  assert.equal(review.reviewedWholeSection,true);assert.equal(review.printedScanVerified,false);
  assert.equal(review.editorialSha256,sha256(editorialBytes));
  assert.deepEqual(review.paragraphs.map(p=>[p.ref,p.sha256,p.phraseCount]),paragraphs.map(p=>[p.ref,p.fileSha256,p.phrases.length]));
  assert.ok(review.paragraphs.every(p=>p.completeSemanticReview===true && p.completeSourceReview===true && p.assessment));
  assert.deepEqual(editorial.paragraphs.map(p=>p.number),[1,2,3,4,5,6]);
  const evidence=new Map();
  for (const source of editorial.primarySources) {
    assert.ok(!evidence.has(source.id));safeSource(source);
    assert.ok(source.verified && source.versionTitle && source.hebrew && source.verification);
    assert.equal(source.hebrewSha256,sha256(source.hebrew));evidence.set(source.id,source);
  }
  const noteIds=new Set(),legacyNumbers=new Set();
  for (const [i,entry] of editorial.paragraphs.entries()) {
    const p=paragraphs[i],ids=new Map(p.phrases.map((phrase,index)=>[phrase.id,index]));
    let last=-1;
    for (const heading of entry.headings || []) {
      assert.ok(Number.isInteger(heading.phraseIndex)&&heading.phraseIndex>last&&heading.phraseIndex<p.phrases.length);
      assert.match(heading.text,/[A-Za-z]/);last=heading.phraseIndex;
    }
    for (const source of entry.citations || []) {
      assert.ok(ids.has(source.phraseId));safeSource(source);
      const witness=evidence.get(source.evidenceId);assert.ok(witness && witness.ref===source.ref);
      assert.ok(source.reviewed && source.hebrewText && source.englishText);
      const phrase=p.phrases[ids.get(source.phraseId)];
      linkedText(phrase.he,[source],'hebrew');linkedText(phrase.en,[source],'english');
    }
    for (const note of entry.notes || []) {
      assert.ok(ids.has(note.phraseId));assert.ok(!noteIds.has(note.id));noteIds.add(note.id);
      const witness=evidence.get(note.evidenceId);assert.ok(witness && witness.ref===note.ref);safeSource(note);
      assert.ok(note.reviewed && note.translationProvenance && note.explanation);
      assert.match(note.hebrew,/[א-ת]/);assert.match(note.english,/[A-Za-z]/);
      assert.doesNotMatch(note.english,/[\[\]]/,'English source quotations must retain the reviewed readable presentation');
      assert.ok(letters(witness.hebrew).includes(letters(note.hebrew)),'Noncontiguous or invented primary quotation: '+note.id);
      assert.doesNotMatch(note.hebrew,/\.\.\.|…/,'Source notes use contiguous excerpts');
      if (note.legacyIdentity) {
        const legacy=note.legacyIdentity;
        assert.equal(i,5,'Misplaced Chanukah24 notes belong to the sixth original paragraph of Chanukah25');
        assert.ok(Number.isInteger(legacy.number)&&legacy.number>=1658&&legacy.number<=1664,
          'Only the seven explicitly reconciled source notes may retain a legacy identity');
        assert.ok(!legacyNumbers.has(legacy.number),'A misplaced note may be reconciled only once');
        legacyNumbers.add(legacy.number);
        assert.equal(legacy.sourceId,`PT-${legacy.number}`);
        assert.equal(legacy.placementId,`PT-${legacy.number}-1`);
        assert.equal(legacy.uploadedNumber,legacy.number+11);
        assert.match(legacy.fromRef,/^Peri Tzadik, Chanukah 24:[3-6]$/);
      }
    }
    assert.ok(entry.notes?.length,'Every original paragraph must have its verified supporting sources');
  }
  assert.deepEqual([...legacyNumbers].sort((a,b)=>a-b),[1658,1659,1660,1661,1662,1663,1664],
    'All seven distinct misplaced source notes must have an explicit reviewed successor');
  assert.equal(noteIds.size,36,'The complete reviewed edition contains 31 core notes and five distinct migrated sources');
  return {paragraphs,editorial,review,editionSha256:sha256(paragraphs.map(p=>p.fileSha256).join('\n')+'\n'+sha256(editorialBytes))};
}

export function compileChanukah25(storageId) {
  const pack=readChanukah25(),items=[{h:pack.editorial.title}],links=[],seen=new Set();
  let noteIndex=0;
  for (const [i,p] of pack.paragraphs.entries()) {
    const entry=pack.editorial.paragraphs[i],connections=new Map();
    const record=source=>{
      connections.set(source.ref,{ref:source.ref,url:source.url,label:source.label || source.ref});
      const a=`${CHANUKAH25_REF}:${i+1}`,key=a+'\0'+source.ref;
      if (!seen.has(key)) {seen.add(key);links.push({a,r:source.ref,c:categoryOf(source.ref)});}
    };
    const pairs=p.phrases.map(phrase=>{
      const citations=(entry.citations || []).filter(source=>source.phraseId===phrase.id);citations.forEach(record);
      return [linkedText(phrase.he,citations,'hebrew'),linkedText(phrase.en,citations,'english')];
    });
    const footnotes=(entry.notes || []).map(note=>{
      record(note);const phraseIndex=p.phrases.findIndex(phrase=>phrase.id===note.phraseId),phrase=p.phrases[phraseIndex];
      const sourceId=`PT-CH25-${String(++noteIndex).padStart(4,'0')}`,number=CHANUKAH25_FIRST_NOTE+noteIndex-1;
      const quotation={text:`${note.ref}: “${note.english}”`,language:'en',rich:[
        {text:note.ref,bold:true,href:note.url},{text:`: “${note.english}”`}]};
      return {sourceId,placementId:sourceId+'-1',number,phraseIndex,
        heCharOffset:phrase.he.length,enCharOffset:phrase.en.length,heAnchorPrefix:phrase.he,enAnchorPrefix:phrase.en,
        heWord:phrase.he.trim().split(/\s+/u).length,
        paragraphs:[quotation],
        sources:[{ref:note.ref,url:note.url,role:'primary-source'}],nativeConnections:[],verificationStatus:'verified',
        reviewedSourceExcerpt:{schemaVersion:1,ref:note.ref,
          he:note.hebrew,en:note.english,provenance:note.translationProvenance,coverage:'excerpt'},
        provenance:{edition:'Akiva Publishing · Chanukah 25 interlinear edition',importRelease:CHANUKAH25_RELEASE,
          section:CHANUKAH25_REF,item:i+1,sourceFile:`${storageId}.json`,sourceId,
          primaryEvidenceId:note.evidenceId,reviewedNoteId:note.id,editionSha256:pack.editionSha256,
          sourceQuotationRelease:{versionTitle:note.translationProvenance,license:'© Akiva Publishing'},
          explanation:note.explanation,
          ...(note.legacyIdentity?{legacyIdentity:note.legacyIdentity}:{}),
          method:'Original English source quotation checked against the cited primary context. Hebrew evidence and editorial explanation retained in metadata only.'}};
    });
    items.push({n:i+1,p:pairs,keepPairs:true,...(entry.headings?.length?{inlineHeadings:entry.headings}:{}),
      connections:[...connections.values()],footnotes});
  }
  return {pack,items,links,noteCount:noteIndex};
}

// A tightly validated successor is the only permitted extension of historical
// 124-section / 5,539-note audit scopes. Unknown extra sections still fail.
export function validatePublishedChanukah25(leaf,rows) {
  assert.equal(leaf.ref,CHANUKAH25_REF);assert.equal(leaf.chanukah25Edition,CHANUKAH25_RELEASE);
  assert.equal(leaf.depth,1);assert.equal(leaf.shape,6);assert.equal(leaf.interlinear,true);
  assert.ok(Number.isSafeInteger(leaf.id)&&leaf.id>201);
  const compiled=compileChanukah25(leaf.id);
  assert.equal(leaf.editionSha256,compiled.pack.editionSha256);
  assert.deepEqual(rows,compiled.items,'The new Chanukah edition differs from independently reviewed content');
  return {...compiled,file:`${leaf.id}.json`,leaf};
}

export function publishedChanukah25(library='dist/library') {
  const directory=path.join(library,'data/peri-tzadik'),toc=read(path.join(directory,'toc.json'));
  const matches=walk(toc.toc).filter(leaf=>leaf.interlinear&&leaf.ref===CHANUKAH25_REF);
  assert.ok(matches.length<=1,'Duplicate Chanukah25 edition');
  if (!matches.length) return null;
  return validatePublishedChanukah25(matches[0],read(path.join(directory,`${matches[0].id}.json`)));
}

export function publishChanukah25(library='dist/library') {
  const root=path.resolve(library),data=path.join(root,'data'),directory=path.join(data,'peri-tzadik');
  const tocFile=path.join(directory,'toc.json'),toc=read(tocFile),study=toc.toc.children[0];
  assert.equal(study.en,'Akiva Publishing — Interlinear Study Edition');
  const matches=walk(toc.toc).filter(leaf=>leaf.interlinear&&leaf.ref===CHANUKAH25_REF);assert.ok(matches.length<=1);
  const previous=matches[0];
  const maxId=Math.max(...fs.readdirSync(directory).flatMap(file=>/^\d+(?:-\d+)*\.json$/.test(file)?[Number(file.split(/[-.]/)[0])]:[]));
  const id=previous?.id ?? maxId+1;assert.ok(id>201,'Publish after the existing Toldos, Shabbos and Shevat editions');
  const ownFile=path.join(directory,`${id}.json`),compiled=compileChanukah25(id),{pack,items,links:ownLinks}=compiled;
  if (previous) validatePublishedChanukah25(previous,read(ownFile));
  const oldNotes=fs.readdirSync(directory).filter(file=>/^\d+(?:-\d+)*\.json$/.test(file)&&file!==`${id}.json`)
    .flatMap(file=>read(path.join(directory,file)).flatMap(item=>item.footnotes||[]));
  assert.equal(oldNotes.length,5539,'Publish after all historical supplied notes');
  assert.equal(new Set(oldNotes.map(note=>note.number)).size,5539);
  assert.ok(oldNotes.every(note=>note.number<CHANUKAH25_FIRST_NOTE));
  const protectedFiles=new Map(filesIn(data).filter(file=>file!==ownFile).map(file=>[file,fs.readFileSync(file)]));
  const protectedBodies=Object.fromEntries([...protectedFiles].filter(([file])=>/^\d+(?:-\d+)*\.json$/.test(path.basename(file))&&path.dirname(file)===directory)
    .map(([file,bytes])=>[path.basename(file),sha256(canonical(body(JSON.parse(bytes))))]));
  const originalHebrew=path.join(directory,'16-25.json');assert.ok(fs.existsSync(originalHebrew));
  const staged=new Map();
  const stage=(file,value)=>{const bytes=Buffer.from(JSON.stringify(value));
    if (fs.existsSync(file)&&JSON.stringify(read(file))===JSON.stringify(value)) return;
    staged.set(file,bytes);};
  stage(ownFile,items);
  const oldStudy=study.children.filter(leaf=>leaf.ref!==CHANUKAH25_REF);
  const after=oldStudy.findIndex(leaf=>leaf.ref==='Peri Tzadik, Chanukah 24');assert.ok(after>=0);
  const leaf={en:pack.editorial.title,he:'חנוכה · אות כ״ה',id,depth:1,shape:6,il1:true,interlinear:true,
    ref:CHANUKAH25_REF,heRef:'פרי צדיק, חנוכה · אות כ״ה',sep:':',parashah:'Chanukah',ois:25,
    chanukah25Edition:CHANUKAH25_RELEASE,editionSha256:pack.editionSha256,
    sourceUrl:'https://www.sefaria.org/Peri_Tzadik,_Chanukah.25'};
  study.children=[...oldStudy.slice(0,after+1),leaf,...oldStudy.slice(after+1)];stage(tocFile,toc);
  const linksFile=path.join(directory,'links.json'),allLinks=read(linksFile),priorOwnLinks=allLinks[CHANUKAH25_REF]||[];
  allLinks[CHANUKAH25_REF]=ownLinks;stage(linksFile,allLinks);
  const catalogFile=path.join(data,'catalog.json'),catalog=read(catalogFile),book=catalog.find(book=>book.slug==='peri-tzadik');
  assert.equal(book.title,'Peri Tzadik');book.segments+=previous?0:6;book.akiva=true;book.ilParts=true;stage(catalogFile,catalog);
  const cited=path.join(data,'cited'),reverse=new Map(),ownAnchor=anchor=>anchor.startsWith(CHANUKAH25_REF+':');
  for (const file of fs.readdirSync(cited).filter(file=>file.endsWith('.json')&&!['index.json','search.json'].includes(file))) {
    const refs=read(path.join(cited,file));
    for (const [ref,anchors] of Object.entries(refs)) {const retained=anchors.filter(anchor=>!ownAnchor(anchor));if(retained.length)refs[ref]=retained;else delete refs[ref];}
    reverse.set(file,refs);
  }
  const slugOf=ref=>ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  for (const link of ownLinks) {const filename=slugOf(link.r)+'.json';assert.notEqual(filename,'.json');
    if(!reverse.has(filename))reverse.set(filename,{});const refs=reverse.get(filename),anchors=refs[link.r]??=[];
    if(!anchors.includes(link.a))anchors.push(link.a);}
  for (const [file,refs] of reverse) stage(path.join(cited,file),refs);
  const citedIndex=path.join(cited,'index.json');stage(citedIndex,[...new Set([...read(citedIndex),...[...reverse.keys()].map(file=>file.slice(0,-5))])].sort());
  const sourcePackFile=path.join(data,'packs/sources.json'),sourcePack=read(sourcePackFile);
  sourcePack.refs=[...new Set([...sourcePack.refs,...ownLinks.filter(link=>!catalog.some(book=>link.r===book.title||link.r.startsWith(book.title+',')||link.r.startsWith(book.title+' '))).map(link=>link.r)])].sort();
  stage(sourcePackFile,sourcePack);
  const htmlFile=path.join(root,'index.html'),swFile=path.join(root,'sw.js'),start='const editionDataUrl = url => ';
  const edition=CHANUKAH25_RELEASE+'-'+pack.editionSha256.slice(0,12);
  let html=fs.readFileSync(htmlFile,'utf8');assert.equal(html.split(start).length,2);
  const prefix=`(url.startsWith('data/peri-tzadik/') || url.startsWith('data/cited/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition=${edition}' : `;
  if(!html.includes(prefix))html=html.replace(start,start+prefix);staged.set(htmlFile,Buffer.from(html));
  let sw=fs.readFileSync(swFile,'utf8');assert.match(sw,/const SHELL = `[^`]+`;/);
  const suffix='-chanukah25-'+pack.editionSha256.slice(0,12);
  if(!sw.includes(suffix))sw=sw.replace(/const SHELL = `([^`]+)`;/,`const SHELL = \`$1${suffix}\`;`);staged.set(swFile,Buffer.from(sw));
  const dataFiles=[...new Set([...filesIn(data),...[...staged.keys()].filter(file=>file.startsWith(data+path.sep))])].filter(file=>file!==path.join(data,'files.json')).sort();
  const manifestHash=createHash('sha256');let bytes=0;
  for(const file of dataFiles){const value=staged.get(file)||fs.readFileSync(file);manifestHash.update(path.relative(data,file).split(path.sep).join('/')).update('\0').update(value);bytes+=value.length;}
  stage(path.join(data,'files.json'),{version:manifestHash.digest('hex').slice(0,16),bytes,files:dataFiles.map(file=>path.relative(data,file).split(path.sep).join('/'))});
  const report={schemaVersion:1,release:CHANUKAH25_RELEASE,ref:CHANUKAH25_REF,id,editionSha256:pack.editionSha256,
    paragraphs:6,phrasePairs:pack.paragraphs.reduce((n,p)=>n+p.phrases.length,0),sourceNotes:compiled.noteCount,
    sourceLinks:ownLinks.length,chapterSha256:sha256(JSON.stringify(items)),edition,
    originalHebrewFile:'16-25.json',originalHebrewSha256:sha256(fs.readFileSync(originalHebrew)),
    protectedBodies,originalNotesPreservedAtPublication:true,priorNoteCount:5539,
    priorLinkCount:priorOwnLinks.length,independentReviewSha256:sha256(fs.readFileSync(path.join(SOURCE,'independent-review.json')))};
  const reportFile=path.join(root,CHANUKAH25_REPORT),priorReport=previous?read(reportFile):null;
  if(priorReport){assert.equal(priorReport.editionSha256,pack.editionSha256);assert.equal(priorReport.chapterSha256,report.chapterSha256);}
  else stage(reportFile,report);
  for(const [file,old] of protectedFiles)assert.deepEqual(fs.readFileSync(file),old,'Concurrent data change: '+file);
  const backups=new Map(),prepared=[];
  try {
    for(const [file,value]of staged){assert.ok(!fs.existsSync(file)||fs.lstatSync(file).isFile());
      backups.set(file,fs.existsSync(file)?fs.readFileSync(file):null);fs.mkdirSync(path.dirname(file),{recursive:true});
      const temporary=file+'.chanukah25.tmp';fs.writeFileSync(temporary,value,{flag:'wx'});prepared.push({file,temporary});}
    for(const {file,temporary}of prepared)fs.renameSync(temporary,file);
    publishedChanukah25(root);
    for(const [file,old]of protectedFiles)if(!staged.has(file))assert.deepEqual(fs.readFileSync(file),old,'Unrelated data changed: '+file);
    assert.deepEqual(read(tocFile).toc.children[0].children.filter(node=>node.ref!==CHANUKAH25_REF),oldStudy);
  } catch(error) {
    for(const [file,old]of backups)if(old===null){if(fs.existsSync(file))fs.unlinkSync(file);}else fs.writeFileSync(file,old);
    throw error;
  } finally {for(const {temporary}of prepared)if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  console.log(`PASS Chanukah25: six complete original paragraphs, ${report.phrasePairs} reviewed phrase pairs, ${report.sourceNotes} English source notes; prior editions and all 5,539 historical notes preserved.`);
  return priorReport || report;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const at=process.argv.indexOf('--root');publishChanukah25(at>=0?process.argv[at+1]:'dist/library');
}

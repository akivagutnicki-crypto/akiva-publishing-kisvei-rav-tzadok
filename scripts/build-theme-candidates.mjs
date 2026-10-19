#!/usr/bin/env node
// Internal retrieval worklists. Nothing produced here is an approved connection.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readStudyCorpus} from './build-theme-review-progress.mjs';

const require=createRequire(import.meta.url);
const sources=require('../dist/library/source-connections.js');
export const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const INTERNAL_ROOT=path.join(REPO,'artifacts/connected-ideas');
export const DEFAULT_OUTPUT=path.join(INTERNAL_ROOT,'theme-candidates');
export const SCHOOLS=['Kisvei Rav Tzadok','Ishbitz–Radzin'];
export const METHOD='lexical-citation-discovery-v1';
export const CAUTION='Unreviewed retrieval candidates only. Shared words, translated wording, and citations locate passages; they do not establish a relevant conceptual connection or verify a translation. Exact Hebrew homographs may have different meanings in context. No generated result completes editorial review.';
export const sha=value=>createHash('sha256').update(value).digest('hex');
const normalized=sources.normalizedHebrew;
const heOf=p=>p.p?p.p.map(pair=>pair[0] || '').join(' '):p.t || '';
const enOf=p=>p.p?p.p.map(pair=>pair[1] || '').join(' '):'';
const HE_STOP=new Set(normalized('של את על אל עם גם זה זו זאת אלו הוא היא הם הן היה היו אשר כי אם או לא אין יש כל כן כך כמו שם שם יתברך השם הקב״ה זכרונם לברכה חז״ל ז״ל וכו וכולי וכמו אמר אמרו אומר כתוב שנאמר נאמר רצה לומר היינו ועל וכן אבל רק עוד מה מי בו בה לו לה בהן בהם לזה והוא והיא ועל ידי ידי').split(' '));
const EN_STOP=new Set('the and that this these those with from into upon they them their there here then than when where what which whose whom each both also only even very have has had been being were was are his her its our your you who for not but all can may must should would could will shall said says saying say words word written blessed hashem god lord torah sages concerning means meaning known see such through therefore about before after other because itself himself themselves oneself person people world holy'.split(' '));
// Publication formulas are useful bibliographic text, but poor thematic leads.
for(const word of normalized('קנטרס קונטרס קראתיו דשמיא סיעתא בסיעתא בסייעתא בסד כתבתי נכתב רשמתי רשום לעיל לקמן עיין יעוין במקום בזה כאן').split(' '))HE_STOP.add(word);
for(const word of 'pamphlet booklet volume chapter introduction titled entitled'.split(' '))EN_STOP.add(word);

export function safeInternalOutput(value) {
  const output=path.resolve(value || DEFAULT_OUTPUT);
  assert(output.startsWith(INTERNAL_ROOT+path.sep),'Candidate output must stay inside the ignored artifacts/connected-ideas directory, outside published and editorial inputs');
  // Do not allow an existing symlink to redirect otherwise-safe output.
  let parent=output;
  const exists=p=>{try{fs.lstatSync(p);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  while(!exists(parent))parent=path.dirname(parent);
  assert(fs.realpathSync(parent)===parent,'Candidate output cannot pass through a symbolic link');
  return output;
}
export function writeInternalFile(file,bytes) {
  const destination=safeInternalOutput(file);
  // Check descendants too, before mkdir or truncating an existing file.
  fs.mkdirSync(path.dirname(destination),{recursive:true});safeInternalOutput(destination);
  const fd=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|(fs.constants.O_NOFOLLOW || 0),0o644);
  try{fs.writeFileSync(fd,bytes);}finally{fs.closeSync(fd);}
}

export function translationAvailability(paragraph) {
  const pairs=paragraph.p || [];
  const required=pairs.map((pair,index)=>({index,he:String(pair[0] || '').trim(),en:String(pair[1] || '').trim()})).filter(pair=>pair.he);
  const missing=required.filter(pair=>!pair.en).map(pair=>pair.index);
  return {status:!required.length || required.length===missing.length?'missing':missing.length?'partial':'present-for-all-Hebrew-phrases',
    requiredPhrases:required.length || (String(paragraph.t || '').trim()?1:0),
    translatedPhrases:required.length-missing.length,missingPhraseIndexes:required.length?missing:String(paragraph.t || '').trim()?[0]:[],
    provenance:'Existing published canonical English; this discovery run has not reviewed its accuracy or supplied new translation.'};
}

function citationLocation(place) {
  if(!Array.isArray(place))return {kind:'unlocated-published-metadata',weight:.2};
  if(place[0]==='n')return {kind:'footnote',note:String(place[1] || ''),weight:.2};
  return {kind:place[1]==='h'?'Hebrew-body':'English-body',phraseIndex:place[0],offset:place[2],weight:place[1]==='h'?1:.5};
}
export function citationsOf(paragraph) {
  const refs=new Set([...Object.keys(paragraph.a || {}),...(paragraph.c || []).map(item=>item[0])]);
  return [...refs].filter(ref=>typeof ref==='string' && ref.trim()).sort().map(ref=>{
    const canonical=sources.normalizeRef(ref),parsed=sources.parseRef(canonical);
    return {ref:canonical,...citationLocation(paragraph.a?.[ref]),
      granularity:!parsed?'unresolved-reference':parsed.daf&&parsed.depth===1?'whole-folio':parsed.depth===1?'section-level':'segment-or-range'};
  });
}

export function loadCanonicalDocuments(mcpRoot=path.join(REPO,'dist/mcp-data')) {
  mcpRoot=path.resolve(mcpRoot);
  const corpus=readStudyCorpus(mcpRoot),rawBooks=new Map(),books=new Map(corpus.books.map(book=>[book.slug,book]));
  for(const book of corpus.books){
    const bytes=fs.readFileSync(path.join(mcpRoot,'text',book.slug+'.json'));
    assert(sha(bytes)===corpus.sourceFiles.find(file=>file.book===book.slug).sha256,'Canonical data changed while selecting default editions: '+book.slug);
    rawBooks.set(book.slug,JSON.parse(bytes));
  }
  const documents=[...corpus.paragraphs.values()].map(row=>{
    const book=books.get(row.book),paragraph=rawBooks.get(row.book).paras[row.index];
    assert(paragraph.r===row.ref,'Canonical default-edition pointer changed: '+row.ref);
    return {...row,bookTitle:book.book,school:book.school,bookOrder:corpus.books.indexOf(book),
      sectionOrder:book.sections.findIndex(section=>section.ref===row.sectionRef),sectionIndex:paragraph.s,number:paragraph.n,
      hebrew:heOf(paragraph),english:enOf(paragraph),citations:citationsOf(paragraph),
      translation:translationAvailability(paragraph),canonicalParagraphSha256:sha(JSON.stringify(paragraph))};
  }).sort((a,b)=>a.bookOrder-b.bookOrder || a.sectionOrder-b.sectionOrder || a.order-b.order || a.ref.localeCompare(b.ref));
  return {corpus,documents,rawBooks,mcpRoot};
}

function termCounts(document) {
  const counts=new Map();
  const add=key=>counts.set(key,(counts.get(key) || 0)+1);
  let words=0;
  for(const [lang,value,stop,pattern] of [['he',document.hebrew,HE_STOP,/^[א-ת]{2,}$/u],['en',document.english,EN_STOP,/^[a-z]{3,}$/]]) {
    const tokens=normalized(value).split(' ');words+=tokens.length;
    for(let i=0;i<tokens.length;i++) {
      const word=tokens[i];
      if(!pattern.test(word) || stop.has(word))continue;
      add(lang+':'+word);
      // Preserve actual adjacency; removing stopwords must not invent a phrase.
      const next=tokens[i+1];
      if(next && pattern.test(next) && !stop.has(next))add(lang+'p:'+word+' '+next);
    }
  }
  return {counts,length:Math.max(1,words)};
}

export function createCandidateIndex(documents) {
  const featureIds=new Map(),features=[],postings=[],documentFeatures=[],lengths=[];
  const citations=new Map(),byRef=new Map(),bySection=new Map();
  documents.forEach((document,id)=>{
    assert(SCHOOLS.includes(document.school),'Unknown school '+document.school);
    assert(!byRef.has(document.ref),'Duplicate canonical ref '+document.ref);byRef.set(document.ref,id);
    if(!bySection.has(document.sectionRef))bySection.set(document.sectionRef,[]);
    bySection.get(document.sectionRef).push(id);
    const {counts,length}=termCounts(document),encoded=[];lengths.push(length);
    for(const [feature,tf] of counts) {
      let fid=featureIds.get(feature);
      if(fid===undefined){fid=features.length;featureIds.set(feature,fid);features.push(feature);postings.push([]);}
      postings[fid].push(id,tf);encoded.push(fid,tf);
    }
    documentFeatures.push(encoded);
    for(const citation of document.citations || []){
      if(!citations.has(citation.ref))citations.set(citation.ref,[]);
      citations.get(citation.ref).push({id,citation});
    }
  });
  const count=documents.length;
  const idf=postings.map(list=>Math.log(1+(count-list.length/2+.5)/(list.length/2+.5)));
  return {documents,features,postings,documentFeatures,lengths,idf,citations,byRef,bySection,
    schoolCounts:Object.fromEntries(SCHOOLS.map(school=>[school,documents.filter(d=>d.school===school).length])),
    averageLength:lengths.reduce((a,b)=>a+b,0)/Math.max(1,count)};
}

const featureWeight=feature=>feature.startsWith('hep:')?1.7:feature.startsWith('he:')?1:feature.startsWith('enp:')?.6:.35;
function sharedTerms(evidence,prefix) {return evidence.filter(item=>item.feature.startsWith(prefix)).map(item=>item.feature.slice(prefix.length));}
function qualify(candidate) {
  const e=candidate.evidence;
  return e.directCitations.length || e.sharedCitations.length || sharedTerms(e.terms,'hep:').length
    || sharedTerms(e.terms,'he:').length>=2 || sharedTerms(e.terms,'en:').length>=3
    || (sharedTerms(e.terms,'enp:').length && sharedTerms(e.terms,'en:').length>=2);
}
export function diversifyCandidates(candidates,{perSchool=6,maxPerBook=2,maxPerSection=1}={}) {
  const result=[],books=new Map(),sections=new Map();
  const ranked=[...candidates].sort((a,b)=>b.retrievalScore-a.retrievalScore || a.ref.localeCompare(b.ref));
  // First offer distinct works; then a second passage in a work if supported.
  for(let round=1;round<=maxPerBook && result.length<perSchool;round++) {
    for(const candidate of ranked){
      if(result.length>=perSchool)break;
      if(result.includes(candidate) || (books.get(candidate.book)||0)>=round || (sections.get(candidate.sectionRef)||0)>=maxPerSection)continue;
      result.push(candidate);books.set(candidate.book,(books.get(candidate.book)||0)+1);
      sections.set(candidate.sectionRef,(sections.get(candidate.sectionRef)||0)+1);
    }
  }
  return result;
}

export function retrieveCandidates(index,origin,{perSchool=6,maxPerBook=2,maxPerSection=1}={}) {
  const originId=typeof origin==='number'?origin:index.byRef.get(origin.ref || origin);
  assert(Number.isInteger(originId),'Origin is absent from the canonical retrieval index');
  const document=index.documents[originId],pool=new Map(),maxDf=Math.max(8,Math.floor(index.documents.length*.18));
  const touch=id=>{
    const target=index.documents[id];
    if(id===originId || target.sectionRef===document.sectionRef)return null;
    if(!pool.has(id))pool.set(id,{id,retrievalScore:0,evidence:{terms:[],sharedCitations:[],directCitations:[]}});
    return pool.get(id);
  };
  const encoded=index.documentFeatures[originId],features=[];
  for(let i=0;i<encoded.length;i+=2){
    const id=encoded[i],df=index.postings[id].length/2;
    if(df<2 || df>maxDf)continue;
    features.push({id,weight:featureWeight(index.features[id]),priority:index.idf[id]*featureWeight(index.features[id])*(1+Math.log1p(encoded[i+1]))});
  }
  const selected=[];
  for(const [prefix,limit] of [['he:',36],['hep:',16],['en:',20],['enp:',8]])selected.push(...features.filter(item=>index.features[item.id].startsWith(prefix)).sort((a,b)=>b.priority-a.priority || a.id-b.id).slice(0,limit));
  for(const feature of selected){
    const list=index.postings[feature.id];
    for(let i=0;i<list.length;i+=2){
      const candidate=touch(list[i]);if(!candidate)continue;
      const tf=list[i+1],length=index.lengths[list[i]]/index.averageLength;
      const score=feature.weight*index.idf[feature.id]*(tf*2.2)/(tf+1.2*(.3+.7*length));
      candidate.retrievalScore+=score;
      candidate.evidence.terms.push({feature:index.features[feature.id],contribution:score});
    }
  }
  for(const citation of document.citations || []){
    const exact=index.byRef.get(citation.ref);
    if(exact!==undefined){
      const candidate=touch(exact);
      if(candidate){candidate.retrievalScore+=35*citation.weight;candidate.evidence.directCitations.push({direction:'origin-cites-target',ref:citation.ref,location:citation});}
    }
    const peers=index.citations.get(citation.ref) || [];
    // Bare work names and extremely common references do not become shared-source matches.
    if(citation.granularity==='unresolved-reference' || peers.length>Math.max(20,index.documents.length*.08))continue;
    const rarity=Math.log(1+index.documents.length/(peers.length+1));
    for(const peer of peers){
      const candidate=touch(peer.id);if(!candidate)continue;
      const granularity=citation.granularity==='whole-folio'?.25:citation.granularity==='section-level'?.45:1;
      const score=4*rarity*granularity*Math.sqrt(citation.weight*peer.citation.weight);
      candidate.retrievalScore+=score;
      candidate.evidence.sharedCitations.push({ref:citation.ref,granularity:citation.granularity,originLocation:citation,targetLocation:peer.citation,
        warning:'The same citation does not establish that the same argument or part of the source is discussed.'});
    }
  }
  for(const peer of index.citations.get(document.ref) || []){
    const candidate=touch(peer.id);if(!candidate)continue;
    candidate.retrievalScore+=35*peer.citation.weight;
    candidate.evidence.directCitations.push({direction:'target-cites-origin',ref:document.ref,location:peer.citation});
  }
  const qualified=[...pool.values()].filter(qualify).map(candidate=>{
    const target=index.documents[candidate.id],terms=candidate.evidence.terms.sort((a,b)=>b.contribution-a.contribution || a.feature.localeCompare(b.feature));
    return {ref:target.ref,book:target.book,bookTitle:target.bookTitle,sectionRef:target.sectionRef,school:target.school,
      edition:target.edition,paragraphHebrewSha256:target.paragraphHebrewSha256,sectionHebrewSha256:target.sectionHebrewSha256,
      translation:target.translation,retrievalScore:Number((candidate.retrievalScore*(target.book===document.book ? .8 : 1)).toFixed(4)),
      reviewed:false,reviewStatus:'pending-editorial-review',evidence:{
        sharedHebrewTerms:sharedTerms(terms,'he:').slice(0,12),sharedHebrewPhrases:sharedTerms(terms,'hep:').slice(0,8),
        sharedEnglishTerms:sharedTerms(terms,'en:').slice(0,10),sharedEnglishPhrases:sharedTerms(terms,'enp:').slice(0,6),
        sharedCitations:candidate.evidence.sharedCitations.slice(0,12),directCitations:candidate.evidence.directCitations},
      warning:CAUTION};
  });
  const citedSections=(document.citations || []).filter(c=>index.bySection.has(c.ref) && !index.byRef.has(c.ref)).map(c=>({ref:c.ref,location:c,
    warning:'Explicit section citation; no paragraph is inferred. Read the complete cited section.'}));
  return {kind:'unreviewed-theme-candidates',originRef:document.ref,sectionRef:document.sectionRef,book:document.book,school:document.school,
    paragraphHebrewSha256:document.paragraphHebrewSha256,sectionHebrewSha256:document.sectionHebrewSha256,
    reviewed:false,reviewStatus:'pending-editorial-review',retrievalStatus:'queried',queryFeatures:selected.map(x=>index.features[x.id]),
    citedCanonicalSections:citedSections,schools:SCHOOLS.map(school=>({school,indexedSubsections:index.schoolCounts[school],
      qualifiedCandidates:qualified.filter(c=>c.school===school).length,
      candidates:diversifyCandidates(qualified.filter(c=>c.school===school),{perSchool,maxPerBook,maxPerSection})}))};
}

export function selectOrigins(documents,{book,section,ref,start=1,count}={}) {
  assert([book,section,ref].filter(Boolean).length<=1,'Choose one exact book, section, or subsection');
  const rows=documents.filter(d=>!book&&!section&&!ref || book&&(d.book===book || d.bookTitle===book) || section&&d.sectionRef===section || ref&&d.ref===ref);
  assert(rows.length,'No canonical subsections match the requested scope');
  assert(Number.isInteger(start)&&start>0,'Start must be a positive 1-based subsection position');
  assert(count===undefined || Number.isInteger(count)&&count>0,'Count must be a positive subsection count');
  const selected=rows.slice(start-1,count===undefined?undefined:start-1+count);
  assert(selected.length,'The ordered range is outside the selected canonical scope');return selected;
}

function existingReviews(corpus,progressPath) {
  const reviews=new Map(),provenance={status:'unavailable',path:progressPath};
  if(!fs.existsSync(progressPath))return {reviews,provenance};
  const bytes=fs.readFileSync(progressPath),progress=JSON.parse(bytes);let stale=0;
  const {contentSha256,...body}=progress;
  assert(progress.schemaVersion===1 && sha(JSON.stringify(body))===contentSha256,'Existing review-progress evidence is invalid');
  for(const book of progress.books || [])for(const section of book.sections || [])for(const row of section.subsections || []){
    const current=corpus.paragraphs.get(row.ref);
    if(!current || current.paragraphHebrewSha256!==row.paragraphHebrewSha256 || current.sectionHebrewSha256!==row.sectionHebrewSha256){stale++;continue;}
    if(['reviewed-with-connections','reviewed-no-approved-connection'].includes(row.connectionReview))reviews.set(row.ref,row.connectionReview);
  }
  return {reviews,provenance:{status:'read-existing-ledger-summary',path:progressPath,sha256:sha(bytes),matchingCompletedSubsections:reviews.size,staleRowsIgnored:stale}};
}

export function buildThemeCandidates(options={}) {
  const output=safeInternalOutput(options.output),loaded=loadCanonicalDocuments(options.mcpRoot),{corpus,documents}=loaded;
  const settings={perSchool:options.perSchool??6,maxPerBook:options.maxPerBook??2,maxPerSection:options.maxPerSection??1};
  for(const [key,value] of Object.entries(settings))assert(Number.isInteger(value)&&value>0&&value<=30,'Invalid '+key);
  const selected=selectOrigins(documents,options),selectedRefs=new Set(selected.map(d=>d.ref)),index=createCandidateIndex(documents);
  const {reviews,provenance:reviewProvenance}=existingReviews(corpus,options.progressPath || path.join(REPO,'dist/library/connected-ideas/review-progress.json'));
  const snapshotFiles=[{path:'catalog.json',source:path.join(loaded.mcpRoot,'catalog.json'),sha256:corpus.catalogSha256},
    ...corpus.sourceFiles.map(file=>({path:'text/'+file.book+'.json',source:path.join(loaded.mcpRoot,'text',file.book+'.json'),sha256:file.sha256}))];
  if(options.write!==false){
    for(const file of snapshotFiles){const bytes=fs.readFileSync(file.source);assert(sha(bytes)===file.sha256,'Canonical data changed during retrieval');writeInternalFile(path.join(output,'corpus',file.path),bytes);}
  }
  const counts={books:corpus.books.length,sections:corpus.books.reduce((n,b)=>n+b.sections.length,0),canonicalSubsections:documents.length,
    queriedSubsections:0,subsectionsWithCandidatesInBothSchools:0,subsectionsWithNoCandidate:0,candidatePairs:0,
    previouslyCompletedSubsectionReviews:reviews.size,completedReviewsCreatedByThisRun:0};
  const files=[],books=[],targetUses=new Map();
  for(const book of corpus.books){
    const rows=[],bookDocs=documents.filter(d=>d.book===book.slug),selectedDocs=bookDocs.filter(d=>selectedRefs.has(d.ref));
    for(const document of selectedDocs){
      const row=retrieveCandidates(index,document,settings);row.existingEditorialReview=reviews.get(document.ref) || 'pending';rows.push(row);counts.queriedSubsections++;
      if(row.schools.every(s=>s.candidates.length))counts.subsectionsWithCandidatesInBothSchools++;
      if(row.schools.every(s=>!s.candidates.length))counts.subsectionsWithNoCandidate++;
      for(const school of row.schools)for(const target of school.candidates){counts.candidatePairs++;targetUses.set(target.ref,(targetUses.get(target.ref)||0)+1);}
    }
    const filename='candidates/'+book.slug+'.jsonl',bytes=rows.map(row=>JSON.stringify(row)).join('\n')+(rows.length?'\n':'');
    if(rows.length){files.push({path:filename,sha256:sha(bytes),origins:rows.length});if(options.write!==false)writeInternalFile(path.join(output,filename),bytes);}
    books.push({book:book.book,slug:book.slug,school:book.school,sections:book.sections.length,canonicalSubsections:bookDocs.length,queriedSubsections:rows.length,
      previouslyCompletedSubsectionReviews:bookDocs.filter(d=>reviews.has(d.ref)).length,candidatesFile:rows.length?filename:null});
    if(rows.length)options.onProgress?.({book:book.book,queried:rows.length,totalQueried:counts.queriedSubsections,totalSelected:selected.length});
  }
  const documentRows=documents.map(({hebrew,english,citations,...row})=>row);
  const documentBytes=JSON.stringify(documentRows)+'\n';
  if(options.write!==false)writeInternalFile(path.join(output,'documents.json'),documentBytes);
  const manifest={schemaVersion:1,kind:'internal-theme-candidate-index',method:METHOD,
    implementationSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),reviewed:false,caution:CAUTION,
    createdOn:options.date || new Date().toISOString().slice(0,10),settings,selection:{book:options.book || null,section:options.section || null,ref:options.ref || null,start:options.start || 1,count:options.count || null},counts,books,
    corpus:{catalogSha256:corpus.catalogSha256,version:corpus.catalog.version,files:snapshotFiles.map(({source,...file})=>file)},
    documents:{path:'documents.json',sha256:sha(documentBytes)},candidateFiles:files,existingReviewEvidence:reviewProvenance,
    targetExposure:[...targetUses].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,30).map(([ref,selections])=>({ref,selections})),
    ranking:'BM25-style lexical retrieval over author Hebrew and existing English, plus exact citation metadata. English has lower weight; no embedding, inference, or semantic approval is claimed.',
    diversity:'Each school is selected separately. Distinct works are offered first, with configured per-work and per-section limits. Empty or short lists are retained when evidence is insufficient.',
    scope:'Every canonical subsection is enumerated using the same default-edition selector as the formal review inventory. Queried means automated retrieval only, never completed editorial search.'};
  manifest.contentSha256=sha(JSON.stringify(manifest));
  if(options.write!==false)writeInternalFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {manifest,output};
}

export function parseCandidateArgs(args) {
  const result={};
  const fields={'--book':'book','--section':'section','--ref':'ref','--start':'start','--count':'count','--out-dir':'output','--mcp-root':'mcpRoot','--per-school':'perSchool','--max-per-book':'maxPerBook','--max-per-section':'maxPerSection'};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--check'){result.write=false;continue;}
    const field=fields[args[i]];assert(field && args[i+1]!==undefined,'Unknown or incomplete argument '+args[i]);
    result[field]=['perSchool','maxPerBook','maxPerSection','start','count'].includes(field)?Number(args[++i]):args[++i];
  }
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=buildThemeCandidates({...parseCandidateArgs(process.argv.slice(2)),onProgress:p=>process.stderr.write(`Retrieved ${p.totalQueried}/${p.totalSelected} subsections (${p.book})\n`)});
    console.log(JSON.stringify({ok:true,output:result.output,counts:result.manifest.counts,warning:CAUTION}));}
  catch(error){console.error(error.stack || error.message);process.exitCode=1;}
}

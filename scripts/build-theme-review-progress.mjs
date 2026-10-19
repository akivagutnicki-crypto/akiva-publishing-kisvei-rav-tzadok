#!/usr/bin/env node
// Account for every canonical book, section and subsection. An approved anchor
// or a full contextual reading never silently completes a subsection's search.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {studySections} from './study-editions.mjs';
const require=createRequire(import.meta.url);
const sources=require('../dist/library/source-connections.js');
const ideas=require('../dist/library/connected-ideas.js');
const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalized=sources.normalizedHebrew;
const content=paragraph=>Array.isArray(paragraph.p)?paragraph.p.map(pair=>pair[0] || '').join(' '):paragraph.t || '';
const required=(value,label)=>{assert(typeof value==='string' && value.trim(),label+' is missing');return value.trim();};
const pinned=(actual,expected,label)=>assert(/^[a-f0-9]{64}$/.test(expected || '') && actual===expected,label+' changed or was not reviewed');
const STATES=['reviewed-with-connections','reviewed-no-approved-connection'];

export function readStudyCorpus(mcpRoot) {
  const catalogBytes=fs.readFileSync(path.join(mcpRoot,'catalog.json')), catalog=JSON.parse(catalogBytes);
  const paragraphs=new Map(), books=[], sourceFiles=[];
  for(const book of catalog.books) {
    const bytes=fs.readFileSync(path.join(mcpRoot,'text',book.slug+'.json')), data=JSON.parse(bytes);
    assert(data.slug===book.slug && Array.isArray(data.paras),'Invalid canonical work '+book.slug);
    sourceFiles.push({book:book.slug,sha256:sha(bytes)});
    const editions=studySections(book), sections=new Map();
    for(const {section,order} of editions.values()) {
      sections.set(section.ref,{ref:section.ref,title:section.title || section.ref,
        path:section.path || '',subsections:[],order});
    }
    const preferred=new Map();
    data.paras.forEach((paragraph,index)=>{
      const section=book.sections[paragraph.s];
      assert(section,'Invalid section pointer in '+paragraph.r);
      if(editions.get(section.ref).index!==paragraph.s)return;
      const previous=preferred.get(paragraph.r);
      if(!previous || Number(section.il)>Number(previous.section.il)) preferred.set(paragraph.r,{paragraph,index,section});
    });
    const sectionHashes=new Map();
    for(const [ref,item] of preferred) {
      const {paragraph,section,index}=item;
      assert(!paragraphs.has(ref),'Repeated canonical reference in different books: '+ref);
      const sectionIndex=paragraph.s;
      if(!sectionHashes.has(sectionIndex)) sectionHashes.set(sectionIndex,
        sha(normalized(data.paras.slice(section.first,section.first+section.count).map(content).join(' '))));
      const row={ref,sectionRef:section.ref,book:book.slug,index,order:index-section.first,
        edition:section.il?'interlinear':'hebrew',paragraphHebrewSha256:sha(normalized(content(paragraph))),
        sectionHebrewSha256:sectionHashes.get(sectionIndex),
        phraseCount:Array.isArray(paragraph.p)?paragraph.p.length:1};
      paragraphs.set(ref,row); sections.get(section.ref).subsections.push(row);
    }
    for(const section of sections.values()) section.subsections.sort((a,b)=>a.order-b.order || a.ref.localeCompare(b.ref));
    books.push({book:book.title,slug:book.slug,school:book.group==='Izhbitz'?ideas.SCHOOLS[1]:ideas.SCHOOLS[0],
      sections:[...sections.values()].sort((a,b)=>a.order-b.order)});
  }
  return {books,paragraphs,catalog,catalogSha256:sha(catalogBytes),sourceFiles};
}

export function buildThemeReviewProgress(options={}) {
  const mcpRoot=path.resolve(options.mcpRoot || path.join(REPO,'dist/mcp-data'));
  const reviewDir=path.resolve(options.reviewDir || path.join(REPO,'sources/akiva/theme-reviews'));
  const connections=options.connections || JSON.parse(fs.readFileSync(path.join(REPO,'dist/library/connected-ideas/catalog.json'),'utf8'));
  const output=path.resolve(options.output || path.join(REPO,'dist/library/connected-ideas/review-progress.json'));
  assert(!output.startsWith(mcpRoot+path.sep) && !output.startsWith(reviewDir+path.sep)
    && !output.startsWith(path.join(REPO,'dist/library/data')+path.sep),'Progress output cannot overwrite its inputs');
  assert(connections.schemaVersion===1 && Array.isArray(connections.records),'Invalid approved-connection catalog');
  const corpus=readStudyCorpus(mcpRoot), approved=new Map(), contextRead=new Set(), reviews=new Map(), evidence=[];
  const add=(ref,record,direction)=>{
    assert(corpus.paragraphs.has(ref),'Approved connection outside the canonical corpus: '+ref);
    if(!approved.has(ref)) approved.set(ref,[]);
    approved.get(ref).push({id:record.id,direction,targetRef:direction==='forward'?record.targetRef:record.originRef});
  };
  for(const record of connections.records) {
    assert(ideas.validRecord(record),'Invalid approved record '+record.id);
    const origin=corpus.paragraphs.get(record.originRef), target=corpus.paragraphs.get(record.targetRef);
    assert(origin && target,'Approved connection reference is absent from this corpus');
    pinned(origin.paragraphHebrewSha256,record.reviewedOriginHebrewSha256,'Origin '+record.originRef);
    pinned(origin.sectionHebrewSha256,record.reviewedOriginSectionHebrewSha256,'Origin section '+origin.sectionRef);
    pinned(target.paragraphHebrewSha256,record.reviewedTargetHebrewSha256,'Target '+record.targetRef);
    add(record.originRef,record,'forward');
    contextRead.add(origin.sectionRef+'|'+origin.sectionHebrewSha256);
    if(record.reverseExplanation) {
      pinned(target.sectionHebrewSha256,record.reviewedTargetSectionHebrewSha256,'Receiving section '+target.sectionRef);
      contextRead.add(target.sectionRef+'|'+target.sectionHebrewSha256);add(record.targetRef,record,'reverse');
    }
  }
  for(const file of (fs.existsSync(reviewDir)?fs.readdirSync(reviewDir):[]).filter(file=>file.endsWith('.json')).sort()) {
    const bytes=fs.readFileSync(path.join(reviewDir,file)), doc=JSON.parse(bytes);
    assert(doc.schemaVersion===1 && Array.isArray(doc.entries),'Invalid subsection review schema: '+file);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(doc.reviewedOn || ''),'Review date is missing: '+file);
    const method=required(doc.method,'Review method in '+file), fileHash=sha(bytes);
    evidence.push({path:file,sha256:fileHash});
    for(const entry of doc.entries) {
      try {
        const paragraph=corpus.paragraphs.get(entry.ref);
        assert(paragraph,'Review is not an exact canonical subsection');
        assert(!reviews.has(entry.ref),'Subsection was counted twice');
        assert(entry.sectionRef===paragraph.sectionRef,'Review belongs to the wrong section');
        assert(STATES.includes(entry.status),'Only an explicit completed subsection review may enter the ledger');
        assert(Array.isArray(entry.schoolSearch) && entry.schoolSearch.length===2
          && ideas.SCHOOLS.every(school=>entry.schoolSearch.includes(school)),'Both schools must be examined');
        pinned(paragraph.paragraphHebrewSha256,entry.reviewedParagraphHebrewSha256,'Subsection '+entry.ref);
        pinned(paragraph.sectionHebrewSha256,entry.reviewedSectionHebrewSha256,'Context '+entry.sectionRef);
        const assessment=required(entry.assessment,'Subsection assessment');
        assert(Array.isArray(entry.candidatesReviewed) && entry.candidatesReviewed.length,'Candidate review evidence is missing');
        const candidates=entry.candidatesReviewed.map(candidate=>{
          const ref=required(candidate.ref,'Candidate reference'), target=corpus.paragraphs.get(ref);
          assert(target,'Candidate evidence must identify an exact canonical passage');
          const book=corpus.books.find(book=>book.slug===target.book);
          assert(ideas.SCHOOLS.includes(candidate.school) && candidate.school===book.school,'Incorrect candidate school');
          return {ref,school:candidate.school,reason:required(candidate.reason,'Candidate assessment')};
        });
        assert(ideas.SCHOOLS.every(school=>candidates.some(candidate=>candidate.school===school)),
          'Completed review requires a documented candidate comparison in each school');
        const hasApproved=Boolean(approved.get(entry.ref)?.length);
        assert((entry.status==='reviewed-with-connections')===hasApproved,
          'Review status contradicts the approved catalog; update the assessment explicitly');
        reviews.set(entry.ref,{status:entry.status,reviewedOn:doc.reviewedOn,method,assessment,candidatesReviewed:candidates,
          evidence:{file,fileSha256:fileHash}});
        contextRead.add(paragraph.sectionRef+'|'+paragraph.sectionHebrewSha256);
      } catch(error) {throw new Error(file+': '+(entry.ref || '(missing ref)')+': '+error.message,{cause:error});}
    }
  }
  const counts={books:0,sections:0,subsections:0,subsectionsWithApprovedIdeas:0,subsectionsReviewed:0,
    subsectionsPendingReview:0,subsectionsReviewedWithoutApprovedConnection:0,sectionsFullyReviewed:0,booksFullyReviewed:0};
  const books=corpus.books.map(book=>{
    const sections=book.sections.map(section=>{
      const subsections=section.subsections.map(paragraph=>{
        const review=reviews.get(paragraph.ref), links=approved.get(paragraph.ref) || [];
        const item={ref:paragraph.ref,edition:paragraph.edition,phraseCount:paragraph.phraseCount,
          paragraphHebrewSha256:paragraph.paragraphHebrewSha256,sectionHebrewSha256:paragraph.sectionHebrewSha256,
          sectionContextRead:contextRead.has(paragraph.sectionRef+'|'+paragraph.sectionHebrewSha256),
          connectionReview:review?.status || 'pending',approvedConnections:links,...(review?{review}:{})};
        counts.subsections++; if(links.length) counts.subsectionsWithApprovedIdeas++;
        if(review) counts.subsectionsReviewed++; else counts.subsectionsPendingReview++;
        if(review?.status==='reviewed-no-approved-connection') counts.subsectionsReviewedWithoutApprovedConnection++;
        return item;
      });
      const reviewed=subsections.filter(row=>row.connectionReview!=='pending').length;
      const complete=subsections.length>0 && reviewed===subsections.length;
      counts.sections++;if(complete)counts.sectionsFullyReviewed++;
      return {ref:section.ref,title:section.title,path:section.path,
        counts:{subsections:subsections.length,reviewed,pending:subsections.length-reviewed,
          withApprovedIdeas:subsections.filter(row=>row.approvedConnections.length).length},
        reviewStatus:complete?'complete':'pending',subsections};
    });
    const complete=sections.length>0 && sections.every(section=>section.reviewStatus==='complete');
    counts.books++;if(complete)counts.booksFullyReviewed++;
    return {book:book.book,slug:book.slug,school:book.school,
      counts:{sections:sections.length,sectionsFullyReviewed:sections.filter(s=>s.reviewStatus==='complete').length,
        subsections:sections.reduce((n,s)=>n+s.counts.subsections,0),reviewed:sections.reduce((n,s)=>n+s.counts.reviewed,0),
        pending:sections.reduce((n,s)=>n+s.counts.pending,0),withApprovedIdeas:sections.reduce((n,s)=>n+s.counts.withApprovedIdeas,0)},
      reviewStatus:complete?'complete':'pending',sections};
  });
  const provenance={mcpCatalogSha256:corpus.catalogSha256,mcpDataVersion:corpus.catalog.version,
    canonicalFiles:corpus.sourceFiles,connectionCatalogVersion:connections.version,reviewFiles:evidence};
  const body={schemaVersion:1,release:ideas.VERSION,
    scope:'Every book, section and exact paragraph reference in the current canonical study corpus. New canonical material is added as pending at the next build.',
    definitions:{pending:'The subsection has not completed an explicit connection review, even if an individual anchor is already approved.',
      'reviewed-with-connections':'The subsection and both schools were examined; one or more individually approved parallels are present.',
      'reviewed-no-approved-connection':'The documented candidate comparisons yielded no approved parallel. This does not assert that no useful parallel exists.',
      sectionContextRead:'The full section was read for an approved relation or explicit review. This is distinct from completing every subsection\'s connection search.'},
    counts,provenance,books};
  const result={...body,contentSha256:sha(JSON.stringify(body))};
  if(options.write!==false){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');}
  return {progress:result,output};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {progress,output}=buildThemeReviewProgress({write:!process.argv.includes('--check')});
  console.log(JSON.stringify({ok:true,counts:progress.counts,contentSha256:progress.contentSha256,output}));
}

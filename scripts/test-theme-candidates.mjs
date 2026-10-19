#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {INTERNAL_ROOT,createCandidateIndex,retrieveCandidates,diversifyCandidates,translationAvailability,citationsOf,
  safeInternalOutput,writeInternalFile,loadCanonicalDocuments,selectOrigins,buildThemeCandidates} from './build-theme-candidates.mjs';
import {buildThemeReviewPacket,openCandidateSnapshot,renderPacketMarkdown} from './theme-review-packet.mjs';
const require=createRequire(import.meta.url),ideas=require('../dist/library/connected-ideas.js');
let checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
const throws=(fn,pattern)=>{assert.throws(fn,pattern);checks++;};
const rav='Kisvei Rav Tzadok',ish='Ishbitz–Radzin';
function doc(ref,hebrew,{school=rav,book=ref.split(' ')[0],sectionRef=ref.replace(/:\d+$/,''),english='',citations=[]}={}) {
  return {ref,hebrew,english,school,book,bookTitle:book,sectionRef,citations,translation:{status:'missing'},edition:'hebrew'};
}
const c=(ref)=>citationsOf({a:{[ref]:[0,'h',0]}});
const flatten=row=>row.schools.flatMap(s=>s.candidates);

{
  const origin=doc('Rav 1:1','נחש גן איבה'),correct=doc('Other 2:1','נחש גן איבה'),wrong=doc('Other 3:1','נחשב שכל דעת');
  const result=flatten(retrieveCandidates(createCandidateIndex([origin,correct,wrong]),origin));
  check(result.some(r=>r.ref===correct.ref),'Exact whole words should find the relevant lexical lead');
  check(!result.some(r=>r.ref===wrong.ref),'נחש must not match נחשב through a substring');
  check(result.every(r=>!r.reviewed && !ideas.validRecord(r)),'A retrieved candidate must not satisfy the publication schema');
}
{
  const origin=doc('Rav 1:1','עצם מקור'),differentMeaning=doc('Ish 2:1','עצם מקור',{school:ish});
  const result=flatten(retrieveCandidates(createCandidateIndex([origin,differentMeaning]),origin));
  check(result.length===1 && result[0].reviewStatus==='pending-editorial-review','A legitimate homograph remains unresolved, never approved');
  check(/homographs/.test(result[0].warning),'The ambiguity of identical forms must be stated');
}
{
  const origin=doc('Rav 1:1','קנטרס קראתיו בסיעתא דשמיא'),other=doc('Other 2:1','קנטרס קראתיו בסיעתא דשמיא');
  check(flatten(retrieveCandidates(createCandidateIndex([origin,other]),origin)).length===0,'Shared publication formulas alone must not generate a candidate');
}
{
  const origin=doc('Rav 1:1','מקור',{citations:c('Berakhot 6b')}),same=doc('Other 2:1','לב',{citations:c('Berakhot 6b')}),wrong=doc('Other 3:1','דעת',{citations:c('Berakhot 6a')});
  const result=flatten(retrieveCandidates(createCandidateIndex([origin,same,wrong]),origin));
  check(result.length===1 && result[0].ref===same.ref,'Citation equality must preserve the daf side');
  check(result[0].evidence.sharedCitations[0].granularity==='whole-folio','A shared daf must retain its broad granularity');
  check(/does not establish/.test(result[0].evidence.sharedCitations[0].warning),'A shared citation cannot claim contextual relevance');
}
{
  const origin=doc('Rav 1:1','בריאה',{citations:c('Ish 2:1')}),target=doc('Ish 2:1','תיקון',{school:ish}),sibling=doc('Rav 1:2','בריאה');
  const index=createCandidateIndex([origin,target,sibling]);
  check(flatten(retrieveCandidates(index,origin)).some(r=>r.ref===target.ref && r.evidence.directCitations.length),'An explicit exact citation must be discoverable without lexical overlap');
  check(flatten(retrieveCandidates(index,target)).some(r=>r.ref===origin.ref),'Incoming exact citations must also be discoverable');
  check(!flatten(retrieveCandidates(index,origin)).some(r=>r.ref===sibling.ref),'The originating section is already context, not its own proposed parallel');
}
{
  const many=Array.from({length:8},(_,i)=>({ref:'Mei '+i,book:'mei',sectionRef:'Mei section '+i,retrievalScore:100-i}));
  const other=['beit','sod','tiferet'].map((book,i)=>({ref:book,book,sectionRef:book,retrievalScore:30-i}));
  const selected=diversifyCandidates([...many,...other],{perSchool:6,maxPerBook:2,maxPerSection:1});
  check(selected.filter(r=>r.book==='mei').length<=2,'A familiar work must not consume the shortlist');
  check(new Set(selected.slice(0,4).map(r=>r.book)).size===4,'Different evidenced works should be offered before repeats');
  const sameSection=many.map(r=>({...r,sectionRef:'Mei Lech Lecha'}));
  check(diversifyCandidates(sameSection).length===1,'One familiar section must not dominate through several paragraphs');
}
{
  check(translationAvailability({t:'מקור'}).status==='missing','Hebrew-only text must request translation');
  check(translationAvailability({t:'מקור'}).missingPhraseIndexes[0]===0,'A Hebrew-only paragraph must retain its untranslated fallback position');
  check(translationAvailability({p:[['מקור','source'],['תיקון','']]}).status==='partial','Partial English must not be labeled complete');
  check(translationAvailability({p:[['מקור','source']]}).status==='present-for-all-Hebrew-phrases','Availability must be measured independently of accuracy');
  throws(()=>safeInternalOutput('dist/library/connected-ideas'),/ignored/);
  throws(()=>safeInternalOutput('sources/akiva/themes'),/ignored/);
}

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'theme-candidate-test-'));
fs.mkdirSync(INTERNAL_ROOT,{recursive:true});
const output=fs.mkdtempSync(path.join(INTERNAL_ROOT,'candidate-test-'));
try {
  fs.mkdirSync(path.join(temp,'text'));
  const catalog={version:'fixture',books:[
    {slug:'test-rav',title:'Test Rav',group:"R' Tzadok HaKohen",sections:[
      {ref:'Test Rav 1',first:0,count:1,il:false},{ref:'Test Rav 1',first:1,count:2,il:true},{ref:'Test Rav 2',first:3,count:1,il:true}]},
    {slug:'test-ish',title:'Test Ish',group:'Izhbitz',sections:[{ref:'Test Ish 1',first:0,count:2,il:false}]}]};
  fs.writeFileSync(path.join(temp,'catalog.json'),JSON.stringify(catalog));
  fs.writeFileSync(path.join(temp,'text/test-rav.json'),JSON.stringify({slug:'test-rav',paras:[
    {r:'Test Rav 1:1',s:0,n:1,t:'נוסח ישן שאינו ברירת המחדל'},
    {r:'Test Rav 1:1',s:1,n:1,p:[['תשובה מקור תיקון','Return repairs the source.']],a:{'Test Ish 1:1':[0,'h',0]}},
    {r:'Test Rav 1:2',s:1,n:2,p:[['המשך ההקשר השלם','The remaining complete context.']]},
    {r:'Test Rav 2:1',s:2,n:1,p:[['תשובה מקור תיקון','Return repairs the source.']]}]}));
  fs.writeFileSync(path.join(temp,'text/test-ish.json'),JSON.stringify({slug:'test-ish',paras:[
    {r:'Test Ish 1:1',s:0,n:1,t:'תשובה מקור תיקון'},
    {r:'Test Ish 1:2',s:0,n:2,t:'סיום ההקשר השלם'}]}));
  const loaded=loadCanonicalDocuments(temp);
  check(loaded.documents.length===5,'The old duplicate must not create a second canonical subsection');
  check(loaded.documents.find(d=>d.ref==='Test Rav 1:1').edition==='interlinear','Default-edition selection must prefer the canonical interlinear paragraph');
  check(selectOrigins(loaded.documents,{book:'test-rav'}).length===3,'Book selection must include every canonical subsection');
  check(selectOrigins(loaded.documents,{section:'Test Rav 1'}).length===2,'Section selection must use exact equality');
  check(selectOrigins(loaded.documents,{book:'test-rav',start:2,count:1})[0].ref==='Test Rav 1:2','Bounded ranges must follow canonical subsection order');
  throws(()=>selectOrigins(loaded.documents,{book:'test-rav',start:9}),/outside/);
  const built=buildThemeCandidates({mcpRoot:temp,output,book:'test-rav',progressPath:path.join(temp,'absent.json')});
  check(built.manifest.counts.queriedSubsections===3 && built.manifest.counts.canonicalSubsections===5,'Queried scope must not conceal the whole-corpus denominator');
  check(built.manifest.counts.completedReviewsCreatedByThisRun===0,'Retrieval cannot advance editorial completion');
  const result=buildThemeReviewPacket({input:output,book:'test-rav',start:1,count:1,write:false});
  check(result.packet.counts.selectedSubsections===1,'A bounded packet must select only the requested origin');
  const originContext=result.packet.contexts.find(c=>c.ref==='Test Rav 1');
  check(originContext.paragraphs.length===2 && originContext.paragraphs[1].ref==='Test Rav 1:2','A bounded packet must still include the full originating section');
  const targetContext=result.packet.contexts.find(c=>c.ref==='Test Ish 1');
  check(targetContext.paragraphs.length===2,'A target excerpt must retain its full section context');
  check(targetContext.paragraphs[0].translation.status==='missing','The packet must surface missing target English');
  const continuity=result.packet.continuityReviews[0];
  check(continuity.previous.status==='book-boundary' && continuity.previous.sectionRef===null,'The first section must not inherit a neighbor from another book');
  check(continuity.core.sectionRef==='Test Rav 1' && continuity.next.sectionRef==='Test Rav 2','Neighbors must follow exact canonical section order');
  check(continuity.status==='pending' && continuity.core.editorialStatement==='' && continuity.core.supportingRefs.length===0,'Ordering must not generate an asserted thesis');
  check(result.packet.contexts.some(c=>c.ref==='Test Rav 2' && c.paragraphs[0].ref==='Test Rav 2:1'),'Complete neighbor context must be included even outside a bounded origin selection');
  const last=buildThemeReviewPacket({input:output,book:'test-rav',start:3,count:1,write:false}).packet;
  check(last.continuityReviews[0].previous.sectionRef==='Test Rav 1' && last.continuityReviews[0].next.status==='book-boundary','The last section must stop at its own book boundary');
  check(last.contexts.find(c=>c.ref==='Test Rav 1').paragraphs.length===2,'Previous context must also be complete');
  const whole=buildThemeReviewPacket({input:output,book:'test-rav',write:false}).packet;
  check(whole.continuityReviews.length===2 && whole.origins.length===3,'Several paragraphs in a section must share one continuity worklist');
  const markdown=renderPacketMarkdown(result.packet);
  check(markdown.includes('המשך ההקשר השלם') && markdown.includes('סיום ההקשר השלם'),'The readable packet must include context, not just hashes');
  check(!markdown.includes('נוסח ישן שאינו ברירת המחדל'),'An old edition must not rescue or substitute a target');
  check(markdown.includes('Required; not supplied') && markdown.includes('Section continuity worklist'),'Readable continuity fields must remain pending and demand evidence');
  check(!ideas.validRecord(result.packet) && result.packet.counts.newCompletedReviews===0,'A packet cannot be a published connection or completed review');
  const outside=path.join(temp,'untouched');fs.mkdirSync(outside);
  const redirected=path.join(output,'redirected');fs.mkdirSync(redirected);fs.symlinkSync(outside,path.join(redirected,'corpus'));
  throws(()=>buildThemeCandidates({mcpRoot:temp,output:redirected,book:'test-rav',progressPath:path.join(temp,'absent.json')}),/symbolic link/);
  check(fs.readdirSync(outside).length===0,'A symlinked output descendant must be rejected before any external write');
  const outsideFile=path.join(outside,'keep');fs.writeFileSync(outsideFile,'unchanged');fs.symlinkSync(outsideFile,path.join(output,'existing-link'));
  throws(()=>writeInternalFile(path.join(output,'existing-link'),'replacement'),/symbolic link/);
  check(fs.readFileSync(outsideFile,'utf8')==='unchanged','A symlinked output file must not be truncated');
  fs.symlinkSync(path.join(outside,'not-created'),path.join(output,'dangling-link'));
  throws(()=>writeInternalFile(path.join(output,'dangling-link'),'replacement'),/ENOENT|symbolic link/);
  check(!fs.existsSync(path.join(outside,'not-created')),'A dangling output symlink must not create its target');
  const raw=path.join(output,'corpus/text/test-ish.json');fs.appendFileSync(raw,' ');
  throws(()=>buildThemeReviewPacket({input:output,book:'test-rav',start:1,count:1,write:false}),/Snapshot evidence changed/);
  const manifestFile=path.join(output,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile));manifest.counts.completedReviewsCreatedByThisRun=1;fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  throws(()=>openCandidateSnapshot(output),/manifest changed/);
} finally {fs.rmSync(temp,{recursive:true,force:true});fs.rmSync(output,{recursive:true,force:true});}
console.log(`PASS ${checks} candidate-retrieval, scope, full-context, isolation, and integrity fixtures.`);

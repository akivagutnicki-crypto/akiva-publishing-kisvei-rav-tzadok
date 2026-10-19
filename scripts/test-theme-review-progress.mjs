#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildConnectedIdeas} from './build-connected-ideas.mjs';
import {buildThemeReviewProgress,readStudyCorpus} from './build-theme-review-progress.mjs';
const require=createRequire(import.meta.url),sources=require('../dist/library/source-connections.js');
const sha=value=>createHash('sha256').update(value).digest('hex');
const pin=value=>sha(sources.normalizedHebrew(value));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'akiva-theme-progress-'));
const mcpRoot=path.join(temporary,'mcp'),editorialDir=path.join(temporary,'ideas'),reviewDir=path.join(temporary,'reviews');
const output=path.join(temporary,'output','progress.json');
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
let checks=0;const check=fn=>{fn();checks++;};
try {
  const a=['הידיעה בלב מולידה מעשה טוב','הדבר צריך להתקיים בכל יום'],b=['דרך הלב מביאה לעשיית הטוב','אין די בידיעה בלי קיום'];
  write(path.join(mcpRoot,'catalog.json'),{version:'fixture',books:[
    {title:'Fixture Tzadok',slug:'tzadok',group:"R' Tzadok HaKohen",sections:[
      {ref:'Fixture Tzadok 1',first:0,count:1,il:false},{ref:'Fixture Tzadok 1',first:1,count:2,il:true}]},
    {title:'Fixture Ishbitz',slug:'ishbitz',group:'Izhbitz',sections:[{ref:'Fixture Ishbitz 1',first:0,count:2,il:true}]}]});
  write(path.join(mcpRoot,'text/tzadok.json'),{slug:'tzadok',paras:[
    {r:'Fixture Tzadok 1:1',s:0,n:1,t:'המהדורה הישנה נושאת לשון אחרת'},
    ...a.map((text,i)=>({r:'Fixture Tzadok 1:'+(i+1),s:1,n:i+1,p:[[text,'English fixture.']]}))]});
  write(path.join(mcpRoot,'text/ishbitz.json'),{slug:'ishbitz',paras:b.map((text,i)=>({r:'Fixture Ishbitz 1:'+(i+1),s:0,n:i+1,p:[[text,'English fixture.']]}))});
  write(path.join(editorialDir,'record.json'),{schemaVersion:1,records:[{
    id:'fixture-understanding',themeTitle:'Understanding reaches action',themeSummary:'Understanding must come to expression in action.',
    originRef:'Fixture Tzadok 1:1',originHebrew:a[0],originEnglish:'Understanding in the heart gives birth to good action.',
    targetRef:'Fixture Ishbitz 1:1',targetHebrew:b[0],targetEnglish:'The path of the heart brings one to doing good.',
    school:'Ishbitz–Radzin',explanation:'The heart is described as a path to action, clarifying the transition from knowledge to practice.',
    translationProvenance:'Synthetic test passage.',reviewed:true,reviewedOriginHebrewSha256:pin(a[0]),
    reviewedOriginSectionHebrewSha256:pin(a.join(' ')),reviewedTargetHebrewSha256:pin(b[0])}]});
  const connections=buildConnectedIdeas({mcpRoot,editorialDir,write:false}).catalog;
  const options={mcpRoot,reviewDir,connections,output};
  const first=buildThemeReviewProgress(options).progress;
  check(()=>assert.deepEqual([first.counts.books,first.counts.sections,first.counts.subsections],[2,2,4],
    'Older duplicate editions must not add a book, section or subsection'));
  check(()=>assert.deepEqual([first.counts.subsectionsWithApprovedIdeas,first.counts.subsectionsReviewed,
    first.counts.subsectionsPendingReview,first.counts.sectionsFullyReviewed,first.counts.booksFullyReviewed],[1,0,4,0,0],
    'One approved anchor cannot complete a subsection, section or book'));
  const origin=first.books[0].sections[0].subsections;
  check(()=>assert(origin.every(row=>row.sectionContextRead && row.connectionReview==='pending'),
    'Full contextual reading remains distinct from every subsection’s connection search'));
  check(()=>assert(first.books[1].sections[0].subsections.every(row=>!row.sectionContextRead && !row.approvedConnections.length),
    'Receiving a forward quotation does not approve the opposite direction or its section'));
  const entry=(index,status)=>({ref:'Fixture Tzadok 1:'+index,sectionRef:'Fixture Tzadok 1',status,
    schoolSearch:['Kisvei Rav Tzadok','Ishbitz–Radzin'],reviewedParagraphHebrewSha256:pin(a[index-1]),
    reviewedSectionHebrewSha256:pin(a.join(' ')),assessment:'The complete paragraph and its context were compared with the passages recorded below.',
    candidatesReviewed:[{ref:'Fixture Tzadok 1:'+(index===1?2:1),school:'Kisvei Rav Tzadok',reason:'This adjacent observation does not add a distinct explanation.'},
      {ref:'Fixture Ishbitz 1:1',school:'Ishbitz–Radzin',reason:index===1?'Approved because it explains the path from the heart to action.':'The discussion of the heart does not illuminate the daily repetition required here.'}]});
  const doc={schemaVersion:1,reviewedOn:'2026-10-19',method:'Synthetic inventory-verification fixture.',
    entries:[entry(1,'reviewed-with-connections'),entry(2,'reviewed-no-approved-connection')]};
  const file=path.join(reviewDir,'fixture.json');write(file,doc);
  const complete=buildThemeReviewProgress(options).progress;
  check(()=>assert.deepEqual([complete.counts.subsectionsReviewed,complete.counts.sectionsFullyReviewed,
    complete.counts.booksFullyReviewed,complete.counts.subsectionsReviewedWithoutApprovedConnection],[2,1,1,1]));
  const reject=(mutate,pattern)=>check(()=>{
    const copy=structuredClone(doc);mutate(copy);write(file,copy);const before=sha(fs.readFileSync(output));
    assert.throws(()=>buildThemeReviewProgress(options),pattern);assert.equal(sha(fs.readFileSync(output)),before);
  });
  reject(doc=>{doc.entries[0].reviewedSectionHebrewSha256='0'.repeat(64);},/Context.*changed/);
  reject(doc=>{doc.entries[0].reviewedParagraphHebrewSha256='0'.repeat(64);},/Subsection.*changed/);
  reject(doc=>{doc.entries[0].status='reviewed-no-approved-connection';},/contradicts/);
  reject(doc=>{doc.entries[1].status='reviewed-with-connections';},/contradicts/);
  reject(doc=>{doc.entries[0].candidatesReviewed.pop();},/each school/);
  reject(doc=>{doc.entries[0].candidatesReviewed[0].ref='Fixture Tzadok 1';},/exact canonical passage/);
  reject(doc=>{doc.entries[0].candidatesReviewed[0].school='Ishbitz–Radzin';},/Incorrect candidate school/);
  reject(doc=>{doc.entries.push(doc.entries[0]);},/counted twice/);
  write(file,doc);
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
const canonicalRoot=path.resolve('dist/mcp-data'),canonical=readStudyCorpus(canonicalRoot);
const progress=buildThemeReviewProgress({write:false}).progress;
const published=JSON.parse(fs.readFileSync('dist/library/connected-ideas/review-progress.json','utf8'));
check(()=>assert.equal(published.contentSha256,progress.contentSha256,'Rebuild the subsection inventory after editorial changes'));
const refs=published.books.flatMap(book=>book.sections.flatMap(section=>section.subsections.map(row=>row.ref)));
check(()=>assert.equal(new Set(refs).size,refs.length,'A subsection appears more than once'));
check(()=>assert.deepEqual(new Set(refs),new Set(canonical.paragraphs.keys()),'Every canonical subsection must be represented'));
check(()=>assert.equal(published.counts.subsectionsReviewed+published.counts.subsectionsPendingReview,published.counts.subsections));
check(()=>{
  for(const book of published.books) for(const section of book.sections) for(const row of section.subsections) {
    if(row.connectionReview!=='pending')assert(row.review?.candidatesReviewed.length,'Completion needs documented review evidence');
  }
});
console.log(JSON.stringify({ok:true,checks,counts:published.counts,contentSha256:published.contentSha256}));

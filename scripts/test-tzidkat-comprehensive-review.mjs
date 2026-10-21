#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readStudyCorpus} from './build-theme-review-progress.mjs';

const ledger=JSON.parse(fs.readFileSync('sources/akiva/theme-reviews/tzidkat-60-264.json','utf8'));
const corpus=readStudyCorpus('dist/mcp-data');
const number=ref=>Number(/^Tzidkat HaTzadik (\d+):\d+$/.exec(ref)?.[1]);
const expected=new Map([...corpus.paragraphs].filter(([ref])=>{
  const n=number(ref); return n>=60 && n<=264 && n!==74;
}));
const sections=new Map();
for(const [ref,row] of expected){
  if(!sections.has(row.sectionRef))sections.set(row.sectionRef,[]);
  sections.get(row.sectionRef).push(ref);
}
assert.equal(sections.size,204,'The range has 204 existing simanim; 74 is absent');
assert.equal(expected.size,207,'Count every subsection, including all four at 264');
assert.deepEqual(ledger.scope.excludedSimanim,[74]);
assert.equal(ledger.scope.existingSimanim,204);
assert.equal(ledger.scope.existingSubsections,207);
const completed=new Set();
for(const entry of ledger.entries){
  assert(expected.has(entry.ref),'Review outside the available scope: '+entry.ref);
  assert(!completed.has(entry.ref),'Repeated review: '+entry.ref);
  completed.add(entry.ref);
  const row=expected.get(entry.ref);
  assert.equal(entry.reviewedParagraphHebrewSha256,row.paragraphHebrewSha256);
  assert.equal(entry.reviewedSectionHebrewSha256,row.sectionHebrewSha256);
  for(const school of ['Kisvei Rav Tzadok','Ishbitz–Radzin']){
    assert(entry.candidatesReviewed.some(candidate=>candidate.school===school && candidate.reason.trim()),
      'Missing documented school comparison at '+entry.ref);
  }
}
const full=[...sections.values()].filter(refs=>refs.every(ref=>completed.has(ref))).length;
const pending=[...expected.keys()].filter(ref=>!completed.has(ref));
assert.equal(ledger.scope.completedSimanim,full,'A multi-part siman needs every subsection');
assert.equal(ledger.scope.completedSubsections,completed.size);
assert.equal(ledger.scope.status,pending.length?'in-progress':'complete');
if(process.argv.includes('--require-complete')){
  assert.equal(pending.length,0,'Comprehensive review is unfinished: '+pending.join(', '));
  assert.equal(full,204);
}
console.log(JSON.stringify({ok:true,existingSimanim:204,excludedSimanim:[74],
  expectedSubsections:207,completedSimanim:full,completedSubsections:completed.size,
  pendingSubsections:pending.length,status:ledger.scope.status}));

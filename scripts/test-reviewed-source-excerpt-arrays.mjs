#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../dist/library/source-connections.js');
const excerpts = [
  {ref:'Shabbat 33a:4',he:'ראיה עברית ראשונה',en:'The first selected source quotation.'},
  {ref:'Shabbat 33a:5',he:'ראיה עברית שניה',en:'The second selected source quotation.'}
];
const fixture = {
  verificationStatus:'verified', quotationOnly:true,
  provenance:{sourceAudit:{release:'test-reviewed-source-excerpts-v1'}},
  sources:excerpts.map(({ref}) => ({ref,url:'https://www.sefaria.org/' + ref.replaceAll(' ', '_').replaceAll(':', '.'),role:'primary-source'})),
  reviewedSourceExcerpts:excerpts.map(excerpt => ({...excerpt,scope:'selected-source-excerpt',evidenceSha256:'a'.repeat(64)}))
};
fixture.paragraphs = excerpts.map((excerpt,index) => ({language:'en',
  text:`${excerpt.ref}: “${excerpt.en}”`,rich:[
    {text:excerpt.ref,bold:true,href:fixture.sources[index].url},{text:`: “${excerpt.en}”`}
  ]}));

for (const [index,excerpt] of excerpts.entries()) {
  for (const selector of [{ref:excerpt.ref},{sourceUrl:fixture.sources[index].url},
    {ref:excerpt.ref,sourceUrl:fixture.sources[index].url}]) {
    const quote = engine.sourceQuotationFromNote(fixture,selector);
    assert.equal(quote.ref,excerpt.ref);
    assert.equal(quote.en,excerpt.en);
    assert.equal(quote.coverage,'excerpt');
    assert.equal(quote.he,undefined,'Audit Hebrew is not display content');
  }
}
assert.equal(engine.sourceQuotationFromNote(fixture,{ref:'Shabbat_33a.5'}).en,excerpts[1].en);
for (const selector of [{},{ref:'Shabbat 33a'},{ref:'Shabbat 33a:6'},
  {ref:excerpts[0].ref,sourceUrl:fixture.sources[1].url}]) {
  assert.equal(engine.sourceQuotationFromNote(fixture,selector),null,'Ambiguous or mismatched selectors must not choose a quote');
}
for (const mutate of [
  note => { note.verificationStatus = 'draft'; },
  note => { delete note.provenance.sourceAudit; },
  note => { note.reviewedSourceExcerpts[0].scope = 'complete'; },
  note => { note.reviewedSourceExcerpts[0].evidenceSha256 = ''; },
  note => { note.reviewedSourceExcerpts[0].en = 'A quote not present in the note.'; },
  note => { note.reviewedSourceExcerpts.push({...note.reviewedSourceExcerpts[0]}); },
  note => { note.sources.push({...note.sources[0]}); },
  note => { note.sources[0].url = note.sources[1].url; },
  note => { note.paragraphs[0].text += ' Added editorial prose.'; },
  note => { note.paragraphs[0].rich[1].text += ' Added editorial prose.'; },
  note => { note.paragraphs[0].rich[0].href = note.sources[1].url; },
  note => { note.paragraphs[0].rich[0].bold = false; }
]) {
  const changed = structuredClone(fixture);
  mutate(changed);
  assert.equal(engine.sourceQuotationFromNote(changed,{ref:excerpts[0].ref}),null);
}
const single = structuredClone(fixture);
single.sources.splice(1); single.reviewedSourceExcerpts.splice(1); single.paragraphs.splice(1);
assert.equal(engine.sourceQuotationFromNote(single).en,excerpts[0].en);
const legacyMultiple = structuredClone(fixture);
delete legacyMultiple.reviewedSourceExcerpts;
assert.equal(engine.sourceQuotationFromNote(legacyMultiple,{ref:excerpts[0].ref}),null,
  'Unaudited multi-source notes must retain the legacy behavior');
console.log('PASS: reviewed source excerpt arrays select exact, displayed English excerpts and reject mismatched or ambiguous records.');

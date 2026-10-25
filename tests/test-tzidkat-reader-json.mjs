import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadPack,verify,PACK} from '../scripts/publish-tzidkat-reader-json.mjs';
import {validateEnglishApproval} from '../scripts/tzidkat-english-replacement-transition.mjs';
const args=process.argv.slice(2),root=path.resolve(args.includes('--root')?args[args.indexOf('--root')+1]:'dist');
const {pack}=loadPack(),sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const report=verify(root);let native=0;const numbers=new Set();
for(let i=0;i<264;i++){
  const file=JSON.parse(fs.readFileSync(path.join(root,'library/data/tzidkat-hatzadik/'+i+'.json')));
  for(const row of file)for(const note of row.footnotes||[]){assert(!numbers.has(note.number),'Duplicated note number');numbers.add(note.number);native++;}
}
assert.equal(native,3684);assert(numbers.has(4031));
for(const c of pack.chapters){
  const rows=JSON.parse(fs.readFileSync(path.join(root,c.path))),before=structuredClone(rows);
  for(const r of pack.approval.records.filter(r=>r.chapterPath===c.path)){
    const note=rows[r.rowIndex].footnotes[r.noteIndex];assert.deepEqual(note,r.afterNote);
    for(const key of ['number','sourceId','placementId','phraseIndex','heCharOffset','enCharOffset','heAnchorPrefix','enAnchorPrefix','heWord','nativeConnections'])assert.deepEqual(note[key],r.beforeNote[key]);
    before[r.rowIndex].footnotes[r.noteIndex]=r.beforeNote;
  }
  assert.equal(sha(before),c.beforeSha256,'Author text or another note changed');
  assert.equal(sha(rows),c.afterSha256);
}
const forbidden=structuredClone(pack.approval);forbidden.records[0].afterNote.phraseIndex+=1;assert.throws(()=>validateEnglishApproval(forbidden),'Changed Hebrew placement accepted');
const untranslated=structuredClone(pack.approval);untranslated.records[0].review.completeSelectedUnit=false;assert.throws(()=>validateEnglishApproval(untranslated),'Incomplete quotation accepted');
const mcp=JSON.parse(fs.readFileSync(path.join(root,'mcp-data/text/tzidkat-hatzadik.json'))),mcpNotes=new Map(mcp.paras.flatMap(p=>(p.f||[]).map(n=>[Number(n[0]),n])));
for(const r of pack.approval.records)assert.equal(mcpNotes.get(r.number)[1],r.afterNote.paragraphs.map(p=>p.text).join('\n'));
const sw=fs.readFileSync(path.join(root,'library/sw.js'),'utf8'),html=fs.readFileSync(path.join(root,'library/index.html'),'utf8');assert(sw.includes('-tzidkat-reader-'));assert(html.includes('/* 20261025-tzidkat-reader-json-v1 */'));
// Cache changes must not introduce new download actions or document links.
assert(!html.includes('const tzidkatEditionDownloads ='));
fs.mkdirSync('artifacts/tzidkat-reader-json',{recursive:true});
fs.writeFileSync('artifacts/tzidkat-reader-json/data-verification.json',JSON.stringify({...report,nativeNotesChecked:native,all1369AnchorsAndOriginalChapterPreimagesChecked:true,negativeGuards:2}));
console.log(JSON.stringify({...report,nativeNotesChecked:native,all1369AnchorsAndOriginalChapterPreimagesChecked:true,negativeGuards:2}));

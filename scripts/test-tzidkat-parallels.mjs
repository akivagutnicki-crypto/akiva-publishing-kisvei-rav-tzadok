import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const overlay=JSON.parse(fs.readFileSync('sources/akiva/overlays/tzidkat-footnote-parallels.json','utf8'));
const sourcePath='sources/akiva/Tzidkat_HaTzadik.json';
const bytes=fs.readFileSync(sourcePath,'utf8');
const source=JSON.parse(bytes);
const toc=JSON.parse(fs.readFileSync('dist/library/data/tzidkat-hatzadik/toc.json','utf8'));
for(const e of overlay.entries){
 const s=source.sections.find(s=>s.n===e.siman), i=s.items.find(i=>i.n===e.item);
 const note=i.footnotes.find(n=>n.placementId===e.anchor.placementId);
 assert.ok(note.parallelEdition,'Unimported parallel '+e.anchor.sourceId);
 assert.equal(note.paragraphs.length,e.parallels.length,'One or two complete English paragraphs');
 for(const p of note.paragraphs){
  assert.ok(!/[א-ת]/.test(p.text));
  assert.equal(p.rich.map(r=>r.text).join(''),p.text);
 }
 for(const [index,key] of e.parallels.entries()){
  const p=overlay.passages[key];
  const rich=note.paragraphs[index].rich;
  assert.ok(rich.some(r=>r.bold&&r.text===(p.displayRef||p.ref)&&r.href==='https://www.sefaria.org/'+p.ref.replaceAll(' ','_')),'Bold canonical source link '+key);
  assert.ok(note.paragraphs[index].text.includes(p.quote),'Complete quotation '+key);
  assert.ok(note.sources.some(s=>s.ref===p.ref),'Parallel absent from source index');
 }
 for(const [key,value] of Object.entries(e.anchor))assert.deepEqual(note[key],value,'Moved footnote anchor');
 const leaf=toc.toc.children.find(l=>l.ref==='Tzidkat HaTzadik '+e.siman);
 const data=JSON.parse(fs.readFileSync('dist/library/data/tzidkat-hatzadik/'+leaf.id+'.json','utf8'));
 assert.deepEqual(data.find(i=>i.n===e.item).footnotes.find(n=>n.placementId===e.anchor.placementId),note,'Reader omitted parallel quotation');
}
const correction=source.sections.flatMap(s=>s.items.flatMap(i=>i.footnotes||[])).find(n=>n.sourceId==='TZ-0934');
assert.ok(correction.sources.some(s=>s.ref==='Zohar, Beshalach 27:360'),'Exact Netzach and Hod Zohar source');
assert.ok(correction.paragraphs[0].text.includes('Hod and Netzach'));
assert.ok(!correction.paragraphs[0].text.includes('Moses was created'));
const run=spawnSync(process.execPath,['scripts/import-tzidkat-parallels.mjs'],{encoding:'utf8'});
assert.equal(run.status,0,run.stderr);
assert.equal(fs.readFileSync(sourcePath,'utf8'),bytes,'Idempotent parallel import');
assert.equal(source.footnoteParallelInfo.reviewedPlacements,overlay.entries.length);
console.log('PASS Tzidkat parallel quotations: '+overlay.entries.length+' reviewed placements, complete English, bold canonical links, exact anchors, corrected Zohar, and idempotent import.');

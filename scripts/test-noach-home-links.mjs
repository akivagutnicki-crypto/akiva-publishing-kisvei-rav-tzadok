// Regression check for the links shown on the Rav Tzadok Library homepage.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const home = fs.readFileSync('dist/library/index.html', 'utf8');
const dir = 'dist/library/data/peri-tzadik/';
const toc = JSON.parse(fs.readFileSync(dir + 'toc.json', 'utf8'));
const leaves = [];
function walk(node) {
  if (node?.ref) leaves.push(node);
  for (const child of node?.children || []) walk(child);
}
walk(toc.toc);

for (const [ois, phrases, notes] of [[5, 158, 15], [6, 194, 16]]) {
  const ref = 'Peri Tzadik, Noach ' + ois;
  const hash = '#/read/Peri_Tzadik,_Noach_' + ois;
  assert.ok(home.includes('href="' + hash + '"'), 'Homepage is missing a direct reader link to ' + ref);
  const leaf = leaves.find(l => l.ref === ref && l.interlinear);
  assert.ok(leaf, 'Direct link leads to a missing interlinear chapter: ' + ref);
  const segments = JSON.parse(fs.readFileSync(dir + leaf.id + '.json', 'utf8')).filter(item => item.p);
  assert.equal(segments.flatMap(item => item.p).length, phrases, 'Missing phrases in ' + ref);
  const sourceNotes = segments.flatMap(item => item.footnotes || []);
  assert.ok(sourceNotes.length >= notes, 'Missing annotated footnotes in ' + ref);
  const originallyReviewed=sourceNotes.filter(n => !n.provenance?.reviewSource);
  assert.equal(originallyReviewed.length,notes,'One of the original Word notes has gone missing in '+ref);
  assert.ok(originallyReviewed.every(note => note.paragraphs?.length >= 6), 'Incomplete original English commentary in ' + ref);
  assert.ok(sourceNotes.filter(n=>n.provenance?.reviewSource).every(n=>n.paragraphs?.length>=1),'Missing expanded source excerpts in '+ref);
}

for (const [file, header] of [
  ['pri-tzaddik-noach-ois-5-6-chassidus-kdp-7x10.pdf', '%PDF'],
  ['pri-tzaddik-noach-ois-5-6-chassidus-kdp-7x10.docx', 'PK'],
]) {
  const local = 'dist/library/downloads/' + file;
  assert.ok(home.includes('href="downloads/' + file + '"'), 'Broken homepage download path ' + file);
  assert.ok(fs.existsSync(local), 'Missing publication asset: ' + local);
  assert.ok(fs.statSync(local).size > 10240, 'Empty/invalid publication asset: ' + local);
  assert.equal(fs.readFileSync(local).subarray(0,header.length).toString(), header, 'Bad file header: ' + local);
}
console.log('PASS: Home links open both interlinear annotated Noach chapters, all 31 footnotes remain, and the linked PDF/DOCX assets are included.');

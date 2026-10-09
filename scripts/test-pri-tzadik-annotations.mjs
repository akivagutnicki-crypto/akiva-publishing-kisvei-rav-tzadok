// Ensures the published reader really contains all 31 complete annotated Word footnotes.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const dir = 'dist/library/data/peri-tzadik';
const toc = JSON.parse(fs.readFileSync(dir + '/toc.json', 'utf8'));
const leaves = [];
function collect(node) {
  if (node?.ref) leaves.push(node);
  for (const child of node?.children || []) collect(child);
}
collect(toc.toc);
const all = [];
for (const [ois, expectedNotes, expectedPhrases] of [[5,15,162],[6,16,194]]) {
  const ref = 'Peri Tzadik, Noach ' + ois;
  const leaf = leaves.find(l => l.ref === ref && l.interlinear);
  assert.ok(leaf, 'Missing interlinear reader section: ' + ref);
  const data = JSON.parse(fs.readFileSync(dir + '/' + leaf.id + '.json', 'utf8'));
  const paragraphs = data.filter(x => x.p);
  const phrases = paragraphs.reduce((sum, p) => sum + p.p.length, 0);
  assert.equal(phrases, expectedPhrases, 'Changed interlinear phrase count: ' + ref);
  const annotated = paragraphs.flatMap(p => (p.footnotes || []).map(note => ({note,p})));
  assert.equal(annotated.length, expectedNotes, 'Incorrect annotated footnote count: ' + ref);
  for (const {note,p} of annotated) {
    assert.ok(Number.isInteger(note.phraseIndex) && note.phraseIndex >= 0 && note.phraseIndex < p.p.length,
      'Footnote positioned outside a phrase: ' + note.number);
    assert.equal(note.paragraphs.length, 6, 'Missing source/parallel/commentary block: ' + note.number);
    assert.ok(note.paragraphs.every(item => item.text.length > 20),
      'Empty or truncated source passage in footnote ' + note.number);
    assert.ok(note.paragraphs.some(item => /English translation/i.test(item.text)),
      'No English translation in footnote ' + note.number);
    const links = note.paragraphs.flatMap(item => item.links || []);
    assert.ok(links.length >= 2 && links.every(link => /^https:\/\/www\.sefaria\.org\//.test(link.url)),
      'Invalid or missing Sefaria source links in note ' + note.number);
    all.push(note.number);
  }
  console.log('Verified ' + ref + ': ' + phrases + ' interlinear phrases, ' + annotated.length + ' fully anchored annotated footnotes');
}
assert.deepEqual(all,[...Array(31)].map((_,i)=>i+1),'Footnote numbering is not complete and sequential');
console.log('Annotated Pri Tzaddik Noach Ois 5–6: 31 complete footnotes verified.');

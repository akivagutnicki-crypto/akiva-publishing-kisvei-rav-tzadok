// Verify Akiva Publishing's annotated Rosh Chodesh study editions, down to each Word-footnote phrase.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base = 'dist/library/data/peri-tzadik/';
const toc = JSON.parse(fs.readFileSync(base + 'toc.json', 'utf8'));
const leaves = [];
function walk(node) {
  if (node?.ref) leaves.push(node);
  for (const child of node?.children || []) walk(child);
}
walk(toc.toc);
let count = 0;
for (const [section, totalNotes, totalPhrases, docx] of [
  ['Rosh Chodesh (manuscript)', 33, 172, 'pri-tzaddik-rosh-chodesh-manuscript-annotated.docx'],
  ['Rosh Chodesh Cheshvan', 48, 328, 'pri-tzaddik-rosh-chodesh-marcheshvan-annotated.docx']
]) {
  const ref = 'Peri Tzadik, ' + section;
  const leaf = leaves.find(item => item.ref === ref && item.interlinear);
  assert.ok(leaf, 'Missing study-edition reader chapter: ' + ref);
  assert.equal(leaf.downloadDocx, 'downloads/' + docx, 'Missing reader download: ' + ref);
  const doc = fs.readFileSync('dist/library/downloads/' + docx);
  assert.ok(doc.length > 50000 && doc[0] === 0x50 && doc[1] === 0x4b,
    'Missing or invalid Word package: ' + docx);
  const chapter = JSON.parse(fs.readFileSync(base + leaf.id + '.json', 'utf8'));
  const segments = chapter.filter(item => item.p);
  assert.equal(segments.reduce((n, item) => n + item.p.length, 0), totalPhrases,
    'Interlinear text coverage changed: ' + ref);
  assert.ok(segments.every(s => s.p.every(p => p.length === 2 && p[0] && p[1])),
    'Unpaired original Hebrew/English: ' + ref);
  const notes = segments.flatMap(item => (item.footnotes || []).map(n => ({n, segment:item})));
  assert.equal(notes.length, totalNotes, 'Footnote count: ' + ref);
  for (const [i, {n, segment}] of notes.entries()) {
    assert.equal(n.number, i + 1, 'Footnotes must retain Word numbering: ' + ref);
    assert.ok(n.phraseIndex >= 0 && n.phraseIndex < segment.p.length, 'Orphaned note: ' + n.number);
    assert.ok(n.paragraphs.length >= 5, 'Truncated multi-paragraph source: ' + n.number);
    const text = n.paragraphs.map(p => p.text).join('\n');
    assert.ok(text.length > 1200, 'Shortened source excerpts: ' + n.number);
    assert.match(text, /Kisvei Rav Tzadok/i, 'Missing Rav Tzadok parallel: ' + n.number);
    assert.match(text, /Kisvei Ishbitz/i, 'Missing Ishbitz-Radzin parallel: ' + n.number);
    assert.ok(n.paragraphs.every(p => Array.isArray(p.rich) && p.rich.length &&
      p.rich.map(r => r.text).join('') === p.text),
      'Failed to preserve original Word bolding/quotations: ' + n.number);
    const links = n.paragraphs.flatMap(p => p.links || []);
    for (const l of links)
      assert.match(l.url, /^https:\/\/(?:www\.)?sefaria\.org\//i,
        'Invalid Sefaria reference: ' + n.number);
  }
  count += notes.length;
  console.log(ref + ': ' + totalPhrases + ' interlinear phrases, ' + notes.length +
    ' anchored full-text scholarly footnotes, DOCX available.');
}
assert.equal(count, 81);
console.log('PASS — Both Rosh Chodesh annotated study editions and all 81 Word footnotes.');

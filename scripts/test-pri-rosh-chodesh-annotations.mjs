// Verify Akiva Publishing's annotated Rosh Chodesh study editions, down to each Word-footnote phrase.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
// Read Word's actual language runs and footnote references, independently of
// the importer. A count alone did not catch the corrupted PDF phrase splits.
const wordReader = `
import json, sys, zipfile, xml.etree.ElementTree as E
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W='{'+ns['w']+'}'
with zipfile.ZipFile(sys.argv[1]) as z:
    root=E.fromstring(z.read('word/document.xml'))
    notes=E.fromstring(z.read('word/footnotes.xml'))
pairs=[]; anchors={}
for paragraph in root.findall('w:body/w:p',ns):
    pending=None
    for run in paragraph.findall('w:r',ns):
        size=run.find('w:rPr/w:sz',ns); rtl=run.find('w:rPr/w:rtl',ns)
        text=''.join(t.text or '' for t in run.findall('.//w:t',ns)).strip()
        if size is not None and size.get(W+'val')=='19' and rtl is not None and text:
            if rtl.get(W+'val','1')!='0':
                assert pending is None
                pending=text
            else:
                assert pending is not None
                pairs.append([pending,text]); pending=None
        for marker in run.findall('w:footnoteReference',ns):
            assert pending is None
            anchors[marker.get(W+'id')]=len(pairs)-1
    assert pending is None
paragraphs={n.get(W+'id'):[''.join(t.text or '' for t in p.findall('.//w:t',ns)) for p in n.findall('w:p',ns)] for n in notes if int(n.get(W+'id'))>0}
print(json.dumps({'pairs':pairs,'anchors':anchors,'paragraphs':paragraphs}))
`;
const plain = s => s.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot);|&#(?:39|x27);/g,
  token => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x27;':"'"}[token]));
const edition = JSON.parse(fs.readFileSync('sources/akiva/editions/Peri_Tzadik_Bereshit_Cheshvan_Noach_Study_Edition.json', 'utf8'));
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
  ['Rosh Chodesh Cheshvan', 48, 327, 'pri-tzaddik-rosh-chodesh-marcheshvan-annotated.docx']
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
  const word = JSON.parse(execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3',
    ['-c', wordReader, 'dist/library/downloads/' + docx], {encoding:'utf8', maxBuffer:10 * 1024 * 1024}));
  const source = edition.sections.find(s => s.node === section);
  assert.equal(source.useVerifiedHebrew, true, 'Reviewed Word phrases must bypass estimated alignment');
  assert.deepEqual(source.topics.flatMap(t => t.pairs), word.pairs, 'Source edition differs from Word');
  const published = segments.flatMap(s => s.p.map(p => p.map(plain)));
  assert.deepEqual(published, word.pairs, 'Published Hebrew/English differs from reviewed Word phrases');
  for (const [he, en] of published) {
    assert.doesNotMatch(he, /(?:^|\s)[\u0591-\u05bd\u05bf-\u05c7]/, 'Detached Hebrew vowel');
    assert.match(he, /[א-ת][\u05b0-\u05bc]/, 'Missing Hebrew vocalization');
    assert.match(en, /[A-Za-z]/, 'English translation is absent');
  }
  if (section === 'Rosh Chodesh (manuscript)') {
    assert.match(published[21][1], /explanation is strained/);
    assert.match(published[139][1], /sanctify him/);
    assert.match(published[53][0], /חֲכָמֵינוּ/);
  } else {
    assert.match(published[49][1], /not again \[fall\]/);
    assert.match(published[145][1], /And there was light/);
    assert.match(published[282][1], /Woman of Harlotry seeks/);
    assert.match(published[195][1], /intestines in the person/);
  }
  assert.equal(segments.reduce((n, item) => n + item.p.length, 0), totalPhrases,
    'Interlinear text coverage changed: ' + ref);
  assert.ok(segments.every(s => s.p.every(p => p.length === 2 && p[0] && p[1])),
    'Unpaired original Hebrew/English: ' + ref);
  const notes = segments.flatMap(item => (item.footnotes || []).map(n => ({n, segment:item})));
  assert.equal(notes.length, totalNotes, 'Footnote count: ' + ref);
  for (const [i, {n, segment}] of notes.entries()) {
    assert.equal(n.number, i + 1, 'Footnotes must retain Word numbering: ' + ref);
    assert.ok(n.phraseIndex >= 0 && n.phraseIndex < segment.p.length, 'Orphaned note: ' + n.number);
    const offset = segments.slice(0, segments.indexOf(segment)).reduce((sum, s) => sum + s.p.length, 0);
    assert.equal(offset + n.phraseIndex, word.anchors[n.number], 'Footnote moved away from its Word phrase: ' + n.number);
    assert.deepEqual(n.paragraphs.map(p => p.text), word.paragraphs[n.number], 'Website shortened or changed Word footnote: ' + n.number);
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
// The supplied Cheshvan URL ends in a comma. Resolve it to the translated leaf.
const html = fs.readFileSync('dist/library/index.html', 'utf8');
const resolver = html.slice(html.indexOf('let CATALOG = []'), html.indexOf('const CAT_COLORS'));
const context = vm.createContext({gematria:String, fetch:async url => ({ok:true,
  json:async () => JSON.parse(fs.readFileSync('dist/library/' + url.split('?')[0], 'utf8'))})});
vm.runInContext(resolver, context);
for (const section of ['Rosh Chodesh (manuscript)', 'Rosh Chodesh Cheshvan']) {
  const ref = 'Peri Tzadik, ' + section;
  const exact = await context.resolveLocal(ref);
  const trailing = await context.resolveLocal(ref + ',');
  assert.ok(exact.phrases && trailing.phrases, 'Direct link lost interlinear mode');
  assert.equal(trailing.sectionRef, exact.sectionRef, 'Trailing comma opened another chapter');
  assert.deepEqual(trailing.phrases, exact.phrases);
}
console.log('PASS — Both Rosh Chodesh annotated study editions and all 81 Word footnotes.');

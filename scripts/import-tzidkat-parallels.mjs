import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const sourcePath = 'sources/akiva/Tzidkat_HaTzadik.json';
const overlayBytes = fs.readFileSync('sources/akiva/overlays/tzidkat-footnote-parallels.json', 'utf8');
const overlay = JSON.parse(overlayBytes);
const collation = JSON.parse(fs.readFileSync('sources/akiva/overlays/tzidkat-parallel-collation.json','utf8'));
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const before = JSON.stringify(source.sections.map(s => ({n:s.n, items:s.items.map(i => ({n:i.n,p:i.p}))})));
const link = ref => 'https://www.sefaria.org/' + ref.replaceAll(' ', '_');
const passageRuns = passage => [
  {text:passage.displayRef || passage.ref, bold:true, href:link(passage.ref)},
  {text:': “' + passage.quote + '”'}
];
const paragraph = rich => ({text:rich.map(r => r.text).join(''), rich});
const sourceLink = (passage,role) => ({ref:passage.ref, url:link(passage.ref),
  connectionsUrl:'https://www.sefaria.org/api/links/' + encodeURIComponent(passage.ref) + '?with=all', role});
const placements = new Set();
for (const entry of overlay.entries) {
  assert.ok(!placements.has(entry.anchor.placementId), 'Repeated placement in parallel overlay');
  placements.add(entry.anchor.placementId);
  const section = source.sections.find(s => s.n === entry.siman);
  const item = section?.items.find(i => i.n === entry.item);
  const note = item?.footnotes?.find(n => n.placementId === entry.anchor.placementId);
  assert.ok(note, 'Missing parallel footnote ' + entry.anchor.placementId);
  for (const [key,value] of Object.entries(entry.anchor)) assert.deepEqual(note[key],value,'Changed anchor '+key);
  const current = sha(JSON.stringify({paragraphs:note.paragraphs,sources:note.sources}));
  assert.ok(current === entry.baseSha256 || note.parallelEdition?.baseSha256 === entry.baseSha256,
    'Primary note changed since collation: ' + note.sourceId);
  assert.equal(sha(JSON.stringify(entry.original)),entry.baseSha256,'Modified collation baseline');
  assert.ok(entry.parallels.length >= 1 && entry.parallels.length <= 2);
  const passages = entry.parallels.map(key => {
    const p = overlay.passages[key];
    assert.ok(p?.ref && p.quote && p.hebrewExcerpt && p.verification,'Incomplete source '+key);
    assert.equal(collation[key]?.ref,p.ref,'Uncollated source '+key);
    assert.equal(collation[key]?.englishSha256,sha(p.quote),'Translation changed after collation '+key);
    assert.equal(collation[key]?.hebrewExcerptSha256,sha(p.hebrewExcerpt),'Excerpt changed after collation '+key);
    assert.ok(!/[א-ת]/.test(p.quote),'English-only footnote quotation '+key);
    return p;
  });
  assert.equal(passages[0].school,'Rav Tzadok','Rav Tzadok must precede Ishbitz');
  if (passages[1]) assert.equal(passages[1].school,'Ishbitz–Radzin');
  let primaryParagraphs = structuredClone(entry.original.paragraphs).filter(p => !p.text.startsWith('Sources: '));
  let primarySources = structuredClone(entry.original.sources);
  if (entry.primaryCorrection) {
    const correction = overlay.passages[entry.primaryCorrection];
    assert.equal(correction.school,'Primary source');
    assert.equal(collation[entry.primaryCorrection]?.englishSha256,sha(correction.quote),'Uncollated primary correction');
    primaryParagraphs = [paragraph(passageRuns(correction))];
    primarySources = [sourceLink(correction,'source')];
  }
  // Two English paragraphs: the original source and Rav Tzadok, then Ishbitz.
  // The overlay retains the complete primary note and exact Hebrew audit excerpts.
  const first = primaryParagraphs.flatMap((p,i) => [...(i ? [{text:' '}] : []),...p.rich]);
  note.paragraphs = [paragraph([...first,{text:' '},...passageRuns(passages[0])])];
  if (passages[1]) note.paragraphs.push(paragraph(passageRuns(passages[1])));
  const seen = new Set();
  note.sources = [...primarySources,...passages.map((p,i) => sourceLink(p,i ? 'parallel-ishbitz-radzin':'parallel-rav-tzadok'))]
    .filter(s => !seen.has(s.ref) && seen.add(s.ref));
  note.parallelEdition = {revision:overlay.revision,baseSha256:entry.baseSha256,
    passages:entry.parallels,primaryCorrection:entry.primaryCorrection || null};
}
assert.equal(JSON.stringify(source.sections.map(s => ({n:s.n, items:s.items.map(i => ({n:i.n,p:i.p}))}))),before,
  'Parallel importer must preserve every Hebrew and English phrase');
const allNotes = source.sections.flatMap(s => s.items.flatMap(i => i.footnotes || []));
source.footnoteImportInfo.sourceLinks = allNotes.reduce((n,x) => n + x.sources.length,0);
source.footnoteParallelInfo = {revision:overlay.revision,overlaySha256:sha(overlayBytes),
  reviewedNotes:new Set(overlay.entries.map(e => e.anchor.sourceId)).size,
  reviewedPlacements:placements.size,quotedPassages:Object.keys(overlay.passages).length,
  totalNotes:source.footnoteImportInfo.notes};
fs.writeFileSync(sourcePath,JSON.stringify(source,null,2)+'\n');
console.log('IMPORTED TZIDKAT PARALLELS: ' + source.footnoteParallelInfo.reviewedNotes + ' reviewed notes; ' +
  placements.size + ' exact anchors preserved; ' + Object.keys(overlay.passages).length + ' collated English passages.');

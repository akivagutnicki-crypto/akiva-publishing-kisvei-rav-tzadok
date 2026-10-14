// End-to-end validation of the supplied 2,096 footnotes and two parallel sources per note.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = JSON.parse(fs.readFileSync('sources/akiva/Tzidkat_HaTzadik.json','utf8'));
const toc = JSON.parse(fs.readFileSync('dist/library/data/tzidkat-hatzadik/toc.json','utf8'));
assert.equal(src.sections.length,264);
let count=0,covered=0,parallelLinks=0;
for (const sec of src.sections) {
  const notes=sec.items.flatMap(item=>item.footnotes||[]);
  if(notes.length)covered++;
  const uniqueSources=new Set(),lastBySchool=[null,null];
  const leaf=toc.toc.children.find(t=>t.ref==='Tzidkat HaTzadik '+sec.n);
  assert.ok(leaf,'Missing reader chapter '+sec.n);
  const published=JSON.parse(fs.readFileSync('dist/library/data/tzidkat-hatzadik/'+leaf.id+'.json','utf8'));
  assert.deepEqual(
    published.flatMap(item=>item.footnotes||[]),
    notes,
    'Lost source or parallel footnotes in reader chapter '+sec.n
  );
  for(const note of notes) {
    count++;
    assert.equal(note.number,count,'Book-wide footnote numbering');
    assert.equal(note.sourceId,'TZ-'+String(count).padStart(4,'0'));
    assert.equal(note.placementId,note.sourceId+'-1');
    assert.equal(note.paragraphs.length,4,'Primary source + Rav Tzadok + Ishbitz + source links');
    assert.equal(note.sources.length,1,'One primary source per note');
    assert.equal(note.nativeConnections.length,2,'Two source-school parallels per note');
    assert.ok(!uniqueSources.has(note.sources[0].ref),'Repeated source within siman '+sec.n);
    uniqueSources.add(note.sources[0].ref);
    for(const [index,school] of ['Kisvei Rav Tzadok Parallel','Kisvei Beis Ishbitz–Radzin Parallel'].entries()){
      const paragraph=note.paragraphs[index+1];
      assert.ok(paragraph.text.startsWith(school+' — '),'Wrong source-school label '+count);
      assert.ok(paragraph.text.includes('“'),'Missing actual English translated passage '+count);
      assert.ok(!/[א-ת]/.test(paragraph.text),'Footnote is not fully English '+count);
      const anchor=paragraph.rich.find(x=>x.href&&x.bold);
      assert.ok(anchor && anchor.href.startsWith('https://www.sefaria.org/'));
      assert.ok(paragraph.text.includes(note.nativeConnections[index]),'Wrong quoted passage '+count);
      assert.notEqual(note.nativeConnections[index],lastBySchool[index],
        'Back-to-back repeated Chassidic parallel in siman '+sec.n+' (school '+index+')');
      lastBySchool[index]=note.nativeConnections[index];
      parallelLinks++;
    }
    for(const p of note.paragraphs)
      assert.equal(p.rich.map(x=>x.text).join(''),p.text,'Truncated footnote '+count);
    assert.ok(note.paragraphs[3].text.includes('Sources:'));
    assert.equal(note.verificationStatus,'verified');
  }
}
assert.equal(count,2096,'Missing notes');
assert.equal(covered,263,'Missing annotated simanim');
assert.equal(parallelLinks,4192,'Both schools must be linked for all notes');
assert.equal(src.footnoteImportInfo.notes,count);
assert.equal(src.footnoteImportInfo.placements,count);
console.log('PASS: 2,096 complete Hebrew-anchored Tzidkat footnotes, 4,192 linked distinct parallels, no adjacent parallel repetition, and all 263 annotated simanim published.');

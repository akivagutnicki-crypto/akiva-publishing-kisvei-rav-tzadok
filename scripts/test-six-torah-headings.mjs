// Structural regression: editorial headings throughout six interlinear seforim,
// with every Hebrew source marker, popup, and translated phrase intact.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root='dist/library/data/';
const expected={
  'poked-akarim':[6,952],
  'machshavot-charutz':[21,3580],
  'likkutei-maamarim':[19,3347],
  'divrei-chalomot':[28,247],
  'kometz-haminchah':[194,1688],
  'et-haochel':[16,248]
};
let allSections=0,allInline=0,allNotes=0;
for(const [slug,[sections,notes]] of Object.entries(expected)){
  const dir=root+slug+'/';
  const files=fs.readdirSync(dir).filter(x=>/^\d+(?:-\d+)?\.json$/.test(x));
  assert.equal(files.length,sections,'Wrong section count for '+slug);
  let counted=0,inline=0;
  for(const file of files){
    const items=JSON.parse(fs.readFileSync(dir+file,'utf8'));
    assert.ok(items[0]?.h?.startsWith('§ '),'Section title missing '+slug+'/'+file);
    assert.ok(items[0].h.includes('\n'),'Concise section summary missing '+slug+'/'+file);
    const pairs=items.filter(x=>Array.isArray(x.p));
    assert.ok(pairs.length,'Missing text '+slug+'/'+file);
    for(const item of pairs){
      counted+=(item.footnotes||[]).length;
      for(const hd of item.inlineHeadings||[]){
        assert.ok(Number.isInteger(hd.phraseIndex)&&hd.phraseIndex>=0&&hd.phraseIndex<item.p.length,'Heading outside exact phrase '+slug+'/'+file);
        assert.ok(hd.text?.length>=9,'Editorial headline too short '+slug+'/'+file);
        inline++;
      }
    }
  }
  assert.equal(counted,notes,'An original source footnote disappeared in '+slug);
  assert.ok(inline>0,'Thematic transitions missing '+slug);
  console.log('PASS six-book headings: '+slug+' '+files.length+' sections, '+inline+' inline subheadings, '+counted+' original notes');
  allSections+=files.length;allInline+=inline;allNotes+=counted;
}
// Eis HaOchel's contents must display the same specific editorial chapter
// titles that readers encounter at the start of each ois.
const etToc=JSON.parse(fs.readFileSync(root+'et-haochel/toc.json','utf8'));
const etChapters=etToc.toc.children;
assert.equal(etChapters.length,16,'Missing Kuntres Eis HaOchel chapters');
const observed=new Set();
for(const leaf of etChapters){
 assert.ok(leaf.ref.startsWith('Et HaOchel '),'Wrong Eis HaOchel TOC ref');
 assert.ok(leaf.en.length>=25&&!/^Ois\\s*\\d+/.test(leaf.en),'Unhelpful Eis HaOchel TOC title '+leaf.ref);
 assert.ok(!observed.has(leaf.en),'Duplicate Eis HaOchel chapter title');
 observed.add(leaf.en);
 const contents=JSON.parse(fs.readFileSync(root+'et-haochel/'+leaf.id+'.json','utf8'));
 assert.ok(contents[0].h.startsWith('§ '+leaf.en+'\n'),'Eis HaOchel headline differs from the TOC '+leaf.ref);
}
assert.equal(allSections,284);
assert.ok(allInline>=1200);
assert.equal(allNotes,10062);
console.log('PASS 284 section headings, '+allInline+' phrase-level transitions; '+allNotes+' footnotes retained');

// End-to-end conservation checks for the real corrected Takanas DOCX source.
// Run after build-library and build-mcp-index; this does not rebuild unrelated live books.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=process.argv[2]||'dist';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const plain=s=>String(s).replace(/<[^>]*>/g,'').replace(/&(?:quot|amp|apos|lt|gt|nbsp|#39|#x27);/g,t=>({'&quot;':'"','&amp;':'&','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&#39;':"'",'&#x27;':"'"}[t]));
const source=read('sources/akiva/Takanat_HaShavin.json');
const manifest=read('sources/akiva/overlays/takanas-docx-master-20261102-manifest.json');
assert.equal(source.editionId,'takanas-docx-master-2026-11-02');
assert.equal(sha(fs.readFileSync('sources/akiva/Takanat_HaShavin.json')),manifest.canonicalSha256);
for(const d of manifest.docx)assert.equal(sha(fs.readFileSync(d.path)),d.sha256);
const mcp=read(path.join(root,'mcp-data/text/takanat-hashavin.json'));
const refs=new Map(mcp.paras.map(p=>[p.r,p]));
let pairs=0,notes=0,paragraphs=0;const ids=new Set();
for(let section=0;section<source.sections.length;section++){
 const src=source.sections[section];const current=read(path.join(root,`library/data/takanat-hashavin/${section}.json`));
 const rows=src.items.filter(x=>x.p),built=current.filter(x=>x.p);
 assert.equal(built.length,rows.length,`Paragraphs in section ${section}`);
 for(let n=0;n<rows.length;n++){
  const expected=rows[n],actual=built[n];assert.equal(actual.n,expected.n);
  assert.deepEqual(actual.p.map(p=>p.map(plain)),expected.p.map(p=>p.map(plain)),`Word phrase text ${section}:${expected.n}`);
  assert.deepEqual(actual.paragraphBreaks,expected.paragraphBreaks);
  assert.deepEqual(actual.footnotes||[],expected.footnotes||[],`Word note content/links/anchors ${section}:${expected.n}`);
  const ref=section?`Takanat HaShavin ${section}:${expected.n}`:`Takanat HaShavin, Introduction ${expected.n}`;
  const exported=refs.get(ref);assert(exported,ref);
  assert.deepEqual(exported.p,expected.p.map(p=>p.map(plain)),`MCP phrase text ${ref}`);
  assert.equal((exported.f||[]).length,(expected.footnotes||[]).length,`MCP note count ${ref}`);
  for(const [i,note]of(expected.footnotes||[]).entries()){
   assert(!ids.has(note.sourceId),'Duplicate note identity '+note.sourceId);ids.add(note.sourceId);
   const [he,en]=expected.p[note.phraseIndex].map(plain);
   assert.equal(he.slice(0,note.heCharOffset),note.heAnchorPrefix,note.sourceId);
   assert.equal(en.slice(0,note.enCharOffset),note.enAnchorPrefix,note.sourceId);
   const f=exported.f[i];assert.equal(String(f[0]),String(note.number));
   assert.equal(f[2],note.phraseIndex);assert.equal(f[3],'h');assert.equal(f[4],note.heCharOffset);
   const flatten=note.paragraphs.map(p=>p.text.trim()).filter(Boolean).join('\n');
   assert.equal(f[1].replace(/\s+/g,' ').trim(),flatten.replace(/\s+/g,' ').trim(),`MCP note text ${note.sourceId}`);
   notes++;
  }
  pairs+=expected.p.length;paragraphs++;
 }
}
assert.equal(pairs,manifest.pairs);assert.equal(notes,2621);assert.equal(paragraphs,363);
assert.equal(source.sections.length,16);
const catalog=read(path.join(root,'library/data/catalog.json'));assert.equal(catalog.filter(x=>x.slug==='takanat-hashavin').length,1);
for(const d of source.downloads)assert.equal(sha(fs.readFileSync(path.join(root,'library',d.file))),sha(fs.readFileSync(d.source)));
console.log(JSON.stringify({ok:true,sections:16,paragraphs,pairs,notes,allNativeHebrewAnchors:true,allNoteTextAndHyperlinks:true,newDocxDownloads:true}));

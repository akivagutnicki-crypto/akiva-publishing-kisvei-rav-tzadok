// Content, placement, preservation and offline verification of the new edition.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {CHANUKAH25_REF,CHANUKAH25_REPORT,CHANUKAH25_RELEASE,validatePublishedChanukah25,sha256,canonical} from './pri-chanukah25.mjs';
import {readChanukah24Boundary} from './pri-chanukah24-boundary.mjs';
import {PACK as SEASONAL_PACK,readPack as readSeasonalPack,restoreHistoricalRows} from './publish-pri-seasonal-quoted-sources.mjs';
import {categoryOf} from './citations.mjs';
const rootAt=process.argv.indexOf('--root'),root=path.resolve(rootAt>=0?process.argv[rootAt+1]:'dist/library');
const urlAt=process.argv.indexOf('--url'),base=urlAt>=0?process.argv[urlAt+1].replace(/\/?$/,'/'):null;
const cache=new Map();
const bytes=file=>{
  if(!cache.has(file))cache.set(file,(async()=>{
    if(!base)return fs.readFileSync(path.join(root,file));
    const r=await fetch(new URL(file+'?verify='+CHANUKAH25_RELEASE,base),{cache:'no-store',signal:AbortSignal.timeout(60000)});
    assert.ok(r.ok,'HTTP '+r.status+' '+file);return Buffer.from(await r.arrayBuffer());
  })());return cache.get(file);
};
const read=async file=>JSON.parse(await bytes(file));
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
const clean=text=>String(text).replace(/<[^>]*>/g,'').replace(/&(#\d+|amp|lt|gt|quot|apos);/g,(all,key)=>key[0]==='#'?String.fromCodePoint(Number(key.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[key]);
const [toc,report,links,manifest,html,sw]=await Promise.all([
  read('data/peri-tzadik/toc.json'),read(CHANUKAH25_REPORT),read('data/peri-tzadik/links.json'),read('data/files.json'),bytes('index.html'),bytes('sw.js')]);
const study=toc.toc.children[0],leaves=walk(study).filter(node=>node.interlinear&&node.ref);
const matches=leaves.filter(leaf=>leaf.ref===CHANUKAH25_REF);assert.equal(matches.length,1);
const leaf=matches[0],file='data/peri-tzadik/'+leaf.id+'.json',publishedRows=await read(file);
const seasonalPack=fs.existsSync(SEASONAL_PACK)?readSeasonalPack():null;
const rows=seasonalPack?restoreHistoricalRows(file,publishedRows,seasonalPack):publishedRows;
const hasReviewedSuccessor=JSON.stringify(rows)!==JSON.stringify(publishedRows);
const verified=validatePublishedChanukah25(leaf,rows),position=leaves.indexOf(leaf);
assert.equal(leaves[position-1].ref,'Peri Tzadik, Chanukah 24','Ois25 must directly follow24');
assert.deepEqual(leaves.filter(node=>node.parashah==='Chanukah').map(node=>node.ois),Array.from({length:25},(_,i)=>i+1));
assert.equal(report.release,CHANUKAH25_RELEASE);assert.equal(report.editionSha256,verified.pack.editionSha256);
assert.equal(report.paragraphs,6);assert.equal(report.sourceNotes,verified.noteCount);assert.equal(report.priorNoteCount,5539);
assert.equal(report.chapterSha256,sha256(hasReviewedSuccessor?JSON.stringify(rows):await bytes(file)));assert.equal(report.originalNotesPreservedAtPublication,true);
assert.equal(report.originalHebrewSha256,sha256(await bytes('data/peri-tzadik/'+report.originalHebrewFile)));
assert.ok(manifest.files.includes('peri-tzadik/'+leaf.id+'.json'));assert.ok(html.toString().includes(report.edition));
assert.ok(sw.toString().includes('-chanukah25-'+verified.pack.editionSha256.slice(0,12)));
const expectedLinks=structuredClone(verified.links);
if(hasReviewedSuccessor)for(const op of seasonalPack.operations.filter(op=>op.sectionRef===CHANUKAH25_REF&&op.after)){
  if(!expectedLinks.some(link=>link.a===op.originRef&&link.r===op.quotation.ref))expectedLinks.push({a:op.originRef,r:op.quotation.ref,c:categoryOf(op.quotation.ref)});
}
assert.deepEqual(links[CHANUKAH25_REF],expectedLinks);
const noteIds=new Set();let pairs=0;
for(const [i,row]of rows.filter(row=>row.p).entries()){
  assert.equal(row.n,i+1);assert.ok(row.keepPairs);assert.ok(row.footnotes.length);
  assert.deepEqual(row.p.map(pair=>pair.map(clean)),verified.pack.paragraphs[i].phrases.map(phrase=>[phrase.he,phrase.en]));
  for(const note of row.footnotes){assert.ok(!noteIds.has(note.sourceId));noteIds.add(note.sourceId);
    assert.equal(note.heAnchorPrefix,clean(row.p[note.phraseIndex][0]));assert.equal(note.enAnchorPrefix,clean(row.p[note.phraseIndex][1]));
    assert.equal(note.heCharOffset,note.heAnchorPrefix.length);assert.equal(note.enCharOffset,note.enAnchorPrefix.length);
    assert.equal(note.paragraphs.length,1);assert.ok(note.paragraphs.every(p=>p.language==='en'));
    assert.equal(note.paragraphs[0].text,`${note.sources[0].ref}: “${note.reviewedSourceExcerpt.en}”`);
    assert.match(note.reviewedSourceExcerpt.he,/[א-ת]/,'Primary Hebrew is retained in evidence metadata');
    for(const p of note.paragraphs)assert.equal(p.text,p.rich.map(run=>run.text).join(''));
  }pairs+=row.p.length;
}
assert.equal(pairs,report.phrasePairs);assert.equal(noteIds.size,report.sourceNotes);
const sourceSlug=ref=>ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
await Promise.all([...new Set(verified.links.map(link=>sourceSlug(link.r)))].map(async slug=>{
  const reverse=await read('data/cited/'+slug+'.json');
  for(const link of verified.links.filter(link=>sourceSlug(link.r)===slug))assert.ok(reverse[link.r]?.includes(link.a),'Missing exact reverse source location');
}));
if(!base){
  const boundary=readChanukah24Boundary(root);
  // Verify every body preserved at publication. The separate, exact boundary
  // proof verifies the later 24 correction and reconstructs its prior bytes.
  for(const [oldFile,digest]of Object.entries(report.protectedBodies)){
    const relative='data/peri-tzadik/'+oldFile;
    const oldRows=JSON.parse(boundary?.historicalFiles.get(relative)||fs.readFileSync(path.join(root,relative)));
    const body=oldRows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='footnotes')));
    assert.equal(sha256(canonical(body)),digest,'An earlier Pri Tzadik body changed: '+oldFile);
  }
  const mcpRoot=path.join(path.dirname(root),'mcp-data'),catalog=JSON.parse(fs.readFileSync(path.join(mcpRoot,'catalog.json')));
  const book=catalog.books.find(book=>book.slug==='peri-tzadik'),entries=book.sections.filter(section=>section.ref===CHANUKAH25_REF&&section.il);
  assert.equal(entries.length,1);assert.equal(entries[0].count,6);
  const text=JSON.parse(fs.readFileSync(path.join(mcpRoot,'text/peri-tzadik.json'))),section=entries[0];
  const actual=text.paras.slice(section.first,section.first+section.count);
  assert.deepEqual(actual.map(p=>p.r),[1,2,3,4,5,6].map(n=>CHANUKAH25_REF+':'+n));
  for(const [i,p]of actual.entries())assert.deepEqual(p.p,verified.pack.paragraphs[i].phrases.map(phrase=>[phrase.he,phrase.en]));
  if(process.argv.includes('--zips')){
    const {unzipSync}=createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
    for(const archive of ['downloads/books/peri-tzadik.zip','downloads/rav-tzadok-library.zip']){
      const entries=unzipSync(fs.readFileSync(path.join(root,archive)));
      for(const target of [file,'data/peri-tzadik/'+report.originalHebrewFile,'data/peri-tzadik/158.json','data/peri-tzadik/toc.json','data/peri-tzadik/links.json'])
        assert.equal(sha256(entries[target]),sha256(fs.readFileSync(path.join(root,target))),'Offline edition mismatch: '+target);
    }
  }
}
console.log(JSON.stringify({ok:true,live:Boolean(base),ref:CHANUKAH25_REF,paragraphs:6,phrasePairs:pairs,sourceNotes:noteIds.size,
  orderedChanukahSections:25,originalHebrewPreserved:true,editionSha256:verified.pack.editionSha256}));

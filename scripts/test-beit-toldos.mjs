// Compare the upload with every reader phrase and with its offline publication.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readPack, BOOK, SLUG, RELEASE, digest, leaves, visible} from './publish-beit-toldos.mjs';
import {readPack as readSeasonalPack, restoreHistoricalRows} from './publish-pri-seasonal-quoted-sources.mjs';
import {readPack as readTzidkatPack, historicalBytes as tzidkatHistoricalBytes} from './publish-tzidkat-quoted-sources.mjs';
const args=process.argv.slice(2),ui=args.indexOf('--url'),base=ui<0?null:new URL(args[ui+1]);
const root='dist/library',pack=readPack();
async function bytes(file){
  if(!base)return fs.readFileSync(path.join(root,file));
  const url=new URL(file,base);url.searchParams.set('beit-toldos-check',String(Date.now()));
  const r=await fetch(url,{cache:'no-store'});assert.ok(r.ok,`${file}: HTTP ${r.status}`);return Buffer.from(await r.arrayBuffer());
}
const json=async file=>JSON.parse((await bytes(file)).toString());
const [toc,catalog,report,links]=await Promise.all([json(`data/${SLUG}/toc.json`),json('data/catalog.json'),json('beit-toldos-publication.json'),json(`data/${SLUG}/links.json`)]);
assert.equal(toc.toldosEdition.release,RELEASE);assert.equal(report.release,RELEASE);
const all=leaves(toc.toc),targets=all.filter(l=>l.ref?.startsWith(BOOK+', Toldot '));
if(args.includes('--after-docx-import')){
  const successor=await json('reader-docx-import-20261022.json');
  assert.equal(successor.schemaVersion,1);
  assert.equal(successor.release,'20261022-reader-docx-import-v1');
  assert.equal(successor.previousBeitSections,338);
  assert.equal(successor.retainedToldosSections,52);
  assert.deepEqual(toc.documentImportEdition,{release:successor.release,sections:76});
  const expected=Array.from({length:76},(_,i)=>`${BOOK}, Vayetzei ${i+1}`);
  const added=successor.sections.filter(section=>section.book===BOOK);
  assert.deepEqual(added.map(section=>section.ref),expected,'Unexpected successor sections');
  const restored=structuredClone(toc),group=restored.toc.children.pop();
  assert.equal(group.en,'Vayetzei · 76 Osiyos');assert.equal(group.he,'ויצא');
  assert.deepEqual(leaves(group).map(leaf=>leaf.ref),expected,'Successor TOC group differs');
  for(const [i,leaf]of leaves(group).entries()){
    assert.equal(added[i].file,`data/${SLUG}/${leaf.id}.json`);
    assert.equal(added[i].paragraphs,leaf.shape);
  }
  delete restored.documentImportEdition;
  assert.equal(digest(JSON.stringify(restored)),successor.beforeTocSha256,'Historical TOC changed');
  assert.equal(leaves(restored.toc).length,338);
  assert.equal(all.length,414);
}else assert.equal(all.length,338);
assert.equal(targets.length,52);
assert.deepEqual(targets.map(l=>l.ois),pack.sections.map(s=>s.chapter));
assert.equal(new Set(all.map(l=>l.ref)).size,all.length,'Duplicate references');
const book=catalog.find(b=>b.slug===SLUG);
assert.equal(book.segments,all.reduce((n,l)=>n+l.shape,0));
assert.equal(book.downloads.filter(d=>d.file===pack.document.file).length,1);
assert.equal(digest(await bytes(pack.document.file)),pack.document.sha256);
let paragraphs=0,pairs=0;
const chapterBytes=await Promise.all(targets.map(l=>bytes(`data/${SLUG}/${l.id}.json`)));
for(const [index,leaf]of targets.entries()){
  const expected=pack.sections[index],allRows=JSON.parse(chapterBytes[index]),rows=allRows.filter(r=>r.p);
  assert.equal(allRows[0].h,expected.title);
  assert.ok(leaf.en.includes(expected.title));
  const headings=allRows.filter(r=>r.h).map(r=>r.h);
  for(const item of expected.items)assert.ok(headings.includes(item.heading));
  assert.equal(leaf.downloadDocx,pack.document.file);assert.equal(leaf.shape,expected.items.length);
  assert.equal(rows.length,expected.items.length);paragraphs+=rows.length;
  for(const [j,row]of rows.entries()){
    assert.equal(row.n,expected.items[j].n);assert.ok(row.keepPairs);
    assert.deepEqual(row.inlineHeadings,expected.items[j].inlineHeadings);
    assert.deepEqual(row.p.map(p=>p.map(visible)),expected.items[j].p,'Hebrew-English content or alignment changed in '+leaf.ref);
    pairs+=row.p.length;
    assert.doesNotMatch(row.p.flat().map(visible).join(''),/[\[\]]|להלן תרגום בין-טורי/);
    for(const text of row.p.flat())for(const anchor of text.matchAll(/<a\b([^>]+)>/g))assert.match(anchor[1],/href="https:\/\/www\.sefaria\.org\//);
  }
  for(const link of links[leaf.ref])assert.ok(rows.some(r=>`${leaf.ref}:${r.n}`===link.a),'Unanchored citation');
}
assert.equal(paragraphs,82);assert.equal(pairs,2407);
assert.deepEqual(pack.source.absentSectionNumbers,[]);
if(!base){
  // Historical checks remain byte-exact. After the seasonal publication gate,
  // only its exact reviewed successor may reconstruct the earlier bytes.
  const seasonalPack=args.includes('--after-seasonal-quotes')?readSeasonalPack():null;
  const tzidkatPack=args.includes('--after-tzidkat-quotes')?readTzidkatPack():null;
  for(const [f,sha]of Object.entries(report.protectedTextSha256))if(!f.startsWith('dover-tzedek/')){
    let raw=fs.readFileSync(path.join(root,'data',f));
    if(tzidkatPack && f.startsWith('tzidkat-hatzadik/') && digest(raw)!==sha)
      raw=tzidkatHistoricalBytes('data/'+f,raw,tzidkatPack);
    if(seasonalPack && digest(raw)!==sha){
      const relative='data/'+f,reviewed=seasonalPack.files.find(file=>file.path===relative);
      assert(reviewed && reviewed.beforeSha256===sha && reviewed.afterSha256===digest(raw),'An earlier text changed: '+f);
      const restored=JSON.stringify(restoreHistoricalRows(relative,JSON.parse(raw),seasonalPack));
      // Older imports end in a newline; Chanukah 25 uses compact JSON only.
      // The original byte hash selects the exact historical serialization.
      raw=Buffer.from(digest(restored)===sha?restored:restored+'\n');
    }
    assert.equal(digest(raw),sha,'An earlier text changed: '+f);
  }
}
if(args.includes('--mcp')){
  const mcp=JSON.parse(fs.readFileSync('dist/mcp-data/catalog.json'));
  const b=mcp.books.find(b=>b.slug===SLUG);assert.ok(b);
  assert.equal(b.sections.filter(s=>s.ref.startsWith(BOOK+', Toldot ')).length,52);
}
if(args.includes('--zips')){
  const {unzipSync}=createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
  const index=await json('downloads/index.json');
  for(const file of [index.books.find(b=>b.slug===SLUG).file,index.library.file]){
    const entries=unzipSync(await bytes(file));
    assert.equal(digest(entries[pack.document.file]),pack.document.sha256,'Stale Word document in '+file);
    for(const [i,leaf]of targets.entries())assert.equal(digest(entries[`data/${SLUG}/${leaf.id}.json`]),digest(chapterBytes[i]),'Stale Toldos chapter in '+file);
  }
}
console.log(JSON.stringify({ok:true,release:RELEASE,sections:52,paragraphs,pairs,bracketsRemoved:4758,missingSections:[],publiclyVerified:!!base}));

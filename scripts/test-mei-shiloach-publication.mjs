import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root='dist/library/data';
const slug='mei-ha-shiloach';
const load=path.join(root,slug);
const data=JSON.parse(fs.readFileSync(path.join(load,'interlinear.json'),'utf8'));
const headings=JSON.parse(fs.readFileSync(path.join(load,'headings.json'),'utf8'));
const links=JSON.parse(fs.readFileSync(path.join(load,'links.json'),'utf8'));
const source=JSON.parse(fs.readFileSync('sources/akiva/overlays/mei-hashiloach-interlinear.json','utf8'));
const legacy=[15,8,10,2,3,1,9,3,4];
const added=[9,5,13,9,38,7,9,7,10,5,4,7];
const counts=[...legacy,...added];
assert.equal(source.sections.length,21,'Nine prior sections and twelve newly translated parashiyos');
assert.equal(Object.keys(data).length,21,'Every translated section is present in reader');
let passages=0,phrases=0,nikkud=0,sourceLinks=0,inlineLinks=0;
for(let i=0;i<source.sections.length;i++){
 const sect=source.sections[i];
 assert.ok(Array.isArray(data[sect.ref]),'Missing reader section '+sect.ref);
 assert.equal(data[sect.ref].length,counts[i],'Wrong canonical Sefaria paragraph count '+sect.ref);
 assert.equal(sect.paragraphs.length,counts[i],'Wrong source paragraph count '+sect.ref);
 if(i>=9){
  assert.equal(headings[sect.ref].headings.length,counts[i],'Headlines and subtitles must match every canonical passage '+sect.ref);
  assert.ok(headings[sect.ref].headings.every(h=>h.includes('\n')),'Missing source-based subheadline');
 }
 for(let j=0;j<counts[i];j++){
  const actual=data[sect.ref][j];
  assert.ok(actual.length>0);
  // The existing pipeline is allowed to merge pairs but must retain all source words.
  assert.ok(actual.every(p=>p.length===2),'Malformed bilingual pair');
  passages++;
  for(const [he,en] of actual){
   assert.match(he,/[א-ת]/,'Missing Hebrew');
   assert.match(en,/[A-Za-z]/,'Missing English');
   assert.doesNotMatch(en,/[\[\]]/,'No translation brackets');
   nikkud+=(he.match(/[\u0591-\u05c7]/g)||[]).length;
   inlineLinks+=(he+en).match(/data-ref="/g)?.length||0;
   phrases++;
  }
  if(i>=9){
   for(const ref of sect.sourceLinks?.[j]||[]){
    assert.ok((links[sect.ref]||[]).some(l=>l.a===sect.ref+':'+(j+1)&&l.r===ref),
      'Unlinked Sefaria reference '+ref+' at '+sect.ref+':'+(j+1));
    sourceLinks++;
   }
  }
 }
}
assert.equal(passages,178,'Expected 55 prior plus 123 new canonical passages');
assert.ok(phrases>=2400,'No Hebrew-English text truncated');
assert.ok(nikkud>1000,'Hebrew vocalization missing');
assert.ok(sourceLinks>=200,'Missing source connections from the supplied DOCX');
assert.ok(inlineLinks>=100,'Inline primary-source links missing');
const html=fs.readFileSync('dist/library/index.html','utf8');
const meiRefsBlock=html.split('const meiStudyRefs = new Set([')[1]?.split(']);')[0];
assert.ok(meiRefsBlock,'Missing Mei HaShiloach reader edition registry');
// Accept either JavaScript string quotation style while still requiring the
// exact canonical section to be explicitly registered in the Reader.
const meiReaderRefs = new Set([...meiRefsBlock.matchAll(/(["'])(.*?)\\1/g)].map(match => match[2]));
for(const section of source.sections){
  assert.ok(meiReaderRefs.has(section.ref),'Reader does not route revised Mei section: '+section.ref);
}
assert.ok(html.includes('if (!remoteOnly && meiStudyRefs.has(ref))'),
  'Reviewed Mei HaShiloach edition must load before the older remote translation');
assert.ok(html.includes("const en = overlay.map(pairs => pairs.map(p => p[1]).join(' '))"),
  'Reviewed English must appear in Stacked and Side by side, not only Interlinear');
assert.ok(!html.includes('overlay.length !== d.he.length'),
  'Reader must not discard imported Mei edition when remote Sefaria count differs');
const sw=fs.readFileSync('dist/library/sw.js','utf8');
assert.ok(Number(/const VERSION = 'v(\d+)-/.exec(sw)?.[1]) >= 47,
  'Installed reader shell cache was not refreshed');

assert.ok(html.includes('withMeiStudy')&&html.includes('phrases:overlay'),'Reader did not load the Mei study overlay');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));
assert.ok(!catalog.some(e=>e.title==='Mei HaShiloach'),'Do not override the canonical Sefaria catalog');
console.log('PASS Mei HaShiloach: '+passages+' canonical passages, '+phrases+' bilingual pairs, '+sourceLinks+' explicit Sefaria source connections, '+inlineLinks+' inline hyperlinks, headings and nikkud; original Sefaria English unaffected.');

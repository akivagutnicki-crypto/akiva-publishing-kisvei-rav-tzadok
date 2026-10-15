// Homepage links must lead to the exact published Pri Tzaddik study edition,
// not the older Hebrew-only Sefaria leaf or an unavailable download.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const home = fs.readFileSync('dist/library/index.html','utf8');
const dir='dist/library/data/peri-tzadik/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
const leaves=[];
function walk(node){if(node?.ref)leaves.push(node);for(const child of node?.children||[])walk(child);}
walk(toc.toc);

for (const test of [
  {ref:'Peri Tzadik, Rosh Chodesh Cheshvan',hash:'#/read/Peri_Tzadik,_Rosh_Chodesh_Cheshvan',
   phraseCount:327,notes:48,docx:'pri-tzaddik-rosh-chodesh-marcheshvan-annotated.docx'},
  {ref:'Peri Tzadik, Bereshit 4',hash:'#/read/Peri_Tzadik,_Bereshit_4',
   phraseCount:115,notes:24},
]) {
  assert.ok(home.includes('href="'+test.hash+'"'), 'Missing homepage reader link: '+test.ref);
  const leaf=leaves.find(item=>item.ref===test.ref&&item.interlinear);
  assert.ok(leaf,'No annotated/interlinear reader route: '+test.ref);
  const published=JSON.parse(fs.readFileSync(dir+leaf.id+'.json','utf8')).filter(i=>i.p);
  const phrases=published.flatMap(item=>item.p);
  assert.equal(phrases.length,test.phraseCount,'Incomplete study text: '+test.ref);
  assert.ok(phrases.every(([he,en])=>he&&en),'Missing Hebrew or English: '+test.ref);
  const notes=published.flatMap(item=>item.footnotes||[]);
  assert.equal(notes.length,test.notes,'Annotation collection changed: '+test.ref);
  if(test.docx){
    assert.equal(leaf.downloadDocx,'downloads/'+test.docx);
    const path='dist/library/downloads/'+test.docx;
    assert.ok(home.includes('href="downloads/'+test.docx+'"'),'Word download not linked');
    const b=fs.readFileSync(path);
    assert.ok(b.length>50_000&&b.toString('ascii',0,2)==='PK','Missing annotated DOCX');
    assert.ok(notes.every(n=>n.paragraphs?.length>0),'Incomplete Mar Cheshvan footnotes');
  }
}
assert.ok(home.includes('Read annotated Bereishis Ois 4 with 24 source footnotes'),
  'Show the new 24-source Bereishis Ois 4 edition with accurate description');
console.log('PASS Pri Tzaddik homepage links: 327 Mar Cheshvan phrase pairs with 48 Word footnotes and 115 Bereishis Ois 4 interlinear phrases and 24 source footnotes.');

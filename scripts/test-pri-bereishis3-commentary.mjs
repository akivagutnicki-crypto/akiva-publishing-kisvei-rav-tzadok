import assert from 'node:assert/strict';
import fs from 'node:fs';

const annotations=JSON.parse(fs.readFileSync('sources/akiva/annotations/Peri_Tzadik_Bereshit_3_Commentary.json','utf8'));
const toc=JSON.parse(fs.readFileSync('dist/library/data/peri-tzadik/toc.json','utf8'));
const all=[];
function walk(node){if(node?.ref)all.push(node);for(const child of node?.children||[])walk(child);}
walk(toc.toc);
const leaf=all.find(x=>x.ref==='Peri Tzadik, Bereshit 3'&&x.interlinear);
assert.ok(leaf,'Expected genuine interlinear Bereishis Ois Gimmel');
const chapter=JSON.parse(fs.readFileSync('dist/library/data/peri-tzadik/'+leaf.id+'.json','utf8'));
const paragraphs=chapter.filter(x=>x.p);
assert.equal(paragraphs.flatMap(p=>p.p).length,135,'Source phrase count changed');
const notes=paragraphs.flatMap(p=>(p.footnotes||[]).map(note=>({p,note})));
assert.equal(notes.length,17,'Not all 17 supplied commentary paragraphs became reader notes');
assert.equal(annotations.notes.length,17);
const byNumber=new Map(notes.map(x=>[x.note.number,x]));
assert.equal(byNumber.size,17,'Footnote numbers must be unique');
let lastPosition=-1;
for(const source of annotations.notes){
  const {p,note}=byNumber.get(source.number)||{};
  assert.ok(p,'Footnote lost during publication '+source.number);
  const phrase=p.p[note.phraseIndex];
  assert.ok(phrase,'Footnote not attached to a reader phrase');
  const he=phrase[0].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  assert.equal(note.heCharOffset,he.length,'Invisible or misplaced Hebrew marker '+source.number);
  assert.equal(note.paragraphs.length,1,'Duplicate source review in footnote '+source.number);
  const body=note.paragraphs[0];
  assert.equal(body.rich.map(x=>x.text).join(''),body.text,'Truncated commentary '+source.number);
  assert.ok(body.text.length>=180,'Unexpectedly short source commentary '+source.number);
  assert.ok(body.rich.some(x=>x.href?.startsWith('https://www.sefaria.org/')),'Missing source hyperlink '+source.number);
  assert.ok(body.rich.filter(x=>x.href).every(x=>/^https:\/\/www\.sefaria\.org\/[A-Za-z0-9_.%,:-]+$/.test(x.href)),'Bad linked source '+source.number);
  const position=paragraphs.indexOf(p)*1000+note.phraseIndex;
  assert.ok(position>=lastPosition,'Sequential footnote numbers do not follow reading order');
  lastPosition=position;
}
console.log('PASS Bereishis Ois Gimmel: 135 Hebrew-English phrases, 17 complete commentary footnotes, 17 Hebrew-word markers and source hyperlinks.');

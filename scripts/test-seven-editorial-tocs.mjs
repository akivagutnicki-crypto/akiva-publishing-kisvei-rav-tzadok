// Post-archive integration guard: seven books need meaningful English TOCs,
// matching in-reader headlines, untouched interlinear text, and original notes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root='dist/library/data/';
const counts={
 'machshavot-charutz':3580,'sefer-hazikhronot':785,
 'divrei-chalomot':247,'sichat-malakhei-hasharet':752,
 'yisrael-kedoshim':2685,'likkutei-maamarim':3347,'divrei-soferim':845
};
const html=fs.readFileSync('dist/library/index.html','utf8');
assert.ok(html.includes('thematic-toc'),'Descriptive TOC display missing from reader application');
function leaves(n){
 if(!n||typeof n!=='object')return [];
 return Array.isArray(n.children) ? n.children.flatMap(leaves) : [n];
}
const generic=/^(?:Section|Chapter|Siman|Ois|Teaching)\s+\d+\s*$/i;
for(const [slug,expectedFootnotes] of Object.entries(counts)){
 const folder=root+slug+'/';
 const toc=JSON.parse(fs.readFileSync(folder+'toc.json','utf8'));
 let titles=0,readings=0,headings=0,notes=0;
 for(const leaf of leaves(toc.toc)){
  const shape=leaf.shape;
  const candidates=Array.isArray(shape)
   ? shape.map((n,i)=>n? {id:String(leaf.id)+'-'+(i+1),en:leaf.chapterTitles?.[i]}:null).filter(Boolean)
   : leaf.depth===1?[{id:String(leaf.id),en:leaf.en}]:[];
  for(const c of candidates){
   assert.ok(c.en&&c.en.length>=16&&!generic.test(c.en),'Generic/missing English title '+slug+'/'+c.id+': '+c.en);
   assert.match(c.en,/[A-Za-z]{4}/,'Non-English title '+slug+'/'+c.id);
   const items=JSON.parse(fs.readFileSync(folder+c.id+'.json','utf8'));
   assert.ok(items.some(x=>typeof x.h==='string'&&x.h.includes(c.en)),'Missing in-reader headline for '+slug+'/'+c.id);
   const phrases=items.filter(x=>Array.isArray(x.p));
   assert.ok(phrases.length,'Missing original interlinear source '+slug+'/'+c.id);
   const at=phrases.reduce((n,i)=>n+i.p.length,0);
   assert.ok(at>0,'Empty source '+slug+'/'+c.id);
   notes+=phrases.reduce((n,i)=>n+(i.footnotes?.length||0),0);
   headings+=items.reduce((n,i)=>n+(i.inlineHeadings?.length||0),0);
   titles++;readings++;
  }
 }
 assert.ok(titles>=1,'No descriptive TOC entries '+slug);
 assert.equal(notes,expectedFootnotes,'Original source footnotes lost '+slug);
 if(slug==='divrei-soferim'){
   assert.ok(readings>=38,'Missing Divrei Soferim chapters');
   assert.ok(headings>=50,'Divrei Soferim still lacks English subheadings');
 }
 if(slug==='sefer-hazikhronot')assert.ok(titles>=6,'Missing Sefer HaZikhronot titles');
 console.log('PASS '+slug+': '+titles+' English TOC headlines, '+headings+' original/new transitions; '+notes+' source footnotes intact');
}
console.log('PASS seven sefarim retain their exact footnote coverage and themed English TOCs');

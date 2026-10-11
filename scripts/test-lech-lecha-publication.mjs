// Validate complete original Lech Lecha bilingual text and live Sefaria citation connections.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='dist/library/data/';
const read=(path)=>JSON.parse(fs.readFileSync(path,'utf8'));
const extract=(slug)=>{const toc=read(root+slug+'/toc.json');const leaves=[];function walk(x){if(x.ref)leaves.push(x);for(const c of x.children||[])walk(c)}walk(toc.toc);return leaves};
const points=s=>(s.match(/[\u0591-\u05C7]/g)||[]).length;
const checks=[
 {name:'Peri Tzadik',slug:'peri-tzadik',prefix:'Peri Tzadik, Lech Lecha ',leafCount:11,phrases:1224,download:'pri-tzaddik-lech-lecha-interlinear.docx',headlines:106},
 {name:'Beit Yaakov on Torah',slug:'beit-yaakov-on-torah',prefix:'Beit Yaakov on Torah, Lech Lecha ',leafCount:51,phrases:4171,download:'beit-yaakov-lech-lecha-interlinear.docx',headlines:432}
];
for(const cfg of checks){
 const leaves=extract(cfg.slug).filter(l=>l.ref.startsWith(cfg.prefix)&&l.interlinear);
 assert.equal(leaves.length,cfg.leafCount,'Missing Lech Lecha osiyos: '+cfg.name);
 let phrases=0,connections=0,headlines=0;
 for(const leaf of leaves){
   const items=read(root+cfg.slug+'/'+leaf.id+'.json');
   headlines+=items.reduce((n,x)=>n+(x.h?1:0)+(x.inlineHeadings?.length||0),0);
   const rows=items.filter(x=>x.p);
   for(const row of rows)for(const pair of row.p){
     assert.ok(pair.length===2&&/[א-ת]/.test(pair[0])&&/[A-Za-z]/.test(pair[1]),'Unpaired text '+leaf.ref);
     assert.ok(!/^\s*\[/.test(pair[1]),'Unclean English translation in '+leaf.ref);
     phrases++;
     connections += (pair[0]+pair[1]).split('data-ref=').length-1;
   }
 }
 assert.equal(phrases,cfg.phrases,'Missing translated phrases: '+cfg.name);
 assert.equal(headlines,cfg.headlines,'Word headlines missing from reader: '+cfg.name);
 const p='dist/library/downloads/'+cfg.download;
 const raw=fs.readFileSync(p);assert.ok(raw.length>50000&&raw[0]===0x50&&raw[1]===0x4b,'Missing DOCX');
 console.log('PASS '+cfg.name+': '+leaves.length+' osiyos, '+phrases+' pairs, '+headlines+' correctly anchored Word headlines, '+connections+' inline source links, DOCX');
}
const mei=read(root+'mei-ha-shiloach/interlinear.json');
const refs=[
 ['Mei HaShiloach, Volume I, Genesis, Lech Lecha',9,249],
 ['Mei HaShiloach, Volume II, Genesis, Lech Lecha',3,42],
 ['Mei HaShiloach, Mei HaShiloach Anthology, Genesis, Lech Lecha',4,65]
];
for(const [ref,paras,phrases] of refs){
 const sections=mei[ref];assert.ok(Array.isArray(sections),ref+' missing');
 assert.equal(sections.length,paras,'Incorrect Sefaria paragraph alignment in '+ref);
 const pairs=sections.flat();
 assert.equal(pairs.length,phrases);
 assert.ok(pairs.every(p=>p.length===2&&/[א-ת]/.test(p[0])&&/[A-Za-z]/.test(p[1])&&!/^\s*\[/.test(p[1])));
 console.log('PASS '+ref+': '+paras+' verified paragraph boundaries / '+phrases+' phrase pairs');
}
const meiHeadings=read(root+'mei-ha-shiloach/headings.json');
let meiHeadlineCount=0;
for(const [ref] of refs) {
 const h=meiHeadings[ref];
 assert.ok(h && Array.isArray(h.headings),'Mei HaShiloach chapter headlines missing: '+ref);
 meiHeadlineCount+=h.headings.flatMap(x=>String(x).split('\\n')).filter(Boolean).length;
 meiHeadlineCount+=Object.values(h.phraseHeadings||{}).flat().length;
}
assert.equal(meiHeadlineCount,30,'Some of the 29 Word subheadlines or the Volume I continuation headline are missing');
console.log('PASS Mei HaShiloach: '+meiHeadlineCount+' precisely anchored headlines/subheadlines from the Word edition');
const meiDoc=fs.readFileSync('dist/library/downloads/mei-hashiloach-lech-lecha-interlinear.docx');
assert.ok(meiDoc.length>50000&&meiDoc[0]===0x50&&meiDoc[1]===0x4b);
console.log('PASS: all three Lech Lecha editions available in the library with cleaned English and downloadable DOCX files.');

// Regression gates for reversible edits and preservation of published numbers.
import assert from 'node:assert/strict';
import {applyOperations,sha,digest,historicalBytes,stableNumberAllocator,readPack,PACK} from './publish-tzidkat-quoted-sources.mjs';
import fs from 'node:fs';
const file='data/tzidkat-hatzadik/0.json';
const old=number=>({number,sourceId:'OLD-'+number,placementId:'OLD-'+number,paragraphs:[{text:'Original '+number}]});
const before=[{n:1,p:[['אַהֲבָה','Love']],footnotes:[old(1),old(2),old(3)]},{n:2,p:[['אמת','Truth']]}];
const quoted=(number,id)=>({number,sourceId:id,placementId:id,phraseIndex:0,heCharOffset:7,enCharOffset:4,
  heAnchorPrefix:'אַהֲבָה',enAnchorPrefix:'Love',paragraphs:[{text:'A reviewed source quotation.'}]});
const ops=[
  {action:'remove',placementId:'OLD-2',paragraph:1,before:old(2),beforeNoteIndex:1,beforeHadFootnotes:true},
  {action:'replace',placementId:'OLD-1',paragraph:1,before:old(1),after:quoted(1,'OLD-1'),beforeNoteIndex:0,beforeHadFootnotes:true},
  {action:'add',placementId:'NEW',paragraph:1,after:quoted(2542,'NEW'),beforeHadFootnotes:true}
].map(operation=>({...operation,path:file}));
const after=applyOperations(before,ops),raw=Buffer.from(JSON.stringify(after)),historical=Buffer.from(JSON.stringify(before)+'\n');
const pack={files:[{path:file,beforeSha256:sha(historical),afterSha256:sha(raw),beforeObjectSha256:digest(before)}],operations:ops};
assert.deepEqual(historicalBytes(file,raw,pack),historical);
assert.deepEqual(historicalBytes(file,historical,pack),historical);
assert.deepEqual(after[1],before[1]);assert.deepEqual(before[0].footnotes,[old(1),old(2),old(3)],'The input was mutated');
const altered=structuredClone(after);altered[0].footnotes[0].paragraphs[0].text='Changed without review';
assert.throws(()=>historicalBytes(file,Buffer.from(JSON.stringify(altered)),pack),/Unreviewed successor/);
assert.throws(()=>applyOperations(before,[{...ops[1],before:old(99)}]),/predecessor note changed/);
const badAnchor={...ops[2],after:{...ops[2].after,heAnchorPrefix:'different'}};
assert.throws(()=>applyOperations(before,[badAnchor]),/Hebrew marker no longer matches/);
const pinned={connectionNotes:[{id:'prior',field:'footnoteNumber',number:2195,originRef:'Tzidkat HaTzadik 1:1',targetRef:'Tzidkat HaTzadik 2:1'}]};
const allocator=stableNumberAllocator([1,2194,2542],pinned);
assert.equal(allocator.take('prior','footnoteNumber','Tzidkat HaTzadik 1:1','Tzidkat HaTzadik 2:1'),2195);
assert.equal(allocator.take('later','footnoteNumber','Tzidkat HaTzadik 3:1','Tzidkat HaTzadik 4:1'),2543);allocator.verify();
assert.throws(()=>stableNumberAllocator([1,2195],pinned),/collides/);
assert.throws(()=>stableNumberAllocator([1],pinned).verify(),/disappeared/);
assert.throws(()=>stableNumberAllocator([1],pinned).take('prior','footnoteNumber','Tzidkat HaTzadik 1:1','wrong'),/wrong/);
const historicalAllocator=stableNumberAllocator([1,2],null);
assert.equal(historicalAllocator.take('earlier','footnoteNumber','a','b'),3);historicalAllocator.verify();
const release=readPack(), corrected=release.operations.find(operation=>operation.inlineCorrections?.length);
assert(corrected,'Missing reviewed Tosefta locator correction');
const locator=corrected.inlineCorrections[0];
assert.equal(corrected.after.enAnchorPrefix,locator.after[1].replace(/<[^>]*>/g,''));
const rawPack=JSON.parse(fs.readFileSync(PACK,'utf8'));
const tampered=rawPack.operations.find(operation=>operation.inlineCorrections?.length);
tampered.inlineCorrections[0].after[0]+=' changed';
const temporary=PACK+'.guard-test';
try {
  fs.writeFileSync(temporary,JSON.stringify(rawPack));
  assert.throws(()=>readPack(temporary),'A locator correction must not authorize additional body changes');
} finally {fs.rmSync(temporary,{force:true});}
console.log('PASS Tzidkat preservation, exact successor reconstruction, tamper rejection, and stable numbering guards.');

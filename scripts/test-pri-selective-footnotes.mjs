import fs from 'node:fs';
import assert from 'node:assert/strict';
const base='dist/library/data/peri-tzadik/';
const toc=JSON.parse(fs.readFileSync(base+'toc.json','utf8'));
const walk=(n,a=[])=>{if(n.ref)a.push(n);for(const x of n.children||[])walk(x,a);return a;};
const leaves=walk(toc.toc);
const exp={'Peri Tzadik, Bereshit 3':null,'Peri Tzadik, Noach 5':null,'Peri Tzadik, Noach 6':null,'Peri Tzadik, Rosh Chodesh Cheshvan':48};
for(const [ref,e] of Object.entries(exp)){
 const leaf=leaves.find(l=>l.ref===ref&&l.interlinear);assert.ok(leaf);
 const data=JSON.parse(fs.readFileSync(base+leaf.id+'.json','utf8'));
 const ns=data.flatMap(i=>i.footnotes||[]);
 if(e!==null)assert.equal(ns.length,e);
 if(ref.endsWith('Bereshit 3'))assert.ok(ns.length>=37&&ns.length<=44);
 if(ref.endsWith('Noach 5'))assert.ok(ns.length>=15);
 if(ref.endsWith('Noach 6'))assert.ok(ns.length>=16);
 assert.ok(ns.every(n=>n.heCharOffset>0&&n.paragraphs?.length>=1));
}
assert.equal(toc.footnoteUpgradeInfo.marcheshvanPreservedNotes,48);
console.log('PASS independent Pri Tzaddik footnote regression and Mar Cheshvan preservation.');

// Checks the parallels built by scripts/build-parallels.mjs for the reader's Connections panel.
import fs from 'node:fs';
const dir = 'dist/library/data/parallels';
const read = f => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
const fail = m => { throw new Error('Parallels test failed: ' + m); };
const index = read('index.json');
if (index.length < 15) fail('too few books with parallels: ' + index.length);
const words = read('words.json');
let paragraphs = 0, parallels = 0;
for (const slug of index) {
  for (const [ref, e] of Object.entries(read(`${slug}.json`))) {
    paragraphs++;
    for (const [other, score, sources, ids] of e.p || []) {
      parallels++;
      if (other === ref || !(score > 0) || (!(slug === 'et-haochel' && e.reviewedParallels === true) && !(sources.length || ids.length))) fail(`bad parallel ${ref} -> ${other}`);
      for (const id of ids) if (!words[id]) fail(`unknown word ${id} in ${ref}`);
    }
  }
}
// The haste of the Egyptian Pesach (Tzidkat HaTzadik 1:3) is drawn on across both schools.
const t = read('tzidkat-hatzadik.json')['Tzidkat HaTzadik 1:3'];
const refs = (t?.p || []).map(x => x[0]);
for (const want of ['Sod Yesharim, The First Night of Pesach', 'Machshavot Charutz']) if (!refs.some(r => r.startsWith(want))) fail('Tzidkat HaTzadik 1:3 lacks a parallel in ' + want);
// A verse quoted without its name is found by its wording (Peri Tzadik quotes Exodus 12:11 in Rosh Chodesh Nisan 2).
const pt = read('peri-tzadik.json')['Peri Tzadik, Rosh Chodesh Nisan 2:1'];
if (!pt || !(pt.q || []).includes('Exodus 12:11')) fail('Exodus 12:11 not found by wording in Peri Tzadik, Rosh Chodesh Nisan 2:1');
console.log(`PASS parallels: ${paragraphs} paragraphs with connections, ${parallels} parallels, ${Object.keys(words).length} distinctive words`);


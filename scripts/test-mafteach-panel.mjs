// Tests the HaMafteach HaShalem reader panel (dist/library/mafteach-panel.js) and its data (dist/library/mafteach/).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../dist/library/mafteach-panel.js');
const DIR = 'dist/library/mafteach';
let passed = 0;
const check = (ok, what) => { if (!ok) throw new Error('Mafteach panel test failed: ' + what); passed++; };

const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const books = Object.entries(index.books);
check(books.length >= 80 && index.books['Tzidkat HaTzadik'] && index.books['Peri Tzadik, Vayechi'], 'index lists the sefarim and Pri Tzaddik sections');
const validRefs = new Set(fs.readFileSync('sources/mafteach/library-refs.txt', 'utf8').split('\n').filter(Boolean));
let passages = 0, links = 0;
for (const [book, info] of books) {
  const file = path.join(DIR, info.file);
  const size = fs.statSync(file).size;
  check(size < 10e6 && size < 2e6, `${info.file} is small (${size} bytes; limit 10 MB, target under 2 MB)`);
  const shard = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [ref, e] of Object.entries(shard.passages)) {
    passages++;
    check(M.shardKey(ref) === book, `${ref} is in its own file`);
    check(validRefs.has(ref), `${ref} is a library ref`);
    for (const [target, score, why] of e.p) {
      links++;
      if (!validRefs.has(target) || !(score > 0) || !Array.isArray(why)) check(false, `${ref} -> ${target} is a valid parallel`);
    }
  }
}
check(passages > 1400 && links > 25000, `${passages} passages, ${links} parallels`);

const tz = JSON.parse(fs.readFileSync(path.join(DIR, index.books['Tzidkat HaTzadik'].file), 'utf8'));
const e = M.entryFor(tz.passages, 'Tzidkat HaTzadik 100');
check(e.p.some(p => p[0] === 'Takanat HaShavin 6') && e.s.some(s => s[0] === 'Chagigah 15a'), 'Tzidkat HaTzadik 100: parallel Takanat HaShavin 6 via Chagigah 15a');
const html = M.render(e, 'Tzidkat HaTzadik 100');
check(html.includes('href="#/read/Takanat_HaShavin_6"') && html.includes('https://www.sefaria.org/Chagigah.15a') && html.includes('Show all'), 'render: in-app links, Sefaria links, show-all');
const hc = JSON.parse(fs.readFileSync(path.join(DIR, index.books['Peri Tzadik, Parshat HaChodesh'].file), 'utf8'));
const merged = M.entryFor(hc.passages, 'Peri Tzadik, Parshat HaChodesh');
check(merged && merged.p.length && merged.p.length <= 40 && merged.p.every(p => !p[0].startsWith('Peri Tzadik, Parshat HaChodesh ')), 'one-block section gathers its paragraphs');
check(M.sefariaUrl('Bereshit Rabbah 2:4') === 'https://www.sefaria.org/Bereshit_Rabbah.2.4' && M.sefariaUrl('Berakhot 6b') === 'https://www.sefaria.org/Berakhot.6b', 'Sefaria URLs');
check(!M.render(e, 'x').includes('<script'), 'render escapes text');
check(fs.readFileSync('dist/library/index.html', 'utf8').includes('window.AkivaMafteach?.mount(d, sec, {toHash, esc})'), 'reader mounts the panel');
console.log(`PASS Mafteach panel: ${passed} checks, ${passages} passages, ${links} parallels`);

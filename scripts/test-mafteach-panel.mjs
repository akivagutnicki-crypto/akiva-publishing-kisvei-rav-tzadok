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

// Machine-learned parallels (dist/library/ml-parallels)
const ML = 'dist/library/ml-parallels';
const mlIndex = JSON.parse(fs.readFileSync(path.join(ML, 'index.json'), 'utf8'));
check(mlIndex.evaluation.model.prec10 > mlIndex.evaluation['engine only'].prec10, 'model beats the engine on held-out data');
let mlTeachings = 0, mlLinks = 0;
const ishbitz = ['Beit Yaakov on Torah', 'Sod Yesharim', 'Tiferet Yosef', 'Mei HaShiloach, Volume I'];
for (const b of ishbitz) check(Object.keys(mlIndex.books).includes(b), `ML covers ${b}`);
for (const [key, info] of Object.entries(mlIndex.books)) {
  const size = fs.statSync(path.join(ML, info.file)).size;
  check(size < 2e6, `${info.file} under 2 MB`);
  const sh = JSON.parse(fs.readFileSync(path.join(ML, info.file), 'utf8'));
  for (const [ref, items] of Object.entries(sh.passages)) {
    mlTeachings++;
    check(M.mlKey(mlIndex.books, ref) === key, `${ref} is found through its file`);
    for (const [target, p, tier, cites, words] of items) {
      mlLinks++;
      if (!['strong', 'likely', 'possible'].includes(tier) || !(p > 0 && p <= 1) || !Array.isArray(cites) || !Array.isArray(words) || target === ref) check(false, `${ref} -> ${target} well formed`);
    }
  }
}
check(mlTeachings > 3500 && mlLinks > 30000, `${mlTeachings} teachings, ${mlLinks} suggested parallels`);
const meiShard = JSON.parse(fs.readFileSync(path.join(ML, mlIndex.books['Mei HaShiloach, Volume I'].file), 'utf8'));
const meiParsha = M.mlFor(meiShard.passages, 'Mei HaShiloach, Volume I, Genesis, Bereshit');
check(meiParsha.length > 5 && meiParsha.every(x => !x[0].startsWith('Mei HaShiloach, Volume I, Genesis, Bereshit ')), 'a Mei HaShiloach parsha gathers its teachings, without self-links');
const htmlMl = M.render(null, 'X', {}, meiParsha);
check(htmlMl.includes('suggested by machine learning') && htmlMl.includes('maf-tier'), 'panel renders suggested parallels with tiers');

// Parallels in Chassidus, Kabbalah, Machshava and Mussar (dist/library/genre-parallels)
const GP = 'dist/library/genre-parallels';
const gIndex = JSON.parse(fs.readFileSync(path.join(GP, 'index.json'), 'utf8'));
let gLinks = 0; const genres = new Set();
for (const [key, info] of Object.entries(gIndex.books)) {
  check(fs.statSync(path.join(GP, info.file)).size < 1e6, `${info.file} under 1 MB`);
  for (const [ref, items] of Object.entries(JSON.parse(fs.readFileSync(path.join(GP, info.file), 'utf8')).passages)) {
    check(M.mlKey(gIndex.books, ref) === key, `${ref} found through its file`);
    for (const [target, title, genre, p, tier, words] of items) {
      gLinks++; genres.add(genre);
      if (!['Chassidus', 'Kabbalah', 'Machshava', 'Mussar'].includes(genre) || !['strong', 'likely', 'possible'].includes(tier) || !(p > 0) || !String(target).trim()) check(false, `${ref} -> ${target} well formed`);
    }
  }
}
check(genres.size === 4 && gLinks > 8000, `${gLinks} parallels in four genres`);
check(M.sefariaRefUrl('Sefat Emet, Genesis, Bereshit 3:2-9') === 'https://www.sefaria.org/Sefat_Emet,_Genesis,_Bereshit.3.2-9', 'Sefaria link for a passage range');
const gHtml = M.render(null, 'X', {}, [], [['Mesilat Yesharim 1-15', 'מסילת ישרים', 'Mussar', 0.7, 'likely', ['א']]]);
check(gHtml.includes('In Chassidus, Kabbalah, Machshava and Mussar') && gHtml.includes('https://www.sefaria.org/Mesilat_Yesharim.1-15'), 'panel renders the outside parallels');
console.log(`PASS Mafteach panel: ${passed} checks, ${passages} passages, ${links} parallels`);

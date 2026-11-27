// Outside passages (Chassidus, Kabbalah, Machshava, Mussar) that cite the same source as an Akiva Publishing edition note,
// from Sefaria's link graph. Runs in GitHub Actions (Sefaria's API is not reachable from the editing workspace).
// In:  sources/mafteach/curated-sources/{rav-tzadok-word-editions,pri-vbd-edition}.json  (library passage -> [[Sefaria ref, label]])
//      sources/mafteach/library-refs.txt  (the library's own books are left out: they have their own parallels)
// Out: sources/mafteach/sefaria-cited-parallels.json  { passages: { "<library passage>": [[ref, he title, genre, via, how]] } }
// A lead is kept only when its Hebrew quotes three words in a row of the source, or names its chapter and verse / daf.
import fs from 'node:fs';

const OUT = 'sources/mafteach/sefaria-cited-parallels.json';
const GENRE = { Chasidut: 'Chassidus', Musar: 'Mussar', 'Jewish Thought': 'Machshava', Kabbalah: 'Kabbalah' };
const PER_PASSAGE = 6, CONC = Number(process.env.CONC || 4);
const API = 'https://www.sefaria.org/api';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'akiva-publishing-library/1 (parallels)' } });
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(2000 * (a + 1)); }
  }
  return null;
}
const strip = s => (Array.isArray(s) ? s.flat(Infinity).join(' ') : String(s || '')).replace(/<[^>]+>/g, ' ');
const norm = s => strip(s).replace(/[֑-ׇ]/g, '').replace(/[^א-ת ]/g, ' ').replace(/[ךםןףץ]/g, c => 'כמנפצ'['ךםןףץ'.indexOf(c)]).replace(/\s+/g, ' ').trim();
const STOP = new Set('את על אל כי לא כל אשר הוא היא זה זו גם עם מן או אם כן לו לה בו בה אין יש'.split(' '));
function grams(s, n = 3) {
  const w = norm(s).split(' ').filter(x => x.length > 1); const out = new Set();
  for (let i = 0; i + n <= w.length; i++) { const g = w.slice(i, i + n); if (g.filter(x => !STOP.has(x)).length >= 2) out.add(g.join(' ')); }
  return out;
}
const L = 'אבגדהוזחטיכלמנסעפצקרשת', V = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400];
function heb(n) { let o = ''; for (let i = V.length - 1; i >= 0; i--) while (n >= V[i]) { if (n === 15) return o + 'טו'; if (n === 16) return o + 'טז'; o += L[i]; n -= V[i]; } return o; }
// "Genesis 21:12" -> ['כא','יב'];  "Shabbat 31a:5" -> ['לא','א']
function citeNums(ref) {
  let m = ref.match(/ (\d+)([ab])(?::\d+)?$/); if (m) return [heb(+m[1]), m[2] === 'a' ? 'א' : 'ב'];
  m = ref.match(/ (\d+):(\d+)/); if (m) return [heb(+m[1]), heb(+m[2])];
  return null;
}
function names(text, he, nums) {
  if (!nums) return false;
  const t = norm(text); const book = norm(he).split(' ')[0];
  if (!book || book.length < 2) return false;
  const re = new RegExp(`${book}[^א-ת]*(?:\\S+\\s){0,2}${nums[0]}\\s+${nums[1]}(\\s|$)`);
  return re.test(t);
}

// the library's own books (their refs, as the reader lists them)
const own = new Set(fs.readFileSync('sources/mafteach/library-refs.txt', 'utf8').split('\n').filter(Boolean).map(r => r.split(',')[0].replace(/\s+\d+(:\d+)?$/, '').trim()));
const ownRe = /^(Peri Tzadik|Tzidkat|Resisei|Takanat|Divrei|Kometz|Mei HaShiloach|Beit Yaakov|Sod Yesharim|Tiferet Yosef|Ne'ot Deshe|Torat Emet|Imrei Emet)/;
const per = {};
for (const f of ['rav-tzadok-word-editions', 'pri-vbd-edition'])
  for (const [p, l] of Object.entries(JSON.parse(fs.readFileSync(`sources/mafteach/curated-sources/${f}.json`, 'utf8'))))
    for (const [ref] of l) (per[ref] ||= new Set()).add(p);
const refs = Object.keys(per);
console.log('sources', refs.length);
const out = {}; const stats = { sources: 0, withLinks: 0, links: 0, quoted: 0, named: 0, kept: 0 };
async function one(ref) {
  const [src, links] = await Promise.all([get(`${API}/v3/texts/${encodeURIComponent(ref)}?version=hebrew&return_format=text_only`), get(`${API}/links/${encodeURIComponent(ref)}?with_text=1`)]);
  stats.sources++;
  if (!Array.isArray(links)) return;
  const sv = src && (src.versions || [])[0]; const stext = sv ? sv.text : '';
  const sg = grams(stext); const heTitle = src && (src.heRef || ''); const nums = citeNums(ref);
  const keep = links.filter(l => GENRE[l.category] && !own.has(l.index_title) && !ownRe.test(l.index_title || ''));
  if (keep.length) stats.withLinks++;
  for (const l of keep) {
    stats.links++;
    const he = strip(l.he);
    let how = null;
    for (const g of grams(he)) if (sg.has(g)) { how = 'quotes'; break; }
    if (how) stats.quoted++;
    else if (names(he, heTitle, nums)) { how = 'names'; stats.named++; }
    if (!how) continue;
    const title = (l.collectiveTitle && l.collectiveTitle.he) || l.heTitle || l.index_title;
    for (const p of per[ref]) {
      const list = out[p] ||= [];
      if (list.length < PER_PASSAGE && !list.some(x => x[0] === l.ref)) { list.push([l.ref, title, GENRE[l.category], ref, how]); stats.kept++; }
    }
  }
}
const queue = refs.slice();
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { await one(queue.shift()); if (stats.sources % 500 === 0) console.log(JSON.stringify(stats)); } }));
fs.writeFileSync(OUT, JSON.stringify({ version: new Date().toISOString().slice(0, 10), source: "Sefaria's link graph (Chasidut, Kabbalah, Jewish Thought, Musar), checked against the text",
  note: 'Each lead quotes three words in a row of the source an edition note cites, or names its chapter and verse / daf. Leads to study, not verified citations.', stats, passages: out }));
console.log('done', JSON.stringify(stats), 'library passages', Object.keys(out).length);

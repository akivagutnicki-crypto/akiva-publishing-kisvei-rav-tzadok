// Same established source-overlap algorithm; returns only the revised book, never writes files.
import fs from 'node:fs';
import path from 'node:path';
import {REPO_ROOT} from './takanat-review-core.mjs';
export function computeTakanatParallels(directory,{mcpOverride}={}){
const TEXT = path.join(directory,'mcp-data/text');
const MAX_PER_SCHOOL = 10, MAX_SOURCE_DF = 400, MAX_WORD_DF = 25, MIN_SCORE = 5.0;
const catalog = JSON.parse(fs.readFileSync(path.join(directory,'mcp-data/catalog.json'), 'utf8')).books;
const school = new Map(catalog.map(b => [b.slug, b.group === 'Izhbitz' ? 'Ishbitz–Radzin' : 'Kisvei Rav Tzadok']));
const readerSlug = slug => (slug === 'mei-hashiloach' ? 'mei-ha-shiloach' : slug);

// ---------- Hebrew words, loosely: no nikkud, no quote marks, final letters as medial, no ו/י (spelling varies)
const FIN = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const loose = w => w.replace(/[ךםןףץ]/g, c => FIN[c]).replace(/[וי]/g, '');
function words(s, keepMatres = false) {
  return String(s).replace(/[֑-ׇ]/g, m => (m === '־' ? ' ' : '')).replace(/[׳״'"`’]/g, '').replace(/[^א-ת\s]/g, ' ')
    .split(/\s+/).filter(Boolean).map(w => {
      if (w === 'יהוה' || w === 'יהו') return 'ה';
      w = w.replace(/^(ו?[בלמכה]?)אלה(?=ים|י|כ|נו|יו|יה|ה|$)/, '$1אלק');
      return keepMatres ? w.replace(/[ךםןףץ]/g, c => FIN[c]) : loose(w);
    }).filter(Boolean);
}

// ---------- Verses a passage quotes: three words in a row found in at most three verses
const K = 3;
const verses = JSON.parse(fs.readFileSync(path.join(REPO_ROOT,'sources/tanakh/wlc-consonantal.json'), 'utf8'));
const grams = new Map();
for (const [ref, t] of Object.entries(verses)) {
  const w = words(t);
  for (let i = 0; i + K <= w.length; i++) {
    const g = w.slice(i, i + K).join(' ');
    let s = grams.get(g);
    if (!s) grams.set(g, (s = new Set()));
    if (s.size <= 3) s.add(ref);
  }
}
function quotedVerses(text) {
  const w = words(text), hits = new Map();
  for (let i = 0; i + K <= w.length; i++) {
    const g = w.slice(i, i + K).join(' ');
    const s = grams.get(g);
    if (!s || s.size > 3 || g.replace(/ /g, '').length < 8) continue;
    for (const ref of s) {
      const h = hits.get(ref) || { run: 0, last: -9, unique: false, best: 0 };
      if (i === h.last + 1) h.run++; else h.run = 1;
      h.best = Math.max(h.best, h.run);
      if (s.size === 1 && g.replace(/ /g, '').length >= 10) h.unique = true;
      h.last = i;
      hits.set(ref, h);
    }
  }
  // Four or more consecutive words of the verse, or three distinctive words found in that verse only.
  return [...hits].filter(([, h]) => h.best >= 2 || h.unique).map(([ref]) => ref);
}

// ---------- Distinctive Biblical words
const PREFIX_RE = /^[והבכלמש]/;
const lemmas = JSON.parse(fs.readFileSync(path.join(REPO_ROOT,'sources/tanakh/rare-lemmas.json'), 'utf8'));
// How often each spelling occurs in Tanakh, with or without prefixes, whatever word it is: a rare word must also
// be a rare spelling, so that e.g. עגלה (a calf, and also a name) or בית never count as distinctive.
const formCount = new Map();
for (const t of Object.values(verses)) for (let w of words(t, true)) {
  for (let k = 0; k <= 3 && w; k++) {
    formCount.set(w, (formCount.get(w) || 0) + 1);
    if (!PREFIX_RE.test(w)) break;
    w = w.slice(1);
  }
}
const formToLemma = new Map();
// Biblical Aramaic (Daniel 2:4–7:28, Ezra 4:8–6:18, 7:12–26, Jeremiah 10:11) is everyday language in the Gemara and Zohar.
const aramaic = ref => { const m = ref.match(/^(Daniel|Ezra|Jeremiah) (\d+):(\d+)$/); if (!m) return false; const c = +m[2], v = +m[3];
  return m[1] === 'Daniel' ? (c > 2 || (c === 2 && v >= 4)) && c <= 7 : m[1] === 'Ezra' ? ((c === 4 && v >= 8) || c === 5 || (c === 6 && v <= 18) || (c === 7 && v >= 12 && v <= 26)) : c === 10 && v === 11; };
for (const [id, { f, v }] of Object.entries(lemmas)) for (const form of f) {
  // Found in at most three verses, five letters or more, not Aramaic: shorter or commoner words are too often
  // ordinary Rabbinic Hebrew (חזקת, כפול) rather than an echo of a verse.
  if (v.length > 3 || v.some(aramaic) || form.replace(/[ךםןףץ]/g, c => FIN[c]).length < 5) continue;
  // Spelled exactly as in Tanakh (only final letters folded): dropping ו/י here would confuse distinct words.
  const k = form.replace(/[ךםןףץ]/g, c => FIN[c]);
  if (k.length >= 4 && (formCount.get(k) || 0) <= 8 && !formToLemma.has(k)) formToLemma.set(k, id);
}
const PREFIX = /^[והבכלמש]/;
function rareWords(text) {
  const out = new Set();
  for (let w of words(text, true)) {
    for (let k = 0; k <= 3 && w.length >= 4; k++) {
      const id = formToLemma.get(w);
      if (id) { out.add(id); break; }
      if (!PREFIX.test(w)) break;
      w = w.slice(1);
    }
  }
  return out;
}

// ---------- One key per source, at the level parallels are judged: verse, daf (not its segment), etc.
const BAVLI = /^(Berakhot|Shabbat|Eruvin|Pesachim|Shekalim|Yoma|Sukkah|Beitzah|Rosh Hashanah|Taanit|Megillah|Moed Katan|Chagigah|Yevamot|Ketubot|Nedarim|Nazir|Sotah|Gittin|Kiddushin|Bava Kamma|Bava Metzia|Bava Batra|Sanhedrin|Makkot|Shevuot|Avodah Zarah|Horayot|Zevachim|Menachot|Chullin|Bekhorot|Arakhin|Temurah|Keritot|Meilah|Tamid|Niddah) (\d+[ab])\b/;
function sourceKey(ref) {
  let r = String(ref).trim().replace(/\s*[–—-]\s*\d+[ab]?(:\d+)?$/, '');
  const b = r.match(BAVLI);
  if (b) return `${b[1]} ${b[2]}`;
  return r;
}

// ---------- Read every paragraph
const paras = [];                 // { ref, slug, sec, sources:Set, quoted:[], words:Set }
const byRef = new Map();
for (const file of fs.readdirSync(TEXT).sort()) {
  const parsed=file==='takanat-hashavin.json'&&mcpOverride?mcpOverride:JSON.parse(fs.readFileSync(path.join(TEXT, file), 'utf8'));
  const { slug, paras: list } = parsed;
  const book = catalog.find(b => b.slug === slug);
  for (const p of list) {
    const he = p.p ? p.p.map(x => x[0]).join(' ') : p.t || '';
    let rec = byRef.get(p.r);                // Peri Tzadik: study edition and original Hebrew share refs
    if (!rec) {
      const sec = book.sections[p.s].ref;
      rec = { ref: p.r, slug, sec, sources: new Set(), cited: new Set(), quoted: new Set(), words: new Set() };
      byRef.set(p.r, rec); paras.push(rec);
    }
    for (const [r] of p.c || []) { const k = sourceKey(r); rec.sources.add(k); rec.cited.add(k); }
    for (const v of quotedVerses(he)) { rec.sources.add(v); if (!rec.cited.has(v)) rec.quoted.add(v); }
    for (const id of rareWords(he)) rec.words.add(id);
  }
}
// A passage's own book and section are not parallels of themselves: drop sources that name the citing passage.
for (const p of paras) for (const s of [...p.sources]) if (s === p.sec || p.ref.startsWith(s + ':') || p.ref.startsWith(s + ' ')) p.sources.delete(s);

// ---------- Inverted index and scores
const N = paras.length;
const index = new Map();          // feature -> [paragraph indexes]
const add = (f, i) => { let l = index.get(f); if (!l) index.set(f, (l = [])); l.push(i); };
paras.forEach((p, i) => { for (const s of p.sources) add('s:' + s, i); for (const w of p.words) add('w:' + w, i); });
const weight = new Map();
for (const [f, l] of index) {
  const df = l.length, isWord = f.startsWith('w:');
  if (df < 2 || df > (isWord ? MAX_WORD_DF : MAX_SOURCE_DF)) continue;
  weight.set(f, Math.log(N / df) * (isWord ? 0.8 : 1));
}

const out = {};                   // reader slug -> { ref: { q, p } }
let pairs = 0, withParallels = 0;
const usedWords = new Set();
paras.forEach((p, i) => {
  if(p.slug!=='takanat-hashavin')return;
  const score = new Map(), shared = new Map();
  for (const f of [...[...p.sources].map(s => 's:' + s), ...[...p.words].map(w => 'w:' + w)]) {
    const w = weight.get(f);
    if (!w) continue;
    for (const j of index.get(f)) {
      if (j === i || paras[j].sec === p.sec) continue;
      score.set(j, (score.get(j) || 0) + w);
      let l = shared.get(j); if (!l) shared.set(j, (l = [])); l.push(f);
    }
  }
  const ranked = [...score].filter(([, s]) => s >= MIN_SCORE).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const perSchool = {}, keep = [];
  for (const [j, s] of ranked) {
    const sc = school.get(paras[j].slug);
    if ((perSchool[sc] = (perSchool[sc] || 0) + 1) > MAX_PER_SCHOOL) continue;
    const f = shared.get(j);
    const srcs = f.filter(x => x.startsWith('s:')).map(x => x.slice(2));
    const wds = f.filter(x => x.startsWith('w:')).map(x => x.slice(2));
    wds.forEach(w => usedWords.add(w));
    keep.push([paras[j].ref, Math.round(s * 10) / 10, srcs, wds]);
  }
  const entry = {};
  if (p.quoted.size) entry.q = [...p.quoted];
  if (keep.length) { entry.p = keep; pairs += keep.length; withParallels++; }
  if (Object.keys(entry).length) ((out[readerSlug(p.slug)] ||= {})[p.ref] = entry);
});

const verseOrder = new Map(Object.keys(verses).map((r, i) => [r, i]));
const wordInfo = {};
for (const id of usedWords) wordInfo[id] = { w: lemmas[id].f.find(f => formToLemma.get(f.replace(/[ךםןףץ]/g, c => FIN[c])) === id) || lemmas[id].f[0], v: [...lemmas[id].v].sort((a, b) => verseOrder.get(a) - verseOrder.get(b)) };
const quoted = paras.reduce((n, p) => n + p.quoted.size, 0);
return {parallels:out['takanat-hashavin']||{},wordAdditions:wordInfo,quotedByRef:Object.fromEntries(paras.filter(p=>p.slug==='takanat-hashavin').map(p=>[p.ref,[...p.quoted]])),corpusParagraphs:N,withParallels,pairs};
}

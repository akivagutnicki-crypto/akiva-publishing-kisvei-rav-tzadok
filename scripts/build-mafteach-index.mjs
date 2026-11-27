// Builds the HaMafteach HaShalem data served by the Kisvei Rav Tzadok MCP server (mafteach_* tools).
//
// HaMafteach HaShalem (R' Chaim Hirsch, Jerusalem 5752/5760) is the complete index to R. Tzadok HaKohen's works:
//   parts 1-2 topics and part 3 sources for his sefarim other than Pri Tzaddik; parts 4, 5-6 topics and part 7 sources
//   for Pri Tzaddik. The entries were OCR'd from the printed volumes; references were parsed and, where the
//   library has the passage, linked to its ref (e.g. "Tzidkat HaTzadik 100", "Peri Tzadik, Vayechi 11").
//
// Input:  sources/mafteach/entries.jsonl.gz   one compact record per index entry
//         sources/mafteach/glossary.json      topics/people/places with English and Ashkenazi/Sefardi transliterations,
//                                             sefer codes, Pri Tzaddik sections, Tanach and Shas names
// Output: <out>/mafteach/glossary.json        terms (with entry counts), sefarim, sections, books, source titles
//         <out>/mafteach/topic/<id>.json      entries under a topic or sub-topic
//         <out>/mafteach/source/<key>.json    entries for a Tanach chapter, a daf, a Midrash Rabbah parasha ...
//         <out>/mafteach/source/b-<id>.json   entries for sources without a numeric address (Zohar, Midrash ...)
//         <out>/mafteach/passage/<key>.json   index entries that point to one library passage
//         <out>/mafteach/text/<part>.txt      search lines: normalized text TAB compact entry JSON
//
// Run by scripts/build-mcp-index.mjs (which rebuilds dist/mcp-data from scratch); can also run alone.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sources/mafteach');

// Same search form as cloudflare/mcp.mjs norm(): no nikkud, final letters as medial, no quote marks, punctuation as space.
export function heNorm(s) {
  return ' ' + String(s || '')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[־׀׃׆]/g, ' ')
    .replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ')
    .replace(/[׳״'"`´ʼ‘’“”]/g, '')
    .replace(/[^א-תa-z0-9]+/gi, ' ')
    .toLowerCase().trim().replace(/\s+/g, ' ') + ' ';
}
export const fileKey = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// "Genesis 2:7" -> ["Genesis", "2"]; "Shabbat 88b" -> ["Shabbat", "88"]; "Bereshit Rabbah 2:4" -> ["Bereshit Rabbah", "2"]
export function sourceShard(key) {
  const m = String(key).match(/^(.*?)\s+(\d+)[ab]?(?::\d+)?$/);
  return m ? [m[1], m[2]] : [key, null];
}

// Sefarim the printed index does not cover whose Akiva Publishing editions carry verified source notes, the name each
// edition goes by, and its corpus (ir = Ishbitz-Radzin; rt = R. Tzadok's own works outside HaMafteach HaShalem)
export const EDITION_BOOKS = [
  ['Beit Yaakov', 'the Akiva Publishing Beis Yaakov edition'],
  ["Sha'ar HaEmunah VeYesod HaChasidut", "the Akiva Publishing Sha'ar HaEmunah edition"],
  ["Ne'ot Deshe", 'the Akiva Publishing Naos Deshe edition'],
  ['Tiferet HaChanokhi', 'the Akiva Publishing Tiferes HaChanochi edition'],
  ['Ein HaTekhelet', 'the Akiva Publishing Ein HaTecheiles edition'],
  ['Ptil Tekhelet', 'the Akiva Publishing Pesil Techeiles edition'],
  ['Sefunei Temunei Chol', 'the Akiva Publishing Sefunei Temunei Chol edition'],
  ['Orchot Chaim and Eser Milin', 'the Akiva Publishing Orchos Chaim and Eser Milin edition'],
  ['Tiferet Yosef', 'the Akiva Publishing Tiferes Yosef edition'],
  ['Sidrei Taharot, Ohalot', 'the Akiva Publishing Sidrei Taharos (Ohalos) edition', 'ir', 'edt'],   // own text part (10 MB file limit)
  ['Sidrei Taharot, Kelim', 'the Akiva Publishing Sidrei Taharos (Keilim) edition', 'ir', 'edt'],
  ['Gibor BaShtikah', 'the Akiva Publishing book Gibor BaShtikah (on the Beis Yaakov)'],
  ['Tekhelet Min HaYam', 'the Akiva Publishing book Techeiles Min HaYam (on the Baal HaTecheiles)'],
  ['BeShuvah VaNachat', 'the Akiva Publishing book BeShuvah VaNachas (on the Tiferes Yosef)'],
  ['Omed BaPeretz', 'the Akiva Publishing book Omed BaPeretz (on R. Shmuel Shlomo of Radzin)'],
  ['VaYita Eshel', 'the Akiva Publishing book VaYita Eshel (on R. Avraham Yissachar Englard)'],
  ['Otzar HaMelekh', 'the Akiva Publishing Otzar HaMelech edition', 'rt'],
  ['Tiferet Tzvi, Part I', 'the Akiva Publishing Tiferes Tzvi (Part I) edition', 'rt'],
  ['Tiferet Tzvi, Part II', 'the Akiva Publishing Tiferes Tzvi (Part II) edition', 'rt'],
  ['Torat Emet', 'the Akiva Publishing Toras Emes edition', 'ir', 'ede'],   // R. Leibele Eiger of Lublin; own text part (10 MB file limit)
  ['Imrei Emet', 'the Akiva Publishing Imrei Emes edition', 'ir', 'ede'],
  ['Sod Yesharim', 'the Akiva Publishing Sod Yesharim edition', 'ir', 'ede'],
  // R. Tzadok's own sefarim (also in the printed index): the verified sources of the Word editions' notes (November 2026),
  // flagged as edition notes beside the printed index's lines (sources/mafteach/curated-sources/rav-tzadok-word-editions.json)
  ...[['Divrei Chalomot', 'Divrei Chalomos'], ['Divrei Soferim', 'Divrei Soferim'], ['Dover Tzedek', 'Dover Tzedek'],
    ['Et HaOchel', 'Kitzur Kuntres Eis HaOchel'], ['Kometz HaMinchah', 'Kometz HaMinchah'], ['Likkutei Maamarim', 'Likutei Maamarim'],
    ['Machshavot Charutz', 'Machshavos Charutz'], ["Meshiv HaTa'anah", 'Meshiv HaTaanah'], ['Meshiv Tzedek', 'Meshiv Tzedek'],
    ['Ohr Zarua LaTzadik', 'Ohr Zarua LaTzaddik'], ['Poked Akarim', 'Poked Akarim'], ['Resisei Layla', 'Resisei Layla'],
    ['Sefer HaZikhronot', 'Sefer HaZichronos'], ['Sichat Malakhei HaSharet', 'Sichas Malachei HaShareis'], ['Sichat Shedim', 'Sichas Sheidim'],
    ['Takanat HaShavin', 'Takanas HaShavin'], ['Tzidkat HaTzadik', 'Tzidkas HaTzaddik'], ['Yisrael Kedoshim', 'Yisrael Kedoshim']]
    .map(([t, he]) => [t, `the Akiva Publishing ${he} edition`, 'rt']),
  // the Pri Tzaddik interlinear study editions (sources/mafteach/curated-sources/*-edition.json), as Pri Tzaddik edition notes
  ['Peri Tzadik', 'the Akiva Publishing Pri Tzaddik study edition', 'pt', 'edp'],
];
// A Sefaria ref of an edition note -> the index's source key: "Berakhot 6b:4" -> "Berakhot 6b", "Psalms 81:4-5" -> "Psalms 81:4",
// "Bereshit Rabbah 3:1" stays; works the printed index has no heading for keep their own title ("Zohar, Terumah 39:4").
export function editionKey(ref) {
  let k = String(ref).trim().replace(/\s*-\s*[\d:ab]+$/, '');
  k = k.replace(/^(.*\s\d+[ab])[:\s]\d+$/, '$1');
  return k;
}
function editionEntries() {
  const dir = path.join(SRC, 'curated-sources');
  if (!fs.existsSync(dir)) return [];
  const out = [], seen = new Set();
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const [passage, cited] of Object.entries(data)) {
      const ed = EDITION_BOOKS.filter(([t]) => passage === t || passage.startsWith(t + ',') || passage.startsWith(t + ' ')).sort((a, b) => b[0].length - a[0].length)[0];
      if (!ed) continue;                        // a work with no Akiva Publishing edition listed above
      for (const [ref, label] of cited) {
        const k = editionKey(ref);
        if (!k || seen.has(passage + '\u0000' + k)) continue;
        seen.add(passage + '\u0000' + k);
        const [title, ch] = sourceShard(k);
        out.push({ id: `ed-${out.length + 1}`, v: ed[3] || (ed[2] === 'rt' ? 'edr' : 'ed'), x: 's', c: ed[2] || 'ir', p: 0, t: label || ref, k, zs: ref, ...(ch ? {} : { b: title }),
          r: [[passage, passage]], added: true, ed: ed[1] });
      }
    }
  }
  console.log(`Mafteach edition notes: ${out.length} source entries from the Akiva Publishing editions outside the printed index`);
  return out;
}

export function buildMafteach(OUT) {
  if (!fs.existsSync(path.join(SRC, 'entries.jsonl.gz'))) { console.log('Mafteach: no source data, skipped'); return null; }
  const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'glossary.json'), 'utf8'));
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(SRC, 'entries.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean);
  // Column-header rows of the source volumes ("דף עמ'", "פרשה", "פרק פסוק") have no references: leave them out.
  const entries = lines.map(l => JSON.parse(l)).filter(e => e.r.length || e.x === 't' || e.t.trim().split(/\s+/).length > 3);
  // English of the index lines (scripts/mafteach-english.py): key = Hebrew line, plus "|heading" when it uses the dash.
  const enFile = path.join(SRC, 'captions-en.json');
  if (fs.existsSync(enFile)) {
    const en = JSON.parse(fs.readFileSync(enFile, 'utf8'));
    const heOf = new Map(glossary.terms.map(t => [t.id, t.he]));
    let n = 0;
    for (const e of entries) {
      if (e.x !== 't') continue;
      const t = e.t.trim();
      const k = /(^|\s)-(?=\s|$)/.test(t) ? `${t}|${(e.T != null ? heOf.get(e.T) : e.Th) || ''}` : t;
      if (en[k]) { e.e = en[k]; n++; }
    }
    console.log(`Mafteach English: ${n} of ${entries.filter(e => e.x === 't').length} topic lines`);
  }
  // The Ishbitz-Radzin editions (HaMafteach indexes only R. Tzadok): the verified Sefaria sources of each Akiva Publishing
  // edition's notes (sources/mafteach/curated-sources/) join as source entries, flagged as edition notes and never as lines
  // of the printed index, so mafteach_lookup_source and mafteach_lookup_passage reach these sefarim too.
  const editions = editionEntries();
  entries.push(...editions);
  const base = path.join(OUT, 'mafteach');
  fs.rmSync(base, { recursive: true, force: true });
  for (const d of ['topic', 'source', 'passage', 'text']) fs.mkdirSync(path.join(base, d), { recursive: true });

  const byTopic = new Map(), bySource = new Map(), byPassage = new Map(), byPart = new Map();
  const push = (m, k, e) => { const l = m.get(k); l ? l.push(e) : m.set(k, [e]); };
  const counts = new Map();                         // term id -> entries
  const sourceTitles = new Map();                   // title -> {chapters:Set, n}
  for (const e of entries) {
    if (e.T != null) { push(byTopic, e.T, e); counts.set(e.T, (counts.get(e.T) || 0) + 1); }
    if (e.U != null && e.U !== e.T) { push(byTopic, e.U, e); counts.set(e.U, (counts.get(e.U) || 0) + 1); }
    if (e.k) {
      const [title, ch] = sourceShard(e.k);
      push(bySource, fileKey(ch ? `${title} ${ch}` : title), e);
      const st = sourceTitles.get(title) || { n: 0, chapters: new Set() };
      st.n++; if (ch) st.chapters.add(+ch); sourceTitles.set(title, st);
    }
    if (e.B != null) push(bySource, `b-${e.B}`, e);   // the source heading by name ("Tanchuma", "Zohar") lists every entry under it, keyed or not
    if (e.B != null) counts.set(e.B, (counts.get(e.B) || 0) + 1);
    const once = new Set();                          // one slim copy per passage, even when several pages of it are cited
    for (const r of e.r) if (r[1] && !once.has(r[1])) {   // slim copy: the entry with only the reference to this passage
      once.add(r[1]);
      const { r: _all, ...rest } = e;
      push(byPassage, fileKey(r[1]), { ...rest, r: [r], nr: e.r.length });
    }
    push(byPart, e.v, e);
  }
  const write = (rel, data) => fs.writeFileSync(path.join(base, rel), JSON.stringify(data));
  for (const [k, l] of byTopic) write(`topic/${k}.json`, l);
  for (const [k, l] of bySource) write(`source/${k}.json`, l);
  for (const [k, l] of byPassage) write(`passage/${k}.json`, l);
  for (const [v, l] of byPart) {
    fs.writeFileSync(path.join(base, 'text', `${v}.txt`), l.map(e => heNorm(e.t + (e.e ? ' ' + e.e : '')) + '\t' + JSON.stringify(e)).join('\n'));
  }
  const passages = {};
  for (const e of entries) for (const r of e.r) if (r[1]) passages[r[1]] = (passages[r[1]] || 0) + 1;
  for (const t of glossary.terms) t.n = counts.get(t.id) || 0;
  write('glossary.json', {
    ...glossary,
    parts: [...byPart.keys()],
    source_titles: Object.fromEntries([...sourceTitles].map(([t, v]) => [t, { n: v.n, chapters: [...v.chapters].sort((a, b) => a - b) }])),
    passages,
    stats: { entries: entries.length, refs: entries.reduce((a, e) => a + e.r.length, 0), linked: Object.values(passages).reduce((a, b) => a + b, 0) },
  });
  // Question answering (reader "Ask" and the worker's /ask): every index line that links to a library passage,
  // as [English, topic id, [refs], treated at length, Hebrew, source key]
  const answer = [];
  for (const e of entries) {
    if (e.ed) continue;                     // the written answers draw on the printed index only
    const refs = [...new Set(e.r.filter(r => r[1]).map(r => r[1]))];
    if (!refs.length) continue;
    const long = e.r.some(r => r[1] && String(r[r.length - 1]).includes('*')) ? 1 : 0;
    answer.push([e.e || '', e.T ?? (e.U ?? -1), refs, long, e.t, e.k || '']);
  }
  write('answer.json', answer);
  const stats = { entries: entries.length, topics: byTopic.size, sources: bySource.size, passages: byPassage.size, answer: answer.length };
  console.log('Mafteach index:', JSON.stringify(stats));
  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildMafteach(process.argv[2] || 'dist/mcp-data');
}

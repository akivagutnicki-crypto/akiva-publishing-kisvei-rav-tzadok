// Builds the HaMafteach HaShalem data served by the Kisvei Rav Tzadok MCP server (mafteach_* tools).
//
// HaMafteach HaShalem (R' Chaim Hirsch, Jerusalem 5752/5760) is the complete index to R. Tzadok HaKohen's works:
//   parts 1-2 topics and part 3 sources for his sefarim other than Pri Tzaddik; parts 4, 5-6 topics and part 7 sources
//   for Pri Tzaddik. The entries were OCR'd from the printed volumes; references were parsed and, where the
//   library has the passage, linked to its ref (e.g. "Tzidkat HaTzadik 100", "Peri Tzadik, Vayechi 11").
//
// Input:  sources/mafteach/entries.jsonl.gz   one compact record per index entry
//         sources/mafteach/torat-hakohen.jsonl.gz  index of Torat HaKohen (R' Mordechai Yosef Zakutinsky, 5787): where it
//                                             quotes and explains R. Tzadok passages, by siman/os/sub-topic and page (part "th")
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

export function buildMafteach(OUT) {
  if (!fs.existsSync(path.join(SRC, 'entries.jsonl.gz'))) { console.log('Mafteach: no source data, skipped'); return null; }
  const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'glossary.json'), 'utf8'));
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(SRC, 'entries.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean);
  // Torat HaKohen index (part "th", corpus "th"): one entry per place the sefer quotes a library passage. Index only.
  const thFile = path.join(SRC, 'torat-hakohen.jsonl.gz');
  if (fs.existsSync(thFile)) lines.push(...zlib.gunzipSync(fs.readFileSync(thFile)).toString('utf8').split('\n').filter(Boolean));
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
  const base = path.join(OUT, 'mafteach');
  fs.rmSync(base, { recursive: true, force: true });
  for (const d of ['topic', 'source', 'passage', 'text']) fs.mkdirSync(path.join(base, d), { recursive: true });

  const byTopic = new Map(), bySource = new Map(), byPassage = new Map(), byPart = new Map();
  const push = (m, k, e) => { const l = m.get(k); l ? l.push(e) : m.set(k, [e]); };
  const counts = new Map();                         // term id -> entries
  const sourceTitles = new Map();                   // title -> {chapters:Set, n}
  for (const e of entries) {
    // Torat HaKohen entries join their topic shard but not the heading counts (the reader shows HaMafteach entries only).
    if (e.T != null) { push(byTopic, e.T, e); if (e.c !== 'th') counts.set(e.T, (counts.get(e.T) || 0) + 1); }
    if (e.U != null && e.U !== e.T) { push(byTopic, e.U, e); counts.set(e.U, (counts.get(e.U) || 0) + 1); }
    if (e.k) {
      const [title, ch] = sourceShard(e.k);
      push(bySource, fileKey(ch ? `${title} ${ch}` : title), e);
      const st = sourceTitles.get(title) || { n: 0, chapters: new Set() };
      st.n++; if (ch) st.chapters.add(+ch); sourceTitles.set(title, st);
    }
    if (e.B != null) push(bySource, `b-${e.B}`, e);   // the source heading by name ("Tanchuma", "Zohar") lists every entry under it, keyed or not
    if (e.B != null) counts.set(e.B, (counts.get(e.B) || 0) + 1);
    for (const r of e.r) if (r[1]) {                // slim copy: the entry with only the reference to this passage
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
    if (e.c === 'th') continue;
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

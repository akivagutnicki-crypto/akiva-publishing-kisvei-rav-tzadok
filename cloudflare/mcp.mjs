// Kisvei Rav Tzadok Library: an MCP (Model Context Protocol) server for the texts in the library reader.
//
// Add https://<this site>/mcp to Claude as a custom connector. There is no sign-in; every tool is read-only:
//   kisvei_list_books            the books, editions and licenses
//   kisvei_get_contents          a book's table of contents, with refs
//   kisvei_get_text              exact text of a section or paragraphs (Hebrew/English phrase pairs, notes)
//   kisvei_search                full-text search, Hebrew without nikkud, English, headings, notes
//   kisvei_find_citing_passages  every library passage that cites a verse, daf, midrash...
//   kisvei_get_cited_sources     the sources a library passage cites
//   mafteach_find_topic / mafteach_lookup_source / mafteach_lookup_passage / mafteach_search
//                                HaMafteach HaShalem, the complete index to R. Tzadok's works (topics, sources, passages)
//
// Transport: Streamable HTTP with JSON responses and no sessions. It answers both the current protocol
// (2026-07-28: protocol version and capabilities in each request's _meta, server/discover) and the earlier
// initialize-based versions (2024-11-05 to 2025-11-25).
//
// Data: /mcp-data/*.json, built by scripts/build-mcp-index.mjs from the reader's own data during the
// Netlify build, fetched from this site and kept in memory while the function stays warm.

const SERVER_INFO = { name: 'kisvei-rav-tzadok-library', title: 'Kisvei Rav Tzadok Library', version: '1.0.0' };
const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SUPPORTED = [...MODERN, ...LEGACY];
const META = 'io.modelcontextprotocol/';

const INSTRUCTIONS = `Kisvei Rav Tzadok Library: the writings of R. Tzadok HaKohen of Lublin and works of the Izhbitz-Radzin school, as published in Akiva Publishing's online library. Akiva Publishing interlinear editions give vocalized Hebrew phrase by phrase with English and source notes (© Akiva Publishing); the other works are the original Hebrew of public-domain printings.
How to use: kisvei_search finds passages (Hebrew is matched without nikkud, prefixes included; spelling "loose" also ignores ו/י spelling differences); kisvei_get_text returns the exact text of a ref; kisvei_get_contents browses a book; kisvei_find_citing_passages lists every passage citing a source such as "Berakhot 6b" or "Genesis 1:1"; kisvei_get_cited_sources lists what a passage cites; kisvei_find_parallels lists the passages in Kisvei Rav Tzadok and the Ishbitz-Radzin works that share a passage's sources.
Quote the text exactly as returned and give its ref. Refs follow the reader, e.g. "Resisei Layla 5:2", "Tzidkat HaTzadik 100", "Peri Tzadik, Bereshit 1:3". Ashkenazi spellings (Tzidkas HaTzaddik, Pri Tzaddik, Bereishis, Berachos) are accepted.
HaMafteach HaShalem (R' Chaim Hirsch's complete index to R. Tzadok's works) is searchable too: mafteach_find_topic (a topic, person or concept: Hebrew, English, or Ashkenazi/Sefardi transliteration such as "emunah", "bitachon", "Shabbos", "Avrohom Avinu"), mafteach_lookup_source (a pasuk, daf or midrash: "Bereishis 2:7", "Berachos 6b", "Bereshit Rabbah 2:4"), mafteach_lookup_passage (the topics and sources indexed to a passage, for footnotes: "Tzidkas HaTzaddik 100", "Pri Tzaddik Vayechi 11") and mafteach_search (Hebrew words or a quote inside the entries). Its entries were OCR'd from the printed index; open the passage with kisvei_get_text before citing it.`;

// ---------------------------------------------------------------- data

let ORIGIN = '';
const cache = new Map();
function load(file) {
  let p = cache.get(file);
  if (!p) {
    p = (async () => {
      if (typeof process !== 'undefined' && process.env?.MCP_DATA_DIR) { // tests: disk; Cloudflare has no Node process by default
        const { readFile } = await import('node:fs/promises');
        return JSON.parse(await readFile(`${process.env.MCP_DATA_DIR}/${file}`, 'utf8'));
      }
      const res = await fetch(new URL(`mcp-data/${file}`, `${ORIGIN.replace(/\/+$/, '')}/`));
      if (!res.ok) throw new Error(`library data ${file} is unavailable (HTTP ${res.status})`);
      return res.json();
    })();
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p;
}

// The reader's own data files (library/...): the Mafteach panel, the machine-learned and the outside-genre parallels.
function loadLib(file) {
  const key = 'library/' + file;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      if (typeof process !== 'undefined' && process.env?.MCP_DATA_DIR) {
        const { readFile } = await import('node:fs/promises');
        return JSON.parse(await readFile(`${process.env.MCP_DATA_DIR}/../library/${file}`, 'utf8'));
      }
      const res = await fetch(new URL(`library/${file}`, `${ORIGIN.replace(/\/+$/, '')}/`));
      if (!res.ok) throw new Error(`library data ${file} is unavailable (HTTP ${res.status})`);
      return res.json();
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
// The entries for one section from a sharded reader data set (index.json maps a sefer, or a Pri Tzaddik section, to its file).
async function libSection(dir, sectionRef) {
  try {
    const idx = await loadLib(`${dir}/index.json`);
    let key = null;
    for (const k of Object.keys(idx.books || {})) if ((sectionRef === k || sectionRef.startsWith(k + ',') || sectionRef.startsWith(k + ' ')) && (!key || k.length > key.length)) key = k;
    if (!key) return [];
    const { passages } = await loadLib(`${dir}/${idx.books[key].file}`);
    const keys = passages[sectionRef] ? [sectionRef] : Object.keys(passages).filter(k => k.startsWith(sectionRef + ' ') && /^\d+$/.test(k.slice(sectionRef.length + 1)));
    return keys.map(k => passages[k]);
  } catch { return []; }
}
const OUTSIDE = ['Chassidus', 'Kabbalah', 'Machshava', 'Mussar'];

let CAT = null;
async function catalog() {
  const c = await load('catalog.json');
  if (CAT?.raw === c) return CAT;
  const books = c.books.map((b, i) => {
    const keys = new Set([skel(b.title), skel(b.slug.replace(/-/g, ' ')), heKey(b.he)]);
    const short = b.title.replace(/\s+on\s+(Torah|the Torah)$/i, '');
    keys.add(skel(short));
    for (const a of TITLE_ALIASES[b.title] || []) keys.add(/[א-ת]/.test(a) ? heKey(a) : skel(a));
    const sections = b.sections.map(s => {
      const rest = s.ref.startsWith(b.title) ? s.ref.slice(b.title.length) : s.ref;
      return { ...s, key: refKey(rest), heKey: heKey(s.he || '') };
    });
    return { ...b, order: i, keys: [...keys].filter(Boolean), sections };
  });
  CAT = { raw: c, books, bySlug: new Map(books.map(b => [b.slug, b])) };
  return CAT;
}

async function bookText(book) {
  const t = await load(`text/${book.slug}.json`);
  if (!t.byRef) {
    t.book = book;
    t.byRef = new Map();
    t.paras.forEach((p, i) => { const l = t.byRef.get(p.r); l ? l.push(i) : t.byRef.set(p.r, [i]); });
    t.norm = {};
  }
  return t;
}

// Titles people write in other transliterations (most variants are already caught by skel()).
const TITLE_ALIASES = {
  'Peri Tzadik': ['Pri Tzaddik', 'Pri Tzadik', 'Peri Tzaddik'],
  'Tzidkat HaTzadik': ['Tzidkas HaTzaddik'],
  'Takanat HaShavin': ['Takanas HaShavin'],
  'Beit Yaakov on Torah': ['Beis Yaakov', 'Beit Yaakov', 'בית יעקב'],
  'Sefer HaZikhronot': ['Sefer HaZichronos', 'Sefer HaZikhronos'],
  'Kometz HaMinchah': ['Kometz HaMincha'],
  'Ohr Zarua LaTzadik': ['Or Zarua LaTzaddik', 'Ohr Zarua LaTzaddik'],
  'Machshavot Charutz': ['Machshavos Charutz'],
  'Sichat Malakhei HaSharet': ['Sichas Malachei HaShareis'],
  'Mei HaShiloach': ['Mei Hashiloach', 'מי השלוח'],
  'Resisei Layla': ['Rsisei Layla', 'Resisei Laylah'],
};

// ---------------------------------------------------------------- normalization

// Search form of a text: no nikkud or cantillation, final letters as medial, no quote marks (so הקב"ה = הקבה),
// punctuation as space, Latin lowercase without accents. "Loose" spelling also drops ו and י.
function table(loose) {
  const t = new Array(65536);
  for (let c = 0; c < 65536; c++) t[c] = String.fromCharCode(c);
  for (let c = 0x41; c <= 0x5a; c++) t[c] = String.fromCharCode(c + 32);
  for (let c = 0xc0; c <= 0x24f; c++) t[c] = String.fromCharCode(c).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (let c = 0x300; c <= 0x36f; c++) t[c] = '';
  for (let c = 0x591; c <= 0x5c7; c++) t[c] = '';
  for (const c of [0x5be, 0x5c0, 0x5c3, 0x5c6]) t[c] = ' ';
  t[0x5da] = 'כ'; t[0x5dd] = 'מ'; t[0x5df] = 'נ'; t[0x5e3] = 'פ'; t[0x5e5] = 'צ';
  if (loose) { t[0x5d5] = ''; t[0x5d9] = ''; }
  for (let c = 0xfb1d; c <= 0xfb4f; c++) t[c] = [...String.fromCharCode(c).normalize('NFKD')].map(x => t[x.charCodeAt(0)]).join('');
  for (const ch of '׳״\'"`´ʼ‘’‚‛“”„​‌‍‎‏­⁠﻿') t[ch.charCodeAt(0)] = '';
  for (const ch of ' \t\n\r\f\v                 　.,;:!?()[]{}<>«»‹›–—―‐‑‒-…/\\|*~_=+•·§¶#@$%^&') t[ch.charCodeAt(0)] = ' ';
  return t;
}
const TABLES = { exact: table(false), loose: table(true) };

// Returns ' text ' (padded, single spaces). With a map, map[k] is the index in s of normalized character k.
function norm(s, mode = 'exact', map = null) {
  const t = TABLES[mode];
  let out = ' ', sp = true;
  if (map) map.push(-1);
  for (let i = 0; i < s.length; i++) {
    const r = t[s.charCodeAt(i)];
    if (r === ' ') { if (!sp) { out += ' '; sp = true; if (map) map.push(i); } }
    else if (r) { out += r; sp = false; if (map) for (let k = 0; k < r.length; k++) map.push(i); }
  }
  if (!sp) { out += ' '; if (map) map.push(s.length); }
  return out;
}

// Skeleton of a transliterated name, so that Ashkenazi/Sephardi/academic spellings meet:
// Tzidkas HaTzaddik = Tzidkat HaTzadik, Bereishis = Bereshit, Berachos = Berakhot, Sukkah = Succah.
function skel(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/).map(w => w.replace(/([aeiou])h$/, '$1')).join('')
    .replace(/c(?!h)/g, 'k').replace(/kh/g, 'ch').replace(/s/g, 't').replace(/th/g, 't').replace(/ph/g, 'f')
    .replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}
// Word by word, for finding a name inside a longer title: "Bereishis" in "Peri Tzadik, Bereshit 1".
const wordSkels = s => String(s).split(/[^A-Za-zÀ-ɏ']+/).filter(Boolean).map(skel).filter(Boolean);
function wordsIn(needle, hay) {
  const h = wordSkels(hay);
  for (let i = 0; i + needle.length <= h.length; i++) if (needle.every((w, j) => h[i + j] === w)) return true;
  return false;
}
// Key of a Hebrew name: letters only, without nikkud or final forms.
const heKey = s => norm(String(s || '')).replace(/[^א-ת]/g, '');
// Key of a ref: letter runs as skeletons, numbers as written: "Pri Tzaddik, Bereishis 1:3" -> "prtzdkbrt|1|3".
function refKey(s) {
  return String(s).split(/(\d+)/).map((part, i) => (i % 2 ? String(+part) : skel(part))).filter(Boolean).join('|');
}

// ---------------------------------------------------------------- formatting helpers

const toHash = ref => encodeURIComponent(ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':');
const readerLink = ref => `${ORIGIN}/library/#/read/${toHash(ref)}`;
const heOf = p => (p.p ? p.p.map(x => x[0]).join(' ') : p.t || '');
const enOf = p => (p.p ? p.p.map(x => x[1]).join(' ') : '');
const headsOf = p => [...(p.h || []), ...(p.h2 || [])];
// Headings a paragraph is found under: the section's title (on its first paragraph) and the headings in the text.
function headingsAt(t, i) {
  const p = t.paras[i], sec = t.book?.sections[p.s];
  return [...(sec && sec.first === i && sec.title && !/^[\w' -]* \d+(:\d+)*$/.test(sec.title) ? [sec.title] : []), ...headsOf(p)];
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// A book can hold the original Hebrew of a public-domain printing and, for some sections, Akiva Publishing's
// interlinear study edition (Peri Tzadik, Tiferet Yosef); label each section by what it actually is.
function editionLabel(book, sec) {
  if (sec.il && !book.akiva) return 'Akiva Publishing interlinear study edition (© Akiva Publishing)';
  if (sec.il && book.akiva && book.license !== '© Akiva Publishing') return 'Akiva Publishing interlinear study edition (© Akiva Publishing)';
  if (!sec.il && sec.sourceEdition) return sec.sourceEdition;
  if (!sec.il && book.akiva && book.license === '© Akiva Publishing') return book.edition;
  return `${sec.edition === 'hebrew' ? 'original Hebrew: ' : ''}${book.edition}${book.license && book.license !== '© Akiva Publishing' ? ` (${book.license})` : ''}`;
}

// Put the note numbers back into a phrase: notes are [number, text, phraseIndex, 'h'|'e', offset].
function withMarks(text, notes, k, side) {
  const here = notes.filter(f => f[2] === k && f[3] === side).sort((a, b) => b[4] - a[4]);
  let s = text;
  for (const f of here) s = s.slice(0, f[4]) + `[${f[0]}]` + s.slice(f[4]);
  return s;
}

// ---------------------------------------------------------------- book and ref resolution

async function findBook(name) {
  const { books } = await catalog();
  const q = String(name || '').trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  const exact = books.find(b => b.slug === lower || b.title.toLowerCase() === lower || b.he === q);
  if (exact) return exact;
  const key = /[א-ת]/.test(q) ? heKey(q) : skel(q);
  if (!key) return null;
  return books.find(b => b.keys.includes(key)) || books.find(b => b.keys.some(k => k.startsWith(key) && key.length >= 3)) || null;
}

async function findBooks(list) {
  if (list == null || (Array.isArray(list) && !list.length)) return { books: null, unknown: [] };
  const names = (Array.isArray(list) ? list : String(list).split(',')).map(x => String(x).trim()).filter(Boolean);
  const books = [], unknown = [];
  for (const n of names) { const b = await findBook(n); b ? books.includes(b) || books.push(b) : unknown.push(n); }
  return { books, unknown };
}

// Split "Pri Tzaddik, Bereishis 1:3" into the book and the rest of the ref.
async function splitRef(input) {
  const { books } = await catalog();
  const s = String(input).trim().replace(/\s+/g, ' ');
  const lower = s.toLowerCase();
  // Exact title prefix first (fast path for refs copied from this server).
  let best = null;
  for (const b of books) {
    for (const t of [b.title, b.he]) {
      if (t && lower.startsWith(t.toLowerCase()) && (!best || t.length > best.len)) best = { book: b, len: t.length, hebrew: t === b.he };
    }
  }
  if (best) return best.hebrew ? { book: best.book, rest: s, hebrew: true } : { book: best.book, rest: s.slice(best.len) };
  if (/^[\s֐-׿"'״׳,.:()\d-]+$/.test(s)) {           // Hebrew ref
    const k = heKey(s);
    for (const b of books) {
      const hk = heKey(b.he);
      if (hk && k.startsWith(hk) && (!best || hk.length > best.len)) best = { book: b, len: hk.length, hebrew: true };
    }
    if (best) return { book: best.book, rest: s, hebrew: true };
  }
  // Transliterated title, word by word ("Pri Tzaddik, Korach 12"): joining the words first would merge letters across
  // the title and the section ("...tzdk" + "krch" -> "...tzdkrch") and lose the section's first letter.
  const words = s.split(/[\s,]+/).filter(Boolean);
  for (let n = Math.min(6, words.length - 1); n >= 1; n--) {
    const k = skel(words.slice(0, n).join(' '));
    if (n > 1 && k === skel(words.slice(0, n - 1).join(' '))) continue;      // "Pri Tzaddik Ki": "Ki" adds no letter after "...k"
    const b = k && books.find(b => b.keys.includes(k));
    if (b) {
      const m = s.match(new RegExp('^(?:[^\\s,]+[\\s,]+){' + n + '}'));
      return { book: b, rest: m ? s.slice(m[0].length) : words.slice(n).join(' ') };
    }
  }
  // Transliterated title: the longest book key that starts the ref's first letter run.
  const key = refKey(s);
  const first = key.split('|')[0];
  for (const b of books) {
    for (const k of b.keys) {
      if (k && first.startsWith(k) && (!best || k.length > best.len)) best = { book: b, len: k.length };
    }
  }
  if (!best) return null;
  return { book: best.book, restKey: [first.slice(best.len), ...key.split('|').slice(1)].filter(Boolean).join('|') };
}

// Resolve a ref to a section and an optional paragraph range.
async function resolveRef(input, edition) {
  const raw = String(input || '').trim().replace(/\s+/g, ' ');
  if (!raw) return { error: 'ref is empty.' };
  let range = raw.match(/^(.*?\d)\s*[-–—]\s*(\d+)$/);
  const base = range ? range[1] : raw;
  const split = await splitRef(base);
  if (!split) return { error: `No book in the library matches "${raw}".`, suggest: (await catalog()).books.map(b => b.title) };
  const { book } = split;
  const pick = list => {
    if (list.length < 2) return list[0];
    const want = edition === 'hebrew' ? false : true;
    return list.find(s => !!s.il === want) || list[0];
  };
  let candidates = [];
  if (split.hebrew) {
    const m = base.match(/^(.*?)(?:[\s:]+(\d+))?$/);
    for (const [txt, para] of [[base, null], [m?.[1] || base, m?.[2] ? +m[2] : null]]) {
      const k = heKey(txt);
      const hits = book.sections.filter(s => s.heKey && s.heKey === k);
      if (hits.length) { candidates = hits.map(sec => ({ sec, para })); break; }
    }
  } else {
    const restKey = split.restKey ?? refKey(split.rest);
    const exact = book.sections.filter(s => s.key === restKey);
    if (exact.length) candidates = exact.map(sec => ({ sec, para: null }));
    else {
      // "<section> <n>": the last number is the paragraph.
      const parts = restKey.split('|');
      const last = parts.pop();
      if (/^\d+$/.test(last)) {
        const secKey = parts.join('|');
        candidates = book.sections.filter(s => s.key === secKey).map(sec => ({ sec, para: +last }));
      }
    }
  }
  // The sound-alike key can join two names (Masei / Matot both reduce to "mt"): keep the sections whose name is closest
  // to what was written, letter for letter.
  if (!split.hebrew && new Set(candidates.map(c => c.sec.key)).size === 1 && new Set(candidates.map(c => c.sec.ref.replace(/[\d:\s]+$/, ''))).size > 1) {
    const lit = x => String(x).toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
    const said = lit(base.replace(new RegExp('^' + book.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ''));
    const bigrams = x => new Set([...x].map((ch, i) => x.slice(i, i + 2)).filter(b => b.length === 2));
    const sim = name => { const a = bigrams(lit(name)), b = bigrams(said); let n = 0; for (const g of a) if (b.has(g)) n++; return (2 * n) / (a.size + b.size || 1); };
    const nameOf = sec => (sec.ref.startsWith(book.title) ? sec.ref.slice(book.title.length) : sec.ref).replace(/[\d:\s]+$/, '');
    const best = Math.max(...candidates.map(c => sim(nameOf(c.sec))));
    candidates = candidates.filter(c => sim(nameOf(c.sec)) === best);
  }
  // A section named by its last words: "Shekalim 6" for "Parshat Shekalim", "Mei HaShiloach I, Vayetzei 3" for
  // "Mei HaShiloach, Volume I, Genesis, Vayetzei" (paragraph 3); "I"/"II" picks the volume.
  if (!candidates.length && !split.hebrew) {
    const restKey = split.restKey ?? refKey(split.rest);
    const parts = restKey.split('|');
    const tryName = (nameKey, para) => nameKey ? book.sections.filter(s => s.key !== nameKey && s.key.endsWith(nameKey) && !/\d/.test(s.key.slice(0, -nameKey.length).slice(-1))).map(sec => ({ sec, para })) : [];
    candidates = tryName(restKey, null);
    if (!candidates.length && /^\d+$/.test(parts[parts.length - 1])) candidates = tryName(parts.slice(0, -1).join('|'), +parts[parts.length - 1]);
    if (!candidates.length && parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1]) && /^\d+$/.test(parts[parts.length - 2])) {
      // "Korach 12:3": a whole-parsha section, os 12 (the paragraph); the last number is dropped
      candidates = tryName(parts.slice(0, -2).join('|'), +parts[parts.length - 2]);
    }
    const vol = base.slice(book.title.length).match(/(?:^|[\s,])(?:volume\s+|vol\.?\s*)?(II|I)(?=[\s,])/i);
    if (candidates.length > 1 && vol) { const v = candidates.filter(c => c.sec.ref.includes(`Volume ${vol[1].toUpperCase()},`)); if (v.length) candidates = v; }
  }
  if (!candidates.length) {
    const restKey = split.restKey ?? (split.hebrew ? '' : refKey(split.rest));
    const head = restKey.split('|')[0];
    const near = book.sections.filter(s => head && s.key.startsWith(head)).slice(0, 15);
    return { error: `"${raw}" is not a ref in ${book.title}.`, book, suggest: (near.length ? near : book.sections.slice(0, 15)).map(s => s.ref) };
  }
  const chosen = pick(candidates.map(c => c.sec));
  const c = candidates.find(x => x.sec === chosen);
  let from = c.para, to = c.para;
  if (range) {
    if (from == null) return { error: `A range needs a paragraph number, e.g. "${chosen.ref}:1-3".`, book };
    to = +range[2];
    if (to < from) [from, to] = [to, from];
  }
  return { book, sec: chosen, from, to, alternatives: candidates.filter(x => x.sec !== chosen).map(x => x.sec) };
}

// ---------------------------------------------------------------- tools

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const FORMAT = { type: 'string', enum: ['markdown', 'json'], default: 'markdown', description: 'markdown (default) for reading, json for structured data.' };

const TOOLS = [
  {
    name: 'kisvei_list_books',
    title: 'List the books in the library',
    description: 'List every book in the Kisvei Rav Tzadok Library with its Hebrew title, school (R. Tzadok HaKohen or Izhbitz), edition, license, number of sections and paragraphs, and whether it has Akiva Publishing\'s interlinear English. Start here to learn which titles can be searched or read.',
    inputSchema: { type: 'object', properties: { response_format: FORMAT }, additionalProperties: false },
    annotations: { title: 'List books', ...RO },
  },
  {
    name: 'kisvei_get_contents',
    title: 'Table of contents',
    description: 'Table of contents of one book: every section with its exact ref (for kisvei_get_text), English and Hebrew titles and paragraph count. Use "filter" to show part of a large book, e.g. book "Peri Tzadik" with filter "Noach".',
    inputSchema: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'Book title (English, Hebrew or Ashkenazi spelling) or slug, e.g. "Resisei Layla", "פרי צדיק", "Tzidkas HaTzaddik".' },
        filter: { type: 'string', description: 'Only sections whose ref, title or part of the book contains this text, e.g. "Chanukah" or "Bereshit".' },
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Number of sections to skip.' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, default: 300, description: 'Maximum number of sections to list.' },
        response_format: FORMAT,
      },
      required: ['book'],
      additionalProperties: false,
    },
    annotations: { title: 'Table of contents', ...RO },
  },
  {
    name: 'kisvei_get_text',
    title: 'Read a passage',
    description: 'Exact text of a section, a paragraph or a range of paragraphs. Akiva Publishing interlinear editions return each vocalized Hebrew phrase with its English, and the footnotes ([1], [2] ... in the text). Hebrew-only works return the Hebrew. Examples: "Resisei Layla 5", "Resisei Layla 5:2", "Tzidkat HaTzadik 100", "Peri Tzadik, Bereshit 1:2-4", "Dover Tzedek, Kuntres Dover Tzedek, Eruvin 1:5". Ashkenazi spellings and Hebrew section names (e.g. "רסיסי לילה, סימן ה׳") work too.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Section ref, paragraph ref ("…:3") or range ("…:3-5"), as given by kisvei_get_contents or kisvei_search.' },
        view: { type: 'string', enum: ['interlinear', 'hebrew', 'english', 'both'], default: 'interlinear', description: 'interlinear: one Hebrew phrase and its English per line; hebrew or english: that language only, as running paragraphs; both: the Hebrew paragraph, then the English.' },
        include_notes: { type: 'boolean', default: true, description: 'Include the footnotes and transcription notes.' },
        include_citations: { type: 'boolean', default: false, description: 'List the sources each paragraph cites.' },
        edition: { type: 'string', enum: ['interlinear', 'hebrew'], description: 'Only for refs that exist in two editions (Peri Tzadik): the interlinear study edition (default) or the original Hebrew.' },
        max_chars: { type: 'integer', minimum: 2000, maximum: 150000, default: 40000, description: 'Stop after about this many characters; the reply says where to continue.' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
    annotations: { title: 'Read a passage', ...RO },
  },
  {
    name: 'kisvei_search',
    title: 'Search the library',
    description: 'Full-text search across the library. Hebrew is matched without nikkud, inside words (so שבת also finds בשבת and השבת) and with abbreviation marks ignored (הקב"ה = הקבה). All words must appear in the paragraph; put a phrase in double quotes to match it exactly, and start a word with - to exclude it. English matches the Akiva Publishing translations and the section headings. Results are paragraphs, best matches first, with the matching phrase and its ref.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to find, Hebrew and/or English, e.g. צוותא, "אור הגנוז", "hidden light" Chanukah, שמחה -פורים.' },
        books: { type: 'array', items: { type: 'string' }, description: 'Limit to these books (titles, Hebrew titles or slugs).' },
        fields: {
          type: 'array', items: { type: 'string', enum: ['hebrew', 'english', 'headings', 'notes'] },
          description: 'Where to look. Default: hebrew, english and headings. Add "notes" to search the footnotes too.',
        },
        spelling: { type: 'string', enum: ['exact', 'loose'], default: 'exact', description: 'loose: ignore ו and י, so plene and defective spellings (מצוה/מצווה, תקון/תיקון) match. Finds more, less precisely.' },
        whole_words: { type: 'boolean', default: false, description: 'Match whole words only. Hebrew words may still carry up to three prefix letters (ו ה ב כ ל מ ש), so שבת matches בשבת but not שבתות.' },
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Number of results to skip (for the next page).' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Number of results to return.' },
        response_format: FORMAT,
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { title: 'Search the library', ...RO },
  },
  {
    name: 'kisvei_find_citing_passages',
    title: 'Passages that cite a source',
    description: 'Every passage in the library that cites a given source: a verse or chapter ("Genesis 1:1", "Tehillim 92"), a daf ("Berakhot 6b", "Shabbos 88"), a midrash ("Bereshit Rabbah 1:1"), Zohar, Mishnah, Rambam, Shulchan Arukh or another Rav Tzadok work ("Tzidkat HaTzadik 100"). Useful for finding parallels. A whole chapter or daf includes its verses and segments.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The cited source, e.g. "Berakhot 6b", "Psalms 92:2", "Bereishis 1", "Zohar, Yitro".' },
        books: { type: 'array', items: { type: 'string' }, description: 'Only passages in these library books.' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        response_format: FORMAT,
      },
      required: ['source'],
      additionalProperties: false,
    },
    annotations: { title: 'Passages that cite a source', ...RO },
  },
  {
    name: 'kisvei_get_cited_sources',
    title: 'Sources a passage cites',
    description: 'The sources (Tanakh, Talmud, Midrash, Zohar, halachah, other Rav Tzadok works) that a section or paragraph of the library cites, paragraph by paragraph.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Section or paragraph ref, e.g. "Resisei Layla 1" or "Resisei Layla 1:1".' },
        edition: { type: 'string', enum: ['interlinear', 'hebrew'], description: 'Only for refs that exist in two editions (Peri Tzadik).' },
        response_format: FORMAT,
      },
      required: ['ref'],
      additionalProperties: false,
    },
    annotations: { title: 'Sources a passage cites', ...RO },
  },
  {
    name: 'kisvei_find_parallels',
    title: 'Parallels in the library',
    description: 'Parallels to a passage: in Kisvei Rav Tzadok and the Ishbitz-Radzin works, ranked by a model trained on HaMafteach HaShalem\'s own parallels together with the Mafteach\'s index lines and the sources both passages draw on (verses, Gemara, Midrash, Zohar, including verses quoted without being named); and beyond the library, in Chassidus, Kabbalah, Machshava and Mussar (Sefaria). Strongest first; each parallel says why (the index line, the shared sources or rare words), so read both before relying on it. Give a paragraph ref ("Tzidkat HaTzadik 1:3") or a section ref (all its paragraphs).',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Paragraph or section ref, e.g. "Tzidkat HaTzadik 1:3", "Resisei Layla 5".' },
        school: { type: 'string', enum: ['all', 'Kisvei Rav Tzadok', 'Ishbitz-Radzin', 'outside', 'Chassidus', 'Kabbalah', 'Machshava', 'Mussar'], default: 'all', description: 'Only parallels from this school. "outside" = Chassidus, Kabbalah, Machshava and Mussar beyond the library (Sefaria).' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30, description: 'Maximum number of parallels.' },
        response_format: FORMAT,
      },
      required: ['ref'],
      additionalProperties: false,
    },
    annotations: { title: 'Parallels in the library', ...RO },
  },
  {
    name: 'mafteach_find_topic',
    title: 'HaMafteach: where Rav Tzadok discusses a topic',
    description: 'HaMafteach HaShalem (R\' Chaim Hirsch\'s complete index to R. Tzadok HaKohen\'s works): every place R. Tzadok discusses a topic, concept, person, place, mitzvah or festival, with the passages as library refs. Ask in Hebrew, English or Ashkenazi/Sefardi transliteration: "אמונה", "faith", "emunah", "emunoh"; "Shabbos"/"Shabbat"; "Avrohom Avinu"; "Mashiach ben Yosef"; "teshuva"; "Chanukah". Returns the best-matching index heading with its entries (grouped by sub-heading) and other headings that also match.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic, person or concept in Hebrew, English or transliteration, e.g. "בטחון", "trust in God", "bitachon", "Yosef HaTzaddik".' },
        corpus: { type: 'string', enum: ['all', 'rav-tzadok', 'pri-tzadik'], default: 'all', description: 'all; rav-tzadok = his sefarim other than Pri Tzaddik (Mafteach parts 1-3); pri-tzadik = Pri Tzaddik (parts 4-7).' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 300, default: 60, description: 'Number of entries to return.' },
        response_format: FORMAT,
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { title: 'HaMafteach topics', ...RO },
  },
  {
    name: 'mafteach_lookup_source',
    title: 'HaMafteach: where Rav Tzadok draws on a verse, daf or midrash',
    description: 'From HaMafteach HaShalem\'s source indexes: every place R. Tzadok (his sefarim and Pri Tzaddik) uses a given pasuk, daf, Midrash Rabbah passage, or Zohar/Midrash/Rambam source, with the words he quotes and the passages as library refs. Names in any spelling: "Genesis 2:7", "Bereishis 2:7", "Bereshit 2", "Berachos 6b", "Shabbos 88", "Yerushalmi Berakhot 1:1", "Bereshit Rabbah 2:4", "בראשית ב ז", "שבת פח ב", "Zohar Bereshit", "Tanchuma".',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Book and address, e.g. "Tehillim 92:2", "Psalms 92", "Sanhedrin 97b", "שמות רבה ג", "Pirkei DeRabbi Eliezer".' },
        corpus: { type: 'string', enum: ['all', 'rav-tzadok', 'pri-tzadik'], default: 'all', description: 'all; rav-tzadok = his sefarim other than Pri Tzaddik (Mafteach parts 1-3); pri-tzadik = Pri Tzaddik (parts 4-7).' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 300, default: 60 },
        response_format: FORMAT,
      },
      required: ['source'],
      additionalProperties: false,
    },
    annotations: { title: 'HaMafteach sources', ...RO },
  },
  {
    name: 'mafteach_lookup_passage',
    title: 'HaMafteach: topics and sources indexed to a passage',
    description: 'Every HaMafteach HaShalem entry that points to one R. Tzadok passage: the topics the index files it under and the verses, dapim and midrashim it draws on. Use it to build footnotes and to find parallels. Refs in any form: "Tzidkat HaTzadik 100", "Tzidkas HaTzaddik 100", "Peri Tzadik, Vayechi 11", "Pri Tzaddik Vayechi 11", "Resisei Layla 57", "צדקת הצדיק ק", or a Mafteach code "צה-ק".',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Library passage (section) ref or Mafteach code.' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 300, default: 100 },
        response_format: FORMAT,
      },
      required: ['ref'],
      additionalProperties: false,
    },
    annotations: { title: 'HaMafteach by passage', ...RO },
  },
  {
    name: 'mafteach_search',
    title: 'HaMafteach: search entries and headings',
    description: 'Search all of HaMafteach HaShalem: Hebrew words or phrases inside the index entries (the quoted words of pesukim, Gemara and Midrash, and the topic sentences), plus index headings matching a Hebrew, English or transliterated query. Hebrew matching ignores nikkud, final letters and quote marks; put a phrase in double quotes. Use it for a remembered quote ("ויפח באפיו", "אין מזל לישראל") or a word inside topics.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Hebrew words (all must appear) or a quoted phrase; English/transliteration matches headings only.' },
        corpus: { type: 'string', enum: ['all', 'rav-tzadok', 'pri-tzadik'], default: 'all', description: 'all; rav-tzadok = his sefarim other than Pri Tzaddik (Mafteach parts 1-3); pri-tzadik = Pri Tzaddik (parts 4-7).' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 40 },
        response_format: FORMAT,
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { title: 'HaMafteach search', ...RO },
  },
];

class ToolError extends Error {}

// Minimal argument check against the tool's schema (types, enums, ranges, required, unknown names).
function checkArgs(tool, args) {
  if (args == null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new ToolError('arguments must be an object.');
  const { properties, required = [] } = tool.inputSchema;
  for (const k of Object.keys(args)) if (!properties[k]) throw new ToolError(`unknown argument "${k}". Arguments: ${Object.keys(properties).join(', ')}.`);
  for (const k of required) if (args[k] == null || args[k] === '') throw new ToolError(`"${k}" is required.`);
  const out = {};
  for (const [k, sch] of Object.entries(properties)) {
    let v = args[k];
    if (v == null) { if (sch.default !== undefined) out[k] = sch.default; continue; }
    if (sch.type === 'integer') {
      if (typeof v === 'string' && /^\d+$/.test(v)) v = +v;
      if (!Number.isInteger(v)) throw new ToolError(`"${k}" must be an integer.`);
      if (sch.minimum != null && v < sch.minimum) throw new ToolError(`"${k}" must be at least ${sch.minimum}.`);
      if (sch.maximum != null && v > sch.maximum) v = sch.maximum;
    } else if (sch.type === 'boolean') {
      if (v === 'true' || v === 'false') v = v === 'true';
      if (typeof v !== 'boolean') throw new ToolError(`"${k}" must be true or false.`);
    } else if (sch.type === 'string') {
      if (typeof v !== 'string') throw new ToolError(`"${k}" must be a string.`);
      if (sch.enum && !sch.enum.includes(v)) throw new ToolError(`"${k}" must be one of: ${sch.enum.join(', ')}.`);
    } else if (sch.type === 'array') {
      if (typeof v === 'string') v = v.split(',').map(x => x.trim()).filter(Boolean);
      if (!Array.isArray(v)) throw new ToolError(`"${k}" must be a list.`);
      const en = sch.items?.enum;
      for (const x of v) {
        if (typeof x !== 'string') throw new ToolError(`"${k}" must be a list of strings.`);
        if (en && !en.includes(x)) throw new ToolError(`"${k}" values must be among: ${en.join(', ')}.`);
      }
    }
    out[k] = v;
  }
  return out;
}

const json = v => JSON.stringify(v, null, 1);

// ---- kisvei_list_books
async function listBooks({ response_format }) {
  const { books } = await catalog();
  const rows = books.map(b => {
    const il = b.sections.filter(s => s.il).length;
    return {
      title: b.title, he: b.he, slug: b.slug, school: b.group === 'Izhbitz' ? 'Izhbitz-Radzin' : 'R. Tzadok HaKohen',
      edition: b.edition, license: b.license || null, source: b.source || null, sections: b.sections.length, paragraphs: b.paragraphs,
      interlinear_sections: il,
      ...(il && il < b.sections.length ? { note: `Original Hebrew, with Akiva Publishing's interlinear study edition (© Akiva Publishing) for ${il} sections` } : {}),
    };
  });
  if (response_format === 'json') return json({ books: rows });
  const lines = [`# Kisvei Rav Tzadok Library: ${rows.length} books`, ''];
  for (const r of rows) {
    const kind = r.note ? `${r.note}` : r.interlinear_sections ? 'Hebrew with English, phrase by phrase' : 'Hebrew';
    lines.push(`- **${r.title}** · ${r.he} (${r.school}): ${r.sections} sections, ${r.paragraphs} paragraphs. ${kind}. Edition: ${r.edition}${r.license ? ` (${r.license})` : ''}.`);
  }
  lines.push('', 'Read with kisvei_get_text, browse with kisvei_get_contents, search with kisvei_search.');
  return lines.join('\n');
}

// ---- kisvei_get_contents
async function getContents({ book: name, filter, offset, limit, response_format }) {
  const book = await findBook(name);
  if (!book) throw new ToolError(`no book matches "${name}". Books: ${(await catalog()).books.map(b => b.title).join('; ')}.`);
  let secs = book.sections;
  if (filter) {
    const f = filter.toLowerCase(), hebrew = /[א-ת]/.test(filter);
    const fk = hebrew ? heKey(filter) : wordSkels(filter);
    secs = secs.filter(s => [s.ref, s.title, s.path, s.parashah || ''].some(x => x.toLowerCase().includes(f))
      || (hebrew ? fk && [s.he, s.heTitle].some(x => heKey(x).includes(fk)) : fk.length && [s.ref, s.title, s.path].some(x => wordsIn(fk, x))));
  }
  const page = secs.slice(offset, offset + limit);
  const more = offset + page.length < secs.length;
  if (response_format === 'json') {
    return json({ book: book.title, he: book.he, total: secs.length, offset, count: page.length, has_more: more, next_offset: more ? offset + page.length : null,
      sections: page.map(s => ({ ref: s.ref, he_ref: s.he || null, title: s.title, he_title: s.heTitle || null, part: s.path || null, paragraphs: s.count, interlinear: !!s.il, ...(s.edition ? { edition: s.edition } : {}) })) });
  }
  const lines = [`# ${book.title} · ${book.he}: contents`, `${book.edition}${book.license ? ` (${book.license})` : ''}. ${secs.length} section${secs.length === 1 ? '' : 's'}${filter ? ` matching "${filter}"` : ''}${secs.length > page.length ? `, showing ${offset + 1}–${offset + page.length}` : ''}.`, ''];
  let lastPath = null;
  for (const s of page) {
    if (s.path !== lastPath) { if (s.path) lines.push(`## ${s.path}`); lastPath = s.path; }
    const titles = [s.title !== s.ref ? s.title : '', s.heTitle].filter(Boolean).join(' · ');
    lines.push(`- ${s.ref}${titles ? ` — ${titles}` : ''} (${s.count} ¶${s.il ? ', interlinear' : ''}${s.edition ? `, ${s.edition === 'hebrew' ? 'original Hebrew' : 'study edition'}` : ''})`);
  }
  if (more) lines.push('', `More: offset ${offset + page.length}.`);
  return lines.join('\n');
}

// ---- kisvei_get_text
async function getText({ ref, view, include_notes, include_citations, edition, max_chars }) {
  const r = await resolveRef(ref, edition);
  if (r.error) throw new ToolError(r.error + (r.suggest?.length ? ` Try: ${r.suggest.slice(0, 15).join('; ')}.` : ''));
  const { book, sec } = r;
  const t = await bookText(book);
  let paras = t.paras.slice(sec.first, sec.first + sec.count);
  if (r.from != null) {
    const sel = paras.filter(p => { const n = +p.r.slice(p.r.search(/\d+$/)); return n >= r.from && n <= r.to; });
    if (!sel.length) {
      const a = paras[0].r.match(/\d+$/)[0], b = paras[paras.length - 1].r.match(/\d+$/)[0];
      throw new ToolError(`${sec.ref}${sec.edition ? ` (${sec.edition === 'hebrew' ? 'original Hebrew' : 'study edition'})` : ''} has ${a === b ? `paragraph ${a} only` : `paragraphs ${a}–${b}`}; ask for "${sec.ref}" or a paragraph in that range.`);
    }
    paras = sel;
  }
  const interlinear = paras.some(p => p.p);
  const v = interlinear ? view : 'hebrew';
  const out = [];
  out.push(`# ${book.title}: ${sec.title}${sec.heTitle ? ` · ${sec.heTitle}` : ''}`);
  out.push(`Ref: ${r.from != null ? (r.from === r.to ? paras[0].r : `${paras[0].r}–${paras[paras.length - 1].r.match(/\d+$/)[0]}`) : sec.ref}${sec.he ? ` · ${sec.he}` : ''}`);
  const label = editionLabel(book, sec);
  out.push(`Edition: ${label}${label.includes('©') || !book.license || label.includes(book.license) ? '' : ` (${book.license})`}${sec.path && !/Study Edition/i.test(sec.path) ? ` · ${sec.path}` : ''}`);
  if (r.alternatives?.length) out.push(`Also in the ${r.alternatives.map(a => editionLabel(book, a)).join(', ')}: ask again with edition "${sec.il ? 'hebrew' : 'interlinear'}".`);
  if (!interlinear && (view === 'english' || view === 'both')) out.push('No English translation is included in this indexed text; the Hebrew follows.');
  out.push(`Reader: ${readerLink(r.from != null && r.from === r.to ? paras[0].r : sec.ref)}`, '');
  let used = out.join('\n').length, stopped = null;
  for (const p of paras) {
    const block = [];
    for (const h of p.h || []) block.push(`**${h.replace(/\n+/g, ' — ')}**`);
    block.push(`[${p.r}]`);
    const notes = p.f || [];
    if (p.p) {
      if (v === 'interlinear') {
        p.p.forEach(([he, en], k) => block.push(`${withMarks(he, notes, k, 'h')} — ${withMarks(en, notes, k, 'e')}`));
      } else {
        if (v === 'hebrew' || v === 'both') block.push(p.p.map(([he], k) => withMarks(he, notes, k, 'h')).join(' '));
        if (v === 'both') block.push('');
        if (v === 'english' || v === 'both') block.push(p.p.map(([, en], k) => withMarks(en, notes, k, 'e')).join(' '));
      }
    } else block.push(withMarks(p.t || '', notes, -1, 'h'));
    if (include_notes && notes.length) {
      block.push('', 'Notes:');
      const order = notes.map((f, i) => [f, i]).sort((a, b) => (+a[0][0] || 0) - (+b[0][0] || 0) || a[1] - b[1]);
      for (const [f] of order) block.push(`[${f[0]}] ${f[1]}`);
    }
    if (include_notes && p.x?.length) block.push('', 'Transcription notes:', ...p.x.map(x => `- ${x}`));
    if (include_citations && p.c?.length) block.push('', `Cites: ${p.c.map(c => c[0]).join('; ')}`);
    for (const h of p.h2 || []) block.push('', `**${h.replace(/\n+/g, ' — ')}**`);
    const text = block.join('\n') + '\n';
    if (used + text.length > max_chars && used > 600) { stopped = p.r; break; }
    out.push(text);
    used += text.length + 1;
  }
  if (stopped) out.push(`… stopped at the length limit. Continue with ref "${stopped}" (or a range from it), or raise max_chars.`);
  return out.join('\n');
}

// ---- kisvei_search
function parseQuery(q, mode) {
  const terms = [], not = [];
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
  for (let m; (m = re.exec(q)); ) {
    const neg = (m[1] || m[3]) === '-';
    const raw = m[2] ?? m[4];
    const n = norm(raw, mode).trim();
    if (!n) continue;
    (neg ? not : terms).push({ raw, n, phrase: m[2] != null, hebrew: /^[א-ת]/.test(n) });
  }
  return { terms, not };
}

// Normalized fields of paragraph i, built on first use and kept for the life of the function instance.
function field(t, i, name, mode) {
  const byMode = (t.norm[mode] = t.norm[mode] || {});
  const arr = (byMode[name] = byMode[name] || []);
  let v = arr[i];
  if (v === undefined) {
    const p = t.paras[i];
    v = arr[i] = name === 'hebrew' ? norm(heOf(p), mode) : name === 'english' ? norm(enOf(p), mode)
      : name === 'headings' ? norm(headingsAt(t, i).join(' \n '), mode) : (p.f ? norm(p.f.map(x => x[1]).join(' \n '), mode) : ' ');
  }
  return v;
}

// Hebrew words carry prefixes (ו ה ב כ ל מ ש); a whole-word match allows up to three of them.
const PREFIX = new Set('והבכלמש');
function wordStart(hay, i, hebrew) {
  if (hay[i - 1] === ' ') return true;
  if (!hebrew) return false;
  for (let j = i - 1, k = 0; k < 3 && j > 0 && PREFIX.has(hay[j]); j--, k++) if (hay[j - 1] === ' ') return true;
  return false;
}
function firstAt(hay, term, whole, from = 0) {
  for (let i = hay.indexOf(term.n, from); i >= 0; i = hay.indexOf(term.n, i + 1)) {
    if (!whole || (hay[i + term.n.length] === ' ' && wordStart(hay, i, term.hebrew))) return i;
  }
  return -1;
}
function occurrences(hay, term, whole, cap = 5) {
  let n = 0;
  for (let i = firstAt(hay, term, whole); i >= 0 && n < cap; i = firstAt(hay, term, whole, i + term.n.length)) n++;
  return n;
}

// The phrase pairs (or a window of the text) where the words occur.
function snippet(t, i, terms, fields, mode, whole) {
  const p = t.paras[i];
  const has = s => { const n = norm(s, mode); return terms.some(t => firstAt(n, t, whole) >= 0); };
  const out = [];
  if (p.p && (fields.includes('hebrew') || fields.includes('english'))) {
    for (const [he, en] of p.p) {
      if ((fields.includes('hebrew') && has(he)) || (fields.includes('english') && has(en))) out.push({ he, en });
      if (out.length === 2) break;
    }
    if (out.length) return out;
  }
  const windowOf = text => {
    const map = [];
    const n = norm(text, mode, map);
    let at = -1, len = 0;
    for (const t of terms) { const i = firstAt(n, t, whole); if (i >= 0 && (at < 0 || i < at)) { at = i; len = t.n.length; } }
    if (at < 0) return null;
    const s = map[at] ?? 0, e = (map[Math.min(map.length - 1, at + len - 1)] ?? text.length) + 1;
    const a = Math.max(0, s - 100), b = Math.min(text.length, e + 100);
    return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : '');
  };
  if (!p.p && fields.includes('hebrew') && p.t) { const w = windowOf(p.t); if (w) return [{ he: w }]; }
  if (fields.includes('headings')) for (const h of headingsAt(t, i)) if (has(h)) return [{ heading: clip(h.replace(/\n+/g, ' — '), 240) }];
  if (fields.includes('notes')) for (const f of p.f || []) { const w = windowOf(f[1]); if (w) return [{ note: `[${f[0]}] ${w}` }]; }
  return [];
}

async function search({ query, books: bookNames, fields, spelling, whole_words: whole, offset, limit, response_format }) {
  const { terms, not } = parseQuery(query, spelling);
  if (!terms.length) throw new ToolError('the query has no searchable words.');
  fields = fields?.length ? [...new Set(fields)] : ['hebrew', 'english', 'headings'];
  const { books: chosen, unknown } = await findBooks(bookNames);
  if (unknown.length) throw new ToolError(`no book matches ${unknown.map(u => `"${u}"`).join(', ')}. Use kisvei_list_books for the titles.`);
  const { books } = await catalog();
  const list = chosen || books;
  const texts = await Promise.all(list.map(bookText));
  // Several words: the same words side by side, in order, rank first.
  const together = terms.length > 1 ? { n: norm(terms.map(x => x.raw).join(' '), spelling).trim(), hebrew: terms[0].hebrew } : null;
  const hits = [];
  const perBook = new Map();
  list.forEach((book, bi) => {
    const t = texts[bi];
    for (let i = 0; i < t.paras.length; i++) {
      let score = 0, near = 0, ok = true;
      for (const term of terms) {
        let c = 0;
        for (const name of fields) c += occurrences(field(t, i, name, spelling), term, whole);
        if (!c) { ok = false; break; }
        score += Math.min(c, 5) + (term.phrase ? 3 : 0);
      }
      if (!ok) continue;
      if (not.some(term => fields.some(name => firstAt(field(t, i, name, spelling), term, whole) >= 0))) continue;
      if (together) for (const name of fields) near += occurrences(field(t, i, name, spelling), together, whole, 3);
      if (fields.includes('headings') && terms.every(term => firstAt(field(t, i, 'headings', spelling), term, whole) >= 0)) score += 2;
      hits.push({ book, bi, i, score, near: Math.min(near, 3) });
      perBook.set(book.title, (perBook.get(book.title) || 0) + 1);
    }
  });
  hits.sort((a, b) => b.near - a.near || b.score - a.score || a.book.order - b.book.order || a.i - b.i);
  const page = hits.slice(offset, offset + limit);
  const more = offset + page.length < hits.length;
  const bestSnippet = h => {                                   // where the words stand together, if they do
    const near = h.near ? snippet(texts[h.bi], h.i, [together], fields, spelling, whole) : [];
    return near.length ? near : snippet(texts[h.bi], h.i, terms, fields, spelling, whole);
  };
  const results = page.map(h => {
    const p = texts[h.bi].paras[h.i];
    const sec = h.book.sections[p.s];
    return { ref: p.r, book: h.book.title, section: sec.title, ...(sec.heTitle ? { he_section: sec.heTitle } : {}),
      ...(sec.edition ? { edition: sec.edition } : {}), match: bestSnippet(h), link: readerLink(p.r) };
  });
  if (response_format === 'json') {
    return json({ query, fields, spelling, total: hits.length, offset, count: results.length, has_more: more, next_offset: more ? offset + results.length : null,
      by_book: Object.fromEntries(perBook), results });
  }
  if (!hits.length) {
    return `No paragraphs match ${JSON.stringify(query)} in ${chosen ? chosen.map(b => b.title).join(', ') : 'the library'} (${fields.join(', ')}${spelling === 'loose' ? ', loose spelling' : ''}).`
      + ` Try fewer words, ${spelling === 'exact' ? 'spelling "loose", ' : ''}${fields.includes('notes') ? '' : 'fields including "notes", '}or another spelling.`;
  }
  const lines = [`${hits.length} paragraph${hits.length === 1 ? '' : 's'} match ${JSON.stringify(query)} (${fields.join(', ')}${spelling === 'loose' ? ', loose spelling' : ''}); showing ${offset + 1}–${offset + results.length}, best first.`];
  lines.push(`By book: ${[...perBook].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '');
  results.forEach((r, k) => {
    lines.push(`${offset + k + 1}. ${r.ref} — ${r.section}${r.he_section ? ` · ${r.he_section}` : ''}${r.edition ? ` (${r.edition === 'hebrew' ? 'original Hebrew' : 'study edition'})` : ''}`);
    for (const m of r.match) {
      if (m.heading) lines.push(`   heading: ${m.heading}`);
      if (m.note) lines.push(`   note: ${clip(m.note, 400)}`);
      if (m.he) lines.push(`   ${clip(m.he, 400)}`);
      if (m.en) lines.push(`   ${clip(m.en, 400)}`);
    }
  });
  if (more) lines.push('', `More results: offset ${offset + results.length}.`);
  return lines.join('\n');
}

// ---- kisvei_find_citing_passages
// Hebrew and transliterated names -> the titles used in the citation index.
const SOURCE_ALIASES = {
  Genesis: ['Bereishis', 'Bereshit', 'Bereishit', 'בראשית'], Exodus: ['Shemos', 'Shemot', 'שמות'], Leviticus: ['Vayikra', 'ויקרא'],
  Numbers: ['Bamidbar', 'במדבר'], Deuteronomy: ['Devarim', 'דברים'], Joshua: ['Yehoshua', 'יהושע'], Judges: ['Shoftim', 'Shofetim', 'שופטים'],
  'I Samuel': ['Shmuel I', 'I Shmuel', '1 Samuel', 'Samuel I', 'שמואל א'], 'II Samuel': ['Shmuel II', 'II Shmuel', '2 Samuel', 'Samuel II', 'שמואל ב'],
  'I Kings': ['Melachim I', 'I Melachim', '1 Kings', 'Kings I', 'מלכים א'], 'II Kings': ['Melachim II', 'II Melachim', '2 Kings', 'Kings II', 'מלכים ב'],
  Isaiah: ['Yeshayahu', 'Yeshaya', 'ישעיה', 'ישעיהו'], Jeremiah: ['Yirmiyahu', 'Yirmeyahu', 'Yirmiya', 'ירמיה', 'ירמיהו'], Ezekiel: ['Yechezkel', 'Yechezkiel', 'יחזקאל'],
  Hosea: ['Hoshea', 'הושע'], Joel: ['Yoel', 'יואל'], Amos: ['עמוס'], Obadiah: ['Ovadiah', 'Ovadia', 'עובדיה'], Jonah: ['Yonah', 'יונה'], Micah: ['Michah', 'Mikhah', 'מיכה'],
  Nahum: ['Nachum', 'נחום'], Habakkuk: ['Chavakuk', 'חבקוק'], Zephaniah: ['Tzefaniah', 'Tzefanyah', 'צפניה'], Haggai: ['Chaggai', 'Chagai', 'חגי'], Zechariah: ['Zecharyah', 'Zecharia', 'זכריה'],
  Malachi: ['מלאכי'], Psalms: ['Tehillim', 'Tehilim', 'Psalm', 'תהלים', 'תהילים'], Proverbs: ['Mishlei', 'Mishle', 'משלי'], Job: ['Iyov', 'Iyyov', 'איוב'],
  'Song of Songs': ['Shir HaShirim', 'Shir Hashirim', 'שיר השירים'], Ruth: ['Rus', 'רות'], Lamentations: ['Eichah', 'Eicha', 'Echah', 'איכה'],
  Ecclesiastes: ['Koheles', 'Kohelet', 'Qohelet', 'קהלת'], Esther: ['אסתר'], Daniel: ['דניאל'], Ezra: ['עזרא'], Nehemiah: ['Nechemiah', 'Nechemyah', 'נחמיה'],
  'I Chronicles': ['Divrei HaYamim I', 'I Divrei HaYamim', '1 Chronicles', 'דברי הימים א'], 'II Chronicles': ['Divrei HaYamim II', 'II Divrei HaYamim', '2 Chronicles', 'דברי הימים ב'],
  Berakhot: ['ברכות'], Shabbat: ['שבת'], Eruvin: ['עירובין'], Pesachim: ['פסחים'], Yoma: ['יומא'], Sukkah: ['סוכה'], Beitzah: ['ביצה'], 'Rosh Hashanah': ['ראש השנה'],
  Taanit: ['תענית'], Megillah: ['מגילה'], 'Moed Katan': ['מועד קטן'], Chagigah: ['חגיגה'], Yevamot: ['יבמות'], Ketubot: ['כתובות'], Nedarim: ['נדרים'], Nazir: ['נזיר'],
  Sotah: ['סוטה'], Gittin: ['גיטין'], Kiddushin: ['קידושין'], 'Bava Kamma': ['Bava Kama', 'בבא קמא'], 'Bava Metzia': ['בבא מציעא'], 'Bava Batra': ['Bava Basra', 'בבא בתרא'],
  Sanhedrin: ['סנהדרין'], Makkot: ['מכות'], Shevuot: ['שבועות'], 'Avodah Zarah': ['עבודה זרה'], Horayot: ['הוריות'], Zevachim: ['זבחים'], Menachot: ['מנחות'],
  Chullin: ['חולין'], Bekhorot: ['בכורות'], Arakhin: ['ערכין'], Temurah: ['תמורה'], Keritot: ['כריתות'], Meilah: ['מעילה'], Tamid: ['תמיד'], Niddah: ['נדה'],
  'Pirkei Avot': ['Avos', 'Avot', 'Pirkei Avos', 'Pirkei Avoth', 'אבות', 'פרקי אבות'],
  'Bereshit Rabbah': ['Genesis Rabbah', 'בראשית רבה'], 'Shemot Rabbah': ['Exodus Rabbah', 'שמות רבה'], 'Vayikra Rabbah': ['Leviticus Rabbah', 'ויקרא רבה'],
  'Bamidbar Rabbah': ['Numbers Rabbah', 'במדבר רבה'], 'Devarim Rabbah': ['Deuteronomy Rabbah', 'דברים רבה'], 'Kohelet Rabbah': ['Koheles Rabbah', 'קהלת רבה'],
  'Shir HaShirim Rabbah': ['Song of Songs Rabbah', 'שיר השירים רבה'], 'Eichah Rabbah': ['Lamentations Rabbah', 'איכה רבה'], 'Ruth Rabbah': ['Rus Rabbah', 'רות רבה'],
  'Midrash Tehillim': ['Shocher Tov', 'מדרש תהלים'], 'Tikkunei Zohar': ['Tikunei Zohar', 'Tikkunim', 'תיקוני זהר'], 'Zohar Chadash': ['זהר חדש'],
  'Mishneh Torah, Repentance': ['Rambam Hilchos Teshuvah', 'Rambam Hilchot Teshuvah', 'Hilchos Teshuvah', 'Hilchot Teshuvah'],
  'Mishneh Torah, Foundations of the Torah': ['Rambam Hilchos Yesodei HaTorah', 'Hilchos Yesodei HaTorah', 'Hilchot Yesodei HaTorah'],
  'Mishneh Torah, Human Dispositions': ['Rambam Hilchos Deos', 'Hilchos Deos', 'Hilchot Deot'],
  'Mishneh Torah, Torah Study': ['Rambam Hilchos Talmud Torah', 'Hilchos Talmud Torah', 'Hilchot Talmud Torah'],
  'Mishneh Torah, Kings and Wars': ['Rambam Hilchos Melachim', 'Hilchos Melachim', 'Hilchot Melakhim'],
  'Mishneh Torah, Prayer and the Priestly Blessing': ['Rambam Hilchos Tefillah', 'Hilchos Tefillah', 'Hilchot Tefillah'],
  'Mishneh Torah, Forbidden Intercourse': ['Rambam Hilchos Issurei Biah', 'Hilchos Issurei Biah', 'Hilchot Issurei Biah'],
  'Mishneh Torah, Blessings': ['Rambam Hilchos Berachos', 'Hilchos Berachos', 'Hilchot Berakhot'],
  'Mishneh Torah, Divorce': ['Rambam Hilchos Gerushin', 'Hilchos Gerushin', 'Hilchot Gerushin'],
  'Shulchan Arukh, Orach Chayim': ['Orach Chaim', 'Orach Chayim', 'OC', 'שולחן ערוך אורח חיים'], 'Shulchan Arukh, Yoreh De\'ah': ['Yoreh Deah', 'YD'],
  'Shulchan Arukh, Even HaEzer': ['Even HaEzer', 'Even Haezer', 'EH'], 'Shulchan Arukh, Choshen Mishpat': ['Choshen Mishpat', 'CM'],
};
const PREFIX_ALIASES = [[/^(yerushalmi|talmud yerushalmi|jt|y\.)\s+/i, 'Jerusalem Talmud '], [/^(mishna|mishnah|m\.)\s+/i, 'Mishnah '], [/^(bavli|b\.)\s+/i, '']];

let CITED = null;
async function citedIndex() {
  const raw = await load('cited.json');
  if (CITED?.raw === raw) return CITED;
  const titles = new Map();                 // title -> [keys]
  for (const k of Object.keys(raw)) {
    const m = k.match(/^(.*?)(?:\s+(\d[\dab:.\-–]*))?$/);
    const title = m[1];
    const list = titles.get(title) || [];
    list.push(k);
    titles.set(title, list);
  }
  const keyOf = new Map();                  // skeleton or Hebrew key -> title
  const add = (alias, title) => { const k = /[א-ת]/.test(alias) ? heKey(alias) : skel(alias); if (k && !keyOf.has(k)) keyOf.set(k, title); };
  for (const t of titles.keys()) add(t, t);
  for (const [t, list] of Object.entries(SOURCE_ALIASES)) for (const a of list) add(a, t);
  CITED = { raw, titles, keyOf };
  return CITED;
}

async function resolveSource(input) {
  const idx = await citedIndex();
  let s = String(input).trim().replace(/\s+/g, ' ').replace(/(\d)\s+([ab])\b/gi, '$1$2');
  for (const [re, rep] of PREFIX_ALIASES) s = s.replace(re, rep);
  // A range of verses or segments: "Genesis 1:1-5" (the last number only).
  let to = null;
  const rm = s.match(/^(.*\d)\s*[-–—]\s*(\d+)$/);
  if (rm) { s = rm[1]; to = +rm[2]; }
  // Split off the address: digits with a/b, colons, dots, e.g. "6b", "1:1", "88".
  const m = s.match(/^(.*?)[\s,]*((?:\d+[ab]?)(?:[:.]\d+[ab]?)*)?$/i);
  let name = (m?.[1] || s).replace(/[,\s]+$/, ''), addr = m?.[2] ? m[2].replace(/\./g, ':').toLowerCase() : '';
  if (to != null && !/(^|:)\d+$/.test(addr)) to = null;
  let title = idx.titles.has(name) ? name : null;
  if (!title) {
    const k = /[א-ת]/.test(name) ? heKey(name) : skel(name);
    title = idx.keyOf.get(k) || null;
    if (!title && /[א-ת]/.test(name)) {                       // Hebrew name with a Hebrew-letter address is not supported
      return { error: `write the address in digits, e.g. "${name} 6b" or "${name} 1:1".` };
    }
  }
  if (!title) {
    const k = skel(name);
    const near = [...idx.titles.keys()].filter(t => k && (skel(t).includes(k) || k.includes(skel(t)))).slice(0, 12);
    return { error: `no cited source is named "${name}".`, suggest: near };
  }
  return { title, addr, to };
}

// Does a cited key fall under the requested address? "Berakhot 6" takes in 6a, 6b and their segments;
// "Genesis 1" takes in 1:1, 1:2 …; "Genesis 1:1-5" takes in verses 1 to 5.
function underAddress(key, title, addr, to) {
  if (!addr) return true;
  const rest = key.slice(title.length).trim();
  if (to == null) {
    if (rest === addr) return true;
    if (!rest.startsWith(addr)) return false;
    const next = rest[addr.length];
    return next === ':' || ((next === 'a' || next === 'b') && /\d$/.test(addr));
  }
  const head = addr.replace(/\d+$/, ''), from = +addr.match(/\d+$/)[0];
  if (!rest.startsWith(head)) return false;
  const n = rest.slice(head.length).match(/^(\d+)(?=$|:)/);
  return !!n && +n[1] >= from && +n[1] <= to;
}

// The words around a citation: the phrase that cites it, or the note that does.
function citationPreview(p, cited) {
  const at = p.a?.[cited];
  if (at && at[0] === 'n') {
    const note = (p.f || []).find(f => String(f[0]) === String(at[1]));
    if (note) return `note [${note[0]}]: ${clip(note[1].replace(/\s+/g, ' '), 260)}`;
  }
  if (at && p.p && p.p[at[0]]) { const [he, en] = p.p[at[0]]; return `${he} — ${en}`; }
  if (at && p.t) {
    const a = Math.max(0, at[2] - 120), b = Math.min(p.t.length, at[2] + 140);
    return (a ? '…' : '') + p.t.slice(a, b).replace(/\s+/g, ' ').trim() + (b < p.t.length ? '…' : '');
  }
  return p.p ? p.p.slice(0, 2).map(([he, en]) => `${he} — ${en}`).join(' / ') : (p.t || '');
}

async function findCiting({ source, books: bookNames, offset, limit, response_format }) {
  const idx = await citedIndex();
  const r = await resolveSource(source);
  if (r.error) throw new ToolError(r.error + (r.suggest?.length ? ` Similar: ${r.suggest.join('; ')}.` : ''));
  const { books: only, unknown } = await findBooks(bookNames);
  if (unknown.length) throw new ToolError(`no book matches ${unknown.map(u => `"${u}"`).join(', ')}.`);
  const prefix = (r.addr ? `${r.title} ${r.addr}` : r.title) + (r.to != null ? `-${r.to}` : '');
  const keys = (idx.titles.get(r.title) || []).filter(k => underAddress(k, r.title, r.addr, r.to));
  const naturally = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  keys.sort(naturally);
  const { books, bySlug } = await catalog();
  const pairs = [];
  for (const k of keys) for (const a of idx.raw[k]) pairs.push([k, a]);
  // Which book is each citing passage in? Its ref starts with the book title.
  const byTitle = [...books].sort((x, y) => y.title.length - x.title.length);
  const located = pairs.map(([k, a]) => ({ cited: k, ref: a, book: byTitle.find(b => a.startsWith(b.title)) || null })).filter(x => x.book && (!only || only.includes(x.book)));
  const page = located.slice(offset, offset + limit);
  const more = offset + page.length < located.length;
  for (const x of page) {
    const t = await bookText(x.book);
    const ids = t.byRef.get(x.ref) || [];
    const p = ids.map(i => t.paras[i]).find(q => x.book.sections[q.s].il) || t.paras[ids[0]];
    if (p) {
      const sec = x.book.sections[p.s];
      x.section = sec.title + (sec.heTitle ? ` · ${sec.heTitle}` : '');
      x.preview = clip(citationPreview(p, x.cited).replace(/\s+/g, ' '), 320);
    }
  }
  if (response_format === 'json') {
    return json({ source: prefix, total: located.length, offset, count: page.length, has_more: more, next_offset: more ? offset + page.length : null,
      passages: page.map(x => ({ cited: x.cited, ref: x.ref, book: x.book.title, section: x.section || null, preview: x.preview || null, link: readerLink(x.ref) })) });
  }
  if (!located.length) return `No passage in ${only ? only.map(b => b.title).join(', ') : 'the library'} cites ${prefix}${keys.length ? '' : ` (the citation index has nothing under "${prefix}")`}.`;
  const lines = [`${located.length} passage${located.length === 1 ? '' : 's'} cite ${prefix}${only ? ` in ${only.map(b => b.title).join(', ')}` : ''}${located.length > page.length ? `; showing ${offset + 1}–${offset + page.length}` : ''}.`, ''];
  let last = null;
  for (const x of page) {
    if (x.cited !== last) { lines.push(`## ${x.cited}`); last = x.cited; }
    lines.push(`- ${x.ref}${x.section ? ` — ${x.section}` : ''}`);
    if (x.preview) lines.push(`  ${x.preview}`);
  }
  if (more) lines.push('', `More: offset ${offset + page.length}.`);
  lines.push('', 'Citations are those marked in the library\'s texts and notes; read a passage with kisvei_get_text.');
  return lines.join('\n');
}

// ---- kisvei_get_cited_sources
async function getCited({ ref, edition, response_format }) {
  const r = await resolveRef(ref, edition);
  if (r.error) throw new ToolError(r.error + (r.suggest?.length ? ` Try: ${r.suggest.slice(0, 15).join('; ')}.` : ''));
  const t = await bookText(r.book);
  let paras = t.paras.slice(r.sec.first, r.sec.first + r.sec.count);
  if (r.from != null) paras = paras.filter(p => { const n = +p.r.match(/\d+$/)[0]; return n >= r.from && n <= r.to; });
  const rows = paras.map(p => ({ ref: p.r, cites: (p.c || []).map(([source, category]) => ({ source, category })) }));
  const total = rows.reduce((n, x) => n + x.cites.length, 0);
  if (response_format === 'json') return json({ ref: r.from != null ? paras.map(p => p.r).join(', ') : r.sec.ref, book: r.book.title, total, paragraphs: rows });
  if (!total) return `No citations are marked in ${r.from != null ? ref : r.sec.ref}.`;
  const lines = [`# Sources cited in ${r.from != null ? ref : r.sec.ref} (${total})`, ''];
  for (const x of rows) {
    if (!x.cites.length) continue;
    lines.push(`- ${x.ref}: ${x.cites.map(c => `${c.source}${c.category ? ` (${c.category})` : ''}`).join('; ')}`);
  }
  return lines.join('\n');
}

// ---- kisvei_find_parallels (data from scripts/build-parallels.mjs)
const readerSlug = slug => (slug === 'mei-hashiloach' ? 'mei-ha-shiloach' : slug);
async function findParallels({ ref, school, limit, response_format }) {
  const r = await resolveRef(ref, undefined);
  if (r.error) throw new ToolError(r.error + (r.suggest?.length ? ` Try: ${r.suggest.slice(0, 15).join('; ')}.` : ''));
  const t = await bookText(r.book);
  let paras = t.paras.slice(r.sec.first, r.sec.first + r.sec.count);
  if (r.from != null) paras = paras.filter(p => { const n = +p.r.match(/\d+$/)[0]; return n >= r.from && n <= r.to; });
  let data, words;
  try { [data, words] = await Promise.all([load(`parallels/${readerSlug(r.book.slug)}.json`), load('parallels/words.json')]); }
  catch { data = {}; words = {}; }
  const { books } = await catalog();
  const byTitle = [...books].sort((x, y) => y.title.length - x.title.length);
  const schoolOf = x => { const b = byTitle.find(b => x.startsWith(b.title)); return b && b.group === 'Izhbitz' ? 'Ishbitz-Radzin' : 'Kisvei Rav Tzadok'; };
  const best = new Map(), quoted = new Set();
  for (const p of paras) {
    const e = data[p.r];
    if (!e) continue;
    for (const q of e.q || []) quoted.add(q);
    for (const [other, score, sources, ids] of e.p || []) {
      const prev = best.get(other);
      if (!prev || prev.score < score) best.set(other, { ref: other, from: p.r, score, school: schoolOf(other), shared: [...sources, ...ids.map(id => words[id] ? `the Biblical word ${words[id].w} (${words[id].v.join('; ')})` : '').filter(Boolean)] });
    }
  }
  // Blend: the machine-learned model (trained on the Mafteach's parallels) first, the Mafteach's own index lines next,
  // shared citations last. Library parallels are compared by section.
  const base = x => x.replace(/:\d+$/, '');
  const self = r.sec.ref, merged = new Map();
  const get = ref => { const k = base(ref); let m = merged.get(k); if (!m) { m = { ref: k, ml: 0, maf: 0, cit: 0, shared: [], why: [] }; merged.set(k, m); } return m; };
  const maxCit = Math.max(1e-9, ...[...best.values()].map(x => x.score));
  for (const x of best.values()) { const m = get(x.ref); if (x.score / maxCit > m.cit) { m.cit = x.score / maxCit; m.shared = x.shared; m.from = x.from; } }
  for (const list of await libSection('ml-parallels', self)) for (const [other, prob, tier, srcs, words] of list) {
    const m = get(other); if (prob > m.ml) { m.ml = prob; m.tier = tier; m.mlShared = [...(srcs || []), ...(words || []).map(w => `the rare word ${w}`)]; }
  }
  const mafLists = await libSection('mafteach', self);
  const maxMaf = Math.max(1e-9, ...mafLists.flatMap(e => (e.p || []).map(x => x[1])));
  for (const e of mafLists) for (const [other, w, whys] of e.p || []) {
    const m = get(other); if (w / maxMaf > m.maf) { m.maf = w / maxMaf; m.why = (whys || []).slice(0, 2).map(y => y[0] === 'line' ? `the Mafteach lists both under "${y[4] || y[3] || y[1]}"` : y[0] === 'quote' ? `both quote ${y[2]}` : y[0] === 'topic' || y[0] === 'subtopic' ? `the Mafteach topic ${y[2] || y[1]}` : `both draw on ${y[1]}`); }
  }
  merged.delete(self);
  for (const m of merged.values()) {
    m.score = Math.round((0.55 * m.ml + 0.6 * m.maf + 0.02 * m.cit + (m.ml && m.maf ? 0.1 : 0)) * 1000) / 1000;   // weights tuned on 11 reviewed maamarim (Chayei Sarah): shared citations alone mostly found weak parallels
    m.school = schoolOf(m.ref);
    m.shared = [...m.why, ...(m.mlShared || []).slice(0, 4), ...m.shared.filter(x => !(m.mlShared || []).includes(x))].slice(0, 7);
  }
  const outsideOnly = school === 'outside' || OUTSIDE.includes(school);
  let list = outsideOnly ? [] : [...merged.values()].filter(x => school === 'all' || x.school === school).sort((a, b) => b.score - a.score);
  // beyond the library: [sefaria ref, Hebrew title, genre, probability, tier, [shared rare words]]
  const outside = [], seenOut = new Set();
  if (school === 'all' || outsideOnly) for (const l of await libSection('genre-parallels', self)) for (const [oref, heTitle, genre, prob, tier, words, why] of l) {
    if (seenOut.has(oref) || (OUTSIDE.includes(school) && genre !== school)) continue;
    seenOut.add(oref); outside.push({ ref: oref, title_he: heTitle, genre, score: prob, tier, ...(why ? { why } : {}), shared: (words || []).map(w => `the rare word ${w}`), link: `https://www.sefaria.org/${encodeURIComponent(oref.replace(/ /g, '_'))}` });
  }
  const TO = { reviewed: -1, strong: 0, likely: 1, possible: 2 };
  outside.sort((a, b) => TO[a.tier] - TO[b.tier] || b.score - a.score);
  const total = list.length;
  list = list.slice(0, limit);
  for (const x of list) {
    const b = byTitle.find(b => x.ref.startsWith(b.title));
    if (!b) continue;
    const bt = await bookText(b);
    const ids = bt.byRef.get(x.ref) || bt.byRef.get(x.ref + ':1') || [];
    const p = ids.map(i => bt.paras[i]).find(q => b.sections[q.s].il) || bt.paras[ids[0]];
    if (p) { const sec = b.sections[p.s]; x.section = sec.title + (sec.heTitle ? ` · ${sec.heTitle}` : ''); x.preview = clip((p.p ? p.p.slice(0, 2).map(([he, en]) => `${he} — ${en}`).join(' / ') : (p.t || '')).replace(/\s+/g, ' '), 260); }
  }
  const label = r.from != null ? (r.from === r.to ? paras[0]?.r : `${paras[0]?.r}–${r.to}`) : r.sec.ref;
  const outShow = outside.filter(x => outsideOnly || x.tier !== 'possible').slice(0, outsideOnly ? limit : 8);
  if (response_format === 'json') return json({ ref: label, total, quoted_verses: [...quoted], parallels: list.map(({ ml, maf, cit, why, mlShared, ...x }) => ({ ...x, signals: { model: ml, mafteach: Math.round(maf * 100) / 100, citations: Math.round(cit * 100) / 100 }, link: readerLink(x.ref) })), outside: outShow });
  if (!total && !quoted.size && !outShow.length) return `No parallels are recorded for ${label}. Try kisvei_search with its key words.`;
  const lines = [`# Parallels to ${label}`];
  if (!outsideOnly) lines.push(`${total} passage${total === 1 ? '' : 's'} in the library${school !== 'all' ? ` (${school})` : ''}; showing ${list.length}, strongest first. Why each is a parallel is given; read both before relying on it.`);
  if (quoted.size) lines.push(`Verses it quotes without naming them: ${[...quoted].join('; ')}.`);
  lines.push('');
  for (const x of list) {
    lines.push(`- ${x.ref}${x.section ? ` — ${x.section}` : ''} [${x.school}${x.tier ? `, ${x.tier}` : ''}]`, `  Why: ${x.shared.join(' · ') || 'shared sources'}`);
    if (x.preview) lines.push(`  ${x.preview}`);
  }
  if (outShow.length) {
    lines.push('', `## Beyond the library: Chassidus, Kabbalah, Machshava, Mussar`, '"Checked by a reader" means both passages were read and the link confirmed; the rest were found by wording and rare shared words: read both before relying on one.');
    for (const x of outShow) lines.push(`- ${x.ref}${x.title_he ? ` (${x.title_he})` : ''} [${x.genre}, ${x.tier === 'reviewed' ? 'checked by a reader' : x.tier}] — ${x.why || `shares ${x.shared.join(', ') || 'wording'}`} — ${x.link}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- HaMafteach HaShalem
//
// The complete index to R. Tzadok's works (R' Chaim Hirsch): topics, people and sources, each with the passages
// where R. Tzadok discusses them. Data: mcp-data/mafteach/ (scripts/build-mafteach-index.mjs). Queries may be
// Hebrew, English, or Ashkenazi/Sefardi transliteration; every term carries all three.

const fileKey = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const MAF_PART = { '1-2': 'א-ב', '3': 'ג', '4': 'ד', '5': 'ה-ו', '7': 'ז' };
const MAF_CORPUS = { all: null, 'rav-tzadok': 'rt', 'pri-tzadik': 'pt' };
const MAF_CORPUS_SCHEMA = {
  type: 'string', enum: ['all', 'rav-tzadok', 'pri-tzadik'], default: 'all',
  description: 'all; rav-tzadok = his sefarim other than Pri Tzaddik (Mafteach parts 1-3); pri-tzadik = Pri Tzaddik (parts 4-7).',
};
const MAF_CODES = { 'רל': 'Resisei Layla', 'צה': 'Tzidkat HaTzadik', 'מח': 'Machshavot Charutz', 'תה': 'Takanat HaShavin' };
const MAF_STOP = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'to', 'rav', 'tzadok', 'r']);
const RABBAH_EN = {
  'Bereshit Rabbah': ['Bereishis Rabbah', 'Genesis Rabbah', 'Breishis Rabba', 'בראשית רבה'], 'Shemot Rabbah': ['Shemos Rabbah', 'Exodus Rabbah', 'שמות רבה'],
  'Vayikra Rabbah': ['Leviticus Rabbah', 'ויקרא רבה'], 'Bamidbar Rabbah': ['Numbers Rabbah', 'במדבר רבה'], 'Devarim Rabbah': ['Deuteronomy Rabbah', 'דברים רבה'],
  'Shir HaShirim Rabbah': ['Song of Songs Rabbah', 'Shir Hashirim Rabba', 'שיר השירים רבה'], 'Ruth Rabbah': ['Rus Rabbah', 'רות רבה'],
  'Eichah Rabbah': ['Lamentations Rabbah', 'Eicha Rabba', 'איכה רבה'], 'Kohelet Rabbah': ['Koheles Rabbah', 'Ecclesiastes Rabbah', 'קהלת רבה'],
  'Esther Rabbah': ['Esther Rabba', 'אסתר רבה'],
};
const gematria = s => [...String(s).replace(/[^א-ת]/g, '')].reduce((n, c) => n + ({ א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 }[c] || 0), 0);
const latinKeys = s => {                        // whole-phrase skeleton, plus the same without stop words
  const words = String(s).toLowerCase().split(/[^a-z']+/).filter(Boolean);
  const all = skel(words.join(' ')), core = skel(words.filter(w => !MAF_STOP.has(w)).join(' '));
  return [...new Set([all, core].filter(Boolean))];
};

// Vowel-aware key for transliterations: Ashkenazi and Sefardi spellings meet, but emunah stays apart from moon.
// kamatz o/a, final h, doubled letters, apostrophes, s/t for sav, kh/ch/h for ches, ei/ai/ay, tz/ts.
function translitKey(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z']+/).filter(w => w && !MAF_STOP.has(w)).map(w => w.replace(/'/g, '')
      .replace(/kh/g, 'ch').replace(/ck/g, 'k').replace(/c(?!h)/g, 'k').replace(/ph/g, 'f').replace(/ts/g, 'tz')
      .replace(/th/g, 't').replace(/(?<=.)s(?!h)/g, 't').replace(/(ei|ai|ay|ey)/g, 'e').replace(/oi|oy/g, 'o')
      .replace(/o/g, 'a').replace(/u/g, 'u').replace(/y(?=[^aeiou]|$)/g, 'i').replace(/([aeiou])h$/, '$1').replace(/h$/, '')
      .replace(/(.)\1+/g, '$1')).join('');
}

let MAF = null;
async function mafteach() {
  const g = await load('mafteach/glossary.json');
  if (MAF?.raw === g) return MAF;
  const keys = new Map();                       // key -> [{t, w}]
  const add = (k, t, w) => {
    if (!k || k.length < 2) return;
    const l = keys.get(k) || [];
    const prev = l.find(x => x.t === t);
    if (prev) prev.w = Math.max(prev.w, w); else l.push({ t, w });
    keys.set(k, l);
  };
  const addAlias = (a, t, w) => {
    if (!a) return;
    if (/[א-ת]/.test(a)) { add('h:' + heKey(a), t, w); return; }
    for (const k of latinKeys(a)) add('l:' + k, t, w);
    add('v:' + translitKey(a), t, w);
  };
  for (const t of g.terms) {
    addAlias(t.he, t, 3); for (const h of t.he_raw || []) addAlias(h, t, 1);
    addAlias(t.en, t, 3);
    for (const a of [...(t.ashk || []), ...(t.sef || [])]) addAlias(a, t, 2.5);
    for (const a of t.en_alt || []) addAlias(a, t, 2);
  }
  // Source names: Tanach, Shas, Midrash Rabbah, and the source headings without numeric addresses (Zohar, Midrash ...).
  const sourceNames = new Map();                // key -> {title, kind, term?}
  const addSource = (a, v) => { const k = /[א-ת]/.test(a) ? 'h:' + heKey(a) : 'l:' + skel(a); if (k.length > 3 && !sourceNames.has(k)) sourceNames.set(k, v); };
  for (const b of g.books) for (const a of [b.en, b.he, ...(b.he_alt || []), ...(b.variants || [])]) addSource(a, { title: b.en, kind: b.kind });
  for (const [en, alts] of Object.entries(RABBAH_EN)) for (const a of [en, ...alts]) addSource(a, { title: en, kind: 'rabbah' });
  for (const t of g.terms.filter(t => t.kind === 'source_book')) for (const a of [t.he, ...(t.he_raw || []), t.en, ...(t.en_alt || []), ...(t.ashk || []), ...(t.sef || [])]) {
    if (!a) continue;
    for (const v of [a, ...String(a).split(/\s*\/\s*/), String(a).replace(/^(midrash|sefer|the)\s+/i, '')]) if (v) addSource(v, { title: t.he, kind: 'named', term: t });
  }
  const passageKeys = new Map(Object.keys(g.passages).map(p => [refKey(p), p]));
  MAF = { raw: g, keys, sourceNames, passageKeys, byId: new Map(g.terms.map(t => [t.id, t])) };
  return MAF;
}

// Index headings matching a query in Hebrew, English or transliteration, best first.
function mafFindTerms(M, query, kinds = ['topic']) {
  const q = String(query).trim();
  const scores = new Map();
  const bump = (t, s) => { if (kinds.includes(t.kind)) scores.set(t, Math.max(scores.get(t) || 0, s)); };
  if (/[א-ת]/.test(q)) {
    const k = heKey(q);
    const variants = [k, k.replace(/^[והבלמש]/, ''), k.replace(/^ה/, '')].filter(x => x.length >= 2);
    for (const v of variants) for (const { t, w } of M.keys.get('h:' + v) || []) bump(t, 100 + w * 10 - (v === k ? 0 : 5));
    if (k.length >= 2) for (const [key, l] of M.keys) {
      if (!key.startsWith('h:')) continue;
      const hk = key.slice(2);
      if (hk.includes(k) || (k.length >= 4 && k.includes(hk) && hk.length >= 3)) for (const { t, w } of l) bump(t, (hk.startsWith(k) ? 60 : 40) + w);
    }
  } else {
    const qk = latinKeys(q), qwords = wordSkels(q).filter((w, i, a) => w && !MAF_STOP.has(q.toLowerCase().split(/[^a-z']+/).filter(Boolean)[i]));
    for (const { t, w } of M.keys.get('v:' + translitKey(q)) || []) bump(t, 160 + w * 10);
    for (const k of qk) for (const { t, w } of M.keys.get('l:' + k) || []) bump(t, 100 + w * 10);
    for (const t of M.raw.terms) {
      if (!kinds.includes(t.kind)) continue;
      for (const a of [t.en, ...(t.en_alt || []), ...(t.ashk || []), ...(t.sef || [])]) {
        if (!a) continue;
        if (qwords.length && wordsIn(qwords, a)) { bump(t, qwords.length === wordSkels(a).length ? 90 : 55); continue; }
        const ak = skel(a);
        for (const k of qk) if (k.length >= 4 && ak.includes(k)) bump(t, 35);
      }
    }
  }
  return [...scores].sort((a, b) => b[1] - a[1] || b[0].n - a[0].n).map(([t, s]) => ({ t, s }));
}

const mafTermLabel = t => t ? `${t.he}${t.en ? ` — ${t.en}` : ''}` : '';
function mafRefText(r, corpus) {
  const [label, kref, bookEn, flags = ''] = r.length === 3 && /^[*?~]+$/.test(r[2] || '') ? [r[0], r[1], null, r[2]] : r;
  const marks = (flags.includes('*') ? ' (discussed at length)' : '') + (flags.includes('?') ? ' (OCR uncertain)' : '') + (flags.includes('~') ? ' (OCR-corrected)' : '');
  if (kref) return `${kref}${marks}`;
  if (corpus === 'rt' && bookEn) {
    const loc = String(label).replace(/^[א-ת]{2}-/, '');
    return `${bookEn} ${loc}${/^\d/.test(loc) ? ' (page)' : ''}${marks}`;
  }
  return `${label}${marks}`;
}
const mafWhere = e => `Mafteach part ${MAF_PART[e.v] || e.v}, scan p. ${e.p}`;
function mafEntryLine(M, e, { topic = false, source = true } = {}) {
  const parts = [];
  if (topic && e.T != null) parts.push(`[${mafTermLabel(M.byId.get(e.T))}${e.U != null ? ` › ${M.byId.get(e.U)?.he || ''}` : ''}]`);
  else if (topic && e.Th) parts.push(`[${e.Th}]`);
  if (source && e.x === 's') parts.push(`[${e.k || [e.b, e.ch, e.vs].filter(Boolean).join(' ')}]`);
  parts.push(e.t);
  if (e.e) parts.push(`(${e.e})`);
  const refs = e.r.map(r => mafRefText(r, e.c)).join('; ');
  return `- ${parts.join(' ')} → ${refs || '(no reference legible)'}  _(${mafWhere(e)}${e.nr > 1 ? `; ${e.nr} refs in all` : ''})_`;
}
function mafJson(M, e) {
  return {
    id: e.id, part: MAF_PART[e.v], scan_page: e.p, index: e.x === 't' ? 'topics' : 'sources', corpus: e.c === 'pt' ? 'Pri Tzaddik' : 'Rav Tzadok sefarim',
    topic: e.T != null ? { he: M.byId.get(e.T)?.he, en: M.byId.get(e.T)?.en } : (e.Th || undefined),
    subtopic: e.U != null ? { he: M.byId.get(e.U)?.he, en: M.byId.get(e.U)?.en } : (e.Uh || undefined),
    source: e.x === 's' ? { key: e.k || null, book: e.b || null, chapter: e.ch || null, verse: e.vs || null } : undefined,
    text: e.t, text_en: e.e || undefined, refs: e.r.map(r => ({ label: r[0], ref: r[1] || null, text: mafRefText(r, e.c) })),
  };
}
const mafCorpusFilter = (list, corpus) => (MAF_CORPUS[corpus] ? list.filter(e => e.c === MAF_CORPUS[corpus]) : list);
async function mafShard(rel) { try { return await load(`mafteach/${rel}`); } catch { return []; } }
function mafPage(list, offset, limit) { return { total: list.length, page: list.slice(offset, offset + limit), more: offset + limit < list.length ? offset + limit : null }; }

// ---- mafteach_find_topic
async function mafFindTopic({ query, corpus, offset, limit, response_format }) {
  const M = await mafteach();
  const found = mafFindTerms(M, query, ['topic']).filter(x => x.t.n > 0);
  if (!found.length) throw new ToolError(`no Mafteach heading matches "${query}". Try a synonym, the Hebrew term, or mafteach_search for words inside entries.`);
  const best = found[0].t;
  const entries = mafCorpusFilter(await mafShard(`topic/${best.id}.json`), corpus);
  const { total, page, more } = mafPage(entries, offset, limit);
  const others = found.slice(1, 12).map(x => x.t);
  if (response_format === 'json') {
    return json({ topic: { he: best.he, en: best.en, also: best.en_alt, ashkenazi: best.ashk, sefardi: best.sef, type: best.type, entries: best.n },
      total, offset, next_offset: more, entries: page.map(e => mafJson(M, e)),
      other_matches: others.map(t => ({ he: t.he, en: t.en, entries: t.n })) });
  }
  const out = [`# ${best.he} — ${best.en}`,
    `Also: ${[...(best.ashk || []), ...(best.sef || [])].filter((v, i, a) => a.indexOf(v) === i).join(', ')}${best.en_alt?.length ? ` · ${best.en_alt.join(', ')}` : ''}`,
    `HaMafteach HaShalem: ${total} entr${total === 1 ? 'y' : 'ies'}${corpus !== 'all' ? ` (${corpus})` : ''}; showing ${total ? offset + 1 : 0}–${offset + page.length}. In the entry text " - " stands for the heading word itself.`, ''];
  let sub = undefined;
  for (const e of page) {
    if (e.U !== sub) { sub = e.U; if (sub != null) out.push(`## ${mafTermLabel(M.byId.get(sub))}`); }
    out.push(mafEntryLine(M, e));
  }
  if (more != null) out.push('', `More: offset ${more}.`);
  if (others.length) out.push('', `Other matching headings: ${others.map(t => `${t.he} (${t.en}, ${t.n})`).join('; ')}.`);
  out.push('', 'Refs in Library form open with kisvei_get_text. Index entries are OCR\'d from the printed Mafteach: check the passage before citing.');
  return out.join('\n');
}

// The Zohar by volume and daf, as the corrected part ז keys it: "Zohar I 128b", "Zohar 2 52b", "זהר ח"ג רנו ב", "זוהר חלק א קכח."
const ZOHAR_RE = /^(?:zohar|zohar hakadosh|זהר|זוהר)\s*(?:vol(?:ume)?\.?\s*|part\s*|חלק\s*|ח['׳"״]?)?\s*(III|II|I|3|2|1|[אבג])['׳"״]?(?=\s|$|,)\s*,?\s*(.*)$/i;
function zoharVolume(s) {
  const m = String(s).trim().match(ZOHAR_RE);
  if (!m) return null;
  const v = { I: 1, II: 2, III: 3, 1: 1, 2: 2, 3: 3, 'א': 1, 'ב': 2, 'ג': 3 }[m[1].toUpperCase()] || { 'א': 1, 'ב': 2, 'ג': 3 }[m[1]];
  return v ? { title: `Zohar ${'I'.repeat(v)}`, rest: m[2].trim() } : null;
}

// Split "Bereishis 2:7", "Berachos 6b", "שבת פח ב", "Zohar Bereshit" into a known source name and an address.
// An address after a source name: digits "2:7", "88b", "6", or Hebrew numerals "ב ז", "פח ב"; '' for none, null if not an address.
function parseAddr(rest, kind) {
  if (!rest) return '';
  const d = rest.match(/^(\d+)\s*([ab]|[:.]\s*(\d+))?\s*$/i);
  if (d) return d[3] ? `${d[1]}:${d[3]}` : d[2] && /[ab]/i.test(d[2]) ? `${d[1]}${d[2].toLowerCase()}` : d[1];
  if (!/^[א-ת"'׳״\s:.,]+$/.test(rest)) return null;
  const tok = rest.replace(/[:.,]/g, ' ').split(/\s+/).filter(Boolean);
  const a = gematria(tok[0]);
  if (kind === 'shas' && tok[1] && /^(ע"?[אב]|[אב]|עמוד [אב])$/.test(tok.slice(1).join(' ').replace(/['׳״]/g, '"'))) return `${a}${/ב/.test(tok.slice(1).join(' ')) ? 'b' : 'a'}`;
  if (kind === 'shas' && !tok[1] && /[.:]\s*$/.test(rest)) return `${a}${/:\s*$/.test(rest) ? 'b' : 'a'}`;
  return tok[1] ? `${a}:${gematria(tok[1])}` : String(a);
}

function mafParseSource(M, input) {
  let s = String(input).trim().replace(/\s+/g, ' ').replace(/^(the\s+)?(book of\s+)?/i, '');
  let jt = false;
  if (/^(yerushalmi|jerusalem talmud|talmud yerushalmi|ירושלמי)\s+/i.test(s)) { jt = true; s = s.replace(/^(yerushalmi|jerusalem talmud|talmud yerushalmi|ירושלמי)\s+/i, ''); }
  s = s.replace(/^(bavli|talmud bavli|tb|בבלי)\s+/i, '');
  const zv = zoharVolume(s);
  if (zv) {
    const a = parseAddr(zv.rest, 'shas');
    if (a != null) return { title: zv.title, kind: 'shas', addr: a };
  }
  const words = s.split(' ');
  for (let n = Math.min(words.length, 5); n >= 1; n--) {
    const name = words.slice(0, n).join(' '), rest = words.slice(n).join(' ').trim();
    if (/\d/.test(name)) continue;
    const key = /[א-ת]/.test(name) ? 'h:' + heKey(name) : 'l:' + skel(name);
    const hit = M.sourceNames.get(key);
    if (!hit) continue;
    // address: digits "2:7", "88b", "6", or Hebrew numerals "ב ז", "פח ב", "פח:"
    const addr = parseAddr(rest, hit.kind);
    if (addr == null) continue;
    let title = hit.title;
    if (hit.kind === 'shas' && jt) title = `Jerusalem Talmud ${title}`;
    return { ...hit, title, addr };
  }
  const best = mafFindTerms(M, s, ['source_book'])[0];               // unnumbered sources by any name: "Tanchuma", "Zohar Bereishis"
  if (best && best.s >= 100) return { title: best.t.he, kind: 'named', term: best.t, addr: '' };
  return null;
}

// ---- mafteach_lookup_source
async function mafLookupSource({ source, corpus, offset, limit, response_format }) {
  const M = await mafteach();
  const ps = mafParseSource(M, source);
  if (!ps) {
    const near = mafFindTerms(M, source, ['source_book']).slice(0, 8).map(x => x.t.he);
    throw new ToolError(`no Mafteach source is named "${source}". Give a book and address, e.g. "Genesis 2:7", "Bereishis 2:7", "Berachos 6b", "Shabbos 88", "Bereshit Rabbah 2:4", "בראשית ב ז".${near.length ? ` Sources without numbered addresses that match: ${near.join(', ')}.` : ''}`);
  }
  let entries;
  if (ps.kind === 'named') entries = await mafShard(`source/b-${ps.term.id}.json`);
  else if (!ps.addr) {
    const info = M.raw.source_titles[ps.title];
    if (!info) throw new ToolError(`the Mafteach has no entries for ${ps.title}.`);
    const text = `# ${ps.title} in HaMafteach HaShalem\n${info.n} entries. Chapters/dapim with entries: ${info.chapters.join(', ')}.\nAsk again with an address, e.g. "${ps.title} ${info.chapters[0]}".`;
    return response_format === 'json' ? json({ source: ps.title, entries: info.n, chapters: info.chapters }) : text;
  } else {
    const chapter = ps.addr.match(/^\d+/)[0];
    const shard = await mafShard(`source/${fileKey(`${ps.title} ${chapter}`)}.json`);
    const exact = ps.addr.includes(':') || /[ab]$/.test(ps.addr);
    entries = shard.filter(e => !exact ? true : e.k === `${ps.title} ${ps.addr}` || (/^\d+$/.test(ps.addr) && e.k?.startsWith(`${ps.title} ${ps.addr}`)));
    if (!exact) entries = shard.filter(e => new RegExp(`^${ps.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${chapter}(?:[ab]|:|$)`).test(e.k || ''));
  }
  entries = mafCorpusFilter(entries, corpus);
  const label = ps.kind === 'named' ? ps.title : `${ps.title}${ps.addr ? ' ' + ps.addr : ''}`;
  const { total, page, more } = mafPage(entries, offset, limit);
  if (response_format === 'json') return json({ source: label, total, offset, next_offset: more, entries: page.map(e => mafJson(M, e)) });
  if (!total) return `# ${label}\nHaMafteach HaShalem lists no entries for ${label}${corpus !== 'all' ? ` in ${corpus}` : ''}. (Its source volumes are OCR'd; also try kisvei_find_citing_passages.)`;
  const out = [`# ${label} — where Rav Tzadok draws on it`, `HaMafteach HaShalem: ${total} entr${total === 1 ? 'y' : 'ies'}; showing ${offset + 1}–${offset + page.length}. Each line: the quoted words, then the passages.`, ''];
  for (const e of page) out.push(mafEntryLine(M, e, { source: true }));
  if (more != null) out.push('', `More: offset ${more}.`);
  out.push('', 'Refs in Library form open with kisvei_get_text. Index entries are OCR\'d from the printed Mafteach: check the passage before citing.');
  return out.join('\n');
}

// ---- mafteach_lookup_passage
async function mafLookupPassage({ ref, offset, limit, response_format }) {
  const M = await mafteach();
  let s = String(ref).trim();
  let target = null;
  const code = s.match(/^([א-ת]{2})\s*[-־ ]\s*([א-ת"'׳״]+)$/);         // Mafteach code: צה-קיח, רל-נז
  if (code && MAF_CODES[code[1]]) target = `${MAF_CODES[code[1]]} ${gematria(code[2])}`;
  if (!target) {
    const k = refKey(s.replace(/:\d+(-\d+)?$/, ''));
    target = M.passageKeys.get(k) || null;
    if (!target) {
      try { const r = await resolveRef(s); if (r?.sec?.ref) target = r.sec.ref; } catch {}
    }
  }
  if (!target) throw new ToolError(`could not read "${ref}" as a library passage. Examples: "Tzidkat HaTzadik 100", "Tzidkas HaTzaddik 100", "Peri Tzadik, Vayechi 11", "Pri Tzaddik Vayechi 11", "Resisei Layla 57", "צה-ק".`);
  const entries = await mafShard(`passage/${fileKey(target)}.json`);
  const topics = entries.filter(e => e.x === 't'), sources = entries.filter(e => e.x === 's');
  const all = [...topics, ...sources];
  const { total, page, more } = mafPage(all, offset, limit);
  if (response_format === 'json') return json({ passage: target, total, topics: topics.length, sources: sources.length, offset, next_offset: more, entries: page.map(e => mafJson(M, e)) });
  if (!total) return `# ${target}\nHaMafteach HaShalem has no entry pointing to ${target}. (References it cites only by page, e.g. Dover Tzedek or Likkutei Maamarim, are not linked to library sections.)`;
  const out = [`# ${target} in HaMafteach HaShalem`, `${topics.length} topic entr${topics.length === 1 ? 'y' : 'ies'} and ${sources.length} source entr${sources.length === 1 ? 'y' : 'ies'} point here; showing ${offset + 1}–${offset + page.length}. Use these as footnote leads: the topics it treats and the verses, sugyos and midrashim it draws on.`, ''];
  let shown = '';
  for (const e of page) {
    const h = e.x === 't' ? 'Topics' : 'Sources';
    if (h !== shown) { out.push(`## ${h}`); shown = h; }
    out.push(mafEntryLine(M, e, { topic: e.x === 't', source: e.x === 's' }));
  }
  if (more != null) out.push('', `More: offset ${more}.`);
  return out.join('\n');
}

// ---- mafteach_search
async function mafSearch({ query, corpus, offset, limit, response_format }) {
  const M = await mafteach();
  const q = String(query).trim();
  const headings = mafFindTerms(M, q, ['topic', 'source_book']).filter(x => x.t.n > 0).slice(0, 10).map(x => x.t);
  const hits = [];
  let total = 0;
  if (/[א-ת]/.test(q)) {
    const phrases = [...q.matchAll(/"([^"]+)"|(\S+)/g)].map(m => (m[1] || m[2]).trim()).filter(Boolean);
    const terms = phrases.map(p => norm(p).trim()).filter(Boolean);
    if (!terms.length) throw new ToolError('the query has no letters to search for.');
    const parts = MAF_CORPUS[corpus] === 'rt' ? ['1-2', '3'] : MAF_CORPUS[corpus] === 'pt' ? ['4', '5', '7'] : M.raw.parts;
    for (const p of parts) {
      let text = '';
      try {
        if (typeof process !== 'undefined' && process.env?.MCP_DATA_DIR) {
          const { readFile } = await import('node:fs/promises');
          text = await readFile(`${process.env.MCP_DATA_DIR}/mafteach/text/${p}.txt`, 'utf8');
        } else {
          const res = await fetch(new URL(`mcp-data/mafteach/text/${p}.txt`, `${ORIGIN.replace(/\/+$/, '')}/`));
          if (res.ok) text = await res.text();
        }
      } catch {}
      for (const line of text.split('\n')) {
        const tab = line.indexOf('\t');
        const hay = line.slice(0, tab);
        if (terms.every(t => hay.includes(t))) {
          total++;
          if (total > offset && hits.length < limit) hits.push(JSON.parse(line.slice(tab + 1)));
        }
      }
    }
  }
  if (response_format === 'json') {
    return json({ query: q, headings: headings.map(t => ({ he: t.he, en: t.en, kind: t.kind, entries: t.n })), total, offset, next_offset: offset + hits.length < total ? offset + hits.length : null, entries: hits.map(e => mafJson(M, e)) });
  }
  const out = [`# Mafteach search: ${q}`];
  if (headings.length) out.push(`Matching headings (open with mafteach_find_topic or mafteach_lookup_source): ${headings.map(t => `${t.he} — ${t.en} (${t.n})`).join('; ')}.`);
  if (/[א-ת]/.test(q)) {
    out.push(`${total} entr${total === 1 ? 'y contains' : 'ies contain'} these words${total ? `; showing ${offset + 1}–${offset + hits.length}` : ''}.`, '');
    for (const e of hits) out.push(mafEntryLine(M, e, { topic: true, source: true }));
    if (offset + hits.length < total) out.push('', `More: offset ${offset + hits.length}.`);
  } else if (!headings.length) {
    out.push('No heading matches. Entry texts are Hebrew: search with Hebrew words, or try another English or transliterated form.');
  }
  return out.join('\n');
}

const HANDLERS = {
  mafteach_find_topic: mafFindTopic,
  mafteach_lookup_source: mafLookupSource,
  mafteach_lookup_passage: mafLookupPassage,
  mafteach_search: mafSearch,
  kisvei_list_books: listBooks,
  kisvei_get_contents: getContents,
  kisvei_get_text: getText,
  kisvei_search: search,
  kisvei_find_citing_passages: findCiting,
  kisvei_get_cited_sources: getCited,
  kisvei_find_parallels: findParallels,
};

async function callTool(params) {
  const tool = TOOLS.find(t => t.name === params?.name);
  if (!tool) return { error: { code: -32602, message: `Unknown tool: ${params?.name}. Tools: ${TOOLS.map(t => t.name).join(', ')}.` } };
  try {
    const args = checkArgs(tool, params.arguments);
    const text = await HANDLERS[tool.name](args);
    return { result: { content: [{ type: 'text', text }], isError: false } };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : `the library could not answer (${e.message}). Try again in a moment.`;
    if (!(e instanceof ToolError)) console.error(tool.name, e);
    return { result: { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true } };
  }
}

// ---------------------------------------------------------------- protocol

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};
const reply = (status, body) => new Response(body == null ? null : JSON.stringify(body), {
  status, headers: { ...CORS, ...(body == null ? {} : { 'Content-Type': 'application/json' }), 'Cache-Control': 'no-store' },
});
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });

function headerValue(v) {                       // Mcp-Name may be sent as =?base64?…?=
  const m = v && v.match(/^=\?base64\?([A-Za-z0-9+/=]*)\?=$/);
  if (!m) return v;
  try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]), c => c.charCodeAt(0))); } catch { return null; }
}

// 2026-07-28: every request carries its version and capabilities; the transport mirrors them in headers.
async function modern(req, msg) {
  const { id, method } = msg;
  const params = msg.params || {};
  const meta = params._meta || {};
  const version = meta[`${META}protocolVersion`];
  const serverMeta = { [`${META}serverInfo`]: SERVER_INFO };
  if (!MODERN.includes(version)) {
    return reply(400, rpcError(id, -32022, 'Unsupported protocol version', { supported: SUPPORTED, requested: version }));
  }
  if (meta[`${META}clientCapabilities`] == null) {
    return reply(400, rpcError(id, -32602, `Invalid params: _meta["${META}clientCapabilities"] is required`));
  }
  const hVersion = req.headers.get('mcp-protocol-version');
  const hMethod = req.headers.get('mcp-method');
  if (hVersion !== version) return reply(400, rpcError(id, -32020, hVersion ? `Header mismatch: MCP-Protocol-Version ${hVersion} does not match ${version}` : 'Header mismatch: MCP-Protocol-Version header is missing'));
  if (hMethod !== method) return reply(400, rpcError(id, -32020, hMethod ? `Header mismatch: Mcp-Method ${hMethod} does not match ${method}` : 'Header mismatch: Mcp-Method header is missing'));
  if (['tools/call', 'resources/read', 'prompts/get'].includes(method)) {
    const want = method === 'resources/read' ? params.uri : params.name;
    const raw = req.headers.get('mcp-name');
    const got = headerValue(raw);
    if (got !== want) return reply(400, rpcError(id, -32020, raw ? `Header mismatch: Mcp-Name ${raw} does not match ${want}` : 'Header mismatch: Mcp-Name header is missing'));
  }
  const done = result => reply(200, { jsonrpc: '2.0', id, result: { resultType: 'complete', ...result, _meta: serverMeta } });
  switch (method) {
    case 'server/discover':
      return done({ supportedVersions: SUPPORTED, capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3600000, cacheScope: 'public' });
    case 'tools/list':
      return done({ tools: TOOLS, ttlMs: 3600000, cacheScope: 'public' });
    case 'tools/call': {
      const r = await callTool(params);
      return r.error ? reply(200, { jsonrpc: '2.0', id, error: r.error }) : done(r.result);
    }
    case 'ping':
      return done({});
    default:
      return reply(404, rpcError(id, -32601, `Method not found: ${method}`));
  }
}

// 2024-11-05 to 2025-11-25: initialize handshake; this server keeps no session, so every request stands alone.
async function legacy(msg, headerVersion) {
  const { id, method } = msg;
  const params = msg.params || {};
  if (id === undefined || id === null) return null;            // notification (e.g. notifications/initialized)
  const ok = result => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      const version = LEGACY.includes(asked) ? asked : LEGACY[0];
      return ok({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': { const r = await callTool(params); return r.error ? { jsonrpc: '2.0', id, error: r.error } : ok(r.result); }
    case 'resources/list': return ok({ resources: [] });
    case 'resources/templates/list': return ok({ resourceTemplates: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

const isModern = msg => !!msg?.params?._meta?.[`${META}protocolVersion`] && msg.method !== 'initialize';

// Clients list the tools before they call them; use that moment to load the texts, so a first search
// does not wait for them.
let warming = null;
function warm() {
  warming = warming || (async () => {
    const { books } = await catalog();
    for (const b of books) {
      const t = await bookText(b);
      for (let i = 0; i < t.paras.length; i++) { field(t, i, 'hebrew', 'exact'); field(t, i, 'english', 'exact'); field(t, i, 'headings', 'exact'); }
    }
    await citedIndex();
  })().catch(e => { warming = null; console.error('warm', e); });
  return warming;
}

export default async (req, context) => {
  ORIGIN = context?.siteOrigin || process.env.MCP_SITE_ORIGIN || new URL(req.url).origin;
  const res = await handle(req);
  if (req.method === 'POST' && res.status < 300 && !warming && !context?.disableWarm && typeof context?.waitUntil === 'function') context.waitUntil(warm());
  return res;
};

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response('Kisvei Rav Tzadok Library MCP server. Add this URL to Claude as a custom connector (no sign-in needed); MCP clients send JSON-RPC by POST.\n',
      { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS', 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  let msg;
  try { msg = await req.json(); } catch { return reply(400, rpcError(null, -32700, 'Parse error: the body must be JSON-RPC')); }
  const headerVersion = req.headers.get('mcp-protocol-version');
  if (headerVersion && !SUPPORTED.includes(headerVersion) && !(Array.isArray(msg) || isModern(msg))) {
    // Not one of ours and no modern _meta to answer from: name the versions we speak.
    return reply(400, rpcError(Array.isArray(msg) ? null : msg?.id, -32022, 'Unsupported protocol version', { supported: SUPPORTED, requested: headerVersion }));
  }
  if (Array.isArray(msg)) {                                     // JSON-RPC batch (2025-03-26)
    if (!msg.length) return reply(400, rpcError(null, -32600, 'Invalid request: empty batch'));
    const out = [];
    for (const m of msg) {
      if (!m || typeof m !== 'object' || typeof m.method !== 'string') { out.push(rpcError(m?.id, -32600, 'Invalid request')); continue; }
      const r = await legacy(m, headerVersion);
      if (r) out.push(r);
    }
    return out.length ? reply(200, out) : reply(202, null);
  }
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return reply(400, rpcError(msg?.id, -32600, 'Invalid request: expected a JSON-RPC 2.0 request or notification'));
  }
  if (msg.id === undefined || msg.id === null) return reply(202, null);   // notifications need no answer
  if (isModern(msg)) return modern(req, msg);
  if (MODERN.includes(headerVersion)) {
    return reply(400, rpcError(msg.id, -32602, `Invalid params: _meta["${META}protocolVersion"] is required for protocol ${headerVersion}`));
  }
  return reply(200, await legacy(msg, headerVersion));
}

export const config = { path: ['/mcp', '/mcp/'] };

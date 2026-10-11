// Kisvei Rav Tzadok Library: an MCP (Model Context Protocol) server for the texts in the library reader.
//
// Add https://<this site>/mcp to Claude as a custom connector. There is no sign-in; every tool is read-only:
//   kisvei_list_books            the books, editions and licenses
//   kisvei_get_contents          a book's table of contents, with refs
//   kisvei_get_text              exact text of a section or paragraphs (Hebrew/English phrase pairs, notes)
//   kisvei_search                full-text search, Hebrew without nikkud, English, headings, notes
//   kisvei_find_citing_passages  every library passage that cites a verse, daf, midrash...
//   kisvei_get_cited_sources     the sources a library passage cites
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
How to use: kisvei_search finds passages (Hebrew is matched without nikkud, prefixes included; spelling "loose" also ignores ו/י spelling differences); kisvei_get_text returns the exact text of a ref; kisvei_get_contents browses a book; kisvei_find_citing_passages lists every passage citing a source such as "Berakhot 6b" or "Genesis 1:1"; kisvei_get_cited_sources lists what a passage cites.
Quote the text exactly as returned and give its ref. Refs follow the reader, e.g. "Resisei Layla 5:2", "Tzidkat HaTzadik 100", "Peri Tzadik, Bereshit 1:3". Ashkenazi spellings (Tzidkas HaTzaddik, Pri Tzaddik, Bereishis, Berachos) are accepted.`;

// ---------------------------------------------------------------- data

let ORIGIN = '';
const cache = new Map();
function load(file) {
  let p = cache.get(file);
  if (!p) {
    p = (async () => {
      if (process.env.MCP_DATA_DIR) {                       // tests: read the built files from disk
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
  if (!interlinear && (view === 'english' || view === 'both')) out.push('This text has no English translation in the library; the Hebrew follows.');
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

const HANDLERS = {
  kisvei_list_books: listBooks,
  kisvei_get_contents: getContents,
  kisvei_get_text: getText,
  kisvei_search: search,
  kisvei_find_citing_passages: findCiting,
  kisvei_get_cited_sources: getCited,
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

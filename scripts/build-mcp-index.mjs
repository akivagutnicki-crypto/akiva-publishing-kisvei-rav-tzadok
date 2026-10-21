// Builds the data the Kisvei Rav Tzadok MCP server (cloudflare/mcp.mjs) serves.
// Run after scripts/build-library.mjs. Bundled works use the reader's published text;
// remote works can also have a checked Hebrew snapshot for exact source verification.
// These snapshots do not replace the reader's live bilingual Sefaria editions.
//
// Input:  dist/library/data   (catalog, contents, texts, citations; see build-library.mjs)
// Output: dist/mcp-data/catalog.json       books and their sections (refs, titles, paragraph counts)
//         dist/mcp-data/text/<slug>.json   every paragraph as plain text, in reading order:
//                                          Hebrew/English phrase pairs or Hebrew text, headings, notes,
//                                          and the sources the paragraph cites
//         dist/mcp-data/cited.json         cited source -> library paragraphs that cite it
//
// Nothing is rewritten: the text is the reader's text with the HTML markup removed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const DATA = 'dist/library/data';
const OUT = 'dist/mcp-data';
const read = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const exists = f => fs.existsSync(path.join(DATA, f));

// ---------- HTML -> plain text ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ', zwnj: '‌', zwj: '‍', lrm: '', rlm: '' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const tidy = s => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const plain = html => tidy(decode(String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')));

// Citations are marked <a data-ref="Berakhot 6b">…</a>; returns each ref with its offset in the plain text.
function anchorsOf(html) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*\bdata-ref="([^"]+)"[^>]*>/g)) {
    out.push({ ref: decode(m[1]), at: plain(html.slice(0, m.index)).length });
  }
  return out;
}

// Footnotes are written inline: <sup class="footnote-marker">N</sup><i class="footnote">…</i>, and the note
// itself may contain <i>…</i>. Returns the text without the notes and each note with its character offset,
// plus the citations marked in the text and in each note.
function splitNotes(html) {
  const s = String(html ?? '');
  const notes = [];
  let out = '', i = 0;
  const MARK = /<sup class="footnote-marker">([^<]*)<\/sup>\s*<i class="footnote">/g;
  for (let m; (m = MARK.exec(s)); ) {
    out += s.slice(i, m.index);
    let depth = 1, j = MARK.lastIndex;
    const TAG = /<(\/?)i\b[^>]*>/g;
    TAG.lastIndex = j;
    let end = s.length, closeEnd = s.length;
    for (let t; (t = TAG.exec(s)); ) {
      depth += t[1] ? -1 : 1;
      if (!depth) { end = t.index; closeEnd = TAG.lastIndex; break; }
    }
    notes.push({ n: plain(m[1]), html: s.slice(j, end), raw: out.length });
    i = closeEnd;
    MARK.lastIndex = closeEnd;
  }
  out += s.slice(i);
  // Offsets are measured in the plain text before the marker, after cleanup.
  const text = plain(out);
  return {
    text,
    anchors: anchorsOf(out),
    notes: notes.map(x => ({ n: x.n, text: plain(x.html), at: Math.min(plain(out.slice(0, x.raw)).length, text.length), anchors: anchorsOf(x.html).map(a => a.ref) })),
  };
}

// First place each cited ref is marked in a paragraph: [phrase index or -1, 'h'|'e', offset] in the text,
// or ['n', note number] in a note.
function citationPlaces(parts) {
  const a = {};
  for (const { k, side, split } of parts) for (const x of split.anchors) if (!a[x.ref]) a[x.ref] = [k, side, x.at];
  for (const { split } of parts) for (const n of split.notes) for (const ref of n.anchors) if (!a[ref]) a[ref] = ['n', n.n];
  return Object.keys(a).length ? a : null;
}

// ---------- Contents ----------
const leavesOf = (node, trail = []) => node.children
  ? node.children.flatMap(c => leavesOf(c, node === ROOT ? trail : [...trail, node.en]))
  : [{ leaf: node, trail }];
let ROOT = null;
const gematria = n => {
  if (n <= 0 || n >= 1000) return String(n);
  const H = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'], T = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'], O = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const h = H[Math.floor(n / 100)], r = n % 100;
  if (r === 15) return h + 'טו'; if (r === 16) return h + 'טז';
  return h + T[Math.floor(r / 10)] + O[r % 10];
};
// Section addresses of a leaf in reading order (as the reader's sectionsOf does).
function sectionsOf(leaf) {
  if (leaf.depth === 1) return leaf.shape > 0 ? [[]] : [];
  const out = [];
  const walk = (sh, addr) => Array.isArray(sh) && sh.some(Array.isArray)
    ? sh.forEach((c, i) => walk(c, [...addr, i + 1]))
    : Array.isArray(sh) ? sh.forEach((c, i) => { if (c) out.push([...addr, i + 1]); }) : null;
  if (leaf.depth === 2) (leaf.shape || []).forEach((c, i) => { if (c) out.push([i + 1]); });
  else walk(leaf.shape, []);
  return out;
}

// ---------- One section's items -> paragraphs ----------
const warnings = [];
function paragraphsOf(items, where) {
  const paras = [];
  let pending = [];          // headings and tables that come before the next paragraph
  const list = Array.isArray(items) ? items : [items];
  const interlinear = list.some(it => it && typeof it === 'object' && (Array.isArray(it.p) || typeof it.h === 'string' || it.table));
  list.forEach((it, idx) => {
    if (it == null) return;
    if (!interlinear) {                       // Hebrew-only text: one string per paragraph
      if (typeof it !== 'string') { warnings.push(`${where}: unexpected item ${JSON.stringify(it).slice(0, 80)}`); return; }
      const split = splitNotes(it);
      const para = { n: idx + 1, t: split.text };
      if (split.notes.length) para.f = split.notes.map(x => [x.n, x.text, -1, 'h', x.at]);
      const places = citationPlaces([{ k: -1, side: 'h', split }]);
      if (places) para.a = places;
      if (pending.length) { para.h = pending; pending = []; }
      if (split.text || para.f) paras.push(para);
      return;
    }
    if (typeof it.h === 'string') { const h = plain(it.h); if (h) pending.push(h); return; }
    if (it.table) {
      const t = it.table, rows = [t.headers || [], ...(t.rows || [])].filter(r => r.length).map(r => r.map(plain).join(' | '));
      if (rows.length) pending.push(rows.join('\n'));
      return;
    }
    if (!Array.isArray(it.p)) { warnings.push(`${where}: unexpected item ${JSON.stringify(it).slice(0, 80)}`); return; }
    const pairs = [], notes = [], parts = [];
    it.p.forEach((pair, k) => {
      const [heHtml, enHtml] = Array.isArray(pair) ? pair : [pair, ''];
      const he = splitNotes(heHtml), en = splitNotes(enHtml);
      pairs.push([he.text, en.text]);
      parts.push({ k, side: 'h', split: he }, { k, side: 'e', split: en });
      for (const x of he.notes) notes.push([x.n, x.text, k, 'h', x.at]);
      for (const x of en.notes) notes.push([x.n, x.text, k, 'e', x.at]);
    });
    // Notes kept beside the paragraph (Peri Tzadik study edition) are anchored to a phrase.
    for (const fn of it.footnotes || []) {
      const k = Math.max(0, Math.min(pairs.length - 1, fn.phraseIndex ?? pairs.length - 1));
      const text = (fn.paragraphs || []).map(x => plain(x.text ?? x)).filter(Boolean).join('\n') || plain(fn.text);
      notes.push([String(fn.number ?? notes.length + 1), text, k, 'e', pairs[k] ? pairs[k][1].length : 0]);
    }
    const para = { n: it.n || paras.length + 1, p: pairs };
    if (notes.length) para.f = notes;
    let places = citationPlaces(parts);
    // The current Dover Word edition stores its full quotations beside their
    // Hebrew anchors. Include those exact note sources in citation searches.
    if (it.sourceVolume) for (const note of it.footnotes || []) for (const source of note.sources || []) {
      if (!source.ref) continue;
      places ??= {};
      places[source.ref] ??= ['n', String(note.number)];
    }
    if (places) para.a = places;
    if (it.transcriptionNotes?.length) para.x = it.transcriptionNotes.map(plain);
    if (pending.length) { para.h = pending; pending = []; }
    // Keep editorial structure beside the canonical paragraph and phrase pairs.
    // The MCP server searches h/h2; include topical titles there without putting
    // them into the Hebrew or English source text or changing citation offsets.
    if (Array.isArray(it.inlineHeadings)) {
      para.inlineHeadings = it.inlineHeadings.map(heading => ({ ...heading, text: plain(heading.text) }));
      const titles = para.inlineHeadings.map(heading => heading.text).filter(Boolean);
      if (titles.length) para.h = [...(para.h || []), ...titles];
    }
    if (Array.isArray(it.paragraphBreaks)) para.paragraphBreaks = [...it.paragraphBreaks];
    paras.push(para);
  });
  if (pending.length) {                      // headings after the last paragraph: keep them on it
    if (paras.length) paras[paras.length - 1].h2 = pending;
    else warnings.push(`${where}: headings without text`);
  }
  return paras;
}

// ---------- Build ----------
if (!exists('catalog.json')) { console.error('build-mcp-index: run scripts/build-library.mjs first'); process.exit(1); }
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'text'), { recursive: true });

const catalog = read('catalog.json');
const books = [];
const cited = {};                             // cited ref -> [paragraph refs]
let totalParas = 0;

function addLinks(linksFile, byRef) {
  if (!exists(linksFile)) return;
  for (const list of Object.values(read(linksFile))) {
    for (const { a, r, c } of list) {
      if (!a || !r) continue;
      const para = byRef.get(a);
      if (para) (para.c = para.c || []).push([r, c || '']);
      (cited[r] = cited[r] || []).includes(a) || cited[r].push(a);
    }
  }
}

for (const b of catalog) {
  const toc = read(`${b.slug}/toc.json`);
  ROOT = toc.toc;
  const sections = [], paras = [];
  for (const { leaf, trail } of leavesOf(ROOT)) {
    const secLen = leaf.depth - 1;
    const sep = leaf.sep || (secLen ? ':' : ' ');
    for (const addr of sectionsOf(leaf)) {
      const ref = addr.length ? `${leaf.ref} ${addr.join(':')}` : leaf.ref;
      const heRef = leaf.interlinear ? leaf.heRef : (addr.length ? `${leaf.heRef} ${addr.map(gematria).join(':')}` : leaf.heRef);
      const file = leaf.depth === 1 ? `${b.slug}/${leaf.id}.json` : `${b.slug}/${leaf.id}-${addr[0]}.json`;
      if (!exists(file)) { warnings.push(`${b.slug}: missing ${file} for ${ref}`); continue; }
      let text = read(file);
      for (const i of addr.slice(1)) text = (text || [])[i - 1];
      const list = paragraphsOf(text, ref);
      if (!list.length) continue;
      const s = sections.length;
      const il = list.some(x => x.p);
      const chapterDisplayTitle = leaf.shabbosEdition && leaf.chapterTitleDisplay && leaf.chapterTitles?.[addr[0] - 1];
      sections.push({
        ref, he: heRef, title: chapterDisplayTitle || (addr.length ? `${leaf.en} ${addr.join(':')}` : leaf.en),
        heTitle: addr.length ? `${leaf.he} ${addr.map(gematria).join(':')}` : leaf.he,
        path: trail.filter(Boolean).join(' › '), il, first: paras.length, count: list.length,
        ...(chapterDisplayTitle ? { chapterDisplayTitle } : {}),
        ...(leaf.parashah ? { parashah: leaf.parashah } : {}), ...(leaf.ois ? { ois: leaf.ois } : {}),
      });
      for (const p of list) paras.push({ r: `${ref}${sep}${p.n}`, s, ...p });
    }
  }
  // Two sections can share a ref (Peri Tzadik: the interlinear study edition and the original Hebrew of the
  // same ois). The reader opens the study edition; keep both and label them.
  const seen = new Map();
  sections.forEach((sec, i) => { const list = seen.get(sec.ref) || []; list.push(i); seen.set(sec.ref, list); });
  for (const list of seen.values()) if (list.length > 1) for (const i of list) sections[i].edition = sections[i].il ? 'interlinear' : 'hebrew';
  const byRef = new Map();
  for (const p of paras) if (!byRef.has(p.r) || sections[p.s].il) byRef.set(p.r, p);
  addLinks(`${b.slug}/links.json`, byRef);
  books.push({ slug: b.slug, title: b.title, he: b.he, group: b.group, edition: b.version?.title || '', license: b.version?.license || '',
    source: b.version?.source || '', akiva: !!b.akiva, interlinear: !!b.interlinear, paragraphs: paras.length, sections });
  fs.writeFileSync(path.join(OUT, 'text', `${b.slug}.json`), JSON.stringify({ slug: b.slug, paras }));
  totalParas += paras.length;
}

// Mei HaShiloach: the reader shows Akiva Publishing's interlinear translation of these parashiyos.
if (exists('mei-ha-shiloach/interlinear.json')) {
  const overlay = read('mei-ha-shiloach/interlinear.json');
  const heads = exists('mei-ha-shiloach/headings.json') ? read('mei-ha-shiloach/headings.json') : {};
  const sections = [], paras = [];
  for (const [ref, passages] of Object.entries(overlay)) {
    if (!Array.isArray(passages) || !passages.length) continue;
    const info = heads[ref];
    const titles = info && Array.isArray(info.headings) && info.headings.length === passages.length ? info.headings : null;
    const items = [];
    passages.forEach((pairs, i) => {
      if (titles && titles[i]) items.push({ h: String(titles[i]) });
      items.push({ n: i + 1, p: pairs });
    });
    const list = paragraphsOf(items, ref);
    const parts = ref.split(', ');
    sections.push({ ref, he: '', title: parts.slice(1).join(', '), heTitle: '', path: parts.slice(1, -1).join(' › '), il: true,
      first: paras.length, count: list.length, ...(info?.title ? { heading: info.title } : {}) });
    for (const p of list) paras.push({ r: `${ref} ${p.n}`, s: sections.length - 1, ...p });
  }
  if (paras.length) {
    const byRef = new Map(paras.map(p => [p.r, p]));
    addLinks('mei-ha-shiloach/links.json', byRef);
    books.push({ slug: 'mei-hashiloach', title: 'Mei HaShiloach', he: 'מי השילוח', group: 'Izhbitz',
      edition: 'Akiva Publishing interlinear translation (selected parashiyos)', license: '© Akiva Publishing', source: '',
      akiva: true, interlinear: true, paragraphs: paras.length, sections });
    fs.writeFileSync(path.join(OUT, 'text', 'mei-hashiloach.json'), JSON.stringify({ slug: 'mei-hashiloach', paras }));
    totalParas += paras.length;
  }
}

// Preserve exact, complete Hebrew contexts for works that the reader already opens
// remotely. In particular, retaining Sha'ar HaEmunah's live reader edition keeps
// its existing English translation and English footnotes available to the reader.
const remoteSourceDir = 'sources/akiva/remote-source-texts';
if (fs.existsSync(remoteSourceDir)) {
  for (const file of fs.readdirSync(remoteSourceDir).filter(x => x.endsWith('.json')).sort()) {
    const sourcePath = path.join(remoteSourceDir, file);
    const bytes = fs.readFileSync(sourcePath);
    const doc = JSON.parse(bytes);
    assert(doc.schemaVersion === 1 && typeof doc.title === 'string' && doc.title.trim()
      && typeof doc.he === 'string' && typeof doc.edition === 'string'
      && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.slug)
      && ['Izhbitz', "R' Tzadok HaKohen"].includes(doc.group)
      && /^https:\/\/www\.sefaria\.org\//.test(doc.source)
      && Array.isArray(doc.sections) && doc.sections.length,
    'Invalid remote Hebrew source snapshot: ' + sourcePath);
    const existing = books.find(b => b.title === doc.title || b.slug === doc.slug);
    assert(!existing || (doc.extendsExisting === true && doc.title === 'Mei HaShiloach'
      && existing.title === doc.title && existing.slug === doc.slug && existing.group === doc.group),
      'A remote source snapshot cannot replace a bundled edition: ' + doc.title);
    const sections = existing ? [...existing.sections] : [];
    const paras = existing ? JSON.parse(fs.readFileSync(path.join(OUT, 'text', doc.slug + '.json'))).paras : [];
    const previousCount = paras.length;
    const seen = new Set(sections.map(s => s.ref));
    for (const sec of doc.sections) {
      assert(typeof sec.ref === 'string' && sec.ref.startsWith(doc.title + ', ')
        && !seen.has(sec.ref) && [':', ' '].includes(sec.separator)
        && Array.isArray(sec.paragraphs) && sec.paragraphs.length
        && sec.paragraphs.every(p => typeof p === 'string' && /[א-ת]/.test(p)),
      'Invalid or repeated remote source section: ' + sec.ref);
      seen.add(sec.ref);
      const list = paragraphsOf(sec.paragraphs, sec.ref);
      assert(list.length === sec.paragraphs.length, 'Remote source paragraphs were lost: ' + sec.ref);
      const s = sections.length;
      sections.push({ref: sec.ref, he: sec.heRef || '', title: sec.title || sec.ref,
        heTitle: sec.heTitle || '', path: sec.path || '', il: false,
        first: paras.length, count: list.length, sourceEdition: doc.edition, sourceUrl: doc.source});
      for (const p of list) paras.push({r: sec.ref + sec.separator + p.n, s, ...p});
    }
    const sourceSnapshot = {path: sourcePath, retrievedOn: doc.retrievedOn,
      sha256: createHash('sha256').update(bytes).digest('hex')};
    if (existing) {
      existing.sections = sections;
      existing.paragraphs = paras.length;
      existing.sourceSnapshots = [...(existing.sourceSnapshots || []), sourceSnapshot];
      // The MCP's existing section-aware labeling still identifies the Akiva
      // interlinear text separately; do not attribute its copyright to new Hebrew.
      existing.edition = `Mei HaShiloach, ${doc.edition} (Hebrew); Akiva Publishing interlinear translation (selected parashiyos)`;
      existing.license = '';
      existing.source = doc.source;
    } else {
      books.push({slug: doc.slug, title: doc.title, he: doc.he, group: doc.group,
        edition: doc.edition, license: '', source: doc.source, akiva: false, interlinear: false,
        paragraphs: paras.length, sections, sourceSnapshot});
    }
    fs.writeFileSync(path.join(OUT, 'text', doc.slug + '.json'), JSON.stringify({slug: doc.slug, paras}));
    totalParas += paras.length - previousCount;
  }
}

const version = exists('files.json') ? read('files.json').version : '';
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify({ version, built: new Date().toISOString(), books }));
fs.writeFileSync(path.join(OUT, 'cited.json'), JSON.stringify(cited));
const size = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
for (const w of warnings.slice(0, 20)) console.warn('  warning: ' + w);
if (warnings.length > 20) console.warn(`  … ${warnings.length - 20} more warnings`);
console.log(`MCP index: ${books.length} books, ${totalParas} paragraphs, ${Object.keys(cited).length} cited sources, ${(size(OUT) / 1e6).toFixed(1)} MB in ${OUT}`);

// Rebuilding text data clears OUT. Retain the exact published, curated parallels.
// The normal build-parallels step can replace these when a full rebuild is requested.
if (exists('parallels')) {
  fs.cpSync(path.join(DATA, 'parallels'), path.join(OUT, 'parallels'), {recursive: true});
}

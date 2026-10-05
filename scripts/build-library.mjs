// Builds the static text data for the library reader (dist/library/data).
//
// Input:  sources/sefaria/*.json and sources/akiva/*.json — Sefaria-style
//         exports ({title, heTitle, versionTitle, text, schema?, ...}).
// Output: dist/library/data/catalog.json        list of books
//         dist/library/data/<slug>/toc.json     table of contents + shapes
//         dist/library/data/<slug>/<leaf>.json  text of a depth-1 node
//         dist/library/data/<slug>/<leaf>-<n>.json  chapter n of a deeper node
//         dist/library/data/<slug>/links.json   sources each paragraph cites
//         dist/library/data/cited/<book>.json   library passages citing that book
//
// To add a book, drop its Sefaria JSON export into sources/sefaria and rerun.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { linkCitations, categoryOf, normalizeRef } from './citations.mjs';
import { packs, TANAKH, SHAS } from './packs.mjs';

const OUT = 'dist/library/data';
// Akiva sources come first and replace a Sefaria export of the same title.
const DIRS = ['sources/akiva', 'sources/sefaria'];

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const depthOf = x => (Array.isArray(x) ? 1 + Math.max(0, ...x.map(depthOf)) : 0);
const isEmpty = x => (Array.isArray(x) ? x.every(isEmpty) : !String(x ?? '').trim());

// Trim trailing empty entries so section/segment counts match real text.
function trim(x) {
  if (!Array.isArray(x)) return x;
  const out = x.map(trim);
  while (out.length && isEmpty(out[out.length - 1])) out.pop();
  return out;
}
// Shape mirrors Sefaria's /api/shape: number of segments per section, 0 when empty.
function shapeOf(x, depth) {
  if (depth === 1) return x.length;
  return x.map(c => (Array.isArray(c) ? shapeOf(c, depth - 1) : 0));
}

// Translated parts of a book (scripts/convert-interlinear.py), keyed "Book|Node path".
const PARTS = new Map();
const partsDir = 'sources/akiva/parts';
if (fs.existsSync(partsDir)) {
  for (const f of fs.readdirSync(partsDir).filter(f => f.endsWith('.json'))) {
    const part = JSON.parse(fs.readFileSync(path.join(partsDir, f), 'utf8'));
    PARTS.set(`${part.book}|${part.node}`, part);
  }
}
// Topic subheadings written for an edition (sources/akiva/headings), keyed
// node -> "chapter:paragraph"; each goes just before that paragraph.
const headingsDir = 'sources/akiva/headings';
if (fs.existsSync(headingsDir)) {
  for (const f of fs.readdirSync(headingsDir).filter(f => f.endsWith('.json'))) {
    const { book, headings } = JSON.parse(fs.readFileSync(path.join(headingsDir, f), 'utf8'));
    for (const [node, byPara] of Object.entries(headings)) {
      const part = PARTS.get(`${book}|${node}`);
      if (!part) throw new Error(`headings ${f}: no translated part "${node}"`);
      for (const [ch, items] of Object.entries(part.chapters)) {
        part.chapters[ch] = items.flatMap(i => (i.p && byPara[`${ch}:${i.n}`] ? [{ h: byPara[`${ch}:${i.n}`] }, i] : [i]));
      }
    }
  }
}

// Connections: what each translated paragraph cites, and the reverse.
const LINKS = {};  // slug -> { sectionRef: [{a: paragraph ref, r: cited ref, c: category}] }
const CITED = {};  // cited book slug -> { cited ref: [paragraph refs] }
const decode = s => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
const bookOfRef = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '');
// Subheadings in one consistent style: the topic only (Hebrew, English beneath).
// Numbering in the source files (אות / סעיף / פסקא / Section / Paragraph / Seif,
// "[המשך …]") is not consistent across books, so it is dropped; headings that are
// only a number or a range are removed (the margin numbers show the place).
const NIQQUD = /[\u0591-\u05C7]/g;
const HE_MARK = /^\[?(?:המשך |סיום |סוף )?(?:אות|אותיות|סעיף|סעיפים|פסקא|פסקה|פרק|סימן|סגמנט)(?=\s|$)[^\]—(:]*\]?$/;
const EN_MARK = /^(?:Sections?|Paragraphs?|Chapter|Se['’]?ifs?|Segment|Siman|Ois)\b[\s\d–\-,]*$/i;
function topicOf(part) {
  const plain = part.replace(NIQQUD, '').trim();
  const paren = /\(([^()]+)\)\s*$/.exec(part);
  // "סעיף 1 (הקדמה)" / "Section 1 (Ois Aleph: Introduction)" -> the words in the brackets
  if (paren && (HE_MARK.test(plain.replace(/\s*\([^()]*\)\s*$/, '')) || EN_MARK.test(part.replace(/\s*\([^()]*\)\s*$/, '')))) return paren[1].replace(/^Ois \w+:\s*/, '').trim();
  // "Paragraph 1: King David …" / "Section 2: …" -> after the colon
  const colon = /^(?:Sections?|Paragraphs?|Chapter \d+[^:]*|Se['’]?if)[^:]*:\s*(.+)$/i.exec(part);
  if (colon) return colon[1].trim();
  if (HE_MARK.test(plain) || EN_MARK.test(part)) return '';
  return part.trim();
}
function cleanHeading(h) {
  if (h.startsWith('\n')) return h; // a summary ("The theme: …") stays as it is
  const [title, ...rest] = h.split('\n');
  const plainTitle = title.replace(NIQQUD, '');
  // "ישראל קדושים — פרק ה׳, אותיות ט׳–י״ב", "סימן ט״ו: סעיפים ד׳–ז׳": a range only
  if (/^[^—]*—\s*(?:פרק|סימן)\s[^—]*$/.test(plainTitle) && !/[A-Za-z]/.test(plainTitle) && /(פרק|סימן|אות|סעיף)/.test(plainTitle.split('—').pop())) return null;
  if (/^(?:סימן|פרק)\s+\S+:\s*(?:סעיפים|סעיף|אותיות|אות)/.test(plainTitle)) return null;
  const parts = title.split(/\s+[—–]\s+/).map(topicOf).filter(Boolean);
  if (!parts.length) return rest.length ? '\n' + rest.join(' ') : null;
  const he = parts.filter(x => /[\u05D0-\u05EA]/.test(x) && !/[A-Za-z]{3}/.test(x));
  const en = parts.filter(x => !he.includes(x));
  const lines = [(he.length ? he : en).join(' — '), ...(he.length && en.length ? [en.join(' — ')] : []), ...rest];
  return lines.join('\n');
}
const cleanHeadings = items => items.flatMap(i => {
  if (!('h' in i)) return [i];
  const h = cleanHeading(i.h);
  return h ? [{ ...i, h }] : [];
}).filter((i, k, all) => !('h' in i) || !(k > 0 && 'h' in all[k - 1] && all[k - 1].h === i.h)); // no repeats

// Link citations in interlinear paragraphs and record them as connections.
function connect(slug, sectionRef, sep, items) {
  items = cleanHeadings(items);
  let k = 0;
  for (const item of items) {
    if (!item.p) continue;
    k++;
    const anchor = sectionRef + sep + (item.n || k);
    const norm = h => linkCitations(h).replace(/data-ref="([^"]+)"/g, (_, r) => `data-ref="${normalizeRef(r)}"`);
    item.p = item.p.map(([he, en]) => [norm(he), norm(en)]);
    const refs = new Set();
    for (const [he, en] of item.p) for (const m of (he + en).matchAll(/data-ref="([^"]+)"/g)) refs.add(decode(m[1]));
    for (const r of refs) {
      ((LINKS[slug] ??= {})[sectionRef] ??= []).push({ a: anchor, r, c: categoryOf(r) });
      ((CITED[slugify(bookOfRef(r))] ??= {})[r] ??= []).push(anchor);
    }
  }
  return items;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const catalog = [];
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const src = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (catalog.some(b => b.title === src.title)) { console.log(`${src.title}: using Akiva edition, skipping ${path.join(dir, file)}`); continue; }
    const slug = slugify(src.title);
    const bookDir = path.join(OUT, slug);
    fs.mkdirSync(bookDir, { recursive: true });
    let leafId = 0, segments = 0;

    // Interlinear editions (scripts/convert-interlinear.py): one leaf per section,
    // each paragraph a list of [hebrew, english] phrase pairs.
    if (src.interlinear) {
      const children = src.sections.map(sec => {
        const id = leafId++;
        const numbered = !sec.key;
        const paras = sec.items.filter(i => i.p).length;
        segments += paras;
        const ref = numbered ? `${src.title} ${sec.n}` : `${src.title}, ${sec.key}`;
        const sep = sec.sep || (numbered ? ':' : ' ');
        fs.writeFileSync(path.join(bookDir, `${id}.json`), JSON.stringify(connect(slug, ref, sep, sec.items)));
        return {
          en: sec.en, he: sec.he, id, depth: 1, shape: paras, interlinear: true,
          ref,
          heRef: `${src.heTitle}, ${sec.he}`, sep,
        };
      });
      const version = { title: src.versionTitle, source: src.versionSource || '', license: src.license || '' };
      const toc = { en: src.title, he: src.heTitle, children };
      fs.writeFileSync(path.join(bookDir, 'toc.json'), JSON.stringify({ title: src.title, he: src.heTitle, version, toc }));
      catalog.push({ title: src.title, he: src.heTitle, slug, group: (src.categories || [])[1] || 'Other', version, akiva: true, interlinear: true, segments });
      console.log(`${src.title}: interlinear, ${children.length} sections, ${segments} paragraphs`);
      continue;
    }

    // Walk schema nodes (complex texts) or treat the whole text as one leaf.
    const build = (schemaNode, text, enPath, hePath) => {
      if (schemaNode && schemaNode.nodes) {
        return {
          en: schemaNode.enTitle, he: schemaNode.heTitle,
          children: schemaNode.nodes.map(n =>
            build(n, text?.[n.enTitle], n.enTitle ? [...enPath, n.enTitle] : enPath, n.heTitle ? [...hePath, n.heTitle] : hePath)),
        };
      }
      const t = trim(text ?? []);
      const depth = Math.max(1, Array.isArray(t) ? depthOf(t) : 1);
      const id = leafId++;
      const ref = [src.title, ...enPath.slice(1)].join(', ');
      const heRef = [src.heTitle, ...hePath.slice(1)].join(', ');
      if (depth === 1) {
        fs.writeFileSync(path.join(bookDir, `${id}.json`), JSON.stringify(t));
        segments += t.filter(s => String(s ?? '').trim()).length;
      } else {
        t.forEach((ch, i) => {
          if (!isEmpty(ch)) fs.writeFileSync(path.join(bookDir, `${id}-${i + 1}.json`), JSON.stringify(ch));
          segments += [ch].flat(Infinity).filter(s => String(s ?? '').trim()).length;
        });
      }
      const shape = depth === 1 ? t.length : t.map(c => (isEmpty(c) ? 0 : shapeOf(c, depth - 1)));
      const leaf = { en: schemaNode?.enTitle ?? '', he: schemaNode?.heTitle ?? '', ref, heRef, id, depth, shape };
      // Lay Akiva interlinear chapters over this node's Hebrew.
      const part = PARTS.get(`${src.title}|${enPath.slice(1).join(', ')}`);
      if (part && depth === 1 && part.chapters['1']) {
        // A single-level node (e.g. "From Zohar"): its translated paragraphs replace the Hebrew file.
        const items = connect(slug, ref, ' ', part.chapters['1']);
        fs.writeFileSync(path.join(bookDir, `${id}.json`), JSON.stringify(items));
        leaf.il1 = true;
        leaf.shape = Math.max(leaf.shape, items.filter(i => i.p).length);
        console.log(`  ${ref}: interlinear`);
      }
      if (part && depth === 2) {
        leaf.ilch = [];
        for (const [ch, rawItems] of Object.entries(part.chapters)) {
          const k = +ch;
          // Keep the Hebrew of paragraphs before the translation begins (e.g. a title page).
          const nums = rawItems.filter(i => i.p && i.n).map(i => i.n);
          const lead = [];
          for (let n = 1; nums.length && n < Math.min(...nums); n++) {
            const heb = t[k - 1]?.[n - 1];
            if (typeof heb === 'string' && heb.trim()) lead.push({ p: [[heb, '']], n });
          }
          const items = [...lead, ...connect(slug, `${ref} ${k}`, ':', rawItems)];
          fs.writeFileSync(path.join(bookDir, `${id}-${k}.json`), JSON.stringify(items));
          while (shape.length < k) shape.push(0);
          shape[k - 1] = Math.max(1, items.filter(i => i.p).length);
          leaf.ilch.push(k);
        }
        console.log(`  ${ref}: interlinear chapters ${leaf.ilch.join(', ')}`);
      }
      return leaf;
    };

    const root = src.schema
      ? build(src.schema, src.text, [src.title], [src.heTitle])
      : build(null, src.text, [src.title], [src.heTitle]);
    root.en = src.title; root.he = src.heTitle;

    const [, group = 'Other'] = src.categories || [];
    const version = {
      title: src.versionTitle === 'merged' && src.versions?.[0] ? src.versions[0][0] : src.versionTitle,
      source: (src.versionSource || src.versions?.[0]?.[1] || '').trim().split(/\s+/)[0],
      license: src.license && src.license !== 'unknown' ? src.license : '',
    };
    fs.writeFileSync(path.join(bookDir, 'toc.json'), JSON.stringify({ title: src.title, he: src.heTitle, version, toc: root }));
    const ilParts = [...PARTS.values()].some(p => p.book === src.title);
    catalog.push({ title: src.title, he: src.heTitle, slug, group, version, akiva: !!src.akiva, ilParts, segments });
    console.log(`${src.title}: ${leafId} node(s), ${segments} segments`);
  }
}
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 1));
let nLinks = 0;
for (const [slug, bySection] of Object.entries(LINKS)) {
  fs.writeFileSync(path.join(OUT, slug, 'links.json'), JSON.stringify(bySection));
  nLinks += Object.values(bySection).reduce((n, l) => n + l.length, 0);
}
fs.mkdirSync(path.join(OUT, 'cited'), { recursive: true });
for (const [book, refs] of Object.entries(CITED)) fs.writeFileSync(path.join(OUT, 'cited', `${book}.json`), JSON.stringify(refs));
fs.writeFileSync(path.join(OUT, 'cited', 'index.json'), JSON.stringify(Object.keys(CITED).sort()));
// Offline packs of Sefaria texts: every source the library cites, Tanakh, Shas.
const localTitles = catalog.map(b => b.title);
const cited = new Set();
for (const bySection of Object.values(LINKS)) for (const l of Object.values(bySection).flat()) {
  if (!localTitles.some(t => l.r === t || l.r.startsWith(t + ' ') || l.r.startsWith(t + ','))) cited.add(l.r);
}
fs.mkdirSync(path.join(OUT, 'packs'), { recursive: true });
for (const [name, pack] of Object.entries(packs([...cited].sort()))) {
  fs.writeFileSync(path.join(OUT, 'packs', `${name}.json`), JSON.stringify(pack));
  console.log(`Pack ${name}: ${pack.refs.length} texts`);
}

fs.writeFileSync(path.join(OUT, 'packs', 'index.json'), JSON.stringify([
  ['Tanakh', TANAKH.map(([g, books]) => [g, books.map(b => b[0])])],
  ['Talmud Bavli', SHAS.map(([g, ts]) => [g, ts.map(t => t[0])])],
]));

// Every data file, for the web app's "download for offline reading".
const files = [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
  const f = path.join(dir, e.name);
  if (e.isDirectory()) walk(f);
  else files.push([path.relative(OUT, f).split(path.sep).join('/'), fs.statSync(f).size]);
});
walk(OUT);
files.sort((a, b) => a[0].localeCompare(b[0]));
const bytes = files.reduce((n, f) => n + f[1], 0);
const version = files.reduce((h, [f, n]) => (h * 31 + n + f.length) % 2147483647, 7).toString(36);
fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify({ version, bytes, files: files.map(f => f[0]) }));
// The whole library as one zip: downloadable as a file, and used by the web app
// to save everything for offline reading in a single download.
const { zipSync } = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
const entries = {
  'README.txt': new TextEncoder().encode(
    'Rav Tzadok Library - Akiva Publishing\n\n' +
    'The text data of the library (https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/).\n' +
    'data/catalog.json lists the books; data/<book>/toc.json gives each book\'s contents;\n' +
    'the numbered files hold the text (Hebrew, or [Hebrew, English] phrase pairs for interlinear editions).\n\n' +
    'Hebrew texts from Sefaria are under their own licenses (see each toc.json).\n' +
    'Akiva Publishing translations and vocalized editions (c) Akiva Publishing. All rights reserved.\n'),
};
for (const [f] of files) entries['data/' + f] = fs.readFileSync(path.join(OUT, f));
const DL = path.join(OUT, '..', 'downloads');
fs.mkdirSync(DL, { recursive: true });
const zip = zipSync(entries, { level: 6 });
fs.writeFileSync(path.join(DL, 'rav-tzadok-library.zip'), zip);
console.log(`Zip: downloads/rav-tzadok-library.zip, ${(zip.length / 1048576).toFixed(1)} MB`);
console.log(`Offline package: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB, version ${version}`);
console.log(`Connections: ${nLinks} citations from ${Object.keys(LINKS).length} books into ${Object.keys(CITED).length} cited books`);
console.log(`Built ${catalog.length} books into ${OUT}`);

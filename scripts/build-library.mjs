// Builds the static text data for the library reader (dist/library/data).
//
// Input:  sources/sefaria/*.json and sources/akiva/*.json — Sefaria-style
//         exports ({title, heTitle, versionTitle, text, schema?, ...}).
// Output: dist/library/data/catalog.json        list of books
//         dist/library/data/<slug>/toc.json     table of contents + shapes
//         dist/library/data/<slug>/<leaf>.json  text of a depth-1 node
//         dist/library/data/<slug>/<leaf>-<n>.json  chapter n of a deeper node
//
// To add a book, drop its Sefaria JSON export into sources/sefaria and rerun.
import fs from 'node:fs';
import path from 'node:path';

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
        fs.writeFileSync(path.join(bookDir, `${id}.json`), JSON.stringify(sec.items));
        return {
          en: sec.en, he: sec.he, id, depth: 1, shape: paras, interlinear: true,
          ref: numbered ? `${src.title} ${sec.n}` : `${src.title}, ${sec.key}`,
          heRef: `${src.heTitle}, ${sec.he}`, sep: numbered ? ':' : ' ',
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
      return { en: schemaNode?.enTitle ?? '', he: schemaNode?.heTitle ?? '', ref, heRef, id, depth, shape };
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
    catalog.push({ title: src.title, he: src.heTitle, slug, group, version, akiva: !!src.akiva, segments });
    console.log(`${src.title}: ${leafId} node(s), ${segments} segments`);
  }
}
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 1));
console.log(`Built ${catalog.length} books into ${OUT}`);

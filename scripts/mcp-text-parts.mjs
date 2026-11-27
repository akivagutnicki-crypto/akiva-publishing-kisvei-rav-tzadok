// Whole-book MCP texts (dist/mcp-data/text/<slug>.json) over 10 MB are published in parts, so no file in the site is over
// 10 MB: <slug>.json becomes {slug, parts, n} and <slug>.part<k>.json holds {slug, part, paras} in reading order.
// The tools read a book through text-chunks/ and the search index; these files are the fallback (cloudflare/mcp.mjs).
import fs from 'node:fs';
import path from 'node:path';
export const PART_MAX = 9_000_000;
export const isPart = file => /\.part\d+\.json$/.test(file);
// The paragraphs of one book, joining its parts when it has them.
export function readBookText(dir, slug) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, slug + '.json'), 'utf8'));
  if (!d.parts) return d;
  const paras = [];
  for (let k = 1; k <= d.parts; k++) paras.push(...JSON.parse(fs.readFileSync(path.join(dir, `${slug}.part${k}.json`), 'utf8')).paras);
  if (d.n != null && paras.length !== d.n) throw new Error(`text/${slug}: ${paras.length} paragraphs in the parts, ${d.n} expected`);
  return {slug, paras};
}
// The books published in parts. Peri Tzadik joined them with its Vayikra, Bamidbar and Devarim editions (its release
// scripts read and write the parts: scripts/pri-vbd/release.py). Bais Yaakov keeps its whole files (grandfathered in
// scripts/test-mcp-budget.mjs) because their own release scripts publish those files by name.
export const SPLIT = new Set(['peri-tzadik', 'sidrei-taharot-kelim', 'sidrei-taharot-ohalot', 'tiferet-tzvi-part-i', 'sod-yesharim', 'torat-emet', 'imrei-emet']);
// Split those books' whole-book texts, when over 10 MB, into parts under PART_MAX bytes.
export function splitLargeTexts(dir) {
  const out = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json') && !isPart(f)).sort()) {
    const full = path.join(dir, file);
    if (!SPLIT.has(file.slice(0, -5)) || fs.statSync(full).size <= 10_000_000) continue;
    const {slug, paras} = JSON.parse(fs.readFileSync(full, 'utf8'));
    const parts = []; let cur = [], size = 0;
    for (const p of paras) {
      const b = Buffer.byteLength(JSON.stringify(p)) + 1;
      if (cur.length && size + b > PART_MAX) { parts.push(cur); cur = []; size = 0; }
      cur.push(p); size += b;
    }
    if (cur.length) parts.push(cur);
    parts.forEach((list, i) => fs.writeFileSync(path.join(dir, `${slug}.part${i + 1}.json`), JSON.stringify({slug, part: i + 1, paras: list})));
    fs.writeFileSync(full, JSON.stringify({slug, parts: parts.length, n: paras.length}));
    out.push([slug, parts.length]);
  }
  return out;
}

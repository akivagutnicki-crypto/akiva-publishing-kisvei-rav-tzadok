// MCP search index: every paragraph's Hebrew, English and headings in search form, so kisvei_search reads a few MB of
// strings per book instead of the full texts (see searchFields in cloudflare/mcp.mjs).
// Usage: node scripts/build-mcp-search-index.mjs [MCP_DATA_DIR=dist/mcp-data]
// Writes DIR/search/<slug>.json; a book whose index would pass PART_BYTES is split into <slug>.1.json, <slug>.2.json …
// with <slug>.json = {"v":1,"parts":n}, so no published file comes near the 10 MB limit.
import fs from 'node:fs';
import path from 'node:path';
const DIR = process.argv[2] || 'dist/mcp-data';
const PART_BYTES = 7_000_000;
const { searchFields } = await import('../cloudflare/mcp.mjs');
const { books } = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'));
const out = path.join(DIR, 'search');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let bytes = 0, files = 0, largest = 0;
const write = (name, obj) => { const s = JSON.stringify(obj); fs.writeFileSync(path.join(out, name), s); bytes += s.length; files++; largest = Math.max(largest, Buffer.byteLength(s)); };
for (const b of books) {
  const t = JSON.parse(fs.readFileSync(path.join(DIR, 'text', `${b.slug}.json`), 'utf8'));
  t.book = b;
  const idx = searchFields(t);
  const size = Buffer.byteLength(JSON.stringify(idx));
  if (size <= PART_BYTES) { write(`${b.slug}.json`, idx); continue; }
  const n = Math.ceil(size / PART_BYTES), per = Math.ceil(idx.h.length / n);
  for (let k = 0; k < n; k++) {
    const sl = a => a.slice(k * per, (k + 1) * per);
    write(`${b.slug}.${k + 1}.json`, { v: 1, h: sl(idx.h), e: sl(idx.e), d: sl(idx.d) });
  }
  write(`${b.slug}.json`, { v: 1, parts: n });
}
console.log(`MCP search index: ${books.length} books, ${files} files, ${(bytes / 1e6).toFixed(1)} MB, largest ${(largest / 1e6).toFixed(1)} MB`);

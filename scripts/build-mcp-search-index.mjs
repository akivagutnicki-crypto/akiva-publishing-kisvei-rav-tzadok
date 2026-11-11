// MCP search index: every paragraph's Hebrew, English and headings in search form, so kisvei_search reads a few MB of
// strings per book instead of the full texts (see searchFields in cloudflare/mcp.mjs).
// Usage: node scripts/build-mcp-search-index.mjs [MCP_DATA_DIR=dist/mcp-data]
// Writes DIR/search/<slug>.json; a book whose index would pass PART_BYTES is split into <slug>.1.json, <slug>.2.json …
// with <slug>.json = {"v":1,"parts":n}, so no published file comes near the 10 MB limit.
import fs from 'node:fs';
import path from 'node:path';
const DIR = process.argv[2] || 'dist/mcp-data';
const PART_BYTES = 7_000_000;
const CHUNK_BYTES = 400_000;
let chunkFiles = 0, largestChunk = 0;
const { searchFields, searchNotes } = await import('../cloudflare/mcp.mjs');
const { books } = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'));
const out = path.join(DIR, 'search');
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(path.join(DIR, 'text-chunks'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let bytes = 0, files = 0, largest = 0;
const write = (name, obj) => { const s = JSON.stringify(obj); fs.writeFileSync(path.join(out, name), s); bytes += s.length; files++; largest = Math.max(largest, Buffer.byteLength(s)); };
for (const b of books) {
  const t = JSON.parse(fs.readFileSync(path.join(DIR, 'text', `${b.slug}.json`), 'utf8'));
  t.book = b;
  put(b.slug, searchFields(t), ['h', 'e', 'd']);
  chunks(b.slug, t.paras);
  put(`${b.slug}.notes`, searchNotes(t), ['n']);
}
// text-chunks/<slug>/: the book's paragraphs in pieces of about CHUNK_BYTES, so tools read only what they show.
function chunks(slug, paras) {
  const dir = path.join(DIR, 'text-chunks', slug);
  fs.mkdirSync(dir, { recursive: true });
  const avg = Buffer.byteLength(JSON.stringify(paras)) / Math.max(1, paras.length);
  const chunk = Math.max(1, Math.floor(CHUNK_BYTES / Math.max(1, avg)));
  for (let k = 0; k * chunk < paras.length; k++) {
    const s = JSON.stringify({ v: 1, paras: paras.slice(k * chunk, (k + 1) * chunk) });
    fs.writeFileSync(path.join(dir, `${k}.json`), s); chunkFiles++; largestChunk = Math.max(largestChunk, Buffer.byteLength(s));
  }
  fs.writeFileSync(path.join(dir, 'refs.json'), JSON.stringify({ v: 1, n: paras.length, chunk, r: paras.map(p => p.r) }));
}
function put(name, idx, keys) {
  const size = Buffer.byteLength(JSON.stringify(idx)), count = idx[keys[0]].length;
  if (size <= PART_BYTES) return write(`${name}.json`, idx);
  const n = Math.ceil(size / PART_BYTES), per = Math.ceil(count / n);
  for (let k = 0; k < n; k++) write(`${name}.${k + 1}.json`, Object.fromEntries([['v', 1], ...keys.map(x => [x, idx[x].slice(k * per, (k + 1) * per)])]));
  write(`${name}.json`, { v: 1, parts: n });
}
console.log(`MCP text chunks: ${chunkFiles} files, largest ${(largestChunk / 1e6).toFixed(2)} MB`);
console.log(`MCP search index: ${books.length} books, ${files} files, ${(bytes / 1e6).toFixed(1)} MB, largest ${(largest / 1e6).toFixed(1)} MB`);

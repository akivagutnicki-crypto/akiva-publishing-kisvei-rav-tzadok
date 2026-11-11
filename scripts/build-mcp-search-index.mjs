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
const { searchFields, searchNotes, looseOf } = await import('../cloudflare/mcp.mjs');
const { books } = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'));
const out = path.join(DIR, 'search');
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(path.join(DIR, 'text-chunks'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let bytes = 0, files = 0, largest = 0;
for (const b of books) {
  const t = JSON.parse(fs.readFileSync(path.join(DIR, 'text', `${b.slug}.json`), 'utf8'));
  t.book = b;
  const idx = searchFields(t), notes = searchNotes(t);
  for (const [f, lines] of [['h', idx.h], ['hl', idx.h.map(looseOf)], ['e', idx.e], ['d', idx.d], ['n', notes.n]]) putText(`${b.slug}.${f}`, lines);
  chunks(b.slug, t.paras);
}
// One line per paragraph (search form has no newlines); split by lines past PART_BYTES, with "#parts n" in the first file.
function putText(name, lines) {
  const all = lines.join('\n') + '\n';
  if (Buffer.byteLength(all) <= PART_BYTES) return writeRaw(`${name}.txt`, all);
  const n = Math.ceil(Buffer.byteLength(all) / PART_BYTES), per = Math.ceil(lines.length / n);
  for (let k = 0; k < n; k++) writeRaw(`${name}.${k + 1}.txt`, lines.slice(k * per, (k + 1) * per).join('\n') + '\n');
  writeRaw(`${name}.txt`, `#parts ${n}`);
}
function writeRaw(name, s) { fs.writeFileSync(path.join(out, name), s); bytes += Buffer.byteLength(s); files++; largest = Math.max(largest, Buffer.byteLength(s)); }
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
console.log(`MCP text chunks: ${chunkFiles} files, largest ${(largestChunk / 1e6).toFixed(2)} MB`);
console.log(`MCP search index: ${books.length} books, ${files} files, ${(bytes / 1e6).toFixed(1)} MB, largest ${(largest / 1e6).toFixed(1)} MB`);

// Guards the MCP server's resource budget as the library grows (more books, translations, footnotes, Sefaria links).
// The live server is a Cloudflare Worker: 128 MB of memory and a CPU-time limit per request. Past either one,
// Cloudflare ends the request and the client sees "Service Unavailable" (this happened to kisvei_search in Nov 2026).
//
// Usage: node scripts/test-mcp-budget.mjs [MCP_DATA_DIR=dist/mcp-data]
// Run before every publication (Pages build, Mafteach release). Fails when:
//   - a book has no search index, or its index does not match the book's paragraphs;
//   - a published MCP data file is over 10 MB (except files already over it on the live site, which may not grow);
//   - one book's search index is over BOOK_READ_MB (it is read at once inside the 128 MB heap);
//   - any tool call fails, or takes more than CPU_BUDGET_MS of CPU, inside a 128 MB heap (as on Cloudflare).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = process.argv[2] || 'dist/mcp-data';
// The Worker runs on Workers Paid (since November 2026) with "cpu_ms": 120000 in wrangler.jsonc: up to 2 minutes of CPU per
// request (the free plan's limit ended kisvei_search at ~2,000 ms). Memory stays 128 MB on every plan, and a library-wide
// search reads the books' index files ONE BOOK AT A TIME (cloudflare/mcp.mjs search()), so what memory bounds is the
// largest single book's index, not the library's total. The total is reported, and its CPU cost is measured below.
const WORKER_CPU_MS = 120_000;    // wrangler.jsonc limits.cpu_ms
const CPU_BUDGET_MS = Number(process.env.MCP_CPU_BUDGET_MS) || 15_000;   // per tool call measured here: an 8x margin under the Worker's limit
const BOOK_READ_MB = 40;          // one book's search index, read at once inside the 128 MB heap (parts are joined)
const READ_WARN_MB = 150;         // library-wide total: past this, plan a word index so a search reads only its words' entries
const MAX_FILE = 10_000_000;
// Whole-book files over 10 MB. The tools read text-chunks/ and the search index; this whole-book file is only a fallback,
// and this test makes it unreachable on a published site (it fails a publication whose chunks or index are missing).
// cloudflare/mcp.mjs also refuses to load a whole-book file over 20 MB (wholeText), so the Worker never parses it.
// Pri Tzaddik (formerly grandfathered here up to 60 MB) is published in parts since the Vayikra, Bamidbar and Devarim
// editions (scripts/pri-vbd/release.py write_text), so every Pri Tzaddik file is under 10 MB.
const GRANDFATHERED = {
  // the complete Bais Yaakov edition (November 2026): the tools read its text-chunks; the whole-book files are fallbacks
  'text/beit-yaakov-on-torah.json': 16_000_000, 'text/beit-yaakov-shemos.json': 15_000_000 };
// Sidrei Taharos and Tiferes Tzvi I are published in parts under 10 MB (scripts/mcp-text-parts.mjs).
let passed = 0;
const fail = [];
const check = (ok, what) => { ok ? passed++ : fail.push(what); };

// --- data checks
const { books } = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'));
const size = f => { try { return fs.statSync(path.join(DIR, f)).size; } catch { return -1; } };
const readJson = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
let mainBytes = 0, notesBytes = 0;
const bookBytes = {};
const lineCount = t => { let n = 0; for (let k = t.indexOf('\n'); k >= 0; k = t.indexOf('\n', k + 1)) n++; return n; };
for (const b of books) {
  const whole = readJson(`text/${b.slug}.json`);
  if (whole.parts) {                                 // a large book in parts (scripts/mcp-text-parts.mjs)
    let n = 0;
    for (let k = 1; k <= whole.parts; k++) { const f = `text/${b.slug}.part${k}.json`; if (size(f) < 0) { check(false, 'text part missing: ' + f); continue; } n += readJson(f).paras.length; }
    check(n === whole.n, `text/${b.slug}: ${n} paragraphs in its parts for ${whole.n}`);
  }
  const paras = whole.parts ? whole.n : whole.paras.length;
  for (const f of ['h', 'hl', 'e', 'd', 'n']) {
    const name = `search/${b.slug}.${f}`;
    if (size(`${name}.txt`) < 0) { check(false, `search index missing: ${name}.txt`); continue; }
    const head = fs.readFileSync(path.join(DIR, `${name}.txt`), 'utf8');
    const files = head.startsWith('#parts ') ? Array.from({ length: +head.slice(7) }, (_, k) => `${name}.${k + 1}.txt`) : [`${name}.txt`];
    let lines = 0;
    for (const file of files) {
      if (size(file) < 0) { check(false, `search index part missing: ${file}`); continue; }
      lines += lineCount(fs.readFileSync(path.join(DIR, file), 'utf8'));
      if (f === 'n') notesBytes += size(file); else if (f !== 'hl') { mainBytes += size(file); bookBytes[b.slug] = (bookBytes[b.slug] || 0) + size(file); }
    }
    check(lines === paras, `${name}: ${lines} lines for ${paras} paragraphs`);
  }
  const R = size(`text-chunks/${b.slug}/refs.json`) >= 0 ? readJson(`text-chunks/${b.slug}/refs.json`) : null;
  check(R && R.n === paras, `text-chunks/${b.slug}: ${R ? R.n : 'missing'} refs for ${paras} paragraphs`);
}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(DIR)) {
  const rel = path.relative(DIR, f).split(path.sep).join('/'), s = fs.statSync(f).size;
  check(s <= (GRANDFATHERED[rel] ?? MAX_FILE), `${rel} is ${(s / 1e6).toFixed(1)} MB (limit ${((GRANDFATHERED[rel] ?? MAX_FILE) / 1e6).toFixed(1)} MB)`);
}
for (const [slug, mb] of Object.entries(bookBytes)) check(mb / 1e6 <= BOOK_READ_MB, `search index of ${slug} is ${(mb / 1e6).toFixed(1)} MB (one book, read at once: limit ${BOOK_READ_MB} MB)`);

// --- every tool, in a 128 MB heap, one call per fresh process (a cold Worker), with CPU time measured
const CALLS = [
  ['kisvei_list_books', {}],
  ['kisvei_search', { query: 'צוותא' }],
  ['kisvei_search', { query: '"ציד בפיו"', limit: 20 }],
  ['kisvei_search', { query: 'שבת', spelling: 'loose', whole_words: true }],
  ['kisvei_search', { query: 'hidden light' }],
  ['kisvei_search', { query: 'Chagigah', fields: ['notes'] }],
  ['kisvei_search', { query: 'תשובה', fields: ['hebrew', 'english', 'headings', 'notes'] }],
  ['kisvei_get_text', { ref: 'Peri Tzadik, Sukkot 10' }],
  ['kisvei_get_contents', { book: 'Peri Tzadik' }],
  ['kisvei_find_citing_passages', { source: 'Berakhot 6b' }],
  ['kisvei_get_cited_sources', { ref: 'Tzidkat HaTzadik 100' }],
  ['kisvei_find_parallels', { ref: 'Peri Tzadik, Rosh Hashanah 5' }],
  ['mafteach_find_topic', { query: 'emunah' }],
  ['mafteach_lookup_source', { source: 'Bereishis 2:7' }],
  ['mafteach_lookup_passage', { ref: 'Pri Tzaddik Vayechi 11' }],
  ['mafteach_search', { query: '"ויפח באפיו"' }],
];
const child = `
process.env.MCP_DATA_DIR = ${JSON.stringify(path.resolve(DIR))};
const { default: h } = await import(${JSON.stringify(new URL('../cloudflare/mcp.mjs', import.meta.url).href)});
const [name, args] = JSON.parse(process.argv[1]);
const t0 = process.cpuUsage();
const res = await h(new Request('https://example.org/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), { disableWarm: true, siteOrigin: 'https://example.org' });
const body = await res.text(); const c = process.cpuUsage(t0);
let j = null; try { j = JSON.parse(body); } catch {}
console.log(JSON.stringify({ status: res.status, ms: Math.round((c.user + c.system) / 1000), error: j?.error?.message || (j?.result?.isError ? j.result.content?.[0]?.text : null), first: (j?.result?.content?.[0]?.text || '').split('\\n')[0].slice(0, 90) }));
`;
const rows = [];
// CI machines are shared and their timing is noisy (the same call has measured 1.0 s and 1.6 s an hour apart), so a call
// over budget is run again, up to three times, and judged by its fastest run: a real regression is slow every time.
const runOnce = (name, args) => {
  const r = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', child, JSON.stringify([name, args])], { encoding: 'utf8', timeout: 120000 });
  try { return { out: JSON.parse(r.stdout.trim().split('\n').pop()), r }; } catch { return { out: null, r }; }
};
for (const [name, args] of CALLS) {
  let { out, r } = runOnce(name, args);
  for (let k = 1; k < 3 && out && out.ms > CPU_BUDGET_MS; k++) { const again = runOnce(name, args); if (again.out && again.out.ms < out.ms) out = again.out; }
  const label = `${name} ${JSON.stringify(args)}`;
  if (!out) { check(false, `${label}: crashed (${(r.stderr || '').split('\n').find(l => /heap|Error/.test(l)) || 'exit ' + r.status})`); continue; }
  rows.push(`${String(out.ms).padStart(5)} ms  ${label.slice(0, 80)}  → ${out.first}`);
  check(out.status === 200 && !out.error, `${label}: ${out.error || 'HTTP ' + out.status}`);
  check(out.ms <= CPU_BUDGET_MS, `${label}: ${out.ms} ms CPU (budget ${CPU_BUDGET_MS} ms)`);
}
console.log(rows.join('\n'));
console.log(`search index read per library-wide search: ${(mainBytes / 1e6).toFixed(1)} MB (notes ${(notesBytes / 1e6).toFixed(1)} MB); largest book ${(Math.max(...Object.values(bookBytes)) / 1e6).toFixed(1)} MB (limit ${BOOK_READ_MB} MB)`);
for (const [what, mb] of [['library-wide search', mainBytes / 1e6], ['notes search', notesBytes / 1e6]])
  if (mb > READ_WARN_MB) console.log(`::warning::MCP ${what} reads ${mb.toFixed(1)} MB of index (warn ${READ_WARN_MB} MB): time to add a word index`);
if (fail.length) { console.error('MCP budget test FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log(`PASS MCP budget: ${passed} checks`);

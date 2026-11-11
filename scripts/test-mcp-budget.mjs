// Guards the MCP server's resource budget as the library grows (more books, translations, footnotes, Sefaria links).
// The live server is a Cloudflare Worker: 128 MB of memory and a CPU-time limit per request. Past either one,
// Cloudflare ends the request and the client sees "Service Unavailable" (this happened to kisvei_search in Nov 2026).
//
// Usage: node scripts/test-mcp-budget.mjs [MCP_DATA_DIR=dist/mcp-data]
// Run before every publication (Pages build, Mafteach release). Fails when:
//   - a book has no search index, or its index does not match the book's paragraphs;
//   - a published MCP data file is over 10 MB (except files already over it on the live site, which may not grow);
//   - one library-wide search would read more than READ_BUDGET_MB of index data (deterministic: file sizes);
//   - any tool call fails, or takes more than CPU_BUDGET_MS of CPU, inside a 128 MB heap (as on Cloudflare).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = process.argv[2] || 'dist/mcp-data';
const READ_BUDGET_MB = 60;        // index data one library-wide search reads (h/e/d files; notes searches read notes files)
const READ_WARN_MB = 45;          // past this, plan the next step (a word index, so a search reads only its words' entries)
const CPU_BUDGET_MS = 1500;       // per tool call, measured here; the Worker failed at ~2,000 ms of the same work
const MAX_FILE = 10_000_000;
const GRANDFATHERED = { 'text/peri-tzadik.json': 13_500_000 };   // over 10 MB before this test; may not grow past this
let passed = 0;
const fail = [];
const check = (ok, what) => { ok ? passed++ : fail.push(what); };

// --- data checks
const { books } = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'));
const size = f => { try { return fs.statSync(path.join(DIR, f)).size; } catch { return -1; } };
const readJson = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
let mainBytes = 0, notesBytes = 0;
for (const b of books) {
  const paras = readJson(`text/${b.slug}.json`).paras.length;
  for (const [name, keys] of [[b.slug, ['h', 'e', 'd']], [`${b.slug}.notes`, ['n']]]) {
    if (size(`search/${name}.json`) < 0) { check(false, `search index missing: search/${name}.json`); continue; }
    const head = readJson(`search/${name}.json`);
    const files = head.parts ? Array.from({ length: head.parts }, (_, k) => `search/${name}.${k + 1}.json`) : [`search/${name}.json`];
    const counts = keys.map(() => 0);
    for (const f of files) {
      if (size(f) < 0) { check(false, `search index part missing: ${f}`); continue; }
      const part = head.parts ? readJson(f) : head;
      keys.forEach((k, i) => (counts[i] += part[k]?.length || 0));
      if (keys[0] === 'n') notesBytes += size(f); else mainBytes += size(f);
    }
    check(counts.every(c => c === paras), `search/${name}: ${counts.join('/')} entries for ${paras} paragraphs`);
  }
}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(DIR)) {
  const rel = path.relative(DIR, f).split(path.sep).join('/'), s = fs.statSync(f).size;
  check(s <= (GRANDFATHERED[rel] ?? MAX_FILE), `${rel} is ${(s / 1e6).toFixed(1)} MB (limit ${((GRANDFATHERED[rel] ?? MAX_FILE) / 1e6).toFixed(1)} MB)`);
}
check(mainBytes / 1e6 <= READ_BUDGET_MB, `a library-wide search reads ${(mainBytes / 1e6).toFixed(1)} MB of index (budget ${READ_BUDGET_MB} MB)`);
check(notesBytes / 1e6 <= READ_BUDGET_MB, `a library-wide notes search reads ${(notesBytes / 1e6).toFixed(1)} MB of index (budget ${READ_BUDGET_MB} MB)`);

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
for (const [name, args] of CALLS) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', child, JSON.stringify([name, args])], { encoding: 'utf8', timeout: 120000 });
  let out = null; try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
  const label = `${name} ${JSON.stringify(args)}`;
  if (!out) { check(false, `${label}: crashed (${(r.stderr || '').split('\n').find(l => /heap|Error/.test(l)) || 'exit ' + r.status})`); continue; }
  rows.push(`${String(out.ms).padStart(5)} ms  ${label.slice(0, 80)}  → ${out.first}`);
  check(out.status === 200 && !out.error, `${label}: ${out.error || 'HTTP ' + out.status}`);
  check(out.ms <= CPU_BUDGET_MS, `${label}: ${out.ms} ms CPU (budget ${CPU_BUDGET_MS} ms)`);
}
console.log(rows.join('\n'));
console.log(`search index read per library-wide search: ${(mainBytes / 1e6).toFixed(1)} MB (notes ${(notesBytes / 1e6).toFixed(1)} MB); budget ${READ_BUDGET_MB} MB`);
for (const [what, mb] of [['library-wide search', mainBytes / 1e6], ['notes search', notesBytes / 1e6]])
  if (mb > READ_WARN_MB) console.log(`::warning::MCP ${what} reads ${mb.toFixed(1)} MB of index (warn ${READ_WARN_MB} MB, limit ${READ_BUDGET_MB} MB): time to add a word index`);
if (fail.length) { console.error('MCP budget test FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log(`PASS MCP budget: ${passed} checks`);

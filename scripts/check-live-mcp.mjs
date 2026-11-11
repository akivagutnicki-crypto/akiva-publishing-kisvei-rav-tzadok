// Live health check of the Kisvei Rav Tzadok MCP server: every tool, as an MCP client calls it.
// Usage: node scripts/check-live-mcp.mjs [ENDPOINT]   (default: the Cloudflare Worker's /mcp)
// Exits 1 and prints what failed; .github/workflows/mcp-health.yml opens an issue then (and closes it on recovery).
const ENDPOINT = process.argv[2] || 'https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/mcp';
const SLOW_MS = 15000;
let id = 0;
async function rpc(method, params, headers = {}) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, { method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').find(l => l.startsWith('data:')).slice(5) : text); } catch {}
  return { status: res.status, j, text, ms: Date.now() - t0 };
}
const CALLS = [
  ['kisvei_list_books', {}, /25|\d+ books/],
  ['kisvei_search', { query: 'צוותא' }, /paragraphs? match/],
  ['kisvei_search', { query: '"ציד בפיו"', limit: 20 }, /paragraphs? match/],
  ['kisvei_search', { query: 'hidden light' }, /paragraphs? match/],
  ['kisvei_search', { query: 'Chagigah', fields: ['notes'] }, /paragraphs? match/],
  ['kisvei_get_text', { ref: 'Peri Tzadik, Sukkot 10' }, /Sukkot 10/],
  ['kisvei_get_contents', { book: 'Peri Tzadik' }, /contents/],
  ['kisvei_find_citing_passages', { source: 'Berakhot 6b' }, /cite Berakhot 6b/],
  ['kisvei_get_cited_sources', { ref: 'Tzidkat HaTzadik 100' }, /Sources cited/],
  ['kisvei_find_parallels', { ref: 'Peri Tzadik, Rosh Hashanah 5' }, /Parallels/],
  ['mafteach_find_topic', { query: 'emunah' }, /אמונה/],
  ['mafteach_lookup_source', { source: 'Bereishis 2:7' }, /Genesis 2:7/],
  ['mafteach_lookup_passage', { ref: 'Pri Tzaddik Vayechi 11' }, /Vayechi 11/],
  ['mafteach_search', { query: '"ויפח באפיו"' }, /Mafteach search/],
];
const fails = [], rows = [];
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'health-check', version: '1' } });
  if (init.status !== 200 || !init.j?.result) fails.push(`initialize: HTTP ${init.status} ${init.text.slice(0, 200)}`);
  const list = await rpc('tools/list', {});
  const names = new Set((list.j?.result?.tools || []).map(t => t.name));
  if (names.size < 11) fails.push(`tools/list: ${names.size} tools`);
  for (const [name, args, expect] of CALLS) {
    let r;
    try { r = await rpc('tools/call', { name, arguments: args }); } catch (e) { fails.push(`${name} ${JSON.stringify(args)}: ${e.message}`); continue; }
    const out = r.j?.result?.content?.[0]?.text || '';
    const err = r.status !== 200 ? `HTTP ${r.status} ${r.text.slice(0, 160)}` : r.j?.error ? r.j.error.message : r.j?.result?.isError ? out.slice(0, 200) : !expect.test(out) ? `unexpected reply: ${out.slice(0, 160)}` : null;
    rows.push(`${String(r.ms).padStart(6)} ms  ${name} ${JSON.stringify(args)}${err ? '  ✗ ' + err : ''}`);
    if (err) fails.push(`${name} ${JSON.stringify(args)}: ${err}`);
    else if (r.ms > SLOW_MS) fails.push(`${name} ${JSON.stringify(args)}: slow (${r.ms} ms)`);
  }
} catch (e) { fails.push(`server unreachable: ${e.message}`); }
console.log(rows.join('\n'));
if (fails.length) { console.log('\nMCP HEALTH CHECK FAILED:\n- ' + fails.join('\n- ')); process.exit(1); }
console.log(`\nMCP health: all ${CALLS.length + 2} calls OK`);

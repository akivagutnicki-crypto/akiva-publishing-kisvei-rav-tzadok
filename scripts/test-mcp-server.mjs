// Tests the Kisvei Rav Tzadok MCP server (netlify/functions/mcp.mjs) against the freshly built data
// (dist/mcp-data, from scripts/build-mcp-index.mjs): both protocol eras, every tool, and the error paths.
process.env.MCP_DATA_DIR = 'dist/mcp-data';
const { default: handler, config } = await import('../cloudflare/mcp.mjs');

let passed = 0;
const check = (ok, what) => { if (!ok) throw new Error('MCP server test failed: ' + what); passed++; };
const ORIGIN = 'https://akiva-publishing-kisvei-rav-tzadok.netlify.app';

async function send(body, headers = {}, method = 'POST') {
  const res = await handler(new Request(ORIGIN + '/mcp', {
    method, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  }), {});
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

// Earlier protocol versions: initialize, then requests without per-request metadata.
const META = 'io.modelcontextprotocol/';
let r = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
check(r.status === 200 && r.json.result.protocolVersion === '2025-06-18', 'initialize negotiates 2025-06-18');
check(r.json.result.capabilities.tools && r.json.result.serverInfo.name === 'kisvei-rav-tzadok-library' && r.json.result.instructions, 'initialize describes the server');
r = await send({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
check(r.json.result.protocolVersion === '2025-11-25', 'initialize offers its latest legacy version for an unknown one');
r = await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-protocol-version': '2025-06-18' });
check(r.status === 202 && !r.text, 'notifications get 202 and no body');
r = await send({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-protocol-version': '2025-06-18' });
const tools = r.json.result.tools;
check(tools.length === 6 && tools.every(t => t.name.startsWith('kisvei_') && t.inputSchema.type === 'object' && t.annotations.readOnlyHint === true), 'six read-only tools');
r = await send({ jsonrpc: '2.0', id: 4, method: 'ping' }, { 'mcp-protocol-version': '2025-11-25' });
check(r.status === 200 && r.json.result && !r.json.error, 'ping');
r = await send({ jsonrpc: '2.0', id: 5, method: 'nope/nothing' }, { 'mcp-protocol-version': '2025-06-18' });
check(r.json.error?.code === -32601, 'unknown legacy method is -32601');
r = await send([{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 7, method: 'tools/list' }]);
check(r.status === 200 && Array.isArray(r.json) && r.json.length === 2, 'JSON-RPC batch');
r = await send(null, {}, 'GET');
check(r.status === 405 && r.headers.get('allow')?.includes('POST'), 'GET is 405');
r = await send(null, {}, 'OPTIONS');
check(r.status === 204 && r.headers.get('access-control-allow-origin') === '*', 'CORS preflight');
r = await send('{not json');
check(r.status === 400 && r.json.error.code === -32700, 'parse error');
check(config.path.includes('/mcp'), 'function is routed at /mcp');

// 2026-07-28: version and capabilities in every request's _meta, mirrored in headers.
const meta = (v = '2026-07-28') => ({ [META + 'protocolVersion']: v, [META + 'clientCapabilities']: {}, [META + 'clientInfo']: { name: 'test', version: '1' } });
const modern = (id, method, params = {}, headers = {}) => send({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta() } },
  { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}), ...headers });
r = await modern(10, 'server/discover');
check(r.status === 200 && r.json.result.resultType === 'complete' && r.json.result.supportedVersions.includes('2026-07-28')
  && r.json.result.capabilities.tools && r.json.result._meta[META + 'serverInfo'].name === 'kisvei-rav-tzadok-library', 'server/discover');
r = await modern(11, 'tools/list');
check(r.json.result.resultType === 'complete' && r.json.result.tools.length === 6, 'modern tools/list');
r = await modern(12, 'tools/call', { name: 'kisvei_list_books', arguments: {} });
check(r.json.result.resultType === 'complete' && r.json.result.isError === false && r.json.result.content[0].text.includes('Resisei Layla'), 'modern tools/call');
r = await send({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'kisvei_list_books', arguments: {}, _meta: meta() } },
  { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': '=?base64?' + Buffer.from('kisvei_list_books').toString('base64') + '?=' });
check(r.status === 200 && !r.json.error, 'Base64-encoded Mcp-Name');
r = await send({ jsonrpc: '2.0', id: 14, method: 'tools/list', params: { _meta: meta('2099-01-01') } }, { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' });
check(r.status === 400 && r.json.error.code === -32022 && r.json.error.data.supported.includes('2026-07-28'), 'unsupported version is 400 / -32022');
r = await modern(15, 'tools/list', {}, { 'mcp-protocol-version': '2025-11-25' });
check(r.status === 400 && r.json.error.code === -32020, 'version header mismatch is 400 / -32020');
r = await send({ jsonrpc: '2.0', id: 16, method: 'tools/list', params: { _meta: meta() } }, { 'mcp-protocol-version': '2026-07-28' });
check(r.status === 400 && r.json.error.code === -32020, 'missing Mcp-Method is 400 / -32020');
r = await modern(17, 'tools/call', { name: 'kisvei_list_books', arguments: {} }, { 'mcp-name': 'kisvei_search' });
check(r.status === 400 && r.json.error.code === -32020, 'Mcp-Name mismatch is 400 / -32020');
r = await modern(18, 'resources/subscribe');
check(r.status === 404 && r.json.error.code === -32601, 'unknown modern method is 404 / -32601');
r = await send({ jsonrpc: '2.0', id: 19, method: 'tools/list', params: { _meta: { [META + 'protocolVersion']: '2026-07-28' } } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' });
check(r.status === 400 && r.json.error.code === -32602, 'missing clientCapabilities is 400 / -32602');

// Tools
async function tool(name, args) {
  const res = await send({ jsonrpc: '2.0', id: 100, method: 'tools/call', params: { name, arguments: args } }, { 'mcp-protocol-version': '2025-06-18' });
  if (res.json.error) return { error: res.json.error };
  return { text: res.json.result.content[0].text, isError: res.json.result.isError };
}
let t = await tool('kisvei_list_books', {});
check(['Resisei Layla', 'Tzidkat HaTzadik', 'Peri Tzadik', 'Mei HaShiloach', 'Beit Yaakov on Torah'].every(x => t.text.includes(x)), 'list_books');
t = await tool('kisvei_list_books', { response_format: 'json' });
check(JSON.parse(t.text).books.length >= 20, 'list_books json');
t = await tool('kisvei_get_contents', { book: 'Resisei Layla' });
check(t.text.includes('Resisei Layla 1 —') && t.text.includes('סימן א׳'), 'get_contents');
t = await tool('kisvei_get_contents', { book: 'Pri Tzaddik', filter: 'Noach', response_format: 'json' });
const noach = JSON.parse(t.text);
check(noach.book === 'Peri Tzadik' && noach.total > 0 && noach.sections.every(s => /Noach/i.test(s.ref + s.title + (s.part || ''))), 'get_contents with Ashkenazi title and filter');
t = await tool('kisvei_get_text', { ref: 'Resisei Layla 1:1' });
check(t.text.includes('הָאָדָם בָּעוֹלָם הַזֶּה צָרִיךְ לְצַוְותָא') && t.text.includes('Man in this world needs companionship') && /\[1\]/.test(t.text) && t.text.includes('Notes:'), 'get_text interlinear with notes');
t = await tool('kisvei_get_text', { ref: 'Resisei Layla 1:1', include_notes: false, view: 'english' });
check(!t.text.includes('Notes:') && t.text.includes('Man in this world needs companionship') && !t.text.includes('הָאָדָם בָּעוֹלָם'), 'get_text english without notes');
t = await tool('kisvei_get_text', { ref: 'Tzidkas HaTzaddik 100' });
check(!t.isError && t.text.includes('Ref: Tzidkat HaTzadik 100'), 'get_text Ashkenazi ref');
t = await tool('kisvei_get_text', { ref: 'רסיסי לילה, סימן ה׳' });
check(!t.isError && t.text.includes('Ref: Resisei Layla 5'), 'get_text Hebrew ref');
t = await tool('kisvei_get_text', { ref: 'Resisei Layla 8:1-2' });
check(!t.isError && t.text.includes('[Resisei Layla 8:1]') && t.text.includes('[Resisei Layla 8:2]') && !t.text.includes('[Resisei Layla 8:3]'), 'get_text range');
t = await tool('kisvei_get_text', { ref: 'Pri Tzaddik, Bereishis 1:2' });
check(!t.isError && t.text.includes('Peri Tzadik, Bereshit 1:2') && t.text.includes(' — '), 'get_text study edition');
t = await tool('kisvei_get_text', { ref: 'Peri Tzadik, Bereshit 1', edition: 'hebrew' });
check(!t.isError && t.text.includes('original Hebrew') && t.text.includes('[Peri Tzadik, Bereshit 1:1]') && !t.text.includes(' — '), 'get_text original Hebrew edition');
t = await tool('kisvei_get_text', { ref: 'Peri Tzadik, Bereshit 1:2', edition: 'hebrew' });
check(t.isError && t.text.includes('paragraph 1 only'), 'get_text explains a paragraph missing from one edition');
t = await tool('kisvei_get_text', { ref: 'Resisei Layla 999' });
check(t.isError && t.text.includes('Try:'), 'get_text unknown ref suggests refs');
t = await tool('kisvei_get_text', { ref: 'Resisei Layla 1:1', include_citations: true });
check(t.text.includes('Cites:') && t.text.includes('Berakhot 6b'), 'get_text with citations');

const t0 = Date.now();
t = await tool('kisvei_search', { query: 'צוותא' });
const ms = Date.now() - t0;
check(t.text.includes('Resisei Layla 1:1'), 'search Hebrew without nikkud');
t = await tool('kisvei_search', { query: 'לְצַוְותָא', response_format: 'json' });
let js = JSON.parse(t.text);
check(js.results.some(x => x.ref === 'Resisei Layla 1:1'), 'search Hebrew with nikkud');
t = await tool('kisvei_search', { query: '"hidden light"', books: ['Resisei Layla'], response_format: 'json' });
js = JSON.parse(t.text);
check(js.total > 0 && js.results.every(x => x.book === 'Resisei Layla'), 'search phrase in one book');
const sub = JSON.parse((await tool('kisvei_search', { query: 'שבת', response_format: 'json', limit: 1 })).text).total;
const whole = JSON.parse((await tool('kisvei_search', { query: 'שבת', whole_words: true, response_format: 'json', limit: 1 })).text).total;
const loose = JSON.parse((await tool('kisvei_search', { query: 'שבת', spelling: 'loose', response_format: 'json', limit: 1 })).text).total;
check(whole > 0 && whole < sub && loose >= sub, 'whole words narrow, loose spelling widens');
const without = JSON.parse((await tool('kisvei_search', { query: 'שבת -פורים', response_format: 'json', limit: 1 })).text).total;
check(without > 0 && without < sub, 'excluded word');
t = await tool('kisvei_search', { query: 'הקב"ה', limit: 3 });
check(!t.isError && /\d+ paragraphs? match/.test(t.text), 'abbreviation marks ignored');
t = await tool('kisvei_search', { query: 'zzzzqqq' });
check(!t.isError && t.text.startsWith('No paragraphs match'), 'search with no results');

t = await tool('kisvei_find_citing_passages', { source: 'Berachos 6b' });
check(t.text.includes('cite Berakhot 6b') && t.text.includes('Resisei Layla 1:1'), 'find_citing with Ashkenazi tractate');
t = await tool('kisvei_find_citing_passages', { source: 'Tehillim 92', response_format: 'json' });
js = JSON.parse(t.text);
check(js.total > 0 && js.passages.every(p => /^Psalms 92(:|$)/.test(p.cited)), 'find_citing a whole chapter');
t = await tool('kisvei_find_citing_passages', { source: 'Genesis 1:1-3', response_format: 'json' });
js = JSON.parse(t.text);
check(js.total > 0 && js.passages.every(p => /^Genesis 1:[123](:|$)/.test(p.cited)), 'find_citing a range of verses');
t = await tool('kisvei_find_citing_passages', { source: 'Berakhot 6', books: ['Resisei Layla'], response_format: 'json' });
js = JSON.parse(t.text);
check(js.total > 0 && js.passages.every(p => p.book === 'Resisei Layla' && /^Berakhot 6[ab]/.test(p.cited)), 'find_citing a daf in one book');
t = await tool('kisvei_get_cited_sources', { ref: 'Resisei Layla 1:1' });
check(t.text.includes('Berakhot 6b'), 'get_cited_sources');

t = await tool('kisvei_search', {});
check(t.isError && t.text.includes('"query" is required'), 'missing argument is a tool error');
t = await tool('kisvei_search', { query: 'x', colour: 'red' });
check(t.isError && t.text.includes('unknown argument'), 'unknown argument is a tool error');
t = await tool('kisvei_nothing', {});
check(t.error?.code === -32602, 'unknown tool is -32602');

console.log(`PASS MCP server: ${passed} checks (first full-library search ${ms} ms)`);

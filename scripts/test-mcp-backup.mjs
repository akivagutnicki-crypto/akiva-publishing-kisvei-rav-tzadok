// Tests the local backup MCP server (mcp-backup/server/index.mjs) over stdio, as the Claude desktop app runs it:
// against a local copy of the published site (dist/), then with that site gone (offline: answered from the disk cache).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
fs.copyFileSync('cloudflare/mcp.mjs', 'mcp-backup/server/mcp.mjs');
let passed = 0;
const check = (ok, what) => { if (!ok) throw new Error('MCP backup test failed: ' + what); passed++; };
const ROOT = path.resolve('dist');
const site = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/site\//, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200); fs.createReadStream(f).pipe(res);
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${site.address().port}/site`;
const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'kisvei-cache-'));
function server() {
  const p = spawn(process.execPath, ['mcp-backup/server/index.mjs'], { env: { ...process.env, KISVEI_SITE_ORIGIN: ORIGIN, KISVEI_CACHE_DIR: CACHE, NO_PROXY: '127.0.0.1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', id = 0; const waiting = new Map(); let err = '';
  p.stdout.on('data', d => { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, k); buf = buf.slice(k + 1); const m = JSON.parse(line); waiting.get(m.id)?.(m); } });
  p.stderr.on('data', d => { err += d; });
  const send = (method, params) => new Promise(r => { const i = ++id; waiting.set(i, r); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const note = method => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { p, send, note, err: () => err };
}
const tool = async (s, name, args) => { const r = await s.send('tools/call', { name, arguments: args }); return r.result?.content?.[0]?.text || JSON.stringify(r); };
const CALLS = [
  ['kisvei_list_books', {}, /books/],
  ['kisvei_search', { query: '"ציד בפיו"' }, /paragraphs match/],
  ['kisvei_search', { query: 'Chagigah', fields: ['notes'] }, /paragraphs match/],
  ['kisvei_get_text', { ref: 'Peri Tzadik, Sukkot 10' }, /Sukkot 10/],
  ['kisvei_find_citing_passages', { source: 'Berakhot 6b' }, /cite Berakhot 6b/],
  ['kisvei_find_parallels', { ref: 'Peri Tzadik, Rosh Hashanah 5' }, /Parallels/],
  ['mafteach_find_topic', { query: 'emunah' }, /אמונה/],
  ['mafteach_lookup_passage', { ref: 'Pri Tzaddik Vayechi 11' }, /Vayechi 11/],
];
let s = server();
const init = await s.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
check(init.result?.serverInfo?.name === 'kisvei-rav-tzadok-library', 'initialize');
s.note('notifications/initialized');
const list = await s.send('tools/list', {});
check(list.result.tools.length === 11, 'eleven tools');
for (const [n, a, re] of CALLS) check(re.test(await tool(s, n, a)), `${n} online`);
const bad = await s.send('tools/call', { name: 'kisvei_get_text', arguments: { ref: 'No Such Book 1' } });
check(bad.result?.isError || bad.error, 'errors come back as errors');
s.p.stdin.end(); await new Promise(r => s.p.on('exit', r));
// offline: the site is gone, a fresh server answers from the disk cache
await new Promise(r => site.close(r)); site.closeAllConnections?.();
s = server();
await s.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
for (const [n, a, re] of CALLS) check(re.test(await tool(s, n, a)), `${n} offline`);
s.p.stdin.end(); await new Promise(r => s.p.on('exit', r));
fs.rmSync(CACHE, { recursive: true, force: true });
console.log(`PASS MCP backup: ${passed} checks (online and offline)`);

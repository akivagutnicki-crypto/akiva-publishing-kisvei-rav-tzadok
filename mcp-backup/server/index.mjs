// Kisvei Rav Tzadok Library — local backup MCP server (stdio), for the Claude desktop app and Claude Code.
// The same server code as the live Cloudflare Worker (./mcp.mjs, copied from cloudflare/mcp.mjs when the bundle is
// built), reading the library files published on GitHub Pages directly — no Cloudflare, and none of a Worker's memory or
// CPU limits. Every file it reads is also kept in a disk cache, so it keeps working offline with the last copy it saw.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const ORIGIN = (process.env.KISVEI_SITE_ORIGIN || 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok').replace(/\/+$/, '');
const CACHE = process.env.KISVEI_CACHE_DIR
  || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'kisvei-library-mcp')
    : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'kisvei-library-mcp')
      : path.join(os.homedir(), '.cache', 'kisvei-library-mcp'));
const log = (...a) => process.stderr.write('[kisvei-backup] ' + a.join(' ') + '\n');   // stdout carries only MCP messages

// Library files: network first (always the latest publication), the disk copy when the network fails.
const netFetch = globalThis.fetch;
const cacheFile = url => path.join(CACHE, encodeURIComponent(url.slice(ORIGIN.length + 1)) || 'index');
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(ORIGIN + '/')) return netFetch(input, init);
  const file = cacheFile(url);
  try {
    const res = await netFetch(url, { ...init, signal: AbortSignal.timeout(60000) });
    if (res.ok) {
      const body = Buffer.from(await res.arrayBuffer());
      try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file + '.tmp', body); fs.renameSync(file + '.tmp', file); } catch (e) { log('cache write failed:', e.message); }
      return new Response(body, { status: 200, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } });
    }
    if (res.status === 404) return res;                                 // not published (the server falls back itself)
    log('HTTP', res.status, url);
  } catch (e) { log('offline or slow:', e.message, '— using the cached copy of', url.slice(ORIGIN.length)); }
  if (fs.existsSync(file)) return new Response(fs.readFileSync(file), { status: 200 });
  return new Response('unavailable offline', { status: 503 });
};

const { default: handler } = await import('./mcp.mjs');
let version = '2025-06-18';
async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
  const first = Array.isArray(msg) ? msg[0] : msg;
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (first?.method !== 'initialize') headers['mcp-protocol-version'] = version;
  const res = await handler(new Request(ORIGIN + '/mcp', { method: 'POST', headers, body: line }), { siteOrigin: ORIGIN, disableWarm: true });
  const text = await res.text();
  if (!text) return null;                                               // notifications: no reply
  const out = JSON.parse(text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').find(l => l.startsWith('data:')).slice(5) : text);
  if (first?.method === 'initialize' && out?.result?.protocolVersion) version = out.result.protocolVersion;
  return out;
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on('line', line => {
  if (!line.trim()) return;
  queue = queue.then(async () => {
    try { const out = await handle(line); if (out) process.stdout.write(JSON.stringify(out) + '\n'); }
    catch (e) {
      log('error:', e.stack || e.message);
      let id = null; try { id = JSON.parse(line).id ?? null; } catch {}
      if (id !== null) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e.message || e) } }) + '\n');
    }
  });
});
rl.on('close', () => queue.then(() => process.exit(0)));
log('ready; library', ORIGIN, '; cache', CACHE);

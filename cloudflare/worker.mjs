// Cloudflare Workers entry point for Akiva Publishing's existing read-only MCP server.
// The searchable texts remain published by GitHub Pages (same content as the reader).
import mcp from './mcp.mjs';

async function health(env) {
  const origin = String(env.MCP_SITE_ORIGIN || '').replace(/\/+$/, '');
  if (!origin) {
    return Response.json({ ok: false, error: 'MCP_SITE_ORIGIN is missing' }, { status: 503 });
  }
  try {
    const url = new URL('mcp-data/catalog.json', origin + '/');
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return Response.json({ ok: false, catalog_status: response.status, catalog_url: url.href }, { status: 503 });
    }
    const data = await response.json();
    if (!Array.isArray(data.books)) throw Error('Invalid library catalog');
    return Response.json({
      ok: true,
      service: 'Akiva Publishing MCP',
      tools: 11,
      books: data.books.length,
      catalog_url: url.href,
      mcp_endpoint: '/mcp',
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 503 });
  }
}

// ---- /ask: a short written answer to a question, from passages the reader already found (Mafteach search).
// The reader ranks the passages itself; this only writes 2-5 sentences that cite them as [Ref]. Cloudflare Workers AI.
const ASK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const ASK_ORIGINS = /^https:\/\/akivagutnicki-crypto\.github\.io$/;
const corsHeaders = request => {
  const o = request.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ASK_ORIGINS.test(o) ? o : 'https://akivagutnicki-crypto.github.io', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
};
const ASK_SYSTEM = `You help people find where Rav Tzadok HaKohen of Lublin discusses their question. You are given index lines from HaMafteach HaShalem (the index to his works) and short excerpts of the passages.
Answer in 2 to 5 sentences, in the language of the question (English unless the question is in Hebrew). Say which passages to read first and what each says that bears on the question.
Cite passages only as [Ref], copying the ref exactly as given, for example [Peri Tzadik, Behar 17]. Use only the material given: no other sources, quotations or claims. If none of the passages really answers the question, say so and name the ones that come closest. Plain prose, no lists, no sermon.`;
async function ask(request, env) {
  const headers = { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST a question' }), { status: 405, headers });
  if (!env.AI) return new Response(JSON.stringify({ error: 'AI is not enabled for this Worker' }), { status: 503, headers });
  const raw = await request.text();
  if (raw.length > 24000) return new Response(JSON.stringify({ error: 'too large' }), { status: 413, headers });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response(JSON.stringify({ error: 'bad JSON' }), { status: 400, headers }); }
  const q = String(body.q || '').trim().slice(0, 300);
  const passages = (Array.isArray(body.passages) ? body.passages : []).slice(0, 8).map(p => ({
    ref: String(p.ref || '').slice(0, 120),
    lines: (Array.isArray(p.lines) ? p.lines : []).slice(0, 4).map(l => String(l).slice(0, 300)),
    text: String(p.text || '').slice(0, 1500),
  })).filter(p => p.ref);
  if (q.length < 2 || !passages.length) return new Response(JSON.stringify({ error: 'need a question and passages' }), { status: 400, headers });
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ q, r: passages.map(p => p.ref), m: ASK_MODEL }))))].map(b => b.toString(16).padStart(2, '0')).join('');
  const cacheKey = new Request('https://ask-cache.akiva/' + digest);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache && await cache.match(cacheKey);
  if (hit) return new Response(await hit.text(), { headers });
  const user = `Question: ${q}\n\nPassages:\n` + passages.map(p => `[${p.ref}]\nIndex lines: ${p.lines.join(' | ')}\nExcerpt: ${p.text}`).join('\n\n');
  let answer = '';
  try {
    const r = await env.AI.run(ASK_MODEL, { messages: [{ role: 'system', content: ASK_SYSTEM }, { role: 'user', content: user }], max_tokens: 450, temperature: 0.2 });
    answer = String(r?.response || '').trim();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'AI unavailable' }), { status: 503, headers });
  }
  const refs = new Set(passages.map(p => p.ref));
  answer = answer.replace(/\[([^\]]{2,120})\]/g, (m, ref) => (refs.has(ref) ? m : ''));    // only the refs it was given
  const out = JSON.stringify({ answer, model: ASK_MODEL });
  if (cache && answer) await cache.put(cacheKey, new Response(out, { headers: { 'Cache-Control': 'max-age=604800' } }));
  return new Response(out, { headers });
}

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health' && request.method === 'GET') return health(env);
    if (pathname === '/ask' || pathname === '/ask/') return ask(request, env);
    if (pathname === '/' && request.method === 'GET') {
      return new Response('Akiva Publishing MCP server. Use /health for a browser-friendly status check and /mcp for MCP clients.', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    if (pathname !== '/mcp' && pathname !== '/mcp/') {
      return new Response('Akiva Publishing MCP: connect at /mcp', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return mcp(request, {
      siteOrigin: env.MCP_SITE_ORIGIN,
      // Avoid background full-index warmup on Cloudflare's free per-request CPU budget.
      disableWarm: true,
      waitUntil: promise => context.waitUntil(promise),
    });
  },
};

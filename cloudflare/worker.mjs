// Cloudflare Workers entry point for Akiva Publishing's existing read-only MCP server.
// The searchable texts remain published by GitHub Pages (same content as the reader).
import mcp from '../netlify/functions/mcp.mjs';

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
      tools: 6,
      books: data.books.length,
      catalog_url: url.href,
      mcp_endpoint: '/mcp',
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 503 });
  }
}

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health' && request.method === 'GET') return health(env);
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

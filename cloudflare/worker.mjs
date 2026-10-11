// Cloudflare Workers entry point for Akiva Publishing's existing read-only MCP server.
// The searchable texts remain published by GitHub Pages (same content as the reader).
import mcp from '../netlify/functions/mcp.mjs';

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname !== '/mcp' && pathname !== '/mcp/') {
      return new Response('Akiva Publishing MCP: connect at /mcp', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return mcp(request, {
      siteOrigin: env.MCP_SITE_ORIGIN,
      // The Netlify background full-index warmup is not suitable for
      // Cloudflare's free per-request CPU budget. Load requested books lazily.
      disableWarm: true,
      waitUntil: promise => context.waitUntil(promise),
    });
  },
};

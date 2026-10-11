// Fast local smoke test of the Cloudflare Worker adapter and existing MCP tools.
// Run after scripts/build-mcp-index.mjs; no Cloudflare credentials needed.
process.env.MCP_DATA_DIR = 'dist/mcp-data';
const { default: worker } = await import('../cloudflare/worker.mjs');
const env = { MCP_SITE_ORIGIN: 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok' };
const context = { waitUntil() {} };
const post = async (method, params = {}, id = 1) => {
  const req = new Request('https://akiva-publishing-mcp.example.workers.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const response = await worker.fetch(req, env, context);
  if (!response.ok) throw Error(method + ' HTTP ' + response.status);
  return response.json();
};
const initialization = await post('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'cloudflare-smoke-test', version: '1' },
});
if (initialization.result?.serverInfo?.name !== 'kisvei-rav-tzadok-library') throw Error('MCP initialize failed');
const listed = await post('tools/list');
if (listed.result?.tools?.length !== 7) throw Error('Expected seven MCP tools');
const books = await post('tools/call', { name: 'kisvei_list_books', arguments: { response_format: 'json' } });
const parsed = JSON.parse(books.result?.content?.[0]?.text ?? '{}');
if (!Array.isArray(parsed.books) || !parsed.books.some(b => /Resisei Layla/.test(b.title || b.name || ''))) {
  throw Error('MCP failed to load the expected catalog');
}
const root = await worker.fetch(new Request('https://example.workers.dev/'), env, context);
if (root.status !== 200) throw Error('Root status page should answer 200');
const badPath = await worker.fetch(new Request('https://example.workers.dev/not-a-route'), env, context);
if (badPath.status !== 404) throw Error('Unexpected route accepted');
console.log('Cloudflare adapter smoke test: seven tools and library catalog OK');

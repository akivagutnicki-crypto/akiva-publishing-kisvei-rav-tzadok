// Links HaMafteach topics to Yochai Knowledge Graph concepts.
// Runs in GitHub Actions; the key comes only from the YOCHAI_API_KEY secret.
// Output: sources/mafteach/yochai-concepts.json
//   { version, source, note, topics: { "<topic id>": [ {id, name, he, domain, sim, sources:[{title, ref, url}]} ] } }
// Yochai's concept texts are machine-synthesized, so we keep names and links, not the descriptions.
import fs from 'node:fs';

const URL_ = process.env.YOCHAI_URL || 'https://yochai-kg-gateway-production.up.railway.app/mcp';
const KEY = process.env.YOCHAI_API_KEY;
if (!KEY) { console.error('YOCHAI_API_KEY is not set'); process.exit(1); }
const MIN_SIM = Number(process.env.MIN_SIM || 0.8);
const PER_TOPIC = 3, SOURCES = 6, CONC = Number(process.env.CONC || 4);
const LIMIT = Number(process.env.LIMIT || 0);
const OUT = 'sources/mafteach/yochai-concepts.json';

let session = null, rid = 0;
async function rpc(method, params, notify = false) {
  const body = { jsonrpc: '2.0', method, params };
  if (!notify) body.id = ++rid;
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': KEY };
  if (session) h['mcp-session-id'] = session;
  for (let attempt = 0; ; attempt++) {
    let r;
    try { r = await fetch(URL_, { method: 'POST', headers: h, body: JSON.stringify(body) }); }
    catch (e) { if (attempt < 4) { await sleep(2000 * (attempt + 1)); continue; } throw e; }
    if (r.headers.get('mcp-session-id')) session = r.headers.get('mcp-session-id');
    if (notify) return null;
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await sleep(3000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`${method}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const txt = await r.text();
    let msg;
    if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
      const data = txt.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
      msg = data.map(d => { try { return JSON.parse(d); } catch { return null; } }).find(m => m && m.id === body.id);
    } else msg = JSON.parse(txt);
    if (!msg) throw new Error(`${method}: no response`);
    if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
    return msg.result;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tool(name, args) {
  const res = await rpc('tools/call', { name, arguments: args });
  if (res.structuredContent) return res.structuredContent;
  const t = (res.content || []).find(c => c.type === 'text');
  try { return JSON.parse(t.text); } catch { return {}; }
}

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'akiva-mafteach', version: '1' } });
await rpc('notifications/initialized', {}, true);

const g = JSON.parse(fs.readFileSync('sources/mafteach/glossary.json', 'utf8'));
let topics = g.terms.filter(t => t.kind === 'topic' && t.he);
if (LIMIT) topics = topics.slice(0, LIMIT);
const clean = s => String(s || '').replace(/["״׳']/g, '').trim();

const concepts = {}; // concept cache
const out = {};
let done = 0, linked = 0;
async function one(t) {
  const q = `${clean(t.he)}${t.en ? ' - ' + t.en : ''}`;
  let res;
  try { res = await tool('search_concepts', { query: q, limit: PER_TOPIC }); }
  catch (e) { console.error(t.id, e.message); return; }
  const hits = (res.concepts || []).filter(c => (c.similarity || 0) >= MIN_SIM);
  const list = [];
  for (const c of hits) {
    if (!concepts[c.canonical_id]) {
      let src = [];
      try {
        const s = await tool('get_concept_sources', { canonical_id: c.canonical_id, limit: SOURCES });
        src = (s.passages || []).filter(p => p.anchor).map(p => ({
          title: p.text_title || p.reference || p.text_slug, ref: p.anchor, url: p.deep_link || null,
        }));
      } catch (e) { console.error(c.canonical_id, e.message); }
      concepts[c.canonical_id] = { id: c.canonical_id, name: c.name, he: c.name_hebrew || '', domain: c.domain || '', sources: src };
    }
    list.push({ ...concepts[c.canonical_id], sim: Math.round(c.similarity * 1000) / 1000 });
  }
  if (list.length) { out[t.id] = list; linked++; }
  if (++done % 100 === 0) console.log(`${done}/${topics.length} topics, ${linked} linked`);
}
const queue = topics.slice();
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await one(queue.shift()); }));

fs.writeFileSync(OUT, JSON.stringify({
  version: new Date().toISOString().slice(0, 10),
  source: 'Yochai Knowledge Graph (yochai.lightningstudios.ai), for study and research',
  note: 'Concept names are machine-synthesized by Yochai; leads only, verify before citing.',
  min_similarity: MIN_SIM,
  topics: out,
}, null, 0) + '\n');
console.log(`done: ${linked} of ${topics.length} topics linked to ${Object.keys(concepts).length} concepts`);

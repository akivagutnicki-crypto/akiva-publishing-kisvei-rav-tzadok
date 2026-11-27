// Yochai leads for the Parallels panel: passages in Chassidus, Kabbalah, Machshava and Mussar that cite the same pasuk,
// daf or midrash as an Akiva Publishing edition note.
// Runs in GitHub Actions; the key comes only from the YOCHAI_API_KEY secret.
// In:  sources/mafteach/yochai-source-ids.json (Yochai id -> Sefaria ref of a cited source; Sefaria ref -> library passages)
//      genre-corpus.jsonl.gz (the Sefaria corpus of outside sefarim, release genre-corpus-2026-11) to name each lead's Sefaria ref
// Out: sources/mafteach/yochai-parallels.json  { version, note, passages: { "<library passage>": [[sefaria ref, he title, genre, via]] } }
// A lead is kept only when its own Hebrew quotes the cited source (four words in a row) and its Sefaria ref is found.
import fs from 'node:fs';
import zlib from 'node:zlib';

const URL_ = process.env.YOCHAI_URL || 'https://yochai-kg-gateway-production.up.railway.app/mcp';
const KEY = process.env.YOCHAI_API_KEY;
if (!KEY) { console.error('YOCHAI_API_KEY is not set'); process.exit(1); }
const CORPUS = process.env.CORPUS || 'genre-corpus.jsonl.gz';
const OUT = 'sources/mafteach/yochai-parallels.json';
const GENRE = { Chasidut: 'Chassidus', Musar: 'Mussar', 'Jewish Thought': 'Machshava', Kabbalah: 'Kabbalah' };
const PER_PASSAGE = 4, PER_SOURCE = 10;

let session = null, rid = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
async function tool(name, args) {
  const res = await rpc('tools/call', { name, arguments: args });
  if (res.structuredContent) return res.structuredContent;
  const t = (res.content || []).find(c => c.type === 'text');
  try { return JSON.parse(t.text); } catch { return {}; }
}
const norm = s => String(s || '').replace(/[֑-ׇ]/g, '').replace(/[^א-ת ]/g, ' ').replace(/[ךםןףץ]/g, c => 'כמנפצ'['ךםןףץ'.indexOf(c)]).replace(/\s+/g, ' ').trim();
const grams = (s, n = 4) => { const w = norm(s).split(' ').filter(x => x.length > 1); const out = new Set(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ')); return out; };
const titleKey = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/tz/g, 'z').replace(/ch/g, 'h').replace(/kh/g, 'h').replace(/aa/g, 'a');

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'akiva-mafteach', version: '1' } });
await rpc('notifications/initialized', {}, true);

const src = JSON.parse(fs.readFileSync('sources/mafteach/yochai-source-ids.json', 'utf8'));
const ids = Object.keys(src.ids);
// 1. the links of each cited source (aggregated per source; run_cypher returns at most 25 rows)
const links = {};
for (let i = 0; i < ids.length; i += 25) {
  const chunk = ids.slice(i, i + 25);
  const q = `MATCH (p:TextUnit)-[r:CONNECTS_TO]-(q:TextUnit) WHERE p.canonical_id IN $ids AND r.link_type IN ['Chasidut','Musar','Jewish Thought','Kabbalah']
             WITH p, collect(DISTINCT r.link_type + '|' + q.canonical_id) AS L RETURN p.canonical_id AS a, L[0..${PER_SOURCE}] AS L`;
  try {
    const res = await tool('run_cypher', { query: q, params: { ids: chunk } });
    for (const row of res.rows || []) links[row.a] = row.L.filter(x => !/mishneh-torah-vows/.test(x));
  } catch (e) { console.error('cypher', i, e.message); }
}
console.log('sources with links', Object.keys(links).length, 'of', ids.length);
// 2. the Hebrew of each cited source and each lead
const cache = {};
async function passage(id) {
  if (!(id in cache)) { try { cache[id] = await tool('lookup_passage', { reference: id }); } catch (e) { cache[id] = null; } }
  return cache[id];
}
// 3. the corpus by title, for Sefaria refs
const byTitle = new Map();
for (const line of zlib.gunzipSync(fs.readFileSync(CORPUS)).toString('utf8').split('\n')) {
  if (!line) continue;
  const e = JSON.parse(line); const k = titleKey(e.title);
  if (!byTitle.has(k)) byTitle.set(k, []);
  byTitle.get(k).push({ ref: e.ref, he_title: e.he_title, genre: e.genre, n: norm(e.he) });
}
function sefariaRef(p) {
  const list = byTitle.get(titleKey(p.text_title)) || [];
  const n = norm(p.hebrew); if (n.length < 40) return null;
  for (const probe of [n.slice(0, 60), n.slice(Math.floor(n.length / 2), Math.floor(n.length / 2) + 60)]) {
    const hit = list.find(x => x.n.includes(probe));
    if (hit) return hit;
  }
  return null;
}
const out = {}; const stats = { leads: 0, quoted: 0, named: 0, kept: 0 };
for (const [a, L] of Object.entries(links)) {
  const s = await passage(a); if (!s || !s.hebrew) continue;
  const sg = grams(s.hebrew);
  for (const item of L) {
    const [type, id] = item.split('|'); if (!GENRE[type]) continue;
    stats.leads++;
    const p = await passage(id); if (!p || !p.hebrew) continue;
    const pg = grams(p.hebrew); let shared = 0; for (const g of pg) if (sg.has(g)) { shared++; break; }
    if (!shared) continue;
    stats.quoted++;
    const hit = sefariaRef(p); if (!hit) continue;
    stats.named++;
    const via = src.ids[a];
    for (const lib of src.per[via] || []) {
      const l = out[lib] || (out[lib] = []);
      if (l.length < PER_PASSAGE && !l.some(x => x[0] === hit.ref)) { l.push([hit.ref, hit.he_title || p.text_title, GENRE[type], via]); stats.kept++; }
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify({ version: new Date().toISOString().slice(0, 10), source: 'Yochai Knowledge Graph links, checked against the text and named by Sefaria ref',
  note: 'Each lead quotes the same pasuk, daf or midrash (four words in a row) that the edition note cites. Leads to study, not verified citations.', stats, passages: out }, null, 0));
console.log('done', JSON.stringify(stats), 'library passages', Object.keys(out).length);

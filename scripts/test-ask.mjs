// Tests the worker's /ask endpoint (short written answers for the reader's Mafteach search) with a stand-in AI.
import worker from '../cloudflare/worker.mjs';
let seen = null;
const env = { AI: { run: async (model, input) => { seen = { model, input }; return { response: 'Start with [Peri Tzadik, Behar 17], which says the gift of Shabbat is unique to Israel; then [Made Up 1] and [Peri Tzadik, Shoftim 7].' }; } } };
const body = { q: 'Why is Shabbos called a gift?', passages: [{ ref: 'Peri Tzadik, Behar 17', lines: ['The gift of Shabbat is unique to Israel'], text: 'x' }, { ref: 'Peri Tzadik, Shoftim 7', lines: ['The gift of Shabbat is the giving of reward'], text: 'y' }] };
const r = await worker.fetch(new Request('https://w/ask', { method: 'POST', headers: { origin: 'https://akivagutnicki-crypto.github.io', 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
const j = await r.json();
console.log(r.status, r.headers.get('access-control-allow-origin'), j.answer);
if (!/\[Peri Tzadik, Behar 17\]/.test(j.answer) || /Made Up/.test(j.answer) || seen.input.messages[1].content.indexOf('[Peri Tzadik, Shoftim 7]') < 0) throw new Error('ask failed');
const pre = await worker.fetch(new Request('https://w/ask', { method: 'OPTIONS', headers: { origin: 'https://akivagutnicki-crypto.github.io' } }), env, {});
const none = await worker.fetch(new Request('https://w/ask', { method: 'POST', body: '{}' }), {}, {});
console.log('preflight', pre.status, 'no AI', none.status);
console.log('PASS /ask');

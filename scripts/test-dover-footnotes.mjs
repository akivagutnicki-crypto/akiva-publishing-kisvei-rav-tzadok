// Ensures every English source footnote from the Dover Tzedek Source Expansion
// Word document reaches the published reader, once, on a real phrase.
import fs from 'node:fs';
import vm from 'node:vm';

const pack = JSON.parse(fs.readFileSync('sources/akiva/footnotes/Dover_Tzedek_Source_Expansion.json', 'utf8'));
const dir = 'dist/library/data/dover-tzedek';
const urlArg = process.argv.indexOf('--url');
const publicBase = urlArg < 0 ? null : process.argv[urlArg + 1];
if (urlArg >= 0 && !publicBase) throw new Error('--url requires the public library URL');
// An installed reader must show current Dover notes on its first online load,
// even when a previous edition was saved. Offline reading must still work.
async function checkDoverRefresh() {
  const asset = async file => {
    if (!publicBase) return fs.readFileSync(`dist/library/${file}`, 'utf8');
    const url = new URL(file, publicBase.endsWith('/') ? publicBase : publicBase + '/');
    url.searchParams.set('dover-cache-check', String(Date.now()));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot read ${file}: HTTP ${response.status}`);
    return response.text();
  };
  const [worker, html] = await Promise.all([asset('sw.js'), asset('index.html')]);
  const editionFunction = html.match(/^const editionDataUrl = url => [\s\S]*?;\s*(?=const catalogReady)/m)?.[0];
  if (!editionFunction) throw new Error('Reader data URL function missing');
  const currentUrl = vm.runInNewContext(editionFunction + '\neditionDataUrl("data/dover-tzedek/1-2.json")');
  if (!currentUrl.includes('20261018-dover-source-quotes-2570'))
    throw new Error('Dover still uses its old edition cache key');
  if (!worker.includes('dover-source-quotes-20261018'))
    throw new Error('Installed reader shell has no Dover update version');
  const handlers = {}, entries = new Map();
  const request = new Request('https://reader.example/library/data/dover-tzedek/1-2.json?edition=previous');
  entries.set(request.url, new Response('old Dover notes'));
  let offline = false, fetchOptions;
  const cache = {
    match: async req => entries.get(req.url || req)?.clone(),
    put: async (req, response) => { entries.set(req.url || req, response.clone()); }
  };
  vm.runInNewContext(worker, {
    URL, Request, Response, setTimeout: () => 0,
    self: {registration:{scope:'https://reader.example/library/'}, addEventListener:(type, handler) => {handlers[type] = handler;}},
    caches:{open:async()=>cache, match:cache.match},
    fetch:async (req, options) => {fetchOptions = options; if (offline) throw new Error('offline'); return new Response('current Dover quotations');}
  });
  let reply;
  const event = {request, respondWith:promise=>{reply=promise;}, waitUntil:()=>{}};
  handlers.fetch(event);
  if (await (await reply).text() !== 'current Dover quotations' || fetchOptions?.cache !== 'no-cache')
    throw new Error('Installed reader serves stale Dover notes while online');
  offline = true;
  handlers.fetch(event);
  if (await (await reply).text() !== 'current Dover quotations')
    throw new Error('Dover offline fallback lost the saved notes');
}
await checkDoverRefresh();
const expected = new Map(pack.notes.map(note => [note.number, note]));
const seen = new Map();
for (const f of fs.readdirSync(dir).filter(f => /^\d+-\d+\.json$/.test(f))) {
  let items;
  if (publicBase) {
    const url = new URL(`data/dover-tzedek/${f}`, publicBase.endsWith('/') ? publicBase : publicBase + '/');
    url.searchParams.set('quotation-check', String(Date.now()));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot read ${f}: HTTP ${response.status}`);
    items = await response.json();
  } else items = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  for (const item of items) {
    for (const note of item.footnotes || []) {
      if (seen.has(note.number)) throw new Error(`Footnote ${note.number} published twice`);
      if (!Array.isArray(item.p) || !item.p[note.phraseIndex]) throw new Error(`Footnote ${note.number} has no phrase in ${f}`);
      const text = (note.paragraphs || []).map(p => p.text || '').join(' ').trim();
      if (!/[A-Za-z]{3}/.test(text)) throw new Error(`Footnote ${note.number} has no English text`);
      const sourceNote = expected.get(note.number);
      if (!sourceNote) throw new Error(`Unexpected Dover footnote ${note.number}`);
      if (JSON.stringify(note.paragraphs) !== JSON.stringify(sourceNote.paragraphs))
        throw new Error(`Footnote ${note.number} does not contain the complete current quotation`);
      const words = String(item.p[note.phraseIndex][0]).replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean);
      if (!(note.heWord >= 1 && note.heWord <= words.length)) throw new Error(`Footnote ${note.number} is not beside a Hebrew word`);
      seen.set(note.number, f);
    }
  }
}
const missing = pack.notes.filter(n => !seen.has(n.number)).map(n => n.number);
if (missing.length) throw new Error('Missing Dover Tzedek footnotes: ' + missing.slice(0, 20).join(', '));
console.log(`PASS Dover Tzedek${publicBase ? ' publicly verified' : ''}: ${seen.size} complete English source footnotes placed beside their Hebrew words.`);

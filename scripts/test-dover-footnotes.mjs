// Verify that installed readers refresh to the reviewed Dover edition, then run
// the same clean-baseline, approved-source and Hebrew-anchor checks as publication.
import fs from 'node:fs';
import vm from 'node:vm';

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
  if (!currentUrl.includes('-dover-reviewed-parallels-v3'))
    throw new Error('Dover still uses its old edition cache key');
  if (!worker.includes('-dover-reviewed-parallels-v3'))
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
// Share the strict publication checks without invoking the browser suite.
if (!process.argv.includes('--data-only')) process.argv.push('--data-only');
await import('./test-dover-revisions.mjs');

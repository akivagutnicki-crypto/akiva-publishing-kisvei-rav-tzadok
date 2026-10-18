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
  if (!currentUrl.includes('20261018-dover-elaboration-sources'))
    throw new Error('Dover still uses its old edition cache key');
  if (!worker.includes('dover-elaboration-sources-20261018'))
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
const review = JSON.parse(fs.readFileSync('editorial/dover-elaboration-source-review.json', 'utf8'));
const reviewedSources = [...new Map(review.review.flatMap(entry => entry.results.filter(r => r.status === 'new')).map(source => [source.number, source])).values()];
if (review.triggerCount !== 155 || reviewedSources.length !== review.notesAdded.length)
  throw new Error('Dover elaboration review is incomplete');
const bareHebrew = text => String(text).replace(/<[^>]+>/g, '').replace(/[^\u05d0-\u05ea]/g, '');
const sourceCache = new Map();
for (const source of reviewedSources) {
  const note = expected.get(source.number);
  if (!note || !['שמעתי', 'קבלתי', 'להאריך'].some(cue => note.heWordText.includes(cue)))
    throw new Error('New source note is missing its Hebrew elaboration cue: ' + source.number);
  if (note.paragraphs[0].rich[0].text !== 'Parallel: ' + source.sourceRef ||
      !note.paragraphs[0].text.endsWith('“' + source.translation.trim() + '”'))
    throw new Error('New source note lost its exact citation or full translation: ' + source.number);
  const path = source.sourcePath.replace(/^reader-repo\//, '');
  if (!sourceCache.has(path)) {
    const strings = [];
    const walk = value => {
      if (typeof value === 'string') strings.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    walk(raw.text ?? raw);
    sourceCache.set(path, bareHebrew(strings.join(' ')));
  }
  const original = sourceCache.get(path);
  let cursor = 0;
  for (const excerpt of source.hebrewQuote.split(/…|\.\.\./)) {
    const quote = bareHebrew(excerpt);
    if (!quote) continue;
    const found = original.indexOf(quote, cursor);
    if (found < 0) throw new Error('Quoted Hebrew does not match its source: ' + source.number);
    cursor = found + quote.length;
  }
}
const seen = new Map();
// The uploaded revision adds translated parallel passages around these reviewed
// quotations. Keep the original source-evidence checks above, then compare the
// final reader with the complete late-published revision when it is present.
let publicationExpected = expected;
const readPublication = async file => {
  if (!publicBase) return JSON.parse(fs.readFileSync(`dist/library/${file}`, 'utf8'));
  const url = new URL(file, publicBase.endsWith('/') ? publicBase : publicBase + '/');
  url.searchParams.set('dover-publication-check', String(Date.now()));
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Cannot read ${file}: HTTP ${response.status}`);
  return response.json();
};
const publicationToc = await readPublication('data/dover-tzedek/toc.json');
if (['20261018-dover-revisions-v1', '20261018-dover-revisions-v2'].includes(publicationToc.revisedFootnotes?.release)) {
  const publication = await readPublication('dover-revisions-report.json');
  if (publication.release !== publicationToc.revisedFootnotes.release || publication.expectedNotes.length !== expected.size)
    throw new Error('Dover revision publication report is incomplete');
  publicationExpected = new Map(publication.expectedNotes.map(note => [note.number, note]));
  for (const note of pack.notes) {
    const published = publicationExpected.get(note.number);
    // Every earlier complete source quotation, including secondary paragraphs,
    // must remain verbatim. The uploaded revision cannot replace it by a teaser.
    if (!published || note.paragraphs.some(p => !published.paragraphs.some(q => JSON.stringify(p) === JSON.stringify(q))))
      throw new Error('Dover revision lost an earlier complete quotation: ' + note.number);
  }
}
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
      if (JSON.stringify(note.paragraphs) !== JSON.stringify(publicationExpected.get(note.number).paragraphs))
        throw new Error(`Footnote ${note.number} does not contain the complete current quotation`);
      const words = String(item.p[note.phraseIndex][0]).replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean);
      if (!(note.heWord >= 1 && note.heWord <= words.length)) throw new Error(`Footnote ${note.number} is not beside a Hebrew word`);
      if (sourceNote.heWordText && bareHebrew(words[note.heWord - 1]) !== sourceNote.heWordText)
        throw new Error(`Footnote ${note.number} moved away from its Hebrew word`);
      seen.set(note.number, f);
    }
  }
}
const missing = pack.notes.filter(n => !seen.has(n.number)).map(n => n.number);
if (missing.length) throw new Error('Missing Dover Tzedek footnotes: ' + missing.slice(0, 20).join(', '));
console.log(`PASS Dover Tzedek${publicBase ? ' publicly verified' : ''}: ${seen.size} complete English source footnotes placed beside their Hebrew words.`);

'use strict';

// Focused asynchronous safety checks. This executes the candidate's real OCR
// controller and PDF-loading functions with only browser/worker/network I/O
// mocked. No browser automation, app-source mutation, or real OCR request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const candidate = path.resolve(process.argv[2] || 'dist/sefer-studio/index.html');
const html = fs.readFileSync(candidate, 'utf8');
function section(first, last) {
  const start = html.indexOf(first), end = html.indexOf(last, start);
  assert(start >= 0 && end > start, 'Candidate section exists: ' + first);
  return html.slice(start, end);
}
const healthCode = section('  const VISION_OCR_DEFAULT_LIMITS =', '  // OCR text belongs to a source document and page');
const controllerCode = section('  // OCR text belongs to a source document and page', '  async function exportEditedBinaryPdf(');
const loadCode = section('  async function loadPdfBytes(', '  async function renderPdfThumbnails(');
const bridgeCode = section('  // BEGIN STUDIO PDF BRIDGE', '  // END STUDIO PDF BRIDGE');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };

function clock() {
  let now = 1000000, id = 0;
  const timers = new Map();
  return {
    get now() { return now; },
    setTimeout(fn, delay = 0) { const key = ++id; timers.set(key, {at: now + Math.max(0, Number(delay) || 0), fn}); return key; },
    clearTimeout(key) { timers.delete(key); },
    due() { for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); } },
    next() { if (!timers.size) return false; now = Math.min(...[...timers.values()].map(x => x.at)); this.due(); return true; },
    advance(ms) { now += ms; this.due(); },
    pending() { return [...timers.values()].map(t => t.at - now); }
  };
}

function element(tag = 'div') {
  let text = '';
  const classes = new Set();
  return {
    tagName: tag, value: '', checked: false, disabled: false, readOnly: false, dir: 'auto', title: '', options: [], children: [], dataset: {}, listeners: {},
    classList: {add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); }, contains(n) { return classes.has(n); }, toggle(n, value) { const yes = value === undefined ? !classes.has(n) : value; yes ? classes.add(n) : classes.delete(n); return yes; }},
    get textContent() { return text; },
    set textContent(value) { text = String(value); if (value === '') { this.children = []; this.options = []; } },
    appendChild(child) { this.children.push(child); if (child.tagName === 'option') this.options.push(child); return child; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    removeAttribute(name) { delete this[name]; },
    focus() {}, setSelectionRange() {}, click() {}, remove() {}
  };
}

function fixture(options = {}) {
  const time = clock(), nodes = new Map(), actions = new Map(), canvases = [], workers = [], calls = [], requests = [], toasts = [];
  let nextLoad;
  const get = id => { if (!nodes.has(id)) nodes.set(id, element(id === 'pdf-ocr-result-page' ? 'select' : 'div')); return nodes.get(id); };
  const action = name => { if (!actions.has(name)) actions.set(name, element('button')); return actions.get(name); };
  const controls = ['pdf-ocr-engine','pdf-ocr-lang','pdf-ocr-quality','pdf-ocr-scope','pdf-ocr-range-start','pdf-ocr-range-end','pdf-ocr-rescan','pdf-vision-layout','pdf-vision-endpoint','pdf-vision-access','pdf-vision-connection-file'].map(get);
  controls.push(action('ocr'), action('ocr-connect'), action('ocr-load-connection'));
  Object.entries({'pdf-ocr-engine': options.engine || 'local', 'pdf-ocr-lang': 'heb+eng', 'pdf-ocr-quality': '300', 'pdf-ocr-scope': 'all', 'pdf-ocr-range-start': '1', 'pdf-ocr-range-end': String(options.pages || 3), 'pdf-vision-layout': 'rtl-columns', 'pdf-vision-endpoint': 'https://ocr.example/ocr', 'pdf-vision-access': 'fixture-access-code'}).forEach(([id, value]) => { get(id).value = value; });
  function makePdf(name, count) {
    return {name, numPages: count, async getPage(pageNumber) {
      if (options.getPage) await options.getPage({name, page: pageNumber});
      return {
        getViewport: ({scale}) => ({width: 504 * scale, height: 720 * scale}),
        render({canvasContext}) { canvasContext.canvas.page = pageNumber; canvasContext.canvas.source = name; return {promise: Promise.resolve(), cancel() {}}; },
        async getTextContent() { return {items: options.textLayer && options.textLayer[pageNumber] ? [{str: options.textLayer[pageNumber]}] : []}; },
        cleanup() {}
      };
    }};
  }
  const bytes = new Uint8Array([1, 2, 3]);
  const pdfState = {pdfBytes: bytes, pdfJsDocSource: bytes, pdfJsDoc: makePdf('A', options.pages || 3), fileName: 'A.pdf', pageCount: options.pages || 3, currentPage: 1, ocrText: '', ocrRunning: false, overlays: {}, pdfFootnotes: {}};
  function makeWorker() {
    const worker = {id: workers.length + 1, terminateCount: 0, async setParameters() {}, recognize(canvas) {
      const call = {page: canvas.page, source: canvas.source, worker: worker.id}; calls.push(call);
      if (options.recognize) return options.recognize(call, calls.length);
      return Promise.resolve({data: {text: options.emptyPages?.includes(call.page) ? '' : 'Recognized page ' + call.page, blocks: []}});
    }, async terminate() { worker.terminateCount++; }};
    workers.push(worker); return worker;
  }
  const response = (status, data, retry = null) => ({ok: status >= 200 && status < 300, status, headers: {get: name => name.toLowerCase() === 'retry-after' ? retry : null}, async json() { return data; }});
  const document = {
    baseURI: 'https://example.test/sefer-studio/',
    getElementById: get,
    querySelector(selector) { const match = /data-pdf-action="([^"]+)"/.exec(selector); return match ? action(match[1]) : element(); },
    querySelectorAll(selector) { return selector === '[data-pdf-action="ocr"]' ? [action('ocr')] : controls; },
    dispatchEvent() {}, body: element('body'),
    createElement(tag) {
      if (tag !== 'canvas') return element(tag);
      const canvas = {width: 0, height: 0, getContext() { return {canvas, fillRect() {}, drawImage() {}}; }, toDataURL() { return 'data:image/jpeg;base64,/9j/AA=='; }};
      canvases.push(canvas); return canvas;
    }
  };
  class FakeDate extends Date { static now() { return time.now; } }
  const context = vm.createContext({
    pdfState, document, Uint8Array, TextEncoder, URL, Blob, AbortController, crypto: crypto.webcrypto, Date: FakeDate,
    performance: {now: () => time.now}, setTimeout: time.setTimeout.bind(time), clearTimeout: time.clearTimeout.bind(time),
    toast: (message, kind) => toasts.push({message, kind}),
    Tesseract: {PSM: {AUTO: 3, SINGLE_LINE: 7}, createWorker() { const worker = makeWorker(); return options.createWorker ? options.createWorker(worker) : Promise.resolve(worker); }},
    pdfjsLib: {GlobalWorkerOptions: {}, getDocument() { assert(nextLoad, 'Replacement PDF is configured'); const pdf = nextLoad; nextLoad = null; return {promise: Promise.resolve(pdf)}; }},
    renderPdfThumbnails() {}, async renderCurrentPdfPage() {},
    fetch: async (url, init) => {
      const req = {url, method: init.method, page: init.body ? JSON.parse(init.body).pageNumber : null, at: time.now}; requests.push(req);
      if (init.method === 'GET') return response(200, {ready: true, provider: 'Fixture AI', model: 'fixture', limits: {maxRequestBytes: 12000000, maxImageDataUrlChars: 12000000, maxDimension: 6000, maxPixels: 20000000}});
      if (options.post) return options.post(req, init, response);
      return response(200, {text: 'Vision page ' + req.page, warnings: [], uncertain: [], provider: 'Fixture AI', model: 'fixture'});
    }
  });
  vm.runInContext(healthCode + controllerCode + loadCode + bridgeCode, context, {filename: candidate});
  context.showOcrPage(1);
  const api = {
    context, pdfState, time, nodes, actions, canvases, workers, calls, requests, toasts, get,
    run: () => context.runOcrOnCurrentPage(), stop: () => context.stopOcrRun(),
    rows: () => plain(vm.runInContext('[...ocrResults.entries()]', context)),
    row: page => plain(vm.runInContext('ocrResults.get(' + page + ') || null', context)),
    counts: () => plain(context.ocrPageCounts(Array.from({length: pdfState.pageCount}, (_, i) => i + 1))),
    active: () => vm.runInContext('activeOcrRun', context),
    status: () => get('pdf-ocr-status').textContent,
    async replace(name = 'B', count = 2, keep = true) { nextLoad = makePdf(name, count); await context.loadPdfBytes(new Uint8Array([8, 9, name.charCodeAt(0)]), name + '.pdf', keep); },
    async flush(turns = 80) { for (let i = 0; i < turns; i++) { await Promise.resolve(); time.due(); } },
    async until(check, label, advance = false) {
      for (let i = 0; i < 180; i++) { await this.flush(); if (check()) return; if (advance) time.next(); }
      throw new Error('Did not settle: ' + label + '; status=' + this.status() + '; timers=' + time.pending());
    },
    async finish(promise, label) {
      let done = false, failure;
      promise.then(() => { done = true; }, error => { done = true; failure = error; });
      await this.until(() => done, label, true);
      if (failure) throw failure;
    }
  };
  return api;
}

const checks = [];
async function check(name, fn) { await fn(); checks.push(name); }

(async () => {
  await check('Three-page completion reuses one worker and counts a blank page honestly', async () => {
    const f = fixture({emptyPages: [3]}); await f.finish(f.run(), 'complete three pages');
    assert.deepEqual(f.calls.map(c => c.page), [1, 2, 3]); assert.equal(f.workers.length, 1); assert.equal(f.workers[0].terminateCount, 1);
    assert.deepEqual(f.counts(), {saved: 3, recognized: 2, edited: 0, empty: 1, failed: 0, fallback: 0, missing: 0});
    assert.equal(f.get('pdf-ocr-output').value, 'Recognized page 1'); assert.equal(f.pdfState.ocrSourcePage, 1);
    assert.equal(f.get('pdf-ocr-progress').value, 3); assert(f.canvases.every(c => c.width === 1 && c.height === 1));
    const exported = f.context.buildOcrTextExport([1, 2, 3]); assert(exported.indexOf('Page 1 of 3') < exported.indexOf('Page 2 of 3')); assert.match(exported, /NO TEXT FOUND/); assert.doesNotMatch(exported, /PARTIAL/);
  });

  await check('Stop preserves completed pages; late recognition is ignored; resume skips saved pages', async () => {
    const pending = deferred(); let stalled = false;
    const f = fixture({recognize(call) { if (call.page === 2 && !stalled) { stalled = true; return pending.promise; } return Promise.resolve({data: {text: 'Page ' + call.page, blocks: []}}); }});
    const running = f.run(); await f.until(() => f.calls.length === 2, 'page two begins'); f.stop(); await f.finish(running, 'stop while recognizing');
    assert.equal(f.workers[0].terminateCount, 1); assert.deepEqual(f.rows().map(x => x[0]), [1]); assert.equal(f.get('pdf-ocr-progress').value, 1);
    assert.equal(f.counts().missing, 2); assert.match(f.status(), /stopped/);
    pending.resolve({data: {text: 'LATE OLD RESULT', blocks: []}}); await f.flush(); assert.equal(f.row(2), null);
    await f.finish(f.run(), 'resume unfinished pages'); assert.deepEqual(f.calls.map(c => c.page), [1, 2, 2, 3]); assert.equal(f.counts().saved, 3);
  });

  await check('A worker initialized after source replacement is terminated and never recognizes', async () => {
    const init = deferred(); const f = fixture({createWorker() { return init.promise; }});
    const running = f.run(); await f.until(() => f.workers.length === 1, 'worker initialization starts');
    await f.replace('B', 2, true); await f.finish(running, 'source replacement cancels initialization');
    assert.equal(f.rows().length, 0); assert.equal(f.get('pdf-ocr-output').value, ''); assert.equal(f.pdfState.fileName, 'B.pdf');
    const status = f.status(); init.resolve(f.workers[0]); await f.flush();
    assert.equal(f.workers[0].terminateCount, 1); assert.equal(f.calls.length, 0); assert.equal(f.status(), status); assert.equal(f.rows().length, 0);
  });

  await check('Repeated Stop and Run cannot accumulate pending worker initializations', async () => {
    const init = deferred(); let creations = 0;
    const f = fixture({pages: 1, createWorker(worker) { return ++creations === 1 ? init.promise : Promise.resolve(worker); }});
    const first = f.run(); await f.until(() => f.workers.length === 1, 'first initializer starts'); f.stop(); await f.finish(first, 'stop pending initializer');
    assert.equal(f.actions.get('ocr').disabled, true);
    for (let i = 0; i < 3; i++) { await f.finish(f.run(), 'blocked repeated start'); f.stop(); }
    assert.equal(f.workers.length, 1); assert.equal(f.calls.length, 0);
    init.resolve(f.workers[0]); await f.flush(); assert.equal(f.workers[0].terminateCount, 1); assert.equal(f.actions.get('ocr').disabled, false);
    await f.finish(f.run(), 'start after late initializer cleanup'); assert.equal(f.workers.length, 2); assert.equal(f.calls.length, 1); assert.equal(f.counts().saved, 1);
  });

  for (const rescan of [false, true]) {
    await check('A future-page correction made after launch is preserved with Rescan=' + rescan, async () => {
      const firstPage = deferred();
      const f = fixture({recognize(call) { return call.page === 1 ? firstPage.promise : Promise.resolve({data: {text: 'Fresh page ' + call.page, blocks: []}}); }});
      f.get('pdf-ocr-rescan').checked = rescan;
      const running = f.run(); await f.until(() => f.calls.length === 1, 'page one held during future edit');
      f.pdfState.currentPage = 2; f.context.showOcrPage(2);
      f.get('pdf-ocr-output').value = 'Do not overwrite this new page-two correction'; f.context.persistDisplayedOcrText();
      firstPage.resolve({data: {text: 'Fresh page one', blocks: []}}); await f.finish(running, 'finish with edited future page');
      assert.deepEqual(f.calls.map(c => c.page), [1, 3]); assert.equal(f.row(2).status, 'edited'); assert.equal(f.row(2).text, 'Do not overwrite this new page-two correction');
      assert.equal(f.get('pdf-ocr-output').value, 'Do not overwrite this new page-two correction'); assert.equal(f.get('pdf-ocr-progress').value, 3);
      assert.deepEqual(f.counts(), {saved: 3, recognized: 2, edited: 1, empty: 0, failed: 0, fallback: 0, missing: 0});
    });
  }

  await check('Late results from an old PDF cannot overwrite a new active run or unlock it', async () => {
    const a = deferred(), b = deferred();
    const f = fixture({pages: 1, recognize(call) { return call.source === 'A' ? a.promise : b.promise; }});
    const first = f.run(); await f.until(() => f.calls.length === 1, 'old recognition starts');
    await f.replace('B', 1, true); await f.finish(first, 'old run aborts');
    const second = f.run(); await f.until(() => f.calls.length === 2, 'new recognition starts'); const active = f.active();
    a.resolve({data: {text: 'OLD PRIVATE PAGE', blocks: []}}); await f.flush();
    assert.equal(f.active(), active); assert.equal(f.pdfState.ocrRunning, true); assert.equal(f.get('pdf-ocr-output').readOnly, true); assert.equal(f.rows().length, 0);
    b.resolve({data: {text: 'NEW PDF RESULT', blocks: []}}); await f.finish(second, 'new result accepted');
    assert.equal(f.row(1).text, 'NEW PDF RESULT'); assert.equal(f.get('pdf-ocr-output').value, 'NEW PDF RESULT');
  });

  await check('Failed rescans retain manually corrected text and report partial output', async () => {
    let fail = false; const f = fixture({pages: 1, textLayer: {1: 'Older embedded text'}, recognize() { return fail ? Promise.reject(new Error('Fixture OCR failure')) : Promise.resolve({data: {text: 'Original scan', blocks: []}}); }});
    await f.finish(f.run(), 'initial scan'); f.get('pdf-ocr-output').value = 'Corrected Hebrew text'; f.context.persistDisplayedOcrText(); assert.equal(f.row(1).status, 'edited');
    fail = true; f.get('pdf-ocr-rescan').checked = true; await f.finish(f.run(), 'failed rescan');
    assert.equal(f.row(1).text, 'Corrected Hebrew text'); assert.equal(f.get('pdf-ocr-output').value, 'Corrected Hebrew text'); assert.equal(f.row(1).status, 'failed');
    assert.equal(f.counts().failed, 1); assert.match(f.context.buildOcrTextExport([1]), /PARTIAL/); assert.match(f.status(), /1 failed/);
  });

  await check('Manual and MCP page edits and undo survive page navigation', async () => {
    const f = fixture({pages: 2}); await f.finish(f.run(), 'scan two pages');
    f.get('pdf-ocr-output').value = 'Manual page one'; f.context.persistDisplayedOcrText();
    f.pdfState.currentPage = 2; f.context.showOcrPage(2); assert.equal(f.get('pdf-ocr-output').value, 'Recognized page 2');
    f.pdfState.currentPage = 1; f.context.showOcrPage(1); assert.equal(f.get('pdf-ocr-output').value, 'Manual page one');
    const invoke = (name, args = {}) => f.context.invokePdfBridgeTool(name, args, {isAuthorized: () => true});
    let before = await invoke('studio_get_ocr_text');
    const changed = await invoke('studio_set_ocr_text', {documentId: before.documentId, expectedRevision: before.revision, page: 1, expectedText: before.text, replacementText: 'MCP correction'});
    assert.equal(f.row(1).text, 'MCP correction'); assert.equal(f.row(1).engine, 'chatgpt-review');
    assert.match(f.context.buildOcrTextExport([1, 2]), /MCP correction/);
    before = await invoke('studio_get_ocr_text'); await invoke('studio_undo_ocr', {documentId: before.documentId, expectedRevision: before.revision, undoId: changed.undoId});
    assert.equal(f.row(1).text, 'Manual page one');
    f.pdfState.currentPage = 2; f.context.showOcrPage(2); before = await invoke('studio_get_ocr_text'); assert.equal(before.text, 'Recognized page 2'); assert.equal(before.ocrSourcePage, 2);
    f.pdfState.currentPage = 1; f.context.showOcrPage(1); assert.equal(f.get('pdf-ocr-output').value, 'Manual page one');
    const exported = f.context.buildOcrTextExport([1, 2]); assert.match(exported, /Manual page one/); assert.doesNotMatch(exported, /MCP correction/);
  });

  for (const [status, name] of [[429, 'Rate-limit'], [504, 'Provider-timeout']]) {
    await check(name + ' pauses the batch, keeps partial results, and never submits later pages', async () => {
      const f = fixture({engine: 'vision', post(req, init, response) { return req.page === 1 ? response(200, {text: 'Completed cloud page', warnings: [], uncertain: []}) : response(status, {error: status === 429 ? 'Busy' : 'Provider timeout', code: status === 429 ? 'rate_limited' : 'provider_timeout'}); }});
      await f.finish(f.run(), 'cloud pause ' + status);
      const posts = f.requests.filter(r => r.method === 'POST'); assert.deepEqual(posts.map(r => r.page), [1, 2]); assert(posts[1].at - posts[0].at >= 13000);
      assert.equal(f.requests.filter(r => r.method === 'GET').length, 1); assert.equal(f.row(1).text, 'Completed cloud page');
      assert.deepEqual(f.counts(), {saved: 1, recognized: 1, edited: 0, empty: 0, failed: 1, fallback: 0, missing: 1}); assert.match(f.status(), /paused/);
      if (status === 429) assert.match(f.status(), /60 seconds/);
    });
  }

  await check('Browser request timeout pauses without retrying or submitting remaining pages', async () => {
    const f = fixture({engine: 'vision', post(req, init, response) {
      if (req.page === 1) return response(200, {text: 'Completed cloud page', warnings: [], uncertain: []});
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { const error = new Error('Aborted fetch'); error.name = 'AbortError'; reject(error); }, {once: true}));
    }});
    await f.finish(f.run(), 'browser cloud timeout');
    assert.deepEqual(f.requests.filter(r => r.method === 'POST').map(r => r.page), [1, 2]); assert.equal(f.row(1).text, 'Completed cloud page');
    assert.equal(f.counts().failed, 1); assert.equal(f.counts().missing, 1); assert.match(f.status(), /paused.*timed out.*not retried/i); assert.equal(f.pdfState.ocrRunning, false);
  });

  for (const failure of ['network', 'unreadable']) {
    await check('Cloud ' + failure + ' failure pauses and preserves earlier results', async () => {
      const f = fixture({engine: 'vision', post(req, init, response) {
        if (req.page === 1) return response(200, {text: 'Earlier successful page', warnings: [], uncertain: []});
        if (failure === 'network') throw new TypeError('Fixture network failure');
        return {ok: true, status: 200, headers: {get() { return null; }}, async json() { throw new SyntaxError('Fixture malformed JSON'); }};
      }});
      await f.finish(f.run(), 'pause on ' + failure);
      assert.deepEqual(f.requests.filter(r => r.method === 'POST').map(r => r.page), [1, 2]); assert.equal(f.row(1).text, 'Earlier successful page');
      assert.equal(f.counts().failed, 1); assert.equal(f.counts().missing, 1); assert.match(f.status(), /paused/);
    });
  }

  const result = {status: 'PASS', candidate, sha256: crypto.createHash('sha256').update(html).digest('hex'), cases: checks.length, checks, realNetworkRequests: 0, appSourceMutations: 0};
  fs.writeFileSync(path.join(__dirname, 'async-controller-results.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

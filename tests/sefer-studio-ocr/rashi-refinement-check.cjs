'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const harnessPath = path.join(__dirname, 'async-controller-check.cjs');
const harness = fs.readFileSync(harnessPath, 'utf8');
const fixtureModule = new Module(harnessPath, module);
fixtureModule.filename = harnessPath; fixtureModule.paths = module.paths;
fixtureModule._compile(harness.slice(0, harness.indexOf('const checks = [];')) + '\nmodule.exports={fixture,plain,deferred};', harnessPath);
const { fixture, plain, deferred } = fixtureModule.exports;
const word = (text, x, y = 12) => ({ text, confidence: 91, bbox: { x0: x, y0: y, x1: x + 32, y1: y + 18 } });
function recognition(lines, cropped = false) {
  const parts = lines.map((text, i) => {
    const tokens = text.split(' ').filter(Boolean);
    return { text, bbox: { x0: cropped ? 12 : 20, y0: cropped ? 12 : 20 + i * 40, x1: 220, y1: cropped ? 32 : 40 + i * 40 }, words: tokens.map((token, j) => word(token, (cropped ? 12 : 24) + j * 38, cropped ? 12 : 20 + i * 40)) };
  });
  return { data: { text: lines.join('\n'), confidence: 90, blocks: [{paragraphs:[{lines:parts}]}] } };
}
function rashi(options) {
  const f = fixture({ pages: 1, ...options });
  f.get('pdf-ocr-lang').value = 'heb_rashi';
  f.get('pdf-ocr-rashi-refine').checked = true;
  return f;
}
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); }
(async () => {
  await check('Changed Rashi lines retain the first reading and correct source-page word positions', async () => {
    const f = rashi({ recognize: (_call, n) => n === 1 ? recognition(['שלום עולם', 'מקור חדש']) : n === 2 ? recognition(['שלום עלם'], true) : recognition(['מקור חדש'], true) });
    await f.finish(f.run(), 'Rashi refinement');
    const result = f.row(1);
    assert.equal(result.text, 'שלום עלם\nמקור חדש');
    assert.equal(result.rashiRefinement.firstPassText, 'שלום עולם\nמקור חדש');
    assert.equal(result.rashiRefinement.detectedLines, 2);
    assert.equal(result.rashiRefinement.lines.length, 2);
    assert.equal(result.rashiRefinement.changedLines, 1);
    assert.equal(result.rashiRefinement.lines[0].firstText, 'שלום עולם');
    assert.equal(result.searchWords[0][1], 20);
    assert.equal(result.searchWords[0][2], 20);
    assert.equal(result.searchWords.map(word => word[0]).join(' '), 'שלום עלם מקור חדש');
    assert.equal(result.engineConfidence, null);
    assert.equal(f.context.buildOcrReport([1]).latestRun.refineRashiLines, true);
    assert(f.workers.every(worker => worker.terminateCount === 1));
  });
  await check('Empty, truncated, or positionless refinements cannot erase first-pass lines', async () => {
    for (const refined of [{data:{text:'',blocks:[]}}, recognition(['ש'], true), {data:{text:'שלום עלם',blocks:[]}}]) {
      const f = rashi({ recognize: (_call, n) => n === 1 ? recognition(['שלום עולם']) : refined });
      await f.finish(f.run(), 'fallback');
      const result = f.row(1);
      assert.equal(result.text, 'שלום עולם');
      assert.equal(result.rashiRefinement.fallbackLines, 1);
      assert.equal(result.rashiRefinement.lines[0].selectedSource, 'first-pass');
      assert.equal(result.rashiRefinement.lines[0].selectedText, 'שלום עולם');
    }
  });
  await check('A line worker failure retains all subsequent first readings without repeated failed OCR', async () => {
    const f = rashi({ recognize: (_call, n) => n === 1 ? recognition(['שלום עולם', 'מקור חדש', 'דברי תורה']) : Promise.reject(new Error('OCR failed')) });
    await f.finish(f.run(), 'refinement failure');
    const result = f.row(1);
    assert.equal(result.text, 'שלום עולם\nמקור חדש\nדברי תורה');
    assert.equal(result.rashiRefinement.lines.length, 3);
    assert.equal(result.rashiRefinement.fallbackLines, 3);
    assert.equal(result.rashiRefinement.status, 'partial');
    assert.equal(f.calls.length, 2);
  });
  await check('A missing tail word is rejected even when the remaining line exceeds the character threshold', async () => {
    const f = rashi({ recognize: (_call, n) => n === 1 ? recognition(['שלום עולם דברי תורה']) : recognition(['שלום עולם דברי'], true) });
    await f.finish(f.run(), 'missing tail');
    assert.equal(f.row(1).text, 'שלום עולם דברי תורה');
    assert.equal(f.row(1).rashiRefinement.changedLines, 0);
    assert.match(f.row(1).rashiRefinement.lines[0].fallbackReason, /fewer words/);
  });
  await check('Unmatched first-pass word geometry skips refinement and preserves the whole reading', async () => {
    const initial = recognition(['שלום עולם']); initial.data.text += '\nטקסט נוסף';
    const f = rashi({ recognize: () => initial });
    await f.finish(f.run(), 'unmatched first pass');
    assert.equal(f.row(1).text, initial.data.text);
    assert.equal(f.row(1).rashiRefinement.status, 'skipped');
    assert.equal(f.calls.length, 1);
  });
  await check('Optional refinement setup or reset failure preserves first-pass text and retires the worker', async () => {
    for (const failAt of [2, 3]) {
      let configuration = 0;
      const f = rashi({ createWorker: worker => { worker.setParameters = async () => { if (++configuration === failAt) throw new Error('Parameter change failed'); }; return worker; }, recognize: (_call, n) => n === 1 ? recognition(['שלום עולם']) : recognition(['שלום עלם'], true) });
      await f.finish(f.run(), 'configuration fallback ' + failAt);
      assert.equal(f.row(1).status, 'recognized');
      assert.equal(f.row(1).text, 'שלום עולם');
      assert.equal(f.row(1).rashiRefinement.applied, false);
      assert.equal(f.row(1).rashiRefinement.status, 'skipped');
      assert.equal(f.workers[0].terminateCount, 1);
    }
  });
  await check('Stop during refinement cannot commit a late line or overwrite previous saved text', async () => {
    const waiting = deferred();
    const f = rashi({ recognize: (_call, n) => n === 1 ? recognition(['שלום עולם']) : waiting.promise });
    f.context.storeOcrResult(1, { text: 'Previously checked text', status: 'edited', flags: [] });
    f.get('pdf-ocr-rescan').checked = true;
    const promise = f.run(); await f.until(() => f.calls.length === 2, 'line is running');
    f.stop(); await f.finish(promise, 'stopped refinement');
    waiting.resolve(recognition(['שלום עלם'], true)); await f.flush();
    assert.equal(f.row(1).text, 'Previously checked text');
    assert.equal(f.workers[0].terminateCount, 1);
  });
  await check('A retired refinement worker is recreated for the next page without losing the previous page', async () => {
    let firstConfigurations = 0;
    const f = rashi({ pages: 2, createWorker: worker => { worker.setParameters = async () => { if (worker.id === 1 && ++firstConfigurations === 2) throw new Error('Configuration failed'); }; return worker; }, recognize: call => call.page ? recognition([call.page === 1 ? 'שלום עולם' : 'דברי תורה']) : recognition(['דברי תרה'], true) });
    await f.finish(f.run(), 'next-page worker recreation');
    assert.equal(f.workers.length, 2);
    assert.equal(f.row(1).text, 'שלום עולם');
    assert.equal(f.row(2).text, 'דברי תרה');
    assert.equal(f.row(2).status, 'recognized');
    assert(f.workers.every(worker => worker.terminateCount === 1));
  });
  await check('Unicode annotations and overflowing footnotes stop export before content can be dropped', async () => {
    const f = fixture({pages:1});
    for (const [overlays, notes, pattern] of [
      [[{kind:'text',text:'שלום'}],[],/Unicode annotation/],
      [[],[{text:'מקור בעברית'}],/Unicode footnotes/],
      [[],[{text:'x'.repeat(105)}],/truncating/]
    ]) await assert.rejects(f.context.applyPdfPageEdits({}, {}, overlays, notes, false, {}, {}), pattern);
  });
  const report = { status: 'PASS', cases: checks.length, checks, realNetworkRequests: 0 };
  fs.writeFileSync(path.join(__dirname, 'rashi-refinement-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

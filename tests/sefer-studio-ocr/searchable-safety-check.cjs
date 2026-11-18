'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), Module = require('node:module'), crypto = require('node:crypto');
const harnessPath = path.join(__dirname, 'async-controller-check.cjs');
const harness = fs.readFileSync(harnessPath, 'utf8');
const moduleFixture = new Module(harnessPath, module); moduleFixture.filename = harnessPath; moduleFixture.paths = module.paths;
moduleFixture._compile(harness.slice(0, harness.indexOf('const checks = [];')) + '\nmodule.exports={fixture,plain,deferred};', harnessPath);
const { fixture, plain, deferred } = moduleFixture.exports;
const PDFLib = require('pdf-lib');
const seed = new Uint8Array(fs.readFileSync(path.join(__dirname, 'native-text-only.pdf')));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fZ8AAAAASUVORK5CYII=', 'base64');
const word = (text, x = 10, y = 10, w = 30, h = 20, confidence = 90) => ({ text, bbox: {x0:x, y0:y, x1:x+w, y1:y+h}, confidence });
const recognized = (words, text = words.map(w => w.text).join(' ')) => ({ data: { text, confidence: 92, pdf: seed, blocks: [{paragraphs:[{lines:[{words}]}]}] } });
const saved = (text = 'דברי סופרים') => ({text, status:'recognized', engine:'on-device', renderScale:1, actualDpi:72, searchWords:text.split(' ').map((token,i)=>[token,200-i*70,20,250-i*70,40]), flags:[], flaggedCount:0, engineConfidence:95, timing:{elapsedMs:1200,renderMs:200,recognitionMs:1000}});
const checks=[];
async function check(name,fn){await fn();checks.push(name);}

function exportFixture(options={}) {
  const f=fixture({pages:options.pages||1,textLayer:{1:'OLD LAYER MUST NOT SURVIVE'}}), downloads=[];
  // pdf-lib's public addPage uses instanceof Array; adapt only the VM realm boundary.
  f.context.PDFLib={...PDFLib,PDFDocument:{load:PDFLib.PDFDocument.load.bind(PDFLib.PDFDocument),create:async()=>{const doc=await PDFLib.PDFDocument.create();const add=doc.addPage.bind(doc);doc.addPage=size=>add(Array.from(size));return doc;}}};
  f.context.__seed=seed; vm.runInContext('ocrGlyphlessSeed=__seed;',f.context);
  for(let p=1;p<=f.pdfState.pageCount;p++)f.context.storeOcrResult(p,saved());
  const create=f.context.document.createElement;
  f.context.document.createElement=tag=>{
    const el=create(tag);
    if(tag==='canvas')el.toBlob=callback=>options.encode?options.encode(callback):callback(new Blob([png],{type:'image/png'}));
    return el;
  };
  f.context.downloadPdfStudioBlob=(blob,name)=>downloads.push({blob,name});
  return {...f,downloads};
}

(async()=>{
  await check('One-word and whitespace edits preserve positions; structural rewrites invalidate them',async()=>{
    const f=fixture({pages:1}), original=saved();
    const correction=plain(f.context.remapEditedOcrWords(original,'דברי ספרים'));
    assert.equal(correction.searchWords[1][0],'ספרים');assert.deepEqual(correction.searchWords[1].slice(1),original.searchWords[1].slice(1));
    assert.equal(original.searchWords[1][0],'סופרים');
    assert(plain(f.context.remapEditedOcrWords(original,'דברי\n  סופרים')).searchWords);
    assert.equal(f.context.remapEditedOcrWords(original,'דברי הרבה סופרים').searchWords,null);
    assert.equal(f.context.remapEditedOcrWords(original,'מילים אחרות').searchWords,null);
  });
  await check('MCP correction and undo keep cache geometry coherent without stale confidence',async()=>{
    const f=fixture({pages:1});f.context.storeOcrResult(1,saved());
    const before=f.context.pdfBridgeStatus();
    const applied=await f.context.invokePdfBridgeTool('studio_set_ocr_text',{documentId:before.documentId,expectedRevision:before.revision,page:1,expectedText:'דברי סופרים',replacementText:'דברי ספרים'},{isAuthorized:()=>true});
    assert.equal(f.row(1).searchWords[1][0],'ספרים');assert.equal(f.row(1).engineConfidence,null);
    await f.context.invokePdfBridgeTool('studio_undo_ocr',{documentId:applied.documentId,expectedRevision:applied.revision,undoId:applied.undoId},{isAuthorized:()=>true});
    assert.equal(f.row(1).searchWords[1][0],'סופרים');assert.equal(f.row(1).engineConfidence,95);
  });
  await check('Searchable export creates a fresh PDF and embeds only current OCR text',async()=>{
    const f=exportFixture();await f.finish(f.context.exportSearchablePdf(),'searchable success');
    assert.equal(f.downloads.length,1,f.get('pdf-searchable-status').textContent);assert.match(f.downloads[0].name,/_Searchable_Pages_1-1\.pdf$/);
    const bytes=Buffer.from(await f.downloads[0].blob.arrayBuffer());fs.writeFileSync(path.join(__dirname,'controller-searchable-proof.pdf'),bytes);
    const out=await PDFLib.PDFDocument.load(bytes);assert.equal(out.getPageCount(),1);
    assert.equal(vm.runInContext('activeSearchableExport',f.context),null);assert.equal(f.canvases[0].width,1);
  });
  await check('Editing a future selected page while encoding aborts download and keeps the edit',async()=>{
    let ready;const f=exportFixture({pages:2,encode:callback=>{ready=callback;}});
    const promise=f.context.exportSearchablePdf();await f.until(()=>ready,'encoding started');
    f.context.storeOcrResult(2,{...saved('דברי ספרים'),status:'edited'});ready(new Blob([png]));await f.finish(promise,'changed page guard');
    assert.equal(f.downloads.length,0);assert.equal(f.row(2).text,'דברי ספרים');assert.match(f.get('pdf-searchable-status').textContent,/changed on Page 2/);
  });
  await check('Source replacement during encoding cancels export without restoring old results',async()=>{
    let ready;const f=exportFixture({encode:callback=>{ready=callback;}});
    const promise=f.context.exportSearchablePdf();await f.until(()=>ready,'encoding started');await f.replace('New',1,true);ready(new Blob([png]));await f.finish(promise,'source guard');
    assert.equal(f.downloads.length,0);assert.equal(f.row(1),null);assert.equal(vm.runInContext('ocrGlyphlessSeed',f.context),null);
  });
  await check('Stop and changed annotations cannot produce a late searchable download',async()=>{
    for(const reason of ['stop','annotation']){
      let ready;const f=exportFixture({encode:callback=>{ready=callback;}});const promise=f.context.exportSearchablePdf();await f.until(()=>ready,'encoding started');
      if(reason==='stop')f.context.stopSearchablePdfExport();else f.pdfState.overlays[1]=[{kind:'text',text:'NEW',xPct:10,yPct:10}];
      ready(new Blob([png]));await f.finish(promise,reason+' guard');assert.equal(f.downloads.length,0);
    }
  });
  await check('A broad OCR rewrite and a missing selected result block export before rendering',async()=>{
    for(const invalid of [{...saved(),searchWords:null,searchIssue:'Edited without positions'},null]){
      const f=exportFixture();if(invalid)f.context.storeOcrResult(1,invalid);else vm.runInContext('ocrResults.clear();',f.context);
      await f.finish(f.context.exportSearchablePdf(),'preflight');assert.equal(f.downloads.length,0);assert.equal(f.canvases.length,0);
    }
  });
  await check('Small-number pass reuses one auxiliary worker and replaces only the exact repeated token',async()=>{
    let f,numberCalls=0;
    f=fixture({pages:2,createWorker:worker=>{f.time.advance(worker.id===1?50:20);return worker;},recognize:call=>{
      if(call.worker===1){f.time.advance(1000);return recognized([word('5',20,20,20,20,99),word('text',160,20),word('5',300,20,20,20,99)]);}
      f.time.advance(10);numberCalls++;return {data:{text:Math.floor((numberCalls-1)/2)%2===0?'95':'5',confidence:95}};
    }});
    f.get('pdf-ocr-lang').value='heb';f.get('pdf-ocr-small-numbers').checked=true;await f.finish(f.run(),'number review');
    assert.equal(f.workers.length,2);assert.equal(numberCalls,8);assert.equal(f.row(1).text,'95 text 5');assert.equal(f.row(2).text,'95 text 5');
    assert.equal(f.row(1).searchWords[0][0],'95');assert.equal(f.row(1).searchWords[2][0],'5');assert.equal(f.row(1).numericReview.changed,1);assert.equal(f.row(1).numericReview.candidates[0].original,'5');
    assert(f.row(1).timing.elapsedMs>=1060);const report=plain(f.context.buildOcrReport([1,2]));assert.equal(report.latestRun.improveSmallNumbers,true);assert.equal(report.latestRun.numberWorkerInitializationMs,20);assert(report.latestRun.elapsedMs>=2150);
    assert(f.workers.every(worker=>worker.terminateCount===1));
  });
  await check('Low-confidence agreement and conflicting number readings retain primary text',async()=>{
    let calls=0;const f=fixture({pages:1,recognize:call=>call.worker===1?recognized([word('5')]):{data:{text:++calls===1?'18':'18',confidence:0}}});
    f.get('pdf-ocr-lang').value='heb';f.get('pdf-ocr-small-numbers').checked=true;await f.finish(f.run(),'low confidence');assert.equal(f.row(1).text,'5');assert.equal(f.row(1).numericReview.changed,0);assert.equal(f.row(1).numericReview.flagged,1);
    let second=0;const g=fixture({pages:1,recognize:call=>call.worker===1?recognized([word('5')]):{data:{text:++second===1?'95':'96',confidence:99}}});
    g.get('pdf-ocr-lang').value='heb';g.get('pdf-ocr-small-numbers').checked=true;await g.finish(g.run(),'disagreement');assert.equal(g.row(1).text,'5');assert.equal(g.row(1).numericReview.changed,0);
  });
  await check('Padded overlap is flagged without starting an auxiliary worker',async()=>{
    const f=fixture({pages:1,recognize:()=>recognized([word('5',10,10,10,20),word('next',21,10,30,20)])});f.get('pdf-ocr-lang').value='heb';f.get('pdf-ocr-small-numbers').checked=true;
    await f.finish(f.run(),'overlap');assert.equal(f.workers.length,1);assert.equal(f.row(1).numericReview.checked,0);assert.equal(f.row(1).numericReview.skipped,1);assert.match(f.row(1).numericReview.candidates[0].reason,/overlaps/);
  });
  await check('Stop during auxiliary initialization terminates the late worker and gates repeated Run',async()=>{
    const waiting=deferred();const f=fixture({pages:1,createWorker:worker=>worker.id===2?waiting.promise:worker,recognize:()=>recognized([word('5')])});f.get('pdf-ocr-lang').value='heb';f.get('pdf-ocr-small-numbers').checked=true;
    const promise=f.run();await f.until(()=>f.workers.length===2,'number worker starting');f.stop();await f.finish(promise,'stopped numeric initialization');await f.run();assert.equal(f.workers.length,2);assert.equal(f.row(1),null);
    waiting.resolve(f.workers[1]);await f.flush();assert.equal(f.workers[1].terminateCount,1);assert.equal(f.calls.filter(call=>call.worker===2).length,0);
  });
  await check('Explicit empty AI page is no-text; unexplained empty output stays failed',async()=>{
    const good=fixture({pages:1,engine:'vision',post:(_req,_init,response)=>response(200,{text:'',warnings:['No visible text on this page.'],uncertain:[]})});await good.finish(good.run(),'explicit blank');assert.equal(good.row(1).status,'no-text');assert.equal(good.row(1).wordCount,0);
    const bad=fixture({pages:1,engine:'vision',post:(_req,_init,response)=>response(200,{text:'',warnings:[],uncertain:[]})});await bad.finish(bad.run(),'unexplained blank');assert.equal(bad.row(1).status,'failed');
  });
  const candidate=path.resolve(process.argv[2]||'dist/sefer-studio/index.html');const result={status:'PASS',candidate,sha256:crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'),cases:checks.length,checks,realNetworkRequests:0,appSourceMutations:0};fs.writeFileSync(path.join(__dirname,'searchable-safety-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

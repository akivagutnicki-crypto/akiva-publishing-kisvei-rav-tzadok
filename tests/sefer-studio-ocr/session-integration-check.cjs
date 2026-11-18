'use strict';
// Executes the real app session lifecycle against the existing controller fixture.
// Browser, worker, and font-parser I/O are isolated; source hashes are real SHA-256.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const crypto = require('node:crypto');
const candidate = path.resolve(process.argv[2] || 'dist/sefer-studio/index.html');
const testDirectory = path.resolve(path.dirname(candidate), '../../tests/sefer-studio-ocr');
const harnessPath = path.join(testDirectory, 'async-controller-check.cjs');
const harness = fs.readFileSync(harnessPath, 'utf8');
const moduleFixture = new Module(harnessPath, module);
moduleFixture.filename = harnessPath; moduleFixture.paths = module.paths;
moduleFixture._compile(harness.slice(0, harness.indexOf('const checks = [];')) + '\nmodule.exports={fixture,plain,deferred};', harnessPath);
const { fixture, plain, deferred } = moduleFixture.exports;
const Session = require(path.join(path.dirname(candidate), 'ocr-session.js'));
const seed = new Uint8Array(fs.readFileSync(path.join(testDirectory, 'native-text-only.pdf')));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest();
const asArrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const settings = count => ({engine:'local',language:'heb',targetDpi:300,scope:'all',layout:'rtl-columns',rangeStart:1,rangeEnd:count,currentPage:1,improveSmallNumbers:true,refineRashiLines:true});
const row = (page=1, text='דברי סופרים', status='recognized') => ({page,text,status,engine:'on-device',language:'heb',modelId:'fixture-model',dir:'rtl',imageWidth:504,imageHeight:720,renderScale:1,actualDpi:72,searchWords:text?text.split(' ').map((token,i)=>[token,200-i*70,20,250-i*70,40]):[],searchIssue:'',flags:[],flaggedCount:0,reviewNotes:[],engineConfidence:95,timing:{elapsedMs:1200,renderMs:200,recognitionMs:1000},rashiRefinement:{retainedLines:2,changedLines:1},numericReview:{changed:0,flagged:0},revision:1});
function checkpoint(pages=[row()], count=3, overrides={}) {
  return {format:Session.FORMAT,version:1,savedAt:'2026-11-18T12:00:00.000Z',source:{sha256:digest(new Uint8Array([1,2,3])).toString('hex'),byteLength:3,pageCount:count,fileName:'A.pdf'},settings:settings(count),pages,glyphlessSeed:null,latestRun:{elapsedMs:1300,attempts:[{page:1,status:'recognized',elapsedMs:1200}]},...overrides};
}
function fileFor(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return {size:Buffer.byteLength(raw),text:async()=>raw};
}
function sessionFixture(options={}) {
  const f=fixture(options), downloads=[], fontChecks=[];
  f.context.SeferOcrSession=Session;
  f.context.crypto={randomUUID:crypto.randomUUID,subtle:{digest:async(_algorithm,bytes)=>asArrayBuffer(digest(bytes))}};
  f.context.PDFLib={PDFDocument:{create:async()=>({fixture:true})}};
  f.context.copyOcrGlyphlessDescriptor=async(_doc,bytes)=>{fontChecks.push(new Uint8Array(bytes));if(options.badFont)throw new Error('Invalid fixture font');return {};};
  f.context.downloadPdfStudioBlob=(blob,name)=>downloads.push({blob,name});
  f.sessionStatus=()=>f.get('pdf-ocr-session-status').textContent;
  f.downloads=downloads;f.fontChecks=fontChecks;
  f.restore=async value=>f.finish(f.context.restoreOcrSession(fileFor(value)),'session restore');
  f.save=async()=>f.finish(f.context.saveOcrSession(),'session save');
  return f;
}
const checks=[];
async function check(name,fn){await fn();checks.push(name);}
(async()=>{
  await check('Fresh-session roundtrip preserves Hebrew edits, geometry, font, audits, and settings without credentials',async()=>{
    const f=sessionFixture({pages:3});
    f.context.storeOcrResult(1,row(1));f.context.storeOcrResult(2,{...row(2,'דברי ספרים','edited'),searchEdited:true});f.context.storeOcrResult(3,row(3,'','no-text'));
    f.context.__seed=seed;vm.runInContext('ocrGlyphlessSeed=__seed;lastOcrRunReport={elapsedMs:2400,attemptedPages:3};',f.context);
    f.get('pdf-ocr-lang').value='heb_rashi';f.get('pdf-ocr-quality').value='400';f.get('pdf-ocr-scope').value='range';f.get('pdf-ocr-range-start').value='2';f.get('pdf-ocr-rashi-refine').checked=true;
    await f.save();assert.equal(f.downloads.length,1,f.sessionStatus());
    const raw=await f.downloads[0].blob.text();assert(!raw.includes('fixture-access-code'));assert(!raw.includes('https://ocr.example/ocr'));
    const saved=JSON.parse(raw);assert.equal(saved.pages.length,3);assert.equal(saved.settings.scope,'range');assert.match(f.downloads[0].name,/_OCR_Session\.json$/);
    const g=sessionFixture({pages:3});await g.restore(raw);
    assert.equal(g.rows().length,3,g.sessionStatus());assert.equal(g.row(2).status,'edited');assert.equal(g.row(2).text,'דברי ספרים');assert.deepEqual(g.row(2).searchWords,f.row(2).searchWords);assert.deepEqual(g.row(1).timing,f.row(1).timing);assert.deepEqual(g.row(1).rashiRefinement,f.row(1).rashiRefinement);assert.deepEqual(g.row(1).numericReview,f.row(1).numericReview);assert.equal(g.row(3).status,'no-text');assert.deepEqual(g.row(3).searchWords,[]);
    assert.equal(g.get('pdf-ocr-output').value,'דברי סופרים');assert.equal(g.get('pdf-ocr-lang').value,'heb_rashi');assert.equal(g.get('pdf-ocr-quality').value,'400');assert.equal(g.get('pdf-ocr-range-start').value,'2');assert.equal(g.get('pdf-ocr-rescan').checked,false);assert.equal(g.fontChecks.length,1);assert.deepEqual(Buffer.from(vm.runInContext('ocrGlyphlessSeed',g.context)),Buffer.from(seed));assert.equal(g.workers.length,0);assert.equal(g.requests.length,0);
  });
  await check('Same filename and page count cannot bypass the source hash; identical renamed PDF can restore',async()=>{
    const f=sessionFixture({pages:3});f.context.storeOcrResult(3,row(3,'נוסח קיים','edited'));
    f.pdfState.pdfBytes=new Uint8Array([9,9,9]);f.pdfState.pdfJsDocSource=f.pdfState.pdfBytes;
    await f.restore(checkpoint());assert.equal(f.row(1),null);assert.equal(f.row(3).text,'נוסח קיים');assert.match(f.sessionStatus(),/different PDF/);
    const g=sessionFixture({pages:3});g.pdfState.fileName='Renamed-identical.pdf';await g.restore(checkpoint());assert.equal(g.row(1).text,'דברי סופרים',g.sessionStatus());
  });
  await check('Changing source while a checkpoint file is reading cannot restore late results',async()=>{
    const f=sessionFixture({pages:3}), waiting=deferred(), raw=JSON.stringify(checkpoint());
    const restoring=f.context.restoreOcrSession({size:raw.length,text:()=>waiting.promise});await f.flush();await f.replace('B',3);const status=f.sessionStatus();waiting.resolve(raw);await f.finish(restoring,'stale session read');assert.equal(f.rows().length,0);assert.equal(f.pdfState.fileName,'B.pdf');assert.equal(f.sessionStatus(),status);
  });
  await check('Changing source during hashing cancels both restore and save without a late download',async()=>{
    for(const kind of ['restore','save']){
      const f=sessionFixture({pages:3}), waiting=deferred();let hashStarted=false;
      f.context.crypto.subtle.digest=()=>{hashStarted=true;return waiting.promise;};
      if(kind==='save')f.context.storeOcrResult(1,row(1));
      const operation=kind==='restore'?f.context.restoreOcrSession(fileFor(checkpoint())):f.context.saveOcrSession();
      await f.until(()=>hashStarted,'hash started');await f.replace('B',3);const status=f.sessionStatus();waiting.resolve(asArrayBuffer(digest(new Uint8Array([1,2,3]))));await f.finish(operation,'stale source hash');assert.equal(f.rows().length,0);assert.equal(f.downloads.length,0);assert.equal(f.sessionStatus(),status);
    }
  });
  await check('A manual edit made while the file loads is kept; missing pages merge without replacing current settings',async()=>{
    const f=sessionFixture({pages:3}), waiting=deferred();f.context.storeOcrResult(1,row(1,'נוסח קיים','edited'));f.get('pdf-ocr-lang').value='heb';f.get('pdf-ocr-quality').value='300';f.get('pdf-ocr-rescan').checked=true;
    const incoming=checkpoint([row(1),row(2)],3);incoming.settings.language='heb_rashi';incoming.settings.targetDpi=400;
    const raw=JSON.stringify(incoming), restoring=f.context.restoreOcrSession({size:raw.length,text:()=>waiting.promise});await f.flush();f.get('pdf-ocr-output').value='תיקון מאוחר';waiting.resolve(raw);await f.finish(restoring,'manual-edit-safe merge');
    assert.equal(f.row(1).text,'תיקון מאוחר');assert.equal(f.row(1).status,'edited');assert.equal(f.row(2).text,'דברי סופרים');assert.equal(f.get('pdf-ocr-output').value,'תיקון מאוחר');assert.equal(f.get('pdf-ocr-quality').value,'300');assert.equal(f.get('pdf-ocr-lang').value,'heb');assert.equal(f.get('pdf-ocr-rescan').checked,false);assert.match(f.sessionStatus(),/kept 1 existing/);
  });
  await check('Run after restoration scans failed and missing pages, skipping recognized and blank pages',async()=>{
    const f=sessionFixture({pages:4});await f.restore(checkpoint([row(1),{...row(2,'הטקסט הקודם','failed'),searchWords:null},row(3,'','no-text')],4));
    await f.finish(f.run(),'resume restored work');assert.deepEqual(f.calls.map(call=>call.page),[2,4]);assert.equal(f.row(1).text,'דברי סופרים');assert.equal(f.row(3).status,'no-text');assert.equal(f.counts().saved,4);
  });
  await check('Restoring current-page scope restores its page, picker, preview, and subsequent scan target',async()=>{
    const f=sessionFixture({pages:3}), incoming=checkpoint([row(1)]);let previewPage=null, thumbnailPage=null;
    incoming.settings.scope='current';incoming.settings.currentPage=2;
    f.context.renderPdfThumbnails=()=>{thumbnailPage=f.pdfState.currentPage;};
    f.context.renderCurrentPdfPage=async()=>{previewPage=f.pdfState.currentPage;};
    await f.restore(incoming);assert.equal(f.pdfState.currentPage,2);assert.equal(f.get('pdf-ocr-result-page').value,'2');assert.equal(f.get('pdf-ocr-output').value,'');assert.equal(previewPage,2);assert.equal(thumbnailPage,2);assert.deepEqual(plain(f.context.selectedOcrPages()),[2]);
    await f.finish(f.run(),'resume restored current page');assert.deepEqual(f.calls.map(call=>call.page),[2]);assert.equal(f.row(1).text,'דברי סופרים');
  });
  await check('Duplicate pages, source geometry mismatch, and invalid fonts reject atomically',async()=>{
    for(const kind of ['duplicate','geometry','font']){
      const f=sessionFixture({pages:3,badFont:kind==='font'});f.context.storeOcrResult(3,row(3,'נוסח קיים','edited'));const before=f.rows();const incoming=checkpoint([row(1),row(2)]);
      if(kind==='duplicate')incoming.pages[1].page=1;
      if(kind==='geometry')incoming.pages[1].imageWidth=505;
      if(kind==='font')incoming.glyphlessSeed=Session.encodeSeed(seed);
      await f.restore(incoming);assert.deepEqual(f.rows(),before,kind);assert.match(f.sessionStatus(),/not restored/);assert.equal(vm.runInContext('activeOcrSessionOperation',f.context),null);assert.equal(f.downloads.length,0);
    }
  });
  await check('Checkpoint restoration is blocked while OCR is active',async()=>{
    const waiting=deferred();const f=sessionFixture({pages:3,recognize:()=>waiting.promise});const running=f.run();await f.until(()=>f.calls.length===1,'OCR active');await f.restore(checkpoint());assert.match(f.sessionStatus(),/Stop OCR/);assert.equal(f.row(1),null);f.stop();await f.finish(running,'stop active OCR');waiting.resolve({data:{text:'LATE',blocks:[]}});await f.flush();assert.equal(f.row(1),null);
  });
  await check('A running OCR batch can save completed pages without stopping or inventing an unfinished result',async()=>{
    const waiting=deferred();const f=sessionFixture({pages:3,recognize:call=>call.page===2?waiting.promise:{data:{text:'Page '+call.page,blocks:[]}}});const running=f.run();await f.until(()=>f.calls.length===2,'second page pending');await f.save();assert.equal(f.downloads.length,1,f.sessionStatus());const saved=JSON.parse(await f.downloads[0].blob.text());assert.deepEqual(saved.pages.map(row=>row.page),[1]);assert(f.active());assert.match(f.sessionStatus(),/still running/);f.stop();await f.finish(running,'stop after snapshot');waiting.resolve({data:{text:'late',blocks:[]}});await f.flush();assert.equal(f.row(2),null);
  });
  await check('Matching source download preserves exact source bytes instead of serializing PDF edits',async()=>{
    const f=sessionFixture({pages:3});await f.replace('Rotated',3);const before=Buffer.from(f.pdfState.pdfBytes);f.context.downloadOcrSessionSource();assert.equal(f.downloads.length,1);assert.deepEqual(Buffer.from(await f.downloads[0].blob.arrayBuffer()),before);assert.match(f.downloads[0].name,/_OCR_Source\.pdf$/);assert.equal(f.fontChecks.length,0);
  });
  await check('The optional faster-Rashi setting survives a roundtrip and old sessions restore it as false',async()=>{
    const f=sessionFixture({pages:3});f.context.storeOcrResult(1,row());f.get('pdf-ocr-lang').value='heb_rashi';f.get('pdf-ocr-rashi-refine').checked=true;f.get('pdf-ocr-rashi-fast').checked=true;await f.save();assert.equal(f.downloads.length,1,f.sessionStatus());
    const saved=JSON.parse(await f.downloads[0].blob.text());assert.equal(saved.settings.fasterRashi,true);
    const g=sessionFixture({pages:3});await g.restore(saved);assert.equal(g.get('pdf-ocr-rashi-fast').checked,true);assert.equal(g.get('pdf-ocr-lang').value,'heb_rashi');
    const legacy=sessionFixture({pages:3});legacy.get('pdf-ocr-rashi-fast').checked=true;await legacy.restore(checkpoint());assert.equal(legacy.get('pdf-ocr-rashi-fast').checked,false,'Old v1 session must not opt in to extra worker memory');
  });
  const result={status:'PASS',candidate,sha256:crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'),cases:checks.length,checks,realNetworkRequests:0,appSourceMutations:0,fontParserMocked:true};
  fs.writeFileSync(path.join(__dirname,'session-integration-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

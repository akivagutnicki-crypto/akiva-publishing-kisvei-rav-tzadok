'use strict';
// Executes the app's actual detected-line refinement with real Tesseract.js.
// Only Canvas I/O is adapted to Node PNG buffers; no browser is automated.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm'), Module = require('node:module'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const Tesseract = require('tesseract.js');
assert.equal(require('tesseract.js/package.json').version, '5.1.1', 'Use the same Tesseract.js version as the app');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const harnessPath = path.join(__dirname, 'async-controller-check.cjs');
const harness = fs.readFileSync(harnessPath, 'utf8');
const fixtureModule = new Module(harnessPath, module); fixtureModule.filename = harnessPath; fixtureModule.paths = module.paths;
fixtureModule._compile(harness.slice(0, harness.indexOf('const checks = [];')) + '\nmodule.exports={fixture,plain};', harnessPath);
const { fixture, plain } = fixtureModule.exports;
const root = path.resolve(__dirname, '../..'), output = path.join(__dirname, 'model-results');
const fixtures = path.join(__dirname, 'fixtures');
function tokens(text) { return String(text).normalize('NFKC').replace(/\p{M}/gu, '').replace(/['"׳״‘’“”]/g, '').match(/[א-ת0-9A-Za-z]+/g) || []; }
function distance(a, b) {
  let row = Array.from({length:b.length+1},(_,i)=>i);
  for (let i=0;i<a.length;i++) { const next=[i+1];for(let j=0;j<b.length;j++) next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]!==b[j])));row=next; }
  return row[b.length];
}
function score(reference, hypothesis) { const a=tokens(reference), b=tokens(hypothesis);return {referenceWords:a.length,hypothesisWords:b.length,wordEdits:distance(a,b),characterEdits:distance(a.join(''),b.join(''))}; }
(async () => {
  fs.mkdirSync(output,{recursive:true});
  const model = zlib.gunzipSync(fs.readFileSync(path.join(root,'dist/sefer-studio/ocr-models/rashi-v1/heb_rashi.traineddata.gz')));
  const modelHash = crypto.createHash('sha256').update(model).digest('hex');
  assert.equal(modelHash, 'c3bdf2c4188e037838e027de419e6e8ca663f1168fef3d09df1a3a46afab6c50');
  fs.writeFileSync(path.join(output,'heb_rashi.traineddata'),model);
  const worker = await Tesseract.createWorker('heb_rashi',1,{langPath:output,gzip:false,cacheMethod:'none'});
  const samples=JSON.parse(fs.readFileSync(path.join(fixtures,'ground_truth_107_words.json'),'utf8')).samples;
  const report={status:'running',modelSha256:modelHash,tesseractJs:require('tesseract.js/package.json').version,samples:[],qualification:'Three recovered manually adjudicated crops, 107 normalized words. Node execution of the actual browser helper with real Tesseract.js; these results do not measure full-book accuracy or user-browser speed.'};
  try {
    for (const sample of samples) {
      const bitmap=await loadImage(path.join(fixtures,sample.id+'.png'));
      const canvas=createCanvas(bitmap.width,bitmap.height);canvas.getContext('2d').drawImage(bitmap,0,0);
      await worker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SINGLE_BLOCK,user_defined_dpi:'300'});
      const began=performance.now();
      const first=(await worker.recognize(canvas.toBuffer('image/png'),{},{text:true,blocks:true,pdf:false,hocr:false,tsv:false})).data;
      const firstMs=performance.now()-began;
      const f=fixture({pages:1});f.context.performance={now:()=>performance.now()};f.context.Tesseract=Tesseract;
      const create=f.context.document.createElement;
      f.context.document.createElement=tag=>tag==='canvas'?createCanvas(1,1):create(tag);
      f.context.__worker={setParameters:parameters=>worker.setParameters(parameters),recognize:(image,options,outputs)=>worker.recognize(image.toBuffer('image/png'),options,outputs),terminate:()=>worker.terminate()};
      const run=vm.runInContext('activeOcrRun={generation:ocrGeneration,sourcePdf:pdfState.pdfJsDoc,sourceBytes:pdfState.pdfBytes,controller:new AbortController(),worker:__worker,terminatedWorkers:new Set(),pages:[1],page:1,finished:0}',f.context);
      const refined=await f.context.refineOcrRashiLines(run,first,{canvas,actualDpi:300});
      const geometry=f.context.collectOcrSearchWords(refined.data,refined.data.text);
      assert(geometry.searchWords,geometry.searchIssue);
      assert.equal(refined.audit.firstPassText,first.text);
      assert.equal(refined.audit.lines.length,refined.audit.detectedLines);
      const result={id:sample.id,baseline:score(sample.text,first.text),refined:score(sample.text,refined.data.text),firstMs,refinementMs:refined.audit.elapsedMs,detectedLines:refined.audit.detectedLines,changedLines:refined.audit.changedLines,fallbackLines:refined.audit.fallbackLines,status:refined.audit.status};
      report.samples.push(result);
      fs.writeFileSync(path.join(output,sample.id+'.json'),JSON.stringify({result,firstText:first.text,refinedText:refined.data.text,audit:plain(refined.audit)},null,2));
      console.log(JSON.stringify(result));
    }
    report.totalReferenceWords=report.samples.reduce((n,s)=>n+s.baseline.referenceWords,0);
    report.baselineWordEdits=report.samples.reduce((n,s)=>n+s.baseline.wordEdits,0);
    report.refinedWordEdits=report.samples.reduce((n,s)=>n+s.refined.wordEdits,0);
    report.firstMs=report.samples.reduce((n,s)=>n+s.firstMs,0);
    report.refinementMs=report.samples.reduce((n,s)=>n+s.refinementMs,0);
    report.status=report.refinedWordEdits<=report.baselineWordEdits?'PASS':'REGRESSION';
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    assert.equal(report.status,'PASS','Refinement must not worsen this recovered manual sample');
  } finally { await worker.terminate(); }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

'use strict';
// Regression for selecting the source word associated with a review crop.
// Executes showOcrWordCrop with browser/PDF rendering I/O mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm'), Module = require('node:module');
const harnessPath = process.env.OCR_TEST_HARNESS || path.join(__dirname, 'async-controller-check.cjs');
const harness = fs.readFileSync(harnessPath, 'utf8');
const fixtureModule = new Module(harnessPath, module);
fixtureModule.filename = harnessPath; fixtureModule.paths = module.paths;
fixtureModule._compile(harness.slice(0, harness.indexOf('const checks = [];')) + '\nmodule.exports={fixture};', harnessPath);
const {fixture} = fixtureModule.exports;
const checks = [];

async function check(name, text, item, expected) {
  const f = fixture({pages:1}), selections = [];
  f.context.storeOcrResult(1, {text,engine:'on-device',status:'recognized',dir:'rtl',renderScale:1,imageWidth:504,imageHeight:720,flags:[],flaggedCount:0});
  const result = vm.runInContext('ocrResults.get(1)', f.context);
  const output = f.get('pdf-ocr-output');
  output.setSelectionRange = (start,end) => selections.push([start,end]);
  await f.context.showOcrWordCrop(1,result,{bbox:{x0:20,y0:20,x1:50,y1:40},...item});
  assert.equal(f.get('pdf-ocr-review-image').classList.contains('hidden'),false,'The source crop remains available');
  assert.deepEqual(selections,expected ? [expected] : [],name);
  assert.equal(output.value,text,'Review navigation must not edit OCR text');
  checks.push(name);
}

(async () => {
  const repeated = '5 מילה 5 סוף', later = repeated.lastIndexOf('5');
  await check('A repeated number selects its recorded later occurrence',repeated,{text:'5',offset:later},[later,later+1]);
  const contained = '125 מילה 5', isolated = contained.lastIndexOf('5');
  await check('A small-number label never selects digits inside a larger number',contained,{text:'5',offset:isolated},[isolated,isolated+1]);
  await check('A slightly shifted offset uses the uniquely nearest complete token',repeated,{text:'5',offset:later+1},[later,later+1]);
  const bidi = '5 מילה \u200f5\u200f סוף', bidiStart = bidi.indexOf('\u200f');
  await check('Bidirectional controls stay inside the selected source token',bidi,{text:'5',offset:bidiStart},[bidiStart,bidiStart+3]);
  await check('Equidistant repeated labels are left unselected','5 5',{text:'5',offset:1},null);
  await check('An unknown source offset does not select the first repeated number',repeated,{text:'5',offset:-1},null);
  await check('A stale offset does not jump to a distant matching number','5 '+ 'א'.repeat(170)+' 5',{text:'5',offset:90},null);
  console.log(JSON.stringify({status:'PASS',cases:checks.length,checks,realOcrCalls:0,appSourceMutations:0},null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

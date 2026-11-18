'use strict';
// Focused header-review lifecycle checks. OCR/network I/O is simulated.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const candidate=path.resolve(process.argv[2]||'dist/sefer-studio/index.html');
const harnessPath=path.resolve(path.dirname(candidate),'../../tests/sefer-studio-ocr/session-integration-check.cjs');
const harness=fs.readFileSync(harnessPath,'utf8'),fixtureModule=new Module(harnessPath,module);
fixtureModule.filename=harnessPath;fixtureModule.paths=module.paths;
fixtureModule._compile(harness.slice(0,harness.indexOf('const checks=[];'))+'\nmodule.exports={sessionFixture,row};',harnessPath);
const {sessionFixture,row}=fixtureModule.exports;
const checks=[];let simulatedPageRecognitions=0;
(async()=>{
  const f=sessionFixture({pages:3});
  const flag={kind:'unrecognized-region',text:'Possible missed header',offset:-1,confidence:null,bbox:{x0:390,y0:10,x1:440,y1:38},reason:'Visible marks fall outside the detected OCR words. Compare with the scan; no text was added.'};
  const summary={method:'unboxed-header-ink-v1',scope:'header-only',status:'checked',regionCount:1,shownRegions:1,inspectedPixels:40000,elapsedMs:12.25,headerBounds:{x0:10,y0:5,x1:494,y1:90}};
  // Keep the UI label in unrelated OCR text: offset -1 must still never select it.
  const savedRow={...row(1,'Possible missed header'),headerCoverage:summary,flags:[flag],flaggedCount:1,reviewNotes:['This check covers only the header; other omissions can still occur.']};
  f.context.storeOcrResult(1,savedRow);await f.save();assert.equal(f.downloads.length,1,f.sessionStatus());
  const raw=await f.downloads[0].blob.text(),checkpoint=JSON.parse(raw);
  assert.deepEqual(checkpoint.pages[0].headerCoverage,summary,'Checkpoint retains header coverage summary');
  assert.deepEqual(checkpoint.pages[0].flags,[flag],'Region flag is retained with unknown text offset and confidence');
  const g=sessionFixture({pages:3});await g.restore(raw);const restored=g.row(1);
  assert.deepEqual(restored.headerCoverage,summary);assert.deepEqual(restored.flags,[flag]);assert.equal(restored.flaggedCount,1);assert.equal(restored.text,savedRow.text);assert.deepEqual(restored.searchWords,savedRow.searchWords,'Review-only region does not invent searchable text');
  const report=g.context.buildOcrReport([1]);assert.deepEqual(JSON.parse(JSON.stringify(report.pages[0].headerCoverage)),summary);assert.equal(report.pages[0].reviewItemCount,1);assert.equal(report.pages[0].reviewWordCount,0,'Region is not counted as a low-confidence OCR word');
  let selections=0;g.get('pdf-ocr-output').setSelectionRange=()=>{selections++;};
  // showOcrWordCrop protects identity; pass the live stored result.
  g.context.__page=1;g.context.__flag=flag;
  const vm=require('node:vm');await g.finish(vm.runInContext('showOcrWordCrop(__page,ocrResults.get(__page),__flag)',g.context),'live header crop');
  assert.equal(selections,0,'Unrecognized region must not select an unrelated text token');assert.equal(g.get('pdf-ocr-review-image').classList.contains('hidden'),false,'Restored region can still show its source crop');
  assert.equal(g.requests.length,0);assert.equal(g.workers.length,0);
  checks.push('Header summary and offset -1/confidence null region survive save/restore; source crop remains available without selecting unrelated OCR text');

  const tokens=Array.from({length:45},(_,index)=>'word'+index),bodyText=tokens.join(' ');
  const data={text:bodyText,confidence:50,blocks:[{paragraphs:[{lines:[{words:tokens.map((text,index)=>({text,confidence:50,bbox:{x0:20+index*35,y0:100,x1:50+index*35,y1:120}}))}]}]}]};
  function controller(header){
    const h=sessionFixture({pages:1,recognize:()=>({data:structuredClone(data)})});
    h.get('pdf-ocr-lang').value='heb_rashi';h.get('pdf-ocr-rashi-refine').checked=false;
    if(header)h.context.SeferStudioOcrHeaderCoverage=header;
    return h;
  }
  const regions=Array.from({length:4},(_,index)=>({...flag,bbox:{x0:200+index*80,y0:10,x1:250+index*80,y1:38}}));
  const mixed=controller({collectOcrHeaderCoverage:()=>({flags:regions,summary:{...summary,status:'incomplete',regionCount:6,shownRegions:4}})});
  await mixed.finish(mixed.run(),'mixed word/region review');simulatedPageRecognitions+=mixed.calls.length;
  const mixedRow=mixed.row(1);assert.equal(mixedRow.flags.length,40);assert.deepEqual(mixedRow.flags.slice(0,4),regions,'Header regions stay visible before the 40-item cap');assert(mixedRow.flags.slice(4).every(item=>item.kind!=='unrecognized-region'));assert.equal(mixedRow.flaggedCount,51);assert.equal(mixedRow.text,bodyText);assert.equal(mixedRow.searchWords.length,45);assert.equal(mixed.calls.length,1);
  const mixedReport=mixed.context.buildOcrReport([1]).pages[0];assert.equal(mixedReport.reviewWordCount,45);assert.equal(mixedReport.reviewItemCount,51);assert.equal(mixedReport.headerCoverage.regionCount,6);
  mixed.get('pdf-ocr-output').value=bodyText+' corrected';mixed.context.persistDisplayedOcrText();assert.equal(mixed.row(1).headerCoverage.editedAfterReview,true);assert.equal(mixed.row(1).flags.length,0);assert.equal(mixed.context.buildOcrReport([1]).pages[0].reviewItemCount,0);
  checks.push('Header regions precede the 40-item cap; reports distinguish word/item counts and mark historical coverage after edits');

  for(const mode of ['missing','throws']){
    const h=controller(mode==='throws'?{collectOcrHeaderCoverage:()=>{throw new Error('Unreadable optional helper');}}:null);await h.finish(h.run(),'optional header helper '+mode);simulatedPageRecognitions+=h.calls.length;
    const result=h.row(1);assert.equal(result.status,'recognized');assert.equal(result.text,bodyText);assert.equal(result.searchWords.length,45);assert.equal(result.headerCoverage.status,'unavailable');assert.equal(result.headerCoverage.regionCount,0);assert.equal(result.flaggedCount,45);assert(result.reviewNotes.some(note=>/could not be fully checked/.test(note)));assert.equal(h.calls.length,1);assert.equal(h.requests.length,0);
  }
  checks.push('Missing or throwing optional header helper retains successful OCR text, word positions, and ordinary review flags');
  const result={status:'PASS',candidate,sha256:crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'),cases:checks.length,checks,realNetworkRequests:0,realOcrCalls:0,simulatedPageRecognitions};
  fs.writeFileSync(path.join(__dirname,'header-session-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

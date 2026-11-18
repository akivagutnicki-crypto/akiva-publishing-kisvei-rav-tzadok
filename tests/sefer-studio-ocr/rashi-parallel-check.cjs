'use strict';
// Real controller concurrency checks; only browser/worker I/O is simulated.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const candidate=path.resolve(process.argv[2]||'dist/sefer-studio/index.html');
const harnessPath=path.resolve(process.env.SEFER_OCR_TEST_ROOT||'tests/sefer-studio-ocr','async-controller-check.cjs');
const harness=fs.readFileSync(harnessPath,'utf8'),fixtureModule=new Module(harnessPath,module);
fixtureModule.filename=harnessPath;fixtureModule.paths=module.paths;
fixtureModule._compile(harness.slice(0,harness.indexOf('const checks = [];'))+'\nmodule.exports={fixture,plain,deferred};',harnessPath);
const {fixture,plain,deferred}=fixtureModule.exports;
const firstLines=['שלום עולם','מקור קדום','דברי תורה','אור חדש'];
const refinedLines=['שלום עלם','מקור קרום','דברי תרה','אור חדר'];
function recognition(lines,cropped=false){return {data:{text:lines.join('\n'),confidence:90,blocks:[{paragraphs:[{lines:lines.map((text,i)=>({text,bbox:{x0:cropped?12:20,y0:cropped?12:20+i*40,x1:220,y1:cropped?32:40+i*40},words:text.split(' ').map((token,j)=>({text:token,confidence:91,bbox:{x0:(cropped?12:24)+j*38,y0:cropped?12:20+i*40,x1:(cropped?12:24)+j*38+32,y1:cropped?30:38+i*40}}))}))}]}]}};}
function parallel(options={}){
  const lineCalls=[],events=[],creations=[],parameters=[],active=new Map();let maxActive=0,sameWorkerOverlap=false;
  const f=fixture({pages:options.pages||1,createWorker:worker=>{
    let parameterCount=0,mode=null;
    worker.setParameters=async params=>{parameters.push({worker:worker.id,...params});events.push({type:'parameters',worker:worker.id,params});if(options.configure)await options.configure(worker,params,++parameterCount);mode=params.tessedit_pageseg_mode??mode;};
    const original=worker.recognize;
    worker.recognize=canvas=>{
      const crop=String(canvas.source||'').startsWith('crop:');
      if(crop){const count=(active.get(worker.id)||0)+1;active.set(worker.id,count);if(count>1)sameWorkerOverlap=true;maxActive=Math.max(maxActive,[...active.values()].reduce((a,b)=>a+b,0));assert.equal(mode,7,'Line worker uses SINGLE_LINE');}
      else assert.equal(mode,3,'Full-page worker uses AUTO');
      events.push({type:'recognize',worker:worker.id,crop,source:canvas.source,page:canvas.page});
      let answer;try{answer=original.call(worker,canvas);}catch(error){answer=Promise.reject(error);}
      return Promise.resolve(answer).finally(()=>{if(crop)active.set(worker.id,(active.get(worker.id)||0)-1);});
    };
    const terminate=worker.terminate;
    worker.terminate=async()=>{events.push({type:'terminate',worker:worker.id});return terminate.call(worker);};
    return options.initialize?options.initialize(worker):worker;
  },recognize:call=>{
    if(call.page)return recognition(options.firstLines||firstLines);
    const match=/^crop:(\d+):(\d+)$/.exec(call.source||'');assert(match,'Crop records its source page and row');
    const record={worker:call.worker,page:Number(match[1]),index:(Number(match[2])-20)/40};lineCalls.push(record);
    return options.line?options.line(record,lineCalls.length):recognition([refinedLines[record.index]],true);
  }});
  const create=f.context.document.createElement;
  f.context.document.createElement=tag=>{
    const element=create(tag);if(tag==='canvas'){
      const get=element.getContext; element.getContext=()=>{const context=get();context.drawImage=(source,_left,top)=>{element.source='crop:'+source.page+':'+top;};return context;};
    }return element;
  };
  const workerFactory=f.context.Tesseract.createWorker;
  f.context.Tesseract.createWorker=(...args)=>{creations.push(args);return workerFactory(...args);};
  f.get('pdf-ocr-lang').value='heb_rashi';f.get('pdf-ocr-rashi-refine').checked=options.refine!==false;f.get('pdf-ocr-rashi-fast').checked=options.fast!==false;
  return {...f,lineCalls,events,creations,parameters,maxActive:()=>maxActive,sameWorkerOverlap:()=>sameWorkerOverlap};
}
const checks=[];
async function check(name,fn){await fn();checks.push(name);}
function clean(f){assert(f.workers.every(worker=>worker.terminateCount===1),'Each worker is terminated exactly once');assert(f.canvases.every(canvas=>canvas.width===1&&canvas.height===1),'All rendered and cropped canvases released');assert.equal(f.sameWorkerOverlap(),false,'No worker receives concurrent recognition calls');}
(async()=>{
  await check('Two-worker refinement stays bounded and reconstructs text, audit, and geometry in source order',async()=>{
    const waiting=new Map(),f=parallel({line:record=>{const wait=deferred();waiting.set(record.index,wait);return wait.promise;}});
    const run=f.run();await f.until(()=>f.lineCalls.length===2,'two lines in flight');assert.equal(f.workers.length,2);assert.equal(f.maxActive(),2);
    waiting.get(1).resolve(recognition([refinedLines[1]],true));await f.until(()=>f.lineCalls.length===3,'third line while first pending');
    waiting.get(2).resolve(recognition([refinedLines[2]],true));await f.until(()=>f.lineCalls.length===4,'fourth line while first pending');
    waiting.get(3).resolve(recognition([refinedLines[3]],true));await f.flush();assert.equal(f.row(1),null,'No partially refined page committed');
    waiting.get(0).resolve(recognition([refinedLines[0]],true));await f.finish(run,'out-of-order completion');
    const row=f.row(1);assert.equal(row.text,refinedLines.join('\n'));assert.deepEqual(row.rashiRefinement.lines.map(line=>line.line),[1,2,3,4]);assert.deepEqual(row.rashiRefinement.lines.map(line=>line.selectedText),refinedLines);assert.equal(row.rashiRefinement.firstPassText,firstLines.join('\n'));assert.deepEqual(row.searchWords.filter((_,i)=>i%2===0).map(word=>word[2]),[20,60,100,140]);assert.equal(f.maxActive(),2);clean(f);
    assert.equal(f.creations[0][0],'heb_rashi');assert.equal(f.creations[1][0],'heb_rashi');assert.equal(f.creations[0][2].langPath,f.creations[1][2].langPath);assert.equal(f.creations[0][2].cachePath,f.creations[1][2].cachePath);
  });
  await check('The default serial path and disabled refinement never start an auxiliary worker',async()=>{
    for(const options of [{fast:false},{refine:false}]){const f=parallel(options);await f.finish(f.run(),'optional parallel disabled');assert.equal(f.workers.length,1);assert(f.maxActive()<=1);if(options.refine===false)assert.equal(f.lineCalls.length,0);clean(f);}
  });
  await check('A page with one detected line does not start an unnecessary auxiliary worker',async()=>{
    const f=parallel({firstLines:[firstLines[0]]});await f.finish(f.run(),'one detected line');assert.equal(f.workers.length,1);assert.equal(f.row(1).text,refinedLines[0]);assert.equal(f.row(1).rashiRefinement.detectedLines,1);assert.equal(f.lineCalls.length,1);clean(f);
  });
  await check('Both workers are reused across pages and primary AUTO resets precede every full-page scan',async()=>{
    const f=parallel({pages:2});await f.finish(f.run(),'two pages');assert.equal(f.workers.length,2);assert.equal(f.row(1).text,refinedLines.join('\n'));assert.equal(f.row(2).text,refinedLines.join('\n'));assert.equal(f.lineCalls.length,8);assert(f.lineCalls.some(call=>call.worker===2&&call.page===1));assert(f.lineCalls.some(call=>call.worker===2&&call.page===2));clean(f);
  });
  await check('Stop terminates both in-flight workers, retains a previous edit, and discards every late line',async()=>{
    const waiting=[],f=parallel({line:()=>{const d=deferred();waiting.push(d);return d.promise;}});f.context.storeOcrResult(1,{text:'Previously checked text',status:'edited',flags:[]});f.get('pdf-ocr-rescan').checked=true;
    const run=f.run();await f.until(()=>f.lineCalls.length===2,'parallel recognition starts');f.stop();await f.finish(run,'stop parallel');assert.equal(f.row(1).text,'Previously checked text');assert.equal(f.lineCalls.length,2);assert(f.workers.every(worker=>worker.terminateCount===1));
    waiting.forEach((d,i)=>d.resolve(recognition([refinedLines[i]],true)));await f.flush();assert.equal(f.row(1).text,'Previously checked text');assert.equal(f.lineCalls.length,2);clean(f);
  });
  await check('Replacing the PDF during parallel recognition prevents stale text and further scheduling',async()=>{
    const waiting=[],f=parallel({line:()=>{const d=deferred();waiting.push(d);return d.promise;}}),run=f.run();await f.until(()=>f.lineCalls.length===2,'parallel recognition starts');await f.replace('B',2);await f.finish(run,'source replaced');const status=f.status();waiting.forEach((d,i)=>d.resolve(recognition([refinedLines[i]],true)));await f.flush();assert.equal(f.rows().length,0);assert.equal(f.pdfState.fileName,'B.pdf');assert.equal(f.status(),status);assert.equal(f.lineCalls.length,2);clean(f);
  });
  await check('Stop or source replacement during auxiliary startup gates repeated Run and retires its late worker once',async()=>{
    for(const reason of ['stop','source']){
      const waiting=deferred(),f=parallel({initialize:worker=>worker.id===2?waiting.promise:worker}),run=f.run();await f.until(()=>f.workers.length===2,'auxiliary initialization');if(reason==='stop')f.stop();else await f.replace('B',2);await f.finish(run,'cancel auxiliary init');await f.run();assert.equal(f.workers.length,2,'Repeated Run cannot create another pending initializer');assert.equal(f.lineCalls.length,0);waiting.resolve(f.workers[1]);await f.flush();assert.equal(f.row(1),null);clean(f);
    }
  });
  await check('An auxiliary startup failure falls back to one worker without dropping text or retrying each page',async()=>{
    const f=parallel({pages:2,initialize:worker=>worker.id===2?Promise.reject(new Error('Secondary startup failed')):worker});await f.finish(f.run(),'auxiliary failure');assert.equal(f.row(1).text,refinedLines.join('\n'));assert.equal(f.row(2).text,refinedLines.join('\n'));assert.equal(f.workers.length,2);assert(f.lineCalls.every(call=>call.worker===1));assert.equal(f.workers[0].terminateCount,1);
  });
  await check('Auxiliary configuration failure retires it and keeps the primary refinement working',async()=>{
    const f=parallel({pages:2,configure:worker=>{if(worker.id===2)throw new Error('Secondary configuration failed');}});await f.finish(f.run(),'auxiliary configuration failure');assert.equal(f.row(1).text,refinedLines.join('\n'));assert.equal(f.row(2).text,refinedLines.join('\n'));assert.equal(f.workers.length,2);assert(f.lineCalls.every(call=>call.worker===1));clean(f);
  });
  await check('One failed auxiliary recognition retains its first-pass line while the healthy primary completes the rest',async()=>{
    let failedIndex=null;const f=parallel({line:record=>{if(record.worker===2&&failedIndex===null){failedIndex=record.index;return Promise.reject(new Error('Secondary recognize failed'));}return recognition([refinedLines[record.index]],true);}});await f.finish(f.run(),'auxiliary line failure');assert.notEqual(failedIndex,null);const expected=refinedLines.map((text,index)=>index===failedIndex?firstLines[index]:text);assert.equal(f.row(1).text,expected.join('\n'));assert.equal(f.row(1).rashiRefinement.lines.length,4);assert.equal(f.row(1).rashiRefinement.fallbackLines,1);assert.equal(f.lineCalls.filter(call=>call.worker===2).length,1);clean(f);
  });
  await check('A failed primary line is retained, the healthy auxiliary completes coverage, and the next page gets a new primary',async()=>{
    let failedIndex=null;const f=parallel({pages:2,line:record=>{if(record.worker===1&&record.page===1&&failedIndex===null){failedIndex=record.index;return Promise.reject(new Error('Primary recognize failed'));}return recognition([refinedLines[record.index]],true);}});await f.finish(f.run(),'primary line failure and next page');assert.notEqual(failedIndex,null);const expected=refinedLines.map((text,index)=>index===failedIndex?firstLines[index]:text);assert.equal(f.row(1).text,expected.join('\n'));assert.equal(f.row(1).rashiRefinement.lines.length,4);assert.equal(f.row(2).text,refinedLines.join('\n'));assert.equal(f.workers.length,3);assert.equal(f.events.filter(event=>event.type==='recognize'&&!event.crop&&event.page===2)[0].worker,3);clean(f);
  });
  await check('If both workers fail, even unattempted lines remain in the saved text and complete audit',async()=>{
    const f=parallel({line:()=>Promise.reject(new Error('Both workers failed'))});await f.finish(f.run(),'both workers fail');const result=f.row(1);assert.equal(result.status,'recognized');assert.equal(result.text,firstLines.join('\n'));assert.equal(result.rashiRefinement.lines.length,4);assert.deepEqual(result.rashiRefinement.lines.map(line=>line.selectedText),firstLines);assert.equal(result.rashiRefinement.fallbackLines,4);assert.equal(f.lineCalls.length,2);clean(f);
  });
  await check('A primary AUTO reset failure preserves the complete first pass and recreates the primary on the next page',async()=>{
    const f=parallel({pages:2,configure:(worker,_params,count)=>{if(worker.id===1&&count===3)throw new Error('Primary reset failed');}});await f.finish(f.run(),'primary reset failure');assert.equal(f.row(1).text,firstLines.join('\n'));assert.equal(f.row(1).rashiRefinement.applied,false);assert.equal(f.row(1).rashiRefinement.status,'skipped');assert.equal(f.row(2).text,refinedLines.join('\n'));assert.equal(f.workers.length,3);clean(f);
  });
  const report={status:'PASS',candidate,sha256:crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'),cases:checks.length,checks,realNetworkRequests:0};fs.writeFileSync(path.join(__dirname,'rashi-parallel-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

import fs from 'node:fs';
import assert from 'node:assert/strict';
function replaceOnce(text,from,to){assert.equal(text.split(from).length,2,'Unexpected patch anchor: '+from.slice(0,70));return text.replace(from,to);}
const baselinePath='scripts/reader-ui-baseline.py';
let baseline=fs.readFileSync(baselinePath,'utf8');
baseline=replaceOnce(baseline,"runs=api('/actions/runs?branch=main&status=success&per_page=100')['workflow_runs']","runs=api('/actions/runs?branch=main&per_page=100')['workflow_runs']");
baseline=replaceOnce(baseline,"        if run['path'] not in PUBLISHERS or run['conclusion']!='success':continue",`        if run['path'] not in PUBLISHERS:continue
        deployed = run['conclusion']=='success'
        # Post-deployment browser checks may fail after Pages has already published.
        # Preserve the actual deployed artifact; the live hash guard still applies.
        if not deployed and run['path']=='.github/workflows/reader-ui-release.yml' and run['conclusion']=='failure':
            jobs=api('/actions/runs/'+str(run['id'])+'/jobs')['jobs']
            deployed=any(step['name']=='Publish responsive reader' and step['conclusion']=='success'
                         for job in jobs for step in job.get('steps',[]))
        if not deployed:continue`);
baseline=replaceOnce(baseline,"['dist/library/index.html','dist/library/sw.js','.github/workflows/pages.yml']","['dist/library/index.html','dist/library/sw.js','.github/workflows/pages.yml','scripts/reader-ui-baseline.py','scripts/apply-reader-ui.mjs','scripts/test-reader-ui-browser.mjs']");
fs.writeFileSync(baselinePath,baseline);
const applyPath='scripts/apply-reader-ui.mjs';
let apply=fs.readFileSync(applyPath,'utf8');
const guardPatch=String.raw`
// Do not let a delayed contents request write into a newer route.
if(!html.includes('const stillOnBookView =')){
  const start=html.indexOf('async function renderBook(title) {');
  const end=html.indexOf('function renderLocalNode(',start);
  assert(start>=0 && end>start,'Expected the existing book contents renderer');
  let block=html.slice(start,end);
  const edit=(from,to)=>{assert.equal(block.split(from).length,2,'Unexpected book renderer: '+from);block=block.replace(from,to);};
  edit('  const actions =', "  const bookView = document.getElementById('toc');\n  const stillOnBookView = () => bookView?.isConnected && document.getElementById('toc') === bookView;\n  const actions =");
  edit('    await catalogReady;', '    await catalogReady;\n    if (!stillOnBookView()) return;');
  edit('      const toc = await loadToc(lb.slug);', '      const toc = await loadToc(lb.slug);\n      if (!stillOnBookView()) return;');
  edit('    const root = Array.isArray(shape) ? shape[0] : shape;', '    if (!stillOnBookView()) return;\n    const root = Array.isArray(shape) ? shape[0] : shape;');
  edit('  } catch (e) {', '  } catch (e) {\n    if (!stillOnBookView()) return;');
  html=html.slice(0,start)+block+html.slice(end);
}
if(!sw.includes('-reader-ui-route-safe-v2')){
  const shell=/const SHELL = ` + '`([^`]+)`;' + String.raw`/;
  assert(shell.test(sw));
  sw=sw.replace(shell,(_,value)=>'const SHELL = ` + '`' + String.raw`'+value+'-reader-ui-route-safe-v2` + '`;' + String.raw`');
}
`;
apply=replaceOnce(apply,"fs.writeFileSync(htmlPath,html);fs.writeFileSync(swPath,sw);",guardPatch+"\nfs.writeFileSync(htmlPath,html);fs.writeFileSync(swPath,sw);");
fs.writeFileSync(applyPath,apply);
const testPath='scripts/test-reader-ui-browser.mjs';
let test=fs.readFileSync(testPath,'utf8');
test=replaceOnce(test,"page.on('pageerror',e=>errors.push(e.message));","page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack,url:page.url()}));");
const raceTests=String.raw`
 // Hold a real TOC response until after navigation. Late success, late failure,
 // and a second book with the same DOM IDs must not write into another page.
 for(const scenario of ['home-success','home-error','different-book']){
  const ctx=await browser.newContext({serviceWorkers:'block'});
  const p=await ctx.newPage();
  p.on('pageerror',e=>errors.push({scenario,message:e.message,stack:e.stack,url:p.url()}));
  let release,started,finished;
  const gate=new Promise(resolve=>release=resolve);
  const requested=new Promise(resolve=>started=resolve);
  const completed=new Promise(resolve=>finished=resolve);
  await p.route('**/data/resisei-layla/toc.json*',async route=>{
   const response=await route.fetch(); started(); await gate;
   if(scenario==='home-error')await route.fulfill({status:500,contentType:'text/plain',body:'Deliberate failure after navigation'});
   else await route.fulfill({response});
   finished();
  });
  await p.goto(base);await p.waitForSelector('#libraryBookshop .shop-shelf');
  await p.evaluate(()=>{location.hash='#/book/Resisei_Layla';});
  await p.waitForSelector('.toc-head');
  await Promise.race([requested,new Promise((_,reject)=>setTimeout(()=>reject(Error('TOC request was not intercepted')),30000))]);
  if(scenario==='different-book'){
   await p.evaluate(()=>{location.hash='#/book/Dover_Tzedek';});
   await p.waitForSelector('#tocActions .btn');
  }else{
   await p.evaluate(()=>{location.hash='#/';});
   await p.waitForSelector('#libraryBookshop .shop-shelf');
  }
  const before=await p.locator('#app').textContent();
  release();await completed;await p.waitForTimeout(600);
  assert.equal(await p.locator('#app').textContent(),before,'Late TOC request changed the newer page: '+scenario);
  await ctx.close();
 }
`;
test=replaceOnce(test," assert.equal(errors.length,0,'Unexpected JavaScript errors: '+errors.join('; '));",raceTests+"\n assert.equal(errors.length,0,'Unexpected JavaScript errors: '+JSON.stringify(errors));");
test=replaceOnce(test,"androidUserAgent:true,errors,physicalDevicesTested:false","androidUserAgent:true,lateTocSuccess:true,lateTocFailure:true,lateTocOtherBook:true,errors,physicalDevicesTested:false");
test=replaceOnce(test,"}catch(e){fs.writeFileSync(`${out}/failure.txt`,String(e.stack||e));throw e;}","}catch(e){fs.writeFileSync(`${out}/failure.txt`,String(e.stack||e));fs.writeFileSync(`${out}/browser-report.json`,JSON.stringify({base,passed:false,viewports:results,errors,failure:String(e.stack||e),physicalDevicesTested:false},null,2));throw e;}");
fs.writeFileSync(testPath,test);
console.log('Prepared focused route guards, deployed-baseline selection and deterministic delayed-response tests.');

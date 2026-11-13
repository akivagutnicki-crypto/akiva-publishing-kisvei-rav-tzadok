const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.DC25_PLAYWRIGHT||'playwright');
const root=path.resolve(process.argv[2]);
const server=http.createServer((req,res)=>{
 let name=decodeURIComponent(req.url.split('?')[0]);if(name.endsWith('/'))name+='index.html';
 const file=path.resolve(root,'.'+name);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.pdf':'application/pdf','.m4a':'audio/mp4'})[path.extname(file)]||'application/octet-stream');
 const size=fs.statSync(file).size;const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
 if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),size-1):size-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}
 else{res.setHeader('Content-Length',size);fs.createReadStream(file).pipe(res);}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'});const page=await context.newPage();
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/library/#/read/Divrei_Chalomot_25');
  const card=page.locator('.divrei25-media');await card.waitFor();assert.equal(await card.count(),1);
  assert.equal(await card.locator('audio').count(),1);assert.equal(await card.locator('details').getAttribute('open'),null);
  assert.equal(await card.locator('.shiur-speed').inputValue(),'1');await card.locator('.shiur-speed').selectOption('1.5');
  assert.equal(await card.locator('audio').evaluate(a=>a.playbackRate),1.5);
  await card.locator('audio').evaluate(a=>a.load());await page.waitForFunction(()=>document.querySelector('.divrei25-media audio').readyState>=1);
  assert(Math.abs(await card.locator('audio').evaluate(a=>a.duration)-3982.6)<1);
  await card.locator('audio').evaluate(a=>{a.currentTime=120;});
  await card.locator('.shiur-restart').click();assert.equal(await card.locator('audio').evaluate(a=>a.currentTime),0);
  await card.locator('summary').click();assert.equal(await card.locator('details').evaluate(d=>d.open),true);
  assert((await card.locator('iframe').getAttribute('src')).includes('divrei-chalomot-ois-25-interlinear-commentary.pdf'));
  assert.equal(await page.locator('.source-note-trigger[data-note-key^="DC25-"]:visible').count(),76);
  assert.equal(await card.evaluate(c=>{const p=c.closest('.sec').querySelector('.seg');return !!p && !!(c.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING);}),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  fs.mkdirSync('artifacts/divrei-chalomot25-media',{recursive:true});await page.screenshot({path:`artifacts/divrei-chalomot25-media/${width}.png`});
  await context.close();
 }}finally{await browser.close();server.close();}
 console.log('PASS: desktop/mobile combined card, real audio metadata/seek/speed/restart, collapsed PDF toggle and 76 preserved footnotes');
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

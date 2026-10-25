import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {loadPack} from '../scripts/publish-tzidkat-reader-json.mjs';
const args=process.argv.slice(2),arg=(n,d)=>args.includes(n)?args[args.indexOf(n)+1]:d;
const root=path.resolve(arg('--root','dist')),live=arg('--url',null),{pack}=loadPack();
const out='artifacts/tzidkat-reader-json';fs.mkdirSync(out,{recursive:true});
let playwright;try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
let server,base=live;
if(!base){server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://local').pathname);let f=path.resolve(root,'.'+name);assert(f.startsWith(root+path.sep));if(fs.statSync(f).isDirectory())f=path.join(f,'index.html');res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port+'/library/';}
const browser=await playwright.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
const report={ok:false,publiclyVerified:!!live,viewports:[],errors:[]};
// Exercise early, middle, and final chapters, including the longer corrected range.
const samples=[20,166,1036,2194].map(n=>pack.approval.records.find(r=>r.number===n));assert(samples.every(Boolean));
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};});
  await context.route(u=>u.origin!==new URL(base).origin,r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));let checked=0;
  for(const r of samples){
   const ref='Tzidkat HaTzadik '+r.ois;await page.goto(base+'#/read/'+ref.replaceAll(' ','_'),{waitUntil:'domcontentloaded'});
   await page.waitForFunction(ref=>[...document.querySelectorAll('.sec')].some(s=>s.dataset.ref===ref&&s.dataset.connectionFootnotesMounted==='true'),ref,{timeout:60000});
   const sec=page.locator('.sec[data-ref="'+ref+'"]'),sel='[data-note-key="'+r.afterNote.placementId+'"]';
   const marker=sec.locator('.seg-il .ph-he button'+sel),box=sec.locator('.seg-il .reader-footnote'+sel);
   assert.equal(await marker.count(),1);assert.equal(Number(await marker.getAttribute('data-fn')),r.number);assert.equal(await sec.locator('.seg-il .ph-en button'+sel).count(),0);
   const anchor=await marker.evaluate(e=>{const range=document.createRange();range.selectNodeContents(e.closest('.ph-he'));range.setEndBefore(e);const c=range.cloneContents();c.querySelectorAll('.footnote-marker,.reader-footnote').forEach(n=>n.remove());return {prefix:c.textContent,phrase:[...e.closest('.seg').querySelectorAll('.seg-il .ph')].indexOf(e.closest('.ph'))};});
   assert.equal(anchor.prefix,r.afterNote.heAnchorPrefix);assert.equal(anchor.phrase,r.afterNote.phraseIndex);
   assert.deepEqual(await box.locator('.annotation-text').allTextContents(),r.afterNote.paragraphs.map(p=>p.text));
   for(const s of r.afterNote.sources||[])if(s.url)assert(await box.locator('a').evaluateAll((links,url)=>links.some(a=>a.getAttribute('href')===url),s.url));
   await marker.click();assert(await box.isVisible());assert.equal(await marker.getAttribute('aria-expanded'),'true');assert(await box.evaluate(e=>e.scrollWidth<=e.clientWidth+2));
   if(checked===0)await page.screenshot({path:path.join(out,(live?'live':'local')+'-'+width+'.png')});
   await marker.click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);checked++;
  }
  report.viewports.push({width,quotedNotesOpened:checked,exactHebrewAnchors:checked,sourceLinksPreserved:true});await context.close();
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
}finally{fs.writeFileSync(path.join(out,(live?'live':'local')+'-browser.json'),JSON.stringify(report));await browser.close();if(server)await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report));

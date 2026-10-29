import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
import {splitNotes,plain} from '../scripts/takanat-review-core.mjs';
const dir=path.resolve(process.env.AKIVA_ROOT||'dist');
const live=process.env.AKIVA_LIVE_URL||null;
const out='artifacts/takanat-part2-cp25';fs.mkdirSync(out,{recursive:true});
const checks=[14,15].map(id=>({id,ref:'Takanat HaShavin '+id,rows:JSON.parse(fs.readFileSync(path.join(dir,'library/data/takanat-hashavin',id+'.json'))).filter(x=>x.p)}));
assert.equal(checks[0].rows.flatMap(r=>r.footnotes||[]).length,26);
assert.equal(checks[1].rows.flatMap(r=>r.footnotes||[]).length,740);
const tidy=x=>String(x).replace(/\s+/g,' ').trim();
let browser,server,base=live?.replace(/\/?$/,'/');
const result={ok:false,readbackMode:live?'public-site':'local-candidate',release:'20261029-takanat-part2-scholarly-audit25',viewports:[],errors:[]};
try{
 if(!base){server=http.createServer((req,res)=>{try{const target=path.resolve(dir,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert(target===dir||target.startsWith(dir+path.sep));const f=fs.statSync(target).isDirectory()?path.join(target,'index.html'):target;res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);}catch{res.writeHead(404).end();}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));base='http://127.0.0.1:'+server.address().port+'/library/';}
 const playwright=await import('playwright');browser=await playwright.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:960},hasTouch:width===390,serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};});
  await context.route(url=>url.origin!==new URL(base).origin,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  const page=await context.newPage();page.on('pageerror',e=>result.errors.push({width,error:e.message}));const sections=[];
  for(const {id,ref,rows} of checks){
   await page.goto(base+'#/read/'+encodeURIComponent(ref).replace(/%20/g,'_'),{waitUntil:'domcontentloaded'});
   await page.waitForFunction(s=>[...document.querySelectorAll('.sec')].some(e=>e.dataset.ref===s&&e.dataset.connectionFootnotesMounted==='true'),ref,{timeout:80000});
   await page.locator('#setBtn').click();await page.locator('#settings .seg-ctl[data-pref="lang"] button[data-v="bi"]').click();await page.locator('#settings .seg-ctl[data-pref="layout"] button[data-v="inter"]').click();await page.locator('#setBtn').click();
   const element=page.locator('.sec[data-ref="'+ref+'"]');
   assert.equal(await element.getAttribute('data-connected-ideas-status'),'checked',ref+' validated conceptual quote pins');
   const native=rows.flatMap(row=>(row.footnotes||[]).map(note=>({row,note})).sort((a,b)=>a.note.phraseIndex-b.note.phraseIndex));
   const actual=await element.locator('.seg-il .reader-footnote[data-source-note="true"]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.noteKey,text:[...node.querySelectorAll('.annotation-text')].map(p=>p.textContent),urls:[...node.querySelectorAll('.annotation-text a')].map(a=>a.getAttribute('href'))})));
   assert.deepEqual(actual,native.map(({note})=>({id:note.placementId,text:note.paragraphs.map(p=>p.text),urls:note.paragraphs.flatMap(p=>(p.rich||[]).filter(run=>run.href).map(run=>run.href))})),ref+' every native source note and link');
   const markers=await element.locator('.seg-il .footnote-marker[data-note-key]').evaluateAll(nodes=>nodes.map(mark=>{const range=document.createRange();range.selectNodeContents(mark.closest('.ph-he'));range.setEndBefore(mark);const content=range.cloneContents();content.querySelectorAll('.footnote,.footnote-marker').forEach(n=>n.remove());return{id:mark.dataset.noteKey,paragraph:mark.closest('.seg').dataset.ref,hebrewOnly:Boolean(mark.closest('.ph-he')),prefix:content.textContent};}));
   const ordered=rows.flatMap(row=>(row.footnotes||[]).map(note=>({row,note})).sort((a,b)=>a.note.phraseIndex-b.note.phraseIndex||a.note.heCharOffset-b.note.heCharOffset));
   assert.deepEqual(markers.map(m=>({...m,prefix:tidy(m.prefix)})),ordered.map(({row,note})=>({id:note.placementId,paragraph:ref+':'+row.n,hebrewOnly:true,prefix:tidy(note.heAnchorPrefix)})),ref+' exact Hebrew attachment points');
   const visible=await element.evaluate(element=>{const buttons=[...element.querySelectorAll('.seg-il .footnote-marker[data-note-key]')];for(const b of buttons){const id=b.dataset.noteKey;const card=[...element.querySelectorAll('.reader-footnote[data-source-note="true"]')].find(n=>n.dataset.noteKey===id);if(!card)throw Error('Unmatched popup '+id);b.click();if(b.getAttribute('aria-expanded')!=='true'||!card.classList.contains('open'))throw Error('Popup failed open '+id);b.click();if(b.getAttribute('aria-expanded')!=='false'||card.classList.contains('open'))throw Error('Popup failed close '+id);}return buttons.length;});
   assert.equal(visible,native.length,ref+' all source popups functional');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,ref+' no horizontal overflow');
   await page.screenshot({path:path.join(out,(live?'live':'candidate')+'-siman'+id+'-'+width+'.png'),fullPage:false});
   sections.push({ref,nativeNotes:visible,allSourceTextsUrlsAndHebrewPositionsChecked:true,allPopupsOpenedAndClosed:true});
  }
  result.viewports.push({width,sections});await context.close();
 }
 assert.deepEqual(result.errors,[]);result.ok=true;
}finally{fs.writeFileSync(path.join(out,(live?'live':'candidate')+'-browser-report.json'),JSON.stringify(result,null,2)+'\n');if(browser)await browser.close();if(server)await new Promise(ok=>server.close(ok));}
console.log(JSON.stringify({ok:true,mode:result.readbackMode,viewports:result.viewports.length,notesPerViewport:766}));

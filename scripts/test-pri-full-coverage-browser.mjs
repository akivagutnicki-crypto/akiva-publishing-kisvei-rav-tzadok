// Render the missing sections in the actual web reader, not only JSON checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
const dir='dist/library/data/peri-tzadik/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
const leaves=[];function walk(n){if(n?.ref)leaves.push(n);for(const x of n?.children||[])walk(x);}walk(toc.toc);
const selected=[
 ['Peri Tzadik, Bereshit 1',45],
 ['Peri Tzadik, Noach 9',9],
 ['Peri Tzadik, Lech Lecha 1',9],
 ['Peri Tzadik, Rosh Chodesh Kislev 1',26],
 ['Peri Tzadik, Chanukah 1',52]
];
const root=path.resolve('dist');
const server=http.createServer((req,res)=>{
 let filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{
  if(fs.statSync(filename).isDirectory())filename=path.join(filename,'index.html');
  const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'};
  res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');
  res.end(fs.readFileSync(filename));
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'External source test'}));
 const page=await ctx.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const hash=s=>encodeURIComponent(s).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
 for(const [ref,count] of selected){
  await page.goto('http://127.0.0.1:'+server.address().port+'/library/#/read/'+hash(ref));
  const block=page.locator('#text > .sec[data-ref="'+ref+'"]');
  const markers=block.locator('.seg-il .ph-he button.footnote-marker');
  await markers.first().waitFor({state:'visible',timeout:30000});
  assert.equal(await markers.count(),count,'Hebrew footnotes invisible for '+ref);
  assert.equal(await block.locator('.seg-il .ph-en button.footnote-marker').count(),0,'Extra English footnote numbers '+ref);
  const trigger=markers.first(),id=await trigger.getAttribute('data-fn');
  await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  const note=block.locator('.reader-footnote[data-fn="'+id+'"]').first();
  assert.ok(await note.isVisible(),'Footnote did not open '+ref);
  assert.ok(await note.locator('.annotation-text').count()>=1,'Missing English note text '+ref);
  assert.ok(await note.locator('a[href^="https://www.sefaria.org/"]').count()>=1,'Sefaria citation not clickable '+ref);
  console.log('PASS '+ref+': '+count+' actual Hebrew markers and clickable Sefaria source');
 }
 assert.deepEqual(errors,[],'JavaScript exceptions in reader');
 await ctx.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}

// Browser integration: Hebrew footnote number -> complete English popup.
// Exercise opening, a middle siman, and the final siman on a mobile viewport.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
const root=path.resolve('dist');
const dir='dist/library/data/machshavot-charutz/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
const targets=[1,11,21];
const server=http.createServer((req,res)=>{
  let filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{
    if(fs.statSync(filename).isDirectory())filename=path.join(filename,'index.html');
    const mime={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
    res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');
    res.end(fs.readFileSync(filename));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/plain',body:'Offline source preview'}));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const n of targets){
    const ref='Machshavot Charutz '+n;
    const leaf=toc.toc.children.find(x=>x.ref===ref);
    assert.ok(leaf?.interlinear,'Missing interlinear reader entry '+ref);
    const data=JSON.parse(fs.readFileSync(dir+leaf.id+'.json','utf8'));
    const notes=data.filter(x=>x.p).flatMap(i=>(i.footnotes||[]).map(note=>({note,item:i})));
    assert.ok(notes.length>0,'Footnotes missing in '+ref);
    const hash=encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',');
    await page.goto(origin+'/library/#/read/'+hash);
    const section=page.locator('#text > .sec[data-ref="'+ref+'"]');
    await section.locator('.seg-il .ph-he button.footnote-marker').first().waitFor({state:'visible',timeout:30000});
    const markers=section.locator('.seg-il .ph-he button.footnote-marker');
    assert.equal(await markers.count(),notes.length,'Hebrew markers missing '+ref);
    assert.equal(await section.locator('.seg-il .ph-en button.footnote-marker').count(),0,'English footnote numbers duplicated '+ref);
    const boxes=section.locator('.seg-il .reader-footnote');
    assert.equal(await boxes.count(),notes.length,'Popup text missing '+ref);
    const first=notes[0].note;
    const marker=section.locator('.seg-il .ph-he button[data-fn="'+first.number+'"]').first();
    const box=section.locator('.seg-il .reader-footnote[data-fn="'+first.number+'"]').first();
    await marker.click();
    assert.equal(await marker.getAttribute('aria-expanded'),'true','Hebrew marker did not open '+ref);
    assert.ok(await box.isVisible(),'Footnote popup invisible '+ref);
    assert.equal(await box.locator('.annotation-text').count(),first.paragraphs.length,'Expanded parallel text missing '+ref);
    assert.deepEqual(await box.locator('.annotation-text').allTextContents(),first.paragraphs.map(p=>p.text),'Footnote popup text altered '+ref);
    await marker.click();
    assert.equal(await marker.getAttribute('aria-expanded'),'false','Hebrew marker did not close '+ref);
    console.log('PASS Machshavot mobile popup:',ref,notes.length,'markers and',first.paragraphs.length,'English source paragraphs');
  }
  assert.deepEqual(errors,[],'Browser errors in expanded Machshavot');
  await context.close();
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

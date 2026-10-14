// Browser smoke test for exact Hebrew-only source markers in the published reader.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
const root=path.resolve('dist');
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const data='dist/library/data/divrei-soferim/';
const toc=JSON.parse(fs.readFileSync(data+'toc.json','utf8'));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await page.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>linked source</p>'}));
 let total=0;
 for(const leaf of toc.toc.children.filter(x=>/^Divrei Soferim \d+$/.test(x.ref))){
  const expected=JSON.parse(fs.readFileSync(data+leaf.id+'.json','utf8')).flatMap(i=>i.footnotes||[]);
  await page.goto(origin+'/library/#/read/'+encodeURIComponent(leaf.ref).replace(/%20/g,'_'));
  const section=page.locator('#text > .sec[data-ref="'+leaf.ref+'"]');
  await section.locator('.seg-il .ph-he button.source-note-trigger').first().waitFor({state:'visible'});
  const marks=await section.evaluate(el=>{
   const found=[];
   for(const he of el.querySelectorAll('.seg-il .ph-he')){
    const walker=document.createTreeWalker(he,NodeFilter.SHOW_TEXT);let node,prefix='';
    while((node=walker.nextNode())){
     const mark=node.parentElement?.closest('.source-note-trigger');
     if(mark)found.push({id:mark.dataset.noteKey,prefix,number:mark.textContent,nested:!!mark.closest('a')});
     else prefix+=node.textContent;
    }
   }
   return found;
  });
  assert.equal(marks.length,expected.length,'Exactly one Hebrew marker per note '+leaf.ref);
  assert.equal(await section.locator('.seg-il .ph-en .source-note-trigger').count(),0,'English marker forbidden');
  for(const note of expected){
   const marker=marks.find(m=>m.id===note.placementId);
   assert.ok(marker,'Missing note '+note.placementId);
   assert.equal(marker.prefix,note.heAnchorPrefix,'Misplaced Hebrew footnote '+note.placementId);
   assert.equal(+marker.number,note.number);
   assert.equal(marker.nested,false,'Do not place markers inside links');
  }
  const cards=await section.evaluate(el=>[...el.querySelectorAll('.seg-il .reader-footnote[data-source-note]')].map(node=>({
   id:node.dataset.noteKey,paragraphs:[...node.querySelectorAll('.annotation-text')].map(p=>p.textContent)
  })));
  assert.equal(cards.length,expected.length,'Missing note bodies '+leaf.ref);
  for(const note of expected)assert.deepEqual(cards.find(c=>c.id===note.placementId)?.paragraphs,note.paragraphs.map(p=>p.text));
  if(leaf.ref==='Divrei Soferim 1'){
   const note=expected[0],trigger=section.locator('.seg-il .ph-he button.source-note-trigger[data-note-key="'+note.placementId+'"]');
   await trigger.click();
   const box=section.locator('.seg-il .reader-footnote[data-note-key="'+note.placementId+'"]');
   assert.ok(await box.isVisible(),'Source popup did not expand');
   assert.ok(await box.locator('a[href^="https://www.sefaria.org/"]').count(),'Missing Sefaria link in note');
   await trigger.click();assert.ok(!(await box.isVisible()),'Source popup did not close');
  }
  total+=expected.length;
 }
 assert.equal(total,491);
 console.log('PASS mobile browser: 491 Hebrew-only markers, matching complete English inline source notes in 38 chapters');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}

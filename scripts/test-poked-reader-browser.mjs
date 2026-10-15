// Mobile-browser verification of 925 Hebrew-only expandable source notes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
const root=path.resolve('dist');
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{
  if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8',
    '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const folder='dist/library/data/poked-akarim/';
const toc=JSON.parse(fs.readFileSync(folder+'toc.json','utf8'));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await page.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>External source</p>'}));
 let count=0;
 for(const leaf of toc.toc.children.filter(x=>/^Poked Akarim [1-6]$/.test(x.ref))){
  const items=JSON.parse(fs.readFileSync(folder+leaf.id+'.json','utf8'));
  const expected=items.flatMap(i=>(i.footnotes||[]).filter(n=>n.sourceId?.startsWith('PA-')));
  await page.goto(origin+'/library/#/read/'+encodeURIComponent(leaf.ref).replace(/%20/g,'_'));
  const section=page.locator('#text > .sec[data-ref="'+leaf.ref+'"]');
  await section.locator('.seg-il .ph-he button.source-note-trigger').first().waitFor({state:'visible'});
  const markers=await section.evaluate(el=>{
    const found=[];
    for(const he of el.querySelectorAll('.seg-il .ph-he')){
      const walk=document.createTreeWalker(he,NodeFilter.SHOW_TEXT);let node,prefix='';
      while((node=walk.nextNode())){
        const mark=node.parentElement?.closest('.source-note-trigger');
        if(mark)found.push({id:mark.dataset.noteKey,prefix,number:mark.textContent,nested:!!mark.closest('a')});
        else prefix+=node.textContent;
      }
    }
    return found;
  });
  assert.equal(markers.length,expected.length,'One Hebrew marker per Poked source note '+leaf.ref);
  assert.equal(await section.locator('.seg-il .ph-en button.source-note-trigger').count(),0,'Footnote number appears in English '+leaf.ref);
  for(const note of expected){
   const marker=markers.find(m=>m.id===note.placementId);
   assert.ok(marker,'Missing Poked marker '+note.placementId);
   assert.equal(marker.prefix,note.heAnchorPrefix,'Wrong Hebrew word '+note.placementId);
   assert.equal(+marker.number,note.number);
   assert.equal(marker.nested,false,'Marker placed inside hyperlink '+note.placementId);
  }
  const cards=await section.evaluate(el=>[...el.querySelectorAll('.seg-il .reader-footnote[data-source-note]')].map(node=>({
    id:node.dataset.noteKey,paragraphs:[...node.querySelectorAll('.annotation-text')].map(p=>p.textContent)
  })));
  assert.equal(cards.length,expected.length,'Missing Poked reader footnote bodies '+leaf.ref);
  for(const note of expected)assert.deepEqual(cards.find(c=>c.id===note.placementId)?.paragraphs,note.paragraphs.map(p=>p.text));
  if(leaf.ref==='Poked Akarim 1'){
    const note=expected[0],trigger=section.locator('.seg-il .ph-he button.source-note-trigger[data-note-key="'+note.placementId+'"]');
    await trigger.click();
    const box=section.locator('.seg-il .reader-footnote[data-note-key="'+note.placementId+'"]');
    assert.ok(await box.isVisible(),'Poked source popup did not open');
    assert.ok(await box.locator('a[href^="https://www.sefaria.org/"]').count(),'Missing clickable Poked source');
    await trigger.click();
    assert.ok(!(await box.isVisible()),'Poked source popup did not close');
  }
  count+=expected.length;
 }
 assert.equal(count,925);
 console.log('PASS mobile reader: 925 correctly anchored Hebrew-only Poked Akarim note buttons and complete source popups in six sections');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}

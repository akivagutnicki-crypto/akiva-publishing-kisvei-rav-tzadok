// Mobile browser smoke test for Sichat Malakhei HaSharet source popups.
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
const dir='dist/library/data/sichat-malakhei-hasharet/';
const targets=[
 ['0-1.json','Sichat Malakhei HaSharet 1'],
 ['1.json','Sichat Malakhei HaSharet, From Yerushalmi'],
 ['4.json',"Sichat Malakhei HaSharet, A Note on Angels' Names"]
];
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await page.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>source opened</p>'}));
 let inspected=0;
 for(const [file,ref] of targets){
  const expected=JSON.parse(fs.readFileSync(dir+file,'utf8'))
    .flatMap(item=>(item.footnotes||[]).filter(n=>n.sourceId?.startsWith('SM-')));
  assert.ok(expected.length>0,'Missing notes '+ref);
  const slug=encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
  await page.goto(origin+'/library/#/read/'+slug);
  const section=page.locator('#text > .sec[data-ref="'+ref.replace(/'/g,"\\'")+'"]');
  await section.locator('.seg-il .ph-he button.source-note-trigger').first().waitFor({state:'visible'});
  const markers=await section.evaluate(el=>{
   const found=[];
   for(const he of el.querySelectorAll('.seg-il .ph-he')){
    const walk=document.createTreeWalker(he,NodeFilter.SHOW_TEXT);let node,prefix='';
    while((node=walk.nextNode())){
     const marker=node.parentElement?.closest('.source-note-trigger');
     if(marker)found.push({id:marker.dataset.noteKey,prefix,num:marker.textContent});
     else prefix+=node.textContent;
    }
   }
   return found;
  });
  assert.equal(markers.length,expected.length,'Wrong count of Hebrew markers '+ref);
  assert.equal(await section.locator('.seg-il .ph-en .source-note-trigger').count(),0,
    'Footnote number duplicated in the English '+ref);
  for(const note of expected){
   const mark=markers.find(m=>m.id===note.placementId);
   assert.ok(mark,'Missing Hebrew number '+note.sourceId);
   assert.equal(mark.prefix,note.heAnchorPrefix,'Misplaced Hebrew marker '+note.sourceId);
   assert.equal(+mark.num,note.number);
  }
  const cards=await section.evaluate(el=>[...el.querySelectorAll('.seg-il .reader-footnote[data-source-note]')]
   .map(card=>({id:card.dataset.noteKey,text:[...card.querySelectorAll('.annotation-text')].map(p=>p.textContent)})));
  assert.equal(cards.length,expected.length,'Missing full source popup bodies '+ref);
  for(const note of expected)
   assert.deepEqual(cards.find(c=>c.id===note.placementId)?.text,note.paragraphs.map(p=>p.text));
  const first=expected[0];
  const trigger=section.locator('.seg-il .ph-he button.source-note-trigger[data-note-key="'+first.placementId+'"]');
  await trigger.click();
  const popup=section.locator('.seg-il .reader-footnote[data-note-key="'+first.placementId+'"]');
  assert.ok(await popup.isVisible(),'Source popup did not open '+ref);
  assert.ok(await popup.locator('a[href^="https://www.sefaria.org/"]').count(),
    'Primary source Sefaria hyperlink not clickable '+ref);
  await trigger.click();
  assert.ok(!(await popup.isVisible()),'Source popup did not close '+ref);
  inspected+=expected.length;
 }
 console.log('PASS Sichat mobile-browser source popups, Hebrew markers, and live Sefaria source links; '+inspected+' notes examined across three representative sections');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}

// Mobile browser checks of Et HaOchel Hebrew-only expandable notes.
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
const folder='dist/library/data/et-haochel/';
const toc=JSON.parse(fs.readFileSync(folder+'toc.json','utf8'));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await page.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>External source</p>'}));
 let checked=0;
 for(const sectionIndex of Array.from({length:16},(_,i)=>i)){
  const leaf=toc.toc.children[sectionIndex];
  const items=JSON.parse(fs.readFileSync(folder+leaf.id+'.json','utf8'));
  const expected=items.flatMap(i=>(i.footnotes||[]).filter(n=>n.sourceId?.startsWith('EH-')));
  const hash=encodeURIComponent(leaf.ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
  await page.goto(origin+'/library/#/read/'+hash);
  const section=page.locator('#text > .sec[data-ref="'+leaf.ref+'"]');
  await section.locator('.seg-il .ph-he button.source-note-trigger').first().waitFor({state:'visible'});
  const marks=await section.evaluate(el=>{
   const found=[];
   for(const he of el.querySelectorAll('.seg-il .ph-he')){
    const walker=document.createTreeWalker(he,NodeFilter.SHOW_TEXT);let node,prefix='';
    while((node=walker.nextNode())){
     const mark=node.parentElement?.closest('.source-note-trigger');
     if(mark)found.push({id:mark.dataset.noteKey,prefix,num:mark.textContent,nested:!!mark.closest('a')});
     else prefix+=node.textContent;
    }
   }
   return found;
  });
  assert.equal(marks.length,expected.length,'Incorrect mobile markers '+leaf.ref);
  assert.equal(await section.locator('.seg-il .ph-en button.source-note-trigger').count(),0,
    'English text must not include duplicate note numbers '+leaf.ref);
  for(const note of expected){
    const m=marks.find(x=>x.id===note.placementId);
    assert.ok(m,'Missing Et HaOchel marker '+note.placementId);
    assert.equal(m.prefix,note.heAnchorPrefix,'Wrong Hebrew word for '+note.placementId);
    assert.equal(+m.num,note.number);
    assert.equal(m.nested,false,'Footnote nested inside citation link');
  }
  const cards=await section.evaluate(el=>[...el.querySelectorAll('.seg-il .reader-footnote[data-source-note]')].map(n=>({
   id:n.dataset.noteKey,text:[...n.querySelectorAll('.annotation-text')].map(p=>p.textContent)
  })));
  assert.equal(cards.length,expected.length,'Incorrect popup note count '+leaf.ref);
  for(const note of expected)
   assert.deepEqual(cards.find(c=>c.id===note.placementId)?.text,note.paragraphs.map(p=>p.text));
  const first=expected[0],trigger=section.locator('.seg-il .ph-he button.source-note-trigger[data-note-key="'+first.placementId+'"]');
  await trigger.click();
  const popup=section.locator('.seg-il .reader-footnote[data-note-key="'+first.placementId+'"]');
  assert.ok(await popup.isVisible(),'Et HaOchel popup did not expand');
  assert.ok(await popup.locator('a[href^="https://www.sefaria.org/"]').count(),
    'Et HaOchel source hyperlink absent');
  await trigger.click();
  assert.ok(!(await popup.isVisible()),'Et HaOchel popup did not collapse');
  checked+=expected.length;
 }
 console.log('PASS Et HaOchel mobile-browser Hebrew-only footnotes and source popup links in all 16 oisiyos ('+checked+' notes)');
}finally{await browser.close();await new Promise(ok=>server.close(ok));}


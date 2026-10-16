// Real-reader smoke test for editorial section titles and thematic segues.
import fs from 'node:fs';import path from 'node:path';
import http from 'node:http';import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=path.resolve('dist');
const paths=[
 'Poked Akarim 1',
 'Machshavot Charutz 1',
 'Likkutei Maamarim, On Book of Joshua',
 'Divrei Chalomot 1',
 'Kometz HaMinchah 1:1',
 'Et HaOchel 1'
];
const server=http.createServer((req,res)=>{
 let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 let file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 const ext=path.extname(file);
 res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'})[ext]||'application/octet-stream');
 res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await context.route('https://**/*',route=>route.fulfill({status:200,body:'External reference',contentType:'text/plain'}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const ref of paths){
   const hash=encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
   await page.goto('http://127.0.0.1:'+server.address().port+'/library/#/read/'+hash);
   const root=page.locator('#text > .sec[data-ref="'+ref+'"]');
   const main=root.locator('.subhead.reader-section-break').first();
   await main.waitFor({state:'visible',timeout:30000});
   assert.ok((await main.innerText()).trim().length>15,'Section headline does not render '+ref);
   assert.ok(await root.locator('.subhead.en-head').count()>1,'Subheadings missing '+ref);
   assert.ok(await root.locator('.seg-il .ph-he').count(),'Original Hebrew not rendered '+ref);
   assert.ok(await root.locator('.seg-il .ph-en').count(),'Original interlinear English not rendered '+ref);
   console.log('PASS live-reader heading '+ref+': '+(await root.locator('.subhead').count())+' headings, Hebrew and English present');
 }
 // Confirm that the actual mobile book contents display thematic titles,
 // not generic "Teaching 1" or "Ois 1" labels.
 const menu=[
  {book:'Peri_Tzadik',chapter:'Peri_Tzadik,_Vayera_1',expected:'Divine Revelation, Circumcision, and the Shabbat Soul'},
  {book:'Peri_Tzadik',chapter:'Peri_Tzadik,_Chayei_Sara_1',expected:'Eshet Chayil, Sarah, and the Field of Machpelah'},
  {book:'Et_HaOchel',chapter:'Et_HaOchel_1',expected:'Eating, Fasting, and the Sanctity of Body and Mind'}
 ];
 for(const entry of menu){
   await page.goto('http://127.0.0.1:'+server.address().port+'/library/#/book/'+entry.book);
   const link=page.locator('#toc a[href="#/read/'+entry.chapter+'"]').first();
   await link.waitFor({state:'visible',timeout:30000});
   const name=await link.innerText();
   assert.ok(name.includes(entry.expected),'Generic or incorrect public reader TOC title: '+entry.chapter+' : '+name);
   console.log('PASS real-reader themed TOC '+entry.chapter+': '+entry.expected);
 }
 assert.deepEqual(errors,[],'Reader JS errors');
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}

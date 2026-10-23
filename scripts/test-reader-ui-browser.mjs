import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const pos=process.argv.indexOf('--url');
let server;
let base=pos>=0?process.argv[pos+1]:null;
if(!base){
 const root=path.resolve('.ui-site');
 server=http.createServer((req,res)=>{
  let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.writeHead(404).end();return;}
  const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base=`http://127.0.0.1:${server.address().port}/library/`;
}
const out='reader-ui-evidence';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];const errors=[];
const sizes=[[320,740],[360,800],[390,844],[430,932],[600,960],[768,1024],[820,1180],[960,1536],[1024,768],[1100,900],[1101,900],[1280,800],[1440,900],[1536,960],[1920,1080],[844,390]];
const snapshots=new Set(['390x844','820x1180','960x1536','1440x900','844x390']);
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const [width,height] of sizes){
  await page.setViewportSize({width,height});await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#libraryBookshop .shop-shelf',{timeout:60000});
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('#libraryBookshop .shop-group:first-child img,.top .mark img')].map(i=>i.decode().catch(()=>{})));});
  await page.waitForTimeout(250);
  const metrics=await page.evaluate(()=>{
   const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right};};
   const shop=document.getElementById('libraryBookshop'),nav=[...document.querySelectorAll('.topnav a')];
   const track=shop.querySelector('.shop-shelf');
   return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,nav:nav.map(el=>({text:el.textContent,...box(el),display:getComputedStyle(el).display})),logo:document.querySelector('.mark img')?.naturalWidth||0,shop:box(shop),compact:shop.classList.contains('compact-bookshop'),afterIntro:shop.previousElementSibling?.classList.contains('intro')||false,inSidebar:!!shop.closest('aside.side'),groups:shop.querySelectorAll('.shop-group').length,books:shop.querySelectorAll('.shop-book').length,images:[...shop.querySelectorAll('.shop-group:first-child img')].map(i=>({loaded:i.naturalWidth>0,fit:getComputedStyle(i).objectFit})),track:{scroll:track.scrollWidth,client:track.clientWidth},header:box(document.querySelector('.top')),sticky:getComputedStyle(document.querySelector('.top')).position,offset:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-h'))};
  });
  assert(!metrics.overflow,`Page overflow at ${width}`);assert(metrics.logo>0,'Logo did not load');
  assert.deepEqual(metrics.nav.map(n=>n.text),['Texts','Weekly Torah','Our books','About','Support']);
  for(const n of metrics.nav){assert(n.w>0&&n.h>=43.9&&n.x>=-1&&n.right<=width+1,`Navigation clipped at ${width}: ${n.text}`);}
  for(let i=0;i<metrics.nav.length;i++)for(let j=i+1;j<metrics.nav.length;j++)assert(metrics.nav[i].right<=metrics.nav[j].x+1||metrics.nav[j].right<=metrics.nav[i].x+1,'Navigation overlap');
  assert.equal(metrics.groups,3);assert.equal(metrics.books,5);assert(metrics.images.every(i=>i.loaded&&i.fit==='contain'));
  assert.equal(metrics.compact,width<=1100);assert(width<=1100?metrics.afterIntro:metrics.inSidebar,'Bookshop at wrong responsive location');
  assert.equal(metrics.offset,metrics.sticky==='sticky'?Math.ceil(metrics.header.h):0);
  results.push({viewport:[width,height],...metrics});
  if(snapshots.has(`${width}x${height}`)){
   await page.screenshot({path:`${out}/${width}x${height}.png`,fullPage:false});
   await page.locator('#libraryBookshop').screenshot({path:`${out}/books-${width}x${height}.png`});
  }
 }
 // The same mounted bookshop must survive rotation; no duplicate cards or IDs.
 await page.setViewportSize({width:390,height:844});await page.goto(base);await page.waitForSelector('#libraryBookshop .shop-shelf');
 await page.evaluate(()=>{window.__originalShop=document.getElementById('libraryBookshop');});
 for(const size of [{width:1536,height:960},{width:820,height:1180},{width:390,height:844}]){
  await page.setViewportSize(size);await page.waitForTimeout(150);
  assert(await page.evaluate(()=>document.querySelectorAll('#libraryBookshop').length===1&&document.getElementById('libraryBookshop')===window.__originalShop));
 }
 const next=page.getByRole('button',{name:'Next books',exact:true});await next.click();await page.waitForTimeout(550);
 assert(await page.locator('.shop-shelf').evaluate(e=>e.scrollLeft>100),'Shelf arrow did not scroll');
 await page.locator('.shop-shelf').focus();await page.keyboard.press('ArrowLeft');await page.waitForTimeout(550);
 assert(await page.locator('.shop-shelf').evaluate(e=>e.scrollLeft<5),'Keyboard shelf navigation failed');
 // No route mutation: book navigation and return to the home shelf still work.
 await page.goto(base+'#/book/Resisei_Layla');await page.waitForSelector('.toc-head',{timeout:60000});
 await page.goto(base+'#/');await page.waitForSelector('#libraryBookshop .shop-shelf');
 assert.equal(await page.locator('#libraryBookshop').count(),1);
 for(const theme of ['dark','sepia']){
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:`${out}/phone-${theme}.png`});
 }
 await context.close();
 const android=await browser.newContext({viewport:{width:412,height:915},hasTouch:true,isMobile:true,deviceScaleFactor:2,serviceWorkers:'block',userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 AkivaPublishingAndroid/1.0.5'});
 const app=await android.newPage();await app.goto(base);await app.waitForSelector('#libraryBookshop.compact-bookshop');
 assert(await app.locator('body').evaluate(e=>e.classList.contains('akiva-android-reader')));
 assert(await app.locator('.topnav').isVisible());await app.screenshot({path:`${out}/android-wrapper-412.png`});await android.close();
 assert.equal(errors.length,0,'Unexpected JavaScript errors: '+errors.join('; '));
 fs.writeFileSync(`${out}/browser-report.json`,JSON.stringify({base,viewports:results,rotation:true,shelfButtons:true,keyboard:true,spaReturn:true,androidUserAgent:true,errors,physicalDevicesTested:false},null,2));
 console.log('PASS: 16 viewport layouts, rotation, real cover loading, navigation, shelf controls, themes, SPA return and Android-wrapper user agent.');
}catch(e){fs.writeFileSync(`${out}/failure.txt`,String(e.stack||e));throw e;}finally{await browser.close();if(server)server.close();}

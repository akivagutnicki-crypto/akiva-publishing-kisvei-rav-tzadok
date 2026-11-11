// Exercise the real Reader with the Pri Tzaddik Moadim editions (adapted from scripts/pri-shemos/test-browser.mjs):
// every chapter on desktop (and the first of each group on a phone) shows every phrase pair, in order, exactly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const OVERLAY='sources/akiva/overlays/pri-moadim-20261111';
const manifest=read(`${OVERLAY}/manifest.json`);
const root=path.resolve(process.env.MOADIM_SITE || 'dist');
const live=process.argv.includes('--url')?process.argv[process.argv.indexOf('--url')+1]:null;
let pw;try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const hash=r=>encodeURIComponent(r).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const plain=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
let server;let base=live;
if(!base){
  server=http.createServer((req,res)=>{
    try{
      let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
      assert(file.startsWith(root+path.sep));
      if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
      const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
      res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/library/`;
}
if(!base.endsWith('/'))base+='/';
const report={edition:manifest.edition,live:!!live,viewports:[],pageErrors:[],ok:false};
const output='artifacts/pri-moadim';fs.mkdirSync(output,{recursive:true});
let browser;
try{
  browser=await pw.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,serviceWorkers:'block'});
    await context.addInitScript(()=>{
      localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));
      window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
    });
    await context.route(u=>u.origin!==new URL(base).origin,r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
    const page=await context.newPage();page.setDefaultTimeout(30000);
    page.on('pageerror',e=>report.pageErrors.push({width,error:e.message}));
    await page.goto(base+'#/book/Peri_Tzadik',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelectorAll('#toc a[href^="#/read/"]').length>100);
    const hrefs=await page.locator('#toc a[href^="#/read/"]').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
    for(const section of manifest.sections)assert(hrefs.includes('#/read/'+hash(section.ref)),'Missing contents link '+section.ref);
    for(const volume of manifest.volumes)assert(await page.locator('a[download][href="downloads/'+volume.download+'"]').count(),'Word download missing '+volume.download);
    const samples=width===1280?manifest.sections:manifest.groups.map(g=>manifest.sections.find(s=>s.parashah===g));
    const checks=[];
    for(const section of samples){
      const rows=read(`${OVERLAY}/${section.id}.json`).filter(x=>x.p);
      await page.goto(base+'#/read/'+hash(section.ref),{waitUntil:'domcontentloaded'});
      await page.waitForFunction(({ref,count})=>[...document.querySelectorAll('.sec')].some(s=>s.dataset.ref===ref&&s.querySelectorAll('.seg-il .ph').length===count),{ref:section.ref,count:section.pairs},{timeout:60000});
      const actual=await page.locator('.sec').evaluateAll((nodes,ref)=>{
        const s=nodes.find(x=>x.dataset.ref===ref);
        const paragraphs=[...s.querySelectorAll('.seg')].map(seg=>({n:Number(seg.dataset.i),pairs:[...seg.querySelectorAll('.seg-il .ph')].map(ph=>({
          he:ph.querySelector('.ph-he').textContent,en:ph.querySelector('.ph-en').textContent}))}));
        return {paragraphs,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+8,
          download:s.querySelector('.section-docx-link a')?.getAttribute('href')};
      },section.ref);
      assert.equal(actual.paragraphs.length,rows.length,section.ref+' paragraph count');
      for(let i=0;i<rows.length;i++){
        const row=rows[i],ar=actual.paragraphs[i];assert.equal(ar.n,row.n,section.ref+' paragraph number');
        assert.deepEqual(ar.pairs.map(p=>[p.he,p.en]),row.p.map(([h,e])=>[plain(h),plain(e)]),section.ref+' phrase pairs, paragraph '+row.n);
      }
      assert(!actual.horizontalOverflow,section.ref+' horizontal overflow');
      assert.equal(actual.download,'downloads/'+manifest.volumes.find(v=>v.volume===section.volume).download,section.ref+' download');
      if(width===390&&['Shavuos','Sukkos'].includes(section.parashah)||width===1280&&['Peri Tzadik, Shavuot 1','Peri Tzadik, Sukkot 10'].includes(section.ref))
        await page.screenshot({path:`${output}/${live?'live':'local'}-${section.ref.replace(/\W+/g,'-')}-${width}.png`});
      checks.push({ref:section.ref,paragraphs:rows.length,pairs:section.pairs});
    }
    report.viewports.push({width,sections:checks});await context.close();
  }
  assert.deepEqual(report.pageErrors,[]);report.ok=true;
}finally{
  fs.writeFileSync(`${output}/${live?'live':'local'}-browser.json`,JSON.stringify(report,null,2));
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
}
console.log(JSON.stringify({ok:report.ok,desktopSections:report.viewports[0]?.sections.length,mobileSections:report.viewports[1]?.sections.length,pairs:report.viewports[0]?.sections.reduce((n,s)=>n+s.pairs,0)}));

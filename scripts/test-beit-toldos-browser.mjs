import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {BOOK,SLUG,readPack} from './publish-beit-toldos.mjs';
let playwright;
try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const root=path.resolve('dist'),publicBase=process.env.AKIVA_READER_URL;
const server=http.createServer((req,res)=>{
  let f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{if(fs.statSync(f).isDirectory())f=path.join(f,'index.html');
    res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=publicBase||`http://127.0.0.1:${server.address().port}/library/`;
const hash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const browser=await playwright.chromium.launch({headless:true});
try{
  for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));});
    await context.route('https://www.sefaria.org/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({he:[],text:[],versions:[]})}));
    await page.goto(base+'#/book/Beit_Yaakov_on_Torah');
    const toc=page.locator('#toc a[href^="#/read/Beit_Yaakov_on_Torah,_Toldot_"]');
    await toc.last().waitFor();assert.equal(await toc.count(),52);
    for(const chapter of [1,14,15,16,20,47,52]){
      const ref=`${BOOK}, Toldot ${chapter}`;await page.goto(base+'#/read/'+hash(ref));
      const section=page.locator(`#text > .sec[data-ref="${ref}"]`);
      await section.locator('.seg-il .ph-he').first().waitFor();
      const count=readPack().sections.find(s=>s.chapter===chapter).items.reduce((n,i)=>n+i.p.length,0);
      assert.equal(await section.locator('.ph-he').count(),count);assert.equal(await section.locator('.ph-en').count(),count);
      assert.doesNotMatch((await section.locator('.ph-en').allTextContents()).join(''),/[\[\]]/);
      assert.equal(await section.locator('.section-docx-link a[download]').count(),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Horizontal overflow '+ref);
    }
    await page.goto(base+'#/read/'+hash(BOOK+', Toldot 14'));
    await page.locator('#text .ph-he').first().waitFor();await page.locator('#nextBtn').click();
    await page.waitForURL(base+'#/read/'+hash(BOOK+', Toldot 15'));
    await page.locator('#text .ph-he').first().waitFor();await page.locator('#nextBtn').click();
    await page.waitForURL(base+'#/read/'+hash(BOOK+', Toldot 16'));
    assert.deepEqual(errors,[]);
    fs.mkdirSync('artifacts/beit-toldos',{recursive:true});
    await page.screenshot({path:`artifacts/beit-toldos/${viewport.width}.png`,fullPage:false});
    await context.close();console.log('PASS Bais Yaakov Toldos reader '+viewport.width+'px; 52 TOC entries, phrase pairs, bracket removal, download and continuous navigation');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}

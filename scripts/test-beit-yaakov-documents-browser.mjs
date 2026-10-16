import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const root=path.resolve('dist');
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  let file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{
    if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8'})[path.extname(file)]||'application/octet-stream');
    res.end(fs.readFileSync(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
const base=process.env.AKIVA_READER_URL||`http://127.0.0.1:${server.address().port}/library/`;
const hash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
try{
  for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block'});
    // UI checks use the committed sources; no external API is needed to read them.
    await context.route('https://www.sefaria.org/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({he:[],text:[],versions:[]})}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'#/book/Beit_Yaakov_on_Torah');
    await page.locator('#toc a[href="#/read/Beit_Yaakov_on_Torah,_Chayei_Sara_40"]').waitFor();
    for(const [parashah,count]of [['Vayera',58],['Chayei_Sara',40]])
      assert.equal(await page.locator(`#toc a[href^="#/read/Beit_Yaakov_on_Torah,_${parashah}_"]`).count(),count);
    assert.equal(await page.locator('#toc a[href="#/read/Beit_Yaakov_on_Torah,_Vayera_22"]').count(),0);
    for(const [parashah,ois]of [['Vayera',1],['Vayera',21],['Vayera',27],['Vayera',63],['Chayei Sara',1],['Chayei Sara',40]]){
      const ref=`Beit Yaakov on Torah, ${parashah} ${ois}`;
      await page.goto(base+'#/read/'+hash(ref));
      const section=page.locator(`#text > .sec[data-ref="${ref}"]`);
      await section.locator('.seg-il .ph-he').first().waitFor();
      assert.ok(await section.locator('.seg-il .ph-en').count());
      assert.ok(await section.locator('.subhead').count());
      assert.ok(await section.locator('.seg-il a.cite[data-ref]').count());
      const download=section.locator('.section-docx-link a[download]');
      assert.equal(await download.count(),1);
      assert.match(await download.innerText(),/interlinear Word edition/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Horizontal page overflow '+ref);
      await section.locator('.seg-il a.cite').first().click();
      await page.locator('#pContent').waitFor({state:'visible'});
      assert.ok((await page.locator('#pContent').innerText()).trim().length);
      console.log('PASS reader '+viewport.width+'px '+ref);
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
}finally{
  await browser.close();await new Promise(r=>server.close(r));
}

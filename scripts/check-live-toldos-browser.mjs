import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {gunzipSync} from 'node:zlib';

const refOf=section=>`Peri Tzadik, Toldot ${section.chapter}`;
const plain=text=>String(text).replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#x27;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

const base='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/';
const pack=JSON.parse(gunzipSync(Buffer.from(fs.readFileSync('sources/akiva/overlays/pri-toldos.json.gz.b64','utf8').trim(),'base64'))),hash=ref=>ref.replace(/ /g,'_');
fs.mkdirSync('toldos-browser-verification',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'#/book/Peri_Tzadik');
    await page.locator('#toc a[href="#/read/Peri_Tzadik,_Toldot_10"]').waitFor({timeout:45000});
    for(const section of pack.sections){
      const ref=refOf(section);
      assert.equal(await page.locator(`#toc a[href="#/read/${hash(ref)}"]`).count(),1,'One visible contents link per teaching');
    }
    for(const section of pack.sections){
      const ref=refOf(section),expected=section.items.filter(i=>i.p);
      await page.goto(base+'#/read/'+hash(ref));
      const body=page.locator(`#text > .sec[data-ref="${ref}"]`);
      await body.locator('.seg-il .ph-he').first().waitFor({timeout:45000});
      assert.equal(await body.locator('.seg').count(),expected.length);
      assert.deepEqual(await body.locator('.seg-il .ph-he').allTextContents(),expected.flatMap(i=>i.p.map(p=>plain(p[0]))));
      assert.deepEqual(await body.locator('.seg-il .ph-en').allTextContents(),expected.flatMap(i=>i.p.map(p=>plain(p[1]))));
      if(section.chapter===10)assert.ok((await body.innerText()).includes('After Havdalah'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Horizontal overflow '+ref);
      if(section.chapter===1){
        const file=`toldos-browser-verification/toldos-${width}.png`;
        await page.screenshot({path:file,fullPage:false});
        if(width===1280)console.log('TOLDOS_SCREENSHOT_BASE64='+fs.readFileSync(file).toString('base64'));
      }
      console.log(`PASS ${width}px ${ref}: exact Hebrew and English phrases rendered`);
    }
    assert.deepEqual(errors,[],'Reader JavaScript errors');
    await context.close();
  }
}finally{await browser.close();}

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const http = require('node:http');
const path = require('node:path');
const ROOT = process.cwd();
const screenshots = path.join(ROOT,'artifacts/vayeira-study');
fs.mkdirSync(screenshots,{recursive:true});
let base = process.env.READER_TEST_URL;
let server;
const ref = 'Akiva_Publishing_Weekly_Torah%2C_Vayeira_Mesiras_Nefesh';
(async()=>{
  if(!base) {
    const site=path.resolve(process.env.WEEKLY_STUDY_SITE || '.vayeira-study-site');
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.pdf':'application/pdf','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'};
    server=http.createServer((req,res)=>{
      const url=new URL(req.url,'http://localhost');
      let file=path.resolve(site,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(site+path.sep) && file!==site){res.writeHead(403).end();return;}
      try {
        if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
        res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
        fs.createReadStream(file).pipe(res);
      }catch{res.writeHead(404).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    base='http://127.0.0.1:'+server.address().port+'/library/';
  }
  const browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROMIUM || undefined,args:['--no-sandbox']});
  const results=[];
  for (const viewport of [{width:1365,height:1000},{width:390,height:844}]) {
    const context=await browser.newContext({viewport,serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'#/read/'+ref,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.weekly-study .seg-il');
    assert.equal(await page.locator('#text').getAttribute('data-lang'),'bi');
    assert.equal(await page.locator('#text').getAttribute('data-layout'),'inter');
    assert.equal(await page.locator('.weekly-study .seg').count(),25);
    assert.equal(await page.locator('.weekly-study .seg:not(.study-commentary) .ph-he').first().evaluate(e=>getComputedStyle(e).fontWeight),'400');
    assert.equal(await page.locator('.weekly-study .seg:not(.study-commentary) .ph-en').first().evaluate(e=>getComputedStyle(e).fontWeight),'700');
    assert.equal(await page.locator('.weekly-study .study-commentary .ph-en').first().evaluate(e=>getComputedStyle(e).fontWeight),'400');
    const marker=page.locator('.weekly-study .seg-il .footnote-marker').first();
    await marker.click();
    const note=page.locator('.weekly-study .seg-il .reader-footnote.open').first();
    await note.waitFor({state:'visible'});
    assert((await note.textContent()).includes('Chanukah'));
    assert(await note.locator('a').count()>0);
    assert.equal(await page.locator('.weekly-study .weekly-study-new a').count(),2);
    const attachment=page.locator('.weekly-study-pdf').first();
    await attachment.locator('summary').click();
    assert(await attachment.locator('a[download]').isVisible());
    const pdf=await context.request.get(new URL(await attachment.locator('a[download]').getAttribute('href'),base).href);
    assert.equal(pdf.status(),200);
    assert(pdf.headers()['content-type'].includes('application/pdf'));
    assert((await pdf.body()).subarray(0,5).toString()==='%PDF-');
    await page.screenshot({path:screenshots+'/reader-'+viewport.width+'.png',fullPage:false});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
    await page.locator('#nextBtn').click();
    await page.waitForFunction(()=>document.querySelector('.weekly-study')?.dataset.ref.endsWith(' Sources'));
    assert.equal(await page.locator('.weekly-study .seg').count(),34);
    assert.equal(await page.locator('.weekly-study .seg-il .footnote-marker').count(),26);
    await page.locator('.weekly-study .seg-il .footnote-marker').first().click();
    await page.locator('.weekly-study .seg-il .reader-footnote.open').first().waitFor({state:'visible'});
    await page.locator('#setBtn').click();
    await page.locator('[data-pref="lang"] [data-v="en"]').click();
    assert.equal(await page.locator('#text').getAttribute('data-lang'),'en');
    await page.locator('#setBtn').click();
    await page.locator('#tocBtn').click();
    await page.waitForSelector('.weekly-study-contents');
    assert.equal(await page.locator('.weekly-study-contents a[download]').count(),5);
    await page.locator('.weekly-study-contents a').filter({hasText:'Read the Vayeira Dvar Torah'}).click();
    await page.waitForSelector('.weekly-study');
    assert.equal(await page.locator('#text').getAttribute('data-lang'),'en','Returning reader preference was reset');
    await page.goto(base+'#/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.weekly-study-teaser');
    assert.equal(await page.locator('.weekly-study-teaser').count(),1);
    assert.equal(await page.locator('.weekly-study-teaser').getAttribute('href'),'blog/even-the-world-to-come/');
    await page.goto(base+'blog/',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#vayeira-feature-title');
    assert.equal((await page.locator('#vayeira-feature-title').textContent()).trim(),'Even the World to Come');
    const cardLinks=await page.locator('article[aria-labelledby="vayeira-feature-title"] a').evaluateAll(a=>a.map(x=>x.href));
    assert(cardLinks.length>=10,'Blog and shiur actions');
    for(const href of new Set(cardLinks.filter(h=>!h.includes('#')))) assert.equal((await context.request.get(href)).status(),200,href);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Blog listing overflow');
    for(const [dir,count] of [['blog/even-the-world-to-come/',12],['blog/even-the-world-to-come/shiur/',38]]) {
      await page.goto(base+dir,{waitUntil:'load'});
      assert.equal(await page.locator('.sheet img').count(),count);
      await page.waitForFunction(()=>{const i=document.querySelector('.sheet img');return i.complete&&i.naturalWidth===1224;});
      for(const link of await page.locator('.mast .actions a').evaluateAll(a=>a.map(x=>x.href))) {
        const res=await context.request.get(link);
        assert.equal(res.status(),200,link);
      }
      const bodies=await Promise.all((await page.locator('.mast .actions a[download]').evaluateAll(a=>a.map(x=>x.href))).map(h=>context.request.get(h).then(r=>r.body())));
      assert.deepEqual(bodies.map(b=>b.subarray(0,2).toString()).sort(),['%P','PK']);
      await page.locator('.toc summary').click();
      await page.locator('.toc li a').last().click();
      await page.waitForFunction(()=>location.hash.startsWith('#page-'));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Reader page overflow '+dir);
      await page.screenshot({path:screenshots+'/'+(dir.includes('shiur')?'shiur':'blog')+'-'+viewport.width+'.png',fullPage:false});
    }
    assert.deepEqual(errors,[]);
    results.push({viewport:viewport.width,pass:true});
    await context.close();
  }
  await browser.close();
  if(server)server.close();
  console.log(JSON.stringify({base,results}));
})().catch(e=>{console.error(e);if(server)server.close();process.exit(1)});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'))
  : await import('playwright');
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const root = path.resolve(arg('--root') || '.new-books-site');
const publicBase = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const proxy = process.argv.includes('--proxy-live');
let base = arg('--url'), server;
const fixtures = new Map();
if (!base) {
  server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {response.writeHead(403).end(); return;}
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      if (proxy && pathname.startsWith('/library/') && !pathname.includes('/editions/')) {
        try {
          const url = publicBase + pathname.slice(1) + new URL(request.url, 'http://local').search;
          if (!fixtures.has(url)) {
            const remote = await fetch(url);
            fixtures.set(url, {status:remote.status, type:remote.headers.get('content-type'), data:Buffer.from(await remote.arrayBuffer())});
          }
          const remote = fixtures.get(url);
          response.writeHead(remote.status, {'Content-Type':remote.type || 'application/octet-stream'}).end(remote.data);
        } catch (error) {response.writeHead(502).end(String(error));}
        return;
      }
      response.writeHead(404).end(); return;
    }
    const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.pdf':'application/pdf','.webmanifest':'application/manifest+json'};
    response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
}
if (!base.endsWith('/')) base += '/';
const out = 'artifacts/new-books';
fs.mkdirSync(out, {recursive:true});
const browser = await chromium.launch({headless:true, ...(process.env.NEW_BOOKS_CHROME ? {executablePath:process.env.NEW_BOOKS_CHROME} : {})});
const errors = [], failures = [], checks = [], verifiedUrls = [];
const sizes = [[1440,1000],[390,844],[844,390]];
try {
  const context = await browser.newContext({serviceWorkers:'block'});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({url:page.url(), message:error.message}));
  page.on('response', response => {if(response.status() >= 400 && response.url().includes('/editions/')) failures.push({url:response.url(),status:response.status()});});
  const response = await context.request.get(base + 'editions/catalog.json');
  assert(response.ok(), 'Missing book catalog');
  const catalog = await response.json();
  const doverResponse = await context.request.get(base + 'editions/dover-tzedek.json');
  assert(doverResponse.ok(), 'Missing Dover Tzedek print catalog');
  const doverCatalog = await doverResponse.json();
  const sampleBooks = [...catalog.books, ...doverCatalog.books];
  const expectOrder = catalog.books.map(book => book.slug);
  const assertNoOverflow = async label => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' overflows the viewport');
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    await page.goto(base, {waitUntil:'domcontentloaded'});
    await page.locator('.hero-edition img').first().waitFor();
    await page.evaluate(async () => {await document.fonts.ready; await Promise.all([...document.querySelectorAll('.hero-edition img,.print-scene img')].map(img=>{img.loading='eager';return img.decode();}));});
    await assertNoOverflow('Homepage ' + width);
    assert.deepEqual(await page.locator('.print-release').evaluateAll(nodes => nodes.map(node=>node.id)), expectOrder);
    assert(await page.evaluate(() => document.getElementById('new-books').previousElementSibling?.classList.contains('hero')), 'New books must immediately follow hero');
    assert.equal(await page.locator('.hero-edition img').count(), 2);
    for (const book of catalog.books) {
      assert.equal(await page.locator('#'+book.slug+' .purchase').getAttribute('href'), book.amazon);
      assert.equal(await page.locator('#'+book.slug+' .sample').getAttribute('href'), 'editions/sample.html?book='+book.slug);
      const bounds = await page.locator('#'+book.slug+' .sample').boundingBox();
      assert(bounds.height >= 44, 'Sample touch target too small');
    }
    await page.screenshot({path:`${out}/homepage-${width}x${height}.png`});
    await page.locator('#new-books').screenshot({path:`${out}/releases-${width}x${height}.png`});
    await page.locator('#'+catalog.books[0].slug+' .print-originals button').first().click();
    assert(await page.locator('#box').isVisible(), 'Original-cover lightbox did not open');
    assert.equal(await page.locator('#large').getAttribute('src'), 'editions/'+catalog.books[0].front);
    await page.locator('#close').click();
    checks.push({surface:'homepage',viewport:[width,height],titles:expectOrder,overflow:false});

    await page.goto(base + 'library/', {waitUntil:'domcontentloaded'});
    await page.waitForSelector('#libraryBookshop .shop-shelf', {timeout:60000});
    await page.evaluate(async () => {await document.fonts.ready; await Promise.all([...document.querySelectorAll('.shop-new img')].map(img=>img.decode()));});
    await assertNoOverflow('Reader ' + width);
    assert.deepEqual(await page.locator('.shop-shelf>.shop-group').evaluateAll(nodes => nodes.slice(0,2).map(node=>node.dataset.edition)), expectOrder);
    assert.equal(await page.locator('#libraryBookshop').count(),1);
    assert.equal(await page.locator('.shop-shelf>.shop-group').count(),7);
    assert.equal(await page.locator('#libraryBookshop .shop-book').count(),9);
    assert.equal(await page.locator('#libraryBookshop').evaluate(node=>node.classList.contains('compact-bookshop')),width<=1100);
    if (width <= 1100) {
      assert(await page.locator('#libraryBookshop').evaluate(node=>node.previousElementSibling?.classList.contains('intro')));
      await page.getByRole('button',{name:'Next books',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.shop-shelf').scrollLeft > 100);
      await page.locator('.shop-shelf').evaluate(node=>node.scrollLeft=0);
    }
    await page.locator('#libraryBookshop').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/reader-${width}x${height}.png`});
    await page.locator('#libraryBookshop').screenshot({path:`${out}/books-${width}x${height}.png`});
    checks.push({surface:'reader',viewport:[width,height],newCardsFirst:true,bookCount:9,overflow:false});

    for (const book of sampleBooks) {
      const url = base + 'editions/sample.html?book=' + book.slug;
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!document.getElementById('sample-page').hidden && document.getElementById('sample-page').naturalWidth>0);
      assert.equal(await page.locator('#sample-subtitle').textContent(),book.subtitle);
      assert(await page.locator('#previous-page').isDisabled());
      await page.locator('#page-select').selectOption('4');
      await page.waitForFunction(()=>document.getElementById('sample-page').src.includes('page-04.webp') && !document.getElementById('sample-page').hidden);
      await assertNoOverflow('Sample '+width);
      await page.screenshot({path:`${out}/${book.slug}-sample-${width}x${height}.png`});
      await page.locator('#zoom-in').click();
      assert.equal(await page.locator('#zoom-level').textContent(),'125%');
      await page.locator('#fit-width').click();
      assert.equal(await page.locator('#zoom-level').textContent(),'100%');
      await page.locator('#page-select').selectOption('20');
      await page.waitForFunction(()=>document.getElementById('sample-page').src.includes('page-20.webp') && !document.getElementById('sample-page').hidden);
      assert(await page.locator('#next-page').isDisabled());
      assert.equal(await page.locator('#sample-download').getAttribute('href'),'./'+book.pdf);
      await page.locator('#sample-viewport').focus();
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(()=>document.getElementById('sample-page').src.includes('page-19.webp') && !document.getElementById('sample-page').hidden);
      checks.push({surface:'sample',book:book.slug,viewport:[width,height],pages:[1,4,19,20],zoom:true,download:true,overflow:false});
    }
  }
  await page.goto(base+'library/editions/sample.html?book='+catalog.books[0].slug,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('sample-page').hidden && document.getElementById('sample-page').naturalWidth>0);
  assert.equal(await page.locator('#sample-download').getAttribute('href'),'../../editions/'+catalog.books[0].pdf);
  checks.push({surface:'android-compatible sample route',withinLibrary:true});
  const files = new Set(['editions/new-books.css?v='+catalog.version,'editions/akiva-nine-book-collection.webp','editions/dover-tzedek.json','editions/dover-tzedek.css?v=20261025-dover-print-v1','editions/sample.html','editions/sample.css','editions/sample.js','editions/sample-provenance.json','library/editions/sample.html']);
  for (const book of sampleBooks) {
    for (const key of ['front','back','scene','pdf']) files.add('editions/'+book[key]);
    for (let n=1;n<=20;n++) files.add(`editions/${book.pageDirectory}/page-${String(n).padStart(2,'0')}.webp`);
  }
  for (const file of files) {
    const result=await context.request.get(base+file);
    assert(result.ok(),file+' returned '+result.status());
    assert((await result.body()).length>20,'Empty asset '+file);
    verifiedUrls.push({path:file,status:result.status(),type:result.headers()['content-type']});
  }
  assert.equal(errors.length,0,'JavaScript errors: '+JSON.stringify(errors));
  assert.equal(failures.length,0,'Edition requests failed: '+JSON.stringify(failures));
  await context.close();
} finally {
  fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify({base,checks,verifiedUrls,errors,failures,readOnlyLiveFixtures:[...fixtures.keys()]},null,2));
  await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({checks:checks.length,verifiedUrls:verifiedUrls.length,errors:errors.length,readOnlyLiveFixtures:fixtures.size}));

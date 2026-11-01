const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const screenshots = path.join(process.cwd(), 'artifacts/halacha-zips');
fs.mkdirSync(screenshots, {recursive: true});
let base = process.env.READER_TEST_URL;
let server;
(async () => {
  if (!base) {
    const site = path.resolve(process.env.HALACHA_SITE || '.halacha-site');
    const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp'};
    server = http.createServer((req, res) => {
      let file = path.resolve(site, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (!file.startsWith(site + path.sep) && file !== site) { res.writeHead(403).end(); return; }
      try {
        if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
        fs.createReadStream(file).pipe(res);
      } catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port + '/library/';
  }
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  const results = [];
  for (const viewport of [{width: 1365, height: 1000}, {width: 390, height: 844}]) {
    const context = await browser.newContext({viewport, serviceWorkers: 'block'});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '#/downloads', {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('#halachaZips .pack[data-id]');
    const packs = page.locator('#halachaZips .pack[data-id]');
    assert.equal(await packs.count(), 3);
    assert.deepEqual(await packs.evaluateAll(p => p.map(x => x.dataset.id)), ['halakhah-with-meforshim', 'torahlm-halakhah', 'halachipedia-torahlm']);
    const links = await page.locator('#halachaZips a.zipb').evaluateAll(a => a.map(x => x.href));
    assert.equal(links.length, 3);
    for (const href of links) assert(href.startsWith('https://github.com/akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok/releases/download/'), href);
    for (const detail of await page.locator('#halachaZips .zip-details').allTextContents()) assert(/\d MB|\d GB/.test(detail), detail);
    // The existing collections and the Shulchan Arukh pack are still offered.
    assert.equal(await page.locator('#corpusPacks .pack').count(), 4);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
    await page.locator('.halacha-downloads').scrollIntoViewIfNeeded();
    await page.screenshot({path: screenshots + '/downloads-' + viewport.width + '.png'});
    if (process.env.READER_TEST_URL || process.env.CHECK_RELEASE_LINKS) {
      for (const href of links) {
        const response = await context.request.fetch(href, {method: 'HEAD', maxRedirects: 5});
        assert.equal(response.status(), 200, href);
      }
    }
    assert.deepEqual(errors, []);
    results.push({viewport: viewport.width, pass: true});
    await context.close();
  }
  await browser.close();
  if (server) server.close();
  console.log(JSON.stringify({base, results}));
})().catch(e => { console.error(e); if (server) server.close(); process.exit(1); });

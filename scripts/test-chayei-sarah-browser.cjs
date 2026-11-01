// Browser checks for the Parshas Chayei Sarah blog and shiur, on desktop and phone widths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const screenshots = path.join(process.cwd(), 'artifacts/vayeira-study');
fs.mkdirSync(screenshots, {recursive: true});
let base = process.env.READER_TEST_URL;
let server;
(async () => {
  if (!base) {
    const site = path.resolve(process.env.WEEKLY_STUDY_SITE || '.vayeira-study-site');
    const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf',
      '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.png': 'image/png'};
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let file = path.resolve(site, '.' + decodeURIComponent(url.pathname));
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
  const browser = await chromium.launch({headless: true, executablePath: process.env.READER_CHROMIUM || undefined, args: ['--no-sandbox']});
  const results = [];
  for (const viewport of [{width: 1365, height: 1000}, {width: 390, height: 844}]) {
    const context = await browser.newContext({viewport, serviceWorkers: 'block'});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '#/', {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('.weekly-chayei-teaser');
    assert.equal(await page.locator('.weekly-chayei-teaser').getAttribute('href'), 'blog/from-the-east/');
    await page.waitForFunction(() => { const i = document.querySelector('.weekly-chayei-teaser img'); return i && i.complete && i.naturalWidth > 100; });
    await page.goto(base + 'blog/', {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('#chayei-sarah-feature-title');
    assert.equal((await page.locator('#chayei-sarah-feature-title').textContent()).trim(), 'From the East I Will Bring Your Seed');
    const cardLinks = await page.locator('article[aria-labelledby="chayei-sarah-feature-title"] a').evaluateAll(a => a.map(x => x.href));
    assert(cardLinks.length >= 9, 'Blog and shiur actions');
    for (const href of new Set(cardLinks.filter(h => !h.includes('#')))) assert.equal((await context.request.get(href)).status(), 200, href);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Blog listing overflow');
    for (const [dir, count] of [['blog/from-the-east/', 8], ['blog/from-the-east/shiur/', 32]]) {
      await page.goto(base + dir, {waitUntil: 'load'});
      assert.equal(await page.locator('.sheet img').count(), count);
      await page.waitForFunction(() => { const i = document.querySelector('.sheet img'); return i.complete && i.naturalWidth === 1224; });
      for (const link of await page.locator('.mast .actions a').evaluateAll(a => a.map(x => x.href))) assert.equal((await context.request.get(link)).status(), 200, link);
      const bodies = await Promise.all((await page.locator('.mast .actions a[download]').evaluateAll(a => a.map(x => x.href))).map(h => context.request.get(h).then(r => r.body())));
      assert.deepEqual(bodies.map(b => b.subarray(0, 2).toString()).sort(), ['%P', 'PK']);
      await page.locator('.toc summary').click();
      await page.locator('.toc li a').last().click();
      await page.waitForFunction(() => location.hash.startsWith('#page-'));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Reader page overflow ' + dir);
      await page.screenshot({path: screenshots + '/chayei-' + (dir.includes('shiur') ? 'shiur' : 'blog') + '-' + viewport.width + '.png', fullPage: false});
    }
    assert.deepEqual(errors, []);
    results.push({viewport: viewport.width, pass: true});
    await context.close();
  }
  await browser.close();
  if (server) server.close();
  console.log(JSON.stringify({base, results}));
})().catch(e => { console.error(e); if (server) server.close(); process.exit(1); });

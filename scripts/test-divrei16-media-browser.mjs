// Exercise only the Ois 16 media card, mobile page preview, and original audio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';

const {chromium} = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  assert(['--root', '--url', '--screenshots'].includes(args[i]) && args[i + 1], 'Unknown option or missing value: ' + args[i]);
  options[args[i]] = args[++i];
}
const root = path.resolve(options['--root'] || 'dist/library');
const screenshots = options['--screenshots'];
if (screenshots) fs.mkdirSync(screenshots, {recursive: true});
let server, origin;
if (options['--url']) {
  const url = new URL(options['--url'].replace(/\/?$/, '/'));
  assert(url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname));
  origin = url.href;
} else {
  server = http.createServer((req, res) => {
    let filename;
    try { filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
    catch { res.writeHead(400).end(); return; }
    if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
      const size = fs.statSync(filename).size;
      const types = {'.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
      res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      let start = 0, end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) { res.writeHead(416, {'Content-Range': `bytes */${size}`}).end(); return; }
        if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        else start = Math.max(0, size - Number(match[2]));
        if (start > end || start >= size) { res.writeHead(416, {'Content-Range': `bytes */${size}`}).end(); return; }
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      res.setHeader('Content-Length', end - start + 1);
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(filename, {start, end}).pipe(res);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port + '/';
}

const browser = await chromium.launch({headless: true, executablePath: process.env.AKIVA_TEST_CHROMIUM || undefined});
const checks = [];
try {
  for (const device of [
    {name: 'desktop', viewport: {width: 1440, height: 1000}},
    {name: 'mobile', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}
  ]) {
    const context = await browser.newContext({viewport: device.viewport, isMobile: !!device.isMobile, hasTouch: !!device.hasTouch, serviceWorkers: 'block'});
    const page = await context.newPage();
    const errors = [], imageRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/divrei-soferim-ois-16-lech-lecha-preview/')) imageRequests.push(request.url());
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(origin).origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});
    });
    try {
      await page.goto(origin + '?divrei16-media-check=' + Date.now() + '#/read/Divrei_Soferim_16', {waitUntil: 'domcontentloaded'});
      const section = page.locator('#text > .sec[data-ref="Divrei Soferim 16"]');
      const card = section.locator('.divrei16-media');
      await card.waitFor({state: 'visible', timeout: 30000});
      assert.equal(await card.locator('.shiur-audio').count(), 1, device.name + ': missing Ois 16 player');
      assert.match(await card.locator('.shiur-audio h3').innerText(), /Divrei Soferim.*Ois 16.*Lech Lecha/);
      assert.match(await card.locator('.shiur-audio-meta').innerText(), /36:57/);
      assert.equal(await card.locator('audio').getAttribute('src'), 'audio/divrei-soferim-ois-16-lech-lecha.m4a');
      assert.equal(await card.locator('a[href="downloads/divrei-soferim-ois-16-lech-lecha-shiur.pdf?v=20261022-divrei16-transcript-v2"]').count(), 1);
      assert.equal(await card.locator('a[href="downloads/divrei-soferim-ois-16-lech-lecha-shiur.docx?v=20261022-divrei16-transcript-v2"]').count(), 1);
      assert(await section.locator('.seg').count() > 0, 'The original Ois 16 text is missing');
      assert((await section.locator('.seg').first().textContent()).trim().length > 30, 'The original text is empty');

      const preview = card.locator('.divrei16-pdf');
      const image = preview.locator('.divrei16-page-image');
      const pages = Number(await preview.getAttribute('data-preview-pages'));
      const revision = await preview.getAttribute('data-preview-version');
      assert(Number.isInteger(pages) && pages > 1, 'Missing transcript page count');
      assert.equal(revision, '20261022-divrei16-transcript-v2', 'Transcript revision is stale');
      assert.match(await preview.locator('summary').innerText(), new RegExp(`${pages} pages`));
      assert.equal(await preview.evaluate(el => el.open), false, 'Preview must begin collapsed');
      assert.equal(await image.getAttribute('src'), null, 'Page images must not load before expansion');
      assert.equal(imageRequests.length, 0, 'A preview image was requested before expansion');
      assert.equal(await preview.locator('iframe').count(), 0, 'Mobile preview must not require a native PDF viewer');
      const waitForImage = async number => {
        await page.waitForFunction(({number, revision}) => {
          const image = document.querySelector('.divrei16-page-image');
          return image && image.getAttribute('src')?.endsWith(`page-${String(number).padStart(2, '0')}.webp?v=${revision}`)
            && image.complete && image.naturalWidth > 0 && !image.hidden;
        }, {number, revision}, {timeout: 30000});
        assert.equal((await preview.locator('.divrei16-page-count').innerText()).trim(), `Page ${number} of ${pages}`);
      };
      await preview.locator('summary').click();
      await waitForImage(1);
      assert.equal(new Set(imageRequests).size, 1, 'Expanding the preview should load only its first page');
      assert(await preview.locator('[data-preview-action="previous"]').isDisabled());
      if (screenshots) await card.screenshot({path: path.join(screenshots, device.name + '-page-1.png')});
      await preview.locator('[data-preview-action="next"]').click();
      await waitForImage(2);
      await preview.locator('[data-preview-action="previous"]').click();
      await waitForImage(1);
      for (let number = 2; number <= pages; number++) {
        await preview.locator('[data-preview-action="next"]').click();
        await waitForImage(number);
      }
      assert(await preview.locator('[data-preview-action="next"]').isDisabled());
      assert.equal(new Set(imageRequests.map(url => new URL(url).pathname)).size, pages, 'Every transcript page must be readable');

      await preview.locator('[data-preview-action="zoom-in"]').click();
      assert.equal(await preview.locator('.divrei16-zoom-label').innerText(), '125%');
      await preview.locator('[data-preview-action="zoom-out"]').click();
      assert.equal(await preview.locator('.divrei16-zoom-label').innerText(), '100%');
      for (let i = 0; i < 4; i++) await preview.locator('[data-preview-action="zoom-in"]').click();
      assert.equal(await preview.locator('.divrei16-zoom-label').innerText(), '200%');
      const zoomLayout = await page.evaluate(() => {
        const viewport = document.querySelector('.divrei16-page-viewport');
        viewport.scrollLeft = 60;
        viewport.scrollTop = 60;
        return {pageWidth: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth,
          viewportWidth: viewport.clientWidth, contentWidth: viewport.scrollWidth, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop};
      });
      assert(zoomLayout.contentWidth > zoomLayout.viewportWidth + 50, 'Zoom must enlarge the image inside its viewport');
      assert(zoomLayout.scrollLeft > 0 && zoomLayout.scrollTop > 0, 'Enlarged pages must scroll in both directions');
      assert(zoomLayout.documentWidth <= zoomLayout.pageWidth + 1, device.name + ': zoom caused document horizontal overflow');
      await preview.locator('[data-preview-action="fit"]').click();
      assert.equal(await preview.locator('.divrei16-zoom-label').innerText(), '100%');
      assert(await preview.locator('[data-preview-action="zoom-out"]').isDisabled());
      assert.equal(await preview.locator('.divrei16-page-viewport').evaluate(el => el.scrollLeft), 0);

      await card.locator('audio').evaluate(audio => { audio.preload = 'metadata'; audio.load(); });
      await page.waitForFunction(() => {
        const audio = document.querySelector('.divrei16-media audio');
        return audio && Number.isFinite(audio.duration) && audio.duration > 0;
      }, undefined, {timeout: 45000});
      const duration = await card.locator('audio').evaluate(audio => audio.duration);
      assert(Math.abs(duration - 2217.472) < 1, 'The audio metadata does not match the supplied 36:57 recording');
      if (screenshots) await card.screenshot({path: path.join(screenshots, device.name + '-page-' + pages + '.png')});
      assert.deepEqual(errors, [], device.name + ': reader JavaScript errors');
      checks.push({device: device.name, pages, transcriptRevision: revision, lazyImages: true, navigation: true, zoom: true, containedScrolling: true, audioDurationSeconds: duration});
    } catch (error) {
      if (screenshots) await page.screenshot({path: path.join(screenshots, device.name + '-failure.png'), fullPage: false}).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({status: 'passed', origin, checks}, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(done => server.close(done));
}

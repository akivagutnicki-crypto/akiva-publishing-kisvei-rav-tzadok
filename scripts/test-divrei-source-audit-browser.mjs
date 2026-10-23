// Desktop/mobile smoke test of the reviewed Divrei source notes. All718 notes
// and750 quotations are checked by test-divrei-source-audit.mjs; this verifies
// actual DOM markers, complete note rendering, and the new section16 source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {readPack, RELEASE} from './publish-divrei-source-audit.mjs';

const {chromium} = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  assert(['--root', '--url', '--pack', '--screenshots'].includes(args[i]) && args[i + 1], 'Unknown option or missing value: ' + args[i]);
  options[args[i]] = args[++i];
}
const root = path.resolve(options['--root'] || 'dist/library');
const pack = readPack(options['--pack']);
const sections = [1, 8, 9, 16];
const chapterData = new Map(sections.map(section => [section, JSON.parse(pack.files.find(file => file.path === `data/divrei-soferim/${section}.json`).afterText)]));
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
      const types = {'.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'};
      res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
      res.end(fs.readFileSync(filename));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port + '/';
}
const browser = await chromium.launch({headless: true});
const checks = [];
try {
  for (const device of [
    {name: 'desktop', viewport: {width: 1440, height: 1000}},
    {name: 'mobile', viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}
  ]) {
    const context = await browser.newContext({viewport: device.viewport, isMobile: !!device.isMobile, hasTouch: !!device.hasTouch, serviceWorkers: 'block'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Native notes are entirely local. No external source-content response is
    // required to test their complete reviewed English quotation.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(origin).origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});
    });
    let markersChecked = 0, paragraphsChecked = 0, expanded = 0;
    for (const sectionNumber of sections) {
      const ref = 'Divrei Soferim ' + sectionNumber;
      const expected = chapterData.get(sectionNumber).flatMap(row => row.footnotes || []);
      await page.goto(origin + '#/read/' + encodeURIComponent(ref).replace(/%20/g, '_'), {waitUntil: 'domcontentloaded'});
      const section = page.locator('#text > .sec[data-ref="' + ref + '"]');
      await section.locator('.seg-il .ph-he button.source-note-trigger').first().waitFor({state: 'visible', timeout: 30000});
      const markers = await section.evaluate(element => {
        const found = [];
        for (const he of element.querySelectorAll('.seg-il .ph-he')) {
          const walker = document.createTreeWalker(he, NodeFilter.SHOW_TEXT);
          let node, prefix = '';
          while ((node = walker.nextNode())) {
            const marker = node.parentElement?.closest('.source-note-trigger');
            if (marker) found.push({id: marker.dataset.noteKey, prefix, number: marker.textContent, nested: !!marker.closest('a')});
            else prefix += node.textContent;
          }
        }
        return found;
      });
      assert.equal(markers.length, expected.length, device.name + ': wrong marker count in ' + ref);
      assert.equal(await section.locator('.seg-il .ph-en .source-note-trigger').count(), 0, 'Source markers must remain Hebrew-only');
      for (const note of expected) {
        const matches = markers.filter(marker => marker.id === note.placementId);
        assert.equal(matches.length, 1, 'Missing/duplicate visible marker ' + note.sourceId);
        assert.equal(matches[0].prefix, note.heAnchorPrefix, 'Visible marker prefix differs: ' + note.sourceId);
        assert.equal(Number(matches[0].number), note.number);
        assert.equal(matches[0].nested, false, 'Marker must not be nested inside a source link');
      }
      markersChecked += markers.length;
      const cards = await section.evaluate(element => [...element.querySelectorAll('.seg-il .reader-footnote[data-source-note]')].map(node => ({
        id: node.dataset.noteKey,
        paragraphs: [...node.querySelectorAll('.annotation-text')].map(paragraph => paragraph.textContent)
      })));
      assert.equal(cards.length, expected.length, 'Missing or extra note bodies');
      for (const note of expected) {
        assert.deepEqual(cards.find(card => card.id === note.placementId)?.paragraphs, note.paragraphs.map(paragraph => paragraph.text), 'DOM shortened or changed a quotation');
        paragraphsChecked += note.paragraphs.length;
      }
      // Includes the first fully restored dialogue, both cross-section moves,
      // the user's document source203, and the added Zohar source718.
      for (const number of [1, 98, 105, 203, 718]) {
        const note = expected.find(item => item.number === number);
        if (!note) continue;
        const trigger = section.locator('.seg-il .ph-he button.source-note-trigger[data-note-key="' + note.placementId + '"]');
        const card = section.locator('.seg-il .reader-footnote[data-note-key="' + note.placementId + '"]');
        await trigger.click();
        assert(await card.isVisible(), 'Source note did not expand: ' + number);
        assert.deepEqual(await card.locator('.annotation-text').allTextContents(), note.paragraphs.map(paragraph => paragraph.text));
        for (let i = 0; i < note.sources.length; i++) {
          const source = note.sources[i];
          const link = card.locator('.annotation-text').nth(i).locator('a').filter({hasText: source.ref});
          assert.equal(await link.count(), 1, 'Missing precise linked citation');
          assert.equal(await link.getAttribute('href'), source.url);
          const weight = await link.evaluate(element => {
            const content = element.querySelector('strong,b') || element;
            return getComputedStyle(content).fontWeight;
          });
          assert(['bold', 'bolder'].includes(weight) || Number(weight) >= 600, 'Source citation is not visibly bold');
        }
        const popups = await page.evaluate(note => note.sources.map(source => window.AkivaSourceConnections.sourceQuotationFromNote(note, {ref: source.ref})), note);
        assert(popups.every(Boolean), 'Browser engine cannot extract an exact English source quotation');
        for (let i = 0; i < popups.length; i++) {
          assert.equal(popups[i].en, note.reviewedSourceExcerpts[i].en);
          assert.equal(popups[i].coverage, 'excerpt');
          assert(!popups[i].he);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Reader overflows the viewport');
        if (options['--screenshots'] && number === 718) {
          const directory = path.resolve(options['--screenshots']); fs.mkdirSync(directory, {recursive: true});
          await page.screenshot({path: path.join(directory, `divrei-source-audit-${device.name}.png`), fullPage: false});
        }
        await trigger.click();
        assert(!(await card.isVisible()), 'Source note did not close: ' + number);
        expanded++;
      }
    }
    assert.equal(expanded, 5, 'All selected source controls must be exercised');
    assert.deepEqual(errors, [], 'Browser JavaScript errors');
    checks.push({device: device.name, sections: sections.length, exactVisibleMarkers: markersChecked, exactRenderedParagraphs: paragraphsChecked, sourceNotesOpenedAndClosed: expanded});
    await context.close();
  }
  console.log(JSON.stringify({ok: true, release: RELEASE, publiclyVerified: !!options['--url'], checks}, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(done => server.close(done));
}

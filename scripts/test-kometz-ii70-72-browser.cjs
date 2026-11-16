// Check the scoped reviewed edition in a complete, locally served Pages artifact.
// Usage: KOMETZ_PLAYWRIGHT=/path/to/playwright node scripts/test-kometz-ii70-72-browser.cjs SITE
// Optional: KOMETZ_CHROMIUM=/path/to/chromium
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const repo = path.resolve(__dirname, '..');
const root = path.resolve(process.argv[2] || path.join(repo, 'dist'));
const output = path.join(repo, 'artifacts/kometz-ii70-72');
const editionFile = path.join(repo, 'sources/akiva/kometz-ii70-72/edition.json');
const tidy = value => String(value).replace(/\s+/gu, ' ').trim();
const attr = value => JSON.stringify(String(value));
const result = {
  ok: false,
  site: root,
  edition: path.relative(repo, editionFile),
  startedAt: new Date().toISOString(),
  viewports: [],
  errors: [],
  localHttpErrors: [],
};
fs.mkdirSync(output, {recursive: true});
let browser, server, activePage;

function serveSite() {
  const mime = {
    '.html': 'text/html;charset=utf-8', '.js': 'application/javascript;charset=utf-8',
    '.mjs': 'application/javascript;charset=utf-8', '.json': 'application/json;charset=utf-8',
    '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.pdf': 'application/pdf', '.zip': 'application/zip',
  };
  return http.createServer((req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end(); return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': fs.statSync(file).size,
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
}

async function checkSection(page, base, width, section) {
  const rows = section.items.filter(item => Array.isArray(item.p));
  const native = rows.flatMap(row => (row.footnotes || []).map(note => ({row, note})));
  const keys = native.map(({note}) => note.placementId);
  assert.equal(new Set(keys).size, keys.length, section.ref + ': unique edition placement IDs');
  assert(keys.every(Boolean), section.ref + ': all notes need placement IDs');
  const route = encodeURIComponent(section.ref).replace(/%20/g, '_');
  await page.goto(base + '/library/#/read/' + route, {waitUntil: 'domcontentloaded'});
  const element = page.locator('#text > .sec[data-ref=' + attr(section.ref) + ']');
  await element.locator('.seg-il .source-note-trigger[data-note-key=' + attr(keys[0]) + ']').waitFor({state: 'visible', timeout: 60000});
  assert.equal(await page.locator('#text').getAttribute('data-lang'), 'bi', section.ref + ': bilingual mode');
  assert.equal(await page.locator('#text').getAttribute('data-layout'), 'inter', section.ref + ': active interlinear layout');

  const visibleKeys = await element.locator('.seg-il .ph-he .source-note-trigger:visible').evaluateAll(
    nodes => nodes.filter(node => !node.classList.contains('connection-idea-marker')).map(node => node.dataset.noteKey));
  assert.deepEqual([...visibleKeys].sort(), [...keys].sort(), section.ref + ': every reviewed Hebrew marker appears exactly once');
  assert.equal(await element.locator('.seg-il .ph-en .source-note-trigger:visible').count(), 0,
    section.ref + ': no duplicate English-side source markers');

  const rowResults = [];
  for (const row of rows) {
    const segment = element.locator('.seg[data-i=' + attr(row.n) + ']');
    assert.equal(await segment.count(), 1, section.ref + ': canonical paragraph ' + row.n);
    const snapshot = await segment.evaluate((node, expectedPairs) => {
      const author = element => {
        const copy = element.cloneNode(true);
        copy.querySelectorAll('.footnote,.reader-footnote,.footnote-marker,.subhead').forEach(child => child.remove());
        return copy.textContent;
      };
      const plain = value => {
        const template = document.createElement('template'); template.innerHTML = value;
        return template.content.textContent;
      };
      return {
        pairs: [...node.querySelectorAll('.seg-il .ph')].map(phrase => [
          author(phrase.querySelector('.ph-he')), author(phrase.querySelector('.ph-en')),
        ]),
        expectedPairs: expectedPairs.map(pair => pair.map(plain)),
        paragraphStarts: [...node.querySelectorAll('.seg-il > .source-paragraph')].map(p => Number(p.dataset.phraseStart)),
        paragraphSizes: [...node.querySelectorAll('.seg-il > .source-paragraph')].map(p => p.querySelectorAll('.ph').length),
        visibleParagraphs: [...node.querySelectorAll('.seg-il > .source-paragraph')].every(p => p.getClientRects().length > 0),
      };
    }, row.p);
    assert.deepEqual(snapshot.pairs.map(p => p.map(tidy)), snapshot.expectedPairs.map(p => p.map(tidy)),
      section.ref + ': every corrected Hebrew and English phrase in paragraph ' + row.n);
    const starts = [...new Set((row.paragraphBreaks || []).filter(i => Number.isInteger(i) && i > 0 && i < row.p.length))].sort((a, b) => a - b);
    const expectedStarts = starts.length ? [0, ...starts] : [];
    assert.deepEqual(snapshot.paragraphStarts, expectedStarts,
      section.ref + ': manuscript paragraph breaks in active interlinear layout');
    if (expectedStarts.length) {
      assert.deepEqual(snapshot.paragraphSizes, expectedStarts.map((start, i) => (expectedStarts[i + 1] ?? row.p.length) - start));
      assert(snapshot.visibleParagraphs, section.ref + ': paragraph groups must be visible');
    }
    rowResults.push({paragraph: row.n, phrases: row.p.length, paragraphStarts: expectedStarts});
  }

  // Open every note through its visible Hebrew button, then compare the full
  // rendered paragraphs and hyperlinks, not a substring or a popup summary.
  const noteResults = [];
  for (const {row, note} of native) {
    const segment = element.locator('.seg[data-i=' + attr(row.n) + ']');
    const selector = '[data-note-key=' + attr(note.placementId) + ']';
    const marker = segment.locator('.seg-il .ph-he .source-note-trigger' + selector);
    const box = segment.locator('.seg-il .reader-footnote' + selector);
    assert.equal(await marker.count(), 1, note.placementId + ': one Hebrew button');
    assert.equal(await box.count(), 1, note.placementId + ': one interlinear note card');
    const attachment = await marker.evaluate((mark, expected) => {
      const phrase = mark.closest('.ph');
      const range = document.createRange();
      range.selectNodeContents(mark.closest('.ph-he')); range.setEndBefore(mark);
      const prefix = range.cloneContents();
      prefix.querySelectorAll('.footnote-marker,.footnote,.reader-footnote,.subhead').forEach(child => child.remove());
      const template = document.createElement('template'); template.innerHTML = expected.he;
      const he = template.content.textContent;
      return {
        phraseIndex: [...mark.closest('.seg').querySelectorAll('.seg-il .ph')].indexOf(phrase),
        prefix: prefix.textContent,
        expectedPrefix: expected.prefix ?? he.slice(0, expected.offset ?? he.length),
      };
    }, {he: row.p[note.phraseIndex][0], prefix: note.heAnchorPrefix, offset: note.heCharOffset});
    assert.equal(attachment.phraseIndex, note.phraseIndex, note.placementId + ': exact phrase attachment');
    assert.equal(tidy(attachment.prefix), tidy(attachment.expectedPrefix), note.placementId + ': exact Hebrew anchor prefix');

    await marker.click();
    await box.waitFor({state: 'visible'});
    assert.equal(await marker.getAttribute('aria-expanded'), 'true', note.placementId + ': opens on click');
    assert.equal(await page.locator('.reader-footnote.open').count(), 1, note.placementId + ': one open note at a time');
    assert.deepEqual(await box.locator('.annotation-text').allTextContents(), note.paragraphs.map(p => p.text),
      note.placementId + ': full exact note text');
    const expectedLinks = note.paragraphs.flatMap(p => [
      ...(p.rich || []).filter(run => run.href).map(run => run.href),
      ...[...new Set((p.links || []).map(link => link.url))],
    ]);
    assert(expectedLinks.length > 0, note.placementId + ': edition supplies a primary-source hyperlink');
    const links = await box.locator('.annotation-text a, .annotation-links a').evaluateAll(
      nodes => nodes.map(node => node.getAttribute('href')));
    assert.deepEqual(links, expectedLinks, note.placementId + ': exact source hyperlinks');
    assert(await box.evaluate(node => node.scrollWidth <= node.clientWidth + 2), note.placementId + ': note content is not clipped');
    if (note === native[0].note) {
      await box.scrollIntoViewIfNeeded();
      await page.screenshot({path: path.join(output, width + '-section-' + section.id + '-note.png'), fullPage: false});
    }
    await marker.click();
    assert.equal(await marker.getAttribute('aria-expanded'), 'false', note.placementId + ': closes on second click');
    assert.equal(await box.isVisible(), false, note.placementId + ': closed card is hidden');
    noteResults.push({placementId: note.placementId, phraseIndex: note.phraseIndex, paragraphs: note.paragraphs.length, links: links.length});
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), section.ref + ': no horizontal overflow');
  await element.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: path.join(output, width + '-section-' + section.id + '-reader.png'), fullPage: false});
  return {ref: section.ref, id: section.id, rows: rowResults, visibleHebrewMarkers: visibleKeys.length, allNotesOpenedAndClosed: true, notes: noteResults};
}

(async () => {
  try {
    const edition = JSON.parse(fs.readFileSync(editionFile, 'utf8'));
    assert.deepEqual(edition.sections.map(section => section.ref), [70, 71, 72].map(n => 'Kometz HaMinchah 2:' + n));
    const rows = edition.sections.flatMap(section => section.items.filter(item => Array.isArray(item.p)));
    assert.equal(rows.reduce((n, row) => n + row.p.length, 0), 249, 'Reviewed edition phrase total');
    assert.equal(rows.reduce((n, row) => n + (row.footnotes || []).length, 0), 70, 'Reviewed edition note total');
    const {chromium} = require(process.env.KOMETZ_PLAYWRIGHT || 'playwright');
    server = serveSite();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({headless: true, ...(process.env.KOMETZ_CHROMIUM ? {executablePath: process.env.KOMETZ_CHROMIUM} : {})});
    for (const width of [1280, 390]) {
      const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 950}, hasTouch: width === 390, serviceWorkers: 'block'});
      await context.addInitScript(() => {
        localStorage.setItem('rtl.lang', JSON.stringify('bi'));
        localStorage.setItem('rtl.layout', JSON.stringify('inter'));
      });
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = activePage = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => result.errors.push({width, message: error.message}));
      page.on('response', response => {
        if (response.status() >= 400 && response.url().startsWith(base)) result.localHttpErrors.push({width, status: response.status(), url: response.url().replace(base, '')});
      });
      const entry = {width, sections: []};
      result.viewports.push(entry);
      for (const section of edition.sections) entry.sections.push(await checkSection(page, base, width, section));
      assert.deepEqual(result.errors, [], 'No JavaScript errors');
      fs.writeFileSync(path.join(output, width + '-verification.json'), JSON.stringify(entry, null, 2) + '\n');
      await context.close(); activePage = null;
    }
    result.ok = true;
    console.log('PASS: all three Kometz II 70–72 sections, 249 phrase pairs, 70 exact Hebrew-anchored footnotes and their source hyperlinks on desktop and mobile');
  } catch (error) {
    result.failure = {message: error.message, stack: error.stack};
    if (activePage && !activePage.isClosed()) {
      try { await activePage.screenshot({path: path.join(output, 'failure.png'), fullPage: false}); } catch {}
    }
    console.error(error); process.exitCode = 1;
  } finally {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'browser-verification.json'), JSON.stringify(result, null, 2) + '\n');
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();

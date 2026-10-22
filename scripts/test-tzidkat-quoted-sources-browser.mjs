// Exercise the actual quotation markers and full note boxes at both screen sizes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {RELEASE, readPack} from './publish-tzidkat-quoted-sources.mjs';
let playwright;
try {playwright=await import('playwright');}
catch {assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'Playwright runtime unavailable');playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const {chromium}=playwright;

const args = process.argv.slice(2), option = name => {const at = args.indexOf(name); return at < 0 ? null : args[at + 1];};
const root = path.resolve(option('--root') || 'dist/library'), live = option('--url');
const artifacts = path.resolve('artifacts/tzidkat-quoted-sources'); fs.mkdirSync(artifacts, {recursive:true});
const pack = readPack(), selectedSection = option('--section');
const sections = [...new Set(pack.operations.map(operation => operation.sectionRef))]
  .filter(ref => !selectedSection || ref === selectedSection);
assert(sections.length, 'No reviewed quotations in the requested section');
const reportSuffix = selectedSection ? '-section-' + selectedSection.match(/\d+$/)[0] : '';
const hash = ref => encodeURIComponent(ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':');
let base = live?.replace(/\/?$/, '/'), server;
if (!base) {
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filename = path.resolve(root, '.' + pathname.replace(/^\/library/, ''));
    if (filename !== root && !filename.startsWith(root + path.sep)) {response.writeHead(403).end(); return;}
    try {
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
      response.setHeader('Content-Type', {'.html':'text/html;charset=utf-8', '.json':'application/json;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.css':'text/css;charset=utf-8'}[path.extname(filename)] || 'application/octet-stream');
      response.end(fs.readFileSync(filename));
    } catch {response.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/library/';
}
const report = {release:RELEASE, publiclyVerified:!!live, ok:false, sections:[], screenshots:[], errors:[]};
const browser = await chromium.launch({headless:true, ...(process.env.AKIVA_CHROMIUM_EXECUTABLE ? {executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE} : {})});
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({viewport:{width, height:width === 390 ? 844 : 960}, serviceWorkers:'block'});
    await context.addInitScript(() => {
      localStorage.setItem('rtl.lang', JSON.stringify('bi')); localStorage.setItem('rtl.layout', JSON.stringify('inter'));
      window.IntersectionObserver = class {observe() {} unobserve() {} disconnect() {}};
    });
    // Rendering quotations needs only the published app. External text fetches
    // do not supply or replace the note content being verified.
    await context.route(url => url.origin !== new URL(base).origin, route => route.fulfill({status:200, contentType:'application/json', body:'[]'}));
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({width, message:error.message}));
    for (const ref of sections) {
      const operations = pack.operations.filter(operation => operation.sectionRef === ref);
      const notes = operations.filter(operation => operation.after);
      await page.goto(base + '#/read/' + hash(ref), {waitUntil:'domcontentloaded'});
      const section = page.locator('.sec[data-ref="' + ref + '"]');
      await page.waitForFunction(ref => [...document.querySelectorAll('.sec')].some(section => section.dataset.ref === ref && section.dataset.connectionFootnotesMounted === 'true'), ref, {timeout:60000});
      if (ref === 'Tzidkat HaTzadik 15') {
        assert.equal(await section.locator('.seg-il .ph [data-ref="Mishnah Peah 3:8"]').count(), 0,
          'The corrected Tosefta quotation still has the unrelated Mishnah inline target');
        assert.equal(await section.locator('.seg-il .ph [data-ref="Tosefta Peah 3:13"]').count(), 3,
          'Every Hebrew and English Tosefta inline link must use the corrected source');
        assert.equal(await section.locator('.seg-il .ph-en [data-ref="Tosefta Peah 3:13"]').textContent(), 'Peah 3:13');
      }
      for (const operation of operations) {
        const selector = '[data-note-key="' + operation.placementId + '"]';
        const marker = section.locator('.seg-il .ph-he button' + selector);
        const box = section.locator('.seg-il .reader-footnote' + selector);
        if (!operation.after) {assert.equal(await marker.count(), 0); assert.equal(await box.count(), 0); continue;}
        const note = operation.after;
        assert.equal(await marker.count(), 1, 'Quotation marker missing or repeated');
        assert.equal(await box.count(), 1, 'Quotation box missing or repeated');
        assert.equal(await section.locator('.seg-il .ph-en button' + selector).count(), 0, 'Duplicate English-side marker');
        const anchor = await marker.evaluate(marker => {
          const segment = marker.closest('.seg'), phrase = marker.closest('.ph');
          const range = document.createRange(); range.selectNodeContents(marker.closest('.ph-he')); range.setEndBefore(marker);
          const preceding = range.cloneContents(); preceding.querySelectorAll('button.footnote-marker').forEach(button => button.remove());
          return {ref:segment.dataset.ref, phraseIndex:[...segment.querySelectorAll('.seg-il .ph')].indexOf(phrase), prefix:preceding.textContent};
        });
        assert.deepEqual(anchor, {ref:operation.originRef, phraseIndex:note.phraseIndex, prefix:note.heAnchorPrefix}, 'Marker is attached to another Hebrew phrase');
        assert.deepEqual(await box.locator('.annotation-text').allTextContents(), note.paragraphs.map(paragraph => paragraph.text));
        assert.equal(await box.locator('.annotation-label').count(), 0, 'Quotation acquired an explanatory label');
        assert.equal(await box.locator('.annotated-title').textContent(), 'Footnote ' + note.number + ' · Quoted source');
        assert.equal(await box.locator('a').count(), operation.quotation.url ? 1 : 0);
        if (operation.quotation.url) assert.equal(await box.locator('a').getAttribute('href'), operation.quotation.url);
        assert.equal(await box.locator('strong').textContent(), operation.quotation.citation || operation.quotation.ref);
        assert.equal(Number(await marker.getAttribute('data-fn')),note.number,'A published footnote number moved');
      }
      const displayed = await section.locator('.seg-il .ph-he button.footnote-marker').evaluateAll(markers=>markers.map(marker=>Number(marker.dataset.fn)));
      assert.equal(new Set(displayed).size,displayed.length,'A native and supplemental number collide');
      for (const pinned of pack.numbering.connectionNotes.filter(note=>note.originRef.startsWith(ref+':'))) {
        // The record's reviewed book-wide number must remain visible regardless of its paragraph.
        assert(displayed.includes(pinned.number),'An existing supplemental marker is missing');
      }
      // Open every selected note, not merely a sample, to detect colliding
      // marker numbers and ensure complete quotes remain readable on phones.
      for (const [index, operation] of notes.entries()) {
        const selector = '[data-note-key="' + operation.placementId + '"]';
        const marker = section.locator('.seg-il .ph-he button' + selector), box = section.locator('.seg-il .reader-footnote' + selector);
        await marker.click(); assert.equal(await marker.getAttribute('aria-expanded'), 'true'); assert(await box.isVisible());
        assert.equal(await section.locator('.seg-il .reader-footnote.open').count(), 1, 'A marker opened more than its own note');
        assert.deepEqual(await box.locator('.annotation-text').allTextContents(), operation.after.paragraphs.map(paragraph => paragraph.text));
        assert(await box.evaluate(element => element.scrollWidth <= element.clientWidth + 2), 'Quotation is clipped');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'Horizontal overflow');
        if (index === 0) {
          const file = `${live ? 'live' : 'local'}-${operation.path.split('/').at(-1).replace('.json', '')}-${width}.png`;
          await box.evaluate(element => {
            const bottom = Math.max(...['.top', '.rbar'].map(selector => document.querySelector(selector)?.getBoundingClientRect().bottom || 0));
            window.scrollBy({top:element.getBoundingClientRect().top - bottom - 14, behavior:'instant'});
          });
          await page.screenshot({path:path.join(artifacts, file)}); report.screenshots.push(file);
        }
        await marker.click(); assert.equal(await marker.getAttribute('aria-expanded'), 'false');
      }
      report.sections.push({ref, width, completeQuotations:notes.length, preciseHebrewMarkers:notes.length, everyNoteOpened:true, removed:operations.length - notes.length});
      console.log('PASS quotation reader ' + ref + ' at ' + width + 'px');
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []); assert.equal(report.sections.length, sections.length * 2); report.ok = true;
} catch (error) {report.failure = error.message; throw error;}
finally {
  fs.writeFileSync(path.join(artifacts, (live ? 'live' : 'local') + reportSuffix + '-report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); if (server) await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify(report, null, 2));

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {loadRelease, normalizedSections, REPORT, visible} from './publish-reader-docx-import.mjs';
import {loadPack as loadMeiVolumeII, REPORT as MEI_VOLUME_II_REPORT} from './publish-mei-volume-ii.mjs';
import {loadPack as loadMeiLikutei, REPORT as MEI_LIKUTEI_REPORT, TARGET as MEI_ANTHOLOGY} from './publish-mei-likutei.mjs';

let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href); }
const args = process.argv.slice(2), urlIndex = args.indexOf('--url');
const root = path.resolve('dist');
const server = http.createServer((request, response) => {
  let file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://local').pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    response.setHeader('Content-Type', ({'.html':'text/html;charset=utf-8', '.json':'application/json;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.css':'text/css;charset=utf-8'})[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = urlIndex >= 0 ? args[urlIndex + 1].replace(/\/?$/, '/') : `http://127.0.0.1:${server.address().port}/library/`;
const hash = ref => encodeURIComponent(ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':');
const release = loadRelease(), likuteiSuccessor = args.includes('--after-mei-likutei') ? loadMeiLikutei() : null;
const meiSuccessor = args.includes('--after-mei-volume-ii') || likuteiSuccessor ? loadMeiVolumeII() : null;
const originalSections = release.packs.flatMap(({pack}) => normalizedSections(pack));
const sections = originalSections.filter(section => !(meiSuccessor && section.ref.startsWith('Mei HaShiloach, Volume II, ')) && !(likuteiSuccessor && section.ref.startsWith(MEI_ANTHOLOGY))).concat(meiSuccessor?.sections || [], likuteiSuccessor?.sections || []);
const paratext = release.packs.flatMap(({pack}) => pack.paratext || []);
const report = await (await fetch(base + REPORT)).json();
if (meiSuccessor) {
  const successor = await (await fetch(new URL(MEI_VOLUME_II_REPORT, base.replace(/library\/$/, '')))).json();
  assert.equal(successor.packSha256, meiSuccessor.packSha256);
  report.canonicalOrder = successor.canonicalOrder;
}
if (likuteiSuccessor) {
  const successor = await (await fetch(new URL(MEI_LIKUTEI_REPORT, base.replace(/library\/$/, '')))).json();
  assert.equal(successor.packSha256, likuteiSuccessor.packSha256);
  assert.equal(successor.editorialStage, 'reviewed'); assert.equal(successor.preview, false);
  report.canonicalOrder = successor.canonicalOrder;
}
const browser = await playwright.chromium.launch({headless:true,
  ...(process.env.READER_CHROMIUM_EXECUTABLE ? {executablePath:process.env.READER_CHROMIUM_EXECUTABLE} : {})});
const sampleRefs = [1, 3, 9, 28, 76].map(number => `Beit Yaakov on Torah, Vayetzei ${number}`);
sampleRefs.push('Mei HaShiloach, Volume I, Introduction',
  'Mei HaShiloach, Volume I, Exodus, Beshalach',
  'Mei HaShiloach, Volume I, Numbers, Korach',
  "Mei HaShiloach, Volume I, Deuteronomy, V'Zot HaBerachah",
  'Mei HaShiloach, Volume I, Writings, Psalms 81',
  'Mei HaShiloach, Volume I, Writings, Proverbs 13',
  'Mei HaShiloach, Volume I, Talmud, Shabbat 138b',
  'Mei HaShiloach, Volume I, Talmud, Rosh Hashanah 27a',
  'Mei HaShiloach, Volume I, Talmud, Megillah 18a',
  'Mei HaShiloach, Volume II, Writings, Psalms 78');
fs.mkdirSync('artifacts/reader-docx-import', {recursive:true});
try {
  for (const viewport of [{width:390, height:844}, {width:1280, height:900}]) {
    const context = await browser.newContext({viewport, serviceWorkers:'block'}), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('rtl.lang', JSON.stringify('bi'));
      localStorage.setItem('rtl.layout', JSON.stringify('inter'));
    });
    let shapeRequests = 0;
    // The uploaded interlinear text and contents must load independently of
    // Sefaria availability. Exact live source targets are checked separately.
    await context.route('https://www.sefaria.org/**', route => {
      if (route.request().url().includes('/api/shape/')) shapeRequests++;
      const body = route.request().url().includes('/api/links/') ? [] : {he:[], text:[], versions:[]};
      return route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(body)});
    });
    await page.goto(base + '#/book/Mei_HaShiloach');
    const meiToc = page.locator('#toc .study-entry a[href^="#/read/Mei_HaShiloach,"]');
    await meiToc.last().waitFor();
    assert.equal(await meiToc.count(), report.canonicalOrder.length);
    assert.equal(shapeRequests, 0, 'Interlinear contents depended on remote Sefaria shape');
    await page.goto(base + '#/book/Beit_Yaakov_on_Torah');
    const beitToc = page.locator('#toc a[href^="#/read/Beit_Yaakov_on_Torah,_Vayetzei_"]');
    await beitToc.last().waitFor(); assert.equal(await beitToc.count(), 76);
    assert.equal(await page.locator('#toc a[href^="#/read/Beit_Yaakov_on_Torah,_Toldot_"]').count(), 52);

    for (const ref of sampleRefs) {
      const source = sections.find(section => section.ref === ref); assert.ok(source, 'Missing test source ' + ref);
      const expected = source.items.flatMap(item => item.p).concat(paratext.filter(item => item.afterRef === ref).flatMap(item => item.p));
      await page.goto(base + '#/read/' + hash(ref));
      const section = page.locator('#text > .sec').filter({has:page.locator(`.seg[data-ref="${ref}${source.sep}1"]`)}).first();
      await section.locator('.seg-il .ph-he').first().waitFor();
      assert.equal(await section.locator('.ph-he').count(), expected.length, 'Missing rendered Hebrew in ' + ref);
      assert.equal(await section.locator('.ph-en').count(), expected.length, 'Missing rendered English in ' + ref);
      assert.deepEqual((await section.locator('.ph-he').allTextContents()).map(text => text.trim()), expected.map(pair => visible(pair[0]).trim()));
      assert.deepEqual((await section.locator('.ph-en').allTextContents()).map(text => text.trim()), expected.map(pair => visible(pair[1]).trim()));
      assert.doesNotMatch((await section.locator('.ph-en').allTextContents()).join(''), /[\[\]]/);
      if (ref.startsWith('Mei HaShiloach,') && source.he) assert.ok((await section.locator('.sec-head').textContent()).includes(source.he), 'Hebrew section heading hidden');
      if (ref.startsWith('Beit Yaakov on Torah, Vayetzei ')) {
        assert.equal((await section.locator('.sec-head').textContent()).trim(), `Vayetzei · Ois ${source.chapter}`,
          'Generic ois title repeats in the section header');
        assert.deepEqual(await section.locator('.seg-il .subhead').allTextContents(),
          source.items.flatMap(item => (item.inlineHeadings || []).map(heading => heading.text)),
          'Manuscript continuation heading is missing or duplicated');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'Horizontal overflow in ' + ref);
    }
    // Numeric chapters and daf references require a colon for the paragraph.
    const deepRef = 'Mei HaShiloach, Volume I, Writings, Psalms 81:1';
    await page.goto(base + '#/read/' + hash(deepRef));
    await page.locator(`.seg[data-ref="${deepRef}"] .ph-he`).first().waitFor();
    const current = report.canonicalOrder.indexOf('Mei HaShiloach, Volume I, Writings, Psalms 81');
    await page.locator('#nextBtn').click();
    await page.waitForURL(base + '#/read/' + hash(report.canonicalOrder[current + 1]));
    await page.locator('#text .ph-he').first().waitFor();

    await page.goto(base + '#/read/' + hash('Beit Yaakov on Torah, Vayetzei 1'));
    await page.locator('#text .ph-he').first().waitFor();
    const firstSource = page.locator('#text > .sec').first().locator('.seg-il a.cite[data-ref]').first();
    await firstSource.waitFor();
    const target = await firstSource.getAttribute('data-ref'), href = await firstSource.getAttribute('href');
    // The reader opens inline citations in its source panel; the panel retains
    // the checked external Sefaria link for opening the original passage.
    assert.equal(href, '#/read/' + hash(target));
    await firstSource.click();
    await page.locator('#panel').waitFor({state:'visible'});
    await page.waitForFunction(ref => document.querySelector('#panel .ttl')?.textContent === ref, target);
    const externalSource = page.locator('#panel .link-item .acts a[href^="https://www.sefaria.org/"]').first();
    await externalSource.waitFor();
    assert.match(await externalSource.getAttribute('href'), /^https:\/\/www\.sefaria\.org\//);
    await page.screenshot({path:`artifacts/reader-docx-import/source-${viewport.width}.png`, fullPage:false});
    await page.locator('#pClose').click();
    await page.locator('#nextBtn').click();
    await page.waitForURL(base + '#/read/' + hash('Beit Yaakov on Torah, Vayetzei 2'));
    await page.locator('.seg[data-ref="Beit Yaakov on Torah, Vayetzei 2:1"] .ph-he').first().waitFor();
    await page.screenshot({path:`artifacts/reader-docx-import/reader-${viewport.width}.png`, fullPage:false});
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${viewport.width}px: all contents entries, ${sampleRefs.length} complete rendered sample sections, canonical paragraph links, source popup and next-section navigation`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

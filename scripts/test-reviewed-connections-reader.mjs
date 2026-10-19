#!/usr/bin/env node
// CI integration test for the shipped reader and actual reviewed catalog.
// The final canonical chapter files are served unchanged. Only Sefaria network
// responses are isolated, so click routing does not depend on a live API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

const require = createRequire(import.meta.url);
const engine = require('../dist/library/source-connections.js');
const root = path.resolve('dist');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'library/source-connections/catalog.json')));
const toc = JSON.parse(fs.readFileSync(path.join(root, 'library/data/tzidkat-hatzadik/toc.json')));
const leaf = toc.toc.children.find(item => item.ref === 'Tzidkat HaTzadik 1');
const section = JSON.parse(fs.readFileSync(path.join(root, `library/data/tzidkat-hatzadik/${leaf.id}.json`)));
const paragraph = section.find(item => item.n === 3);
const context = {originRef:'Tzidkat HaTzadik 1:3',
  he:paragraph.p.map(pair=>pair[0]).join(' '), en:paragraph.p.map(pair=>pair[1]).join(' ')};
const expected = engine.pickConnections(catalog.records, 'Exodus 12:11', context);
assert(expected.some(item=>item.school === 'Kisvei Rav Tzadok'), 'This release needs a reviewed Rav Tzadok haste connection');
assert(expected.some(item=>item.school === 'Ishbitz–Radzin'), 'This release needs a reviewed Ishbitz–Radzin haste connection');
const source = expected.find(item=>item.sourceRefs.includes('Exodus 12:11'));
assert(source, 'A precise Exodus 12:11 source excerpt is required');
const hash = ref => encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const text = value => String(value || '').replace(/\s+/g,' ').trim();
const ids = records => records.map(record=>record.id).sort();
const server = http.createServer((request,response)=>{
  let file = path.resolve(root,'.' + decodeURIComponent(new URL(request.url,'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
    response.setHeader('Content-Type', {'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8',
      '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true});
const screenshotDir = path.resolve('artifacts/source-connections');
fs.mkdirSync(screenshotDir,{recursive:true});
let routesChecked = 0;

async function prepare(viewport, failCatalog = false) {
  const session = await browser.newContext({viewport,serviceWorkers:'block'});
  await session.addInitScript(()=>{
    localStorage.setItem('rtl.lang', JSON.stringify('bi'));
    localStorage.setItem('rtl.layout', JSON.stringify('inter'));
    // Infinite reading is separately tested by the historical reader suites.
    window.IntersectionObserver = class {observe(){} unobserve(){} disconnect(){}};
  });
  await session.route('https://**/*', async route=>{
    const url = new URL(route.request().url());
    if (!/^(?:www\.)?sefaria\.org$/.test(url.hostname)) { await route.abort(); return; }
    if (url.pathname.startsWith('/api/links/')) {
      // An unreviewed Sefaria reverse citation must never enter either school.
      await route.fulfill({json:[{anchorRef:'Exodus 12:11',sourceRef:'Tzidkat HaTzadik 99:1',
        category:'Chasidut',index_title:'Unreviewed reverse citation'}]}); return;
    }
    if (!url.pathname.startsWith('/api/')) { await route.fulfill({body:'Source link destination'}); return; }
    const ref = decodeURIComponent(url.pathname.split('/texts/')[1] || '');
    let he = 'טקסט לבדיקת הממשק בלבד', en = 'Isolated source response for the interface test.',
      sectionRef = ref, sections = [1], book = ref.replace(/\s+\d.*$/,'');
    if (ref === 'Exodus 12:11') {
      he = source.sourceHebrew; en = source.sourceEnglish; sectionRef = 'Exodus 12'; sections = [12,11]; book = 'Exodus';
    } else if (ref === 'Exodus 12') {
      he = Array(11).fill(''); en = Array(11).fill('');
      he[10] = source.sourceHebrew; en[10] = source.sourceEnglish; sections = [12]; book = 'Exodus';
    } else if (ref === 'Ezekiel 18:20') {
      // A Hebrew-only source plus an English excerpt in a published footnote
      // must remain separate; the excerpt cannot translate this whole fixture.
      he = ['טקסט ראשון לבדיקת הממשק','טקסט שני לבדיקת הממשק']; en = [];
    }
    await route.fulfill({json:{ref,sectionRef,sections,book,heRef:ref,next:null,prev:null,
      versions:[{language:'he',versionTitle:'Isolated Hebrew fixture',text:he},
        {language:'en',versionTitle:'Isolated English fixture',text:en}]}});
  });
  if (failCatalog) await session.route('**/source-connections/catalog.json?*',route=>route.fulfill({status:503,body:'Unavailable fixture'}));
  return session;
}

async function checkedCards(page, records) {
  const cards = page.locator('#lItems .reviewed-connection');
  if (records.length) await cards.last().locator('.qe').waitFor({state:'visible'});
  assert.deepEqual((await cards.evaluateAll(nodes=>nodes.map(node=>node.dataset.connectionId))).sort(), ids(records), 'Wrong reviewed connections');
  for (const record of records) {
    const card = page.locator(`[data-connection-id="${record.id}"]`);
    assert.equal(text(await card.locator('.quote .qe').textContent()), text(record.targetEnglish), 'Missing or replaced English: ' + record.id);
    assert.equal(text(await card.locator('.quote .qh').textContent()), text(record.targetHebrew), 'Changed Hebrew: ' + record.id);
    assert.equal(text(await card.locator('.connection-explanation').textContent()), 'How this explains the source' + record.explanation, 'Explanation must be separate from the quotation');
    assert(await card.evaluate(node=>node.classList.contains('full')), 'Reviewed quotations must be expanded');
    assert(await card.locator('.quote').evaluate(node=>node.scrollHeight <= node.clientHeight + 2), 'Reviewed quotation clipped');
    assert.equal(await card.locator('.source-missing').count(),0,'Reviewed quote must have both languages');
  }
  routesChecked++;
}

try {
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    const session = await prepare(viewport), page = await session.newPage(), errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin + '/library/#/read/' + hash('Tzidkat HaTzadik 1'));
    const seg = page.locator('.seg[data-ref="Tzidkat HaTzadik 1:3"]');
    await seg.locator('.seg-il .ph-he').getByRole('link',{name:'בְּחִפָּזוֹן',exact:true}).click();
    await checkedCards(page,expected);
    assert.equal(text(await page.locator('#panel .ttl').textContent()),'Exodus 12:11');
    const directIds = await page.locator('.reviewed-connection').evaluateAll(nodes=>nodes.map(node=>node.dataset.connectionId).sort());
    for (const school of engine.SCHOOLS) assert(await page.getByRole('button',{name:school + ' sources',exact:true}).isVisible());
    await page.getByRole('button',{name:'English only',exact:true}).click();
    await page.getByRole('button',{name:'Ishbitz–Radzin sources',exact:true}).click();
    await checkedCards(page,expected.filter(record=>record.school === 'Ishbitz–Radzin'));
    await page.screenshot({path:path.join(screenshotDir,viewport.width > 600 ? 'desktop-source-connection.jpg' : 'mobile-source-connection.jpg'),type:'jpeg',quality:90});
    const ishbitz = expected.find(record=>record.school === 'Ishbitz–Radzin');
    await page.locator(`[data-connection-id="${ishbitz.id}"] .explore-source`).click();
    await page.locator('.source-head .qe').waitFor({state:'visible'});
    assert.equal(text(await page.locator('.source-head .qe').textContent()),text(ishbitz.targetEnglish));
    assert.equal(text(await page.locator('.quote-label').textContent()),'Reviewed excerpt from this passage');
    await page.locator('#pClose').click();
    await seg.locator('.seg-il .ph-he').getByRole('link',{name:'בְּחִפָּזוֹן',exact:true}).click();
    await checkedCards(page,expected);
    await page.getByRole('button',{name:'Hebrew and English',exact:true}).click();
    await page.getByRole('button',{name:'All sources',exact:true}).click();
    await checkedCards(page,expected);
    await page.locator('#pClose').click();

    // A linked footnote opens exactly the same source and reviewed connections.
    await seg.locator('.seg-il button[data-note-key="TZ-0003-1"]').click();
    await seg.locator('.seg-il .reader-footnote[data-note-key="TZ-0003-1"] a').first().click();
    await checkedCards(page,expected);
    assert.deepEqual(await page.locator('.reviewed-connection').evaluateAll(nodes=>nodes.map(node=>node.dataset.connectionId).sort()),directIds);
    assert(page.url().endsWith(hash('Tzidkat HaTzadik 1')), 'Footnote source replaced the reading route');
    await page.locator('#pClose').click();

    // A source selected through the paragraph's Connections sidebar does too.
    await seg.locator('.seg-il .ph-en').last().click();
    await page.locator('#pContent .cat[data-cat="Tanakh"]').click();
    await checkedCards(page,expected);
    assert.equal(await page.locator('[data-cat="Parallel Sources"],[data-cat="Parallels by source"]').count(),0);
    await page.locator('#pClose').click();

    // The continuous view must localize the same citation, without using note text.
    await page.locator('#setBtn').click();
    await page.locator('[data-pref="layout"] button[data-v="stack"]').click();
    await page.locator('#setBtn').click();
    await seg.locator('.seg-he').getByRole('link',{name:'בְּחִפָּזוֹן',exact:true}).click();
    await checkedCards(page,expected);
    await page.locator('#pClose').click();

    // The title's Ezekiel citation is unrelated to the haste discussion. Its
    // original English note is an excerpt, never an aligned full translation.
    const title = page.locator('.seg[data-ref="Tzidkat HaTzadik 1:2"]');
    await title.locator('.seg-he button[data-note-key="TZ-0001-1"]').click();
    await title.locator('.segment-annotations .reader-footnote[data-note-key="TZ-0001-1"] a').first().click();
    await page.locator('.footnote-source-excerpt').waitFor({state:'visible'});
    assert.equal(await page.locator('.reviewed-connection').count(),0);
    assert.equal(await page.locator('.source-head .quote .qe').count(),0,'A partial footnote translation was paired with the full Hebrew');
    assert.match(await page.locator('.connection-status').textContent(),/No reviewed connection/);
    const noteEnglish = text(await page.locator('.footnote-source-excerpt .qe').textContent());
    await page.locator('#pClose').click();

    // The same nearby verified footnote excerpt is also available when the
    // reader opens that source from its inline citation or sidebar book button.
    await title.locator('.seg-he').getByRole('link',{name:'צִדְקַת הַצַּדִּיק',exact:true}).click();
    await page.locator('.footnote-source-excerpt').waitFor({state:'visible'});
    assert.equal(text(await page.locator('.footnote-source-excerpt .qe').textContent()),noteEnglish);
    assert.equal(await page.locator('.source-head .quote .qe').count(),0);
    await page.locator('#pClose').click();
    await title.locator('.seg-en').click();
    await page.locator('#pContent button[data-cat="Tanakh"][data-book="Ezekiel"]').click();
    await page.locator('.footnote-source-excerpt').waitFor({state:'visible'});
    assert.equal(text(await page.locator('.footnote-source-excerpt .qe').textContent()),noteEnglish);
    assert.equal(await page.locator('.reviewed-connection').count(),0);
    await page.locator('#pClose').click();

    // Exact direct source lookup works when the source is already in R.sections.
    await page.goto(origin + '/library/#/read/' + hash('Exodus 12:11'));
    const direct = engine.pickConnections(catalog.records,'Exodus 12:11');
    for (const school of engine.SCHOOLS) {
      await page.locator(`#pContent .cat[data-cat="${school}"]`).click();
      await checkedCards(page,direct.filter(record=>record.school === school));
      await page.locator('#pBack').click();
    }
    assert.equal(await page.locator('#pContent .cat[data-cat="Chasidut"]').count(),0,'Unreviewed reverse citation leaked');
    assert.deepEqual(errors,[],'Reader JavaScript errors');
    await session.close();
  }
  const unavailable = await prepare({width:1280,height:900},true), page = await unavailable.newPage();
  await page.goto(origin + '/library/#/read/' + hash('Tzidkat HaTzadik 1'));
  await page.locator('.seg[data-ref="Tzidkat HaTzadik 1:3"] .seg-il .ph-he').getByRole('link',{name:'בְּחִפָּזוֹן',exact:true}).click();
  await page.locator('.connection-status').waitFor({state:'visible'});
  assert.match(await page.locator('.connection-status').first().textContent(),/could not be loaded/,'Failure must not masquerade as no matching source');
  assert.equal(await page.locator('.reviewed-connection').count(),0);
  await unavailable.close();
  console.log(JSON.stringify({ok:true,viewports:2,reviewedViews:routesChecked,matchedSource:'Exodus 12:11',
    entryPoints:['inline citation','footnote source','sidebar source','direct source lookup'],
    fullTranslations:true,unrelatedConnectionsSuppressed:true,partialFootnoteTranslationKeptSeparate:true,
    footnoteEnglishAvailableAcrossEntryPoints:true,reviewedEnglishRetainedWhenOpeningItsPassage:true,catalogFailureReported:true}));
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

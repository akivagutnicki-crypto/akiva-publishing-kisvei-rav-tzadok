import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
}
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  assert(['--root', '--url', '--screenshots'].includes(name) && process.argv[i + 1], 'Unexpected option: ' + name);
  options[name] = process.argv[i + 1];
}
const ROOT = path.resolve(options['--root'] || 'dist');
const CANONICAL = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const OPEN = CANONICAL + 'library/open/';
const REF = '#/read/Divrei_Soferim_16';
let server;
let origin = options['--url'];
if (!origin) {
  server = http.createServer((request, response) => {
    let filename;
    try { filename = path.resolve(ROOT, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)); }
    catch { response.writeHead(400).end(); return; }
    if (filename !== ROOT && !filename.startsWith(ROOT + path.sep)) { response.writeHead(403).end(); return; }
    try {
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
      const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg'};
      response.setHeader('content-type', types[path.extname(filename)] || 'application/octet-stream');
      fs.createReadStream(filename).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port + '/';
}
origin = origin.replace(/\/?$/, '/');
const {chromium} = playwright;
const browser = await chromium.launch({headless: true, executablePath: process.env.AKIVA_TEST_CHROMIUM || undefined});
const checks = [];
const screenshots = options['--screenshots'];
if (screenshots) fs.mkdirSync(screenshots, {recursive: true});

async function contextFor(viewport, extra = {}) {
  const context = await browser.newContext({viewport, serviceWorkers: 'block', ...extra});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(origin).origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});
  });
  return context;
}

async function assertHeader(page, location) {
  const button = page.locator('#akivaShareButton');
  await button.waitFor({state: 'visible'});
  const state = await button.evaluate(element => {
    const box = element.getBoundingClientRect();
    const siblings = [...element.parentElement.children].filter(node => node !== element && getComputedStyle(node).display !== 'none' && !node.hidden);
    const headerItems = [...(document.querySelector('header.top')?.children || [])].filter(node => !node.hidden && getComputedStyle(node).display !== 'none');
    const headerOverlaps = [];
    for (let i=0;i<headerItems.length;i++) for(let j=i+1;j<headerItems.length;j++) {
      const a=headerItems[i].getBoundingClientRect(), b=headerItems[j].getBoundingClientRect();
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) headerOverlaps.push(headerItems[i].className+' / '+headerItems[j].className);
    }
    return {
      x: box.x, y: box.y, width: box.width, height: box.height, right: box.right,
      viewport: innerWidth,
      headerOverlaps,
      heroClearance: document.querySelector('header#top') && document.querySelector('.hero .eyebrow') ? document.querySelector('.hero .eyebrow').getBoundingClientRect().top - document.querySelector('header#top').getBoundingClientRect().bottom : null,
      overlaps: siblings.filter(node => {
        const r = node.getBoundingClientRect();
        return Math.min(box.right, r.right) - Math.max(box.left, r.left) > 1 && Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top) > 1;
      }).map(node => node.tagName + '.' + node.className),
      overflow: document.documentElement.scrollWidth - innerWidth
    };
  });
  assert(state.width >= 43 && state.height >= 43, location + ': share target too small ' + JSON.stringify(state));
  assert(state.x >= 0 && state.right <= state.viewport + 1, location + ': Share is outside viewport');
  assert.deepEqual(state.overlaps, [], location + ': Share overlaps another header element');
  assert.deepEqual(state.headerOverlaps, [], location + ': reader header items overlap');
  if (state.heroClearance !== null) assert(state.heroClearance >= 23, location + ': website header overlaps hero content; gap=' + state.heroClearance);
  assert(state.overflow <= 2, location + ': document overflow ' + state.overflow);
}

try {
  for (const [name, viewport] of [
    ['phone-small', {width: 320, height: 640}],
    ['phone-portrait', {width: 390, height: 844}],
    ['phone-landscape', {width: 844, height: 390}],
    ['tablet-portrait', {width: 768, height: 1024}],
    ['tablet-landscape', {width: 1024, height: 768}],
    ['desktop', {width: 1440, height: 1000}]
  ]) {
    const context = await contextFor(viewport, {hasTouch: name !== 'desktop'});
    await context.addInitScript(() => {
      window.__sharePayloads = [];
      Object.defineProperty(navigator, 'share', {configurable: true, value: data => { window.__sharePayloads.push(data); return Promise.resolve(); }});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + 'library/?private-check=must-not-share' + REF, {waitUntil: 'domcontentloaded'});
    await assertHeader(page, name + ' reader');
    await page.locator('#akivaShareButton').click();
    let payload = await page.evaluate(() => window.__sharePayloads.at(-1));
    assert.equal(payload.url, OPEN + REF, name + ': incorrect reading link');
    assert.match(payload.title, /Divrei Soferim 16/);
    assert(!payload.url.includes('private-check'));
    await page.evaluate(() => { location.hash = '#/book/Divrei_Soferim'; });
    await page.locator('#akivaShareButton').click();
    payload = await page.evaluate(() => window.__sharePayloads.at(-1));
    assert.equal(payload.url, OPEN + '#/book/Divrei_Soferim', 'Share must use the current route after navigation');
    if (name === 'phone-portrait') {
      await page.setViewportSize({width: 844, height: 390});
      await assertHeader(page, 'rotated landscape');
      await page.setViewportSize(viewport);
      await assertHeader(page, 'rotated portrait');
    }
    if (name === 'desktop') {
      await page.evaluate(() => document.getElementById('installBtn').hidden = false);
      await assertHeader(page, 'desktop with Install app visible');
      if (screenshots) await page.screenshot({path: path.join(screenshots, 'desktop-install-visible.png')});
      await page.evaluate(() => document.getElementById('installBtn').hidden = true);
    }
    if (screenshots && ['phone-portrait', 'phone-landscape', 'desktop'].includes(name)) await page.screenshot({path: path.join(screenshots, name + '-reader.png')});
    await page.goto(origin, {waitUntil: 'domcontentloaded'});
    await assertHeader(page, name + ' website');
    await page.locator('#akivaShareButton').click();
    payload = await page.evaluate(() => window.__sharePayloads.at(-1));
    assert.equal(payload.url, OPEN);
    if (viewport.width <= 850) assert(await page.locator('header#top nav a').last().isVisible(), 'Existing website Support link became hidden');
    if (screenshots && name === 'phone-portrait') await page.screenshot({path: path.join(screenshots, name + '-website.png')});
    assert.deepEqual(errors, [], name + ': browser errors');
    checks.push({name, reader: true, website: true, nativePayload: true});
    await context.close();
  }

  // Exercise cancellation, denied native sharing, clipboard access, and keyboard recovery.
  const context = await contextFor({width: 390, height: 844});
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {configurable: true, value: () => Promise.reject(new DOMException('Cancelled', 'AbortError'))});
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: text => {window.__copiedShare = text; return Promise.resolve();}}});
  });
  const page = await context.newPage();
  await page.goto(origin + 'library/' + REF, {waitUntil: 'domcontentloaded'});
  await page.locator('#akivaShareButton').click();
  await page.waitForFunction(() => !document.querySelector('#akivaShareButton').disabled);
  assert.equal(await page.locator('#akivaShareDialog[open]').count(), 0, 'Cancellation must not open fallback');
  await page.evaluate(() => Object.defineProperty(navigator, 'share', {value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError'))}));
  await page.locator('#akivaShareButton').click();
  const dialog = page.locator('#akivaShareDialog');
  await dialog.waitFor({state: 'visible'});
  assert.equal(await page.locator('#akivaShareLink').inputValue(), OPEN + REF);
  await page.locator('#akivaCopyShareLink').click();
  assert.equal(await page.evaluate(() => window.__copiedShare), OPEN + REF);
  assert.equal(await page.locator('#akivaShareStatus').innerText(), 'Link copied.');
  assert.match(await page.locator('#akivaShareWhatsApp').getAttribute('href'), /^https:\/\/wa\.me\/\?text=/);
  assert.match(await page.locator('#akivaShareEmail').getAttribute('href'), /^mailto:\?subject=/);
  for (const theme of ['dark', 'sepia']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const colors = await dialog.evaluate(element => {const style=getComputedStyle(element);return {background:style.backgroundColor,color:style.color};});
    assert.notEqual(colors.background, colors.color, theme + ': unreadable dialog colors');
  }
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard denied'));
    document.execCommand = () => false;
  });
  await page.locator('#akivaCopyShareLink').click();
  const selection = await page.locator('#akivaShareLink').evaluate(input => ({start:input.selectionStart,end:input.selectionEnd,length:input.value.length}));
  assert.equal(selection.start, 0); assert.equal(selection.end, selection.length);
  assert.match(await page.locator('#akivaShareStatus').innerText(), /selected/);
  if (screenshots) {
    await page.screenshot({path:path.join(screenshots,'fallback-dialog.png')});
    await page.setViewportSize({width:844,height:390});
    const bounds=await dialog.boundingBox();
    assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=845&&bounds.y+bounds.height<=391,'Landscape dialog must fit viewport');
    await page.screenshot({path:path.join(screenshots,'landscape-fallback-dialog.png')});
  }
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'akivaShareButton');
  checks.push({fallback: true, nativeCancellation: true, deniedNative: true, copyLink: true, clipboardDeniedSelection: true, keyboardFocus: true, themes: ['dark','sepia']});
  await context.close();

  // Android handoff is inspected, never followed: no external app or message is launched by tests.
  for (const [name, userAgent] of [
    ['android-browser','Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'],
    ['android-wrapper','Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 AkivaPublishingAndroid/1.0.5'],
    ['desktop-browser','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36']
  ]) {
    const context = await contextFor({width:390,height:844},{userAgent});
    const page = await context.newPage();
    await page.goto(origin + 'library/open/' + REF, {waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#akivaOpenWeb').getAttribute('href'), CANONICAL+'library/'+REF);
    assert.equal(await page.locator('#akivaOpenWebsite').getAttribute('href'), CANONICAL);
    assert.equal(await page.locator('#akivaSharedReference').innerText(),'Divrei Soferim 16');
    const android=page.locator('#akivaOpenAndroid');
    assert.equal(await android.isVisible(), name === 'android-browser');
    if (name==='android-browser') {
      const intent=await android.getAttribute('href');
      const parts=intent.split('#Intent;');
      assert.equal(parts.length,2);
      assert.equal(parts[0].replace(/^intent:/,'https:'),CANONICAL+'library/'+REF);
      assert.match(parts[1],/package=org\.akivapublishing\.reader;/);
      assert.equal(decodeURIComponent(parts[1].match(/S\.browser_fallback_url=([^;]+);/)[1]),CANONICAL+'library/'+REF);
      if(screenshots)await page.screenshot({path:path.join(screenshots,'android-open-link.png')});
    }
    await page.goto(origin+'library/open/#/read/%3Cscript%3E', {waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#akivaOpenWeb').getAttribute('href'), CANONICAL+'library/');
    if(name==='android-wrapper') {
      await page.goto(origin+'library/'+REF,{waitUntil:'domcontentloaded'});
      await page.locator('#akivaShareButton').click();
      await page.locator('#akivaShareDialog').waitFor({state:'visible'});
      assert.equal(await page.locator('#akivaShareLink').inputValue(),OPEN+REF);
    }
    checks.push({name, safeLanding:true, exactReadingTarget:true, explicitAndroidHandoff:name==='android-browser', webFallback:true});
    await context.close();
  }
  const report={status:'passed',origin,shareRevision:'20261022-share-v1',checks};
  fs.mkdirSync('share-browser-evidence',{recursive:true});
  fs.writeFileSync(path.join('share-browser-evidence',options['--url']?'public-checks.json':'local-checks.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); if(server)await new Promise(resolve=>server.close(resolve)); }

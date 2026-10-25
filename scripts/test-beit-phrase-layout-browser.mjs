import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

let playwright;
try { playwright = await import('playwright'); }
catch {
  assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'Playwright is unavailable');
  playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href);
}

const argument = process.argv.findIndex(value => value === '--url');
const publicUrl = argument >= 0 ? process.argv[argument + 1] : process.argv.find(value => value.startsWith('--url='))?.slice(6);
assert(argument < 0 || publicUrl, '--url requires a public library URL');
const root = path.resolve(process.env.BEIT_LAYOUT_SITE_ROOT || '.beit-layout-site');
const book = 'Beit Yaakov on Torah', slug = 'beit-yaakov-on-torah';
const parashiyot = [['Vayishlach', 48], ['Vayeshev', 48], ['Miketz', 40], ['Vayigash', 35], ['Vayechi', 86]];
const hash = ref => encodeURIComponent(ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':');
const leaves = node => node.children ? node.children.flatMap(leaves) : [node];
const server = publicUrl ? null : http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    response.setHeader('Content-Type', ({'.html': 'text/html;charset=utf-8', '.json': 'application/json;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = new URL(publicUrl || `http://127.0.0.1:${server.address().port}/library/`);
base.hash = ''; base.search = '';
if (!base.pathname.endsWith('/')) base.pathname += '/';
const browser = await playwright.chromium.launch({headless: true});
let checked = 0, checkedPairs = 0;

try {
  for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
    const context = await browser.newContext({viewport, serviceWorkers: 'block'});
    await context.addInitScript(() => {
      localStorage.setItem('rtl.lang', JSON.stringify('bi'));
      localStorage.setItem('rtl.layout', JSON.stringify('inter'));
    });
    await context.route('https://www.sefaria.org/**', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({he: [], text: [], versions: []})}));
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    const getJson = async relative => {
      const url = new URL(relative, base); url.searchParams.set('beit_layout_check', String(Date.now()));
      const response = await context.request.get(url.href);
      assert(response.ok(), `${response.status()} while loading ${relative}`);
      return response.json();
    };
    const toc = await getJson(`data/${slug}/toc.json`), sections = leaves(toc.toc);
    const samples = viewport.width >= 760
      ? parashiyot.flatMap(([parashah, count]) => [1, Math.ceil(count / 2), count].map(ois => `${book}, ${parashah} ${ois}`))
      : [`${book}, Vayishlach 1`, `${book}, Vayechi 86`];
    for (const [parashah, count] of parashiyot) {
      assert.equal(sections.filter(leaf => new RegExp(`^${book}, ${parashah} \\d+$`).test(leaf.ref)).length, count, `${parashah} TOC count`);
    }
    for (const ref of samples) {
      const leaf = sections.find(section => section.ref === ref);
      assert(leaf?.interlinear, `Missing interlinear TOC leaf: ${ref}`);
      const items = await getJson(`data/${slug}/${leaf.id}.json`);
      const count = items.reduce((sum, item) => sum + (item.p?.length || 0), 0);
      assert(count > 0, `No phrase pairs in ${ref}`);
      await page.goto(base.href + '#/read/' + hash(ref));
      const section = page.locator(`#text > .sec[data-ref="${ref}"]`);
      await section.locator('.seg-il .ph-he').first().waitFor({state: 'attached'});
      assert.equal(await section.locator('.ph-he').count(), count, `Hebrew phrase count: ${ref}`);
      assert.equal(await section.locator('.ph-en').count(), count, `English phrase count: ${ref}`);
      assert.match(await section.getAttribute('class'), /\bil\b/, `Interlinear class missing: ${ref}`);
      assert.doesNotMatch(await section.getAttribute('class'), /paragraph-translation/, `Forced paragraph class: ${ref}`);

      const preference = async (name, value) => {
        if (!await page.locator('#settings').isVisible()) await page.locator('#setBtn').click();
        const button = page.locator(`#settings [data-pref="${name}"] button[data-v="${value}"]`);
        await button.click();
        assert.equal(await button.getAttribute('aria-pressed'), 'true', `Selected ${name} button`);
        assert.equal(await page.locator('#text').getAttribute('data-' + name), value, `Applied ${name} setting`);
      };
      await preference('lang', 'bi');
      for (const layout of ['inter', 'stack', 'side']) {
        await preference('layout', layout);
        const actual = await section.locator('.seg').first().evaluate(segment => {
          const shown = selector => getComputedStyle(segment.querySelector(selector)).display !== 'none';
          return {phrases: shown('.seg-il'), hebrew: shown('.seg-he'), english: shown('.seg-en'), columns: getComputedStyle(segment).gridTemplateColumns.trim().split(/\s+/).length};
        });
        assert.deepEqual(actual, {phrases: layout === 'inter', hebrew: layout !== 'inter', english: layout !== 'inter', columns: layout === 'side' && viewport.width >= 760 ? 2 : 1}, `${viewport.width}px ${ref}: ${layout} must change the rendered layout`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `Horizontal overflow: ${viewport.width}px ${ref} ${layout}`);
      }
      await preference('layout', 'inter');
      for (const language of ['en', 'he']) {
        await preference('lang', language);
        assert.equal(await section.locator('.seg-en').first().isVisible(), language === 'en', `${ref}: ${language} English visibility`);
        assert.equal(await section.locator('.seg-he').first().isVisible(), language === 'he', `${ref}: ${language} Hebrew visibility`);
        assert.equal(await section.locator('.seg-il').first().isVisible(), false, `${ref}: ${language} phrase duplication`);
      }
      await preference('lang', 'bi');
      assert.equal(await section.locator('.seg-il .ph-he').first().isVisible(), true, `${ref}: interlinear restored`);
      await page.locator('#setBtn').click();
      if (ref === samples[0]) {
        fs.mkdirSync('artifacts/beit-phrase-layout', {recursive: true});
        await page.screenshot({path: `artifacts/beit-phrase-layout/interlinear-${viewport.width}.png`, fullPage: false});
      }
      checked++; checkedPairs += count;
      console.log(`PASS ${viewport.width}px ${ref}: ${count} pairs, three layouts and both single-language modes`);
    }
    assert.deepEqual(errors, [], `${viewport.width}px browser errors`);
    await context.close();
  }
  console.log(JSON.stringify({ok: true, samples: checked, renderedPhrasePairs: checkedPairs, desktopParashiyot: 5, mobile: true, layoutModes: 3, singleLanguageModes: 2}));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}

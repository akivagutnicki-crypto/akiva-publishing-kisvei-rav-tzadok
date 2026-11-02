// Real-browser conservation checks for the corrected Takanas DOCX publication.
// node tests/test-takanas-docx-master-browser.mjs --root .takanas-docx-fixture
// Add --url https://example.test/library/ to verify the same fixture on the web.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {loadPack} from '../scripts/publish-takanas-docx-master.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
for (const flag of ['--root', '--url', '--out', '--repairs']) {
  if (args.includes(flag)) assert(args[args.indexOf(flag) + 1] && !args[args.indexOf(flag) + 1].startsWith('--'), 'Missing value for ' + flag);
}
const positional = args.find((value, index) => !value.startsWith('--') && (index === 0 || !['--root', '--url', '--out', '--repairs'].includes(args[index - 1])));
const root = path.resolve(option('--root', positional || process.env.AKIVA_ROOT || path.join(repository, 'dist')));
const live = option('--url', process.env.AKIVA_LIVE_URL || null);
const output = path.resolve(option('--out', path.join(repository, 'artifacts/takanas-docx-master/browser')));
const repairsPath = path.resolve(option('--repairs', path.join(repository, 'sources/akiva/overlays/takanas-docx-master-20261102-anchor-repairs.json')));
const {src, manifest, stats, sourceSha256, manifestSha256} = loadPack();
assert.deepEqual({sections: stats.sections, paragraphs: stats.paragraphs, pairs: stats.pairs, notes: stats.notes},
  {sections: 16, paragraphs: 363, pairs: 15541, notes: 2621}, 'Frozen publication totals');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const source = path.join(repository, 'sources/akiva/Takanat_HaShavin.json');
assert.equal(sha(fs.readFileSync(source)), sourceSha256);
const repairLedger = fs.existsSync(repairsPath) ? read(repairsPath) : null;
if (manifest.readerDisplayWordBoundaryRepairs) {
  assert(repairLedger, 'The approved Reader display repair ledger is required');
  assert.equal(repairLedger.repair_count, 28);
  assert.equal(repairLedger.repairs.length, 28);
}
const repairByKey = new Map((repairLedger?.repairs || []).map(repair => [repair.note_key, repair]));
const sections = src.sections.map((section, id) => {
  const builtPath = path.join(root, `library/data/takanat-hashavin/${id}.json`);
  assert(fs.existsSync(builtPath), 'Missing fixture chapter ' + builtPath);
  const built = read(builtPath), rows = section.items.filter(row => row.p), actualRows = built.filter(row => row.p);
  assert.equal(actualRows.length, rows.length, 'Fixture paragraph count in section ' + id);
  for (const [index, row] of rows.entries()) {
    assert.equal(actualRows[index].n, row.n);
    assert(isDeepStrictEqual(actualRows[index].footnotes || [], row.footnotes || []), 'Fixture note preimage differs ' + id + ':' + row.n);
  }
  return {id, ref: id ? `Takanat HaShavin ${id}` : 'Takanat HaShavin, Introduction', rows, builtRows: actualRows};
});


const toc = read(path.join(root, 'library/data/takanat-hashavin/toc.json'));
const navigationLedger = read(path.join(repository, manifest.seifNavigation.path));
assert.equal(sha(fs.readFileSync(path.join(repository, manifest.seifNavigation.path))), manifest.seifNavigation.sha256, 'Printed-seif navigation ledger pin');
const navSections = navigationLedger.simanim.map(siman => {
  const leaf = toc.toc.children.find(child => child.id === siman.n);
  assert(leaf, 'TOC Siman ' + siman.n);
  const entries = leaf.seifNavigation || [];
  assert.equal(entries.length, siman.seifCount, 'Every printed seif in TOC Siman ' + siman.n);
  for (const [index, entry] of entries.entries()) {
    const expected = siman.entries[index];
    for (const key of ['n', 'he', 'en', 'ref', 'phraseIndex', 'headingTitle']) assert.deepEqual(entry[key], expected[key], `Native seif navigation ${siman.n}:${entry.n} ${key}`);
  }
  return {section: siman.n, entries};
});
const navigation = navSections.flatMap(group => group.entries.map(entry => ({...entry, section: group.section})));
assert.equal(navigation.length, manifest.seifNavigation.entries);
const toHash = ref => encodeURIComponent(ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':');

let playwright;
try { playwright = await import('playwright'); }
catch {
  assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'Install Playwright or set CODEX_PRIMARY_RUNTIME_NODE_MODULES');
  playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href);
}
fs.mkdirSync(output, {recursive: true});
let server, browser, activePage;
let base = live;
if (base) {
  const url = new URL(base); assert(['http:', 'https:'].includes(url.protocol));
  url.hash = ''; url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  if (!url.pathname.endsWith('/library/')) url.pathname += 'library/';
  base = url.href;
} else {
  server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      let file = path.resolve(root, '.' + pathname);
      assert(file === root || file.startsWith(root + path.sep));
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const types = {'.html': 'text/html;charset=utf-8', '.json': 'application/json;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'};
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(file).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/library/`;
}
const report = {ok: false, editionId: src.editionId, sourceSha256, manifestSha256, staticRoot: root,
  liveURL: live, expected: stats, readerDisplayRepairsExpected: repairByKey.size, printedSeifNavigationExpected: navigation.length, viewports: [], pageErrors: [], screenshots: []};
const mode = live ? 'live' : 'local';
try {
  browser = await playwright.chromium.launch({headless: true, ...(process.env.AKIVA_CHROMIUM_EXECUTABLE ? {executablePath: process.env.AKIVA_CHROMIUM_EXECUTABLE} : {})});
  for (const width of [1280, 390]) {
    const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 960}, hasTouch: width === 390, serviceWorkers: 'block'});
    // Isolate the selected chapter from infinite-scroll loading and stale caches.
    await context.addInitScript(() => {
      localStorage.setItem('rtl.lang', JSON.stringify('bi'));
      localStorage.setItem('rtl.layout', JSON.stringify('inter'));
      window.IntersectionObserver = class {observe() {} unobserve() {} disconnect() {}};
    });
    await context.route(url => url.origin !== new URL(base).origin, route => route.fulfill({status: 200, contentType: 'application/json', body: '[]'}));
    const page = activePage = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.pageErrors.push({width, message: error.message}));
    const checks = [], checkedRepairKeys = new Set();
    const navigationClicks = [];
    const openContents = async () => {
      await page.goto(base + '#/book/' + toHash('Takanat HaShavin'), {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(count => document.querySelectorAll('#toc a[data-kdp-seif]').length === count, navigation.length, {timeout: 60000});
      const links = await page.locator('#toc a[data-kdp-seif]').evaluateAll(nodes => nodes.map(node => {
        const raw = node.getAttribute('href'), [encoded, query] = raw.replace(/^#\/read\//, '').split('?');
        const params = new URLSearchParams(query);
        return {n: Number(node.dataset.kdpSeif), ref: decodeURIComponent(encoded.replace(/_/g, ' ')), title: params.get('heading'), phrase: Number(params.get('topic')), text: node.textContent};
      }));
      assert.deepEqual(links.map(({n, ref, title, phrase}) => ({n, ref, title, phrase})), navigation.map(entry => ({n: entry.n, ref: entry.ref, title: entry.headingTitle, phrase: entry.phraseIndex})), 'Every printed seif navigation target');
      for (const [index, link] of links.entries()) {
        assert(link.text.includes(navigation[index].he), 'TOC Hebrew label ' + navigation[index].ref);
        assert(link.text.includes(navigation[index].en), 'TOC English label ' + navigation[index].ref);
      }
      for (const download of src.downloads || []) assert.equal(await page.locator('#tocActions a').evaluateAll((nodes, file) => nodes.filter(node => node.getAttribute('href') === file && node.hasAttribute('download')).length, download.file), 1, 'Current Word download is offered: ' + download.file);
      return links;
    };
    await openContents();
    // Click one actual TOC entry in every Siman; use the recovered seventh seif
    // and mid-paragraph KDP boundaries rather than only easy chapter starts.
    for (const group of navSections) {
      const sample = group.section === 12 ? group.entries.find(entry => entry.n === 7)
        : [8, 15].includes(group.section) ? (group.entries.find(entry => entry.phraseIndex > 0) || group.entries.at(-1))
        : group.entries[Math.floor(group.entries.length / 2)];
      assert(sample, 'Representative printed seif exists in Siman ' + group.section);
      const index = navigation.findIndex(entry => entry.section === group.section && entry.n === sample.n);
      await openContents();
      const link = page.locator('#toc a[data-kdp-seif]').nth(index);
      if (width === 390) await link.tap(); else await link.click();
      await page.waitForFunction(entry => [...document.querySelectorAll('.subhead[data-topic-ref]')].some(node => node.dataset.topicRef === entry.ref && node.dataset.topicTitle === entry.headingTitle && Number(node.dataset.topicPhraseIndex) === entry.phraseIndex && node.classList.contains('flash') && node.getClientRects().length), sample, {timeout: 60000});
      const visible = await page.locator('.subhead[data-topic-ref]').evaluateAll((nodes, entry) => nodes.filter(node => node.dataset.topicRef === entry.ref && node.dataset.topicTitle === entry.headingTitle && Number(node.dataset.topicPhraseIndex) === entry.phraseIndex && node.getClientRects().length).map(node => ({top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, flashed: node.classList.contains('flash')})), sample);
      assert(visible.some(node => node.flashed && node.top >= 0 && node.bottom <= (width === 390 ? 844 : 960)), 'TOC jump reveals exact seif heading ' + group.section + ':' + sample.n);
      navigationClicks.push({siman: group.section, seif: sample.n, ref: sample.ref, phraseIndex: sample.phraseIndex, nativeHeading: sample.headingTitle, pointer: width === 390 ? 'touch' : 'mouse'});
      if ([8, 12, 15].includes(group.section)) {
        const image = path.join(output, `${mode}-seif-${group.section}-${sample.n}-${width}.png`);
        await page.screenshot({path: image}); report.screenshots.push(image);
      }
    }
    for (const section of sections) {
      await page.goto(base + '#/read/' + encodeURIComponent(section.ref).replace(/%20/g, '_'), {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(ref => [...document.querySelectorAll('.sec')].some(node => node.dataset.ref === ref && node.dataset.connectionFootnotesMounted === 'true'), section.ref, {timeout: 60000});
      const current = page.locator(`.sec[data-ref=${JSON.stringify(section.ref)}]`);
      assert.equal(await current.count(), 1, 'Unique mounted chapter ' + section.ref);
      assert.equal(await page.locator('#text').getAttribute('data-lang'), 'bi');
      assert.equal(await page.locator('#text').getAttribute('data-layout'), 'inter');
      const sectionNavigation = navSections.find(group => group.section === section.id)?.entries || [];
      const checked = await current.evaluate((node, {section, repairs, navigationEntries}) => {
        const equal = (actual, expected, label) => {
          if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(label + '\nExpected: ' + JSON.stringify(expected).slice(0, 1100) + '\nActual: ' + JSON.stringify(actual).slice(0, 1100));
        };
        const text = html => { const template = document.createElement('template'); template.innerHTML = html; return template.content.textContent; };
        const author = element => { const clone = element.cloneNode(true); clone.querySelectorAll('.footnote,.reader-footnote,.footnote-marker,.subhead').forEach(child => child.remove()); return clone.textContent; };
        const citationLinks = html => { const template = document.createElement('template'); template.innerHTML = html; return [...template.content.querySelectorAll('a.cite')].map(a => ({ref: a.dataset.ref, href: '#/read/' + encodeURIComponent(a.dataset.ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':')})); };
        const expectedPairs = section.rows.flatMap(row => row.p), expectedBuilt = section.builtRows.flatMap(row => row.p);
        const visiblePhrases = [...node.querySelectorAll('.seg-il .ph')];
        for (const entry of navigationEntries) {
          const targets = [...node.querySelectorAll('.subhead[data-topic-ref]')].filter(head => head.dataset.topicRef === entry.ref && head.dataset.topicTitle === entry.headingTitle && Number(head.dataset.topicPhraseIndex) === entry.phraseIndex && head.getClientRects().length);
          if (!targets.length) throw Error('Missing visible KDP seif heading ' + entry.ref + ' / ' + entry.n);
          const row = [...node.querySelectorAll('.seg')].find(value => value.dataset.ref === entry.ref);
          const expectedPhrase = row?.querySelectorAll('.seg-il .ph')[entry.phraseIndex];
          if (!expectedPhrase) throw Error('KDP seif navigation is outside its canonical row ' + entry.ref);
          for (const target of targets) {
            const actualPhrase = target.closest('.ph') || visiblePhrases.find(phrase => target.compareDocumentPosition(phrase) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (actualPhrase !== expectedPhrase) throw Error('KDP seif heading is premature or late ' + entry.ref + ' / ' + entry.n);
          }
        }
        equal([...node.querySelectorAll('.seg-il .ph-he')].map(author), expectedPairs.map(pair => text(pair[0])), section.ref + ' every exact Hebrew phrase');
        equal([...node.querySelectorAll('.seg-il .ph-en')].map(author), expectedPairs.map(pair => text(pair[1])), section.ref + ' every exact English phrase');
        const authorLinks = [...node.querySelectorAll('.seg-il .ph-he a.cite,.seg-il .ph-en a.cite')].filter(a => !a.closest('.reader-footnote,.footnote')).map(a => ({ref: a.dataset.ref, href: a.getAttribute('href')}));
        const explicitLinks = expectedBuilt.flatMap(pair => pair.flatMap(citationLinks));
        // The Reader also recognizes references in plain manuscript prose at
        // render time. Require every supplied link, and validate every generated
        // link's exact Reader destination without treating those extra links as
        // added manuscript words.
        for (const expected of explicitLinks) if (!authorLinks.some(actual => JSON.stringify(actual) === JSON.stringify(expected))) throw Error(section.ref + ' missing supplied citation link ' + expected.ref);
        for (const actual of authorLinks) {
          if (!actual.ref) throw Error(section.ref + ' empty citation target');
          equal(actual.href, '#/read/' + encodeURIComponent(actual.ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':'), section.ref + ' generated citation destination');
        }
        const actualRows = [...node.querySelectorAll('.seg')].filter(row => row.querySelector('.seg-il'));
        equal(actualRows.map(row => row.dataset.ref), section.rows.map(row => section.ref + (section.id ? ':' : ' ') + row.n), section.ref + ' stable paragraph references');
        const expectedNotes = section.rows.flatMap(row => (row.footnotes || []).map(note => ({row, note}))).sort((a, b) => a.row.n - b.row.n || a.note.phraseIndex - b.note.phraseIndex || a.note.heCharOffset - b.note.heCharOffset);
        const notes = new Map(expectedNotes.map(value => [value.note.placementId, value]));
        const boxes = [...node.querySelectorAll('.seg-il .reader-footnote[data-source-note="true"]')];
        equal(boxes.length, expectedNotes.length, section.ref + ' complete native note count');
        equal(new Set(boxes.map(box => box.dataset.noteKey)).size, boxes.length, section.ref + ' unique note identities');
        let hyperlinks = 0;
        for (const box of boxes) {
          const expected = notes.get(box.dataset.noteKey); if (!expected) throw Error('Unexpected native note ' + box.dataset.noteKey);
          equal(box.dataset.fn, String(expected.note.number), expected.note.sourceId + ' displayed note number');
          const parts = [...box.querySelectorAll('.annotation-part')];
          equal(parts.map(part => part.querySelector('.annotation-text').textContent), expected.note.paragraphs.map(p => p.text), expected.note.sourceId + ' entire note paragraphs');
          equal(parts.map(part => [...part.querySelectorAll('.annotation-text a')].map(a => a.getAttribute('href'))), expected.note.paragraphs.map(p => (p.rich || []).filter(run => run.href).map(run => run.href)), expected.note.sourceId + ' every Word hyperlink');
          equal(parts.map(part => [...part.querySelectorAll('.annotation-text strong')].map(a => a.textContent)), expected.note.paragraphs.map(p => (p.rich || []).filter(run => run.bold).map(run => run.text || '')), expected.note.sourceId + ' bold Word runs');
          equal(parts.map(part => [...part.querySelectorAll('.annotation-text em')].map(a => a.textContent)), expected.note.paragraphs.map(p => (p.rich || []).filter(run => run.italic).map(run => run.text || '')), expected.note.sourceId + ' italic Word runs');
          hyperlinks += box.querySelectorAll('.annotation-text a').length;
        }
        const markers = [...node.querySelectorAll('.seg-il .footnote-marker[data-note-key]')];
        equal(markers.length, expectedNotes.length, section.ref + ' every native source marker');
        equal(new Set(markers.map(marker => marker.dataset.noteKey)).size, markers.length, section.ref + ' unique source markers');
        const repairKeys = [];
        for (const marker of markers) {
          const expected = notes.get(marker.dataset.noteKey); if (!expected) throw Error('Unexpected marker ' + marker.dataset.noteKey);
          const hebrew = marker.closest('.ph-he'); if (!hebrew) throw Error('Source marker is outside Hebrew: ' + marker.dataset.noteKey);
          equal(marker.closest('.seg').dataset.ref, section.ref + (section.id ? ':' : ' ') + expected.row.n, expected.note.sourceId + ' exact paragraph');
          equal([...marker.closest('.seg').querySelectorAll('.seg-il .ph')].indexOf(marker.closest('.ph')), expected.note.phraseIndex, expected.note.sourceId + ' exact phrase');
          const range = document.createRange(); range.selectNodeContents(hebrew); range.setEndBefore(marker);
          const prefix = range.cloneContents(); prefix.querySelectorAll('.footnote,.reader-footnote,.footnote-marker,.subhead').forEach(child => child.remove());
          equal(prefix.textContent, expected.note.heAnchorPrefix, expected.note.sourceId + ' exact Hebrew prefix; no premature/late marker');
          const repair = repairs[expected.note.provenance?.docxNoteKey];
          // Provenance shapes can add fields; exact applied prefixes remain mandatory.
          const matched = repair || Object.values(repairs).find(value => value.section_key === String(section.id || 'Introduction') && value.seif === expected.row.n && value.phrase_index === expected.note.phraseIndex && value.new_prefix === expected.note.heAnchorPrefix);
          if (matched) { equal(prefix.textContent, matched.new_prefix, expected.note.sourceId + ' approved grapheme/word completion'); equal(expected.note.provenance.readerAnchorPresentationRepair.nativeEvent, matched.native_provenance, expected.note.sourceId + ' unchanged native Word anchor provenance'); repairKeys.push(matched.note_key); }
          const box = boxes.find(value => value.dataset.noteKey === marker.dataset.noteKey);
          marker.click(); equal(marker.getAttribute('aria-expanded'), 'true', expected.note.sourceId + ' opens');
          if (!box.classList.contains('open')) throw Error('Full source did not open ' + marker.dataset.noteKey);
          marker.click(); equal(marker.getAttribute('aria-expanded'), 'false', expected.note.sourceId + ' closes');
          if (box.classList.contains('open')) throw Error('Source did not close ' + marker.dataset.noteKey);
        }
        return {section: section.ref, paragraphs: section.rows.length, phrasePairs: expectedPairs.length, nativeNotes: boxes.length, noteHyperlinks: hyperlinks, authorCitationLinks: authorLinks.length, suppliedCitationLinksPreserved: explicitLinks.length, exactHebrewAndEnglish: true, exactFullNoteTextAndFormatting: true, exactHebrewMarkerPrefixes: true, allNotesOpenedAndClosed: markers.length, exactPrintedSeifHeadingPlacements: navigationEntries.length, repairedWordBoundaryKeys: repairKeys};
      }, {section, repairs: Object.fromEntries(repairByKey), navigationEntries: sectionNavigation});
      checked.repairedWordBoundaryKeys.forEach(key => checkedRepairKeys.add(key));
      // A physical pointer activation checks hit targets, focus, visible expansion and layout.
      const notes = section.rows.flatMap(row => (row.footnotes || []).map(note => ({row, note})));
      const sample = notes.find(({note}) => note.provenance?.readerAnchorPresentationRepair) || notes[0];
      if (sample) {
        const selector = `[data-note-key=${JSON.stringify(sample.note.placementId)}]`;
        const marker = current.locator('.seg-il .ph-he .footnote-marker' + selector), box = current.locator('.seg-il .reader-footnote' + selector);
        const activate = () => width === 390 ? marker.tap() : marker.click();
        await activate(); assert.equal(await marker.getAttribute('aria-expanded'), 'true'); assert(await box.isVisible());
        assert(await box.evaluate(node => node.scrollWidth <= node.clientWidth + 2), section.ref + ' expanded source note horizontal overflow');
        if ([0, 1, 6, 10, 15].includes(section.id)) {
          await marker.scrollIntoViewIfNeeded();
          const image = path.join(output, `${mode}-${section.id}-${width}-source-note.png`);
          await page.screenshot({path: image, fullPage: false}); report.screenshots.push(image);
        }
        await activate(); assert.equal(await marker.getAttribute('aria-expanded'), 'false');
        checked.physicalPointerOpenClose = width === 390 ? 'touch' : 'mouse';
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, section.ref + ' horizontal page overflow');
      checks.push(checked);
      console.log(JSON.stringify({width, section: section.id, pairs: checked.phrasePairs, notes: checked.nativeNotes, exactTextAndAnchors: true}));
    }
    assert.equal(checks.reduce((sum, check) => sum + check.paragraphs, 0), 363);
    assert.equal(checks.reduce((sum, check) => sum + check.phrasePairs, 0), 15541);
    assert.equal(checks.reduce((sum, check) => sum + check.nativeNotes, 0), 2621);
    assert.equal(checks.reduce((sum, check) => sum + check.allNotesOpenedAndClosed, 0), 2621);
    if (repairByKey.size) assert.deepEqual([...checkedRepairKeys].sort(), [...repairByKey.keys()].sort(), 'All28 approved display repairs are rendered at width ' + width);
    assert.equal(checks.reduce((sum, check) => sum + check.exactPrintedSeifHeadingPlacements, 0), navigation.length);
    report.viewports.push({width, chapters: checks, readerDisplayRepairsChecked: checkedRepairKeys.size, printedSeifTargetsChecked: navigation.length, navigationClicks});
    await context.close();
  }
  assert.deepEqual(report.pageErrors, [], 'Reader JavaScript errors');
  assert.equal(sha(fs.readFileSync(source)), sourceSha256, 'Frozen source changed while browser tests ran');
  report.ok = true;
} catch (error) {
  report.failure = error.stack || error.message;
  if (activePage && !activePage.isClosed()) {
    try { const image = path.join(output, mode + '-failure.png'); await activePage.screenshot({path: image}); report.screenshots.push(image); } catch {}
  }
  throw error;
} finally {
  fs.writeFileSync(path.join(output, mode + '-browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ok: true, ...stats, viewports: [1280, 390], allNoteOpenCloseChecks: 5242, sourceSha256, manifestSha256, report: path.join(output, mode + '-browser-report.json')}));

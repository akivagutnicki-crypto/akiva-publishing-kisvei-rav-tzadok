// Verify the additive review and every new Hebrew marker on desktop/mobile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {loadPack,validatePack,verifyBatchSuccessor,verifyBatchChain,hasPublishedBatches,registeredPacks,batchNames,DEFAULT_PACK,notesOf,sectionOf,plain,verifyDivreiZipRefresh,DIVREI_ZIP_REFRESH,addVerifiedSourceUrls} from './publish-tzidkat-batch-review.mjs';

const args = process.argv.slice(2), option = (key,fallback) => { const at = args.indexOf(key); return at < 0 ? fallback : args[at+1]; };
if (args.includes('--all')) {
  for (const filename of registeredPacks()) {
    const run = spawnSync(process.execPath,[fileURLToPath(import.meta.url),...args.filter(value => value !== '--all'),'--pack',filename],{stdio:'inherit'});
    assert.equal(run.status,0,'Batch browser verification failed');
  }
  process.exit(0);
}
const root = path.resolve(option('--root','dist')), live = option('--url',null), prepared = loadPack(path.resolve(option('--pack',DEFAULT_PACK)));
const {pack,additions} = prepared;
const artifacts = 'artifacts/' + batchNames(pack).artifact; fs.mkdirSync(artifacts,{recursive:true});

// Frozen output of the authenticated independent Divrei repair. This fixture
// verifies that the one accepted transition cannot admit other index/ZIP edits.
const divreiIndexFixture = Buffer.from("{\"version\":\"688632ebb4a20eea\",\"library\":{\"file\":\"downloads/rav-tzadok-library.zip\",\"bytes\":65933746,\"dataFiles\":4912,\"documents\":21},\"books\":[{\"title\":\"Beit Yaakov on Torah\",\"he\":\"בית יעקב על התורה\",\"slug\":\"beit-yaakov-on-torah\",\"file\":\"downloads/books/beit-yaakov-on-torah.zip\",\"bytes\":4207274,\"dataFiles\":420,\"documents\":4},{\"title\":\"Divrei Chalomot\",\"he\":\"דברי חלומות\",\"slug\":\"divrei-chalomot\",\"file\":\"downloads/books/divrei-chalomot.zip\",\"bytes\":287346,\"dataFiles\":36,\"documents\":0},{\"title\":\"Divrei Soferim\",\"he\":\"דברי סופרים\",\"slug\":\"divrei-soferim\",\"file\":\"downloads/books/divrei-soferim.zip\",\"bytes\":678319,\"dataFiles\":47,\"documents\":0},{\"title\":\"Et HaOchel\",\"he\":\"עת האוכל\",\"slug\":\"et-haochel\",\"file\":\"downloads/books/et-haochel.zip\",\"bytes\":147649,\"dataFiles\":24,\"documents\":0},{\"title\":\"Kometz HaMinchah\",\"he\":\"קומץ המנחה\",\"slug\":\"kometz-haminchah\",\"file\":\"downloads/books/kometz-haminchah.zip\",\"bytes\":2309371,\"dataFiles\":202,\"documents\":2},{\"title\":\"Machshavot Charutz\",\"he\":\"מחשבות חרוץ\",\"slug\":\"machshavot-charutz\",\"file\":\"downloads/books/machshavot-charutz.zip\",\"bytes\":2968638,\"dataFiles\":29,\"documents\":0},{\"title\":\"Meshiv HaTa'anah\",\"he\":\"משיב הטענה\",\"slug\":\"meshiv-hata-anah\",\"file\":\"downloads/books/meshiv-hata-anah.zip\",\"bytes\":413187,\"dataFiles\":71,\"documents\":0},{\"title\":\"Meshiv Tzedek\",\"he\":\"משיב צדק\",\"slug\":\"meshiv-tzedek\",\"file\":\"downloads/books/meshiv-tzedek.zip\",\"bytes\":530412,\"dataFiles\":8,\"documents\":0},{\"title\":\"Ohr Zarua LaTzadik\",\"he\":\"אור זרוע לצדיק\",\"slug\":\"ohr-zarua-latzadik\",\"file\":\"downloads/books/ohr-zarua-latzadik.zip\",\"bytes\":1298004,\"dataFiles\":65,\"documents\":0},{\"title\":\"Poked Akarim\",\"he\":\"פוקד עקרים\",\"slug\":\"poked-akarim\",\"file\":\"downloads/books/poked-akarim.zip\",\"bytes\":771471,\"dataFiles\":14,\"documents\":0},{\"title\":\"Resisei Layla\",\"he\":\"רסיסי לילה\",\"slug\":\"resisei-layla\",\"file\":\"downloads/books/resisei-layla.zip\",\"bytes\":4399868,\"dataFiles\":66,\"documents\":1},{\"title\":\"Sefer HaZikhronot\",\"he\":\"ספר הזכרונות\",\"slug\":\"sefer-hazikhronot\",\"file\":\"downloads/books/sefer-hazikhronot.zip\",\"bytes\":976447,\"dataFiles\":44,\"documents\":0},{\"title\":\"Takanat HaShavin\",\"he\":\"תקנת השבין\",\"slug\":\"takanat-hashavin\",\"file\":\"downloads/books/takanat-hashavin.zip\",\"bytes\":1854569,\"dataFiles\":24,\"documents\":0},{\"title\":\"Toldos HaKohen\",\"he\":\"תולדות הכהן מלובלין\",\"slug\":\"toldos-hakohen\",\"file\":\"downloads/books/toldos-hakohen.zip\",\"bytes\":94171,\"dataFiles\":22,\"documents\":0},{\"title\":\"Tzidkat HaTzadik\",\"he\":\"צדקת הצדיק\",\"slug\":\"tzidkat-hatzadik\",\"file\":\"downloads/books/tzidkat-hatzadik.zip\",\"bytes\":6829790,\"dataFiles\":274,\"documents\":1},{\"title\":\"Dover Tzedek\",\"he\":\"דובר צדק\",\"slug\":\"dover-tzedek\",\"file\":\"downloads/books/dover-tzedek.zip\",\"bytes\":6756381,\"dataFiles\":24,\"documents\":2},{\"title\":\"Likkutei Maamarim\",\"he\":\"ספר ליקוטי מאמרים\",\"slug\":\"likkutei-maamarim\",\"file\":\"downloads/books/likkutei-maamarim.zip\",\"bytes\":2868261,\"dataFiles\":27,\"documents\":0},{\"title\":\"Peri Tzadik\",\"he\":\"פרי צדיק\",\"slug\":\"peri-tzadik\",\"file\":\"downloads/books/peri-tzadik.zip\",\"bytes\":20506118,\"dataFiles\":1249,\"documents\":9},{\"title\":\"Sichat Malakhei HaSharet\",\"he\":\"שיחת מלאכי השרת\",\"slug\":\"sichat-malakhei-hasharet\",\"file\":\"downloads/books/sichat-malakhei-hasharet.zip\",\"bytes\":747650,\"dataFiles\":16,\"documents\":0},{\"title\":\"Sichat Shedim\",\"he\":\"שיחת שדים\",\"slug\":\"sichat-shedim\",\"file\":\"downloads/books/sichat-shedim.zip\",\"bytes\":102571,\"dataFiles\":10,\"documents\":0},{\"title\":\"Sod Yesharim\",\"he\":\"סוד ישרים\",\"slug\":\"sod-yesharim\",\"file\":\"downloads/books/sod-yesharim.zip\",\"bytes\":1826558,\"dataFiles\":743,\"documents\":0},{\"title\":\"Yisrael Kedoshim\",\"he\":\"ישראל קדושים\",\"slug\":\"yisrael-kedoshim\",\"file\":\"downloads/books/yisrael-kedoshim.zip\",\"bytes\":1939585,\"dataFiles\":18,\"documents\":0},{\"title\":\"Tiferet Yosef\",\"he\":\"תפארת יוסף\",\"slug\":\"tiferet-yosef\",\"file\":\"downloads/books/tiferet-yosef.zip\",\"bytes\":427974,\"dataFiles\":64,\"documents\":0}]}\n");
function divreiRefreshGuards() {
  const known = DIVREI_ZIP_REFRESH, input = {indexBytes:divreiIndexFixture,indexBefore:{...known.index.before},zipBefore:{...known.zip.before},zipAfter:{...known.zip.after}};
  assert.equal(verifyDivreiZipRefresh(input).commit,known.commit);
  const cases = [
    ['another download record changed', copy => { const index = JSON.parse(copy.indexBytes); index.books.find(book => book.slug !== 'divrei-soferim').bytes++; copy.indexBytes = Buffer.from(JSON.stringify(index) + '\n'); }, /Download index differs/],
    ['unverified Divrei ZIP', copy => { copy.zipAfter.sha256 = '0'.repeat(64); }, /Divrei ZIP differs/],
    ['different predecessor index', copy => { copy.indexBefore.sha256 = '0'.repeat(64); }, /Unknown predecessor index/],
    ['different predecessor Divrei ZIP', copy => { copy.zipBefore.sha256 = '0'.repeat(64); }, /Unknown predecessor Divrei ZIP/],
    ['different Divrei ZIP size', copy => { copy.zipAfter.bytes++; }, /Divrei ZIP differs/],
  ];
  return cases.map(([name,mutate,pattern]) => { const copy = {...input,indexBefore:{...input.indexBefore},zipBefore:{...input.zipBefore},zipAfter:{...input.zipAfter}}; mutate(copy); assert.throws(() => verifyDivreiZipRefresh(copy),pattern); return {name,rejected:true}; });
}

function rejected(name, mutate, pattern) {
  const copy = structuredClone(pack); mutate(copy);
  assert.throws(() => validatePack(copy),pattern,name + ' must be rejected');
  return {name,rejected:true};
}
const firstAdded = additions[0];
const findNew = copy => notesOf(copy.chapters.find(file => sectionOf(file.path) === firstAdded.sectionRef).after).find(item => item.note.placementId === firstAdded.note.placementId);
const guards = [
  ...divreiRefreshGuards(),
  rejected('changed existing quotation', copy => { const file = copy.chapters.find(f => notesOf(f.before).length); notesOf(file.after).find(item => item.note.placementId === notesOf(file.before)[0].note.placementId).note.paragraphs[0].text += ' changed'; }, /Existing note/),
  rejected('removed existing note', copy => { const file = copy.chapters.find(f => notesOf(f.before).length), item = notesOf(file.after).find(item => item.note.placementId === notesOf(file.before)[0].note.placementId); item.row.footnotes = item.row.footnotes.filter(n => n.placementId !== item.note.placementId); }, /Existing note/),
  rejected('changed author text', copy => { copy.chapters[0].after.find(row => row.p).p[0][0] += 'x'; }, /Existing note/),
  rejected('incorrect Hebrew anchor', copy => { findNew(copy).note.heAnchorPrefix = 'incorrect'; }, /inexact Hebrew anchor/),
  rejected('colliding note number', copy => { findNew(copy).note.number = notesOf(copy.chapters.find(f => notesOf(f.before).length).before)[0].note.number; }, /existing identity/),
  rejected('incorrect predecessor', copy => { copy.chapters[0].beforeSha256 = '0'.repeat(64); }, /preimage hash/),
  rejected('unrequested section', copy => { copy.linksBefore['Tzidkat HaTzadik ' + (copy.reviewedSections[0] === 1 ? 264 : 1)] = []; }, /exactly the reviewed batch/),
  rejected('secondary-edition attribution', copy => { const p = findNew(copy).note.paragraphs[0]; p.text += ' Biur Meshulav'; if (p.rich) p.rich.push({text:' Biur Meshulav'}); }, /Secondary commentary/),
];
if (pack.verifiedExternalUrls?.length) {
  guards.push(
    rejected('undeclared primary URL', copy => { copy.verifiedExternalUrls = []; }, /exact reviewed declaration/),
    rejected('unrequested external URL', copy => { copy.verifiedExternalUrls[0].url += '?unrequested'; }, /Unsupported exact primary-source URL|not a declared new original source/),
    rejected('unapproved primary-text page', copy => { copy.verifiedExternalUrls[0].url = 'https://mobile.tora.ws/html/15061-999.html'; }, /Unsupported exact primary-source URL/),
    rejected('different external-source evidence', copy => { copy.verifiedExternalUrls[0].evidenceSha256 = '0'.repeat(64); }, /source evidence changed/),
    rejected('unreviewed external source', copy => { const item = copy.verifiedExternalUrls[0]; copy.audit.entries.find(entry => entry.placementId === item.placementId).sourceEvidence[0].url += '?different'; }, /matching reviewed bilingual source evidence/),
  );
  const original = 'before /* Verified primary source URLs */ ["https://existing.example/source"].includes(String(url || \'\')) after';
  const next = addVerifiedSourceUrls(original,pack.verifiedExternalUrls);
  const expectedList = '["https://existing.example/source",' + pack.verifiedExternalUrls.map(item => JSON.stringify(item.url)).join(',') + ']';
  assert.equal(next,original.replace('["https://existing.example/source"]',() => expectedList),'Exact source list must preserve every existing reader byte');
  assert.equal(addVerifiedSourceUrls(next,pack.verifiedExternalUrls),next,'Repeated exact URLs must not duplicate or alter the list');
}
if (args.includes('--guards-only')) {
  fs.writeFileSync(path.join(artifacts,'guard-report.json'),JSON.stringify({ok:true,guards},null,2));
  console.log(JSON.stringify({ok:true,guards})); process.exit(0);
}
const proof = hasPublishedBatches(root) ? verifyBatchChain({directory:root,verifyAllBaseline:true}) : verifyBatchSuccessor({directory:root,prepared,verifyAllBaseline:true});
let browserModule;
try { browserModule = await import('playwright'); }
catch { assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES); browserModule = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href); }
let server, base = live?.replace(/\/?$/,'/');
if (!base) {
  server = http.createServer((request,response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url,'http://local').pathname), file = path.resolve(root,'.' + pathname);
      assert(file === root || file.startsWith(root + path.sep));
      const resolved = fs.statSync(file).isDirectory() ? path.join(file,'index.html') : file;
      response.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.pdf':'application/pdf'})[path.extname(resolved)] || 'application/octet-stream');
      fs.createReadStream(resolved).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); base = 'http://127.0.0.1:' + server.address().port + '/library/';
}
const report = {ok:false,release:pack.release,publiclyVerified:!!live,guards,proof:proof.proof,viewports:[],errors:[]};
const browser = await browserModule.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE ? {executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE} : {})});
try {
  for (const width of [1280,390]) {
    const context = await browser.newContext({viewport:{width,height:width === 390 ? 844 : 960},serviceWorkers:'block'});
    await context.addInitScript(() => { localStorage.setItem('rtl.lang',JSON.stringify('bi')); localStorage.setItem('rtl.layout',JSON.stringify('inter')); window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} }; });
    await context.route(url => url.origin !== new URL(base).origin,route => route.fulfill({status:200,contentType:'application/json',body:'[]'}));
    const page = await context.newPage(); page.on('pageerror',error => report.errors.push({width,error:error.message}));
    let preserved = 0, opened = 0, originalLinks = 0, internalSourcesOpened = 0, exactSourceExcerptsOpened = 0, exactExternalUrlsOpened = 0;
    for (const file of pack.chapters) {
      const ref = sectionOf(file.path), hash = encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
      await page.goto(base + '#/read/' + hash,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(ref => [...document.querySelectorAll('.sec')].some(section => section.dataset.ref === ref && section.dataset.connectionFootnotesMounted === 'true'),ref,{timeout:60000});
      const section = page.locator('.sec[data-ref="' + ref + '"]');
      const expectedPairs = file.before.filter(row => row.p).flatMap(row => row.p.map(pair => pair.map(plain)));
      for (const [side,index] of [['he',0],['en',1]]) {
        const actual = await section.locator('.seg-il .ph-' + side).evaluateAll(elements => elements.map(element => { const copy = element.cloneNode(true); copy.querySelectorAll('button.footnote-marker,.reader-footnote').forEach(n => n.remove()); return copy.textContent.trim(); }));
        assert.deepEqual(actual,expectedPairs.map(pair => pair[index]),'Displayed author text changed: ' + ref + ' ' + side);
      }
      for (const {note} of notesOf(file.before)) {
        const selector = '[data-note-key="' + note.placementId + '"]';
        assert.equal(await section.locator('.seg-il .ph-he button' + selector).count(),1,'Existing marker missing');
        assert.deepEqual(await section.locator('.seg-il .reader-footnote' + selector + ' .annotation-text').allTextContents(),note.paragraphs.map(p => p.text),'Existing note changed'); preserved++;
      }
      for (const item of additions.filter(item => item.sectionRef === ref)) {
        const note = item.note, selector = '[data-note-key="' + note.placementId + '"]';
        const marker = section.locator('.seg-il .ph-he button' + selector), box = section.locator('.seg-il .reader-footnote' + selector);
        assert.equal(await marker.count(),1,'New Hebrew marker missing or duplicated'); assert.equal(await box.count(),1);
        assert.equal(await section.locator('.seg-il .ph-en button' + selector).count(),0,'New note appears on English');
        assert.equal(Number(await marker.getAttribute('data-fn')),note.number,'New footnote number changed');
        const anchor = await marker.evaluate(element => {
          const seg = element.closest('.seg'), phrase = element.closest('.ph'), range = document.createRange();
          range.selectNodeContents(element.closest('.ph-he')); range.setEndBefore(element); const prefix = range.cloneContents(); prefix.querySelectorAll('button.footnote-marker').forEach(n => n.remove());
          return {ref:seg.dataset.ref,phraseIndex:[...seg.querySelectorAll('.seg-il .ph')].indexOf(phrase),prefix:prefix.textContent};
        });
        assert.equal(anchor.ref,item.originRef); assert.equal(anchor.phraseIndex,note.phraseIndex); assert.equal(anchor.prefix,note.heAnchorPrefix,'New note is beside the wrong Hebrew words');
        assert.deepEqual(await box.locator('.annotation-text').allTextContents(),note.paragraphs.map(p => p.text),'Complete new quotation differs');
        for (const source of note.sources) if (source.url) {
          const hrefs = await box.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')));
          assert(hrefs.includes(source.url),'Missing original-source link ' + note.placementId + ': ' + source.url + '; found ' + JSON.stringify(hrefs));
        }
        await marker.click(); assert(await box.isVisible()); assert.equal(await marker.getAttribute('aria-expanded'),'true'); assert(await box.evaluate(element => element.scrollWidth <= element.clientWidth + 2),'New footnote clipped');
        for (const source of note.sources) if (source.url) {
          const link = box.locator('a').filter({hasText:source.ref}).first(); originalLinks++;
          if (source.openExternal) {
            assert.equal(await link.getAttribute('data-source-external'),'true','Original-source link was incorrectly intercepted');
            if (pack.verifiedExternalUrls?.some(item => item.url === source.url)) {
              const [external] = await Promise.all([page.waitForEvent('popup'),link.click()]);
              await external.waitForLoadState('domcontentloaded');
              assert.equal(new URL(external.url()).href,new URL(source.url).href,'External source opened a different original destination');
              await external.close(); exactExternalUrlsOpened++;
            }
            continue;
          }
          if (!source.url.startsWith('#/read/')) continue;
          const target = source.readerRef || source.ref;
          if (source.readerRef) assert.equal(await link.getAttribute('data-reader-ref'),source.readerRef,'Wrong canonical source mapping');
          await link.click();
          const panel = page.locator('#panel .source-head[data-source-ref="' + target + '"]');
          await panel.locator('.quote .qh').first().waitFor({state:'visible',timeout:60000});
          assert.equal(await page.locator('#panel .panel-head .ttl').textContent(),target,'Opened a different original source');
          const he = (await panel.locator('.quote .qh').allTextContents()).join(' ').replace(/[^א-ת]/g,'');
          const evidence = note.reviewedSourceExcerpt?.he?.replace(/[^א-ת]/g,'').slice(0,28);
          assert(evidence && he.includes(evidence),'Original-source navigation did not show the checked Hebrew passage: ' + target);
          const primaryEnglish = (await panel.locator('.quote .qe').allTextContents()).join(' ').trim();
          const fallbackEnglish = await panel.locator('.footnote-source-excerpt .qe').allTextContents();
          if (fallbackEnglish.length || !primaryEnglish) {
            const excerpt = note.reviewedSourceExcerpts?.find(item => item.ref === source.ref);
            assert(excerpt && excerpt.scope === 'selected-source-excerpt','Missing reviewed source-excerpt metadata: ' + note.placementId);
            assert.deepEqual(fallbackEnglish,[excerpt.en],'Source panel must display the exact approved English quotation: ' + note.placementId);
            assert.equal(excerpt.en,note.reviewedSourceExcerpt.en,'Source panel quotation differs from the checked source translation');
            const exactHebrew = note.reviewedSourceExcerpt.he.replace(/[^א-ת]/g,'');
            assert(exactHebrew && he.includes(exactHebrew),'Source panel must display the complete checked Hebrew excerpt: ' + target);
            exactSourceExcerptsOpened++;
          } else assert(primaryEnglish,'Original-source panel lacks English: ' + target + ' / ' + note.placementId);
          internalSourcesOpened++; await page.locator('#pClose').click();
        }

        if (opened === 0 || item === additions.filter(value => value.sectionRef === ref).at(-1)) await page.screenshot({path:path.join(artifacts,(live?'live':'local') + '-ois' + ref.split(' ').at(-1) + '-' + width + '.png'),fullPage:false});
        await marker.click(); opened++;
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),false,'Reader overflows horizontally');
    }
    assert.equal(opened,additions.length); report.viewports.push({width,reviewedSections:pack.reviewedSections.length,newNotesOpened:opened,exactHebrewAnchors:opened,existingNotesPreserved:preserved,originalSourceLinks:originalLinks,internalSourcesOpened,exactSourceExcerptsOpened,exactExternalUrlsOpened}); await context.close();
  }
  assert.deepEqual(report.errors,[]); report.ok = true;
} catch (error) { report.failure = error.message; throw error; }
finally { fs.writeFileSync(path.join(artifacts,(live?'live':'local') + '-report.json'),JSON.stringify(report,null,2)); await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
console.log(JSON.stringify(report));

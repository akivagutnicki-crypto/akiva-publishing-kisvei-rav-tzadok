// Verify the additive review and every new Hebrew marker on desktop/mobile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {loadPack,validatePack,verifyBatchSuccessor,verifyBatchChain,hasPublishedBatches,registeredPacks,batchNames,DEFAULT_PACK,notesOf,sectionOf,plain} from './publish-tzidkat-batch-review.mjs';

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

function rejected(name, mutate, pattern) {
  const copy = structuredClone(pack); mutate(copy);
  assert.throws(() => validatePack(copy),pattern,name + ' must be rejected');
  return {name,rejected:true};
}
const firstAdded = additions[0];
const findNew = copy => notesOf(copy.chapters.find(file => sectionOf(file.path) === firstAdded.sectionRef).after).find(item => item.note.placementId === firstAdded.note.placementId);
const guards = [
  rejected('changed existing quotation', copy => { const file = copy.chapters.find(f => notesOf(f.before).length); notesOf(file.after).find(item => item.note.placementId === notesOf(file.before)[0].note.placementId).note.paragraphs[0].text += ' changed'; }, /Existing note/),
  rejected('removed existing note', copy => { const file = copy.chapters.find(f => notesOf(f.before).length), item = notesOf(file.after).find(item => item.note.placementId === notesOf(file.before)[0].note.placementId); item.row.footnotes = item.row.footnotes.filter(n => n.placementId !== item.note.placementId); }, /Existing note/),
  rejected('changed author text', copy => { copy.chapters[0].after.find(row => row.p).p[0][0] += 'x'; }, /Existing note/),
  rejected('incorrect Hebrew anchor', copy => { findNew(copy).note.heAnchorPrefix = 'incorrect'; }, /inexact Hebrew anchor/),
  rejected('colliding note number', copy => { findNew(copy).note.number = notesOf(copy.chapters.find(f => notesOf(f.before).length).before)[0].note.number; }, /existing identity/),
  rejected('incorrect predecessor', copy => { copy.chapters[0].beforeSha256 = '0'.repeat(64); }, /preimage hash/),
  rejected('unrequested section', copy => { copy.linksBefore['Tzidkat HaTzadik ' + (copy.reviewedSections[0] === 1 ? 264 : 1)] = []; }, /exactly the reviewed batch/),
  rejected('secondary-edition attribution', copy => { const p = findNew(copy).note.paragraphs[0]; p.text += ' Biur Meshulav'; if (p.rich) p.rich.push({text:' Biur Meshulav'}); }, /Secondary commentary/),
];
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
    let preserved = 0, opened = 0, originalLinks = 0, internalSourcesOpened = 0, exactSourceExcerptsOpened = 0;
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
          if (source.openExternal) { assert.equal(await link.getAttribute('data-source-external'),'true','Original-source link was incorrectly intercepted'); continue; }
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
    assert.equal(opened,additions.length); report.viewports.push({width,reviewedSections:pack.reviewedSections.length,newNotesOpened:opened,exactHebrewAnchors:opened,existingNotesPreserved:preserved,originalSourceLinks:originalLinks,internalSourcesOpened,exactSourceExcerptsOpened}); await context.close();
  }
  assert.deepEqual(report.errors,[]); report.ok = true;
} catch (error) { report.failure = error.message; throw error; }
finally { fs.writeFileSync(path.join(artifacts,(live?'live':'local') + '-report.json'),JSON.stringify(report,null,2)); await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
console.log(JSON.stringify(report));

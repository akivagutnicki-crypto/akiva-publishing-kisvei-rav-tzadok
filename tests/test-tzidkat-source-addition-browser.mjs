// Focused CI regression for the independently reviewed Tosafot addition in ois 6.
// Run in the authorized publication CI; this file does not publish or modify data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const root = path.resolve(option('--root', 'dist'));
const live = option('--url', null);
const packPath = path.resolve(option('--pack', 'sources/akiva/addenda/tzidkat-source-addition-006-20261025.json.gz'));
const artifacts = path.resolve(option('--artifacts', 'artifacts/tzidkat-source-addition-006'));
fs.mkdirSync(artifacts, {recursive:true});
const sha = value => createHash('sha256').update(value).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',thinsp:' ',ensp:' ',emsp:' ',lrm:'',rlm:''};
const decode = text => String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => entity[0] === '#'
  ? String.fromCodePoint(parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10))
  : entities[entity.toLowerCase()] ?? match);
const plain = text => decode(String(text ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
  .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
const noteProjection = note => [String(note.number), note.paragraphs.map(p => plain(p.text))
  .concat(note.sources.filter(s => s.readerRef || s.openExternal).map(s => s.readerRef
    ? 'Reader location: ' + s.readerRef + '; original source citation: ' + s.ref + ' — ' + s.url
    : 'Original source: ' + s.url)).join('\n'), note.phraseIndex, 'h', note.heCharOffset];

const raw = fs.readFileSync(packPath), pin = fs.readFileSync(packPath + '.sha256', 'utf8').trim();
assert.match(pin, /^[a-f0-9]{64}$/); assert.equal(sha(raw), pin, 'Immutable one-note pack changed');
const pack = JSON.parse(gunzipSync(raw));
assert.equal(pack.schemaVersion, 1);
assert.equal(pack.chapters.length, 1); assert.equal(pack.additions.length, 1);
const file = pack.chapters[0], addition = pack.additions[0], note = addition.note;
const SECTION = 'Tzidkat HaTzadik 6', ORIGIN = SECTION + ':1';
const SOURCE = 'Tosafot on Berakhot 14b:16:1';
const SOURCE_URL = 'https://www.sefaria.org/Tosafot_on_Berakhot.14b.16.1';
assert.equal(file.path, 'library/data/tzidkat-hatzadik/5.json');
assert.equal(addition.sectionRef, SECTION); assert.equal(addition.originRef, ORIGIN); assert.equal(addition.row, 1);
assert.equal(note.number, 4031); assert.equal(note.phraseIndex, 8); assert.equal(note.heCharOffset, 91);
assert.equal(note.sources.length, 1); assert.equal(note.sources[0].ref, SOURCE); assert.equal(note.sources[0].url, SOURCE_URL);
const oldNotes = file.before.flatMap(row => (row.footnotes || []).map(note => ({row:row.n,note})));
const row = file.after.find(row => row.n === 1 && row.p);
assert.equal(plain(row.p[8][0]).slice(0, note.heCharOffset), note.heAnchorPrefix, 'Pack has an inexact Hebrew anchor');
const withoutNew = structuredClone(file.after);
for (const item of withoutNew) if (item.footnotes) item.footnotes = item.footnotes.filter(n => n.placementId !== note.placementId);
assert.deepEqual(withoutNew, file.before, 'The one-note addition changed previous body or notes');
assert.equal(file.after.flatMap(row => row.footnotes || []).filter(n => n.number === 4031).length, 1);
assert.deepEqual(read(file.path), file.after, 'Candidate ois 6 differs from approved output');
assert.equal(note.paragraphs.length, 1);
assert.equal(note.paragraphs[0].text, note.paragraphs[0].rich.map(run => run.text || '').join(''));
assert.equal(note.paragraphs[0].text, SOURCE + ': “' + note.reviewedSourceExcerpt.en + '”');
assert(!/[“”]/.test(note.reviewedSourceExcerpt.en), 'Nested English quotation marks should be single');

// Deterministic MCP/citation/archive checks run before any browser is launched.
const mcp = read('mcp-data/text/tzidkat-hatzadik.json');
const para = mcp.paras.find(p => p.r === ORIGIN); assert(para);
for (const item of [...oldNotes, {row:1,note}]) {
  const target = mcp.paras.find(p => p.r === SECTION + ':' + item.row); assert(target);
  assert.deepEqual((target.f || []).filter(value => String(value[0]) === String(item.note.number)), [noteProjection(item.note)],
    'MCP note is missing, duplicated, or changed: ' + item.note.number);
}
assert(para.a?.[SOURCE], 'MCP source anchor missing');
assert((para.c || []).some(edge => edge[0] === SOURCE), 'MCP source citation missing');
assert(read('mcp-data/cited.json')[SOURCE]?.includes(ORIGIN), 'MCP reverse citation missing');
assert(read('library/data/cited/tosafot-on-berakhot.json')[SOURCE]?.includes(ORIGIN), 'Reader reverse citation missing');
assert(read('library/data/tzidkat-hatzadik/links.json')[SECTION].some(edge => edge.a === ORIGIN && edge.r === SOURCE),
  'Reader source link missing');
const require = createRequire(import.meta.url);
const {unzipSync} = require(path.join(root, 'library/vendor/fflate.min.js'));
const archiveChecks = [];
for (const archive of ['library/downloads/books/tzidkat-hatzadik.zip', 'library/downloads/rav-tzadok-library.zip']) {
  const member = file.path.slice('library/'.length);
  const entries = unzipSync(fs.readFileSync(path.join(root, archive)), {filter:item => item.name === member});
  assert(entries[member], 'ZIP lacks ois 6: ' + archive);
  assert.deepEqual(JSON.parse(Buffer.from(entries[member]).toString()), file.after, 'ZIP lost or changed the approved note: ' + archive);
  archiveChecks.push({archive,member,newNoteNumber:4031,approvedChapterExact:true});
}

const report = {ok:false,release:pack.release,packSha256:pin,publiclyVerified:Boolean(live),
  deterministic:{approvedChapterExact:true,oldNativeNotesPreserved:oldNotes.length,mcpNewAndOldNotesVerified:oldNotes.length+1,
    canonicalSource:SOURCE,canonicalUrl:SOURCE_URL,archives:archiveChecks},viewports:[],errors:[],
  scope:'No implicit external Sefaria text fetch is required. The exact primary HTTP source was independently checked before freezing the pack.'};
if (args.includes('--data-only')) {
  report.ok = true; fs.writeFileSync(path.join(artifacts, 'data-report.json'), JSON.stringify(report,null,2) + '\n');
  console.log(JSON.stringify(report)); process.exit(0);
}

// Derive note 2202 from the current published pure functions; do not substitute
// a summary for its full pre-existing displayed quotation. This requires the
// full reader artifact, whereas --data-only also supports the sealed mini-tree.
const modules = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'library/source-connections.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'library/connected-ideas.js'), 'utf8'), modules);
const ideas = modules.AkivaConnectedIdeas;
const records = ideas.forSection(read('library/connected-ideas/catalog.json').records, SECTION);
const rows = file.after.filter(row => row.p);
const data = {sectionRef:SECTION,nums:rows.map(row => row.n),he:rows.map(row => row.p.map(pair => pair[0]).join(' ')),
  en:rows.map(row => row.p.map(pair => pair[1]).join(' ')),annotations:Object.fromEntries(rows.map((row,i) => [i,row.footnotes || []]))};
const connectedValue = ideas.footnotesForSection(data, records).find(note => note.number === 2202);
assert(connectedValue, 'Existing connected note 2202 missing');
const connected = JSON.parse(JSON.stringify(connectedValue));
assert.equal(connected.phraseIndex, 8); assert.equal(connected.sources[0].ref, 'Tiferet Yosef, Nitzavim 10');

let browserModule;
try { browserModule = await import('playwright'); }
catch { assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES); browserModule = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href); }
let server, browser, base = live?.replace(/\/?$/, '/');
if (!base) {
  server = http.createServer((request,response) => {
    try {
      const name = decodeURIComponent(new URL(request.url,'http://local').pathname);
      const target = path.resolve(root, '.' + name); assert(target === root || target.startsWith(root + path.sep));
      const file = fs.statSync(target).isDirectory() ? path.join(target,'index.html') : target;
      response.setHeader('Content-Type', ({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
        '.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/library/';
}
try {
  browser = await browserModule.chromium.launch({headless:true,
    ...(process.env.AKIVA_CHROMIUM_EXECUTABLE ? {executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE} : {})});
  for (const width of [1280,390]) {
    const context = await browser.newContext({viewport:{width,height:width === 390 ? 844 : 960},
      hasTouch:width === 390,serviceWorkers:'block'});
    await context.addInitScript(() => {
      localStorage.setItem('rtl.lang',JSON.stringify('bi'));
      localStorage.setItem('rtl.layout',JSON.stringify('inter'));
      window.IntersectionObserver = class {observe(){} unobserve(){} disconnect(){}};
    });
    // External content availability is outside this UI regression. The real
    // source link remains intact, and an ordinary click must resolve its exact
    // canonical reader-panel target even when external API text is unavailable.
    await context.route(url => url.origin !== new URL(base).origin,
      route => route.fulfill({status:200,contentType:'application/json',body:'[]'}));
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({width,error:error.message}));
    await page.goto(base + '#/read/Tzidkat_HaTzadik_6', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(ref => [...document.querySelectorAll('.sec')].some(section => section.dataset.ref === ref
      && section.dataset.connectionFootnotesMounted === 'true'), SECTION, {timeout:60000});
    const section = page.locator('.sec[data-ref="' + SECTION + '"]');
    assert.equal(await section.getAttribute('data-connected-ideas-status'),'checked');
    const segment = section.locator('.seg[data-ref="' + ORIGIN + '"]');
    const expectedPairs = file.before.filter(row => row.p).flatMap(row => row.p.map(pair => pair.map(plain)));
    for (const [language,index] of [['he',0],['en',1]]) {
      const actual = await section.locator('.seg-il .ph-' + language).evaluateAll(elements => elements.map(element => {
        const copy = element.cloneNode(true); copy.querySelectorAll('.footnote-marker,.reader-footnote').forEach(node => node.remove());
        return copy.textContent.trim();
      }));
      assert.deepEqual(actual, expectedPairs.map(pair => pair[index]), 'Author text changed in ' + language);
    }
    for (const {note:prior} of oldNotes) {
      const key = '[data-note-key="' + prior.placementId + '"]';
      assert.equal(await section.locator('.seg-il .ph-he button' + key).count(),1,'Old marker missing/duplicated: '+prior.number);
      assert.deepEqual(await section.locator('.seg-il .reader-footnote' + key + ' .annotation-text').allTextContents(),
        prior.paragraphs.map(p => p.text),'Old complete note changed: '+prior.number);
    }
    for (const value of [note,connected]) {
      const key = '[data-note-key="' + value.placementId + '"]';
      assert.equal(await segment.locator('.seg-il .ph-he button' + key).count(),1);
      assert.equal(await segment.locator('.seg-he button' + key).count(),1);
      assert.equal(await segment.locator('.seg-il .ph-en button' + key).count(),0);
      assert.equal(await segment.locator('.seg-il .reader-footnote' + key).count(),1);
      assert.equal(await segment.locator('.segment-annotations > .reader-footnote' + key).count(),1);
      const marker = segment.locator('.seg-il .ph-he button' + key);
      const anchor = await marker.evaluate(element => {
        const segment = element.closest('.seg'),phrase = element.closest('.ph');
        const range = document.createRange();range.selectNodeContents(element.closest('.ph-he'));range.setEndBefore(element);
        const prefix = range.cloneContents();prefix.querySelectorAll('.footnote-marker,.reader-footnote').forEach(node => node.remove());
        return {originRef:segment.dataset.ref,phraseIndex:[...segment.querySelectorAll('.seg-il .ph')].indexOf(phrase),prefix:prefix.textContent};
      });
      assert.equal(anchor.originRef,ORIGIN);assert.equal(anchor.phraseIndex,8);
      assert.equal(anchor.prefix,note.heAnchorPrefix);assert.equal(anchor.prefix.length,91);
    }
    assert.deepEqual(await segment.locator('.seg-il .ph').nth(8).locator('.ph-he .footnote-marker')
      .evaluateAll(markers=>markers.map(marker=>Number(marker.dataset.fn))),[4031,2202],
      'At the shared interlinear anchor, the new native note must precede the existing connected note');
    const flatPrefix = await segment.locator('.seg-he button[data-note-key="'+note.placementId+'"]')
      .evaluate(element=>{
        const range=document.createRange();range.selectNodeContents(element.closest('.seg-he'));range.setEndBefore(element);
        const prefix=range.cloneContents();prefix.querySelectorAll('.footnote-marker,.reader-footnote').forEach(node=>node.remove());
        return prefix.textContent;
      });
    assert.equal(flatPrefix,row.p.slice(0,8).map(pair=>plain(pair[0])).join(' ')+' '+note.heAnchorPrefix,
      'Hebrew-only native marker moved away from the exact approved phrase boundary');
    const modes = [];
    for (const mode of ['bi','he']) {
      if (mode === 'he') {
        await page.locator('#setBtn').click();
        await page.locator('#settings .seg-ctl[data-pref="lang"] button[data-v="he"]').click();
        await page.locator('#setBtn').click();
        assert.equal(await page.locator('#text').getAttribute('data-lang'),'he');
      }
      const checks = [];
      const protect = oldNotes.find(item => item.note.number === 20);assert(protect);
      for (const value of [note,connected,protect.note]) {
        const key = '[data-note-key="' + value.placementId + '"]';
        const marker = segment.locator((mode === 'bi' ? '.seg-il .ph-he button' : '.seg-he button') + key);
        const box = segment.locator((mode === 'bi' ? '.seg-il .reader-footnote' : '.segment-annotations > .reader-footnote') + key);
        assert.equal(await marker.count(),1);assert.equal(await box.count(),1);
        await marker.click();await box.waitFor({state:'visible'});
        assert.equal(await marker.getAttribute('aria-expanded'),'true','Marker did not open '+value.number);
        assert.deepEqual(await box.locator('.annotation-text').allTextContents(),value.paragraphs.map(p=>p.text));
        assert(await box.evaluate(element=>element.scrollWidth <= element.clientWidth+2),'Footnote clips horizontally');
        if (value.number === 4031 || value.number === 2202) {
          const source=value.sources[0];
          const link=box.locator('a').filter({hasText:source.ref}).first();
          assert.equal(await link.getAttribute('href'),source.url,'Exact source hyperlink changed');
          assert.equal(await link.getAttribute('data-source-external'),null);
          if (value.number === 4031) {
            await marker.scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(artifacts,(live?'live':'candidate')+'-ois6-'+width+'-'+mode+'.png'),fullPage:false});
          }
          await link.click();
          await page.locator('#panel .panel-head .ttl').waitFor({state:'visible'});
          assert.equal(await page.locator('#panel .panel-head .ttl').textContent(),source.ref,'Source click resolved to another target');
          await page.locator('#pClose').click();
        }
        await marker.click();await box.waitFor({state:'hidden'});
        assert.equal(await marker.getAttribute('aria-expanded'),'false','Marker did not close '+value.number);
        checks.push({number:value.number,completeParagraphs:value.paragraphs.length,openedAndClosed:true,
          ...(value.number!==20?{exactLinkAndClickTarget:value.sources[0].ref}:{existingNativeProtected:true})});
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Reader overflows horizontally');
      for(const value of [note,connected]) {
        const key='[data-note-key="'+value.placementId+'"]';
        assert.equal(await segment.locator('.seg-il .ph-he button'+key).count(),1,'Marker duplicated after mode change');
        assert.equal(await segment.locator('.seg-he button'+key).count(),1,'Flat marker duplicated after mode change');
      }
      modes.push({mode,checks,noHorizontalClipping:true,noDuplicatedMarkers:true});
    }
    report.viewports.push({width,authorPhrasePairsPreserved:expectedPairs.length,
      oldNativeNotesPreserved:oldNotes.length,newNoteAnchor:{row:1,phraseIndex:8,heCharOffset:91},
      connected2202Preserved:true,modes});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.ok=true;
} catch(error) { report.failure=error.message;throw error; }
finally {
  fs.writeFileSync(path.join(artifacts,(live?'live':'candidate')+'-browser-report.json'),JSON.stringify(report,null,2)+'\n');
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(report));

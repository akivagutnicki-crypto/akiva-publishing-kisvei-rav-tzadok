// Publication checks for the revised Dover Tzedek footnotes, anchors and links.
// node scripts/test-dover-revisions.mjs [--data-only] [--url https://…/library/] [--zips]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {checkDoverSourceLinks} from './check-dover-source-links.mjs';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
assert.ok(urlIndex < 0 || args[urlIndex + 1], '--url requires a library URL');
const publicBase = urlIndex < 0 ? null : new URL(args[urlIndex + 1]);
if (publicBase && !publicBase.pathname.endsWith('/')) publicBase.pathname += '/';
if (publicBase) publicBase.hash = '';
const release = '20261018-dover-revisions-v1';
const root = path.resolve('dist/library');
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const entity = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
const visible = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, key) => {
  if (key[0] === '#') return String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : +key.slice(1));
  return entity[key] ?? all;
});
const norm = value => visible(value).normalize('NFC').replace(/\s+/g, ' ').trim();
const bareHebrew = value => visible(value).replace(/[^\u05d0-\u05ea]/g, '');
const read = async file => {
  if (!publicBase) return fs.readFileSync(path.join(root, file));
  const url = new URL(file, publicBase); url.searchParams.set('dover-revision-check', String(Date.now()));
  const response = await fetch(url, {cache:'no-store'});
  assert.ok(response.ok, `${file}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const json = async file => JSON.parse((await read(file)).toString('utf8'));
const report = await json('dover-revisions-report.json');
assert.equal(report.release, release, 'Unexpected Dover revisions release');
assert.equal(report.notes, 2698);
assert.equal(report.counts.contentSections, 15);
assert.equal(report.counts.addedHebrewLinks, 944);
assert.equal(report.counts.removedHebrewLinks, 0);
assert.equal(report.counts.bodyChanges, 0);
assert.equal(report.counts.originalParagraphsPreserved, true);
assert.equal(report.counts.originalExtraParagraphsPreserved, 90);
assert.equal(report.expectedNotes.length, 2698);
assert.equal(report.sections.length, 16);
const baseline = JSON.parse(fs.readFileSync('sources/akiva/footnotes/Dover_Tzedek_Source_Expansion.json','utf8'));
const original = new Map(baseline.notes.map(note => [note.number,note]));
const expected = new Map(report.expectedNotes.map(note => [note.number,note]));
assert.equal(expected.size, 2698, 'Duplicate expected stable footnote number');
assert.equal(new Set(report.expectedNotes.map(note=>note.uploadNumber)).size,2698,'Incoming footnote mapping is not one to one');
assert.equal(baseline.notes.reduce((count,note)=>count+note.paragraphs.length-1,0), 90, 'Original supplementary quotation baseline changed');
const toc = await json('data/dover-tzedek/toc.json');
assert.equal(toc.revisedFootnotes.release, release);
assert.equal(toc.revisedFootnotes.notes, 2698);
assert.equal(toc.revisedFootnotes.report, 'dover-revisions-report.json');
const sections = new Map();
const seen = new Set();
const rejected = /Context and connection to Dover Tzedek:|Connection to this note:|Extended English quotation from Akiva interlinear:/i;
let supplementary = 0, linksAdded = 0, quoteParagraphs = 0;
for (const entry of report.sections) {
  assert.ok(/^\d+(?:-\d+)?\.json$/.test(entry.file), 'Invalid Dover chapter path');
  const rows = await json('data/dover-tzedek/' + entry.file);
  sections.set(entry.file, {entry,rows});
  for (const [language,key] of [[0,'heSha256'],[1,'enSha256']]) {
    const normalized = entry.file === '0.json' ? rows.map(norm) : rows.filter(row=>row.p).map(row=>[row.n,row.p.map(pair=>norm(pair[language]))]);
    assert.equal(hash(normalized), entry[key], `Body text changed: ${entry.file}, language ${language}`);
  }
  const anchors = language => rows.filter(row=>row.p).flatMap(row=>row.p.map(pair=>pair[language])).reduce((count,text)=>count+(String(text).match(/data-ref=["']/gi)||[]).length,0);
  assert.equal(anchors(0),entry.heLinks, 'Hebrew link count '+entry.file);
  assert.equal(anchors(1),entry.enLinks, 'English link count '+entry.file);
  assert.equal(entry.heLinks-entry.baselineHeLinks,entry.addedHebrewLinks,'Added Hebrew link count '+entry.file);
  assert.equal(entry.enLinks,entry.baselineEnLinks,'English source links changed '+entry.file);
  linksAdded += entry.addedHebrewLinks;
  for (const item of rows) for (const note of item.footnotes || []) {
    const label = `${entry.file}, footnote ${note.number}`;
    assert.ok(!seen.has(note.number), 'Duplicate '+label); seen.add(note.number);
    const source = expected.get(note.number), old = original.get(note.number);
    assert.ok(source && old, 'Unknown stable number '+label);
    assert.equal(source.file, entry.file, 'Wrong chapter '+label);
    assert.equal(source.paragraph, item.n, 'Wrong reader paragraph '+label);
    for (const key of ['phraseIndex','heWord','heCharOffset','heAnchorPrefix','sourceId','placementId'])
      assert.equal(note[key],source[key],`Changed ${key}: ${label}`);
    assert.equal(note.sourceId, 'DT-'+String(note.number).padStart(4,'0'), 'Changed stable source ID '+label);
    assert.equal(note.placementId,note.sourceId+'-1', 'Changed stable placement ID '+label);
    assert.deepEqual(note.paragraphs,source.paragraphs, 'Incomplete published quotation '+label);
    assert.equal(source.originalParagraphCount,old.paragraphs.length, 'Original paragraph count '+label);
    assert.equal(hash(old.paragraphs),source.originalParagraphsSha256,'Original quotation checksum '+label);
    assert.deepEqual(note.paragraphs.slice(0,old.paragraphs.length),old.paragraphs,'Lost original quotation '+label);
    supplementary += old.paragraphs.length-1;
    const phrase = item.p?.[note.phraseIndex]?.[0];
    assert.ok(typeof phrase === 'string', 'Missing Hebrew phrase '+label);
    const text = visible(phrase), words = text.split(/\s+/).filter(Boolean);
    assert.ok(note.heWord >= 1 && note.heWord <= words.length,'No Hebrew word '+label);
    if (old.heWordText) assert.equal(bareHebrew(words[note.heWord-1]),old.heWordText,'Moved Hebrew word '+label);
    if (Number.isInteger(note.heCharOffset)) {
      assert.ok(note.heCharOffset > 0 && note.heCharOffset <= text.length,'Invalid Hebrew character position '+label);
      assert.equal(text.slice(0,note.heCharOffset),note.heAnchorPrefix,'Changed Hebrew prefix '+label);
    }
    for (const paragraph of note.paragraphs) {
      assert.ok(paragraph.text?.trim(), 'Empty quotation '+label);
      assert.ok(!rejected.test(paragraph.text) && !/^Sources:\s/.test(paragraph.text), 'Editorial boilerplate '+label);
      if (paragraph.rich?.length) assert.equal(paragraph.rich.map(run=>run.text||'').join(''),paragraph.text,'Rich text differs from full quotation '+label);
      quoteParagraphs++;
    }
  }
}
assert.equal(seen.size,2698,'Some Dover footnotes are missing');
assert.equal(supplementary,90,'Lost existing supplementary quotations');
assert.equal(linksAdded,944,'Missing added Hebrew hyperlinks');
console.log(`PASS Dover revised data${publicBase?' publicly verified':''}: 2,698 complete notes; 90 supplementary original paragraphs preserved; 944 Hebrew links; both languages unchanged (${quoteParagraphs} quotation paragraphs).`);
if(!publicBase) await checkDoverSourceLinks();

if (args.includes('--zips')) {
  const {unzipSync} = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
  const downloads = await json('downloads/index.json');
  const entry = downloads.books.find(book=>book.slug==='dover-tzedek');
  assert.ok(entry,'Dover ZIP missing from download manifest');
  const bytes = await read(entry.file);
  assert.equal(bytes.length,entry.bytes,'Dover ZIP byte count');
  const contents = unzipSync(bytes);
  for (const {entry:section,rows} of sections.values()) {
    const file = 'data/dover-tzedek/'+section.file;
    assert.ok(contents[file],'Dover ZIP lacks '+file);
    assert.deepEqual(JSON.parse(Buffer.from(contents[file]).toString()),rows,'Dover ZIP has stale '+file);
  }
  assert.deepEqual(JSON.parse(Buffer.from(contents['data/dover-tzedek/toc.json']).toString()),toc,'Dover ZIP has stale contents');
  const sourceLinks=await json('data/dover-tzedek/links.json');
  assert.deepEqual(JSON.parse(Buffer.from(contents['data/dover-tzedek/links.json']).toString()),sourceLinks,'Dover ZIP has stale source connections');
  console.log('PASS downloadable Dover ZIP contains the current full quotations, anchors and Hebrew hyperlinks.');
}
if (args.includes('--data-only')) process.exit(0);

let playwright;
try { playwright = await import('playwright'); }
catch (error) {
  const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  if (!modules) throw error;
  playwright = await import(pathToFileURL(path.join(modules,'playwright/index.mjs')).href);
}
let server,base = publicBase?.href;
if (!base) {
  server = http.createServer((req,res)=>{
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file = path.resolve(root,'./'+pathname.replace(/^\/library\//,''));
    if (file !== root && !file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
      res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'})[path.extname(file)]||'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}/library/`;
}
const chapterHash = ref => '#/read/'+encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const targets = [];
const walk = node => {
  if (node.children) node.children.forEach(walk);
  else if (node.ref && node.id !== 0) {
    const ref = node.ref+' 1';
    const target = [...sections.values()].find(section=>section.entry.ref===ref);
    assert.ok(target,'TOC chapter missing from revision report '+ref);
    targets.push(target);
  }
};
walk(toc.toc);
assert.equal(targets.length,5,'Expected the five Dover content nodes');
const tocTargets=[...targets];
const largest=[...sections.values()].filter(section=>section.entry.file!=='0.json').sort((a,b)=>
  b.rows.reduce((n,row)=>n+(row.footnotes?.length||0),0)-a.rows.reduce((n,row)=>n+(row.footnotes?.length||0),0)).slice(0,2);
for(const section of largest) if(!targets.some(target=>target.entry.file===section.entry.file)) targets.push(section);
const browser = await playwright.chromium.launch({headless:true});
try {
  for (const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    const mobile = viewport.width < 500;
    const context = await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    const page = await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));});
    await page.goto(base+'#/book/Dover_Tzedek');
    await page.locator(`#toc a[href="${chapterHash(tocTargets[0].entry.ref)}"]`).first().waitFor({state:'visible',timeout:45000});
    for(const target of tocTargets)
      assert.ok(await page.locator(`#toc a[href="${chapterHash(target.entry.ref)}"]`).count(),'Missing TOC chapter link '+target.entry.ref);
    for (const target of targets) {
      const ref = target.entry.ref;
      const chapterNotes = target.rows.flatMap(row=>row.footnotes||[]);
      await page.goto(base+chapterHash(ref));
      const section = page.locator('#text > .sec').filter({has:page.locator(`.source-note-trigger[data-note-key="${chapterNotes[0].placementId}"]`)}).first();
      await section.locator('.seg-il .ph-he .source-note-trigger').first().waitFor({state:'visible',timeout:45000});
      assert.equal(await section.locator('.seg-il .ph-he .source-note-trigger').count(),chapterNotes.length,'Hebrew marker count '+ref);
      assert.equal(await section.locator('.seg-il .ph-en .source-note-trigger').count(),0,'English marker duplicate '+ref);
      const markers = await section.evaluate(element=>[...element.querySelectorAll('.seg-il .ph-he')].flatMap(he=>{
        const found=[],walker=document.createTreeWalker(he,NodeFilter.SHOW_TEXT);let node,prefix='';
        while ((node=walker.nextNode())) {
          const marker=node.parentElement?.closest('.source-note-trigger');
          if(marker) found.push({id:marker.dataset.noteKey,number:+marker.textContent,prefix});
          else if(!node.parentElement?.closest('.reader-footnote')) prefix+=node.textContent;
        }
        return found;
      }));
      for (const note of chapterNotes) {
        const marker=markers.find(mark=>mark.id===note.placementId);
        assert.ok(marker,'Missing rendered marker '+note.sourceId);
        assert.equal(marker.number,note.number,'Rendered footnote number');
        assert.equal(marker.prefix,note.heAnchorPrefix,'Rendered Hebrew placement '+note.sourceId);
      }
      const cards=await section.locator('.seg-il .reader-footnote[data-source-note]').evaluateAll(elements=>elements.map(element=>({id:element.dataset.noteKey,paragraphs:[...element.querySelectorAll('.annotation-text')].map(p=>p.textContent)})));
      assert.equal(cards.length,chapterNotes.length,'Missing source card '+ref);
      for(const note of chapterNotes) assert.deepEqual(cards.find(card=>card.id===note.placementId)?.paragraphs,note.paragraphs.map(p=>p.text),'Truncated browser quotation '+note.sourceId);
      const first=chapterNotes.find(note=>note.paragraphs.some(p=>p.rich?.some(run=>run.bold && run.href)));
      assert.ok(first,'No linked source citation '+ref);
      const trigger=section.locator(`.ph-he .source-note-trigger[data-note-key="${first.placementId}"]`);
      const card=section.locator(`.seg-il .reader-footnote[data-note-key="${first.placementId}"]`);
      await trigger.click();
      await card.waitFor({state:'visible'});
      assert.equal(await trigger.getAttribute('aria-expanded'),'true','Footnote did not open');
      const style=await card.evaluate(element=>{
        const strong=element.querySelector('.annotation-text strong');
        const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node,normal=false;
        while((node=walker.nextNode())) if(node.textContent.trim().length>15 && node.parentElement.closest('.annotation-text') && !node.parentElement.closest('strong') && +getComputedStyle(node.parentElement).fontWeight<600)normal=true;
        return {bold:!!strong && +getComputedStyle(strong).fontWeight>=600,normal};
      });
      assert.ok(style.bold && style.normal,'Source must be bold and quotation regular '+ref);
      await trigger.click();
      assert.equal(await trigger.getAttribute('aria-expanded'),'false','Footnote did not close');
      assert.ok(!(await card.isVisible()),'Closed source card still visible');
    }
    // Exercise a real internal parallel link, including navigation back to Dover.
    const parallel=[...expected.values()].find(note=>note.paragraphs.slice(note.originalParagraphCount).some(p=>p.rich?.some(run=>run.href?.startsWith('#/read/'))));
    assert.ok(parallel,'No internal parallel-source link was published');
    const sourceSection=sections.get(parallel.file);
    await page.goto(base+chapterHash(sourceSection.entry.ref));
    const marker=page.locator(`.ph-he .source-note-trigger[data-note-key="${parallel.placementId}"]`).first();
    await marker.waitFor({state:'visible',timeout:45000});await marker.click();
    const card=page.locator(`.reader-footnote[data-note-key="${parallel.placementId}"]`).first();
    const link=card.locator('a[href^="#/read/"]').first();
    const href=await link.getAttribute('href');
    const popupPromise=context.waitForEvent('page',{timeout:3000}).catch(()=>null);
    await link.click();
    const popup=await popupPromise;
    const destination=popup||page;
    await destination.waitForURL(url=>url.hash===href,{timeout:45000});
    const destinationRef=decodeURIComponent(href.slice('#/read/'.length)).replace(/_/g,' ');
    await destination.waitForFunction(ref=>document.querySelector('#rTitle')?.textContent.includes(ref.split(':')[0]),destinationRef,{timeout:45000});
    await destination.locator('#text .sec .seg').first().waitFor({state:'visible',timeout:45000});
    if(popup) await popup.close();
    else {await page.goBack();await marker.waitFor({state:'visible',timeout:45000});}
    assert.deepEqual(errors,[],'Reader JavaScript errors');
    await context.close();
    console.log(`PASS Dover ${mobile?'mobile':'desktop'} browser: five TOC nodes plus the two largest chapters (${targets.length} chapters), exact Hebrew markers, complete expandable quotations, source typography and internal parallel navigation.`);
  }
} finally {
  await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
}

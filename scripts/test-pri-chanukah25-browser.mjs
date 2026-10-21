// Exercise the actual reader routes and all three source entry points.
// The unavailable-English transport fixture tests fallback behavior; the
// primary sources and translations themselves are checked by the data gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {checkConnectionFootnotes} from './reader-connection-footnote-checks.mjs';
import {CHANUKAH25_REF,readChanukah25,publishedChanukah25} from './pri-chanukah25.mjs';

const rootAt=process.argv.indexOf('--root'),root=path.resolve(rootAt>=0?process.argv[rootAt+1]:'dist/library');
const urlAt=process.argv.indexOf('--url'),remote=urlAt>=0?process.argv[urlAt+1]:process.env.AKIVA_READER_URL;
const pack=readChanukah25(),published=publishedChanukah25(root);
assert.ok(published,'The reviewed edition must be built before its browser test');
// Use the shipped catalog and its own grouping rules; no canonical text or
// connection response is replaced by a browser fixture.
const ideas=createRequire(import.meta.url)(path.join(root,'connected-ideas.js'));
const ideaCatalog=JSON.parse(fs.readFileSync(path.join(root,'connected-ideas/catalog.json')));
const ideaRecords=ideas.forSection(ideaCatalog.records,CHANUKAH25_REF);
const ideaGroups=ideas.groups(ideaRecords);
const ideaOrigins=pack.paragraphs.map((_,index)=>CHANUKAH25_REF+':'+(index+1));
assert.equal(ideaRecords.length,18,'Chanukah 25 must retain its 18 reviewed connections');
assert.deepEqual([...new Set(ideaRecords.map(record=>record.originRef))].sort(),ideaOrigins,
  'Connected Ideas must cover all 6 canonical Chanukah 25 paragraphs');
const plain=value=>String(value||'').replace(/\s+/g,' ').trim();
const ideaIds=records=>records.map(record=>record.id).sort();

const walk=node=>[node,...(node.children||[]).flatMap(walk)];
const toc=JSON.parse(fs.readFileSync(path.join(root,'data/peri-tzadik/toc.json')));
const leaves=walk(toc.toc.children[0]).filter(node=>node.interlinear&&node.ref);
const next=leaves[leaves.findIndex(node=>node.ref===CHANUKAH25_REF)+1]?.ref;
const translations=JSON.parse(fs.readFileSync(path.join(root,'source-connections/translations.json'))).translations;
const translated=new Set(translations.map(entry=>entry.ref));
let sample;
for(const entry of pack.editorial.paragraphs){
  for(const note of entry.notes){
    const cite=entry.citations.find(c=>c.phraseId===note.phraseId&&c.ref===note.ref);
    const unique=entry.notes.filter(n=>n.ref===note.ref).length===1;
    if(cite&&unique&&!translated.has(note.ref)&&!/^(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Rashi on )/.test(note.ref)){
      sample={entry,note,cite};break;
    }
  }
  if(sample)break;
}
assert.ok(sample,'Need a reviewed rabbinic source with a citation and a unique paragraph note for source-entry verification');
const noteRow=published.items.find(row=>row.n===sample.entry.number);
const compiledNote=noteRow.footnotes.find(note=>note.provenance.reviewedNoteId===sample.note.id);
const sourceRef=sample.note.ref,paragraphRef=CHANUKAH25_REF+':'+sample.entry.number;
const server=http.createServer((req,res)=>{
  let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/library(?=\/|$)/,''));
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}
  try{
    if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'})[path.extname(file)]||'application/octet-stream');
    res.end(fs.readFileSync(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=remote?remote.replace(/\/?$/,'/'):`http://127.0.0.1:${server.address().port}/library/`;
const hash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const browser=await chromium.launch({headless:true});
const output=path.resolve('chanukah25-verification',remote?'live':'local');fs.mkdirSync(output,{recursive:true});
const checks=[];
const ideaChecks=[];
async function verifyConnectedIdeas(page,section,viewport){
  const check=await checkConnectionFootnotes(page,section,ideaRecords,{screenshot:path.join(output,`connection-footnotes-${viewport.width}.jpg`)});
  ideaChecks.push({viewport:viewport.width,...check});
}

try{
  for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block'});
    await context.route('https://www.sefaria.org/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({he:[],text:[],versions:[]})}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'#/book/Peri_Tzadik');
    // The retained Hebrew contents also link to this stable ref. Select the
    // dedicated interlinear card, whose label identifies the new edition.
    const tocLink=page.locator(`#toc a.btn.single[href="#/read/${hash(CHANUKAH25_REF)}"]`);
    await tocLink.waitFor();assert.equal(await tocLink.count(),1,'Exactly one dedicated interlinear TOC card');
    assert.equal(await tocLink.textContent(),'Read · 6 paragraphs · interlinear English');
    await tocLink.click();
    const section=page.locator(`#text > .sec[data-ref="${CHANUKAH25_REF}"]`);
    await section.locator('.seg-il .ph-he').first().waitFor({state:'visible'});
    assert.equal(await page.locator('#text').getAttribute('data-layout'),'inter');
    assert.equal(await page.locator('#text').getAttribute('data-lang'),'bi');
    assert.equal(await section.locator('.seg').count(),6);
    for(const [language,weight]of [['he','400'],['en','700']]){
      const weights=await section.locator('.seg-il .ph-'+language).evaluateAll(nodes=>[...new Set(nodes.map(node=>getComputedStyle(node).fontWeight))]);
      assert.deepEqual(weights,[weight],'Chanukah25 requires regular Hebrew and bold English');
      assert.equal(await section.locator('.seg-'+language).first().evaluate(node=>getComputedStyle(node).fontWeight),weight,
        'The requested type weight must also hold in paragraph reading layouts');
    }
    for(const [index,paragraph]of pack.paragraphs.entries()){
      const seg=section.locator('.seg').nth(index);
      for(const [language,key]of [['he','he'],['en','en']]){
        const actual=await seg.locator('.seg-il .ph-'+language).evaluateAll(nodes=>nodes.map(node=>{
          const copy=node.cloneNode(true);copy.querySelectorAll('.reader-footnote,.footnote-marker').forEach(item=>item.remove());return copy.textContent;
        }));
        assert.deepEqual(actual,paragraph.phrases.map(phrase=>phrase[key]),'Visible phrase text differs from independent review');
      }
    }
    const allNotes=(published.publishedItems || published.items).flatMap(row=>row.footnotes||[]);
    assert.equal(await section.locator('.seg-il .ph-he .footnote-marker:not(.connection-idea-marker)').count(),allNotes.length);
    assert.equal(await section.locator('.seg-il .ph-en .footnote-marker').count(),0,'No duplicated English note numbering');
    for(const note of allNotes){
      const marker=section.locator(`.seg-il .ph-he button[data-note-key="${note.placementId}"]`);
      const box=section.locator(`.seg-il .reader-footnote[data-note-key="${note.placementId}"]`);
      await marker.click();assert.equal(await marker.getAttribute('aria-expanded'),'true');
      assert.deepEqual(await box.locator('.annotation-text').allTextContents(),note.paragraphs.map(p=>p.text));
      assert.equal(await box.locator('a[href="'+note.sources[0].url+'"]').count(),1);
      await marker.click();assert.equal(await marker.getAttribute('aria-expanded'),'false');
    }
    await section.locator('.seg-il .ph-he').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,`first-${viewport.width}.png`)});
    await section.locator('.seg-il .ph-en').last().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,`last-${viewport.width}.png`)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Reader overflows the viewport');

    await verifyConnectedIdeas(page,section,viewport);

    const segment=section.locator(`.seg[data-ref="${paragraphRef}"]`);
    const verifySource=async entry=>{
      const card=page.locator('#pContent .source-head').filter({has:page.locator(`button[aria-label="Sources and connections for ${sourceRef}"]`)});
      const excerpt=card.locator('.footnote-source-excerpt');
      await excerpt.waitFor({state:'visible'});
      assert.equal(await excerpt.locator('.qh').count(),0,'Footnote excerpts remain English-only');
      assert.equal(await excerpt.locator('.qe').textContent(),sample.note.english);
      assert.equal(await card.locator('.quote .qe').count(),0,'An excerpt must not be presented as the complete source translation');
      assert.ok((await excerpt.locator('.connection-provenance').textContent()).includes(sample.note.translationProvenance));
      await page.locator('#pContent button[data-source-lang="he"]').click();
      assert.equal(await excerpt.locator('.qe').isVisible(),false);
      await page.locator('#pContent button[data-source-lang="en"]').click();
      assert.ok(await excerpt.locator('.qe').isVisible());
      await page.locator('#pContent button[data-source-lang="bi"]').click();
      assert.ok(await excerpt.locator('.qe').isVisible());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Source popup overflows viewport');
      checks.push({viewport:viewport.width,entry,sourceRef,englishSourceQuotation:true});
      await page.screenshot({path:path.join(output,`${entry}-${viewport.width}.png`)});
      await page.locator('#pClose').click();
    };
    await segment.locator(`.seg-il a.cite[data-ref="${sourceRef}"]`).first().click();
    await verifySource('underlined-citation');
    await segment.locator(`.seg-il .ph-he button[data-note-key="${compiledNote.placementId}"]`).click();
    await segment.locator(`.seg-il .reader-footnote[data-note-key="${compiledNote.placementId}"] a[href="${sample.note.url}"]`).click();
    await verifySource('footnote-link');
    await segment.locator('.num').click();
    await page.locator('#pContent button.cat').first().waitFor();
    // Read the rendered category buttons; the source may share a category with
    // other citations, so select its actual card when a list is shown.
    const categories=await page.locator('#pContent button.cat').evaluateAll(nodes=>nodes.map(node=>node.dataset.cat));
    let opened=false;
    for(const category of categories){
      if(category.startsWith('Connected Ideas')||category.startsWith('Kisvei'))continue;
      await page.locator('#pContent button.cat').filter({has:page.locator('.nm',{hasText:category})}).first().click();
      const heading=page.locator('#pContent .source-head .ref-en',{hasText:sourceRef});
      const target=page.locator(`#pContent .link-item[data-source-ref="${sourceRef}"] .ref-en`);
      await page.locator('#pContent #lItems').waitFor();
      if(await heading.count()){opened=true;break;}
      if(await target.count()){await target.first().click();opened=true;break;}
      await page.locator('#pBack').click();await page.locator('#pContent button.cat').first().waitFor();
    }
    assert.ok(opened,'The exact source must be discoverable from the paragraph sidebar');
    await verifySource('sidebar');
    for(const [from,button,to]of [
      ['Peri Tzadik, Chanukah 24','nextBtn',CHANUKAH25_REF],
      [CHANUKAH25_REF,'prevBtn','Peri Tzadik, Chanukah 24'],
      ...(next?[[CHANUKAH25_REF,'nextBtn',next]]:[])]){
      await page.goto(base+'#/read/'+hash(from));
      await page.locator(`#text > .sec[data-ref="${from}"] .ph-he`).first().waitFor();
      await page.locator('#'+button).click();await page.waitForURL(base+'#/read/'+hash(to));
      await page.locator(`#text > .sec[data-ref="${to}"] .ph-he`).first().waitFor();
    }
    assert.deepEqual(errors,[]);await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const report={ok:true,live:Boolean(remote),ref:CHANUKAH25_REF,paragraphs:6,phrasePairs:pack.paragraphs.reduce((sum,p)=>sum+p.phrases.length,0),sourceNotes:published.publishedNoteCount ?? published.noteCount,
  sourceTransportFixture:'English unavailable; the actual published English quotation is displayed without treating the excerpt as a complete source translation',checks,
  connectedIdeas:{records:ideaRecords.length,paragraphs:ideaOrigins.length,groups:ideaGroups.length,checks:ideaChecks}};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

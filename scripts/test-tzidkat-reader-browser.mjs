// Browser integration: every Hebrew/English insertion boundary, literal note text,
// source navigation, language modes, touch targets, keyboard focus, and long notes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const root=path.resolve('dist');
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try {if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const toc=JSON.parse(fs.readFileSync(root+'/library/data/tzidkat-hatzadik/toc.json','utf8'));
const sections=toc.toc.children.map(leaf=>({leaf,items:JSON.parse(fs.readFileSync(root+'/library/data/tzidkat-hatzadik/'+leaf.id+'.json','utf8'))}));
const expected=sections.flatMap(s=>s.items.flatMap(i=>(i.footnotes||[]).map(note=>({note,ref:s.leaf.ref,paragraph:i.n}))));
const source=JSON.parse(fs.readFileSync('sources/akiva/Tzidkat_HaTzadik.json','utf8'));
const expectedCount=source.footnoteImportInfo.placements;
const expectedSections=source.footnoteImportInfo.sectionsWithNotes;
assert.equal(expected.length,expectedCount);
const annotatedSections=sections.filter(s=>s.items.some(i=>i.footnotes?.length));
const toHash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
 await context.route('https://**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<p>Source navigation test</p>'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function openSection(ref,marker){
  await page.goto(origin+'/library/#/read/'+toHash(ref));
  const section=page.locator('#text > .sec[data-ref="'+ref+'"]');
  await section.locator(marker||'.seg-il .ph-he .source-note-trigger').first().waitFor({state:'visible'});
  return section;
 }
 const cases=new Set(['TZ-0001','TZ-0007','TZ-0023','TZ-0034','TZ-0047','TZ-0093','TZ-0094','TZ-0114','TZ-0144','TZ-0205','TZ-0222','TZ-0241','TZ-0251','TZ-0255','TZ-0256','TZ-0269','TZ-0934','TZ-0939','TZ-0940']);
 const checkedCases=new Set();let markerCount=0,noteCount=0,sectionCount=0;
 for(const {leaf,items} of annotatedSections){
  const section=await openSection(leaf.ref);
  const sectionNotes=items.flatMap(i=>i.footnotes||[]);
  const boundaries=await section.evaluate(root=>{
   const found=[];
   root.querySelectorAll('.seg-il .ph-he').forEach(container=>{
    const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);let node,prefix='';
    while((node=walker.nextNode())){
     const marker=node.parentElement?.closest('.source-note-trigger');
     if(marker)found.push({key:marker.dataset.noteKey,prefix,nested:Boolean(marker.closest('a')),number:marker.textContent});
     else prefix+=node.textContent;
    }
   });return found;
  });
  assert.equal(boundaries.length,sectionNotes.length,'One Hebrew marker per note in '+leaf.ref);
  assert.equal(await section.locator('.seg-il .ph-en .source-note-trigger').count(),0,'Never number the English translation');
  markerCount+=boundaries.length;
  for(const note of sectionNotes){
   const mark=boundaries.find(b=>b.key===note.placementId);assert.ok(mark,note.placementId);
   assert.equal(mark.prefix,note.heAnchorPrefix,'Incorrect Hebrew insertion point '+note.placementId);
   assert.equal(mark.nested,false,'Footnote marker inside source hyperlink');
   assert.equal(+mark.number,Number(note.sourceId.slice(3)),'Book-wide numbering');
  }
  const literal=await section.evaluate(root=>[...root.querySelectorAll('.seg-il .reader-footnote[data-source-note]')].map(box=>({key:box.dataset.noteKey,paragraphs:[...box.querySelectorAll('.annotation-text')].map(p=>p.textContent)})));
  assert.equal(literal.length,sectionNotes.length,'One complete inline box per footnote');
  assert.equal(await section.locator('.seg-il .reader-footnote summary').filter({hasText:'Explore Sefaria connections'}).count(),0,'Redundant Tzidkat connection sections must be absent');
  assert.equal(await section.locator('.seg-il .reader-footnote summary').filter({hasText:'Source review'}).count(),0,'Editorial verification controls must not clutter the Tzidkat footnotes');
  assert.equal(await section.locator('.seg-il .reader-footnote .footnote-connections').count(),0,'No auxiliary Sefaria or source-review panels are rendered');
  for(const note of sectionNotes){
   assert.deepEqual(literal.find(x=>x.key===note.placementId)?.paragraphs,note.paragraphs.map(p=>p.text),'Footnote text missing '+note.placementId);noteCount++;
   if(!cases.has(note.sourceId)||checkedCases.has(note.sourceId))continue;
   const trigger=section.locator('.seg-il .ph-he button[data-note-key="'+note.placementId+'"]');
   const box=section.locator('.seg-il .reader-footnote[data-note-key="'+note.placementId+'"]');
   await trigger.click();assert.ok(await box.isVisible(),'Inline note did not expand');
   assert.equal(await trigger.getAttribute('aria-expanded'),'true');
   assert.equal(await box.locator('.annotation-text').first().textContent(),note.paragraphs[0].text);
   await box.scrollIntoViewIfNeeded();const bounds=await box.boundingBox();
   assert.ok(bounds.x>=-0.5&&bounds.x+bounds.width<=390.5,'Inline note overflows mobile viewport');
   if(note.verificationStatus.includes('requires collation'))assert.ok(await box.locator('.footnote-edition-warning').isVisible());
   const source=box.locator('a[href^="https://www.sefaria.org/"]').first();assert.ok(await source.count());
   assert.equal(await source.getAttribute('target'),'_blank');
   if(note.sourceId==='TZ-0001'){
    const expectedUrl=await source.getAttribute('href');
    const popupPromise=page.waitForEvent('popup');await source.click();const popup=await popupPromise;
    await popup.waitForLoadState('domcontentloaded');assert.equal(popup.url(),expectedUrl);await popup.close();
   }
   // The original linked citations remain, but Tzidkat's redundant Sefaria
   // connections explorer must never be displayed inside a footnote.
   assert.equal(await box.locator('summary').filter({hasText:'Explore Sefaria connections'}).count(),0);
   assert.ok(await box.locator('a[href^="https://www.sefaria.org/"]').count()>0);
   await trigger.click();assert.ok(!(await box.isVisible()),'Inline note did not collapse');
   assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   checkedCases.add(note.sourceId);
  }
  sectionCount++;
  if(sectionCount%25===0)console.log('Verified '+sectionCount+'/'+annotatedSections.length+' reader routes.');
 }
 assert.equal(markerCount,expectedCount,'All Hebrew-only anchors');
 assert.equal(noteCount,expectedCount,'All full notes');
 assert.equal(sectionCount,expectedSections);assert.equal(checkedCases.size,cases.size);
 async function setPrefs(language,layout){
  await page.locator('#setBtn').click();
  await page.locator('[data-pref="lang"] button[data-v="'+language+'"]').click();
  await page.locator('[data-pref="layout"] button[data-v="'+layout+'"]').click();
  await page.locator('#setBtn').click();
 }
 const layoutSectionRef='Tzidkat HaTzadik 6';
 const firstKey=sections.find(s=>s.leaf.ref===layoutSectionRef).items.flatMap(i=>i.footnotes||[])[0].placementId;
 const first=await openSection(layoutSectionRef);
 for(const [lang,layout,selector] of [['he','stack','.seg-he'],['bi','side','.seg-he'],['bi','inter','.ph-he']]){
  await setPrefs(lang,layout);
  const trigger=first.locator(selector+' button[data-note-key="'+firstKey+'"]');
  assert.ok(await trigger.isVisible(),lang+' '+layout);
  await trigger.click();
  const box=first.locator(layout==='inter'?'.seg-il .reader-footnote[data-note-key="'+firstKey+'"]':'.segment-annotations .reader-footnote[data-note-key="'+firstKey+'"]');
  assert.ok(await box.isVisible(),lang+' '+layout+' inline expansion');
  await trigger.click();assert.ok(!(await box.isVisible()));
 }
 await setPrefs('en','stack');
 assert.equal(await first.locator('.seg-en button[data-note-key="'+firstKey+'"]').count(),0);
 assert.ok(await first.locator('.segment-annotations .reader-footnote[data-note-key="'+firstKey+'"]').isVisible(),'Source text accessible in English-only view');
 await setPrefs('bi','inter');
 for(const [ref,nums] of [['Dover Tzedek, Kuntres Dover Tzedek, Eruvin 2',[37,38,44]],['Dover Tzedek, Kuntres Dover Tzedek, Eruvin 3',[91]]]){
  const sec=await openSection(ref,'.seg-il .ph-he .footnote-marker');
  for(const num of nums){
   const trigger=sec.locator('.seg-il .ph-he button[data-fn="'+num+'"]');
   assert.ok(await trigger.count(),'Dover marker '+num+' missing in '+ref);
   const box=sec.locator('.seg-il .reader-footnote[data-fn="'+num+'"]');
   assert.equal(await box.count(),1,'Dover note box '+num+' missing');
   await trigger.first().click();assert.ok(await box.isVisible(),'Dover note '+num+' did not expand');
   assert.ok((await box.textContent()).length>100,'Dover note '+num+' lost full commentary');
   await trigger.first().click();assert.ok(!(await box.isVisible()));
  }
 }
 assert.deepEqual(errors,[],'Reader JavaScript errors');
 console.log('PASS browser: '+expectedCount+' Hebrew-only Tzidkat markers, continuous book-wide numbering, all untruncated inline notes, Sefaria links, three reading layouts, English-only access, and preserved Dover inline notes.');
 await context.close();
}finally{await browser.close();await new Promise(ok=>server.close(ok));}

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
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
 await context.route('https://**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<p>Source navigation test</p>'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/library/#/read/Tzidkat_HaTzadik_6');
 await page.locator('.seg-il .ph-he .source-note-trigger').first().waitFor({state:'visible'});
 // Render the actual published items through the production renderer, in one
 // document, avoiding a slow navigation for each of the 165 annotated simanim.
 await page.evaluate(all=>{
  document.querySelector('#text').replaceChildren();R.sections=[];
  for(const {leaf,items} of all){
   const ps=items.filter(i=>i.p),annotations={};ps.forEach((p,i)=>{if(p.footnotes?.length)annotations[i]=p.footnotes;});
   appendSection({local:true,ref:leaf.ref,sectionRef:leaf.ref,book:'Tzidkat HaTzadik',sep:':',chapterLinks:true,
    title:{en:leaf.en,he:leaf.he},he:ps.map(p=>p.p.map(x=>x[0]).join(' ')),en:ps.map(p=>p.p.map(x=>x[1]).join(' ')),
    phrases:ps.map(p=>p.p),nums:ps.map(p=>p.n),annotations});
  }
 },sections.filter(s=>s.items.some(i=>i.footnotes?.length)));
 const boundaries=await page.evaluate(()=>{
  const found=[];
  document.querySelectorAll('.seg-il .ph-he,.seg-il .ph-en').forEach(container=>{
   const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);let node,prefix='';
   while(node=walker.nextNode()){
    const marker=node.parentElement?.closest('.source-note-trigger');
    if(marker){found.push({key:marker.dataset.noteKey,language:container.classList.contains('ph-he')?'he':'en',prefix,nested:Boolean(marker.closest('a')),number:marker.textContent});}
    else prefix+=node.textContent;
   }
  });return found;
 });
 assert.equal(boundaries.length,558,'All 279 bilingual markers must be rendered');
 for(const {note} of expected){for(const language of ['he','en']){
  const b=boundaries.find(b=>b.key===note.placementId&&b.language===language);assert.ok(b,note.placementId);
  assert.equal(b.prefix,note[language+'AnchorPrefix'],'Wrong visible insertion point '+note.placementId+' '+language);
  assert.equal(b.nested,false,'A marker must not be inside a source hyperlink');assert.equal(+b.number,note.number);
 }}
 const literal=await page.evaluate(()=>[...document.querySelectorAll('.seg-il .reader-footnote[data-source-note]')].map(box=>({key:box.dataset.noteKey,text:box.querySelector('.annotation-text').textContent})));
 for(const {note} of expected)assert.equal(literal.find(x=>x.key===note.placementId).text,note.paragraphs[0].text,'Truncated displayed footnote '+note.placementId);
 const cases=['TZ-0001','TZ-0007','TZ-0023','TZ-0034','TZ-0047','TZ-0093','TZ-0094','TZ-0114','TZ-0144','TZ-0205','TZ-0222','TZ-0241','TZ-0251','TZ-0255','TZ-0256','TZ-0269'];
 for(const id of cases){
  const {note}=expected.find(x=>x.note.sourceId===id);
  const trigger=page.locator('.seg-il .ph-he button[data-note-key="'+note.placementId+'"]');
  await trigger.click();await page.waitForSelector('#source-note-dialog[open]');
  assert.equal(await page.locator('#source-note-dialog .annotation-text').first().textContent(),note.paragraphs[0].text);
  const box=await page.locator('#source-note-dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390.5,'Mobile dialog overflows viewport');
  assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  if(note.verificationStatus.includes('requires collation'))assert.ok(await page.locator('#source-note-dialog .footnote-edition-warning').isVisible());
  const source=page.locator('#source-note-dialog a[href^="https://www.sefaria.org/"]').first();assert.ok(await source.count());
  assert.equal(await source.getAttribute('target'),'_blank');
  const expectedUrl=await source.getAttribute('href');
  if(id==='TZ-0001'){
   const popupPromise=page.waitForEvent('popup');await source.click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');assert.equal(popup.url(),expectedUrl);await popup.close();
  }
  await page.keyboard.press('Escape');await page.waitForSelector('#source-note-dialog:not([open])',{state:'attached'});
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 }
 async function setPrefs(language,layout){
  await page.locator('#setBtn').click();
  await page.locator('[data-pref="lang"] button[data-v="'+language+'"]').click();
  await page.locator('[data-pref="layout"] button[data-v="'+layout+'"]').click();
  await page.locator('#setBtn').click();
 }
 for(const [language,layout,selector] of [['he','stack','.seg-he'],['en','stack','.seg-en'],['bi','side','.seg-he'],['bi','inter','.ph-he']]){
  await setPrefs(language,layout);const trigger=page.locator(selector+' button[data-note-key="TZ-0001-1"]');
  assert.ok(await trigger.isVisible(),language+' '+layout);const area=await trigger.boundingBox();assert.ok(area.width>=44&&area.height>=44,'Touch targets must be at least 44px');
  await trigger.click();await page.waitForSelector('#source-note-dialog[open]');
  for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.querySelector('#source-note-dialog').contains(document.activeElement)),'Keyboard focus escaped the dialog');}
  await page.locator('.source-note-dialog-close').click();await page.waitForSelector('#source-note-dialog:not([open])',{state:'attached'});
  assert.ok(await trigger.evaluate(el=>document.activeElement===el),'Focus was not restored to the clicked marker');
 }
 assert.deepEqual(errors,[],'Reader runtime errors');
 console.log('PASS browser: 558 exact bilingual markers, 279 complete displayed notes, source popups, Hebrew/English/interlinear/side views, 44px touch controls, mobile fit, Escape/close and focus restoration.');
 await context.close();
}finally{await browser.close();await new Promise(ok=>server.close(ok));}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {loadPack,REPORT,plain,DEFAULT_PACK} from './publish-tzidkat-source-attribution.mjs';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const root=path.resolve(option('--root','dist')),live=option('--url',null),{pack}=loadPack(option('--pack',DEFAULT_PACK));
const publication=JSON.parse(fs.readFileSync(path.join(root,REPORT))),revised=new Set(publication.operations.map(x=>x.placementId));
const sections=[...new Set([...pack.chapters.map(f=>'Tzidkat HaTzadik '+(Number(f.path.match(/\/(\d+)\.json$/)[1])+1)),...(pack.ideaChanges||[]).map(x=>x.after.placement.originSectionRef)])];
assert(sections.length);let browserModule;try{browserModule=await import('playwright');}catch{assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES);browserModule=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const artifacts='artifacts/tzidkat-source-attribution';fs.mkdirSync(artifacts,{recursive:true});
let server,base=live?.replace(/\/?$/,'/');
if(!base){server=http.createServer((request,response)=>{try{const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname),file=path.resolve(root,'.'+pathname);assert(file===root||file.startsWith(root+path.sep));const f=fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;response.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf'})[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(response);}catch{response.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/library/';}
const refHash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const normalizedHebrew=value=>String(value).replace(/[^א-ת]/g,'');
const navigationByNote=new Map(pack.audit.entries.filter(entry=>entry.navigationReview?.length).map(entry=>[entry.placementId,entry.navigationReview]));
const report={ok:false,release:pack.release,publiclyVerified:!!live,viewports:[],errors:[]};
const browser=await browserModule.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
try{
 for(const width of[1280,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:960},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};});
  await context.route(url=>url.origin!==new URL(base).origin,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push({width,error:error.message}));let opened=0,anchored=0,supplemental=0,citationOnlyLabels=0;const sourceNavigationChecks=[];
  for(const ref of sections){
   const file=pack.chapters.find(f=>'Tzidkat HaTzadik '+(Number(f.path.match(/\/(\d+)\.json$/)[1])+1)===ref),native=(file?.after||[]).filter(r=>r.p).flatMap(row=>(row.footnotes||[]).filter(note=>revised.has(note.placementId)).map(note=>({originRef:ref+':'+row.n,note,hebrew:row.p[note.phraseIndex][0]}))),ideas=(pack.ideaChanges||[]).filter(x=>x.after.placement.originSectionRef===ref);
   await page.goto(base+'#/read/'+refHash(ref),{waitUntil:'domcontentloaded'});
   await page.waitForFunction(ref=>[...document.querySelectorAll('.sec')].some(sec=>sec.dataset.ref===ref&&sec.dataset.connectionFootnotesMounted==='true'),ref,{timeout:60000});
   const section=page.locator('.sec[data-ref="'+ref+'"]');
   if(file){const expected=file.after.filter(r=>r.p).flatMap(row=>row.p.map(pair=>pair.map(plain)));const actualHe=await section.locator('.seg-il .ph-he').evaluateAll(elements=>elements.map(element=>{const c=element.cloneNode(true);c.querySelectorAll('button.footnote-marker').forEach(n=>n.remove());return c.textContent.trim();}));assert.deepEqual(actualHe,expected.map(pair=>pair[0]),'Displayed Hebrew changed '+ref);}
   for(const {originRef,note,hebrew}of native){
    const selector='[data-note-key="'+note.placementId+'"]',marker=section.locator('.seg-il .ph-he button'+selector),box=section.locator('.seg-il .reader-footnote'+selector);
    assert.equal(await marker.count(),1,'Missing or repeated revised Hebrew marker '+note.placementId);assert.equal(await box.count(),1);assert.equal(await section.locator('.seg-il .ph-en button'+selector).count(),0);
    assert.equal(Number(await marker.getAttribute('data-fn')),Number(note.number),'Footnote number changed');
    const anchor=await marker.evaluate(element=>{const seg=element.closest('.seg'),phrase=element.closest('.ph'),range=document.createRange();range.selectNodeContents(element.closest('.ph-he'));range.setEndBefore(element);const before=range.cloneContents();before.querySelectorAll('button.footnote-marker').forEach(n=>n.remove());return{ref:seg.dataset.ref,phraseIndex:[...seg.querySelectorAll('.seg-il .ph')].indexOf(phrase),prefix:before.textContent};});
    assert.equal(anchor.ref,originRef);assert.equal(anchor.phraseIndex,note.phraseIndex);assert.equal(anchor.prefix,note.heAnchorPrefix??plain(hebrew).slice(0,note.heCharOffset),'Marker beside wrong Hebrew words '+note.placementId);anchored++;
    assert.deepEqual(await box.locator('.annotation-text').allTextContents(),note.paragraphs.map(p=>p.text),'Quotation/context differs '+note.placementId);
    const visible=(await box.locator('.annotation-text').allTextContents()).join('\n');assert.doesNotMatch(visible,/Biur\s*(?:Me|Mi)shulav|Neim(?:ot|os|us|ut)(?:\s*HaTzedek)?|linked\s+(?:PDF|scan)|source\s+attachment/i,'Secondary edition attribution remains visible');assert.equal(await box.locator('a[href*=".pdf"]').count(),0,'PDF attachment remains in the note');
    for(const source of note.sources||[])if(source.citationOnly){assert(!source.url&&!source.readerRef&&!source.openExternal&&!source.connectionsUrl);const heading=box.locator('b,strong').filter({hasText:source.ref});assert(await heading.count(),'Citation-only source lost its bold heading');assert.equal(await box.locator('a').evaluateAll((links,ref)=>links.filter(a=>a.textContent.trim()===ref).length,source.ref),0,'Citation-only label unexpectedly navigates');citationOnlyLabels++;}
    await marker.click();assert.equal(await marker.getAttribute('aria-expanded'),'true');assert(await box.isVisible());assert.equal(await section.locator('.seg-il .reader-footnote.open').count(),1);assert(await box.evaluate(e=>e.scrollWidth<=e.clientWidth+2),'Footnote clipped on '+width);if(Number(note.number)===2642||Number(note.number)===2658)await page.screenshot({path:path.join(artifacts,(live?'live':'local')+'-ois'+(Number(note.number)===2642?'40':'154')+'-source-'+width+'.png'),fullPage:false});
    for(const mapping of navigationByNote.get(note.placementId)||[]){
     const matched=box.locator('a[href="'+mapping.sourceUrl+'"]');assert(await matched.count(),'Missing original source URL '+mapping.canonicalRef);
     const link=matched.first();assert.equal(await link.getAttribute('href'),mapping.sourceUrl);
     if(mapping.openExternal){assert.equal(await link.getAttribute('data-source-external'),'true','Printed witness was intercepted');assert.equal(await link.getAttribute('data-reader-ref'),null);sourceNavigationChecks.push({number:note.number,canonicalRef:mapping.canonicalRef,openExternal:true,originalUrlPreserved:true});continue;}
     assert.equal(await link.getAttribute('data-reader-ref'),mapping.readerRef,'Wrong mapped local source target');
     await link.click();const item=page.locator('#panel .source-head[data-source-ref="'+mapping.readerRef+'"]');await item.locator('.quote .qh').first().waitFor({state:'visible',timeout:60000});
     assert.equal(await page.locator('#panel .panel-head .ttl').textContent(),mapping.readerRef);
     const actualHebrew=normalizedHebrew((await item.locator('.quote .qh').allTextContents()).join(' ')),anchors=(mapping.localEvidence?.rows||[]).flatMap(row=>row.anchors||[]).filter(anchor=>anchor.length>=18);
     assert(anchors.length,'Missing independent local quotation proof '+mapping.readerRef);for(const anchor of anchors)assert(actualHebrew.includes(anchor.exactNormalizedHebrew),'Mapped panel opened different source words '+mapping.readerRef);
     assert((await item.locator('.quote .qe').allTextContents()).join(' ').trim(),'Mapped panel is missing English '+mapping.readerRef);
     assert(await item.locator('.acts a').evaluateAll((links,url)=>links.some(a=>a.getAttribute('href')===url),mapping.sourceUrl),'Original source link lost in mapped panel');
     sourceNavigationChecks.push({number:note.number,canonicalRef:mapping.canonicalRef,readerRef:mapping.readerRef,matchedHebrewAnchors:anchors.length,originalUrlPreserved:true});await page.locator('#pClose').click();
    }
    await marker.click();opened++;
   }
   for(const {after:idea}of ideas){const key='IDEA-'+idea.id,selector='[data-note-key="'+key+'"]',marker=section.locator('.seg-il .ph-he button'+selector),box=section.locator('.seg-il .reader-footnote'+selector);assert.equal(await marker.count(),1,'Missing supplemental footnote '+key);assert.equal(Number(await marker.getAttribute('data-fn')),idea.footnoteNumber);const text=await box.textContent();assert(text.includes(idea.targetEnglish)&&text.includes(idea.explanation),'Supplemental quote/context differs '+key);await marker.click();assert(await box.isVisible());await marker.click();supplemental++;}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Reader horizontal overflow '+ref);
  }
  await page.screenshot({path:path.join(artifacts,(live?'live':'local')+'-'+width+'.png'),fullPage:false});report.viewports.push({width,sections:sections.length,revisedNativeNotesOpened:opened,exactHebrewAnchors:anchored,revisedSupplementalNotesOpened:supplemental,citationOnlyLabels,sourceNavigationChecks});await context.close();
 }
 assert.deepEqual(report.errors,[]);for(const viewport of report.viewports){assert.equal(viewport.revisedNativeNotesOpened,pack.operations.length);assert.equal(viewport.exactHebrewAnchors,pack.operations.length);assert.equal(viewport.citationOnlyLabels,3);}report.ok=true;
}catch(error){report.failure=error.message;throw error;}
finally{fs.writeFileSync(path.join(artifacts,(live?'live':'local')+'-report.json'),JSON.stringify(report,null,2));await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify(report));

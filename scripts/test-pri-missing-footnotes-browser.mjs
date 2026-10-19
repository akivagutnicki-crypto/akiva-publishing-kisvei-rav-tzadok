// Exercise real Hebrew markers and their own complete note boxes in every new
// chapter on desktop and mobile, including the corrected Resisei references.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {REPO,RELEASE,readExpectedMissingFootnotes,toHash,canonical,sha} from './test-pri-missing-footnotes.mjs';

const value=flag=>{const index=process.argv.indexOf(flag);return index<0?undefined:process.argv[index+1];};
const live=value('--url'),root=path.resolve(value('--root') || path.join(REPO,'dist/library'));
const artifacts=path.resolve(value('--artifacts') || 'pri-missing-footnotes-verification');
const fixture=readExpectedMissingFootnotes();
const {chromium}=createRequire(import.meta.url)('playwright');
let server,base=live?.replace(/\/?$/,'/');
if(!base) {
  server=http.createServer((request,response)=>{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(!pathname.startsWith('/library/')) {response.writeHead(404).end();return;}
    let file=path.resolve(root,'.'+pathname.slice('/library'.length));
    if(file!==root&&!file.startsWith(root+path.sep)) {response.writeHead(403).end();return;}
    try {
      if(fs.statSync(file).isDirectory()) file=path.join(file,'index.html');
      if(!fs.statSync(file).isFile()) {response.writeHead(404).end();return;}
      response.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8',
        '.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(response);
    } catch {response.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port+'/library/';
}
fs.mkdirSync(artifacts,{recursive:true});
const report={release:RELEASE,base,status:'running',sections:[],errors:[],screenshots:[]};
const browser=await chromium.launch({headless:true,...(process.env.AKIVA_CHROME_EXECUTABLE ? {executablePath:process.env.AKIVA_CHROME_EXECUTABLE} : {})});
const expectedLinks=note=>note.paragraphs.flatMap(paragraph=>[
  ...(paragraph.rich || []).flatMap(run=>run.href?[run.href]:[]),
  ...(paragraph.links || []).map(link=>link.url),
]);
const sortByKey=values=>values.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
try {
  for(const mobile of [false,true]) {
    const width=mobile?390:1440;
    const context=await browser.newContext({viewport:{width,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    await context.addInitScript(()=>{
      localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));
      // Isolate each requested chapter from the reader's infinite-scroll loader.
      window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
    });
    const origin=new URL(base).origin;
    await context.route(url=>url.origin!==origin,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
    const page=await context.newPage();
    page.on('pageerror',error=>report.errors.push({viewport:width,message:error.message}));
    for(const target of fixture.targets) {
      await page.goto(base+'#/read/'+toHash(target.ref),{waitUntil:'domcontentloaded'});
      const current=page.locator('#text > .sec[data-ref="'+target.ref+'"]');
      await current.locator('.seg-il .ph-he button.footnote-marker').first().waitFor({state:'visible',timeout:60000});
      assert.equal(await current.count(),1,'Exactly one chapter '+target.ref);
      const flattened=target.expectedItems.flatMap(item=>item.footnotes.map(note=>({item:item.n,note})));
      const marks=current.locator('.seg-il .ph-he button.footnote-marker');
      assert.equal(await marks.count(),target.noteCount,'Every Hebrew marker '+target.ref);
      assert.equal(await current.locator('.seg-il .ph-en button.footnote-marker').count(),0,'No duplicate English markers '+target.ref);
      assert.equal(await current.locator('.seg-il .reader-footnote').count(),target.noteCount,'Every source note box '+target.ref);
      const actualMarkers=await current.locator('.seg').evaluateAll(segments=>segments.flatMap(segment=>
        [...segment.querySelectorAll('.seg-il .ph')].flatMap((phrase,phraseIndex)=>
          [...phrase.querySelectorAll('.ph-he button.footnote-marker')].map(marker=>{
            const range=document.createRange();range.selectNodeContents(marker.closest('.ph-he'));range.setEndBefore(marker);
            const before=range.cloneContents();before.querySelectorAll('button.footnote-marker').forEach(button=>button.remove());
            return {key:marker.dataset.noteKey,number:Number(marker.dataset.fn),ref:segment.dataset.ref,phraseIndex,prefix:before.textContent};
          }))));
      const expectedMarkers=flattened.map(({item,note})=>({key:note.placementId,number:note.number,
        ref:target.ref+target.separator+item,phraseIndex:note.phraseIndex,prefix:note.heAnchorPrefix}));
      assert.deepEqual(sortByKey(actualMarkers),sortByKey(expectedMarkers),'Actual Hebrew marker positions '+target.ref);
      const actualBoxes=await current.locator('.seg-il .reader-footnote').evaluateAll(boxes=>boxes.map(box=>({
        key:box.dataset.noteKey,number:Number(box.dataset.fn),paragraphs:[...box.querySelectorAll('.annotation-text')].map(p=>p.textContent),
        links:[...box.querySelectorAll('a')].map(a=>a.getAttribute('href')),
      })));
      const expectedBoxes=flattened.map(({note})=>({key:note.placementId,number:note.number,paragraphs:note.paragraphs.map(p=>p.text),links:expectedLinks(note)}));
      assert.equal(sha(canonical(sortByKey(actualBoxes))),sha(canonical(sortByKey(expectedBoxes))),
        'Every rendered note has the complete expected English and clickable sources '+target.ref);
      const samples=new Map([flattened[0],flattened.at(-1)].map(entry=>[entry.note.sourceId,entry]));
      // Multiple notes in one phrase must open their own matching box.
      const multi=flattened.find(entry=>flattened.some(other=>other.note.sourceId!==entry.note.sourceId
        &&other.item===entry.item&&other.note.phraseIndex===entry.note.phraseIndex));
      if(multi) samples.set(multi.note.sourceId,multi);
      // In each chapter with a correction, exercise its first and final corrected note.
      const corrected=flattened.filter(entry=>fixture.correctedIds.has(entry.note.sourceId));
      for(const entry of [corrected[0],corrected.at(-1)].filter(Boolean)) samples.set(entry.note.sourceId,entry);
      for(const {note} of samples.values()) {
        const trigger=current.locator('.seg-il .ph-he button[data-note-key="'+note.placementId+'"]');
        const box=current.locator('.seg-il .reader-footnote[data-note-key="'+note.placementId+'"]');
        assert.equal(await trigger.count(),1); assert.equal(await box.count(),1);
        assert.equal(await trigger.getAttribute('aria-expanded'),'false');
        await trigger.click();
        assert.equal(await trigger.getAttribute('aria-expanded'),'true','Marker did not open '+note.sourceId);
        assert.ok(await box.isVisible(),'Wrong note opened '+note.sourceId);
        assert.equal(await current.locator('.seg-il .reader-footnote.open').count(),1,'A different note also opened '+note.sourceId);
        assert.deepEqual(await box.locator('.annotation-text').allTextContents(),note.paragraphs.map(p=>p.text),'Complete open source note '+note.sourceId);
        assert.deepEqual(await box.locator('a').evaluateAll(anchors=>anchors.map(anchor=>anchor.getAttribute('href'))),expectedLinks(note),'Clickable open source links '+note.sourceId);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Horizontal overflow with note open '+note.sourceId);
        const correctedSample=corrected.length && note===corrected[0].note;
        if(((target.file==='177.json'||target.file==='189-7.json'||target.file==='190-7.json')&&note===flattened[0].note)||correctedSample) {
          const filename=(live?'live-':'local-')+target.file.replace('.json','')+(correctedSample?'-corrected':'')+'-'+width+'.png';
          await box.evaluate(element=>{
            const stickyBottom=Math.max(...['.top','.rbar'].map(selector=>document.querySelector(selector)?.getBoundingClientRect().bottom || 0));
            window.scrollBy({top:element.getBoundingClientRect().top-stickyBottom-16,behavior:'instant'});
          });
          await page.screenshot({path:path.join(artifacts,filename)});report.screenshots.push(filename);
        }
        await trigger.click();
        assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await box.isVisible(),false,'Note did not close '+note.sourceId);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Reader horizontal overflow '+target.ref);
      const entry={ref:target.ref,file:target.file,viewport:width,markers:target.noteCount,englishMarkers:0,
        completeRenderedNotes:target.noteCount,openedNotes:samples.size,correctedNotes:corrected.length};
      report.sections.push(entry);console.log('PASS '+JSON.stringify(entry));
    }
    await context.close();
  }
  assert.equal(report.sections.length,52);assert.deepEqual(report.errors,[],'Reader JavaScript errors');
  report.status='pass';
  console.log('PASS '+(live?'LIVE':'LOCAL')+' Pri missing-footnote reader: all 2,299 markers and source boxes in all 26 chapters at desktop and mobile widths.');
} catch(error) {report.status='fail';report.failure=error.message;throw error;}
finally {
  fs.writeFileSync(path.join(artifacts,(live?'live-':'local-')+'report.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();if(server) await new Promise(resolve=>server.close(resolve));
}

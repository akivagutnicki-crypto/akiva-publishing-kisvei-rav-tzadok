import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {loadPack,validatePack,verifyPublication,RELEASE} from '../scripts/publish-vayeira-parallels.mjs';
import {plain,read,notesOf} from '../scripts/pri-parsha-review-core.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const root=path.resolve(option('--root',process.env.AKIVA_ROOT||'dist')),live=option('--url',null);
const artifacts=path.resolve(option('--artifacts','artifacts/vayeira-parallels'));
const prepared=loadPack(),{pack,additions,reanchors}=prepared;
assert.equal(additions.length,pack.audit.newNotes,'Expected the audited individually reviewed additions');
assert.equal(reanchors.length,pack.audit.reanchoredNotes,'Expected the exact audited reanchors');
const newEntries=p=>validatePack(p).additions;
let guards=0;
const reject=(label,mutate)=>{const bad=structuredClone(pack);mutate(bad);assert.throws(()=>validatePack(bad),undefined,label);guards++;};
reject('A bad exact Hebrew anchor must fail',p=>{newEntries(p).find(e=>e.row).note.heAnchorPrefix+='X';});
reject('Missing primary source evidence must fail',p=>{p.sourceEvidence=[];});
reject('A repeated parallel reference must fail',p=>{const a=newEntries(p),first=a[0].note,second=a[1].note;second.reviewedSourceExcerpt=structuredClone(first.reviewedSourceExcerpt);second.sources=structuredClone(first.sources);second.paragraphs=structuredClone(first.paragraphs);});
reject('Changing author text must fail',p=>{p.sections[0].after.find(r=>r.p).p[0][0]+=' תוספת';});
reject('Changing an existing note must fail',p=>{const s=p.sections[0],old=notesOf(s.before)[0].note,n=notesOf(s.after).find(x=>x.note.placementId===old.placementId).note;n.paragraphs[0].text+=' X';});
reject('An invented quotation must fail',p=>{newEntries(p)[0].note.reviewedSourceExcerpt.he='ציטוט שמעולם לא היה';});
if(reanchors.length){
 reject('Unapproved reanchoring must fail',p=>{p.reanchors=[];});
 reject('A reanchor without a reviewed reason must fail',p=>{p.reanchors[0].reason='';});
 reject('Reanchoring cannot alter the existing quotation',p=>{const id=p.reanchors[0].placementId,n=[...p.sections.flatMap(s=>notesOf(s.after).map(x=>x.note)),...Object.values(p.supplement.after).flat(2)].find(n=>n.placementId===id);n.paragraphs[0].text+=' X';});
}
const allNotes=p=>[...p.sections.flatMap(s=>notesOf(s.after).map(x=>({section:s.sectionRef,note:x.note}))),...Object.entries(p.supplement.after).flatMap(([section,rows])=>rows.flatMap(ns=>ns.map(note=>({section,note}))))];
const td145=allNotes(pack).filter(x=>x.note.sources?.some(s=>s.ref==='Tzidkat HaTzadik 145:1'));
assert.deepEqual(td145.map(x=>x.section),['Peri Tzadik, Vayera 1'],'Keep Tzidkat 145 in ois 1 and remove its repeat in ois 10');
if(args.includes('--guards-only')){console.log(JSON.stringify({ok:true,release:RELEASE,negativeGuards:guards,additions:additions.length,reviewedSections:10}));process.exit(0);}

const proof=verifyPublication(root,prepared);
if(args.includes('--data-only')){console.log(JSON.stringify({...proof,negativeGuards:guards}));process.exit(0);}
const expectedSections=[...pack.sections.map(s=>({sectionRef:s.sectionRef,rows:s.after.filter(r=>r.p)})),...Object.entries(pack.supplement.after).map(([sectionRef,notes])=>({sectionRef,hebrewOnly:true,rows:read(root,'library/data/peri-tzadik/9-'+sectionRef.split(' ').at(-1)+'.json').map((text,i)=>({n:i+1,p:[[text,'']],footnotes:notes[i]}))}))];
const tidy=s=>String(s).replace(/\s+/g,' ').trim();
fs.mkdirSync(artifacts,{recursive:true});
let playwright;try{playwright=await import('playwright');}catch{assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'Playwright runtime path is required');playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
let server,browser,base=live?.replace(/\/?$/,'/');
if(!base){
 server=http.createServer((request,response)=>{try{const name=decodeURIComponent(new URL(request.url,'http://local').pathname),target=path.resolve(root,'.'+name);assert(target===root||target.startsWith(root+path.sep));const file=fs.statSync(target).isDirectory()?path.join(target,'index.html'):target;response.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(response);}catch{response.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/library/';
}
const report={ok:false,release:RELEASE,negativeGuards:guards,proof,viewports:[],errors:[]};
try{
 browser=await playwright.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
 for(const [width,layout]of [[1280,'side'],[390,'inter']]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:960},hasTouch:width===390,serviceWorkers:'block'});
  await context.addInitScript(layout=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify(layout));window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};},layout);
  await context.route(url=>url.origin!==new URL(base).origin,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push({width,error:error.message}));const checks=[];
  for(const expected of expectedSections){
   const ref=expected.sectionRef,newNotes=additions.filter(e=>e.sectionRef===ref).map(e=>e.note),movedNotes=reanchors.filter(e=>e.sectionRef===ref).map(e=>e.note),changedNotes=[...newNotes,...movedNotes];
   await page.goto(base+'#/read/'+encodeURIComponent(ref).replace(/%20/g,'_'),{waitUntil:'domcontentloaded'});
   await page.waitForFunction(ref=>[...document.querySelectorAll('.sec')].some(s=>s.dataset.ref===ref&&s.dataset.connectionFootnotesMounted==='true'),ref,{timeout:60000});
   // First-visit routing can select interlinear; exercise the requested layout
   // through the reader's settings after that initialization has completed.
   await page.locator('#setBtn').click();
   await page.locator('#settings .seg-ctl[data-pref="lang"] button[data-v="bi"]').click();
   await page.locator('#settings .seg-ctl[data-pref="layout"] button[data-v="'+layout+'"]').click();
   await page.locator('#setBtn').click();
   assert.equal(await page.locator('#text').getAttribute('data-lang'),'bi',ref+' bilingual view');
   assert.equal(await page.locator('#text').getAttribute('data-layout'),layout,ref+' selected layout');
   const section=page.locator('.sec[data-ref="'+ref+'"]');
   assert.equal(await section.getAttribute('data-connected-ideas-status'),'checked',ref+' connected-idea check');
   const snapshot=await section.evaluate(element=>{
    const author=e=>{const x=e.cloneNode(true);x.querySelectorAll('.footnote-marker,.reader-footnote').forEach(n=>n.remove());return x.textContent;};
    return{he:[...element.querySelectorAll('.seg-il .ph-he')].map(author),en:[...element.querySelectorAll('.seg-il .ph-en')].map(author),enMarkers:element.querySelectorAll('.seg-il .ph-en button[data-note-key]').length};
   });
   assert.deepEqual(snapshot.he.map(tidy),expected.rows.flatMap(r=>r.p.map(p=>tidy(plain(p[0])))),ref+' author Hebrew');
   assert.deepEqual(snapshot.en.map(tidy),expected.rows.flatMap(r=>r.p.map(p=>tidy(plain(p[1])))),ref+' author English');
   assert.equal(snapshot.enMarkers,0,ref+' Hebrew-only numbering');
   for(const note of changedNotes){
    const key='[data-note-key="'+note.placementId+'"]',inline=section.locator('.seg-il .ph-he button'+key),flat=section.locator('.seg-he button'+key);
    assert.equal(await inline.count(),1,ref+' unique inline marker '+note.number);assert.equal(await flat.count(),1,ref+' unique running-Hebrew marker '+note.number);
    assert.equal(Number(await inline.getAttribute('data-fn')),note.number);assert.equal(Number(await flat.getAttribute('data-fn')),note.number);
    const anchor=await inline.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element.closest('.ph-he'));range.setEndBefore(element);const before=range.cloneContents();before.querySelectorAll('.footnote-marker,.reader-footnote').forEach(n=>n.remove());return before.textContent;});
    assert.equal(anchor,note.heAnchorPrefix,ref+' exact Hebrew placement '+note.number);
    const useInline=layout==='inter',marker=useInline?inline:flat,box=section.locator((useInline?'.seg-il .reader-footnote':'.segment-annotations > .reader-footnote')+key);
    await marker.click();await box.waitFor({state:'visible'});assert.equal(await marker.getAttribute('aria-expanded'),'true');
    assert.deepEqual(await box.locator('.annotation-text').allTextContents(),note.paragraphs.map(p=>p.text),ref+' complete popup quotation '+note.number);
    for(const source of note.sources){
     const links=await box.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>({href:n.getAttribute('href'),text:n.textContent,readerRef:n.getAttribute('data-reader-ref')})));
     const link=links.find(a=>a.href===source.url&&a.text===(note.reviewedSourceExcerpt.citation||source.ref));assert(link,ref+' precise linked citation '+note.number);
     if(source.readerRef){
      assert.equal(link.readerRef,source.readerRef,ref+' explicit reader mapping '+note.number);
     }
    }
    assert(await box.evaluate(e=>e.scrollWidth<=e.clientWidth+2),ref+' unclipped quotation '+note.number);
    if(note===changedNotes[0])await page.screenshot({path:path.join(artifacts,(live?'live':'candidate')+'-'+ref.replace(/[^A-Za-z0-9]+/g,'-')+'-'+width+'.png'),fullPage:false});
    await marker.click();await box.waitFor({state:'hidden'});
   }
   if(expected.hebrewOnly){
    await page.locator('#setBtn').click();await page.locator('#settings .seg-ctl[data-pref="lang"] button[data-v="he"]').click();await page.locator('#setBtn').click();
    for(const note of changedNotes){const key='[data-note-key="'+note.placementId+'"]',mark=section.locator('.seg-he button'+key),box=section.locator('.segment-annotations > .reader-footnote'+key);await mark.click();await box.waitFor({state:'visible'});assert.deepEqual(await box.locator('.annotation-text').allTextContents(),note.paragraphs.map(p=>p.text));await mark.click();}
    await page.locator('#setBtn').click();await page.locator('#settings .seg-ctl[data-pref="lang"] button[data-v="bi"]').click();await page.locator('#setBtn').click();
   }
   if(ref==='Peri Tzadik, Vayera 1')assert.equal(await section.locator('.seg-il .ph-he button[data-note-key="PT-5638-1"]').count(),1,'Tzidkat 145 retained in ois 1');
   if(ref==='Peri Tzadik, Vayera 10')assert.equal(await section.locator('button[data-note-key="PT-5719-1"]').count(),0,'Tzidkat 145 repeat removed from ois 10');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,ref+' horizontal overflow');
   checks.push({section:ref,newNotes:newNotes.length,reanchoredNotes:movedNotes.length,exactHebrewMarkers:true,fullPopupQuotesAndLinks:true,authorTextUnchanged:true,hebrewOnlyMode:!!expected.hebrewOnly});
  }
  assert.equal(checks.reduce((sum,c)=>sum+c.newNotes,0),pack.audit.newNotes);assert.equal(checks.reduce((sum,c)=>sum+c.reanchoredNotes,0),pack.audit.reanchoredNotes);report.viewports.push({width,layout,sections:checks});await context.close();console.log(JSON.stringify({width,layout,verifiedSections:checks.length,additions:additions.length,reanchoredNotes:reanchors.length}));
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.failure=error.message;throw error;}finally{fs.writeFileSync(path.join(artifacts,(live?'live':'candidate')+'-browser-report.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({ok:true,sections:10,additions:additions.length,reanchoredNotes:reanchors.length,viewports:2,layouts:['side','inter'],release:RELEASE}));

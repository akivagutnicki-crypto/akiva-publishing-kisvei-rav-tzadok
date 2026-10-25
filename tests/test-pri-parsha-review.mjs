import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {loadPack,validatePack,verifyPublication,read,plain,sha,SUPPLEMENT,ARCHIVES} from '../scripts/pri-parsha-review-core.mjs';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const root=path.resolve(option('--root','dist')),live=option('--url',null),artifacts=path.resolve(option('--artifacts','artifacts/pri-parsha-review'));
const prepared=loadPack({requireDescriptor:true}),{pack}=prepared;
const reject=(label,mutate)=>{const bad=structuredClone(pack);mutate(bad);assert.throws(()=>validatePack(bad),undefined,label);};
reject('An unrelated Hebrew quotation must be rejected',p=>p.operations.find(o=>o.quotation).quotation.he='ציטוט שלא היה ולא נברא');
reject('An unreviewed note operation must be rejected',p=>p.operations[0].reviewed=false);
reject('An author Hebrew change must be rejected',p=>p.chapters[0].after.find(r=>r.p).p[0][0]+=' תוספת');
reject('Existing note identity must be preserved',p=>p.operations.find(o=>o.action==='replace').after.number=99999);
reject('New Hebrew marker must match its exact prefix',p=>p.operations.find(o=>o.action==='add').after.heAnchorPrefix+='X');
reject('A duplicate existing Kisvei identity must be rejected',p=>p.connected.entries[0].number++);
reject('Incomplete original-note review must be rejected',p=>p.audit.entries.pop());
reject('Hebrew-only source anchors must be exact',p=>p.supplementalSections[0].annotations.flat()[0].heAnchorPrefix+='X');
reject('Formatting must not insert an unreviewed visible paragraph',p=>{const f=p.formatCorrections[0];f.after.paragraphs.push({language:'en',text:'Unreviewed text',rich:[{text:'Unreviewed text'}]});const row=p.chapters.find(c=>c.path===f.path).after.find(r=>r.n===f.paragraph);row.footnotes[row.footnotes.findIndex(n=>n.placementId===f.placementId)]=structuredClone(f.after);});
reject('Formatting must preserve the rendered quotation',p=>{const f=p.formatCorrections[0];f.after.paragraphs[0].rich[1].text='Unreviewed text';const row=p.chapters.find(c=>c.path===f.path).after.find(r=>r.n===f.paragraph);row.footnotes[row.footnotes.findIndex(n=>n.placementId===f.placementId)]=structuredClone(f.after);});
if(args.includes('--guards-only')){console.log(JSON.stringify({ok:true,negativeGuards:10,scope:57}));process.exit(0);}
const verified=verifyPublication({directory:root,prepared,verifyAllBaseline:true});
const {unzipSync}=createRequire(import.meta.url)(path.join(root,'library/vendor/fflate.min.js'));
for(const archive of ARCHIVES){
 const members=unzipSync(fs.readFileSync(path.join(root,archive)),{filter:f=>f.name.startsWith('data/peri-tzadik/')});
 for(const c of pack.chapters)assert.deepEqual(JSON.parse(Buffer.from(members[c.path.slice(8)])),c.after,'Download has old notes: '+c.path);
 assert.deepEqual(JSON.parse(Buffer.from(members[SUPPLEMENT.slice(8)])),read(root,SUPPLEMENT));
 for(const s of pack.supplementalSections)assert.deepEqual(JSON.parse(Buffer.from(members[s.path.slice(8)])),s.before,'Download changed original Hebrew');
}
if(args.includes('--data-only')){console.log(JSON.stringify({ok:true,...verified.proof,archives:2}));process.exit(0);}
fs.mkdirSync(artifacts,{recursive:true});
let browserModule;try{browserModule=await import('playwright');}catch{assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES);browserModule=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
let server,browser,base=live?.replace(/\/?$/,'/');
if(!base){server=http.createServer((request,response)=>{try{const name=decodeURIComponent(new URL(request.url,'http://local').pathname),target=path.resolve(root,'.'+name);assert(target===root||target.startsWith(root+path.sep));const file=fs.statSync(target).isDirectory()?path.join(target,'index.html'):target;response.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(response);}catch{response.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/library/';}
const report={ok:false,release:pack.release,viewports:[],errors:[],negativeGuards:10};
const expectedSections=[...pack.chapters.map(c=>({sectionRef:c.sectionRef,rows:c.after.filter(r=>r.p)})),...pack.supplementalSections.map(s=>({sectionRef:s.sectionRef,hebrewOnly:true,rows:s.before.map((text,i)=>({n:i+1,p:[[text,'']],footnotes:s.annotations[i]}))}))];
const tidy=s=>String(s).replace(/\s+/g,' ').trim();
try{
 browser=await browserModule.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:960},hasTouch:width===390,serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};});
  await context.route(url=>url.origin!==new URL(base).origin,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push({width,error:error.message}));const checks=[];
  for(const expected of expectedSections){
   const ref=expected.sectionRef;await page.goto(base+'#/read/'+encodeURIComponent(ref).replace(/%20/g,'_'),{waitUntil:'domcontentloaded'});
   await page.waitForFunction(ref=>[...document.querySelectorAll('.sec')].some(s=>s.dataset.ref===ref&&s.dataset.connectionFootnotesMounted==='true'),ref,{timeout:60000});
   const section=page.locator('.sec[data-ref="'+ref+'"]');assert.equal(await section.getAttribute('data-connected-ideas-status'),'checked',ref+' context pins');
   const snapshot=await section.evaluate(element=>{
    const author=e=>{const x=e.cloneNode(true);x.querySelectorAll('.footnote-marker,.reader-footnote').forEach(n=>n.remove());return x.textContent;};
    return{he:[...element.querySelectorAll('.seg-il .ph-he')].map(author),en:[...element.querySelectorAll('.seg-il .ph-en')].map(author),
      notes:[...element.querySelectorAll('.seg-il .reader-footnote')].map(n=>({key:n.dataset.noteKey,text:[...n.querySelectorAll('.annotation-text')].map(p=>p.textContent),links:[...n.querySelectorAll('a[href]')].map(a=>({href:a.getAttribute('href'),text:a.textContent}))})),
      heMarkers:[...element.querySelectorAll('.seg-il .ph-he button[data-note-key]')].map(n=>({key:n.dataset.noteKey,number:Number(n.dataset.fn)})),
      flatMarkers:[...element.querySelectorAll('.seg-he button[data-note-key]')].map(n=>n.dataset.noteKey),enMarkers:element.querySelectorAll('.seg-il .ph-en button[data-note-key]').length};
   });
   assert.deepEqual(snapshot.he.map(tidy),expected.rows.flatMap(r=>r.p.map(p=>tidy(plain(p[0])))),ref+' Hebrew body');
   assert.deepEqual(snapshot.en.map(tidy),expected.rows.flatMap(r=>r.p.map(p=>tidy(plain(p[1])))),ref+' English body');assert.equal(snapshot.enMarkers,0,ref+' English marker duplication');
   const native=expected.rows.flatMap(row=>(row.footnotes||[]).map(note=>({row:row.n,note}))),connections=pack.connected.entries.filter(e=>e.sectionRef===ref);
   const all=[...native.map(x=>({...x.note,originRef:ref+':'+x.row})),...connections.map(e=>({placementId:e.placementId,number:e.number,paragraphs:[e.quotationParagraph],originRef:e.originRef,sources:[]}))];
   assert.equal(snapshot.heMarkers.length,all.length,ref+' marker count');assert.equal(snapshot.notes.length,all.length,ref+' note count');
   for(const note of all){
    assert.deepEqual(snapshot.heMarkers.filter(n=>n.key===note.placementId),[{key:note.placementId,number:note.number}],ref+' unique numbered marker '+note.placementId);
    assert.equal(snapshot.flatMarkers.filter(key=>key===note.placementId).length,1,ref+' Hebrew mode marker '+note.placementId);
    const actual=snapshot.notes.filter(n=>n.key===note.placementId);assert.equal(actual.length,1);assert.deepEqual(actual[0].text,note.paragraphs.map(p=>p.text),ref+' complete quotation '+note.placementId);
    for(const source of note.sources||[])assert(actual[0].links.some(a=>a.href===source.url),ref+' exact source link '+note.placementId);
   }
   const newNotes=prepared.additions.filter(o=>o.sectionRef===ref).map(o=>o.after),representative=ref.endsWith(' 1')||expected.hebrewOnly;
   const toOpen=newNotes.length?newNotes:representative?native.slice(0,1).map(x=>x.note):[];
   if(connections.length&&representative)toOpen.push(all.find(n=>n.placementId===connections[0].placementId));
   for(const note of toOpen){
    const key='[data-note-key="'+note.placementId+'"]',marker=section.locator('.seg-il .ph-he button'+key),box=section.locator('.seg-il .reader-footnote'+key);
    await marker.click();await box.waitFor({state:'visible'});assert.equal(await marker.getAttribute('aria-expanded'),'true');assert(await box.evaluate(e=>e.scrollWidth<=e.clientWidth+2),'Clipped footnote '+note.placementId);
    if(newNotes.includes(note)){
     const anchor=await marker.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element.closest('.ph-he'));range.setEndBefore(element);const before=range.cloneContents();before.querySelectorAll('.footnote-marker,.reader-footnote').forEach(n=>n.remove());return before.textContent;});assert.equal(anchor,note.heAnchorPrefix,'Exact new source anchor '+note.placementId);
    }
    const source=note.sources?.[0];
    if(source&&!source.openExternal&&representative){const link=box.locator('a[href="'+source.url.replace(/"/g,'\\"')+'"]').first();await link.click();await page.locator('#panel .panel-head .ttl').waitFor({state:'visible'});assert.equal(await page.locator('#panel .panel-head .ttl').textContent(),source.readerRef||source.ref);await page.locator('#pClose').click();}
    if(representative){await marker.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,(live?'live':'candidate')+'-'+ref.replace(/[^A-Za-z0-9]+/g,'-')+'-'+width+'.png'),fullPage:false});}
    await marker.click();await box.waitFor({state:'hidden'});
   }
   if(representative&&all.length){
    await page.locator('#setBtn').click();await page.locator('#settings .seg-ctl[data-pref="lang"] button[data-v="he"]').click();await page.locator('#setBtn').click();
    const n=all[0],key='[data-note-key="'+n.placementId+'"]',mark=section.locator('.seg-he button'+key),box=section.locator('.segment-annotations > .reader-footnote'+key);await mark.click();await box.waitFor({state:'visible'});assert.deepEqual(await box.locator('.annotation-text').allTextContents(),n.paragraphs.map(p=>p.text));await mark.click();
    await page.locator('#setBtn').click();await page.locator('#settings .seg-ctl[data-pref="lang"] button[data-v="bi"]').click();await page.locator('#setBtn').click();
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,ref+' horizontal overflow');
   checks.push({section:ref,nativeNotes:native.length,existingKisveiNotes:connections.length,newNotes:newNotes.length,quotedTextAndLinks:true,hebrewAuthorTextUnchanged:true,uniqueHebrewMarkers:true});
  }
  report.viewports.push({width,sections:checks});await context.close();console.log(JSON.stringify({width,verifiedSections:checks.length}));
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.failure=error.message;throw error;}finally{fs.writeFileSync(path.join(artifacts,(live?'live':'candidate')+'-browser-report.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({ok:true,sections:57,viewports:2,release:pack.release}));

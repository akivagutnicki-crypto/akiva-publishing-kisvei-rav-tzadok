import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {loadPack,validatePack,verifyPublication,RELEASE} from '../scripts/publish-pri-bnl-parallels.mjs';
import {plain,notesOf} from '../scripts/pri-parsha-review-core.mjs';

const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);assert(i<0||args[i+1]&&!args[i+1].startsWith('--'),'Missing value for '+key);return i<0?fallback:args[i+1];};
const root=path.resolve(option('--root',process.env.AKIVA_ROOT||'dist')),live=option('--url',null);
const artifacts=path.resolve(option('--artifacts','artifacts/pri-bnl-parallels'));
const prepared=loadPack(),{pack,additions,reanchors,materialized,removedDynamic,legacy}=prepared;
assert.equal(pack.sections.length,36);
for(const[key,entries]of [['newNotes',additions],['staticReanchoredNotes',reanchors],['materializedDynamicNotes',materialized],['removedDynamicNotes',removedDynamic]])assert.equal(entries.length,pack.audit[key],'Audited '+key);
assert.equal(legacy.length,157,'Every previously rendered directed quotation is accounted for');
assert.equal(materialized.length+removedDynamic.length,legacy.length);

const changedEntries=p=>{const v=validatePack(p);return{...v,changed:[...v.additions,...v.reanchors,...v.materialized]};};
let guards=0;
const reject=(label,mutate,expected)=>{const bad=structuredClone(pack);mutate(bad);assert.throws(()=>validatePack(bad),expected,label);guards++;};
reject('Changing author Hebrew must fail',p=>{p.sections[0].after.find(r=>r.p).p[0][0]+=' תוספת';});
reject('Changing author English must fail',p=>{p.sections[0].after.find(r=>r.p).p[0][1]+=' Added words.';});
reject('A primary source coordinate cannot be moved even with a proposed audit',p=>{const n=notesOf(p.sections[0].after).find(e=>e.note.placementId==='PT-0002-1').note;n.heCharOffset--;n.heAnchorPrefix=n.heAnchorPrefix.slice(0,-1);p.staticReanchors.push({placementId:n.placementId,reason:'An invented primary-source move must be rejected.'});p.audit.staticReanchoredNotes++;},/Primary source notes and their coordinates are immutable/);
if(additions.length){
 reject('A bad exact Hebrew anchor must fail',p=>{changedEntries(p).additions[0].note.heAnchorPrefix+='X';});
 reject('Missing primary source evidence must fail',p=>{p.sourceEvidence=[];});
 reject('An unknown source quotation must fail',p=>{changedEntries(p).additions[0].note.reviewedSourceExcerpt.he='ציטוט שמעולם לא היה';});
 reject('Every new note requires its reviewed relevance and completed-point rationale',p=>{p.newNotesAudit=[];});
}
if(additions.length>1)reject('A repeated quotation cannot be introduced as another new parallel',p=>{const a=changedEntries(p).additions;for(const key of ['reviewedSourceExcerpt','sources','paragraphs'])a[1].note[key]=structuredClone(a[0].note[key]);});
if(reanchors.length){
 reject('An existing quotation cannot change during a move',p=>{changedEntries(p).reanchors[0].note.paragraphs[0].text+=' X';});
 reject('A static move needs its reviewed audit entry',p=>{p.staticReanchors.shift();});
 reject('A static move needs its exact completed-point anchor',p=>{changedEntries(p).reanchors[0].note.heAnchorPrefix+='X';});
}
if(materialized.length){
 reject('An imported quotation must retain its exact paragraph',p=>{changedEntries(p).materialized[0].note.paragraphs[0].text+=' X';});
 reject('An imported quotation must retain its primary Hebrew',p=>{changedEntries(p).materialized[0].note.reviewedSourceExcerpt.he+=' תוספת';});
 reject('An imported quotation cannot invent a number',p=>{changedEntries(p).materialized[0].note.number=999999;});
 reject('An imported quotation cannot invent a source identity',p=>{changedEntries(p).materialized[0].note.sourceId+='-invented';});
 reject('An imported quotation cannot invent a placement identity',p=>{changedEntries(p).materialized[0].note.placementId+='-invented';});
 reject('An imported quotation requires its runtime duplicate-suppression identity',p=>{delete changedEntries(p).materialized[0].note.connectionIdeaId;});
 reject('An imported quotation cannot invent a directed connection identity',p=>{changedEntries(p).materialized[0].note.connectionIdeaId+='-invented';});
 reject('An imported quotation needs its exact completed-point anchor',p=>{changedEntries(p).materialized[0].note.heAnchorPrefix+='X';});
 reject('Every retained legacy note must actually be materialized',p=>{const e=changedEntries(p).materialized[0];e.row.footnotes=e.row.footnotes.filter(n=>n!==e.note);});
}
if(removedDynamic.length)reject('Removed directed quotations require explicit runtime suppression',p=>{p.suppressConnectionIds=[];});
if(pack.staticRemovals.length)reject('A removed static duplicate needs its audit entry',p=>{p.staticRemovals.shift();});
for(const removal of pack.staticRemovals.filter(e=>e.equivalentExcerpt)){
 const proof=p=>p.staticRemovals.find(e=>e.placementId===removal.placementId).equivalentExcerpt;
 reject('An edition-equivalent duplicate requires its reviewed proof',p=>{delete p.staticRemovals.find(e=>e.placementId===removal.placementId).equivalentExcerpt;},/independently reviewed edition-equivalence proof/);
 reject('The removed edition Hebrew must match its proof hash',p=>{proof(p).beforeHebrewSha256='0'.repeat(64);},/Removed source-edition Hebrew differs/);
 reject('The retained edition Hebrew must match its proof hash',p=>{proof(p).retainedHebrewSha256='0'.repeat(64);},/Retained source-edition Hebrew differs/);
 reject('The retained equivalent quotation must actually exist',p=>{proof(p).retainedPlacementId='INVENTED-retained-quotation';},/Equivalent retained quotation does not exist/);
}

// This assertion is independent of the validator's classification: imports keep
// the actual prior reader projection, including scoped numbers and linked runs.
for(const entry of materialized){
 const original=legacy.find(e=>e.id===entry.note.connectionIdeaId);assert(original);
 assert.equal(entry.note.number,original.number);assert.equal(entry.note.sourceId,original.placementId);assert.equal(entry.note.placementId,original.placementId);
 assert.deepEqual(entry.note.paragraphs,[original.quotationParagraph]);
 for(const key of ['ref','he','en'])assert.equal(entry.note.reviewedSourceExcerpt[key],original[key]);
}
const countSummary={release:RELEASE,reviewedSections:36,negativeGuards:guards,newNotes:additions.length,staticReanchoredNotes:reanchors.length,materializedDynamicNotes:materialized.length,removedDynamicNotes:removedDynamic.length};
if(args.includes('--guards-only')){console.log(JSON.stringify({ok:true,...countSummary}));process.exit(0);}
const proof=verifyPublication(root,prepared);
if(args.includes('--data-only')){console.log(JSON.stringify({...proof,negativeGuards:guards}));process.exit(0);}

const tidy=s=>String(s).replace(/\s+/g,' ').trim(),unspaced=s=>String(s).replace(/\s/g,'');
const changed=[...additions,...reanchors,...materialized];
fs.mkdirSync(artifacts,{recursive:true});
let playwright;try{playwright=await import('playwright');}catch{assert(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'Playwright runtime path is required');playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
let server,browser,base=live?.replace(/\/?$/,'/');
if(!base){
 server=http.createServer((request,response)=>{try{const name=decodeURIComponent(new URL(request.url,'http://local').pathname),target=path.resolve(root,'.'+name);assert(target===root||target.startsWith(root+path.sep));const file=fs.statSync(target).isDirectory()?path.join(target,'index.html'):target;response.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(response);}catch{response.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/library/';
}
const report={ok:false,...countSummary,proof,viewports:[],errors:[]};
try{
 browser=await playwright.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
 for(const[width,layout]of [[1280,'side'],[390,'inter']]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:960},hasTouch:width===390,serviceWorkers:'block'});
  await context.addInitScript(layout=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify(layout));window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};},layout);
  await context.route(url=>url.origin!==new URL(base).origin,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push({width,error:error.message}));const checks=[],screenshots=new Set();
  for(const expected of pack.sections){
   const ref=expected.sectionRef,rows=expected.after.filter(r=>r.p),entries=changed.filter(e=>e.sectionRef===ref),expectedNotes=notesOf(expected.after).map(e=>e.note);
   await page.goto(base+'#/read/'+encodeURIComponent(ref).replace(/%20/g,'_'),{waitUntil:'domcontentloaded'});
   await page.waitForFunction(ref=>[...document.querySelectorAll('.sec')].some(s=>s.dataset.ref===ref&&s.dataset.connectionFootnotesMounted==='true'),ref,{timeout:60000});
   // Routing performs a first-visit preference migration. Select the real UI
   // after mounting so every test actually exercises the requested layout.
   await page.locator('#setBtn').click();
   await page.locator('#settings .seg-ctl[data-pref="lang"] button[data-v="bi"]').click();
   await page.locator('#settings .seg-ctl[data-pref="layout"] button[data-v="'+layout+'"]').click();
   await page.locator('#setBtn').click();
   assert.equal(await page.locator('#text').getAttribute('data-lang'),'bi',ref+' bilingual view');
   assert.equal(await page.locator('#text').getAttribute('data-layout'),layout,ref+' selected layout');
   const section=page.locator('.sec[data-ref="'+ref+'"]');
   assert.equal(await section.getAttribute('data-connected-ideas-status'),'checked',ref+' connected source verification');
   const snapshot=await section.evaluate(element=>{
    const author=e=>{const x=e.cloneNode(true);x.querySelectorAll('.footnote-marker,.reader-footnote,.subhead').forEach(n=>n.remove());return x.textContent;};
    const markers=selector=>[...element.querySelectorAll(selector)].map(e=>({id:e.dataset.noteKey,number:Number(e.dataset.fn),connectionId:e.dataset.connectionId||null}));
    return{he:[...element.querySelectorAll('.seg-il .ph-he')].map(author),en:[...element.querySelectorAll('.seg-il .ph-en')].map(author),enMarkers:element.querySelectorAll('.seg-il .ph-en button[data-note-key],.seg-en button[data-note-key]').length,inline:markers('.seg-il .ph-he button[data-note-key]'),flat:markers('.seg-he button[data-note-key]')};
   });
   assert.deepEqual(snapshot.he.map(tidy),rows.flatMap(r=>r.p.map(p=>tidy(plain(p[0])))),ref+' original author Hebrew');
   assert.deepEqual(snapshot.en.map(tidy),rows.flatMap(r=>r.p.map(p=>tidy(plain(p[1])))),ref+' original author English');
   assert.equal(snapshot.enMarkers,0,ref+' markers occur only in Hebrew');
   const projected=expectedNotes.map(n=>({id:n.placementId,number:n.number,connectionId:n.connectionIdeaId||null})),byId=list=>list.slice().sort((a,b)=>a.id.localeCompare(b.id));
   for(const family of ['inline','flat']){
    assert.deepEqual(byId(snapshot[family]),byId(projected),ref+' exact '+family+' marker inventory without dynamic duplicates');
    assert.equal(new Set(snapshot[family].map(n=>n.id)).size,snapshot[family].length,ref+' unique '+family+' placement identities');
    assert.equal(new Set(snapshot[family].map(n=>n.number)).size,snapshot[family].length,ref+' unique '+family+' note numbers within section');
   }
   for(const id of pack.suppressConnectionIds)assert.equal(await section.locator('[data-connection-id="'+id+'"]').count(),0,ref+' removed directed duplicate '+id);
   for(const removal of pack.staticRemovals)assert.equal(await section.locator('[data-note-key="'+removal.placementId+'"]').count(),0,ref+' removed static duplicate '+removal.placementId);
   for(const entry of entries){
    const{note,row}=entry,key='[data-note-key="'+note.placementId+'"]',inline=section.locator('.seg-il .ph-he button'+key),flat=section.locator('.seg-he button'+key);
    assert.equal(await inline.count(),1,ref+' unique inline marker '+note.number);assert.equal(await flat.count(),1,ref+' unique running Hebrew marker '+note.number);
    for(const marker of [inline,flat]){assert.equal(Number(await marker.getAttribute('data-fn')),note.number);assert.equal(await marker.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," seg ")][1]').getAttribute('data-ref'),entry.originRef,ref+' exact destination paragraph '+note.number);}
    const prefix=await inline.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element.closest('.ph-he'));range.setEndBefore(element);const before=range.cloneContents();before.querySelectorAll('.footnote-marker,.reader-footnote,.subhead').forEach(n=>n.remove());return before.textContent;});
    assert.equal(prefix,note.heAnchorPrefix,ref+' exact phrase prefix '+note.number);
    const flatPrefix=await flat.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element.closest('.seg-he'));range.setEndBefore(element);const before=range.cloneContents();before.querySelectorAll('.footnote-marker,.reader-footnote,.subhead').forEach(n=>n.remove());return before.textContent;});
    assert.equal(unspaced(flatPrefix),unspaced(row.p.slice(0,note.phraseIndex).map(p=>plain(p[0])).join(' ')+note.heAnchorPrefix),ref+' running Hebrew prefix '+note.number);
    if(note.connectionIdeaId){
     assert.equal(await inline.getAttribute('data-connection-id'),note.connectionIdeaId);assert.equal(await flat.getAttribute('data-connection-id'),note.connectionIdeaId);
     assert.equal(await section.locator('.seg-il .ph-he button[data-connection-id="'+note.connectionIdeaId+'"]').count(),1,ref+' no remounted inline legacy source');
     assert.equal(await section.locator('.seg-he button[data-connection-id="'+note.connectionIdeaId+'"]').count(),1,ref+' no remounted running Hebrew legacy source');
    }
    const useInline=layout==='inter',marker=useInline?inline:flat,box=section.locator((useInline?'.seg-il .reader-footnote':'.segment-annotations > .reader-footnote')+key);
    await marker.click();await box.waitFor({state:'visible'});assert.equal(await marker.getAttribute('aria-expanded'),'true');
    assert.deepEqual(await box.locator('.annotation-text').allTextContents(),note.paragraphs.map(p=>p.text),ref+' complete quotation paragraphs '+note.number);
    const links=await box.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>({href:n.getAttribute('href'),text:n.textContent,readerRef:n.getAttribute('data-reader-ref')})));
    for(const paragraph of note.paragraphs)for(const run of paragraph.rich||[])if(run.href)assert(links.some(a=>a.href===run.href&&a.text===run.text),ref+' exact linked quotation citation '+note.number);
    for(const source of note.sources){const link=links.find(a=>a.href===source.url);assert(link,ref+' primary citation link '+note.number);if(source.readerRef)assert.equal(link.readerRef,source.readerRef,ref+' explicit source reader mapping '+note.number);}
    assert(await box.evaluate(e=>e.scrollWidth<=e.clientWidth+2),ref+' unclipped source quotation '+note.number);
    const parsha=ref.replace(/ \d+$/,'');if(!screenshots.has(parsha)){await page.screenshot({path:path.join(artifacts,(live?'live':'candidate')+'-'+parsha.replace(/[^A-Za-z0-9]+/g,'-')+'-'+width+'.png'),fullPage:false});screenshots.add(parsha);}
    await marker.click();await box.waitFor({state:'hidden'});
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,ref+' horizontal overflow');
   checks.push({section:ref,newNotes:additions.filter(e=>e.sectionRef===ref).length,staticReanchoredNotes:reanchors.filter(e=>e.sectionRef===ref).length,materializedDynamicNotes:materialized.filter(e=>e.sectionRef===ref).length,totalStaticNotes:expectedNotes.length,exactHebrewMarkers:true,completePopupQuotesAndLinks:true,authorTextUnchanged:true,noRuntimeDuplicates:true});
  }
  assert.equal(checks.length,36);for(const key of ['newNotes','staticReanchoredNotes','materializedDynamicNotes'])assert.equal(checks.reduce((n,c)=>n+c[key],0),pack.audit[key]);
  report.viewports.push({width,layout,sections:checks});await context.close();console.log(JSON.stringify({width,layout,verifiedSections:checks.length,...countSummary}));
 }
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.failure=error.message;throw error;}finally{fs.writeFileSync(path.join(artifacts,(live?'live':'candidate')+'-browser-report.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({ok:true,...countSummary,viewports:2,layouts:['side','inter']}));

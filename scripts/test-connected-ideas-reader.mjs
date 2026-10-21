#!/usr/bin/env node
// Browser coverage for the actual published thematic catalog and reader. This
// runs in the Pages workflow; canonical text files are served without edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {checkConnectionFootnotes} from './reader-connection-footnote-checks.mjs';
const require=createRequire(import.meta.url);
const ideas=require('../dist/library/connected-ideas.js');
const editions=require('../dist/library/source-editions.js');
const root=path.resolve('dist');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'library/connected-ideas/catalog.json')));
const artifacts=path.resolve('artifacts/connected-ideas');fs.mkdirSync(artifacts,{recursive:true});
const hash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const plain=value=>String(value || '').replace(/\s+/g,' ').trim();
const ids=records=>records.map(record=>record.id).sort();
const targetOrigin='Peri Tzadik, Lech Lecha 6:1';
const selected=ideas.forPassage(catalog.records,targetOrigin);
assert(selected.some(record=>record.school===ideas.SCHOOLS[0]) && selected.some(record=>record.school===ideas.SCHOOLS[1]),'The reviewed growth theme must retain both independently selected schools');
const selectedGroup=ideas.groups(selected)[0];
const leaves=node=>node.children?node.children.flatMap(leaves):[node];
const testLeaf=leaves(JSON.parse(fs.readFileSync(path.join(root,'library/data/peri-tzadik/toc.json'))).toc)
  .find(leaf=>leaf.ref==='Peri Tzadik, Lech Lecha 6');
assert(testLeaf?.interlinear);
const server=http.createServer((request,response)=>{
  let file=path.resolve(root,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
  try{
    if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    response.setHeader('Content-Type',{'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8'}[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  }catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const urlAt=process.argv.indexOf('--url');
const base=urlAt>=0?process.argv[urlAt+1].replace(/\/?$/,'/'):origin+'/library/';
const browser=await chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
const report={ok:false,sections:[],views:[],sourceRoutes:[]};
async function prepare(viewport,{catalogFailure=false,wrongEdition=false,staleContext=false}={}){
  const session=await browser.newContext({viewport,serviceWorkers:'block'});
  await session.addInitScript(()=>{
    localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));
    window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  });
  await session.route('https://**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===new URL(base).origin){await route.continue();return;}
    if(!/^(?:www\.)?sefaria\.org$/.test(url.hostname)){await route.abort();return;}
    if(url.pathname.startsWith('/api/links/')){await route.fulfill({json:[]});return;}
    const ref=decodeURIComponent(url.pathname.split('/texts/')[1] || '');
    const policy=editions.policyFor(ref);
    if(policy){
      assert.deepEqual(url.searchParams.getAll('version'),['source','english|'+policy.versionTitle]);
      assert.equal(url.searchParams.get('fill_in_missing_segments'),'0');
    }
    await route.fulfill({json:{ref,sectionRef:ref,sections:[],next:null,prev:null,book:policy?.book || ref,
      versions:[{language:'he',versionTitle:'Isolated Hebrew interface fixture',text:'טקסט למבחן הממשק בלבד'},
        {language:'en',versionTitle:wrongEdition?'JPS wrong-edition fixture':policy?.versionTitle || 'Isolated English interface fixture',
          text:'Isolated source text for interface verification.'}]}});
  });
  if(catalogFailure)await session.route('**/connected-ideas/catalog.json?*',route=>route.fulfill({status:503,body:'Unavailable fixture'}));
  if(staleContext){
    const file='library/data/peri-tzadik/'+testLeaf.id+'.json';
    const changed=JSON.parse(fs.readFileSync(path.join(root,file)));
    const last=changed.filter(item=>Array.isArray(item.p)).at(-1);
    // Change only a later paragraph. The selected opening quotation is intact.
    last.p.push(['בדיקת שינוי הקשר בממשק בלבד','Interface fixture: the surrounding discussion has changed.']);
    await session.route('**/'+file+'?*',route=>route.fulfill({json:changed}));
  }
  return session;
}
async function openFixtureCitation(page,ref){
  // The actual underlined-citation event opens the source viewer. The clearly
  // marked fixture exists only in this isolated browser document, never in a
  // published sefer; genuine canonical citation/footnote paths have their own test.
  await page.evaluate(ref=>{
    document.getElementById('source-edition-interface-fixture')?.remove();
    const anchor=document.createElement('a');anchor.id='source-edition-interface-fixture';
    anchor.className='cite';anchor.dataset.ref=ref;anchor.href='#';anchor.textContent='Interface fixture: '+ref;
    document.querySelector('.seg').appendChild(anchor);
  },ref);
  await page.locator('#source-edition-interface-fixture').click();
}
try{
  // Every reviewed forward and reciprocal placement must become a normal note.
  const audit=await prepare({width:1280,height:900}),page=await audit.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const book of catalog.coverage)for(const ref of book.reviewedSections){
    await page.goto(base+'#/read/'+hash(ref));
    const section=page.locator('.sec[data-ref="'+ref+'"]');
    report.sections.push(await checkConnectionFootnotes(page,section,ideas.forSection(catalog.records,ref)));
  }
  assert.deepEqual(errors,[]);await audit.close();
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const session=await prepare(viewport),page=await session.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    for(const ref of ['Peri Tzadik, Rosh Chodesh Kislev 1','Peri Tzadik, Lech Lecha 6','Tzidkat HaTzadik 2','Tzidkat HaTzadik 60','Tzidkat HaTzadik 252','Tzidkat HaTzadik 261','Tzidkat HaTzadik 264']){
      await page.goto(base+'#/read/'+hash(ref));
      const section=page.locator('.sec[data-ref="'+ref+'"]'),records=ideas.forSection(catalog.records,ref);
      const example=ref.startsWith('Tzidkat')?'tzidkat-'+ref.split(' ').at(-1):(ref.includes('Kislev')?'kislev':'lech-lecha');
      await checkConnectionFootnotes(page,section,records,{screenshot:path.join(artifacts,viewport.width+'-'+example+'-footnotes.jpg')});
      for(const layout of ['stack','side']){
        await page.locator('#setBtn').click();await page.locator('[data-pref="layout"] button[data-v="'+layout+'"]').click();await page.locator('#setBtn').click();
        await checkConnectionFootnotes(page,section,records);
      }
      await section.locator('.seg').first().locator('.num').click();
      await page.locator('#pContent .cat').first().waitFor();
      assert.equal(await page.locator('[data-cat^="Connected Ideas"],.reviewed-theme').count(),0,'The converted material remains in a popup');
      await page.locator('#pClose').click();
      await page.locator('#setBtn').click();await page.locator('[data-pref="layout"] button[data-v="inter"]').click();await page.locator('#setBtn').click();
    }
    report.views.push({viewport,layouts:['interlinear','stacked','side by side'],hebrewFootnotes:true});
    assert.deepEqual(errors,[]);await session.close();
  }

  // Exercise the shared live source-opening function for every preference
  // family. Separate integration tests cover actual citation/footnote clicks.
  const editionSession=await prepare({width:1280,height:900}),editionPage=await editionSession.newPage();
  await editionPage.goto(base+'#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
  await editionPage.locator('.seg-il .connection-idea-marker').first().waitFor();
  for(const ref of ['Genesis 12:1','Psalms 1:1','Rashi on Genesis 1:1:1','Rashi on Joshua 1:1:1','Rashi on Judges 1:1:1','Rashi on Ruth 1:1:1']){
    await openFixtureCitation(editionPage,ref);
    await editionPage.locator('.source-head .qe').waitFor({state:'visible'});
    const title=editions.policyFor(ref).versionTitle;
    assert.equal(await editionPage.locator('.source-head .connection-provenance').textContent(),title);
    assert.equal(await editionPage.locator('.source-head a').filter({hasText:'Sefaria'}).getAttribute('href'),editions.sourceUrl(ref));
    report.sourceRoutes.push({ref,edition:title});
    await editionPage.locator('#pClose').click();
  }
  await editionSession.close();
  const rejected=await prepare({width:1280,height:900},{wrongEdition:true}),rejectedPage=await rejected.newPage();
  await rejectedPage.goto(base+'#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
  await rejectedPage.locator('.seg-il .connection-idea-marker').first().waitFor();
  await openFixtureCitation(rejectedPage,'Genesis 12:1');
  await rejectedPage.locator('.source-head .source-missing[data-missing="en"]').waitFor({state:'visible'});
  assert.equal(await rejectedPage.locator('.source-head .qe').count(),0);
  assert.match(await rejectedPage.locator('.source-head .source-missing[data-missing="en"]').textContent(),/Metsudah Chumash/);
  await rejected.close();
  const failed=await prepare({width:1280,height:900},{catalogFailure:true}),failedPage=await failed.newPage();
  await failedPage.goto(base+'#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
  await failedPage.locator('.sec').waitFor({state:'visible'});
  await failedPage.getByText('Additional source footnotes could not be loaded.',{exact:true}).waitFor({state:'visible'});
  assert.equal(await failedPage.locator('.connected-outline,.reviewed-theme,.connection-idea-marker').count(),0);
  await failed.unroute('**/connected-ideas/catalog.json?*');
  await failedPage.getByRole('button',{name:'Retry source footnotes',exact:true}).click();
  await failedPage.locator('.seg-il .connection-idea-marker').first().waitFor();
  assert.equal(await failedPage.locator('.connected-ideas-load-error').count(),0);await failed.close();
  const stale=await prepare({width:1280,height:900},{staleContext:true}),stalePage=await stale.newPage();
  await stalePage.goto(base+'#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
  await stalePage.locator('.sec[data-connected-ideas-status="context-mismatch"]').waitFor({state:'visible'});
  assert.equal(await stalePage.locator('.connected-outline,.idea-anchor,.connection-idea-marker').count(),0,
    'An unchanged opening quotation must not approve a changed section');
  await stalePage.locator('.seg[data-ref="'+targetOrigin+'"] .seg-il .ph-en').first().click();
  await stalePage.locator('#pContent .cat').first().waitFor({state:'visible'});
  assert.equal(await stalePage.locator('[data-cat^="Connected Ideas"]').count(),0);
  await stalePage.locator('#pClose').click();
  await openFixtureCitation(stalePage,'Genesis 12:1');
  await stalePage.locator('.source-head .qe').waitFor({state:'visible'});
  assert.equal(await stalePage.locator('.reviewed-theme').count(),0);await stale.close();
  report.ok=true;report.wrongEditionRejected=true;report.catalogFailureReported=true;report.catalogRetryRecovered=true;
  report.changedContextRejected=true;
  fs.writeFileSync(path.join(artifacts,'reader-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

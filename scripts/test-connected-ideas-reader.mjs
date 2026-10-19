#!/usr/bin/env node
// Browser coverage for the actual published thematic catalog and reader. This
// runs in the Pages workflow; canonical text files are served without edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
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
const browser=await chromium.launch({headless:true});
const report={ok:false,sections:[],views:[],sourceRoutes:[]};
async function prepare(viewport,{catalogFailure=false,wrongEdition=false,staleContext=false}={}){
  const session=await browser.newContext({viewport,serviceWorkers:'block'});
  await session.addInitScript(()=>{
    localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));
    window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  });
  await session.route('https://**/*',async route=>{
    const url=new URL(route.request().url());
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
async function cards(page,records){
  const list=page.locator('#lItems .reviewed-theme');
  await list.last().locator('.quote .qe').waitFor({state:'visible'});
  assert.deepEqual((await list.evaluateAll(nodes=>nodes.map(node=>node.dataset.connectionId))).sort(),ids(records));
  for(const record of records){
    const card=page.locator('[data-connection-id="'+record.id+'"]');
    assert.equal(plain(await card.locator('.quote .qh').textContent()),plain(record.targetHebrew));
    assert.equal(plain(await card.locator('.quote .qe').textContent()),plain(record.targetEnglish));
    assert.equal(plain(await card.locator('.connection-explanation').textContent()),'How this develops the idea'+record.explanation);
    assert.equal(await card.locator('.quote').evaluate(node=>node.scrollHeight<=node.clientHeight+2),true,'The full thought is clipped');
    assert.equal(await card.locator('.source-missing').count(),0,'Reviewed bilingual source is incomplete');
  }
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
  // Every section claimed in the coverage manifest must actually display its
  // exact approved anchors in the shipped reader, including reviewed reverses.
  const audit=await prepare({width:1280,height:900}),page=await audit.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const book of catalog.coverage)for(const ref of book.reviewedSections){
    await page.goto(origin+'/library/#/read/'+hash(ref));
    const section=page.locator('.sec[data-ref="'+ref+'"]');
    await section.locator('.connected-outline').waitFor({state:'visible'});
    const expected=ideas.groups(ideas.forSection(catalog.records,ref));
    assert.equal(await section.locator('.connected-outline [data-idea-group]').count(),expected.length,'Wrong section outline: '+ref);
    for(const group of expected){
      const anchors=section.locator('.idea-anchor[data-idea-id="'+group.id+'"]');
      assert(await anchors.count()>=1,'Missing passage anchor: '+group.id);
      const inline=section.locator('.idea-phrase[data-idea-id="'+group.id+'"]');
      if(await inline.count()){
        const placement=await inline.evaluate(node=>({ref:node.closest('.seg').dataset.ref,
          index:[...node.closest('.seg').querySelectorAll('.seg-il .ph')].indexOf(node.closest('.ph'))}));
        assert.equal(placement.ref,group.originRef);assert.equal(placement.index,group.phraseIndex);
      }
    }
    report.sections.push({ref,anchors:expected.length});
  }
  assert.deepEqual(errors,[]);await audit.close();

  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const session=await prepare(viewport),page=await session.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/library/#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
    const outline=page.locator('.connected-outline');await outline.waitFor({state:'visible'});
    await outline.getByRole('button',{name:selectedGroup.title,exact:true}).click();
    await cards(page,selectedGroup.records);
    assert.equal(await page.locator('.theme-context h3').textContent(),selectedGroup.title);
    assert.equal(await page.locator('.theme-context p').textContent(),selectedGroup.summary);
    for(const school of ideas.SCHOOLS)assert(await page.getByRole('button',{name:school+' sources',exact:true}).isVisible());
    await page.screenshot({path:path.join(artifacts,viewport.width>600?'desktop-connected-ideas.jpg':'mobile-connected-ideas.jpg'),type:'jpeg',quality:90});
    await page.getByRole('button',{name:'English only',exact:true}).click();
    await page.getByRole('button',{name:'Ishbitz–Radzin sources',exact:true}).click();
    await cards(page,selectedGroup.records.filter(record=>record.school===ideas.SCHOOLS[1]));
    assert.equal(await page.locator('.quote .qh').first().isVisible(),false);
    await page.getByRole('button',{name:'Hebrew and English',exact:true}).click();
    await page.locator('#pClose').click();

    // The exact phrase anchor and section outline open the same reviewed set.
    const seg=page.locator('.seg[data-ref="'+targetOrigin+'"]');
    await seg.locator('.idea-phrase[data-idea-id="'+selectedGroup.id+'"] button').click();
    await cards(page,selectedGroup.records);await page.locator('#pClose').click();
    // Sidebar grouping is available to all works and displays the same text.
    await seg.locator('.seg-il .ph-en').first().click();
    await page.locator('#pContent .cat[data-cat="Connected Ideas · Kisvei Rav Tzadok"]').click();
    await cards(page,selected.filter(record=>record.school===ideas.SCHOOLS[0]));await page.locator('#pClose').click();
    // In stacked layout, the passage button stays next to its paragraph.
    await page.locator('#setBtn').click();await page.locator('[data-pref="layout"] button[data-v="stack"]').click();await page.locator('#setBtn').click();
    const fallback=page.locator('.idea-paragraph[data-idea-id="'+selectedGroup.id+'"] button');
    assert(await fallback.isVisible());await fallback.click();await cards(page,selectedGroup.records);
    const first=selectedGroup.records[0];
    await page.locator('[data-connection-id="'+first.id+'"] .explore-source').click();
    await page.locator('.source-head .qe').waitFor({state:'visible'});
    assert.equal(plain(await page.locator('.source-head .qe').textContent()),plain(first.targetEnglish),'Opening a parallel lost its reviewed translation');
    report.views.push({viewport,entryPoints:['section outline','exact phrase','sidebar','stacked paragraph','connected source']});
    assert.deepEqual(errors,[]);await session.close();
  }

  // Exercise the shared live source-opening function for every preference
  // family. Separate integration tests cover actual citation/footnote clicks.
  const editionSession=await prepare({width:1280,height:900}),editionPage=await editionSession.newPage();
  await editionPage.goto(origin+'/library/#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
  await editionPage.locator('.connected-outline').waitFor({state:'visible'});
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
  await rejectedPage.goto(origin+'/library/#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
  await rejectedPage.locator('.connected-outline').waitFor({state:'visible'});
  await openFixtureCitation(rejectedPage,'Genesis 12:1');
  await rejectedPage.locator('.source-head .source-missing[data-missing="en"]').waitFor({state:'visible'});
  assert.equal(await rejectedPage.locator('.source-head .qe').count(),0);
  assert.match(await rejectedPage.locator('.source-head .source-missing[data-missing="en"]').textContent(),/Metsudah Chumash/);
  await rejected.close();
  const failed=await prepare({width:1280,height:900},{catalogFailure:true}),failedPage=await failed.newPage();
  await failedPage.goto(origin+'/library/#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
  await failedPage.locator('.sec').waitFor({state:'visible'});
  await failedPage.getByText('Connected Ideas could not be loaded.',{exact:true}).waitFor({state:'visible'});
  assert.equal(await failedPage.locator('.connected-outline,.reviewed-theme').count(),0);
  await failed.unroute('**/connected-ideas/catalog.json?*');
  await failedPage.getByRole('button',{name:'Retry Connected Ideas',exact:true}).click();
  await failedPage.locator('.connected-outline').waitFor({state:'visible'});
  assert.equal(await failedPage.locator('.connected-ideas-load-error').count(),0);await failed.close();
  const stale=await prepare({width:1280,height:900},{staleContext:true}),stalePage=await stale.newPage();
  await stalePage.goto(origin+'/library/#/read/'+hash('Peri Tzadik, Lech Lecha 6'));
  await stalePage.locator('.sec[data-connected-ideas-status="context-mismatch"]').waitFor({state:'visible'});
  assert.equal(await stalePage.locator('.connected-outline,.idea-anchor').count(),0,
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

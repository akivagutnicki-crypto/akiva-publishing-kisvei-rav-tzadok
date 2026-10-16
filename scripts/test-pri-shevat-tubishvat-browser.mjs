// Canonical routes must open the reviewed edition, including on small screens.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readPriShevatTuBiShvat,sectionRef,sha256} from './pri-shevat-tubishvat.mjs';

const root=path.resolve('dist'),pack=readPriShevatTuBiShvat();
const server=http.createServer((req,res)=>{
  let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{
    if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8'})[path.extname(file)]||'application/octet-stream');
    res.end(fs.readFileSync(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const base=process.env.AKIVA_READER_URL||`http://127.0.0.1:${server.address().port}/library/`;
const hash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
try{
  for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block'});
    // All reviewed text and source indexes are local; external APIs are not a
    // dependency of this edition or of this UI check.
    await context.route('https://www.sefaria.org/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({he:[],text:[],versions:[]})}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'#/book/Peri_Tzadik');
    await page.locator('#toc a[href="#/read/Peri_Tzadik,_Tu_BiShvat_5"]').waitFor();
    for(const section of pack.sections){
      const ref=sectionRef(section);
      assert.equal(await page.locator(`#toc a[href="#/read/${hash(ref)}"]`).count(),1,'Duplicate/missing canonical TOC route '+ref);
    }
    for(const section of pack.sections){
      const ref=sectionRef(section),expectedPairs=section.paragraphs.flatMap(paragraph=>paragraph.pairs);
      await page.goto(base+'#/read/'+hash(ref));
      const rendered=page.locator(`#text > .sec[data-ref="${ref}"]`);
      await rendered.locator('.seg-il .ph-he').first().waitFor();
      assert.equal(await rendered.locator('.seg').count(),section.paragraphs.length,'Source paragraph boundaries changed in the DOM');
      assert.deepEqual(await rendered.locator('.seg-il .ph-he').allTextContents(),expectedPairs.map(pair=>pair.hebrew));
      assert.deepEqual(await rendered.locator('.seg-il .ph-en').allTextContents(),expectedPairs.map(pair=>pair.english));
      assert.equal(await rendered.locator('.seg-il .subhead').count(),section.paragraphs.reduce((n,paragraph)=>n+(paragraph.headings||[]).length,0));
      assert.equal(await rendered.locator('.source-note-trigger,.reader-footnote,.footnote-marker').count(),0,'Unexpected source footnotes');
      assert.ok((await rendered.locator('.sec-head').innerText()).includes(section.title));
      assert.ok(await rendered.locator('.sec-sub a[href^="https://www.sefaria.org/"]').count(),'Original Sefaria source link missing');
      const resolved=await page.evaluate(async ref=>{
        const section=await resolveLocal(ref);
        return {ref:section.sectionRef,paragraphs:section.phrases?.length,next:section.next,prev:section.prev,
          sourceUrl:section.sourceUrl,downloadDocx:section.downloadDocx,downloadDocxLabel:section.downloadDocxLabel,
          sources:(await libraryLinks(section,ref,true)).map(link=>link.sourceRef),
          paragraphSources:await Promise.all(section.phrases.map(async(_,index)=>
            (await libraryLinks(section,ref+':'+(index+1),false)).filter(link=>link.kind==='').map(link=>link.sourceRef)))};
      },ref);
      assert.equal(resolved.ref,ref);assert.equal(resolved.paragraphs,section.paragraphs.length);
      assert.equal(resolved.sourceUrl,pack.source.sections.find(s=>s.node===section.node&&s.chapter===section.chapter).sourceUrl);
      for(const connection of section.connections)assert.ok(resolved.sources.includes(connection.ref),'Verified source not returned by Connections: '+connection.ref);
      const pairedRefs=new Set(section.paragraphs.flatMap(paragraph=>paragraph.pairs)
        .flatMap(pair=>pair.links||[]).map(link=>link.ref));
      for(const [index,paragraph]of section.paragraphs.entries()){
        const expectedSources=new Set(paragraph.pairs.flatMap(pair=>pair.links||[]).map(link=>link.ref));
        if(index===0)for(const connection of section.connections)if(!pairedRefs.has(connection.ref))expectedSources.add(connection.ref);
        for(const ref of expectedSources)assert.ok(resolved.paragraphSources[index].includes(ref),'Paragraph Connections omitted '+ref);
        for(const ref of pairedRefs)if(!expectedSources.has(ref))assert.ok(!resolved.paragraphSources[index].includes(ref),'Pair source duplicated at the wrong paragraph: '+ref);
      }
      const download=section.downloadDocx||(pack.documents?.length===1?pack.documents[0].file:null);
      assert.equal(resolved.downloadDocx,download);
      assert.equal(await rendered.locator('.section-docx-link a[download]').count(),download?1:0);
      if(download){
        assert.match(await rendered.locator('.section-docx-link').innerText(),/complete interlinear Word edition/);
        assert.doesNotMatch(await rendered.locator('.section-docx-link').innerText(),/annotated/);
      }
      const indexed=pack.sections.findIndex(s=>sectionRef(s)===ref);
      if(indexed>0)assert.equal(resolved.prev,sectionRef(pack.sections[indexed-1]));
      if(indexed<pack.sections.length-1)assert.equal(resolved.next,sectionRef(pack.sections[indexed+1]));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Horizontal page overflow '+ref);
      if(await rendered.locator('.seg-il a.cite').count()){
        await rendered.locator('.seg-il a.cite').first().click();
        await page.locator('#pContent').waitFor({state:'visible'});
        assert.ok((await page.locator('#pContent').innerText()).trim());
        await page.locator('#pClose').click();
      }
      console.log(`PASS ${viewport.width}px canonical interlinear route ${ref}`);
    }
    for(const [from,button,to]of [
      ['Peri Tzadik, Rosh Chodesh Shvat 1','nextBtn','Peri Tzadik, Rosh Chodesh Shvat 2'],
      ['Peri Tzadik, Rosh Chodesh Shvat 6','nextBtn','Peri Tzadik, Tu BiShvat 1'],
      ['Peri Tzadik, Tu BiShvat 1','prevBtn','Peri Tzadik, Rosh Chodesh Shvat 6'],
      ['Peri Tzadik, Tu BiShvat 4','nextBtn','Peri Tzadik, Tu BiShvat 5']]){
      await page.goto(base+'#/read/'+hash(from));
      await page.locator(`#text > .sec[data-ref="${from}"] .ph-he`).first().waitFor();
      await page.locator('#'+button).click();
      await page.waitForURL(base+'#/read/'+hash(to));
      await page.locator(`#text > .sec[data-ref="${to}"] .ph-he`).first().waitFor();
    }
    const paragraph=await page.evaluate(async()=>{
      const section=await resolveLocal('Peri Tzadik, Rosh Chodesh Shvat 2:2');
      return {ref:section.sectionRef,highlight:section.highlight,paragraphs:section.phrases?.length};
    });
    assert.deepEqual(paragraph,{ref:'Peri Tzadik, Rosh Chodesh Shvat 2',highlight:'Peri Tzadik, Rosh Chodesh Shvat 2:2',paragraphs:2});
    for(const document of pack.documents||[]){
      const response=await page.request.get(base+document.file);assert.equal(response.status(),200);
      assert.equal(sha256(await response.body()),document.sha256,'Browser download differs from supplied Word document');
    }
    assert.deepEqual(errors,[]);await context.close();
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

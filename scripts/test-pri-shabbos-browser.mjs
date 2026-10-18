// Check the real imported edition in the reader on desktop and mobile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {readShabbos,sectionRef,plain} from './publish-pri-shabbos.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const pack=readShabbos(),at=process.argv.indexOf('--url');
let base=at>=0?process.argv[at+1]:null,server;
if(!base){
  const root=path.resolve('dist');
  server=http.createServer((request,response)=>{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
    if(pathname.endsWith('/'))file=path.join(file,'index.html');
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
    const mime={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
    response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}/library/`;
}
const toHash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const browser=await chromium.launch({headless:true,...(process.env.AKIVA_CHROME_EXECUTABLE?{executablePath:process.env.AKIVA_CHROME_EXECUTABLE}:{})});
const artifacts=path.resolve('shabbos-verification');fs.mkdirSync(artifacts,{recursive:true});
const report={base,sections:[],viewports:[],screenshots:[],errors:[]};
try{
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    await context.addInitScript(()=>{
      localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));
      // Verify one complete section at a time without infinite-scroll prefetch.
      window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
    });
    const origin=new URL(base).origin;
    await context.route(url=>url.origin!==origin,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(base+'#/book/Peri_Tzadik');
    await page.locator('.study-entry .thematic-toc').first().waitFor();
    for(const node of pack.nodes.filter(node=>node.depth===2))for(const chapter of node.chapters){
      const ref=sectionRef(node,chapter);
      const entry=page.locator('.study-entry .toc-chapter > a').filter({hasText:chapter.title});
      assert.equal(await entry.count(),1,'One descriptive contents entry for '+ref);
      assert.equal(await entry.getAttribute('href'),'#/read/'+toHash(ref));
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Contents overflow');
    const tocShot=`contents-${width}.png`;await page.screenshot({path:path.join(artifacts,tocShot)});report.screenshots.push(tocShot);
    const selected=width===1280?pack.nodes.flatMap(node=>node.chapters.map(chapter=>({node,chapter}))):[
      {node:pack.nodes[2],chapter:pack.nodes[2].chapters[0]},
      {node:pack.nodes[3],chapter:pack.nodes[3].chapters[6]}];
    for(const {node,chapter}of selected){
      const ref=sectionRef(node,chapter),expected=chapter.items.filter(item=>item.p);
      await page.goto(base+'#/read/'+toHash(ref));
      const section=page.locator(`.sec[data-ref="${ref}"]`);await section.locator('.seg-il .ph').first().waitFor();
      assert.equal(await section.locator('.seg').count(),expected.length,'Canonical paragraph count '+ref);
      assert.equal(await section.locator('.seg-il .ph').count(),expected.reduce((n,item)=>n+item.p.length,0),'No missing phrase pairs '+ref);
      assert.equal(await section.locator('.sec-head').innerText(),chapter.title);
      assert.equal(await section.locator('.sec-sub a').getAttribute('href'),chapter.sourceUrl);
      const sourceAnchors=expected.flatMap(item=>item.p).flat().reduce((n,html)=>n+(html.match(/<a\b[^>]*data-ref=/g)||[]).length,0);
      assert.equal(await section.locator('.seg-il a[data-ref]').count(),sourceAnchors,'Rendered Sefaria links '+ref);
      const lastPair=expected.at(-1).p.at(-1);
      assert.equal((await section.locator('.seg-il .ph-he').last().innerText()).replace(/\s/gu,''),plain(lastPair[0]).replace(/\s/gu,''));
      assert.equal((await section.locator('.seg-il .ph-en').last().innerText()).replace(/\s/gu,''),plain(lastPair[1]).replace(/\s/gu,''));
      const refs=await section.locator('.seg').evaluateAll(elements=>elements.map(element=>element.dataset.ref));
      assert.equal(new Set(refs).size,refs.length,'Duplicate canonical DOM anchors');
      const styles=await section.locator('.ph-en').first().evaluate(element=>{const style=getComputedStyle(element);return {align:style.textAlign,weight:style.fontWeight,font:style.fontFamily};});
      assert.equal(styles.align,'left');assert.equal(styles.weight,'700');assert.ok(styles.font.includes('Times New Roman'));
      assert.equal(await section.locator('.ph-he').first().evaluate(element=>getComputedStyle(element).fontWeight),'400');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Reader overflow '+ref);
      report.sections.push({ref,width,canonicalParagraphs:expected.length,phrasePairs:expected.reduce((n,item)=>n+item.p.length,0),sourceAnchors});
      if(node.depth===2&&(chapter.number===1||(width===390&&chapter.number===7))){
        const screenshot=`${node.ref.includes('Kuntres')?'kuntres':'kedushas'}-${chapter.number}-${width}.png`;
        await page.screenshot({path:path.join(artifacts,screenshot)});report.screenshots.push(screenshot);
      }
    }
    // Follow a real subheading into a later original manuscript paragraph.
    const node=pack.nodes[2],chapter=node.chapters[0],item=chapter.items.find(item=>item.paragraphBreaks?.length&&item.inlineHeadings?.some(heading=>heading.phraseIndex>0));
    assert.ok(item);const heading=item.inlineHeadings.find(heading=>heading.phraseIndex>0);
    const params=new URLSearchParams({heading:heading.text,topic:String(heading.phraseIndex)});
    await page.goto(base+'#/read/'+toHash(sectionRef(node,chapter)+':'+item.n)+'?'+params);
    await page.locator('.subhead.flash:visible').waitFor();
    assert.equal(await page.locator('.subhead.flash:visible').getAttribute('data-topic-phrase-index'),String(heading.phraseIndex));
    report.viewports.push({width,status:'pass'});await context.close();
  }
  assert.deepEqual(report.errors,[]);report.status='pass';
  console.log(`PASS ${at>=0?'LIVE ':''}Pri Shabbos reader: all 16 sections on desktop, both works on mobile, exact phrase/link counts, descriptive contents, source URLs and subheading navigation.`);
}finally{
  fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
  await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
}

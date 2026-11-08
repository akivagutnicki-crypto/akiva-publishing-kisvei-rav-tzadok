// Exercise the real Reader, every imported chapter and all native note anchors.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const manifest=read('sources/akiva/overlays/pri-bereishis-20261108/manifest.json');
const root=path.resolve(process.env.BEREISHIS_SITE || 'dist');
const live=process.argv.includes('--url')?process.argv[process.argv.indexOf('--url')+1]:null;
let pw;try{pw=await import('playwright');}catch{pw=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const hash=r=>encodeURIComponent(r).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const compact=s=>s.replace(/\s+/g,' ').trim();
const plain=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
let server;let base=live;
if(!base){
  server=http.createServer((req,res)=>{
    try{
      let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
      assert(file.startsWith(root+path.sep));
      if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
      const types={'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
      res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/library/`;
}
if(!base.endsWith('/'))base+='/';
const report={edition:manifest.edition,live:!!live,viewports:[],pageErrors:[],ok:false};
const output='artifacts/pri-bereishis';fs.mkdirSync(output,{recursive:true});
let browser;
try{
  browser=await pw.chromium.launch({headless:true,...(process.env.AKIVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.AKIVA_CHROMIUM_EXECUTABLE}:{})});
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,serviceWorkers:'block'});
    await context.addInitScript(()=>{
      localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));
      window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
    });
    await context.route(u=>u.origin!==new URL(base).origin,r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
    const page=await context.newPage();page.setDefaultTimeout(30000);
    page.on('pageerror',e=>report.pageErrors.push({width,error:e.message}));
    await page.goto(base+'#/book/Peri_Tzadik',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelectorAll('#toc a[href^="#/read/"]').length>100);
    const hrefs=await page.locator('#toc a[href^="#/read/"]').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
    for(const section of manifest.sections)assert(hrefs.includes('#/read/'+hash(section.ref)),'Missing contents link '+section.ref);
    for(const volume of manifest.volumes)assert(await page.locator('a[download][href="downloads/'+volume.download+'"]').count(),'Word download missing');
    const samples=width===1280?manifest.sections:manifest.parashas.map(p=>manifest.sections.find(s=>s.parashah===p&&s.notes));
    const checks=[];
    for(const section of samples){
      const rows=read(`sources/akiva/overlays/pri-bereishis-20261108/${section.id}.json`).filter(x=>x.p);
      await page.goto(base+'#/read/'+hash(section.ref),{waitUntil:'domcontentloaded'});
      await page.waitForFunction(({ref,count})=>[...document.querySelectorAll('.sec')].some(s=>s.dataset.ref===ref&&s.querySelectorAll('.seg-il .ph').length===count),{ref:section.ref,count:section.pairs},{timeout:60000});
      const actual=await page.locator('.sec').evaluateAll((nodes,ref)=>{
        const s=nodes.find(x=>x.dataset.ref===ref);
        const paragraphs=[...s.querySelectorAll('.seg')].map(seg=>({n:Number(seg.dataset.i),pairs:[...seg.querySelectorAll('.seg-il .ph')].map(ph=>{
          const h=ph.querySelector('.ph-he').cloneNode(true),e=ph.querySelector('.ph-en').cloneNode(true);
          h.querySelectorAll('.footnote-marker').forEach(n=>n.remove());e.querySelectorAll('.reader-footnote').forEach(n=>n.remove());
          const markers=[...ph.querySelectorAll('.ph-he .footnote-marker')].map(b=>{
            const r=document.createRange();r.selectNodeContents(ph.querySelector('.ph-he'));r.setEndBefore(b);
            const frag=r.cloneContents();frag.querySelectorAll('.footnote-marker').forEach(n=>n.remove());
            return {number:Number(b.dataset.fn),key:b.dataset.noteKey,prefix:frag.textContent};
          });
          const notes=[...ph.querySelectorAll('.reader-footnote')].map(n=>({number:Number(n.dataset.fn),key:n.dataset.noteKey||'',paragraphs:[...n.querySelectorAll('.annotation-text')].map(p=>p.textContent),links:[...n.querySelectorAll('a[href]')].map(a=>a.getAttribute('href'))}));
          return {he:h.textContent,en:e.textContent,markers,notes};
        })}));
        return {paragraphs,englishMarkers:s.querySelectorAll('.seg-il .ph-en .footnote-marker').length,
          horizontalOverflow:document.documentElement.scrollWidth>innerWidth+8,
          download:s.querySelector('.section-docx-link a')?.getAttribute('href')};
      },section.ref);
      assert.equal(actual.paragraphs.length,rows.length,section.ref+' paragraph count');
      let markers=0;
      for(let i=0;i<rows.length;i++){
        const row=rows[i],ar=actual.paragraphs[i];assert.equal(ar.n,row.n);
        assert.equal(ar.pairs.length,row.p.length);
        for(let j=0;j<row.p.length;j++){
          const ap0=ar.pairs[j];
          // the reader's own connected-idea notes (IDEA-…) also attach to this Hebrew; check this edition's notes only
          const ap={...ap0,ideas:ap0.markers.filter(x=>!String(x.key).startsWith('BEREISHIS-')).length,
            markers:ap0.markers.filter(x=>String(x.key).startsWith('BEREISHIS-')),notes:ap0.notes.filter(x=>!x.key||x.key.startsWith('BEREISHIS-'))};assert.equal(ap.he,plain(row.p[j][0]),section.ref+' Hebrew');assert.equal(ap.en,plain(row.p[j][1]),section.ref+' English');
          const notes=(row.footnotes||[]).filter(n=>n.phraseIndex===j);markers+=ap.markers.length;
          assert.deepEqual(ap.markers.map(x=>[x.number,x.key,x.prefix]),notes.map(n=>[n.number,n.placementId,n.heAnchorPrefix]),section.ref+' exact rendered Hebrew anchors');
          assert.deepEqual(ap.notes.map(n=>[n.number,n.paragraphs.map(compact)]),notes.map(n=>[n.number,n.paragraphs.map(p=>compact(p.text))]),section.ref+' complete note text');
          for(let k=0;k<notes.length;k++){
            const urls=[...new Set(notes[k].paragraphs.flatMap(p=>p.rich.filter(r=>r.href).map(r=>r.href)))];
            assert.deepEqual([...new Set(ap.notes[k].links)],urls,section.ref+' source hyperlinks');
          }
        }
      }
      assert.equal(markers,section.notes);assert.equal(actual.englishMarkers,0);assert(!actual.horizontalOverflow,section.ref+' horizontal overflow');
      assert.equal(actual.download,'downloads/'+manifest.volumes.find(v=>v.volume===section.volume).download);
      if(section===manifest.sections.find(s=>s.parashah===section.parashah&&s.notes)){
        const selector='.sec[data-ref='+JSON.stringify(section.ref)+'] .seg-il .ph-he .footnote-marker';
        const marker=page.locator(selector).first();const key=await marker.getAttribute('data-note-key');
        if(width===390)await marker.tap();else await marker.click();
        const opened=page.locator('.seg-il .reader-footnote[data-note-key='+JSON.stringify(key)+']');
        await opened.waitFor({state:'visible'});assert((await opened.getAttribute('class')).includes('open'));
        if(['Bereishis','Toldos','Vayechi'].includes(section.parashah))await page.screenshot({path:`${output}/${live?'live':'local'}-${section.parashah}-${width}.png`});
        if(width===390)await marker.tap();else await marker.click();
        assert(!(await opened.getAttribute('class')).includes('open'));
      }
      checks.push({ref:section.ref,pairs:section.pairs,notes:markers});
    }
    report.viewports.push({width,sections:checks});await context.close();
  }
  assert.deepEqual(report.pageErrors,[]);report.ok=true;
}finally{
  fs.writeFileSync(`${output}/${live?'live':'local'}-browser.json`,JSON.stringify(report,null,2));
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
}
console.log(JSON.stringify({ok:report.ok,desktopSections:report.viewports[0]?.sections.length,mobileSections:report.viewports[1]?.sections.length,notes:report.viewports[0]?.sections.reduce((n,s)=>n+s.notes,0)}));

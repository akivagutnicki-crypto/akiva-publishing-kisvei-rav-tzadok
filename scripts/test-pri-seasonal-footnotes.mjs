// Checks the final output, not an intermediate build. --url checks the deployed reader.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';

const release='20261016-pri-seasonal-1407-v1';
const root='dist/library/';
const arg=process.argv.indexOf('--url'),live=arg>=0?process.argv[arg+1].replace(/\/?$/,'/'):null;
const sha=b=>createHash('sha256').update(b).digest('hex');
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
const supplied=JSON.parse(gunzipSync(fs.readFileSync('sources/akiva/pri-seasonal-supplied-20261016.json.gz')));
// Independently calculated from the user's uploaded Peri_Tzadik (3).json.
const uploadedContent=supplied.sections.flatMap(s=>s.items.flatMap(r=>(r.footnotes||[]).map(n=>[s.ref,r.n,n.number,n.paragraphs,n.sources])));
assert.equal(sha(canonical(uploadedContent)),'78788c0cd849450759d8928de03396bddd591deb202734c9e6e7d4576ecef086','Exact uploaded seasonal note content');
const targets=supplied.sections.map(s=>s.ref),expectedCounts=[27,16,10,29,28,15,11,52,69,16,32,32,10,13,20,54,15,21,10,40,62,44,11,21,23,12,12,27,11,19,10,74,82,35,50,31,65,63,145,49,29,12];
async function bytes(file){
  if(!live)return fs.readFileSync(root+file);
  const r=await fetch(live+file+'?verify='+release,{cache:'no-store'});
  assert.ok(r.ok,`${r.status}: ${file}`);return Buffer.from(await r.arrayBuffer());
}
const read=async file=>JSON.parse(await bytes(file));
if(live){
  let ready=false;
  for(let i=0;i<20;i++){
    try{ready=(await read('pri-seasonal-footnotes-report.json')).release===release;}catch{}
    if(ready)break;
    await new Promise(r=>setTimeout(r,15000));
  }
  assert.ok(ready,'The live site did not publish the seasonal release');
}
const report=await read('pri-seasonal-footnotes-report.json'),toc=await read('data/peri-tzadik/toc.json');
assert.equal(report.release,release);assert.equal(report.notes,1407);assert.equal(report.sections,42);assert.equal(report.totalBookNotes,3240);
assert.equal(report.sourceSHA256,'52e53d19420823db61c6772770e84cd8e1719596b736ee7affd3b0540d020eba');
const leaves=[];function walk(n){if(n.ref)leaves.push(n);for(const c of n.children||[])walk(c);}walk(toc.toc);
const expectations=[],seenNumbers=new Set(),links=await read('data/peri-tzadik/links.json');
for(const [index,s]of supplied.sections.entries()){
  const matches=leaves.filter(l=>l.interlinear&&l.ref===s.ref);assert.equal(matches.length,1,s.ref);
  const leaf=matches[0],file='data/peri-tzadik/'+leaf.id+'.json',raw=await bytes(file),rows=JSON.parse(raw);
  const entry=report.chapters.find(c=>c.ref===s.ref);assert.equal(sha(raw),entry.sha256,'Published chapter checksum '+s.ref);
  const body=rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='footnotes')));
  assert.equal(sha(canonical(body)),entry.bodySHA256,'Existing text, headings and inline links '+s.ref);
  const notes=rows.flatMap(r=>r.footnotes||[]);
  assert.equal(notes.length,expectedCounts[index]);assert.equal(notes.length,entry.notes);
  const wanted=s.items.filter(r=>r.p),actual=rows.filter(r=>r.p);
  assert.equal(actual.length,wanted.length);
  for(const sr of wanted){
    const r=actual.find(r=>r.n===sr.n);assert.ok(r);
    assert.equal(r.footnotes.length,(sr.footnotes||[]).length);
    for(const [k,n]of r.footnotes.entries()){
      const source=sr.footnotes[k];assert.equal(n.provenance.uploadedNumber,source.number);
      assert.equal(n.provenance.importRelease,release);
      assert.deepEqual(n.paragraphs,source.paragraphs,'Complete supplied English');
      assert.deepEqual(n.sources,source.sources,'Supplied source hyperlinks');
      assert.ok(!seenNumbers.has(n.number),'Duplicate note number');seenNumbers.add(n.number);
      assert.equal(n.sourceId,'PT-'+String(n.number).padStart(4,'0'));
      assert.ok(n.heCharOffset>0&&n.heAnchorPrefix);
      for(const src of n.sources){
        const ref=src.ref.replace(/\s*\(§\d+\)$/,'').trim();
        assert.ok(links[s.ref].some(l=>l.a===s.ref+':'+r.n&&l.r===ref),'Missing paragraph connection '+ref);
      }
    }
  }
  expectations.push({ref:s.ref,file,leaf,rows,notes});
}
assert.equal(seenNumbers.size,1407);
if(!live){
  for(const [file,digest]of Object.entries(report.protectedFiles))assert.equal(sha(fs.readFileSync(root+'data/'+file)),digest,'Unrelated chapter or book changed '+file);
  const html=fs.readFileSync(root+'index.html','utf8'),sw=fs.readFileSync(root+'sw.js','utf8');
  assert.ok(html.includes(release));assert.ok(sw.includes('-pri-seasonal-1407-v1'));
  // The original Word downloads remain exact, even though the reader now has new source notes.
  if(process.argv.includes('--zips')){
    const {unzipSync}=createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
    const docReport=JSON.parse(fs.readFileSync(root+'pri-shevat-tubishvat-publication.json','utf8'));
    for(const name of ['downloads/rav-tzadok-library.zip','downloads/books/peri-tzadik.zip']){
      const zip=unzipSync(fs.readFileSync(root+name));
      const files=['data/peri-tzadik/toc.json','data/peri-tzadik/links.json',...expectations.map(e=>e.file),...Object.keys(report.protectedFiles).filter(f=>f.startsWith('peri-tzadik/')).map(f=>'data/'+f)];
      for(const f of files)assert.deepEqual(Buffer.from(zip[f]||[]),fs.readFileSync(root+f),'Missing or changed ZIP content '+f);
      for(const d of docReport.documents||[])assert.equal(sha(Buffer.from(zip[d.file]||[])),d.sha256,'Original Word edition '+name);
    }
    console.log('PASS offline ZIPs: all 42 seasonal teachings, 1407 supplied notes, protected Pri chapters, and exact original Word editions.');
  }
}
if(process.argv.includes('--data-only')||process.argv.includes('--zips')){
  console.log('PASS final seasonal data: 42 teachings; 1407 complete source notes; original body and other books preserved.');
  process.exit(0);
}
const {chromium}=await import('playwright');
let server,base=live;
if(!base){
  const dist=path.resolve('dist');server=http.createServer((req,res)=>{
    let f=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!f.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
    try{if(fs.statSync(f).isDirectory())f=path.join(f,'index.html');
      res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.json':'application/json;charset=utf-8','.css':'text/css;charset=utf-8'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));
    }catch{res.writeHead(404).end();}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/library/`;
}
const hash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const browser=await chromium.launch({headless:true}),results=[];
fs.mkdirSync('seasonal-verification',{recursive:true});
try{
  for(const mobile of [true,false]){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'#/book/Peri_Tzadik',{waitUntil:'domcontentloaded'});
    // Original Hebrew entries intentionally share canonical routes. Test uniqueness
    // within the visible interlinear edition, not across both separate editions.
    const studyToc=page.locator('#toc > .study-entry');
    await studyToc.locator('a[href="#/read/Peri_Tzadik,_Tu_BiShvat_5"]').waitFor({state:'visible',timeout:60000});
    assert.equal(await studyToc.count(),1,'One interlinear contents group');
    for(const e of expectations){
      const entry=studyToc.locator('a[href="#/read/'+hash(e.ref)+'"]');
      assert.equal(await entry.count(),1,'Unique interlinear contents route '+e.ref);
      assert.ok(await entry.isVisible(),'Visible interlinear contents route '+e.ref);
    }
    for(const e of expectations){
      await page.goto(base+'#/read/'+hash(e.ref),{waitUntil:'domcontentloaded'});
      const sec=page.locator('#text > .sec[data-ref="'+e.ref+'"]');
      const markers=sec.locator('.seg-il .ph-he button.footnote-marker');
      await markers.first().waitFor({state:'visible',timeout:60000});
      assert.equal(await markers.count(),e.notes.length,'Visible Hebrew note markers '+e.ref);
      assert.equal(await sec.locator('.seg-il .ph-en button.footnote-marker').count(),0);
      const boxes=sec.locator('.seg-il .reader-footnote');assert.equal(await boxes.count(),e.notes.length);
      const rendered=await boxes.evaluateAll(bs=>Object.fromEntries(bs.map(b=>[b.dataset.fn,[...b.querySelectorAll('.annotation-text')].map(p=>p.textContent)])));
      for(const n of e.notes)assert.deepEqual(rendered[n.number],n.paragraphs.map(p=>p.rich?.length?p.rich.map(r=>r.text||'').join(''):p.text),'Full rendered English '+e.ref+' #'+n.number);
      const samples=[e.notes[0],e.notes.at(-1)];
      for(const n of samples){
        const trigger=sec.locator('.seg-il .ph-he button[data-fn="'+n.number+'"]').first(),box=sec.locator('.seg-il .reader-footnote[data-fn="'+n.number+'"]').first();
        await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'true');assert.ok(await box.isVisible());
        assert.ok(await box.locator('a[href^="https://www.sefaria.org/"]').count()>0,'Source link opens from note');
        if(n===e.notes[0]&&/ 1$/.test(e.ref)){
          const group=e.ref.includes('Kislev')?'kislev':e.ref.includes('Chanukah')?'chanukah':e.ref.includes('Tu BiShvat')?'tu-bishvat':'shevat';
          await page.screenshot({path:'seasonal-verification/'+(live?'live-':'')+(mobile?'mobile-':'desktop-')+group+'.png'});
        }
        await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');
      }
      results.push({ref:e.ref,viewport:mobile?'mobile':'desktop',hebrewMarkers:e.notes.length,englishMarkers:0,allRenderedNotesMatched:true,popupsOpened:2});
      console.log('PASS '+(live?'LIVE ':'')+(mobile?'mobile ':'desktop ')+e.ref+': '+e.notes.length+' notes');
    }
    assert.deepEqual(errors,[]);await context.close();
  }
  if(live){
    // Installed/PWA behavior: allow the real service worker, then reopen the page.
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'}),page=await context.newPage();
    const url=base+'#/read/Peri_Tzadik,_Rosh_Chodesh_Shvat_1';
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('#text > .sec[data-ref="Peri Tzadik, Rosh Chodesh Shvat 1"] .seg-il .ph-he button.footnote-marker').first().waitFor({timeout:60000});
    await page.reload({waitUntil:'domcontentloaded'});
    const ms=page.locator('#text > .sec[data-ref="Peri Tzadik, Rosh Chodesh Shvat 1"] .seg-il .ph-he button.footnote-marker');
    await ms.first().waitFor({timeout:60000});assert.equal(await ms.count(),74);await context.close();
  }
}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
fs.writeFileSync('seasonal-verification/'+(live?'live-':'')+'report.json',JSON.stringify({release,live:live||false,sections:42,notes:1407,uploadedContentSHA256:sha(canonical(uploadedContent)),results},null,2));
console.log('PASS '+(live?'LIVE':'FINAL')+' seasonal reader: all 1407 notes rendered with complete supplied English; 42 mobile and 42 desktop routes; source popups open.');

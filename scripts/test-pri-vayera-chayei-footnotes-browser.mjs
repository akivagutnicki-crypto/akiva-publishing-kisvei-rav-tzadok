// Verify visible Hebrew-only markers, complete supplied English, and source links.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';

const at=process.argv.indexOf('--url');
const live=at>=0 ? process.argv[at+1].replace(/\/?$/,'/') : null;
const targets=[...Array.from({length:7},(_,i)=>`Peri Tzadik, Vayera ${i+1}`),...Array.from({length:11},(_,i)=>`Peri Tzadik, Chayei Sara ${i+1}`)];
const counts=[194,41,43,51,21,43,16,108,57,25,30,62,38,60,24,37,52,27];
const release='20261016-pri-vayera-chayei-footnotes-929';
const dir='dist/library/';
async function read(file){
  if(!live) return JSON.parse(fs.readFileSync(dir+file,'utf8'));
  const r=await fetch(live+file+'?verify='+release,{cache:'no-store'});
  assert.ok(r.ok,`${r.status}: ${file}`);return r.json();
}
if(live){
  let ready=false;
  for(let attempt=0;attempt<20;attempt++){
    try{const r=await read('pri-vayera-chayei-footnotes-report.json');ready=r.release===release&&r.suppliedNotes===929;}catch{}
    if(ready)break;
    console.log('Waiting for published footnote release, attempt '+(attempt+1));
    await new Promise(r=>setTimeout(r,15000));
  }
  assert.ok(ready,'Live Pages did not serve the requested release');
}
const toc=await read('data/peri-tzadik/toc.json');
const leaves=[];
function walk(n){if(n?.ref)leaves.push(n);for(const c of n?.children||[])walk(c);}
walk(toc.toc);
const expectations=[];
for(let i=0;i<targets.length;i++){
  const ref=targets[i],matches=leaves.filter(l=>l.ref===ref&&l.interlinear);
  assert.equal(matches.length,1,'Unique interlinear contents entry '+ref);
  const rows=await read('data/peri-tzadik/'+matches[0].id+'.json');
  const notes=rows.flatMap(r=>r.footnotes||[]);
  const imported=notes.filter(n=>n.provenance?.importRelease===release);
  assert.equal(imported.length,counts[i],ref);
  assert.ok(rows.filter(r=>r.h).length>=3,'Existing headings '+ref);
  for(const n of imported){
    assert.equal(n.paragraphs.length,4);assert.equal(n.sources.length,3);
    assert.ok(n.heAnchorPrefix&&n.heCharOffset>0);
    for(const p of n.paragraphs)assert.equal(p.text,p.rich.map(r=>r.text).join(''));
  }
  expectations.push({ref,notes,imported,rows});
}
assert.equal(expectations.reduce((n,e)=>n+e.imported.length,0),929);
let server;
let base=live;
if(!live){
  const root=path.resolve('dist');
  server=http.createServer((req,res)=>{
    let f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    try{
      if(fs.statSync(f).isDirectory())f=path.join(f,'index.html');
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(f)]||'application/octet-stream');
      res.end(fs.readFileSync(f));
    }catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  base='http://127.0.0.1:'+server.address().port+'/library/';
}
const browser=await chromium.launch({headless:true});
const results=[];fs.mkdirSync('pri-verification',{recursive:true});
try{
  for(const mobile of [true,false]){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const selected=mobile?expectations:[expectations[0],expectations[7]];
    for(const e of selected){
      const hash=encodeURIComponent(e.ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
      await page.goto(base+'#/read/'+hash,{waitUntil:'domcontentloaded'});
      const sec=page.locator('#text > .sec[data-ref="'+e.ref+'"]');
      const marks=sec.locator('.seg-il .ph-he button.footnote-marker');
      await marks.first().waitFor({state:'visible',timeout:60000});
      assert.equal(await marks.count(),e.notes.length,'Every note visible '+e.ref);
      assert.equal(await sec.locator('.seg-il .ph-en button.footnote-marker').count(),0,'No English markers '+e.ref);
      assert.equal(await sec.locator('.seg-il .reader-footnote').count(),e.notes.length);
      const samples=[e.imported[0],e.imported.at(-1)];
      const multi=e.rows.find(r=>(r.footnotes||[]).some((n,i,a)=>a.some((m,j)=>i!==j&&m.phraseIndex===n.phraseIndex)));
      if(multi){const ns=multi.footnotes;const n=ns.find((n,i)=>ns.some((m,j)=>i!==j&&m.phraseIndex===n.phraseIndex));samples.push(n);}
      for(const n of [...new Map(samples.map(n=>[n.number,n])).values()]){
        const trigger=sec.locator('.ph-he button[data-fn="'+n.number+'"]').first();
        const box=sec.locator('.reader-footnote[data-fn="'+n.number+'"]').first();
        await trigger.click();
        assert.equal(await trigger.getAttribute('aria-expanded'),'true');
        assert.ok(await box.isVisible());
        assert.deepEqual(await box.locator('.annotation-text').allTextContents(),n.paragraphs.map(p=>p.text),'Full English popup '+e.ref+' #'+n.number);
        assert.ok(await box.locator('a[href^="https://www.sefaria.org/"]').count()>0,'Clickable source links');
        if(n===e.imported[0]&&(e===expectations[0]||e===expectations[7]))
          await page.screenshot({path:'pri-verification/'+(live?'live-':'')+(mobile?'mobile-':'desktop-')+(e===expectations[0]?'vayera':'chayei-sara')+'.png'});
        await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');
      }
      const r={ref:e.ref,viewport:mobile?'mobile':'desktop',markers:await marks.count(),englishMarkers:0,completePopupSamples:samples.length};
      results.push(r);console.log('PASS '+JSON.stringify(r));
    }
    assert.deepEqual(errors,[],'Reader JavaScript errors');await context.close();
  }
}finally{
  await browser.close();if(server)await new Promise(r=>server.close(r));
}
fs.writeFileSync('pri-verification/'+(live?'live-':'')+'report.json',JSON.stringify({release,live:live||false,notes:929,sections:18,results},null,2));
console.log('PASS '+(live?'LIVE':'LOCAL')+': 929 Hebrew-anchored notes, 18 sections, complete supplied English popups and links.');

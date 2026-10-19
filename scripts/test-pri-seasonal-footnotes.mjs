// Checks the final output, not an intermediate build. --url checks the deployed reader.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {readMissingFootnotes,recoverOriginalItems,hasImportedNotes,MISSING_FOOTNOTE_COUNT} from './import-pri-missing-footnotes.mjs';

const release='20261016-pri-seasonal-1407-v1';
const rootAt=process.argv.indexOf('--root');
const root=path.resolve(rootAt>=0?process.argv[rootAt+1]:'dist/library')+path.sep;
const afterParallelCleanup=process.argv.includes('--after-parallel-cleanup');
const cleanupReportAt=process.argv.indexOf('--cleanup-report');
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
// This final-stage mode is explicit. The normal import checks still require
// every supplied paragraph and source, including the original appendices.
const cleanupReport=afterParallelCleanup
  ?(cleanupReportAt>=0?JSON.parse(fs.readFileSync(process.argv[cleanupReportAt+1],'utf8')):await read('parallel-cleanup-report.json'))
  :null;
const cleanupFiles=new Map((cleanupReport?.files||[]).map(entry=>[entry.path,entry]));
const cleanupTargets=new Set(['sefer-hazikhronot','tzidkat-hatzadik','peri-tzadik','machshavot-charutz',
  'divrei-soferim','yisrael-kedoshim','likkutei-maamarim','sichat-malakhei-hasharet','sichat-shedim',
  'divrei-chalomot','et-haochel','ohr-zarua-latzadik','kometz-haminchah','meshiv-hata-anah','meshiv-tzedek','poked-akarim']);
const protectedPriFiles=new Set(['data/peri-tzadik/6.json','data/peri-tzadik/106.json','data/peri-tzadik/111.json','data/peri-tzadik/112.json',
  'data/peri-tzadik/7-5.json','data/peri-tzadik/7-6.json']);
if(afterParallelCleanup){
  assert.equal(cleanupReport.schemaVersion,1,'Cleanup report schema');
  assert.equal(cleanupReport.mode,'write','A dry run is not a completed cleanup');
  assert.equal(cleanupFiles.size,cleanupReport.files.length,'Duplicate cleanup file evidence');
  for(const assertion of ['bodyUnchanged','footnoteCountsUnchanged','noteMetadataUnchanged','firstParagraphsUnchanged','protectedUnchanged','idempotent'])
    assert.equal(cleanupReport.assertions[assertion],true,'Cleanup preservation proof: '+assertion);
}
function checkPublishedHash(file,beforeHash,raw){
  const change=afterParallelCleanup?cleanupFiles.get(file):null;
  if(change){
    const target=file.match(/^data\/([^/]+)\/(?:links|\d+(?:-\d+)*)\.json$/);
    assert.ok(target&&cleanupTargets.has(target[1])&&!protectedPriFiles.has(file),
      'Cleanup cannot excuse a changed protected or unrelated file: '+file);
    assert.equal(change.beforeSha256,beforeHash,'Cleanup must start from the verified import: '+file);
    assert.equal(sha(raw),change.afterSha256,'Cleaned published chapter checksum '+file);
    if(change.bodyBeforeSha256!==undefined)assert.equal(change.bodyBeforeSha256,change.bodyAfterSha256,'Cleanup changed body '+file);
    if(change.notesBefore!==undefined)assert.equal(change.notesBefore,change.notesAfter,'Cleanup changed footnote count '+file);
  }else assert.equal(sha(raw),beforeHash,'Published chapter checksum '+file);
  return change;
}
function approvedPrimary(source,label){
  // An independent, narrow expectation for this frozen four-part upload.
  // Do not use the cleanup implementation to decide what the test may omit.
  assert.equal(source.paragraphs.length,4,'Original four-part upload '+label);
  assert.deepEqual(source.sources.map(src=>src.role),['primary-source','parallel-rav-tzadok','parallel-ishbitz-radzin'],label);
  // The frozen upload contains both orders for these two labeled appendices.
  // Require one of each; the source digest and restored-file hash still fix
  // every original word and its exact position independently.
  const labels=source.paragraphs.slice(1,3).map(paragraph=>
    /^Kisvei\s+Rav\s+Tzadok\s+Parallel\b/.test(paragraph.text)?'rav':
    /^Kisvei\s+Beis\s+Ishbitz[–—\-\s]+Radzin\s+Parallel\b/.test(paragraph.text)?'ishbitz':null);
  assert.deepEqual(labels.sort(),['ishbitz','rav'],label);
  assert.match(source.paragraphs[3].text,/^Sources:.*\|\s*Parallels:/s,label);
  return {paragraphs:[source.paragraphs[0]],sources:[source.sources[0]]};
}
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
// The historic 3,240 notes remain fixed. Accept the later book-wide total
// only after all 26 formerly empty chapters pass exact source-note validation.
const missingPack=readMissingFootnotes();
assert.equal(missingPack.noteCount,MISSING_FOOTNOTE_COUNT);assert.equal(missingPack.targets.length,26);
let filledTargets=0,verifiedAddedNotes=0;
for(const target of missingPack.targets){
  const rows=await read('data/peri-tzadik/'+target.file),original=recoverOriginalItems(rows,target.ref);
  if(hasImportedNotes(rows,target.ref)){
    filledTargets++;
    verifiedAddedNotes+=rows.flatMap(row=>row.footnotes||[]).length-original.flatMap(row=>row.footnotes||[]).length;
  }
}
assert.ok(filledTargets===0||filledTargets===missingPack.targets.length,'The later source-note edition is incomplete');
assert.equal(verifiedAddedNotes,filledTargets?MISSING_FOOTNOTE_COUNT:0,'Verified additional source-note count');
assert.equal(report.release,release);assert.equal(report.notes,1407);assert.equal(report.sections,42);assert.equal(report.totalBookNotes,3240+verifiedAddedNotes);
assert.equal(report.sourceSHA256,'52e53d19420823db61c6772770e84cd8e1719596b736ee7affd3b0540d020eba');
const leaves=[];function walk(n){if(n.ref)leaves.push(n);for(const c of n.children||[])walk(c);}walk(toc.toc);
const expectations=[],seenNumbers=new Set(),links=await read('data/peri-tzadik/links.json');
for(const [index,s]of supplied.sections.entries()){
  const matches=leaves.filter(l=>l.interlinear&&l.ref===s.ref);assert.equal(matches.length,1,s.ref);
  const leaf=matches[0],file='data/peri-tzadik/'+leaf.id+'.json',raw=await bytes(file),rows=JSON.parse(raw);
  const entry=report.chapters.find(c=>c.ref===s.ref),cleanup=checkPublishedHash(file,entry.sha256,raw);
  const reconstructed=afterParallelCleanup?structuredClone(rows):null;
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
      const expected=afterParallelCleanup?approvedPrimary(source,s.ref+' #'+n.number):source;
      assert.deepEqual(n.paragraphs,expected.paragraphs,afterParallelCleanup?'Exact original primary quotation and commentary':'Complete supplied English');
      assert.deepEqual(n.sources,expected.sources,'Supplied source hyperlinks');
      if(afterParallelCleanup){
        assert.ok(cleanup,'Missing cleanup evidence for '+file);
        const proof=cleanup.changes.find(change=>change.itemNumber===r.n&&change.noteIndex===k&&change.sourceId===n.sourceId);
        assert.ok(proof,'Missing note cleanup evidence '+n.sourceId);
        assert.equal(proof.number,n.number);assert.equal(proof.placementId,n.placementId);
        assert.equal(proof.paragraphCountBefore,4);assert.equal(proof.paragraphCountAfter,1);
        assert.deepEqual(proof.removedParagraphs.map(p=>p.index),[1,2,3]);
        assert.deepEqual(proof.removedSources.map(src=>src.role),['parallel-rav-tzadok','parallel-ishbitz-radzin']);
        const original=reconstructed.find(row=>row.p&&row.n===r.n).footnotes[k];
        original.paragraphs=source.paragraphs;original.sources=source.sources;
      }
      assert.ok(!seenNumbers.has(n.number),'Duplicate note number');seenNumbers.add(n.number);
      assert.equal(n.sourceId,'PT-'+String(n.number).padStart(4,'0'));
      assert.ok(n.heCharOffset>0&&n.heAnchorPrefix);
      for(const src of n.sources){
        const ref=src.ref.replace(/\s*\(§\d+\)$/,'').trim();
        assert.ok(links[s.ref].some(l=>l.a===s.ref+':'+r.n&&l.r===ref),'Missing paragraph connection '+ref);
      }
    }
  }
  if(afterParallelCleanup){
    // Restoring only the three appendices and their two source entries must
    // recover the exact pre-cleanup file. This also verifies all note metadata,
    // IDs, English and Hebrew anchors, body text, headings and inline links.
    assert.equal(sha(canonical(reconstructed)+'\n'),entry.sha256,'Only approved appendices and source roles may change: '+s.ref);
    assert.equal(cleanup.notesBefore,notes.length);assert.equal(cleanup.notesAfter,notes.length);
  }
  expectations.push({ref:s.ref,file,leaf,rows,notes});
}
assert.equal(seenNumbers.size,1407);
if(!live){
  for(const [file,digest]of Object.entries(report.protectedFiles))checkPublishedHash('data/'+file,digest,fs.readFileSync(root+'data/'+file));
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
    console.log('PASS offline ZIPs: all 42 seasonal teachings, 1407 '+(afterParallelCleanup?'primary source notes after approved appendix cleanup':'supplied notes')+', protected Pri chapters, and exact original Word editions.');
  }
}
if(process.argv.includes('--data-only')||process.argv.includes('--zips')){
  console.log('PASS final seasonal data: 42 teachings; 1407 complete primary source notes; '+(afterParallelCleanup?'approved appendices removed; all original metadata, body and unaffected files preserved.':'original body and other books preserved.'));
  process.exit(0);
}
const {chromium}=await import('playwright');
let server,base=live;
if(!base){
  const dist=path.resolve(root);server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!pathname.startsWith('/library/')){res.writeHead(404).end();return;}
    let f=path.resolve(dist,'.'+pathname.slice('/library'.length));
    if(f!==dist&&!f.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
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
    await ms.first().waitFor({timeout:60000});assert.equal(await ms.count(),74);
    if(afterParallelCleanup){
      const expected=expectations.find(section=>section.ref==='Peri Tzadik, Rosh Chodesh Shvat 1');
      const boxes=page.locator('#text > .sec[data-ref="Peri Tzadik, Rosh Chodesh Shvat 1"] .seg-il .reader-footnote');
      const rendered=await boxes.evaluateAll(elements=>Object.fromEntries(elements.map(box=>[box.dataset.fn,
        [...box.querySelectorAll('.annotation-text')].map(paragraph=>paragraph.textContent)])));
      for(const note of expected.notes)assert.deepEqual(rendered[note.number],note.paragraphs.map(paragraph=>
        paragraph.rich?.length?paragraph.rich.map(run=>run.text||'').join(''):paragraph.text),
        'Installed reader retained stale appended paragraphs after reload #'+note.number);
    }
    await context.close();
  }
}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
fs.writeFileSync('seasonal-verification/'+(live?'live-':'')+'report.json',JSON.stringify({release,afterParallelCleanup,live:live||false,sections:42,notes:1407,uploadedContentSHA256:sha(canonical(uploadedContent)),results},null,2));
console.log('PASS '+(live?'LIVE':'FINAL')+' seasonal reader: all 1407 notes rendered with '+(afterParallelCleanup?'exact original primary quotations and commentary':'complete supplied English')+'; 42 mobile and 42 desktop routes; source popups open.');

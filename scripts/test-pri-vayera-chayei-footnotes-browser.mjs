// Verify visible Hebrew-only markers, complete supplied English, and source links.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const at=process.argv.indexOf('--url');
const live=at>=0 ? process.argv[at+1].replace(/\/?$/,'/') : null;
const rootAt=process.argv.indexOf('--root');
const afterParallelCleanup=process.argv.includes('--after-parallel-cleanup');
const cleanupReportAt=process.argv.indexOf('--cleanup-report');
const targets=[...Array.from({length:7},(_,i)=>`Peri Tzadik, Vayera ${i+1}`),...Array.from({length:11},(_,i)=>`Peri Tzadik, Chayei Sara ${i+1}`)];
const counts=[194,41,43,51,21,43,16,108,57,25,30,62,38,60,24,37,52,27];
const release='20261016-pri-vayera-chayei-footnotes-929';
const dir=path.resolve(rootAt>=0?process.argv[rootAt+1]:'dist/library')+path.sep;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
async function bytes(file){
  if(!live) return fs.readFileSync(dir+file);
  const r=await fetch(live+file+'?verify='+release,{cache:'no-store'});
  assert.ok(r.ok,`${r.status}: ${file}`);return Buffer.from(await r.arrayBuffer());
}
const read=async file=>JSON.parse(await bytes(file));
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
const cleanupReport=afterParallelCleanup
  ?(cleanupReportAt>=0?JSON.parse(fs.readFileSync(process.argv[cleanupReportAt+1],'utf8')):await read('parallel-cleanup-report.json'))
  :null;
const cleanupFiles=new Map((cleanupReport?.files||[]).map(entry=>[entry.path,entry]));
let originalSections,publicationReport,seasonalReport;
if(afterParallelCleanup){
  assert.equal(cleanupReport.schemaVersion,1,'Cleanup report schema');
  assert.equal(cleanupReport.mode,'write','A dry run is not a completed cleanup');
  assert.equal(cleanupFiles.size,cleanupReport.files.length,'Duplicate cleanup file evidence');
  for(const assertion of ['bodyUnchanged','footnoteCountsUnchanged','noteMetadataUnchanged','firstParagraphsUnchanged','protectedUnchanged','idempotent'])
    assert.equal(cleanupReport.assertions[assertion],true,'Cleanup preservation proof: '+assertion);
  const supplied=JSON.parse(gunzipSync(fs.readFileSync('sources/akiva/pri-vayera-chayei-footnotes-929.json.gz')));
  assert.equal(supplied.work,'Peri Tzadik');
  assert.deepEqual(supplied.sections.map(section=>section.ref),targets,'Exact supplied section scope');
  const content=supplied.sections.flatMap(section=>section.entries.map(entry=>[section.ref,entry.item,entry.note.number,entry.note.paragraphs,entry.note.sources]));
  assert.equal(sha(canonical(content)),'ca72b10d3eb7aaf160c9c1acb26f3360f10a159d432b5797e07ce9f4675b61f5','Exact uploaded Vayera and Chayei Sara content');
  originalSections=new Map(supplied.sections.map(section=>[section.ref,section]));
  publicationReport=await read('pri-vayera-chayei-footnotes-report.json');
  seasonalReport=await read('pri-seasonal-footnotes-report.json');
  assert.equal(publicationReport.release,release);assert.equal(publicationReport.suppliedNotes,929);
  assert.equal(publicationReport.suppliedContentSHA256,sha(canonical(content)));
  assert.equal(seasonalReport.release,'20261016-pri-seasonal-1407-v1');
}
function approvedPrimary(source,label){
  // This frozen upload has one primary paragraph and three marked appendices.
  // Verify that shape independently, without sharing the cleanup predicate.
  assert.equal(source.paragraphs.length,4,'Original four-part upload '+label);
  assert.deepEqual(source.sources.map(src=>src.role),['primary-source','parallel-rav-tzadok','parallel-ishbitz-radzin'],label);
  assert.match(source.paragraphs[1].text,/^Kisvei\s+Rav\s+Tzadok\s+Parallel\b/,label);
  assert.match(source.paragraphs[2].text,/^Kisvei\s+Beis\s+Ishbitz[–—\-\s]+Radzin\s+Parallel\b/,label);
  assert.match(source.paragraphs[3].text,/^Sources:.*\|\s*Parallels:/s,label);
  return {paragraphs:[source.paragraphs[0]],sources:[source.sources[0]]};
}
const toc=await read('data/peri-tzadik/toc.json');
const leaves=[];
function walk(n){if(n?.ref)leaves.push(n);for(const c of n?.children||[])walk(c);}
walk(toc.toc);
const expectations=[];
for(let i=0;i<targets.length;i++){
  const ref=targets[i],matches=leaves.filter(l=>l.ref===ref&&l.interlinear);
  assert.equal(matches.length,1,'Unique interlinear contents entry '+ref);
  const file='data/peri-tzadik/'+matches[0].id+'.json',raw=await bytes(file),rows=JSON.parse(raw);
  const notes=rows.flatMap(r=>r.footnotes||[]);
  const imported=notes.filter(n=>n.provenance?.importRelease===release);
  assert.equal(imported.length,counts[i],ref);
  assert.ok(rows.filter(r=>r.h).length>=3,'Existing headings '+ref);
  const cleanup=afterParallelCleanup?cleanupFiles.get(file):null;
  const reconstructed=afterParallelCleanup?structuredClone(rows):null;
  const originals=afterParallelCleanup?new Map(originalSections.get(ref).entries.map(entry=>[entry.note.sourceId,entry])):null;
  if(afterParallelCleanup){
    assert.ok(cleanup,'Missing cleanup evidence '+file);
    assert.equal(sha(raw),cleanup.afterSha256,'Cleaned published chapter checksum '+ref);
    assert.equal(cleanup.beforeSha256,seasonalReport.protectedFiles[file.slice('data/'.length)],'Cleanup must follow the final verified import '+ref);
    assert.equal(cleanup.bodyBeforeSha256,cleanup.bodyAfterSha256,'Cleanup changed text or headings '+ref);
    assert.equal(cleanup.notesBefore,notes.length);assert.equal(cleanup.notesAfter,notes.length);
    assert.equal(originals.size,counts[i],'Exact supplied note count '+ref);
    const body=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='footnotes')));
    const chapter=publicationReport.countsBySection.find(section=>section.ref===ref);
    assert.ok(chapter);assert.equal(sha(canonical(body)),chapter.bodySHA256,'Original text, headings and inline links '+ref);
  }
  for(const n of imported){
    if(afterParallelCleanup){
      const entry=originals.get(n.sourceId);assert.ok(entry,'Unexpected note ID '+n.sourceId);
      const source=entry.note,expected=approvedPrimary(source,ref+' #'+n.number);
      assert.equal(n.number,source.number);assert.equal(n.placementId,source.placementId);
      assert.deepEqual(n.paragraphs,expected.paragraphs,'Exact original primary quotation and commentary '+n.sourceId);
      assert.deepEqual(n.sources,expected.sources,'Exact retained source hyperlink '+n.sourceId);
      const row=rows.find(row=>row.p&&row.n===entry.item);assert.ok(row);
      const noteIndex=row.footnotes.findIndex(note=>note.sourceId===n.sourceId);
      assert.ok(noteIndex>=0);
      const proof=cleanup.changes.find(change=>change.itemNumber===row.n&&change.noteIndex===noteIndex&&change.sourceId===n.sourceId);
      assert.ok(proof,'Missing note cleanup evidence '+n.sourceId);
      assert.equal(proof.number,n.number);assert.equal(proof.placementId,n.placementId);
      assert.equal(proof.paragraphCountBefore,4);assert.equal(proof.paragraphCountAfter,1);
      assert.deepEqual(proof.removedParagraphs.map(paragraph=>paragraph.index),[1,2,3]);
      assert.deepEqual(proof.removedSources.map(src=>src.role),['parallel-rav-tzadok','parallel-ishbitz-radzin']);
      const original=reconstructed.find(row=>row.p&&row.n===entry.item).footnotes[noteIndex];
      original.paragraphs=source.paragraphs;original.sources=source.sources;
    }else{
      assert.equal(n.paragraphs.length,4);assert.equal(n.sources.length,3);
    }
    assert.ok(n.heAnchorPrefix&&n.heCharOffset>0);
    for(const p of n.paragraphs)assert.equal(p.text,p.rich.map(r=>r.text).join(''));
  }
  if(afterParallelCleanup)assert.equal(sha(canonical(reconstructed)+'\n'),cleanup.beforeSha256,
    'Restoring only approved appendices must recover all original body, anchors and note metadata '+ref);
  expectations.push({ref,notes,imported,rows});
}
assert.equal(expectations.reduce((n,e)=>n+e.imported.length,0),929);
if(process.argv.includes('--data-only')){
  console.log('PASS Vayera and Chayei Sara data: 929 Hebrew-anchored notes in 18 sections; '+(afterParallelCleanup?'exact original primary quotations, links, body and metadata retained after approved appendix cleanup.':'complete supplied four-part notes and source links.'));
  process.exit(0);
}
let server;
let base=live;
if(!live){
  const root=path.resolve(dir);
  server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!pathname.startsWith('/library/')){res.writeHead(404).end();return;}
    let f=path.resolve(root,'.'+pathname.slice('/library'.length));
    if(f!==root&&!f.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    try{
      if(fs.statSync(f).isDirectory())f=path.join(f,'index.html');
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(f)]||'application/octet-stream');
      res.end(fs.readFileSync(f));
    }catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  base='http://127.0.0.1:'+server.address().port+'/library/';
}
const {chromium}=await import('playwright');
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
fs.writeFileSync('pri-verification/'+(live?'live-':'')+'report.json',JSON.stringify({release,afterParallelCleanup,live:live||false,notes:929,sections:18,results},null,2));
console.log('PASS '+(live?'LIVE':'LOCAL')+': 929 Hebrew-anchored notes, 18 sections, '+(afterParallelCleanup?'exact original primary-source':'complete supplied English')+' popups and links.');

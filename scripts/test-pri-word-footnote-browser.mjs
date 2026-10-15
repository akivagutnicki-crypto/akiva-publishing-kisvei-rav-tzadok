// Verify Word-footnote markers actually appear in the Hebrew reader and open
// the complete text with its Sefaria links; count-only JSON tests miss this.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';

const dir='dist/library/data/peri-tzadik/';
const toc=JSON.parse(fs.readFileSync(dir+'toc.json','utf8'));
const leaves=[];
function walk(node){if(node?.ref)leaves.push(node);for(const child of node?.children||[])walk(child);}
walk(toc.toc);
const sections=[
  ['Peri Tzadik, Bereshit 3',17],
  ['Peri Tzadik, Noach 5',15],
  ['Peri Tzadik, Noach 6',16],
  ['Peri Tzadik, Rosh Chodesh Cheshvan',48],
  ['Peri Tzadik, Rosh Chodesh (manuscript)',33]
];
const expectations=[];
for (const [ref,total] of sections) {
  const leaf=leaves.find(l=>l.ref===ref&&l.interlinear);
  assert.ok(leaf,'Missing interlinear section '+ref);
  const data=JSON.parse(fs.readFileSync(dir+leaf.id+'.json','utf8'));
  const notes=data.filter(i=>i.p).flatMap(i=>(i.footnotes||[]).map(n=>({note:n,phrase:i.p[n.phraseIndex]})));
  assert.ok(notes.length>=total,'Missing original notes '+ref);
  for(const {note,phrase} of notes){
    assert.ok(Number.isInteger(note.heCharOffset)&&note.heCharOffset>0,'No Hebrew marker anchor '+note.number);
    const hebrew=phrase[0].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    if(note.provenance?.reviewSource) assert.equal(hebrew.slice(0,note.heCharOffset),note.heAnchorPrefix,
      'New source marker is not attached to the exact Hebrew word '+ref+' #'+note.number);
    else assert.equal(note.heCharOffset,hebrew.length,
      'Original Word-footnote marker moved '+ref+' #'+note.number);
    // Noach's supplied 31 notes have verified Sefaria links; older Cheshvan
    // Word notes are preserved verbatim, even when a note lacks a link.
    if (ref.startsWith('Peri Tzadik, Noach') && !note.provenance?.reviewSource)
      assert.ok(note.paragraphs.some(p=>p.links?.some(l=>/^https:\/\/www\.sefaria\.org\//.test(l.url))),
        'Missing original Noach Sefaria source link '+ref+' #'+note.number);
  }
  expectations.push({ref,total:notes.length,notes});
}

const root=path.resolve('dist');
const server=http.createServer((req,res)=>{
  let filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try {
    if(fs.statSync(filename).isDirectory())filename=path.join(filename,'index.html');
    const mime={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8',
      '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
    res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');
    res.end(fs.readFileSync(filename));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'Test source landing'}));
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const toHash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
  for (const {ref,total,notes} of expectations){
    await page.goto(origin+'/library/#/read/'+toHash(ref));
    const section=page.locator('#text > .sec[data-ref="'+ref+'"]');
    await section.locator('.seg-il .ph-he button.footnote-marker').first().waitFor({state:'visible',timeout:30000});
    const marks=section.locator('.seg-il .ph-he button.footnote-marker');
    assert.equal(await marks.count(),total,'Invisible markers '+ref);
    assert.equal(await section.locator('.seg-il .ph-en button.footnote-marker').count(),0,
      'English translation must have no duplicated footnote numbering '+ref);
    const boxes=section.locator('.seg-il .reader-footnote');
    assert.equal(await boxes.count(),total,'Missing note content boxes '+ref);
    const n=notes[0].note;
    const trigger=section.locator('.seg-il .ph-he button[data-fn="'+n.number+'"]').first();
    const box=section.locator('.seg-il .reader-footnote[data-fn="'+n.number+'"]').first();
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'),'true','Click did not expand '+ref);
    assert.ok(await box.isVisible(),'Note did not open '+ref);
    assert.equal(await box.locator('.annotation-text').count(),n.paragraphs.length,
      'Footnote paragraphs truncated '+ref);
    const body=await box.locator('.annotation-text').allTextContents();
    assert.deepEqual(body,n.paragraphs.map(p=>p.text),'Word-source English changed '+ref);
    if (n.paragraphs.some(p=>p.links?.some(l=>/^https:\/\/www\.sefaria\.org\//.test(l.url)) || p.rich?.some(run=>run.href?.startsWith('https://www.sefaria.org/'))))
      assert.ok(await box.locator('a[href^="https://www.sefaria.org/"]').count()>0,'Existing Sefaria links invisible '+ref);
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'),'false','Note did not close '+ref);
    console.log('PASS '+ref+': '+total+' real Hebrew markers and complete opening note.');
  }
  assert.deepEqual(errors,[],'JavaScript errors in reader');
  await context.close();
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
console.log('PASS browser: all reviewed original and new Hebrew footnote markers, complete English and clickable source links.');

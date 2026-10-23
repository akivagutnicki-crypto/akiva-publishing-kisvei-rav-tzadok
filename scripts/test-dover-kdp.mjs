// End-to-end comparison of the published reader with both authoritative DOCX files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readPack as readDivreiAudit, protectedSuccessorHash} from './publish-divrei-source-audit.mjs';
const args=process.argv.slice(2),ui=args.indexOf('--url');
const divreiAudit=args.includes('--after-divrei-source-audit')?readDivreiAudit():null;
const publicBase=ui<0?null:new URL(args[ui+1]);
if(publicBase){publicBase.hash='';if(!publicBase.pathname.endsWith('/'))publicBase.pathname+='/';}
const root=path.resolve('dist/library'),hash=x=>createHash('sha256').update(x).digest('hex');
const serial=x=>JSON.stringify(x),cache=new Map();
const read=async f=>{
 if(!cache.has(f))cache.set(f,(async()=>{if(!publicBase)return fs.readFileSync(path.join(root,f));const u=new URL(f,publicBase);u.searchParams.set('dover-kdp-check',String(Date.now()));const r=await fetch(u,{cache:'no-store'});assert.ok(r.ok,f+': HTTP '+r.status);return Buffer.from(await r.arrayBuffer());})());
 return cache.get(f);
};
const json=async f=>JSON.parse((await read(f)).toString());
const entity={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
const visible=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(all,k)=>k[0]==='#'?String.fromCodePoint(k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):+k.slice(1)):entity[k]??all);
const norm=s=>visible(s).replace(/\s+/g,' ').trim();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dover-kdp-check-'));
let source;
try{const p=path.join(temp,'source.json');execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',['scripts/dover-kdp-docx.py','--out',p],{stdio:['ignore','pipe','inherit']});source=JSON.parse(fs.readFileSync(p));}finally{fs.rmSync(temp,{recursive:true,force:true});}
const report=await json('dover-kdp-reader-report.json'),toc=await json('data/dover-tzedek/toc.json');
assert.equal(report.release,'20261020-dover-kdp-manuscripts-v1');
assert.deepEqual(report.wordSources,source.volumes,'Reader is not based on the latest two Word manuscripts');
assert.equal(toc.manuscriptEdition.sourceSignature,report.sourceSignature);
const sections=new Map();let pairs=0,notes=0,headlines=0;
const seen=new Set(),numbers={I:[],II:[]};
for(const proof of report.sections){
 const rows=await json('data/dover-tzedek/'+proof.file),expected=source.sections[proof.file];
 assert.equal(hash(await read('data/dover-tzedek/'+proof.file)),proof.sha256,'Published chapter bytes differ');
 assert.equal(rows.length,proof.paragraphs,'An existing paragraph reference was removed');
 const actual=rows.flatMap(row=>row.p.map((p,i)=>({row,p,i,notes:(row.footnotes||[]).filter(n=>n.phraseIndex===i)})));
 assert.equal(actual.length,expected.pairs.length,'A phrase was lost or duplicated');
 actual.forEach((a,index)=>{
  const e=expected.pairs[index];
  assert.equal(a.row.n,expected.canonicalNumbers[index],'An original paragraph link moved');
  assert.deepEqual(a.p.map(norm),[e.he,e.en].map(norm),'Hebrew or English differs from Word in '+proof.file+' phrase '+index);
  assert.deepEqual(a.notes.map(n=>n.wordFootnoteId),e.notes.map(n=>n.wordFootnoteId),'A Word footnote is missing or attached to another phrase');
  for(const [j,note]of a.notes.entries()){
   const original=e.notes[j];assert.ok(!seen.has(note.placementId),'Repeated note identity');seen.add(note.placementId);
   assert.equal(note.number,original.number);assert.equal(note.sourceId,original.sourceId);
   assert.equal(note.heCharOffset,e.he.length);assert.equal(note.heAnchorPrefix,e.he);
   assert.deepEqual(note.paragraphs.map(p=>p.text),original.paragraphs.map(p=>p.text),'A full source quotation was changed or shortened');
   note.paragraphs.forEach(p=>assert.equal(p.rich.map(r=>r.text).join(''),p.text,'Linked source text differs'));
   numbers[note.volume].push(note.number);notes++;
  }
  const headings=(a.row.inlineHeadings||[]).filter(h=>h.phraseIndex===a.i);
  assert.deepEqual(headings.map(h=>h.text),e.heads.map(h=>h.text),'A Word headline is misplaced');headlines+=headings.length;
  if(e.paragraphStart&&a.i)assert.ok(a.row.paragraphBreaks.includes(a.i),'Word paragraph break missing');
  pairs++;
 });
 sections.set(proof.ref,{proof,rows});
}
assert.equal(pairs,7405);assert.equal(notes,2796);assert.equal(headlines,371);
for(const v of ['I','II'])assert.deepEqual(numbers[v],Array.from({length:source.volumes[v].notes},(_,i)=>i+1),'Footnote sequence has a gap in volume '+v);
const opening=await json('data/dover-tzedek/0.json');assert.equal(opening.length,9);
opening.forEach((row,i)=>assert.deepEqual(row.p[0].map(norm),source.volumes.I.title.slice(2*i,2*i+2).map(norm)));
const links=await json('data/dover-tzedek/links.json');
const count=Object.values(links).flat().length;assert.equal(count,report.connections);assert.ok(count>5000,'Revised source connections were not rebuilt');
for(const [section,edges]of Object.entries(links)){
 const rows=sections.get(section)?.rows;assert.ok(rows,'Connection belongs to a missing section');
 for(const edge of edges)assert.ok(rows.some(r=>edge.a===section+':'+r.n),'Source connection has a stale paragraph anchor');
}
for(const d of report.downloads)assert.equal(hash(await read(d.file)),source.volumes[d.volume].sha256,'Download is not the current Word manuscript');
const require=createRequire(import.meta.url),{unzipSync}=require('../dist/library/vendor/fflate.min.js');
if(args.includes('--zips')){
 const index=await json('downloads/index.json'),book=index.books.find(b=>b.slug==='dover-tzedek');
 const zip=unzipSync(await read(book.file));
 for(const p of report.sections)assert.equal(hash(zip['data/dover-tzedek/'+p.file]),p.sha256,'Dover ZIP has a stale chapter');
 for(const d of report.downloads)assert.equal(hash(zip[d.file]),source.volumes[d.volume].sha256,'Dover ZIP has an older Word file');
 // The historical verification runs before this authorized replacement. The
 // successor proves every other sefer's final text remains exactly unchanged.
 const whole=unzipSync(await read(index.library.file));
 for(const [f,digest]of Object.entries(report.protectedTextSha256))assert.equal(hash(whole['data/'+f]),protectedSuccessorHash(f,digest,divreiAudit),'Another sefer changed during the Dover replacement: '+f);
 console.log('PASS both ZIPs contain the current Dover text and Word files; all '+Object.keys(report.protectedTextSha256).length+' other text files preserved.');
}
if(!args.includes('--data-only')){
 let playwright;
 try{playwright=await import('playwright');}catch(e){assert.ok(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'Playwright runtime missing');playwright=await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
 let server,base=publicBase?.href;
 if(!base){server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\/library/,''));if(!f.startsWith(root+path.sep)&&f!==root){res.writeHead(403).end();return;}try{if(fs.statSync(f).isDirectory())f=path.join(f,'index.html');res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port+'/library/';}
 const browser=await playwright.chromium.launch({headless:true,...(process.env.DOVER_CHROMIUM_EXECUTABLE?{executablePath:process.env.DOVER_CHROMIUM_EXECUTABLE}:{})});
 try{
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
   const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};});
   for(const [ref,{rows,proof}]of sections){
    const hashRef=encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
    await page.goto(base+'#/read/'+hashRef);
    const sec=page.locator('#text > .sec').filter({has:page.locator('.seg[data-ref="'+ref+':1"]')}).first();
    await sec.locator('.seg-il .ph-he .footnote-marker').first().waitFor({state:'visible',timeout:45000});
    assert.equal(await sec.locator('.seg-il .ph').count(),proof.phrases,'Reader loses phrase pairs');
    assert.equal(await sec.locator('.seg-il .ph-he .footnote-marker:not(.connection-idea-marker)').count(),proof.notes,'A numbered marker is invisible or missing');
    assert.equal(await sec.locator('.seg-il .ph-en .footnote-marker').count(),0,'A numbered marker moved onto English');
    const boxes=await sec.locator('.seg-il .reader-footnote').evaluateAll(elements=>elements.map(e=>({key:e.dataset.noteKey,number:+e.dataset.fn,text:[...e.querySelectorAll('.annotation-text')].map(p=>p.textContent)})));
    const byKey=new Map(boxes.map(b=>[b.key,b]));
    for(const note of rows.flatMap(r=>r.footnotes||[])){const box=byKey.get(note.placementId);assert.ok(box,'Missing numbered footnote popup');assert.equal(box.number,note.number);assert.deepEqual(box.text.map(norm),note.paragraphs.map(p=>norm(p.text)),'The browser shortens a footnote');}
    for(const mark of [sec.locator('.seg-il .footnote-marker').first(),sec.locator('.seg-il .footnote-marker').last()]){await mark.click();assert.equal(await mark.getAttribute('aria-expanded'),'true');await mark.click();assert.equal(await mark.getAttribute('aria-expanded'),'false');}
   }
   assert.deepEqual(errors,[],'Reader JavaScript error');
   console.log('PASS browser '+viewport.width+'px: all 7,405 phrases, all 2,796 numbered markers and complete source-note popups.');
   await context.close();
  }
 }finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
}
console.log(JSON.stringify({ok:true,release:report.release,pairs,notes,headlines,sourceConnections:count,mode:publicBase?'public':'local'}));

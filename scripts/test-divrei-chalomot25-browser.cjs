const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.DC25_PLAYWRIGHT||'playwright');
const root=path.resolve(process.argv[2]||'dist');
const edition=JSON.parse(fs.readFileSync('sources/akiva/divrei-chalomot25/edition.json','utf8'));
const beshegam=edition.notes.find(n=>n.pdfNumber===7).sourceId+'-1';
const output='artifacts/divrei-chalomot25';fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
 let name=decodeURIComponent(req.url.split('?')[0]);
 if(name.endsWith('/'))name+='index.html';
 const file=path.resolve(root,'.'+name);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[ext]||'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.DC25_CHROMIUM?{executablePath:process.env.DC25_CHROMIUM}:{})});
 try{
  for(const width of [1280,390]){
   const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'});
   const page=await context.newPage();
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/library/#/read/Divrei_Chalomot_25',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('.source-note-trigger[data-note-key^="DC25-"]',{timeout:60000});
   assert.equal(await page.locator('.source-note-trigger[data-note-key^="DC25-"]').count(),76);
   assert((await page.locator('#text').textContent()).includes(edition.translations[0].en));
   assert((await page.locator('#text').textContent()).includes(edition.translations[25].en));
   assert(!(await page.locator('#text').textContent()).includes('surpassing even Shem in explicit prophetic vision'));
   await page.locator('.source-note-trigger[data-note-key="'+beshegam+'"]').click();
   const box=page.locator('.reader-footnote.open[data-note-key="'+beshegam+'"]');
   await box.waitFor();const content=await box.textContent();
   assert(content.includes('Bereishis 6:3'));assert(content.includes('מֵאָה וְעֶשְׂרִים'));assert(content.includes('Chullin 139b:10'));
   await page.screenshot({path:output+'/'+width+'-beshegam.png',fullPage:false});
   assert.equal(await page.locator('.reader-footnote.open').count(),1);
   assert.deepEqual(errors,[]);
   fs.writeFileSync(output+'/'+width+'-verification.json',JSON.stringify({width,markers:76,correctedPdfTranslation:true,fullBeshegamVerse:true,errors}));
   await context.close();
  }
 }finally{await browser.close();server.close();}
 console.log('PASS: desktop and mobile show the PDF translation, 76 Hebrew note markers and the complete beshegam verse');
})().catch(e=>{console.error(e);server.close();process.exit(1);});

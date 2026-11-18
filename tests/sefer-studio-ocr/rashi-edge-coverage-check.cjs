'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const {createCanvas}=require('@napi-rs/canvas');
const candidate=path.resolve(process.argv[2]||'dist/sefer-studio/index.html'),html=fs.readFileSync(candidate,'utf8');
const start=html.indexOf('  function ocrRashiLineCropBounds('),end=html.indexOf("  // Refine Tesseract's detected lines.",start);
assert(start>=0&&end>start,'Candidate crop helper exists');
const context=vm.createContext({});vm.runInContext(html.slice(start,end),context);
const bounds=context.ocrRashiLineCropBounds,plain=x=>JSON.parse(JSON.stringify(x));
function setup(){const canvas=createCanvas(400,180),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,180);const line={bbox:{x0:50,y0:40,x1:130,y1:80}},a={bbox:{x0:50,y0:90,x1:250,y1:130}},b={bbox:{x0:50,y0:140,x1:250,y1:175}};return {canvas,ctx,line,paragraph:{bbox:{x0:50,y0:40,x1:250,y1:175},lines:[line,a,b]},lines:[line,a,b]};}
const checks=[];function check(name,f){f();checks.push(name);}
check('Adds only the horizontal edge containing uncovered letter-sized ink',()=>{const f=setup();f.ctx.fillStyle='black';f.ctx.fillRect(148,46,18,29);const actual=plain(bounds(f.line,f.paragraph,f.canvas,f.lines));assert.deepEqual(actual,{x0:50,y0:40,x1:180,y1:80});});
check('Leaves an empty extended margin exactly unchanged',()=>{const f=setup();assert.deepEqual(plain(bounds(f.line,f.paragraph,f.canvas,f.lines)),f.line.bbox);});
check('Does not expand for small specks',()=>{const f=setup();f.ctx.fillStyle='black';f.ctx.fillRect(148,46,3,3);assert.deepEqual(plain(bounds(f.line,f.paragraph,f.canvas,f.lines)),f.line.bbox);});
check('Excludes ink already covered by another detected line',()=>{const f=setup();f.ctx.fillStyle='black';f.ctx.fillRect(148,46,18,29);f.lines.push({bbox:{x0:145,y0:43,x1:168,y1:77}});assert.deepEqual(plain(bounds(f.line,f.paragraph,f.canvas,f.lines)),f.line.bbox);});
check('Rejects a paragraph spanning multiple normal-width columns',()=>{const f=setup();f.paragraph.bbox.x1=390;f.ctx.fillStyle='black';f.ctx.fillRect(148,46,18,29);assert.deepEqual(plain(bounds(f.line,f.paragraph,f.canvas,f.lines)),f.line.bbox);});
check('Does not infer column width from one isolated line',()=>{const f=setup();f.paragraph.lines=[f.line];f.ctx.fillStyle='black';f.ctx.fillRect(148,46,18,29);assert.deepEqual(plain(bounds(f.line,f.paragraph,f.canvas,f.lines)),f.line.bbox);});
check('Retains the original box if pixels cannot be read',()=>{const f=setup();f.canvas={width:400,height:180,getContext(){throw new Error('unavailable')}};assert.deepEqual(plain(bounds(f.line,f.paragraph,f.canvas,f.lines)),f.line.bbox);});
check('Never extends outside source page bounds',()=>{const f=setup();f.paragraph.bbox.x0=-1;f.ctx.fillStyle='black';f.ctx.fillRect(148,46,18,29);assert.deepEqual(plain(bounds(f.line,f.paragraph,f.canvas,f.lines)),f.line.bbox);});
console.log(JSON.stringify({status:'PASS',checks},null,2));

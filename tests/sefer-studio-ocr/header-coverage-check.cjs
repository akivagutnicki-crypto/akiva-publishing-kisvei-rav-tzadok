'use strict';
// Real saved browser geometry/source pixels, plus bounded coverage controls.
// No OCR worker, recognition call, network request, or text mutation occurs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createCanvas,loadImage} = require('@napi-rs/canvas');
const {collectOcrHeaderCoverage} = require('../../dist/sefer-studio/ocr-header-coverage.js');
const fixtures = path.join(__dirname,'fixtures');
const source = JSON.parse(fs.readFileSync(path.join(fixtures,'header-coverage-p196.json'),'utf8'));
const checks = [];
const box = values => Object.fromEntries(['x0','y0','x1','y1'].map((key,index)=>[key,values[index]]));
const bounds = flag => ['x0','y0','x1','y1'].map(key=>flag.bbox[key]);
function blank(width=source.imageSize[0],height=source.imageSize[1]) {
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);return canvas;
}
function verify(name,data,canvas,expected,status='checked') {
  const before=JSON.stringify(data),result=collectOcrHeaderCoverage(data,{canvas});
  assert.equal(result.summary.status,status,name);
  assert.deepEqual(result.flags.map(bounds),expected,name);
  assert.equal(JSON.stringify(data),before,'Coverage review must not modify input text or word positions');
  for(const flag of result.flags) {
    assert.equal(flag.kind,'unrecognized-region');assert.equal(flag.text,'Possible missed header');
    assert.equal(flag.offset,-1);assert.equal(flag.confidence,null);
    assert(!('replacement' in flag),'Coverage must not propose a guessed numeric replacement');
  }
  checks.push({name,regions:result.flags.map(bounds)});return result;
}

(async()=>{
  const bitmap=await loadImage(path.join(fixtures,'header-coverage-p196.png')),canvas=blank();
  canvas.getContext('2d').drawImage(bitmap,source.imageCrop[0],source.imageCrop[1]);
  const reference=source.expectedRegionApprox;
  verify('Saved browser page 196 exposes its omitted header without recognizing digits',source.data,canvas,[reference]);
  const covered=structuredClone(source.data);
  covered.blocks[0].paragraphs[0].lines.push({bbox:box(reference),words:[{text:'196',bbox:box(reference)}]});
  verify('A recognized header number is excluded from coverage review',covered,canvas,[]);
  verify('Blank header stays clear',source.data,blank(),[]);
  const transparent=createCanvas(...source.imageSize);
  verify('Transparent pixels are treated as white background',source.data,transparent,[]);
  const noise=blank(),noiseCtx=noise.getContext('2d');noiseCtx.fillStyle='#000';
  for(const [x,y] of [[100,100],[170,150],[500,240],[1450,260]])noiseCtx.fillRect(x,y,5,5);
  verify('Small isolated specks do not become missed-header flags',source.data,noise,[]);
  const rules=blank(),ruleCtx=rules.getContext('2d');ruleCtx.fillStyle='#000';
  ruleCtx.fillRect(100,230,1500,3);ruleCtx.fillRect(0,60,15,260);ruleCtx.fillRect(1690,60,9,260);
  verify('Horizontal rules and tall scan-edge bars are excluded',source.data,rules,[]);
  for(const scale of [.5,.75,4/3]) {
    const scaled=blank(Math.round(canvas.width*scale),Math.round(canvas.height*scale));
    const ctx=scaled.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,0,0,scaled.width,scaled.height);
    const geometry=structuredClone(source.data);
    for(const block of geometry.blocks)for(const paragraph of block.paragraphs)for(const line of paragraph.lines)for(const b of [line.bbox,...line.words.map(word=>word.bbox)])for(const key of Object.keys(b))b[key]=Math.round(b[key]*scale);
    const result=collectOcrHeaderCoverage(geometry,{canvas:scaled});
    assert.equal(result.summary.status,'checked');assert.equal(result.flags.length,1);
    assert(bounds(result.flags[0]).every((value,index)=>Math.abs(value-Math.round(reference[index]*scale))<=1),'Scaled flag must locate the same source pixels');
    checks.push({name:'Scale '+scale+' retains the same source region',regions:result.flags.map(bounds)});
    scaled.width=scaled.height=1;
  }
  verify('Missing geometry is explicitly skipped',{},canvas,[],'skipped');
  const malformed = [
    ['null result',null], ['non-array blocks',{blocks:{}}], ['null block',{blocks:[null]}],
    ['non-array paragraphs',{blocks:[{paragraphs:{}}]}], ['null paragraph',{blocks:[{paragraphs:[null]}]}],
    ['non-array lines',{blocks:[{paragraphs:[{lines:{}}]}]}], ['null line',{blocks:[{paragraphs:[{lines:[null]}]}]}],
    ['non-array words',{blocks:[{paragraphs:[{lines:[{words:{}}]}]}]}],
    ['null word',{blocks:[{paragraphs:[{lines:[{words:[null]}]}]}]}],
    ['non-text word',{blocks:[{paragraphs:[{lines:[{words:[{text:{},bbox:box([10,10,20,20])}]}]}]}]}]
  ];
  let malformedReads=0;
  const unread={width:canvas.width,height:canvas.height,getContext(){malformedReads++;throw new Error('Invalid geometry must be rejected before reading pixels');}};
  for(const [name,data] of malformed)verify('Malformed geometry safely skips: '+name,data,unread,[],'skipped');
  assert.equal(malformedReads,0);
  const invalid=structuredClone(source.data);invalid.blocks[0].paragraphs[0].lines[0].words[0].bbox.x0=NaN;
  verify('Invalid word positions do not trigger a coverage inference',invalid,canvas,[],'skipped');
  for(const [name,target,key,value] of [
    ['right edge','word','x1',canvas.width+1],['bottom edge','word','y1',canvas.height+1],['line edge','line','x1',canvas.width+1]
  ]) {
    const outside=structuredClone(source.data),line=outside.blocks[0].paragraphs[0].lines[0];
    (target==='word'?line.words[0].bbox:line.bbox)[key]=value;
    verify('Off-image geometry safely skips: '+name,outside,unread,[],'skipped');
  }
  assert.equal(malformedReads,0);
  const overlap={blocks:[{paragraphs:[{lines:[
    {bbox:box([400,120,600,160]),words:Array.from({length:5996},()=>({text:'header',bbox:box([100,120,1600,160])}))},
    {bbox:box([100,335,1600,375]),words:Array.from({length:4},(_,i)=>({text:'body',bbox:box([100+i*100,335,180+i*100,375])}))}
  ]}]}]};
  const maskBudget=verify('Six thousand overlapping word boxes are bounded before pixel reads',overlap,unread,[],'skipped');
  assert.match(maskBudget.summary.reason,/mask-work limit/);assert.equal(malformedReads,0);
  const manyEmpty={blocks:Array.from({length:2001},()=>({paragraphs:[]}))};
  const containerBudget=verify('Empty geometry containers cannot bypass the work limit',manyEmpty,unread,[],'skipped');
  assert.match(containerBudget.summary.reason,/limit/);assert.equal(malformedReads,0);
  let pixelReads=0;
  const oversized={width:8192,height:8192,getContext(){pixelReads++;throw new Error('Pixel read must be bounded');}};
  const broad={blocks:[{paragraphs:[{lines:[{bbox:box([100,1400,7800,1440]),words:Array.from({length:4},(_,i)=>({text:'body',bbox:box([100+i*100,1400,180+i*100,1440])}))}]}]}]};
  const budget=verify('Large header regions are skipped before allocating pixels',broad,oversized,[],'skipped');
  assert.match(budget.summary.reason,/pixel limit/);assert.equal(pixelReads,0);
  verify('Unreadable canvas reports an unavailable coverage check',source.data,{width:canvas.width,height:canvas.height,getContext(){throw new Error('unreadable');}},[],'unavailable');
  const result={status:'PASS',cases:checks.length,checks,sourceWordCount:source.sourceWordCount,ocrCalls:0,textEdits:0,qualification:'One saved browser page plus geometric/background controls. This is a header review signal, not a complete-page recall or OCR accuracy measurement.'};
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

// Restore the existing phrase pairs; change no text, headings, notes or links.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const RELEASE='20261025-beit-phrase-layout-v1';
const SLUG='beit-yaakov-on-torah';
const REPORT='library/beit-phrase-layout-20261025.json';
const PROOF='artifacts/beit-phrase-layout/verification.json';
const PUBLIC='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const RANGES=[['Vayishlach',48],['Vayeshev',48],['Miketz',40],['Vayigash',35],['Vayechi',86]];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=(root,name)=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
const hash=(root,name)=>sha(fs.readFileSync(path.join(root,name)));
const leaves=node=>node.children?node.children.flatMap(leaves):[node];
const files=(root,prefix='')=>fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{
  assert(!e.isSymbolicLink(),'Unexpected symlink');const name=prefix+e.name;
  return e.isDirectory()?files(root,name+'/'):[name];
});
const visible=x=>String(x).replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#39;|&#x27;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function source(){
  const raw=gunzipSync(Buffer.from(fs.readFileSync('sources/akiva/overlays/beit-yaakov-vayishlach-vayechi-20261025.json.gz.b64','utf8').trim(),'base64'));
  assert.equal(sha(raw),'974d5bd587b34cde3dc9ec9e3da773606765c0a11f105b003aef58c3cc103b55');
  return JSON.parse(raw);
}
function selections(toc){
  const all=leaves(toc.toc),out=[];
  for(const [parashah,count]of RANGES){
    const selected=all.filter(l=>l.ref?.startsWith(`Beit Yaakov on Torah, ${parashah} `));
    assert.equal(selected.length,count,parashah+' section count');
    assert.deepEqual(selected.map(l=>l.ref),Array.from({length:count},(_,i)=>`Beit Yaakov on Torah, ${parashah} ${i+1}`));
    out.push(...selected);
  }
  return out;
}
function manifest(root){
  const directory=path.join(root,'library/data'),names=files(directory).filter(n=>n!=='files.json').sort();
  const h=createHash('sha256');let bytes=0;
  for(const name of names){const b=fs.readFileSync(path.join(directory,name));bytes+=b.length;h.update(name);h.update('\0');h.update(b);}
  return {version:h.digest('hex').slice(0,16),bytes,files:names};
}
function verifyText(root,toc){
  const pack=source();let paragraphs=0,pairs=0;
  for(const leaf of selections(toc)){
    assert.equal(leaf.presentation,'interlinear');
    const items=read(root,`library/data/${SLUG}/${leaf.id}.json`).filter(it=>it.p);
    const original=pack.sections.find(s=>`Beit Yaakov on Torah, ${s.key}`===leaf.ref);
    assert(original);assert.equal(items.length,original.items.length);
    for(let i=0;i<items.length;i++){
      assert.equal(items[i].paragraphTranslation,false);assert.equal(items[i].keepPairs,true);
      assert.deepEqual(items[i].p.map(pair=>pair.map(visible)),original.items[i].p,'Original phrase content changed: '+leaf.ref+':'+(i+1));
      pairs+=items[i].p.length;paragraphs++;
    }
  }
  assert.equal(paragraphs,1839);assert.equal(pairs,25241);
  return {sections:257,paragraphs,pairs};
}
function apply(root){
  const baseline=read('.','new-books-baseline.json').files;
  const tocName=`library/data/${SLUG}/toc.json`,toc=read(root,tocName);
  assert(!toc.beitPhraseLayout,'Phrase layout fix is already present; reconcile before reapplying');
  const originalToc=structuredClone(toc),affected=new Set();
  const touch=(name,value)=>{
    assert.equal(hash(root,name),baseline[name],'Live preimage changed: '+name);
    write(root,name,value);affected.add(name);
  };
  for(const leaf of selections(toc)){
    const name=`library/data/${SLUG}/${leaf.id}.json`,items=read(root,name),before=structuredClone(items);
    for(const it of items)if(it.p){assert(Array.isArray(it.p));it.paragraphTranslation=false;}
    const withoutFlag=x=>x.map(it=>{const copy={...it};delete copy.paragraphTranslation;return copy;});
    assert.deepEqual(withoutFlag(items),withoutFlag(before),'Changed chapter content beyond the layout flag');
    leaf.presentation='interlinear';touch(name,items);
  }
  const checkToc=structuredClone(toc);
  for(const leaf of selections(checkToc))leaf.presentation='paragraphs';
  assert.deepEqual(checkToc,originalToc,'Changed headings or other TOC metadata');
  toc.beitPhraseLayout={release:RELEASE,sections:257,phrasePairs:25241,presentation:'interlinear',layoutSelectionEnabled:true};
  if(toc.beitFinalEdition)toc.beitFinalEdition.paragraphTranslation=false;
  touch(tocName,toc);
  const counts=verifyText(root,toc);
  touch('library/data/files.json',manifest(root));
  const htmlName='library/index.html',html=fs.readFileSync(path.join(root,htmlName),'utf8');
  const marker='const editionDataUrl = url => ';
  assert.equal(html.split(marker).length,2,'Unexpected reader data cache helper');
  touch(htmlName,html.replace(marker,marker+`/* ${RELEASE} */ (url.startsWith('data/${SLUG}/') || url === 'data/files.json') ? url + '?beit_layout=${RELEASE}' :\n`));
  const swName='library/sw.js',sw=fs.readFileSync(path.join(root,swName),'utf8');
  assert.equal((sw.match(/const SHELL = `[^`]+`;/g)||[]).length,1);
  touch(swName,sw.replace(/const SHELL = `([^`]+)`;/,(_,value)=>`const SHELL = \`${value}-${RELEASE}\`;`));
  const report={release:RELEASE,...counts,parashiyot:RANGES.map(([name,osiyos])=>({name,osiyos})),
    originalTextPreserved:true,headingsNotesAndLinksPreserved:true,
    affected:[...affected].sort().map(name=>({name,sha256:hash(root,name),preimage:baseline[name]}))};
  assert(!fs.existsSync(path.join(root,REPORT)));
  write(root,REPORT,report);console.log(JSON.stringify({ok:true,...counts,changed:affected.size}));
}
function verify(root){
  const baseline=read('.','new-books-baseline.json').files,report=read(root,REPORT);
  assert.equal(report.release,RELEASE);
  const allow=new Set([REPORT,...report.affected.map(f=>f.name)]);
  for(const [name,digest]of Object.entries(baseline)){
    assert(fs.existsSync(path.join(root,name)),'Published file removed: '+name);
    if(!allow.has(name))assert.equal(hash(root,name),digest,'Unrelated published file changed: '+name);
  }
  for(const name of files(root))assert(baseline[name]||allow.has(name),'Unexpected new file: '+name);
  for(const f of report.affected)assert.equal(hash(root,f.name),f.sha256,'Changed release file: '+f.name);
  assert.equal(report.affected.length,261);
  assert.deepEqual(read(root,'library/data/files.json'),manifest(root));
  const counts=verifyText(root,read(root,`library/data/${SLUG}/toc.json`));
  const proof={ok:true,release:RELEASE,...counts,preservedFiles:Object.keys(baseline).length-report.affected.length};
  write('.',PROOF,proof);console.log(JSON.stringify(proof));
}
async function live(root){
  const report=read(root,REPORT),targets=[...report.affected,{name:REPORT,sha256:hash(root,REPORT)}];
  let next=0,passed=0;const errors=[];
  await Promise.all(Array.from({length:8},async()=>{
    for(;;){const i=next++;if(i>=targets.length)return;const f=targets[i];let ok=false;
      for(let attempt=0;attempt<5;attempt++){
        try{const url=new URL(f.name,PUBLIC);url.searchParams.set('beit_layout_verify',Date.now());
          const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(45000)});
          if(r.ok&&sha(Buffer.from(await r.arrayBuffer()))===f.sha256){ok=true;break;}
        }catch{}
        if(attempt<4)await new Promise(r=>setTimeout(r,3000));
      }
      if(ok)passed++;else errors.push(f.name);
    }
  }));
  assert.deepEqual(errors,[],'Public bytes differ from tested release');
  write('.',PROOF,{...read('.',PROOF),live:true,publicFilesChecked:passed});
  console.log(JSON.stringify({ok:true,live:true,publicFilesChecked:passed}));
}
const [mode,root='.beit-layout-site']=process.argv.slice(2);
if(mode==='--apply')apply(root);
else if(mode==='--verify')verify(root);
else if(mode==='--live')await live(root);
else throw Error('Usage: --apply SITE | --verify SITE | --live SITE');

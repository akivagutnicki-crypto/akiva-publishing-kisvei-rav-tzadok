// Beis Yaakov Torah reader: a JSON-only, preservation-checked Pages release.
// This patches the exact deployed Pages artifact; it does NOT rebuild other seforim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {linkCitations, linkHebrewCitations, normalizeRef, categoryOf} from './citations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = 'sources/akiva/overlays/beit-yaakov-vayishlach-vayechi-20261025.json.gz.b64';
const PACK_SHA = '76b11428a39e8bed7b9bffa7bf7eb8bb648f5f2b60444646cd59679cea4c03be';
const TEXT_SHA = '974d5bd587b34cde3dc9ec9e3da773606765c0a11f105b003aef58c3cc103b55';
const RELEASE = '20261025-vayishlach-vayechi-reader';
const BOOK = 'Beit Yaakov on Torah', SLUG = 'beit-yaakov-on-torah';
const REPORT = 'library/beit-yaakov-reader-20261025.json';
const PROOF = 'artifacts/beit-yaakov-reader-json/final-verification.json';
const PREVIOUS = 'new-books-baseline.json', META = 'new-books-publication.json';
const PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const RANGES = [['Vayishlach',48,518,5113,'וישלח'],['Vayeshev',48,365,5823,'וישב'],['Miketz',40,98,3913,'מקץ'],['Vayigash',35,158,4036,'ויגש'],['Vayechi',86,700,6356,'ויחי']];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = obj => JSON.stringify(obj);
const relative = (root,name) => {
  assert(name && !path.isAbsolute(name) && name.split('/').every(p=>p && p!=='.' && p!=='..'));
  const resolved = path.resolve(root,name); assert(resolved.startsWith(path.resolve(root)+path.sep));return resolved;
};
const read = (root,name) => JSON.parse(fs.readFileSync(relative(root,name),'utf8'));
const write = (root,name,bytes) => {
  const f=relative(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});
  fs.writeFileSync(f,Buffer.isBuffer(bytes) ? bytes : Buffer.from(typeof bytes==='string' ? bytes : json(bytes)));
};
const digest = (root,name) => sha(fs.readFileSync(relative(root,name)));
const leaves = node => node.children ? node.children.flatMap(leaves) : [node];
const escape = x => String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const visible = x => String(x).replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#39;|&#x27;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const sourceSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const heNumber = n => {
  const digits = [[400,'ת'],[300,'ש'],[200,'ר'],[100,'ק'],[90,'צ'],[80,'פ'],[70,'ע'],[60,'ס'],[50,'נ'],[40,'מ'],[30,'ל'],[20,'כ'],[10,'י'],[9,'ט'],[8,'ח'],[7,'ז'],[6,'ו'],[5,'ה'],[4,'ד'],[3,'ג'],[2,'ב'],[1,'א']];
  if(n===15)return 'ט״ו';if(n===16)return 'ט״ז';let t='',m=n;
  for(const [val,c] of digits)while(m>=val){t+=c;m-=val;}
  return t.length===1?t+'׳':t.slice(0,-1)+'״'+t.slice(-1);
};
const checkString = (x,hebrew) => typeof x==='string' && x.trim() && (hebrew ? /[א-ת]/.test(x) : /[A-Za-z]/.test(x));

function loadPack(){
  const encoded=fs.readFileSync(path.join(ROOT,PACK));assert.equal(sha(encoded),PACK_SHA,'Compressed edition differs from reviewed file');
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded.toString('utf8').trim()),'Unexpected base64');
  const bytes=gunzipSync(Buffer.from(encoded.toString('utf8').trim(),'base64'));
  assert.equal(sha(bytes),TEXT_SHA,'Decompressed manuscript changed');
  const pack=JSON.parse(bytes.toString('utf8'));
  assert.equal(pack.schemaVersion,1);assert.equal(pack.book,BOOK);assert.equal(pack.release,RELEASE);
  assert.equal(pack.sections.length,257);
  let i=0;
  for(const [parashah,length,paragraphs,pairs] of RANGES){
    const sections=pack.sections.slice(i,i+length);i+=length;
    assert.equal(sections.length,length);
    assert.deepEqual(sections.map(s=>s.key),Array.from({length},(_,n)=>parashah+' '+(n+1)));
    assert.equal(sections.reduce((n,s)=>n+s.items.length,0),paragraphs);
    assert.equal(sections.reduce((n,s)=>n+s.items.reduce((sum,item)=>sum+item.p.length,0),0),pairs);
    for(const section of sections){
      assert.equal(section.parashah,parashah);assert.equal(section.sep,':');
      assert.equal(section.sourceUrl,`https://www.sefaria.org/Beit_Yaakov_on_Torah,_${parashah}.${section.ois}`);
      for(let p=0;p<section.items.length;p++){
        const item=section.items[p];assert.equal(item.n,p+1);assert.equal(item.keepPairs,true);assert.equal(item.paragraphTranslation,true);
        assert(item.p.length>0);
        for(const pair of item.p){
          assert(Array.isArray(pair)&&pair.length===2 && checkString(pair[0],true) && checkString(pair[1],false),section.key+' missing Hebrew or English');
          assert(!/[\[\]]/.test(pair[1]),section.key+' English bracket not removed');
          assert(!/[<>]/.test(pair[0]+pair[1]),section.key+' unexpected HTML in source');
        }
      }
    }
  }
  assert.equal(i,257);
  return pack;
}

function allFiles(directory,prefix=''){
  const out=[];
  for(const e of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    assert(!e.isSymbolicLink(),'Untrusted site symlink: '+prefix+e.name);
    if(e.isDirectory())out.push(...allFiles(path.join(directory,e.name),prefix+e.name+'/'));
    else if(e.isFile())out.push(prefix+e.name);
    else throw Error('Unexpected site entry '+prefix+e.name);
  }
  return out;
}
function manifest(root){
  const data=relative(root,'library/data'),files=allFiles(data).filter(n=>n!=='files.json').sort();
  const digest=createHash('sha256');let total=0;
  for(const file of files){const buffer=fs.readFileSync(path.join(data,file));total+=buffer.length;digest.update(file);digest.update('\0');digest.update(buffer);}
  return {version:digest.digest('hex').slice(0,16),bytes:total,files};
}
const linked = (x,hebrew) => hebrew ? linkHebrewCitations(linkCitations(escape(x))) : linkCitations(escape(x));
function edgesFromPairs(pairs,ref,paragraph){
  const found=new Map();
  for(const phrase of pairs)for(const text of phrase){
    for(const m of text.matchAll(/<a\b[^>]*data-ref="([^"]+)"[^>]*>/g)){
      const r=normalizeRef(visible(m[1]));if(r&&!found.has(r))found.set(r,{a:ref+':'+paragraph,r,c:categoryOf(r)});
    }
  }
  return [...found.values()];
}
function updateSite(root){
  const p=loadPack();const before=read(ROOT,PREVIOUS),original=before.files;
  const base=read(ROOT,META);
  assert.equal(before.publication?.artifactId,base.publication?.artifactId,'Baseline selection changed');
  for(const name of ['library/index.html','library/sw.js','library/data/catalog.json',`library/data/${SLUG}/toc.json`,`library/data/${SLUG}/links.json`]){
    assert.equal(digest(root,name),original[name],'An existing reader file changed since baseline capture: '+name);
  }
  const affected=new Set(),touch=(name,data)=>{
    if(original[name])assert.equal(digest(root,name),original[name],'Existing site file preimage differs: '+name);
    else assert(!fs.existsSync(relative(root,name)),'Untracked file collision: '+name);
    write(root,name,data);affected.add(name);
  };
  const loc=n=>'library/data/'+n;
  const tocName=loc(SLUG+'/toc.json'),linksName=loc(SLUG+'/links.json'),catalogName=loc('catalog.json');
  const toc=read(root,tocName),catalog=read(root,catalogName),links=read(root,linksName);
  assert(Array.isArray(toc.toc.children));
  if(toc.beitFinalEdition?.release===RELEASE){console.log('The identical Beis Yaakov release is already in the restored publication.');return;}
  const existing=leaves(toc.toc),existingRefs=new Set(existing.map(l=>l.ref));
  assert(existing.some(l=>l.ref?.startsWith(BOOK+', Vayetzei ')),'The Vayetzei reader must be published before this update');
  for(const s of p.sections)assert(!existingRefs.has(BOOK+', '+s.parashah+' '+s.ois),'A Beis Yaakov section already exists and requires reconciliation: '+s.key);
  const book=catalog.find(b=>b.slug===SLUG);assert.equal(book?.title,BOOK);assert.equal(book.interlinear,true);
  const prefixToc=json(toc.toc.children),otherCatalog=json(catalog.filter(b=>b.slug!==SLUG));
  const earlierLinks=Object.keys(links).length;
  let nextId=Math.max(...existing.map(x=>x.id||0))+1;
  const reverse=new Map(),allEdges=[],created={},newGroups=[];
  const newBookSections=[];
  for(const [parashah,length,_,__,he] of RANGES){
    const sectionRows=[];
    for(const section of p.sections.filter(s=>s.parashah===parashah)){
      const ref=BOOK+', '+section.key;
      const items=[],edges=[];
      for(const item of section.items){
        const pairs=item.p.map(([h,e])=>[linked(h,true),linked(e,false)]);
        pairs.forEach((pair,index)=>assert.deepEqual(pair.map(visible),item.p[index],`Linked source changed manuscript ${ref}:${item.n}:${index}`));
        items.push({n:item.n,p:pairs,keepPairs:true,paragraphTranslation:false});
        edges.push(...edgesFromPairs(pairs,ref,item.n));
      }
      const id=nextId++,filename=loc(`${SLUG}/${id}.json`);
      assert(!fs.existsSync(relative(root,filename)),'Existing chapter ID conflict '+id);
      touch(filename,items);created[ref]={file:filename,id,paragraphs:items.length,pairs:items.reduce((sum,it)=>sum+it.p.length,0)};
      const distinct=new Set();const cleaned=edges.filter(e=>{const key=e.a+'\0'+e.r;if(distinct.has(key))return false;distinct.add(key);return true;});
      links[ref]=cleaned;allEdges.push(...cleaned);
      newBookSections.push(ref);
      sectionRows.push({en:section.en,he:`${he}, ${heNumber(section.ois)}`,id,depth:1,shape:items.length,interlinear:true,
        ref,heRef:`בית יעקב על התורה, ${he} ${heNumber(section.ois)}`,sourceUrl:section.sourceUrl,sep:':',parashah,ois:section.ois,
        presentation:'interlinear'});
    }
    assert.equal(sectionRows.length,length);
    newGroups.push({en:`${parashah} · ${length} Osiyos`,he,children:sectionRows});
  }
  toc.toc.children.push(...newGroups);
  toc.beitFinalEdition={release:RELEASE,parashiyot:RANGES.map(([name,n])=>({name,osiyos:n})),osiyos:257,paragraphs:1839,phrasePairs:25241,
    deduplicated:true,originalFilesUnchanged:true,englishBracketsRemoved:true,paragraphTranslation:false};
  assert.equal(json(toc.toc.children.slice(0,-5)),prefixToc,'Existing table of contents changed');
  book.segments+=1839;assert.equal(json(catalog.filter(b=>b.slug!==SLUG)),otherCatalog,'Other seforim changed');
  assert.equal(Object.keys(links).length,earlierLinks+257,'Source link group keys changed unexpectedly');
  assert(allEdges.length>100,'Missing source hyperlink connections');
  touch(tocName,toc);touch(catalogName,catalog);touch(linksName,links);
  for(const edge of allEdges){
    const slug=sourceSlug(edge.r);assert(slug,'Unrecognized source slug for '+edge.r);
    const name=loc('cited/'+slug+'.json');
    let refs=reverse.get(name);
    if(!refs){refs=fs.existsSync(relative(root,name))?read(root,name):{};reverse.set(name,refs);}
    const list=refs[edge.r]??=[];
    if(!list.includes(edge.a))list.push(edge.a);
  }
  for(const [name,index]of reverse)touch(name,index);
  const citedIndexName=loc('cited/index.json'),citedIndex=read(root,citedIndexName);
  const citedSlugs=new Set([...citedIndex,...[...reverse.keys()].map(s=>s.split('/').at(-1).slice(0,-5))]);
  touch(citedIndexName,[...citedSlugs].sort());
  const sourcePackName=loc('packs/sources.json'),sourcePack=read(root,sourcePackName);
  const sourceRefs=new Set([...sourcePack.refs,...allEdges.map(e=>e.r).filter(r=>!catalog.some(b=>r===b.title||r.startsWith(b.title+' ')||r.startsWith(b.title+',')))]);
  sourcePack.refs=[...sourceRefs].sort();touch(sourcePackName,sourcePack);
  const manifestName=loc('files.json');touch(manifestName,manifest(root));
  const htmlName='library/index.html',html=fs.readFileSync(relative(root,htmlName),'utf8');
  const marker='const editionDataUrl = url => ';
  assert.equal(html.split(marker).length,2,'Reader cache helper unexpectedly changed');
  assert(!html.includes('/* Beis Yaakov '+RELEASE+' */'));
  const rewritten=html.replace(marker,marker+`/* Beis Yaakov ${RELEASE} */ (url.startsWith('data/${SLUG}/') || url.startsWith('data/cited/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?beit=${TEXT_SHA.slice(0,12)}' :\n`);
  assert(rewritten.includes('paragraph-translation') && rewritten.includes('text-align:left'),'Reader must retain paragraph layout and left-aligned English');
  touch(htmlName,rewritten);
  const swName='library/sw.js',sw=fs.readFileSync(relative(root,swName),'utf8');
  assert.equal((sw.match(/const SHELL = `[^`]+`;/g)||[]).length,1,'Unexpected service worker cache revision');
  touch(swName,sw.replace(/const SHELL = `([^`]+)`;/,(_,v)=>`const SHELL = \`${v}-beit-20261025-${TEXT_SHA.slice(0,12)}\`;`));
  const report={schemaVersion:1,release:RELEASE,sourcePackSha256:PACK_SHA,sourceTextSha256:TEXT_SHA,
    publication:base.publication,originalFileCount:Object.keys(original).length,existingBeitSections:existing.length,
    addedSections:newBookSections.length,addedParagraphs:1839,addedPhrasePairs:25241,sourceConnections:allEdges.length,
    reverseIndexes:reverse.size,previousSourceSections:earlierLinks,unchangedPriorToc:true,unchangedOtherBooks:true,
    affected:[...affected].sort().map(name=>({name,sha256:digest(root,name),preimage:original[name]||null})),
    preview:{first:newBookSections[0],last:newBookSections.at(-1)},validation:'Unverified source references are not asserted to be editorially verified.'};
  touch(REPORT,report);
  write(ROOT,PROOF,{ok:true,release:RELEASE,addedSections:257,paragraphs:1839,phrasePairs:25241,
    links:allEdges.length,publishedFiles:report.affected.length,baselineArtifact:base.publication.artifactId});
  console.log(json({ok:true,sections:257,paragraphs:1839,pairs:25241,sourceConnections:allEdges.length,affected:affected.size,reverseIndexes:reverse.size}));
}

function verify(root){
  const pack=loadPack(),base=read(ROOT,PREVIOUS),before=base.files,report=read(root,REPORT);
  assert.equal(report.release,RELEASE);assert.equal(report.addedSections,257);
  const allow=new Set([REPORT,...report.affected.map(f=>f.name)]);
  const afterNames=allFiles(root).sort();assert(afterNames.length>=Object.keys(before).length);
  for(const [name,hash]of Object.entries(before)){
    assert(fs.existsSync(relative(root,name)),'Existing published file missing: '+name);
    if(!allow.has(name))assert.equal(digest(root,name),hash,'Unrelated published file altered: '+name);
  }
  for(const f of report.affected)assert.equal(digest(root,f.name),f.sha256,'Published Beis Yaakov file changed: '+f.name);
  const toc=read(root,`library/data/${SLUG}/toc.json`),catalog=read(root,'library/data/catalog.json'),links=read(root,`library/data/${SLUG}/links.json`);
  assert.equal(toc.beitFinalEdition.release,RELEASE);
  const sections=leaves(toc.toc).filter(s=>pack.sections.some(k=>BOOK+', '+k.key===s.ref));
  assert.equal(sections.length,257);
  let count=0,pairs=0,brackets=0;
  for(const original of pack.sections){
    const leaf=sections.find(s=>s.ref===BOOK+', '+original.key);assert(leaf?.interlinear && leaf.presentation==='interlinear');
    const items=read(root,`library/data/${SLUG}/${leaf.id}.json`);
    assert.equal(items.length,original.items.length);count+=items.length;
    for(let i=0;i<items.length;i++){
      assert.equal(items[i].paragraphTranslation,false);assert.equal(items[i].keepPairs,true);
      assert.equal(items[i].p.length,original.items[i].p.length);
      for(let j=0;j<items[i].p.length;j++){
        assert.deepEqual(items[i].p[j].map(visible),original.items[i].p[j],`Source text changed in ${original.key} ${i+1}:${j+1}`);
        pairs++;brackets+=items[i].p[j][1].includes('[')||items[i].p[j][1].includes(']')?1:0;
      }
    }
    assert(Array.isArray(links[leaf.ref]));
  }
  assert.equal(count,1839);assert.equal(pairs,25241);assert.equal(brackets,0);
  const version=read(root,'library/data/files.json').version;assert.equal(version,manifest(root).version);
  assert.equal(catalog.filter(b=>b.slug===SLUG).length,1);
  assert.equal(read(root,REPORT).sourceConnections>100,true);
  console.log(json({ok:true,sections:257,paragraphs:count,pairs,sourceConnections:report.sourceConnections,otherFilesPreserved:Object.keys(before).length-report.affected.filter(f=>f.preimage).length,updatedFiles:report.affected.length,newFiles:afterNames.length-Object.keys(before).length,version}));
}
async function publicBytes(name){
  const url=new URL(name,PUBLIC);url.searchParams.set('beit_verify',Date.now());
  const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(60000)});
  assert(r.ok,`HTTP ${r.status} ${name}`);return Buffer.from(await r.arrayBuffer());
}
async function verifyLive(){
  const report=read('dist'===process.env.BEIT_SITE_ROOT?'dist':'.beit-site',REPORT);
  const targets=[...report.affected, {name:REPORT,sha256:digest('.beit-site',REPORT)}];
  let passed=0,queue=0;
  const errors=[];
  await Promise.all(Array.from({length:6},async()=>{
    for(;;){const n=queue++;if(n>=targets.length)return;const f=targets[n];let ok=false;
      for(let attempt=0;attempt<4;attempt++){
        try{if(sha(await publicBytes(f.name))===f.sha256){ok=true;break;}}catch(e){if(attempt===3)errors.push({path:f.name,error:String(e)})}
        if(attempt<3)await new Promise(r=>setTimeout(r,2000));
      }
      if(!ok)errors.push({path:f.name,error:'Published bytes did not match local release'});else passed++;
    }
  }));
  assert.equal(errors.length,0,'Live URL verification failed: '+json(errors.slice(0,8)));
  write(ROOT,PROOF,{ok:true,live:true,release:RELEASE,publicFilesChecked:passed,addedSections:257,
    phrasePairs:25241,sourceConnections:report.sourceConnections,originalBooksPreserved:true});
  console.log(json({ok:true,live:true,publicFilesChecked:passed,sourceConnections:report.sourceConnections}));
}
const mode=process.argv[2];const site=process.argv[3]||'.beit-site';
if(mode==='--check-pack')console.log(json({ok:true,sections:loadPack().sections.length,release:RELEASE}));
else if(mode==='--apply')updateSite(site);
else if(mode==='--verify')verify(site);
else if(mode==='--live')await verifyLive();
else throw Error('Usage: node scripts/publish-beit-yaakov-final.mjs --check-pack | --apply SITE | --verify SITE | --live');

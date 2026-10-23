// Replay the reviewed Divrei Soferim source correction after historical editions.
// Exact predecessor hashes and sealed postimages prevent unrelated overwrites.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const RELEASE = '20261022-divrei-source-audit-v1';
export const PACK = 'sources/akiva/overlays/divrei-source-audit-20261022.json';
export const REPORT = 'divrei-source-audit-20261022.json';
export const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
export const plain = value => String(value ?? '').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,key) => {
  if(key[0]==='#')return String.fromCodePoint(key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1)));
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[key.toLowerCase()] ?? all;
});
const body = value => Array.isArray(value) ? value.map(body) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key])=>key!=='footnotes').map(([key,item])=>[key,key==='p'?item.map(pair=>pair.map(plain)):body(item)])) : value;
export const bodyDigest = value => sha(JSON.stringify(canonical(body(value))));
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const walk = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]).sort();
const ownerIsDivrei = value => /^Divrei Soferim(?:\s\d|, Introduction)/.test(value);
const sourceSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export function readPack(filename=PACK) {
  const bytes=fs.readFileSync(filename),manifest=JSON.parse(bytes);
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.release,RELEASE);
  assert(/^[a-z0-9.-]+\.json\.gz\.b64$/.test(manifest.payloadFile),'Unsafe audit payload name');
  const encoded=fs.readFileSync(path.join(path.dirname(filename),manifest.payloadFile),'utf8').replace(/\s/g,'');
  const compressed=Buffer.from(encoded,'base64');assert.equal(compressed.toString('base64'),encoded);
  assert.equal(sha(compressed),manifest.payloadSha256,'Audit package checksum differs');
  const pack=JSON.parse(gunzipSync(compressed));assert.equal(pack.release,RELEASE);
  assert.equal(pack.audit.reviewedExistingNotes,717);assert.equal(pack.audit.newNotes,1);
  assert.equal(pack.audit.unresolvedInlineLinks.length,0,'Unresolved source-link decisions');
  const numbers=pack.audit.notes.map(n=>n.number).sort((a,b)=>a-b);
  assert.deepEqual(numbers,Array.from({length:718},(_,i)=>i+1),'Incomplete source review');
  assert.equal(new Set(pack.audit.notes.map(n=>n.sourceId)).size,718);
  const paths=new Set();
  for(const f of pack.files){
    assert(/^data\/divrei-soferim\/(?:[1-9]|[12]\d|3[0-8]|links)\.json$/.test(f.path),'Unscoped audit path');
    assert(!paths.has(f.path));paths.add(f.path);
    assert.equal(sha(f.afterText),f.afterSha256,'Corrupt audited postimage');
    if(f.bodySha256)assert.equal(bodyDigest(JSON.parse(f.afterText)),f.bodySha256,'Audited text differs');
  }
  assert.equal(pack.files.length,39); //38 sections and their exact connections.
  // Two malformed numeric citation indexes were included by earlier chapter
  // preservation guards. Seal their exact Divrei-only cleanup as well.
  assert.deepEqual(pack.sourceIndexSuccessors?.map(f=>f.path).sort(),['data/cited/213-8.json','data/cited/80.json']);
  const edges=Object.values(JSON.parse(pack.files.find(f=>f.path==='data/divrei-soferim/links.json').afterText)).flat();
  for(const f of pack.sourceIndexSuccessors){
    assert.equal(sha(f.beforeText),f.beforeSha256,'Corrupt source-index predecessor');
    assert.equal(sha(f.afterText),f.afterSha256,'Corrupt source-index successor');
    const before=JSON.parse(f.beforeText),remaining={};
    assert(before&&typeof before==='object'&&!Array.isArray(before));
    assert(Object.keys(before).length,'Empty source-index predecessor');
    for(const alternative of f.equivalentPredecessors||[]){
      assert.equal(sha(alternative.text),alternative.sha256,'Corrupt equivalent source-index predecessor');
      assert.deepEqual(canonical(JSON.parse(alternative.text)),canonical(before),'Source-index alternative changes content');
    }
    for(const[ref,owners]of Object.entries(before)){
      assert(Array.isArray(owners)&&owners.length&&owners.every(owner=>typeof owner==='string'&&ownerIsDivrei(owner)),
        'Source-index cleanup includes a protected owner');
      const retained=owners.filter(owner=>!ownerIsDivrei(owner));
      if(retained.length)remaining[ref]=retained;
    }
    assert(!edges.some(edge=>sourceSlug(edge.r)===path.basename(f.path,'.json')),'Reviewed source still uses retired index');
    assert.equal(f.afterText,JSON.stringify(remaining),'Source-index successor differs from Divrei-only cleanup');
    assert.equal(f.afterText,'{}');
  }
  return {...pack,manifest,packageSha256:sha(bytes)};
}

// Other edition verifiers may accept only this exact authorized successor.
// The predecessor checksum must match their original protection record.
export function protectedSuccessorHash(file,expected,pack) {
  if(!pack)return expected;
  const relative=file.startsWith('data/')?file:'data/'+file;
  const reviewed=[...pack.files,...pack.sourceIndexSuccessors].find(f=>f.path===relative);
  if(!reviewed)return expected;
  assert([reviewed.beforeSha256,...(reviewed.equivalentPredecessors||[]).map(f=>f.sha256)].includes(expected),
    'Audit does not descend from protected edition: '+file);
  return reviewed.afterSha256;
}

export function readPublishedAudit(library='dist/library',filename=PACK) {
  const reportFile=path.join(library,REPORT);
  if(!fs.existsSync(reportFile))return null;
  const pack=readPack(filename),report=read(reportFile);
  assert.equal(report.release,RELEASE);assert.equal(report.packageSha256,pack.packageSha256);
  for(const file of [...pack.files,...pack.sourceIndexSuccessors])assert.equal(sha(fs.readFileSync(path.join(library,file.path))),file.afterSha256,'Published audit file changed: '+file.path);
  return pack;
}

export function publish(library='dist/library',filename=PACK) {
  const pack=readPack(filename),targetFiles=new Set(pack.files.map(f=>path.join(library,f.path)));
  const allAfter=pack.files.every(f=>sha(fs.readFileSync(path.join(library,f.path)))===f.afterSha256);
  if(allAfter){readPublishedAudit(library,filename);return {...read(path.join(library,REPORT)),mode:'already-applied'};}
  const data=path.join(library,'data');
  const protectedFiles=walk(data).filter(f=>!targetFiles.has(f));
  const snapshot=()=>sha(JSON.stringify(protectedFiles.map(f=>[path.relative(data,f),sha(fs.readFileSync(f))])));
  const beforeProtected=snapshot();
  for(const f of pack.files){
    const raw=fs.readFileSync(path.join(library,f.path));
    assert.equal(sha(raw),f.beforeSha256,'Reader changed since source review: '+f.path);
    if(f.bodySha256)assert.equal(bodyDigest(JSON.parse(raw)),f.bodySha256,'Author text or structure changed: '+f.path);
  }
  for(const f of pack.sourceIndexSuccessors)
    assert([f.beforeSha256,...(f.equivalentPredecessors||[]).map(p=>p.sha256)].includes(sha(fs.readFileSync(path.join(library,f.path)))),
      'Source index changed since review: '+f.path);
  for(const f of pack.files)fs.writeFileSync(path.join(library,f.path),f.afterText);
  assert.equal(snapshot(),beforeProtected,'An unrelated reader data file changed');

  const links=read(path.join(data,'divrei-soferim/links.json'));
  const edges=Object.values(links).flat();
  const citedDir=path.join(data,'cited'),sourceNames=new Set(read(path.join(citedDir,'index.json')));
  let removedOwners=0;
  // Remove stale reverse connections owned by this book; retain all other owners.
  for(const name of sourceNames){
    const file=path.join(citedDir,name+'.json');if(!fs.existsSync(file))continue;
    const index=read(file);let changed=false;
    for(const [ref,owners]of Object.entries(index)){
      const retained=owners.filter(owner=>!ownerIsDivrei(owner));
      if(retained.length!==owners.length){removedOwners+=owners.length-retained.length;changed=true;
        if(retained.length)index[ref]=retained;else delete index[ref];}
    }
    if(changed)fs.writeFileSync(file,JSON.stringify(index));
  }
  const reverse=new Map();
  for(const edge of edges){
    const name=sourceSlug(edge.r);assert(name,'Empty source slug');
    if(!reverse.has(name)){const f=path.join(citedDir,name+'.json');reverse.set(name,fs.existsSync(f)?read(f):{});}
    const index=reverse.get(name),owners=index[edge.r]||(index[edge.r]=[]);
    if(!owners.includes(edge.a))owners.push(edge.a);sourceNames.add(name);
  }
  for(const[name,index]of reverse)fs.writeFileSync(path.join(citedDir,name+'.json'),JSON.stringify(index));
  for(const f of pack.sourceIndexSuccessors)
    assert.equal(sha(fs.readFileSync(path.join(library,f.path))),f.afterSha256,'Source-index cleanup differs from sealed proof: '+f.path);
  fs.writeFileSync(path.join(citedDir,'index.json'),JSON.stringify([...sourceNames].sort()));
  const sourceFile=path.join(data,'packs/sources.json');
  if(fs.existsSync(sourceFile)){
    const sources=read(sourceFile);sources.refs=[...new Set([...sources.refs,...edges.map(e=>e.r)])].sort();
    fs.writeFileSync(sourceFile,JSON.stringify(sources));
  }
  const revision=RELEASE+'-'+pack.packageSha256.slice(0,12);
  const htmlFile=path.join(library,'index.html');let html=fs.readFileSync(htmlFile,'utf8');
  const marker='const editionDataUrl = url => ';assert.equal(html.split(marker).length,2);
  html=html.replace(/\/\* Divrei source audit revision \*\/[^\n]*\n/g,'');
  html=html.replace(marker,marker+`/* Divrei source audit revision */ (url.startsWith('data/divrei-soferim/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json' || url === 'source-connections/translations.json') ? url + '?edition=${revision}' :\n`);
  fs.writeFileSync(htmlFile,html);
  const swFile=path.join(library,'sw.js');let sw=fs.readFileSync(swFile,'utf8');
  assert.match(sw,/const SHELL = `[^`]+`;/);
  sw=sw.replace(/-divrei-source-audit-[a-f0-9]+/g,'').replace(/const SHELL = `([^`]+)`;/,`const SHELL = \`$1-divrei-source-audit-${pack.packageSha256.slice(0,12)}\`;`);
  fs.writeFileSync(swFile,sw);
  const report={schemaVersion:1,release:RELEASE,revision,packageSha256:pack.packageSha256,payloadSha256:pack.manifest.payloadSha256,
    counts:pack.counts,files:pack.files.map(({afterText,...f})=>f),
    sourceIndexSuccessors:pack.sourceIndexSuccessors.map(({beforeText,afterText,...f})=>f),
    protectedDataFiles:protectedFiles.length,protectedDataSha256:beforeProtected,
    authorTextPreserved:true,existingNoteIdentitiesPreserved:true,excludedParallelDataPreserved:true,
    sourceConnections:edges.length,replacedReverseConnectionOwners:removedOwners};
  fs.writeFileSync(path.join(library,REPORT),JSON.stringify(report));
  fs.writeFileSync(path.join(library,'divrei-source-audit-ledger.json'),JSON.stringify(pack.audit));
  return {...report,mode:'applied'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const i=process.argv.indexOf('--root');console.log(JSON.stringify(publish(i<0?'dist/library':process.argv[i+1])));
}

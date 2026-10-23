// Apply a scoped Divrei release to a previously verified Pages artifact while
// retaining exact proofs for every pre-existing reader file and source owner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {RELEASE,REPORT,readPack,sha,bodyDigest,protectedSuccessorHash} from './publish-divrei-source-audit.mjs';

const ENGINE_SHA256='f0362269e5f2f2c3d64e2d6b793a7591ad3d702f69fc410afb00c86d51ad39ab';
const reports=['reader-docx-import-20261022.json','dover-kdp-reader-report.json'];
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  assert(!e.isSymbolicLink(),'Baseline must not contain symbolic links');
  return e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)];
}).sort();
const relativeFiles=root=>walk(root).map(file=>path.relative(root,file).split(path.sep).join('/')).sort();
const isDivrei=value=>/^Divrei Soferim(?:\s\d|, Introduction)/.test(value);
const slug=ref=>ref.replace(/\s+\d[\dab:\-–]*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const sourceEdges=pack=>Object.values(JSON.parse(pack.files.find(f=>f.path==='data/divrei-soferim/links.json').afterText)).flat();
const derived=new Set(['data/files.json','data/cited/index.json','data/packs/sources.json',
  'source-connections/translations.json','source-connections/catalog.json','connected-ideas/catalog.json',
  'connected-ideas/review-progress.json','downloads/index.json','index.html','sw.js','source-connections.js',
  REPORT,'divrei-source-audit-ledger.json']);
const isDerived=file=>derived.has(file)||/^data\/cited\/[^/]+\.json$/.test(file)||/^downloads\/(?:books\/)?[a-z0-9-]+\.zip$/.test(file);

export function captureBaseline(root,pack){
  const files=Object.fromEntries(relativeFiles(root).map(file=>[file,sha(fs.readFileSync(path.join(root,file)))]));
  const cited={};
  for(const file of Object.keys(files).filter(file=>/^data\/cited\/[^/]+\.json$/.test(file)&&file!=='data/cited/index.json'))
    cited[file]=read(path.join(root,file));
  for(const f of pack.files){
    assert.equal(files[f.path],f.beforeSha256,'Wrong baseline chapter: '+f.path);
    if(f.bodySha256)assert.equal(bodyDigest(read(path.join(root,f.path))),f.bodySha256);
  }
  return {schemaVersion:1,release:RELEASE,packageSha256:pack.packageSha256,files,cited,
    sourceNames:read(path.join(root,'data/cited/index.json')),sources:read(path.join(root,'data/packs/sources.json')),
    html:fs.existsSync(path.join(root,'index.html'))?fs.readFileSync(path.join(root,'index.html'),'utf8'):null,
    serviceWorker:fs.existsSync(path.join(root,'sw.js'))?fs.readFileSync(path.join(root,'sw.js'),'utf8'):null};
}

export function verifyPreservedData(root,baseline,pack){
  assert.equal(baseline.release,RELEASE);assert.equal(baseline.packageSha256,pack.packageSha256);
  const targets=new Map(pack.files.map(f=>[f.path,f]));
  const actualNames=relativeFiles(root),actualSet=new Set(actualNames);
  for(const[file,digest]of Object.entries(baseline.files)){
    assert(actualSet.has(file),'A baseline file disappeared: '+file);
    if(targets.has(file))assert.equal(sha(fs.readFileSync(path.join(root,file))),targets.get(file).afterSha256,'Wrong Divrei successor: '+file);
    else if(!isDerived(file))assert.equal(sha(fs.readFileSync(path.join(root,file))),digest,'Unrelated file changed: '+file);
  }
  const edges=sourceEdges(pack),expected=structuredClone(baseline.cited),names=new Set(baseline.sourceNames);
  for(const[file,index]of Object.entries(expected)){
    assert(index&&typeof index==='object'&&!Array.isArray(index),'Invalid source index: '+file);
    for(const[ref,owners]of Object.entries(index)){
      assert(Array.isArray(owners)&&owners.every(owner=>typeof owner==='string'),'Invalid source owner array');
      const retained=owners.filter(owner=>!isDivrei(owner));
      if(retained.length!==owners.length){if(retained.length)index[ref]=retained;else delete index[ref];}
    }
  }
  for(const edge of edges){
    assert(isDivrei(edge.a),'Sealed edge has an unrelated owner');
    const name=slug(edge.r);assert(name);names.add(name);
    const file='data/cited/'+name+'.json',index=expected[file]||(expected[file]={}),owners=index[edge.r]||(index[edge.r]=[]);
    if(!owners.includes(edge.a))owners.push(edge.a);
  }
  const actualCited=actualNames.filter(file=>/^data\/cited\/[^/]+\.json$/.test(file)&&file!=='data/cited/index.json');
  assert.deepEqual(actualCited,Object.keys(expected).sort(),'Unexpected added or omitted citation index');
  for(const[file,index]of Object.entries(expected))assert.deepEqual(read(path.join(root,file)),index,'Unrelated source owner or reviewed edge changed: '+file);
  assert.deepEqual(read(path.join(root,'data/cited/index.json')),[...names].sort(),'Source title index differs');
  const sources=structuredClone(baseline.sources);sources.refs=[...new Set([...sources.refs,...edges.map(e=>e.r)])].sort();
  assert.deepEqual(read(path.join(root,'data/packs/sources.json')),sources,'Source pack lost prior refs or changed unrelated fields');
  for(const file of actualNames)if(!Object.hasOwn(baseline.files,file))
    assert(Object.hasOwn(expected,file)||[REPORT,'divrei-source-audit-ledger.json'].includes(file), 'Unapproved new reader file: '+file);
  for(const f of pack.files)if(f.bodySha256)assert.equal(bodyDigest(read(path.join(root,f.path))),f.bodySha256,'Divrei author wording changed');
  return {baselineFiles:Object.keys(baseline.files).length,exactSourceIndexes:actualCited.length};
}

function verifyManifestAndArchives(root,baseline,pack){
  const files=relativeFiles(path.join(root,'data')).filter(file=>file!=='files.json');
  const digest=createHash('sha256');let bytes=0;
  for(const file of files){const raw=fs.readFileSync(path.join(root,'data',file));digest.update(file).update('\0').update(raw);bytes+=raw.length;}
  const manifest={version:digest.digest('hex').slice(0,16),bytes,files};
  assert.deepEqual(read(path.join(root,'data/files.json')),manifest,'Final data manifest differs from real files');
  const downloads=read(path.join(root,'downloads/index.json'));assert.equal(downloads.version,manifest.version);
  const {unzipSync}=createRequire(import.meta.url)(path.resolve(root,'vendor/fflate.min.js'));
  const archive=unzipSync(fs.readFileSync(path.join(root,downloads.library.file)));
  assert.deepEqual(Object.keys(archive).filter(file=>file.startsWith('data/')).sort(),[...files.map(file=>'data/'+file),'data/files.json'].sort(),'Whole-library ZIP file list differs');
  for(const file of [...files,'files.json'])assert.equal(sha(archive['data/'+file]),sha(fs.readFileSync(path.join(root,'data',file))),'Whole-library ZIP is stale: '+file);
  let protectedEntries=0;
  for(const filename of reports){
    assert(baseline.files[filename],'Trusted baseline lacks preservation report: '+filename);
    assert.equal(sha(fs.readFileSync(path.join(root,filename))),baseline.files[filename],'Preservation report changed');
    const report=read(path.join(root,filename));assert(report.protectedTextSha256&&Object.keys(report.protectedTextSha256).length>0,'Missing predecessor preservation record');
    for(const[file,expected]of Object.entries(report.protectedTextSha256)){
      assert(archive['data/'+file],'Protected file absent from final ZIP: '+file);
      assert.equal(sha(archive['data/'+file]),protectedSuccessorHash(file,expected,pack),'Predecessor preservation failed: '+file);protectedEntries++;
    }
  }
  for(const[file,expected]of Object.entries(baseline.files).filter(([file])=>/^downloads\/[^/]+\.(docx|pdf)$/i.test(file)))
    assert.equal(sha(archive[file]),expected,'Original manuscript omitted or changed in archive: '+file);
  return {exactArchiveDataFiles:files.length+1,protectedPredecessorEntries:protectedEntries,manifestVersion:manifest.version};
}

function verifyReaderShell(root,baseline,pack){
  assert.equal(sha(fs.readFileSync(path.join(root,'source-connections.js'))),ENGINE_SHA256,'Unexpected source-popup engine');
  let html=baseline.html;assert.equal(typeof html,'string');
  const oldQuery='source-connections.js?v=20261021-pri-seasonal-pdf-quotations-v1-92abce2ff13b';
  assert.equal(html.split(oldQuery).length,2,'Baseline source-popup version differs');
  html=html.replace(oldQuery,'source-connections.js?v=20261022-reviewed-connections-v5');
  const marker='const editionDataUrl = url => ',revision=RELEASE+'-'+pack.packageSha256.slice(0,12);
  assert.equal(html.split(marker).length,2);
  html=html.replace(/\/\* Divrei source audit revision \*\/[^\n]*\n/g,'');
  html=html.replace(marker,marker+`/* Divrei source audit revision */ (url.startsWith('data/divrei-soferim/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json' || url === 'source-connections/translations.json') ? url + '?edition=${revision}' :\n`);
  assert.equal(fs.readFileSync(path.join(root,'index.html'),'utf8'),html,'Reader HTML changed beyond approved version/cache edits');
  let sw=baseline.serviceWorker;assert.equal(typeof sw,'string');assert.match(sw,/const SHELL = `[^`]+`;/);
  sw=sw.replace(/-divrei-source-audit-[a-f0-9]+/g,'').replace(/const SHELL = `([^`]+)`;/,`const SHELL = \`$1-divrei-source-audit-${pack.packageSha256.slice(0,12)}\`;`);
  assert.equal(fs.readFileSync(path.join(root,'sw.js'),'utf8'),sw,'Service worker changed beyond cache revision');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};let mode;
  for(let i=0;i<args.length;i++){
    if(['--capture','--verify'].includes(args[i])){assert(!mode,'Choose one mode');mode=args[i];}
    else{assert(['--root','--baseline-record','--pack'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'Unknown/missing option');options[args[i]]=args[++i];}
  }
  assert(mode&&options['--baseline-record'],'Mode and --baseline-record are required');
  const root=path.resolve(options['--root']||'dist/library'),record=options['--baseline-record'],pack=readPack(options['--pack']);
  if(mode==='--capture'){
    assert(!fs.existsSync(record),'Refusing to replace the trusted baseline record');
    const baseline=captureBaseline(root,pack);
    for(const report of reports)assert(baseline.files[report],'Verified baseline report absent: '+report);
    fs.writeFileSync(record,JSON.stringify(baseline));console.log(JSON.stringify({ok:true,mode,baselineFiles:Object.keys(baseline.files).length,packageSha256:pack.packageSha256}));
  }else{
    const baseline=read(record),data=verifyPreservedData(root,baseline,pack),archives=verifyManifestAndArchives(root,baseline,pack);
    verifyReaderShell(root,baseline,pack);
    console.log(JSON.stringify({ok:true,mode,release:RELEASE,packageSha256:pack.packageSha256,...data,...archives,readerShellPreserved:true,originalManuscriptsPreserved:true},null,2));
  }
}

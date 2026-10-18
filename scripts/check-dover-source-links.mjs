// Exercise every internal Dover citation with the reader's actual bundled-text resolver.
// --source accepts a prepared master JSON before publication; otherwise check published Dover.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export async function checkDoverSourceLinks({source=null,quiet=false}={}) {
  const root=path.resolve('dist/library');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const start=html.indexOf('function sectionsOf(leaf)');
  const end=html.indexOf('const CAT_COLORS',start);
  assert.ok(start>=0 && end>start,'Reader local resolver implementation is missing');
  const studyStart=html.indexOf('const meiStudyRefs = new Set(');
  const studyEnd=html.indexOf('async function fetchText(',studyStart);
  assert.ok(studyStart>=0 && studyEnd>studyStart,'Reader Mei HaShiloach study resolver is missing');
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json'),'utf8'));
  const tocCache=new Map();
  const leavesOf=node=>node.children?node.children.flatMap(leavesOf):[node];
  const context=vm.createContext({
    CATALOG:catalog,catalogReady:Promise.resolve(catalog),leavesOf,
    gematria:number=>String(number),editionDataUrl:url=>url,
    dataJSON:async file=>JSON.parse(fs.readFileSync(path.join(root,'data',file),'utf8')),
    loadToc:async slug=>{
      if(!tocCache.has(slug))tocCache.set(slug,JSON.parse(fs.readFileSync(path.join(root,'data',slug,'toc.json'),'utf8')));
      return tocCache.get(slug);
    },
    fetch:async url=>{
      const pathname=new URL(url,'https://reader.example/library/').pathname.replace(/^\/library\//,'');
      const file=path.resolve(root,pathname);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return{ok:false,status:404,json:async()=>null};
      return{ok:true,status:200,json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))};
    }
  });
  vm.runInContext(html.slice(start,end)+'\n'+html.slice(studyStart,studyEnd)+
    '\nglobalThis.testResolveLocal=async ref=>meiStudyRefs.has(ref)?withMeiStudy({ref,sectionRef:ref,he:[],en:[]}):resolveLocal(ref);',context,{filename:'published-reader-resolver.js'});
  const hrefs=new Set();
  const walk=value=>{
    if(!value||typeof value!=='object')return;
    if(typeof value.href==='string' && value.href.startsWith('#/read/'))hrefs.add(value.href);
    for(const child of Object.values(value))if(child&&typeof child==='object')walk(child);
  };
  if(source)walk(JSON.parse(fs.readFileSync(source,'utf8')));
  else for(const file of fs.readdirSync(path.join(root,'data/dover-tzedek')).filter(file=>/^\d+(?:-\d+)?\.json$/.test(file)))
    walk(JSON.parse(fs.readFileSync(path.join(root,'data/dover-tzedek',file),'utf8')));
  assert.ok(hrefs.size,'No published internal Dover source links found');
  const hasText=value=>Array.isArray(value)?value.some(hasText):typeof value==='string'&&value.replace(/<[^>]*>/g,'').trim().length>0;
  const failures=[];
  for(const href of hrefs) {
    const ref=decodeURIComponent(href.slice('#/read/'.length)).replace(/_/g,' ');
    try {
      const result=await context.testResolveLocal(ref);
      assert.ok(result?.local||result?.meiStudy,'No bundled text resolves');
      assert.ok(result.sectionRef===ref||result.highlight===ref,`Resolved to ${result.sectionRef}${result.highlight?' / '+result.highlight:''}`);
      assert.ok(hasText(result.he),'Resolved source chapter has no Hebrew text');
      if(result.meiStudy)assert.ok(hasText(result.en),'Reviewed Mei HaShiloach chapter has no English text');
      if(result.highlight) {
        const segment=Number(result.highlight.slice(result.sectionRef.length+result.sep.length));
        const nums=result.nums||result.he.map((_,index)=>index+1);
        assert.ok(nums.includes(segment),`Requested source paragraph ${segment} is absent (available ${nums[0]}–${nums.at(-1)})`);
      }
    } catch(error) {failures.push({href,ref,error:error.message});}
  }
  if(failures.length) {
    const error=new Error(`${failures.length}/${hrefs.size} internal Dover citations do not resolve precisely:\n`+failures.slice(0,10).map(f=>`${f.ref}: ${f.error}`).join('\n'));
    Object.defineProperty(error,'failures',{value:failures,enumerable:false});
    throw error;
  }
  if(!quiet)console.log(`PASS all ${hrefs.size} unique Dover internal citations resolve to their exact bundled source chapter or existing paragraph using the published reader resolver.`);
  return{links:hrefs.size,failures};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const index=process.argv.indexOf('--source');
  if(index>=0)assert.ok(process.argv[index+1],'--source requires a JSON file');
  try {await checkDoverSourceLinks({source:index<0?null:process.argv[index+1]});}
  catch(error) {console.error(error.message);process.exitCode=1;}
}

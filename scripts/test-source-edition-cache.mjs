#!/usr/bin/env node
// Verify the shipped service worker and offline pack loader cannot substitute
// a default translation for a request naming an exact English edition.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const editions=require('../dist/library/source-editions.js');
const packs=require('../dist/library/sefaria-packs.js');
const workerPath=process.argv.find(arg=>arg.startsWith('--worker='))?.slice(9)||'dist/library/sw.js';
const sw=fs.readFileSync(workerPath,'utf8');
const checks=[];
async function check(name,run){await run();checks.push(name);}

function serviceWorker(saved){
  const matches=[],writes=[];
  const context=vm.createContext({URL,Request,Response,console,
    setTimeout:()=>0,
    fetch:async()=>{throw new Error('Offline fixture');},
    caches:{open:async()=>({
      match:async(request,options)=>{
        const url=typeof request==='string'?request:request.url;
        matches.push({url,...options});
        const key=options.ignoreSearch?new URL(url).pathname:url;
        return saved.get(key)?.clone();
      },
      put:async(request,response)=>writes.push({request,response})
    })},
    self:{addEventListener(){},registration:{scope:'https://reader.test/library/'}}
  });
  vm.runInContext(sw+'\nglobalThis.swTest={networkFirst,hasExplicitEdition,SHELL_FILES,DATA};',context);
  return {...context.swTest,matches,writes};
}

const ref='Exodus 12:11';
const preferredRequest=new Request(editions.requestUrl(ref));
const preferredPayload={ref,versions:[
  {language:'he',versionTitle:'Hebrew test fixture',text:'טקסט עברי'},
  {language:'en',versionTitle:editions.EDITIONS.chumash,text:'Preferred fixture text.'}
]};
await check('offline service worker rejects a queryless default-translation cache entry',async()=>{
  const worker=serviceWorker(new Map([[new URL(preferredRequest.url).pathname,new Response('Wrong cached JPS fixture')]]));
  await assert.rejects(worker.networkFirst(preferredRequest,'rtl-external'),/Offline fixture/);
  assert(worker.matches.length===1 && !worker.matches[0].ignoreSearch);
});
await check('offline service worker retains a previously saved exact edition',async()=>{
  const worker=serviceWorker(new Map([[preferredRequest.url,Response.json(preferredPayload)]]));
  const response=await worker.networkFirst(preferredRequest,'rtl-external');
  assert.equal(editions.adaptResponse(ref,await response.json()).preferredEdition.status,'available');
  assert.equal(worker.matches.length,1);
});
await check('an exact API edition cannot use a queryless entry even in the downloaded-data cache',async()=>{
  const canonical=new URL(preferredRequest.url);canonical.search='';
  const worker=serviceWorker(new Map([[canonical.href,new Response('Wrong default fixture')]]));
  await assert.rejects(worker.networkFirst(preferredRequest,worker.DATA),/Offline fixture/);
  assert.equal(worker.matches.length,1);
});
await check('legacy ven and vhe requests cannot receive queryless editions',async()=>{
  const worker=serviceWorker(new Map());
  for(const query of ['ven=Named%20edition','vhe=Named%20edition']){
    const request=new Request('https://www.sefaria.org/api/texts/Genesis?'+query);
    assert.equal(worker.hasExplicitEdition(request),true);
    await assert.rejects(worker.networkFirst(request,'rtl-external'),/Offline fixture/);
  }
  assert(worker.matches.every(match=>!match.ignoreSearch));
});
await check('generic source requests preserve existing whole-pack cache behavior',async()=>{
  const request=new Request('https://www.sefaria.org/api/v3/texts/Fixture?version=source&version=translation');
  const worker=serviceWorker(new Map([['/api/v3/texts/Fixture',new Response('Generic saved fixture')]]));
  assert.equal(await (await worker.networkFirst(request,'rtl-external')).text(),'Generic saved fixture');
  assert.equal(worker.matches.at(-1).ignoreSearch,true);
});
await check('installed shell includes both new reader modules and the thematic catalog',async()=>{
  const worker=serviceWorker(new Map());
  assert(worker.SHELL_FILES.includes('./source-editions.js?v='+editions.VERSION));
  for(const prefix of ['./connected-ideas.js?','./connected-ideas/catalog.json?'])
    assert(worker.SHELL_FILES.some(file=>file.startsWith(prefix)));
});

const manifest={revision:packs.REVISION,books:[{title:'Genesis',nodes:['Genesis']}]};
let saved={ref:'Genesis',sections:[],textDepth:2,addressTypes:['Integer','Integer'],
  he:[['בראשית','הארץ']],text:[['Default first fixture.','Default second fixture.']],
  heVersionTitle:'Hebrew fixture',versionTitle:'JPS default fixture'};
const previousCaches=globalThis.caches;
globalThis.caches={open:async name=>({match:async key=>{
  if(name==='rtl-meta')return key==='packs/tanakh.json'?Response.json(manifest):undefined;
  return key===packs.wholeTextUrl('Genesis')?Response.json(saved):undefined;
}})};
try{
  await check('offline packs cannot synthesize Metsudah from a saved JPS whole book',async()=>{
    assert.equal(await packs.offlineJSON(editions.requestPath('Genesis 1:2')),null);
  });
  await check('matching offline edition keeps its exact verse and provenance',async()=>{
    saved={...saved,versionTitle:editions.EDITIONS.chumash,versionSource:'Fixture provenance',license:'Fixture license'};
    const raw=await packs.offlineJSON(editions.requestPath('Genesis 1:2'));
    const result=editions.adaptResponse('Genesis 1:2',raw);
    assert.deepEqual(result.he,['הארץ']);assert.deepEqual(result.en,['Default second fixture.']);
    assert.equal(result.preferredEdition.actualVersionTitle,editions.EDITIONS.chumash);
    assert.equal(result.preferredEdition.license,'Fixture license');
  });
  await check('merged whole-book translations cannot pass as one requested edition',async()=>{
    saved={...saved,sources:[editions.EDITIONS.chumash,'JPS default fixture']};
    assert.equal(await packs.offlineJSON(editions.requestPath('Genesis 1:2')),null);
    delete saved.sources;saved.isMerged=true;
    assert.equal(await packs.offlineJSON(editions.requestPath('Genesis 1:2')),null);
  });
}finally{
  if(previousCaches===undefined)delete globalThis.caches;else globalThis.caches=previousCaches;
}
console.log(JSON.stringify({ok:true,cases:checks.length,checks}));

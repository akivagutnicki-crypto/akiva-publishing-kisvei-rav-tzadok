// Resolve every outgoing Sefaria reference against Sefaria's own name API.
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
const root='dist/library/data',catalog=JSON.parse(fs.readFileSync(root+'/catalog.json'));
const titles=catalog.map(x=>x.title);
const links=JSON.parse(fs.readFileSync(root+'/dover-tzedek/links.json'));
const refs=[...new Set(Object.values(links).flat().map(x=>x.r))].filter(r=>!titles.some(t=>r===t||r.startsWith(t+' ')||r.startsWith(t+','))).sort();
const file='sources/verified/dover/kdp-sefaria-links-20261020.json.gz';
const cache=fs.existsSync(file)?JSON.parse(gunzipSync(fs.readFileSync(file))):{provider:'Sefaria API',references:{}};
let next=0,done=0;
const pending=refs.filter(r=>!cache.references[r]?.isRef);
const save=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,gzipSync(JSON.stringify(cache),{mtime:0}));};
async function worker(){
  while(next<pending.length){
    const ref=pending[next++];
    try{
      const response=await fetch('https://www.sefaria.org/api/name/'+encodeURIComponent(ref),{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('HTTP '+response.status);
      const d=await response.json();
      cache.references[ref]={isRef:!!d.is_ref,...(d.ref?{ref:d.ref}:{}),...(d.url?{url:d.url}:{}),...(!d.is_ref?{completions:d.completions?.slice(0,3)||[],error:d.error||'Exact reference not recognized'}:{})};
    }catch(error){cache.references[ref]={isRef:false,error:error.message,transportError:true};}
    done++;if(done%100===0){save();console.log(JSON.stringify({checked:done,total:pending.length,remaining:pending.length-done}));}
  }
}
await Promise.all(Array.from({length:8},worker));save();
const failed=refs.filter(r=>!cache.references[r]?.isRef);
console.log(JSON.stringify({requested:refs.length,recognized:refs.length-failed.length,failed:failed.map(ref=>({ref,...cache.references[ref]}))}));
if(failed.length)process.exitCode=1;

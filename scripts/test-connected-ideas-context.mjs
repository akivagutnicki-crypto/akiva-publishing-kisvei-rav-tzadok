#!/usr/bin/env node
// Exercise the actual reader loaders and context checks against every section
// named by the reviewed catalog. No remote text or simplified loader is used.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../',import.meta.url));
const library=path.join(root,'dist/library');
const html=fs.readFileSync(path.join(library,'index.html'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(library,'connected-ideas/catalog.json'),'utf8'));
const sourceConnections=require(path.join(library,'source-connections.js'));
const connectedIdeas=require(path.join(library,'connected-ideas.js'));
const editions=require(path.join(library,'source-editions.js'));
function slice(start,end){
  const a=html.indexOf(start),b=html.indexOf(end,a);
  assert(a>=0 && b>a,'Missing reader source boundary: '+start);
  return html.slice(a,b);
}
const requests=[],externalRequests=[];
const context=vm.createContext({
  console,URL,TextEncoder,crypto:crypto.webcrypto,sourceConnections,connectedIdeas,
  window:{AkivaSourceEditions:editions},cache:new Map(),gematria:String,
  getJSON:async ref=>{externalRequests.push(ref);throw Error('Unexpected external lookup: '+ref);},
  fetch:async url=>{
    const parsed=new URL(url,'https://reader.test/library/');
    assert.equal(parsed.origin,'https://reader.test','Unexpected remote fetch: '+url);
    const file=path.resolve(library,'.'+parsed.pathname.replace(/^\/library/,''));
    requests.push(parsed.pathname);
    if(!file.startsWith(library+path.sep)||!fs.existsSync(file))return {ok:false,status:404,json:async()=>null};
    return {ok:true,status:200,json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))};
  }
});
vm.runInContext([
  slice('let CATALOG = [];','const CAT_COLORS'),
  slice('const localJSON = new Map();','const sourceConnections ='),
  slice('const flatten = t =>','/* ======================= Text fetching'),
  slice('const meiStudyRefs = new Set(','async function fetchEnglish('),
  slice('const segRef = (sectionRef, n) =>','/* ======================= Router'),
  slice('async function preferredSourceText(ref)','async function sourceTextData(link)'),
  slice('const themeContextPins=new WeakMap();','async function currentPassageIdeas('),
  'globalThis.readerTest={fetchText,currentThemePins,verifiedThemeRecords,segRef,flatten};'
].join('\n'),context,{filename:'actual-reader-context-functions.js'});
const sha=value=>crypto.createHash('sha256').update(sourceConnections.normalizedHebrew(value)).digest('hex');
const sectionRefs=[...new Set(catalog.records.flatMap(record=>[
  record.placement.originSectionRef,...(record.reverseExplanation?[record.placement.targetSectionRef]:[])
]))].sort();
const sections=[],failures=[];
let directedChecks=0,paragraphs=0,changedSectionChecks=0;
for(const sectionRef of sectionRefs){
  try{
    const data=await context.readerTest.fetchText(sectionRef);
    const records=connectedIdeas.forSection(catalog.records,sectionRef);
    const checked=await context.readerTest.verifiedThemeRecords(data,records);
    const he=context.readerTest.flatten(data.he).map(connectedIdeas.authorText);
    const sectionHash=sha(he.join(' '));
    paragraphs+=he.length;
    assert.equal(data.sectionRef,sectionRef,'Resolved section reference differs');
    assert(data.local||data.meiStudy,'Reviewed section did not use its canonical local edition');
    const checks=[];
    for(const record of records){
      directedChecks++;
      const reverse=record.direction==='reverse',index=record.paragraphOrder;
      assert(Number.isInteger(index)&&index>=0&&index<he.length,'Paragraph placement is outside its section');
      const number=data.nums?data.nums[index]:index+1;
      const ref=data.sep?data.sectionRef+data.sep+number:context.readerTest.segRef(data.sectionRef,number);
      assert.equal(ref,record.originRef,'Reader paragraph reference differs: '+record.id);
      assert.equal(sha(he[index]),reverse?record.reviewedTargetHebrewSha256:record.reviewedOriginHebrewSha256,
        'Reader paragraph text differs: '+record.id);
      assert.equal(sectionHash,reverse?record.reviewedTargetSectionHebrewSha256:record.reviewedOriginSectionHebrewSha256,
        'Reader section context differs: '+record.id);
      assert(connectedIdeas.anchorMatches(record,he[index]),'Quotation is outside the author text: '+record.id);
      const phrases=data.phrases?.[index];
      if(phrases){
        assert(record.phraseIndex>=0&&record.phraseEnd<phrases.length,'Phrase placement is out of bounds: '+record.id);
        const anchored=phrases.slice(record.phraseIndex,record.phraseEnd+1).map(pair=>pair[0]).join(' ');
        assert(connectedIdeas.anchorMatches(record,anchored),'Quotation is outside its placed phrase interval: '+record.id);
      }
      assert(checked.some(item=>item.id===record.id),'Actual reader context gate rejected: '+record.id);
      checks.push({id:record.id,direction:record.direction,ref,paragraphOrder:index,
        phraseIndex:record.phraseIndex,phraseEnd:record.phraseEnd});
    }
    // A surviving quotation is insufficient after another part of its section changes.
    if(he.length>1&&records.some(record=>record.paragraphOrder!==he.length-1)){
      const changed={...data,he:he.map((text,index)=>index===he.length-1?text+' שינוי בדיקה':text)};
      const surviving=records.filter(record=>record.paragraphOrder!==he.length-1);
      assert(surviving.every(record=>connectedIdeas.anchorMatches(record,changed.he[record.paragraphOrder])));
      assert.equal((await context.readerTest.verifiedThemeRecords(changed,surviving)).length,0,
        'Changed section context must invalidate its surviving quotations');
      changedSectionChecks++;
    }
    sections.push({sectionRef,book:data.book,loader:data.meiStudy?'withMeiStudy':'resolveLocal',
      paragraphs:he.length,sectionHebrewSha256:sectionHash,checks});
  }catch(error){failures.push({sectionRef,error:error.stack});}
}
const report={ok:!failures.length&&!externalRequests.length,catalogSha256:catalog.contentSha256,
  sectionCount:sectionRefs.length,works:new Set(sections.map(section=>section.book)).size,
  paragraphs,directedChecks,changedSectionChecks,externalRequests,
  localFiles:new Set(requests).size,failures,sections};
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,sections:undefined}));
process.exitCode=report.ok?0:1;

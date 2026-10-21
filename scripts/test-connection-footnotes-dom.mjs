// Exercise the shipped reader and every reviewed footnote using a real DOM.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {JSDOM,VirtualConsole}=process.env.AKIVA_JSDOM_ROOT
  ? createRequire(path.join(process.env.AKIVA_JSDOM_ROOT,'package.json'))('jsdom') : require('jsdom');
const root=path.resolve('dist/library'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ideas=require('../dist/library/connected-ideas.js');
const sources=require('../dist/library/source-connections.js');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'connected-ideas/catalog.json')));
const tzidkatSource=JSON.parse(fs.readFileSync('dist/mcp-data/text/tzidkat-hatzadik.json'));
const tzidkatOriginalMaximum=Math.max(0,...tzidkatSource.paras.flatMap(paragraph=>(paragraph.f||[]).map(note=>Number(note[0])||0)));
const tzidkatAdditionalNumbers=[];
const virtualConsole=new VirtualConsole(),errors=[];
virtualConsole.on('jsdomError',error=>errors.push(error.message));
const dom=new JSDOM(html,{url:'https://reader.test/library/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
const window=dom.window;
window.AkivaConnectedIdeas=ideas;window.AkivaSourceConnections=sources;
window.AkivaSourceEditions=require('../dist/library/source-editions.js');
window.TextEncoder=TextEncoder;window.TextDecoder=TextDecoder;
Object.defineProperty(window.crypto,'subtle',{value:crypto.webcrypto.subtle});
window.CSS={escape:value=>String(value).replace(/[^\w-]/g,character=>'\\'+character)};
window.scrollTo=()=>{};window.HTMLElement.prototype.scrollIntoView=()=>{};
window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
window.fetch=async url=>{
  const u=new URL(url,'https://reader.test/library/');
  if(u.origin!=='https://reader.test')return {ok:true,json:async()=>u.pathname.includes('/links/')?[]:{versions:[]}};
  const f=path.resolve(root,'.'+u.pathname.replace(/^\/library/,''));
  if(!f.startsWith(root+path.sep)||!fs.existsSync(f))return {ok:false,status:404,json:async()=>null};
  return {ok:true,status:200,json:async()=>JSON.parse(fs.readFileSync(f,'utf8'))};
};
const body=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));
window.eval(body.replace(/route\(\);\s*\}\)\(\);\s*$/,
  'globalThis.readerTest={load:async ref=>{cleanupFns.forEach(f=>f());cleanupFns=[];await renderReader(ref);},getSections:()=>R.sections,mountConnectedIdeas};})();'));
const clean=value=>String(value).replace(/\s+/g,' ').trim();
let total=0;
try{
  for(const coverage of catalog.coverage)for(const ref of coverage.reviewedSections){
    const expected=ideas.forSection(catalog.records,ref);
    await window.readerTest.load(ref);
    const section=[...window.document.querySelectorAll('.sec')].find(element=>element.dataset.ref===ref);
    assert(section,'Missing actual reader section: '+ref);
    for(let i=0;i<100 && section.dataset.connectionFootnotesMounted!=='true';i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(section.dataset.connectedIdeasStatus,'checked','Current text context was not verified: '+ref);
    assert.equal(+section.dataset.connectionFootnotesCount,expected.length,'A reviewed connection was not converted: '+ref);
    assert.equal(section.querySelectorAll('.connected-outline,.idea-anchor,.reviewed-theme').length,0,'Old boxes still appear');
    const data=window.readerTest.getSections().find(item=>item.sectionRef===ref);
    const baseNumbers=Object.values(data.annotations||{}).flat().filter(note=>!note.connectionIdeaId).map(note=>note.number);
    for(const record of expected){
      const seg=[...section.querySelectorAll('.seg')].find(element=>element.dataset.ref===record.originRef);
      const key='IDEA-'+record.id;
      const marker=seg.querySelector('.seg-he .connection-idea-marker[data-note-key="'+key+'"]');
      const tray=seg.querySelector('.segment-annotations .connection-idea-footnote[data-note-key="'+key+'"]');
      assert(marker && tray,'Missing Hebrew marker or normal footnote: '+record.id);
      const prefix=window.document.createRange();prefix.selectNodeContents(seg.querySelector('.seg-he'));prefix.setEndBefore(marker);
      const preceding=prefix.cloneContents();preceding.querySelectorAll('.footnote,.footnote-marker,.subhead').forEach(element=>element.remove());
      const original=data.phrases?.[+seg.dataset.k]?.[record.phraseIndex]?.[0] || record.originHebrew;
      assert(sources.normalizedHebrew(preceding.textContent).endsWith(sources.normalizedHebrew(ideas.authorText(original))),
        'The stacked marker is not beside its reviewed Hebrew phrase: '+record.id);
      assert(!baseNumbers.includes(+marker.dataset.fn),'Original Word footnote number was reused');
      if(coverage.book==='Tzidkat HaTzadik'){
        assert(+marker.dataset.fn>tzidkatOriginalMaximum,'A supplementary note reuses an original number from another siman');
        assert.equal(+marker.dataset.fn,record.footnoteNumber,'Published book-wide number was lost');
        tzidkatAdditionalNumbers.push(+marker.dataset.fn);
      }
      assert.equal(seg.querySelectorAll('.seg-en .connection-idea-marker,.ph-en .connection-idea-marker').length,0);
      assert.deepEqual([...tray.querySelectorAll('.annotation-text')].map(element=>clean(element.textContent)),
        [record.themeTitle,record.themeSummary,record.targetRef+': “'+record.targetEnglish+'”','Explanation: '+record.explanation].map(clean));
      assert.equal(tray.querySelector('.annotation-text a').textContent,record.targetRef);
      assert.equal(tray.querySelector('.annotation-text a').getAttribute('href'),'#/read/'+encodeURIComponent(record.targetRef).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':'));
      assert.equal(tray.querySelectorAll('[lang="he"]').length,0,'Footnotes should remain English');
      const phrase=seg.querySelectorAll('.seg-il .ph')[record.phraseIndex];
      if(phrase){
        const inline=phrase.querySelector('.ph-he .connection-idea-marker[data-note-key="'+key+'"]');
        const box=phrase.querySelector('.connection-idea-footnote[data-note-key="'+key+'"]');
        assert(inline && box,'The exact phrase lost its footnote: '+record.id);
        inline.click();assert(box.classList.contains('open'));assert.equal(inline.getAttribute('aria-expanded'),'true');
        inline.click();assert(!box.classList.contains('open'));
      }
      marker.click();assert(tray.classList.contains('open'));marker.click();assert(!tray.classList.contains('open'));
      assert(window.document.getElementById('panel').hidden,'A footnote opened the old connections popup');
      total++;
    }
    const before=section.querySelectorAll('.connection-idea-marker').length;
    await window.readerTest.mountConnectedIdeas(data,section);
    assert.equal(section.querySelectorAll('.connection-idea-marker').length,before,'Repeated mounting duplicated notes');
  }
  assert.deepEqual(errors,[],'Reader DOM errors');
  assert.deepEqual([...tzidkatAdditionalNumbers].sort((a,b)=>a-b),
    Array.from({length:tzidkatAdditionalNumbers.length},(_,index)=>tzidkatOriginalMaximum+index+1),
    'Tzidkat supplementary notes must remain unique and continuous across all simanim');
  assert.equal(total,catalog.coverage.reduce((sum,work)=>sum+work.reviewedSections.reduce((count,ref)=>count+ideas.forSection(catalog.records,ref).length,0),0));
  console.log(JSON.stringify({ok:true,records:catalog.records.length,footnotes:total,sections:catalog.counts.sectionsWithReviewedIdeas,works:catalog.counts.worksWithReviewedIdeas,
    completeEnglishQuotes:true,hebrewMarkersOnly:true,normalFootnoteInteraction:true,originalNumbersPreserved:true,
    tzidkatBookWideNumbers:{originalMaximum:tzidkatOriginalMaximum,additionalNotes:tzidkatAdditionalNumbers.length}}));
}finally{window.close();}

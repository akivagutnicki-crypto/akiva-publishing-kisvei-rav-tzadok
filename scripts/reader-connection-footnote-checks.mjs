import assert from 'node:assert/strict';
const normalized=value=>String(value||'').replace(/\s+/g,' ').trim();
export async function checkConnectionFootnotes(page,section,records,{screenshot=null}={}) {
  const ref=await section.getAttribute('data-ref');
  await page.waitForFunction(ref=>[...document.querySelectorAll('.sec')].some(element=>
    element.dataset.ref===ref && element.dataset.connectionFootnotesMounted==='true'),ref);
  assert.equal(await section.getAttribute('data-connected-ideas-status'),'checked');
  assert.equal(await section.locator('.connected-outline,.idea-anchor,.reviewed-theme').count(),0,'The old popup boxes remain');
  const boxes=await section.locator('.segment-annotations .connection-idea-footnote').evaluateAll(nodes=>nodes.map(node=>({
    id:node.dataset.connectionId,number:+node.dataset.fn,ref:node.closest('.seg').dataset.ref,
    paragraphs:[...node.querySelectorAll('.annotation-text')].map(p=>p.textContent),
    href:node.querySelector('a')?.getAttribute('href'),source:node.querySelector('a')?.textContent,
    sourceBold:Boolean(node.querySelector('a strong')),hebrewParagraphs:node.querySelectorAll('[lang="he"]').length
  })));
  assert.deepEqual(boxes.map(box=>box.id).sort(),records.map(record=>record.id).sort(),'A reviewed connection is missing or duplicated');
  const markers=await section.locator('.seg-he .connection-idea-marker').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.connectionId,number:+node.dataset.fn})));
  assert.deepEqual(markers.map(marker=>marker.id).sort(),records.map(record=>record.id).sort(),'Missing exact Hebrew note markers');
  assert.equal(new Set(markers.map(marker=>marker.number)).size,records.length,'Additional notes reuse a number');
  assert.equal(await section.locator('.seg-en .connection-idea-marker,.ph-en .connection-idea-marker').count(),0);
  for(const record of records){
    const box=boxes.find(box=>box.id===record.id);
    assert.equal(box.ref,record.originRef);
    if(record.footnoteNumber)assert.equal(box.number,record.footnoteNumber,'The book-wide supplementary number was lost');
    assert.deepEqual(box.paragraphs.map(normalized),[record.themeTitle,record.themeSummary,
      record.targetRef+': “'+record.targetEnglish+'”','Explanation: '+record.explanation].map(normalized));
    assert.equal(box.source,record.targetRef);assert(box.sourceBold);assert.equal(box.hebrewParagraphs,0);
    assert.equal(box.href,'#/read/'+encodeURIComponent(record.targetRef).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':'));
    const inline=section.locator('.seg-il .connection-idea-marker[data-connection-id="'+record.id+'"]');
    if(await inline.count()){
      const place=await inline.evaluate(node=>({ref:node.closest('.seg').dataset.ref,
        phrase:[...node.closest('.seg').querySelectorAll('.seg-il .ph')].indexOf(node.closest('.ph'))}));
      assert.deepEqual(place,{ref:record.originRef,phrase:record.phraseIndex});
    }
  }
  for(const [index,record] of [...new Set([records[0],records.at(-1)])].filter(Boolean).entries()){
    const inter=await page.locator('#text').getAttribute('data-layout')==='inter';
    const inline=section.locator('.seg-il .connection-idea-marker[data-connection-id="'+record.id+'"]');
    const useInline=inter && await inline.count();
    const marker=useInline?inline:section.locator('.seg-he .connection-idea-marker[data-connection-id="'+record.id+'"]');
    const box=section.locator((useInline?'.seg-il ':'.segment-annotations ')+'.connection-idea-footnote[data-connection-id="'+record.id+'"]');
    await marker.click();assert.equal(await marker.getAttribute('aria-expanded'),'true');assert(await box.isVisible());
    assert.equal(await page.locator('#panel').isVisible(),false,'Opening a footnote must not open the old source popup');
    assert(await box.evaluate(element=>element.scrollWidth<=element.clientWidth+2),'The complete footnote is clipped');
    if(inter)assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Footnote overflows the viewport');
    if(index===0 && screenshot)await page.screenshot({path:screenshot,type:'jpeg',quality:90});
    await marker.click();assert.equal(await marker.getAttribute('aria-expanded'),'false');assert.equal(await box.isVisible(),false);
  }
  return {ref,footnotes:records.length,completeEnglishQuotes:true,hebrewAnchors:true,ordinaryFootnotes:true};
}

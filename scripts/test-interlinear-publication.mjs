import fs from 'node:fs';
import path from 'node:path';
const out='dist/library/data';
const catalog=JSON.parse(fs.readFileSync(path.join(out,'catalog.json'),'utf8'));
const books=[
  {title:'Peri Tzadik',minPairs:3000,minLinks:40,required:'Peri Tzadik, Noach 1'},
  {title:'Tiferet Yosef',minPairs:100,minLinks:10,required:'Tiferet Yosef, Bereshit 1'}
];
for(const b of books){
  const info=catalog.find(x=>x.title===b.title);
  if(!info)throw new Error('Book absent from catalog: '+b.title);
  const directory=path.join(out,info.slug);
  const {toc}=JSON.parse(fs.readFileSync(path.join(directory,'toc.json'),'utf8'));
  const edition=toc.children?.find(x=>x.en==='Akiva Publishing — Interlinear Study Edition');
  if(!edition || toc.children[0]!==edition)throw new Error('Interlinear edition must be the first reading option: '+b.title);
  let count=0,segments=0,heads=0,refs=[],hebrewLetters=0,vowelledLetters=0;
  for(const leaf of edition.children){
    refs.push(leaf.ref);
    if(!leaf.interlinear||!leaf.il1)throw new Error('Interlinear metadata missing: '+leaf.ref);
    // The number in the canonical section ref is the original ois, not the
    // running position in the translated TOC. Some ois are not translated.
    const numbered = leaf.ref.match(/, (Bereshit|Noach) (\d+)$/);
    if(numbered){
      const [, parashah, number] = numbered;
      if(leaf.parashah!==parashah || leaf.ois!==Number(number))
        throw new Error('Wrong parashah / ois metadata: '+leaf.ref);
      if(!/אות\s+[א-ת][א-ת׳״]*/u.test(leaf.he))
        throw new Error('Hebrew אות label missing: '+leaf.ref);
      if(!leaf.heRef.includes(leaf.he))
        throw new Error('Reader Hebrew heading lacks ois: '+leaf.ref);
    }
    if (leaf.ref === 'Peri Tzadik, Bereshit 15' && leaf.he !== 'בראשית · אות ט״ו')
      throw new Error('Ois 15 must use ט״ו, not a sequential label');
    if (leaf.ref === 'Peri Tzadik, Noach 10' && leaf.ois !== 10)
      throw new Error('Noach Ois 10 must not be renumbered to Ois 7');

    const items=JSON.parse(fs.readFileSync(path.join(directory,leaf.id+'.json'),'utf8'));
    for(const item of items){
      if(item.h)heads++;
      if(!item.p)continue;
      segments++;
      if(item.p.length<1)throw new Error('Empty translated paragraph '+leaf.ref);
      for(const [he,en] of item.p){
        if(typeof he!=='string'||!/[א-ת]/.test(he) || typeof en!=='string'||!/[A-Za-z]/.test(en))
          throw new Error('Missing Hebrew or English phrase in '+leaf.ref+': '+String(en).slice(0,40));
        count++;
        hebrewLetters += (he.match(/[\u05d0-\u05ea]/g) || []).length;
        vowelledLetters += (he.match(/[\u0591-\u05bd\u05bf-\u05c7]/g) || []).length;
      }
    }
  }
  if(!refs.includes(b.required))throw new Error('Missing required translated section: '+b.required);
  if(count<b.minPairs)throw new Error('Too few bilingual pairs: '+b.title+' ('+count+')');
  if(heads<edition.children.length*2)throw new Error('Missing study edition headings: '+b.title);
  // Catch regressions where the canonical Hebrew inadvertently replaces the
  // vocalized Hebrew, even though interlinear translations still load.
  const minNikkudRatio = b.title === 'Peri Tzadik' ? 0.48 : 0.34;
  if (vowelledLetters / Math.max(1,hebrewLetters) < minNikkudRatio)
    throw new Error('Nikkud missing from published interlinear Hebrew in '+b.title+
      ': '+vowelledLetters+'/'+hebrewLetters+' marks');
  const linksFile=path.join(directory,'links.json');
  const links=fs.existsSync(linksFile)?JSON.parse(fs.readFileSync(linksFile,'utf8')):{};
  const linkCount=Object.values(links).flat().length;
  if(linkCount<b.minLinks)throw new Error('Too few Sefaria source connections: '+b.title+' ('+linkCount+')');
  console.log('PASS '+b.title+': '+edition.children.length+' sections, '+segments+' paragraphs, '+count+' Hebrew-English pairs, '+vowelledLetters+' nikkud marks, '+linkCount+' source connections');
}


// Meshiv HaTa'anah is published as 65 genuine interlinear reader sections,
// not a Hebrew-only leaf masquerading as an interlinear translation.
{
  const book = catalog.find(x => x.title === "Meshiv HaTa'anah");
  if (!book || !book.akiva || !book.interlinear || book.slug !== "meshiv-hata-anah")
    throw new Error("Meshiv HaTa'anah is not the new interlinear Akiva source");
  const dir=path.join(out, book.slug);
  const {toc}=JSON.parse(fs.readFileSync(path.join(dir,'toc.json'),'utf8'));
  const leaves=(node)=>node.children ? node.children.flatMap(leaves) : [node];
  const sections=leaves(toc);
  if (sections.length!==65 || sections.some(s=>!s.interlinear))
    throw new Error("Meshiv requires 65 linked interlinear headings: "+sections.length);
  let hebrewEnglish=0, explanations=0, editorialLinks=0, vowelMarks=0, sourceAnchors=0;
  for(const leaf of sections){
    const rows=JSON.parse(fs.readFileSync(path.join(dir,String(leaf.id)+'.json'),'utf8'));
    for(const row of rows){
      for(const [he,en] of row.p || []){
        if (/[א-ת]/u.test(he||'') && /[A-Za-z]/.test(en||'')) hebrewEnglish++;
        if ((en||'').includes('Explanation')) explanations++;
        if ((en||'').includes('Sefaria connections (editorial)')) editorialLinks++;
        vowelMarks+=((he||'').match(/[\u0591-\u05c7]/g)||[]).length;
        sourceAnchors+=((he+' '+en).match(/<a[^>]+data-ref="/g)||[]).length;
      }
    }
  }
  if(hebrewEnglish<2100 || explanations!==67 || editorialLinks!==67 || vowelMarks<2000 || sourceAnchors<100)
    throw new Error("Meshiv source incomplete: "+JSON.stringify({hebrewEnglish,explanations,editorialLinks,vowelMarks,sourceAnchors}));
  const reader=fs.readFileSync('dist/library/index.html','utf8');
  const sw=fs.readFileSync('dist/library/sw.js','utf8');
  if(!reader.includes('meshiv-new-edition') || !reader.includes('20261012-meshiv-interlinear-v3') || !sw.includes('v34-meshiv-tzedek-20261012-interlinear') || !sw.includes('meshiv-hata-anah'))
    throw new Error('Meshiv reader version/caching update missing');
  console.log("PASS Meshiv HaTa'anah: " + sections.length + " sections, " + hebrewEnglish + " bilingual phrases, " + explanations + " explanations, " + sourceAnchors + " source anchors");
}


// Meshiv Tzedek must replace the old Hebrew-only reader with the actual
// Sefaria-linked Akiva Publishing interlinear Word edition, without breaking
// the two existing reading URLs.
{
  const book = catalog.find(b => b.title === 'Meshiv Tzedek');
  if (!book || !book.akiva || !book.interlinear || book.slug !== 'meshiv-tzedek')
    throw new Error('Meshiv Tzedek must replace the old Hebrew-only edition');
  const dir = path.join(out, book.slug);
  const {toc} = JSON.parse(fs.readFileSync(path.join(dir, 'toc.json'), 'utf8'));
  const leaves = toc.children || [];
  const expectedRefs = [
    'Meshiv Tzedek, A Rebuttal Regarding Sitting in the Sukkah on Shemini Atzeret',
    'Meshiv Tzedek, Talks for Bar Mitzvah'
  ];
  if (leaves.length !== 2 || expectedRefs.some(ref => !leaves.some(l => l.ref === ref && l.interlinear)))
    throw new Error('Meshiv Tzedek previous chapter URLs were not preserved');
  let headings = 0, bilingual = 0, links = 0, editorialConnections = 0, paragraphs = 0, nikkud = 0;
  for (const leaf of leaves) {
    const items = JSON.parse(fs.readFileSync(path.join(dir, leaf.id + '.json'), 'utf8'));
    for (const item of items) {
      if (item.h) headings++;
      if (!item.p) continue;
      paragraphs++;
      for (const [he, en] of item.p) {
        if (/[א-ת]/.test(he) && /[A-Za-z]/.test(en)) bilingual++;
        nikkud += (he.match(/[\u0591-\u05c7]/g) || []).length;
        links += ((he + en).match(/<a[^>]+data-ref="/g) || []).length;
        if (/Sefaria connections \(editorial\)|Sources in this discussion/.test(en)) editorialConnections++;
      }
    }
  }
  if (headings < 245 || bilingual < 4800 || links < 425 || editorialConnections !== 112 || nikkud < 1000)
    throw new Error('Meshiv Tzedek reader lost translated text or source links: ' +
      JSON.stringify({headings, bilingual, links, editorialConnections, paragraphs, nikkud}));
  const page = fs.readFileSync('dist/library/index.html', 'utf8');
  const sw = fs.readFileSync('dist/library/sw.js', 'utf8');
  if (!page.includes('20261012-meshiv-tzedek-interlinear-v1') ||
      !sw.includes('v34-meshiv-tzedek-20261012-interlinear') ||
      !sw.includes('meshiv-hata-anah|meshiv-tzedek'))
    throw new Error('Meshiv Tzedek offline/app cache invalidation is incomplete');
  console.log('PASS Meshiv Tzedek: '+leaves.length+' historical chapters, '+headings+
    ' topic headings, '+bilingual+' Hebrew–English phrases, '+editorialConnections+
    ' editorial source panels, '+links+' Sefaria references');
}

#!/usr/bin/env node
// Exercise the shipped reader's exact-source loader without a browser or a
// network. These fixtures test quotation boundaries and translation fidelity;
// the separate reader integration suite exercises actual DOM clicks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const engine = require('../dist/library/source-connections.js');
const editions = require('../dist/library/source-editions.js');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(repo, 'dist/library/index.html'), 'utf8');
const beginning = 'async function preferredSourceText(ref) {';
const ending = 'async function showLinkList(';
const first = html.indexOf(beginning), last = html.indexOf(ending, first);
assert(first >= 0 && last > first, 'The shipped source-rendering functions were not found');
assert.equal(html.indexOf(beginning, first + beginning.length), -1, 'Ambiguous source loader in reader');
const source = html.slice(first, last);
assert(source.includes('function alignedSourceRows(he, en)'), 'The shipped alignment function must be tested with its loader');

const plain = value => String(value || '').replace(/<[^>]*>/g, '')
  .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({
    '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'", '&nbsp;':' '
  })[entity] ?? entity);
const serializable = value => JSON.parse(JSON.stringify(value));
const passed = [];

function harness(responses, translations = null, preferredResponses = {}) {
  const requests = [];
  const context = vm.createContext({
    sourceConnections: engine,
    window: {AkivaSourceEditions:editions},
    cache:new Map(),
    getJSON: async requestPath => {
      requests.push({preferredRequest:requestPath});
      const value=preferredResponses[requestPath];
      assert(value,'Unexpected preferred source request: '+requestPath);
      if(value instanceof Error)throw value;
      return structuredClone(value);
    },
    plain,
    publishedSourceTranslation: async ref => {
      if (translations instanceof Error) throw translations;
      return translations?.[ref] || null;
    },
    flatten: value => Array.isArray(value) ? value.flat(Infinity) : value == null ? [] : [value],
    fetchText: async (ref, options = {}) => {
      requests.push({ref, options});
      const response = typeof responses === 'function' ? await responses(ref, options) : responses[ref];
      assert(response, 'Unexpected source request: ' + ref);
      if (response instanceof Error) throw response;
      return structuredClone(response);
    }
  });
  vm.runInContext(source + '\nglobalThis.reader = {sourceTextData, alignedSourceRows};', context,
    {filename: 'reviewed-source-rendering-from-reader.js', timeout: 1000});
  return {loader: context.reader.sourceTextData, align: context.reader.alignedSourceRows, requests};
}

async function check(name, verify) {
  await verify();
  passed.push(name);
}

const chapterOne = {
  local:true, ref:'Fixture Tzadok 1', sectionRef:'Fixture Tzadok 1', sep:':', nums:[1,2,3],
  he:['ראשון שאינו המקור המבוקש','המקור המדויק השני','סוף הפרק הראשון'],
  en:['The first paragraph is not the requested source.','The exact second source.','The end of the first chapter.'],
  next:'Fixture Tzadok 2', versions:[{title:'Fixture canonical edition',lang:'Hebrew and English'}]
};
const chapterTwo = {
  local:true, ref:'Fixture Tzadok 2', sectionRef:'Fixture Tzadok 2', sep:':', nums:[1,2,3],
  he:['ראש הפרק השני','גבולו האחרון של המקור','אחרי המקור המבוקש'],
  en:['The beginning of the second chapter.','The final boundary of the source.','Beyond the requested source.'],
  next:'Fixture Tzadok 3', versions:[{title:'Fixture canonical edition',lang:'Hebrew and English'}]
};

try {
  await check('exact local paragraph excludes neighboring paragraphs', async () => {
    const {loader,requests} = harness({'Fixture Tzadok 1:2':chapterOne});
    const result = await loader({sourceRef:'Fixture Tzadok 1:2'});
    assert.equal(result.ref, 'Fixture Tzadok 1:2');
    assert.deepEqual(serializable(result.he), [chapterOne.he[1]]);
    assert.deepEqual(serializable(result.en), [chapterOne.en[1]]);
    assert.deepEqual(requests.map(request=>request.ref), ['Fixture Tzadok 1:2']);
  });

  await check('nonsequential canonical paragraph numbers remain exact', async () => {
    const sparse = {...chapterOne, nums:[1,7,12]};
    const {loader} = harness({'Fixture Tzadok 1:7':sparse});
    const result = await loader({sourceRef:'Fixture Tzadok 1:7'});
    assert.deepEqual(serializable(result.he), [chapterOne.he[1]]);
    assert.deepEqual(serializable(result.en), [chapterOne.en[1]]);
  });

  await check('missing local paragraph cannot fall back to chapter opening', async () => {
    const {loader} = harness({'Fixture Tzadok 1:99':chapterOne});
    await assert.rejects(loader({sourceRef:'Fixture Tzadok 1:99'}), /exact requested local passage was not found/);
  });

  await check('single chapter range includes both boundaries only', async () => {
    const {loader,requests} = harness({'Fixture Tzadok 1:2':chapterOne});
    const result = await loader({sourceRef:'Fixture Tzadok 1:2-3'});
    assert.equal(result.ref, 'Fixture Tzadok 1:2-3');
    assert.deepEqual(serializable(result.he), chapterOne.he.slice(1));
    assert.deepEqual(serializable(result.en), chapterOne.en.slice(1));
    assert.equal(requests.length, 1);
  });

  await check('range crosses chapters without adding neighboring text', async () => {
    const {loader,requests} = harness({'Fixture Tzadok 1:2':chapterOne,'Fixture Tzadok 2':chapterTwo});
    const result = await loader({sourceRef:'Fixture Tzadok 1:2-2:2'});
    assert.equal(result.ref, 'Fixture Tzadok 1:2-2:2');
    assert.deepEqual(serializable(result.he), [...chapterOne.he.slice(1),...chapterTwo.he.slice(0,2)]);
    assert.deepEqual(serializable(result.en), [...chapterOne.en.slice(1),...chapterTwo.en.slice(0,2)]);
    assert.deepEqual(requests.map(request=>request.ref), ['Fixture Tzadok 1:2','Fixture Tzadok 2']);
  });

  await check('range with a missing first paragraph cannot begin at a later paragraph', async () => {
    const sparse = {...chapterOne,nums:[1,3,4]};
    const {loader} = harness({'Fixture Tzadok 1:2':sparse});
    await assert.rejects(loader({sourceRef:'Fixture Tzadok 1:2-3'}), /complete requested local range could not be verified/);
  });

  await check('range with a missing final paragraph cannot end early', async () => {
    const {loader} = harness({'Fixture Tzadok 1:2':chapterOne});
    await assert.rejects(loader({sourceRef:'Fixture Tzadok 1:2-9'}), /complete requested local range could not be verified/);
  });

  await check('broken next-section link cannot silently truncate a crosschapter range', async () => {
    const {loader} = harness({'Fixture Tzadok 1:2':{...chapterOne,next:null}});
    await assert.rejects(loader({sourceRef:'Fixture Tzadok 1:2-2:2'}), /complete requested local range could not be verified/);
  });

  await check('looping section link cannot publish an unfinished range', async () => {
    const loop = {...chapterOne,next:chapterOne.sectionRef};
    const {loader,requests} = harness({'Fixture Tzadok 1:2':loop,'Fixture Tzadok 1':loop});
    await assert.rejects(loader({sourceRef:'Fixture Tzadok 1:2-2:2'}), /complete requested local range could not be verified/);
    assert.equal(requests.length,2,'A next-section cycle must terminate promptly');
  });

  await check('chapter-only range verifies both requested sections and keeps complete paragraphs', async () => {
    const {loader} = harness({'Fixture Tzadok 1':chapterOne,'Fixture Tzadok 2':chapterTwo});
    const result = await loader({sourceRef:'Fixture Tzadok 1-2'});
    assert.equal(result.ref,'Fixture Tzadok 1-2');
    assert.deepEqual(serializable(result.he), [...chapterOne.he,...chapterTwo.he]);
    assert.deepEqual(serializable(result.en), [...chapterOne.en,...chapterTwo.en]);
  });

  await check('whole local section retains its complete source text', async () => {
    const {loader} = harness({'Fixture Tzadok 1':chapterOne});
    const result = await loader({sourceRef:'Fixture Tzadok 1'});
    assert.deepEqual(serializable(result.he), chapterOne.he);
    assert.deepEqual(serializable(result.en), chapterOne.en);
  });

  await check('Mei study overlay obeys the same exact paragraph selection', async () => {
    const overlay = {...chapterOne,local:false,meiStudy:true,sectionRef:'Mei HaShiloach, Volume I, Genesis, Bereshit',sep:' '};
    const ref = overlay.sectionRef + ' 2';
    const {loader} = harness({[ref]:overlay});
    const result = await loader({sourceRef:ref});
    assert.deepEqual(serializable(result.he), [chapterOne.he[1]]);
    assert.deepEqual(serializable(result.en), [chapterOne.en[1]]);
  });

  await check('remote range requests the exact range from the text API', async () => {
    const precise = {ref:'Fixture Remote 1:2-3',sectionRef:'Fixture Remote 1',he:['שני','שלישי'],en:['Second.','Third.']};
    const {loader,requests} = harness({'Fixture Remote 1:2':{ref:'Fixture Remote 1:2',he:'שני',en:'Second.'},'Fixture Remote 1:2-3':precise});
    assert.deepEqual(serializable(await loader({sourceRef:'Fixture Remote 1:2-3'})), precise);
    assert.deepEqual(serializable(requests), [{ref:'Fixture Remote 1:2',options:{}},{ref:'Fixture Remote 1:2-3',options:{remoteOnly:true}}]);
  });

  await check('preferred Chumash edition precedes saved quote and translation-index shortcuts', async () => {
    const ref='Exodus 12:11', versionTitle=editions.EDITIONS.chumash;
    const raw={ref,sectionRef:'Exodus 12',sections:[12,11],versions:[
      {language:'he',versionTitle:'Primary Hebrew fixture',text:'המקור המבוקש'},
      {language:'en',versionTitle,text:'Preferred edition interface fixture.'}]};
    const {loader,requests}=harness({}, {[ref]:{he:'ישן',en:'Old indexed translation.'}},
      {[editions.requestPath(ref)]:raw});
    const result=await loader({sourceRef:ref,quote:{he:'ישן',en:'Old embedded English.'},translationProvenance:'Old provenance'});
    assert.deepEqual(serializable(result.en),['Preferred edition interface fixture.']);
    assert.equal(result.preferredEdition.actualVersionTitle,versionTitle);
    assert.deepEqual(requests,[{preferredRequest:editions.requestPath(ref)}]);
  });

  await check('preferred Tanach failure cannot silently reuse a JPS quote or footnote', async () => {
    const ref='Ezekiel 18:20';
    const raw={ref,versions:[{language:'he',versionTitle:'Hebrew fixture',text:'המקור המבוקש'},
      {language:'en',versionTitle:'The Contemporary Torah, Jewish Publication Society, 2006',text:'Wrong edition fixture.'}]};
    const {loader,requests}=harness({},null,{[editions.requestPath(ref)]:raw});
    const result=await loader({sourceRef:ref,quote:{he:'ישן',en:'Unapproved saved quote.'},
      fallbackQuote:{ref,en:'Unapproved footnote excerpt.'}});
    assert.equal(result.preferredEdition.status,'unavailable');
    assert.equal(result.preferredEdition.requestedVersionTitle,editions.EDITIONS.koren);
    assert.deepEqual(serializable(result.he),['המקור המבוקש']);
    assert.deepEqual(serializable(result.en),[]);
    assert.equal(result.footnoteExcerpt,undefined);
    assert.equal(requests.length,1);
  });

  await check('Metsudah Rashi request preserves the exact commentary segment', async () => {
    const ref='Rashi on Genesis 1:1:2';
    const raw={ref,versions:[{language:'he',text:'פירוש מדויק'},
      {language:'en',versionTitle:editions.EDITIONS.rashiChumash,text:'The exact commentary fixture.'}]};
    const {loader,requests}=harness({},null,{[editions.requestPath(ref)]:raw});
    const result=await loader({sourceRef:ref});
    assert.equal(result.ref,ref);
    assert.deepEqual(serializable(result.en),['The exact commentary fixture.']);
    assert.deepEqual(requests,[{preferredRequest:editions.requestPath(ref)}]);
  });

  await check('reviewed excerpt remains exact and performs no source substitution', async () => {
    const {loader,requests} = harness({});
    const quote = {he:'דברי המקור המוגהים בשלמותם',en:'The complete checked source quotation.'};
    const result = await loader({sourceRef:'Fixture Tzadok 1:2',quoteRef:'Fixture Tzadok 1:2',quote});
    assert.deepEqual(serializable(result), {ref:'Fixture Tzadok 1:2',he:[quote.he],en:[quote.en],reviewedExcerpt:true});
    assert.equal(requests.length,0);
  });

  await check('an exact published source translation is available independently of its footnote', async () => {
    const translated = {ref:'Rashi on Ketubot 85b:8:1',he:'פירוש המקור השלם',en:'The complete translated explanation.',
      sourceUrl:'https://www.sefaria.org/Rashi_on_Ketubot.85b.8.1',provenance:'Published source-footnote translation with retained primary evidence'};
    const {loader,requests} = harness({}, {[translated.ref]:translated});
    const result = await loader({sourceRef:translated.ref});
    assert.deepEqual(serializable(result.he),[translated.he]);
    assert.deepEqual(serializable(result.en),[translated.en]);
    assert.equal(result.sourceTranslationUrl,translated.sourceUrl);
    assert.equal(result.versions[0].title,translated.provenance);
    assert.equal(result.publishedSourceTranslation,true);
    assert.equal(requests.length,0);
  });

  await check('a translation for one exact source cannot substitute for a neighboring source', async () => {
    const original = {ref:'Rashi on Ketubot 85b:8:2',he:['המקור הסמוך'],en:[]};
    const {loader,requests} = harness({[original.ref]:original}, {'Rashi on Ketubot 85b:8:1':{he:'אחר',en:'Other.'}});
    const result = await loader({sourceRef:original.ref});
    assert.deepEqual(serializable(result.en),[]);
    assert.deepEqual(requests.map(request=>request.ref),[original.ref]);
  });

  await check('source translation index failure is distinguished from a missing translation', async () => {
    const ref = 'Fixture Commentary 18:20';
    const {loader} = harness({[ref]:{ref,he:['המקור'],en:[]}},new Error('Index unavailable'));
    const result = await loader({sourceRef:ref});
    assert.equal(result.translationLookupFailed,true);
    assert.deepEqual(serializable(result.en),[]);
  });

  await check('an unavailable supplementary index preserves complete existing English', async () => {
    const ref = 'Fixture Commentary 18:20', en = ['The complete available English.'];
    const {loader} = harness({[ref]:{ref,he:['המקור'],en}},new Error('Index unavailable'));
    const result = await loader({sourceRef:ref});
    assert.deepEqual(serializable(result.en),en);
  });

  const excerpt = {ref:'Fixture Commentary 18:20',en:'The quoted excerpt covers only part of this source.',provenance:'Checked fixture footnote'};
  await check('complete original English is preserved instead of a shorter footnote excerpt', async () => {
    const original = {ref:excerpt.ref,sectionRef:'Fixture Commentary 18',he:['ראשון','שני'],
      en:['A full first sentence.','The full final sentence.'],versions:[{title:'Original published English',lang:'English'}]};
    const {loader} = harness({[excerpt.ref]:original});
    const result = await loader({sourceRef:excerpt.ref,fallbackQuote:excerpt});
    assert.deepEqual(serializable(result.he),original.he);
    assert.deepEqual(serializable(result.en),original.en);
    assert.deepEqual(serializable(result.versions),original.versions);
    assert.equal(result.footnoteExcerpt,null);
    assert.equal(result.fromFootnoteFallback,true);
  });

  await check('incomplete English remains incomplete and the footnote excerpt stays separate', async () => {
    const original = {ref:excerpt.ref,he:['ראשון','שני'],en:['An available first sentence.','']};
    const {loader,align} = harness({[excerpt.ref]:original});
    const result = await loader({sourceRef:excerpt.ref,fallbackQuote:excerpt});
    assert.deepEqual(serializable(result.he),original.he);
    assert.deepEqual(serializable(result.en),original.en);
    assert.deepEqual(serializable(result.footnoteExcerpt),excerpt);
    assert.deepEqual(serializable(align(result.he,result.en)),[['ראשון','An available first sentence.'],['שני','']]);
  });

  await check('Hebrew-only source cannot be represented as translated by an English excerpt', async () => {
    const original = {ref:excerpt.ref,he:['ראשון','שני'],en:[]};
    const {loader} = harness({[excerpt.ref]:original});
    const result = await loader({sourceRef:excerpt.ref,fallbackQuote:excerpt});
    assert.deepEqual(serializable(result.he),original.he);
    assert.deepEqual(serializable(result.en),[]);
    assert.deepEqual(serializable(result.footnoteExcerpt),excerpt);
  });

  await check('source fetch failure offers only the identified separate footnote excerpt', async () => {
    const {loader} = harness({[excerpt.ref]:new Error('Fixture source unavailable')});
    const result = await loader({sourceRef:excerpt.ref,fallbackQuote:excerpt});
    assert.deepEqual(serializable(result), {ref:excerpt.ref,he:[],en:[],footnoteExcerpt:excerpt,fromFootnoteFallback:true});
  });

  await check('fetch failure without a footnote excerpt remains an error', async () => {
    const {loader} = harness({[excerpt.ref]:new Error('Fixture source unavailable')});
    await assert.rejects(loader({sourceRef:excerpt.ref}), /Fixture source unavailable/);
  });

  await check('nested alignment retains missing English in its actual source row', async () => {
    const {align} = harness({});
    assert.deepEqual(serializable(align([['ראשון','שני'],['שלישי']],[['First.'],['Third.']])),
      [['ראשון','First.'],['שני',''],['שלישי','Third.']]);
    assert.deepEqual(serializable(align([['ראשון'],[]],[['First.'],['English only.']])),
      [['ראשון','First.'],['','English only.']]);
    assert.deepEqual(serializable(align(['<b>ראשון</b>','שני'],'First &amp; complete.')),
      [['ראשון','First & complete.'],['שני','']]);
  });

  const contextStart = html.indexOf('function sourceFootnoteQuote(ref, context) {');
  const contextEnd = html.indexOf('async function reviewedPassageLinks(',contextStart);
  assert(contextStart >= 0 && contextEnd > contextStart);
  const quotedNote = {verificationStatus:'verified',phraseIndex:4,sources:[{ref:'Fixture Commentary 18:20',
    url:'https://www.sefaria.org/Ezekiel.18.20',role:'primary'}],paragraphs:[{
      text:'Fixture Commentary 18:20: “An exact English source excerpt.”',
      rich:[{text:'Fixture Commentary 18:20',href:'https://www.sefaria.org/Ezekiel.18.20'},{text:': “An exact English source excerpt.”'}]}]};
  const noteContext = vm.createContext({sourceConnections:engine,R:{sections:[{sectionRef:'Origin 1',annotations:[[quotedNote]]}]}});
  vm.runInContext(html.slice(contextStart,contextEnd)+'\nglobalThis.pickNote = sourceFootnoteQuote;',noteContext);
  const seg = {dataset:{k:'0'},closest:()=>({dataset:{ref:'Origin 1'}})};
  await check('inline and paragraph lookups can reuse a unique verified note excerpt', async () => {
    assert.equal(noteContext.pickNote('Fixture Commentary 18:20',{el:seg,phraseIndex:4}).en,'An exact English source excerpt.');
    assert.equal(noteContext.pickNote('Fixture Commentary 18:20',{el:seg,phraseIndex:-1}).en,'An exact English source excerpt.');
  });
  await check('an inline lookup excludes a distant note from another discussion', async () => {
    assert.equal(noteContext.pickNote('Fixture Commentary 18:20',{el:seg,phraseIndex:14}),null);
  });
  await check('an inline lookup does not borrow a quotation from the adjacent phrase', async () => {
    assert.equal(noteContext.pickNote('Fixture Commentary 18:20',{el:seg,phraseIndex:5}),null);
  });
  await check('note excerpts do not broaden to an entire chapter', async () => {
    assert.equal(noteContext.pickNote('Ezekiel 18',{el:seg,phraseIndex:4}),null);
  });
  await check('ambiguous different quotations of the same source are omitted', async () => {
    const other = structuredClone(quotedNote);
    other.paragraphs[0].text = 'Fixture Commentary 18:20: “A different part of the source.”';
    other.paragraphs[0].rich[1].text = ': “A different part of the source.”';
    noteContext.R.sections[0].annotations[0].push(other);
    assert.equal(noteContext.pickNote('Fixture Commentary 18:20',{el:seg,phraseIndex:-1}),null);
  });

  console.log(JSON.stringify({ok:true,cases:passed.length,checks:passed}));
} catch (error) {
  console.error('Source rendering fidelity failed after ' + passed.length + ' cases: ' + error.stack);
  process.exitCode = 1;
}

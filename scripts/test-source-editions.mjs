#!/usr/bin/env node
/* Deterministic edition-policy checks. --live also verifies primary Sefaria
 * metadata and representative exact passages; no browser or paid API is used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const editions = require('../dist/library/source-editions.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');

export async function runFixtures() {
  let fixtures = 0;
  const check = async work => { await work(); fixtures++; };
  const example = (ref = 'Exodus 12:11', overrides = {}) => ({
    ref, sectionRef: 'Exodus 12', heRef: 'שמות י״ב:י״א', sections:['12','11'], toSections:['12','11'],
    versions:[
      {versionTitle:'Miqra according to the Masorah', actualLanguage:'he', language:'he', text:'וַאֲכַלְתֶּם אֹתוֹ בְּחִפָּזוֹן'},
      {versionTitle:editions.policyFor(ref).versionTitle, actualLanguage:'en', language:'en',
        text:'You must eat it in haste.', versionSource:'https://www.nli.org.il/he/books/NNL_ALEPH002691623', license:'CC-BY'}
    ], ...overrides
  });
  const reject = async (mutate, code) => check(() => {
    const raw = example(); mutate(raw);
    assert.throws(() => editions.adaptResponse('Exodus 12:11', raw), error => error.code === code);
  });

  await check(() => assert.equal(editions.TANACH_BOOKS.length, 39));
  await check(() => assert.equal(Object.keys(editions.RASHI_EDITIONS).length, 16));
  await check(() => {
    for (const book of ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy'])
      assert.equal(editions.policyFor(book + ' 1:1').versionTitle, 'Metsudah Chumash, Metsudah Publications, 2009');
    for (const book of editions.TANACH_BOOKS.filter(book => !editions.CHUMASH_BOOKS.includes(book)))
      assert.equal(editions.policyFor(book + ' 1:1').versionTitle, 'The Koren Jerusalem Bible');
  });
  await check(() => assert.equal(editions.policyFor('Rashi on Genesis 1:1:1').versionTitle,
    'Rashi Chumash, Metsudah Publications, 2009'));
  await check(() => assert.equal(editions.policyFor('Rashi on Joshua 1:1:1').versionTitle,
    'The Book of Joshua, Metsudah Publications, 1997'));
  await check(() => assert.equal(editions.policyFor('Rashi on II Kings 1:2:1').versionTitle,
    'The Metsudah Tanach series, Lakewood, N.J'));
  await check(() => assert.equal(editions.policyFor('Rashi on Esther 1:1:1').versionTitle,
    'The Metsudah Five Megillot, Lakewood, N.J., 2001'));
  await check(() => {
    for (const ref of ['Berakhot 6b:34','Rashi on Psalms 1:1:1','Rashi on Berakhot 6b:1',
      'Ramban on Genesis 1:1','Genesis Rabbah 1:1','Tzidkat HaTzadik 1:1']) assert.equal(editions.policyFor(ref), null, ref);
  });
  await check(() => assert.equal(editions.policyFor('https://www.sefaria.org/Exodus.12.11?ven=english%7CTHE_JPS_TANAKH%3A_Gender-Sensitive_Edition').ref, 'Exodus 12:11'));
  await check(() => assert.equal(editions.policyFor('https://www.sefaria.org/Rashi_on_1_Samuel.1.1.1').ref, 'Rashi on I Samuel 1:1:1'));
  await check(() => assert.equal(editions.policyFor('rashi on bereishis 1:1:1').ref, 'Rashi on Genesis 1:1:1'));
  await check(() => assert.equal(editions.policyFor('תהילים 1:1').versionTitle, 'The Koren Jerusalem Bible'));
  await check(() => assert.equal(editions.policyFor('Exodus_12.11').ref, 'Exodus 12:11'));
  await check(() => {
    for (const value of ['https://other.example/Genesis.1.1','https://www.sefaria.org/sheets/123',
      'Genesis 1:0','Genesis 1:3-1:1','Genesis 1:1-','Genesis 1:1:1',
      'Rashi on Genesis 1a:1','Rashi on Genesis 1:1:1:1']) assert.equal(editions.policyFor(value), null, value);
  });
  await check(() => {
    const url = new URL(editions.requestUrl('Exodus 12:11'));
    assert.equal(url.origin, 'https://www.sefaria.org');
    assert.equal(decodeURIComponent(url.pathname), '/api/v3/texts/Exodus 12:11');
    assert.deepEqual(url.searchParams.getAll('version'), ['source','english|Metsudah Chumash, Metsudah Publications, 2009']);
    assert.equal(url.searchParams.get('fill_in_missing_segments'), '0');
  });
  await check(() => {
    const url = new URL(editions.sourceUrl('Rashi on I Samuel 1:1:1'));
    assert.equal(url.pathname, '/Rashi_on_I_Samuel.1.1.1');
    assert.equal(url.searchParams.get('ven'), 'english|The_Metsudah_Tanach_series,_Lakewood,_N.J');
  });
  await check(() => {
    const raw = example(), before = JSON.stringify(raw), result = editions.adaptResponse('Exodus 12:11', raw);
    assert.deepEqual(result.he, [raw.versions[0].text]);
    assert.deepEqual(result.en, [raw.versions[1].text]);
    assert.equal(result.preferredEdition.status, 'available');
    assert.equal(result.preferredEdition.actualVersionTitle, editions.EDITIONS.chumash);
    assert.equal(result.preferredEdition.completeEnglish, true);
    assert.equal(result.preferredEdition.license, 'CC-BY');
    assert.equal(result.segmentLevel, true);
    assert.equal(JSON.stringify(raw), before, 'Reading must not rewrite source evidence');
  });
  await check(() => {
    const raw = example(); raw.versions[1].text = '<b>Remember.</b>';
    assert.deepEqual(editions.adaptResponse('Exodus 12:11', raw).en, ['<b>Remember.</b>'], 'Preserve the edition, including brief text and markup');
  });
  await check(() => {
    const raw = example(); raw.versions = raw.versions.slice(0,1);
    const result = editions.adaptResponse('Exodus 12:11', raw);
    assert.deepEqual(result.en, []);
    assert.equal(result.preferredEdition.status, 'missing');
    assert.equal(result.preferredEdition.actualVersionTitle, null);
    assert.match(result.preferredEdition.message, /no English text in Metsudah/);
  });
  await check(() => {
    const raw = example('Exodus 12:11-12', {ref:'Exodus 12:11-12'});
    raw.versions[0].text = ['ראשון','שני']; raw.versions[1].text = ['First.',''];
    const result = editions.adaptResponse('Exodus 12:11-12', raw);
    assert.deepEqual(result.en, ['First.','']);
    assert.equal(result.preferredEdition.status, 'partial');
    assert.equal(result.preferredEdition.translatedSegments, 1);
  });
  await check(() => {
    const raw = example('Rashi on Genesis 1', {ref:'Rashi on Genesis 1', sectionRef:'Rashi on Genesis 1'});
    raw.versions[0].text = [['ראשון','שני'],[],['שלישי']];
    raw.versions[1].text = [['First.',''],[],['Third.']];
    const result = editions.adaptResponse('Rashi on Genesis 1', raw);
    assert.deepEqual(result.he, raw.versions[0].text);
    assert.deepEqual(result.en, raw.versions[1].text);
    assert.equal(result.preferredEdition.status, 'partial');
  });
  await check(() => {
    const raw = example(); raw.versions[0].text = ''; raw.versions[1].text = 'Available English.';
    assert.equal(editions.adaptResponse('Exodus 12:11', raw).preferredEdition.completeEnglish, false);
  });
  await check(() => {
    const raw = example(); raw.versions[1].text = '';
    assert.equal(editions.adaptResponse('Exodus 12:11', raw).preferredEdition.status, 'missing');
  });
  await reject(raw => { raw.versions[1].versionTitle = 'THE JPS TANAKH: Gender-Sensitive Edition'; }, 'EDITION_MISMATCH');
  await reject(raw => { raw.versions[1].versionTitle += ' [with Onkelos translation]'; }, 'EDITION_MISMATCH');
  await reject(raw => { raw.versions[1].versionTitle = editions.EDITIONS.koren; }, 'EDITION_MISMATCH');
  await reject(raw => { raw.versions[1].actualLanguage = 'es'; }, 'EDITION_MISMATCH');
  await reject(raw => { raw.versions.push({...raw.versions[1]}); }, 'AMBIGUOUS_EDITION');
  await reject(raw => { raw.versions[1].isMerged = true; }, 'MERGED_EDITION');
  await reject(raw => { raw.versions[1].sources = [editions.EDITIONS.chumash, 'Tanakh: The Holy Scriptures, published by JPS']; }, 'MERGED_EDITION');
  await reject(raw => { raw.ref = 'Exodus 12'; }, 'REFERENCE_MISMATCH');
  await reject(raw => { raw.ref = 'Exodus 12:12'; }, 'REFERENCE_MISMATCH');
  await reject(raw => { raw.ref = 'Genesis 12:11'; }, 'REFERENCE_MISMATCH');
  await reject(raw => { raw.versions[1].text = {translation:'Wrong shape'}; }, 'INVALID_TEXT');
  await reject(raw => { raw.error = 'Unknown reference'; }, 'INVALID_RESPONSE');
  await check(() => {
    const raw = example('Exodus 12:11-12', {ref:'Exodus 12:11-12:12'});
    assert.equal(editions.adaptResponse('Exodus 12:11-12', raw).ref, 'Exodus 12:11-12:12');
  });
  await check(() => {
    const raw = example('Genesis 1:2-2:1', {ref:'Genesis 1:2-2:1', sectionRef:'Genesis 1:2-2:1'});
    raw.versions[0].text = [['ראשון'],['שני']]; raw.versions[1].text = [['First.'],['Second.']];
    const result = editions.adaptResponse('Genesis 1:2-2:1', raw);
    assert.equal(result.ref, raw.ref);
    assert.deepEqual(result.en, [['First.'],['Second.']]);
  });
  await check(() => {
    const raw = example('Genesis 1', {ref:'Genesis 1', sectionRef:'Genesis 1'});
    const result = editions.adaptResponse('Genesis', raw);
    assert.equal(result.ref, 'Genesis 1', 'A book opening must retain its actual returned section ref');
  });
  await check(async () => {
    let requests = 0;
    const result = await editions.fetchPreferredText('Exodus 12:11', async request => {
      requests++;
      assert.equal(request, editions.requestPath('Exodus 12:11'));
      return example();
    });
    assert.equal(requests, 1);
    assert.equal(result.preferredEdition.status, 'available');
  });
  await check(async () => {
    const raw = example(); raw.versions[1].versionTitle = 'The Holy Scriptures: A New Translation (JPS 1917)';
    const result = await editions.fetchPreferredText('Exodus 12:11', async () => raw);
    assert.deepEqual(result.he, [raw.versions[0].text]);
    assert.deepEqual(result.en, []);
    assert.equal(result.preferredEdition.status, 'unavailable');
    assert.equal(result.preferredEdition.code, 'EDITION_MISMATCH');
    assert.equal(result.versions.some(version => version.lang === 'English'), false);
  });
  await check(async () => {
    const result = await editions.fetchPreferredText('Psalms 1:1', async () => { throw new Error('Offline'); });
    assert.equal(result.preferredEdition.status, 'unavailable');
    assert.equal(result.preferredEdition.requestedVersionTitle, editions.EDITIONS.koren);
    assert.deepEqual(result.en, []);
  });
  await check(async () => {
    const result = await editions.fetchPreferredText('Exodus 12:11', async () => example('Exodus 12:12'));
    assert.equal(result.preferredEdition.code, 'REFERENCE_MISMATCH');
    assert.deepEqual(result.he, [], 'Hebrew from a different source cannot be retained on failure');
    assert.deepEqual(result.en, []);
  });
  await check(async () => {
    const raw = example(); raw.versions[1].sources = ['JPS 1917'];
    const result = await editions.fetchPreferredText('Exodus 12:11', async () => raw);
    assert.equal(result.preferredEdition.code, 'MERGED_EDITION');
    assert.deepEqual(result.he, [raw.versions[0].text]);
    assert.deepEqual(result.en, [], 'Merged English cannot survive an edition verification failure');
  });
  await check(async () => {
    let requested = false;
    assert.equal(await editions.fetchPreferredText('Tzidkat HaTzadik 1:1', async () => { requested = true; }), null);
    assert.equal(requested, false, 'Canonical Akiva text must not enter the preference fetcher');
  });
  const scoped = (ref, sections, toSections, he, en, metadata = {}) => {
    const raw = example(ref, {ref, sectionRef:ref, sections, toSections,
      textDepth:ref.startsWith('Rashi on ') ? 3 : 2, isSpanning:false, ...metadata});
    raw.versions[0].text = he;
    if (en == null) raw.versions = raw.versions.slice(0,1);
    else raw.versions[1].text = en;
    return raw;
  };
  const withinChapter = () => scoped('Genesis 1:2-3', ['1','2'], ['1','3'],
    ['שני','שלישי'], ['The second verse.','The third verse.']);
  const spanning = () => scoped('Genesis 1:31-2:2', ['1','31'], ['2','2'],
    [['אחרון'],['ראשון','שני']], [['The final verse.'],['The first verse.','The second verse.']],
    {isSpanning:true, spanningRefs:['Genesis 1:31','Genesis 2:1-2']});
  await check(() => {
    const result = editions.adaptResponse('Genesis 1:2-3', withinChapter());
    assert.equal(result.sourceRowStatus, 'exact');
    assert.deepEqual(result.sourceRows.map(row => row.ref), ['Genesis 1:2','Genesis 1:3']);
    assert.deepEqual(result.sourceRows.map(row => row.label), ['1:2','1:3']);
    assert.equal(result.sourceRows[1].en, 'The third verse.');
  });
  await check(() => {
    const raw = scoped('Exodus 12:11', ['12','11'], ['12','11'], 'בחפזון', 'In haste.');
    const result = editions.adaptResponse(raw.ref, raw);
    assert.deepEqual(result.sourceRows, [{ref:'Exodus 12:11',label:'12:11',he:'בחפזון',en:'In haste.'}]);
  });
  await check(() => {
    const raw = spanning(), before = JSON.stringify(raw), result = editions.adaptResponse(raw.ref, raw);
    assert.equal(result.sourceRowStatus, 'exact');
    assert.deepEqual(result.sourceRows.map(row => row.ref), ['Genesis 1:31','Genesis 2:1','Genesis 2:2']);
    assert.equal(result.sourceRows[1].he, 'ראשון');
    assert.deepEqual(result.he, raw.versions[0].text, 'The source card retains its original nested text');
    assert.equal(JSON.stringify(raw), before);
  });
  await check(() => {
    const raw = scoped('Genesis 1', ['1'], ['1'], ['ראשון','שני'], ['First.','Second.']);
    const result = editions.adaptResponse('Genesis', raw);
    assert.deepEqual(result.sourceRows.map(row => row.ref), ['Genesis 1:1','Genesis 1:2']);
  });
  await check(() => {
    const raw = scoped('Rashi on Genesis 1:1:2-3', [1,1,2], [1,1,3], ['שני','שלישי'], ['Second.','Third.']);
    assert.deepEqual(editions.adaptResponse(raw.ref, raw).sourceRows.map(row => row.ref),
      ['Rashi on Genesis 1:1:2','Rashi on Genesis 1:1:3']);
  });
  await check(() => {
    const raw = scoped('Rashi on Genesis 1:1:2-2:1', [1,1,2], [1,2,1],
      [['שני','שלישי'],['ראשון']], [['Second.','Third.'],['First.']],
      {isSpanning:true, spanningRefs:['Rashi on Genesis 1:1:2-3','Rashi on Genesis 1:2:1']});
    const result = editions.adaptResponse('Rashi on Genesis 1:1:2-1:2:1', raw);
    assert.equal(result.sourceRowStatus, 'exact');
    assert.deepEqual(result.sourceRows.map(row => row.ref),
      ['Rashi on Genesis 1:1:2','Rashi on Genesis 1:1:3','Rashi on Genesis 1:2:1']);
  });
  await check(() => {
    const raw = scoped('Rashi on Genesis 1', [1], [1], [['ראשון'],[],['שלישי','נוסף']], [['First.'],[],['Third.','']]);
    const result = editions.adaptResponse(raw.ref, raw);
    assert.equal(result.preferredEdition.status, 'partial');
    assert.deepEqual(result.sourceRows.map(row => row.ref),
      ['Rashi on Genesis 1:1:1','Rashi on Genesis 1:3:1','Rashi on Genesis 1:3:2']);
    assert.equal(result.sourceRows[2].en, '', 'A missing translation remains on its actual comment');
  });
  await check(() => {
    const raw = scoped('Rashi on Genesis 1:2-3', [1,2], [1,3], [['דבר'],[]], [['A comment.'],[]],
      {isSpanning:true, spanningRefs:['Rashi on Genesis 1:2','Rashi on Genesis 1:3']});
    const result = editions.adaptResponse(raw.ref, raw);
    assert.equal(result.sourceRowStatus, 'exact');
    assert.deepEqual(result.sourceRows.map(row => row.ref), ['Rashi on Genesis 1:2:1'],
      'An empty final verse does not acquire a fictitious commentary segment');
  });
  await check(() => {
    const raw = withinChapter(); raw.versions = raw.versions.slice(0,1);
    const result = editions.adaptResponse(raw.ref, raw);
    assert.equal(result.preferredEdition.status, 'missing');
    assert.deepEqual(result.sourceRows.map(row => [row.ref,row.en]), [['Genesis 1:2',''],['Genesis 1:3','']]);
  });
  await check(() => {
    const raw = scoped('Rashi on Genesis 1', [1], [1], [['ראשון'],[],['שלישי']], [['First.']]);
    const result = editions.adaptResponse(raw.ref, raw);
    assert.deepEqual(result.sourceRows.map(row => [row.ref,row.en]),
      [['Rashi on Genesis 1:1:1','First.'],['Rashi on Genesis 1:3:1','']],
      'A shorter English array cannot shift later Hebrew into the first verse');
  });
  const wholeRange = async mutate => check(() => {
    const raw = spanning(); mutate(raw);
    const result = editions.adaptResponse(raw.ref, raw);
    assert.equal(result.sourceRowStatus, 'whole-source');
    assert.equal(result.sourceRows.length, 1);
    assert.equal(result.sourceRows[0].ref, raw.ref);
    assert.equal(result.sourceRows[0].label, raw.ref);
    assert.match(result.sourceRows[0].en, /The final verse\./);
    assert.match(result.sourceRows[0].en, /The second verse\./);
  });
  await wholeRange(raw => { delete raw.textDepth; });
  await wholeRange(raw => { raw.textDepth = 3; });
  await wholeRange(raw => { raw.sections = [1,30]; });
  await wholeRange(raw => { raw.toSections = [2,3]; });
  await wholeRange(raw => { delete raw.isSpanning; });
  await wholeRange(raw => { delete raw.spanningRefs; });
  await wholeRange(raw => { raw.spanningRefs = ['Genesis 1:30','Genesis 2:1-2']; });
  await wholeRange(raw => { raw.versions[0].text[1].push('שלישי לא מבוקש'); });
  await wholeRange(raw => { raw.versions[0].text[0].push('שורה מעבר לתחום הראשון'); });
  await wholeRange(raw => { raw.versions[1].text = ['The final verse.','The first verse.','The second verse.']; });
  await check(async () => {
    const raw = withinChapter(); raw.versions[1].versionTitle = 'JPS 1917';
    const result = await editions.fetchPreferredText(raw.ref, async () => raw);
    assert.equal(result.preferredEdition.status, 'unavailable');
    assert.equal(result.sourceRowStatus, 'exact');
    assert.deepEqual(result.sourceRows.map(row => [row.ref,row.he,row.en]),
      [['Genesis 1:2','שני',''],['Genesis 1:3','שלישי','']],
      'Rejected English cannot reappear inside verified source rows');
  });
  await check(async () => {
    const raw = spanning(); raw.ref = 'Genesis 2:1-3:2';
    const result = await editions.fetchPreferredText('Genesis 1:31-2:2', async () => raw);
    assert.deepEqual(result.sourceRows, [], 'Wrong-reference Hebrew is excluded from a whole-range fallback');
  });
  await check(() => {
    const snapshot = JSON.parse(fs.readFileSync(path.join(REPO, 'sources/akiva/source-editions/availability-20261019.json')));
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.release, editions.VERSION);
    assert.equal(snapshot.records.length, 78);
    assert.equal(new Set(snapshot.records.map(row => row.book)).size, 78);
    assert.equal(snapshot.records.filter(row => row.selectedVersionTitle).length, 55);
    for (const row of snapshot.records) {
      const policy = editions.policyFor(row.book);
      assert.equal(row.selectedVersionTitle, policy?.versionTitle || null);
      assert.match(row.responseSha256, /^[a-f0-9]{64}$/);
      if (policy) assert(row.preferredVersions.some(version => version.versionTitle === policy.versionTitle));
    }
    assert.match(snapshot.scope, /not a claim that every segment is translated/);
  });
  return fixtures;
}

async function requestJSON(url) {
  const response = await fetch(url, {headers:{'Cache-Control':'no-cache'}, signal:AbortSignal.timeout(20000)});
  assert(response.ok, 'Primary Sefaria verification HTTP ' + response.status + ': ' + url);
  const raw = await response.text(), data = JSON.parse(raw);
  assert(!data.error, data.error || 'Primary source returned an error');
  return {data, sha256:sha(raw), url};
}
async function concurrent(items, work, limit = 4) {
  let cursor = 0;
  const results = Array(items.length);
  await Promise.all(Array.from({length:Math.min(limit, items.length)}, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await work(items[index], index); }
  }));
  return results;
}
export async function verifyLive() {
  const books = [...editions.TANACH_BOOKS, ...editions.TANACH_BOOKS.map(book => 'Rashi on ' + book)];
  const metadata = await concurrent(books, async book => {
    const result = await requestJSON(editions.API + '/api/texts/versions/' + encodeURIComponent(book));
    assert(Array.isArray(result.data), 'Version metadata is not an array: ' + book);
    const english = result.data.filter(version => (version.actualLanguage || version.language) === 'en');
    const policy = editions.policyFor(book);
    if (policy) assert(english.some(version => version.versionTitle === policy.versionTitle), 'Preferred edition absent from primary metadata: ' + book);
    if (editions.TANACH_BOOKS.includes(book))
      assert(english.some(version => version.versionTitle === editions.EDITIONS.koren), 'Koren Jerusalem metadata absent: ' + book);
    if (book.startsWith('Rashi on ') && !policy)
      assert(!english.some(version => /\bmetsudah\b/i.test(version.versionTitle)), 'New Metsudah Rashi edition needs an explicit policy mapping: ' + book);
    return {book, requestedVersionTitle:policy?.versionTitle || null, url:result.url, metadataSha256:result.sha256};
  });
  const refs = ['Genesis 2:3','Exodus 12:11','Psalms 1:1','Isaiah 55:1','Rashi on Genesis 1:1:1',
    'Rashi on Joshua 1:1:1','Rashi on Judges 1:1:1','Rashi on I Samuel 1:1:1',
    'Rashi on Song of Songs 5:16:1','Rashi on Ruth 1:21:1','Rashi on Esther 1:1:1'];
  const passages = await concurrent(refs, async ref => {
    const response = await requestJSON(editions.requestUrl(ref));
    const result = editions.adaptResponse(ref, response.data);
    assert.equal(result.preferredEdition.status, 'available', 'Preferred source passage incomplete: ' + ref);
    return {ref, versionTitle:result.preferredEdition.actualVersionTitle, license:result.preferredEdition.license,
      requestUrl:response.url, sourceUrl:result.sourceTranslationUrl, responseSha256:response.sha256};
  });
  const rangeCases = [
    {ref:'Genesis 1:2-3', first:'Genesis 1:2', last:'Genesis 1:3', rows:2},
    {ref:'Genesis 1:31-2:2', first:'Genesis 1:31', last:'Genesis 2:2', rows:3},
    {ref:'Rashi on Genesis 1:1:2-1:2:1', first:'Rashi on Genesis 1:1:2', last:'Rashi on Genesis 1:2:1', rows:3},
    {ref:'Rashi on Genesis 1:2-3', first:'Rashi on Genesis 1:2:1', last:'Rashi on Genesis 1:2:5', rows:5}
  ];
  const ranges = await concurrent(rangeCases, async expected => {
    const response = await requestJSON(editions.requestUrl(expected.ref));
    const result = editions.adaptResponse(expected.ref, response.data);
    assert.equal(result.sourceRowStatus, 'exact', 'Primary source range rows could not be verified: ' + expected.ref);
    assert.equal(result.sourceRows.length, expected.rows);
    assert.equal(result.sourceRows[0].ref, expected.first);
    assert.equal(result.sourceRows.at(-1).ref, expected.last);
    return {...expected, actualRef:result.ref, sections:response.data.sections, toSections:response.data.toSections,
      versionTitle:result.preferredEdition.actualVersionTitle, requestUrl:response.url, responseSha256:response.sha256};
  });
  return {metadataBooksVerified:metadata.length, preferredMappingsVerified:metadata.filter(row => row.requestedVersionTitle).length,
    exactPassagesVerified:passages.length, exactSourceRangesVerified:ranges.length, metadata, passages, ranges};
}
async function main() {
  const args = process.argv.slice(2);
  let live = false, publicUrl = null;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--live') live = true;
    else if (args[index] === '--url' && args[index + 1]) publicUrl = args[++index];
    else assert.fail('Usage: node scripts/test-source-editions.mjs [--live] [--url LIBRARY_BASE_URL]');
  }
  const result = {ok:true, fixtures:await runFixtures(), release:editions.VERSION,
    tanachBooks:editions.TANACH_BOOKS.length, metsudahRashiBooks:Object.keys(editions.RASHI_EDITIONS).length};
  if (live) result.live = await verifyLive();
  if (publicUrl) {
    const base = new URL(publicUrl.endsWith('/') ? publicUrl : publicUrl + '/');
    assert(base.protocol === 'https:' || ['localhost','127.0.0.1'].includes(base.hostname), 'Live verification requires HTTPS');
    const url = new URL('source-editions.js', base); url.searchParams.set('verify', editions.VERSION);
    const response = await fetch(url, {headers:{'Cache-Control':'no-cache'}, signal:AbortSignal.timeout(20000)});
    assert(response.ok, 'Published edition policy is unavailable: HTTP ' + response.status);
    const raw = Buffer.from(await response.arrayBuffer()), local = fs.readFileSync(path.join(REPO, 'dist/library/source-editions.js'));
    assert(raw.equals(local), 'Published edition policy differs from this exact build');
    result.publicFilesVerified = ['source-editions.js']; result.moduleSha256 = sha(raw);
  }
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}

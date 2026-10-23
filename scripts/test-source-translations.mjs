#!/usr/bin/env node
// Preservation and rejection checks for reusing existing English quotations.
// These checks deliberately do not confer semantic approval on a translation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildSourceTranslations, completePrimaryUnit, publishedTranslation, primaryPlainText} from './build-source-translations.mjs';
import {readPublishedAudit} from './publish-divrei-source-audit.mjs';

const require = createRequire(import.meta.url);
const engine = require('../dist/library/source-connections.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (filename, value) => { fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, value); };
const writeJSON = (filename, value) => write(filename, JSON.stringify(value));

export function runFixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akiva-source-translations-'));
  const options = {partsDir: path.join(root, 'parts'), evidenceFile: path.join(root, 'primary.json.gz.b64'),
    libraryRoot: path.join(root, 'library'), output: path.join(root, 'library/source-connections/translations.json')};
  let fixtures = 0;
  const check = work => { work(); fixtures++; };
  const ref = 'Rashi on Ketubot 85b:8:1';
  const sourceUrl = 'https://www.sefaria.org/Rashi_on_Ketubot_85b:8:1';
  const requestUrl = 'https://www.sefaria.org/api/texts/Rashi_on_Ketubot_85b?context=0&commentary=0&pad=0';
  const he = 'שודא דדייני - הטלת הדיינים לפי מה שיראו דיינים שהיה דרכו של מת לקרב את זה יותר מזה או מי שבשניהן טוב ונוהג בדרך ישרה שיש לומר בו נתכוין המת לזכות:';
  const en = '“The judges’ assessment”: The judges assign it according to what they perceive: whether it was the deceased’s practice to draw one person closer than the other, or which of the two is good and follows an upright path, so that one may say the deceased intended to benefit him.';
  const primary = {ref: 'Rashi on Ketubot 85b', sections: ['85b'], toSections: ['85b'],
    addressTypes: ['Talmud', 'Integer', 'Integer'], he: [...Array.from({length: 7}, () => []), [he]],
    heVersionTitle: 'Primary preservation fixture', heLicense: 'Public Domain', heVersionSource: requestUrl, index_offsets_by_depth: {}};
  const raw = JSON.stringify(primary), sourceHash = sha(raw);
  const restoration = {path: 'data/fixture/1.json', placementId: 'OLD-PLACEMENT', verified: true,
    sourceHebrew: he, sourceTranslationSha256: sha(en), sourceSha256: sourceHash, sourceCachePath: '/tmp/fixture-source.json',
    sourceRequestUrl: requestUrl, sourceSegmentRefs: [ref], sourceSegmentIndices: [[7, 0]], sourceLanguage: 'he',
    versionTitle: 'Published-quotation preservation fixture', versionSource: requestUrl, license: 'Fixture translation attribution',
    method: 'Complete direct English translation of the Hebrew source unit', verificationScope: 'Complete source unit and citation checked against manuscript anchor'};
  const paragraph = {text: ref + ': “' + en + '”', rich: [{text: ref, href: sourceUrl}, {text: ': “' + en + '”'}]};
  const note = {placementId: 'NEW-PLACEMENT', sourceId: 'FIXTURE', verificationStatus: 'verified', paragraphs: [paragraph],
    sources: [{ref, url: sourceUrl, role: 'primary-source'}], provenance: {sourceQuotationRelease: {
      release: 'fixture-source-quotations', sourceRef: ref, sourceURL: sourceUrl, sourceSegmentRefs: [ref], sourceLanguage: 'he',
      sourceSha256: sourceHash, sourceTranslationSha256: sha(en), versionTitle: restoration.versionTitle,
      versionSource: requestUrl, license: restoration.license, method: restoration.method}}};
  const initial = {restoration, originalNote: structuredClone(note), finalNote: structuredClone(note), rawPrimary: raw, archiveHash: sourceHash};
  const stage = values => {
    const payload = {schemaVersion: 1, release: 'fixture-source-quotations', quotationRestorations: [values.restoration],
      files: [{path: restoration.path, blocks: [{after: [values.originalNote]}]}]};
    const payloadBytes = gzipSync(JSON.stringify(payload), {level: 9});
    write(path.join(options.partsDir, 'part-0000.bin'), payloadBytes);
    writeJSON(path.join(options.partsDir, 'manifest.json'), {schemaVersion: 1, release: payload.release,
      bytes: payloadBytes.length, sha256: sha(payloadBytes), parts: [{path: 'part-0000.bin', bytes: payloadBytes.length, sha256: sha(payloadBytes)}]});
    const archive = {schemaVersion: 1, sourceRelease: payload.release, sourceReleaseSha256: sha(payloadBytes),
      sources: [{sha256: values.archiveHash, requestUrls: [requestUrl], rawResponse: values.rawPrimary}]};
    write(options.evidenceFile, gzipSync(JSON.stringify(archive), {level: 9}).toString('base64') + '\n');
    writeJSON(path.join(options.libraryRoot, restoration.path), [{footnotes: [values.finalNote]}]);
  };
  const rejection = (mutate, pattern) => check(() => {
    const changed = structuredClone(initial);
    mutate(changed);
    stage(changed);
    const before = fs.existsSync(options.output) ? sha(fs.readFileSync(options.output)) : null;
    assert.throws(() => buildSourceTranslations(options), pattern);
    assert.equal(fs.existsSync(options.output) ? sha(fs.readFileSync(options.output)) : null, before,
      'Rejected translation evidence changed the published output');
  });
  const unitRejection = (mutate, pattern) => check(() => {
    const changed = {restoration: structuredClone(restoration), primary: structuredClone(primary)};
    mutate(changed);
    assert.throws(() => completePrimaryUnit(changed.restoration, changed.primary), pattern);
  });
  try {
    stage(structuredClone(initial));
    const chapterBefore = sha(fs.readFileSync(path.join(options.libraryRoot, restoration.path)));
    const built = buildSourceTranslations(options);
    check(() => assert.equal(built.catalog.release, engine.VERSION));
    check(() => assert.equal(built.catalog.translations.length, 1));
    const result = built.catalog.translations[0];
    check(() => assert.equal(result.en, en, 'Nested quotation marks and English punctuation must remain byte-for-byte unchanged'));
    check(() => assert.equal(result.he, he));
    check(() => assert.equal(result.mode, 'complete-source-unit'));
    check(() => assert.equal(result.evidence.sourceEnglishSha256, sha(en)));
    check(() => assert.equal(result.evidence.sourceCacheSha256, sourceHash));
    check(() => assert.equal(result.evidence.publishedNotes[0].placementId, 'NEW-PLACEMENT', 'Matching must survive placement ID renumbering'));
    check(() => assert.equal(result.evidence.publishedNotes[0].jsonPointer, '/0/footnotes/0'));
    check(() => assert.match(result.provenance, /Already-published Akiva Publishing footnote translation/));
    check(() => assert.equal(buildSourceTranslations(options).written, false));
    check(() => assert.equal(sha(fs.readFileSync(path.join(options.libraryRoot, restoration.path))), chapterBefore));
    check(() => assert.equal(primaryPlainText('<b>כִּי</b> קָרוֹב &quot;אֵלֶיךָ&quot;'), 'כִּי קָרוֹב "אֵלֶיךָ"'));
    check(() => assert.notEqual(primaryPlainText('כִּי'), primaryPlainText('כי'), 'Source fidelity may not discard nikkud'));
    check(() => assert.equal(completePrimaryUnit({...restoration, sourceHebrew: [he]}, primary).he, he));
    unitRejection(value => { value.restoration.sourceHebrew = he.slice(0, 70); }, /shorter than or differs/);
    unitRejection(value => { value.primary.he[7][0] += ' ולא כדברי הראשון.'; }, /shorter than or differs/);
    unitRejection(value => { value.restoration.sourceHebrew = he.replace('לפי מה שיראו דיינים ', ''); }, /shorter than or differs/);
    unitRejection(value => { value.restoration.sourceSegmentRefs = ['Rashi on Ketubot 85b:8:2']; }, /address differs/);
    unitRejection(value => { value.restoration.sourceSegmentIndices = [[6, 0]]; }, /outside the response/);
    unitRejection(value => { value.restoration.sourceSegmentIndices = [[7]]; }, /terminal source unit/);
    unitRejection(value => { value.restoration.sourceSegmentRefs.push('Rashi on Ketubot 85b:9:1'); }, /ambiguous/);
    unitRejection(value => { value.restoration.verified = false; }, /not verified/);
    unitRejection(value => { value.restoration.verificationScope = 'Verified only as a transmitted excerpt'; }, /Limited transmitted/);
    unitRejection(value => { value.restoration.sourceLanguage = 'en'; }, /Independent Hebrew/);
    unitRejection(value => { value.primary.index_offsets_by_depth = {'2': [7]}; }, /Offset primary/);
    unitRejection(value => { value.primary.toSections = ['86a']; }, /Spanning primary/);
    check(() => {
      const two = {...primary, ref: 'Noda BiYehudah II, Yoreh Deah 10', sections: [10], toSections: [10],
        addressTypes: ['Integer', 'Integer'], he: ['דבר ראשון.', 'דבר שני.', 'דבר שלישי.']};
      const range = {...restoration, sourceSegmentRefs: ['Noda BiYehudah II, Yoreh Deah 10:1-2'], sourceSegmentIndices: [[0], [1]],
        sourceHebrew: ['דבר ראשון.', 'דבר שני.']};
      assert.equal(completePrimaryUnit(range, two).he, 'דבר ראשון. דבר שני.');
      assert.throws(() => completePrimaryUnit({...range, sourceSegmentIndices: [[1], [0]]}, two), /ordered contiguous/);
      assert.throws(() => completePrimaryUnit({...range, sourceSegmentIndices: [[0], [2]]}, two), /ordered contiguous/);
    });
    rejection(value => { value.finalNote.verificationStatus = 'unverified'; }, /not verified/);
    rejection(value => { value.finalNote.sources.push({...value.finalNote.sources[0]}); }, /ambiguous source attribution/);
    rejection(value => { value.finalNote.paragraphs.push({...paragraph}); }, /not one exact/);
    rejection(value => { value.finalNote.sources[0].ref = 'Rashi on Ketubot 85b:8:2'; }, /exact restored primary/);
    rejection(value => { value.finalNote.sources[0].url = 'https://www.sefaria.org/Rashi_on_Ketubot_85b:8:2'; }, /URL differs/);
    rejection(value => { value.finalNote.provenance.sourceQuotationRelease.sourceSha256 = '0'.repeat(64); }, /primary source proof differs/);
    rejection(value => { value.finalNote.provenance.sourceQuotationRelease.versionTitle = 'Unattributed Sefaria English'; }, /attribution differs/);
    rejection(value => {
      value.finalNote.paragraphs[0].text = ref + ': “A shortened translation.”';
      value.finalNote.paragraphs[0].rich = [{text: ref, href: sourceUrl}, {text: ': “A shortened translation.”'}];
    }, /English quotation checksum mismatch/);
    rejection(value => { value.finalNote.paragraphs[0].rich[1].text = ': “A changed visible conclusion.”'; }, /rich quotation differs/);
    rejection(value => { value.rawPrimary += '\n'; }, /Raw primary response checksum mismatch/);
    rejection(value => { value.archiveHash = '0'.repeat(64); }, /Raw primary response checksum mismatch/);
    rejection(value => { value.restoration.sourceSha256 = '0'.repeat(64); }, /Missing durable raw primary/);
    rejection(value => { value.restoration.sourceHebrew = he.slice(0, 70); }, /No complete source translations/);
    check(() => assert.throws(() => publishedTranslation({...note, paragraphs: [{text: paragraph.text + ' This means something else.'}]}, restoration,
      'fixture-source-quotations'), /outer-delimited/));
    stage(structuredClone(initial));
    check(() => assert.throws(() => buildSourceTranslations({...options, output: path.join(options.libraryRoot, restoration.path)}), /must not overwrite/));
    check(() => {
      const filename = path.join(options.partsDir, 'part-0000.bin');
      fs.appendFileSync(filename, 'changed');
      assert.throws(() => buildSourceTranslations(options), /part checksum mismatch/);
    });
    return fixtures;
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}

async function main() {
  let publicUrl = null, fixturesOnly = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--fixtures-only') fixturesOnly = true;
    else if (args[index] === '--url' && args[index + 1]) publicUrl = args[++index];
    else assert.fail('Usage: node scripts/test-source-translations.mjs [--fixtures-only] [--url LIBRARY_BASE_URL]');
  }
  const fixtures = runFixtures();
  if (fixturesOnly) { console.log(JSON.stringify({ok: true, fixtures})); return; }
  const output = path.join(REPO, 'dist/library/source-connections/translations.json');
  const bytes = fs.readFileSync(output), published = JSON.parse(bytes);
  const checked = buildSourceTranslations({write: false});
  assert(bytes.equals(checked.bytes), 'Published source translations differ from exact primary evidence or final footnotes');
  assert.equal(published.release, engine.VERSION, 'Translation index and deployed source matcher versions differ');
  const byRef = new Map(published.translations.map(translation => [translation.ref, translation]));
  assert.equal(byRef.size, published.translations.length, 'Competing exact source translations');
  for (const translation of published.translations) {
    assert.equal(sha(translation.en), translation.evidence.sourceEnglishSha256);
    assert.equal(sha(translation.he), translation.evidence.displayHebrewSha256);
    assert.equal(translation.mode, 'complete-source-unit');
    assert.equal(engine.sourceRefFromUrl(translation.sourceUrl), translation.ref);
  }
  // These real samples preserve the objections, qualifications, and conclusion
  // in the primary text. Previously retained sub-unit excerpts stay excluded.
  assert.match(byRef.get('Rashi on Ketubot 85b:8:1')?.en || '', /so that one may say the deceased intended to benefit him\.$/);
  const divreiAudit = readPublishedAudit(path.join(REPO,'dist/library'));
  const tosafot = byRef.get('Tosafot on Pesachim 53b:7:1');
  if (tosafot || !divreiAudit) {
    assert.match(tosafot?.en || '', /Nevertheless, the expression ‘served’ is not satisfactory/);
    assert.match(tosafot?.en || '', /What did they see that they did not flee\?/);
  } else {
    // The new Divrei footnote deliberately quotes only Rabbeinu Tam's relevant
    // explanation; that excerpt must not pass as this entire Tosafot unit.
    assert(divreiAudit.audit.notes.filter(note=>[578,628].includes(note.number))
      .every(note=>note.quotes.some(quote=>quote.ref==='Tosafot on Pesachim 53b:7:1')));
  }
  if(divreiAudit)for(const translation of published.translations)
    assert(translation.evidence.publishedNotes.every(note=>!/^data\/divrei-soferim\//.test(note.path)),
      'A superseded Divrei note survived in the complete-source translation index');
  for (const ref of ['Tanna DeBei Eliyahu Rabbah 2:1', 'Sefer HaShorashim, אישׁ', 'Sefer Yereim 252:4',
    'Teshuvot Maharshal 89:2', 'Teshuvot Maharshal 36:4', 'Rosh on Bava Metzia 9:14:2',
    'Shiltei HaGiborim on Shabbat 54b:3', "Sheiltot d'Rav Achai Gaon 1:1"])
    assert(!byRef.has(ref), 'An existing excerpt must not be promoted to the complete indexed source unit: ' + ref);
  const result = {ok: true, fixtures, release: published.release, ...published.counts, sha256: sha(bytes)};
  if (publicUrl) {
    const base = new URL(publicUrl.endsWith('/') ? publicUrl : publicUrl + '/');
    assert(base.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(base.hostname), 'Public verification requires HTTPS');
    const url = new URL('source-connections/translations.json', base);
    url.searchParams.set('verify', published.release);
    const response = await fetch(url, {headers: {'Cache-Control': 'no-cache'}, signal: AbortSignal.timeout(20000)});
    assert(response.ok, 'Published source translation index is unavailable: HTTP ' + response.status);
    assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(bytes), 'Published source translations do not match this exact release');
    result.publicFilesVerified = ['source-connections/translations.json'];
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error('Source translation verification failed: ' + error.message); process.exitCode = 1; }
}

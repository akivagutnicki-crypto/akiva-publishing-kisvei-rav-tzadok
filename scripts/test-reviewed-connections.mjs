#!/usr/bin/env node
// Negative source/quotation fixtures, exact source matching, deterministic
// catalog validation, and optional public readback of the shipped catalog.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildReviewedConnections, validateTranslation, validateSourceRef} from './build-reviewed-connections.mjs';
import {verifySourceConnectionsPreserved} from './publish-mei-volume-ii.mjs';
import {verifyReviewedConnectionsPreserved} from './publish-mei-likutei.mjs';

const require = createRequire(import.meta.url);
const engine = require('../dist/library/source-connections.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = contents => createHash('sha256').update(contents).digest('hex');
const writeJSON = (filename, value) => { fs.mkdirSync(path.dirname(filename), {recursive: true}); fs.writeFileSync(filename, JSON.stringify(value)); };

function runFixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewed-connection-test-'));
  const editorialDir = path.join(root, 'editorial');
  const mcpRoot = path.join(root, 'mcp');
  const output = path.join(root, 'reader', 'source-connections', 'catalog.json');
  const editorialFile = path.join(editorialDir, 'reviewed.json');
  const sourceProofFile = path.join(editorialDir, 'evidence', 'deuteronomy-30-14.json');
  const options = {editorialDir, mcpRoot, output, date: '2026-10-19'};
  let checked = 0;
  const check = fn => { fn(); checked++; };
  const source = 'כי קרוב אליך הדבר מאד בפיך ובלבבך לעשותו';
  const sourceProof = {ref: 'Deuteronomy 30:14',
    apiUrl: 'https://www.sefaria.org/api/texts/Deuteronomy.30.14?context=0',
    versionTitle: 'Synthetic primary-source fixture', verifiedAt: '2026-10-19',
    hebrew: [source, 'דברי המקור ממשיכים מכאן ואילך.']};
  const target = 'כִּי קָרוֹב אֵלֶיךָ הַדָּבָר מְאֹד, בְּפִיךָ וּבִלְבָבְךָ לַעֲשֹׂתוֹ.';
  const record = {id: 'fixture-reviewed-nearness', sourceRefs: ['Deuteronomy 30:14'], sourceHebrew: source,
    sourceEnglish: 'The matter is very close to you, in your mouth and in your heart, to do it.',
    sourceUrl: 'https://www.sefaria.org/Deuteronomy.30.14', targetRef: 'Fixture Tzadok 1:1',
    targetHebrew: target, targetEnglish: 'The matter is very close to you, in your mouth and in your heart, to do it.',
    school: 'Kisvei Rav Tzadok', explanation: 'The target identifies nearness with a command that can be expressed and put into practice.',
    focusTerms: ['nearness', 'קרוב'], translationProvenance: 'Synthetic fixture translation; not a publishable editorial record.', reviewed: true};
  const catalog = {version: 'fixture-final-version', books: [{slug: 'fixture-tzadok', title: 'Fixture Tzadok', group: "R' Tzadok HaKohen",
    sections: [{ref: 'Fixture Tzadok 1', il: true, first: 0, count: 2}]}]};
  const document = {slug: 'fixture-tzadok', paras: [
    {r: 'Fixture Tzadok 1:1', s: 0, n: 1, p: [[target, record.targetEnglish], ['דברי הביאור מכאן ואילך.', 'Further explanation begins here.']]},
    {r: 'Fixture Tzadok 1:10', s: 0, n: 10, p: [['דרך אחרת וענין אחר לגמרי.', 'A different path and an entirely different matter.']]}
  ]};
  record.reviewedTargetHebrewSha256 = sha(engine.normalizedHebrew(document.paras[0].p.map(pair => pair[0]).join(' ')));
  record.reviewedSourceHebrewSha256 = sha(engine.normalizedHebrew(sourceProof.hebrew.join(' ')));
  const stage = records => writeJSON(editorialFile, {schemaVersion: 1, records});
  const rejects = (mutate, pattern, start = [record]) => check(() => {
    const values = structuredClone(start);
    mutate(values);
    stage(values);
    const before = fs.existsSync(output) ? sha(fs.readFileSync(output)) : null;
    assert.throws(() => buildReviewedConnections(options), pattern);
    assert.equal(fs.existsSync(output) ? sha(fs.readFileSync(output)) : null, before, 'An invalid record changed the published catalog');
  });
  const rejectsProof = (mutate, pattern) => check(() => {
    stage([record]);
    const changed = structuredClone(sourceProof);
    const before = fs.existsSync(output) ? sha(fs.readFileSync(output)) : null;
    try {
      if (mutate(changed) === null) fs.unlinkSync(sourceProofFile);
      else writeJSON(sourceProofFile, changed);
      assert.throws(() => buildReviewedConnections(options), pattern);
      assert.equal(fs.existsSync(output) ? sha(fs.readFileSync(output)) : null, before, 'Invalid primary evidence changed the published catalog');
    } finally { writeJSON(sourceProofFile, sourceProof); }
  });
  try {
    writeJSON(path.join(mcpRoot, 'catalog.json'), catalog);
    writeJSON(path.join(mcpRoot, 'text/fixture-tzadok.json'), document);
    writeJSON(sourceProofFile, sourceProof);
    const canonicalBefore = sha(fs.readFileSync(path.join(mcpRoot, 'text/fixture-tzadok.json')));
    stage([record]);
    const first = buildReviewedConnections(options);
    check(() => assert.equal(first.catalog.counts.records, 1));
    check(() => assert.equal(first.catalog.records[0].evidence.canonicalParagraphRef, record.targetRef));
    check(() => assert.equal(first.catalog.records[0].evidence.normalizedQuoteStart, 0));
    check(() => assert.match(first.catalog.records[0].evidence.canonicalParagraphSha256, /^[a-f0-9]{64}$/));
    check(() => assert.equal(first.catalog.records[0].evidence.sourceQuoteVerification, 'exact-contiguous-primary-hebrew'));
    check(() => assert.equal(first.catalog.records[0].evidence.primarySources[0].ref, 'Deuteronomy 30:14'));
    check(() => assert.equal(first.catalog.records[0].evidence.primarySources[0].fileSha256, sha(fs.readFileSync(sourceProofFile))));
    check(() => assert.equal(first.catalog.records[0].evidence.primarySources[0].normalizedQuoteStart, 0));
    check(() => assert.equal(first.catalog.records[0].evidence.primarySources[0].normalizedFullHebrewSha256, record.reviewedSourceHebrewSha256));
    check(() => assert.equal(buildReviewedConnections(options).written, false));
    check(() => assert.equal(sha(fs.readFileSync(path.join(mcpRoot, 'text/fixture-tzadok.json'))), canonicalBefore));
    check(() => assert.equal(engine.normalizedHebrew('<b>כִּי</b> קָרוֹב אֵלֶיךָ'), 'כי קרוב אליך'));
    check(() => assert.equal(engine.normalizedHebrew('אע״פ אע\'פ אע&quot;פ'), 'אעפ אעפ אעפ'));
    check(() => assert.notEqual(engine.normalizedHebrew('קרוב'), engine.normalizedHebrew('קרב')));
    check(() => assert.notEqual(engine.normalizedHebrew('מלך'), engine.normalizedHebrew('מלכ')));
    check(() => assert.equal(validateTranslation('Remember.'), 'Remember.'));
    check(() => assert.equal(validateSourceRef('Berakhot 6b:3-8'), 'Berakhot 6b:3-8'));
    check(() => assert.equal(validateSourceRef('Berakhot 6b:3-7a:2'), 'Berakhot 6b:3-7a:2'));
    check(() => assert.throws(() => validateSourceRef('Berakhot 6b'), /segment-level/));
    check(() => assert.throws(() => validateSourceRef('Berakhot 6b-7a'), /segment-level/));
    check(() => assert.throws(() => validateSourceRef('Berakhot 6b:3-7a'), /incomplete end/));
    check(() => assert.throws(() => validateSourceRef('Genesis 1'), /requires a verse/));
    check(() => assert.throws(() => validateSourceRef('Mishnah Pesachim 9'), /exact mishnah/));
    rejects(values => { values[0].reviewed = false; }, /individually reviewed/);
    rejects(values => { values[0].sourceEnglish = ''; }, /Source English/);
    rejects(values => { values[0].targetEnglish = 'No English translation is available for this source.'; }, /placeholder/);
    rejects(values => { values[0].sourceEnglish = 'Translation of Source:'; }, /only a label/);
    rejects(values => { values[0].sourceEnglish = 'Context: the author discusses nearness.'; }, /editorial commentary/);
    rejects(values => { values[0].targetEnglish = 'Fixture Tzadok 1:1'; }, /only a citation/);
    rejects(values => { values[0].targetEnglish = 'דברים קרובים אליך'; }, /must contain English/);
    rejects(values => { values[0].sourceHebrew = 'The matter is close.'; }, /must contain Hebrew/);
    rejects(values => { values[0].sourceHebrew = 'כי קרב אליך הדבר מאד'; }, /Source Hebrew is not an exact contiguous quote/);
    rejects(values => { values[0].sourceHebrew = 'אליך כי קרוב הדבר'; }, /Source Hebrew is not an exact contiguous quote/);
    rejects(values => { values[0].sourceHebrew = 'קרוב אלי'; }, /Source Hebrew is not an exact contiguous quote/);
    rejects(values => { values[0].sourceHebrew = 'כי קרוב הדבר מאד'; }, /Source Hebrew is not an exact contiguous quote/);
    rejects(values => { delete values[0].reviewedSourceHebrewSha256; }, /Reviewed source Hebrew SHA-256/);
    rejects(values => { values[0].reviewedSourceHebrewSha256 = 'not-a-hash'; }, /must pin the full normalized primary evidence/);
    rejects(values => { values[0].reviewedSourceHebrewSha256 = '0'.repeat(64); }, /Reviewed source context changed or does not match/);
    rejects(values => { values[0].sourceRefs = ['Deuteronomy 30:15']; values[0].sourceUrl = 'https://www.sefaria.org/Deuteronomy.30.15'; }, /Missing primary source evidence/);
    rejectsProof(() => null, /Missing primary source evidence/);
    rejectsProof(proof => { proof.ref = 'Deuteronomy 30:15'; }, /evidence URL does not match its canonical reference/);
    rejectsProof(proof => { proof.hebrew = 'אלה דברים אחרים שאינם שייכים למקור המצוטט'; }, /Source Hebrew is not an exact contiguous quote/);
    rejectsProof(proof => { proof.hebrew[1] = 'מסקנת המקור כעת הפוכה לגמרי.'; }, /Reviewed source context changed or does not match/);
    rejects(values => { values[0].targetHebrew = 'כי קרב אליך הדבר מאד'; }, /not an exact contiguous quote/);
    rejects(values => { values[0].targetHebrew = 'אליך כי קרוב הדבר'; }, /not an exact contiguous quote/);
    rejects(values => { values[0].targetHebrew = 'קרוב אלי'; }, /not an exact contiguous quote/);
    rejects(values => { values[0].targetHebrew = 'לעשותו דרך אחרת'; }, /not an exact contiguous quote/);
    rejects(values => { values[0].targetRef = 'Fixture Tzadok 1'; }, /not an exact contiguous quote/);
    rejects(values => { values[0].targetRef = 'Fixture Tzadok 1:10'; }, /not an exact contiguous quote/);
    rejects(values => { values[0].school = 'Ishbitz–Radzin'; }, /School disagrees/);
    rejects(values => { values[0].focusTerms = []; }, /Context focus terms/);
    rejects(values => { values[0].focusTerms = ['!']; }, /empty or punctuation/);
    rejects(values => { values[0].sourceRefs = ['Berakhot 6b']; }, /segment-level/);
    rejects(values => { values[0].sourceRefs.push('Deuteronomy 30:14'); }, /duplicates/);
    rejects(values => { values[0].sourceUrl = 'https://www.sefaria.org/Deuteronomy.30.15'; }, /exact reviewed source reference/);
    rejects(values => { values[0].sourceUrl = 'javascript:alert(1)'; }, /HTTPS/);
    rejects(values => { values[0].translationProvenance = ''; }, /Translation provenance/);
    rejects(values => { delete values[0].reviewedTargetHebrewSha256; }, /Reviewed target Hebrew SHA-256/);
    rejects(values => { values[0].reviewedTargetHebrewSha256 = '0'.repeat(64); }, /context changed or does not match/);
    rejects(values => { values[0].explanation = 'Also draws on Deuteronomy 30:14.'; }, /shared source or word alone/);
    rejects(values => { values.push(structuredClone(values[0])); }, /Duplicate connection id/);
    rejects(values => { values.push({...structuredClone(values[0]), id: 'different-id'}); }, /Duplicate source-to-target/);
    rejects(values => { values[0].originRefs = ['Fixture Tzadok 9:9']; }, /not an exact canonical paragraph/);
    rejects(values => { values[0].originRefs = [record.targetRef]; }, /cannot explain its own origin/);
    const empty = [];
    rejects(() => {}, /cannot be empty/, empty);
    stage([record]);
    check(() => {
      const changed = structuredClone(document);
      changed.paras[0].p[1][0] = 'מסקנת הדברים הפוכה לגמרי.';
      writeJSON(path.join(mcpRoot, 'text/fixture-tzadok.json'), changed);
      assert.throws(() => buildReviewedConnections(options), /context changed or does not match/, 'An unchanged excerpt cannot reapprove a changed surrounding argument');
      writeJSON(path.join(mcpRoot, 'text/fixture-tzadok.json'), document);
    });
    check(() => assert.throws(() => buildReviewedConnections({...options, output: editorialFile}), /must not overwrite/));
    check(() => assert.equal(engine.sourceRefFromUrl('https://www.sefaria.org/Deuteronomy.30.14?lang=bi'), 'Deuteronomy 30:14'));
    check(() => assert.equal(engine.sourceRefFromUrl('https://sefaria.org/Mishnah_Pesachim.9.5'), 'Mishnah Pesachim 9:5'));
    check(() => assert.equal(engine.sourceRefFromUrl('https://www.sefaria.org/Exodus_12.11?lang=bi&with=all'), 'Exodus 12:11'));
    check(() => assert.equal(engine.sourceRefFromUrl('https://www.sefaria.org/Pesachim_96a.24'), 'Pesachim 96a:24'));
    check(() => assert.equal(engine.sourceRefFromUrl('https://www.sefaria.org/Zohar_1.2a.1-3a.2'), 'Zohar 1:2a:1-3a:2'));
    check(() => assert.equal(engine.sourceRefFromUrl('https://www.sefaria.org/Mishnah_Pesachim_9.5'), 'Mishnah Pesachim 9:5'));
    check(() => assert.equal(engine.sourceRefFromUrl('#/read/Deuteronomy_30:14?heading=Nearness'), 'Deuteronomy 30:14'));
    check(() => assert.equal(engine.sourceRefFromUrl('https://www.sefaria.org/sheets/123'), null));
    check(() => assert.equal(engine.sourceRefFromUrl('https://www.sefaria.org/api/texts/Exodus.12.11'), null));
    check(() => assert.equal(engine.sourceRefFromUrl('https://example.org/Exodus.12.11'), null));
    const quoteUrl = 'https://www.sefaria.org/Berakhot.6b.34';
    const quoteEnglish = 'The words of a person who has fear of Heaven are heeded.';
    const quotationParagraph = text => ({text, rich: [{text:'Berakhot 6b:34',href:quoteUrl},
      {text:text.slice('Berakhot 6b:34'.length)}]});
    const quoteNote = {verificationStatus:'verified',
      sources:[{ref:'Berakhot 6b:34',url:quoteUrl,role:'primary-source'}],
      paragraphs:[quotationParagraph(`Berakhot 6b:34: “${quoteEnglish}”`)],
      provenance:{sourceQuotationRelease:{versionTitle:'Published fixture translation',license:'Fixture license'}}};
    check(() => assert.deepEqual(engine.sourceQuotationFromNote(quoteNote),
      {ref:'Berakhot 6b:34',sourceUrl:quoteUrl,en:quoteEnglish,
        provenance:'Published fixture translation · Fixture license'}));
    check(() => assert.equal(engine.sourceQuotationFromNote(quoteNote,
      {ref:'berakhot_6b.34',sourceUrl:quoteUrl})?.en, quoteEnglish));
    check(() => assert.equal(engine.sourceQuotationFromNote(quoteNote,{ref:'Berakhot 6b'}), null,
      'An exact excerpt must not silently become a whole-daf translation'));
    check(() => assert.equal(engine.sourceQuotationFromNote(quoteNote,{ref:'Berakhot 6b:35'}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote(quoteNote,{sourceUrl:'https://www.sefaria.org/Berakhot.6b.35'}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,verificationStatus:'unverified'}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,verificationStatus:'source text checked'}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,sources:[{...quoteNote.sources[0],role:'secondary-source'}]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,sources:[quoteNote.sources[0],
      {ref:'Berakhot 6b:35',url:'https://www.sefaria.org/Berakhot.6b.35',role:'primary-source'}]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[...quoteNote.paragraphs,quotationParagraph('Berakhot 6b:34: “Another quotation.”')]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph('Berakhot 6b:34: The author means that the listener benefits.')] }), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph(`Berakhot 6b:34: “${quoteEnglish}” This is our explanation.`)]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph('Berakhot 6b:34: “A first quotation.” Our explanation. “A second quotation.”')]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph('Berakhot 6b:34: ‘A first quotation.’ Our explanation. ‘A second quotation.’')]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph('Berakhot 6b:34: "A first quotation." Our explanation. "A second quotation."')]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph('Berakhot 6b:34: “The verse says, “Fear God,” and the teaching follows.”')]} )?.en,
      'The verse says, “Fear God,” and the teaching follows.'));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph(`Berakhot 6b:34: '${quoteEnglish}'`)]}), null,
      'Apostrophes are not one of the established quotation delimiters'));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph(`Berakhot 6b:34: ‘${quoteEnglish}’`)]})?.en, quoteEnglish));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph('Berakhot 6b:34: ‘A person’s words are heeded.’')]})?.en,
      'A person’s words are heeded.'));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph(`Berakhot 6b:34: "${quoteEnglish}"`)]})?.en, quoteEnglish));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[{text:quoteNote.paragraphs[0].text,rich:[{text:'Berakhot 6b:34',href:'https://www.sefaria.org/Berakhot.6b.35'}]}]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,provenance:{}})?.provenance,
      'English source quotation from the published footnote'));
    check(() => assert.equal(engine.sourceQuotationFromNote({...quoteNote,
      paragraphs:[quotationParagraph('Berakhot 6b:34: “דברים אלה נשמעים.”')]}), null));
    check(() => assert.equal(engine.sourceQuotationFromNote(null), null));
    check(() => assert.equal(engine.refsOverlap('Berakhot 6b:3', 'Berakhot 6b:30'), false));
    check(() => assert.equal(engine.refsOverlap('Berakhot 6b:3-8', 'Berakhot 6b:7'), true));
    check(() => assert.equal(engine.refsOverlap('Berakhot 6b:3-8', 'Berakhot 6b:9'), false));
    check(() => assert.equal(engine.refsOverlap('Berakhot 6b:3-7a:2', 'Berakhot 7a:3'), false));
    check(() => assert.equal(engine.refsOverlap('Berakhot 6b:3', 'Berakhot 6a:3'), false));
    check(() => assert.equal(engine.refsOverlap('Zohar 1:2a:1', 'Zohar 1:3:1'), false));
    check(() => assert.equal(engine.refsOverlap('Berakhot 6b:6', 'Berakhot 6b:3b'), false));
    check(() => assert.equal(engine.parseRef('Pesachim 96a:1-'), null));
    check(() => assert.equal(engine.parseRef('Deuteronomy 30:14-'), null));
    check(() => assert.equal(engine.refsOverlap('Zohar 1:2a:1-3a:2', 'Zohar 1:2b:99'), true));
    check(() => assert.equal(engine.refsOverlap('Zohar 1:2a:1-3a:2', 'Zohar 1:3a:3'), false));
    check(() => assert.equal(engine.refsOverlap('Zohar 1:2a:1-3a:2', 'Zohar 2:2b:1'), false));
    check(() => assert.equal(engine.refsOverlap('Genesis 1:1–3', 'Genesis 1:2'), true));
    check(() => assert.equal(engine.pickConnections([record], 'deuteronomy 30:14').length, 1));
    check(() => assert.equal(engine.pickConnections([record], 'Deuteronomy 30:15').length, 0));
    check(() => assert.equal(engine.pickConnections([record], 'Deuteronomy 30:14', {originRef: 'Fixture Tzadok 1:10', en: 'A separate argument about charity.'}).length, 0));
    check(() => assert.equal(engine.pickConnections([record], 'Deuteronomy 30:14', {originRef: 'Fixture Tzadok 1:10', en: 'The nearness of the command makes practice possible.'}).length, 1));
    check(() => assert.equal(engine.pickConnections([record], 'Deuteronomy 30:14', {originRef: record.targetRef, en: 'nearness'}).length, 0));
    const sin = {...record, focusTerms: ['sin']};
    check(() => assert.equal(engine.pickConnections([sin], 'Deuteronomy 30:14', {originRef: 'Fixture Tzadok 1:10', en: 'A single blessing.'}).length, 0));
    check(() => assert.equal(engine.pickConnections([{...record, reviewed: false}], 'Deuteronomy 30:14').length, 0));
    return checked;
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}

async function main() {
  const options = {};
  let publicUrl = null, fixturesOnly = false, afterMeiVolumeII = false, afterMeiLikutei = false, afterTzidkatSourceAccuracy = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--fixtures-only') { fixturesOnly = true; continue; }
    if (flag === '--after-mei-volume-ii') { afterMeiVolumeII = true; continue; }
    if (flag === '--after-mei-likutei') { afterMeiLikutei = true; continue; }
    if (flag === '--after-tzidkat-source-accuracy') { afterTzidkatSourceAccuracy = true; continue; }
    assert(args[index + 1] && !args[index + 1].startsWith('--'), 'Incomplete option: ' + flag);
    if (flag === '--url') { publicUrl = args[++index]; continue; }
    const key = {'--editorial-dir': 'editorialDir', '--mcp-root': 'mcpRoot', '--catalog': 'output'}[flag];
    assert(key, 'Unknown option: ' + flag);
    options[key] = args[++index];
  }
  const fixtures = runFixtures();
  if (fixturesOnly) { console.log(JSON.stringify({ok: true, fixtures})); return; }
  const filename = path.resolve(options.output || path.join(REPO, 'dist/library/source-connections/catalog.json'));
  const bytes = fs.readFileSync(filename);
  const published = JSON.parse(bytes);
  let successor = null;
  if (afterMeiVolumeII || afterMeiLikutei || afterTzidkatSourceAccuracy) {
    assert.equal(Object.keys(options).length,0,'Scoped successor verification requires the published default catalog');
    successor = afterMeiLikutei || afterTzidkatSourceAccuracy ? verifyReviewedConnectionsPreserved({directory:path.join(REPO,'dist'),afterTzidkatSourceAccuracy}) : verifySourceConnectionsPreserved({directory:path.join(REPO,'dist')});
  } else {
    const checked = buildReviewedConnections({...options, date: published.date, write: false});
    assert.deepEqual(published, checked.catalog, 'Published catalog differs from reviewed inputs or the exact final canonical text');
  }
  for (const record of published.records) {
    assert(engine.validRecord(record), 'A validated record cannot be read by the deployed matching engine: ' + record.id);
    for (const source of record.sourceRefs) assert(engine.pickConnections([record], source).length === 1,
      'The exact reviewed source does not retrieve its connection: ' + record.id);
  }
  const result = {ok: true, fixtures, version: published.version, counts: published.counts,
    catalogSha256: sha(bytes), canonicalTargetQuotesVerified: published.records.length,
    primarySourceQuotesVerified: published.records.length,
    ...(successor?{[afterTzidkatSourceAccuracy?'tzidkatSourceAccuracySuccessor':afterMeiLikutei?'meiLikuteiSuccessor':'meiVolumeIISuccessor']:successor}:{})};
  if (publicUrl) {
    const base = new URL(publicUrl.endsWith('/') ? publicUrl : publicUrl + '/');
    assert(base.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(base.hostname), 'Public verification requires HTTPS');
    const files = ['source-connections/catalog.json', 'source-connections.js'];
    for (const name of files) {
      const url = new URL(name, base);
      url.searchParams.set('verify', published.version);
      const response = await fetch(url, {headers: {'Cache-Control': 'no-cache'}, signal: AbortSignal.timeout(30000)});
      assert(response.ok, 'Published reviewed-connection file is unavailable: ' + name + ' HTTP ' + response.status);
      const live = Buffer.from(await response.arrayBuffer());
      const local = name.endsWith('/catalog.json') ? bytes : fs.readFileSync(path.join(REPO, 'dist/library/source-connections.js'));
      assert.equal(sha(live), sha(local), 'Published file does not match this reviewed release: ' + name);
    }
    result.publicFilesVerified = files;
  }
  console.log(JSON.stringify(result));
}

try { await main(); }
catch (error) { console.error('Reviewed source connections verification failed: ' + error.message); process.exitCode = 1; }


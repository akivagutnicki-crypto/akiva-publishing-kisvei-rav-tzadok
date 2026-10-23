#!/usr/bin/env node
// Exact conceptual anchors, editorial context pins, and explicit reciprocal
// review. These synthetic fixtures never enter the published text catalog.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildConnectedIdeas} from './build-connected-ideas.mjs';
import {verifyConnectedIdeasSuccessor} from './publish-mei-volume-ii.mjs';
import {verifyReviewedConnectionsPreserved} from './publish-mei-likutei.mjs';

const require = createRequire(import.meta.url);
const ideas = require('../dist/library/connected-ideas.js');
const sources = require('../dist/library/source-connections.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const normalized = sources.normalizedHebrew;
const content = paragraph => Array.isArray(paragraph.p) ? paragraph.p.map(pair => pair[0] || '').join(' ') : paragraph.t || '';
const writeJSON = (filename, value) => {
  fs.mkdirSync(path.dirname(filename), {recursive:true});
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n');
};

export function runFixtures() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'akiva-connected-ideas-'));
  const mcpRoot = path.join(temporary, 'mcp');
  const editorialDir = path.join(temporary, 'editorial');
  const output = path.join(temporary, 'reader', 'connected-ideas', 'catalog.json');
  const editorialFile = path.join(editorialDir, 'fixture.json');
  const catalog = {version:'synthetic-connection-fixtures', books:[
    {slug:'fixture-ishbitz', title:'Fixture Ishbitz', group:'Izhbitz', sections:[
      {ref:'Fixture Ishbitz 1', il:false, first:0, count:1},
      {ref:'Fixture Ishbitz 1', il:true, first:1, count:2},
      {ref:'Fixture Ishbitz 2', il:true, first:3, count:1}
    ]},
    {slug:'fixture-tzadok', title:'Fixture Tzadok', group:"R' Tzadok HaKohen", sections:[
      {ref:'Fixture Tzadok 2', il:true, first:0, count:2},
      {ref:'Fixture Tzadok 3', il:true, first:2, count:1}
    ]}
  ]};
  const documents = {
    'fixture-ishbitz':{slug:'fixture-ishbitz', paras:[
      {r:'Fixture Ishbitz 1:1', s:0, n:1, t:'לשון ישנה מיוחדת שאינה מהדורת הקורא.'},
      {r:'Fixture Ishbitz 1:1', s:1, n:1, p:[
        ['פתח הדברים', 'The opening of the discussion.'], ['', ''], ['— :', ''],
        ['מֵאִיר אוֹר חדש', 'A new light shines'],
        ['על הלב ומביאו למעשה.', 'upon the heart and brings it into action.']
      ]},
      {r:'Fixture Ishbitz 1:2', s:1, n:2, p:[['והמסקנה מחברת את הידיעה עם המעשה.', 'The conclusion joins understanding with action.']]},
      {r:'Fixture Ishbitz 2:1', s:2, n:1, p:[['ענין אחר המדבר בגבולות הזמן.', 'A separate discussion of the limits of time.']]}
    ]},
    'fixture-tzadok':{slug:'fixture-tzadok', paras:[
      {r:'Fixture Tzadok 2:1', s:0, n:1, p:[
        ['תחילת הביאור', 'The beginning of the explanation.'],
        ['הידיעה פותחת דרך חדשה בלב', 'Understanding opens a new path in the heart'],
        ['וממנה באה עשיית הטוב.', 'and from it comes the practice of goodness.']
      ]},
      {r:'Fixture Tzadok 2:2', s:0, n:2, p:[['סוף הביאור מלמד כי צריך לקיים את הדבר.', 'The conclusion teaches that the matter must be carried out.']]},
      {r:'Fixture Tzadok 3:1', s:1, n:1, p:[['מאיר אור חדש אבל זהו ענין אחר.', 'A new light shines, but this is a different discussion.']]}
    ]}
  };
  const pinParagraph = paragraph => sha(normalized(content(paragraph)));
  const pinSection = (slug, index, docs = documents, cat = catalog) => {
    const section = cat.books.find(book => book.slug === slug).sections[index];
    return sha(normalized(docs[slug].paras.slice(section.first, section.first + section.count).map(content).join(' ')));
  };
  const record = {
    id:'fixture-light-to-action', themeTitle:'Understanding becomes action',
    themeSummary:'The opening discussion follows the movement from a new understanding to practical action.',
    originRef:'Fixture Ishbitz 1:1', originHebrew:'מאיר אור חדש', originEnglish:'A new light shines.',
    targetRef:'Fixture Tzadok 2:1', targetHebrew:'הידיעה פותחת דרך חדשה בלב',
    targetEnglish:'Understanding opens a new path in the heart.', school:'Kisvei Rav Tzadok',
    explanation:'The target describes understanding as the opening of a path in the heart, which explains how the origin moves from illumination to action.',
    translationProvenance:'Synthetic fixture translations; these are not editorial corpus records.',
    reviewed:true,
    reviewedOriginHebrewSha256:pinParagraph(documents['fixture-ishbitz'].paras[1]),
    reviewedOriginSectionHebrewSha256:pinSection('fixture-ishbitz', 1),
    reviewedTargetHebrewSha256:pinParagraph(documents['fixture-tzadok'].paras[0])
  };
  const reciprocal = {...record,
    reverseExplanation:'The origin shows how the new understanding reaches practice, illuminating the target\'s transition from a path in the heart to goodness.',
    reverseThemeTitle:'A path that reaches practice',
    reverseThemeSummary:'This explanation follows understanding through the heart into the practice of goodness.',
    reviewedTargetSectionHebrewSha256:pinSection('fixture-tzadok', 0)
  };
  const options = {mcpRoot, editorialDir, output, date:'2026-10-19'};
  const stage = (records = [record], docs = documents, cat = catalog) => {
    writeJSON(path.join(mcpRoot, 'catalog.json'), cat);
    for (const [slug, data] of Object.entries(docs)) writeJSON(path.join(mcpRoot, 'text', slug + '.json'), data);
    writeJSON(editorialFile, {schemaVersion:1, records});
  };
  let fixtures = 0;
  const check = work => { work(); fixtures++; };
  const reject = (mutate, pattern, initial = [record]) => check(() => {
    const records = structuredClone(initial), docs = structuredClone(documents), cat = structuredClone(catalog);
    mutate(records, docs, cat);
    stage(records, docs, cat);
    const before = fs.existsSync(output) ? sha(fs.readFileSync(output)) : null;
    assert.throws(() => buildConnectedIdeas(options), pattern);
    assert.equal(fs.existsSync(output) ? sha(fs.readFileSync(output)) : null, before,
      'Rejected editorial input must leave the previous published catalog intact');
  });
  const build = (records = [record], docs = documents, cat = catalog) => {
    stage(records, docs, cat);
    return buildConnectedIdeas(options).catalog;
  };
  try {
    const first = build(), forward = first.records[0];
    const inputHashes = Object.fromEntries(Object.keys(documents).map(slug => [slug,
      sha(fs.readFileSync(path.join(mcpRoot, 'text', slug + '.json')))]));
    check(() => assert.equal(first.counts.records, 1));
    check(() => assert.equal(first.counts.sectionsWithReviewedIdeas, 1));
    check(() => assert.equal(first.counts.worksWithReviewedIdeas, 1));
    check(() => assert.equal(first.coverage.find(book => book.book === 'Fixture Ishbitz').sections, 2,
      'Duplicate editions do not manufacture additional sections'));
    check(() => assert.equal(first.coverage.find(book => book.book === 'Fixture Tzadok').sectionsWithReviewedIdeas, 0,
      'A forward target is not automatically a reviewed origin'));
    check(() => assert.deepEqual([forward.placement.originPhraseIndex, forward.placement.originPhraseEnd], [3, 3],
      'Empty and punctuation-only phrases retain their original DOM indexes without advancing normalized text'));
    check(() => assert.deepEqual([forward.placement.targetPhraseIndex, forward.placement.targetPhraseEnd], [1, 1]));
    check(() => assert.equal(forward.evidence.origin.edition, 'interlinear'));
    check(() => assert.equal(forward.evidence.origin.ref, record.originRef));
    check(() => assert.equal(forward.evidence.target.ref, record.targetRef));
    check(() => assert.equal(forward.evidence.origin.fullHebrewSha256, record.reviewedOriginHebrewSha256));
    check(() => assert.equal(forward.evidence.origin.sectionHebrewSha256, record.reviewedOriginSectionHebrewSha256));
    check(() => assert.equal(forward.evidence.targetEnglishSha256, sha(record.targetEnglish)));
    check(() => assert.equal(forward.evidence.reverseRelation, 'not-approved'));
    check(() => assert.equal(first.version, buildConnectedIdeas({...options, write:false}).catalog.version,
      'Identical inputs produce the same evidence and version'));
    const current={ref:record.originRef,sectionRef:'Fixture Ishbitz 1',
      paragraphHebrewSha256:record.reviewedOriginHebrewSha256,sectionHebrewSha256:record.reviewedOriginSectionHebrewSha256};
    check(() => assert(ideas.matchesContext(ideas.forPassage(first.records,record.originRef)[0],current)));
    check(() => assert.equal(ideas.matchesContext(forward,{...current,sectionHebrewSha256:'0'.repeat(64)}),false,
      'An unchanged quotation cannot rescue a changed current section'));
    check(() => assert.equal(ideas.matchesContext(forward,{...current,paragraphHebrewSha256:'0'.repeat(64)}),false));
    check(() => assert.equal(ideas.matchesContext(forward,{...current,ref:'Fixture Ishbitz 1:2'}),false));
    check(() => assert.equal(ideas.forPassage(first.records,record.originRef,{phraseIndex:2,phraseEnd:4}).length,1,
      'A followed source excerpt includes only threads intersecting its exact phrase span'));
    check(() => assert.equal(ideas.forPassage(first.records,record.originRef,{phraseIndex:0,phraseEnd:2}).length,0));
    check(() => assert.equal(ideas.authorText('ב<a data-ref="Midrash 1">תנחומא</a> נאמר'),'בתנחומא נאמר',
      'Inline citation markup cannot split an authorial word'));
    check(() => assert.equal(ideas.authorText('לפני<sup class="footnote-marker">1</sup><i class="footnote">הערה <i>פנימית</i> נוספת</i> אחרי'),'לפני אחרי',
      'Nested note text is excluded exactly as in the canonical MCP projection'));
    check(() => assert.equal(ideas.authorText('א&nbsp;&thinsp;ב<br>ג'),'א ב\nג'));
    check(() => assert(ideas.anchorMatches({originHebrew:'בתנחומא נאמר'},'ב<a>תנחומא</a> נאמר')));
    check(() => assert.equal(ideas.anchorMatches({originHebrew:'דברים אחרים'},'לפני<sup class="footnote-marker">1</sup><i class="footnote">דברים אחרים</i> אחרי'),false,
      'A note cannot impersonate a quotation from the author’s paragraph'));
    check(() => {
      const extended = {...record, originHebrew:'מאיר אור חדש על הלב', originEnglish:'A new light shines upon the heart.'};
      const built = build([extended]);
      assert.deepEqual([built.records[0].placement.originPhraseIndex, built.records[0].placement.originPhraseEnd], [3, 4]);
      assert.equal(ideas.forPassage(built.records, record.originRef, {phraseIndex:4}).length, 1);
      assert.equal(ideas.forPassage(built.records, record.originRef, {phraseIndex:2}).length, 0);
    });
    check(() => {
      const brief = {...record, originHebrew:'פתח הדברים', originEnglish:'The opening.'};
      assert.equal(build([brief]).records[0].placement.originPhraseIndex, 0,
        'Complete brief quotations do not need an artificial English word minimum');
    });
    check(() => {
      const last = {...record, originHebrew:'על הלב ומביאו למעשה.', originEnglish:'Upon the heart and brings it into action.'};
      assert.equal(build([last]).records[0].placement.originPhraseEnd, 4);
    });
    check(() => {
      const docs = structuredClone(documents), changed = {...record};
      docs['fixture-tzadok'].paras[0] = {r:record.targetRef, s:0, n:1, t:content(docs['fixture-tzadok'].paras[0])};
      changed.reviewedTargetHebrewSha256 = pinParagraph(docs['fixture-tzadok'].paras[0]);
      const result = build([changed], docs).records[0];
      assert.deepEqual([result.placement.targetPhraseIndex, result.placement.targetPhraseEnd], [0, 0],
        'A Hebrew-only paragraph can be a precise reviewed target');
    });

    reject(values => { values[0].reviewed = false; }, /Unreviewed/);
    reject(values => { values[0].originHebrew = 'מאיר חדש'; }, /not contiguous/);
    reject(values => { values[0].originHebrew = 'מאיר אור חדש והמסקנה'; }, /not contiguous/);
    reject(values => { values[0].targetHebrew = 'הידעה פותחת דרך חדשה בלב'; }, /not contiguous/,
      [record]);
    reject(values => { values[0].targetRef = 'Fixture Tzadok 2:2'; }, /not contiguous/);
    reject(values => { values[0].targetRef = 'Fixture Tzadok 2'; }, /not an exact paragraph/);
    reject(values => { values[0].originRef = 'Fixture Ishbitz 1:1-2'; }, /not an exact paragraph/);
    reject(values => { values[0].originRef = 'Fixture Ishbitz_1.1'; }, /exact canonical reference/);
    reject(values => { values[0].targetRef = 'Unpublished Work 1:1'; }, /Unknown canonical work/);
    reject(values => { values[0].originRef = values[0].targetRef; }, /own parallel/);
    reject(values => { delete values[0].reviewedOriginHebrewSha256; }, /Reviewed paragraph/);
    reject(values => { delete values[0].reviewedTargetHebrewSha256; }, /Reviewed paragraph/);
    reject(values => { delete values[0].reviewedOriginSectionHebrewSha256; }, /full originating section/);
    reject(values => { values[0].reviewedOriginHebrewSha256 = '0'.repeat(64); }, /Reviewed paragraph/);
    reject(values => { values[0].reviewedOriginSectionHebrewSha256 = '0'.repeat(64); }, /Reviewed section/);
    reject(values => { values[0].school = 'Ishbitz–Radzin'; }, /Wrong school/);
    reject(values => { values[0].originEnglish = 'Translation pending'; }, /placeholder/);
    reject(values => { values[0].targetEnglish = 'English translation:'; }, /only a label/);
    reject(values => { values[0].targetEnglish = values[0].targetRef; }, /only a citation/);
    reject(values => { values[0].originEnglish = 'Context: a discussion of illumination.'; }, /editorial commentary/);
    reject(values => { values[0].explanation = 'Both passages mention light.'; }, /Shared terminology/);
    reject(values => { values[0].translationProvenance = ''; }, /translationProvenance is missing/);
    reject(values => { values.push(structuredClone(values[0])); }, /repeated ID/);
    reject(values => { values.push({...values[0], id:'fixture-another-id'}); }, /Repeated origin-to-target/);
    reject((values, docs) => { docs['fixture-ishbitz'].paras[2].p[0][0] = 'המסקנה כעת מבטלת לגמרי את הצורך במעשה.'; }, /Reviewed section/);
    reject((values, docs) => { docs['fixture-tzadok'].paras[0].p[2][0] = 'אבל אין מזה שום דרך למעשה.'; }, /Reviewed paragraph/);
    reject((values, docs) => {
      // The obsolete Hebrew-only paragraph contains the old quote and pin;
      // the currently displayed interlinear edition no longer does.
      docs['fixture-ishbitz'].paras[0].t = content(docs['fixture-ishbitz'].paras[1]);
      docs['fixture-ishbitz'].paras[1].p[3][0] = 'לשון אחרת במהדורה הנוכחית';
    }, /not contiguous/);
    reject((values, docs) => {
      docs['fixture-ishbitz'].paras[1].p.push(['מאיר אור חדש', 'A new light shines.']);
      values[0].reviewedOriginHebrewSha256 = pinParagraph(docs['fixture-ishbitz'].paras[1]);
      values[0].reviewedOriginSectionHebrewSha256 = pinSection('fixture-ishbitz', 1, docs);
    }, /more than one possible anchor/);
    reject(values => { values[0].reverseExplanation = 'The origin explains the target transition.'; }, /reverseThemeTitle is missing/);
    reject(values => { values[0].reverseThemeTitle = 'An unapproved reverse title'; }, /Incomplete reciprocal review/);
    reject(values => { values[0].reviewedTargetSectionHebrewSha256 = pinSection('fixture-tzadok', 0); }, /Incomplete reciprocal review/);
    reject(values => { delete values[0].reverseThemeSummary; }, /reverseThemeSummary is missing/, [reciprocal]);
    reject(values => { delete values[0].reviewedTargetSectionHebrewSha256; }, /full target-section review/, [reciprocal]);
    reject((values, docs) => { docs['fixture-tzadok'].paras[1].p[0][0] = 'סוף הביאור כעת שולל את הצורך בקיום.'; }, /Reviewed section/, [reciprocal]);
    check(() => {
      const docs = structuredClone(documents);
      docs['fixture-tzadok'].paras[1].p[0][0] = 'מסקנת סעיף אחר מתנסחת באופן אחר.';
      assert.equal(build([record], docs).records.length, 1,
        'Forward review pins the target paragraph; full target-section review is required only for a reciprocal outline');
    });
    check(() => {
      const built = build([reciprocal]);
      assert.equal(built.counts.sectionsWithReviewedIdeas, 2);
      assert.equal(built.counts.worksWithReviewedIdeas, 2);
      const back = ideas.forPassage(built.records, record.targetRef);
      check(() => assert(ideas.matchesContext(back[0],{ref:record.targetRef,sectionRef:'Fixture Tzadok 2',
        paragraphHebrewSha256:record.reviewedTargetHebrewSha256,sectionHebrewSha256:pinSection('fixture-tzadok',0)}),
        'Reciprocal runtime verification uses the receiving paragraph and section pins'));
      assert.equal(back.length, 1);
      assert.equal(back[0].direction, 'reverse');
      assert.equal(back[0].originRef, record.targetRef);
      assert.equal(back[0].targetRef, record.originRef);
      assert.equal(back[0].originHebrew, record.targetHebrew);
      assert.equal(back[0].targetEnglish, record.originEnglish);
      assert.equal(back[0].school, 'Ishbitz–Radzin');
      assert.equal(back[0].themeTitle, reciprocal.reverseThemeTitle);
      assert.equal(back[0].themeSummary, reciprocal.reverseThemeSummary);
      assert.equal(back[0].explanation, reciprocal.reverseExplanation);
      assert.equal(ideas.groups(back)[0].summary, reciprocal.reverseThemeSummary,
        'A target section outline must use its own reviewed summary');
    });

    const runtime = build().records;
    check(() => assert.equal(ideas.forPassage(runtime, record.originRef).length, 1));
    check(() => assert.equal(ideas.forPassage(runtime, 'fixture ishbitz_1.1').length, 1));
    check(() => assert.equal(ideas.forPassage(runtime, record.targetRef).length, 0, 'No implicit reverse relation'));
    check(() => assert.equal(ideas.forPassage(runtime, 'Fixture Ishbitz 1:2', {he:record.originHebrew}).length, 0,
      'Shared words in a different paragraph do not match'));
    check(() => assert.equal(ideas.forPassage(runtime, 'Fixture Ishbitz 1:1-2').length, 0,
      'A containing range cannot become an exact origin paragraph'));
    check(() => assert.equal(ideas.forSection(runtime, 'Fixture Ishbitz 1').length, 1));
    check(() => assert.equal(ideas.forSection(runtime, 'Fixture Ishbitz 2').length, 0));
    check(() => assert.equal(ideas.forSection(runtime, 'Fixture Ishbitz 1-2').length, 0));
    check(() => assert.equal(ideas.forPassage(runtime, record.originRef, {phraseIndex:3}).length, 1));
    check(() => assert.equal(ideas.forPassage(runtime, record.originRef, {phraseIndex:-1}).length, 1,
      'The whole-paragraph sidebar sentinel does not filter away reviewed ideas'));
    check(() => assert.equal(ideas.forPassage(runtime, record.originRef, {phraseIndex:1}).length, 0,
      'An empty phrase does not inherit the following phrase\'s connection'));
    check(() => assert.equal(ideas.forPassage(runtime, record.originRef, {phraseIndex:4}).length, 0));
    check(() => assert.equal(ideas.anchorMatches(runtime[0], '<b>מֵאִיר אוֹר חדש</b> על הלב'), true));
    check(() => assert.equal(ideas.anchorMatches(runtime[0], 'מאיר דבר אחר אור חדש'), false));
    check(() => assert.equal(ideas.anchorMatches(runtime[0], 'במאיר אור חדש'), false, 'Partial Hebrew words do not count'));
    check(() => assert.equal(ideas.anchorMatches(runtime[0], 'מאיר אור חדשות'), false));
    check(() => assert.equal(ideas.forPassage([{...runtime[0], reviewed:false}], record.originRef).length, 0));
    check(() => assert.equal(ideas.forPassage([{...runtime[0], reverseExplanation:'A reverse relation.'}], record.originRef).length, 0,
      'Incomplete reciprocal metadata fails closed at runtime'));
    check(() => assert.equal(ideas.forPassage([{...runtime[0], reverseThemeTitle:'A title without reciprocal review'}], record.originRef).length, 0,
      'A reverse title alone cannot leave a partially reviewed runtime record active'));
    check(() => assert.equal(ideas.forPassage([{...runtime[0], placement:{...runtime[0].placement, originPhraseEnd:2}}], record.originRef).length, 0));
    check(() => assert.equal(ideas.forPassage([runtime[0], structuredClone(runtime[0])], record.originRef).length, 1));
    check(() => {
      stage();
      assert.throws(() => buildConnectedIdeas({...options, output:editorialFile}), /cannot overwrite/);
      assert.throws(() => buildConnectedIdeas({...options, output:path.join(mcpRoot, 'text', 'fixture-tzadok.json')}), /cannot overwrite/);
    });
    check(() => {
      stage(); buildConnectedIdeas({...options, write:false});
      for (const [slug, before] of Object.entries(inputHashes))
        assert.equal(sha(fs.readFileSync(path.join(mcpRoot, 'text', slug + '.json'))), before,
          'Study metadata must not rewrite canonical paragraphs or footnotes');
    });
    return fixtures;
  } finally { fs.rmSync(temporary, {recursive:true, force:true}); }
}

export function verifyCatalog({afterMeiVolumeII=false,afterMeiLikutei=false}={}) {
  const filename = path.join(REPO, 'dist/library/connected-ideas/catalog.json');
  const bytes = fs.readFileSync(filename);
  const published = JSON.parse(bytes);
  assert.equal(published.schemaVersion, 1);
  assert.equal(published.release, ideas.VERSION);
  const successor = afterMeiLikutei ? verifyReviewedConnectionsPreserved({directory:path.join(REPO,'dist')}) : afterMeiVolumeII ? verifyConnectedIdeasSuccessor({directory:path.join(REPO,'dist')}) : null;
  if (!successor) {
    const rebuilt = buildConnectedIdeas({write:false, date:published.date}).catalog;
    assert.equal(sha(bytes), sha(JSON.stringify(rebuilt, null, 2) + '\n'),
      'Published Connected Ideas catalog must exactly match the final canonical data and editorial review');
  }
  let quoteAnchors = 0, reciprocal = 0;
  for (const record of published.records) {
    assert(ideas.validRecord(record), 'Invalid published record: ' + record.id);
    assert.equal(record.evidence.originEnglishSha256, sha(record.originEnglish));
    assert.equal(record.evidence.targetEnglishSha256, sha(record.targetEnglish));
    assert.equal(record.evidence.origin.fullHebrewSha256, record.reviewedOriginHebrewSha256);
    assert.equal(record.evidence.origin.sectionHebrewSha256, record.reviewedOriginSectionHebrewSha256);
    assert.equal(record.evidence.target.fullHebrewSha256, record.reviewedTargetHebrewSha256);
    assert.equal(ideas.forPassage([record], record.originRef).length, 1);
    assert.equal(ideas.forPassage([record], record.originRef, {phraseIndex:record.placement.originPhraseIndex}).length, 1);
    assert.equal(ideas.forPassage([record], record.originRef, {phraseIndex:record.placement.originPhraseEnd + 1}).length, 0);
    assert.equal(ideas.forPassage([record], record.targetRef).length, record.reverseExplanation ? 1 : 0);
    if (record.reverseExplanation) {
      reciprocal++;
      assert.equal(record.evidence.target.sectionHebrewSha256, record.reviewedTargetSectionHebrewSha256);
      assert.equal(ideas.forSection([record], record.placement.targetSectionRef)[0].themeSummary, record.reverseThemeSummary);
    }
    quoteAnchors += 2;
  }
  assert.equal(published.counts.records, published.records.length);
  assert.equal(published.counts.sectionsWithReviewedIdeas,
    published.coverage.reduce((sum, work) => sum + work.reviewedSections.length, 0));
  return {catalogSha256:sha(bytes), version:published.version, counts:published.counts,
    exactCanonicalAnchorsVerified:quoteAnchors, reciprocalReviewsVerified:reciprocal,
    ...(successor?{[afterMeiLikutei?'meiLikuteiSuccessor':'meiVolumeIISuccessor']:successor}:{})};
}

async function verifyPublic(base) {
  const root = new URL(base.endsWith('/') ? base : base + '/');
  const result = {};
  for (const relative of ['connected-ideas.js','source-editions.js','connected-ideas/catalog.json','connected-ideas/review-progress.json']) {
    const url = new URL(relative, root);
    url.searchParams.set('verify', ideas.VERSION);
    const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(20000), headers:{'Cache-Control':'no-cache'}});
    assert(response.ok, 'Public verification HTTP ' + response.status + ': ' + url);
    const live = Buffer.from(await response.arrayBuffer());
    const local = fs.readFileSync(path.join(REPO, 'dist/library', relative));
    assert.equal(sha(live), sha(local), 'Live Connected Ideas bytes differ: ' + relative);
    result[relative] = {url:String(url), bytes:live.length, sha256:sha(live)};
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let fixturesOnly = false, publicUrl = null, afterMeiVolumeII = false, afterMeiLikutei = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fixtures-only') fixturesOnly = true;
    else if (args[i] === '--after-mei-volume-ii') afterMeiVolumeII = true;
    else if (args[i] === '--after-mei-likutei') afterMeiLikutei = true;
    else if (args[i] === '--url') { publicUrl = args[++i]; assert(publicUrl, '--url requires a library base URL'); }
    else throw new Error('Unknown argument: ' + args[i]);
  }
  const report = {ok:true, fixtures:runFixtures(), release:ideas.VERSION};
  if (!fixturesOnly) Object.assign(report, verifyCatalog({afterMeiVolumeII,afterMeiLikutei}));
  if (publicUrl) report.public = await verifyPublic(publicUrl);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

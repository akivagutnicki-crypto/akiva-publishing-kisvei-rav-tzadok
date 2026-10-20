#!/usr/bin/env node
// Release contract: a completed batch must cover the reader's actual preferred
// paragraphs, including paragraphs for which no connection was approved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY = path.join(REPO, 'dist/library');
const urlIndex = process.argv.indexOf('--url');
const remote = urlIndex >= 0 ? process.argv[urlIndex + 1] : null;
if (urlIndex >= 0) assert(remote, '--url requires the published library URL');
const base = remote ? new URL(remote.endsWith('/') ? remote : remote + '/') : null;
const local = relative => JSON.parse(fs.readFileSync(path.join(LIBRARY, relative), 'utf8'));
async function read(relative) {
  if (!base) return local(relative);
  const url = new URL(relative, base);
  url.searchParams.set('verify', 'seasonal-review-20261020');
  const response = await fetch(url);
  assert(response.ok, `${relative}: HTTP ${response.status}`);
  return response.json();
}
const [catalog, progress, toc] = await Promise.all([
  read('connected-ideas/catalog.json'),
  read('connected-ideas/review-progress.json'),
  read('data/peri-tzadik/toc.json')
]);
if (base) {
  assert.equal(catalog.contentSha256, local('connected-ideas/catalog.json').contentSha256,
    'The live connection catalog is not the verified release');
  assert.equal(progress.contentSha256, local('connected-ideas/review-progress.json').contentSha256,
    'The live paragraph review inventory is not the verified release');
}
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const leaves = walk(toc.toc).filter(node => node.interlinear && node.id != null);
const book = progress.books.find(entry => entry.book === 'Peri Tzadik');
assert(book, 'The review inventory must include Peri Tzadik');
const numbered = (name, count) => Array.from({length: count}, (_, index) => `Peri Tzadik, ${name} ${index + 1}`);
const areas = [
  {name: 'Chanukah 1–24', refs: numbered('Chanukah', 24), paragraphs: 146, newRelease: true},
  {name: 'Chanukah 25', refs: ['Peri Tzadik, Chanukah 25'], paragraphs: 6, connections: 18, newRelease: true},
  {name: 'Rosh Chodesh Shevat 1–6', refs: numbered('Rosh Chodesh Shvat', 6), paragraphs: 8, connections: 13, newRelease: true},
  {name: 'Tu BiShvat 1–5', refs: numbered('Tu BiShvat', 5), paragraphs: 7, connections: 12, newRelease: true},
  {name: 'Lech Lecha 1–10', refs: numbered('Lech Lecha', 10), paragraphs: 101},
  {name: 'Mar Cheshvan', refs: ['Peri Tzadik, Rosh Chodesh (manuscript)', 'Peri Tzadik, Rosh Chodesh Cheshvan'], paragraphs: 5},
  {name: 'Rosh Chodesh Kislev 1–7', refs: numbered('Rosh Chodesh Kislev', 7), paragraphs: 40}
];
const allRefs = areas.flatMap(area => area.refs);
assert.equal(new Set(allRefs).size, allRefs.length, 'Release scopes must be disjoint');
const sectionRows = new Map(await Promise.all(allRefs.map(async ref => {
  const editions = leaves.filter(leaf => leaf.ref === ref);
  assert.equal(editions.length, 1, `Expected one preferred interlinear edition: ${ref}`);
  const items = await read(`data/peri-tzadik/${editions[0].id}.json`);
  const rows = items.filter(item => Array.isArray(item.p));
  assert(rows.length, `Missing phrase pairs: ${ref}`);
  return [ref, {leaf: editions[0], rows}];
})));
const report = [];
for (const area of areas) {
  let paragraphCount = 0, connectionCount = 0, comparisons = 0, noConnection = 0;
  const details = [];
  for (const ref of area.refs) {
    const matches = book.sections.filter(section => section.ref === ref);
    assert.equal(matches.length, 1, `Review inventory section identity: ${ref}`);
    const section = matches[0], {rows} = sectionRows.get(ref);
    const rowRefs = rows.map((row, index) => ref + ':' + (row.n ?? index + 1));
    assert.equal(section.reviewStatus, 'complete', `Unfinished section: ${ref}`);
    assert.equal(section.counts.pending, 0, `Unreviewed paragraphs: ${ref}`);
    assert.equal(section.counts.reviewed, rows.length, `Review count differs from reader: ${ref}`);
    assert.deepEqual(section.subsections.map(row => row.ref), rowRefs,
      `Reviewed paragraph boundaries differ from the preferred edition: ${ref}`);
    for (const row of section.subsections) {
      assert.notEqual(row.connectionReview, 'pending', `Missing review decision: ${row.ref}`);
      assert(row.review?.assessment && row.review.method && row.review.evidence?.fileSha256,
        `Missing recorded editorial evidence: ${row.ref}`);
      const candidates = row.review.candidatesReviewed;
      assert(candidates?.length, `Missing finite source comparisons: ${row.ref}`);
      assert.deepEqual(new Set(candidates.map(candidate => candidate.school)),
        new Set(['Kisvei Rav Tzadok', 'Ishbitz–Radzin']), `Both schools were not reviewed: ${row.ref}`);
      comparisons += candidates.length;
      const records = catalog.records.filter(record => record.originRef === row.ref);
      assert.equal(records.length, row.approvedConnections.filter(record => record.direction === 'forward').length,
        `Approved connection inventory differs from the catalog: ${row.ref}`);
      for (const record of records) {
        assert.equal(record.reviewedOriginHebrewSha256, row.paragraphHebrewSha256,
          `Stale origin paragraph pin: ${record.id}`);
        assert.equal(record.reviewedOriginSectionHebrewSha256, row.sectionHebrewSha256,
          `Stale complete-section pin: ${record.id}`);
        assert(candidates.some(candidate => candidate.ref === record.targetRef),
          `An approved target lacks a documented source comparison: ${record.id}`);
        if (area.newRelease) {
          assert.doesNotMatch(record.originEnglish + record.targetEnglish, /[\[\]]/,
            `Unfinished English bracket presentation: ${record.id}`);
        }
      }
      connectionCount += records.length;
      if (!records.length) noConnection++;
    }
    paragraphCount += rows.length;
    details.push({ref, paragraphs: rows.length, connections: section.subsections.reduce((n, row) =>
      n + row.approvedConnections.filter(record => record.direction === 'forward').length, 0)});
  }
  assert.equal(paragraphCount, area.paragraphs, `Incomplete or duplicated scope: ${area.name}`);
  if (area.connections != null) assert.equal(connectionCount, area.connections, `Changed approved set: ${area.name}`);
  report.push({name: area.name, sections: area.refs.length, paragraphs: paragraphCount,
    connections: connectionCount, sourceComparisons: comparisons, reviewedWithoutConnection: noConnection, details});
}
assert.equal(sectionRows.get('Peri Tzadik, Chanukah 24').rows.length, 3,
  'The three rows belonging to Chanukah 25 must not return under Chanukah 24');
console.log(JSON.stringify({ok: true, release: '20261020-seasonal-review', live: !!base,
  catalogSha256: catalog.contentSha256, progressSha256: progress.contentSha256, areas: report}, null, 2));

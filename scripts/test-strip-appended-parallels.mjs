#!/usr/bin/env node
// Focused safeguards for a removal script: scope, original text, ownership,
// source associations, dry-run behavior, fail-closed behavior and idempotence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanFootnote, isProtectedPeriSection, runCleanup } from './strip-appended-parallels.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-cleanup-test-'));
let assertions = 0;
const check = (callback) => { callback(); assertions++; };
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const rich = (text) => ({ text, rich: [{ text }] });
function note() {
  return {
    number: 17, sourceId: 'SOURCE-17', placementId: 'SOURCE-17-2', phraseIndex: 1,
    heCharOffset: 19, enCharOffset: 23, heWord: 4,
    heAnchorPrefix: 'טֶקְסְט בְּעִבְרִית', enAnchorPrefix: 'Original phrase',
    paragraphs: [
      rich('Genesis 2:5: Original primary translation. Context and connection: Citation to Dover Tzedek, Peri Tzadik Noach 5, and Cheshvan must not protect this owner.'),
      rich('Kisvei Rav Tzadok Parallel — Dover Tzedek 13: Appended translation.'),
      rich('Kisvei Beis Ishbitz–Radzin Parallel — Beit Yaakov on Torah, Noach 3: Appended translation.'),
      rich('Sources: Genesis 2:5. | Parallels: Dover Tzedek 13; Beit Yaakov on Torah, Noach 3.'),
    ],
    sources: [
      { ref: 'Genesis 2:5', role: 'primary-source', url: 'https://www.sefaria.org/Genesis.2.5' },
      { ref: 'Dover Tzedek 13', role: 'parallel-rav-tzadok' },
      { ref: 'Beit Yaakov on Torah, Noach 3', role: 'parallel-ishbitz-radzin' },
    ],
    parallels: [{ ref: 'Independently curated material 1' }],
    nativeConnections: [{ ref: 'Rashi on Genesis 2:5' }],
    provenance: { edition: 'Original edition + Kisvei Rav Tzadok', section: 'Peri Tzadik, Bereshit 1' },
  };
}
function put(root, name, data) {
  const filename = path.join(root, name);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
  return filename;
}
function item(value = note()) { return { n: 1, p: [['בְּרֵאשִׁית', 'At the beginning'], ['עוֹד טֶקְסְט', 'More text']], footnotes: [value] }; }
function snapshots(root) {
  const map = new Map();
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const filename = path.join(dir, name);
      if (fs.statSync(filename).isDirectory()) walk(filename);
      else map.set(path.relative(root, filename), sha(fs.readFileSync(filename)));
    }
  }
  walk(root); return map;
}

try {
  const original = note();
  const before = structuredClone(original);
  const cleaned = cleanFootnote(original);
  check(() => assert.deepEqual(original, before, 'Pure cleaner mutated caller input'));
  check(() => assert.deepEqual(cleaned.note.paragraphs, [before.paragraphs[0]], 'Primary text/context must survive exactly'));
  check(() => assert.deepEqual(cleaned.note.sources, [before.sources[0]], 'Remove only associated exact-role sources'));
  check(() => assert.deepEqual(cleaned.note.provenance, before.provenance, 'Do not rewrite provenance'));
  check(() => assert.deepEqual(cleaned.note.parallels, before.parallels, 'Generic curated parallels must survive'));
  check(() => assert.equal(cleanFootnote(cleaned.note).change, null, 'Second pass must do nothing'));

  const separateContext = note();
  separateContext.paragraphs.splice(1, 0, rich('Context and connection to this source: every word must remain.'));
  separateContext.paragraphs.push(rich('Other original commentary after the appended paragraphs.'));
  check(() => assert.deepEqual(cleanFootnote(separateContext).note.paragraphs,
    [separateContext.paragraphs[0], separateContext.paragraphs[1], separateContext.paragraphs[5]], 'Do not trim all later text'));

  const curated = note();
  curated.paragraphs = [curated.paragraphs[0], rich('Kisvei Rav Tzadok — Dover Tzedek 13: Independently reviewed parallel.')];
  check(() => assert.equal(cleanFootnote(curated).change, null, 'Noncanonical curated heading is out of scope'));
  const standalone = note();
  standalone.kind = 'parallel';
  standalone.paragraphs = [rich('Kisvei Rav Tzadok Parallel — Dover Tzedek 13: Primary standalone note.'), ...standalone.paragraphs.slice(1)];
  check(() => assert.equal(cleanFootnote(standalone).change, null, 'Standalone parallel footnotes must survive'));

  const roleOnly = note();
  roleOnly.paragraphs = [roleOnly.paragraphs[0], rich('Sources: Genesis 2:5. | Parallels: Dover Tzedek 13.')];
  check(() => assert.equal(cleanFootnote(roleOnly).change, null, 'Summary/role alone is insufficient for removal'));
  const unassociated = note();
  unassociated.sources.push({ ref: 'Dover Tzedek 130', role: 'parallel-rav-tzadok' });
  unassociated.sources.push({ ref: 'Dover Tzedek 13', role: 'independent-commentary' });
  check(() => assert.deepEqual(cleanFootnote(unassociated).note.sources,
    [unassociated.sources[0], unassociated.sources[3], unassociated.sources[4]], 'Do not remove prefix-colliding or unrelated role entries'));

  const representations = note();
  representations.paragraphs[1] = { rich: [{ text: 'Kisvei Rav ' }, { text: 'Tzadok Parallel — Dover Tzedek 13: Text.' }] };
  representations.paragraphs[2] = { rich: '<p><b>Kisvei Beit Ishbitz-Radzin Parallel</b> — Beit Yaakov on Torah, Noach 3: Text.</p>' };
  representations.paragraphs[3] = '<b>Sources:</b> Genesis 2:5. | <b>Parallels:</b> Dover Tzedek 13.';
  check(() => assert.equal(cleanFootnote(representations).note.paragraphs.length, 1, 'Text, rich runs, HTML and Beit variant must work'));
  const ambiguous = note();
  ambiguous.paragraphs[1].rich[0].text = 'Original commentary with no appended heading.';
  check(() => assert.throws(() => cleanFootnote(ambiguous), /Ambiguous/));
  const unknown = note();
  unknown.paragraphs[2].rich = { nodes: [{ text: unknown.paragraphs[2].text }] };
  check(() => assert.throws(() => cleanFootnote(unknown), /Unknown paragraph shape/));
  check(() => assert.throws(() => cleanFootnote({ text: 'Source citation. Kisvei Rav Tzadok Parallel — text' }), /Unknown candidate footnote shape/));

  check(() => assert.equal(isProtectedPeriSection({ file: '111.json' }), true));
  check(() => assert.equal(isProtectedPeriSection({ file: '777.json', refs: ['Peri Tzadik, Noach 5'] }), true));
  check(() => assert.equal(isProtectedPeriSection({ file: '778.json', refs: ['Peri Tzadik, Rosh Chodesh Mar Cheshvan'] }), true));
  check(() => assert.equal(isProtectedPeriSection({ refs: ['פרי צדיק, נח · אות ו׳'] }), true));
  check(() => assert.equal(isProtectedPeriSection({ refs: ['Peri Tzadik, Noach 50'] }), false));
  check(() => assert.equal(isProtectedPeriSection({ refs: ['Peri Tzadik, Bereshit 1 cites Peri Tzadik, Noach 5'] }), false));

  const root = path.join(temporary, 'fixture');
  const leaves = [
    { id: 90, ref: 'Peri Tzadik, Bereshit 1', sep: ':' },
    { id: 91, ref: 'Peri Tzadik, Bereshit 2', sep: ':' },
    { id: 6, ref: 'Peri Tzadik, Rosh Chodesh Cheshvan' },
    { id: 106, ref: 'Peri Tzadik, Rosh Chodesh Cheshvan' },
    { id: 111, ref: 'Peri Tzadik, Noach 5' },
    { id: 112, ref: 'Peri Tzadik, Noach 6' },
    { id: 777, ref: 'Peri Tzadik, Noach 5' },
    { id: 778, ref: 'Peri Tzadik, Rosh Chodesh Mar Cheshvan' },
  ];
  put(root, 'data/peri-tzadik/toc.json', { toc: { children: leaves } });
  for (const leaf of leaves) put(root, `data/peri-tzadik/${leaf.id}.json`, [item()]);
  const link = { a: 'Peri Tzadik, Bereshit 1:1', r: 'Dover Tzedek 13', c: 'Parallel Sources', kind: 'Direct conceptual parallel · Rav Tzadok' };
  const custom = { ...link, kind: 'Independently reviewed exact-text parallel' };
  const otherCategory = { ...link, c: 'Commentary' };
  const otherAnchor = { ...link, a: 'Peri Tzadik, Bereshit 1:2' };
  const wholeSectionLink = { ...link, a: 'Peri Tzadik, Bereshit 1' };
  const protectedLink = { ...link, a: 'Peri Tzadik, Noach 5:1' };
  put(root, 'data/peri-tzadik/links.json', {
    'Peri Tzadik, Bereshit 1': [link, custom, otherCategory, otherAnchor, wholeSectionLink],
    'Peri Tzadik, Noach 5': [protectedLink],
  });
  put(root, 'data/dover-tzedek/0.json', [item()]);
  put(root, 'data/dover-tzedek/links.json', { 'Dover Tzedek 13': [link] });
  put(root, 'data/takanat-hashavin/0.json', [item()]);
  put(root, 'data/resisei-layla/0.json', [item()]);
  put(root, 'data/other-book/0.json', [item()]);
  put(root, 'data/et-haochel/0.json', [item(curated), item(standalone)]);
  put(root, 'data/sichat-shedim/toc.json', { toc: { id: 0, ref: 'Sichat Shedim', depth: 2, shape: [1, 1], ilch: [1, 2] } });
  const implicitNumber = item(); delete implicitNumber.n;
  implicitNumber.footnotes[0].provenance = { ...implicitNumber.footnotes[0].provenance,
    section: 'Sichat Shedim 1', sourceFile: '0-1.json', item: 3 };
  put(root, 'data/sichat-shedim/0-1.json', [{ h: 'Original heading' }, implicitNumber]);
  const nestedLink = { ...link, a: 'Sichat Shedim 1:1' };
  const legacyNestedLink = { ...link, a: 'Sichat Shedim 1:3' };
  put(root, 'data/sichat-shedim/links.json', { 'Sichat Shedim 1': [nestedLink, legacyNestedLink] });
  put(root, 'data/parallels/independent.json', { parallels: [link] });
  put(root, 'data/cited/independent.json', { 'Dover Tzedek 13': [link.a] });
  put(root, 'data/catalog.json', { unchanged: true });
  put(root, 'data/files.json', ['all original files']);
  put(root, 'sources/akiva/Peri_Tzadik.json', { title: 'Peri Tzadik', sections: [
    { file: '90.json', ref: 'Peri Tzadik, Bereshit 1', items: [item()] },
    { file: '111.json', ref: 'Peri Tzadik, Noach 5', items: [item()] },
    { file: '777.json', ref: 'Peri Tzadik, Noach 5', items: [item()] },
  ] });
  const initial = snapshots(root);
  const dry = runCleanup({ root });
  check(() => assert.equal(dry.mode, 'dry-run'));
  check(() => assert.deepEqual(snapshots(root), initial, 'Default invocation must not write any files'));
  check(() => assert.equal(dry.books['peri-tzadik'].footnotesChanged, 2, 'Protection must use owner, not citation text'));
  check(() => assert.equal(dry.books['peri-tzadik'].protectedFootnotes, 6, 'Protect exact file IDs plus aliased refs'));
  check(() => assert.equal(dry.books['et-haochel'].footnotesChanged, 0, 'Curated Et HaOchel notes survive'));

  const reportPath = path.join(temporary, 'report.json');
  const applied = runCleanup({ root, write: true, report: reportPath });
  check(() => assert.equal(applied.mode, 'write'));
  check(() => assert.equal(applied.totals.filesChanged, 6, 'Only three reader files, one master and two links files change'));
  check(() => assert.deepEqual(applied.assertions, { bodyUnchanged: true, footnoteCountsUnchanged: true,
    noteMetadataUnchanged: true, firstParagraphsUnchanged: true, protectedUnchanged: true, idempotent: true }));
  const modified = snapshots(root);
  const changedPaths = new Set(applied.files.map((file) => file.path));
  check(() => {
    for (const [filename, hash] of initial) if (!changedPaths.has(filename)) assert.equal(modified.get(filename), hash, `Out-of-scope file changed: ${filename}`);
  });
  check(() => {
    for (const file of applied.files) {
      assert.equal(file.beforeSha256, initial.get(file.path));
      assert.equal(file.afterSha256, modified.get(file.path));
      if (file.kind === 'reader' || file.kind === 'master') {
        assert.equal(file.notesBefore, file.notesAfter);
        assert.equal(file.bodyBeforeSha256, file.bodyAfterSha256);
      }
    }
  });
  check(() => assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data/peri-tzadik/links.json'))), {
    'Peri Tzadik, Bereshit 1': [custom, otherCategory, otherAnchor], 'Peri Tzadik, Noach 5': [protectedLink],
  }, 'Links require matching owner, item, source and generated provenance'));
  check(() => assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data/sichat-shedim/links.json'))),
    { 'Sichat Shedim 1': [] }, 'Nested TOC leaves must map to id-chapter.json owners'));
  check(() => {
    const master = JSON.parse(fs.readFileSync(path.join(root, 'sources/akiva/Peri_Tzadik.json')));
    assert.deepEqual(master.sections[0].items[0].footnotes[0], cleaned.note);
    assert.deepEqual(master.sections[1].items[0].footnotes[0], note());
    assert.deepEqual(master.sections[2].items[0].footnotes[0], note());
  });
  const repeated = runCleanup({ root, write: true });
  check(() => assert.equal(repeated.totals.filesChanged, 0, 'Repeated --write must be idempotent'));
  check(() => assert.deepEqual(snapshots(root), modified, 'Idempotent pass must preserve raw bytes'));
  check(() => assert.throws(() => runCleanup({}), /--root is required/));
  check(() => assert.throws(() => runCleanup({ root, report: path.join(root, 'data/report.json') }), /--report must be outside/));

  const badRoot = path.join(temporary, 'bad');
  put(badRoot, 'data/peri-tzadik/toc.json', { toc: { children: leaves.slice(0, 2) } });
  put(badRoot, 'data/peri-tzadik/90.json', [item()]);
  put(badRoot, 'data/peri-tzadik/91.json', [item(unknown)]);
  const badBefore = snapshots(badRoot);
  check(() => assert.throws(() => runCleanup({ root: badRoot, write: true }), /Unknown paragraph shape/));
  check(() => assert.deepEqual(snapshots(badRoot), badBefore, 'A later schema error must prevent all earlier writes'));
  const noOwnerRoot = path.join(temporary, 'no-owner');
  put(noOwnerRoot, 'data/peri-tzadik/90.json', [item()]);
  check(() => assert.throws(() => runCleanup({ root: noOwnerRoot, write: true }), /Cannot establish the TOC owner/));

  const transactionRoot = path.join(temporary, 'transaction');
  put(transactionRoot, 'data/peri-tzadik/toc.json', { toc: { children: leaves.slice(0, 1) } });
  put(transactionRoot, 'data/peri-tzadik/90.json', [item()]);
  const doverFile = put(transactionRoot, 'data/dover-tzedek/0.json', [item()]);
  const transactionBefore = snapshots(transactionRoot);
  const invalidReport = path.join(temporary, 'invalid-report.json');
  fs.mkdirSync(invalidReport);
  check(() => assert.throws(() => runCleanup({ root: transactionRoot, write: true, report: invalidReport }), /regular file/));
  check(() => assert.deepEqual(snapshots(transactionRoot), transactionBefore, 'A report destination error must precede all data writes'));
  const reportSymlink = path.join(temporary, 'symlink-report.json');
  fs.symlinkSync(doverFile, reportSymlink);
  check(() => assert.throws(() => runCleanup({ root: transactionRoot, write: true, report: reportSymlink }), /regular file/));
  check(() => assert.deepEqual(snapshots(transactionRoot), transactionBefore, 'Report symlink cannot overwrite protected Dover'));
  const parentSymlink = path.join(temporary, 'symlink-report-dir');
  fs.symlinkSync(path.join(transactionRoot, 'data/dover-tzedek'), parentSymlink);
  check(() => assert.throws(() => runCleanup({ root: transactionRoot, write: true, report: path.join(parentSymlink, 'new.json') }), /outside data/));
  const linksSymlink = path.join(transactionRoot, 'data/peri-tzadik/links.json');
  fs.symlinkSync(doverFile, linksSymlink);
  check(() => assert.throws(() => runCleanup({ root: transactionRoot, write: true }), /Refusing a symlink/));
  fs.unlinkSync(linksSymlink);
  check(() => assert.deepEqual(snapshots(transactionRoot), transactionBefore, 'Linked input files cannot bypass owner protection'));
  const rollbackReport = path.join(temporary, 'rollback-report.json');
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = (source, destination) => {
      if (destination === rollbackReport) throw Error('Simulated report commit failure');
      return originalRename(source, destination);
    };
    check(() => assert.throws(() => runCleanup({ root: transactionRoot, write: true, report: rollbackReport }), /Simulated report commit failure/));
  } finally { fs.renameSync = originalRename; }
  check(() => assert.deepEqual(snapshots(transactionRoot), transactionBefore, 'Report finalization failure must roll back already-written data'));
  check(() => assert.equal(fs.existsSync(rollbackReport), false, 'A failed transaction cannot leave a successful audit report'));

  const sharedRoot = path.join(temporary, 'shared-links');
  put(sharedRoot, 'data/peri-tzadik/toc.json', { toc: { children: [...leaves.slice(0, 2), { id: 92, ref: 'Peri Tzadik, Bereshit 3', sep: ':' }] } });
  const retained = { number: 99, sourceId: 'SOURCE-99', placementId: 'SOURCE-99-1',
    paragraphs: [{ text: 'Dover Tzedek 13: Retained first-paragraph source.',
      rich: [{ text: 'Read the original', href: 'https://www.sefaria.org/Dover_Tzedek.13' }],
      links: [{ label: 'Beit Yaakov on Torah, Noach 3', url: 'https://www.sefaria.org/Beit_Yaakov_on_Torah,_Noach.3' }] }],
    sources: [{ ref: 'Beit Yaakov on Torah, Noach 3', role: 'primary-source' }] };
  const sharedItem = item(); sharedItem.footnotes.push(retained);
  put(sharedRoot, 'data/peri-tzadik/90.json', [sharedItem]);
  const laterRetained = { number: 100, sourceId: 'SOURCE-100', placementId: 'SOURCE-100-1',
    paragraphs: ['<b>Original source:</b> <a href="https://www.sefaria.org/Dover_Tzedek.13">Original text</a>'], sources: [] };
  const laterItem = item(laterRetained); laterItem.n = 2;
  put(sharedRoot, 'data/peri-tzadik/91.json', [item(), laterItem]);
  const sameNote = note();
  sameNote.paragraphs[0] = { text: 'Dover Tzedek 13: Retained primary source.',
    rich: [{ text: 'Dover Tzedek 13', href: 'https://www.sefaria.org/Dover_Tzedek.13' }] };
  sameNote.sources[0] = { ref: 'Dover Tzedek 13', role: 'primary-source' };
  put(sharedRoot, 'data/peri-tzadik/92.json', [item(sameNote)]);
  const explicitRemoved = { ...link, sourceId: 'SOURCE-17', placementId: 'SOURCE-17-2' };
  const explicitRetained = { ...link, sourceId: 'SOURCE-99' };
  const sharedIshbitz = { ...link, r: 'Beit Yaakov on Torah, Noach 3', kind: 'Direct conceptual parallel · Ishbitz–Radzin' };
  const secondChapterLink = { ...link, a: 'Peri Tzadik, Bereshit 2:1' };
  const secondChapterWholeLink = { ...link, a: 'Peri Tzadik, Bereshit 2' };
  const sameNoteLink = { ...link, a: 'Peri Tzadik, Bereshit 3:1' };
  const sameNoteExplicitLink = { ...sameNoteLink, sourceId: 'SOURCE-17' };
  put(sharedRoot, 'data/peri-tzadik/links.json', {
    'Peri Tzadik, Bereshit 1': [link, wholeSectionLink, explicitRemoved, explicitRetained, sharedIshbitz],
    'Peri Tzadik, Bereshit 2': [secondChapterLink, secondChapterWholeLink],
    'Peri Tzadik, Bereshit 3': [sameNoteLink, sameNoteExplicitLink],
  });
  const sharedReport = runCleanup({ root: sharedRoot, write: true });
  const sharedLinks = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'data/peri-tzadik/links.json')));
  check(() => assert.deepEqual(sharedLinks['Peri Tzadik, Bereshit 1'], [link, wholeSectionLink, explicitRetained, sharedIshbitz],
    'Retained first-paragraph hyperlinks/sources protect shared edges; an explicit different removed note can still be cleaned'));
  check(() => assert.deepEqual(sharedLinks['Peri Tzadik, Bereshit 2'], [secondChapterWholeLink],
    'A retained source elsewhere in the owner protects a whole-section alias, while the removed paragraph edge remains identifiable'));
  check(() => assert.equal(sharedReport.books['peri-tzadik'].linkEntriesRemoved, 2));
  check(() => assert.equal(sharedReport.books['peri-tzadik'].sharedLinkEntriesPreserved, 6));
  check(() => assert.deepEqual(sharedLinks['Peri Tzadik, Bereshit 3'], [sameNoteLink, sameNoteExplicitLink],
    'Even an explicit note ID cannot disambiguate a relation still used in the same note’s first paragraph'));
  check(() => assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sharedRoot, 'data/peri-tzadik/90.json')))[0].footnotes[1], retained));
  check(() => assert.equal(runCleanup({ root: sharedRoot, write: true }).totals.filesChanged, 0,
    'Shared-edge preservation remains idempotent'));
  process.stdout.write(`PASS appended-parallel cleanup: ${assertions} focused checks\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

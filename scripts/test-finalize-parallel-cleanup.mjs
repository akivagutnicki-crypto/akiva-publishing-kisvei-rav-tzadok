#!/usr/bin/env node
// Integration safeguards: exact reverse relations, pinned CLI, staged shell and
// edition changes, rollback, proof-preserving reruns, and strict sealing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { runFinalization } from './finalize-parallel-cleanup.mjs';
import { finalizeShabbos, SOURCE_SHA } from './publish-pri-shabbos.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-finalization-test-'));
const cleaner = fileURLToPath(new URL('./strip-appended-parallels.mjs', import.meta.url));
const wrapper = fileURLToPath(new URL('./finalize-parallel-cleanup.mjs', import.meta.url));
const dependencies = { cleaner };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const owner = 'Peri Tzadik, Bereshit 1';
const rav = 'Dover Tzedek 13';
const ishbitz = 'Beit Yaakov on Torah, Noach 3';
const reportName = 'parallel-cleanup-report.json';
const workerTemplate = fs.readFileSync(new URL('../dist/library/sw.js', import.meta.url), 'utf8');
let checks = 0, serial = 0;
const check = callback => { callback(); checks++; };
function put(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  return file;
}
function snapshot(root) {
  const records = new Map();
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else records.set(path.relative(root, filename), entry.isSymbolicLink() ? 'symlink:' + fs.readlinkSync(filename) : sha(fs.readFileSync(filename)));
    }
  }
  walk(root); return records;
}
function originalNote(number, ravRef = rav) {
  const paragraph = text => ({ text, rich: [{ text }] });
  return { number, sourceId: 'SOURCE-' + number, placementId: 'PLACEMENT-' + number, phraseIndex: 0,
    nativeConnections: [{ ref: 'Curated connection 4' }],
    paragraphs: [paragraph('Genesis 2:5 — Original primary translation. Context and connection are preserved.'),
      paragraph('Kisvei Rav Tzadok Parallel — ' + ravRef + ': appended text.'),
      paragraph('Kisvei Beis Ishbitz–Radzin Parallel — ' + ishbitz + ': appended text.'),
      paragraph('Sources: Genesis 2:5. | Parallels: ' + ravRef + '; ' + ishbitz + '.')],
    sources: [{ ref: 'Genesis 2:5', role: 'primary-source' }, { ref: ravRef, role: 'parallel-rav-tzadok' }, { ref: ishbitz, role: 'parallel-ishbitz-radzin' }] };
}
function fixture(ravRef = rav) {
  const root = path.join(temp, 'fixture-' + serial++);
  const items = [1, 2].map(n => ({ n, p: [['טֶקְסְט', 'Original body ' + n]], footnotes: [originalNote(16 + n, ravRef)] }));
  put(root, 'data/peri-tzadik/toc.json', { toc: { children: [{ id: 90, ref: owner, sep: ':' }, { id: 111, ref: 'Peri Tzadik, Noach 5' }] } });
  put(root, 'data/peri-tzadik/90.json', items);
  put(root, 'data/peri-tzadik/111.json', items);
  const generated = (n, r) => ({ a: owner + ':' + n, r, c: 'Parallel Sources', kind: r === ravRef ? 'Direct conceptual parallel · Rav Tzadok' : 'Direct conceptual parallel · Ishbitz–Radzin' });
  put(root, 'data/peri-tzadik/links.json', { [owner]: [generated(1, ravRef), generated(1, ishbitz), generated(2, ravRef), generated(2, ishbitz),
    { a: owner + ':1', r: ravRef, c: 'Commentary', kind: 'Independent retained source relation' }] });
  put(root, 'data/other-book/links.json', { 'Other book 1': [{ a: owner + ':2', r: ishbitz, c: 'Other Sources' }] });
  put(root, 'data/other-book/0.json', [{ n: 1, p: [['שָׁלוֹם', 'Unrelated body']] }]);
  put(root, 'data/dover-tzedek/0.json', items);
  put(root, 'data/et-haochel/0.json', [{ n: 1, p: [['אֲכִילָה', 'Food']], footnotes: [{ number: 1, kind: 'parallel', sourceId: 'EH-001',
    paragraphs: [{ text: 'Independently curated primary source and translation.' }], sources: [{ ref: 'Sod Yesharim 47' }] }] }]);
  put(root, 'data/parallels/independent.json', { [owner + ':1']: { p: [['Other book 1', 9, ['Genesis 2:5'], []]] } });
  put(root, 'data/cited/dover-tzedek.json', { [ravRef]: [owner + ':1', owner + ':2', 'Independent chapter 1'] });
  put(root, 'data/cited/beit-yaakov.json', { [ishbitz]: [owner + ':1', owner + ':2'] });
  put(root, 'data/cited/genesis.json', { 'Genesis 2:5': [owner + ':1', owner + ':2'] });
  put(root, 'data/cited/index.json', { index: 'Unmodified metadata, different schema' });
  put(root, 'data/files.json', { version: 'original-build-manifest' });
  put(root, 'data/catalog.json', [{ slug: 'peri-tzadik', title: 'Peri Tzadik' }]);
  put(root, 'sources/akiva/Peri_Tzadik.json', { title: 'Peri Tzadik', sections: [{ file: '90.json', ref: owner, items: [items[0]] }] });
  put(root, 'pri-shabbos-publication.json', { sourceDocxSha256: SOURCE_SHA, edition: '20261018-pri-shabbos-0000000000000000', untouched: { title: 'Current installed Word text', count: 661 } });
  put(root, 'index.html', "<!doctype html><script>\nconst editionDataUrl = url => url.startsWith('data/dover-tzedek/') ? url + '?edition=keep-current-dover' : url;\n</script>\n");
  put(root, 'sw.js', workerTemplate);
  return root;
}
function run(root, options = {}, overrides = {}) { return runFinalization({ root, ...options }, { ...dependencies, ...overrides }); }
function verifyFailedWithoutMutation(root, work, pattern) {
  const before = snapshot(root);
  check(() => assert.throws(work, pattern));
  check(() => assert.deepEqual(snapshot(root), before, 'A rejected finalization changed original inputs or left temporary files'));
}

async function workerRequest(code, revision, online) {
  const base = 'https://reader.example/library/';
  const unversioned = base + 'data/sichat-shedim/0-1.json';
  const request = new Request(unversioned + '?edition=' + revision);
  const records = new Map([[unversioned, new Response('previously downloaded pack chapter')]]);
  const handlers = new Map();
  let requests = 0;
  const cache = {
    async match(wanted, options = {}) {
      const key = typeof wanted === 'string' ? new URL(wanted, base).href : wanted.url;
      if (records.has(key)) return records.get(key).clone();
      if (options.ignoreSearch) for (const [stored, response] of records) if (new URL(stored).pathname === new URL(key).pathname) return response.clone();
      return undefined;
    },
    async put(wanted, response) { records.set(wanted.url, response.clone()); },
  };
  runInNewContext(code, { URL, Request, Response, setTimeout: () => 0,
    self: { registration: { scope: base }, addEventListener: (name, callback) => handlers.set(name, callback) },
    caches: { open: async () => cache, match: (...args) => cache.match(...args) },
    fetch: async () => { requests++; if (!online) throw Error('offline'); return new Response('cleaned online chapter'); },
  });
  let response;
  handlers.get('fetch')({ request, respondWith: promise => { response = Promise.resolve(promise); }, waitUntil: () => {} });
  assert(response, 'Worker did not handle the cleanup chapter request');
  return { text: await (await response).text(), requests, cachedVersioned: records.has(request.url) };
}

try {
  const root = fixture(), before = snapshot(root);
  const preview = run(root);
  check(() => assert.equal(preview.report.mode, 'dry-run'));
  check(() => assert.equal(preview.report.publication.sealed, false));
  const previewSnapshot = snapshot(root); previewSnapshot.delete('parallel-cleanup-preview.json');
  check(() => assert.deepEqual(previewSnapshot, before, 'Dry-run must leave data, shell, metadata and source masters unchanged'));
  check(() => assert.equal(preview.report.reverseCitationCleanup.removedRelations, 2));
  check(() => assert.equal(preview.report.reverseCitationCleanup.independentlySupportedReaderRelations, 2));
  const oldMetadata = read(path.join(root, 'pri-shabbos-publication.json'));
  const applied = run(root, { write: true });
  const report = applied.report;
  const finalNote = read(path.join(root, 'data/peri-tzadik/90.json'))[0].footnotes[0];
  const expectedNote = originalNote(17); expectedNote.paragraphs = expectedNote.paragraphs.slice(0, 1); expectedNote.sources = expectedNote.sources.slice(0, 1);
  check(() => assert.deepEqual(finalNote, expectedNote, 'Wrapper must preserve the exact core note contract'));
  check(() => assert.deepEqual(read(path.join(root, 'data/cited/dover-tzedek.json')), { [rav]: [owner + ':1', 'Independent chapter 1'] }, 'Other categories preserve a shared reverse relation'));
  check(() => assert.deepEqual(read(path.join(root, 'data/cited/beit-yaakov.json')), { [ishbitz]: [owner + ':2'] }, 'Any book can independently support the exact shared relation'));
  check(() => assert.equal(sha(fs.readFileSync(path.join(root, 'data/cited/genesis.json'))), before.get('data/cited/genesis.json')));
  check(() => assert.equal(report.totals.filesChanged, report.files.length));
  check(() => assert.equal(report.coreTotals.filesChanged + 3, report.files.length, 'Two reverse indexes and one edition record extend core totals'));
  const metadata = report.files.find(file => file.kind === 'publication-metadata');
  check(() => assert.equal(metadata.beforeSha256, before.get('pri-shabbos-publication.json')));
  const nextMetadata = read(path.join(root, 'pri-shabbos-publication.json'));
  check(() => assert.deepEqual(nextMetadata, { ...oldMetadata, edition: report.publication.shabbosEdition }));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(() => assert(html.indexOf('/* Appended parallel cleanup revision */') < html.indexOf('/* Pri Shabbos final data revision */'), 'Global citation cache route must come before Pri-only revision'));
  check(() => assert(html.includes("'?edition=keep-current-dover'"), 'Preserve the current Dover cache branch'));
  check(() => assert.equal(report.shellFiles.length, 2));
  check(() => assert.equal(report.preservedFiles.find(file => file.path === 'data/parallels/independent.json').category, 'generic-parallels'));
  check(() => assert.equal(report.preservedFiles.find(file => file.path === 'data/et-haochel/0.json').category, 'curated-et-haochel'));
  const covered = [...report.files, ...report.preservedFiles].filter(file => file.path.startsWith('data/')).map(file => file.path).sort();
  const dataPaths = [...before.keys()].filter(relative => relative.startsWith('data/') && relative !== 'data/files.json').sort();
  check(() => assert.deepEqual(covered, dataPaths, 'Every data file except the later ZIP manifest needs exact proof'));
  for (const file of [...report.files, ...report.shellFiles]) check(() => assert.equal(sha(fs.readFileSync(path.join(root, file.path))), file.afterSha256));
  for (const file of report.preservedFiles) check(() => assert.equal(sha(fs.readFileSync(path.join(root, file.path))), file.sha256));
  const appliedSnapshot = snapshot(root);
  check(() => assert.equal(run(root, { write: true }).alreadyApplied, true));
  check(() => assert.deepEqual(snapshot(root), appliedSnapshot, 'Rerun must retain original before→after evidence byte-for-byte'));
  check(() => assert.equal(run(root).alreadyApplied, true));
  check(() => assert.deepEqual(snapshot(root), appliedSnapshot, 'Dry-run of applied cleanup must not overwrite proof or preview'));
  verifyFailedWithoutMutation(root, () => run(root, { report: path.join(root, reportName) }), /dry-run cannot overwrite applied proof/);
  const sealed = run(root, { write: true, seal: true });
  check(() => assert.equal(sealed.report.publication.sealed, true));
  const { sealed: flag, sealedAt, ...pub } = sealed.report.publication;
  const { sealed: previousSeal, ...oldPublication } = report.publication;
  check(() => assert.deepEqual(pub, oldPublication, 'Sealing may only add the seal flag and timestamp'));
  check(() => assert.equal(previousSeal, false));
  check(() => assert(Number.isFinite(Date.parse(sealedAt))));
  const finalWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const online = await workerRequest(finalWorker, report.cacheRevision, true);
  check(() => assert.equal(online.text, 'cleaned online chapter', 'A cleanup request must fetch current online data'));
  check(() => assert.equal(online.requests, 1));
  check(() => assert(online.cachedVersioned, 'The clean response must enter the existing data cache'));
  const offline = await workerRequest(finalWorker, report.cacheRevision, false);
  check(() => assert.equal(offline.text, 'previously downloaded pack chapter', 'A saved unversioned chapter must still open offline'));
  check(() => assert.equal(offline.requests, 1));
  const sealedSnapshot = snapshot(root);
  check(() => assert.equal(run(root, { write: true, seal: true }).alreadyApplied, true));
  check(() => assert.deepEqual(snapshot(root), sealedSnapshot, 'Repeated sealing must be byte-idempotent'));
  put(root, 'data/files.json', { version: 'regenerated-by-zip-step' });
  const afterManifest = snapshot(root);
  check(() => assert.equal(run(root, { write: true, seal: true }).alreadyApplied, true));
  check(() => assert.deepEqual(snapshot(root), afterManifest, 'Manifest regeneration is independent of sealed data proof'));

  for (const baseRef of [rav, 'Resisei Layla 16:1']) {
    const suffixRoot = fixture(baseRef);
    const sourceFile = path.join(suffixRoot, 'data/peri-tzadik/links.json');
    const sourceLinks = read(sourceFile);
    const curated = sourceLinks[owner].find(link => link.c === 'Commentary');
    curated.r = baseRef + ' (§4)';
    put(suffixRoot, 'data/peri-tzadik/links.json', sourceLinks);
    const otherFile = path.join(suffixRoot, 'data/other-book/links.json');
    const otherLinks = read(otherFile);
    otherLinks['Other book 1'][0].r = ishbitz + ' (§5)';
    otherLinks['Other book 1'].push(
      { a: owner + ':2', r: baseRef + '0 (§2)', c: 'Curated source' },
      { a: owner + ':20', r: baseRef + ' (§2)', c: 'Curated source' },
    );
    put(suffixRoot, 'data/other-book/links.json', otherLinks);
    const suffixReport = run(suffixRoot, { write: true }).report;
    check(() => assert.deepEqual(read(path.join(suffixRoot, 'data/cited/dover-tzedek.json')),
      { [baseRef]: [owner + ':1', 'Independent chapter 1'] }, 'Preserve the canonical source with a display suffix, without conflating similar numbers or anchors'));
    check(() => assert.deepEqual(read(path.join(suffixRoot, 'data/cited/beit-yaakov.json')),
      { [ishbitz]: [owner + ':2'] }, 'A curated display suffix in another book still supports the exact canonical backlink'));
    check(() => assert.deepEqual(read(otherFile), otherLinks, 'Never rewrite retained suffixed forward references'));
    check(() => assert.deepEqual(read(sourceFile)[owner].find(link => link.c === 'Commentary'), curated));
    check(() => assert.equal(suffixReport.reverseCitationCleanup.removedRelations, 2));
    check(() => assert.equal(suffixReport.reverseCitationCleanup.independentlySupportedReaderRelations, 2));
  }

  const badShell = fixture();
  put(badShell, 'index.html', '<script>const changedDataLoader = x => x;</script>');
  verifyFailedWithoutMutation(badShell, () => run(badShell, { write: true }), /reader data-loader|false|strictly equal/);
  const badReverse = fixture();
  put(badReverse, 'data/cited/dover-tzedek.json', { [rav]: 'Unknown non-array schema' });
  verifyFailedWithoutMutation(badReverse, () => run(badReverse, { write: true }), /Unknown reverse citation anchors/);
  const badMetadata = fixture();
  verifyFailedWithoutMutation(badMetadata, () => run(badMetadata, { write: true }, { finalizeShabbos(stage) {
    finalizeShabbos(stage);
    const file = path.join(stage, 'pri-shabbos-publication.json');
    const value = read(file); value.untouched.count = 1; fs.writeFileSync(file, JSON.stringify(value));
  } }), /metadata beyond its edition/);
  const badReport = fixture();
  fs.mkdirSync(path.join(badReport, 'directory.json'));
  verifyFailedWithoutMutation(badReport, () => run(badReport, { write: true, report: path.join(badReport, 'directory.json') }), /regular file/);
  const reportSymlink = fixture();
  fs.symlinkSync(path.join(reportSymlink, 'data/dover-tzedek/0.json'), path.join(reportSymlink, reportName));
  verifyFailedWithoutMutation(reportSymlink, () => run(reportSymlink, { write: true }), /symlink/);
  const ancestorSymlink = fixture();
  fs.symlinkSync(path.join(ancestorSymlink, 'data/dover-tzedek'), path.join(ancestorSymlink, 'unsafe-report-directory'));
  verifyFailedWithoutMutation(ancestorSymlink, () => run(ancestorSymlink, { write: true, report: path.join(ancestorSymlink, 'unsafe-report-directory/report.json') }), /symlink/);
  const inputSymlink = fixture();
  fs.unlinkSync(path.join(inputSymlink, 'data/other-book/links.json'));
  fs.symlinkSync(path.join(inputSymlink, 'data/peri-tzadik/links.json'), path.join(inputSymlink, 'data/other-book/links.json'));
  verifyFailedWithoutMutation(inputSymlink, () => run(inputSymlink, { write: true }), /symlink/);

  for (const failingName of ['sw.js', reportName]) {
    const rollback = fixture();
    // An existing dry-run report must also be restored if report commit fails.
    if (failingName === reportName) run(rollback, { report: path.join(rollback, reportName) });
    const rename = fs.renameSync;
    let injected = false, dataCommitted = false, shellCommitted = false;
    fs.renameSync = function(source, destination) {
      if (String(destination).startsWith(rollback + path.sep) && String(source).includes('.parallel-publication-')) {
        if (destination === path.join(rollback, failingName) && !injected) { injected = true; throw Error('Simulated final output failure'); }
        if (destination.startsWith(path.join(rollback, 'data') + path.sep)) dataCommitted = true;
        if (destination === path.join(rollback, 'index.html')) shellCommitted = true;
      }
      return rename.apply(this, arguments);
    };
    try { verifyFailedWithoutMutation(rollback, () => run(rollback, { write: true }), /Simulated final output failure/); }
    finally { fs.renameSync = rename; }
    check(() => assert(injected && dataCommitted && shellCommitted, 'Rollback test must fail after real data and shell renames'));
  }

  const noProof = fixture();
  verifyFailedWithoutMutation(noProof, () => run(noProof, { seal: true }), /requires --write/);
  verifyFailedWithoutMutation(noProof, () => run(noProof, { seal: true, write: true }), /No applied cleanup report/);
  const stale = fixture(); run(stale, { write: true });
  put(stale, 'data/peri-tzadik/90.json', [{ n: 1, p: [['שִׁנּוּי', 'Unexpected body change']], footnotes: [] }]);
  verifyFailedWithoutMutation(stale, () => run(stale, { write: true, seal: true }), /no longer matches/);
  verifyFailedWithoutMutation(stale, () => run(stale, { write: true }), /no longer matches/);
  const addedFile = fixture(); run(addedFile, { write: true });
  put(addedFile, 'data/other-book/new.json', { unreviewed: true });
  verifyFailedWithoutMutation(addedFile, () => run(addedFile, { write: true, seal: true }), /Data inventory differs/);
  const reorderedShell = fixture(); run(reorderedShell, { write: true });
  finalizeShabbos(reorderedShell);
  verifyFailedWithoutMutation(reorderedShell, () => run(reorderedShell, { write: true, seal: true }), /no longer matches/);
  const pinned = fixture();
  verifyFailedWithoutMutation(pinned, () => execFileSync(process.execPath, [wrapper, '--root', pinned, '--write'], { encoding: 'utf8', stdio: 'pipe' }), /Protected edition check failed/);
  check(() => assert.throws(() => execFileSync(process.execPath, [wrapper, '--root', pinned, '--cleaner', cleaner], { encoding: 'utf8', stdio: 'pipe' }), /Unknown argument: --cleaner/));
  console.log(`PASS ${checks} parallel publication integration safeguards.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

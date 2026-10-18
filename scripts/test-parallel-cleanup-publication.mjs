#!/usr/bin/env node
// Read-only verification of the cleanup artifact and the deployed reader.
// Public checks use the full download ZIP for complete data coverage, plus
// direct requests for every protected file and one changed chapter per book.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const chapterName = /^\d+(?:-\d+)*\.json$/;
const hashPattern = /^[a-f0-9]{64}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const objectSha256 = value => sha256(JSON.stringify(value));

function parseOptions(args) {
  const options = { root: path.resolve('dist/library'), final: false, url: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--final') options.final = true;
    else if (arg === '--root' || arg === '--url') {
      const value = args[++i];
      assert(value && !value.startsWith('--'), `${arg} needs a value`);
      options[arg.slice(2)] = arg === '--root' ? path.resolve(value) : value;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/test-parallel-cleanup-publication.mjs [--root dist/library] [--final] [--url https://host/library/]');
      return null;
    } else throw Error(`Unknown argument: ${arg}`);
  }
  if (options.url) {
    const url = new URL(options.url);
    assert(['https:', 'http:'].includes(url.protocol), '--url must be HTTP or HTTPS');
    assert(!url.username && !url.password && !url.search && !url.hash, '--url must be a plain public library base URL');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    options.url = url.href;
  }
  return options;
}

function safeRelative(value) {
  assert(typeof value === 'string' && value.length, 'Missing relative artifact path');
  assert(!value.includes('\\') && !value.includes('\0') && !value.includes('?') && !value.includes('#'), `Invalid artifact path: ${value}`);
  assert(!path.posix.isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..'), `Artifact path escapes the library: ${value}`);
  return value;
}

function loadProtectedEdition() {
  const source = fs.readFileSync(path.join(scriptDir, 'strip_appended_parallels.js'), 'utf8');
  const startMarker = 'const CURRENT_PROTECTED_EDITION = ';
  const endMarker = ';\n\nfunction verifyCurrentProtectedEdition(';
  const start = source.indexOf(startMarker);
  assert(start >= 0 && source.indexOf(startMarker, start + 1) < 0, 'Missing or ambiguous protected-edition literal');
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, 'Missing fixed delimiter after protected-edition literal');
  // Parse the literal as JSON. Never import or execute the cleanup script.
  const pin = JSON.parse(source.slice(start + startMarker.length, end));
  assert(object(pin.files) && Object.keys(pin.files).length === 102, 'Expected exactly 102 independently pinned protected files');
  assert(typeof pin.snapshotVersion === 'string' && pin.snapshotVersion.length, 'Protected snapshot version is missing');
  for (const [relative, expected] of Object.entries(pin.files)) {
    safeRelative(relative);
    assert(hashPattern.test(expected), `Invalid protected SHA-256: ${relative}`);
  }
  return pin;
}

function walkFiles(directory, prefix = '') {
  assert(fs.statSync(directory).isDirectory(), `Missing directory: ${directory}`);
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `Unexpected symlink: ${path.join(directory, entry.name)}`);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...walkFiles(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) result.push(relative);
    else throw Error(`Unsupported artifact entry: ${relative}`);
  }
  return result.sort();
}

async function concurrent(items, work, limit = 8) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await work(items[index], index);
    }
  }));
}

function itemFingerprint(items) {
  let notes = 0;
  function body(value) {
    if (Array.isArray(value)) return value.map(body);
    if (!object(value) || !Object.prototype.hasOwnProperty.call(value, 'footnotes')) return value;
    assert(Array.isArray(value.footnotes), 'Footnotes must remain an array');
    notes += value.footnotes.length;
    const { footnotes, ...rest } = value;
    return rest;
  }
  return { bodySha256: objectSha256(body(items)), notes };
}

function validateReport(report, pin, final) {
  assert.equal(report.schemaVersion, 1, 'Unsupported cleanup report schema');
  assert.equal(report.mode, 'write', 'The publication report must record an applied cleanup');
  assert.equal(report.protectedEdition?.verified, true, 'The cleanup did not verify its protected edition');
  assert.equal(report.protectedEdition?.snapshotVersion, pin.snapshotVersion, 'The cleanup used a different protected snapshot');
  assert.equal(report.protectedEdition?.sourceZipSha256, pin.sourceZipSha256, 'The cleanup used a different protected ZIP');
  assert.equal(report.protectedEdition?.fileCount, Object.keys(pin.files).length, 'Protected file count differs from the independent pin');
  for (const name of ['bodyUnchanged', 'footnoteCountsUnchanged', 'noteMetadataUnchanged', 'firstParagraphsUnchanged', 'protectedUnchanged', 'idempotent',
    'reverseCitationsOnlyRemovedWhenUnsupported', 'genericParallelIndexesUnchanged', 'transactionalPublication', 'shabbosMetadataOnlyEditionChanged']) {
    assert.equal(report.assertions?.[name], true, `Cleanup invariant failed or missing: ${name}`);
  }
  assert(object(report.books) && Object.keys(report.books).length === 16, 'Expected all 16 target books in the cleanup report');
  assert(Array.isArray(report.files) && report.files.length > 0, 'The cleanup report has no changed files');
  assert(Array.isArray(report.shellFiles) && report.shellFiles.length > 0, 'The cleanup report has no reader-shell hashes');
  assert(Array.isArray(report.preservedFiles) && report.preservedFiles.length > 0, 'The cleanup report has no unchanged-data preservation hashes');
  assert.equal(report.totals?.filesChanged, report.files.length, 'Changed-file total differs from the complete publication report');
  assert(report.shellFiles.some(file => file.path === 'index.html'), 'The reader HTML hash is missing from the publication report');
  assert(report.shellFiles.some(file => file.path === 'sw.js'), 'The service-worker hash is missing from the publication report');
  assert(typeof report.cacheRevision === 'string' && report.cacheRevision.length > 0, 'Missing cleanup cache revision');
  assert(report.totals?.footnotesBefore > 0 && report.totals?.footnotesChanged > 0 && report.totals?.paragraphsRemoved > 0, 'Cleanup counts must be nonzero');
  assert.equal(report.totals.footnotesAfter, report.totals.footnotesBefore, 'Original note total changed');
  let totalBefore = 0;
  let totalAfter = 0;
  for (const [book, stats] of Object.entries(report.books)) {
    assert(/^[a-z0-9-]+$/.test(book), `Invalid book slug: ${book}`);
    assert(stats.footnotesBefore > 0, `Original footnotes are missing for ${book}`);
    assert.equal(stats.footnotesAfter, stats.footnotesBefore, `Original note count changed for ${book}`);
    totalBefore += stats.footnotesBefore;
    totalAfter += stats.footnotesAfter;
  }
  assert.equal(totalBefore, report.totals.footnotesBefore, 'Book totals do not add up to the report total');
  assert.equal(totalAfter, report.totals.footnotesAfter, 'Book totals after cleanup do not add up');
  const seen = new Set();
  for (const file of [...report.files, ...report.shellFiles]) {
    safeRelative(file.path);
    assert(!seen.has(file.path), `Duplicate changed artifact: ${file.path}`);
    seen.add(file.path);
    assert(hashPattern.test(file.beforeSha256) && hashPattern.test(file.afterSha256), `Invalid before/after SHA-256: ${file.path}`);
    assert(!Object.prototype.hasOwnProperty.call(pin.files, file.path), `Protected file appears in the change list: ${file.path}`);
    if (file.notesBefore !== undefined) assert.equal(file.notesAfter, file.notesBefore, `Note count changed in ${file.path}`);
    if (file.bodyBeforeSha256 !== undefined) assert.equal(file.bodyAfterSha256, file.bodyBeforeSha256, `Body changed in ${file.path}`);
  }
  for (const file of report.preservedFiles) {
    safeRelative(file.path);
    assert(!seen.has(file.path), `Artifact is both changed and preserved, or listed twice: ${file.path}`);
    seen.add(file.path);
    assert(hashPattern.test(file.sha256), `Invalid preserved SHA-256: ${file.path}`);
  }
  const reportedPins = new Map((report.protectedFiles || []).map(file => [file.path, file.sha256]));
  for (const [relative, hash] of Object.entries(pin.files)) assert.equal(reportedPins.get(relative), hash, `Report does not preserve pinned ${relative}`);
  const dataHashes = [...report.files.map(file => [file.path, file.afterSha256]), ...report.preservedFiles.map(file => [file.path, file.sha256])]
    .filter(([relative]) => relative.startsWith('data/') && relative !== 'data/files.json')
    .sort(([a], [b]) => a.localeCompare(b));
  const dataContentSha256 = sha256(dataHashes.map(([relative, hash]) => `${relative}\0${hash}\n`).join(''));
  assert.equal(report.publication?.dataContentSha256, dataContentSha256, 'Publication content proof does not match all tracked data hashes');
  assert.equal(report.cacheRevision, '20261018-appended-parallels-cleanup-' + dataContentSha256.slice(0, 16), 'Cache revision does not identify the actual tracked data');
  if (final) assert.equal(report.publication?.sealed, true, 'Final publication report has not been sealed after all build steps');
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options) return;
  const startedAt = new Date().toISOString();
  const pin = loadProtectedEdition();
  const directCache = new Map();
  let directRequests = 0;
  async function directRead(relative) {
    safeRelative(relative);
    // Do not retain a second full copy of the local data tree in memory.
    if (!options.url) return fs.readFileSync(path.join(options.root, relative));
    if (!directCache.has(relative)) directCache.set(relative, (async () => {
      directRequests++;
      const url = new URL(relative.split('/').map(encodeURIComponent).join('/'), options.url);
      const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(60000) });
      assert(response.ok, `${relative}: HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    })());
    return directCache.get(relative);
  }
  const parseJson = (bytes, relative) => {
    try { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
    catch (error) { throw Error(`${relative}: invalid JSON (${error.message})`); }
  };
  const report = parseJson(await directRead('parallel-cleanup-report.json'), 'parallel-cleanup-report.json');
  validateReport(report, pin, options.final);
  let archive = null;
  let downloadIndex = null;
  let archiveBytes = null;
  if (options.url || options.final) {
    downloadIndex = parseJson(await directRead('downloads/index.json'), 'downloads/index.json');
    assert(object(downloadIndex.library), 'Complete library ZIP is absent from downloads/index.json');
    safeRelative(downloadIndex.library.file);
    archiveBytes = await directRead(downloadIndex.library.file);
    assert.equal(archiveBytes.length, downloadIndex.library.bytes, 'Complete library ZIP size differs from downloads/index.json');
    const require = createRequire(import.meta.url);
    const vendor = [path.join(options.root, 'vendor/fflate.min.js'), path.join(scriptDir, '../dist/library/vendor/fflate.min.js')].find(file => fs.existsSync(file));
    assert(vendor, 'Existing dist/library/vendor/fflate.min.js is required to verify the full ZIP');
    const { unzipSync } = require(vendor);
    archive = unzipSync(new Uint8Array(archiveBytes));
    for (const relative of Object.keys(archive)) safeRelative(relative);
    assert(archive['data/files.json'], 'Complete library ZIP is missing its data manifest');
  }
  async function artifactRead(relative) {
    safeRelative(relative);
    if (options.url && relative.startsWith('data/')) {
      assert(archive && Object.prototype.hasOwnProperty.call(archive, relative), `Published ZIP is missing ${relative}`);
      return Buffer.from(archive[relative]);
    }
    return directRead(relative);
  }
  async function expectHash(relative, expected, direct = false) {
    assert(hashPattern.test(expected), `Invalid expected SHA-256: ${relative}`);
    const actual = sha256(await (direct ? directRead(relative) : artifactRead(relative)));
    assert.equal(actual, expected, `${relative}: ${direct ? 'public file' : 'artifact'} SHA-256 differs from the expected publication`);
  }
  await concurrent(Object.entries(pin.files), async ([relative, expected]) => {
    await expectHash(relative, expected);
    if (options.url) await expectHash(relative, expected, true);
  });
  const chapterBytes = new Map();
  await concurrent(report.files, async file => {
    const bytes = await artifactRead(file.path);
    assert.equal(sha256(bytes), file.afterSha256, `Cleanup was overwritten after its report: ${file.path}`);
    if (file.kind === 'reader' || file.kind === 'master') {
      const data = parseJson(bytes, file.path);
      const items = file.kind === 'master' ? data.sections.map(section => section.items) : data;
      assert(Array.isArray(items), `Changed reader file is not a section array: ${file.path}`);
      const fingerprint = itemFingerprint(items);
      assert.equal(fingerprint.notes, file.notesAfter, `Actual note count differs from the report: ${file.path}`);
      assert.equal(fingerprint.bodySha256, file.bodyAfterSha256, `Actual body differs from the preserved body: ${file.path}`);
      if (file.kind === 'reader') chapterBytes.set(file.path, data);
    }
  });
  await concurrent(report.shellFiles, file => expectHash(file.path, file.afterSha256, Boolean(options.url)));
  await concurrent(report.preservedFiles || [], file => expectHash(file.path, file.sha256));
  for (const section of report.protectedSections || []) {
    const master = parseJson(await artifactRead(section.path), section.path);
    assert.equal(objectSha256(master.sections?.[section.sectionIndex]), section.sha256, `Protected master section changed: ${section.path} section ${section.sectionIndex}`);
  }
  const html = (await directRead('index.html')).toString('utf8');
  assert(html.includes(report.cacheRevision), 'Reader HTML does not contain the cleanup cache revision');

  let readerFiles = 0;
  let readerNotes = 0;
  for (const [book, stats] of Object.entries(report.books)) {
    const prefix = `data/${book}/`;
    const relativeFiles = options.url
      ? Object.keys(archive).filter(relative => relative.startsWith(prefix) && chapterName.test(relative.slice(prefix.length))).sort()
      : fs.readdirSync(path.join(options.root, prefix)).filter(name => chapterName.test(name)).sort().map(name => prefix + name);
    assert.equal(relativeFiles.length, stats.readerFilesScanned, `Reader chapter inventory changed for ${book}`);
    let notes = 0;
    for (const relative of relativeFiles) {
      const data = chapterBytes.get(relative) || parseJson(await artifactRead(relative), relative);
      assert(Array.isArray(data), `Invalid reader chapter: ${relative}`);
      notes += itemFingerprint(data).notes;
    }
    assert.equal(notes, stats.footnotesAfter, `Actual original-note count changed for ${book}`);
    readerFiles += relativeFiles.length;
    readerNotes += notes;
  }
  assert.equal(readerNotes, report.totals.footnotesAfter, 'Actual original-note total differs from the report');

  let directSamples = 0;
  if (options.url) {
    const samples = new Map();
    for (const file of report.files) if (file.kind === 'reader' && !samples.has(file.book)) samples.set(file.book, file);
    await concurrent([...samples.values()], async file => {
      await expectHash(file.path, file.afterSha256, true);
      directSamples++;
    });
  }
  let manifestVersion = null;
  let manifestFiles = 0;
  let manifestBytes = 0;
  if (options.final || options.url) {
    const manifestRaw = await directRead('data/files.json');
    const manifest = parseJson(manifestRaw, 'data/files.json');
    assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Final offline manifest has no files');
    const listed = manifest.files.map(safeRelative);
    assert.deepEqual(listed, [...new Set(listed)].sort(), 'Final offline manifest paths must be unique and sorted');
    assert(!listed.includes('files.json'), 'The offline manifest must not list itself');
    const actualDataPaths = options.url
      ? Object.keys(archive).filter(relative => relative.startsWith('data/') && relative !== 'data/files.json').map(relative => relative.slice(5)).sort()
      : walkFiles(path.join(options.root, 'data')).filter(relative => relative !== 'files.json');
    assert.deepEqual(actualDataPaths, listed, 'Final data inventory differs from data/files.json');
    const guardedDataPaths = new Set([
      ...report.files.map(file => file.path), ...report.preservedFiles.map(file => file.path),
    ].filter(relative => relative.startsWith('data/') && relative !== 'data/files.json').map(relative => relative.slice(5)));
    assert.deepEqual([...guardedDataPaths].sort(), listed, 'The cleanup report does not hash every final data file as changed or preserved');
    const hash = createHash('sha256');
    for (const relative of listed) {
      const data = await artifactRead('data/' + relative);
      hash.update(relative).update('\0').update(data);
      manifestBytes += data.length;
      if (archive) {
        assert(archive['data/' + relative], `Complete library ZIP is missing data/${relative}`);
        assert.equal(sha256(archive['data/' + relative]), sha256(data), `Complete ZIP has different bytes for data/${relative}`);
      }
    }
    manifestVersion = hash.digest('hex').slice(0, 16);
    manifestFiles = listed.length;
    assert.equal(manifest.version, manifestVersion, 'Offline manifest version does not match its actual data bytes');
    assert.equal(manifest.bytes, manifestBytes, 'Offline manifest byte count is incorrect');
    assert.equal(downloadIndex.version, manifestVersion, 'Download index version differs from the final data manifest');
    assert.equal(downloadIndex.library.dataFiles, listed.length + 1, 'Complete ZIP data-file count differs from its manifest');
    assert.equal(sha256(archive['data/files.json']), sha256(manifestRaw), 'Complete ZIP contains a different offline manifest');
    const zipDataPaths = Object.keys(archive).filter(relative => relative.startsWith('data/')).sort();
    assert.deepEqual(zipDataPaths, [...listed.map(relative => 'data/' + relative), 'data/files.json'].sort(), 'Complete ZIP data inventory differs from the final manifest');
    const docs = Object.keys(archive).filter(relative => /^downloads\/[^/]+\.(?:docx|pdf)$/i.test(relative));
    assert.equal(docs.length, downloadIndex.library.documents, 'Complete ZIP document count differs from download metadata');
    if (report.publication?.dataVersion !== undefined) assert.equal(report.publication.dataVersion, manifestVersion, 'Sealed publication data version differs from the final manifest');
  }
  console.log(JSON.stringify({
    ok: true, mode: options.url ? 'public' : 'local', final: options.final,
    root: options.url || options.root, startedAt, completedAt: new Date().toISOString(),
    protectedSnapshotVersion: pin.snapshotVersion, protectedFilesVerified: Object.keys(pin.files).length,
    changedFilesVerified: report.files.length, shellFilesVerified: report.shellFiles.length,
    preservedFilesVerified: (report.preservedFiles || []).length,
    readerFilesVerified: readerFiles, originalFootnotesBefore: report.totals.footnotesBefore,
    originalFootnotesAfter: readerNotes, cacheRevision: report.cacheRevision,
    manifestVersion, manifestFiles, manifestBytes,
    completeZipBytes: archiveBytes?.length || null, directPublicRequests: directRequests,
    directChangedChapterSamples: directSamples,
  }, null, 2));
}

main().catch(error => {
  console.error(`Parallel cleanup publication verification failed: ${error.message}`);
  process.exitCode = 1;
});

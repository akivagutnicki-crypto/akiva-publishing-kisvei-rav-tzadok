#!/usr/bin/env node
// Final content pass: stage the pinned cleanup, reconcile reverse citations,
// finalize Pri Shabbos, and commit data, shell and proof as one transaction.
// ZIP/manifest and MCP generation run afterward; --seal verifies this proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { finalizeShabbos, REPORT as SHABBOS_REPORT } from './publish-pri-shabbos.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const PINNED_CLEANER = fileURLToPath(new URL('./strip_appended_parallels.js', import.meta.url));
const REPORT_NAME = 'parallel-cleanup-report.json';
const PREVIEW_NAME = 'parallel-cleanup-preview.json';
const SHELL_PATHS = ['index.html', 'sw.js'];
const GENERATED_MANIFEST = 'data/files.json';
const REVISION_PREFIX = '20261018-appended-parallels-cleanup-';
const WORKER_FALLBACK_MARKER = '    } else if (rel.startsWith(\'data/\')) {';
const WORKER_CLEANUP_BRANCH = `    } else if (rel.startsWith('data/') && (url.searchParams.get('edition') || '').startsWith('${REVISION_PREFIX}')) {
      // Appended parallel cleanup offline fallback.
      event.respondWith(networkFirst(request, DATA));
`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const relationKey = link => JSON.stringify([link.a, link.r]);
// Curated forward links can append a display paragraph marker to a canonical
// cited-source ref. Keep the anchor exact and normalize only that final marker
// when deciding whether a reverse backlink still has supporting evidence.
const reverseSupportKey = link => JSON.stringify([link.a, link.r.replace(/\s+\(§\s*\d+\)$/u, '')]);
const posix = value => value.split(path.sep).join('/');
const stringify = value => JSON.stringify(value, null, 2) + '\n';

function regularPath(filename, missing = false) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (missing && error.code === 'ENOENT') continue; throw error; }
    assert(!stat.isSymbolicLink(), `Refusing a symlink in publication input/output: ${current}`);
    if (current !== absolute) assert(stat.isDirectory(), `Not a directory: ${current}`);
  }
  return absolute;
}
function safeRelative(relative) {
  assert(typeof relative === 'string' && relative && !relative.includes('\\') && !relative.includes('\0'), 'Invalid report artifact path');
  assert(!path.posix.isAbsolute(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..'), `Artifact escapes the library: ${relative}`);
  return relative;
}
function walk(directory, prefix = '') {
  regularPath(directory);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `Refusing a symlink in publication input: ${path.join(directory, entry.name)}`);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...walk(path.join(directory, entry.name), relative + '/'));
    else { assert(entry.isFile(), `Unsupported publication entry: ${relative}`); files.push(relative); }
  }
  return files.sort();
}
function inputPaths(root) {
  const files = walk(path.join(root, 'data'), 'data/');
  for (const name of [...SHELL_PATHS, SHABBOS_REPORT]) {
    const filename = regularPath(path.join(root, name));
    assert(fs.statSync(filename).isFile(), `Missing publication input: ${name}`);
    files.push(name);
  }
  const masters = path.join(root, 'sources', 'akiva');
  if (fs.existsSync(masters)) {
    regularPath(masters);
    for (const entry of fs.readdirSync(masters, { withFileTypes: true })) if (entry.name.endsWith('.json')) {
      assert(entry.isFile() && !entry.isSymbolicLink(), `Unsupported source master: ${entry.name}`);
      files.push('sources/akiva/' + entry.name);
    }
  }
  return files.sort();
}
function snapshot(root) {
  return new Map(inputPaths(root).map(relative => {
    const filename = path.join(root, relative);
    return [relative, { sha256: sha(fs.readFileSync(filename)), mode: fs.statSync(filename).mode }];
  }));
}
function verifySnapshot(root, expected, temporaryFiles = []) {
  const ownTemporaries = new Set(temporaryFiles.map(filename => posix(path.relative(root, filename))));
  assert.deepEqual(inputPaths(root).filter(relative => !ownTemporaries.has(relative)), [...expected.keys()], 'Publication input inventory changed during preparation');
  for (const [relative, record] of expected) assert.equal(sha(fs.readFileSync(regularPath(path.join(root, relative)))), record.sha256,
    `Publication input changed during preparation: ${relative}`);
}
function safeReport(root, supplied) {
  const filename = regularPath(supplied, true);
  assert(path.extname(filename).toLowerCase() === '.json', '--report must name a .json file');
  const relative = posix(path.relative(root, filename));
  assert(!/^(?:data|sources)(?:\/|$)/.test(relative), '--report must be outside data/ and sources/');
  assert(![SHABBOS_REPORT, ...SHELL_PATHS].includes(relative) && filename !== SCRIPT, '--report cannot overwrite a publication input');
  if (fs.existsSync(filename)) assert(fs.lstatSync(filename).isFile(), '--report must be a regular file');
  return filename;
}
function readPrior(filename) {
  if (!fs.existsSync(filename)) return null;
  const value = json(filename);
  assert(value?.schemaVersion === 1 && ['write', 'dry-run'].includes(value.mode) && Array.isArray(value.files),
    `Refusing to overwrite an unrelated JSON file: ${filename}`);
  return value;
}
function dataDigest(records) {
  return sha([...records].filter(([relative]) => relative.startsWith('data/') && relative !== GENERATED_MANIFEST)
    .sort(([a], [b]) => a.localeCompare(b)).map(([relative, hash]) => `${relative}\0${hash}\n`).join(''));
}
function cacheShell(html, sw, revision, books) {
  const marker = 'const editionDataUrl = url => ';
  assert.equal(html.split(marker).length, 2, 'Unknown reader data-loader format');
  assert.equal((sw.match(/const SHELL = `[^`]+`;/g) || []).length, 1, 'Unknown service-worker shell key');
  const cleanupLines = html.match(/\/\* Appended parallel cleanup revision \*\/[^\n]*\n/g) || [];
  assert(cleanupLines.length <= 1, 'Ambiguous existing cleanup cache revision');
  html = html.replace(/\/\* Appended parallel cleanup revision \*\/[^\n]*\n/g, '');
  const checks = books.map(slug => {
    assert(/^[a-z0-9-]+$/.test(slug), 'Invalid cache book slug');
    return `url.startsWith('data/${slug}/')`;
  });
  checks.push("url.startsWith('data/cited/')", "url === 'data/files.json'");
  html = html.replace(marker, marker + `/* Appended parallel cleanup revision */ (${checks.join(' || ')}) ? url + (url.includes('?') ? '&' : '?') + 'edition=${revision}' :\n`);
  const fingerprint = revision.slice(REVISION_PREFIX.length);
  assert(revision.startsWith(REVISION_PREFIX) && /^[a-f0-9]{16}$/.test(fingerprint), 'Invalid cleanup cache revision');
  sw = sw.replace(/const SHELL = `([^`]+)`;/, (_, key) => 'const SHELL = `' +
    key.replace(/-appended-parallels-cleanup-[a-f0-9]+/g, '') + '-appended-parallels-cleanup-' + fingerprint + '`;');
  const workerMarkerCount = (sw.match(/Appended parallel cleanup offline fallback\./g) || []).length;
  assert(workerMarkerCount <= 1, 'Ambiguous cleanup worker route');
  if (workerMarkerCount) {
    assert.equal(sw.split(WORKER_CLEANUP_BRANCH).length, 2, 'Unknown existing cleanup worker route');
    sw = sw.replace(WORKER_CLEANUP_BRANCH, '');
  }
  assert.equal(sw.split(WORKER_FALLBACK_MARKER).length, 2, 'Unknown generic worker data route');
  assert.equal((sw.match(/async function networkFirst\(/g) || []).length, 1, 'Missing existing network-first worker handler');
  assert(sw.includes('ignoreSearch: true'), 'Worker lacks downloaded-pack fallback');
  sw = sw.replace(WORKER_FALLBACK_MARKER, WORKER_CLEANUP_BRANCH + WORKER_FALLBACK_MARKER);
  return { html, sw };
}
function verifyApplied(root, report) {
  assert.equal(report.mode, 'write', 'An applied write report is required');
  assert.equal(report.schemaVersion, 1, 'Unknown applied report schema');
  assert.equal(report.totals?.filesChanged, report.files?.length, 'Applied report file total is inconsistent');
  assert(object(report.publication) && report.publication.dataContentSha256, 'Applied report lacks the transaction content proof');
  for (const key of ['bodyUnchanged', 'footnoteCountsUnchanged', 'noteMetadataUnchanged', 'firstParagraphsUnchanged', 'protectedUnchanged', 'idempotent',
    'reverseCitationsOnlyRemovedWhenUnsupported', 'genericParallelIndexesUnchanged', 'transactionalPublication']) assert.equal(report.assertions?.[key], true, `Missing publication invariant: ${key}`);
  const records = new Map();
  for (const entry of [...report.files, ...(report.shellFiles || [])]) {
    const relative = safeRelative(entry.path);
    assert(!records.has(relative), `Duplicate publication record: ${relative}`);
    assert(/^[a-f0-9]{64}$/.test(entry.afterSha256), `Invalid publication hash: ${relative}`);
    records.set(relative, entry.afterSha256);
  }
  for (const entry of report.preservedFiles || []) {
    const relative = safeRelative(entry.path);
    assert(!records.has(relative), `Preservation and change records overlap: ${relative}`);
    assert(/^[a-f0-9]{64}$/.test(entry.sha256), `Invalid preserved hash: ${relative}`);
    records.set(relative, entry.sha256);
  }
  assert.deepEqual(walk(path.join(root, 'data'), 'data/').filter(relative => relative !== GENERATED_MANIFEST),
    [...records.keys()].filter(relative => relative.startsWith('data/') && relative !== GENERATED_MANIFEST).sort(), 'Data inventory differs from the applied cleanup proof; use a fresh build');
  for (const [relative, expected] of records) assert.equal(sha(fs.readFileSync(regularPath(path.join(root, relative)))), expected,
    `Applied cleanup proof no longer matches ${relative}; use a fresh build`);
  for (const entry of report.protectedFiles || []) assert.equal(sha(fs.readFileSync(regularPath(path.join(root, safeRelative(entry.path))))), entry.sha256,
    `Protected file no longer matches: ${entry.path}`);
  assert.equal(dataDigest(records), report.publication.dataContentSha256, 'Final data content proof differs');
  assert.equal(report.cacheRevision, REVISION_PREFIX + report.publication.dataContentSha256.slice(0, 16), 'Cache revision does not identify final content');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const expectedShell = cacheShell(html, sw, report.cacheRevision, report.cacheBooks);
  assert.equal(html, expectedShell.html, 'Cleanup must be the first data-cache route');
  assert.equal(sw, expectedShell.sw, 'Service worker does not identify the final cleanup content');
}

// Prepare every temporary output before the first rename. The report belongs
// to the same rollback boundary as data and shell. Existing input bytes and
// permissions are retained for recovery if any commit or verification fails.
function commit(changes, validate, verifyAfter = () => {}) {
  const prepared = [], attempted = [];
  try {
    for (const change of changes) {
      regularPath(change.file, true);
      fs.mkdirSync(path.dirname(change.file), { recursive: true });
      const temporary = `${change.file}.parallel-publication-${process.pid}-${randomUUID()}.tmp`;
      prepared.push({ ...change, temporary });
      fs.writeFileSync(temporary, change.after, { flag: 'wx', mode: change.mode === undefined ? 0o644 : change.mode & 0o777 });
    }
    validate(prepared.map(change => change.temporary));
    for (const change of prepared) {
      regularPath(change.file, true);
      const actual = fs.existsSync(change.file) ? fs.readFileSync(change.file) : null;
      assert(actual === null ? change.before === null : change.before !== null && actual.equals(change.before), `Output changed during publication: ${change.file}`);
      attempted.push(change);
      fs.renameSync(change.temporary, change.file);
      assert.equal(sha(fs.readFileSync(change.file)), sha(change.after), `Written publication file differs: ${change.file}`);
    }
    verifyAfter();
  } catch (error) {
    const recovery = [];
    for (const change of attempted.reverse()) {
      try {
        regularPath(change.file, true);
        if (change.before === null) { if (fs.existsSync(change.file)) fs.unlinkSync(change.file); }
        else { fs.writeFileSync(change.file, change.before); if (change.mode !== undefined) fs.chmodSync(change.file, change.mode & 0o777); }
      } catch (failure) { recovery.push(`${change.file}: ${failure.message}`); }
    }
    if (recovery.length) throw new AggregateError([error], `Publication failed and recovery was incomplete: ${recovery.join('; ')}`);
    throw error;
  } finally {
    for (const change of prepared) if (fs.existsSync(change.temporary)) fs.unlinkSync(change.temporary);
  }
}
function reportChange(filename, before, report) {
  return { file: filename, before, after: Buffer.from(stringify(report)), mode: before === null ? undefined : fs.statSync(filename).mode };
}
function reconcileReverse(root, report) {
  const supported = new Set();
  const data = path.join(root, 'data');
  for (const entry of fs.readdirSync(data, { withFileTypes: true })) if (entry.isDirectory()) {
    const filename = path.join(data, entry.name, 'links.json');
    if (!fs.existsSync(filename)) continue;
    const groups = json(filename);
    assert(object(groups), `Unknown reader link index: ${entry.name}/links.json`);
    for (const [owner, links] of Object.entries(groups)) {
      assert(Array.isArray(links), `Unknown reader link group: ${entry.name}/${owner}`);
      for (const link of links) {
        assert(object(link) && typeof link.a === 'string' && typeof link.r === 'string', `Unknown reader link relation: ${entry.name}/${owner}`);
        supported.add(reverseSupportKey(link));
      }
    }
  }
  const candidates = new Map();
  for (const file of report.files.filter(file => file.kind === 'links')) for (const group of file.changes) for (const link of group.removedLinks) {
    assert.equal(link.c, 'Parallel Sources', 'Core removed a nonparallel reader relation');
    candidates.set(relationKey(link), { a: link.a, r: link.r });
  }
  const disappeared = [...candidates.values()].filter(relation => !supported.has(reverseSupportKey(relation)));
  const byRef = new Map();
  for (const { a, r } of disappeared) { if (!byRef.has(r)) byRef.set(r, new Set()); byRef.get(r).add(a); }
  let removedCount = 0, filesChanged = 0;
  const cited = path.join(data, 'cited');
  assert(fs.existsSync(cited), 'Missing reverse citation index data/cited/');
  for (const name of fs.readdirSync(cited).filter(name => name.endsWith('.json') && !['index.json', 'search.json'].includes(name)).sort()) {
    const filename = path.join(cited, name), before = fs.readFileSync(filename);
    const value = JSON.parse(before);
    assert(object(value), `Unknown reverse citation index: ${name}`);
    const removed = [];
    for (const [ref, anchors] of Object.entries(value)) {
      assert(Array.isArray(anchors) && anchors.every(anchor => typeof anchor === 'string'), `Unknown reverse citation anchors: ${name}/${ref}`);
      const eligible = byRef.get(ref);
      if (!eligible) continue;
      value[ref] = anchors.filter(anchor => {
        if (!eligible.has(anchor)) return true;
        removed.push({ a: anchor, r: ref }); return false;
      });
    }
    if (!removed.length) continue;
    const after = Buffer.from(JSON.stringify(value) + '\n');
    fs.writeFileSync(filename, after);
    report.files.push({ path: 'data/cited/' + name, kind: 'reverse-citations', beforeSha256: sha(before), afterSha256: sha(after), removedRelations: removed });
    removedCount += removed.length; filesChanged++;
  }
  report.reverseCitationCleanup = { removedRelations: removedCount, disappearedReaderRelations: disappeared.length,
    candidateReaderRelations: candidates.size, independentlySupportedReaderRelations: candidates.size - disappeared.length,
    filesChanged, independentlySupportedRelationsPreserved: true };
}

/** CLI always uses the pinned standalone cleaner. Dependency injection exists
 * only for small, executable integration fixtures, never as a CLI option. */
export function runFinalization(options = {}, dependencies = {}) {
  const root = regularPath(path.resolve(options.root || 'dist/library'));
  assert(fs.statSync(root).isDirectory(), '--root must name a library directory');
  const write = options.write === true;
  assert(!options.seal || write, '--seal requires --write; sealing records verified publication proof');
  const reportPath = safeReport(root, options.report || path.join(root, write ? REPORT_NAME : PREVIEW_NAME));
  const reportBefore = fs.existsSync(reportPath) ? fs.readFileSync(reportPath) : null;
  const destinationPrior = readPrior(reportPath);
  assert(write || destinationPrior?.mode !== 'write', 'A dry-run cannot overwrite applied proof; use a separate --report path');
  const appliedPath = destinationPrior?.mode === 'write' ? reportPath : safeReport(root, path.join(root, REPORT_NAME));
  const prior = appliedPath === reportPath ? destinationPrior : readPrior(appliedPath);
  if (options.seal) {
    assert(prior?.mode === 'write', 'No applied cleanup report to seal');
    assert.equal(appliedPath, reportPath, '--seal must address the applied report');
    verifyApplied(root, prior);
    if (prior.publication.sealed === true) return { report: prior, reportPath, alreadyApplied: true, writtenFiles: 0 };
    const report = structuredClone(prior);
    report.publication.sealed = true;
    report.publication.sealedAt = new Date().toISOString();
    const initial = snapshot(root);
    commit([reportChange(reportPath, reportBefore, report)], temporaryFiles => { verifySnapshot(root, initial, temporaryFiles); verifyApplied(root, prior); }, () => verifyApplied(root, report));
    return { report, reportPath, alreadyApplied: false, writtenFiles: 1 };
  }
  if (prior?.mode === 'write') verifyApplied(root, prior);
  const initial = snapshot(root);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-publication-'));
  const stage = path.join(temporary, 'library');
  try {
    for (const relative of initial.keys()) {
      const target = path.join(stage, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, relative), target);
    }
    const cleaner = dependencies.cleaner || PINNED_CLEANER;
    const stageReport = path.join(temporary, 'core-report.json');
    execFileSync(process.execPath, [cleaner, '--root', stage, '--write', '--report', stageReport], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const report = json(stageReport);
    assert.equal(report.mode, 'write', 'Staged cleaner did not apply its plan');
    if (prior?.mode === 'write') {
      assert.equal(report.files.length, 0, 'New cleanup candidates appeared after an applied report; use a fresh build');
      verifySnapshot(root, initial);
      return { report: prior, reportPath: appliedPath, alreadyApplied: true, writtenFiles: 0 };
    }
    report.root = root;
    report.mode = write ? 'write' : 'dry-run';
    report.coreTotals = { ...report.totals };
    reconcileReverse(stage, report);
    const metadataBefore = fs.readFileSync(path.join(stage, SHABBOS_REPORT));
    const metadataValue = JSON.parse(metadataBefore);
    (dependencies.finalizeShabbos || finalizeShabbos)(stage);
    const metadataAfter = fs.readFileSync(path.join(stage, SHABBOS_REPORT));
    const finalizedMetadata = JSON.parse(metadataAfter);
    const { edition: previousEdition, ...oldMetadata } = metadataValue;
    const { edition: finalEdition, ...newMetadata } = finalizedMetadata;
    assert.deepEqual(newMetadata, oldMetadata, 'Pri Shabbos finalization changed metadata beyond its edition');
    assert(typeof finalEdition === 'string' && /^20261018-pri-shabbos-[a-f0-9]{16}$/.test(finalEdition), 'Unknown final Pri Shabbos edition');
    if (!metadataBefore.equals(metadataAfter)) report.files.push({ path: SHABBOS_REPORT, kind: 'publication-metadata',
      beforeSha256: sha(metadataBefore), afterSha256: sha(metadataAfter),
      changes: [{ field: 'edition', before: previousEdition ?? null, after: finalEdition }] });
    const contentHashes = new Map([...initial.keys()].filter(relative => relative.startsWith('data/'))
      .map(relative => [relative, sha(fs.readFileSync(path.join(stage, relative)))]));
    const contentSha256 = dataDigest(contentHashes);
    const revision = REVISION_PREFIX + contentSha256.slice(0, 16);
    report.cacheBooks = [...new Set(report.files.filter(file => ['reader', 'links'].includes(file.kind)).map(file => file.book))].sort();
    const shell = cacheShell(fs.readFileSync(path.join(stage, 'index.html'), 'utf8'), fs.readFileSync(path.join(stage, 'sw.js'), 'utf8'), revision, report.cacheBooks);
    fs.writeFileSync(path.join(stage, 'index.html'), shell.html);
    fs.writeFileSync(path.join(stage, 'sw.js'), shell.sw);
    report.cacheRevision = revision;
    report.shellFiles = SHELL_PATHS.map(relative => ({ path: relative, beforeSha256: initial.get(relative).sha256,
      afterSha256: sha(fs.readFileSync(path.join(stage, relative))) }));
    report.publication = { sealed: false, preparedAt: new Date().toISOString(), dataContentSha256: contentSha256,
      cleanerFile: path.basename(cleaner), cleanerSha256: sha(fs.readFileSync(cleaner)), shabbosEdition: finalEdition,
      manifestRegeneration: 'data/files.json and download ZIPs are regenerated after sealing; MCP output is outside library/data.' };
    report.assertions.reverseCitationsOnlyRemovedWhenUnsupported = true;
    report.assertions.genericParallelIndexesUnchanged = true;
    report.assertions.transactionalPublication = true;
    report.assertions.shabbosMetadataOnlyEditionChanged = true;
    report.totals.filesChanged = report.files.length;
    report.preservedFiles = [];
    const expected = new Map([...report.files, ...report.shellFiles].map(file => [file.path, file]));
    assert.equal(expected.size, report.files.length + report.shellFiles.length, 'Duplicate planned publication output');
    const changes = [];
    assert.deepEqual(inputPaths(stage), [...initial.keys()], 'A staged finalizer added or removed an input file');
    for (const [relative, original] of initial) {
      const after = fs.readFileSync(path.join(stage, relative));
      const afterSha256 = sha(after);
      const record = expected.get(relative);
      if (record) {
        assert.equal(record.beforeSha256, original.sha256, `Wrong original hash in planned output: ${relative}`);
        assert.equal(record.afterSha256, afterSha256, `Wrong final hash in planned output: ${relative}`);
      } else {
        assert.equal(afterSha256, original.sha256, `Undeclared staged mutation: ${relative}`);
        if (relative !== GENERATED_MANIFEST) report.preservedFiles.push({ path: relative, sha256: original.sha256,
          category: relative.startsWith('data/parallels/') ? 'generic-parallels' : relative.startsWith('data/et-haochel/') ? 'curated-et-haochel'
            : relative.startsWith('data/') ? 'unchanged-reader-data' : relative.startsWith('sources/') ? 'unchanged-source-master' : 'unchanged-publication-metadata' });
      }
      if (afterSha256 !== original.sha256) changes.push({ file: path.join(root, relative), before: fs.readFileSync(path.join(root, relative)), after, mode: original.mode });
    }
    for (const relative of expected.keys()) assert(initial.has(relative), `Output was not an original publication input: ${relative}`);
    const applied = { ...report, mode: 'write' };
    verifyApplied(stage, applied);
    const writes = write ? changes : [];
    writes.push(reportChange(reportPath, reportBefore, report));
    commit(writes, temporaryFiles => verifySnapshot(root, initial, temporaryFiles), () => write ? verifyApplied(root, applied) : verifySnapshot(root, initial));
    return { report, reportPath, alreadyApplied: false, writtenFiles: writes.length };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/finalize-parallel-cleanup.mjs [--root dist/library] [--write] [--report REPORT_JSON] [--seal]\nDry-run writes a separate preview report. --write stages the pinned cleanup, reverse citations, Shabbos final edition and cache shell before committing. --seal --write verifies the applied report and records the publication gate before ZIP/MCP generation.');
      return;
    }
    if (arg === '--write') options.write = true;
    else if (arg === '--seal') options.seal = true;
    else if (arg === '--root' || arg === '--report') {
      const value = argv[++index];
      assert(value && !value.startsWith('--'), `Missing ${arg} value`);
      options[arg.slice(2)] = value;
    } else throw Error(`Unknown argument: ${arg}`);
  }
  const result = runFinalization(options);
  console.log(JSON.stringify({ operation: options.seal ? 'seal' : options.write ? 'write' : 'dry-run', root: result.report.root,
    alreadyApplied: result.alreadyApplied, writtenFiles: result.writtenFiles, report: result.reportPath,
    totals: result.report.totals, reverseCitationCleanup: result.report.reverseCitationCleanup,
    cacheRevision: result.report.cacheRevision, publication: result.report.publication }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Parallel publication aborted: ${error.message}`); process.exitCode = 1; }
}

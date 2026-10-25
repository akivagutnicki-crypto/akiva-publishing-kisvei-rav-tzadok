// Validate the exact Tzidkat successor before adapting any predecessor gate.
// The predecessor catalog is reconstructed only in memory. All other records
// and metadata stay in place and are checked against this build's prior report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {verifyBatchChain, hasPublishedBatches} from './publish-tzidkat-batch-review.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ACCURACY_PACK = 'sources/akiva/overlays/tzidkat-source-accuracy-20261023.json.gz';
export const ACCURACY_REPORT = 'library/tzidkat-source-accuracy-20261023.json';
export const ACCURACY_RELEASE = '20261023-tzidkat-source-accuracy-v1';
export const ACCURACY_PACK_SHA256 = 'aec0a541c2a094262f6f9e66215d89ca2ccb4e0048cc8672e12ba79d96d5192a';
export const ATTRIBUTION_PACK = 'sources/akiva/overlays/tzidkat-source-attribution-20261023.json.gz';
export const ATTRIBUTION_REPORT = 'library/tzidkat-source-attribution-20261023.json';
export const ATTRIBUTION_RELEASE = '20261023-tzidkat-source-accuracy-v2';
export const ATTRIBUTION_PACK_SHA256 = 'ba0242471e1b8ff47042342dbe031aa6ea5bc1e99934ecf3c796af40f3856c88';
export const IDEA_PREIMAGES = 'sources/akiva/overlays/tzidkat-source-accuracy-idea-preimages-20261023.json';
const IDEAS = 'library/connected-ideas/catalog.json';
const LINKS = 'library/data/tzidkat-hatzadik/links.json';
const VOLUME_II_REPORT = 'library/mei-volume-ii-20261023.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const hashObject = value => sha(JSON.stringify(value));
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const canonical = value => JSON.stringify(value, (_, item) =>
  item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function localFile(directory, name) {
  assert(typeof name === 'string' && name.length && !path.isAbsolute(name)
    && !name.includes('\\') && name.split('/').every(part => part && part !== '.' && part !== '..'),
  'Invalid successor asset path: ' + name);
  const root = path.resolve(directory), filename = path.resolve(root, name);
  assert(filename.startsWith(root + path.sep), 'Successor asset escapes publication root: ' + name);
  return filename;
}

// ZIPs are large; hashing them does not require reading them into one buffer.
function fileInfo(filename) {
  const handle = fs.openSync(filename, 'r'), digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    assert(fs.fstatSync(handle).isFile(), 'Expected regular sealed asset: ' + filename);
    for (;;) {
      const count = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (!count) break;
      bytes += count; digest.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(handle); }
  return {bytes, sha256:digest.digest('hex')};
}

function loadPack(filename, release, expectedSha256) {
  const bytes = fs.readFileSync(filename), packSha256 = sha(bytes);
  if (expectedSha256) assert.equal(packSha256, expectedSha256, 'Immutable Tzidkat source pack changed');
  const pack = JSON.parse(gunzipSync(bytes));
  assert.equal(pack.schemaVersion, 1); assert.equal(pack.release, release);
  assert(pack.audit?.completeReview === true, 'Tzidkat source review is incomplete');
  assert(Array.isArray(pack.chapters) && Array.isArray(pack.ideaChanges)
    && Array.isArray(pack.linkChanges), 'Incomplete Tzidkat pack structure');
  return {pack, packSha256};
}

function sealedReport(directory, name, prepared) {
  const report = read(localFile(directory, name));
  assert.equal(report.schemaVersion, 1); assert.equal(report.release, prepared.pack.release);
  assert.equal(report.packSha256, prepared.packSha256, 'Successor report does not authenticate its pack');
  assert(report.completeReview === true && report.verification?.ok === true,
    'Successor publication must complete source review and sealing');
  assert.equal(report.verification.release, prepared.pack.release);
  assert.equal(report.verification.packSha256, prepared.packSha256);
  assert(Array.isArray(report.changedFiles) && report.changedFiles.length,
    'Successor publication has no final file seal');
  const files = new Map();
  for (const item of report.changedFiles) {
    localFile(directory, item.path);
    const allowed = prepared.pack.chapters.some(file => file.path === item.path)
      || (prepared.pack.assets || []).some(file => file.path === item.path)
      || /^library\/data\/cited\/[^/]+\.json$/.test(item.path)
      || [ACCURACY_REPORT, ATTRIBUTION_REPORT, 'library/tzidkat-source-accuracy-ledger.json',
        'library/tzidkat-source-attribution-ledger.json', 'library/data/tzidkat-hatzadik/links.json',
        'library/index.html', 'library/sw.js', 'library/data/files.json', 'library/data/packs/sources.json',
        'mcp-data/catalog.json', 'mcp-data/cited.json', 'mcp-data/text/tzidkat-hatzadik.json',
        'library/downloads/index.json', 'library/downloads/rav-tzadok-library.zip',
        'library/downloads/books/tzidkat-hatzadik.zip', 'library/connected-ideas/catalog.json'].includes(item.path);
    assert(allowed, 'Successor report claims an unrelated publication path: ' + item.path);
    assert(!files.has(item.path), 'Duplicate sealed successor path: ' + item.path);
    assert.match(item.sha256 || '', /^[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(item.bytes) && item.bytes >= 0, 'Missing sealed file size: ' + item.path);
    files.set(item.path, item);
  }
  return {report, files};
}

function validateAttributionLinkage(first, next) {
  assert.equal(next.ideaChanges.length, 0, 'Attribution successor cannot change Connected Ideas');
  assert.equal((next.addedNotes || []).length, 0, 'Attribution successor cannot add note identities');
  assert.equal(next.chapters.length, 11, 'Attribution successor must have its exact eleven reviewed chapters');
  const expectedPaths = [10,39,86,99,109,126,144,148,153,170,215].map(index => 'library/data/tzidkat-hatzadik/' + index + '.json');
  assert.deepEqual(next.chapters.map(item => item.path).sort(), expectedPaths.sort());
  for (const file of next.chapters) {
    const previous = first.chapters.find(item => item.path === file.path);
    assert(previous, 'Attribution chapter was not in the reviewed predecessor');
    assert.equal(file.beforeSha256, hashObject(previous.after), 'Attribution chapter preimage does not match the immutable accuracy result: ' + file.path);
    const identity = rows => rows.flatMap(row => (row.footnotes || []).map(note =>
      [row.n, note.number, note.sourceId, note.placementId, note.phraseIndex, note.heCharOffset, note.enCharOffset]));
    assert.deepEqual(file.after.map(({footnotes, ...body}) => body), previous.after.map(({footnotes, ...body}) => body),
      'Attribution successor changed author text');
    assert.deepEqual(identity(file.after), identity(previous.after), 'Attribution successor changed note identity or placement');
  }
  for (const change of next.linkChanges) {
    assert([11,40,87,100,110,127,145,149,154,171,216].map(n => 'Tzidkat HaTzadik ' + n).includes(change.sectionRef), 'Attribution link change outside reviewed chapters');
    const previous = first.linkChanges.find(item => item.sectionRef === change.sectionRef);
    assert(previous, 'Attribution links were not in the reviewed predecessor');
    assert.equal(change.beforeSha256, hashObject(previous.after), 'Attribution link preimage does not match the immutable accuracy result');
  }
}

/** Verify actual final files, exact after data, and the sealed release chain. */
export function verifyTzidkatSourceAccuracySuccessor({directory=path.join(REPO, 'dist'),
  packFile=path.join(REPO, ACCURACY_PACK), attributionPackFile=path.join(REPO, ATTRIBUTION_PACK)}={}) {
  const prepared = loadPack(packFile, ACCURACY_RELEASE, ACCURACY_PACK_SHA256);
  const {pack, packSha256} = prepared;
  const original = sealedReport(directory, ACCURACY_REPORT, prepared);
  let attribution = null;
  if (fs.existsSync(localFile(directory, ATTRIBUTION_REPORT))) {
    // The path comes from this module, never from report.successor.packPath.
    const next = loadPack(attributionPackFile, ATTRIBUTION_RELEASE, ATTRIBUTION_PACK_SHA256);
    validateAttributionLinkage(pack, next.pack);
    attribution = {...next, ...sealedReport(directory, ATTRIBUTION_REPORT, next)};
  }
  if (original.report.successor) {
    assert(attribution, 'Composed accuracy report requires a separately sealed attribution successor');
    assert.equal(original.report.successor.release, attribution.pack.release);
    assert.equal(original.report.successor.packSha256, attribution.packSha256);
    assert.deepEqual(original.report.successor.chapters.slice().sort(),
      attribution.pack.chapters.map(file => file.path).sort());
  }
  // Each immutable review batch is strictly additive: its validator reconstructs
  // every exact predecessor by removing only declared new note identities.
  // Authenticate it before allowing it to replace any historical file seal.
  const batch = hasPublishedBatches(directory) ? verifyBatchChain({directory}) : null;
  if (batch) {
    const previousChapters = new Map(pack.chapters.map(file => [file.path, file]));
    const previousLinks = new Map(pack.linkChanges.map(item => [item.sectionRef, item]));
    for (const file of attribution?.pack.chapters || []) previousChapters.set(file.path, file);
    for (const item of attribution?.pack.linkChanges || []) previousLinks.set(item.sectionRef, item);
    for (const file of batch.pack.chapters) {
      const previous = previousChapters.get(file.path);
      if (previous) assert.equal(file.beforeSha256, hashObject(previous.after),
        'Additive batch does not descend from the exact reviewed predecessor: ' + file.path);
    }
    for (const [sectionRef, before] of Object.entries(batch.pack.linksBefore)) {
      const previous = previousLinks.get(sectionRef);
      if (previous) assert.equal(hashObject(before), hashObject(previous.after),
        'Additive source links do not descend from the reviewed predecessor: ' + sectionRef);
    }
  }
  // The terminal seal may replace only the explicitly sealed overlap. Both
  // reports remain authenticated by their own immutable source pack.
  const filesByPath = new Map(original.files);
  if (attribution) for (const [name, info] of attribution.files) filesByPath.set(name, info);
  if (batch) for (const [name, info] of batch.files) filesByPath.set(name, info);
  filesByPath.delete(ACCURACY_REPORT); filesByPath.delete(ATTRIBUTION_REPORT);
  for (const [name, expected] of filesByPath) {
    const actual = fileInfo(localFile(directory, name));
    assert.equal(actual.bytes, expected.bytes, 'Sealed successor size changed: ' + name);
    assert.equal(actual.sha256, expected.sha256, 'Sealed successor file changed: ' + name);
  }
  const nextChapters = new Map((attribution?.pack.chapters || []).map(item => [item.path, item]));
  if (batch) for (const file of batch.pack.chapters) nextChapters.set(file.path, file);
  for (const file of pack.chapters) {
    const expected = nextChapters.get(file.path) || file;
    assert.equal(hashObject(read(localFile(directory, file.path))), hashObject(expected.after),
      'Tzidkat chapter is not its exact reviewed terminal state: ' + file.path);
  }
  const links = read(localFile(directory, LINKS));
  const nextLinks = new Map((attribution?.pack.linkChanges || []).map(item => [item.sectionRef, item]));
  if (batch) for (const item of batch.report.linkChanges) nextLinks.set(item.sectionRef, item);
  for (const change of pack.linkChanges) {
    const expected = nextLinks.get(change.sectionRef) || change;
    assert.equal(hashObject(links[change.sectionRef]), hashObject(expected.after),
      'Tzidkat links are not their exact reviewed terminal state: ' + change.sectionRef);
  }
  const catalog = read(localFile(directory, IDEAS));
  assert.equal(pack.ideaChanges.length, 29, 'Unexpected source-accuracy idea scope');
  for (const change of pack.ideaChanges) {
    const found = catalog.records.filter(row => row.id === change.id);
    assert.equal(found.length, 1, 'Missing or duplicate reviewed idea: ' + change.id);
    assert.equal(hashObject(found[0]), hashObject(change.after), 'Reviewed Tzidkat idea changed: ' + change.id);
  }
  return {pack, packSha256, report:original.report, filesByPath, catalog, batch,
    attribution:attribution ? {release:attribution.pack.release, packSha256:attribution.packSha256, report:attribution.report} : null,
    proof:{release:pack.release, packSha256, sealedFilesVerified:filesByPath.size,
      terminalChaptersVerified:pack.chapters.length, terminalLinkListsVerified:pack.linkChanges.length,
      reviewedIdeaRecords:pack.ideaChanges.length,
      ...(batch ? {additiveBatch:batch.proof} : {}),
      ...(attribution ? {attributionRelease:attribution.pack.release, attributionPackSha256:attribution.packSha256} : {})}};
}

/** Recover the prior catalog without writing or replacing any current asset. */
export function verifyTzidkatIdeasSuccessor({directory=path.join(REPO, 'dist'),
  preimagesFile=path.join(REPO, IDEA_PREIMAGES), ...options}={}) {
  const successor = verifyTzidkatSourceAccuracySuccessor({directory, ...options});
  const fixture = read(preimagesFile), {pack, catalog} = successor;
  assert.equal(fixture.schemaVersion, 1); assert.equal(fixture.release, pack.release);
  assert.equal(fixture.records.length, pack.ideaChanges.length);
  const beforeById = new Map();
  for (const item of fixture.records) {
    assert(!beforeById.has(item.id), 'Duplicate idea preimage: ' + item.id);
    const change = pack.ideaChanges.find(entry => entry.id === item.id);
    assert(change && item.before?.id === item.id, 'Unrecognized idea preimage: ' + item.id);
    assert.equal(item.beforeSha256, change.beforeSha256);
    assert.equal(hashObject(item.before), change.beforeSha256, 'Idea preimage does not match the immutable source pack: ' + item.id);
    beforeById.set(item.id, item.before);
  }
  assert.equal(catalog.accuracyReview, pack.release);
  assert.equal(catalog.contentSha256, hashObject(catalog.records), 'Current idea content hash is stale');
  assert.equal(catalog.version, catalog.contentSha256.slice(0, 16), 'Current idea version is stale');
  const predecessorCatalog = structuredClone(catalog);
  predecessorCatalog.records = predecessorCatalog.records.map(row => beforeById.get(row.id) || row);
  delete predecessorCatalog.accuracyReview;
  // This is the existing Volume II publisher's canonical metadata formula.
  // Nothing here pins the whole catalog to the original October 23 build.
  predecessorCatalog.contentSha256 = sha(canonical({release:predecessorCatalog.release,
    records:predecessorCatalog.records, coverage:predecessorCatalog.coverage, provenance:predecessorCatalog.provenance}));
  predecessorCatalog.version = predecessorCatalog.release + '-' + predecessorCatalog.contentSha256.slice(0, 16);
  const predecessorBytes = Buffer.from(JSON.stringify(predecessorCatalog, null, 2) + '\n');
  const prior = read(localFile(directory, VOLUME_II_REPORT));
  assert.match(prior.connectedIdeas?.afterSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(sha(predecessorBytes), prior.connectedIdeas.afterSha256,
    'Unrelated Connected Ideas records or metadata differ from this build’s predecessor');
  return {...successor, predecessorCatalog, predecessorBytes,
    proof:{...successor.proof, restoredPreimageRecords:beforeById.size,
      predecessorCatalogSha256:sha(predecessorBytes), currentCatalogSha256:sha(fs.readFileSync(localFile(directory, IDEAS))),
      predecessorReport:VOLUME_II_REPORT, unrelatedRecordsPreserved:catalog.records.length - beforeById.size}};
}

/**
 * Adapt an earlier edition's protected chapter hashes only after validating the
 * complete current Tzidkat release chain. Unrelated protection hashes are kept
 * verbatim. Each replacement must descend from the frozen v1 chapter preimage
 * and uses the actual terminal file seal, including an authenticated v2 chapter.
 */
export function createProtectedTzidkatSuccessorHash(options={}) {
  const verified = verifyTzidkatSourceAccuracySuccessor(options);
  const targets = new Map(verified.pack.chapters.map(file => [file.path, file]));
  // Chapters unaffected by the original accuracy release can still receive a
  // new quotation. Their own exact preimage supplies the preservation chain.
  for (const file of verified.batch?.pack.chapters || []) if (!targets.has(file.path) && verified.batch.files.has(file.path)) targets.set(file.path,file);
  // The independent Pri review is authenticated against exact predecessor
  // hashes by the batch chain before it can advance an older preservation seal.
  for (const file of verified.batch?.parshaPublication?.pack.chapters || []) {
    assert(verified.batch.files.has(file.path) || file.beforeSha256 === hashObject(file.after));
    if (verified.batch.files.has(file.path)) targets.set(file.path,file);
  }
  return (file, expected) => {
    assert.equal(typeof file, 'string');
    const relative = file.startsWith('library/data/') ? file
      : file.startsWith('data/') ? 'library/' + file : 'library/data/' + file;
    const target = targets.get(relative);
    if (!target) return expected;
    assert.equal(expected, target.beforeSha256,
      'Protected chapter does not descend from the immutable Tzidkat preimage: ' + file);
    const terminal = verified.filesByPath.get(relative);
    assert(terminal, 'Protected Tzidkat chapter is absent from the final seal: ' + file);
    return terminal.sha256;
  };
}

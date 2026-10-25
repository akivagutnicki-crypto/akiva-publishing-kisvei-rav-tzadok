// A single reviewed download-only successor to the final 18 content batches.
// This is an exact transition, not an exemption for arbitrary ZIP or DOCX edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESCRIPTOR = 'sources/akiva/downloads/tzidkat-download-refresh-20261025.json';
const RELEASE = '20261025-tzidkat-download-refresh-v1';
const DOCX = 'library/downloads/tzidkas-hatzaddik-complete.docx';
const DOCX_MEMBER = DOCX.slice(8);
const BOOK = 'library/downloads/books/tzidkat-hatzadik.zip';
const LIBRARY = 'library/downloads/rav-tzadok-library.zip';
const INDEX = 'library/downloads/index.json';
const ALLOWED = [DOCX,BOOK,LIBRARY,INDEX].sort();
const sha = value => createHash('sha256').update(value).digest('hex');
const onlyInfo = value => ({bytes:value.bytes,sha256:value.sha256});
const same = (a,b) => a?.bytes === b?.bytes && a?.sha256 === b?.sha256;

function local(directory,name) {
  assert(typeof name === 'string' && name && !path.isAbsolute(name) && !name.includes('\\')
    && name.split('/').every(part => part && part !== '.' && part !== '..'),'Unsafe download path');
  const base = path.resolve(directory), file = path.resolve(base,name);
  assert(file.startsWith(base + path.sep)); return file;
}
function info(file) {
  const fd = fs.openSync(file,'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024*1024);
  let bytes = 0;
  try { assert(fs.fstatSync(fd).isFile()); for (;;) { const n = fs.readSync(fd,buffer,0,buffer.length,null); if (!n) break; bytes += n; hash.update(buffer.subarray(0,n)); } }
  finally { fs.closeSync(fd); }
  return {bytes,sha256:hash.digest('hex')};
}
function validInfo(value) {
  assert(Number.isSafeInteger(value?.bytes) && value.bytes >= 0 && /^[a-f0-9]{64}$/.test(value.sha256 || ''),'Missing exact download hash/size');
}

export function loadTzidkatDownloadRefresh(repo=REPO) {
  const file = local(repo,DESCRIPTOR);
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file), pin = fs.readFileSync(file + '.sha256','utf8').trim();
  assert.match(pin,/^[a-f0-9]{64}$/); assert.equal(sha(bytes),pin,'Immutable download refresh descriptor changed');
  const descriptor = JSON.parse(bytes);
  assert.equal(descriptor.schemaVersion,1); assert.equal(descriptor.release,RELEASE);
  assert.equal(descriptor.scope,'existing-downloads-only');
  assert.deepEqual(descriptor.files.map(item => item.path).sort(),ALLOWED,'Download transition claims another path');
  for (const item of descriptor.files) { validInfo(item.before); validInfo(item.after); }
  assert.deepEqual(descriptor.documentCounts,{reviewedSections:264,nativeNotes:3684,connectedNotes:347,totalPublicNotes:4031,reviewAdditions:1371,sourceAdditions:1});
  assert.equal(descriptor.predecessor.path,'library/tzidkat-batch-review-256-264-20261025.json');
  assert.equal(descriptor.predecessor.sha256,'742cf6899188bb20080fadfda85bee0ca9f732049e38bb49c318d1cdb507db40');
  assert.equal(descriptor.predecessor.packSha256,'3bc345df5b4c9c9060fab8265de26f9692b0b618580521d3cabdec9103691c61');
  assert.equal(descriptor.predecessor.batches,18); assert.equal(descriptor.predecessor.reviewedSections,264);
  assert.equal(descriptor.predecessor.reviewAdditions,1371);
  assert.equal(descriptor.documentInput.path,'sources/akiva/downloads/tzidkas-hatzaddik-complete-20261025.docx');
  assert.equal(descriptor.documentApproval.path,'sources/akiva/downloads/tzidkat-docx-reader-sync-20261025.json');
  for (const item of [descriptor.documentInput,descriptor.documentApproval]) {
    validInfo(item); assert.deepEqual(info(local(repo,item.path)),onlyInfo(item),'Reviewed DOCX input or validation report changed');
  }
  const docxFile = descriptor.files.find(item => item.path === DOCX);
  assert.deepEqual(docxFile.after,onlyInfo(descriptor.documentInput));
  assert.deepEqual(descriptor.archives.map(item => item.path),[BOOK,LIBRARY]);
  for (const archive of descriptor.archives) {
    const target = descriptor.files.find(item => item.path === archive.path);
    assert.deepEqual(archive.before,target.before); assert.deepEqual(archive.after,target.after);
    assert.equal(archive.members.length,archive.entryCount);
    assert.equal(new Set(archive.members.map(item => item.path)).size,archive.entryCount);
    const changed = archive.members.filter(item => !same(item.before,item.after)).map(item => item.path);
    assert.deepEqual(changed,archive.changedMembers);
    assert.equal(archive.preservedEntries,archive.entryCount - changed.length);
    const allowedMembers = archive.path === LIBRARY ? new Set([DOCX_MEMBER]) : new Set([
      DOCX_MEMBER,'data/catalog.json','data/cited/tzidkat-hatzadik.json','data/parallels/tzidkat-hatzadik.json',
      'data/cited/index.json','data/parallels/index.json','data/parallels/words.json','connected-ideas/catalog.json',
    ]);
    for (const item of archive.members) { local('/tmp/download-member-check',item.path); validInfo(item.before); validInfo(item.after); }
    for (const name of changed) assert(allowedMembers.has(name),'Download refresh changes author data or another document');
    const document = archive.members.find(item => item.path === DOCX_MEMBER);
    if (archive.path === BOOK) assert(document,'The book download must contain its Word edition');
    if (document) { assert.deepEqual(document.before,docxFile.before); assert.deepEqual(document.after,docxFile.after); }
  }
  const expectedIndex = structuredClone(descriptor.downloadIndexBefore);
  const books = expectedIndex.books.filter(book => book.slug === 'tzidkat-hatzadik'); assert.equal(books.length,1);
  books[0].bytes = descriptor.files.find(item => item.path === BOOK).after.bytes;
  expectedIndex.library.bytes = descriptor.files.find(item => item.path === LIBRARY).after.bytes;
  assert.deepEqual(expectedIndex,descriptor.downloadIndexAfter,'Refresh changes another download record or content version');
  return {descriptor,descriptorSha256:pin};
}

// Called before older content gates receive terminalFiles. It returns null for
// the historical pre-refresh publication; a partial refresh fails explicitly.
export function verifyTzidkatDownloadRefresh({directory,batches,terminalFiles,independentFiles,sourcePublication=null,repo=REPO}) {
  const prepared = loadTzidkatDownloadRefresh(repo);
  if (!prepared) return null;
  const {descriptor,descriptorSha256} = prepared;
  const changed = descriptor.files.filter(item => !same(item.before,item.after));
  const actual = new Map(descriptor.files.map(item => [item.path,info(local(directory,item.path))]));
  if (!changed.some(item => same(actual.get(item.path),item.after))) return null;
  assert(changed.every(item => same(actual.get(item.path),item.after)),
    'Incomplete or superseded download refresh; do not waive historical content seals');
  assert.equal(batches.length,18,'Download refresh must follow all 18 reviewed content batches');
  assert(sourcePublication,'Final Word/ZIP refresh must include the requested Tosafot note4031');
  assert.equal(descriptor.sourceAddition.path,'sources/akiva/addenda/tzidkat-source-addition-006-transition-20261025.json');
  assert.equal(descriptor.sourceAddition.sha256,sourcePublication.descriptorSha256);
  assert.equal(descriptor.sourceAddition.packSha256,sourcePublication.packSha256);
  assert.equal(descriptor.sourceAddition.number,4031);
  assert.equal(batches.at(-1).prepared.packSha256,descriptor.predecessor.packSha256);
  assert.deepEqual(info(local(directory,descriptor.predecessor.path)),onlyInfo(descriptor.predecessor),
    'Download refresh is not descended from its exact independently verified content publication');
  for (const item of descriptor.files) {
    const prior = terminalFiles.get(item.path) || batches.at(-1).report.baselineFiles[item.path];
    assert.deepEqual(onlyInfo(prior),item.before,'Unknown download preimage in content seal: ' + item.path);
    assert.deepEqual(actual.get(item.path),item.after,'Sealed download transition differs');
  }
  for (const source of descriptor.sourceFiles) {
    assert.deepEqual(info(local(directory,source.path)),onlyInfo(source),'Download refresh used another reader/source version');
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(local(directory,INDEX))),descriptor.downloadIndexAfter);
  // Only exact authorized bytes are exposed to predecessor verifiers. Their
  // chapter, note, link, ledger, full-baseline, and ZIP chapter checks still run.
  for (const item of descriptor.files) {
    terminalFiles.set(item.path,{path:item.path,...item.after});
    independentFiles.set(item.path,item.after);
  }
  return {release:RELEASE,descriptorSha256,sourceAddition:sourcePublication.proof,document:descriptor.documentInput,
    documentCounts:descriptor.documentCounts,files:descriptor.files,
    authorTextUnchanged:true,existingNotesUnchanged:true,historicalReportsUnchanged:true};
}

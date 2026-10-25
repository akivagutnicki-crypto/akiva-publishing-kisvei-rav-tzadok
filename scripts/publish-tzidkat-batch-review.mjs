// Add reviewed original-source quotations in immutable batches over the current
// Pages publication. Existing notes, author text, other books and files remain
// byte-for-byte intact. Historical source packs are never rewritten.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {patchLocalSourcePreview} from './tzidkat-local-source-preview.mjs';
import {verifyTzidkatDownloadRefresh} from './tzidkat-download-refresh-transition.mjs';
import {prepareSourceAdditionTransition,verifySourceAdditionTerminal} from './tzidkat-source-addition-transition.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok';
export const SITE = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const PACK_DIRECTORY = path.join(REPO_ROOT, 'sources/akiva/overlays');
export function registeredPacks() {
  return fs.readdirSync(PACK_DIRECTORY).filter(name => /^tzidkat-batch-review-\d{3}-\d{3}-\d{8}\.json\.gz$/.test(name))
    .sort((a,b) => Number(a.match(/review-(\d+)/)[1]) - Number(b.match(/review-(\d+)/)[1]))
    .map(name => path.join(PACK_DIRECTORY,name));
}
export const DEFAULT_PACK = registeredPacks().at(-1) || path.join(PACK_DIRECTORY,'tzidkat-batch-review-001-015-20261023.json.gz');
export function batchNames(pack) {
  const match = /^(\d{8})-tzidkat-batch-(\d{3})-(\d{3})-v1$/.exec(pack.release || '');
  assert(match,'Invalid immutable batch release');
  const [,date,start,end] = match, first = Number(start), last = Number(end);
  assert(first >= 1 && last <= 264 && last >= first && last - first < 15 && (first - 1) % 15 === 0,'Invalid batch range');
  assert(last === Math.min(first + 14,264),'Every ois in the batch must be reviewed');
  return {first,last,report:'library/tzidkat-batch-review-' + start + '-' + end + '-' + date + '.json',
    ledger:'library/tzidkat-batch-review-' + start + '-' + end + '-ledger.json',artifact:'tzidkat-batch-' + start + '-' + end};
}
const SLUG = 'tzidkat-hatzadik';
const LINKS = 'library/data/' + SLUG + '/links.json';
const MCP = 'mcp-data/text/' + SLUG + '.json';
const ARCHIVES = ['library/downloads/rav-tzadok-library.zip', 'library/downloads/books/' + SLUG + '.zip'];
// This independently published ZIP repair occurred between batches 2 and 3.
// Its successful CI artifact authenticated all 5,218 files and changed only
// the Divrei ZIP and its byte count in the shared download index. Pin that
// concrete transition; do not waive seals for arbitrary future publications.
export const DIVREI_ZIP_REFRESH = Object.freeze({
  commit:'1afec77e2434baa963d11cca88c97a554715abec',runId:40015215082,
  evidenceArtifactId:12529055050,evidenceArtifactSha256:'dd4d51ab9568ad58b8a7acfdb9f8ed22f668cc74a95db2c1b1d1e07d847d7718',
  index:{path:'library/downloads/index.json',before:{bytes:4102,sha256:'b7a353797bc9152763cc75308f34711fe9ebb7aa5a6ec54c6058f9dc54477bd4'},after:{bytes:4103,sha256:'22af11e32dc75480a15947bb66cd913855886dea9396f7035aa1c7cc5104c50d'}},
  zip:{path:'library/downloads/books/divrei-soferim.zip',before:{bytes:693467,sha256:'bc54bb28204103dfc94caa3e2dc6a449a0b80852fd7f969d55c16df9e3355ae2'},after:{bytes:678319,sha256:'d4fea290699fd871ade6635ba069526f60a86f74e42e53cb451a592e8ec75df0'}},
});
const META = 'tzidkat-batch-publication.json';
const STATE = 'tzidkat-batch-baseline.json';
const argv = process.argv.slice(2);
const option = (key, fallback) => { const at = argv.indexOf(key); return at < 0 ? fallback : argv[at + 1]; };
const root = path.resolve(option('--root', 'dist'));
const packFile = path.resolve(option('--pack', DEFAULT_PACK));
export const sha = value => createHash('sha256').update(value).digest('hex');
export const digest = value => sha(JSON.stringify(value));
const jsonBytes = value => Buffer.from(JSON.stringify(value));
export function verifyDivreiZipRefresh({indexBytes,indexBefore,zipBefore,zipAfter}) {
  const known = DIVREI_ZIP_REFRESH;
  assert.deepEqual(indexBefore,known.index.before,'Unknown predecessor index for Divrei ZIP refresh');
  assert.deepEqual(zipBefore,known.zip.before,'Unknown predecessor Divrei ZIP');
  assert.deepEqual(zipAfter,known.zip.after,'Divrei ZIP differs from its independently verified publication');
  assert.deepEqual({bytes:indexBytes.length,sha256:sha(indexBytes)},known.index.after,'Download index differs from its independently verified publication');
  const previous = JSON.parse(indexBytes), entries = previous.books.filter(book => book.slug === 'divrei-soferim');
  assert.equal(entries.length,1); assert.equal(entries[0].bytes,known.zip.after.bytes);
  entries[0].bytes = known.zip.before.bytes;
  const reconstructed = jsonBytes(previous);
  assert.deepEqual({bytes:reconstructed.length,sha256:sha(reconstructed)},known.index.before,'Divrei refresh changed another download record');
  return known;
}
const read = (directory, name) => JSON.parse(fs.readFileSync(localFile(directory, name), 'utf8'));
const write = (directory, name, value) => { const file = localFile(directory, name); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, value instanceof Uint8Array ? value : jsonBytes(value)); };
const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',thinsp:' ',ensp:' ',emsp:' ',lrm:'',rlm:''};
export const decode = text => String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => entity[0] === '#' ? String.fromCodePoint(parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10)) : entities[entity.toLowerCase()] ?? match);
export const plain = text => decode(String(text ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
const strip = text => decode(String(text ?? '').replace(/<[^>]*>/g, ''));
export const sectionOf = file => 'Tzidkat HaTzadik ' + (Number(file.match(/\/(\d+)\.json$/)[1]) + 1);
export const notesOf = rows => rows.flatMap(row => (row.footnotes || []).map(note => ({row, note})));
const navigates = source => !source.citationOnly && !source.openExternal && source.ref;
const readerRef = source => source.readerRef || source.ref;
const sourceSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function localFile(directory, name) {
  assert(typeof name === 'string' && name && !path.isAbsolute(name) && !name.includes('\\') && name.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid publication path: ' + name);
  const base = path.resolve(directory), file = path.resolve(base, name);
  assert(file.startsWith(base + path.sep), 'Publication path escaped root'); return file;
}
export function fileInfo(file) {
  const handle = fs.openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try { assert(fs.fstatSync(handle).isFile()); for (;;) { const count = fs.readSync(handle, buffer, 0, buffer.length, null); if (!count) break; bytes += count; hash.update(buffer.subarray(0, count)); } }
  finally { fs.closeSync(handle); }
  return {bytes, sha256:hash.digest('hex')};
}
function inventory(directory, prefix = '', out = {}) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    assert(!entry.isSymbolicLink(), 'Unexpected symlink in publication');
    const name = prefix + entry.name, file = path.join(directory, entry.name);
    if (entry.isDirectory()) inventory(file, name + '/', out); else out[name] = fileInfo(file);
  }
  return out;
}

/** Validation is independent of any published state and runs before writes. */
export function validatePack(pack) {
  assert.equal(pack.schemaVersion, 1); const {first,last} = batchNames(pack);
  assert.deepEqual(pack.reviewedSections, Array.from({length:last-first+1}, (_, index) => first+index));
  assert.equal(pack.chapters?.length, last-first+1, 'Every ois in the complete batch must be reviewed');
  assert.deepEqual(Object.keys(pack.linksBefore || {}).sort(),pack.reviewedSections.map(n => 'Tzidkat HaTzadik ' + n).sort(),'Source-link scope must match exactly the reviewed batch');
  assert.equal(pack.audit?.completeReview, true); assert(Array.isArray(pack.audit.entries));
  for (const key of ['assets','ideaChanges','replacements']) assert(!pack[key]?.length, 'This release only adds native source notes: ' + key);
  const paths = new Set(), placements = new Set(), numbers = new Set(), sources = new Set(), additions = [];
  const previousPlacements = new Set(), previousNumbers = new Set(), previousSources = new Set();
  for (const file of pack.chapters) for (const {note} of notesOf(file.before)) { previousPlacements.add(note.placementId); previousNumbers.add(Number(note.number)); previousSources.add(note.sourceId); }
  for (const file of pack.chapters) {
    assert.match(file.path, /^library\/data\/tzidkat-hatzadik\/\d+\.json$/);
    assert(pack.reviewedSections.includes(Number(file.path.match(/\/(\d+)\.json$/)[1])+1),'Chapter outside reviewed batch');
    assert(!paths.has(file.path), 'Repeated chapter'); paths.add(file.path);
    assert(Array.isArray(file.before) && Array.isArray(file.after)); assert.equal(digest(file.before), file.beforeSha256, 'Incorrect chapter preimage hash');
    const old = new Map(notesOf(file.before).map(({row,note}) => [note.placementId, {row:row.n,note}]));
    const retained = structuredClone(file.after);
    for (const row of retained) if (row.footnotes) {
      row.footnotes = row.footnotes.filter(note => old.has(note.placementId));
      const beforeRow = file.before.find(item => item.n === row.n);
      if (!row.footnotes.length && !Object.hasOwn(beforeRow || {}, 'footnotes')) delete row.footnotes;
    }
    assert.deepEqual(retained, file.before, 'Existing note, author text, anchor, or order changed: ' + file.path);
    assert.equal(digest(retained),file.beforeSha256,'Existing serialized chapter content changed: ' + file.path);
    for (const {row,note} of notesOf(file.after)) {
      assert(!placements.has(note.placementId), 'Duplicate note placement'); placements.add(note.placementId);
      if (old.has(note.placementId)) continue;
      assert(!previousPlacements.has(note.placementId) && !previousSources.has(note.sourceId) && !previousNumbers.has(Number(note.number)), 'Addition reuses an existing identity');
      assert(typeof note.sourceId === 'string' && note.sourceId && !sources.has(note.sourceId)); sources.add(note.sourceId);
      assert(Number.isSafeInteger(note.number) && note.number > 0 && !numbers.has(note.number)); numbers.add(note.number);
      assert(Number.isSafeInteger(note.phraseIndex) && row.p?.[note.phraseIndex], 'New note has no Hebrew anchor');
      const he = strip(row.p[note.phraseIndex][0]);
      assert(typeof note.heAnchorPrefix === 'string' && note.heAnchorPrefix.length && he.startsWith(note.heAnchorPrefix), 'New note has an inexact Hebrew anchor');
      assert.equal(note.heCharOffset, note.heAnchorPrefix.length, 'New note Hebrew offset differs');
      assert(note.paragraphs?.length && note.paragraphs.every(p => typeof p.text === 'string' && p.text.trim()), 'Empty source quotation');
      for (const p of note.paragraphs) {
        assert.doesNotMatch(p.text, /Biur\s*(?:Me|Mi)shulav|Ne[’']?im(?:ot|os|us|ut)(?:\s*HaTzedek)?|supplied\s+commentaries|invoked\s+by\s+the\s+commentaries|ביאור\s+משולב|נעימות\s+הצדק/i, 'Secondary commentary attribution remains visible');
        if (p.rich) assert.equal(p.rich.map(run => run.text).join(''), p.text, 'Rich quotation differs');
      }
      assert(note.sources?.length && note.sources.every(s => s.ref && (s.url || s.citationOnly === true)), 'Missing original-source citation');
      for (const source of note.sources) {
        if (source.citationOnly) assert(!source.url && !source.readerRef && !source.connectionsUrl, 'Citation-only source must not invent a link');
        if (source.url) {
          assert(!source.url.startsWith(SITE + 'library/#/read/'),'Internal source links must use the reader-supported #/read/ route');
          assert(note.paragraphs.some(p => (p.rich || []).some(run => run.bold && run.text === source.ref && run.href === source.url)), 'Original-source URL is missing from the bold citation');
        }
        assert(note.paragraphs.some(p => (p.rich || []).some(run => run.bold && run.text === source.ref)), 'Original source needs a bold citation');
      }
      const entry = pack.audit.entries.find(item => item.placementId === note.placementId);
      assert(entry?.status === 'verified', 'New source lacks completed review: ' + note.placementId);
      assert(entry.sourceEvidence?.length && entry.sourceEvidence.every(e => e.ref && /[א-ת]/.test(e.he || '') && /[A-Za-z]/.test(e.en || '')), 'Missing checked Hebrew and original English source evidence');
      additions.push({sectionRef:sectionOf(file.path), originRef:sectionOf(file.path) + ':' + row.n, row:row.n, note});
    }
    const beforeLinks = pack.linksBefore?.[sectionOf(file.path)];
    assert(Array.isArray(beforeLinks) && beforeLinks.every(edge => edge.a?.startsWith(sectionOf(file.path) + ':') && edge.r), 'Missing exact source-link preimage');
  }
  assert(additions.length, 'No new notes in batch');
  validateExternalSourceUrls(pack,additions);
  return additions;
}

// Some original works are available only on these primary-text sites. Enable
// individual reviewed destinations, never a domain-wide runtime permission.
const additionalExactPrimaryUrls = new Set([
  'https://or-breslev.co.il/wp-content/uploads/%D7%9E%D7%A2%D7%A9%D7%99-%D7%94%D7%A9%D7%9D-%D7%97%D7%9C%D7%A7-%D7%90-%D7%94%D7%A8%D7%91-%D7%90%D7%9C%D7%99%D7%A2%D7%96%D7%A8-%D7%90%D7%A9%D7%9B%D7%A0%D7%96%D7%99-%D7%91%D7%9F-%D7%A8%D7%91%D7%99-%D7%90%D7%9C%D7%99%D7%94-%D7%94%D7%A8%D7%95%D7%A4%D7%90.pdf#page=277',
  'https://mobile.tora.ws/html/15061-27.html',
  'https://mobile.tora.ws/html/15061-30.html',
  'https://www.daat.ac.il/daat/vl/sidurshabat/sidurshabat14.pdf#page=14',
  'https://search.orhasulam.org/Document/%D7%94%D7%9C%D7%90-%D7%9C%D7%90%D7%9C%D7%A7%D7%99%D7%9D-%D7%A4%D7%AA%D7%A8%D7%95%D7%A0%D7%99%D7%9D?id=43981&view=doc',
  'https://search.orhasulam.org/Document/%D7%95%D7%99%D7%94%D7%99-%D7%90%D7%97%D7%A8-%D7%94%D7%93%D7%91%D7%A8%D7%99%D7%9D-%D7%94%D7%90%D7%9C%D7%94-%D7%95%D7%9B%D7%95%27?id=43965&view=doc',
]);
export function validateExternalSourceUrls(pack,additions) {
  const declared = pack.verifiedExternalUrls || [];
  assert(Array.isArray(declared),'Verified external URLs must be an exact list');
  const seen = new Set();
  for (const item of declared) {
    assert(typeof item.url === 'string' && (/^https:\/\/wiki\.jewishbooks\.org\.il\/mediawiki\/(?:wiki\/|index\.php\?)/.test(item.url) || additionalExactPrimaryUrls.has(item.url))
      && !/[<>\s\\]/.test(item.url),'Unsupported exact primary-source URL');
    assert(!seen.has(item.url),'Repeated exact primary-source URL'); seen.add(item.url);
    const added = additions.find(entry => entry.note.placementId === item.placementId);
    assert(added?.note.sources.some(source => source.url === item.url && source.ref === item.ref && source.openExternal === true),'Exact URL is not a declared new original source');
    const audit = pack.audit.entries.find(entry => entry.placementId === item.placementId);
    const evidence = audit?.sourceEvidence.find(entry => entry.ref === item.ref && entry.url === item.url
      && entry.he === added.note.reviewedSourceExcerpt?.he && entry.en === added.note.reviewedSourceExcerpt?.en);
    assert(evidence && audit.status === 'verified','Exact URL lacks matching reviewed bilingual source evidence');
    assert.equal(item.evidenceSha256,digest({ref:evidence.ref,url:evidence.url,he:evidence.he,en:evidence.en}),'Exact URL source evidence changed');
  }
  for (const {note} of additions) for (const source of note.sources) if (/^https:\/\/(?:wiki\.jewishbooks\.org\.il|mobile\.tora\.ws|www\.daat\.ac\.il|search\.orhasulam\.org|or-breslev\.co\.il)\//.test(source.url || '')) {
    assert(seen.has(source.url),'Primary-source URL needs its exact reviewed declaration');
  }
  return declared;
}
const externalSourceList = /\/\* Verified primary source URLs \*\/ (\[[^\n]*\])\.includes\(String\(url \|\| ''\)\)/g;
export function addVerifiedSourceUrls(html,declared) {
  if (!declared.length) return html;
  const matches = [...html.matchAll(externalSourceList)]; assert.equal(matches.length,1,'Reader exact source-URL list is missing or ambiguous');
  const original = JSON.parse(matches[0][1]); assert(Array.isArray(original) && original.every(url => typeof url === 'string'));
  const added = declared.map(item => item.url).filter(url => !original.includes(url));
  if (!added.length) return html;
  const list = matches[0][1].slice(0,-1) + (original.length ? ',' : '') + added.map(url => JSON.stringify(url)).join(',') + ']';
  return html.replace(externalSourceList,() => "/* Verified primary source URLs */ " + list + ".includes(String(url || ''))");
}

export function loadPack(filename = packFile) {
  const bytes = fs.readFileSync(filename), pin = fs.readFileSync(filename + '.sha256', 'utf8').trim();
  assert.match(pin, /^[a-f0-9]{64}$/); assert.equal(sha(bytes), pin, 'Reviewed batch package changed');
  const pack = JSON.parse(filename.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  const names = batchNames(pack);
  if (path.dirname(path.resolve(filename)) === PACK_DIRECTORY) assert.equal(path.basename(filename),path.basename(names.report) + '.gz','Immutable batch filename disagrees with release');
  return {pack, packSha256:pin, additions:validatePack(pack), names, filename:path.resolve(filename)};
}

export function expectedLinks(pack, additions = validatePack(pack)) {
  const result = structuredClone(pack.linksBefore);
  for (const item of additions) for (const source of item.note.sources.filter(navigates)) {
    const edges = result[item.sectionRef], ref = readerRef(source);
    if (!edges.some(edge => edge.a === item.originRef && edge.r === ref)) edges.push({a:item.originRef,r:ref,c:source.category || 'Other',kind:'Verified original-source quotation'});
  }
  return result;
}
const noteProjection = note => [String(note.number), note.paragraphs.map(p => plain(p.text)).concat(note.sources.filter(s => s.readerRef || s.openExternal).map(s => s.readerRef ? 'Reader location: ' + s.readerRef + '; original source citation: ' + s.ref + ' — ' + s.url : 'Original source: ' + s.url)).join('\n'), note.phraseIndex, 'h', note.heCharOffset];
const liveGuards = pack => [...new Set(['index.html','library/index.html','library/sw.js','library/data/files.json','library/data/catalog.json','library/data/cited/index.json','mcp-data/catalog.json','library/connected-ideas/catalog.json',...pack.chapters.map(file => file.path)])];

async function github(route) {
  const headers = {Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const response = await fetch('https://api.github.com/repos/' + REPO + route, {headers,signal:AbortSignal.timeout(60000)});
  assert(response.ok, 'GitHub metadata ' + response.status + ' ' + route); return response.json();
}
export async function bytesPublic(name, base = SITE) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = new URL(name, base); url.searchParams.set('tzidkat_batch_verify', String(Date.now()));
    let response;
    try {
      response = await fetch(url, {cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(60000)});
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    if (!response.ok && (response.status === 429 || response.status >= 500) && attempt < 3) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    assert(response.ok, 'Public file ' + response.status + ' ' + name);
    return Buffer.from(await response.arrayBuffer());
  }
}
async function mapLimited(items, callback, concurrency = 4) {
  const results = []; let next = 0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)}, async () => { for (;;) { const at = next++; if (at >= items.length) break; results[at] = await callback(items[at], at); } }));
  return results;
}
async function currentPublication() {
  const publishers = new Map();
  for (const name of fs.readdirSync(path.join(REPO_ROOT, '.github/workflows')).filter(n => n.endsWith('.yml'))) {
    let label = ''; const labels = [];
    for (const line of fs.readFileSync(path.join(REPO_ROOT,'.github/workflows',name),'utf8').split('\n')) { if (line.trimStart().startsWith('- name:')) label = line.split('- name:')[1].trim(); if (line.includes('uses: actions/deploy-pages@')) { assert(label); labels.push(label); } }
    if (labels.length) publishers.set('.github/workflows/' + name, labels);
  }
  const candidates = [];
  for (let page = 1; page <= 3 && !candidates.length; page++) {
    const runs = (await github('/actions/runs?branch=main&per_page=100&page=' + page)).workflow_runs;
    await mapLimited(runs.filter(run => ((String(run.id) !== process.env.GITHUB_RUN_ID && run.status === 'completed') || (String(run.id) === process.env.GITHUB_RUN_ID && Number(process.env.GITHUB_RUN_ATTEMPT) > 1)) && run.conclusion !== 'skipped' && publishers.has(run.path)), async run => {
      // A deployment remains live when a later verification step or rerun fails.
      // Include old attempts, while excluding this attempt's own deployment.
      const jobs = (await github('/actions/runs/' + run.id + '/jobs?filter=all&per_page=100')).jobs;
      const priorJobs = jobs.filter(job => String(run.id) !== process.env.GITHUB_RUN_ID || job.run_attempt < Number(process.env.GITHUB_RUN_ATTEMPT));
      const steps = priorJobs.flatMap(job => job.steps || []).filter(step => publishers.get(run.path).includes(step.name) && step.conclusion === 'success');
      if (steps.length) candidates.push({run,completedAt:steps.map(s => s.completed_at).sort().at(-1)});
    });
  }
  assert(candidates.length, 'No actual completed Pages deployment found; refusing an old rebuild');
  candidates.sort((a,b) => b.completedAt.localeCompare(a.completedAt)); const {run,completedAt} = candidates[0];
  const artifacts = (await github('/actions/runs/' + run.id + '/artifacts?per_page=100')).artifacts;
  const artifact = artifacts.filter(a => a.name === 'github-pages' && !a.expired && a.created_at <= completedAt).sort((a,b) => b.created_at.localeCompare(a.created_at))[0];
  assert(artifact, 'Current publication artifact unavailable');
  return {runId:run.id,headSha:run.head_sha,artifactId:artifact.id,digest:artifact.digest,bytes:artifact.size_in_bytes,deployedAt:completedAt};
}
async function branchGuard(expected) {
  assert(/^[a-f0-9]{40}$/.test(expected || ''), 'An exact main commit is required');
  assert.equal((await github('/git/ref/heads/main')).object.sha, expected, 'Main advanced; preserve intervening work');
}
async function metadata() {
  const {pack,packSha256,additions} = loadPack(); await branchGuard(process.env.GITHUB_SHA);
  const publication = await currentPublication();
  write(REPO_ROOT, META, {expectedHead:process.env.GITHUB_SHA,publication,packSha256});
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'artifact=' + publication.artifactId + '\nrun=' + publication.runId + '\n');
  console.log(JSON.stringify({publication,release:pack.release,newNotes:additions.length}));
}

function checkPreimages(directory, prepared, allowAfter = false) {
  const {pack,additions} = prepared, links = read(directory,LINKS), afterLinks = expectedLinks(pack,additions);
  for (const file of pack.chapters) {
    const actual = digest(read(directory,file.path));
    assert(actual === file.beforeSha256 || allowAfter && actual === digest(file.after), 'Overlapping chapter changed: ' + file.path);
    const ref = sectionOf(file.path), current = digest(links[ref]);
    assert(current === digest(pack.linksBefore[ref]) || allowAfter && current === digest(afterLinks[ref]), 'Overlapping source links changed: ' + ref);
  }
  const wanted = new Map(additions.map(item => [item.note.placementId,item]));
  const numbers = new Map(), sourceIds = new Map(), placements = new Set();
  for (let i = 0; i < 264; i++) for (const {row,note} of notesOf(read(directory,'library/data/' + SLUG + '/' + i + '.json'))) {
    assert(!placements.has(note.placementId), 'Existing duplicate placement'); placements.add(note.placementId);
    // Existing editions may reuse source identities for distinct placements;
    // an added identity or number must not collide with any such occurrence.
    const claimed = wanted.get(note.placementId);
    if (claimed) { assert(allowAfter && claimed.row === row.n && claimed.sectionRef === 'Tzidkat HaTzadik ' + (i+1)); assert.deepEqual(note,claimed.note); }
    else { numbers.set(Number(note.number),note.placementId); sourceIds.set(note.sourceId,note.placementId); }
  }
  for (const {note} of additions) { assert(!numbers.has(note.number), 'New note number already in use: ' + note.number); assert(!sourceIds.has(note.sourceId), 'New source identity already in use'); }
  const ideas = read(directory,'library/connected-ideas/catalog.json');
  for (const record of ideas.records || []) for (const [key,refKey] of [['footnoteNumber','originRef'],['reverseFootnoteNumber','targetRef']]) if (record[key] != null && record[refKey]?.startsWith('Tzidkat HaTzadik ')) assert(!additions.some(item => item.note.number === Number(record[key])), 'New note collides with a connected note number');
  return afterLinks;
}
async function guard(state) {
  const {pack,packSha256} = loadPack(); assert.equal(state.packSha256,packSha256);
  await branchGuard(state.expectedHead); const publication = await currentPublication();
  assert.equal(publication.artifactId,state.publication.artifactId,'A newer site was published; use that complete artifact');
  await mapLimited(liveGuards(pack), async name => assert.equal(sha(await bytesPublic(name)),state.files[name]?.sha256,'Public baseline changed: ' + name));
  console.log('Current main and public baseline match the complete preserved artifact.');
}
async function capture() {
  const prepared = loadPack(), state = read(REPO_ROOT,META); assert.equal(state.packSha256,prepared.packSha256);
  requirePriorBatches(root,prepared);
  state.alreadyPublished = fs.existsSync(localFile(root,prepared.names.report));
  if (state.alreadyPublished) {
    const verified = verifyBatchChain({directory:root,verifyAllBaseline:true});
    assert.equal(verified.batches.at(-1).packSha256,prepared.packSha256,'A different batch is already published');
    checkPreimages(root,prepared,true);
  } else checkPreimages(root,prepared);
  state.files = inventory(root); await guard(state); write(REPO_ROOT,STATE,state);
  console.log(JSON.stringify({capturedFiles:Object.keys(state.files).length,newNotes:prepared.additions.length,alreadyPublished:state.alreadyPublished}));
}

function dataManifest(entries) {
  const names = Object.keys(entries).filter(n => n.startsWith('data/') && n !== 'data/files.json').sort();
  const hash = createHash('sha256'); let bytes = 0;
  for (const name of names) { hash.update(name.slice(5)).update('\0').update(entries[name]); bytes += entries[name].length; }
  return {version:hash.digest('hex').slice(0,16),bytes,files:names.map(n => n.slice(5))};
}
function dataEntries(directory, prefix = 'data/', relative = 'library/data/') {
  const out = {};
  const walk = (dir, key) => { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { assert(!entry.isSymbolicLink()); const file = path.join(dir,entry.name),name = key + entry.name; if (entry.isDirectory()) walk(file,name + '/'); else out[name] = fs.readFileSync(file); } };
  walk(localFile(directory,relative.replace(/\/$/,'')),prefix); return out;
}

/** Build every changed byte in memory before modifying the site. */
export function planPublication(directory, prepared, {publicationNames=null,zipMtime=null}={}) {
  const {pack,packSha256,additions} = prepared, names = publicationNames || batchNames(pack);
  const linksAfter = checkPreimages(directory,prepared), changes = new Map();
  const put = (name,value) => { const bytes = value instanceof Uint8Array ? Buffer.from(value) : jsonBytes(value); const file = localFile(directory,name); if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== sha(bytes)) changes.set(name,bytes); };
  for (const file of pack.chapters) if (digest(file.after) !== file.beforeSha256) put(file.path,file.after);
  const links = read(directory,LINKS); for (const [ref,edges] of Object.entries(linksAfter)) links[ref] = edges; put(LINKS,links);
  const newEdges = Object.entries(linksAfter).flatMap(([ref,edges]) => edges.slice(pack.linksBefore[ref].length));
  const reverseFiles = new Map(), reverse = read(directory,'mcp-data/cited.json');
  for (const edge of newEdges) {
    const filename = 'library/data/cited/' + sourceSlug(edge.r) + '.json'; assert(sourceSlug(edge.r));
    if (!reverseFiles.has(filename)) reverseFiles.set(filename,fs.existsSync(localFile(directory,filename)) ? read(directory,filename) : {});
    for (const object of [reverseFiles.get(filename),reverse]) { const owners = object[edge.r] ??= []; if (!owners.includes(edge.a)) owners.push(edge.a); }
  }
  for (const [name,value] of reverseFiles) put(name,value); put('mcp-data/cited.json',reverse);
  const reverseIndex = read(directory,'library/data/cited/index.json');
  put('library/data/cited/index.json',[...new Set([...reverseIndex,...[...reverseFiles.keys()].map(n => path.basename(n,'.json'))])].sort());
  const sources = read(directory,'library/data/packs/sources.json');
  sources.refs = [...new Set([...sources.refs,...newEdges.map(edge => edge.r)])].sort(); put('library/data/packs/sources.json',sources);
  const mcp = read(directory,MCP);
  for (const item of additions) {
    const para = mcp.paras.find(p => p.r === item.originRef); assert(para,'New note has no MCP paragraph');
    assert(!(para.f || []).some(note => String(note[0]) === String(item.note.number)),'New number already in MCP');
    (para.f ??= []).push(noteProjection(item.note));
    for (const source of item.note.sources.filter(navigates)) (para.a ??= {})[readerRef(source)] ??= ['n',String(item.note.number)];
  }
  for (const edge of newEdges) { const para = mcp.paras.find(p => p.r === edge.a); assert(para); (para.c ??= []).push([edge.r,edge.c || '']); }
  put(MCP,mcp);
  const revision = pack.release + '-' + packSha256.slice(0,12), marker = 'const editionDataUrl = url => ';
  let html = fs.readFileSync(localFile(directory,'library/index.html'),'utf8'); assert.equal(html.split(marker).length,2); assert(!html.includes('/* ' + pack.release + ' */'));
  html = addVerifiedSourceUrls(html,pack.verifiedExternalUrls || []);
  if (pack.release === '20261025-tzidkat-batch-256-264-v1') html = patchLocalSourcePreview(html);
  html = html.replace(marker,marker + "/* " + pack.release + " */ (url.startsWith('data/tzidkat-hatzadik/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?batch=" + revision + "' :\n");
  put('library/index.html',Buffer.from(html));
  let sw = fs.readFileSync(localFile(directory,'library/sw.js'),'utf8'); assert.equal((sw.match(/const SHELL = `[^`]+`;/g)||[]).length,1);
  sw = sw.replace(/const SHELL = `([^`]+)`;/, (_all,key) => 'const SHELL = `' + key + '-tzidkat-batch-' + packSha256.slice(0,12) + '`;'); put('library/sw.js',Buffer.from(sw));
  const data = dataEntries(directory); for (const [name,bytes] of changes) if (name.startsWith('library/data/')) data[name.slice(8)] = bytes;
  const manifest = dataManifest(data); data['data/files.json'] = jsonBytes(manifest); put('library/data/files.json',manifest);
  const require = createRequire(import.meta.url), {zipSync,unzipSync} = require(localFile(directory,'library/vendor/fflate.min.js'));
  const archives = [];
  for (const name of ARCHIVES) {
    const old = unzipSync(fs.readFileSync(localFile(directory,name))), next = {...old}, book = name.includes('/books/');
    // Replace only this release's changed data entries. Retain archive-only
    // entries and every unrelated ZIP entry exactly, including their payload.
    for (const [filename,bytes] of changes) if (filename.startsWith('library/data/')) {
      const relative = filename.slice(8); if (!book || relative.startsWith('data/' + SLUG + '/')) next[relative] = bytes;
    }
    if (!book) next['data/files.json'] = jsonBytes(dataManifest(next));
    const output = zipSync(next,{level:6,...(zipMtime ? {mtime:zipMtime} : {})}), check = unzipSync(output);
    assert.deepEqual(Object.keys(check).sort(),Object.keys(next).sort());
    for (const [filename,bytes] of Object.entries(next)) assert.equal(sha(check[filename]),sha(bytes),'ZIP payload differs');
    archives.push({path:name,...{bytes:output.length,sha256:sha(output)},dataFiles:Object.keys(next).filter(n => n.startsWith('data/')).length,preservedEntries:Object.keys(old).filter(n => sha(old[n]) === sha(next[n])).length}); put(name,output);
  }
  const downloads = read(directory,'library/downloads/index.json'); downloads.version = manifest.version;
  for (const item of archives) { const entry = item.path.includes('/books/') ? downloads.books.find(b => b.slug === SLUG) : downloads.library; assert(entry); entry.bytes = item.bytes; entry.dataFiles = item.dataFiles; } put('library/downloads/index.json',downloads);
  const catalog = read(directory,'mcp-data/catalog.json'); catalog.version = manifest.version; put('mcp-data/catalog.json',catalog);
  if (names.ledger) put(names.ledger,pack.audit);
  return {changes,archives,linksAfter,additions,version:manifest.version};
}

function permitted(name, prepared) {
  return prepared.pack.chapters.some(file => file.path === name)
    || /^library\/data\/cited\/[^/]+\.json$/.test(name)
    || [LINKS,MCP,batchNames(prepared.pack).report,batchNames(prepared.pack).ledger,'mcp-data/cited.json','mcp-data/catalog.json','library/data/packs/sources.json','library/index.html','library/sw.js','library/data/files.json','library/downloads/index.json',...ARCHIVES].includes(name);
}
export function applyPublication(directory, prepared, state) {
  const before = inventory(directory); assert.deepEqual(before,state.files,'Site changed after capture');
  const plan = planPublication(directory,prepared);
  for (const name of plan.changes.keys()) assert(permitted(name,prepared),'Change outside authorized batch: ' + name);
  const report = {schemaVersion:1,release:prepared.pack.release,packSha256:prepared.packSha256,completeReview:true,reviewedSections:prepared.pack.reviewedSections,newNotes:plan.additions.length,existingNotesUnchanged:true,authorTextUnchanged:true,
    operations:plan.additions.map(item => ({sectionRef:item.sectionRef,originRef:item.originRef,placementId:item.note.placementId,sourceId:item.note.sourceId,number:item.note.number})),
    linkChanges:Object.entries(plan.linksAfter).map(([sectionRef,after]) => ({sectionRef,beforeSha256:digest(prepared.pack.linksBefore[sectionRef]),after})),
    offline:plan.archives,baselineArtifact:state.publication || null,baselineFiles:before,changedFiles:[...plan.changes].map(([name,bytes]) => ({path:name,bytes:bytes.length,sha256:sha(bytes)})),
    verification:{ok:true,release:prepared.pack.release,packSha256:prepared.packSha256,existingNotesUnchanged:true,authorTextUnchanged:true,unrelatedFilesUnchanged:true}};
  // The complete plan and its invariants have passed; now write the approved
  // files. A failure aborts publication, and the baseline artifact is untouched.
  for (const [name,bytes] of plan.changes) write(directory,name,bytes);
  write(directory,batchNames(prepared.pack).report,report);
  verifyBatchSuccessor({directory,prepared,verifyAllBaseline:true});
  return report;
}

/** Exact terminal overlay for older preservation gates; no ignored fields. */
export function verifyBatchSuccessor({directory=root,prepared=loadPack(DEFAULT_PACK),verifyAllBaseline=false,terminalFiles=null,archiveChapters=null,independentFiles=new Map(),terminalChapters=new Map(),terminalLinks=new Map()} = {}) {
  const {pack,packSha256,additions} = prepared, REPORT = batchNames(pack).report, report = read(directory,REPORT);
  assert.equal(report.schemaVersion,1); assert.equal(report.release,pack.release); assert.equal(report.packSha256,packSha256);
  assert.equal(report.completeReview,true); assert.equal(report.verification?.ok,true);
  assert.equal(report.verification.release,pack.release); assert.equal(report.verification.packSha256,packSha256);
  assert.deepEqual(read(directory,batchNames(pack).ledger),pack.audit,'Published source review ledger differs from the checked pack');
  assert.equal(report.newNotes,additions.length); assert.deepEqual(report.reviewedSections,pack.reviewedSections);
  assert.deepEqual(report.operations,additions.map(item => ({sectionRef:item.sectionRef,originRef:item.originRef,placementId:item.note.placementId,sourceId:item.note.sourceId,number:item.note.number})));
  const files = new Map();
  for (const item of report.changedFiles) { assert(permitted(item.path,prepared) && item.path !== REPORT && !files.has(item.path),'Invalid batch seal path'); assert.match(item.sha256,/^[a-f0-9]{64}$/); const terminal = terminalFiles?.get(item.path) || item; assert.deepEqual(fileInfo(localFile(directory,item.path)),{bytes:terminal.bytes,sha256:terminal.sha256},'Batch seal differs: ' + item.path); files.set(item.path,item); }
  const linksAfter = expectedLinks(pack,additions), links = read(directory,LINKS);
  assert.deepEqual(report.linkChanges,Object.entries(linksAfter).map(([sectionRef,after]) => ({sectionRef,beforeSha256:digest(pack.linksBefore[sectionRef]),after})));
  for (const file of pack.chapters) { assert.equal(digest(read(directory,file.path)),digest(terminalChapters.get(file.path) || file.after),'Batch chapter differs'); assert.deepEqual(links[sectionOf(file.path)],terminalLinks.get(sectionOf(file.path)) || linksAfter[sectionOf(file.path)],'Batch source links differ'); }
  const mcp = read(directory,MCP), cited = read(directory,'mcp-data/cited.json');
  for (const item of additions) {
    const para = mcp.paras.find(p => p.r === item.originRef); assert(para);
    assert.deepEqual((para.f || []).filter(note => String(note[0]) === String(item.note.number)),[noteProjection(item.note)],'New MCP note missing or changed');
    for (const source of item.note.sources.filter(navigates)) { const ref = readerRef(source); assert(para.a?.[ref],'New MCP source anchor missing'); assert((para.c || []).some(edge => edge[0] === ref),'MCP citation missing'); assert(cited[ref]?.includes(item.originRef)); assert(read(directory,'library/data/cited/' + sourceSlug(ref) + '.json')[ref]?.includes(item.originRef)); }
  }
  if (verifyAllBaseline) {
    const after = inventory(directory), before = report.baselineFiles; assert(before && Object.keys(before).length);
    for (const [name,info] of Object.entries(before)) { assert(after[name],'Original site file removed'); if (!files.has(name) && name !== REPORT) assert.deepEqual(after[name],independentFiles.get(name) || info,'Unrelated site file changed: ' + name); }
    for (const name of Object.keys(after)) assert(before[name] || files.has(name) || name === REPORT || independentFiles.has(name),'Unexpected new site file: ' + name);
    const manifest = dataManifest(dataEntries(directory)); assert.deepEqual(read(directory,'library/data/files.json'),manifest);
    assert.equal(read(directory,'library/downloads/index.json').version,manifest.version); assert.equal(read(directory,'mcp-data/catalog.json').version,manifest.version);
    const require = createRequire(import.meta.url), {unzipSync} = require(localFile(directory,'library/vendor/fflate.min.js'));
    for (const archive of report.offline) { const raw = fs.readFileSync(localFile(directory,archive.path)); const expected = terminalFiles?.get(archive.path) || archive; assert.equal(raw.length,expected.bytes); assert.equal(sha(raw),expected.sha256); const entries = unzipSync(raw); for (const file of archiveChapters || pack.chapters) assert.equal(digest(JSON.parse(Buffer.from(entries[file.path.slice(8)]).toString())),digest(file.after),'ZIP chapter differs'); }
  }
  return {pack,packSha256,additions,report,files,linksAfter,proof:{release:pack.release,packSha256,newNotes:additions.length,reviewedSections:pack.reviewedSections.length,existingNotesUnchanged:true,authorTextUnchanged:true}};
}

/** Authenticate every published immutable pack before accepting a later seal. */
export function hasPublishedBatches(directory) {
  return registeredPacks().some(filename => fs.existsSync(localFile(directory,loadPack(filename).names.report)));
}
export function verifyBatchChain({directory=root,verifyAllBaseline=false,packFiles=registeredPacks()} = {}) {
  const registered = packFiles.map(filename => loadPack(filename)), batches = [];
  let missing = false, next = 1;
  for (const prepared of registered) {
    assert.equal(prepared.names.first,next,'Immutable batches must cover consecutive ois without overlap'); next = prepared.names.last + 1;
    if (!fs.existsSync(localFile(directory,prepared.names.report))) { missing = true; continue; }
    assert(!missing,'Published batch is missing its predecessor');
    const report = read(directory,prepared.names.report);
    assert.equal(report.release,prepared.pack.release); assert.equal(report.packSha256,prepared.packSha256);
    for (const item of report.changedFiles || []) assert(permitted(item.path,prepared) && item.path !== prepared.names.report,'Unrelated batch seal');
    batches.push({prepared,report});
  }
  assert(batches.length,'No published immutable batches found');
  const terminalFiles = new Map();
  for (const {report} of batches) for (const item of report.changedFiles) terminalFiles.set(item.path,item);
  const independentFiles = new Map(), known = DIVREI_ZIP_REFRESH, expectedIndex = terminalFiles.get(known.index.path);
  let independentPublication = null;
  if (expectedIndex?.sha256 === known.index.before.sha256 && fileInfo(localFile(directory,known.index.path)).sha256 !== expectedIndex.sha256) {
    independentPublication = verifyDivreiZipRefresh({
      indexBytes:fs.readFileSync(localFile(directory,known.index.path)),
      indexBefore:{bytes:expectedIndex.bytes,sha256:expectedIndex.sha256},
      zipBefore:batches.at(-1).report.baselineFiles[known.zip.path],
      zipAfter:fileInfo(localFile(directory,known.zip.path)),
    });
    terminalFiles.set(known.index.path,{path:known.index.path,...known.index.after});
    independentFiles.set(known.zip.path,known.zip.after);
  }
  const sourcePublication = prepareSourceAdditionTransition({directory,batches,terminalFiles,independentFiles});
  const downloadPublication = verifyTzidkatDownloadRefresh({directory,batches,terminalFiles,independentFiles,sourcePublication});
  verifySourceAdditionTerminal({directory,sourcePublication,terminalFiles});
  const terminalChapters = sourcePublication?.chapterAfters || new Map(), terminalLinks = sourcePublication?.linkAfters || new Map();
  const chapters = batches.flatMap(({prepared}) => prepared.pack.chapters).map(file => terminalChapters.has(file.path) ? {...file,after:terminalChapters.get(file.path)} : file);
  const verified = batches.map(({prepared},index) => verifyBatchSuccessor({directory,prepared,terminalFiles,
    verifyAllBaseline:verifyAllBaseline && index === batches.length-1,archiveChapters:chapters,independentFiles,terminalChapters,terminalLinks}));
  // A successor may advance shared exports, but must preserve earlier chapter
  // bytes, original report bytes and ledgers in its captured full baseline.
  for (let index = 1; index < batches.length; index++) {
    const before = batches[index].report.baselineFiles;
    for (const prior of verified.slice(0,index)) {
      for (const file of prior.pack.chapters) assert.deepEqual(before[file.path],sourcePublication?.chapterPreimages.get(file.path) || fileInfo(localFile(directory,file.path)),'Later batch did not preserve its predecessor chapter');
      for (const name of [batchNames(prior.pack).report,batchNames(prior.pack).ledger]) assert.deepEqual(before[name],fileInfo(localFile(directory,name)),'Later batch replaced an immutable predecessor audit');
    }
  }
  return {batches:verified,files:terminalFiles,independentFiles,additions:verified.flatMap(b => b.additions),
    pack:{chapters,linksBefore:Object.assign({},...verified.map(b => b.pack.linksBefore))},
    report:{linkChanges:verified.flatMap(b => b.report.linkChanges).map(item => terminalLinks.has(item.sectionRef) ? {...item,after:terminalLinks.get(item.sectionRef)} : item)},
    proof:{batches:verified.map(b => b.proof),reviewedSections:chapters.length,newNotes:verified.reduce((n,b)=>n+b.additions.length,0),existingNotesUnchanged:true,authorTextUnchanged:true,...(independentPublication ? {independentPublication} : {}),...(sourcePublication ? {sourceAddition:sourcePublication.proof} : {}),...(downloadPublication ? {downloadPublication} : {})}};
}
function requirePriorBatches(directory,prepared) {
  if (path.dirname(prepared.filename || '') !== PACK_DIRECTORY) return;
  for (const filename of registeredPacks()) {
    const prior = loadPack(filename); if (prior.names.first >= prepared.names.first) break;
    assert(fs.existsSync(localFile(directory,prior.names.report)),'Publish the preceding immutable batch before adding this one');
  }
  if (hasPublishedBatches(directory)) verifyBatchChain({directory});
}
function rebuild(prepared=loadPack()) {
  const REPORT = prepared.names.report;
  if (fs.existsSync(localFile(root,REPORT))) {
    const result = path.dirname(prepared.filename) === PACK_DIRECTORY ? verifyBatchChain({directory:root,verifyAllBaseline:true}) : verifyBatchSuccessor({directory:root,prepared,verifyAllBaseline:true});
    console.log(JSON.stringify({...result.proof,mode:'already-applied',siteBytesWritten:0})); return;
  }
  requirePriorBatches(root,prepared);
  const state = {files:inventory(root),packSha256:prepared.packSha256,publication:null};
  const report = applyPublication(root,prepared,state); console.log(JSON.stringify({ok:true,mode:'applied',release:prepared.pack.release,newNotes:report.newNotes,changedFiles:report.changedFiles.length}));
}
async function published() {
  const verified = verifyBatchChain({directory:root,verifyAllBaseline:true});
  const files = [...verified.files.values(),...[...verified.independentFiles].map(([path,info]) => ({path,...info})),...verified.batches.map(b => ({path:batchNames(b.pack).report,...fileInfo(localFile(root,batchNames(b.pack).report))}))];
  await mapLimited(files,async item => assert.equal(sha(await bytesPublic(item.path)),item.sha256,'Published bytes differ: ' + item.path));
  const latest = verified.batches.at(-1);
  for (const name of ['library/data/tzidkat-hatzadik/39.json','library/data/tzidkat-hatzadik/153.json','library/connected-ideas/catalog.json']) assert.equal(sha(await bytesPublic(name)),latest.report.baselineFiles[name].sha256,'Protected live content changed');
  write(REPO_ROOT,'tzidkat-batch-live-verification.json',{ok:true,...verified.proof,verifiedFiles:files.length,protected40And154:true,verifiedAt:new Date().toISOString()});
  console.log(JSON.stringify({ok:true,...verified.proof,verifiedFiles:files.length}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = argv[0] || '--prepare';
  if (mode === '--prepare') { const result = loadPack(); console.log(JSON.stringify({ok:true,release:result.pack.release,packSha256:result.packSha256,newNotes:result.additions.length,reviewedSections:result.pack.reviewedSections.length})); }
  else if (mode === '--metadata') await metadata();
  else if (mode === '--capture') await capture();
  else if (mode === '--guard') await guard(read(REPO_ROOT,STATE));
  else if (mode === '--apply') {
    const state = read(REPO_ROOT,STATE), prepared = loadPack(); assert.equal(state.packSha256,prepared.packSha256);
    if (state.alreadyPublished) {
      const verified = verifyBatchChain({directory:root,verifyAllBaseline:true});
      assert.equal(verified.batches.at(-1).packSha256,prepared.packSha256,'Already-published batch differs');
      assert.deepEqual(inventory(root),state.files,'Captured publication changed before re-verification');
      console.log(JSON.stringify({ok:true,mode:'already-published',newNotes:prepared.additions.length,siteBytesWritten:0}));
    } else {
      const report = applyPublication(root,prepared,state); console.log(JSON.stringify({ok:true,newNotes:report.newNotes,changedFiles:report.changedFiles.length}));
    }
  }
  else if (mode === '--rebuild') rebuild();
  else if (mode === '--rebuild-all') { for (const filename of registeredPacks()) rebuild(loadPack(filename)); }
  else if (mode === '--verify') console.log(JSON.stringify((path.dirname(packFile) === PACK_DIRECTORY ? verifyBatchChain({directory:root,verifyAllBaseline:true}) : verifyBatchSuccessor({directory:root,prepared:loadPack(),verifyAllBaseline:true})).proof));
  else if (mode === '--live') await published();
  else throw new Error('Unknown mode ' + mode);
}

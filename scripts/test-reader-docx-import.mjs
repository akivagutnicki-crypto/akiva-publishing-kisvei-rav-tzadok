// Verify every supplied/completed pair and every protected predecessor, not
// merely a sample or a set of headline counts. The same proof runs on Pages.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadRelease, normalizedSections, MANIFEST, REPORT, MEI, BEIT, sha, visible, paragraphRef, leaves} from './publish-reader-docx-import.mjs';
import {readPack as readDivreiAudit, protectedSuccessorHash} from './publish-divrei-source-audit.mjs';

const args = process.argv.slice(2), urlIndex = args.indexOf('--url');
const divreiAudit = args.includes('--after-divrei-source-audit') ? readDivreiAudit() : null;
const base = urlIndex >= 0 ? args[urlIndex + 1].replace(/\/?$/, '/') : null;
const release = loadRelease(), {manifest, registry} = release;
const normalized = text => visible(text).replace(/\s+/g, ' ').trim();
async function bytes(relative) {
  if (!base) return fs.readFileSync(path.join('dist', relative));
  const root = base.replace(/library\/$/, '');
  const response = await fetch(new URL(relative, root), {signal:AbortSignal.timeout(90000), cache:'no-store'});
  assert.equal(response.status, 200, relative);
  return Buffer.from(await response.arrayBuffer());
}
const json = async relative => JSON.parse(await bytes(relative));
const libraryJSON = relative => json('library/' + relative);
const report = await libraryJSON(REPORT);
assert.equal(report.release, manifest.release);
assert.equal(report.manifestSha256, sha(fs.readFileSync(MANIFEST)));
assert.equal(report.retainedToldosSections, 52);
const sections = release.packs.flatMap(({pack}) => normalizedSections(pack).map(section => ({...section, book:pack.book})));
const paratext = release.packs.flatMap(({pack}) => pack.paratext || []);
const mei = await libraryJSON(`data/${MEI}/interlinear.json`);
const headings = await libraryJSON(`data/${MEI}/headings.json`);
const toc = await libraryJSON(`data/${BEIT}/toc.json`);
const studyToc = await libraryJSON(`data/${MEI}/study-contents.json`);
const links = {};
for (const slug of [MEI, BEIT]) links[slug] = await libraryJSON(`data/${slug}/links.json`);
assert.equal(leaves(toc.toc).length, 414);
assert.equal(leaves(toc.toc).filter(leaf => leaf.ref?.startsWith('Beit Yaakov on Torah, Toldot ')).length, 52);
const oldToc = structuredClone(toc), last = oldToc.toc.children.pop();
assert.equal(last.children.length, 76);
assert.deepEqual(last.children.map(leaf => leaf.ois), Array.from({length:76}, (_, index) => index + 1));
delete oldToc.documentImportEdition;
assert.equal(sha(JSON.stringify(oldToc)), report.beforeTocSha256, 'An earlier table of contents changed');
assert.deepEqual(leaves(studyToc.toc).map(leaf => leaf.ref), report.canonicalOrder);
assert.deepEqual(Object.keys(mei), report.canonicalOrder);
assert.equal(paratext.length, report.colophonParagraphs);
const canonicalProof = new Map(Object.values(registry).filter(item => item.verified).map(item => [item.ref, item]));
let pairs = 0, paragraphs = 0, anchors = 0, expectedConnections = 0;
const expectedParagraphs = new Map(), readbackFiles = new Map();

for (const section of sections) {
  const slug = section.book === 'Mei HaShiloach' ? MEI : BEIT;
  const sourceItems = [...section.items];
  for (const item of paratext.filter(item => item.afterRef === section.ref)) {
    const n = sourceItems.length + 1;
    assert.equal(item.sourceRef, paragraphRef(section, n));
    sourceItems.push({...item, n});
  }
  let published;
  if (slug === MEI) {
    published = mei[section.ref];
    assert.equal(headings[section.ref].he, section.he, 'Supplied Hebrew heading missing');
    assert.equal(headings[section.ref].title, section.title, 'Supplied title missing');
    assert.equal(headings[section.ref].sep, section.sep);
  } else {
    const leaf = leaves(toc.toc).find(leaf => leaf.ref === section.ref);
    assert.ok(leaf, 'Missing Vayeitzei ois ' + section.ref);
    const file = `data/${BEIT}/${leaf.id}.json`;
    const body = await libraryJSON(file); readbackFiles.set(file, body);
    const bodyParagraphs = body.filter(item => item.p);
    published = bodyParagraphs.map(item => item.p);
    const expectedHeadings = sourceItems.filter(item => item.heading).map(item => item.heading);
    if (section.title !== `Vayetzei · Ois ${section.chapter}`) expectedHeadings.unshift(section.title);
    assert.deepEqual(body.filter(item => item.h).map(item => item.h), expectedHeadings,
      'Repeated generic title or missing manuscript heading in ' + section.ref);
    assert.deepEqual(bodyParagraphs.map(item => item.inlineHeadings || []), sourceItems.map(item => item.inlineHeadings || []),
      'Manuscript continuation heading changed in ' + section.ref);
    assert.equal(leaf.shape, sourceItems.length);
  }
  assert.ok(published?.length, 'Missing section ' + section.ref);
  assert.equal(published.length, sourceItems.length, 'Missing canonical paragraph in ' + section.ref);
  const allEdges = links[slug][section.ref]; assert.ok(Array.isArray(allEdges));
  for (const [index, sourceItem] of sourceItems.entries()) {
    const actual = published[index], expected = sourceItem.p, ref = paragraphRef(section, sourceItem.n);
    assert.equal(actual.length, expected.length, 'Missing phrase pair in ' + ref);
    assert.deepEqual(actual.map(pair => pair.map(visible)), expected, 'Hebrew or translation changed in ' + ref);
    const foundRefs = new Set();
    for (const pair of actual) {
      assert.equal(pair.length, 2); assert.match(visible(pair[0]), /[א-ת]/); assert.match(visible(pair[1]), /[A-Za-z]/);
      assert.doesNotMatch(visible(pair[1]), /[\[\]]/, 'English brackets remain in ' + ref);
      for (const text of pair) for (const match of text.matchAll(/<a\b[^>]*data-ref="([^"]+)"[^>]*href="([^"]+)"[^>]*>/g)) {
        const target = visible(match[1]), url = visible(match[2]), proof = canonicalProof.get(target);
        assert.ok(proof, 'Unverified citation ' + target); assert.equal(url, proof.url);
        foundRefs.add(target); anchors++;
      }
    }
    for (const target of foundRefs) assert.ok(allEdges.some(edge => edge.a === ref && edge.r === target), 'Citation connection missing: ' + ref + ' → ' + target);
    expectedConnections += foundRefs.size;
    expectedParagraphs.set(ref, expected.map(pair => pair.map(normalized)));
    pairs += actual.length; paragraphs++;
  }
  for (const edge of allEdges) {
    assert.ok(expectedParagraphs.has(edge.a), 'Source connection uses a nonexistent paragraph ' + edge.a);
    assert.ok(canonicalProof.has(edge.r), 'Unverified source connection ' + edge.r);
  }
}
assert.equal(anchors, report.sourceAnchors);
assert.ok(report.sourceConnections >= expectedConnections);
assert.equal(paragraphs, report.sections.reduce((sum, section) => sum + section.paragraphs, 0));
assert.equal(pairs, report.sections.reduce((sum, section) => sum + section.phrasePairs, 0));
assert.equal(report.unresolvedExplicitConnections.length, 0);
for (const [ref, hash] of Object.entries(report.previousMeiSectionSha256)) assert.equal(sha(JSON.stringify(mei[ref])), hash, 'Earlier Mei translation altered: ' + ref);
for (const [ref, hash] of Object.entries(report.previousMeiHeadingSha256)) assert.equal(sha(JSON.stringify(headings[ref])), hash, 'Earlier Mei heading altered: ' + ref);
for (const [slug, entries] of Object.entries(report.previousLinksSha256)) for (const [ref, hash] of Object.entries(entries)) assert.equal(sha(JSON.stringify(links[slug][ref])), hash, 'Earlier connections altered: ' + ref);

const volumeI = Object.entries(mei).filter(([ref]) => ref.startsWith('Mei HaShiloach, Volume I,'));
assert.equal(volumeI.length, manifest.completion.expectedVolumeISections);
assert.equal(volumeI.reduce((sum, [, items]) => sum + items.length, 0), manifest.completion.expectedVolumeIParagraphs);
assert.equal(manifest.completion.completedParagraphs, 50);
assert.equal(manifest.completion.completedSections, 36);
assert.equal(manifest.completion.introductionParagraphs, 5);
assert.equal(mei['Mei HaShiloach, Volume I, Introduction'].length, 5);
const missingLedger = JSON.parse(fs.readFileSync(manifest.completion.missingLedger));
for (const item of missingLedger.missingParagraphs) assert.ok(expectedParagraphs.has(item.ref), 'Canonical gap still present: ' + item.ref);

if (args.includes('--mcp')) {
  const [mcpCatalog, fileManifest] = await Promise.all([
    json('mcp-data/catalog.json'), libraryJSON('data/files.json')
  ]);
  assert.ok(typeof fileManifest.version === 'string' && fileManifest.version.length > 0,
    'Final reader data manifest has no version');
  assert.equal(mcpCatalog.version, fileManifest.version,
    'MCP catalog version must match the final reader data manifest; rebuild MCP after ZIP packaging');
  for (const slug of ['mei-hashiloach', BEIT]) {
    const mcp = await json(`mcp-data/text/${slug}.json`), byRef = new Map(mcp.paras.map(item => [item.r, item]));
    for (const [ref, expected] of expectedParagraphs) if (ref.startsWith(slug === BEIT ? 'Beit Yaakov on Torah,' : 'Mei HaShiloach,')) {
      const paragraph = byRef.get(ref); assert.ok(paragraph, 'Missing MCP paragraph ' + ref);
      assert.deepEqual(paragraph.p, expected, 'MCP translation differs: ' + ref);
    }
  }
}

let protectedFiles = 0;
if (args.includes('--zips')) {
  const {unzipSync} = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
  const archive = unzipSync(await bytes('library/downloads/rav-tzadok-library.zip'));
  for (const [file, hash] of Object.entries(report.protectedTextSha256)) {
    assert.ok(archive['data/' + file], 'Protected section absent from offline archive: ' + file);
    assert.equal(sha(archive['data/' + file]), protectedSuccessorHash(file,hash,divreiAudit), 'Earlier Hebrew or English changed: ' + file); protectedFiles++;
  }
  for (const [file, expected] of readbackFiles) assert.deepEqual(JSON.parse(Buffer.from(archive[file])), expected);
  for (const [file, expected] of [[`data/${MEI}/interlinear.json`, mei], [`data/${MEI}/headings.json`, headings], [`data/${MEI}/study-contents.json`, studyToc]]) {
    assert.deepEqual(JSON.parse(Buffer.from(archive[file])), expected, 'Offline edition differs: ' + file);
  }
  const beitZip = unzipSync(await bytes(`library/downloads/books/${BEIT}.zip`));
  for (const [file, expected] of readbackFiles) assert.deepEqual(JSON.parse(Buffer.from(beitZip[file])), expected);
} else if (!base) {
  for (const [file, hash] of Object.entries(report.protectedTextSha256)) {
    assert.equal(sha(await bytes('library/data/' + file)), protectedSuccessorHash(file,hash,divreiAudit), 'Earlier Hebrew or English changed: ' + file); protectedFiles++;
  }
}

console.log(JSON.stringify({ok:true, release:manifest.release, source:base || 'local build',
  importedSections:sections.length, paragraphs, phrasePairs:pairs, verifiedSourceAnchors:anchors,
  sourceConnections:report.sourceConnections, retainedToldosOsiyos:52, protectedChapterFiles:protectedFiles,
  canonicalCompletion:{scope:manifest.completion.scope, sections:volumeI.length,
    paragraphs:volumeI.reduce((sum, [, items]) => sum + items.length, 0), restoredMainTextParagraphs:50,
    introductionParagraphs:5},
  missingHebrewPhrases:0, missingEnglishPhrases:0, mcpChecked:args.includes('--mcp'), zipsChecked:args.includes('--zips')}, null, 2));

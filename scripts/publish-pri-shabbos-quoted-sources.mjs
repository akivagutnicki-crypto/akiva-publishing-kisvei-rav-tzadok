// Install independently collated quotations after the historical source-note checks.
// The immutable package names exact before/after notes; author text is never edited.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {categoryOf} from './citations.mjs';

export const RELEASE = '20261021-pri-shabbos-pdf-quotations-v1';
export const PACK = 'sources/akiva/overlays/pri-shabbos-quoted-sources-20261021.json';
export const REPORT = 'pri-shabbos-quoted-sources-publication.json';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => sha(JSON.stringify(canonical(value)));
export const body = value => Array.isArray(value) ? value.map(body) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'footnotes').map(([key, item]) => [key, body(item)])) : value;
export const plain = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key) => {
  if (key[0] === '#') return String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)));
  return {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '}[key.toLowerCase()] || all;
});
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const serial = value => JSON.stringify(value);
const filesUnder = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory()
  ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]).sort();
const sourceSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const allowed = /^Peri Tzadik, (?:Introduction(?: \d+)?|Sefer Kedushat Shabbat [1-7](?::\d+)?|Kuntres Shvitat Shabbat [1-7](?::\d+)?)$/;

export function readPack(filename = PACK) {
  const bytes = fs.readFileSync(filename), pack = JSON.parse(bytes);
  assert.equal(pack.schemaVersion, 1); assert.equal(pack.release, RELEASE);
  assert(pack.files.length && pack.operations.length, 'Empty quotation release');
  for (const file of pack.files) assert(/^data\/peri-tzadik\/(?:188|189-[1-7]|190-[1-7])\.json$/.test(file.path), 'Unauthorized chapter path');
  const ids = new Set(), quotations = new Set();
  for (const operation of pack.operations) {
    assert(allowed.test(operation.originRef), 'Outside the authorized works');
    assert.equal(operation.originRef, operation.sectionRef + (operation.sectionRef === 'Peri Tzadik, Introduction' ? ' ' : ':') + operation.paragraph);
    assert(['add', 'replace', 'remove'].includes(operation.action));
    assert(pack.files.some(file => file.path === operation.path));
    assert(!ids.has(operation.placementId), 'Repeated placement operation'); ids.add(operation.placementId);
    assert(operation.reviewed === true && operation.reason, 'Unreviewed editorial operation');
    if (operation.action === 'remove') {assert(operation.before && !operation.after); continue;}
    const note = operation.after, quote = operation.quotation;
    assert(note.quotationOnly === true && note.verificationStatus === 'verified');
    assert.equal(note.placementId, operation.placementId);
    assert(quote && /[א-ת]/.test(quote.he) && /[A-Za-z]/.test(quote.en));
    assert(typeof quote.url === 'string' && (quote.url.startsWith('#/read/') || /^https:\/\/(?:www\.)?(?:sefaria\.org|chabad\.org|hebrewbooks\.org|nli\.org\.il|he\.wikisource\.org)\//.test(quote.url)), 'Unsupported source URL');
    if (quote.url.startsWith('#/read/')) assert.equal(decodeURIComponent(quote.url.slice(7)).replace(/_/g, ' '), quote.ref, 'Internal source link identifies another passage');
    assert.equal(note.sources.length, 1); assert.equal(note.sources[0].ref, quote.ref);
    assert.equal(note.sources[0].url, quote.url);
    assert.equal(note.paragraphs.length, 1, 'A quotation must not acquire commentary');
    const paragraph = note.paragraphs[0], expected = `${quote.ref}: “${quote.en}”`;
    assert.equal(paragraph.language, 'en'); assert.equal(paragraph.text, expected);
    assert.equal(paragraph.rich.map(run => run.text).join(''), expected);
    assert.deepEqual(paragraph.rich[0], {text:quote.ref, bold:true, href:quote.url});
    assert.equal(note.reviewedSourceExcerpt.he, quote.he); assert.equal(note.reviewedSourceExcerpt.en, quote.en);
    assert.equal(note.reviewedSourceExcerpt.ref, quote.ref);
    const key = quote.he.normalize('NFKD').replace(/[\u0591-\u05c7\s\p{P}\p{S}]/gu, '');
    assert(!quotations.has(key), 'Repeated quotation in release'); quotations.add(key);
    assert(note.provenance.quotedSourceRelease === RELEASE);
    if (operation.action === 'replace') {
      assert.equal(note.number, operation.before.number, 'An existing footnote number moved');
      assert.equal(note.sourceId, operation.before.sourceId, 'An existing source identity moved');
    } else assert(!operation.before, 'New note has a predecessor');
  }
  return {...pack, packageSha256:sha(bytes)};
}

export function applyOperations(original, operations) {
  const result = structuredClone(original);
  for (const operation of operations) {
    const item = result.find(row => row.p && row.n === operation.paragraph);
    assert(item, 'Missing canonical paragraph: ' + operation.originRef);
    const notes = item.footnotes || [], at = notes.findIndex(note => note.placementId === operation.placementId);
    if (operation.action === 'add') {
      assert.equal(at, -1, 'A new note already exists');
      assert(!notes.some(note => note.number === operation.after.number), 'Duplicate number in paragraph');
      notes.push(structuredClone(operation.after));
    } else {
      assert(at >= 0, 'Missing predecessor note');
      assert.deepEqual(notes[at], operation.before, 'The predecessor note changed');
      if (operation.action === 'remove') notes.splice(at, 1);
      else notes[at] = structuredClone(operation.after);
    }
    item.footnotes = notes;
    if (operation.after) {
      const note = operation.after, pair = item.p[note.phraseIndex];
      assert(pair && Number.isSafeInteger(note.heCharOffset));
      assert(note.heCharOffset > 0 && note.heCharOffset <= plain(pair[0]).length, 'Hebrew offset outside its phrase');
      assert(Number.isSafeInteger(note.enCharOffset) && note.enCharOffset >= 0 && note.enCharOffset <= plain(pair[1]).length, 'English offset outside its phrase');
      assert.equal(plain(pair[0]).slice(0, note.heCharOffset), note.heAnchorPrefix, 'Hebrew marker no longer matches its phrase');
      assert.equal(plain(pair[1]).slice(0, note.enCharOffset), note.enAnchorPrefix, 'English phrase context moved');
    }
  }
  assert.deepEqual(body(result), body(original), 'Author text or headings changed');
  return result;
}

export function publish(library = 'dist/library', filename = PACK) {
  const pack = readPack(filename), data = path.join(library, 'data');
  const reportPath = path.join(library, REPORT);
  const allAfter = pack.files.every(file => sha(fs.readFileSync(path.join(library, file.path))) === file.afterSha256);
  if (allAfter) {
    const report = read(reportPath);
    assert.equal(report.packageSha256, pack.packageSha256, 'Another release occupies the same output');
    return {...report, mode:'already-applied'};
  }
  const planned = [], touched = new Set(pack.files.map(file => path.join(library, file.path)));
  const protectedFiles = filesUnder(data).filter(file => !touched.has(file));
  const protectedSha256 = digest(protectedFiles.map(file => [path.relative(data, file), sha(fs.readFileSync(file))]));
  for (const file of pack.files) {
    const target = path.join(library, file.path), bytes = fs.readFileSync(target);
    assert.equal(sha(bytes), file.beforeSha256, 'Current reader differs from reviewed baseline: ' + file.path);
    const original = JSON.parse(bytes);
    assert.equal(digest(body(original)), file.bodySha256);
    const updated = applyOperations(original, pack.operations.filter(operation => operation.path === file.path));
    const after = serial(updated);
    assert.equal(sha(after), file.afterSha256, 'Prepared quotation output differs: ' + file.path);
    planned.push([target, after]);
  }
  // Preflight all note operations before any file is written. Source links in
  // existing paragraphs are retained; each new quotation adds its exact edge.
  const linksFile = path.join(data, 'peri-tzadik/links.json'), links = read(linksFile);
  const additions = [];
  for (const operation of pack.operations.filter(operation => operation.after)) {
    const list = links[operation.sectionRef] || (links[operation.sectionRef] = []);
    const ref = operation.quotation.ref;
    if (!list.some(link => link.a === operation.originRef && link.r === ref)) {
      const edge = {a:operation.originRef, r:ref, c:categoryOf(ref)};
      list.push(edge); additions.push(edge);
    }
  }
  for (const [file, contents] of planned) fs.writeFileSync(file, contents);
  // This first preservation proof covers every non-target data file, including
  // all other books and historical citation files, before additive links.
  assert.equal(digest(protectedFiles.map(file => [path.relative(data, file), sha(fs.readFileSync(file))])), protectedSha256);
  fs.writeFileSync(linksFile, serial(links));
  const cited = path.join(data, 'cited'), catalog = read(path.join(data, 'catalog.json'));
  const sourceNames = new Set(read(path.join(cited, 'index.json')));
  for (const edge of additions) {
    const slug = sourceSlug(edge.r), filename = path.join(cited, slug + '.json');
    const index = fs.existsSync(filename) ? read(filename) : {};
    const owners = index[edge.r] || (index[edge.r] = []);
    if (!owners.includes(edge.a)) owners.push(edge.a);
    fs.writeFileSync(filename, serial(index)); sourceNames.add(slug);
  }
  fs.writeFileSync(path.join(cited, 'index.json'), serial([...sourceNames].sort()));
  const sourcesFile = path.join(data, 'packs/sources.json'), sources = read(sourcesFile);
  const external = additions.map(edge => edge.r).filter(ref => !catalog.some(book => ref === book.title || ref.startsWith(book.title + ' ') || ref.startsWith(book.title + ',')));
  sources.refs = [...new Set([...sources.refs, ...external])].sort(); fs.writeFileSync(sourcesFile, serial(sources));
  const revision = RELEASE + '-' + pack.packageSha256.slice(0, 12);
  const htmlFile = path.join(library, 'index.html'); let html = fs.readFileSync(htmlFile, 'utf8');
  const marker = 'const editionDataUrl = url => '; assert.equal(html.split(marker).length, 2);
  html = html.replace(/\/\* Pri Shabbos quoted sources revision \*\/[^\n]*\n/g, '');
  html = html.replace(marker, marker + `/* Pri Shabbos quoted sources revision */ (url.startsWith('data/peri-tzadik/') || url.startsWith('data/cited/') || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition=${revision}' :\n`);
  fs.writeFileSync(htmlFile, html);
  const swFile = path.join(library, 'sw.js'); let sw = fs.readFileSync(swFile, 'utf8');
  assert.match(sw, /const SHELL = `[^`]+`;/);
  sw = sw.replace(/-pri-shabbos-quotes-[a-f0-9]+/g, '').replace(/const SHELL = `([^`]+)`;/, `const SHELL = \`$1-pri-shabbos-quotes-${pack.packageSha256.slice(0,12)}\`;`);
  fs.writeFileSync(swFile, sw);
  const report = {schemaVersion:1, release:RELEASE, revision, packageSha256:pack.packageSha256,
    counts:pack.counts, files:pack.files, protectedDataFiles:protectedFiles.length, protectedDataSha256:protectedSha256,
    authorTextPreserved:true, existingNotesPreservedExceptReviewedOperations:true, exactSourceLinksAdded:additions,
    originalSourceManuscriptsPreserved:true};
  fs.writeFileSync(reportPath, serial(report));
  return {...report, mode:'applied'};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const at = process.argv.indexOf('--root');
  console.log(JSON.stringify(publish(at < 0 ? 'dist/library' : process.argv[at + 1]), null, 2));
}

// Tzidkat HaTzadik Complete Editorial Master: a book-only, preservation-checked Pages release.
// It patches the exact deployed Pages artifact with the freshly built Tzidkat data; it does NOT
// rebuild or alter other seforim. Modelled on publish-beit-yaakov-final.mjs.
//
//   node scripts/publish-tzidkat-editorial-master.mjs --check-pack
//   node scripts/publish-tzidkat-editorial-master.mjs --apply SITE BUILD     patch SITE (restored artifact) from BUILD (fresh local dist)
//   node scripts/publish-tzidkat-editorial-master.mjs --finalize SITE        manifest, MCP catalog version, cache markers, report
//   node scripts/publish-tzidkat-editorial-master.mjs --verify SITE BUILD
//   node scripts/publish-tzidkat-editorial-master.mjs --live SITE
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'sources/akiva/Tzidkat_HaTzadik.json';
const EDITION_ID = 'tzidkat-editorial-master-2026-11';
const RELEASE = '20261102-tzidkat-editorial-master-v1';
const BOOK = 'Tzidkat HaTzadik', SLUG = 'tzidkat-hatzadik', ANCHOR_PREFIX = 'Tzidkat HaTzadik ';
const REPORT = 'library/tzidkat-editorial-master-20261102.json';
const PROOF = 'artifacts/tzidkat-editorial-master/final-verification.json';
const PREVIOUS = 'new-books-baseline.json', META = 'new-books-publication.json';
const PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const DOWNLOAD = 'downloads/tzidkas-hatzaddik-complete-editorial-master.docx';
const IDEAS = 'library/connected-ideas/catalog.json';
const involvesTzidkat = r => String(r.originRef || '').startsWith(ANCHOR_PREFIX) || String(r.targetRef || '').startsWith(ANCHOR_PREFIX);

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = obj => JSON.stringify(obj);
const relative = (root, name) => {
  assert(name && !path.isAbsolute(name) && name.split('/').every(p => p && p !== '.' && p !== '..'), 'Bad path ' + name);
  const resolved = path.resolve(root, name); assert(resolved.startsWith(path.resolve(root) + path.sep)); return resolved;
};
const exists = (root, name) => fs.existsSync(relative(root, name));
const read = (root, name) => JSON.parse(fs.readFileSync(relative(root, name), 'utf8'));
const write = (root, name, bytes) => {
  const f = relative(root, name); fs.mkdirSync(path.dirname(f), {recursive: true});
  fs.writeFileSync(f, Buffer.isBuffer(bytes) ? bytes : Buffer.from(typeof bytes === 'string' ? bytes : json(bytes)));
};
const digest = (root, name) => sha(fs.readFileSync(relative(root, name)));
const textOf = s => String(s).replace(/<[^>]*>/g, '').replace(/&(?:quot|amp|apos|lt|gt|nbsp|#39|#x27);/g,
  t => ({'&quot;': '"', '&amp;': '&', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&#39;': "'", '&#x27;': "'"}[t]));
const utf16 = s => s.length;

export function loadPack() {
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, SOURCE), 'utf8'));
  assert.equal(src.editionId, EDITION_ID, 'The checked-in Tzidkat source is not the editorial master edition');
  assert.equal(src.title, BOOK); assert.equal(src.sections.length, 264);
  let notes = 0, paragraphs = 0, headings = 0, sefariaSources = 0, native = 0, cross = 0;
  const ids = new Set();
  for (const sec of src.sections) {
    assert(Number.isInteger(sec.n) && sec.n >= 1 && sec.n <= 264, 'Bad section ' + sec.n);
    for (const item of sec.items) {
      if ('h' in item) { headings++; continue; }
      assert(Array.isArray(item.p) && item.p.length, `Empty paragraph ${sec.n}:${item.n}`);
      paragraphs++;
      for (const pair of item.p) assert(Array.isArray(pair) && pair.length === 2 && /[א-ת]/.test(pair[0]), `Bad pair in ${sec.n}:${item.n}`);
      for (const note of item.footnotes || []) {
        assert.match(note.sourceId, /^TZ-\d{4}$/); assert.equal(note.placementId, note.sourceId + '-1'); assert.equal(note.number, Number(note.sourceId.slice(3)));
        assert(!ids.has(note.sourceId), 'Duplicate ' + note.sourceId); ids.add(note.sourceId);
        const pair = item.p[note.phraseIndex]; assert(pair, `Missing phrase for ${note.sourceId}`);
        assert.equal(textOf(pair[0]).slice(0, note.heCharOffset), note.heAnchorPrefix, 'Hebrew anchor ' + note.sourceId);
        assert.equal(textOf(pair[1]).slice(0, note.enCharOffset), note.enAnchorPrefix, 'English anchor ' + note.sourceId);
        assert(note.heCharOffset > 0 && note.enCharOffset > 0, 'Zero anchor ' + note.sourceId);
        assert(Array.isArray(note.paragraphs) && note.paragraphs.length, 'Empty note ' + note.sourceId);
        for (const p of note.paragraphs) assert.equal(p.rich.map(r => r.text).join(''), p.text, 'Rich runs differ from text in ' + note.sourceId);
        for (const s of note.sources || []) { assert(s.ref && /^https:\/\/www\.sefaria\.org\//.test(s.url), 'Non-Sefaria source in ' + note.sourceId); sefariaSources++; }
        native += (note.nativeConnections || []).length;
        if (note.crossReference) { assert.match(note.crossReference.placementId, /^TZ-\d{4}-1$/); cross++; }
        notes++;
      }
    }
  }
  assert.equal(notes, src.footnoteImportInfo.notes, 'footnoteImportInfo.notes differs from the notes present');
  for (let i = 1; i <= notes; i++) assert(ids.has('TZ-' + String(i).padStart(4, '0')), 'Gap in numbering at ' + i);
  return {src, stats: {sections: src.sections.length, paragraphs, headings, notes, sefariaSources, nativeConnections: native, crossReferences: cross}};
}

function allFiles(directory, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isSymbolicLink()) {
      // A Pages artifact never contains links; a local checkout may (tracked site assets). Never follow them.
      assert(!prefix.startsWith('library/data/'), 'Untrusted data symlink: ' + prefix + e.name);
      continue;
    }
    if (e.isDirectory()) out.push(...allFiles(path.join(directory, e.name), prefix + e.name + '/'));
    else if (e.isFile()) out.push(prefix + e.name);
    else throw Error('Unexpected site entry ' + prefix + e.name);
  }
  return out;
}
function manifest(root) {
  const data = relative(root, 'library/data'), files = allFiles(data).filter(n => n !== 'files.json').sort();
  const h = createHash('sha256'); let total = 0;
  for (const file of files) { const buffer = fs.readFileSync(path.join(data, file)); total += buffer.length; h.update(file); h.update('\0'); h.update(buffer); }
  return {version: h.digest('hex').slice(0, 16), bytes: total, files};
}
const isTzidkatAnchor = a => typeof a === 'string' && a.startsWith(ANCHOR_PREFIX);

function stripTzidkat(index) {
  // index: {ref: [anchors]} -> same object without Tzidkat anchors (empty refs removed)
  const out = {};
  for (const [ref, anchors] of Object.entries(index)) {
    const kept = anchors.filter(a => !isTzidkatAnchor(a));
    if (kept.length) out[ref] = kept;
  }
  return out;
}
function mergeTzidkat(index, fresh) {
  // add the fresh build's Tzidkat anchors for each ref
  for (const [ref, anchors] of Object.entries(fresh)) {
    const mine = anchors.filter(isTzidkatAnchor);
    if (!mine.length) continue;
    const list = index[ref] ??= [];
    for (const a of mine) if (!list.includes(a)) list.push(a);
  }
  return index;
}

export async function apply(site, build) {
  const {src, stats} = loadPack();
  const before = read(ROOT, PREVIOUS).files, base = read(ROOT, META);
  assert.equal(read(ROOT, PREVIOUS).publication?.artifactId, base.publication?.artifactId, 'Baseline selection changed');
  const affected = new Set(), created = new Set();
  const touch = (name, data) => {
    if (before[name]) assert.equal(digest(site, name), before[name], 'Existing site file changed since baseline capture: ' + name);
    else { assert(!exists(site, name), 'Untracked file collision: ' + name); created.add(name); }
    write(site, name, data); affected.add(name);
  };
  // 1. chapter files, toc and links from the fresh build
  const buildDir = relative(build, 'library/data/' + SLUG);
  const chapterFiles = fs.readdirSync(buildDir).filter(f => /^\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
  assert.equal(chapterFiles.length, 264, 'The fresh build must contain 264 Tzidkat chapter files');
  const btoc = read(build, `library/data/${SLUG}/toc.json`);
  assert.equal(btoc.toc.children.length, 264);
  let builtNotes = 0, builtParagraphs = 0;
  for (const f of chapterFiles) {
    const rows = read(build, `library/data/${SLUG}/${f}`);
    for (const row of rows) { if (row.p) builtParagraphs++; builtNotes += (row.footnotes || []).length; }
    touch(`library/data/${SLUG}/${f}`, fs.readFileSync(path.join(buildDir, f)));
  }
  assert.equal(builtNotes, stats.notes, 'Built note count differs from the source');
  assert.equal(builtParagraphs, stats.paragraphs, 'Built paragraph count differs from the source');
  const siteChapters = fs.readdirSync(relative(site, 'library/data/' + SLUG)).filter(f => /^\d+\.json$/.test(f));
  assert.equal(siteChapters.length, 264, 'The published Tzidkat folder does not have 264 chapters');
  touch(`library/data/${SLUG}/toc.json`, fs.readFileSync(path.join(buildDir, 'toc.json')));
  touch(`library/data/${SLUG}/links.json`, fs.readFileSync(path.join(buildDir, 'links.json')));
  // 2. catalog entry
  const catalogName = 'library/data/catalog.json', catalog = read(site, catalogName), bcatalog = read(build, catalogName);
  const entry = bcatalog.find(b => b.slug === SLUG); assert(entry, 'Fresh catalog lacks Tzidkat');
  const i = catalog.findIndex(b => b.slug === SLUG); assert(i >= 0, 'Published catalog lacks Tzidkat');
  const others = json(catalog.filter(b => b.slug !== SLUG));
  catalog[i] = entry;
  assert.equal(json(catalog.filter(b => b.slug !== SLUG)), others);
  touch(catalogName, catalog);
  // 3. reverse citation indexes: drop every old Tzidkat anchor, add the fresh ones
  const citedDir = 'library/data/cited';
  const freshCited = {};
  for (const f of fs.readdirSync(relative(build, citedDir))) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const idx = read(build, citedDir + '/' + f);
    const mine = {};
    for (const [ref, anchors] of Object.entries(idx)) { const m = anchors.filter(isTzidkatAnchor); if (m.length) mine[ref] = m; }
    if (Object.keys(mine).length) freshCited[f] = mine;
  }
  const siteCitedFiles = fs.readdirSync(relative(site, citedDir)).filter(f => f.endsWith('.json') && f !== 'index.json');
  const touchedCited = new Set();
  for (const f of siteCitedFiles) {
    const idx = read(site, citedDir + '/' + f);
    const hadTzidkat = Object.values(idx).some(a => a.some(isTzidkatAnchor));
    const merged = mergeTzidkat(stripTzidkat(idx), freshCited[f] || {});
    if (hadTzidkat || freshCited[f]) { touch(citedDir + '/' + f, merged); touchedCited.add(f); }
  }
  for (const [f, mine] of Object.entries(freshCited)) if (!siteCitedFiles.includes(f)) { touch(citedDir + '/' + f, mine); touchedCited.add(f); }
  const citedIndexName = citedDir + '/index.json';
  const citedIndex = new Set(read(site, citedIndexName));
  for (const f of fs.readdirSync(relative(site, citedDir))) if (f.endsWith('.json') && f !== 'index.json' && Object.keys(read(site, citedDir + '/' + f)).length) citedIndex.add(f.slice(0, -5));
  touch(citedIndexName, [...citedIndex].sort());
  const mcpCitedName = 'mcp-data/cited.json';
  if (exists(site, mcpCitedName) && exists(build, mcpCitedName)) {
    const freshMcp = {};
    for (const [ref, anchors] of Object.entries(read(build, mcpCitedName))) { const m = anchors.filter(isTzidkatAnchor); if (m.length) freshMcp[ref] = m; }
    touch(mcpCitedName, mergeTzidkat(stripTzidkat(read(site, mcpCitedName)), freshMcp));
  }
  // 4. source pack refs (union; existing refs are kept for the other seforim)
  const packName = 'library/data/packs/sources.json';
  if (exists(site, packName) && exists(build, packName)) {
    const pack = read(site, packName), bpack = read(build, packName);
    const refs = new Set([...pack.refs, ...bpack.refs]); pack.refs = [...refs].sort(); touch(packName, pack);
  }
  // 5. MCP text and parallels for this book
  for (const name of [`mcp-data/text/${SLUG}.json`, `mcp-data/parallels/${SLUG}.json`, `library/data/parallels/${SLUG}.json`]) {
    if (exists(build, name)) touch(name, fs.readFileSync(relative(build, name)));
  }
  const mcpCatalogName = 'mcp-data/catalog.json';
  if (exists(site, mcpCatalogName) && exists(build, mcpCatalogName)) {
    const mc = read(site, mcpCatalogName), bmc = read(build, mcpCatalogName);
    const be = bmc.books.find(b => b.slug === SLUG), j = mc.books.findIndex(b => b.slug === SLUG);
    assert(be && j >= 0, 'MCP catalog lacks Tzidkat'); mc.books[j] = be; touch(mcpCatalogName, mc);
  }
  // 6. the Word edition download
  if (exists(build, 'library/' + DOWNLOAD)) touch('library/' + DOWNLOAD, fs.readFileSync(relative(build, 'library/' + DOWNLOAD)));
  // 7. Connected Ideas: the published catalog pins every thread to the Hebrew it was reviewed on.
  // Threads into Tzidkat are rebuilt from the re-anchored editorial records against the fresh
  // build; every record of the other seforim is kept byte-for-byte, with its numbering.
  let ideasStats = null;
  if (exists(site, IDEAS)) {
    const {buildConnectedIdeas, assembleCatalog, editorialFiles} = await import('./build-connected-ideas.mjs');
    const live = read(site, IDEAS);
    assert(live.schemaVersion === 1 && Array.isArray(live.records) && live.release, 'Unknown published Connected Ideas catalog');
    const kept = live.records.filter(r => !involvesTzidkat(r));
    // Resolve against the site's own texts (Tzidkat is already the fresh edition after step 5), so
    // the other side of each thread is pinned to exactly what the site publishes.
    const unresolved = [];
    const rebuilt = buildConnectedIdeas({mcpRoot: relative(site, 'mcp-data'), write: false, filter: involvesTzidkat,
      onError: (input, file, error) => unresolved.push({id: input.id, file, error: error.message})}).catalog.records;
    assert(rebuilt.length > 0, 'No Tzidkat Connected Ideas could be rebuilt');
    for (const r of rebuilt) assert(r.evidence.origin.textSha256 && involvesTzidkat(r));
    const rebuiltIds = new Set(rebuilt.map(r => r.id));
    // A thread whose other side no longer matches the published text is kept exactly as published
    // (the reader already hides it); it is listed for editorial review rather than dropped.
    const stale = live.records.filter(r => involvesTzidkat(r) && !rebuiltIds.has(r.id));
    const mcpCatalogBytes = fs.readFileSync(relative(site, 'mcp-data/catalog.json'));
    const result = assembleCatalog({records: [...kept, ...stale, ...rebuilt], catalog: JSON.parse(mcpCatalogBytes), catalogBytes: mcpCatalogBytes,
      files: editorialFiles(), date: new Date().toISOString().slice(0, 10), write: false, release: live.release}).catalog;
    result.provenance.partialRebuild = {release: RELEASE, book: BOOK, rebuiltRecords: rebuilt.length, keptRecords: kept.length, keptStaleRecords: stale.map(r => r.id),
      unresolved, previousVersion: live.version, previousTzidkatRecords: live.records.length - kept.length};
    touch(IDEAS, JSON.stringify(result, null, 2) + '\n');
    ideasStats = {kept: kept.length, rebuilt: rebuilt.length, stale: stale.length, unresolved, previous: live.records.length - kept.length, version: result.version, rebuiltIds: [...rebuiltIds].sort()};
  } else console.log(json({note: 'no published Connected Ideas catalog on the site; nothing to re-anchor'}));
  const report = {schemaVersion: 1, release: RELEASE, editionId: EDITION_ID, publication: base.publication, sourceSha256: digest(ROOT, SOURCE),
    stats, connectedIdeas: ideasStats, citedFilesUpdated: touchedCited.size, affected: [...affected].sort(), created: [...created].sort(), stage: 'applied'};
  write(ROOT, 'tzidkat-editorial-master-stage.json', report);
  console.log(json({ok: true, stage: 'applied', ...stats, connectedIdeas: ideasStats && {...ideasStats, rebuiltIds: undefined}, affectedFiles: affected.size, citedFilesUpdated: touchedCited.size}));
}

export function finalize(site) {
  const stage = read(ROOT, 'tzidkat-editorial-master-stage.json');
  const before = read(ROOT, PREVIOUS).files;
  const affected = new Set(stage.affected);
  const touch = (name, data) => { write(site, name, data); affected.add(name); };
  const m = manifest(site); touch('library/data/files.json', m);
  const mcpCatalogName = 'mcp-data/catalog.json';
  if (exists(site, mcpCatalogName)) { const mc = read(site, mcpCatalogName); mc.version = m.version; touch(mcpCatalogName, mc); }
  const htmlName = 'library/index.html', html = fs.readFileSync(relative(site, htmlName), 'utf8');
  const marker = 'const editionDataUrl = url => ';
  assert.equal(html.split(marker).length, 2, 'Reader cache helper unexpectedly changed');
  assert(!html.includes('/* ' + RELEASE + ' */'), 'Release marker already present');
  const stamp = stage.sourceSha256.slice(0, 12);
  touch(htmlName, html.replace(marker, marker + `/* ${RELEASE} */ (url.startsWith('data/${SLUG}/') || url.startsWith('data/cited/') || url.startsWith('data/parallels/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?tzidkat=${stamp}' :\n`));
  if (stage.connectedIdeas) {
    const current = fs.readFileSync(relative(site, htmlName), 'utf8');
    // Earlier publishers rewrote this request in different ways (the Takanat release replaced the "?v=" query,
    // the source-accuracy release appended "&accuracy="), so match the whole fetch argument, whatever its form,
    // and append the Tzidkat cache key as one more concatenated string.
    const fetchLine = /(fetch\('connected-ideas\/catalog\.json[^)\n]*)\)/g;
    const hits = current.match(fetchLine) || [];
    if (hits.length !== 1) console.error(json({connectedIdeasFetchCandidates: hits}));
    assert.equal(hits.length, 1, 'Connected Ideas catalog request not found exactly once in the reader');
    touch(htmlName, current.replace(fetchLine, (_, a) => `${a} + '&tzidkat=${stamp}')`));
  }
  const swName = 'library/sw.js', sw = fs.readFileSync(relative(site, swName), 'utf8');
  assert.equal((sw.match(/const SHELL = `[^`]+`;/g) || []).length, 1, 'Unexpected service worker cache revision');
  touch(swName, sw.replace(/const SHELL = `([^`]+)`;/, (_, v) => `const SHELL = \`${v}-tzidkat-master-${stamp}\`;`));
  const report = {...stage, stage: 'finalized', version: m.version,
    affected: [...affected].sort().map(name => ({name, sha256: digest(site, name), preimage: before[name] || null})),
    validation: 'Sefaria references were resolved against the live API during editorial preparation; see footnoteImportInfo in the source.'};
  write(site, REPORT, report);
  write(ROOT, PROOF, {ok: true, release: RELEASE, ...stage.stats, publishedFiles: report.affected.length, version: m.version, baselineArtifact: stage.publication?.artifactId});
  console.log(json({ok: true, stage: 'finalized', version: m.version, affectedFiles: report.affected.length}));
}

export function verify(site, build) {
  const {stats} = loadPack(), before = read(ROOT, PREVIOUS).files, report = read(site, REPORT);
  assert.equal(report.release, RELEASE); assert.equal(report.editionId, EDITION_ID);
  const allow = new Set([REPORT, ...report.affected.map(f => f.name)]);
  const after = allFiles(path.resolve(site)).sort();
  for (const [name, hash] of Object.entries(before)) {
    assert(fs.existsSync(relative(site, name)), 'Existing published file missing: ' + name);
    if (!allow.has(name)) assert.equal(digest(site, name), hash, 'Unrelated published file altered: ' + name);
  }
  for (const f of report.affected) assert.equal(digest(site, f.name), f.sha256, 'Published Tzidkat file changed: ' + f.name);
  let notes = 0, paragraphs = 0;
  const validAnchors = new Set();
  const toc = read(site, `library/data/${SLUG}/toc.json`);
  assert.equal(toc.toc.children.length, 264, 'Published TOC must list 264 simanim');
  for (let i = 0; i < 264; i++) {
    const rows = read(site, `library/data/${SLUG}/${i}.json`);
    if (build) assert.equal(digest(site, `library/data/${SLUG}/${i}.json`), digest(build, `library/data/${SLUG}/${i}.json`), 'Chapter differs from the fresh build: ' + i);
    const ref = toc.toc.children[i].ref;
    for (const row of rows) { if (row.p) { paragraphs++; validAnchors.add(`${ref}:${row.n}`); } notes += (row.footnotes || []).length; }
  }
  assert.equal(notes, stats.notes); assert.equal(paragraphs, stats.paragraphs);
  // Every Tzidkat anchor left in the reverse citation indexes must point at a paragraph of the new edition.
  let anchors = 0;
  for (const f of fs.readdirSync(relative(site, 'library/data/cited'))) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    for (const list of Object.values(read(site, 'library/data/cited/' + f))) for (const a of list) if (isTzidkatAnchor(a)) {
      anchors++; assert(validAnchors.has(a), 'Stale Tzidkat anchor in cited/' + f + ': ' + a);
    }
  }
  assert(anchors > 1000, 'Too few Tzidkat citation anchors: ' + anchors);
  if (report.connectedIdeas) {
    const live = read(site, IDEAS), normalize = createRequire(import.meta.url)(relative(site, 'library/source-connections.js')).normalizedHebrew;
    assert.equal(live.version, report.connectedIdeas.version, 'Connected Ideas catalog differs from the published stage');
    const text = read(site, `mcp-data/text/${SLUG}.json`), book = read(site, 'mcp-data/catalog.json').books.find(b => b.slug === SLUG);
    const content = p => Array.isArray(p.p) ? p.p.map(x => x[0] || '').join(' ') : p.t || '';
    const paraHash = new Map(), sectionHash = new Map(), nativeMax = Math.max(...text.paras.flatMap(p => (p.f || []).map(n => Number(n[0]) || 0)));
    for (const p of text.paras) {
      paraHash.set(p.r, sha(normalize(content(p))));
      const section = book.sections[p.s];
      if (!sectionHash.has(section.ref)) sectionHash.set(section.ref, sha(normalize(text.paras.slice(section.first, section.first + section.count).map(content).join(' '))));
    }
    let threads = 0, staleThreads = 0; const numbers = new Set(), rebuiltIds = new Set(report.connectedIdeas.rebuiltIds);
    for (const r of live.records) {
      if (!involvesTzidkat(r)) continue;
      if (!rebuiltIds.has(r.id)) { staleThreads++; continue; }
      threads++;
      for (const side of ['origin', 'target']) {
        const ref = r[side + 'Ref']; if (!ref.startsWith(ANCHOR_PREFIX)) continue;
        const key = side === 'origin' ? 'Origin' : 'Target';
        assert.equal(r['reviewed' + key + 'HebrewSha256'], paraHash.get(ref), 'Connected Ideas thread pinned to stale Tzidkat Hebrew: ' + r.id);
        const sectionPin = r['reviewed' + key + 'SectionHebrewSha256'];
        if (sectionPin) assert.equal(sectionPin, sectionHash.get(ref.split(':')[0]), 'Connected Ideas thread pinned to a stale Tzidkat siman: ' + r.id);
        assert((' ' + normalize(content(text.paras.find(p => p.r === ref))) + ' ').includes(' ' + normalize(r[side + 'Hebrew']) + ' '), 'Quotation absent from the published paragraph: ' + r.id);
      }
      for (const field of ['footnoteNumber', 'reverseFootnoteNumber']) if (r[field] !== undefined) {
        assert(Number.isSafeInteger(r[field]) && r[field] > nativeMax && !numbers.has(r[field]), 'Connected Ideas note number collides with the manuscript notes: ' + r.id);
        numbers.add(r[field]);
      }
    }
    assert.equal(threads, report.connectedIdeas.rebuilt, 'Rebuilt Connected Ideas thread count changed');
    assert.equal(staleThreads, report.connectedIdeas.stale, 'Stale Connected Ideas thread count changed');
    assert.equal(live.records.length - threads - staleThreads, report.connectedIdeas.kept, 'Kept Connected Ideas record count changed');
  }
  assert.equal(read(site, 'library/data/files.json').version, manifest(site).version, 'Offline manifest stale');
  const catalog = read(site, 'library/data/catalog.json');
  assert.equal(catalog.filter(b => b.slug === SLUG).length, 1);
  console.log(json({ok: true, notes, paragraphs, connectedIdeas: report.connectedIdeas && {...report.connectedIdeas, rebuiltIds: undefined}, updatedFiles: report.affected.length, newFiles: after.length - Object.keys(before).length, version: report.version}));
}

async function publicBytes(name) {
  const url = new URL(name, PUBLIC); url.searchParams.set('tzidkat_verify', Date.now());
  const r = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(60000)});
  assert(r.ok, `HTTP ${r.status} ${name}`); return Buffer.from(await r.arrayBuffer());
}
async function verifyLive(site) {
  const report = read(site, REPORT);
  const targets = [...report.affected, {name: REPORT, sha256: digest(site, REPORT)}];
  let passed = 0, queue = 0; const errors = [];
  await Promise.all(Array.from({length: 6}, async () => {
    for (;;) {
      const n = queue++; if (n >= targets.length) return; const f = targets[n]; let ok = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { if (sha(await publicBytes(f.name)) === f.sha256) { ok = true; break; } } catch (e) { if (attempt === 3) errors.push({path: f.name, error: String(e)}); }
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
      if (!ok) errors.push({path: f.name, error: 'Published bytes did not match local release'}); else passed++;
    }
  }));
  assert.equal(errors.length, 0, 'Live URL verification failed: ' + json(errors.slice(0, 8)));
  write(ROOT, PROOF, {ok: true, live: true, release: RELEASE, publicFilesChecked: passed});
  console.log(json({ok: true, live: true, publicFilesChecked: passed}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, site = '.tzidkat-site', build = '.tzidkat-build'] = process.argv.slice(2);
  if (mode === '--check-pack') console.log(json({ok: true, release: RELEASE, ...loadPack().stats}));
  else if (mode === '--apply') await apply(site, build);
  else if (mode === '--finalize') finalize(site);
  else if (mode === '--verify') verify(site, build === '-' ? null : build);
  else if (mode === '--live') await verifyLive(site);
  else throw Error('Usage: --check-pack | --apply SITE BUILD | --finalize SITE | --verify SITE [BUILD|-] | --live SITE');
}

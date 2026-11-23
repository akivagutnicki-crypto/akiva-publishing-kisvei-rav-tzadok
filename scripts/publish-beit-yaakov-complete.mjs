// Bais Yaakov al HaTorah, complete interlinear edition: a book-only, preservation-checked Pages release.
// Replaces the reader's Beit Yaakov on Torah (Sefer Bereishis, Bereishis–Vayechi) and adds Shemos,
// Vayikra, Bamidbar, Devarim and Moadim. It patches the exact deployed Pages artifact with the freshly
// built data of these six books only; every other sefer is preserved byte for byte.
// Modelled on publish-tzidkat-editorial-master.mjs.
//
//   node scripts/publish-beit-yaakov-complete.mjs --check-pack
//   node scripts/publish-beit-yaakov-complete.mjs --apply SITE BUILD
//   node scripts/publish-beit-yaakov-complete.mjs --finalize SITE
//   node scripts/publish-beit-yaakov-complete.mjs --verify SITE BUILD
//   node scripts/publish-beit-yaakov-complete.mjs --live SITE
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITION_ID = 'beit-yaakov-complete-2026-11';
const RELEASE = '20261123-beit-yaakov-complete';
const REPORT = 'library/beit-yaakov-complete-20261123.json';
const PROOF = 'artifacts/beit-yaakov-complete/final-verification.json';
const STAGE = 'beit-yaakov-complete-stage.json';
const PREVIOUS = 'new-books-baseline.json', META = 'new-books-publication.json';
const PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
// [source file, title, slug, sections, notes, Word download]
const BOOKS = [
  ['sources/akiva/Beit_Yaakov_on_Torah.json', 'Beit Yaakov on Torah', 'beit-yaakov-on-torah', 677, 4245, 'downloads/bais-yaakov-sefer-bereishis.docx'],
  ['sources/akiva/Beit_Yaakov_Shemos.json', 'Beit Yaakov, Shemos', 'beit-yaakov-shemos', 882, 2673, 'downloads/bais-yaakov-sefer-shemos.docx'],
  ['sources/akiva/Beit_Yaakov_Vayikra.json', 'Beit Yaakov, Vayikra', 'beit-yaakov-vayikra', 475, 2326, 'downloads/bais-yaakov-sefer-vayikra.docx'],
  ['sources/akiva/Beit_Yaakov_Bamidbar.json', 'Beit Yaakov, Bamidbar', 'beit-yaakov-bamidbar', 109, 248, 'downloads/bais-yaakov-sefer-bamidbar.docx'],
  ['sources/akiva/Beit_Yaakov_Devarim.json', 'Beit Yaakov, Devarim', 'beit-yaakov-devarim', 92, 210, 'downloads/bais-yaakov-sefer-devarim.docx'],
  ['sources/akiva/Beit_Yaakov_Moadim.json', 'Beit Yaakov, Moadim', 'beit-yaakov-moadim', 175, 333, 'downloads/bais-yaakov-moadim.docx'],
];
const SLUGS = BOOKS.map(b => b[2]);
const PREFIXES = BOOKS.map(b => b[1] + ', ');
const isOurAnchor = a => typeof a === 'string' && PREFIXES.some(p => a.startsWith(p));

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
const leaves = node => node.children ? node.children.flatMap(leaves) : [node];

export function loadPack() {
  const stats = {};
  let sourceHash = createHash('sha256');
  for (const [file, title, slug, sections, notes] of BOOKS) {
    const bytes = fs.readFileSync(path.join(ROOT, file)); sourceHash.update(bytes);
    const src = JSON.parse(bytes.toString('utf8'));
    assert.equal(src.title, title); assert.equal(src.editionId, EDITION_ID, 'Not the complete edition: ' + file);
    assert(src.interlinear && Array.isArray(src.sectionsFiles) && src.sectionsFiles.length, 'Missing section parts: ' + file);
    const all = [];
    for (const part of src.sectionsFiles) {
      const raw = fs.readFileSync(path.join(ROOT, part)); sourceHash.update(raw);
      assert(raw.length <= 10 * 1024 * 1024, 'Section part over 10 MB: ' + part);
      all.push(...JSON.parse(gunzipSync(raw).toString('utf8')));
    }
    assert.equal(all.length, sections, title + ' section count'); assert.equal(src.sectionCount, sections);
    const keys = new Set(); let paragraphs = 0, pairs = 0, n = 0;
    for (const sec of all) {
      assert(sec.key && !keys.has(sec.key), 'Duplicate or missing key ' + sec.key); keys.add(sec.key);
      assert(/[א-ת]/.test(sec.he) && /^(Os|HaKolel) \d+/.test(sec.en), 'Bad section labels ' + sec.key);
      for (const item of sec.items) {
        if ('h' in item) continue;
        assert(Array.isArray(item.p) && item.p.length, 'Empty paragraph in ' + sec.key);
        paragraphs++; pairs += item.p.length;
        for (const note of item.footnotes || []) {
          n++;
          assert.equal(note.number, n, title + ' note numbering at ' + sec.key);
          assert(item.p[note.phraseIndex], 'Note without its phrase ' + note.sourceId);
          assert(note.paragraphs?.length, 'Empty note ' + note.sourceId);
          for (const s of note.sources || []) assert(/^https:\/\/www\.sefaria\.org\//.test(s.url), 'Non-Sefaria source ' + note.sourceId);
        }
      }
    }
    assert.equal(n, notes, title + ' notes');
    const grouped = src.tocGroups.flatMap(g => g.keys);
    assert.equal(grouped.length, sections); assert.deepEqual(new Set(grouped), keys);
    const docx = src.downloads?.[0]?.source; assert(docx && fs.statSync(path.join(ROOT, docx)).size <= 10 * 1024 * 1024, 'Word file missing or over 10 MB: ' + docx);
    stats[slug] = {sections, paragraphs, pairs, notes};
  }
  return {stats, sourceSha256: sourceHash.digest('hex')};
}

function allFiles(directory, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isSymbolicLink()) { assert(!prefix.startsWith('library/data/'), 'Untrusted data symlink: ' + prefix + e.name); continue; }
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
function stripOurs(index) {
  const out = {};
  for (const [ref, anchors] of Object.entries(index)) { const kept = anchors.filter(a => !isOurAnchor(a)); if (kept.length) out[ref] = kept; }
  return out;
}
function mergeOurs(index, fresh) {
  for (const [ref, anchors] of Object.entries(fresh)) {
    const mine = anchors.filter(isOurAnchor); if (!mine.length) continue;
    const list = index[ref] ??= []; for (const a of mine) if (!list.includes(a)) list.push(a);
  }
  return index;
}

export async function apply(site, build) {
  const {stats, sourceSha256} = loadPack();
  const before = read(ROOT, PREVIOUS).files, base = read(ROOT, META);
  assert.equal(read(ROOT, PREVIOUS).publication?.artifactId, base.publication?.artifactId, 'Baseline selection changed');
  const affected = new Set(), created = new Set();
  const touch = (name, data) => {
    if (before[name]) assert.equal(digest(site, name), before[name], 'Existing site file changed since baseline capture: ' + name);
    else if (!created.has(name)) { assert(!exists(site, name), 'Untracked file collision: ' + name); created.add(name); }
    write(site, name, data); affected.add(name);
  };
  // 1. chapter files, toc and links of the six books from the fresh build
  for (const slug of SLUGS) {
    const buildDir = relative(build, 'library/data/' + slug);
    const btoc = read(build, `library/data/${slug}/toc.json`);
    const ls = leaves(btoc.toc); assert.equal(ls.length, stats[slug].sections, slug + ' TOC leaves');
    let notes = 0, paragraphs = 0;
    for (const leaf of ls) {
      const name = `library/data/${slug}/${leaf.id}.json`;
      const rows = read(build, name);
      for (const row of rows) { if (row.p) paragraphs++; notes += (row.footnotes || []).length; }
      touch(name, fs.readFileSync(relative(build, name)));
    }
    assert.equal(notes, stats[slug].notes, slug + ' built notes'); assert.equal(paragraphs, stats[slug].paragraphs, slug + ' built paragraphs');
    for (const f of ['toc.json', 'links.json']) touch(`library/data/${slug}/${f}`, fs.readFileSync(path.join(buildDir, f)));
  }
  // 2. catalog: replace Beit Yaakov on Torah in place, insert the five new books right after it
  const catalogName = 'library/data/catalog.json', catalog = read(site, catalogName), bcatalog = read(build, catalogName);
  const fresh = SLUGS.map(slug => { const e = bcatalog.find(b => b.slug === slug); assert(e, 'Fresh catalog lacks ' + slug); return e; });
  const others = catalog.filter(b => !SLUGS.includes(b.slug));
  let at = catalog.findIndex(b => b.slug === SLUGS[0]);
  if (at < 0) at = catalog.length;
  const keptBefore = catalog.slice(0, at).filter(b => !SLUGS.includes(b.slug));
  const next = [...keptBefore, ...fresh, ...catalog.slice(at).filter(b => !SLUGS.includes(b.slug))];
  assert.equal(json(next.filter(b => !SLUGS.includes(b.slug))), json(others), 'Other catalog entries changed');
  touch(catalogName, next);
  // 3. reverse citation indexes: drop every old anchor of these books, add the fresh ones
  const citedDir = 'library/data/cited', freshCited = {};
  for (const f of fs.readdirSync(relative(build, citedDir))) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const mine = {};
    for (const [ref, anchors] of Object.entries(read(build, citedDir + '/' + f))) { const m = anchors.filter(isOurAnchor); if (m.length) mine[ref] = m; }
    if (Object.keys(mine).length) freshCited[f] = mine;
  }
  const siteCitedFiles = fs.readdirSync(relative(site, citedDir)).filter(f => f.endsWith('.json') && f !== 'index.json');
  const touchedCited = new Set();
  for (const f of siteCitedFiles) {
    const idx = read(site, citedDir + '/' + f);
    const had = Object.values(idx).some(a => a.some(isOurAnchor));
    if (had || freshCited[f]) { touch(citedDir + '/' + f, mergeOurs(stripOurs(idx), freshCited[f] || {})); touchedCited.add(f); }
  }
  for (const [f, mine] of Object.entries(freshCited)) if (!siteCitedFiles.includes(f)) { touch(citedDir + '/' + f, mine); touchedCited.add(f); }
  const citedIndexName = citedDir + '/index.json', citedIndex = new Set(read(site, citedIndexName));
  for (const f of fs.readdirSync(relative(site, citedDir))) if (f.endsWith('.json') && f !== 'index.json' && Object.keys(read(site, citedDir + '/' + f)).length) citedIndex.add(f.slice(0, -5));
  touch(citedIndexName, [...citedIndex].sort());
  const mcpCitedName = 'mcp-data/cited.json';
  if (exists(site, mcpCitedName) && exists(build, mcpCitedName)) {
    const freshMcp = {};
    for (const [ref, anchors] of Object.entries(read(build, mcpCitedName))) { const m = anchors.filter(isOurAnchor); if (m.length) freshMcp[ref] = m; }
    touch(mcpCitedName, mergeOurs(stripOurs(read(site, mcpCitedName)), freshMcp));
  }
  // 4. source pack refs (union)
  const packName = 'library/data/packs/sources.json';
  if (exists(site, packName) && exists(build, packName)) {
    const pack = read(site, packName), bpack = read(build, packName);
    pack.refs = [...new Set([...pack.refs, ...bpack.refs])].sort(); touch(packName, pack);
  }
  // 5. MCP text, search index, chunks and parallels of these books
  const mcpCatalogName = 'mcp-data/catalog.json';
  const mc = exists(site, mcpCatalogName) ? read(site, mcpCatalogName) : null, bmc = read(build, mcpCatalogName);
  let lastMcp = mc ? mc.books.findIndex(b => b.slug === SLUGS[0]) : -1;
  for (const slug of SLUGS) {
    for (const name of [`mcp-data/text/${slug}.json`, `mcp-data/parallels/${slug}.json`, `library/data/parallels/${slug}.json`])
      if (exists(build, name)) touch(name, fs.readFileSync(relative(build, name)));
    let mcpFiles = 0;
    for (const f of fs.readdirSync(relative(build, 'mcp-data/search')).filter(f => f.startsWith(slug + '.')).sort()) {
      touch('mcp-data/search/' + f, fs.readFileSync(relative(build, 'mcp-data/search/' + f))); mcpFiles++;
    }
    if (exists(build, 'mcp-data/text-chunks/' + slug))
      for (const f of fs.readdirSync(relative(build, 'mcp-data/text-chunks/' + slug)).sort()) {
        touch(`mcp-data/text-chunks/${slug}/${f}`, fs.readFileSync(relative(build, `mcp-data/text-chunks/${slug}/${f}`))); mcpFiles++;
      }
    assert(mcpFiles >= 1, 'Fresh build lacks the MCP search files of ' + slug);
    if (mc) {
      const be = bmc.books.find(b => b.slug === slug); assert(be, 'Fresh MCP catalog lacks ' + slug);
      const j = mc.books.findIndex(b => b.slug === slug);
      if (j >= 0) { mc.books[j] = be; lastMcp = j; }
      else { lastMcp = lastMcp >= 0 ? lastMcp + 1 : mc.books.length; mc.books.splice(lastMcp, 0, be); }
    }
  }
  if (mc) touch(mcpCatalogName, mc);
  // 6. Word downloads
  for (const [, , , , , download] of BOOKS) { assert(exists(build, 'library/' + download), 'Missing Word volume ' + download); touch('library/' + download, fs.readFileSync(relative(build, 'library/' + download))); }
  // Connected Ideas threads that touched the previous Beit Yaakov text stay in the published catalog;
  // the reader verifies each thread's Hebrew against the current paragraph and hides any that no longer match.
  const report = {schemaVersion: 1, release: RELEASE, editionId: EDITION_ID, publication: base.publication, sourceSha256,
    stats, citedFilesUpdated: touchedCited.size, affected: [...affected].sort(), created: [...created].sort(), stage: 'applied'};
  write(ROOT, STAGE, report);
  console.log(json({ok: true, stage: 'applied', stats, affectedFiles: affected.size, createdFiles: created.size, citedFilesUpdated: touchedCited.size}));
}

export function finalize(site) {
  const stage = read(ROOT, STAGE), before = read(ROOT, PREVIOUS).files;
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
  const folders = SLUGS.map(s => `url.startsWith('data/${s}/')`).join(' || ');
  touch(htmlName, html.replace(marker, marker + `/* ${RELEASE} */ (${folders} || url.startsWith('data/cited/') || url.startsWith('data/parallels/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + (url.includes('?') ? '&' : '?') + 'beit=${stamp}' :\n`));
  const swName = 'library/sw.js', sw = fs.readFileSync(relative(site, swName), 'utf8');
  assert.equal((sw.match(/const SHELL = `[^`]+`;/g) || []).length, 1, 'Unexpected service worker cache revision');
  touch(swName, sw.replace(/const SHELL = `([^`]+)`;/, (_, v) => `const SHELL = \`${v}-beit-complete-${stamp}\`;`));
  const report = {...stage, stage: 'finalized', version: m.version,
    affected: [...affected].sort().map(name => ({name, sha256: digest(site, name), preimage: before[name] || null}))};
  write(site, REPORT, report);
  write(ROOT, PROOF, {ok: true, release: RELEASE, stats: stage.stats, publishedFiles: report.affected.length, version: m.version, baselineArtifact: stage.publication?.artifactId});
  console.log(json({ok: true, stage: 'finalized', version: m.version, affectedFiles: report.affected.length}));
}

export function verify(site, build) {
  const {stats} = loadPack(), before = read(ROOT, PREVIOUS).files, report = read(site, REPORT);
  assert.equal(report.release, RELEASE); assert.equal(report.editionId, EDITION_ID);
  const allow = new Set([REPORT, ...report.affected.map(f => f.name)]);
  for (const [name, hash] of Object.entries(before)) {
    assert(fs.existsSync(relative(site, name)), 'Existing published file missing: ' + name);
    if (!allow.has(name)) assert.equal(digest(site, name), hash, 'Unrelated published file altered: ' + name);
  }
  for (const f of report.affected) assert.equal(digest(site, f.name), f.sha256, 'Published file changed: ' + f.name);
  const valid = new Set();
  for (const slug of SLUGS) {
    const toc = read(site, `library/data/${slug}/toc.json`), ls = leaves(toc.toc);
    assert.equal(ls.length, stats[slug].sections, slug + ' published TOC');
    let notes = 0, paragraphs = 0;
    for (const leaf of ls) {
      const name = `library/data/${slug}/${leaf.id}.json`;
      if (build) assert.equal(digest(site, name), digest(build, name), 'Chapter differs from the fresh build: ' + name);
      for (const row of read(site, name)) { if (row.p) { paragraphs++; valid.add(`${leaf.ref}${leaf.sep || ':'}${row.n}`); } notes += (row.footnotes || []).length; }
    }
    assert.equal(notes, stats[slug].notes, slug + ' notes'); assert.equal(paragraphs, stats[slug].paragraphs, slug + ' paragraphs');
  }
  let anchors = 0;
  for (const f of fs.readdirSync(relative(site, 'library/data/cited'))) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    for (const list of Object.values(read(site, 'library/data/cited/' + f))) for (const a of list) if (isOurAnchor(a)) {
      anchors++; assert(valid.has(a), 'Stale Beit Yaakov anchor in cited/' + f + ': ' + a);
    }
  }
  assert(anchors > 1000, 'Too few Beit Yaakov citation anchors: ' + anchors);
  assert.equal(read(site, 'library/data/files.json').version, manifest(site).version, 'Offline manifest stale');
  const catalog = read(site, 'library/data/catalog.json');
  for (const slug of SLUGS) assert.equal(catalog.filter(b => b.slug === slug).length, 1, 'Catalog entry ' + slug);
  console.log(json({ok: true, stats, citationAnchors: anchors, updatedFiles: report.affected.length, version: report.version}));
}

async function publicBytes(name) {
  const url = new URL(name, PUBLIC); url.searchParams.set('beit_verify', Date.now());
  const r = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(60000)});
  assert(r.ok, `HTTP ${r.status} ${name}`); return Buffer.from(await r.arrayBuffer());
}
async function verifyLive(site) {
  const report = read(site, REPORT);
  const targets = [...report.affected, {name: REPORT, sha256: digest(site, REPORT)}];
  let passed = 0, queue = 0; const errors = [];
  await Promise.all(Array.from({length: 8}, async () => {
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
  const [mode, site = '.beit-site', build = '.beit-build'] = process.argv.slice(2);
  if (mode === '--check-pack') { const {stats, sourceSha256} = loadPack(); console.log(json({ok: true, release: RELEASE, sourceSha256, stats})); }
  else if (mode === '--apply') await apply(site, build);
  else if (mode === '--finalize') finalize(site);
  else if (mode === '--verify') verify(site, build === '-' ? null : build);
  else if (mode === '--live') await verifyLive(site);
  else throw Error('Usage: --check-pack | --apply SITE BUILD | --finalize SITE | --verify SITE [BUILD|-] | --live SITE');
}

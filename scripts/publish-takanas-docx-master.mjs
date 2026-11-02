// Replace Takanas HaShavin from the exact corrected KDP source over a captured
// complete Pages artifact. No historical edition guard or other book is rebuilt.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {computeTakanatParallels} from './takanat-parallels.mjs';
import {patchTakanasSeifNavigation} from './patch-takanas-seif-navigation.mjs';
import {patchTakanasPrintPreview, patchTakanasEditionRanges, verifyTakanasPrintPreviewSources, TAKANAS_PRINT_PREVIEW_ASSETS} from './patch-takanas-print-preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = 'Takanat HaShavin', SLUG = 'takanat-hashavin';
const EDITION = 'takanas-docx-master-2026-11-02';
const RELEASE = '20261102-takanas-docx-master-v1';
const SOURCE = 'sources/akiva/Takanat_HaShavin.json';
const MANIFEST = 'sources/akiva/overlays/takanas-docx-master-20261102-manifest.json';
const REPORT = 'library/takanas-docx-master-20261102.json';
const STAGE = 'artifacts/takanas-docx-master/stage.json';
const PROOF = 'artifacts/takanas-docx-master/final-verification.json';
const BASE = 'new-books-baseline.json', META = 'new-books-publication.json';
const IDEAS = 'library/connected-ideas/catalog.json';
const PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const ARCHIVES = ['library/downloads/rav-tzadok-library.zip', `library/downloads/books/${SLUG}.zip`];
const DOCS = {I: 'downloads/takanas-hashavin-volume-i-corrected.docx', II: 'downloads/takanas-hashavin-volume-ii-corrected.docx'};
const EXPECTED = {I: 1526, II: 1095};
const PREVIEW_PATHS = ['Takanas_HaShavin_Volume_I_Siman_Aleph.pdf', 'previews/takanas-hashavin-20-page-preview.pdf', 'sample-page.png', 'sample-text-page.png'];
const RANGE_HTML_PATHS = ['library/index.html', 'library/blog/index.html', 'library/blog/the-alchemy-of-the-soul/index.html'];
const sha = b => createHash('sha256').update(b).digest('hex');
const encode = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x));
const json = x => JSON.stringify(x);
const local = (root, name) => {
  assert(name && !path.isAbsolute(name) && name.split('/').every(x => x && x !== '.' && x !== '..'), 'Unsafe path: ' + name);
  const p = path.resolve(root, name); assert(p.startsWith(path.resolve(root) + path.sep)); return p;
};
const read = (root, name) => JSON.parse(fs.readFileSync(local(root, name), 'utf8'));
const bytes = (root, name) => fs.readFileSync(local(root, name));
const exists = (root, name) => fs.existsSync(local(root, name));
const digest = (root, name) => sha(bytes(root, name));
const write = (root, name, value) => { const p = local(root, name); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, Buffer.isBuffer(value) || value instanceof Uint8Array ? value : encode(value)); };
const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ', zwnj: '‌', zwj: '‍', lrm: '', rlm: ''};
// Reader anchors use DOM.textContent: the layout-only <br/> between joined
// native Word paragraphs contributes no character. Real Word newlines in note
// paragraph.text remain real newlines and are not confused with that HTML break.
const text = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? all);
const mcpPlain = s => text(s).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const mine = ref => typeof ref === 'string' && (ref.startsWith(BOOK + ' ') || ref.startsWith(BOOK + ','));
const involves = r => mine(r.originRef) || mine(r.targetRef);

function files(root, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(path.resolve(root, prefix), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    assert(!e.isSymbolicLink(), 'Unexpected publication symlink: ' + prefix + e.name);
    if (e.isDirectory()) out.push(...files(root, prefix + e.name + '/'));
    else { assert(e.isFile(), 'Unexpected publication object'); out.push(prefix + e.name); }
  }
  return out;
}
const inventory = root => Object.fromEntries(files(root).map(n => [n, digest(root, n)]));
const namedPublicInventory = (root, omitReport = false) => files(root).filter(n => /takanas|takanat/i.test(n) && (!omitReport || n !== REPORT)).map(name => ({name, sha256: digest(root, name), bytes: fs.statSync(local(root, name)).size}));
const volume = v => { const s = String(v).replace(/^Volume\s*/i, '').toUpperCase(); assert(['I', 'II', '1', '2'].includes(s), 'Invalid volume: ' + v); return s === '1' ? 'I' : s === '2' ? 'II' : s; };
const fixed = new Set([REPORT, 'index.html', ...PREVIEW_PATHS, ...RANGE_HTML_PATHS, `library/data/${SLUG}/toc.json`, `library/data/${SLUG}/links.json`,
  ...Array.from({length: 16}, (_, i) => `library/data/${SLUG}/${i}.json`),
  'library/data/catalog.json', 'library/data/cited/index.json', 'library/data/packs/sources.json',
  'library/data/files.json', 'library/data/parallels/index.json', 'library/data/parallels/words.json',
  `library/data/parallels/${SLUG}.json`, 'mcp-data/cited.json', 'mcp-data/catalog.json',
  `mcp-data/text/${SLUG}.json`, `mcp-data/parallels/${SLUG}.json`, 'mcp-data/parallels/index.json', 'mcp-data/parallels/words.json',
  IDEAS, 'library/index.html', 'library/sw.js', 'library/downloads/index.json',
  ...ARCHIVES, ...Object.values(DOCS).map(n => 'library/' + n)]);
const permitted = (name, retired = []) => fixed.has(name) || /^library\/data\/cited\/[a-z0-9-]+\.json$/.test(name) || retired.includes(name);
function strip(index) {
  return Object.fromEntries(Object.entries(index).flatMap(([r, a]) => { assert(Array.isArray(a)); const kept = a.filter(x => !mine(x)); return kept.length ? [[r, kept]] : []; }));
}
function merge(index, fresh) {
  const out = strip(index);
  for (const [r, a] of Object.entries(fresh)) {
    const add = a.filter(mine); if (!add.length) continue;
    const list = out[r] ??= []; for (const anchor of add) if (!list.includes(anchor)) list.push(anchor);
  }
  return out;
}

export function loadPack() {
  const manifest = read(ROOT, MANIFEST), src = read(ROOT, SOURCE);
  assert.equal(digest(ROOT, SOURCE), manifest.canonicalSha256, 'Canonical KDP import preimage changed');
  assert.equal(src.editionId, EDITION); assert.equal(src.title, BOOK); assert.equal(src.sections.length, 16);
  assert.equal(manifest.notes, 2621); assert.equal(manifest.sections, 16); assert.equal(manifest.paragraphs, 363);
  assert(Number.isInteger(manifest.pairs) && manifest.pairs > 0);
  assert(Array.isArray(manifest.sourceUrlAllowlist));
  const allow = new Set(manifest.sourceUrlAllowlist);
  for (const u of allow) { assert(typeof u === 'string' && ['https:', 'http:'].includes(new URL(u).protocol), 'Unsafe allowed source URL'); }
  const docs = new Map(); assert.equal(manifest.docx.length, 2);
  for (const d of manifest.docx) {
    const v = volume(d.volume); assert(!docs.has(v)); assert.equal(d.notes, EXPECTED[v]);
    assert.equal(digest(ROOT, d.path), d.sha256, 'Authoritative KDP Word bytes changed: ' + d.path); docs.set(v, d);
  }
  assert.equal(docs.size, 2);
  const ids = new Set(), placements = new Set(), counts = {I: 0, II: 0}; let paragraphs = 0, pairs = 0, headings = 0;
  src.sections.forEach((sec, i) => {
    if (i === 0) assert.equal(sec.key, 'Introduction'); else assert.equal(sec.n, i);
    const numbers = new Set();
    for (const item of sec.items) {
      if (!item.p) { assert(typeof item.h === 'string'); headings++; continue; }
      paragraphs++; pairs += item.p.length; assert(Number.isInteger(item.n) && item.n > 0 && !numbers.has(item.n)); numbers.add(item.n);
      for (const pair of item.p) { assert(Array.isArray(pair) && pair.length === 2 && pair.every(x => typeof x === 'string')); assert(/[א-ת]/.test(pair[0])); }
      const hePositions = new Set();
      for (const note of item.footnotes || []) {
        const m = /^TK-KDP-(II|I)-(\d{4})$/.exec(note.sourceId); assert(m, 'Non-KDP note: ' + note.sourceId);
        const v = m[1], n = Number(m[2]); assert.equal(note.number, n); assert(n >= 1 && n <= EXPECTED[v]); counts[v]++;
        assert(!ids.has(note.sourceId)); ids.add(note.sourceId); assert(typeof note.placementId === 'string' && note.placementId.startsWith(note.sourceId) && !placements.has(note.placementId)); placements.add(note.placementId);
        const pair = item.p[note.phraseIndex]; assert(pair && Number.isInteger(note.phraseIndex));
        const position = note.phraseIndex + ':' + note.heCharOffset; assert(!hePositions.has(position), 'Clustered Hebrew marker: ' + note.sourceId); hePositions.add(position);
        for (const [side, k] of [['he', 0], ['en', 1]]) {
          const off = note[side + 'CharOffset']; assert(Number.isInteger(off) && off >= (side === 'he' ? 1 : 0) && off <= text(pair[k]).length, 'Invalid anchor offset ' + note.sourceId);
          assert.equal(text(pair[k]).slice(0, off), note[side + 'AnchorPrefix'], 'Exact anchor prefix changed: ' + note.sourceId + ' ' + side);
        }
        assert(Array.isArray(note.paragraphs) && note.paragraphs.length);
        for (const p of note.paragraphs) {
          assert(typeof p.text === 'string' && Array.isArray(p.rich)); assert.equal(p.rich.map(r => r.text).join(''), p.text, 'Rich note text differs: ' + note.sourceId);
          for (const r of p.rich) if (r.href) assert(allow.has(r.href), 'Unapproved rich source URL: ' + r.href);
          for (const link of p.links || []) if (link.url) assert(allow.has(link.url), 'Unapproved paragraph source URL');
        }
        for (const s of note.sources || []) { assert(s.ref || s.label, 'Unlabelled source'); if (s.url) assert(allow.has(s.url), 'Unapproved source URL: ' + s.url); }
      }
    }
  });
  assert.equal(paragraphs, manifest.paragraphs); assert.equal(pairs, manifest.pairs); assert.deepEqual(counts, EXPECTED);
  for (const [v, max] of Object.entries(EXPECTED)) for (let n = 1; n <= max; n++) assert(ids.has(`TK-KDP-${v}-${String(n).padStart(4, '0')}`), 'Missing canonical note');
  const allNotes = src.sections.flatMap(sec => sec.items.flatMap(item => item.footnotes || [])), byPlacement = new Map(allNotes.map(note => [note.placementId, note]));
  for (const note of allNotes) if (note.crossReference) { const target = byPlacement.get(note.crossReference.placementId); assert(target, 'Unresolved manuscript note cross-reference: ' + note.sourceId); if (note.crossReference.number !== undefined) assert.equal(note.crossReference.number, target.number, 'Cross-reference printed number differs'); }
  const navProof = manifest.seifNavigation; assert(navProof && navProof.entries === 356); assert.equal(digest(ROOT, navProof.path), navProof.sha256, 'Printed-seif navigation source changed');
  const navigation = read(ROOT, navProof.path); assert.equal(navigation.editionId, EDITION); assert.equal(navigation.sourceSha256, manifest.canonicalSha256); assert.equal(navigation.simanim.length, 15);
  const navTargets = new Set(), expectedTargets = new Set(); let navCount = 0;
  for (let i = 1; i < 16; i++) for (const row of src.sections[i].items) for (const h of row.inlineHeadings || []) if (h.kind === 'section') expectedTargets.add(json([i, row.n, h.phraseIndex, h.text]));
  navigation.simanim.forEach((siman, index) => {
    const i = index + 1; assert.equal(siman.n, i); assert.equal(siman.ref, BOOK + ' ' + i); assert.equal(siman.seifCount, siman.entries.length);
    siman.entries.forEach((entry, offset) => {
      assert.equal(entry.n, offset + 1); assert.equal(entry.sourcePrintedSeif, entry.n);
      const match = new RegExp('^Takanat HaShavin ' + i + ':(\\d+)$').exec(entry.ref); assert(match, 'Invalid printed-seif Reader target');
      const rows = src.sections[i].items.filter(row => row.p && row.n === Number(match[1])); assert.equal(rows.length, 1); const row = rows[0], pair = row.p[entry.phraseIndex]; assert(pair && Number.isInteger(entry.phraseIndex));
      assert.equal(text(pair[0]), entry.firstHe); assert.equal(text(pair[1]), entry.firstEn); assert.equal(pair[0], entry.firstHeHtml); assert.equal(pair[1], entry.firstEnHtml);
      const key = json([i, row.n, entry.phraseIndex, entry.headingTitle]); assert(expectedTargets.has(key) && !navTargets.has(key), 'Missing or duplicate native printed-seif heading'); navTargets.add(key);
      const origin = row.docxProvenance?.[entry.phraseIndex]; assert(origin); assert.equal(origin.volume, entry.sourceVolume); assert.equal(origin.paragraph, entry.nativeParagraph); assert.equal(origin.printedSeif, entry.sourcePrintedSeif); navCount++;
    });
  });
  assert.equal(navCount, 356); assert.deepEqual(navTargets, expectedTargets, 'Printed-seif navigation does not cover every source heading');
  assert(Array.isArray(manifest.previewAssets)); assert.deepEqual(manifest.previewAssets.map(a => a.path).sort(), [...PREVIEW_PATHS].sort()); verifyTakanasPrintPreviewSources();
  const previewPins = new Map(TAKANAS_PRINT_PREVIEW_ASSETS.flatMap(a => a.publicPaths.map(p => [p, a.sha256])));
  for (const asset of manifest.previewAssets) { assert.equal(asset.sha256, previewPins.get(asset.path)); assert.equal(digest(ROOT, asset.source), asset.sha256, 'Corrected print preview source changed'); }
  return {src, manifest, docs, allow, navigation, sourceSha256: digest(ROOT, SOURCE), manifestSha256: digest(ROOT, MANIFEST), stats: {sections: 16, paragraphs, pairs, headings, notes: ids.size, notesByVolume: counts, printedSeifNavigation: navCount}};
}

function compareReader(site, pack, build = null) {
  let notes = 0; const valid = new Set(), anchors = new Set();
  const toc = read(site, `library/data/${SLUG}/toc.json`); assert.equal(toc.toc.children.length, 16);
  for (let i = 0; i < 16; i++) {
    const name = `library/data/${SLUG}/${i}.json`, rows = read(site, name), sourceItems = pack.src.sections[i].items, expected = sourceItems.filter(r => r.p), actual = rows.filter(r => r.p);
    const sourceSection = pack.src.sections[i], expectedRef = i ? BOOK + ' ' + sourceSection.n : BOOK + ', ' + sourceSection.key;
    assert.equal(toc.toc.children[i].id, i); assert.equal(toc.toc.children[i].ref, expectedRef); assert.equal(toc.toc.children[i].shape, expected.length); assert.equal(toc.toc.children[i].sep, sourceSection.sep || (i ? ':' : ' '));
    assert.deepEqual(toc.toc.children[i].seifNavigation || [], i ? pack.navigation.simanim[i - 1].entries : [], 'Printed-seif TOC entries differ from native Word coordinates');
    if (build) assert.equal(digest(site, name), digest(build, name), 'Published section differs from fresh build');
    assert.equal(rows.length, sourceItems.length, 'Source heading/paragraph sequence differs in section ' + i);
    for (const [index, item] of sourceItems.entries()) for (const [key, value] of Object.entries(item)) if (!['p', 'footnotes', 'pendingEditorialHeadings'].includes(key)) assert.deepEqual(rows[index][key], value, 'Source metadata or heading changed at section ' + i + ' item ' + index + ' field ' + key);
    assert.equal(actual.length, expected.length, 'Paragraph count differs in section ' + i);
    for (let n = 0; n < expected.length; n++) {
      const a = actual[n], e = expected[n]; assert.equal(a.n, e.n); assert.deepEqual(a.p.map(p => p.map(text)), e.p.map(p => p.map(text)), 'Source phrase text/order changed at ' + i + ':' + e.n);
      assert.deepEqual(a.footnotes || [], e.footnotes || [], 'Canonical note content/metadata changed at ' + i + ':' + e.n);
      valid.add(toc.toc.children[i].ref + (toc.toc.children[i].sep || (i ? ':' : ' ')) + a.n);
      for (const note of a.footnotes || []) { notes++; assert(!anchors.has(note.placementId)); anchors.add(note.placementId); const pair = a.p[note.phraseIndex]; for (const [s, k] of [['he', 0], ['en', 1]]) assert.equal(text(pair[k]).slice(0, note[s + 'CharOffset']), note[s + 'AnchorPrefix']); }
    }
  }
  assert.equal(notes, pack.stats.notes); return {notes, valid};
}

export async function apply(site, build) {
  const pack = loadPack(), state = read(ROOT, BASE), meta = read(ROOT, META), before = state.files;
  assert.equal(state.publication.artifactId, meta.publication.artifactId); assert.deepEqual(inventory(site), before, 'Preserved artifact changed after capture');
  const namedPublicBefore = namedPublicInventory(site);
  compareReader(build, pack);
  const affected = new Set(), removed = [], otherCitationPins = {}, retired = [];
  const put = (name, value) => {
    assert(permitted(name, retired), 'Outside Takanas publication scope: ' + name);
    const b = Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value) : encode(value);
    if (!exists(site, name) || digest(site, name) !== sha(b)) { write(site, name, b); affected.add(name); }
  };
  const catalog = read(site, 'library/data/catalog.json'), oldBook = catalog.find(b => b.slug === SLUG); assert(oldBook);
  const otherCatalogPin = sha(json(catalog.filter(b => b.slug !== SLUG)));
  for (const d of oldBook.downloads || []) if (!Object.values(DOCS).includes(d.file)) {
    assert(/^downloads\/[a-z0-9-]+\.(docx|pdf)$/i.test(d.file), 'Unexpected old Takanas asset');
    assert(!catalog.some(b => b.slug !== SLUG && (b.downloads || []).some(x => x.file === d.file)), 'A shared document cannot be retired');
    const name = 'library/' + d.file; retired.push(name);
    if (exists(site, name)) { fs.unlinkSync(local(site, name)); removed.push(name); }
  }
  for (const f of [...Array.from({length: 16}, (_, i) => i + '.json'), 'toc.json', 'links.json']) put(`library/data/${SLUG}/${f}`, bytes(build, `library/data/${SLUG}/${f}`));
  const freshBook = read(build, 'library/data/catalog.json').find(b => b.slug === SLUG); assert(freshBook);
  const downloads = Object.entries(DOCS).map(([v, file]) => ({file, label: `Corrected KDP Volume ${v} (Word)`}));
  catalog[catalog.findIndex(b => b.slug === SLUG)] = {...freshBook, downloads}; put('library/data/catalog.json', catalog);
  const refs = new Set(), freshCited = {};
  for (const file of files(local(build, 'library/data/cited')).filter(n => n.endsWith('.json') && n !== 'index.json')) {
    const idx = read(build, 'library/data/cited/' + file), mineOnly = {};
    for (const [r, a] of Object.entries(idx)) { const list = a.filter(mine); if (list.length) { mineOnly[r] = list; refs.add(r); } }
    if (Object.keys(mineOnly).length) freshCited[file] = mineOnly;
  }
  const existingCited = files(local(site, 'library/data/cited')).filter(n => n.endsWith('.json') && n !== 'index.json');
  for (const file of new Set([...existingCited, ...Object.keys(freshCited)])) {
    assert(!file.includes('/')); const name = 'library/data/cited/' + file, original = exists(site, name) ? read(site, name) : {};
    otherCitationPins[name] = sha(json(strip(original)));
    if (Object.values(original).some(a => a.some(mine)) || freshCited[file]) put(name, merge(original, freshCited[file] || {}));
  }
  const citedIndex = new Set(read(site, 'library/data/cited/index.json')); for (const f of Object.keys(freshCited)) citedIndex.add(f.slice(0, -5)); put('library/data/cited/index.json', [...citedIndex].sort());
  const oldMcpCited = read(site, 'mcp-data/cited.json'), freshMcpCited = read(build, 'mcp-data/cited.json');
  otherCitationPins['mcp-data/cited.json'] = sha(json(strip(oldMcpCited))); put('mcp-data/cited.json', merge(oldMcpCited, freshMcpCited));
  for (const [r, a] of Object.entries(freshMcpCited)) if (a.some(mine)) refs.add(r);
  const sourcePack = read(site, 'library/data/packs/sources.json'), originalSourcePack = structuredClone(sourcePack); sourcePack.refs = [...new Set([...sourcePack.refs, ...refs])].sort(); put('library/data/packs/sources.json', sourcePack);
  const newMcp = read(build, `mcp-data/text/${SLUG}.json`); put(`mcp-data/text/${SLUG}.json`, bytes(build, `mcp-data/text/${SLUG}.json`));
  const mcpCatalog = read(site, 'mcp-data/catalog.json'), freshMcpCatalog = read(build, 'mcp-data/catalog.json');
  const otherMcpPin = sha(json(mcpCatalog.books.filter(b => b.slug !== SLUG))), mc = freshMcpCatalog.books.find(b => b.slug === SLUG); assert(mc && mc.sections.length === 16); mcpCatalog.books[mcpCatalog.books.findIndex(b => b.slug === SLUG)] = mc; put('mcp-data/catalog.json', mcpCatalog);
  // Derive this book's candidates against the actual restored publication,
  // not the historical canonical build of the other seforim. The helper never
  // writes another book's data. The new book/catalog are already installed.
  const parallels = computeTakanatParallels(site, {mcpOverride: newMcp});
  put(`library/data/parallels/${SLUG}.json`, parallels.parallels); put(`mcp-data/parallels/${SLUG}.json`, parallels.parallels);
  // Keep the MCP reverse index complete even if the preparatory fresh build
  // has not run its global parallels generator. These quoted verses derive
  // solely from the new Takanas Hebrew in the current-artifact computation.
  const combinedMcpCited = read(site, 'mcp-data/cited.json');
  for (const [anchor, quoted] of Object.entries(parallels.quotedByRef)) for (const ref of quoted) { const list = combinedMcpCited[ref] ??= []; if (!list.includes(anchor)) list.push(anchor); refs.add(ref); }
  put('mcp-data/cited.json', combinedMcpCited);
  sourcePack.refs = [...new Set([...originalSourcePack.refs, ...refs])].sort(); put('library/data/packs/sources.json', sourcePack);
  const originalWords = {};
  for (const prefix of ['library/data/parallels', 'mcp-data/parallels']) {
    const idx = new Set(read(site, prefix + '/index.json')); idx.add(SLUG); put(prefix + '/index.json', [...idx].sort());
    const words = read(site, prefix + '/words.json'); originalWords[prefix + '/words.json'] = structuredClone(words);
    for (const [id, value] of Object.entries(parallels.wordAdditions)) { if (words[id]) assert.deepEqual(words[id], value, 'Existing rare-word definition changed'); words[id] = value; } put(prefix + '/words.json', words);
  }
  for (const [v, name] of Object.entries(DOCS)) put('library/' + name, bytes(ROOT, pack.docs.get(v).path));
  for (const asset of pack.manifest.previewAssets) put(asset.path, bytes(ROOT, asset.source));
  put('index.html', patchTakanasPrintPreview(bytes(site, 'index.html').toString()));
  for (const name of RANGE_HTML_PATHS.filter(n => n !== 'library/index.html')) put(name, patchTakanasEditionRanges(bytes(site, name).toString(), name));
  assert(exists(site, IDEAS), 'Current Connected Ideas catalog missing'); const ideas = read(site, IDEAS);
  const kept = ideas.records.filter(r => !involves(r)), removedIdeas = ideas.records.filter(involves).map(r => r.id);
  const stage = {schemaVersion: 1, release: RELEASE, editionId: EDITION, publication: meta.publication, sourceSha256: pack.sourceSha256, manifestSha256: pack.manifestSha256, stats: pack.stats,
    affected: [...affected].sort(), removed, retired, otherCatalogPin, otherMcpPin, otherCitationPins, oldBook, originalSourcePack, originalWords, namedPublicBefore,
    currentArtifactParallels: {corpusParagraphs: parallels.corpusParagraphs, withParallels: parallels.withParallels, pairs: parallels.pairs, sha256: sha(json(parallels.parallels)), wordAdditions: parallels.wordAdditions},
    otherDownloadEntriesPin: sha(json(read(site, 'library/downloads/index.json').books.filter(b => b.slug !== SLUG))),
    connectedIdeas: {originalSha256: digest(site, IDEAS), keptRecordPin: sha(json(kept)), keptSortedRecordPin: sha(json(kept.slice().sort((a, b) => a.id.localeCompare(b.id)))), removedIds: removedIdeas},
    sourceRefsAdded: [...refs].sort(), homepageAfterSha256: digest(site, 'index.html'), previewAssets: pack.manifest.previewAssets, stage: 'applied'};
  write(ROOT, STAGE, stage); console.log(json({ok: true, stage: 'applied', ...pack.stats, changedFiles: affected.size, retiredAssets: removed, retiredConnectedIdeas: removedIdeas.length})); return stage;
}

function dataManifest(site) {
  const names = files(local(site, 'library/data')).filter(n => n !== 'files.json').sort(); const h = createHash('sha256'); let size = 0;
  for (const n of names) { const b = bytes(site, 'library/data/' + n); h.update(n).update('\0').update(b); size += b.length; }
  return {version: h.digest('hex').slice(0, 16), bytes: size, files: names};
}
function archiveEntries(site, bookOnly) {
  const data = Object.fromEntries(files(local(site, 'library/data')).map(n => ['data/' + n, bytes(site, 'library/data/' + n)]));
  if (!bookOnly) {
    for (const n of files(local(site, 'library/downloads')).filter(n => /\.(?:docx|pdf)$/i.test(n))) data['downloads/' + n] = bytes(site, 'library/downloads/' + n);
    return data;
  }
  const book = read(site, 'library/data/catalog.json').find(b => b.slug === SLUG), out = {'data/catalog.json': encode([book])};
  for (const [n, b] of Object.entries(data)) if (n.startsWith('data/' + SLUG + '/')) out[n] = b;
  if (data[`data/cited/${SLUG}.json`]) { out[`data/cited/${SLUG}.json`] = data[`data/cited/${SLUG}.json`]; out['data/cited/index.json'] = encode([SLUG]); }
  out[`data/parallels/${SLUG}.json`] = data[`data/parallels/${SLUG}.json`]; out['data/parallels/index.json'] = encode([SLUG]); out['data/parallels/words.json'] = data['data/parallels/words.json'];
  for (const file of Object.values(DOCS)) out[file] = bytes(site, 'library/' + file);
  return out;
}
const archiveReadme = title => encode(`${title} — Akiva Publishing\n\n${PUBLIC}library/\n\ndata/ contains the final published Hebrew, English, interlinear phrase pairs, full notes and indexes. downloads/ contains the supplied Word/PDF editions. This is a text archive, not a standalone offline website. Hebrew sources retain their licenses as recorded in toc.json; Akiva Publishing translations and vocalized editions remain copyright Akiva Publishing.\n`);

// Exported for a targeted CacheStorage/Response integration test without a
// deployment. Only the book and the explicitly affected global data are gated.
export function patchServiceWorker(sw, stamp, hashPins) {
  assert(!sw.includes('const TAKANAS_DOCX_HASHES'), 'Takanas cache guard is already present');
  assert.equal((sw.match(/const SHELL = `[^`]+`;/g) || []).length, 1);
  sw = sw.replace(/const SHELL = `([^`]+)`;/, (_, key) => `const SHELL = \`${key}-takanas-docx-${stamp}\`;`);
  const block = String.raw`
// Corrected Takanas KDP edition: exact bytes, including ZIP-installed offline data.
const TAKANAS_DOCX_STAMP = ${JSON.stringify(stamp)};
const TAKANAS_DOCX_HASHES = ${JSON.stringify(hashPins).replace(/</g, '\u003c')};
function takanasDocxRel(request) {
  const url = new URL(typeof request === 'string' ? request : request.url, self.registration.scope);
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname)
    ? url.pathname.slice(scope.pathname.length) : null;
}
function takanasDocxProtected(rel) {
  // Other publishers can legitimately update shared indexes/catalogs later.
  // Their new SHELL suffix ends this release's global pins, while the unchanged
  // Takanas source bytes remain protected until a reviewed Takanas successor.
  return rel && (rel.startsWith('data/takanat-hashavin/')
    || rel === 'data/parallels/takanat-hashavin.json'
    || (SHELL.endsWith('-takanas-docx-' + TAKANAS_DOCX_STAMP)
      && Object.prototype.hasOwnProperty.call(TAKANAS_DOCX_HASHES, rel)));
}
async function takanasDocxMatches(response, expected) {
  if (!response || !response.ok || typeof expected !== 'string') return false;
  try {
    const hash = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('') === expected;
  } catch (_) { return false; }
}
async function takanasDocxCurrent(request, rel) {
  const expected = TAKANAS_DOCX_HASHES[rel], cache = await caches.open(DATA);
  const canonical = new URL(request.url); canonical.search = ''; canonical.hash = '';
  try {
    const response = await timeout(20000, fetch(request, {cache: 'no-cache'}));
    if (!await takanasDocxMatches(response, expected)) throw new Error('Current edition bytes not available');
    // A quota failure must not prevent reading a verified response online.
    await Promise.all([cache.put(request, response.clone()).catch(() => {}),
      cache.put(canonical.href, response.clone()).catch(() => {})]);
    return response;
  } catch (error) {
    const currentShell = await caches.open(SHELL);
    for (const store of [cache, currentShell]) {
      for (const key of [request, canonical.href]) {
        const saved = await store.match(key, {ignoreVary: true});
        if (await takanasDocxMatches(saved, expected)) return saved;
      }
      // The current shell precaches Connected Ideas under its published query.
      // Search all query variants, but accept only the exact current SHA.
      for (const key of await store.keys()) if (takanasDocxRel(key) === rel) {
        const saved = await store.match(key, {ignoreVary: true});
        if (await takanasDocxMatches(saved, expected)) return saved;
      }
    }
    throw new Error('The current Takanas edition is not available online or in saved data: ' + rel);
  }
}
async function takanasDocxPurgeOldCachedData() {
  let deleted = 0;
  for (const name of [DATA, SHELL]) {
    const store = await caches.open(name), keys = await store.keys(); let next = 0;
    await Promise.all(Array.from({length: 4}, async () => {
      for (;;) {
        const index = next++; if (index >= keys.length) break;
        const key = keys[index], rel = takanasDocxRel(key);
        if (takanasDocxProtected(rel) && !await takanasDocxMatches(await store.match(key), TAKANAS_DOCX_HASHES[rel])) {
          if (await store.delete(key)) deleted++;
        }
      }
    }));
  }
  return deleted;
}
// End corrected Takanas cache guard.
`;
  const install = "self.addEventListener('install', event => {"; assert.equal(sw.split(install).length, 2); sw = sw.replace(install, block + '\n' + install);
  const claim = '    await self.clients.claim();'; assert.equal(sw.split(claim).length, 2); sw = sw.replace(claim, '    await takanasDocxPurgeOldCachedData();\n' + claim);
  const route = "    if (request.mode === 'navigate' || rel === '' || rel === 'index.html') {"; assert.equal(sw.split(route).length, 2);
  sw = sw.replace(route, "    if (takanasDocxProtected(rel)) {\n      event.respondWith(takanasDocxCurrent(request, rel));\n    } else if (request.mode === 'navigate' || rel === '' || rel === 'index.html') {");
  return sw;
}

export async function finalize(site) {
  const pack = loadPack(), stage = read(ROOT, STAGE), before = read(ROOT, BASE).files; assert.equal(stage.sourceSha256, pack.sourceSha256); assert.equal(stage.manifestSha256, pack.manifestSha256);
  const affected = new Set(stage.affected), put = (name, value) => { assert(permitted(name, stage.retired)); const b = Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value) : encode(value); if (!exists(site, name) || digest(site, name) !== sha(b)) { write(site, name, b); affected.add(name); } };
  const m = dataManifest(site); put('library/data/files.json', m);
  const mc = read(site, 'mcp-data/catalog.json'); mc.version = m.version; put('mcp-data/catalog.json', mc);
  assert.equal(digest(site, IDEAS), stage.connectedIdeas.originalSha256, 'Connected Ideas preimage changed');
  const originalIdeas = read(site, IDEAS), kept = originalIdeas.records.filter(r => !involves(r)); assert.equal(sha(json(kept)), stage.connectedIdeas.keptRecordPin);
  const {assembleCatalog} = await import('./build-connected-ideas.mjs'); const catalogBytes = bytes(site, 'mcp-data/catalog.json');
  const ideas = assembleCatalog({records: kept, catalog: mc, catalogBytes, files: originalIdeas.provenance.editorialFiles, date: '2026-11-02', write: false, release: originalIdeas.release}).catalog;
  assert.deepEqual(new Map(ideas.records.map(r => [r.id, r])), new Map(kept.map(r => [r.id, r])), 'Other books’ Connected Ideas changed'); put(IDEAS, JSON.stringify(ideas, null, 2) + '\n');
  const stamp = pack.sourceSha256.slice(0, 12), marker = 'const editionDataUrl = url => '; let html = patchTakanasSeifNavigation(patchTakanasEditionRanges(bytes(site, 'library/index.html').toString(), 'library/index.html')); assert.equal(html.split(marker).length, 2); assert(!html.includes('/* ' + RELEASE + ' */'), 'Release already applied');
  html = html.replace(marker, marker + `/* ${RELEASE} */ (url.startsWith('data/${SLUG}/') || url.startsWith('data/cited/') || url.startsWith('data/parallels/') || ['data/catalog.json','data/files.json','data/packs/sources.json'].includes(url)) ? url + '?takanas_docx=${stamp}' :\n`);
  const safeMarker = 'const safeFootnoteUrl = url => '; assert.equal(html.split(safeMarker).length, 2); html = html.replace(safeMarker, safeMarker + `/* Exact corrected KDP source URLs */ ${JSON.stringify([...pack.allow].sort())}.includes(String(url || '')) || `);
  const fetchRe = /fetch\(('connected-ideas\/catalog\.json[^)\n]*)\)/g; assert.equal((html.match(fetchRe) || []).length, 1, 'Connected Ideas request changed');
  // Preserve the existing leading string argument for the other independently
  // guarded publishers, which locate that exact fetch form on the live site.
  html = html.replace(fetchRe, (_, arg) => { assert(arg.includes('?'), 'Connected Ideas request lacks its reviewed query separator'); return `fetch(${arg} + '&takanas_docx=${stamp}')`; }); put('library/index.html', html);
  const protectedNames = new Set([IDEAS, ...Array.from({length: 16}, (_, i) => `library/data/${SLUG}/${i}.json`),
    `library/data/${SLUG}/toc.json`, `library/data/${SLUG}/links.json`, `library/data/parallels/${SLUG}.json`,
    'library/data/catalog.json', 'library/data/files.json', 'library/data/packs/sources.json', 'library/data/cited/index.json',
    'library/data/parallels/index.json', 'library/data/parallels/words.json',
    ...[...affected].filter(name => name.startsWith('library/data/'))]);
  const cacheHashPins = Object.fromEntries([...protectedNames].sort().map(name => [name.slice(8), digest(site, name)]));
  put('library/sw.js', patchServiceWorker(bytes(site, 'library/sw.js').toString(), stamp, cacheHashPins));
  const {zipSync, unzipSync} = createRequire(import.meta.url)(local(site, 'library/vendor/fflate.min.js')), archiveReports = [];
  for (const archive of ARCHIVES) {
    const bookOnly = archive.includes('/books/'), entries = archiveEntries(site, bookOnly), output = zipSync({'README.txt': archiveReadme(bookOnly ? BOOK : 'Rav Tzadok Library'), ...entries}, {level: 6, mtime: new Date('2026-11-02T00:00:00Z')});
    const checked = unzipSync(output); assert.deepEqual(Object.keys(checked).sort(), ['README.txt', ...Object.keys(entries)].sort()); for (const [name, value] of Object.entries(entries)) assert.equal(sha(checked[name]), sha(value), 'ZIP payload changed: ' + name);
    put(archive, output); archiveReports.push({path: archive, file: archive.slice(8), bytes: output.length, sha256: sha(output), dataFiles: Object.keys(entries).filter(n => n.startsWith('data/')).length, documents: Object.keys(entries).filter(n => n.startsWith('downloads/')).length, entries: Object.keys(checked).length});
  }
  const downloadIndex = read(site, 'library/downloads/index.json'); downloadIndex.version = m.version;
  for (const ar of archiveReports) { const entry = ar.path.includes('/books/') ? downloadIndex.books.find(b => b.slug === SLUG) : downloadIndex.library; assert(entry); Object.assign(entry, {file: ar.file, bytes: ar.bytes, dataFiles: ar.dataFiles, documents: ar.documents}); }
  put('library/downloads/index.json', downloadIndex);
  const report = {...stage, stage: 'finalized', version: m.version, connectedIdeas: {...stage.connectedIdeas, remainingTakanasRecords: 0, keptRecords: kept.length, version: ideas.version}, archives: archiveReports,
    cacheValidation: {hashPins: cacheHashPins, networkFirst: true, canonicalAndVersionedOffline: true, oldMismatchedBytesRejected: true, sharedPinsScope: 'Only this current SHELL release; book source pins persist across later shared-index publishers'},
    namedPublicFiles: namedPublicInventory(site, true), namedPublicInventorySelfExclusion: REPORT,
    affected: [...affected].sort().map(name => ({name, sha256: digest(site, name), bytes: bytes(site, name).length, preimage: before[name] || null}))};
  write(site, REPORT, report); write(ROOT, PROOF, {ok: true, release: RELEASE, ...pack.stats, version: m.version, baselineArtifact: stage.publication.artifactId, affectedFiles: report.affected.length, archives: archiveReports, namedPublicFiles: namedPublicInventory(site)}); console.log(json({ok: true, stage: 'finalized', version: m.version, affectedFiles: report.affected.length, archives: archiveReports})); return report;
}

export function verify(site, build = null) {
  const pack = loadPack(), report = read(site, REPORT), before = read(ROOT, BASE).files, stage = read(ROOT, STAGE); assert.equal(report.release, RELEASE); assert.equal(report.editionId, EDITION); assert.equal(report.sourceSha256, pack.sourceSha256); assert.equal(report.manifestSha256, pack.manifestSha256);
  const after = inventory(site), changed = new Set(report.affected.map(r => r.name));
  for (const [name, pin] of Object.entries(before)) { if (report.removed.includes(name)) { assert(stage.retired.includes(name) && !exists(site, name)); continue; } assert(exists(site, name), 'Original site file disappeared: ' + name); if (!changed.has(name) && name !== REPORT) assert.equal(after[name], pin, 'Unrelated published file changed: ' + name); }
  for (const name of Object.keys(after)) if (!(name in before)) assert(permitted(name, stage.retired) && (changed.has(name) || name === REPORT), 'Unexpected or undeclared new publication file: ' + name);
  for (const row of report.affected) { assert(permitted(row.name, stage.retired)); assert.equal(after[row.name], row.sha256); }
  assert.equal(report.namedPublicInventorySelfExclusion, REPORT); assert.deepEqual(report.namedPublicFiles, namedPublicInventory(site, true), 'Named Takanas public-file inventory drifted');
  const {valid} = compareReader(site, pack, build);
  assert.equal(sha(json(read(site, 'library/data/catalog.json').filter(b => b.slug !== SLUG))), stage.otherCatalogPin);
  const mc = read(site, 'mcp-data/catalog.json'); assert.equal(sha(json(mc.books.filter(b => b.slug !== SLUG))), stage.otherMcpPin); assert.equal(mc.version, report.version);
  for (const [name, pin] of Object.entries(stage.otherCitationPins)) { const idx = read(site, name); assert.equal(sha(json(strip(idx))), pin, 'Other books’ citation anchors changed: ' + name); for (const a of Object.values(idx).flat().filter(mine)) assert(valid.has(a), 'Stale Takanas citation endpoint: ' + a); }
  const ideas = read(site, IDEAS); assert(!ideas.records.some(involves)); assert.equal(sha(json(ideas.records)), stage.connectedIdeas.keptSortedRecordPin, 'Retained other-book Connected Ideas records changed');
  assert.equal(ideas.provenance.mcpDataVersion, report.version); assert.equal(ideas.provenance.mcpCatalogSha256, digest(site, 'mcp-data/catalog.json'));
  const mcp = read(site, `mcp-data/text/${SLUG}.json`); assert.equal(mcp.paras.length, 363); assert.equal(mcp.paras.reduce((sum, p) => sum + (p.f || []).length, 0), 2621);
  const mcBook = mc.books.find(b => b.slug === SLUG), toc = read(site, `library/data/${SLUG}/toc.json`); assert.equal(mcBook.paragraphs, 363); assert.equal(mcBook.sections.length, 16);
  let cursor = 0; for (const [sectionIndex, sec] of pack.src.sections.entries()) {
    const sectionRows = sec.items.filter(r => r.p), leaf = toc.toc.children[sectionIndex], exportedSection = mcBook.sections[sectionIndex]; assert.equal(exportedSection.ref, leaf.ref); assert.equal(exportedSection.first, cursor); assert.equal(exportedSection.count, sectionRows.length);
    for (const item of sectionRows) {
    const p = mcp.paras[cursor++]; assert.equal(p.r, leaf.ref + leaf.sep + item.n, 'MCP paragraph identity/order differs'); assert.equal(p.s, sectionIndex); assert.deepEqual(p.p, item.p.map(pair => pair.map(text)), 'MCP exact Word phrase text/whitespace differs');
    if (item.paragraphBreaks) assert.deepEqual(p.paragraphBreaks, item.paragraphBreaks, 'MCP Word paragraph breaks changed');
    if (item.inlineHeadings) assert.deepEqual(p.inlineHeadings, item.inlineHeadings.map(h => ({...h, text: mcpPlain(h.text)})), 'MCP Word inline headings changed');
    const expectedNotes = (item.footnotes || []).map(n => [String(n.number), n.paragraphs.map(p => mcpPlain(p.text)).filter(Boolean).join('\n'), n.phraseIndex, 'h', n.heCharOffset]);
    assert.deepEqual(p.f || [], expectedNotes, 'MCP note number, full text, phrase, Hebrew side or exact offset differs');
    }
  }
  for (const [v, file] of Object.entries(DOCS)) assert.equal(digest(site, 'library/' + file), pack.docs.get(v).sha256);
  for (const asset of pack.manifest.previewAssets) assert.equal(digest(site, asset.path), asset.sha256, 'Public print preview differs from corrected source');
  assert.equal(digest(site, 'index.html'), stage.homepageAfterSha256); assert.equal(patchTakanasPrintPreview(bytes(site, 'index.html').toString()), bytes(site, 'index.html').toString(), 'Homepage preview/ranges are not current');
  for (const name of RANGE_HTML_PATHS) assert.equal(patchTakanasEditionRanges(bytes(site, name).toString(), name), bytes(site, name).toString(), 'Shop/alt-text edition ranges are not current: ' + name);
  assert(bytes(site, 'library/index.html').toString().includes('function renderKdpSeifContents('), 'Printed-seif navigation UI missing');
  const book = read(site, 'library/data/catalog.json').find(b => b.slug === SLUG); assert.deepEqual(book.downloads.map(d => d.file).sort(), Object.values(DOCS).sort());
  assert.deepEqual(read(site, 'library/data/files.json'), dataManifest(site)); assert.equal(report.version, dataManifest(site).version);
  const sourcePack = read(site, 'library/data/packs/sources.json'); assert.deepEqual({...sourcePack, refs: undefined}, {...stage.originalSourcePack, refs: undefined}); assert.deepEqual(sourcePack.refs, [...new Set([...stage.originalSourcePack.refs, ...stage.sourceRefsAdded])].sort(), 'Source refs changed outside the fresh Takanas union');
  for (const prefix of ['library/data/parallels', 'mcp-data/parallels']) {
    assert.equal(digest(site, prefix + '/' + SLUG + '.json'), stage.currentArtifactParallels.sha256, 'Current-artifact Takanas parallels changed');
    assert.deepEqual(read(site, prefix + '/words.json'), {...stage.originalWords[prefix + '/words.json'], ...stage.currentArtifactParallels.wordAdditions}, 'Other books’ rare-word definitions changed');
  }
  const index = read(site, 'library/downloads/index.json'); assert.equal(index.version, report.version); assert.equal(sha(json(index.books.filter(b => b.slug !== SLUG))), stage.otherDownloadEntriesPin, 'Other book download entries changed'); const {unzipSync} = createRequire(import.meta.url)(local(site, 'library/vendor/fflate.min.js'));
  for (const ar of report.archives) { const raw = bytes(site, ar.path), zipped = unzipSync(raw), expected = archiveEntries(site, ar.path.includes('/books/')); assert.equal(sha(raw), ar.sha256); assert.equal(raw.length, ar.bytes); assert.deepEqual(Object.keys(zipped).sort(), ['README.txt', ...Object.keys(expected)].sort()); for (const [name, value] of Object.entries(expected)) assert.equal(sha(zipped[name]), sha(value), 'Final live-file ZIP mismatch: ' + name); const entry = ar.path.includes('/books/') ? index.books.find(b => b.slug === SLUG) : index.library; for (const field of ['file', 'bytes', 'dataFiles', 'documents']) assert.equal(entry[field], ar[field]); }
  const stamp = pack.sourceSha256.slice(0, 12); assert(bytes(site, 'library/index.html').toString().includes('takanas_docx=' + stamp)); assert(bytes(site, 'library/sw.js').toString().includes('-takanas-docx-' + stamp));
  for (const [relative, expected] of Object.entries(report.cacheValidation.hashPins)) assert.equal(digest(site, 'library/' + relative), expected, 'Service-worker release hash differs from final data: ' + relative);
  for (const row of report.affected.filter(r => r.name.startsWith('library/data/'))) assert.equal(report.cacheValidation.hashPins[row.name.slice(8)], row.sha256, 'Affected data lacks an exact cache pin');
  const result = {ok: true, release: RELEASE, ...pack.stats, version: report.version, preservedFiles: Object.entries(before).filter(([name, pin]) => after[name] === pin).length, retiredAssets: report.removed, retiredConnectedIdeas: report.connectedIdeas.removedIds.length, fullArchiveRebuiltFromCurrentFiles: true, archives: report.archives, namedPublicFiles: namedPublicInventory(site)}; write(ROOT, PROOF, result); console.log(json(result)); return result;
}

async function publicBytes(name) { const url = new URL(name, PUBLIC); url.searchParams.set('takanas_docx_verify', Date.now()); const r = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(180000)}); assert(r.ok, `HTTP ${r.status}: ${name}`); return Buffer.from(await r.arrayBuffer()); }
export async function live(site) {
  const report = read(site, REPORT), pending = [...report.affected, {name: REPORT, sha256: digest(site, REPORT)}], errors = []; let next = 0;
  await Promise.all(Array.from({length: 4}, async () => { for (;;) { const n = next++; if (n >= pending.length) break; const row = pending[n]; let ok = false; for (let attempt = 0; attempt < 6; attempt++) { try { if (sha(await publicBytes(row.name)) === row.sha256) { ok = true; break; } } catch {} if (attempt < 5) await new Promise(r => setTimeout(r, 3000)); } if (!ok) errors.push(row.name); } }));
  for (const name of report.removed) { const url = new URL(name, PUBLIC); url.searchParams.set('takanas_docx_retired', Date.now()); const r = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(60000)}); if (r.status !== 404) errors.push('Retired public path remains: ' + name); }
  assert.deepEqual(errors, [], 'Public successor bytes differ'); const result = {ok: true, live: true, release: RELEASE, filesChecked: pending.length, retiredAssets404: report.removed, verifiedAt: new Date().toISOString()}; write(ROOT, 'artifacts/takanas-docx-master/live-verification.json', result); console.log(json(result)); return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, site = '.takanas-docx-site', build = '.takanas-docx-build'] = process.argv.slice(2);
  if (mode === '--check-pack') console.log(json({ok: true, release: RELEASE, ...loadPack().stats}));
  else if (mode === '--apply') await apply(site, build);
  else if (mode === '--finalize') await finalize(site);
  else if (mode === '--verify') verify(site, build === '-' ? null : build);
  else if (mode === '--live') await live(site);
  else throw Error('Use --check-pack | --apply SITE BUILD | --finalize SITE | --verify SITE BUILD | --live SITE');
}

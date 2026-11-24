// The eight Izhbitz-Radzin editions in HaMafteach and the Parallels panel, both ways, published over the exact current Pages
// artifact (after scripts/publish-izhbitz-editions.mjs):
//   - the reader panel data (library/mafteach, ml-parallels, genre-parallels, genre-reverse, mafteach-links): every changed
//     file is listed in sources/akiva/izhbitz-editions/parallels-manifest.json with the digest it must have on the live site
//     before the release (the committed dist/library copy) and the digest it gets; nothing else in these folders changes
//   - the MCP HaMafteach index (mcp-data/mafteach), rebuilt from sources/mafteach with the editions' verified source notes
//     joined as edition-note entries (scripts/build-mafteach-index.mjs), checked against the Worker's budget
//   - the panel script's cache version and the reader/service-worker cache markers
// Every other published file is preserved byte for byte.
//
//   node scripts/publish-izhbitz-parallels.mjs --check
//   node scripts/publish-izhbitz-parallels.mjs --apply SITE
//   node scripts/publish-izhbitz-parallels.mjs --verify SITE
//   node scripts/publish-izhbitz-parallels.mjs --live SITE
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = '20261124-izhbitz-parallels';
const PANEL_V = '20261124-izhbitz-parallels-v13';
const SEARCH_V = '20261124-izhbitz-mafteach-v12';
const ISH_OLD = "Mei HaShiloach, Beis Yaakov, Sod Yesharim, Tiferes Yosef, Sha'ar HaEmunah — found";
const ISH_NEW = "Mei HaShiloach, Beis Yaakov, Sod Yesharim, Tiferes Yosef, Sha'ar HaEmunah, Naos Deshe, Tiferes HaChanochi, Ein HaTecheiles, Pesil Techeiles, Sefunei Temunei Chol, Orchos Chaim — found";
export function patchSearch(js) {
  if (js.includes(ISH_NEW)) return js;
  assert.equal(js.split(ISH_OLD).length, 2, 'Mafteach search school line not found exactly once');
  return js.replace(ISH_OLD, ISH_NEW);
}
const MANIFEST = 'sources/akiva/izhbitz-editions/parallels-manifest.json';
const REPORT = 'library/izhbitz-parallels-20261124.json';
const STAGE = 'izhbitz-parallels-stage.json';
const PREVIOUS = 'new-books-baseline.json', META = 'new-books-publication.json';
const PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const PANEL_DIRS = /^library\/(mafteach|ml-parallels|genre-parallels|genre-reverse|mafteach-links)\/[a-z0-9-]+\.json$/;

const sha = b => createHash('sha256').update(b).digest('hex');
const rel = (root, name) => {
  assert(name && !path.isAbsolute(name) && name.split('/').every(p => p && p !== '.' && p !== '..'), 'Bad path ' + name);
  const r = path.resolve(root, name); assert(r.startsWith(path.resolve(root) + path.sep)); return r;
};
const read = (root, name) => JSON.parse(fs.readFileSync(rel(root, name), 'utf8'));
const digest = (root, name) => fs.existsSync(rel(root, name)) ? sha(fs.readFileSync(rel(root, name))) : null;
function allFiles(dir, prefix = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    if (e.isDirectory()) out.push(...allFiles(path.join(dir, e.name), prefix + e.name + '/'));
    else if (e.isFile()) out.push(prefix + e.name);
  }
  return out;
}

export function check() {
  const m = read(ROOT, MANIFEST);
  assert.equal(m.release, RELEASE);
  for (const [name, f] of Object.entries(m.files)) {
    assert(PANEL_DIRS.test(name), 'Outside the panel folders: ' + name);
    const src = 'dist/' + name, bytes = fs.readFileSync(rel(ROOT, src));
    assert.equal(sha(bytes), f.sha256, 'Committed panel file differs from the manifest: ' + src);
    assert(bytes.length <= 10 * 1024 * 1024, 'Over 10 MB: ' + src);
    JSON.parse(bytes);
  }
  for (const name of Object.keys(m.removed)) assert(PANEL_DIRS.test(name) && !fs.existsSync(rel(ROOT, 'dist/' + name)), 'Bad removal ' + name);
  for (const dir of ['mafteach', 'ml-parallels', 'genre-parallels']) {
    const idx = read(ROOT, `dist/library/${dir}/index.json`);
    for (const t of m.books) {
      const e = idx.books[t]; assert(e, `${dir}: ${t} missing`);
      const d = read(ROOT, `dist/library/${dir}/${e.file}`);
      assert.equal(Object.keys(d.passages).length, e.passages, `${dir}/${e.file} passage count`);
      assert(Object.keys(d.passages).every(r => r === t || r.startsWith(t + ', ') || r.startsWith(t + ' ')), `${dir}/${e.file}: foreign passage`);
    }
  }
  return {files: Object.keys(m.files).length, removed: Object.keys(m.removed).length, stats: m.stats};
}

function patchPanel(js) {
  assert.equal((js.match(/const VERSION = '[^']+';/g) || []).length, 1, 'Panel VERSION not found');
  return js.replace(/const VERSION = '[^']+';/, `const VERSION = '${PANEL_V}';`);
}

export function apply(site) {
  const counts = check(), m = read(ROOT, MANIFEST);
  const before = read(ROOT, PREVIOUS).files, base = read(ROOT, META);
  const affected = new Set(), created = new Set(), removed = [];
  // 1. panel data: each file must be exactly what the manifest expects on the live site before this release
  for (const [name, f] of Object.entries(m.files)) {
    assert.equal(digest(site, name), f.preimage, 'Live panel file is not the expected preimage: ' + name);
    if (!f.preimage) created.add(name);
    fs.mkdirSync(path.dirname(rel(site, name)), {recursive: true});
    fs.copyFileSync(rel(ROOT, 'dist/' + name), rel(site, name)); affected.add(name);
  }
  for (const [name, h] of Object.entries(m.removed)) {
    assert.equal(digest(site, name), h, 'Live panel file is not the expected preimage: ' + name);
    fs.rmSync(rel(site, name)); removed.push(name);
  }
  // 2. the MCP HaMafteach index, rebuilt over the site's mcp-data with the edition notes
  const mafBefore = new Set(allFiles(rel(site, 'mcp-data/mafteach')).map(f => 'mcp-data/mafteach/' + f));
  let r = spawnSync('node', ['scripts/build-mafteach-index.mjs', rel(site, 'mcp-data')], {cwd: ROOT, stdio: 'inherit'});
  assert.equal(r.status, 0, 'Mafteach index build failed');
  const mafAfter = allFiles(rel(site, 'mcp-data/mafteach')).map(f => 'mcp-data/mafteach/' + f);
  for (const name of mafAfter) if (digest(site, name) !== (before[name] || null)) { affected.add(name); if (!mafBefore.has(name)) created.add(name); }
  for (const name of mafBefore) if (!mafAfter.includes(name)) removed.push(name);
  r = spawnSync('node', ['scripts/test-mcp-budget.mjs', rel(site, 'mcp-data')], {cwd: ROOT, stdio: 'inherit'});
  assert.equal(r.status, 0, 'The MCP data is over the Worker budget');
  // 3. panel script version and the cache markers
  const panel = 'library/mafteach-panel.js', js = fs.readFileSync(rel(site, panel), 'utf8');
  const oldV = js.match(/const VERSION = '([^']+)';/)[1];
  fs.writeFileSync(rel(site, panel), patchPanel(js)); affected.add(panel);
  const search = 'library/mafteach-search.js';
  fs.writeFileSync(rel(site, search), patchSearch(fs.readFileSync(rel(site, search), 'utf8'))); affected.add(search);
  for (const name of ['library/index.html', 'library/sw.js']) {
    const t = fs.readFileSync(rel(site, name), 'utf8');
    assert(t.split('mafteach-panel.js?v=').length - 1 >= 1, 'Panel script reference missing in ' + name);
    assert(t.split('mafteach-search.js?v=').length - 1 >= 1, 'Search script reference missing in ' + name);
    let u = t.replace(/mafteach-panel\.js\?v=[A-Za-z0-9._-]+/g, 'mafteach-panel.js?v=' + PANEL_V)
      .replace(/mafteach-search\.js\?v=[A-Za-z0-9._-]+/g, 'mafteach-search.js?v=' + SEARCH_V);
    if (name === 'library/sw.js') {
      assert.equal((u.match(/const SHELL = `[^`]+`;/g) || []).length, 1, 'Unexpected service worker cache revision');
      u = u.replace(/const SHELL = `([^`]+)`;/, (_, v) => `const SHELL = \`${v}-izhbitz-par\`;`);
    }
    fs.writeFileSync(rel(site, name), u); affected.add(name);
  }
  const report = {schemaVersion: 1, release: RELEASE, publication: base.publication, previousPanelVersion: oldV, panelVersion: PANEL_V, counts,
    affected: [...affected].sort().map(name => ({name, sha256: digest(site, name), preimage: before[name] || null})),
    created: [...created].sort(), removed: removed.sort(), stage: 'final'};
  fs.writeFileSync(rel(site, REPORT), JSON.stringify(report));
  fs.writeFileSync(path.join(ROOT, STAGE), JSON.stringify({...report, affected: report.affected.length}));
  console.log(JSON.stringify({ok: true, counts, affected: affected.size, created: created.size, removed: removed.length}));
}

export function verify(site) {
  const before = read(ROOT, PREVIOUS).files, report = read(site, REPORT);
  const allow = new Set([REPORT, ...report.affected.map(f => f.name)]), gone = new Set(report.removed);
  for (const name of gone) assert(!fs.existsSync(rel(site, name)) && (PANEL_DIRS.test(name) || name.startsWith('mcp-data/mafteach/')), 'Bad removal ' + name);
  for (const [name, hash] of Object.entries(before)) {
    if (gone.has(name)) continue;
    assert(fs.existsSync(rel(site, name)), 'Published file missing: ' + name);
    if (!allow.has(name)) assert.equal(digest(site, name), hash, 'Unrelated file altered: ' + name);
  }
  for (const f of report.affected) {
    assert.equal(digest(site, f.name), f.sha256, 'Changed after apply: ' + f.name);
    assert(PANEL_DIRS.test(f.name) || f.name.startsWith('mcp-data/mafteach/') || ['library/mafteach-panel.js', 'library/mafteach-search.js', 'library/index.html', 'library/sw.js'].includes(f.name),
      'Outside this release: ' + f.name);
  }
  // the panel data answers for a passage of each book, and the MCP index has its edition notes
  const m = read(ROOT, MANIFEST), idx = read(site, 'library/mafteach/index.json');
  for (const t of m.books) assert(Object.keys(read(site, 'library/mafteach/' + idx.books[t].file).passages).length >= 5, 'Too few Mafteach passages: ' + t);
  const g = read(site, 'mcp-data/mafteach/glossary.json');
  assert(g.parts.includes('ed') && Object.keys(g.passages).some(p => p.startsWith("Ne'ot Deshe, ")), 'MCP edition notes missing');
  console.log(JSON.stringify({ok: true, files: report.affected.length, removed: report.removed.length}));
}

async function live(site) {
  const report = read(site, REPORT);
  const sample = report.affected.filter(f => !f.name.startsWith('mcp-data/mafteach/') || /glossary\.json$/.test(f.name));
  const targets = [...sample, {name: REPORT, sha256: digest(site, REPORT)}];
  const errors = [];
  for (const f of targets) {           // one at a time, with pauses: the Pages host rate-limits bursts
    let ok = false;
    for (let a = 0; a < 5 && !ok; a++) {
      try {
        const u = new URL(f.name, PUBLIC); u.searchParams.set('izhbitz_par', Date.now());
        const res = await fetch(u, {cache: 'no-store', signal: AbortSignal.timeout(60000)});
        if (res.ok && sha(Buffer.from(await res.arrayBuffer())) === f.sha256) ok = true;
      } catch {}
      if (!ok) await new Promise(r => setTimeout(r, 3000 * (a + 1)));
    }
    if (!ok) errors.push(f.name);
    await new Promise(r => setTimeout(r, 150));
  }
  assert.equal(errors.length, 0, 'Live check failed: ' + errors.slice(0, 8).join(', '));
  console.log(JSON.stringify({ok: true, live: true, checked: targets.length}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, site = '.izhbitz-par-site'] = process.argv.slice(2);
  if (mode === '--check') console.log(JSON.stringify({ok: true, ...check()}));
  else if (mode === '--apply') apply(site);
  else if (mode === '--verify') verify(site);
  else if (mode === '--live') await live(site);
  else throw Error('Usage: --check | --apply SITE | --verify SITE | --live SITE');
}

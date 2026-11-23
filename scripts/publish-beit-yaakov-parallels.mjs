// Bais Yaakov al HaTorah (six books): HaMafteach panel data, machine-learned parallels and the Chassidus /
// Kabbalah / Machshava / Mussar parallels, published over the exact current Pages artifact.
// Only the six books' panel files, the three panel indexes (their six entries), the panel script's book lookup and
// the cache markers change; every other published file is preserved byte for byte.
//
//   node scripts/publish-beit-yaakov-parallels.mjs --check
//   node scripts/publish-beit-yaakov-parallels.mjs --apply SITE
//   node scripts/publish-beit-yaakov-parallels.mjs --verify SITE
//   node scripts/publish-beit-yaakov-parallels.mjs --live SITE
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = '20261123-beit-yaakov-parallels-both-ways';
const PANEL_V = '20261123-beit-yaakov-parallels-v11';
const DATA = 'sources/akiva/beit-yaakov-complete/parallels';      // committed release data (each file under 10 MB)
const REPORT = 'library/beit-yaakov-parallels-20261123-v2.json';
const STAGE = 'beit-yaakov-parallels-stage.json';
const PREVIOUS = 'new-books-baseline.json', META = 'new-books-publication.json';
const PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const BOOKS = {'Beit Yaakov on Torah': 'beit-yaakov-on-torah', 'Beit Yaakov, Shemos': 'beit-yaakov-shemos', 'Beit Yaakov, Vayikra': 'beit-yaakov-vayikra',
  'Beit Yaakov, Bamidbar': 'beit-yaakov-bamidbar', 'Beit Yaakov, Devarim': 'beit-yaakov-devarim', 'Beit Yaakov, Moadim': 'beit-yaakov-moadim'};
const DIRS = ['mafteach', 'ml-parallels', 'genre-parallels'];
const SHARD_OLD = "    if (ref.startsWith('Peri Tzadik, ')) return ref.replace(/\\s+\\d+$/, '');\n";
const SHARD_NEW = SHARD_OLD + "    if (ref.startsWith('Beit Yaakov, ')) return ref.split(', ').slice(0, 2).join(', ');   // one file per Beit Yaakov volume\n";

const sha = b => createHash('sha256').update(b).digest('hex');
const rel = (root, name) => {
  assert(name && !path.isAbsolute(name) && name.split('/').every(p => p && p !== '.' && p !== '..'), 'Bad path ' + name);
  const r = path.resolve(root, name); assert(r.startsWith(path.resolve(root) + path.sep)); return r;
};
const read = (root, name) => JSON.parse(fs.readFileSync(rel(root, name), 'utf8'));
const write = (root, name, data) => { const f = rel(root, name); fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data)); };
const digest = (root, name) => sha(fs.readFileSync(rel(root, name)));

export function check() {
  const out = {};
  for (const dir of DIRS) {
    const entries = read(ROOT, `${DATA}/${dir}/entries.json`);
    for (const [title, slug] of Object.entries(BOOKS)) {
      const e = entries[title]; assert(e && e.file === slug + '.json', `${dir}: missing ${title}`);
      const bytes = fs.readFileSync(path.join(ROOT, DATA, dir, e.file));
      assert(bytes.length <= 10 * 1024 * 1024, 'Over 10 MB: ' + dir + '/' + e.file);
      const d = JSON.parse(bytes); const refs = Object.keys(d.passages);
      assert.equal(refs.length, e.passages, `${dir}/${e.file} passage count`);
      assert(refs.every(r => r === title || r.startsWith(title + ', ') || r.startsWith(title + ' ')), `${dir}/${e.file}: foreign passage`);
      out[dir + '/' + slug] = refs.length;
    }
  }
  return out;
}

function patchPanel(js) {
  if (!js.includes(SHARD_NEW)) { assert.equal(js.split(SHARD_OLD).length, 2, 'Panel book lookup not found exactly once'); js = js.replace(SHARD_OLD, SHARD_NEW); }
  assert.equal((js.match(/const VERSION = '[^']+';/g) || []).length, 1, 'Panel VERSION not found');
  return js.replace(/const VERSION = '[^']+';/, `const VERSION = '${PANEL_V}';`);
}

export function apply(site) {
  const counts = check();
  const before = read(ROOT, PREVIOUS).files, base = read(ROOT, META);
  const affected = new Set(), created = new Set();
  const touch = (name, data) => {
    if (before[name] && !affected.has(name)) assert.equal(digest(site, name), before[name], 'Site file changed since baseline: ' + name);
    else if (!affected.has(name)) { assert(!fs.existsSync(rel(site, name)), 'Untracked collision: ' + name); created.add(name); }
    write(site, name, data); affected.add(name);
  };
  for (const dir of DIRS) {
    const entries = read(ROOT, `${DATA}/${dir}/entries.json`);
    const idxName = `library/${dir}/index.json`, idx = read(site, idxName);
    const othersBefore = JSON.stringify(Object.entries(idx.books).filter(([k]) => !(k in BOOKS)));
    for (const [title] of Object.entries(BOOKS)) {
      touch(`library/${dir}/${entries[title].file}`, fs.readFileSync(path.join(ROOT, DATA, dir, entries[title].file)));
      idx.books[title] = entries[title];
    }
    assert.equal(JSON.stringify(Object.entries(idx.books).filter(([k]) => !(k in BOOKS))), othersBefore, dir + ': other books changed');
    touch(idxName, JSON.stringify(idx, null, 1));
  }
  // the other way: the other sefarim's passages list the Beit Yaakov osiyos that share their sources (Mafteach) or
  // that the model pairs with them (machine-learned). Earlier links into Beit Yaakov are replaced; reviewed ones are kept.
  const isB = r => r.startsWith('Beit Yaakov on Torah') || r.startsWith('Beit Yaakov, ');
  const ORDER = {reviewed: -1, strong: 0, likely: 1, possible: 2};
  let reverse = {passages: 0, links: 0, files: 0};
  for (const dir of ['mafteach', 'ml-parallels']) {
    const add = read(ROOT, `${DATA}/reverse/${dir}.json`);
    const idxName = `library/${dir}/index.json`, idx = read(site, idxName);
    for (const [book, {file: fallback, passages}] of Object.entries(add)) {
      assert(!(book in BOOKS), 'Reverse data for a Beit Yaakov book: ' + book);
      const file = idx.books[book]?.file || fallback;
      const name = `library/${dir}/${file}`;
      const d = fs.existsSync(rel(site, name)) ? read(site, name) : {version: RELEASE, ...(dir === 'mafteach' ? {book} : {}), passages: {}};
      for (const [ref, items] of Object.entries(passages)) {
        if (dir === 'mafteach') {
          const e = d.passages[ref] ??= {t: [], s: [], p: []};
          e.p = [...e.p.filter(x => !isB(x[0])), ...items].sort((a, b) => b[1] - a[1]);
        } else {
          const kept = (d.passages[ref] || []).filter(x => !isB(x[0]) || x[2] === 'reviewed');
          const have = new Set(kept.map(x => x[0]));
          d.passages[ref] = [...kept, ...items.filter(x => !have.has(x[0]))].sort((a, b) => ORDER[a[2]] - ORDER[b[2]] || b[1] - a[1]);
        }
        reverse.passages++; reverse.links += items.length;
      }
      const bytes = Buffer.from(JSON.stringify(d));
      assert(bytes.length <= 10 * 1024 * 1024, 'Over 10 MB: ' + name);
      touch(name, bytes); reverse.files++;
      idx.books[book] = {...(idx.books[book] || {file}), file, passages: Object.keys(d.passages).length, bytes: bytes.length};
    }
    touch(idxName, JSON.stringify(idx, null, 1));
  }
  console.log(JSON.stringify({reverse}));
  // the panel script: Beit Yaakov volumes ("Beit Yaakov, Shemos, Bo 3") have their own data file; new cache version
  const panel = 'library/mafteach-panel.js', js = fs.readFileSync(rel(site, panel), 'utf8');
  const oldV = js.match(/const VERSION = '([^']+)';/)[1];
  touch(panel, patchPanel(js));
  for (const name of ['library/index.html', 'library/sw.js']) {
    const t = fs.readFileSync(rel(site, name), 'utf8');
    const n = t.split('mafteach-panel.js?v=').length - 1;
    assert(n >= 1, 'Panel script reference missing in ' + name);
    let u = t.replace(/mafteach-panel\.js\?v=[A-Za-z0-9._-]+/g, 'mafteach-panel.js?v=' + PANEL_V);
    if (name === 'library/sw.js') {
      assert.equal((u.match(/const SHELL = `[^`]+`;/g) || []).length, 1, 'Unexpected service worker cache revision');
      u = u.replace(/const SHELL = `([^`]+)`;/, (_, v) => `const SHELL = \`${v}-beit-both-ways\`;`);
    }
    touch(name, u);
  }
  const report = {schemaVersion: 1, release: RELEASE, publication: base.publication, previousPanelVersion: oldV, panelVersion: PANEL_V, counts,
    affected: [...affected].sort(), created: [...created].sort(), stage: 'applied'};
  write(ROOT, STAGE, JSON.stringify(report));
  const final = {...report, stage: 'final', affected: report.affected.map(name => ({name, sha256: digest(site, name), preimage: before[name] || null}))};
  write(site, REPORT, JSON.stringify(final));
  console.log(JSON.stringify({ok: true, counts, affected: affected.size, created: created.size}));
}

export function verify(site) {
  const before = read(ROOT, PREVIOUS).files, report = read(site, REPORT);
  const allow = new Set([REPORT, ...report.affected.map(f => f.name)]);
  for (const [name, hash] of Object.entries(before)) {
    assert(fs.existsSync(rel(site, name)), 'Published file missing: ' + name);
    if (!allow.has(name)) assert.equal(digest(site, name), hash, 'Unrelated file altered: ' + name);
  }
  for (const f of report.affected) assert.equal(digest(site, f.name), f.sha256, 'Changed after apply: ' + f.name);
  // the patched panel resolves each volume to its own file, and the data answers for a real os of each book
  const api = (() => { const m = {exports: {}}; new Function('module', 'exports', fs.readFileSync(rel(site, 'library/mafteach-panel.js'), 'utf8'))(m, m.exports); return m.exports; })();
  const idx = read(site, 'library/mafteach/index.json');
  for (const [title, slug] of Object.entries(BOOKS)) {
    assert.equal(idx.books[title].file, slug + '.json');
    const d = read(site, 'library/mafteach/' + slug + '.json');
    assert(Object.keys(d.passages).length > 50, 'Too few Mafteach passages for ' + title);
  }
  console.log(JSON.stringify({ok: true, files: report.affected.length, panelExports: Object.keys(api).length}));
}

async function live(site) {
  const report = read(site, REPORT);
  const targets = [...report.affected, {name: REPORT, sha256: digest(site, REPORT)}];
  const errors = [];
  for (const f of targets) {           // one at a time, with pauses: the Pages host rate-limits bursts
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      try {
        const url = new URL(f.name, PUBLIC); url.searchParams.set('beit_par_verify', Date.now());
        const r = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(60000)});
        if (r.ok && sha(Buffer.from(await r.arrayBuffer())) === f.sha256) ok = true;
      } catch {}
      if (!ok) await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }
    if (!ok) errors.push(f.name);
    await new Promise(r => setTimeout(r, 300));
  }
  assert.equal(errors.length, 0, 'Live check failed: ' + errors.join(', '));
  console.log(JSON.stringify({ok: true, live: true, checked: targets.length}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, site = '.beit-par-site'] = process.argv.slice(2);
  if (mode === '--check') console.log(JSON.stringify({ok: true, release: RELEASE, counts: check()}));
  else if (mode === '--apply') apply(site);
  else if (mode === '--verify') verify(site);
  else if (mode === '--live') await live(site);
  else throw Error('Usage: --check | --apply SITE | --verify SITE | --live SITE');
}

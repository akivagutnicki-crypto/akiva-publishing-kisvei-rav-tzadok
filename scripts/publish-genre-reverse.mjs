// Chassidus / Kabbalah / Machshava / Mussar parallels the other way: on an outside passage opened in the reader, the
// panel lists the Rav Tzadok and Ishbitz-Radzin teachings that the parallels model pairs with it.
// Adds library/genre-reverse/ (the inverse of library/genre-parallels/) and the panel script that reads it, over the
// exact current Pages artifact. Every other published file is preserved byte for byte.
//
//   node scripts/publish-genre-reverse.mjs --check
//   node scripts/publish-genre-reverse.mjs --apply SITE
//   node scripts/publish-genre-reverse.mjs --verify SITE
//   node scripts/publish-genre-reverse.mjs --live SITE
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = '20261123-genre-reverse';
const PANEL_V = '20261123-genre-reverse-v12';
const DIR = 'dist/library/genre-reverse';          // committed data, each file under 10 MB
const PANEL = 'dist/library/mafteach-panel.js';
const REPORT = 'library/genre-reverse-20261123.json';
const PREVIOUS = 'new-books-baseline.json', META = 'new-books-publication.json';
const PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';

const sha = b => createHash('sha256').update(b).digest('hex');
const rel = (root, name) => {
  assert(name && !path.isAbsolute(name) && name.split('/').every(p => p && p !== '.' && p !== '..'), 'Bad path ' + name);
  const r = path.resolve(root, name); assert(r.startsWith(path.resolve(root) + path.sep)); return r;
};
const read = (root, name) => JSON.parse(fs.readFileSync(rel(root, name), 'utf8'));
const write = (root, name, data) => { const f = rel(root, name); fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, data); };
const digest = (root, name) => sha(fs.readFileSync(rel(root, name)));
const unversioned = js => js.replace(/const VERSION = '[^']+';/, "const VERSION = '';");

export function check() {
  const idx = read(ROOT, DIR + '/index.json');
  let passages = 0, links = 0;
  for (const [title, e] of Object.entries(idx.books)) {
    const bytes = fs.readFileSync(path.join(ROOT, DIR, e.file));
    assert(bytes.length <= 10 * 1024 * 1024, 'Over 10 MB: ' + e.file);
    const d = JSON.parse(bytes);
    assert.equal(Object.keys(d.passages).length, e.passages, e.file);
    for (const [ref, items] of Object.entries(d.passages)) {
      assert(ref.startsWith(title), 'Foreign passage ' + ref + ' in ' + e.file);
      for (const [lib, tier] of items) { assert(lib && /^(reviewed|strong|likely|possible)$/.test(tier), 'Bad item in ' + ref); links++; }
      passages++;
    }
  }
  const js = fs.readFileSync(path.join(ROOT, PANEL), 'utf8');
  assert(js.includes(`const VERSION = '${PANEL_V}';`) && js.includes('function backEntries('), 'Panel script lacks the reverse lookup');
  return {books: Object.keys(idx.books).length, passages, links};
}

export function apply(site) {
  const stats = check();
  const before = read(ROOT, PREVIOUS).files, base = read(ROOT, META);
  const affected = new Set(), created = new Set();
  const touch = (name, data) => {
    if (before[name]) assert.equal(digest(site, name), before[name], 'Site file changed since baseline: ' + name);
    else { assert(!fs.existsSync(rel(site, name)), 'Untracked collision: ' + name); created.add(name); }
    write(site, name, data); affected.add(name);
  };
  for (const f of fs.readdirSync(path.join(ROOT, DIR)).sort()) touch('library/genre-reverse/' + f, fs.readFileSync(path.join(ROOT, DIR, f)));
  // the panel: the published script must be the one these releases were built on (its VERSION line aside)
  const live = fs.readFileSync(rel(site, 'library/mafteach-panel.js'), 'utf8');
  const expected = fs.readFileSync(path.join(ROOT, 'sources/akiva/beit-yaakov-complete/parallels/panel-base.js'), 'utf8');
  assert.equal(sha(unversioned(live)), sha(unversioned(expected)), 'The published panel script is not the expected base; refusing to replace it');
  touch('library/mafteach-panel.js', fs.readFileSync(path.join(ROOT, PANEL)));
  for (const name of ['library/index.html', 'library/sw.js']) {
    const t = fs.readFileSync(rel(site, name), 'utf8');
    assert(t.includes('mafteach-panel.js?v='), 'Panel script reference missing in ' + name);
    let u = t.replace(/mafteach-panel\.js\?v=[A-Za-z0-9._-]+/g, 'mafteach-panel.js?v=' + PANEL_V);
    if (name === 'library/sw.js') {
      assert.equal((u.match(/const SHELL = `[^`]+`;/g) || []).length, 1, 'Unexpected service worker cache revision');
      u = u.replace(/const SHELL = `([^`]+)`;/, (_, v) => `const SHELL = \`${v}-genre-reverse\`;`);
    }
    touch(name, u);
  }
  const final = {schemaVersion: 1, release: RELEASE, publication: base.publication, stats, created: [...created].sort(),
    affected: [...affected].sort().map(name => ({name, sha256: digest(site, name), preimage: before[name] || null}))};
  write(site, REPORT, JSON.stringify(final));
  console.log(JSON.stringify({ok: true, stats, affected: affected.size, created: created.size}));
}

export function verify(site) {
  const before = read(ROOT, PREVIOUS).files, report = read(site, REPORT);
  const allow = new Set([REPORT, ...report.affected.map(f => f.name)]);
  for (const [name, hash] of Object.entries(before)) {
    assert(fs.existsSync(rel(site, name)), 'Published file missing: ' + name);
    if (!allow.has(name)) assert.equal(digest(site, name), hash, 'Unrelated file altered: ' + name);
  }
  for (const f of report.affected) assert.equal(digest(site, f.name), f.sha256, 'Changed after apply: ' + f.name);
  const m = {exports: {}}; new Function('module', 'exports', fs.readFileSync(rel(site, 'library/mafteach-panel.js'), 'utf8'))(m, m.exports);
  const P = m.exports, idx = read(site, 'library/genre-reverse/index.json');
  const key = P.mlKey(idx.books, 'Gevurot Hashem 9'); assert.equal(key, 'Gevurot Hashem');
  assert(P.backFor(read(site, 'library/genre-reverse/' + idx.books[key].file).passages, 'Gevurot Hashem 9').length >= 1, 'Sample lookup failed');
  // a library book never resolves to an outside file
  for (const b of read(site, 'library/data/catalog.json')) assert.equal(P.mlKey(idx.books, b.title + ' 1'), null, 'Library book matches an outside title: ' + b.title);
  console.log(JSON.stringify({ok: true, files: report.affected.length}));
}

async function live(site) {
  const report = read(site, REPORT);
  const targets = [...report.affected, {name: REPORT, sha256: digest(site, REPORT)}];
  const errors = [];
  for (const f of targets) {           // one at a time, with pauses: the Pages host rate-limits bursts
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      try {
        const url = new URL(f.name, PUBLIC); url.searchParams.set('genre_rev_verify', Date.now());
        const r = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(60000)});
        if (r.ok && sha(Buffer.from(await r.arrayBuffer())) === f.sha256) ok = true;
      } catch {}
      if (!ok) await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }
    if (!ok) errors.push(f.name);
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(errors.length, 0, 'Live check failed: ' + errors.join(', '));
  console.log(JSON.stringify({ok: true, live: true, checked: targets.length}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, site = '.genre-rev-site'] = process.argv.slice(2);
  if (mode === '--check') console.log(JSON.stringify({ok: true, release: RELEASE, ...check()}));
  else if (mode === '--apply') apply(site);
  else if (mode === '--verify') verify(site);
  else if (mode === '--live') await live(site);
  else throw Error('Usage: --check | --apply SITE | --verify SITE | --live SITE');
}

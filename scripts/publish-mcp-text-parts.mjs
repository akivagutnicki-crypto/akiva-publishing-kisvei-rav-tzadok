// Publish the whole-book MCP texts of Sidrei Taharos (Ohalos, Keilim) and Tiferes Tzvi I in parts under 10 MB
// (scripts/mcp-text-parts.mjs), over the exact current Pages artifact. Only mcp-data/text/<slug>.json of these three
// books changes (to {slug, parts, n}) and their <slug>.part<k>.json files are added; every other file is preserved.
//
//   node scripts/publish-mcp-text-parts.mjs --check-pack
//   node scripts/publish-mcp-text-parts.mjs --apply SITE BUILD
//   node scripts/publish-mcp-text-parts.mjs --finalize SITE
//   node scripts/publish-mcp-text-parts.mjs --verify SITE BUILD
//   node scripts/publish-mcp-text-parts.mjs --live SITE
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SPLIT} from './mcp-text-parts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = '20261126-mcp-text-parts';
const REPORT = 'library/mcp-text-parts-20261126.json';
const STAGE = 'mcp-text-parts-stage.json';
const PROOF = 'artifacts/mcp-text-parts/final-verification.json';
const PREVIOUS = 'new-books-baseline.json', META = 'new-books-publication.json';
const PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
const SLUGS = [...SPLIT].sort();
const sha = b => createHash('sha256').update(b).digest('hex');
const rel = (root, name) => {
  assert(name && !path.isAbsolute(name) && name.split('/').every(p => p && p !== '.' && p !== '..'), 'Bad path ' + name);
  const r = path.resolve(root, name); assert(r.startsWith(path.resolve(root) + path.sep)); return r;
};
const read = (root, name) => JSON.parse(fs.readFileSync(rel(root, name), 'utf8'));
const digest = (root, name) => sha(fs.readFileSync(rel(root, name)));
const own = name => SLUGS.some(s => name === `mcp-data/text/${s}.json` || name.startsWith(`mcp-data/text/${s}.part`));

function partsOf(root, slug) {
  const dir = rel(root, 'mcp-data/text'), d = read(root, `mcp-data/text/${slug}.json`);
  assert(d.parts >= 2 && d.n > 0, `${slug}: not in parts`);
  let n = 0; const files = [];
  for (let k = 1; k <= d.parts; k++) {
    const f = `mcp-data/text/${slug}.part${k}.json`, b = fs.readFileSync(rel(root, f));
    assert(b.length <= 10_000_000, 'Over 10 MB: ' + f); const p = JSON.parse(b); assert.equal(p.slug, slug); n += p.paras.length; files.push(f);
  }
  assert.equal(n, d.n, slug + ' paragraphs');
  assert(!fs.readdirSync(dir).some(f => f.startsWith(slug + '.part') && !files.includes('mcp-data/text/' + f)), slug + ': stray part');
  return {files: [`mcp-data/text/${slug}.json`, ...files], n};
}
export function apply(site, build) {
  const before = read(ROOT, PREVIOUS).files, base = read(ROOT, META);
  const affected = [], stats = {};
  for (const slug of SLUGS) {
    const main = `mcp-data/text/${slug}.json`;
    assert.equal(digest(site, main), before[main], 'Site file changed since baseline capture: ' + main);
    const old = read(site, main); assert(Array.isArray(old.paras), main + ' is not a whole-book file');
    const {files, n} = partsOf(build, slug);
    assert.equal(n, old.paras.length, slug + ': the parts do not hold the published paragraphs');
    for (const f of files) {
      if (f !== main) assert(!fs.existsSync(rel(site, f)), 'Untracked file collision: ' + f);
      fs.writeFileSync(rel(site, f), fs.readFileSync(rel(build, f))); affected.push(f);
    }
    stats[slug] = {paragraphs: n, parts: files.length - 1};
  }
  fs.writeFileSync(path.join(ROOT, STAGE), JSON.stringify({release: RELEASE, publication: base.publication, stats, affected}));
  console.log(JSON.stringify({ok: true, stage: 'applied', stats}));
}
export function finalize(site) {
  const stage = read(ROOT, STAGE), before = read(ROOT, PREVIOUS).files;
  const report = {...stage, stage: 'finalized', affected: stage.affected.map(name => ({name, sha256: digest(site, name), preimage: before[name] || null}))};
  fs.writeFileSync(rel(site, REPORT), JSON.stringify(report));
  console.log(JSON.stringify({ok: true, stage: 'finalized', files: report.affected.length}));
}
export function verify(site) {
  const before = read(ROOT, PREVIOUS).files, report = read(site, REPORT);
  assert.equal(report.release, RELEASE);
  const allow = new Set([REPORT, ...report.affected.map(f => f.name)]);
  for (const [name, hash] of Object.entries(before)) {
    assert(fs.existsSync(rel(site, name)), 'Existing published file missing: ' + name);
    if (!allow.has(name)) assert.equal(digest(site, name), hash, 'Unrelated published file altered: ' + name);
  }
  for (const f of report.affected) { assert(own(f.name), 'Not one of these files: ' + f.name); assert.equal(digest(site, f.name), f.sha256); }
  for (const slug of SLUGS) partsOf(site, slug);
  console.log(JSON.stringify({ok: true, verified: report.affected.length}));
}
async function verifyLive(site) {
  const report = read(site, REPORT); let passed = 0; const errors = [];
  for (const f of [...report.affected, {name: REPORT, sha256: digest(site, REPORT)}]) {
    let ok = false;
    for (let a = 0; a < 4 && !ok; a++) {
      try { const u = new URL(f.name, PUBLIC); u.searchParams.set('parts_verify', Date.now()); const r = await fetch(u, {cache: 'no-store'}); ok = r.ok && sha(Buffer.from(await r.arrayBuffer())) === f.sha256; } catch {}
      if (!ok) await new Promise(r => setTimeout(r, 3000));
    }
    ok ? passed++ : errors.push(f.name);
  }
  assert.equal(errors.length, 0, 'Live verification failed: ' + errors.join(', '));
  fs.mkdirSync(path.dirname(path.join(ROOT, PROOF)), {recursive: true});
  fs.writeFileSync(path.join(ROOT, PROOF), JSON.stringify({ok: true, live: true, release: RELEASE, publicFilesChecked: passed}));
  console.log(JSON.stringify({ok: true, live: true, publicFilesChecked: passed}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, site = '.parts-site', build = '.parts-build'] = process.argv.slice(2);
  if (mode === '--check-pack') console.log(JSON.stringify({ok: true, release: RELEASE, books: SLUGS}));
  else if (mode === '--apply') apply(site, build);
  else if (mode === '--finalize') finalize(site);
  else if (mode === '--verify') verify(site);
  else if (mode === '--live') await verifyLive(site);
  else throw Error('Usage: --check-pack | --apply SITE BUILD | --finalize SITE | --verify SITE | --live SITE');
}

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const session = require(path.resolve('dist/sefer-studio/ocr-session.js'));
const clone = value => JSON.parse(JSON.stringify(value));
const source = { sha256: 'a'.repeat(64), byteLength: 1024, pageCount: 3, fileName: 'Original.pdf' };
const seed = new Uint8Array(fs.readFileSync(path.join(__dirname, 'native-text-only.pdf')));
const original = {
  format: session.FORMAT, version: 1, savedAt: '2026-11-18T12:00:00.000Z', source,
  settings: { engine: 'local', language: 'heb_rashi', targetDpi: 300, scope: 'all', layout: 'rtl-columns', rangeStart: 1, rangeEnd: 3, currentPage: 2, improveSmallNumbers: true, refineRashiLines: true },
  glyphlessSeed: session.encodeSeed(seed), latestRun: { elapsedMs: 1234, attempts: [{ page: 1, status: 'recognized' }] },
  pages: [
    { page: 1, status: 'edited', text: 'שלום עולם', revision: 2, engine: 'on-device', language: 'heb', dir: 'rtl', imageWidth: 300, imageHeight: 400, renderScale: .5, actualDpi: 36, searchWords: [['שלום', 180, 30, 240, 50], ['עולם', 100, 30, 160, 50]], searchEdited: true, flags: [], flaggedCount: 0, reviewNotes: [], timing: { elapsedMs: 1234 }, numericReview: { corrected: 1 }, rashiRefinement: { status: 'refined', lines: [{ firstText: 'שלוס', refinedText: 'שלום', selectedText: 'שלום' }] } },
    { page: 2, status: 'no-text', text: '', imageWidth: 300, imageHeight: 400, renderScale: .5, searchWords: [], flags: [] },
    { page: 3, status: 'failed', text: '', flags: [], lastAttempt: { message: 'Stopped', status: 'failed' } }
  ]
};
const checks = [];
function check(name, test) { test(); checks.push(name); }
function rejects(change, pattern) { const next = clone(original); change(next); assert.throws(() => session.parse(JSON.stringify(next), source), pattern); }

check('Roundtrip retains corrected Hebrew, positions, blank and failed states, audits, and the exact font seed', () => {
  const saved = session.parse(JSON.stringify(original), source);
  assert.equal(saved.pages[0].text, 'שלום עולם');
  assert.equal(saved.pages[0].status, 'edited');
  assert.deepEqual(saved.pages[0].searchWords, original.pages[0].searchWords);
  assert.deepEqual(saved.pages[0].rashiRefinement, original.pages[0].rashiRefinement);
  assert.equal(saved.pages[1].status, 'no-text'); assert.equal(saved.pages[2].status, 'failed');
  assert.deepEqual(session.decodeSeed(saved.glyphlessSeed), seed);
});
check('Identical PDF bytes may use a different filename', () => {
  assert.equal(session.validate(original, { ...source, fileName: 'Renamed.pdf' }).pages.length, 3);
});
check('Same filename and page count cannot bypass a different PDF fingerprint', () => {
  assert.throws(() => session.validate(original, { ...source, sha256: 'b'.repeat(64) }), /different PDF/);
  assert.throws(() => session.validate(original, { ...source, byteLength: 1025 }), /different PDF/);
});
check('Review reports, future schemas, invalid JSON, duplicate pages and out-of-range pages are rejected', () => {
  rejects(s => { s.format = 'sefer-studio-ocr-report'; }, /review report/);
  rejects(s => { s.version = 2; }, /version 1/);
  assert.throws(() => session.parse('{broken'), /not valid JSON/);
  rejects(s => { s.pages[1] = clone(s.pages[0]); }, /repeats Page/);
  rejects(s => { s.pages[0].page = 4; }, /invalid text or status/);
});
check('Text and hidden search positions must agree', () => {
  rejects(s => { s.pages[0].text = 'different hidden words'; }, /do not match/);
  rejects(s => { s.pages[0].searchWords[0][0] = 'שלום עולם'; }, /invalid word box/);
});
check('Nonfinite, inverted, off-image and oversized word geometry is rejected', () => {
  for (const [index, value] of [[1, -1], [3, 301], [4, 401], [3, 179]]) rejects(s => { s.pages[0].searchWords[0][index] = value; }, /invalid word box/);
  const invalid = clone(original); invalid.pages[0].searchWords[0][1] = Infinity;
  assert.throws(() => session.validate(invalid), /invalid word box/);
  rejects(s => { s.pages[0].renderScale = 0; }, /scan dimensions/);
  rejects(s => { s.pages[0].imageWidth = 8193; }, /scan dimensions/);
});
check('Broad manual rewrites retain text without inventing search positions', () => {
  const next = clone(original); next.pages[0].text = 'A complete manual rewrite with added words'; next.pages[0].searchWords = null; next.pages[0].searchIssue = 'Words were added.';
  const restored = session.validate(next); assert.equal(restored.pages[0].searchWords, null); assert.equal(restored.pages[0].text, next.pages[0].text);
});
check('Blank and recognized states cannot conceal inconsistent text', () => {
  rejects(s => { s.pages[1].text = 'unexpected'; }, /marked blank/);
  rejects(s => { s.pages[0].status = 'recognized'; s.pages[0].text = ''; }, /has no text/);
});
check('Review crop coordinates and offsets are bounded', () => {
  const flag = { text: 'שלום', offset: 0, confidence: 70, bbox: { x0: 180, y0: 30, x1: 240, y1: 50 } };
  const next = clone(original); next.pages[0].flags = [flag]; next.pages[0].flaggedCount = 1;
  assert.equal(session.validate(next).pages[0].flags[0].text, 'שלום');
  next.pages[0].flags[0].offset = 1000; assert.throws(() => session.validate(next), /review crop/);
  next.pages[0].flags[0].offset = 0; next.pages[0].flags[0].bbox.x1 = 301; assert.throws(() => session.validate(next), /review crop/);
});
check('Unrecognized top-level fields and service credentials are not serialized', () => {
  const next = clone(original); next.connection = { access: 'never-save-this', endpoint: 'https://private.example/' }; next.settings.access = 'never-save-this'; next.pages[0].privateToken = 'never-save-this';
  assert(!JSON.stringify(session.validate(next)).includes('never-save-this'));
});
check('Prototype-bearing metadata is rejected without changing object prototypes', () => {
  const next = clone(original); next.pages[0].timing = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => session.validate(next), /unsupported field/); assert.equal({}.polluted, undefined);
});
check('Malformed, non-PDF and oversized searchable font payloads are rejected', () => {
  rejects(s => { s.glyphlessSeed = 'not-a-font'; }, /font/);
  rejects(s => { s.glyphlessSeed = 'YWJj'; }, /font/);
  assert.throws(() => session.encodeSeed(new Uint8Array(1024 * 1024 + 1)), /too large/);
});
check('Page ranges and obsolete language aliases are handled explicitly', () => {
  rejects(s => { s.settings.rangeEnd = 4; }, /page range/);
  const next = clone(original); next.settings.language = 'heb+eng'; assert.equal(session.validate(next).settings.language, 'eng+heb');
});
check('Validated output is detached from the input object', () => {
  const next = clone(original), result = session.validate(next);
  result.pages[0].searchWords[0][0] = 'edited'; result.pages[0].rashiRefinement.lines[0].selectedText = 'edited';
  assert.equal(next.pages[0].searchWords[0][0], 'שלום'); assert.equal(next.pages[0].rashiRefinement.lines[0].selectedText, 'שלום');
});
console.log(JSON.stringify({ status: 'PASS', cases: checks.length, checks }, null, 2));

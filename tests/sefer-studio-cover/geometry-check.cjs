'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modulePath = path.resolve(__dirname, '../../dist/sefer-studio/kdp-geometry.js');
const geometry = require(modulePath);

// Independent fixtures: copied from the official KDP calculator's returned
// measurement tables on 2026-11-18, NOT computed from the implementation.
// Original response filenames are retained for audit/reproduction. The values
// were recovered in kdp-geometry-check/official-measurements.json and the main
// 362-page cream template. Amazon displays mm to two decimal places.
const officialMeasurements = [
  { file: 'hardcover-7x10-cream-362.html', format: 'hardcover', paper: 'cream', ink: 'bw', pages: 362,
    widthMm: 423.39, heightMm: 290, spineMm: 27.79, panelWidthMm: 182.8, panelHeightMm: 260 },
  { file: 'official-CASE_LAMINATE-CREAM-BLACK_AND_WHITE-76.html', format: 'hardcover', paper: 'cream', ink: 'bw', pages: 76,
    widthMm: 405.23, heightMm: 290, spineMm: 9.63, panelWidthMm: 182.8, panelHeightMm: 260 },
  { file: 'official-CASE_LAMINATE-CREAM-BLACK_AND_WHITE-550.html', format: 'hardcover', paper: 'cream', ink: 'bw', pages: 550,
    widthMm: 435.32, heightMm: 290, spineMm: 39.73, panelWidthMm: 182.8, panelHeightMm: 260 },
  { file: 'official-CASE_LAMINATE-WHITE-BLACK_AND_WHITE-362.html', format: 'hardcover', paper: 'white', ink: 'bw', pages: 362,
    widthMm: 421.11, heightMm: 290, spineMm: 25.51, panelWidthMm: 182.8, panelHeightMm: 260 },
  { file: 'official-CASE_LAMINATE-COLOR-PREMIUM_COLOR-362.html', format: 'hardcover', paper: 'white', ink: 'premium', pages: 362,
    widthMm: 421.98, heightMm: 290, spineMm: 26.38, panelWidthMm: 182.8, panelHeightMm: 260 },
  { file: 'official-PAPERBACK-CREAM-BLACK_AND_WHITE-362.html', format: 'paperback', paper: 'cream', ink: 'bw', pages: 362,
    widthMm: 384.94, heightMm: 260.35, spineMm: 22.99, panelWidthMm: 177.8, panelHeightMm: 254 },
  { file: 'official-PAPERBACK-WHITE-BLACK_AND_WHITE-362.html', format: 'paperback', paper: 'white', ink: 'bw', pages: 362,
    widthMm: 382.66, heightMm: 260.35, spineMm: 20.71, panelWidthMm: 177.8, panelHeightMm: 254 },
  { file: 'official-PAPERBACK-COLOR-PREMIUM_COLOR-362.html', format: 'paperback', paper: 'white', ink: 'premium', pages: 362,
    widthMm: 383.53, heightMm: 260.35, spineMm: 21.58, panelWidthMm: 177.8, panelHeightMm: 254 },
  { file: 'official-PAPERBACK-WHITE-STANDARD_COLOR-362.html', format: 'paperback', paper: 'white', ink: 'standard', pages: 362,
    widthMm: 382.66, heightMm: 260.35, spineMm: 20.71, panelWidthMm: 177.8, panelHeightMm: 254 }
];

let checks = 0;
function check(name, callback) { callback(); checks++; }
function near(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
}
const base = { format: 'hardcover', trimW: 7, trimH: 10, pages: 362, paper: 'cream', ink: 'bw', direction: 'ltr' };
const paperback = { ...base, format: 'paperback' };
function valid(changes, template = base) {
  const settings = { ...template, ...changes };
  assert.deepEqual(geometry.validate(settings).errors, []);
  return geometry.calculate(settings);
}
function invalid(changes, template = base) {
  const settings = { ...template, ...changes };
  assert.ok(geometry.validate(settings).errors.length, `Accepted invalid settings ${JSON.stringify(changes)}`);
  assert.throws(() => geometry.calculate(settings), RangeError);
}

for (const fixture of officialMeasurements) {
  check(`Official calculator ${fixture.file}`, () => {
    const g = valid({ format: fixture.format, paper: fixture.paper, ink: fixture.ink, pages: fixture.pages });
    for (const [key, value] of [
      ['totalW', fixture.widthMm], ['totalH', fixture.heightMm], ['spine', fixture.spineMm],
      ['panelW', fixture.panelWidthMm], ['panelH', fixture.panelHeightMm]
    ]) near(g[key] * 25.4, value, 0.0051, `${fixture.file} ${key}`);
  });
}

check('Official hardcover fold, hinge and barcode positions', () => {
  const g = geometry.calculate(base);
  // Coordinates read from the downloaded official 362-page PDF drawing paths.
  near(g.spineRect.x * 25.4, 197.8, 0.00001, 'left spine fold');
  near((g.spineRect.x + g.spineRect.w) * 25.4, 225.587, 0.00001, 'right spine fold');
  near(g.hingeRects[0].x * 25.4, 187.8, 0.00001, 'left hinge edge');
  near((g.hingeRects[1].x + g.hingeRects[1].w) * 25.4, 235.587, 0.00001, 'right hinge edge');
  near(g.barcode.x * 25.4, 130.65, 0.00001, 'barcode x');
  near(g.barcode.y * 25.4, 234.995, 0.00001, 'barcode y');
  assert.equal(g.barcode.w, 2);
  assert.equal(g.barcode.h, 1.2);
  assert.equal(g.bleed, 0);
  assert.ok(g.panels.front.safe.x > 235.587 / 25.4);
  assert.ok(g.panels.back.safe.x + g.panels.back.safe.w < 187.8 / 25.4);
});

check('RTL paperback swaps panel identities and moves barcode to inner-left back', () => {
  const ltr = geometry.calculate(paperback);
  const rtl = valid({ direction: 'rtl', language: 'hebrew' }, paperback);
  assert.deepEqual(rtl.panels.front, ltr.panels.back);
  assert.deepEqual(rtl.panels.back, ltr.panels.front);
  near(rtl.barcode.x, rtl.panels.back.x + 0.25, 1e-12, 'RTL barcode inset');
  near(ltr.barcode.x + ltr.barcode.w, ltr.spineRect.x - 0.25, 1e-12, 'LTR barcode inset');
  assert.equal(rtl.totalW, ltr.totalW);
  assert.equal(rtl.wrap, 0);
  assert.equal(rtl.bleed, 0.125);
});

check('Odd manuscript page count uses next even print count', () => {
  const odd = valid({ pages: 361 });
  const even = geometry.calculate(base);
  assert.equal(odd.effectivePages, 362);
  assert.equal(odd.spine, even.spine);
  assert.equal(odd.totalW, even.totalW);
  assert.match(odd.warnings.join(' '), /361.*362/);
});
check('Hardcover 75-page manuscript becomes supported 76-page geometry', () => {
  const g = valid({ pages: 75 });
  assert.equal(g.effectivePages, 76);
  assert.equal(g.canAddSpineText, true);
  invalid({ pages: 74 });
  valid({ pages: 550 });
  invalid({ pages: 551 });
});
check('Paperback spine text threshold follows effective pages', () => {
  assert.equal(valid({ pages: 78 }, paperback).canAddSpineText, false);
  assert.equal(valid({ pages: 79 }, paperback).canAddSpineText, true);
  const thin = valid({ pages: 24, paper: 'white' }, paperback);
  assert.equal(thin.spineRect.safe.w, 0);
  invalid({ pages: 23 }, paperback);
});
check('Seven-by-ten stock limits', () => {
  valid({ pages: 775 }, paperback);
  valid({ pages: 776 }, paperback);
  invalid({ pages: 777 }, paperback);
  valid({ pages: 828, paper: 'white' }, paperback);
  invalid({ pages: 829, paper: 'white' }, paperback);
  valid({ pages: 72, paper: 'white', ink: 'standard' }, paperback);
  invalid({ pages: 71, paper: 'white', ink: 'standard' }, paperback);
  valid({ pages: 600, paper: 'white', ink: 'standard' }, paperback);
  invalid({ pages: 601, paper: 'white', ink: 'standard' }, paperback);
});
check('Wide trim paperback limits differ from seven-by-ten', () => {
  valid({ trimW: 8.5, trimH: 11, pages: 550 }, paperback);
  invalid({ trimW: 8.5, trimH: 11, pages: 551 }, paperback);
  valid({ trimW: 8.5, trimH: 11, pages: 590, paper: 'white' }, paperback);
  invalid({ trimW: 8.5, trimH: 11, pages: 591, paper: 'white' }, paperback);
  valid({ trimW: 8.25, trimH: 8.25, pages: 750 }, paperback);
  invalid({ trimW: 8.25, trimH: 8.25, pages: 751 }, paperback);
  valid({ trimW: 8.27, trimH: 11.69, pages: 730 }, paperback);
  valid({ trimW: 8.27, trimH: 11.69, pages: 780, paper: 'white' }, paperback);
  invalid({ trimW: 8.27, trimH: 11.69, paper: 'white', ink: 'standard' }, paperback);
  valid({ trimW: 8.27, trimH: 11.69, pages: 590, paper: 'white', ink: 'premium' }, paperback);
  invalid({ trimW: 8.27, trimH: 11.69, pages: 591, paper: 'white', ink: 'premium' }, paperback);
});
check('Custom paperback bounds and conservative limits', () => {
  const g = valid({ trimW: 4.5, trimH: 7.25, pages: 500 }, paperback);
  assert.equal(g.pageLimits.conservative, true);
  assert.match(g.warnings.join(' '), /Custom trim/);
  invalid({ trimW: 4.5, trimH: 7.25, pages: 551 }, paperback);
  valid({ trimW: 4, trimH: 6 }, paperback);
  invalid({ trimW: 3.99 }, paperback);
  invalid({ trimW: 8.51 }, paperback);
  invalid({ trimH: 5.99 }, paperback);
  invalid({ trimH: 11.7 }, paperback);
  invalid({ trimW: 7.1 }, base);
});
check('Unsupported color, language, binding combinations are rejected', () => {
  invalid({ direction: 'rtl' });
  invalid({ ink: 'standard', paper: 'white' });
  invalid({ ink: 'premium', paper: 'cream' });
  invalid({ ink: 'standard', paper: 'white', language: 'hebrew' }, paperback);
  invalid({ ink: 'standard', paper: 'white', language: 'yiddish' }, paperback);
  invalid({ ink: 'standard', paper: 'white', direction: 'rtl' }, paperback);
  valid({ ink: 'premium', paper: 'white', direction: 'rtl', language: 'hebrew' }, paperback);
  valid({ language: 'hebrew' });
});
check('Raw NaN, infinite, fractional, missing and unknown inputs are rejected', () => {
  for (const changes of [
    { trimW: NaN }, { trimH: Infinity }, { trimW: '7' }, { trimH: null },
    { pages: 362.2 }, { pages: NaN }, { pages: Infinity }, { pages: -1 },
    { pages: '362' }, { format: 'dust-jacket' }, { paper: 'groundwood' },
    { ink: 'invalid' }, { direction: 'auto' }, { language: 'invalid' }
  ]) invalid(changes);
  assert.ok(geometry.validate(null).errors.length);
  assert.ok(geometry.validate({}).errors.length);
});
check('All selected sizes have positive contained safe rectangles and barcode', () => {
  for (const [format, trims] of [
    ['hardcover', geometry.SUPPORTED_HARDCOVER_TRIMS],
    ['paperback', geometry.SUPPORTED_PAPERBACK_TRIMS]
  ]) {
    for (const t of trims) {
      const g = valid({ format, trimW: t.trimW, trimH: t.trimH });
      for (const p of Object.values(g.panels)) {
        assert.ok(p.safe.w > 0 && p.safe.h > 0);
        assert.ok(p.safe.x >= p.x && p.safe.y >= p.y);
        assert.ok(p.safe.x + p.safe.w <= p.x + p.w + 1e-10);
        assert.ok(p.safe.y + p.safe.h <= p.y + p.h + 1e-10);
      }
      const b = g.barcode, p = g.panels.back;
      assert.ok(b.x >= p.x && b.y >= p.y);
      assert.ok(b.x + b.w <= p.x + p.w && b.y + b.h <= p.y + p.h);
    }
  }
});
check('Module works without CommonJS in browser global context', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(modulePath, 'utf8'), context);
  assert.equal(typeof context.KdpGeometry.calculate, 'function');
  near(context.KdpGeometry.calculate(base).totalW, geometry.calculate(base).totalW, 1e-12, 'Browser calculation');
});
check('Geometry does not mutate caller settings', () => {
  const settings = Object.freeze({ ...base });
  assert.equal(geometry.calculate(settings).effectivePages, 362);
});

console.log(`KDP geometry: ${checks} checks passed, including ${officialMeasurements.length} official calculator fixtures.`);

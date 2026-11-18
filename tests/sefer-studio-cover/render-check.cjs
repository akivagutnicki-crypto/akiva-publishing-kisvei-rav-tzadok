#!/usr/bin/env node
/* Run: node tests/sefer-studio-cover/render-check.cjs [dist/sefer-studio]
 * Uses the real editor defaults and real render/geometry modules. No generated
 * proof files are written. Browser font and download QA is a separate check. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas } = require('@napi-rs/canvas');

const directory = path.resolve(process.argv[2] || path.join(__dirname, '../../dist/sefer-studio'));
const Geometry = require(path.join(directory, 'kdp-geometry.js'));
const Render = require(path.join(directory, 'kdp-render.js'));
const sandbox = {
  window: { KdpGeometry: Geometry },
  document: { readyState: 'loading', addEventListener() {} },
  console
};
vm.runInNewContext(fs.readFileSync(path.join(directory, 'kdp-cover.js'), 'utf8'), sandbox, { filename: 'kdp-cover.js' });
const make = () => JSON.parse(JSON.stringify(sandbox.window.KdpCoverStudio.defaultProject()));
const passed = [];
function check(name, action) { action(); passed.push(name); }
function render(project, { dpi = 90, guides = false, images = {} } = {}) {
  const geometry = Geometry.calculate(project.settings);
  const canvas = createCanvas(Math.ceil(geometry.totalW * dpi), Math.ceil(geometry.totalH * dpi));
  const ctx = canvas.getContext('2d');
  const report = Render.render(ctx, geometry, project, { dpi, guides, images });
  return { canvas, ctx, geometry, report, dpi };
}
function at(result, inchesX, inchesY) {
  return Array.from(result.ctx.getImageData(Math.floor(inchesX * result.dpi), Math.floor(inchesY * result.dpi), 1, 1).data);
}
function solid(fill, w = 8, h = 8) {
  const c = createCanvas(w, h); const ctx = c.getContext('2d'); ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h); return c;
}

check('actual Tzidkas hardcover defaults fit every front/back/spine block', () => {
  const p = make(), result = render(p);
  assert.deepEqual(result.report.errors, []);
  assert.equal(result.report.blocks.length, p.panels.front.blocks.length + p.panels.back.blocks.length + 4);
  assert(result.report.blocks.every(b => b.fits));
  assert(result.report.blocks.some(b => b.panel === 'front' && b.id === 'hebrew'));
  assert(result.report.blocks.some(b => b.panel === 'spine' && b.id === 'title'));
});

check('LTR and RTL put the actual front/back artwork on the correct physical panels', () => {
  const front = solid('#ff0000'), back = solid('#0000ff');
  for (const direction of ['ltr', 'rtl']) {
    const p = make(); Object.assign(p.settings, { format: 'paperback', direction });
    p.frame = false; p.spine.showText = false;
    for (const side of ['front', 'back']) Object.assign(p.panels[side], { image: side + '-fixture', showText: false });
    const result = render(p, { images: { front, back } });
    assert.deepEqual(result.report.errors, []);
    for (const [side, expected] of [['front', [255, 0, 0, 255]], ['back', [0, 0, 255, 255]]]) {
      const r = result.geometry.panels[side]; assert.deepEqual(at(result, r.x + r.w / 2, r.y + r.h / 2), expected);
    }
    const g = result.geometry;
    assert.equal(g.panels.front.x < g.panels.back.x, direction === 'rtl');
  }
});

check('text that cannot fit at 6pt is an explicit export-blocking error', () => {
  const p = make(); p.panels.front.blocks = [{ id: 'long-copy', text: 'This copy must never be silently lost. '.repeat(100), x: .1, y: .1, w: .1, h: .02, size: 48 }];
  const result = render(p);
  assert(result.report.errors.some(t => t.includes('too long to fit at 6 pt')));
  assert.equal(result.report.blocks.find(b => b.id === 'long-copy').fits, false);
});

check('back copy overlapping KDP barcode is blocked even without a white barcode box', () => {
  const p = make(); p.reserveBarcode = false;
  const g = Geometry.calculate(p.settings), b = g.barcode, s = g.panels.back.safe;
  p.panels.back.blocks = [{ id: 'barcode-collision', text: 'Important back-cover text', size: 12,
    x: (b.x - s.x) / s.w, y: (b.y - s.y) / s.h, w: b.w / s.w, h: b.h / s.h }];
  const result = render(p);
  assert(result.report.errors.some(t => t.includes('barcode-collision overlaps the KDP barcode area')));
});

check('text cannot extend beyond the safe panel rectangle', () => {
  const p = make(); p.panels.front.blocks[0].x = -.03;
  assert(render(p).report.errors.some(t => t.includes('extends outside the safe area')));
});

check('missing and low-resolution images are distinguished from generated print artwork', () => {
  const p = make(); p.panels.front.image = 'fixture'; p.panels.front.showText = false;
  assert(render(p).report.errors.some(t => t.includes('artwork has not loaded')));
  const low = render(p, { images: { front: solid('#554433', 350, 500) } });
  assert.equal(low.report.errors.length, 0);
  assert(low.report.warnings.some(t => t.includes('front artwork is about') && t.includes('DPI')));
  const high = render(p, { images: { front: solid('#554433', 2200, 3100) } });
  assert(!high.report.warnings.some(t => t.includes('DPI')));
});

check('short paperbacks omit spine lettering, and thin spines can disable it', () => {
  const p = make(); Object.assign(p.settings, { format: 'paperback', pages: 24 });
  let result = render(p); assert(!result.report.blocks.some(b => b.panel === 'spine'));
  assert(result.report.warnings.some(t => t.includes('Spine text is hidden')));
  p.settings.pages = 80; result = render(p);
  assert(result.report.errors.some(t => t.startsWith('Spine')));
  p.spine.showText = false; result = render(p);
  assert(!result.report.errors.some(t => t.startsWith('Spine')));
});

check('nikkud remains attached when long Hebrew words wrap', () => {
  const c = createCanvas(600, 300), ctx = c.getContext('2d');
  ctx.font = '24px "Noto Serif Hebrew"'; ctx.direction = 'rtl';
  const text = 'צִדְקַתהַצַּדִּיקצִדְקַתהַצַּדִּיק';
  const wrapped = Render.wrapText(ctx, text, 40);
  assert.equal(wrapped.lines.join(''), text);
  assert(wrapped.lines.length > 1);
  assert(wrapped.lines.every(line => !/^[\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7]/u.test(line)));
});

check('300-DPI output has full pixel extent, opaque wrap, and separate preview guides', () => {
  const p = make(), result = render(p, { dpi: 300 });
  assert.deepEqual(result.report.errors, []);
  // Independently verified official 7x10 / cream / 362-page hardcover dimensions.
  assert.equal(result.canvas.width, 5001); assert.equal(result.canvas.height, 3426);
  const { canvas, ctx, geometry: g } = result;
  for (const [x, y] of [[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]]) {
    assert.equal(ctx.getImageData(x, y, 1, 1).data[3], 255);
  }
  const barcode = g.barcode;
  const x = barcode.x + barcode.w / 2, y = barcode.y + barcode.h / 2;
  const cleanPixel = at(result, x, y);
  const clean = canvas.toBuffer('image/png');
  Render.render(ctx, g, p, { dpi: 300, guides: true });
  assert.notDeepEqual(at(result, x, y), cleanPixel);
  assert.notDeepEqual(canvas.toBuffer('image/png'), clean);
  Render.render(ctx, g, p, { dpi: 300, guides: false });
  assert.deepEqual(canvas.toBuffer('image/png'), clean, 'Removing guides must reproduce the clean print spread exactly.');
});

console.log(JSON.stringify({ status: 'PASS', cases: passed.length, checks: passed }, null, 2));

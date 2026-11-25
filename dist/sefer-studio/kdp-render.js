/* SeferStudio full-cover renderer. Physical coordinates are converted from inches
 * to points once, then painted at the requested DPI. Preview guides never appear
 * when guides:false. No browser-only APIs or external assets are required. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KdpRender = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const PT = 72;
  const MIN_TYPE = 6;
  const EPS = 0.02;
  const hebrew = /[\u0590-\u05ff]/;
  const combining = /[\u0300-\u036f\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7]/;
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const fonts = new Set(['Crimson Pro', 'EB Garamond', 'Playfair Display', 'Frank Ruhl Libre', 'David Libre', 'Noto Serif Hebrew', 'Miriam Libre', 'Secular One', 'Times New Roman', 'Georgia', 'Inter']);
  const colors = { bg: '#102338', accent: '#c6a45c', text: '#f4ecd7' };

  function finite(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  function cap(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function color(v, fallback) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback; }
  function mix(a, b, amount) {
    const parse = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const aa = parse(a), bb = parse(b);
    return '#' + aa.map((v, i) => Math.round(v * (1 - amount) + bb[i] * amount).toString(16).padStart(2, '0')).join('');
  }
  function rect(r) { return { x: r.x * PT, y: r.y * PT, w: r.w * PT, h: r.h * PT }; }
  function inset(r, x, y) { y = y === undefined ? x : y; return { x: r.x + x, y: r.y + y, w: r.w - 2 * x, h: r.h - 2 * y }; }
  function overlap(a, b) { return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS; }
  function contains(a, b) { return b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS; }
  function graphemes(text) {
    if (segmenter) return Array.from(segmenter.segment(text), v => v.segment);
    const out = [];
    for (const cp of Array.from(text)) { if (combining.test(cp) && out.length) out[out.length - 1] += cp; else out.push(cp); }
    return out;
  }
  function textDirection(block) { return block.direction === 'rtl' || block.direction === 'ltr' ? block.direction : hebrew.test(block.text || '') ? 'rtl' : 'ltr'; }
  function fontString(block, size) {
    const family = fonts.has(block.font) ? block.font : hebrew.test(block.text || '') ? 'Frank Ruhl Libre' : 'Crimson Pro';
    return `${block.italic ? 'italic ' : ''}${block.bold ? '700' : '400'} ${size}px "${family}", "Times New Roman", ${hebrew.test(block.text || '') ? '"Noto Serif Hebrew", ' : ''}"Liberation Serif", serif`;
  }
  function configureType(ctx, block, size) {
    ctx.font = fontString(block, size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.direction = textDirection(block);
  }
  function measuredWidth(ctx, text) {
    const m = ctx.measureText(text);
    // Some native Canvas implementations report an RTL ink origin near 100000.
    // The shaped advance remains reliable. Honor realistic italic overhangs,
    // while excluding those implementation-specific coordinate artifacts.
    const ink = finite(m.actualBoundingBoxLeft, 0) + finite(m.actualBoundingBoxRight, 0);
    return Math.max(m.width, ink >= 0 && ink <= m.width + 24 ? ink : m.width);
  }
  function wrapText(ctx, source, width) {
    const lines = [];
    let tooWide = false;
    for (const paragraph of String(source).replace(/\r\n?/g, '\n').split('\n')) {
      if (!paragraph.trim()) { lines.push(''); continue; }
      const words = paragraph.trim().split(/\s+/u);
      let line = '';
      for (const word of words) {
        const joined = line ? line + ' ' + word : word;
        if (measuredWidth(ctx, joined) <= width + EPS) { line = joined; continue; }
        if (line) { lines.push(line); line = ''; }
        if (measuredWidth(ctx, word) <= width + EPS) { line = word; continue; }
        // A single long word may wrap at grapheme boundaries. Nikkud remains
        // attached to its consonant rather than splitting into a separate line.
        for (const glyph of graphemes(word)) {
          if (line && measuredWidth(ctx, line + glyph) > width + EPS) { lines.push(line); line = ''; }
          if (measuredWidth(ctx, glyph) > width + EPS) tooWide = true;
          line += glyph;
        }
      }
      if (line) lines.push(line);
    }
    return { lines, tooWide };
  }
  function layoutAt(ctx, block, box, size) {
    configureType(ctx, block, size);
    const wrapped = wrapText(ctx, block.text || '', box.w);
    let ascent = size * 0.88, descent = size * 0.24;
    for (const line of wrapped.lines) {
      const m = ctx.measureText(line || 'Ag');
      ascent = Math.max(ascent, finite(m.actualBoundingBoxAscent, 0));
      descent = Math.max(descent, finite(m.actualBoundingBoxDescent, 0));
    }
    const leading = hebrew.test(block.text || '') ? 1.40 : 1.27;
    const lineHeight = Math.max(size * leading, ascent + descent + size * 0.08);
    const height = wrapped.lines.length ? ascent + descent + (wrapped.lines.length - 1) * lineHeight : 0;
    return { ...wrapped, size, ascent, descent, lineHeight, height, fits: !wrapped.tooWide && height <= box.h + EPS };
  }
  function fitText(ctx, block, box) {
    const maximum = cap(finite(block.size, 24), MIN_TYPE, 144);
    let layout = layoutAt(ctx, block, box, maximum);
    if (layout.fits) return layout;
    let lo = MIN_TYPE, hi = maximum;
    let best = layoutAt(ctx, block, box, lo);
    if (!best.fits) return best;
    // Monotonic bisection avoids repeated 0.25-point scans on long back copy.
    for (let i = 0; i < 15; i++) {
      const mid = (lo + hi) / 2;
      const candidate = layoutAt(ctx, block, box, mid);
      if (candidate.fits) { best = candidate; lo = mid; } else hi = mid;
    }
    return layoutAt(ctx, block, box, Math.floor(best.size * 100) / 100);
  }
  function paintType(ctx, block, box, layout, fill, middle) {
    configureType(ctx, block, layout.size);
    ctx.fillStyle = color(block.color, fill);
    const align = ['left', 'center', 'right'].includes(block.align) ? block.align : 'center';
    ctx.textAlign = align;
    const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
    const y = box.y + layout.ascent + (middle ? Math.max(0, (box.h - layout.height) / 2) : 0);
    // An overflowing block is reported but remains visibly clipped in preview;
    // export is stopped by the caller using the returned errors.
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    layout.lines.forEach((line, i) => ctx.fillText(line, x, y + i * layout.lineHeight));
    ctx.restore();
  }

  function ornament(ctx, x, y, sx, sy, accent) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
    ctx.strokeStyle = accent; ctx.lineWidth = 0.58;
    // Delicate engraved scrollwork, drawn directly at print resolution.
    const paths = [
      [0, 42, 8, 29, 2, 11, 19, 5, 36, 1, 48, 10, 49, 21],
      [4, 37, 15, 20, 27, 26, 31, 15, 34, 4, 17, 5, 18, 14],
      [7, 30, 16, 29, 23, 36, 22, 43, 21, 51, 10, 50, 11, 43]
    ];
    for (const p of paths) {
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 6) ctx.bezierCurveTo(...p.slice(i, i + 6));
      ctx.stroke();
    }
    for (const [lx, ly, rot] of [[9, 26, -.8], [16, 18, -.7], [28, 8, -.2]]) {
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(rot);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-5, -5, -3, -10, 0, -12); ctx.bezierCurveTo(3, -8, 5, -4, 0, 0); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }
  function panelFrame(ctx, panel, accent, quiet) {
    const r = inset(rect(panel.safe), 9);
    if (r.w < 72 || r.h < 100) return;
    ctx.save(); ctx.strokeStyle = accent; ctx.globalAlpha = quiet ? 0.46 : 0.74;
    ctx.lineWidth = 0.75; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 0.3; ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
    const scale = cap(Math.min(r.w, r.h) / 360, 0.6, 1.3);
    ornament(ctx, r.x + 6, r.y + 6, scale, scale, accent);
    ornament(ctx, r.x + r.w - 6, r.y + 6, -scale, scale, accent);
    ornament(ctx, r.x + 6, r.y + r.h - 6, scale, -scale, accent);
    ornament(ctx, r.x + r.w - 6, r.y + r.h - 6, -scale, -scale, accent);
    const cx = r.x + r.w / 2;
    for (const cy of [r.y, r.y + r.h]) {
      ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(cx, cy - 2.4); ctx.lineTo(cx + 2.4, cy); ctx.lineTo(cx, cy + 2.4); ctx.lineTo(cx - 2.4, cy); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function panelImage(ctx, image, panel, g, isLeft) {
    const r = rect(panel), outer = (g.wrap || g.bleed || 0) * PT;
    const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
    if (!(iw > 0 && ih > 0)) return null;
    const s = Math.max(r.w / iw, r.h / ih), sw = r.w / s, sh = r.h / s;
    const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.save();
    // Extend edge pixels into outer wrap/bleed without moving or scaling the
    // selected panel artwork. The spine itself keeps the chosen cover color.
    ctx.drawImage(image, sx, sy, sw, Math.min(1, sh), r.x, r.y - outer, r.w, outer);
    ctx.drawImage(image, sx, sy + sh - Math.min(1, sh), sw, Math.min(1, sh), r.x, r.y + r.h, r.w, outer);
    if (isLeft) {
      ctx.drawImage(image, sx, sy, Math.min(1, sw), sh, r.x - outer, r.y, outer, r.h);
      ctx.drawImage(image, sx, sy, 1, 1, r.x - outer, r.y - outer, outer, outer);
      ctx.drawImage(image, sx, sy + sh - 1, 1, 1, r.x - outer, r.y + r.h, outer, outer);
    } else {
      ctx.drawImage(image, sx + sw - Math.min(1, sw), sy, Math.min(1, sw), sh, r.x + r.w, r.y, outer, r.h);
      ctx.drawImage(image, sx + sw - 1, sy, 1, 1, r.x + r.w, r.y - outer, outer, outer);
      ctx.drawImage(image, sx + sw - 1, sy + sh - 1, 1, 1, r.x + r.w, r.y + r.h, outer, outer);
    }
    ctx.drawImage(image, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
    ctx.restore();
    return Math.min(iw / panel.w, ih / panel.h);
  }
  function drawSpine(ctx, g, project, theme, result) {
    const spine = project.spine || {};
    if (spine.showText === false) return;
    const entries = [spine.title, spine.subtitle, spine.volume, spine.publisher];
    if (!entries.some(v => String(v || '').trim())) return;
    if (project.settings.format === 'paperback' && g.effectivePages < 80) {
      result.warnings.push('Spine text is hidden: KDP paperback spine text requires at least 80 printed pages.');
      return;
    }
    const r = rect(g.spineRect);
    const usableW = r.w - 2 * finite(g.spineSafe, .0625) * PT;
    const usableL = r.h - 36;
    if (!(usableW > 0 && usableL > 0)) { result.errors.push('The spine is too narrow for text. Turn off spine text or use a larger page count.'); return; }
    const active = [
      { id: 'title', text: spine.title, font: 'Frank Ruhl Libre', weight: 0.31, size: finite(spine.size, 19), bold: true, fill: theme.text },
      { id: 'subtitle', text: spine.subtitle, font: 'Crimson Pro', weight: 0.32, size: finite(spine.size, 19) * .77, bold: false, fill: theme.text },
      { id: 'volume', text: spine.volume, font: 'Crimson Pro', weight: 0.15, size: finite(spine.size, 19) * .69, bold: false, fill: theme.accent },
      { id: 'publisher', text: spine.publisher, font: 'Crimson Pro', weight: 0.22, size: finite(spine.size, 19) * .52, bold: false, fill: theme.accent }
    ].filter(b => String(b.text || '').trim());
    const weight = active.reduce((sum, b) => sum + b.weight, 0), gap = Math.min(12, usableL * .02);
    const length = usableL - gap * (active.length - 1);
    ctx.save(); ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.rotate(spine.direction === 'up' ? -Math.PI / 2 : Math.PI / 2);
    let x = -usableL / 2;
    for (const b of active) {
      const box = { x, y: -usableW / 2, w: length * b.weight / weight, h: usableW };
      const block = { ...b, align: 'center', direction: 'auto', text: String(b.text), size: Math.max(MIN_TYPE, b.size) };
      const layout = fitText(ctx, block, box);
      if (!layout.fits) result.errors.push(`Spine ${b.id} does not fit at 6 pt. Shorten it or turn off spine text.`);
      paintType(ctx, block, box, layout, b.fill, true);
      result.blocks.push({ panel: 'spine', id: b.id, actualSize: layout.size, lines: layout.lines.length, fits: layout.fits });
      x += box.w + gap;
    }
    ctx.restore();
  }
  function dashedBox(ctx, r, stroke, width) {
    ctx.strokeStyle = stroke; ctx.lineWidth = width || .7; ctx.setLineDash([4, 3]); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]);
  }
  function guideLabel(ctx, text, x, y, align) {
    ctx.save(); ctx.font = '700 8px sans-serif'; ctx.direction = 'ltr'; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10;
    const left = (align === 'left' ? x : x - w / 2);
    ctx.fillStyle = 'rgba(5,12,22,.9)'; ctx.fillRect(left, y - 6, w, 12); ctx.fillStyle = '#f8fafc'; ctx.fillText(text, align === 'left' ? x + 5 : x, y); ctx.restore();
  }
  function drawGuides(ctx, g, showBarcode) {
    ctx.save();
    for (const name of ['front', 'back']) {
      const panel = g.panels[name], r = rect(panel), safe = rect(panel.safe);
      dashedBox(ctx, r, '#fb923c', .85); dashedBox(ctx, safe, '#67e8f9', .65);
      guideLabel(ctx, name === 'front' ? 'FRONT' : 'BACK', r.x + r.w / 2, Math.max(8, r.y - 8));
      if (g.hinge > 0) {
        const left = panel.x < g.spineRect.x;
        const hx = left ? r.x + r.w - g.hinge * PT : r.x;
        ctx.fillStyle = 'rgba(251,146,60,.2)'; ctx.fillRect(hx, r.y, g.hinge * PT, r.h);
        dashedBox(ctx, { x: hx, y: r.y, w: g.hinge * PT, h: r.h }, '#fb923c', .45);
      }
    }
    const sr = rect(g.spineRect);
    dashedBox(ctx, sr, '#fb923c', .65);
    dashedBox(ctx, inset(sr, finite(g.spineSafe, .0625) * PT, .125 * PT), '#67e8f9', .55);
    if (showBarcode && g.barcode) {
      const br = rect(g.barcode);
      ctx.fillStyle = 'rgba(255,255,255,.13)'; ctx.fillRect(br.x, br.y, br.w, br.h);
      dashedBox(ctx, br, '#facc15', .9);
      guideLabel(ctx, 'KDP BARCODE AREA', br.x + br.w / 2, br.y + br.h / 2);
    }
    guideLabel(ctx, 'SPINE', sr.x + sr.w / 2, Math.max(8, sr.y - 8));
    ctx.restore();
  }

  function render(ctx, g, project, options) {
    options = options || {};
    const result = { warnings: [], errors: [], blocks: [] };
    if (!ctx || !g || !project || !project.settings || !g.panels || !g.spineRect) throw new TypeError('Cover geometry, project settings, and a 2D canvas context are required.');
    const dpi = finite(options.dpi, 90);
    if (!(dpi >= 36 && dpi <= 600)) throw new RangeError('Cover rendering DPI must be from 36 to 600.');
    const theme = {};
    for (const k of Object.keys(colors)) theme[k] = color(project.theme && project.theme[k], colors[k]);
    const width = g.totalW * PT, height = g.totalH * PT;
    ctx.save(); ctx.setTransform(dpi / PT, 0, 0, dpi / PT, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    ctx.clearRect(0, 0, width + 1, height + 1);
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, mix(theme.bg, '#000000', .28)); grad.addColorStop(.46, theme.bg); grad.addColorStop(1, mix(theme.bg, '#000000', .4));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, width + 1, height + 1);
    // A very restrained crossgrain is vector-painted, so it stays crisp at 300 DPI.
    ctx.save(); ctx.strokeStyle = theme.accent; ctx.globalAlpha = .023; ctx.lineWidth = .26;
    for (let y = 0; y < height; y += 3.7) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y + 2.2); ctx.stroke(); }
    ctx.restore();
    const front = rect(g.panels.front);
    const glow = ctx.createRadialGradient(front.x + front.w / 2, front.y + front.h * .52, 0, front.x + front.w / 2, front.y + front.h * .52, front.h * .55);
    glow.addColorStop(0, theme.accent + '14'); glow.addColorStop(1, theme.accent + '00');
    ctx.fillStyle = glow; ctx.fillRect(front.x, front.y, front.w, front.h);
    // Full-spread vector artwork (Claude's cover design): drawn at the export DPI, so it stays crisp in print.
    if (project.art && !(options.images && options.images.art)) result.errors.push('The cover artwork has not loaded. Reload it before exporting.');
    if (options.images && options.images.art) ctx.drawImage(options.images.art, 0, 0, width, height);

    for (const name of ['back', 'front']) {
      const panel = g.panels[name], config = project.panels && project.panels[name] || {}, safe = rect(panel.safe);
      const supplied = options.images && options.images[name];
      if (config.image && !supplied) result.errors.push(`The ${name} artwork has not loaded. Reload the artwork before exporting.`);
      if (supplied) {
        const effectiveDpi = panelImage(ctx, supplied, panel, g, panel.x < g.spineRect.x);
        if (effectiveDpi === null) result.errors.push(`The ${name} artwork cannot be rendered.`);
        else if (effectiveDpi < 299.5) result.warnings.push(`The ${name} artwork is about ${Math.round(effectiveDpi)} DPI at this size; use a larger image for a 300-DPI print.`);
      }
      if (project.frame !== false) panelFrame(ctx, panel, theme.accent, name === 'back');
      if (config.showText !== false) {
        for (const block of Array.isArray(config.blocks) ? config.blocks : []) {
          if (!String(block.text || '').trim()) continue;
          const box = { x: safe.x + finite(block.x, .05) * safe.w, y: safe.y + finite(block.y, .1) * safe.h, w: finite(block.w, .9) * safe.w, h: finite(block.h, .15) * safe.h };
          const label = `${name === 'front' ? 'Front' : 'Back'} ${String(block.id || 'text')}`;
          if (!(box.w > 0 && box.h > 0) || !contains(safe, box)) {
            result.errors.push(`${label} extends outside the safe area. Move or resize its text box.`);
            continue;
          }
          if (name === 'back' && project.reserveBarcode && g.barcode && overlap(box, rect(g.barcode))) result.errors.push(`${label} overlaps the KDP barcode area. Move it above or away from that area.`);
          const layout = fitText(ctx, block, box);
          if (!layout.fits) result.errors.push(`${label} is too long to fit at 6 pt. Shorten it or increase its text box.`);
          else if (layout.size < finite(block.size, 24) - .1) result.warnings.push(`${label} was fitted to ${layout.size.toFixed(1)} pt.`);
          // Two text boxes that share space print on top of each other: warn, naming both.
          for (const other of result.blocks) if (other.panel === name && other.box && overlap(box, { x: other.box.x * PT, y: other.box.y * PT, w: other.box.w * PT, h: other.box.h * PT })) {
            result.warnings.push(`${label} overlaps ${name} ${other.id}. Move one of them (Position & text area).`);
          }
          paintType(ctx, block, box, layout, theme.text, false);
          result.blocks.push({ panel: name, id: block.id || 'text', actualSize: layout.size, lines: layout.lines.length, fits: layout.fits, box: { x: box.x / PT, y: box.y / PT, w: box.w / PT, h: box.h / PT } });
        }
      }
    }
    drawSpine(ctx, g, project, theme, result);
    if (project.reserveBarcode && g.barcode) {
      const b = rect(g.barcode); ctx.fillStyle = '#ffffff'; ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    if (options.guides) drawGuides(ctx, g, !!project.reserveBarcode);
    ctx.restore();
    result.warnings = Array.from(new Set(result.warnings));
    result.errors = Array.from(new Set(result.errors));
    return result;
  }
  return { render, fitText, wrapText, MIN_TYPE };
});

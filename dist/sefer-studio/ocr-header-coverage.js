(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SeferStudioOcrHeaderCoverage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // A review signal only: this never recognizes text, infers page numbers, or
  // changes OCR words/geometry. The caller limits it to the Rashi OCR profile.
  function collectOcrHeaderCoverage(data, image) {
    const clock = () => typeof performance === 'object' && performance.now ? performance.now() : Date.now();
    const started = clock(), flags = [];
    const summary = { method: 'unboxed-header-ink-v1', scope: 'header-only', status: 'skipped', regionCount: 0, inspectedPixels: 0, elapsedMs: 0 };
    function finish(status, reason) {
      summary.status = status;
      if (reason) summary.reason = reason;
      summary.elapsedMs = Math.round(Math.max(0, clock() - started) * 1000) / 1000;
      return { flags, summary };
    }
    const canvas = image && image.canvas, width = canvas && canvas.width, height = canvas && canvas.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) return finish('skipped', 'Unsupported image dimensions');
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const validBox = b => record(b) && ['x0','y0','x1','y1'].every(key => Number.isFinite(b[key])) && b.x0 >= 0 && b.y0 >= 0 && b.x1 > b.x0 && b.y1 > b.y0 && b.x1 <= width && b.y1 <= height;
    const words = [], lines = []; let containers = 0, wordSlots = 0;
    if (!record(data) || !Array.isArray(data.blocks)) return finish('skipped', 'Word positions are incomplete');
    if (data.blocks.length > 2000) return finish('skipped', 'Word-position limit reached');
    for (const block of data.blocks) {
      if (++containers > 2000) return finish('skipped', 'Word-position limit reached');
      if (!record(block) || !Array.isArray(block.paragraphs)) return finish('skipped', 'Word positions are incomplete');
      if (block.paragraphs.length > 2000) return finish('skipped', 'Word-position limit reached');
      for (const paragraph of block.paragraphs) {
        if (++containers > 2000) return finish('skipped', 'Word-position limit reached');
        if (!record(paragraph) || !Array.isArray(paragraph.lines)) return finish('skipped', 'Word positions are incomplete');
        if (paragraph.lines.length > 500) return finish('skipped', 'Word-position limit reached');
        for (const line of paragraph.lines) {
          if (++containers > 2000) return finish('skipped', 'Word-position limit reached');
          if (!record(line) || !Array.isArray(line.words)) return finish('skipped', 'Word positions are incomplete');
          wordSlots += line.words.length;
          if (wordSlots > 6000 || lines.length >= 500) return finish('skipped', 'Word-position limit reached');
          const current = [];
          for (const word of line.words) {
            if (!record(word) || typeof word.text !== 'string') return finish('skipped', 'Word positions are incomplete');
            if (!word.text.trim()) continue;
            if (!validBox(word.bbox)) return finish('skipped', 'Word positions are incomplete');
            current.push(word);
          }
          if (!current.length) continue;
          if (line.bbox != null && !validBox(line.bbox)) return finish('skipped', 'Line positions are incomplete');
          words.push(...current);
          const b = line.bbox || {
            x0: Math.min(...current.map(word => word.bbox.x0)), y0: Math.min(...current.map(word => word.bbox.y0)),
            x1: Math.max(...current.map(word => word.bbox.x1)), y1: Math.max(...current.map(word => word.bbox.y1))
          };
          lines.push({ count: current.length, bbox: b });
        }
      }
    }
    if (!words.length) return finish('skipped', 'No word positions are available');
    const heights = words.map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b);
    const middle = Math.floor(heights.length / 2), typical = heights.length % 2 ? heights[middle] : (heights[middle - 1] + heights[middle]) / 2;
    const bodyLines = lines.filter(line => line.count >= 4 && line.bbox.x1 - line.bbox.x0 >= width * 0.28);
    if (!bodyLines.length || typical < 4) return finish('skipped', 'No clear text-body boundary');
    const left = Math.round(width * 0.02), right = Math.round(width * 0.98), top = Math.round(height * 0.02);
    const bottom = Math.min(Math.round(height * 0.2), Math.floor(Math.min(...bodyLines.map(line => line.bbox.y0)) - typical * 0.25));
    const regionWidth = right - left, regionHeight = bottom - top, size = regionWidth * regionHeight;
    summary.headerBounds = { x0: left, y0: top, x1: right, y1: bottom };
    if (regionWidth < 1 || regionHeight < 1) return finish('skipped', 'No separate header region');
    if (size > 2000000) return finish('skipped', 'Header pixel limit reached');
    // Bound repeated mask writes as well as image size. Overlapping OCR boxes
    // must not multiply a small header into unbounded main-thread work.
    const padding = Math.max(2, Math.round(typical * 0.1)), masks = [];
    const maskLimit = Math.min(4000000, size * 4); let maskWork = 0;
    for (const word of words) {
      const b = word.bbox;
      const x0 = Math.max(0, Math.floor(b.x0 - padding) - left), x1 = Math.min(regionWidth, Math.ceil(b.x1 + padding) - left);
      const y0 = Math.max(0, Math.floor(b.y0 - padding) - top), y1 = Math.min(regionHeight, Math.ceil(b.y1 + padding) - top);
      if (x1 <= x0 || y1 <= y0) continue;
      maskWork += (x1 - x0) * (y1 - y0);
      if (maskWork > maskLimit) return finish('skipped', 'Header mask-work limit reached');
      masks.push({ x0, y0, x1, y1 });
    }
    let pixels;
    try { pixels = canvas.getContext('2d').getImageData(left, top, regionWidth, regionHeight).data; }
    catch (_error) { return finish('unavailable', 'Header pixels could not be read'); }
    if (!pixels || pixels.length !== size * 4) return finish('unavailable', 'Header pixels are incomplete');
    summary.inspectedPixels = size;
    // 0 = background/visited, 1 = unboxed ink, 2 = ink inside a padded word box.
    const ink = new Uint8Array(size), queue = new Int32Array(size);
    for (let index = 0; index < size; index++) {
      const p = index * 4, luminance = (pixels[p] * 299 + pixels[p + 1] * 587 + pixels[p + 2] * 114) / 1000;
      if (255 + (luminance - 255) * pixels[p + 3] / 255 < 160) ink[index] = 1;
    }
    for (const { x0, y0, x1, y1 } of masks) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (ink[y * regionWidth + x]) ink[y * regionWidth + x] = 2;
    }
    const components = []; let truncated = false;
    for (let seed = 0; seed < size; seed++) {
      if (!ink[seed]) continue;
      let head = 0, tail = 1, covered = ink[seed] === 2 ? 1 : 0;
      let x0 = regionWidth, y0 = regionHeight, x1 = 0, y1 = 0;
      queue[0] = seed; ink[seed] = 0;
      while (head < tail) {
        const index = queue[head++], x = index % regionWidth, y = (index - x) / regionWidth;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
        for (let ny = Math.max(0, y - 1); ny <= Math.min(regionHeight - 1, y + 1); ny++) for (let nx = Math.max(0, x - 1); nx <= Math.min(regionWidth - 1, x + 1); nx++) {
          const next = ny * regionWidth + nx;
          if (ink[next]) { if (ink[next] === 2) covered++; queue[tail++] = next; ink[next] = 0; }
        }
      }
      const w = x1 - x0, h = y1 - y0;
      if (h < typical * 0.4 || h > typical * 2.5 || w < typical * 0.15 || w > typical * 8 || tail < Math.max(25, typical * typical * 0.04) || covered > tail * 0.1) continue;
      if (components.length >= 256) { truncated = true; continue; }
      components.push({ bbox: { x0: x0 + left, y0: y0 + top, x1: x1 + left, y1: y1 + top }, ink: tail });
    }
    const groups = [];
    for (const component of components.sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
      const b = component.bbox;
      const group = groups.find(candidate => b.x0 - candidate.bbox.x1 <= typical * 0.8 && Math.abs((b.y0 + b.y1) / 2 - (candidate.bbox.y0 + candidate.bbox.y1) / 2) <= typical * 0.5);
      if (group) {
        group.bbox = { x0: Math.min(group.bbox.x0, b.x0), y0: Math.min(group.bbox.y0, b.y0), x1: Math.max(group.bbox.x1, b.x1), y1: Math.max(group.bbox.y1, b.y1) };
        group.ink += component.ink;
      } else groups.push({ bbox: { ...b }, ink: component.ink });
    }
    const regions = groups.filter(group => group.ink >= typical * typical * 0.15 && group.bbox.x1 - group.bbox.x0 >= typical * 0.4).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    summary.regionCount = regions.length;
    for (const region of regions.slice(0, 4)) flags.push({ kind: 'unrecognized-region', text: 'Possible missed header', offset: -1, confidence: null, bbox: region.bbox, reason: 'Visible marks fall outside the detected OCR words. Compare this header area with the scan; no text was added.' });
    summary.shownRegions = flags.length;
    return finish(truncated || regions.length > flags.length ? 'incomplete' : 'checked');
  }

  return { collectOcrHeaderCoverage };
});

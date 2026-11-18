/* KDP cover geometry, checked against Amazon's calculator on 2026-11-18.
 * All public measurements are inches. Geometry is independent of artwork.
 * Hardcover board/wrap/hinge values come from the official template, whose
 * measurements are more precise than the rounded inch values in the help page.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KdpGeometry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MM_PER_INCH = 25.4;
  var SAFE = 0.125;
  var SPINE_SAFE = 0.0625;
  var SOURCES = Object.freeze({
    calculator: 'https://kdp.amazon.com/en_US/cover-templates?language=en_US',
    paperback: 'https://kdp.amazon.com/en_US/help/topic/G201953020',
    hardcover: 'https://kdp.amazon.com/en_US/help/topic/GDTKFJPNQCBTMRV6',
    trimSizes: 'https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6',
    languages: 'https://kdp.amazon.com/en_US/help/topic/GML3FXP998V8WS4U',
    pageRounding: 'https://kdp.amazon.com/en_US/help/topic/G201834260'
  });

  function trim(w, h) {
    return Object.freeze({ trimW: w, trimH: h, label: w + ' × ' + h });
  }
  var SUPPORTED_HARDCOVER_TRIMS = Object.freeze([
    trim(5.5, 8.5), trim(6, 9), trim(6.14, 9.21), trim(7, 10), trim(8.25, 11)
  ]);
  var SUPPORTED_PAPERBACK_TRIMS = Object.freeze([
    trim(5, 8), trim(5.06, 7.81), trim(5.25, 8), trim(5.5, 8.5), trim(6, 9),
    trim(6.14, 9.21), trim(6.69, 9.61), trim(7, 10), trim(7.44, 9.69),
    trim(7.5, 9.25), trim(8, 10), trim(8.25, 6), trim(8.25, 8.25),
    trim(8.5, 8.5), trim(8.5, 11), trim(8.27, 11.69)
  ]);

  function sameTrim(s, w, h) {
    return Math.abs(s.trimW - w) < 1e-7 && Math.abs(s.trimH - h) < 1e-7;
  }
  function knownTrim(list, s) {
    return list.some(function (t) { return sameTrim(s, t.trimW, t.trimH); });
  }
  function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  /** The named-size limits are Amazon's published US print limits.
   * Unlisted custom sizes use the lowest published maximum for that stock.
   * This is a conservative builder limit, not a claim that KDP rejects every
   * larger custom book. The caller should display the custom-size warning.
   */
  function getPageLimits(settings) {
    var s = settings || {};
    if (s.format === 'hardcover') {
      return { min: 75, minEffective: 76, max: 550, custom: false,
        conservative: false, available: s.ink !== 'standard' };
    }
    var custom = !knownTrim(SUPPORTED_PAPERBACK_TRIMS, s);
    var standard = s.ink === 'standard';
    var max = s.paper === 'cream' && s.ink === 'bw' ? 776 : 828;
    var available = true;
    if (standard) max = 600;
    else if (sameTrim(s, 8.25, 6) || sameTrim(s, 8.25, 8.25)) {
      max = s.paper === 'cream' && s.ink === 'bw' ? 750 : 800;
    } else if (sameTrim(s, 8.5, 8.5) || sameTrim(s, 8.5, 11)) {
      max = s.paper === 'cream' && s.ink === 'bw' ? 550 : 590;
    } else if (sameTrim(s, 8.27, 11.69)) {
      max = s.ink === 'premium' ? 590 : s.paper === 'cream' ? 730 : 780;
    }
    if (standard && sameTrim(s, 8.27, 11.69)) available = false;
    if (custom) {
      max = standard ? 600 : s.paper === 'cream' && s.ink === 'bw' ? 550 : 590;
      if (standard && s.trimH > 11) available = false;
    }
    return { min: standard ? 72 : 24, minEffective: standard ? 72 : 24,
      max: max, custom: custom, conservative: custom, available: available };
  }

  /** Validate raw numeric form values before generating a cover. */
  function validate(settings) {
    var s = settings;
    var errors = [], warnings = [];
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return { errors: ['Enter the book settings before making a cover.'], warnings: [] };
    }
    if (s.format !== 'hardcover' && s.format !== 'paperback') {
      errors.push('Choose hardcover or paperback.');
    }
    if (!isNumber(s.trimW) || !isNumber(s.trimH) || s.trimW <= 0 || s.trimH <= 0) {
      errors.push('Trim width and height must be positive, finite numbers in inches.');
    } else if (s.format === 'hardcover' && !knownTrim(SUPPORTED_HARDCOVER_TRIMS, s)) {
      errors.push('KDP hardcover supports 5.5 × 8.5, 6 × 9, 6.14 × 9.21, 7 × 10, or 8.25 × 11 inches.');
    } else if (s.format === 'paperback' && (s.trimW < 4 || s.trimW > 8.5 || s.trimH < 6 || s.trimH > 11.69)) {
      errors.push('Paperback trim must be 4–8.5 inches wide and 6–11.69 inches high.');
    }
    var validPages = Number.isSafeInteger(s.pages) && s.pages > 0;
    if (!validPages) errors.push('Page count must be a positive whole number.');
    if (s.paper !== 'cream' && s.paper !== 'white') errors.push('Choose cream or white paper.');
    if (s.ink !== 'bw' && s.ink !== 'premium' && s.ink !== 'standard') {
      errors.push('Choose black-and-white, premium color, or standard color ink.');
    }
    if (s.direction !== 'ltr' && s.direction !== 'rtl') errors.push('Choose a left-to-right or right-to-left binding.');
    var language = s.language == null ? 'other' : s.language;
    if (language !== 'hebrew' && language !== 'yiddish' && language !== 'other') {
      errors.push('Choose Hebrew, Yiddish, or another language.');
    }
    if ((s.ink === 'premium' || s.ink === 'standard') && s.paper === 'cream') {
      errors.push('Color interiors require white paper.');
    }
    if (s.format === 'hardcover' && s.ink === 'standard') {
      errors.push('KDP does not offer standard color for hardcover. Choose premium color or black-and-white.');
    }
    if (s.format === 'hardcover' && s.direction === 'rtl') {
      errors.push('KDP hardcover currently supports left-to-right binding only. Hebrew text can still read right to left within the cover.');
    }
    if (s.ink === 'standard' && (language === 'hebrew' || language === 'yiddish')) {
      errors.push('KDP does not offer standard color for Hebrew or Yiddish books. Choose premium color or black-and-white.');
    } else if (s.ink === 'standard' && s.direction === 'rtl') {
      errors.push('KDP US does not offer standard color for right-to-left paperbacks. Choose premium color or black-and-white.');
    }
    var limits = getPageLimits(s);
    if (s.format === 'paperback' && !limits.available) {
      errors.push('Standard color is not supported by this builder for the selected trim size.');
    }
    if (validPages && (s.format === 'hardcover' || s.format === 'paperback')) {
      var effectivePages = Math.ceil(s.pages / 2) * 2;
      if (s.pages < limits.min || effectivePages > limits.max) {
        errors.push((limits.conservative ? 'This custom-trim builder supports ' : 'This print option supports ') +
          limits.min + '–' + limits.max + ' pages.');
      }
      if (s.pages % 2) warnings.push('KDP rounds ' + s.pages + ' manuscript pages up to ' + effectivePages + ' printed pages; the spine uses ' + effectivePages + '.');
      if (s.format === 'paperback' && effectivePages < 80) {
        warnings.push('Spine text is unavailable below 80 printed pages; the spine background will still print.');
      }
    }
    if (s.format === 'paperback' && limits.custom && isNumber(s.trimW) && isNumber(s.trimH)) {
      warnings.push('Custom trim uses a conservative page limit. Confirm this trim and paper combination in KDP before uploading.');
    }
    return { errors: errors, warnings: warnings };
  }

  function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

  /** Return all rectangles in absolute cover coordinates, in inches.
   * Throws RangeError with .errors/.warnings when settings are invalid.
   * barcode is a reserved placement region only; it does not generate a code.
   */
  function calculate(settings) {
    var check = validate(settings);
    if (check.errors.length) {
      var error = new RangeError(check.errors.join(' '));
      error.errors = check.errors;
      error.warnings = check.warnings;
      throw error;
    }
    var s = settings;
    var hardcover = s.format === 'hardcover';
    var effectivePages = Math.ceil(s.pages / 2) * 2;
    var caliper = s.ink === 'premium' ? 0.002347 : s.paper === 'cream' ? 0.0025 : 0.002252;
    var spine = effectivePages * caliper + (hardcover ? 4.8 / MM_PER_INCH : 0);
    var panelW = s.trimW + (hardcover ? 5 / MM_PER_INCH : 0);
    var panelH = s.trimH + (hardcover ? 6 / MM_PER_INCH : 0);
    var wrap = hardcover ? 15 / MM_PER_INCH : 0;
    var hinge = hardcover ? 10 / MM_PER_INCH : 0;
    var bleed = hardcover ? 0 : 0.125;
    var outer = wrap + bleed;
    var totalW = 2 * panelW + spine + 2 * outer;
    var totalH = panelH + 2 * outer;
    var spineX = outer + panelW;
    var left = rect(outer, outer, panelW, panelH);
    var right = rect(spineX + spine, outer, panelW, panelH);
    // Keep meaningful artwork away from both the hinge and the outer board edge.
    left.safe = rect(left.x + SAFE, left.y + SAFE, panelW - hinge - 2 * SAFE, panelH - 2 * SAFE);
    right.safe = rect(right.x + hinge + SAFE, right.y + SAFE, panelW - hinge - 2 * SAFE, panelH - 2 * SAFE);
    var rtl = s.direction === 'rtl';
    var panels = { front: rtl ? left : right, back: rtl ? right : left };
    var spineRect = rect(spineX, outer, spine, panelH);
    spineRect.safe = rect(spineX + SPINE_SAFE, outer + SAFE, Math.max(0, spine - 2 * SPINE_SAFE), panelH - 2 * SAFE);
    var barcodeX = rtl ? panels.back.x + hinge + 0.25 : panels.back.x + panelW - hinge - 0.25 - 2;
    var barcode = rect(barcodeX, outer + panelH - (hardcover ? 0.375 : 0.25) - 1.2, 2, 1.2);
    return {
      format: s.format, direction: s.direction,
      totalW: totalW, totalH: totalH, spine: spine, panelW: panelW, panelH: panelH,
      wrap: wrap, hinge: hinge, bleed: bleed, safe: SAFE, spineSafe: SPINE_SAFE,
      effectivePages: effectivePages, panels: panels, spineRect: spineRect, barcode: barcode,
      hingeRects: hardcover ? [rect(spineX - hinge, outer, hinge, panelH), rect(spineX + spine, outer, hinge, panelH)] : [],
      canAddSpineText: hardcover || effectivePages >= 80,
      warnings: check.warnings.slice(), pageLimits: getPageLimits(s)
    };
  }

  return Object.freeze({ calculate: calculate, validate: validate, getPageLimits: getPageLimits,
    SUPPORTED_HARDCOVER_TRIMS: SUPPORTED_HARDCOVER_TRIMS,
    SUPPORTED_PAPERBACK_TRIMS: SUPPORTED_PAPERBACK_TRIMS, SOURCES: SOURCES });
}));

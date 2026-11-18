/* Portable OCR checkpoints. No PDF pages, service addresses, or access codes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SeferOcrSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 64 * 1024 * 1024;
  const MAX_WORDS = 250000;
  const FORMAT = 'sefer-studio-ocr-session';
  const fail = message => { throw new Error(message); };
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);
  const text = (value, max) => typeof value === 'string' && value.length <= max;
  const normalize = value => value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();

  function cloneMetadata(value, label, budget = { nodes: 200000, characters: 4000000 }, depth = 0) {
    if (--budget.nodes < 0 || depth > 12) fail(label + ' is too complex.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      budget.characters -= value.length;
      if (budget.characters < 0) fail(label + ' is too large.');
      return value;
    }
    if (Array.isArray(value)) return value.map(item => cloneMetadata(item, label, budget, depth + 1));
    if (object(value)) {
      const copy = {};
      for (const key of Object.keys(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(label + ' contains an unsupported field.');
        copy[key] = cloneMetadata(value[key], label, budget, depth + 1);
      }
      return copy;
    }
    fail(label + ' contains invalid data.');
  }

  function source(value) {
    if (!object(value) || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || !integer(value.byteLength, 1, Number.MAX_SAFE_INTEGER) || !integer(value.pageCount, 1, 10000) || !text(value.fileName, 1024)) fail('This OCR session has an invalid PDF identity.');
    return { sha256: value.sha256, byteLength: value.byteLength, pageCount: value.pageCount, fileName: value.fileName };
  }

  function settings(value, count) {
    if (!object(value)) fail('This OCR session has invalid scan settings.');
    if (!['local', 'vision'].includes(value.engine) || !['eng+heb', 'heb+eng', 'eng', 'heb', 'heb_rashi'].includes(value.language) || ![300, 400].includes(value.targetDpi) || !['current', 'all', 'range'].includes(value.scope) || !['auto', 'rtl-columns', 'single'].includes(value.layout)) fail('This OCR session uses unsupported scan settings.');
    if (!integer(value.rangeStart, 1, count) || !integer(value.rangeEnd, value.rangeStart, count) || !integer(value.currentPage, 1, count) || typeof value.improveSmallNumbers !== 'boolean' || typeof value.refineRashiLines !== 'boolean') fail('This OCR session has an invalid page range.');
    if (value.fasterRashi !== undefined && typeof value.fasterRashi !== 'boolean') fail('This OCR session has an invalid Rashi speed option.');
    return { engine: value.engine, language: value.language === 'heb+eng' ? 'eng+heb' : value.language, targetDpi: value.targetDpi, scope: value.scope, layout: value.layout, rangeStart: value.rangeStart, rangeEnd: value.rangeEnd, currentPage: value.currentPage, improveSmallNumbers: value.improveSmallNumbers, refineRashiLines: value.refineRashiLines, fasterRashi: value.fasterRashi === true };
  }

  function bounds(b, width, height) {
    return object(b) && number(b.x0, 0, width) && number(b.y0, 0, height) && number(b.x1, 0, width) && number(b.y1, 0, height) && b.x1 > b.x0 && b.y1 > b.y0;
  }

  function pageResult(value, count, totals) {
    if (!object(value) || !integer(value.page, 1, count) || !['recognized', 'no-text', 'edited', 'fallback', 'failed'].includes(value.status) || !text(value.text, 200000)) fail('An OCR session page has invalid text or status.');
    const label = 'Page ' + value.page;
    totals.characters += value.text.length;
    if (totals.characters > 30000000) fail('This OCR session exceeds the text limit.');
    if (value.status === 'no-text' && value.text.trim()) fail(label + ' is marked blank but contains text.');
    if (value.status === 'recognized' && !value.text.trim()) fail(label + ' is marked recognized but has no text.');
    const row = { page: value.page, status: value.status, text: value.text, revision: integer(value.revision, 0, 1000000000) ? value.revision : 0, wordCount: value.text.trim() ? value.text.trim().split(/\s+/).length : 0 };
    for (const key of ['engine', 'language', 'modelId', 'message', 'searchIssue']) {
      if (value[key] !== undefined && value[key] !== null) {
        if (!text(value[key], key === 'message' || key === 'searchIssue' ? 4000 : 512)) fail(label + ' has invalid ' + key + '.');
        row[key] = value[key];
      }
    }
    if (value.dir !== undefined && !['auto', 'rtl', 'ltr'].includes(value.dir)) fail(label + ' has an invalid text direction.');
    row.dir = value.dir || 'auto';
    row.engineConfidence = value.engineConfidence == null ? null : value.engineConfidence;
    if (row.engineConfidence !== null && !number(row.engineConfidence, 0, 100)) fail(label + ' has invalid engine confidence.');
    if (value.actualDpi != null) {
      if (!integer(value.actualDpi, 1, 720)) fail(label + ' has an invalid scan resolution.');
      row.actualDpi = value.actualDpi;
    }
    const hasImage = ['imageWidth', 'imageHeight', 'renderScale'].some(key => value[key] != null);
    if (hasImage) {
      if (!integer(value.imageWidth, 1, 8192) || !integer(value.imageHeight, 1, 8192) || value.imageWidth * value.imageHeight > 20000000 || !number(value.renderScale, 0.000001, 10)) fail(label + ' has invalid scan dimensions.');
      row.imageWidth = value.imageWidth; row.imageHeight = value.imageHeight; row.renderScale = value.renderScale;
    }
    row.searchWords = null;
    if (value.searchWords != null) {
      if (!Array.isArray(value.searchWords) || value.searchWords.length > 6000 || !hasImage) fail(label + ' has invalid word positions.');
      totals.words += value.searchWords.length;
      if (totals.words > MAX_WORDS) fail('This OCR session exceeds the word-position limit.');
      row.searchWords = value.searchWords.map(word => {
        if (!Array.isArray(word) || word.length !== 5 || !text(word[0], 160) || !word[0] || normalize(word[0]) !== word[0] || /\s/.test(word[0]) || !bounds({ x0: word[1], y0: word[2], x1: word[3], y1: word[4] }, row.imageWidth, row.imageHeight)) fail(label + ' has an invalid word box.');
        return word.slice();
      });
      if (normalize(row.searchWords.map(word => word[0]).join(' ')) !== normalize(row.text)) fail(label + ': word positions do not match its text.');
    }
    if (value.searchEdited !== undefined) {
      if (typeof value.searchEdited !== 'boolean') fail(label + ' has invalid edit metadata.');
      row.searchEdited = value.searchEdited;
    }
    if (!Array.isArray(value.flags || []) || (value.flags || []).length > 40) fail(label + ' has invalid review flags.');
    row.flags = (value.flags || []).map(flag => {
      if (!object(flag) || !hasImage || !text(flag.text, 2000) || !flag.text || !integer(flag.offset, -1, row.text.length) || !bounds(flag.bbox, row.imageWidth, row.imageHeight)) fail(label + ' has an invalid review crop.');
      return cloneMetadata(flag, label + ' review flag', { nodes: 100, characters: 5000 });
    });
    row.flaggedCount = value.flaggedCount == null ? row.flags.length : value.flaggedCount;
    if (!integer(row.flaggedCount, row.flags.length, 100000)) fail(label + ' has an invalid review count.');
    if (!Array.isArray(value.reviewNotes || []) || (value.reviewNotes || []).length > 100 || (value.reviewNotes || []).some(note => !text(note, 4000))) fail(label + ' has invalid review notes.');
    row.reviewNotes = (value.reviewNotes || []).slice();
    for (const key of ['numericReview', 'rashiRefinement', 'headerCoverage', 'timing', 'lastAttempt']) {
      if (value[key] != null) row[key] = cloneMetadata(value[key], label + ' ' + key);
    }
    return row;
  }

  function validate(value, expectedSource) {
    if (!object(value) || value.format !== FORMAT || value.version !== 1) fail('Choose a Sefer Studio OCR session file (version 1). A review report cannot restore page text.');
    const pdf = source(value.source);
    if (expectedSource && (pdf.sha256 !== expectedSource.sha256 || pdf.byteLength !== expectedSource.byteLength || pdf.pageCount !== expectedSource.pageCount)) fail('This session belongs to a different PDF. Open its matching source PDF, then restore the session. No current OCR text was changed.');
    if (!text(value.savedAt, 64) || !Number.isFinite(Date.parse(value.savedAt)) || !Array.isArray(value.pages) || value.pages.length > pdf.pageCount) fail('This OCR session has invalid page records.');
    const totals = { words: 0, characters: 0 }, seen = new Set();
    const pages = value.pages.map(value => {
      const row = pageResult(value, pdf.pageCount, totals);
      if (seen.has(row.page)) fail('This OCR session repeats Page ' + row.page + '.');
      seen.add(row.page); return row;
    }).sort((a, b) => a.page - b.page);
    let glyphlessSeed = null;
    if (value.glyphlessSeed != null) {
      const seed = value.glyphlessSeed;
      if (!text(seed, 4 * Math.ceil(1024 * 1024 / 3)) || !seed.startsWith('JVBERi0') || seed.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(seed)) fail('This OCR session has an invalid searchable-PDF font.');
      glyphlessSeed = seed;
    }
    return { format: FORMAT, version: 1, savedAt: value.savedAt, source: pdf, settings: settings(value.settings, pdf.pageCount), pages, glyphlessSeed, latestRun: value.latestRun == null ? null : cloneMetadata(value.latestRun, 'Run history') };
  }

  function parse(raw, expectedSource) {
    if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail('This OCR session is too large (64 MB maximum).');
    let value;
    try { value = JSON.parse(raw); } catch (_) { fail('The OCR session file is not valid JSON. No current OCR text was changed.'); }
    return validate(value, expectedSource);
  }

  function encodeSeed(bytes) {
    if (!bytes) return null;
    if (!bytes.length || bytes.length > 1024 * 1024) fail('The searchable-PDF font is too large to save.');
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return btoa(binary);
  }

  function decodeSeed(value) {
    if (!value) return null;
    const binary = atob(value);
    if (binary.length > 1024 * 1024) fail('The searchable-PDF font exceeds its size limit.');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  return Object.freeze({ FORMAT, MAX_BYTES, MAX_WORDS, validate, parse, encodeSeed, decodeSeed });
});

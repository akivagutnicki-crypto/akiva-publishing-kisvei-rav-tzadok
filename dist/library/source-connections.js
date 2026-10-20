/* Exact, reviewed source connections. Shared words and shared dapim are retrieval
 * clues only; neither can turn an unreviewed record into a published connection.
 * The same pure matcher is used by citations, footnotes and the source sidebar. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AkivaSourceConnections = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const SCHOOLS = ['Kisvei Rav Tzadok', 'Ishbitz–Radzin'];
  const VERSION = '20261020-reviewed-connections-v4';

  function decode(value) {
    return String(value || '').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const point = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({
      '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'", '&nbsp;':' '
    })[entity]);
  }
  function normalizedHebrew(value) {
    return decode(String(value || '').replace(/<[^>]*>/g, ' ')).normalize('NFC')
      .replace(/[\u0591-\u05bd\u05bf-\u05c7\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[׳״'"‘’“”`]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function normalizeRef(value) {
    let ref = String(value || '').trim();
    try { ref = decodeURIComponent(ref); } catch { return ''; }
    ref = decode(ref).replace(/_/g, ' ').replace(/[–—]/g, '-');
    // Sefaria uses a period before the address and between its levels in URLs.
    const dotted = ref.match(/^(.+?)[. ](\d+[ab]?(?:[.:]\d+[ab]?)*(?:-\d*[ab]?(?:[.:]\d+[ab]?)*)?)$/i);
    if (dotted) ref = dotted[1] + ' ' + dotted[2].replace(/\./g, ':');
    return ref.replace(/\s*,\s*/g, ', ').replace(/\s*:\s*/g, ':')
      .replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  }
  function sourceRefFromUrl(value) {
    const href = String(value || '').trim();
    if (href.startsWith('#/read/')) return normalizeRef(href.slice(7).split('?')[0]);
    let url;
    try { url = new URL(href); } catch { return null; }
    if (url.protocol !== 'https:' || !['sefaria.org', 'www.sefaria.org'].includes(url.hostname.toLowerCase())) return null;
    if (/^\/(?:api|search|topics|sheets|texts|collections|profile|community|about)(?:\/|$)/i.test(url.pathname)) return null;
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!path || path.includes('/')) return null;
    const ref = normalizeRef(path);
    return /\d/.test(ref) ? ref : null;
  }
  // Reuse only the published quotation itself. This returns an attributed
  // English excerpt, never a claim that it translates a whole fetched page.
  function sourceQuotationFromNote(note, {ref = '', sourceUrl = ''} = {}) {
    if (note?.verificationStatus !== 'verified' || !Array.isArray(note.sources)) return null;
    const sources = note.sources.filter(source => source && typeof source.ref === 'string'
      && typeof source.url === 'string' && source.url
      && (!source.role || /^(?:primary(?:-source)?|source)$/.test(source.role)));
    if (sources.length !== 1) return null;
    const source = sources[0], exactRef = normalizeRef(source.ref);
    if (!exactRef || (ref && normalizeRef(ref).toLowerCase() !== exactRef.toLowerCase())
        || (sourceUrl && sourceUrl !== source.url)) return null;
    // Reviewed metadata identifies the exact displayed quotation. Hebrew kept
    // only as source evidence must not be inserted into an English-only note.
    const excerpt = note.reviewedSourceExcerpt;
    if (excerpt) {
      if (excerpt.schemaVersion !== 1 || excerpt.coverage !== 'excerpt'
          || normalizeRef(excerpt.ref).toLowerCase() !== exactRef.toLowerCase()
          || !/[A-Za-z]/.test(excerpt.en || '')
          || typeof excerpt.provenance !== 'string' || !excerpt.provenance.trim()) return null;
      if (note.paragraphs?.length === 1 && excerpt.hebrewParagraph === undefined
          && excerpt.englishParagraph === undefined) {
        const paragraph = note.paragraphs[0], expected = `${source.ref}: “${excerpt.en}”`;
        if (paragraph.language !== 'en' || paragraph.text !== expected || !Array.isArray(paragraph.rich)
            || paragraph.rich.map(run=>run.text || '').join('') !== expected
            || paragraph.rich[0]?.text !== source.ref || paragraph.rich[0]?.href !== source.url
            || paragraph.rich[0]?.bold !== true) return null;
        return {ref:exactRef,sourceUrl:source.url,en:excerpt.en,
          provenance:excerpt.provenance,coverage:'excerpt'};
      }
      // Earlier bilingual notes identify two distinct displayed paragraphs.
      if (!Number.isSafeInteger(excerpt.hebrewParagraph) || !Number.isSafeInteger(excerpt.englishParagraph)
          || excerpt.hebrewParagraph < 0 || excerpt.englishParagraph < 0 || excerpt.hebrewParagraph === excerpt.englishParagraph
          || !/[א-ת]/.test(excerpt.he || '')) return null;
      const he = note.paragraphs?.[excerpt.hebrewParagraph], en = note.paragraphs?.[excerpt.englishParagraph];
      if (he?.language !== 'he' || en?.language !== 'en' || he.text !== excerpt.he || en.text !== excerpt.en
          || !Array.isArray(he.rich) || !Array.isArray(en.rich)
          || he.rich.map(run=>run.text || '').join('') !== excerpt.he
          || en.rich.map(run=>run.text || '').join('') !== excerpt.en) return null;
      return {ref:exactRef,sourceUrl:source.url,he:excerpt.he,en:excerpt.en,
        provenance:excerpt.provenance,coverage:'excerpt'};
    }
    const paragraphs = (Array.isArray(note.paragraphs) ? note.paragraphs : [])
      .filter(paragraph => Array.isArray(paragraph?.rich)
        && paragraph.rich.some(run => run?.href === source.url));
    if (paragraphs.length !== 1) return null;
    const paragraph = paragraphs[0];
    const raw = paragraph.text || paragraph.rich.map(run => run?.text || '').join('');
    if (typeof raw !== 'string') return null;
    const match = raw.match(/^[^“‘"]+[:：]\s*(?:“([\s\S]+)”|‘([\s\S]+)’|"([\s\S]+)")\s*$/);
    const en = match && (match[1] || match[2] || match[3]);
    if (!en || !/[A-Za-z]/.test(en)) return null;
    // Curly double quotes may legitimately nest (for example, a quoted verse).
    // A second top-level quotation or prose between quotations is ambiguous.
    if (match[1] || match[2]) {
      const opening = match[1] ? '“' : '‘', closing = match[1] ? '”' : '’';
      let depth = 1;
      for (let index = 0; index < en.length; index++) {
        const character = en[index];
        // A typographic apostrophe within a word is not a closing quotation.
        if (closing === '’' && character === closing && /\p{L}/u.test(en[index - 1] || '')
            && /\p{L}/u.test(en[index + 1] || '')) continue;
        if (character === opening) depth++;
        else if (character === closing) depth--;
        if (depth < 1) return null;
      }
      if (depth !== 1) return null;
    } else if (en.includes('"')) return null;
    const provenance = note.provenance?.sourceQuotationRelease;
    return {ref: exactRef, sourceUrl: source.url, en,
      provenance: provenance?.versionTitle
        ? `${provenance.versionTitle}${provenance.license ? ' · ' + provenance.license : ''}`
        : 'English source quotation from the published footnote'};
  }
  function parseRef(value) {
    const ref = normalizeRef(value);
    const match = ref.match(/^(.+?) (\d+[ab]?(?::\d+[ab]?)*)(?:-((?:\d+[ab]?|[ab])(?::\d+[ab]?)*))?$/i);
    if (!match) return null;
    const start = match[2].split(':');
    let end = start.slice();
    if (match[3]) {
      let ending = match[3].split(':');
      if (/^[ab]$/i.test(ending[0])) {
        const original = start[Math.max(0, start.length - ending.length)];
        if (!/[ab]$/i.test(original)) return null;
        ending[0] = original.replace(/[ab]$/i, '') + ending[0];
      }
      // "6b:3-7a:2" has an explicit daf; "6b:3-8" inherits it.
      const folioIndex = start.findIndex(token => /[ab]$/i.test(token));
      end = /[ab]/i.test(ending[0]) && folioIndex >= 0 && ending.length < start.length
        ? [...start.slice(0, folioIndex), ...ending]
        : [...start.slice(0, Math.max(0, start.length - ending.length)), ...ending];
    }
    const number = token => {
      const item = token.match(/^(\d+)([ab])?$/i);
      return item ? Number(item[1]) * (item[2] ? 2 : 1) - (item[2]?.toLowerCase() === 'a' ? 1 : 0) : NaN;
    };
    const from = start.map(number), to = end.map(number);
    const kinds = start.map(token => /[ab]$/i.test(token) ? 'folio' : 'number');
    const endKinds = end.map(token => /[ab]$/i.test(token) ? 'folio' : 'number');
    if (kinds.some((kind,index) => endKinds[index] && endKinds[index] !== kind)) return null;
    if ([...from, ...to].some(x => !Number.isFinite(x) || x < 1)) return null;
    const book = match[1].toLowerCase();
    if (compare(from, to, 0, Infinity) > 0) return null;
    return {ref, book, from, to, kinds, endKinds, daf: /[ab]/i.test(start[0]), depth:start.length};
  }
  function compare(left, right, leftFill, rightFill) {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const a = left[i] ?? leftFill, b = right[i] ?? rightFill;
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }
  function refsOverlap(left, right) {
    const a = parseRef(left), b = parseRef(right);
    if (!a || !b) return normalizeRef(left) !== '' && normalizeRef(left).toLowerCase() === normalizeRef(right).toLowerCase();
    return a.book === b.book && a.kinds.every((kind,index) => !b.kinds[index] || kind === b.kinds[index])
      && a.endKinds.every((kind,index) => !b.endKinds[index] || kind === b.endKinds[index])
      && compare(a.from, b.to, 0, Infinity) <= 0 && compare(b.from, a.to, 0, Infinity) <= 0;
  }
  function containsTerm(text, term) {
    const needle = normalizedHebrew(term);
    if (!needle || needle.length < 3) return false;
    // Hebrew prefixes are part of the written word. English terms require
    // boundaries, so "sin" cannot match "single" or "blessing".
    return /[א-ת]/.test(needle) ? text.includes(needle) : (' ' + text + ' ').includes(' ' + needle + ' ');
  }
  function validRecord(record) {
    return record?.reviewed === true && SCHOOLS.includes(record.school)
      && Array.isArray(record.sourceRefs) && record.sourceRefs.length > 0
      && ['id','targetRef','sourceHebrew','sourceEnglish','targetHebrew','targetEnglish','explanation','translationProvenance']
        .every(key => typeof record[key] === 'string' && record[key].trim())
      && Array.isArray(record.focusTerms) && record.focusTerms.length > 0;
  }
  function pickConnections(records, sourceRef, context = {}) {
    const query = normalizeRef(sourceRef);
    if (!query) return [];
    const origin = normalizeRef(context.originRef || '');
    const text = normalizedHebrew([context.he, context.en].filter(Boolean).join(' '));
    const seen = new Set(), kept = [];
    for (const record of records || []) {
      if (!validRecord(record) || !record.sourceRefs.some(ref => refsOverlap(query, ref))) continue;
      // A citing paragraph must not be offered to explain itself.
      if (origin && refsOverlap(origin, record.targetRef)) continue;
      const exactOrigin = Array.isArray(record.originRefs) && record.originRefs.some(ref => normalizeRef(ref) === origin);
      const contextual = record.focusTerms.some(term => containsTerm(text, term));
      // For an in-text lookup the author's actual nearby words are required.
      // A direct source lookup has no author context and uses the exact source.
      if (origin && !exactOrigin && (!text || !contextual)) continue;
      const target = normalizeRef(record.targetRef).toLowerCase();
      if (seen.has(target)) continue;
      seen.add(target);
      kept.push({...record, matchedSourceRefs:record.sourceRefs.filter(ref => refsOverlap(query, ref))});
    }
    // Stable results, independent of request order. No quota fills or rotation.
    return kept.sort((a, b) => SCHOOLS.indexOf(a.school) - SCHOOLS.indexOf(b.school) || a.targetRef.localeCompare(b.targetRef));
  }
  function pickForPassage(records, sourceRefs, context = {}) {
    const seen = new Set(), out = [];
    for (const ref of sourceRefs || []) for (const record of pickConnections(records, ref, context)) {
      const target = normalizeRef(record.targetRef).toLowerCase();
      if (!seen.has(target)) { seen.add(target); out.push(record); }
    }
    return out;
  }
  return {VERSION, SCHOOLS, normalizeRef, sourceRefFromUrl, sourceQuotationFromNote, parseRef, refsOverlap,
    normalizedHebrew, validRecord, pickConnections, pickForPassage};
});

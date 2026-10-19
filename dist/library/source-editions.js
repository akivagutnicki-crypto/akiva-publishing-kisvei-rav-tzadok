/* Source-reader edition preferences. Canonical Akiva text, footnotes and their
 * quotation evidence are never rewritten by this adapter. Edition availability
 * was checked against Sefaria's primary versions API on 2026-10-19. */
(function (root, factory) {
  const connections = typeof module === 'object' && module.exports
    ? require('./source-connections.js') : root.AkivaSourceConnections;
  const api = factory(connections);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AkivaSourceEditions = api;
})(typeof window === 'object' ? window : globalThis, function (connections) {
  'use strict';

  const VERSION = '20261019-preferred-source-editions-v1';
  const VERIFIED_AT = '2026-10-19';
  const API = 'https://www.sefaria.org';
  const EDITIONS = Object.freeze({
    koren: 'The Koren Jerusalem Bible',
    chumash: 'Metsudah Chumash, Metsudah Publications, 2009',
    rashiChumash: 'Rashi Chumash, Metsudah Publications, 2009',
    rashiJoshua: 'The Book of Joshua, Metsudah Publications, 1997',
    rashiTanach: 'The Metsudah Tanach series, Lakewood, N.J',
    rashiMegillot: 'The Metsudah Five Megillot, Lakewood, N.J., 2001'
  });
  const TANACH_BOOKS = Object.freeze([
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges',
    'I Samuel', 'II Samuel', 'I Kings', 'II Kings', 'Isaiah', 'Jeremiah', 'Ezekiel',
    'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
    'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Psalms', 'Proverbs', 'Job',
    'Song of Songs', 'Ruth', 'Lamentations', 'Ecclesiastes', 'Esther', 'Daniel',
    'Ezra', 'Nehemiah', 'I Chronicles', 'II Chronicles'
  ]);
  const CHUMASH_BOOKS = Object.freeze(TANACH_BOOKS.slice(0, 5));
  const MEGILLOT = Object.freeze(['Song of Songs', 'Ruth', 'Lamentations', 'Ecclesiastes', 'Esther']);
  const RASHI_EDITIONS = Object.freeze(Object.fromEntries([
    ...CHUMASH_BOOKS.map(book => ['Rashi on ' + book, EDITIONS.rashiChumash]),
    ['Rashi on Joshua', EDITIONS.rashiJoshua],
    ...['Judges', 'I Samuel', 'II Samuel', 'I Kings', 'II Kings']
      .map(book => ['Rashi on ' + book, EDITIONS.rashiTanach]),
    ...MEGILLOT.map(book => ['Rashi on ' + book, EDITIONS.rashiMegillot])
  ]));
  const ALIASES = {
    Genesis: ['Bereishit', 'Bereishis', 'Bereshit', 'בראשית'],
    Exodus: ['Shemot', 'Shemos', 'שמות'],
    Leviticus: ['Vayikra', 'ויקרא'],
    Numbers: ['Bamidbar', 'במדבר'],
    Deuteronomy: ['Devarim', 'Devorim', 'דברים'],
    Joshua: ['Yehoshua', 'יהושע'], Judges: ['Shoftim', 'שופטים'],
    'I Samuel': ['1 Samuel', 'Samuel I', 'Shmuel I', 'שמואל א'],
    'II Samuel': ['2 Samuel', 'Samuel II', 'Shmuel II', 'שמואל ב'],
    'I Kings': ['1 Kings', 'Kings I', 'Melakhim I', 'מלכים א'],
    'II Kings': ['2 Kings', 'Kings II', 'Melakhim II', 'מלכים ב'],
    Isaiah: ['Yeshayahu', 'ישעיהו'], Jeremiah: ['Yirmiyahu', 'ירמיהו'],
    Ezekiel: ['Yechezkel', 'יחזקאל'], Hosea: ['Hoshea', 'הושע'],
    Joel: ['Yoel', 'יואל'], Amos: ['עמוס'], Obadiah: ['Ovadiah', 'עובדיה'],
    Jonah: ['Yonah', 'יונה'], Micah: ['Mikhah', 'מיכה'], Nahum: ['Nachum', 'נחום'],
    Habakkuk: ['Chabakuk', 'חבקוק'], Zephaniah: ['Tzefaniah', 'צפניה'],
    Haggai: ['Chaggai', 'חגי'], Zechariah: ['Zekhariah', 'זכריה'], Malachi: ['מלאכי'],
    Psalms: ['Tehillim', 'תהילים', 'תהלים'], Proverbs: ['Mishlei', 'משלי'],
    Job: ['Iyov', 'איוב'], 'Song of Songs': ['Shir HaShirim', 'Song of Solomon', 'שיר השירים'],
    Ruth: ['רות'], Lamentations: ['Eikhah', 'Eicha', 'איכה'],
    Ecclesiastes: ['Kohelet', 'Koheles', 'קהלת'], Esther: ['אסתר'], Daniel: ['דניאל'],
    Ezra: ['עזרא'], Nehemiah: ['Nechemiah', 'נחמיה'],
    'I Chronicles': ['1 Chronicles', 'Chronicles I', 'דברי הימים א'],
    'II Chronicles': ['2 Chronicles', 'Chronicles II', 'דברי הימים ב']
  };
  const BOOK_ALIASES = TANACH_BOOKS.flatMap(book => [book, ...(ALIASES[book] || [])]
    .map(alias => ({book, alias:alias.toLowerCase()})))
    .sort((a,b) => b.alias.length - a.alias.length);

  function canonicalRef(value) {
    let ref = String(value || '').trim();
    if (/^(?:https?:|#\/read\/)/i.test(ref)) ref = connections.sourceRefFromUrl(ref) || '';
    ref = connections.normalizeRef(ref);
    const rashi = /^rashi on /i.test(ref);
    const rest = rashi ? ref.slice(9) : ref;
    const lower = rest.toLowerCase();
    for (const {book, alias} of BOOK_ALIASES) {
      if (lower !== alias && !lower.startsWith(alias + ' ')) continue;
      const address = rest.slice(alias.length).trim();
      if (address && !/^\d+(?::\d+)*(?:-\d+(?::\d+)*)?$/.test(address)) continue;
      const canonical = (rashi ? 'Rashi on ' : '') + book + (address ? ' ' + address : '');
      if (address && !connections.parseRef(canonical)) return '';
      return canonical;
    }
    return ref;
  }
  function policyFor(value) {
    const ref = canonicalRef(value);
    const parsed = connections.parseRef(ref);
    const book = parsed ? ref.slice(0, ref.lastIndexOf(' ')) : ref;
    let versionTitle, kind;
    if (CHUMASH_BOOKS.includes(book)) { versionTitle = EDITIONS.chumash; kind = 'chumash'; }
    else if (TANACH_BOOKS.includes(book)) { versionTitle = EDITIONS.koren; kind = 'tanach'; }
    else if (RASHI_EDITIONS[book]) { versionTitle = RASHI_EDITIONS[book]; kind = 'rashi'; }
    else return null;
    if (parsed && (parsed.kinds.some(address => address !== 'number')
        || parsed.endKinds.some(address => address !== 'number')
        || Math.max(parsed.from.length, parsed.to.length) > (kind === 'rashi' ? 3 : 2))) return null;
    return {ref, book, kind, versionTitle, language:'english', verifiedAt:VERIFIED_AT};
  }
  function requestPath(value) {
    const policy = policyFor(value);
    if (!policy) return null;
    return '/api/v3/texts/' + encodeURIComponent(policy.ref)
      + '?version=source&version=' + encodeURIComponent('english|' + policy.versionTitle)
      + '&fill_in_missing_segments=0';
  }
  function requestUrl(value) {
    const path = requestPath(value);
    return path ? API + path : null;
  }
  function sourceUrl(value) {
    const policy = policyFor(value);
    if (!policy) return null;
    const parsed = connections.parseRef(policy.ref);
    const path = parsed ? policy.book.replace(/ /g, '_') + '.' + policy.ref.slice(policy.book.length + 1).replace(/:/g, '.')
      : policy.book.replace(/ /g, '_');
    // The current reader URL uses language|version_title. The v1 texts API's
    // title-only ven parameter is a different interface (reader/views.py).
    return API + '/' + path + '?lang=bi&ven=' + encodeURIComponent('english|' + policy.versionTitle.replace(/ /g, '_'));
  }
  function editionError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
  function sameRef(left, right) {
    const a = canonicalRef(left), b = canonicalRef(right);
    if (a === b) return Boolean(a);
    const ap = connections.parseRef(a), bp = connections.parseRef(b);
    return Boolean(ap && bp && ap.book === bp.book
      && JSON.stringify(ap.from) === JSON.stringify(bp.from) && JSON.stringify(ap.to) === JSON.stringify(bp.to));
  }
  function checkResponseRef(policy, raw) {
    if (!raw || raw.error || !Array.isArray(raw.versions))
      throw editionError('INVALID_RESPONSE', 'The preferred source response is invalid');
    const actual = canonicalRef(raw.ref);
    if (!sameRef(policy.ref, actual)) {
      // A book-only reader route may open its first section. Its returned ref
      // remains explicit; a requested chapter, segment or range must stay exact.
      const first = connections.parseRef(actual);
      if (connections.parseRef(policy.ref) || !first || first.book !== policy.book.toLowerCase())
        throw editionError('REFERENCE_MISMATCH', 'The preferred edition returned a different source reference');
    }
    return actual;
  }
  function language(version) {
    return String(version.actualLanguage || version.languageFamilyName || version.language || '').toLowerCase();
  }
  const isHebrew = version => ['he', 'hebrew'].includes(language(version));
  const isEnglish = version => ['en', 'english'].includes(language(version));
  function textTree(value) {
    if (Array.isArray(value)) return Array.from(value, textTree);
    if (value == null) return '';
    if (typeof value !== 'string') throw editionError('INVALID_TEXT', 'A source text segment is not text');
    return value;
  }
  function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? textTree(value) : [textTree(value)];
  }
  function present(value) {
    return typeof value === 'string' && value.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|thinsp);/g, ' ').trim() !== '';
  }
  function alignedRows(he, en) {
    if (!Array.isArray(he) && !Array.isArray(en)) return [[he || '', en || '']];
    const hs = Array.isArray(he) ? he : he == null ? [] : [he];
    const es = Array.isArray(en) ? en : en == null ? [] : [en];
    return Array.from({length:Math.max(hs.length, es.length)}, (_,i) => alignedRows(hs[i], es[i])).flat();
  }
  function versionMetadata(version) {
    return {title:version.versionTitle, lang:isHebrew(version) ? 'Hebrew' : 'English',
      source:version.versionSource || '', license:version.license || ''};
  }
  function skeleton(policy, raw) {
    const ref = checkResponseRef(policy, raw);
    const primary = raw.versions.find(isHebrew);
    return {ref, heRef:raw.heRef || '', sectionRef:canonicalRef(raw.sectionRef || ref),
      sections:raw.sections || [], toSections:raw.toSections || raw.sections || [],
      next:raw.next || null, prev:raw.prev || null, book:policy.book,
      he:asArray(primary?.text), en:[], segmentLevel:typeof primary?.text === 'string',
      versions:primary ? [versionMetadata(primary)] : []};
  }
  function attachSourceRows(result, raw, hebrew, english) {
    // The v3 tree is clipped to the requested coordinates. Flattening first
    // would lose the starting verse/comment and every chapter boundary.
    const leaves = value => Array.isArray(value) ? value.flatMap(leaves)
      : typeof value === 'string' ? [value] : [];
    const wholeSource = () => {
      const he = leaves(hebrew).join('<br>'), en = leaves(english).join('<br>');
      result.sourceRows = he || en ? [{ref:result.ref, label:result.ref, he, en}] : [];
      result.sourceRowStatus = 'whole-source';
    };
    try {
      const parsed = connections.parseRef(result.ref);
      const depth = result.book.startsWith('Rashi on ') ? 3 : 2;
      const coordinates = value => Array.isArray(value) && value.every(part => /^[1-9]\d*$/.test(String(part)))
        ? value.map(Number) : null;
      const from = coordinates(raw?.sections), to = coordinates(raw?.toSections);
      if (!parsed || raw.textDepth !== depth || !from || !to
          || JSON.stringify(from) !== JSON.stringify(parsed.from)
          || JSON.stringify(to) !== JSON.stringify(parsed.to)
          || from.length !== to.length || from.length > depth) throw new Error('Unverified source coordinates');
      const spans = raw.isSpanning === true ? raw.spanningRefs : null;
      if (raw.isSpanning === true && (!Array.isArray(spans) || !spans.length
          || spans.some(ref => !connections.parseRef(canonicalRef(ref))
            || !connections.refsOverlap(canonicalRef(ref), result.ref)))) throw new Error('Unverified source spans');
      let common = 0;
      while (common < from.length && from[common] === to[common]) common++;
      if (common < from.length && common < depth - 1 && raw.isSpanning !== true)
        throw new Error('A spanning range requires explicit section boundaries');
      const prefix = from.slice(0, common), rows = [];
      const begins = (path, endpoint) => path.every((part, index) => endpoint[index] === part);
      const branch = value => {
        if (Array.isArray(value)) return value;
        if (value == null || value === '') return [];
        throw new Error('Source nesting does not match its coordinates');
      };
      const visit = (position, he, en) => {
        const level = position.length;
        if (level === depth) {
          if ([he,en].some(value => value != null && typeof value !== 'string'))
            throw new Error('Unexpected source leaf');
          const label = position.join(':'), ref = result.book + ' ' + label;
          if (spans && !spans.some(span => connections.refsOverlap(ref, canonicalRef(span))))
            throw new Error('Source row exceeds an explicit span');
          rows.push({ref,label,he:he || '',en:en || ''});
          return;
        }
        const hs = branch(he), es = branch(en), count = Math.max(hs.length, es.length);
        const start = begins(position, from) && level < from.length ? from[level] : 1;
        if (begins(position, to) && level < to.length && count !== to[level] - start + 1)
          throw new Error('Source rows do not reach the exact range boundary');
        for (let index = 0; index < count; index++) visit([...position,start + index], hs[index], es[index]);
      };
      visit(prefix, hebrew, english);
      result.sourceRows = rows;
      result.sourceRowStatus = 'exact';
    } catch { wholeSource(); }
    return result;
  }
  function adaptResponse(value, raw) {
    const policy = policyFor(value);
    if (!policy) return null;
    const result = skeleton(policy, raw);
    const translated = raw.versions.filter(version => !isHebrew(version));
    if (translated.some(version => version.versionTitle !== policy.versionTitle || !isEnglish(version)))
      throw editionError('EDITION_MISMATCH', 'The response does not contain the requested English edition exclusively');
    if (translated.length > 1)
      throw editionError('AMBIGUOUS_EDITION', 'The source response contains duplicate translation editions');
    const english = translated[0];
    const mergedSources = english?.sources == null ? [] : [english.sources].flat(Infinity).filter(Boolean);
    if (english?.isMerged === true || mergedSources.some(title => title !== policy.versionTitle))
      throw editionError('MERGED_EDITION', 'A mixed translation cannot be presented as the requested edition');
    result.en = asArray(english?.text);
    if (!result.he.length) result.segmentLevel = typeof english?.text === 'string';
    if (english) result.versions.push(versionMetadata(english));
    const rows = alignedRows(result.he, result.en);
    const hebrewSegments = rows.filter(([he]) => present(he)).length;
    const translatedSegments = rows.filter(([he,en]) => present(he) && present(en)).length;
    const englishSegments = rows.filter(([,en]) => present(en)).length;
    const complete = hebrewSegments > 0 && translatedSegments === hebrewSegments && englishSegments === translatedSegments;
    const status = !englishSegments ? 'missing' : complete ? 'available' : 'partial';
    const message = status === 'available' ? '' : status === 'missing'
      ? 'This source has no English text in ' + policy.versionTitle + '.'
      : 'Some of this source could not be matched to English in ' + policy.versionTitle + '.';
    result.preferredEdition = {policyVersion:VERSION, status, requestedVersionTitle:policy.versionTitle,
      actualVersionTitle:english?.versionTitle || null, message, completeEnglish:complete,
      hebrewSegments, translatedSegments, englishSegments, requestUrl:requestUrl(policy.ref),
      sourceUrl:sourceUrl(policy.ref), versionSource:english?.versionSource || '', license:english?.license || ''};
    result.sourceTranslationUrl = result.preferredEdition.sourceUrl;
    return attachSourceRows(result, raw, raw.versions.find(isHebrew)?.text, english?.text);
  }
  async function fetchPreferredText(value, getJSON) {
    const policy = policyFor(value);
    if (!policy) return null;
    let raw;
    try {
      raw = await getJSON(requestPath(policy.ref));
      return adaptResponse(policy.ref, raw);
    } catch (error) {
      // Never allow a rejected or unavailable preferred request to fall through
      // to generic translation caches. A valid primary Hebrew response is safe
      // to retain, but none of its rejected English is reused.
      let result;
      try { result = skeleton(policy, raw); }
      catch { result = {ref:policy.ref, sectionRef:policy.ref, book:policy.book, he:[], en:[], versions:[], sections:[], next:null, prev:null, segmentLevel:false}; }
      result.preferredEdition = {policyVersion:VERSION, status:'unavailable',
        requestedVersionTitle:policy.versionTitle, actualVersionTitle:null,
        message:'The requested English edition could not be verified: ' + policy.versionTitle + '. Reopen this source to retry.',
        code:error?.code || 'FETCH_FAILED', completeEnglish:false,
        requestUrl:requestUrl(policy.ref), sourceUrl:sourceUrl(policy.ref), versionSource:'', license:''};
      result.sourceTranslationUrl = result.preferredEdition.sourceUrl;
      // A wrong-reference response never contributes even Hebrew to fallback
      // rows. Only skeleton's already verified primary text may survive.
      const primary = result.he.length && raw?.versions?.find(isHebrew);
      return attachSourceRows(result, raw, primary?.text, undefined);
    }
  }
  return {VERSION, VERIFIED_AT, API, EDITIONS, TANACH_BOOKS, CHUMASH_BOOKS, RASHI_EDITIONS,
    canonicalRef, policyFor, requestPath, requestUrl, sourceUrl, sameRef, adaptResponse, fetchPreferredText};
});

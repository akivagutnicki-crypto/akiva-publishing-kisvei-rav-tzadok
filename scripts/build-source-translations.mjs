#!/usr/bin/env node
// Reuse already-published source translations only when the retained Hebrew is
// the entire precisely addressed primary unit. Hashes prove preservation and
// provenance, not the semantic quality of a translation or a new connection.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const require = createRequire(import.meta.url);
const engine = require('../dist/library/source-connections.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH = /^[a-f0-9]{64}$/;
const INTEGER_ADDRESSES = new Set(['Integer', 'Perek', 'Pasuk', 'Siman', 'Seif', 'SeifKatan', 'Halakhah']);
const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const canonicalRef = value => nonempty(value) ? engine.normalizeRef(value) : null;

function readRegular(filename) {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'Expected a regular input file: ' + filename);
  return fs.readFileSync(filename);
}

function within(filename, directory) {
  const relative = path.relative(directory, filename);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export function readQuotationRelease(partsDir) {
  const manifest = JSON.parse(readRegular(path.join(partsDir, 'manifest.json')));
  assert(manifest.schemaVersion === 1 && Array.isArray(manifest.parts) && manifest.parts.length,
    'Invalid source quotation manifest');
  assert(HASH.test(manifest.sha256), 'Missing source quotation payload hash');
  const names = new Set();
  const parts = manifest.parts.map(part => {
    assert(object(part) && /^[a-zA-Z0-9_.-]+$/.test(part.path) && !part.path.startsWith('.'), 'Unsafe source quotation part path');
    assert(!names.has(part.path), 'Duplicate source quotation part');
    names.add(part.path);
    const bytes = readRegular(path.join(partsDir, part.path));
    assert(bytes.length === part.bytes && sha(bytes) === part.sha256, 'Source quotation part checksum mismatch: ' + part.path);
    return bytes;
  });
  const compressed = Buffer.concat(parts);
  assert(compressed.length === manifest.bytes && sha(compressed) === manifest.sha256, 'Source quotation payload checksum mismatch');
  const payload = JSON.parse(gunzipSync(compressed));
  assert(payload.schemaVersion === 1 && payload.release === manifest.release && Array.isArray(payload.quotationRestorations)
    && Array.isArray(payload.files), 'Invalid source quotation release payload');
  return {payload, manifest};
}

export function readPrimaryArchive(filename, manifest) {
  const bytes = readRegular(filename);
  const encoded = bytes.toString('utf8').replace(/\s/g, '');
  const compressed = Buffer.from(encoded, 'base64');
  assert(compressed.toString('base64') === encoded, 'Invalid base64 primary evidence archive');
  const archive = JSON.parse(gunzipSync(compressed));
  assert(archive.schemaVersion === 1 && archive.sourceRelease === manifest.release
    && archive.sourceReleaseSha256 === manifest.sha256 && Array.isArray(archive.sources), 'Primary evidence archive belongs to another source release');
  const sources = new Map();
  for (const source of archive.sources) {
    assert(object(source) && HASH.test(source.sha256) && typeof source.rawResponse === 'string', 'Invalid raw primary response evidence');
    assert(sha(Buffer.from(source.rawResponse, 'utf8')) === source.sha256, 'Raw primary response checksum mismatch');
    assert(!sources.has(source.sha256), 'Duplicate primary response evidence');
    assert(Array.isArray(source.requestUrls) && source.requestUrls.length && source.requestUrls.every(nonempty), 'Missing primary response request URL');
    sources.set(source.sha256, {...source, document: JSON.parse(source.rawResponse)});
  }
  return {sources, sha256: sha(bytes)};
}

class Ineligible extends Error {}
const eligible = (condition, message) => { if (!condition) throw new Ineligible(message); };

function flattenStrings(value) {
  const parts = Array.isArray(value) ? value.flat(Infinity) : [value];
  eligible(parts.length > 0 && parts.every(part => typeof part === 'string'), 'Retained source Hebrew is not text');
  return parts;
}

// Formatting alone may differ between a cached response and a retained quote.
// Keep all letters, nikkud, punctuation, and every word; do not use the looser
// search normalization or a substring match to establish a complete source.
export function primaryPlainText(value) {
  const entities = {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '};
  return value.replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name.startsWith('#')) {
      const number = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : entity;
    }
    return entities[name.toLowerCase()] ?? entity;
  }).replace(/\s+/g, ' ').trim();
}

export function completePrimaryUnit(restoration, primary) {
  eligible(restoration.verified === true, 'Source restoration is not verified');
  eligible(restoration.sourceLanguage === 'he', 'Independent Hebrew translation evidence is required');
  eligible(Array.isArray(restoration.sourceSegmentRefs) && restoration.sourceSegmentRefs.length === 1, 'Multiple or ambiguous source references');
  const ref = restoration.sourceSegmentRefs[0];
  eligible(canonicalRef(ref) === ref, 'Source reference is not canonical');
  eligible(nonempty(restoration.method) && nonempty(restoration.verificationScope), 'Missing original translation review scope');
  eligible(!/^Verified only as\b/i.test(restoration.verificationScope), 'Limited transmitted-quotation review');
  eligible(/\bcomplete\b|every word of each selected primary|every sentence of the complete/i.test(restoration.method + ' ' + restoration.verificationScope),
    'Original review does not identify a complete primary unit');
  eligible(object(primary) && nonempty(primary.ref) && Array.isArray(primary.sections) && Array.isArray(primary.toSections)
    && Array.isArray(primary.addressTypes), 'Unsupported primary reference metadata');
  eligible(JSON.stringify(primary.sections) === JSON.stringify(primary.toSections), 'Spanning primary response needs a separate address review');
  eligible(!primary.index_offsets_by_depth || Object.keys(primary.index_offsets_by_depth).length === 0,
    'Offset primary addressing needs a separate address review');
  eligible(!restoration.sourceIndexOffsetsByDepth || Object.keys(restoration.sourceIndexOffsetsByDepth).length === 0,
    'Offset source selection needs a separate address review');
  const selections = restoration.sourceSegmentIndices;
  eligible(Array.isArray(selections) && selections.length > 0 && selections.every(Array.isArray), 'Missing exact source unit indices');
  const baseDepth = primary.sections.length;
  const values = [], refs = [];
  for (const indices of selections) {
    eligible(indices.every(index => Number.isSafeInteger(index) && index >= 0), 'Invalid primary source unit index');
    eligible(baseDepth + indices.length === primary.addressTypes.length, 'Selection does not identify a complete terminal source unit');
    let value = primary.he;
    const address = indices.map((index, position) => {
      eligible(Array.isArray(value) && index < value.length, 'Primary source unit index is outside the response');
      value = value[index];
      const type = primary.addressTypes[baseDepth + position];
      eligible(type === 'Talmud' || INTEGER_ADDRESSES.has(type), 'Unsupported source address type');
      return type === 'Talmud' ? Math.floor(index / 2 + 1) + (index % 2 === 0 ? 'a' : 'b') : String(index + 1);
    });
    eligible(typeof value === 'string' && /[א-ת]/.test(value), 'Primary selection is not a complete Hebrew terminal unit');
    values.push(value);
    refs.push(primary.ref + (address.length ? (baseDepth ? ':' : ' ') + address.join(':') : ''));
  }
  let derivedRef = refs[0];
  if (selections.length > 1) {
    const first = selections[0];
    eligible(first.length > 0, 'A range must contain separately addressed source units');
    eligible(selections.every((indices, index) => indices.length === first.length
      && indices.slice(0, -1).every((part, depth) => part === first[depth])
      && indices.at(-1) === first.at(-1) + index), 'Source range is not an ordered contiguous sequence');
    eligible(primary.addressTypes.at(-1) !== 'Talmud', 'A folio range needs separate segment address review');
    derivedRef += '-' + String(selections.at(-1).at(-1) + 1);
  }
  eligible(canonicalRef(derivedRef) === ref, 'Selected primary address differs from the exact source reference');
  const retained = flattenStrings(restoration.sourceHebrew).join(' ');
  const he = primaryPlainText(retained);
  eligible(/[א-ת]/.test(he), 'Retained source Hebrew is empty');
  eligible(he === primaryPlainText(values.join(' ')), 'Retained Hebrew is shorter than or differs from the complete primary unit');
  return {ref, he, retained, selectedUnits: values, derivedRef};
}

function collectNotes(value, pointer = '', result = []) {
  if (Array.isArray(value)) value.forEach((item, index) => collectNotes(item, pointer + '/' + index, result));
  else if (object(value)) {
    if (object(value.provenance?.sourceQuotationRelease)) result.push({note: value, pointer});
    else for (const [key, item] of Object.entries(value)) collectNotes(item,
      pointer + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'), result);
  }
  return result;
}

export function publishedTranslation(note, restoration, release) {
  assert(note.verificationStatus === 'verified', 'Published note is not verified');
  assert(Array.isArray(note.sources) && note.sources.length === 1, 'Published note has ambiguous source attribution');
  assert(Array.isArray(note.paragraphs) && note.paragraphs.length === 1, 'Published note is not one exact source quotation');
  const source = note.sources[0], provenance = note.provenance?.sourceQuotationRelease;
  const ref = restoration.sourceSegmentRefs[0];
  assert(object(provenance) && provenance.release === release, 'Published note is from another quotation release');
  assert(source.role === 'primary-source' && source.ref === ref && provenance.sourceRef === ref,
    'Published note does not identify the exact restored primary source');
  assert(Array.isArray(provenance.sourceSegmentRefs) && provenance.sourceSegmentRefs.length === 1
    && provenance.sourceSegmentRefs[0] === ref, 'Published note has conflicting source segment evidence');
  assert(source.url === provenance.sourceURL && nonempty(source.url), 'Published source URL differs from its provenance');
  const url = new URL(source.url);
  assert(url.protocol === 'https:' && !url.username && !url.password && ['sefaria.org', 'www.sefaria.org'].includes(url.hostname)
    && engine.sourceRefFromUrl(source.url) === ref, 'Published source URL does not identify its exact Sefaria unit');
  assert(provenance.sourceSha256 === restoration.sourceSha256 && provenance.sourceLanguage === 'he', 'Published primary source proof differs');
  assert(provenance.versionTitle === restoration.versionTitle && provenance.license === restoration.license
    && provenance.method === restoration.method, 'Published translation attribution differs from its original evidence');
  const paragraph = note.paragraphs[0];
  const prefix = ref + ': “';
  assert(typeof paragraph.text === 'string' && paragraph.text.startsWith(prefix) && paragraph.text.endsWith('”'),
    'Published paragraph is not the single outer-delimited source quotation');
  if (Array.isArray(paragraph.rich)) {
    assert(paragraph.rich.map(part => part.text || '').join('') === paragraph.text, 'Published rich quotation differs from its stored English');
    assert(paragraph.rich.some(part => part.href === source.url && part.text === ref), 'Published source label link is missing');
  }
  const en = paragraph.text.slice(prefix.length, -1);
  assert(nonempty(en) && /[A-Za-z]/.test(en), 'Published source quotation has no English');
  const hash = sha(en);
  assert(HASH.test(restoration.sourceTranslationSha256) && hash === restoration.sourceTranslationSha256
    && hash === provenance.sourceTranslationSha256, 'Published English quotation checksum mismatch');
  return {en, sourceUrl: source.url, hash};
}

export function buildSourceTranslations(options = {}) {
  const partsDir = path.resolve(options.partsDir || path.join(REPO, 'sources/akiva/overlays/source-quotations-20261019.json.gz.parts'));
  const evidenceFile = path.resolve(options.evidenceFile || path.join(REPO, 'sources/akiva/overlays/source-translation-evidence-20261019.json.gz.b64'));
  const libraryRoot = path.resolve(options.libraryRoot || path.join(REPO, 'dist/library'));
  const output = path.resolve(options.output || path.join(libraryRoot, 'source-connections/translations.json'));
  assert(!within(output, partsDir) && output !== evidenceFile && !within(output, path.join(libraryRoot, 'data')),
    'Translation output must not overwrite source evidence or historical chapter data');
  const {payload, manifest} = readQuotationRelease(partsDir);
  const archive = readPrimaryArchive(evidenceFile, manifest);
  const releaseFiles = new Map(payload.files.map(file => [file.path, file]));
  assert(releaseFiles.size === payload.files.length, 'Duplicate source release file paths');
  const finalFiles = new Map(), translations = new Map(), skipped = [];
  const candidateRestorations = payload.quotationRestorations.filter(item => item.verified === true
    && item.sourceHebrew && item.sourceTranslationSha256);
  for (const restoration of candidateRestorations) {
    let primary, unit;
    try {
      eligible(Array.isArray(restoration.sourceSegmentRefs) && restoration.sourceSegmentRefs.length === 1, 'Multiple or ambiguous source references');
      eligible(restoration.sourceLanguage === 'he', 'Existing primary English translation is outside the independent Hebrew-translation index');
      eligible(/\.json$/.test(restoration.sourceCachePath || ''), 'Printed or unsupported primary cache format');
      eligible(!/^Verified only as\b/i.test(restoration.verificationScope || ''), 'Limited transmitted-quotation review');
      assert(HASH.test(restoration.sourceSha256), 'Missing original primary response checksum');
      primary = archive.sources.get(restoration.sourceSha256);
      assert(primary, 'Missing durable raw primary response for ' + restoration.sourceSegmentRefs[0]);
      assert(primary.requestUrls.includes(restoration.sourceRequestUrl), 'Primary request URL differs from retained evidence');
      unit = completePrimaryUnit(restoration, primary.document);
    } catch (error) {
      if (!(error instanceof Ineligible)) throw error;
      skipped.push({ref: restoration.sourceSegmentRefs?.join('; ') || null, path: restoration.path, reason: error.message});
      continue;
    }
    assert(/^data\/[a-z0-9_-]+(?:\/[a-z0-9_.-]+)*\.json$/.test(restoration.path)
      && !restoration.path.split('/').some(part => part === '..'), 'Unsafe published chapter path');
    const originalFile = releaseFiles.get(restoration.path);
    assert(originalFile, 'No published release postimage for ' + restoration.path);
    const originalNotes = collectNotes(originalFile).filter(({note}) =>
      note.provenance.sourceQuotationRelease.sourceTranslationSha256 === restoration.sourceTranslationSha256);
    assert(originalNotes.length, 'Original source quotation postimage is missing');
    const originalQuotes = originalNotes.map(({note}) => publishedTranslation(note, restoration, payload.release));
    if (!finalFiles.has(restoration.path)) {
      const bytes = readRegular(path.join(libraryRoot, restoration.path));
      finalFiles.set(restoration.path, {sha256: sha(bytes), notes: collectNotes(JSON.parse(bytes))});
    }
    const finalFile = finalFiles.get(restoration.path);
    const matching = finalFile.notes.filter(({note}) =>
      note.provenance.sourceQuotationRelease.sourceTranslationSha256 === restoration.sourceTranslationSha256);
    assert(matching.length, 'Final published source quotation is missing: ' + restoration.path + ' / ' + unit.ref);
    const quotes = matching.map(({note}) => publishedTranslation(note, restoration, payload.release));
    assert([...originalQuotes, ...quotes].every(quote => quote.en === quotes[0].en && quote.sourceUrl === quotes[0].sourceUrl),
      'Competing source quotations have the same restoration identity');
    const {en, sourceUrl, hash} = quotes[0];
    const publishedNotes = matching.map(({note, pointer}) => ({path: restoration.path, jsonPointer: pointer,
      placementId: note.placementId || null, sourceId: note.sourceId || null, verificationStatus: note.verificationStatus,
      translationSha256: hash, fileSha256: finalFile.sha256}));
    const previous = translations.get(unit.ref);
    if (previous) {
      assert(previous.en === en && previous.he === unit.he && previous.sourceUrl === sourceUrl
        && previous.evidence.sourceCacheSha256 === restoration.sourceSha256, 'Competing translations or primary evidence for ' + unit.ref);
      for (const note of publishedNotes) if (!previous.evidence.publishedNotes.some(item => item.path === note.path && item.jsonPointer === note.jsonPointer))
        previous.evidence.publishedNotes.push(note);
      continue;
    }
    const source = primary.document;
    translations.set(unit.ref, {ref: unit.ref, he: unit.he, en, sourceUrl, mode: 'complete-source-unit',
      provenance: 'Already-published Akiva Publishing footnote translation (' + payload.release + '). '
        + restoration.versionTitle + ' · ' + restoration.license,
      evidence: {sourceQuotationRelease: payload.release, sourceCacheSha256: restoration.sourceSha256,
        sourceRequestUrl: restoration.sourceRequestUrl, sourceCacheRef: source.ref,
        sourceSegmentIndices: restoration.sourceSegmentIndices, sourceAddressVerification: 'exact-indexed-complete-primary-unit',
        sourceVersionTitle: source.heVersionTitle || null, sourceLicense: source.heLicense || null,
        sourceVersionSource: source.heVersionSource || null, retainedSourceHebrew: unit.retained,
        sourceHebrewSha256: sha(unit.retained), displayHebrewSha256: sha(unit.he), sourceEnglishSha256: hash,
        translationVersionTitle: restoration.versionTitle, translationLicense: restoration.license,
        translationVersionSource: restoration.versionSource || null, method: restoration.method,
        verificationScope: restoration.verificationScope, originalVerifiedStatus: restoration.verified, publishedNotes}});
  }
  const records = [...translations.values()].sort((left, right) => left.ref.localeCompare(right.ref, 'en'));
  assert(records.length, 'No complete source translations passed the evidence gates');
  for (const record of records) record.evidence.publishedNotes.sort((left, right) => left.path.localeCompare(right.path, 'en')
    || left.jsonPointer.localeCompare(right.jsonPointer, 'en'));
  const catalog = {schemaVersion: 1, release: engine.VERSION, sourceQuotationRelease: payload.release,
    inputs: {sourceQuotationPayloadSha256: manifest.sha256, primaryEvidenceArchiveSha256: archive.sha256},
    counts: {translations: records.length, publishedNotes: records.reduce((total, record) => total + record.evidence.publishedNotes.length, 0),
      candidateRestorations: candidateRestorations.length, excludedRestorations: skipped.length}, translations: records};
  const bytes = Buffer.from(JSON.stringify(catalog) + '\n');
  let written = false;
  if (options.write !== false && (!fs.existsSync(output) || !readRegular(output).equals(bytes))) {
    fs.mkdirSync(path.dirname(output), {recursive: true});
    const temporary = output + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, bytes, {flag: 'wx'}); fs.renameSync(temporary, output); written = true; }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return {catalog, bytes, written, output, skipped};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.slice(2).every(argument => argument === '--check'), 'Usage: node scripts/build-source-translations.mjs [--check]');
    const result = buildSourceTranslations({write: !process.argv.includes('--check')});
    const exclusionsByReason = result.skipped.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({ok: true, release: result.catalog.release, ...result.catalog.counts,
      sha256: sha(result.bytes), written: result.written, exclusionsByReason}));
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

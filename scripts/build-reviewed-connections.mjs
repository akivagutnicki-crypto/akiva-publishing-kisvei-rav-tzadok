#!/usr/bin/env node
// Publish individually reviewed source connections from the final reader text.
// This builder never invents a connection, translates a passage, or changes the
// reader's chapters, footnotes, historical proofs, or MCP indexes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {VERSION, SCHOOLS, normalizeRef, sourceRefFromUrl, parseRef, normalizedHebrew} =
  require('../dist/library/source-connections.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIBLE = new Set(('Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|I Samuel|II Samuel|I Kings|II Kings|Isaiah|Jeremiah|Ezekiel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Psalms|Proverbs|Job|Song of Songs|Ruth|Lamentations|Ecclesiastes|Esther|Daniel|Ezra|Nehemiah|I Chronicles|II Chronicles').toLowerCase().split('|'));
const SHA = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function readRegular(filename) {
  assert(fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink(), 'Expected a regular input file: ' + filename);
  return fs.readFileSync(filename);
}

function text(value, label) {
  assert(typeof value === 'string' && value.trim(), label + ' must be a nonempty string');
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), label + ' contains control characters');
  return value.trim();
}

export function validateTranslation(value, label = 'English translation', refs = []) {
  const result = text(value, label);
  assert(/[A-Za-z]/.test(result), label + ' must contain English');
  assert(!/^(?:todo\b|tbd\b|placeholder\b|not (?:yet )?translated\b|translation (?:pending|unavailable|needed)\b|no (?:english )?translation(?: is)?(?: yet)? available\b)/i.test(result), label + ' is a placeholder');
  assert(!/^(?:translation of (?:the )?source|source translation|english translation)\s*[:—-]?\s*$/i.test(result), label + ' contains only a label');
  assert(!/^(?:context(?:ual information)?|source review|editorial note)\s*:/i.test(result), label + ' contains editorial commentary instead of the source translation');
  assert(!refs.some(ref => normalizedHebrew(result) === normalizedHebrew(ref)), label + ' contains only a citation');
  // Complete short verses and sentences are valid. A word-count threshold would
  // reject accurate brief quotations without proving the quality of long ones.
  return result;
}

function hebrew(value, label) {
  const result = text(value, label);
  assert(/[א-ת]/.test(result) && normalizedHebrew(result), label + ' must contain Hebrew');
  return result;
}

export function validateSourceRef(value) {
  const ref = normalizeRef(text(value, 'Source reference'));
  const parsed = parseRef(ref);
  assert(parsed, 'Source reference must identify an exact passage or range: ' + ref);
  assert(parsed.from.length === parsed.to.length, 'Source range has an incomplete end address: ' + ref);
  assert(!parsed.daf || parsed.depth >= 2, 'A Bavli source requires segment-level precision, not a whole daf: ' + ref);
  assert(!/\d+[ab]$/i.test(ref), 'A folio source requires its exact segment: ' + ref);
  assert(!BIBLE.has(parsed.book) || parsed.depth >= 2, 'A Biblical source requires a verse: ' + ref);
  assert(!parsed.book.startsWith('mishnah ') || parsed.depth >= 2, 'A Mishnah source requires its exact mishnah: ' + ref);
  return ref;
}

function safeSourceUrl(value, refs) {
  const href = text(value, 'Source URL');
  assert(!/[\s<>"'\\]/.test(href), 'Source URL contains unsafe characters');
  let parsed;
  if (href.startsWith('#/read/')) {
    const ref = sourceRefFromUrl(href);
    assert(ref && refs.some(source => normalizeRef(source).toLowerCase() === ref.toLowerCase()), 'Reader source URL does not identify a reviewed source reference');
    return href;
  }
  try { parsed = new URL(href); } catch { assert.fail('Source URL is invalid'); }
  assert(parsed.protocol === 'https:' && !parsed.username && !parsed.password, 'Source URL must use HTTPS without credentials');
  if (['sefaria.org', 'www.sefaria.org'].includes(parsed.hostname.toLowerCase())) {
    const ref = sourceRefFromUrl(href);
    assert(ref && refs.some(source => normalizeRef(source).toLowerCase() === ref.toLowerCase()), 'Sefaria URL does not identify the exact reviewed source reference');
  }
  return href;
}

function strings(values, label, transform = value => text(value, label)) {
  assert(Array.isArray(values) && values.length, label + ' must be a nonempty array');
  const result = values.map(transform);
  assert(new Set(result.map(value => value.toLowerCase())).size === result.length, label + ' contains duplicates');
  return result;
}

function isWithin(filename, directory) {
  const relative = path.relative(directory, filename);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function targetReader(catalog, mcpRoot) {
  const books = [...catalog.books].sort((left, right) => right.title.length - left.title.length);
  const cache = new Map();
  return (ref, quote = null, reviewedHash = null) => {
    const book = books.find(candidate => ref === candidate.title || ref.startsWith(candidate.title + ' ') || ref.startsWith(candidate.title + ','));
    assert(book, 'Target reference has no canonical library book: ' + ref);
    assert(/^[a-z0-9-]+$/.test(book.slug), 'Unexpected canonical book slug');
    if (!cache.has(book.slug)) {
      const bytes = readRegular(path.join(mcpRoot, 'text', book.slug + '.json'));
      const document = JSON.parse(bytes);
      assert(document.slug === book.slug && Array.isArray(document.paras), 'Invalid canonical text for ' + book.slug);
      cache.set(book.slug, {document, sha256: SHA(bytes)});
    }
    const {document, sha256} = cache.get(book.slug);
    const matches = [];
    let quotationFound = false;
    document.paras.forEach((paragraph, index) => {
      if (paragraph.r !== ref) return;
      const section = book.sections[paragraph.s];
      assert(section && index >= section.first && index < section.first + section.count, 'Paragraph is outside its canonical section: ' + ref);
      const content = Array.isArray(paragraph.p) ? paragraph.p.map(pair => pair[0] || '').join(' ') : paragraph.t;
      assert(typeof content === 'string' && content.trim(), 'Canonical target has no Hebrew text: ' + ref);
      const normalized = normalizedHebrew(content);
      const start = quote === null ? 0 : (' ' + normalized + ' ').indexOf(' ' + quote + ' ');
      if (start >= 0) {
        quotationFound = true;
        if (reviewedHash === null || SHA(normalized) === reviewedHash)
          matches.push({book, paragraph, paragraphIndex: index, section, content, normalized, start, textSha256: sha256});
      }
    });
    assert(matches.length || !quotationFound || reviewedHash === null, 'Reviewed target paragraph context changed or does not match the pinned edition: ' + ref);
    assert(matches.length, quote === null ? 'Target reference is not an exact canonical paragraph: ' + ref
      : 'Selected Hebrew is not an exact contiguous quote in canonical target ' + ref);
    // The interlinear and original editions may share a paragraph ref. Prefer
    // the published interlinear edition only when its exact Hebrew also matches.
    matches.sort((left, right) => Number(right.section.il) - Number(left.section.il) || left.paragraphIndex - right.paragraphIndex);
    return matches[0];
  };
}

export function buildReviewedConnections(options = {}) {
  const editorialDir = path.resolve(options.editorialDir || path.join(REPO, 'sources/akiva/connections'));
  const mcpRoot = path.resolve(options.mcpRoot || path.join(REPO, 'dist/mcp-data'));
  const output = path.resolve(options.output || path.join(REPO, 'dist/library/source-connections/catalog.json'));
  assert(!isWithin(output, editorialDir) && !isWithin(output, mcpRoot), 'Connection output must not overwrite editorial or canonical input');
  assert(!isWithin(output, path.join(REPO, 'dist/library/data')), 'Reviewed connections must stay outside the historical chapter-data inventory');
  const date = options.date || new Date().toISOString().slice(0, 10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date).toISOString().slice(0, 10) === date, 'Publication date must be YYYY-MM-DD');
  const catalogBytes = readRegular(path.join(mcpRoot, 'catalog.json'));
  const catalog = JSON.parse(catalogBytes);
  assert(Array.isArray(catalog.books) && catalog.books.length && typeof catalog.version === 'string', 'Build the final MCP catalog before reviewed connections');
  const getTarget = targetReader(catalog, mcpRoot);
  assert(fs.lstatSync(editorialDir).isDirectory() && !fs.lstatSync(editorialDir).isSymbolicLink(), 'Expected a regular editorial directory');
  const filenames = fs.readdirSync(editorialDir).filter(name => name.endsWith('.json')).sort();
  assert(filenames.length, 'No reviewed connection files are staged');
  const ids = new Set(), pairs = new Set(), records = [], editorialFiles = [];
  for (const filename of filenames) {
    const bytes = readRegular(path.join(editorialDir, filename));
    const document = JSON.parse(bytes);
    assert(document.schemaVersion === 1 && Array.isArray(document.records), 'Unknown editorial schema: ' + filename);
    editorialFiles.push({path: filename, sha256: SHA(bytes)});
    for (const input of document.records) {
      const recordLabel = filename + ': ' + (input?.id || '(missing id)');
      try {
        assert(plainObject(input), 'A record must be an object');
        const id = text(input.id, 'Connection id');
        assert(/^[a-z0-9][a-z0-9._-]*$/.test(id), 'Connection id must be a stable lowercase identifier');
        assert(!ids.has(id), 'Duplicate connection id: ' + id);
        assert(input.reviewed === true, 'Only individually reviewed records may be published');
        assert(SCHOOLS.includes(input.school), 'Unknown school');
        const sourceRefs = strings(input.sourceRefs, 'Source references', validateSourceRef);
        const targetRef = text(input.targetRef, 'Target reference');
        assert(normalizeRef(targetRef) === targetRef, 'Target reference must use its exact canonical spelling');
        const sourceHebrew = hebrew(input.sourceHebrew, 'Source Hebrew');
        const targetHebrew = hebrew(input.targetHebrew, 'Target Hebrew');
        const sourceEnglish = validateTranslation(input.sourceEnglish, 'Source English', sourceRefs);
        const targetEnglish = validateTranslation(input.targetEnglish, 'Target English', [targetRef]);
        const explanation = text(input.explanation, 'Relevance explanation');
        assert(/[A-Za-z]/.test(explanation), 'Relevance explanation must be in English');
        assert(!/^(?:also draws on .+|also uses the Biblical word .+|both passages (?:quote|cite|share) (?:the )?(?:same )?(?:source|word)[.!]?)$/i.test(explanation), 'A shared source or word alone is not a relevance explanation');
        const focusTerms = strings(input.focusTerms, 'Context focus terms');
        assert(focusTerms.some(term => normalizedHebrew(term).length >= 3), 'Context terms cannot be empty or punctuation-only');
        const translationProvenance = text(input.translationProvenance, 'Translation provenance');
        const sourceUrl = safeSourceUrl(input.sourceUrl, sourceRefs);
        const quote = normalizedHebrew(targetHebrew);
        const reviewedTargetHebrewSha256 = text(input.reviewedTargetHebrewSha256, 'Reviewed target Hebrew SHA-256');
        assert(/^[a-f0-9]{64}$/.test(reviewedTargetHebrewSha256), 'Reviewed target Hebrew SHA-256 must pin the full normalized paragraph');
        const matched = getTarget(targetRef, quote, reviewedTargetHebrewSha256);
        assert(['Izhbitz', "R' Tzadok HaKohen", 'Rav Tzadok HaKohen'].includes(matched.book.group), 'Canonical target is outside the two reviewed schools');
        const school = matched.book.group === 'Izhbitz' ? 'Ishbitz–Radzin' : 'Kisvei Rav Tzadok';
        assert(input.school === school, 'School disagrees with the canonical target book');
        const originRefs = own(input, 'originRefs') ? strings(input.originRefs, 'Reviewed origin references', ref => {
          const exact = text(ref, 'Reviewed origin reference');
          assert(normalizeRef(exact) === exact, 'Reviewed origin reference must be canonical');
          getTarget(exact);
          assert(exact !== targetRef, 'A connection cannot explain its own origin');
          return exact;
        }) : undefined;
        for (const sourceRef of sourceRefs) {
          const key = normalizeRef(sourceRef).toLowerCase() + '\0' + targetRef.toLowerCase();
          assert(!pairs.has(key), 'Duplicate source-to-target connection: ' + sourceRef + ' → ' + targetRef);
          pairs.add(key);
        }
        const record = {id, sourceRefs, sourceHebrew, sourceEnglish, sourceUrl, targetRef, targetHebrew, targetEnglish,
          school, explanation, focusTerms, ...(originRefs ? {originRefs} : {}), translationProvenance,
          reviewedTargetHebrewSha256, reviewed: true,
          evidence: {editorialFile: filename, editorialFileSha256: SHA(bytes), canonicalBook: matched.book.slug,
            canonicalTextSha256: matched.textSha256, canonicalParagraphRef: matched.paragraph.r,
            canonicalParagraphIndex: matched.paragraphIndex, canonicalSectionRef: matched.section.ref,
            canonicalEdition: matched.section.il ? 'interlinear' : 'hebrew',
            canonicalParagraphSha256: SHA(canonical(matched.paragraph)),
            canonicalHebrewSha256: SHA(matched.content), normalizedCanonicalHebrewSha256: SHA(matched.normalized),
            selectedHebrewSha256: SHA(targetHebrew), normalizedSelectedHebrewSha256: SHA(quote),
            normalizedQuoteStart: matched.start, normalizedQuoteEnd: matched.start + quote.length,
            sourceHebrewSha256: SHA(sourceHebrew), sourceEnglishSha256: SHA(sourceEnglish), targetEnglishSha256: SHA(targetEnglish),
            targetQuoteVerification: 'exact-contiguous-canonical-hebrew',
            relevanceVerification: 'individual-editorial-review', translationVerification: 'individual-editorial-review'}};
        records.push(record);
        ids.add(id);
      } catch (error) {
        throw new Error(recordLabel + ': ' + error.message, {cause: error});
      }
    }
  }
  assert(records.length, 'The reviewed connection catalog cannot be empty');
  records.sort((left, right) => left.id.localeCompare(right.id));
  const uniqueSources = new Set(records.flatMap(record => record.sourceRefs));
  const provenance = {editorialFiles, mcpCatalogSha256: SHA(catalogBytes), mcpDataVersion: catalog.version,
    method: 'individually-reviewed-records-with-exact-canonical-target-quotations'};
  const counts = {records: records.length, sources: uniqueSources.size, targets: new Set(records.map(record => record.targetRef)).size,
    schools: Object.fromEntries(SCHOOLS.map(school => [school, records.filter(record => record.school === school).length]))};
  const contentSha256 = SHA(canonical({release: VERSION, counts, provenance, records}));
  const result = {schemaVersion: 1, release: VERSION, version: VERSION + '-' + contentSha256.slice(0, 16), date,
    contentSha256, counts, schools: SCHOOLS, provenance, records};
  const contents = JSON.stringify(result, null, 2) + '\n';
  let written = false;
  if (options.write !== false) {
    if (fs.existsSync(output)) assert(fs.lstatSync(output).isFile() && !fs.lstatSync(output).isSymbolicLink(), 'Connection output must be a regular file');
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== contents) {
      fs.mkdirSync(path.dirname(output), {recursive: true});
      const staged = path.join(path.dirname(output), '.reviewed-connections-' + randomUUID() + '.tmp');
      try { fs.writeFileSync(staged, contents, {flag: 'wx'}); fs.renameSync(staged, output); }
      finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
      written = true;
    }
  }
  return {catalog: result, output, written, bytes: Buffer.byteLength(contents)};
}

function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--check') { options.write = false; continue; }
    const field = {'--editorial-dir': 'editorialDir', '--mcp-root': 'mcpRoot', '--output': 'output', '--date': 'date'}[flag];
    assert(field && args[index + 1] && !args[index + 1].startsWith('--'), 'Unknown or incomplete option: ' + flag);
    options[field] = args[++index];
  }
  const result = buildReviewedConnections(options);
  console.log(JSON.stringify({ok: true, release: result.catalog.release, version: result.catalog.version,
    counts: result.catalog.counts, bytes: result.bytes, output: result.output, written: result.written}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error('Reviewed source connections failed: ' + error.message); process.exitCode = 1; }
}

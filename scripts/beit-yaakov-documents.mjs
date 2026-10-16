// Append the supplied Beit Yaakov documents without rebuilding earlier parashiyot.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const BOOK = 'Beit Yaakov on Torah';
const PACK = 'sources/akiva/overlays/beit-yaakov-vayera-chayei.json.gz.b64';
const PACK_SHA256 = '4267bbcb19e1014a312f421f7b06b18f24f83277caaf5b0169b53b286fe825f5';
const CACHE = '.cache/beit-yaakov-documents';
const ORIGINAL_SECTIONS = 183;
const EXPECTED_PARAGRAPHS = 397;
const EXPECTED_PAIRS = 4669;
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
const EXPECTED_KEYS = [
  ...[...range(1, 21), ...range(27, 63)].map(n => `Vayera ${n}`),
  ...range(1, 40).map(n => `Chayei Sara ${n}`),
];
const ORIGINAL_KEYS = [
  ...range(1, 77).map(n => `Bereshit ${n}`),
  ...range(1, 55).map(n => `Noach ${n}`),
  ...[...range(1, 24), ...range(31, 57)].map(n => `Lech Lecha ${n}`),
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error('Beit Yaakov document import: ' + message); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function decodeBase64(value, label) {
  if (typeof value !== 'string') fail('Missing base64 data for ' + label);
  const encoded = value.replace(/\s/g, '');
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    fail('Invalid base64 data for ' + label);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) fail('Noncanonical base64 data for ' + label);
  return bytes;
}

function decodeDocument(document) {
  if (!document || !/^downloads\/[a-z0-9-]+\.docx$/.test(document.file || ''))
    fail('Invalid DOCX download path');
  if (!nonempty(document.label)) fail('Missing DOCX label: ' + document.file);
  if (!/^[a-f0-9]{64}$/i.test(document.sha256 || ''))
    fail('Missing DOCX SHA-256: ' + document.file);
  const bytes = decodeBase64(document.base64, document.file);
  if (sha256(bytes) !== document.sha256.toLowerCase())
    fail('DOCX SHA-256 mismatch: ' + document.file);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4)
    fail('DOCX is not a ZIP document: ' + document.file);
  return { document, bytes };
}

function loadValidatedPack() {
  if (!fs.existsSync(PACK)) fail('Source package missing: ' + PACK);
  const compressed = decodeBase64(fs.readFileSync(PACK, 'utf8'), PACK);
  const bytes = gunzipSync(compressed);
  if (sha256(bytes) !== PACK_SHA256) fail('Source package SHA-256 mismatch');
  const pack = JSON.parse(bytes.toString('utf8'));
  if (pack?.book !== BOOK || pack.schemaVersion !== 1)
    fail('Unsupported source package book or schema');
  if (!Array.isArray(pack.sections) || pack.sections.length !== EXPECTED_KEYS.length)
    fail('Expected all 98 supplied sections');
  if (!Array.isArray(pack.documents) || pack.documents.length !== 2)
    fail('Expected both original DOCX documents');

  const keys = new Set();
  let paragraphs = 0, pairs = 0;
  for (const [index, section] of pack.sections.entries()) {
    if (!section || typeof section.key !== 'string' || keys.has(section.key))
      fail('Duplicate or missing section key: ' + section?.key);
    keys.add(section.key);
    if (section.key !== EXPECTED_KEYS[index])
      fail('Unexpected section range or order: ' + section.key);
    if (!nonempty(section.en) || !nonempty(section.he) || !Array.isArray(section.items))
      fail('Missing section labels or items: ' + section.key);
    const paragraphNumbers = new Set();
    let sectionParagraphs = 0;
    for (const item of section.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        fail('Invalid item in ' + section.key);
      if (!Object.hasOwn(item, 'p')) continue;
      sectionParagraphs++;
      if (!Number.isInteger(item.n) || item.n < 1 || paragraphNumbers.has(item.n))
        fail('Duplicate or invalid paragraph n in ' + section.key);
      paragraphNumbers.add(item.n);
      if (item.n !== sectionParagraphs)
        fail('Nonsequential paragraph n in ' + section.key);
      if (!Array.isArray(item.p) || !item.p.length)
        fail('Empty paragraph in ' + section.key + ':' + item.n);
      for (const pair of item.p) {
        if (!Array.isArray(pair) || pair.length !== 2 || !nonempty(pair[0]) || !nonempty(pair[1]) ||
            !/[א-ת]/.test(pair[0]) || !/[A-Za-z]/.test(pair[1]))
          fail('Invalid Hebrew-English phrase in ' + section.key + ':' + item.n);
        pairs++;
      }
      if (item.inlineHeadings !== undefined) {
        if (!Array.isArray(item.inlineHeadings) || item.inlineHeadings.some(heading =>
          !Number.isInteger(heading?.phraseIndex) || heading.phraseIndex < 0 ||
          heading.phraseIndex >= item.p.length || !nonempty(heading.text)))
          fail('Invalid inline heading in ' + section.key + ':' + item.n);
      }
      if (item.connections !== undefined) {
        if (!Array.isArray(item.connections) || item.connections.some(connection =>
          !nonempty(connection?.ref) || !nonempty(connection.label) ||
          !/^https:\/\/(?:www\.)?sefaria\.org\/[^\s]+$/.test(connection.url || '')))
          fail('Invalid supplied connection in ' + section.key + ':' + item.n);
      }
      paragraphs++;
    }
    if (!sectionParagraphs) fail('Section has no paragraphs: ' + section.key);
  }
  if (paragraphs !== EXPECTED_PARAGRAPHS || pairs !== EXPECTED_PAIRS)
    fail(`Expected 397 paragraphs / 4669 pairs; found ${paragraphs} / ${pairs}`);
  const documents = pack.documents.map(decodeDocument);
  if (new Set(documents.map(({ document }) => document.file)).size !== documents.length)
    fail('Duplicate DOCX download path');
  return { pack, documents };
}

// Read-only accessor for publication checks; each call returns independent data.
export function readBeitYaakovDocuments() {
  return loadValidatedPack().pack;
}

export function addBeitYaakovDocuments(src) {
  if (src?.title !== BOOK) return src;
  if (!src.interlinear || !Array.isArray(src.sections)) fail('Existing source is not interlinear');
  const { pack, documents } = loadValidatedPack();
  const existingKeys = new Set(src.sections.map(section => section.key));
  for (const section of pack.sections) {
    if (existingKeys.has(section.key)) fail('Section collision: ' + section.key);
  }
  if (src.sections.length !== ORIGINAL_SECTIONS ||
      src.sections.some((section, i) => section.key !== ORIGINAL_KEYS[i]))
    fail('Existing 183-section Bereishit / Noach / Lech Lecha source changed');
  if (src.downloads !== undefined && !Array.isArray(src.downloads))
    fail('Existing downloads metadata is invalid');
  const existingFiles = new Set((src.downloads || []).map(document => document.file));
  for (const { document } of documents) {
    if (existingFiles.has(document.file)) fail('Download collision: ' + document.file);
  }

  const additions = structuredClone(pack.sections);
  for (const section of additions) {
    section.sep = ':';
    for (const item of section.items) if (item.p) item.keepPairs = true;
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const downloads = documents.map(({ document, bytes }) => {
    const source = path.join(CACHE, path.basename(document.file));
    if (!fs.existsSync(source) || sha256(fs.readFileSync(source)) !== document.sha256.toLowerCase()) {
      const temporary = source + '.tmp-' + process.pid;
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, source);
    }
    return { source, file: document.file, label: document.label };
  });
  // The earlier section array and every object it contains remain untouched.
  src.sections = [...src.sections, ...additions];
  src.downloads = [...(src.downloads || []), ...downloads];
  return src;
}

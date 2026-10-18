#!/usr/bin/env node
/**
 * Remove the specifically named appended footnote blocks, with an explicit
 * owner whitelist. This program is deliberately not a recursive text replacer.
 *
 * Preview: node scripts/strip-appended-parallels.mjs --root dist/library
 * Apply:   node scripts/strip-appended-parallels.mjs --root dist/library \
 *            --write --report dist/library/parallel-cleanup-report.json
 *
 * Unchanged files are never serialized or written. A complete, validated plan
 * is prepared before --write changes anything. No source attachments, citations
 * cache, generic parallels index, provenance, or reader functionality is edited.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export const TARGET_BOOKS = [
  ['Sefer_HaZikhronot', 'sefer-hazikhronot'],
  ['Tzidkat_HaTzadik', 'tzidkat-hatzadik'],
  ['Peri_Tzadik', 'peri-tzadik'],
  ['Machshavot_Charutz', 'machshavot-charutz'],
  ['Divrei_Soferim', 'divrei-soferim'],
  ['Yisrael_Kedoshim', 'yisrael-kedoshim'],
  ['Likkutei_Maamarim', 'likkutei-maamarim'],
  ['Sichat_Malakhei_HaSharet', 'sichat-malakhei-hasharet'],
  ['Sichat_Shedim', 'sichat-shedim'],
  ['Divrei_Chalomot', 'divrei-chalomot'],
  ['Et_HaOchel', 'et-haochel'],
  ['Ohr_Zarua_LaTzadik', 'ohr-zarua-latzadik'],
  ['Kometz_HaMinchah', 'kometz-haminchah'],
  ['Meshiv_HaTa_anah', 'meshiv-hata-anah'],
  ['Meshiv_Tzedek', 'meshiv-tzedek'],
  ['Poked_Akarim', 'poked-akarim'],
].map(([id, slug]) => Object.freeze({ id, slug }));
export const PROTECTED_BOOKS = [
  { id: 'Takanat_HaShavin', slug: 'takanat-hashavin' },
  { id: 'Dover_Tzedek', slug: 'dover-tzedek' },
  { id: 'Resisei_Layla', slug: 'resisei-layla' },
];
export const PROTECTED_PERI_FILES = new Set(['6.json', '106.json', '111.json', '112.json']);
const CHAPTER_FILE = /^\d+(?:-\d+)*\.json$/;
const ROLES = { rav: 'parallel-rav-tzadok', ishbitz: 'parallel-ishbitz-radzin' };
const LABELS = {
  rav: /^Kisvei\s+Rav\s+Tzadok\s+Parallel\b\s*(?:[—–-]\s*)?/i,
  ishbitz: /^Kisvei\s+(?:Beis|Beit)\s+Ishbitz[\s—–-]+Radzin\s+Parallel\b\s*(?:[—–-]\s*)?/i,
};
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const digest = (x) => crypto.createHash('sha256').update(x).digest('hex');
const objectDigest = (x) => digest(JSON.stringify(x));
const relative = (root, filename) => path.relative(root, filename).split(path.sep).join('/');

function plain(text) {
  return String(text).replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|apos);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const names = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (names[entity.toLowerCase()]) return names[entity.toLowerCase()];
    const value = entity.slice(2, -1);
    const code = /^x/i.test(value) ? parseInt(value.slice(1), 16) : parseInt(value, 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }).replace(/[\u200e\u200f\ufeff]/g, '').trim().replace(/^(?:\*\*|__)/, '').replace(/[\s\u00a0]+/g, ' ');
}

// Used only to compare identifiers and references, never to alter stored text.
function refKey(ref) {
  return plain(ref).normalize('NFKD').replace(/[\u0591-\u05c7\u0300-\u036f]/g, '')
    .replace(/\s*\((?:§|paragraph\b)[^)]*\)/gi, '')
    .replace(/\s*\[(?:paragraph\b)[^\]]*\]/gi, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function isProtectedPeriSection({ file, refs = [] } = {}) {
  if (file && PROTECTED_PERI_FILES.has(path.basename(file))) return true;
  return refs.some((ref) => {
    const key = refKey(ref);
    return /^(?:peri|pri) tzadd?ik noa(?:ch|h) (?:5|6|v|vi|heh|hei|vav)(?: \d+(?: \d+)*)?$/.test(key)
      || /^(?:peri|pri) tzadd?ik rosh (?:chodesh|hodesh) (?:mar ?)?cheshv[ao]n(?: \d+(?: \d+)*)?$/.test(key)
      || /^פרי צדיק נח (?:אות )?[הו](?: \d+)*$/.test(key)
      || /^פרי צדיק (?:ראש חודש|ר ח) (?:מר ?חשוו?ן|חשוו?ן)(?: \d+)*$/.test(key);
  });
}

function labelKind(text) {
  const value = plain(text);
  for (const [kind, regex] of Object.entries(LABELS)) if (regex.test(value)) return kind;
  if (/^Sources:\s*.*\bParallels:\s*/i.test(value)
    || /^Sources\s*\|\s*Parallels\s*[:—–-]/i.test(value)) return 'summary';
  return null;
}

function inspectParagraph(paragraph) {
  const representations = [];
  let unknown = false;
  if (typeof paragraph === 'string') representations.push(paragraph);
  else if (object(paragraph)) {
    if (own(paragraph, 'text')) {
      if (typeof paragraph.text === 'string') representations.push(paragraph.text);
      else unknown = true;
    }
    if (own(paragraph, 'rich')) {
      if (typeof paragraph.rich === 'string') representations.push(paragraph.rich);
      else if (Array.isArray(paragraph.rich) && paragraph.rich.every((run) => object(run) && typeof run.text === 'string'))
        representations.push(paragraph.rich.map((run) => run.text).join(''));
      else unknown = true;
    }
    if (!representations.length) unknown = true;
  } else unknown = true;
  const nonempty = representations.map(plain).filter(Boolean);
  const kinds = new Set(nonempty.map(labelKind));
  if (kinds.size > 1 && [...kinds].some(Boolean))
    throw Error('Ambiguous footnote paragraph: text and rich representations disagree about an appended heading');
  return { text: nonempty[0] || '', kind: kinds.values().next().value || null, unknown };
}

function paragraphLinks(paragraph) {
  if (!object(paragraph)) return [];
  return [
    ...(Array.isArray(paragraph.rich) ? paragraph.rich : []),
    ...(Array.isArray(paragraph.links) ? paragraph.links : []),
  ].filter(object);
}

function sourceMatchesParagraph(source, paragraph, inspected, kind) {
  if (typeof source.ref !== 'string' || !source.ref.trim()) return false;
  const sourceKey = refKey(source.ref);
  const header = refKey(inspected.text.replace(LABELS[kind], ''));
  if (header === sourceKey || header.startsWith(`${sourceKey} `)) return true;
  // Structured runs sometimes carry a more exact ref than the visible header.
  return paragraphLinks(paragraph).some((run) => {
    const label = run.label ?? run.text;
    return typeof label === 'string' && refKey(label) === sourceKey;
  });
}

/** Pure transformation. Only paragraphs[] and associated sources[] can change. */
export function cleanFootnote(note) {
  if (!object(note)) throw Error('Unknown footnote shape: expected an object');
  if (!Array.isArray(note.paragraphs)) {
    if (/Kisvei\s+(?:Rav\s+Tzadok|(?:Beis|Beit)\s+Ishbitz)/i.test(JSON.stringify(note)))
      throw Error('Unknown candidate footnote shape: expected paragraphs[]');
    return { note, change: null };
  }
  const inspected = note.paragraphs.map(inspectParagraph);
  // A standalone parallel note is original content, not an appended block.
  if (inspected[0]?.kind) return { note, change: null };
  const blocks = inspected.flatMap((p, index) => index > 0 && (p.kind === 'rav' || p.kind === 'ishbitz') ? [index] : []);
  if (!blocks.length) return { note, change: null };
  if (inspected.some((p) => p.unknown)) throw Error('Unknown paragraph shape in a candidate footnote');
  if (!inspected[0]?.text) throw Error('Candidate footnote has no nonempty first source paragraph');
  const firstBlock = Math.min(...blocks);
  const remove = new Set([...blocks, ...inspected.flatMap((p, index) => p.kind === 'summary' && index > firstBlock ? [index] : [])]);
  const remaining = note.paragraphs.filter((_, index) => !remove.has(index));
  const removedSources = [];
  let sources = note.sources;
  if (own(note, 'sources')) {
    if (!Array.isArray(sources) || !sources.every(object))
      throw Error('Unknown sources shape in a candidate footnote');
    sources = sources.filter((source, index) => {
      const kind = Object.keys(ROLES).find((key) => ROLES[key] === source.role);
      if (!kind) return true;
      const associated = blocks.some((i) => inspected[i].kind === kind
        && sourceMatchesParagraph(source, note.paragraphs[i], inspected[i], kind));
      if (!associated) return true;
      // Keep an entry still used by a separately curated appended paragraph.
      const independentlyUsed = inspected.some((p, i) => i > 0 && !remove.has(i)
        && /^(?:Additional\s+)?Kisvei\s+/i.test(p.text)
        && paragraphLinks(note.paragraphs[i]).some((run) => refKey(run.label ?? run.text ?? '') === refKey(source.ref)));
      if (independentlyUsed) return true;
      removedSources.push({ index, role: source.role, ref: source.ref });
      return false;
    });
  }
  const cleaned = { ...note, paragraphs: remaining };
  if (own(note, 'sources') && removedSources.length) cleaned.sources = sources;
  const change = {
    paragraphCountBefore: note.paragraphs.length,
    paragraphCountAfter: remaining.length,
    removedParagraphs: [...remove].sort((a, b) => a - b).map((index) => ({
      index, kind: inspected[index].kind,
      textSha256: objectDigest(note.paragraphs[index]),
      heading: inspected[index].text.slice(0, 180),
    })),
    removedSources,
  };
  assert.deepEqual(cleaned.paragraphs[0], note.paragraphs[0], 'First paragraph changed');
  const metadata = ({ paragraphs, sources, ...rest }) => rest;
  assert.deepEqual(metadata(cleaned), metadata(note), 'Footnote metadata changed');
  return { note: cleaned, change };
}

function fingerprintItems(items) {
  const notes = [];
  function body(value) {
    if (Array.isArray(value)) return value.map(body);
    if (!object(value)) return value;
    if (!own(value, 'footnotes')) return value;
    if (!Array.isArray(value.footnotes)) throw Error('Unknown item footnotes shape');
    notes.push(...value.footnotes);
    const { footnotes, ...rest } = value;
    return rest;
  }
  const bodyHash = objectDigest(body(items));
  return {
    bodySha256: bodyHash, notes: notes.length,
    metadataSha256: objectDigest(notes.map(({ paragraphs, sources, ...rest }) => rest)),
    firstParagraphsSha256: objectDigest(notes.map((note) => note.paragraphs?.[0] ?? null)),
  };
}

function equalFingerprints(before, after) {
  assert.equal(after.bodySha256, before.bodySha256, 'Body text/structure changed');
  assert.equal(after.notes, before.notes, 'Footnote count changed');
  assert.equal(after.metadataSha256, before.metadataSha256, 'Footnote identities, placement or metadata changed');
  assert.equal(after.firstParagraphsSha256, before.firstParagraphsSha256, 'First source paragraphs changed');
}

function readJson(filename) {
  const raw = fs.readFileSync(filename, 'utf8');
  try { return { raw, value: JSON.parse(raw) }; }
  catch (error) { throw Error(`Invalid JSON in ${filename}: ${error.message}`); }
}

function chapterMap(toc) {
  const byFile = new Map();
  function walk(node) {
    if (!object(node)) throw Error('Unknown TOC node shape');
    const file = typeof node.file === 'string' && CHAPTER_FILE.test(node.file) ? node.file
      : (typeof node.id === 'number' || typeof node.id === 'string') && CHAPTER_FILE.test(`${node.id}.json`) ? `${node.id}.json` : null;
    if (file) {
      const entry = byFile.get(file) || { file, refs: [], separators: {} };
      for (const key of ['ref', 'heRef']) if (typeof node[key] === 'string' && !entry.refs.includes(node[key])) entry.refs.push(node[key]);
      if (typeof node.ref === 'string') entry.separators[node.ref] = typeof node.sep === 'string' ? node.sep : ':';
      byFile.set(file, entry);
    }
    // Sefaria-schema volumes store a depth-two leaf as id-chapter.json; the
    // root ref alone is not the owner of any of those chapter files.
    if (Number(node.depth) >= 2 && Array.isArray(node.shape) && (typeof node.id === 'number' || typeof node.id === 'string')) {
      for (let index = 0; index < node.shape.length; index++) {
        const chapterFile = `${node.id}-${index + 1}.json`;
        if (!CHAPTER_FILE.test(chapterFile)) throw Error('Unknown nested TOC file identifier');
        const entry = byFile.get(chapterFile) || { file: chapterFile, refs: [], separators: {} };
        for (const key of ['ref', 'heRef']) if (typeof node[key] === 'string') {
          const chapterRef = `${node[key]} ${index + 1}`;
          if (!entry.refs.includes(chapterRef)) entry.refs.push(chapterRef);
          entry.separators[chapterRef] = ':';
        }
        byFile.set(chapterFile, entry);
      }
    }
    if (own(node, 'children')) {
      if (!Array.isArray(node.children)) throw Error('Unknown TOC children shape');
      node.children.forEach(walk);
    }
  }
  if (!object(toc) || !object(toc.toc)) throw Error('Unknown TOC shape: expected toc tree');
  walk(toc.toc);
  return byFile;
}

function explicitParagraphRefs(paragraph) {
  const refs = [];
  const links = paragraphLinks(paragraph);
  const html = typeof paragraph === 'string' ? [paragraph]
    : object(paragraph) ? [paragraph.text, paragraph.rich].filter((value) => typeof value === 'string') : [];
  for (const text of html) for (const match of text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const link = { text: plain(match[2]) };
    for (const attribute of match[1].matchAll(/\b(href|data-ref)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))
      link[attribute[1].toLowerCase() === 'data-ref' ? 'ref' : 'href'] = plain(attribute[2] ?? attribute[3] ?? attribute[4]);
    links.push(link);
  }
  for (const link of links) {
    if (!['href', 'url', 'ref', 'label'].some((key) => typeof link[key] === 'string')) continue;
    for (const key of ['ref', 'label', 'text']) if (typeof link[key] === 'string' && link[key].trim()) refs.push(link[key]);
    const href = link.href ?? link.url;
    if (typeof href !== 'string') continue;
    try {
      const url = new URL(href);
      if (!['sefaria.org', 'www.sefaria.org', 'sefaria.org.il', 'www.sefaria.org.il'].includes(url.hostname.toLowerCase())) continue;
      const ref = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (ref && !/^(?:api|texts|topics|sheets|collections|profile)(?:\/|$)/i.test(ref)) refs.push(ref);
    } catch { /* An unreadable URL does not establish a source identity. */ }
  }
  return refs;
}

function retainedReferences(note) {
  const refs = [
    ...(Array.isArray(note.sources) ? note.sources.filter(object).map((source) => source.ref) : []),
    ...(Array.isArray(note.paragraphs) ? note.paragraphs.flatMap(explicitParagraphRefs) : []),
  ];
  return [...new Set(refs.filter((ref) => typeof ref === 'string' && ref.trim()))].map((ref) => ({ ref }));
}

function addEvidence(evidence, owner, itemNumber, note, sources) {
  if (!['number', 'string'].includes(typeof itemNumber)) throw Error('Unknown item number in an affected note');
  const numbers = new Set([itemNumber]);
  const provenance = note.provenance;
  if (object(provenance)) {
    const sameFile = [provenance.sourceFile, provenance.sectionFile].some((file) => typeof file === 'string' && path.basename(file) === owner.file);
    const sameOwner = [provenance.section, provenance.sectionRef].some((ref) => typeof ref === 'string' && owner.refs.some((ownRef) => refKey(ownRef) === refKey(ref)));
    // Earlier importers counted heading rows in their link anchors. Accept a
    // historical item number only when its exact file AND section owner agree;
    // citation mentions can never supply or protect an owner.
    if (sameFile && sameOwner && /^\d+$/.test(String(provenance.item)) && Number(provenance.item) > 0)
      numbers.add(provenance.item);
  }
  for (const sectionRef of owner.refs) {
    const anchors = [...numbers].map((number) => `${sectionRef}${owner.separators?.[sectionRef] ?? ':'}${number}`);
    for (const source of sources) {
      // Some original importers indexed a whole siman as their anchor, while
      // others indexed the paragraph. Both must still belong to this exact
      // TOC owner, and both must cite a removed source in that owner's note.
      for (const anchorRef of [...anchors, sectionRef]) {
        const key = [refKey(sectionRef), refKey(anchorRef), refKey(source.ref)].join('|');
        const entry = evidence.get(key) || { ids: new Set(), unidentified: false };
        const ids = [note.sourceId, note.placementId, note.id].filter((id) => typeof id === 'string');
        if (!ids.length) entry.unidentified = true;
        ids.forEach((id) => entry.ids.add(id));
        evidence.set(key, entry);
      }
    }
  }
}

function transformItems(items, owner, evidence, retainedEvidence) {
  if (!Array.isArray(items)) throw Error('Unknown reader section shape: expected items array');
  const changes = [];
  function transform(item, itemIndex, indices, itemNumber) {
    if (Array.isArray(item)) return transformArray(item, [...indices, itemIndex]);
    if (!object(item) || !own(item, 'footnotes')) return item;
    if (!Array.isArray(item.footnotes)) throw Error('Unknown item footnotes shape');
    let changed = false;
    const footnotes = item.footnotes.map((note, noteIndex) => {
      const result = cleanFootnote(note);
      if (retainedEvidence) addEvidence(retainedEvidence, owner, itemNumber, result.note, retainedReferences(result.note));
      if (!result.change) return note;
      assert.equal(cleanFootnote(result.note).change, null, 'Footnote cleanup is not idempotent');
      changed = true;
      changes.push({
        sectionFile: owner.file, sectionRefs: owner.refs,
        itemIndex: indices.length ? [...indices, itemIndex] : itemIndex,
        itemNumber, noteIndex,
        number: note.number ?? null, sourceId: note.sourceId ?? null, placementId: note.placementId ?? null,
        ...result.change,
      });
      if (evidence) addEvidence(evidence, owner, itemNumber, note, result.change.removedSources);
      return result.note;
    });
    return changed ? { ...item, footnotes } : item;
  }
  function transformArray(array, indices = []) {
    let paragraphNumber = 0;
    return array.map((item, index) => {
      if (object(item) && Array.isArray(item.p)) paragraphNumber++;
      // The reader numbers bilingual paragraphs, excluding h/heading records.
      // This is the same counting convention as build-library.mjs/connect().
      const itemNumber = object(item) ? item.n || paragraphNumber || index + 1 : index + 1;
      return transform(item, index, indices, itemNumber);
    });
  }
  return { items: transformArray(items), changes };
}

function transformLinks(links, evidence, retainedEvidence, protectedRefs) {
  if (!object(links)) throw Error('Unknown links.json shape: expected ref-to-array map');
  const changes = [];
  const retainedSharedLinks = [];
  const result = { ...links };
  for (const [sectionRef, rows] of Object.entries(links)) {
    if (!Array.isArray(rows)) throw Error('Unknown links.json entry shape');
    if (protectedRefs.has(refKey(sectionRef)) || isProtectedPeriSection({ refs: [sectionRef] })) continue;
    const removedLinks = [];
    const kept = rows.filter((link, index) => {
      if (!object(link)) throw Error('Unknown link shape');
      if (link.c !== 'Parallel Sources' || typeof link.a !== 'string' || typeof link.r !== 'string') return true;
      const key = [refKey(sectionRef), refKey(link.a), refKey(link.r)].join('|');
      const removedSupport = evidence.get(key);
      if (!removedSupport) return true;
      const identities = [link.sourceId, link.placementId, link.noteId].filter((id) => typeof id === 'string');
      const explicitNote = identities.length > 0 && identities.every((id) => removedSupport.ids.has(id));
      // An explicitly named different note is stronger evidence than a generic
      // generated category, and must never be swept into this note's cleanup.
      if (identities.length && !explicitNote) return true;
      // Independently curated relations are outside the generated appendices.
      const generated = /^(?:Direct conceptual parallel|Supplied parallel)(?:$| · (?:Rav Tzadok|Ishbitz[–—-]Radzin)$)/.test(link.kind ?? '');
      if (!generated && !explicitNote) return true;
      const retainedSupport = retainedEvidence.get(key);
      if (retainedSupport) {
        const uniquelyRemovedNote = explicitNote && !retainedSupport.unidentified
          && identities.every((id) => !retainedSupport.ids.has(id));
        if (!uniquelyRemovedNote) {
          retainedSharedLinks.push({ sectionRef, index, a: link.a, r: link.r, c: link.c,
            removedNoteIds: [...removedSupport.ids], retainedNoteIds: [...retainedSupport.ids],
            reason: 'The relation is also supported by a retained footnote source or explicit paragraph link.' });
          return true;
        }
      }
      removedLinks.push({ index, ...link });
      return false;
    });
    if (removedLinks.length) {
      result[sectionRef] = kept;
      changes.push({ sectionRef, removedLinks });
    }
  }
  return { links: result, changes, retainedSharedLinks };
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  if (fs.lstatSync(dir).isSymbolicLink()) throw Error(`Refusing a symlink in the cleanup scope: ${dir}`);
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const filename = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Refusing a symlink in the cleanup scope: ${filename}`);
    return entry.isDirectory() ? walkFiles(filename) : entry.isFile() ? [filename] : [];
  });
}

function checkInputPath(root, filename) {
  const rel = relative(root, filename);
  if (rel.startsWith('../') || path.isAbsolute(rel)) throw Error('Input escaped the explicit library root');
  let current = root;
  for (const segment of rel.split('/')) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw Error(`Refusing a symlink in the cleanup scope: ${current}`);
  }
}

function safeReportPath(root, supplied) {
  let destination = path.resolve(supplied);
  if (path.extname(destination).toLowerCase() !== '.json') throw Error('--report must name a .json report file');
  if (fs.existsSync(destination) && !fs.lstatSync(destination).isFile())
    throw Error('--report must name a regular file, never a directory or symlink');
  // Resolve the existing parent even when the final output directory is new.
  let parent = path.dirname(destination);
  const missing = [];
  while (!fs.existsSync(parent)) {
    missing.unshift(path.basename(parent));
    const next = path.dirname(parent);
    if (next === parent) throw Error('Cannot resolve report directory');
    parent = next;
  }
  parent = path.join(fs.realpathSync(parent), ...missing);
  destination = path.join(parent, path.basename(destination));
  const rel = relative(root, destination);
  if (/^(?:data|sources)\//.test(rel)) throw Error('--report must be outside data/ and sources/');
  return destination;
}

function emptyBook() {
  return { readerFilesScanned: 0, readerFilesChanged: 0, masterFilesChanged: 0,
    footnotesBefore: 0, footnotesAfter: 0, protectedFootnotes: 0,
    footnotesChanged: 0, paragraphsRemoved: 0, ravParagraphsRemoved: 0,
    ishbitzParagraphsRemoved: 0, summaryParagraphsRemoved: 0,
    sourceEntriesRemoved: 0, linkEntriesRemoved: 0, sharedLinkEntriesPreserved: 0 };
}

/** Prepare and optionally apply one complete plan. Does not write by default. */
export function runCleanup({ root, write = false, report: reportPath } = {}) {
  if (typeof root !== 'string' || !root.trim()) throw Error('--root is required; it must name a library directory containing data/');
  root = fs.realpathSync(path.resolve(root));
  checkInputPath(root, path.join(root, 'data'));
  if (!fs.existsSync(path.join(root, 'data')) || !fs.statSync(path.join(root, 'data')).isDirectory())
    throw Error(`No data/ directory under explicit --root ${root}`);
  if (reportPath) {
    reportPath = safeReportPath(root, reportPath);
  }
  const report = {
    schemaVersion: 1, root, mode: write ? 'write' : 'dry-run',
    policy: 'Remove only labeled appended paragraphs and their generated source/link entries; preserve source text, anchors, curated parallels and protected owners.',
    assertions: { bodyUnchanged: true, footnoteCountsUnchanged: true, noteMetadataUnchanged: true,
      firstParagraphsUnchanged: true, protectedUnchanged: true, idempotent: true },
    books: Object.fromEntries(TARGET_BOOKS.map((book) => [book.slug, emptyBook()])),
    files: [], protectedFiles: [], protectedSections: [], retainedSharedLinks: [],
  };
  const plans = [];
  const protectedFiles = new Map();
  function protectFile(filename) {
    checkInputPath(root, filename);
    if (fs.existsSync(filename) && !protectedFiles.has(filename)) {
      const sha256 = digest(fs.readFileSync(filename));
      protectedFiles.set(filename, sha256);
      report.protectedFiles.push({ path: relative(root, filename), sha256 });
    }
  }
  for (const book of PROTECTED_BOOKS) {
    for (const filename of walkFiles(path.join(root, 'data', book.slug))) protectFile(filename);
    protectFile(path.join(root, 'sources', 'akiva', `${book.id}.json`));
  }
  function planFile(filename, raw, value, book, kind, changes, fingerprints) {
    if (!changes.length) return;
    const after = JSON.stringify(value) + '\n';
    if (after === raw) throw Error('Change report did not produce changed JSON');
    const file = { path: relative(root, filename), book: book.slug, kind,
      beforeSha256: digest(raw), afterSha256: digest(after), changes };
    if (fingerprints) Object.assign(file, {
      notesBefore: fingerprints.before.notes, notesAfter: fingerprints.after.notes,
      bodyBeforeSha256: fingerprints.before.bodySha256, bodyAfterSha256: fingerprints.after.bodySha256,
    });
    report.files.push(file);
    plans.push({ filename, before: raw, after, file });
  }
  for (const book of TARGET_BOOKS) {
    const dir = path.join(root, 'data', book.slug);
    checkInputPath(root, dir);
    const stats = report.books[book.slug];
    checkInputPath(root, path.join(dir, 'toc.json'));
    const map = fs.existsSync(path.join(dir, 'toc.json')) ? chapterMap(readJson(path.join(dir, 'toc.json')).value) : new Map();
    const protectedRefs = new Set();
    if (book.slug === 'peri-tzadik') for (const owner of map.values()) if (isProtectedPeriSection(owner))
      owner.refs.forEach((ref) => protectedRefs.add(refKey(ref)));
    const evidence = new Map();
    const retainedEvidence = new Map();
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => CHAPTER_FILE.test(file)).sort() : [];
    for (const file of files) {
      const filename = path.join(dir, file);
      if (fs.lstatSync(filename).isSymbolicLink()) throw Error(`Refusing chapter symlink ${filename}`);
      const { raw, value } = readJson(filename);
      if (!Array.isArray(value)) throw Error(`Unknown chapter shape in ${filename}`);
      const owner = map.get(file) || { file, refs: [], separators: {} };
      const before = fingerprintItems(value);
      stats.readerFilesScanned++; stats.footnotesBefore += before.notes; stats.footnotesAfter += before.notes;
      if (book.slug === 'peri-tzadik' && isProtectedPeriSection(owner)) {
        protectFile(filename); stats.protectedFootnotes += before.notes; continue;
      }
      let result;
      try { result = transformItems(value, owner, evidence, retainedEvidence); }
      catch (error) { throw Error(`${relative(root, filename)}: ${error.message}`); }
      if (!result.changes.length) continue;
      if (!owner.refs.length) throw Error(`Cannot establish the TOC owner of affected reader chapter ${relative(root, filename)}`);
      const after = fingerprintItems(result.items);
      equalFingerprints(before, after);
      planFile(filename, raw, result.items, book, 'reader', result.changes, { before, after });
      stats.readerFilesChanged++; stats.footnotesChanged += result.changes.length;
      for (const change of result.changes) {
        stats.paragraphsRemoved += change.removedParagraphs.length;
        stats.sourceEntriesRemoved += change.removedSources.length;
        for (const paragraph of change.removedParagraphs) stats[`${paragraph.kind}ParagraphsRemoved`]++;
      }
    }
    // A master is owned by its exact known filename. Section refs and filenames
    // are authority; refs mentioned in the note or a cited source are not.
    const masterFile = path.join(root, 'sources', 'akiva', `${book.id}.json`);
    checkInputPath(root, masterFile);
    if (fs.existsSync(masterFile)) {
      const { raw, value } = readJson(masterFile);
      if (!object(value) || !Array.isArray(value.sections)) throw Error(`Unknown master shape in ${masterFile}`);
      const changes = [];
      const beforeAll = [], afterAll = [];
      const sections = value.sections.map((section, index) => {
        if (!object(section) || !Array.isArray(section.items)) throw Error(`Unknown master section shape in ${masterFile} section ${index}`);
        const file = typeof section.file === 'string' && CHAPTER_FILE.test(section.file) ? section.file : null;
        const refs = [...new Set([...(file ? map.get(file)?.refs || [] : []), section.ref, section.heRef].filter((ref) => typeof ref === 'string'))];
        const owner = { file, refs, separators: file ? map.get(file)?.separators || {} : {} };
        beforeAll.push(section.items);
        if (book.slug === 'peri-tzadik' && isProtectedPeriSection(owner)) {
          report.protectedSections.push({ path: relative(root, masterFile), sectionIndex: index, file, refs, sha256: objectDigest(section) });
          afterAll.push(section.items); return section;
        }
        const result = transformItems(section.items, owner, null);
        if (result.changes.length && book.slug === 'peri-tzadik' && !file && !refs.length)
          throw Error(`Cannot establish the owner of Peri Tzadik master section ${index}`);
        afterAll.push(result.items);
        changes.push(...result.changes.map((change) => ({ masterSectionIndex: index, ...change })));
        return result.changes.length ? { ...section, items: result.items } : section;
      });
      if (changes.length) {
        const before = fingerprintItems(beforeAll), after = fingerprintItems(afterAll);
        equalFingerprints(before, after);
        const transformed = { ...value, sections };
        for (const protection of report.protectedSections.filter((p) => p.path === relative(root, masterFile)))
          assert.equal(objectDigest(transformed.sections[protection.sectionIndex]), protection.sha256, 'Protected master section changed');
        planFile(masterFile, raw, transformed, book, 'master', changes, { before, after });
        stats.masterFilesChanged++;
      }
    }
    const linksFile = path.join(dir, 'links.json');
    checkInputPath(root, linksFile);
    if (evidence.size && fs.existsSync(linksFile)) {
      const { raw, value } = readJson(linksFile);
      const result = transformLinks(value, evidence, retainedEvidence, protectedRefs);
      stats.sharedLinkEntriesPreserved = result.retainedSharedLinks.length;
      report.retainedSharedLinks.push(...result.retainedSharedLinks.map((link) => ({ book: book.slug, ...link })));
      if (result.changes.length) {
        assert.equal(transformLinks(result.links, evidence, retainedEvidence, protectedRefs).changes.length, 0, 'Link cleanup is not idempotent');
        planFile(linksFile, raw, result.links, book, 'links', result.changes);
        stats.linkEntriesRemoved = result.changes.reduce((sum, change) => sum + change.removedLinks.length, 0);
      }
    }
  }
  function verifyProtected() {
    for (const [filename, sha256] of protectedFiles)
      assert.equal(digest(fs.readFileSync(filename)), sha256, `Protected file changed: ${filename}`);
  }
  verifyProtected();
  report.totals = Object.values(report.books).reduce((totals, book) => {
    for (const [key, value] of Object.entries(book)) totals[key] = (totals[key] || 0) + value;
    return totals;
  }, { filesChanged: plans.length });
  let stagedReport = null;
  let previousReport = null;
  let reportCommitted = false;
  if (reportPath) {
    // Prepare proof before touching data. A bad/unwritable report destination
    // must not leave successfully changed files without their audit record.
    reportPath = safeReportPath(root, reportPath);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    previousReport = fs.existsSync(reportPath) ? fs.readFileSync(reportPath) : null;
    stagedReport = `${reportPath}.parallel-cleanup-${process.pid}.tmp`;
    fs.writeFileSync(stagedReport, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  const written = [];
  try {
    if (write) {
    // Reject a stale preview if another process changed any planned input.
    for (const plan of plans) assert.equal(digest(fs.readFileSync(plan.filename)), plan.file.beforeSha256,
      `File changed while preparing cleanup: ${plan.filename}`);
      for (const plan of plans) {
        const temporary = `${plan.filename}.parallel-cleanup-${process.pid}.tmp`;
        try {
          fs.writeFileSync(temporary, plan.after, { flag: 'wx', mode: fs.statSync(plan.filename).mode });
          fs.renameSync(temporary, plan.filename);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        written.push(plan);
        assert.equal(digest(fs.readFileSync(plan.filename)), plan.file.afterSha256, `Written file differs: ${plan.filename}`);
      }
      verifyProtected();
    }
    if (stagedReport) {
      safeReportPath(root, reportPath);
      fs.renameSync(stagedReport, reportPath);
      reportCommitted = true;
    }
    verifyProtected();
  } catch (error) {
    for (const plan of written.reverse()) fs.writeFileSync(plan.filename, plan.before);
    if (reportCommitted) {
      if (previousReport !== null) fs.writeFileSync(reportPath, previousReport);
      else fs.unlinkSync(reportPath);
    }
    throw error;
  } finally {
    if (stagedReport && fs.existsSync(stagedReport)) fs.unlinkSync(stagedReport);
  }
  return report;
}

function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      process.stdout.write('Usage: node scripts/strip-appended-parallels.mjs --root LIBRARY_ROOT [--write] [--report REPORT_JSON]\nDry-run is the default. LIBRARY_ROOT must contain data/. Reports belong outside data/ and sources/.\n');
      return;
    }
    if (arg === '--write') options.write = true;
    else if (arg === '--root' || arg === '--report') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else throw Error(`Unknown argument: ${arg}`);
  }
  const report = runCleanup(options);
  process.stdout.write(JSON.stringify({ mode: report.mode, root: report.root, assertions: report.assertions,
    totals: report.totals, books: report.books, report: options.report ? path.resolve(options.report) : null }, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`Parallel cleanup aborted: ${error.message}\n`); process.exitCode = 1; }
}

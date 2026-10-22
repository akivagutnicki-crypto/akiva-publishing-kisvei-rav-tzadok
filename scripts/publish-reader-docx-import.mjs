// Publish the reconciled uploads only after all historical edition gates.
// Existing chapter files and earlier Mei HaShiloach phrase arrays are immutable.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {linkCitations, linkHebrewCitations, categoryOf} from './citations.mjs';

export const MANIFEST = 'sources/akiva/overlays/docx-import-20261022.json';
export const REPORT = 'reader-docx-import-20261022.json';
export const MEI = 'mei-ha-shiloach';
export const BEIT = 'beit-yaakov-on-torah';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, JSON.stringify(value));
};
export const leaves = node => node.children ? node.children.flatMap(leaves) : [node];
const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = value => escapeText(value).replace(/"/g, '&quot;');
const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '};
export const visible = value => String(value).replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,
  (all, key) => key[0] === '#' ? String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : +key.slice(1)) : entities[key] ?? all);
const allFiles = (dir, prefix='') => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory()
  ? allFiles(path.join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
const citedSlug = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const paragraphRef = (section, n) => section.ref + (section.sep || (/\d[ab]?(?::\d+)*$/.test(section.ref) ? ':' : ' ')) + n;

export function checkedFile(proof) {
  const bytes = fs.readFileSync(proof.file);
  assert.equal(sha(bytes), proof.sha256, 'Source or verification file changed: ' + proof.file);
  return bytes;
}

export function loadRelease() {
  const manifest = read(MANIFEST);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.release, '20261022-reader-docx-import-v1');
  const packs = manifest.packs.map(proof => {
    const bytes = checkedFile(proof);
    const pack = JSON.parse(proof.file.endsWith('.gz.b64') ? gunzipSync(Buffer.from(bytes.toString().trim(), 'base64')) : bytes);
    assert.equal(pack.book, proof.book);
    assert.equal(pack.sections.length, proof.sections);
    return {proof, pack};
  });
  const registry = JSON.parse(checkedFile(manifest.citations)).references;
  const reviews = manifest.citationReview ? JSON.parse(checkedFile(manifest.citationReview)) : null;
  const audits = manifest.audits.map(proof => JSON.parse(checkedFile(proof)));
  for (const proof of manifest.evidence || []) checkedFile(proof);
  return {manifest, packs, registry, reviews, audits};
}

export function normalizedSections(pack) {
  return pack.sections.map(section => {
    const isMei = pack.book === 'Mei HaShiloach';
    const ref = section.ref || `${pack.book}, Vayetzei ${section.chapter}`;
    const items = section.items || section.paragraphs.map((p, i) => ({n:i + 1, p}));
    return {...section, ref, items, sep:section.sep || (isMei ? (/\d[ab]?(?::\d+)*$/.test(ref) ? ':' : ' ') : ':'),
      title:section.title || section.en || ref.split(', ').slice(-1)[0],
      he:section.he || section.sourceHeading || '',
      chapter:section.chapter || (!isMei ? Number(ref.match(/(\d+)$/)?.[1]) : undefined)};
  });
}

export function linkPhrase(text, registry, overrides=[], context={}) {
  const source = String(text);
  // Quotes are text, not attributes. Escaping them before Hebrew reference
  // recognition makes the letters in &quot; look like Hebrew numerals.
  const found = linkHebrewCitations(linkCitations(escapeText(source)));
  let anchors = 0;
  const appliedOverrides = new Set();
  let html = found.replace(/<a\b[^>]*data-ref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, encoded, words) => {
    const raw = visible(encoded), label = visible(words);
    const overrideIndex = overrides.findIndex(value => value.from === raw && (!value.label || value.label === label)
      && (!value.sectionRef || value.sectionRef === context.sectionRef)
      && (!value.sourceParagraphIndices || value.sourceParagraphIndices.includes(context.sourceParagraphIndex)));
    const override = overrides[overrideIndex];
    const proof = registry[override?.to || raw];
    if (!proof?.verified) return words;
    assert.match(proof.url, /^https:\/\/www\.sefaria\.org\//);
    anchors++;
    if (overrideIndex >= 0) appliedOverrides.add(overrideIndex);
    return `<a data-ref="${escapeAttribute(proof.ref)}" href="${escapeAttribute(proof.url)}">${words}</a>`;
  });
  // A checked citation written out in words (for example chapter five,
  // halakhah five) has no numeral for the generic parser to recognize.
  for (const [insertionIndex, insertion] of overrides.entries()) {
    if (!(insertion.literal
    && insertion.sectionRef === context.sectionRef
    && (!insertion.sourceParagraphIndices || insertion.sourceParagraphIndices.includes(context.sourceParagraphIndex)))) continue;
    const proof = registry[insertion.to]; assert.ok(proof?.verified, 'Unverified literal citation');
    const label = escapeText(insertion.literal);
    html = html.split(/(<a\b[\s\S]*?<\/a>)/g).map(part => part.startsWith('<a') ? part : part.replaceAll(label, () => {
      anchors++;
      appliedOverrides.add(insertionIndex);
      return `<a data-ref="${escapeAttribute(proof.ref)}" href="${escapeAttribute(proof.url)}">${label}</a>`;
    })).join('');
  }
  assert.equal(visible(html), source, 'Adding a source hyperlink changed manuscript text');
  return {html, anchors, appliedOverrides:[...appliedOverrides]};
}

export function publish(library='dist/library') {
  const release = loadRelease(), {manifest, registry} = release;
  const reportFile = path.join(library, REPORT), data = path.join(library, 'data');
  if (fs.existsSync(reportFile)) {
    const report = read(reportFile);
    assert.equal(report.release, manifest.release, 'Another document import already exists');
    assert.equal(report.manifestSha256, sha(fs.readFileSync(MANIFEST)));
    for (const file of report.addedFiles) assert.equal(sha(fs.readFileSync(path.join(library, file.path))), file.sha256);
    console.log(JSON.stringify({ok:true, mode:'already-applied', release:manifest.release}));
    return report;
  }
  const packs = {};
  for (const {pack} of release.packs) (packs[pack.book] ??= []).push(...normalizedSections(pack));
  const meiSections = packs['Mei HaShiloach'], beitSections = packs['Beit Yaakov on Torah'];
  assert.ok(meiSections?.length && beitSections?.length);
  assert.equal(new Set(meiSections.map(section => section.ref)).size, meiSections.length, 'Duplicate Mei section in supplied/completion packs');
  assert.deepEqual(beitSections.map(s => s.chapter), Array.from({length:76}, (_, i) => i + 1));
  const protectedTextSha256 = Object.fromEntries(allFiles(data).filter(file => /^[^/]+\/\d+(?:-\d+)*\.json$/.test(file))
    .map(file => [file, sha(fs.readFileSync(path.join(data, file)))]));
  const catalog = read(path.join(data, 'catalog.json')), oldOtherCatalog = JSON.stringify(catalog.filter(b => b.slug !== BEIT));
  const beitBook = catalog.find(book => book.slug === BEIT);
  assert.ok(beitBook?.interlinear);
  const toc = read(path.join(data, BEIT, 'toc.json'));
  assert.equal(leaves(toc.toc).length, 338);
  assert.equal(leaves(toc.toc).filter(leaf => leaf.ref?.startsWith('Beit Yaakov on Torah, Toldot ')).length, 52);
  const beforeTocSha256 = sha(JSON.stringify(toc)), beforeMei = read(path.join(data, MEI, 'interlinear.json'));
  assert.equal(Object.keys(beforeMei).length, 21);
  const previousMeiSectionSha256 = Object.fromEntries(Object.entries(beforeMei).map(([ref, value]) => [ref, sha(JSON.stringify(value))]));
  const heads = read(path.join(data, MEI, 'headings.json'));
  const previousMeiHeadingSha256 = Object.fromEntries(Object.entries(heads).map(([ref, value]) => [ref, sha(JSON.stringify(value))]));
  const links = Object.fromEntries([MEI, BEIT].map(slug => [slug, read(path.join(data, slug, 'links.json'))]));
  const previousLinksSha256 = Object.fromEntries(Object.entries(links).map(([slug, entries]) => [slug,
    Object.fromEntries(Object.entries(entries).map(([ref, value]) => [ref, sha(JSON.stringify(value))]))]));
  const addedFiles = [], publishedSections = [], newEdges = [], unmatched = new Set();
  const overrides = manifest.citationOverrides || [];
  const appliedCitationOverrides = new Set();
  let sourceAnchors = 0;

  function linkedItems(section) {
    assert.ok(section.items.length, 'Empty section ' + section.ref);
    const seen = new Set(), edges = [];
    const items = section.items.map((item, index) => {
      assert.equal(item.n, index + 1, 'Nonconsecutive manuscript paragraph');
      assert.ok(item.p?.length, 'Empty paragraph ' + section.ref);
      const pairs = item.p.map(pair => {
        assert.equal(pair.length, 2);
        assert.match(pair[0], /[א-ת]/); assert.match(pair[1], /[A-Za-z]/);
        assert.doesNotMatch(pair[1], /[\[\]]/, 'English translation brackets remain');
        return pair.map(text => {
          const result = linkPhrase(text, registry, overrides, {sectionRef:section.ref,
            sourceParagraphIndex:item.sourceParagraphIndex ?? item.sourceParagraph});
          sourceAnchors += result.anchors;
          result.appliedOverrides.forEach(index => appliedCitationOverrides.add(index));
          return result.html;
        });
      });
      for (const html of pairs.flat()) for (const match of html.matchAll(/data-ref="([^"]+)"/g)) {
        const ref = visible(match[1]), anchor = paragraphRef(section, item.n), key = anchor + '\0' + ref;
        if (!seen.has(key)) {seen.add(key); edges.push({a:anchor, r:ref, c:categoryOf(ref)});}
      }
      for (const candidate of item.connections || []) {
        const proof = registry[candidate.ref], anchor = paragraphRef(section, item.n);
        if (!proof?.verified) {unmatched.add(candidate.ref); continue;}
        const key = anchor + '\0' + proof.ref;
        if (!seen.has(key)) {seen.add(key); edges.push({a:anchor, r:proof.ref, c:categoryOf(proof.ref)});}
      }
      return {...item, p:pairs, keepPairs:true};
    });
    links[section.book === 'Mei HaShiloach' ? MEI : BEIT][section.ref] = edges;
    newEdges.push(...edges);
    return items;
  }

  const nextId = 1 + Math.max(...leaves(toc.toc).map(leaf => leaf.id));
  const children = [];
  for (const [offset, section] of beitSections.entries()) {
    section.book = 'Beit Yaakov on Torah';
    assert.ok(!leaves(toc.toc).some(leaf => leaf.ref === section.ref), 'Would overwrite a published section');
    const items = linkedItems(section), id = nextId + offset;
    const genericTitle = `Vayetzei · Ois ${section.chapter}`;
    const rows = section.title === genericTitle ? [] : [{h:section.title, editorialHeading:true}];
    for (const item of items) {
      if (item.heading) rows.push({h:item.heading, editorialHeading:true});
      const {sourceText, sourceParagraph, sourceParagraphIndex, heading, ...row} = item;
      rows.push(row);
    }
    const file = `data/${BEIT}/${id}.json`;
    assert.ok(!fs.existsSync(path.join(library, file)), 'Existing reader data file');
    write(path.join(library, file), rows);
    addedFiles.push({path:file, sha256:sha(fs.readFileSync(path.join(library, file)))});
    const source = registry[section.ref];
    assert.ok(source?.verified, 'Unverified canonical section ' + section.ref);
    children.push({en:`Vayetzei · Ois ${section.chapter}`, he:section.he, id, depth:1, shape:items.length,
      interlinear:true, ref:section.ref, heRef:`בית יעקב על התורה, ${section.he}`, sourceUrl:source.url,
      sep:':', parashah:'Vayetzei', ois:section.chapter});
    publishedSections.push({book:section.book, ref:section.ref, file, paragraphs:items.length,
      phrasePairs:items.reduce((n, item) => n + item.p.length, 0), sep:section.sep});
  }
  toc.toc.children.push({en:'Vayetzei · 76 Osiyos', he:'ויצא', children});
  toc.documentImportEdition = {release:manifest.release, sections:76};
  beitBook.segments += beitSections.reduce((n, section) => n + section.items.length, 0);

  const mei = {...beforeMei};
  const canonicalSortKeys = Object.assign({}, ...release.packs.map(({pack}) => pack.canonicalSortKeys || {}));
  const paratext = release.packs.flatMap(({pack}) => pack.paratext || []);
  for (const section of meiSections) {
    section.book = 'Mei HaShiloach';
    assert.ok(!Object.hasOwn(mei, section.ref), 'Would replace existing Mei HaShiloach translation');
    canonicalSortKeys[section.ref] = section.sortKey || canonicalSortKeys[section.ref];
    const discourseParagraphs = section.items.length;
    const colophons = paratext.filter(item => item.afterRef === section.ref);
    for (const colophon of colophons) {
      assert.equal(colophon.canonicalSourceVerified, true);
      const n = section.items.length + 1;
      assert.equal(colophon.sourceRef, paragraphRef(section, n), 'Colophon has a nonconsecutive canonical ref');
      section.items.push({...colophon, n, heading:colophon.kind === 'suppliedColophon' ? 'Colophon' : '', paratext:true});
    }
    const source = registry[section.ref];
    assert.ok(source?.verified, 'Unverified canonical Mei section ' + section.ref);
    if (section.canonicalParagraphCount) assert.equal(section.items.length, section.canonicalParagraphCount,
      'Canonical paragraphs missing from ' + section.ref);
    const items = linkedItems(section);
    mei[section.ref] = items.map(item => item.p);
    heads[section.ref] = {title:section.title, he:section.he, sourceUrl:source.url, sep:section.sep,
      headings:section.headings || items.map(item => item.heading || ''),
      phraseHeadings:section.phraseHeadings || Object.fromEntries(items.map((item, index) => [index, item.inlineHeadings || []]).filter(([, value]) => value.length)),
      ...(items.some(item => item.transcriptionNotes?.length) ? {transcriptionNotes:Object.fromEntries(items.map((item,index) => [index,item.transcriptionNotes || []]).filter(([,notes]) => notes.length))} : {}),
      ...(colophons.length ? {paratextParagraphs:items.filter(item => item.paratext).map(item => item.n)} : {})};
    assert.equal(heads[section.ref].headings.length, items.length);
    publishedSections.push({book:section.book, ref:section.ref, file:`data/${MEI}/interlinear.json`,
      paragraphs:items.length, phrasePairs:items.reduce((n, item) => n + item.p.length, 0), sep:section.sep,
      discourseParagraphs, colophonParagraphs:colophons.length,
      sha256:sha(JSON.stringify(mei[section.ref]))});
  }
  // The source document contains genuine Volume II selections. Sort every
  // section, including earlier editions and the completion, by the checked
  // Sefaria index instead of assuming the upload is all Volume I.
  for (const ref of Object.keys(mei)) assert.ok(Array.isArray(canonicalSortKeys[ref]), 'Missing canonical sort key: ' + ref);
  const order = Object.keys(mei).sort((a, b) => {
    const left = canonicalSortKeys[a], right = canonicalSortKeys[b];
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (left[i] || 0) - (right[i] || 0); if (difference) return difference;
    }
    return a.localeCompare(b);
  });
  assert.equal(new Set(order).size, Object.keys(mei).length);
  const studyToc = {title:'Mei HaShiloach', he:'מי השילוח', release:manifest.release, toc:{en:'Mei HaShiloach', he:'מי השילוח', children:[]}};
  for (const ref of order) {
    const parts = ref.split(', '), volume = parts[1], category = parts.slice(2, -1).join(' · ');
    let volumeNode = studyToc.toc.children.find(node => node.en === volume);
    if (!volumeNode) studyToc.toc.children.push(volumeNode = {en:volume, he:volume === 'Volume I' ? 'חלק א' : volume === 'Volume II' ? 'חלק ב' : 'ליקוטים', children:[]});
    let target = volumeNode;
    if (category) {
      target = volumeNode.children.find(node => node.en === category);
      if (!target) volumeNode.children.push(target = {en:category, he:'', children:[]});
    }
    target.children.push({ref, en:heads[ref]?.title || parts.at(-1), he:heads[ref]?.he || '',
      depth:1, shape:mei[ref].length, interlinear:true, sep:heads[ref]?.sep || ' '});
  }
  write(path.join(data, MEI, 'interlinear.json'), Object.fromEntries(order.map(ref => [ref, mei[ref]])));
  write(path.join(data, MEI, 'headings.json'), heads);
  write(path.join(data, MEI, 'study-contents.json'), studyToc);
  write(path.join(data, BEIT, 'toc.json'), toc);
  write(path.join(data, 'catalog.json'), catalog);
  for (const [slug, entries] of Object.entries(links)) write(path.join(data, slug, 'links.json'), entries);

  const citedDir = path.join(data, 'cited'), reverse = new Map();
  for (const edge of newEdges) {
    const file = citedSlug(edge.r) + '.json';
    if (!reverse.has(file)) reverse.set(file, fs.existsSync(path.join(citedDir, file)) ? read(path.join(citedDir, file)) : {});
    const target = reverse.get(file), anchors = target[edge.r] ??= [];
    if (!anchors.includes(edge.a)) anchors.push(edge.a);
  }
  for (const [file, value] of reverse) write(path.join(citedDir, file), value);
  write(path.join(citedDir, 'index.json'), [...new Set([...read(path.join(citedDir, 'index.json')), ...[...reverse.keys()].map(file => file.slice(0,-5))])].sort());
  const sourcePack = read(path.join(data, 'packs/sources.json'));
  sourcePack.refs = [...new Set([...sourcePack.refs, ...newEdges.map(edge => edge.r).filter(ref =>
    !catalog.some(book => ref === book.title || ref.startsWith(book.title + ' ') || ref.startsWith(book.title + ',')))])].sort();
  write(path.join(data, 'packs/sources.json'), sourcePack);

  const htmlFile = path.join(library, 'index.html');
  let html = fs.readFileSync(htmlFile, 'utf8');
  const repeatedOisTitle = "d.title.parashah + ' · Ois ' + d.title.ois + ' — ' + (d.title.en || d.sectionRef)";
  assert.equal(html.split(repeatedOisTitle).length, 2);
  html = html.replace(repeatedOisTitle,
    "d.title.parashah + ' · Ois ' + d.title.ois + (d.title.en === d.title.parashah + ' · Ois ' + d.title.ois ? '' : ' — ' + (d.title.en || d.sectionRef))");
  assert.equal((html.match(/const meiStudyRefs = new Set\(/g) || []).length, 1);
  html = html.replace(/const meiStudyRefs = new Set\(\[[\s\S]*?\]\);/, `const meiStudyRefs = new Set(${JSON.stringify(order, null, 2)});`);
  assert.ok(html.includes("phrases:overlay, meiStudy:true, segmentLevel:false, sep:' '"));
  html = html.replace("phrases:overlay, meiStudy:true, segmentLevel:false, sep:' '", "phrases:overlay, meiStudy:true, segmentLevel:false, sep:headingInfo?.sep || ' '");
  const studyMetadata = "...(heads ? {heads, studyHeading:headingInfo.title, phraseHeads:headingInfo.phraseHeadings || {}} : {})";
  assert.ok(html.includes(studyMetadata));
  html = html.replace(studyMetadata, "heRef:headingInfo?.he || d.heRef, sourceUrl:headingInfo?.sourceUrl || d.sourceUrl, transcriptionNotes:headingInfo?.transcriptionNotes || {}, " + studyMetadata);
  assert.ok(html.includes("const canonicalRef=section+' '+paragraph;"));
  html = html.replace("const canonicalRef=section+' '+paragraph;", "const canonicalRef=section+(study.sep || ' ')+paragraph;");
  html = html.replace('All 21 study sections are bundled;', 'All published study sections are bundled;');
  html = html.replace('Canonical Mei paragraph references use a space after the parashah name.',
    'Canonical Mei paragraphs use a space after a parashah name and a colon after a chapter or daf.');
  const remoteShape = '    const shape = await getJSON(`/api/shape/${encodeURIComponent(title)}`);';
  assert.equal(html.split(remoteShape).length, 2);
  html = html.replace(remoteShape, `    if (title === 'Mei HaShiloach') {
      const study = await dataJSON('mei-ha-shiloach/study-contents.json');
      $('#bookHe').textContent = study.he;
      $('#tocActions').innerHTML = actions([...meiStudyRefs][0]);
      $('#toc').innerHTML = '<div class="study-entry"><h2>Hebrew–English Interlinear</h2><p>Volume I teachings, with selections from Volume II and the anthology. Select a passage for its Hebrew, English, sources and connections.</p>'
        + renderLocalNode(study.toc, true) + '</div><details id="meiOriginalContents" class="original-edition"><summary>Additional source sections · complete Hebrew contents</summary><div class="original-contents"></div></details>';
      $('#meiOriginalContents').addEventListener('toggle', async event => {
        const details = event.currentTarget, target = details.querySelector('.original-contents');
        if (!details.open || target.dataset.loaded) return;
        target.innerHTML = '<div class="loading">Loading contents…</div>';
        try {
          const response = await getJSON('/api/shape/Mei%20HaShiloach');
          const root = Array.isArray(response) ? response[0] : response;
          target.innerHTML = renderNode(root, root.book || title, true); target.dataset.loaded = 'true';
        } catch (error) { target.innerHTML = errorBox('The additional source contents could not be loaded.', title, error); }
      });
      $('#saveBook').onclick = () => saveBook(title);
      return;
    }
` + remoteShape);
  const prefix = 'const editionDataUrl = url => ';
  assert.equal(html.split(prefix).length, 2);
  html = html.replace(prefix, prefix + `/* Complete supplied manuscript import */ (url.startsWith('data/${MEI}/') || url.startsWith('data/${BEIT}/') || url.startsWith('data/cited/') || url.startsWith('data/parallels/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition=${manifest.release}' :\n`);
  fs.writeFileSync(htmlFile, html);
  const swFile = path.join(library, 'sw.js');
  const sw = fs.readFileSync(swFile, 'utf8');
  assert.ok(/const SHELL = `([^`]+)`;/.test(sw));
  fs.writeFileSync(swFile, sw.replace(/const SHELL = `([^`]+)`;/, `const SHELL = \`$1-docx-20261022\`;`));

  for (const [file, hash] of Object.entries(protectedTextSha256)) assert.equal(sha(fs.readFileSync(path.join(data, file))), hash, 'Existing Hebrew or translation changed: ' + file);
  assert.equal(JSON.stringify(catalog.filter(book => book.slug !== BEIT)), oldOtherCatalog);
  const restored = structuredClone(toc); restored.toc.children.pop(); delete restored.documentImportEdition;
  assert.equal(sha(JSON.stringify(restored)), beforeTocSha256, 'Prior section navigation changed');
  for (const [ref, hash] of Object.entries(previousMeiSectionSha256)) assert.equal(sha(JSON.stringify(mei[ref])), hash);
  for (const [ref, hash] of Object.entries(previousMeiHeadingSha256)) assert.equal(sha(JSON.stringify(heads[ref])), hash);
  for (const [slug, sections] of Object.entries(previousLinksSha256)) for (const [ref, hash] of Object.entries(sections)) assert.equal(sha(JSON.stringify(links[slug][ref])), hash);
  overrides.forEach((override, index) => { if (override.required !== false) assert.ok(appliedCitationOverrides.has(index),
    'Reviewed citation correction did not apply: ' + JSON.stringify(override)); });
  const report = {schemaVersion:1, release:manifest.release, manifestSha256:sha(fs.readFileSync(MANIFEST)),
    sourcePacks:manifest.packs, auditedDocuments:manifest.audits, protectedTextSha256, previousMeiSectionSha256,
    previousMeiHeadingSha256, previousLinksSha256, beforeTocSha256, previousBeitSections:338,
    retainedToldosSections:52, addedFiles, sections:publishedSections, sourceAnchors, sourceConnections:newEdges.length,
    canonicalOrder:order, canonicalSortKeys, colophonParagraphs:paratext.length,
    appliedCitationOverrides:[...appliedCitationOverrides].sort((a,b) => a-b),
    completion:manifest.completion,
    unresolvedExplicitConnections:[...unmatched], missingHebrewPhrases:0, missingEnglishPhrases:0};
  write(reportFile, report);
  console.log(JSON.stringify({ok:true, mode:'published', release:manifest.release, addedSections:publishedSections.length,
    paragraphs:publishedSections.reduce((n, section) => n + section.paragraphs, 0),
    phrasePairs:publishedSections.reduce((n, section) => n + section.phrasePairs, 0), sourceAnchors, sourceConnections:newEdges.length,
    retainedToldosSections:52, protectedChapterFiles:Object.keys(protectedTextSha256).length}));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) publish(process.argv[2] || 'dist/library');

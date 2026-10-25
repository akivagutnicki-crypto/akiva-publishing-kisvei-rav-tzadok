import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] || path.join(repo, 'dist'));
const catalog = JSON.parse(fs.readFileSync(path.join(repo, 'sources/akiva/print-editions/new-books-20261023.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(repo, 'dist/editions/sample-provenance.json'), 'utf8'));
const version = catalog.version;
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
assert.equal(catalog.books.length, 2);
for (const book of catalog.books) {
  assert(/^pri-tzaddik-[a-z-]+$/.test(book.slug));
  assert(/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}$/.test(book.amazon));
  assert.equal(book.samplePages, 20);
  const witness = provenance.samples.find(item => item.slug === book.slug);
  assert(witness && witness.sample_pages === 20 && witness.all_pages_pixel_identical);
  book.sourcePages = witness.selected_source_pages;
  book.selectionNote = witness.selection_note;
}

function replaceOnce(text, before, after, label) {
  assert.equal(text.split(before).length, 2, `Unexpected ${label}`);
  return text.replace(before, after);
}
function marked(text, name, content, anchor) {
  const start = `<!-- ${name}-start -->`, end = `<!-- ${name}-end -->`;
  const block = `${start}\n${content}\n${end}`;
  if (text.includes(start)) {
    const from = text.indexOf(start), to = text.indexOf(end, from);
    assert(to > from, `Missing end of ${name}`);
    return text.slice(0, from) + block + text.slice(to + end.length);
  }
  return replaceOnce(text, anchor, block + '\n' + anchor, name);
}

const releaseCard = (book, index) => `
<article class="print-release" id="${book.slug}" aria-labelledby="${book.slug}-title">
  <div class="print-visual">
    <button class="print-scene zoom" type="button" data-img="editions/${book.scene}" data-label="${esc(book.title + ': ' + book.subtitle)} · front and back covers on a shtender" aria-label="Enlarge ${esc(book.subtitle)} front and back cover display"><img src="editions/${book.scene}" alt="${esc(book.title + ': ' + book.subtitle)} front and back covers displayed on a wooden shtender" loading="${index ? 'lazy' : 'eager'}" decoding="async" width="1536" height="1024"></button>
    <div class="print-originals"><button type="button" class="zoom" data-img="editions/${book.front}" data-label="${esc(book.subtitle)} · original front cover">View front cover</button><button type="button" class="zoom" data-img="editions/${book.back}" data-label="${esc(book.subtitle)} · original back cover">View back cover</button></div>
  </div>
  <div class="print-copy"><span class="print-badge">Newly published · Hardcover &amp; paperback</span><h3 id="${book.slug}-title">${esc(book.title)}</h3><div class="print-subtitle">${esc(book.subtitle)}</div><p class="print-scope">${esc(book.scope)}</p><p class="print-description">${esc(book.description)}</p><div class="print-details">Interlinear Hebrew–English · Annotated sources · ${book.pageCount} pages</div><div class="print-actions"><a class="purchase" href="${esc(book.amazon)}" target="_blank" rel="noopener noreferrer">View this book on Amazon ↗</a><a class="sample" href="editions/sample.html?book=${book.slug}">Read 20-page sample →</a></div><a class="print-download" href="editions/${book.pdf}" download>Download the sample PDF ↓</a></div>
</article>`;
const newBooks = `<section class="new-books" id="new-books" aria-labelledby="new-books-title"><div class="wrap"><div class="release-intro"><div><div class="eyebrow">New from Akiva Publishing</div><h2 id="new-books-title">Two new paths into Pri Tzaddik.</h2></div><div><p>Bring Rav Tzadok’s teachings on the months, moadim, and Shabbos to your shtender. Both new editions are now available in hardcover and paperback.</p><div class="release-series"><a href="${esc(catalog.series.hardcover)}" target="_blank" rel="noopener noreferrer">Browse the series in hardcover ↗</a><a href="${esc(catalog.series.paperback)}" target="_blank" rel="noopener noreferrer">Browse the series in paperback ↗</a></div></div></div>${catalog.books.map(releaseCard).join('\n')}<p class="sample-authenticity">Each sample contains 20 pages from the actual print PDF: the title and copyright pages, followed by eighteen consecutive opening pages. The original page layout and printed page numbers are retained.</p></div></section>`;

const rootFile = path.join(root, 'index.html');
let home = fs.readFileSync(rootFile, 'utf8');
const brandLogo = '<img class="mark akiva-brand-logo" src="library/icons/icon.svg" width="38" height="38" alt="">';
if (home.includes('<span class="mark">AP</span>')) {
  home = replaceOnce(home, '<span class="mark">AP</span>', brandLogo, 'homepage brand mark');
} else {
  assert(home.includes(brandLogo), 'Expected the existing Akiva Publishing brand mark');
}
home = marked(home, 'akiva-new-books-style', `<link rel="stylesheet" href="editions/new-books.css?v=${version}">`, '</head>');
home = marked(home, 'akiva-new-books', newBooks, '<section class="manifesto">');
const hero = `<section class="hero"><div class="wrap"><div class="hero-copy"><div class="eyebrow">Akiva Publishing · Kisvei Rav Tzadok</div><a class="hero-release-link" href="#new-books">Just published · Two new Pri Tzaddik editions ↓</a><h1>Depth, without distance.</h1><p>Making the writings of Rav Tzadok HaKohen of Lublin more accessible—with the Hebrew, close English, and annotated sources together on the page.</p><div class="actions"><a class="btn light" href="#new-books">Explore the new books ↓</a><a class="textlink" href="library/">Read the texts online →</a></div><div class="hero-note">Phrase-by-phrase English · Original Hebrew · Annotated sources</div></div><div class="hero-edition-covers" aria-label="The two newly published Pri Tzaddik editions">${catalog.books.map(book => `<a href="#${book.slug}" class="hero-edition"><img src="editions/${book.front}" alt="${esc(book.title + ': ' + book.subtitle)} original front cover" width="700" height="1000" decoding="async" fetchpriority="high"><span>${esc(book.subtitle)}</span></a>`).join('')}</div></div></section>`;
assert.equal((home.match(/<section class="hero">/g) || []).length, 1);
home = home.replace(/<section class="hero">[\s\S]*?<\/section>/, hero);
if (!home.includes('<nav aria-label="Primary navigation"><a href="#new-books">')) {
  home = replaceOnce(home, '<nav aria-label="Primary navigation">', '<nav aria-label="Primary navigation"><a href="#new-books">New books</a>', 'navigation');
}
home = home.replace(/<p><strong>New in print:<\/strong>[\s\S]*?<\/p>/, '<p><strong>New in print:</strong> Two Pri Tzaddik editions, on Rosh Chodesh to Tu BiShvat and on Shabbos. <a class="vol-link" href="#new-books">Explore the new books and their 20-page samples →</a></p>');
const collection = `<section class="collection" id="collection" aria-labelledby="collection-title"><div class="wrap collection-copy"><div class="eyebrow">Akiva Publishing · The collection</div><h2 id="collection-title">Seven sefarim. A growing world of Torah.</h2><p>Discover the new <em>Pri Tzaddik</em> editions alongside <em>Takanas HaShavin</em>, Volumes I and II; <em>Resisei Layla</em>, Volumes I and II; and <em>The Livyasan and Shavuos</em>.</p></div><button class="collection-photo zoom" type="button" data-img="editions/akiva-seven-book-collection.webp" data-label="Akiva Publishing · seven published sefarim" aria-label="Enlarge the seven-book Akiva Publishing collection"><img src="editions/akiva-seven-book-collection.webp" loading="lazy" decoding="async" alt="The seven Akiva Publishing sefarim: Pri Tzaddik Rosh Chodesh to Tu BiShvat; Pri Tzaddik Kedushas Shabbos and Shevisas Shabbos; Takanas HaShavin Volumes I and II; Resisei Layla Volumes I and II; and The Livyasan and Shavuos"></button></section>`;
assert.equal((home.match(/<section class="collection" id="collection"/g) || []).length, 1);
home = home.replace(/<section class="collection" id="collection"[\s\S]*?<\/section>/, collection);
fs.writeFileSync(rootFile, home);

const shopCard = book => `<section class="shop-group shop-new" data-edition="${book.slug}"><h3><span class="shop-new-badge">Newly published</span><br>${esc(book.title)}</h3><div class="shop-book"><img loading="eager" decoding="async" src="../editions/${book.front}" alt="${esc(book.title + ': ' + book.subtitle)} · original front cover"><div><div class="book-name">${esc(book.subtitle)}</div><div class="formats"><a href="${esc(book.amazon)}" target="_blank" rel="noopener noreferrer">View on Amazon ↗</a><a class="sample-link" href="editions/sample.html?book=${book.slug}">Read 20-page sample →</a><a href="../editions/${book.pdf}" download>Download sample PDF ↓</a></div><p class="book-format-note">Hardcover &amp; paperback</p></div></div><p class="shop-description">${esc(book.shortDescription)}</p></section>`;
const readerFile = path.join(root, 'library/index.html');
let reader = fs.readFileSync(readerFile, 'utf8');
reader = marked(reader, 'akiva-new-books-style', `<link rel="stylesheet" href="../editions/new-books.css?v=${version}">`, '</head>');
reader = marked(reader, 'akiva-new-book-cards', catalog.books.map(shopCard).join('\n'), '<section class="shop-group"><h3>Resisei Layla · Two Volumes</h3>');
const shopIntro = '<p class="shop-intro">Continue your learning with the printed editions. Choose a volume and format.</p>';
if (reader.includes(shopIntro)) {
  reader = replaceOnce(reader, shopIntro, '<p class="shop-intro">Start with our two new Pri Tzaddik editions, then explore the collection.</p><div class="shop-series-links"><a href="' + esc(catalog.series.hardcover) + '" target="_blank" rel="noopener noreferrer">Pri Tzaddik · Hardcover ↗</a><a href="' + esc(catalog.series.paperback) + '" target="_blank" rel="noopener noreferrer">Paperback ↗</a></div>', 'bookshop intro');
}
fs.writeFileSync(readerFile, reader);

const swFile = path.join(root, 'library/sw.js');
let sw = fs.readFileSync(swFile, 'utf8');
if (!sw.includes('-' + version)) {
  assert(/const SHELL = `[^`]+`;/.test(sw));
  sw = sw.replace(/const SHELL = `([^`]+)`;/, (_, value) => 'const SHELL = `' + value + '-' + version + '`;');
}
// Cache only the small card style and original cover thumbnails at install.
// Samples and scene images remain ordinary opt-in network requests.
if (!sw.includes('// akiva-new-books-cache')) {
  sw = replaceOnce(sw, 'const SHELL_FILES = [', 'const SHELL_FILES = [\n  // akiva-new-books-cache\n  \'../editions/new-books.css?v=' + version + '\',\n  ' + catalog.books.map(book => "'../editions/" + book.front + "'").join(', ') + ',', 'service worker shell list');
}
fs.writeFileSync(swFile, sw);

const destination = path.join(root, 'editions');
fs.mkdirSync(destination, {recursive: true});
fs.writeFileSync(path.join(repo, 'dist/editions/catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
const source = path.join(repo, 'dist/editions');
if (path.resolve(source) !== path.resolve(destination)) fs.cpSync(source, destination, {recursive: true, dereference: false});
// Keep the same sample viewer inside the Android wrapper's /library/ boundary.
const readerViewer = fs.readFileSync(path.join(source, 'sample.html'), 'utf8')
  .replace('<body>', '<body data-asset-base="../../editions/">')
  .replaceAll('href="sample.css?', 'href="../../editions/sample.css?')
  .replaceAll('src="sample.js?', 'src="../../editions/sample.js?')
  .replaceAll('href="../#new-books"', 'href="../../#new-books"')
  .replaceAll('src="../library/icons/icon.svg"', 'src="../icons/icon.svg"')
  .replaceAll('href="../library/"', 'href="../"')
  .replaceAll('href="pri-tzaddik-', 'href="../../editions/pri-tzaddik-');
fs.mkdirSync(path.join(root, 'library/editions'), {recursive:true});
fs.writeFileSync(path.join(root, 'library/editions/sample.html'), readerViewer);
console.log(`Applied ${version}: homepage feature, two reader cards, seven-book collection, genuine samples, and cache refresh.`);

// Keep the newly published Dover Tzedek presentation on every print release.
await import('./apply-dover-presentation.mjs');

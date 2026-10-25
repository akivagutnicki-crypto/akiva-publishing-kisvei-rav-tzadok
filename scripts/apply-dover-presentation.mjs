import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] || path.join(repo, 'dist'));
const version = '20261025-dover-print-v1';
const catalog = JSON.parse(fs.readFileSync(path.join(repo, 'sources/akiva/print-editions/dover-tzedek-20261025.json')));
const proof = JSON.parse(fs.readFileSync(path.join(repo, 'dist/editions/sample-provenance.json')));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for (const book of catalog.books) {
  const sample = proof.samples.find(s => s.slug === book.slug);
  assert(sample?.all_pages_pixel_identical && sample.sample_pages === 20);
  book.sourcePages = sample.selected_source_pages;
  book.selectionNote = sample.selection_note;
}
const formats = (book, cls = 'dover-format-links') => `<div class="${cls}"><a href="${book.paperback}" target="_blank" rel="noopener noreferrer">Paperback ↗</a><a href="${book.hardcover}" target="_blank" rel="noopener noreferrer">Hardcover ↗</a></div>`;
const cards = catalog.books.map(book => `<article class="dover-volume" id="${book.slug}"><button class="dover-cover zoom" type="button" data-img="editions/${book.front}" data-label="${esc(book.title)} · original published cover" aria-label="Enlarge ${esc(book.title)} front cover"><img src="editions/${book.front}" alt="${esc(book.title)} published front cover" width="700" height="1000" loading="lazy" decoding="async"></button><div class="dover-volume-copy"><div class="eyebrow">${book.pageCount} pages · Hebrew–English</div><h3>${esc(book.title)}</h3><p class="dover-scope">${esc(book.scope)}</p><p>${esc(book.description)}</p>${formats(book)}<a class="dover-sample-link" href="editions/sample.html?book=${book.slug}">Read 20-page sample →</a><div class="dover-volume-extras"><a href="editions/${book.pdf}" download>Download sample PDF ↓</a><button class="zoom" type="button" data-img="editions/${book.back}" data-label="${esc(book.title)} · original back cover">View back cover</button></div></div></article>`).join('\n');
const feature = `<section class="dover" id="dover" aria-labelledby="dover-title"><div class="wrap"><div class="dover-overview"><div class="dover-visual"><button class="dover-scene zoom" type="button" data-img="editions/dover-tzedek-two-volumes-shtenders.webp" data-label="Dover Tzedek · both volumes on walnut shtenders in a beis midrash" aria-label="Enlarge both Dover Tzedek volumes on shtenders"><img src="editions/dover-tzedek-two-volumes-shtenders.webp" alt="Dover Tzedek Volumes I and II displayed on walnut shtenders in a warm beis midrash" width="1536" height="1024" loading="lazy" decoding="async"></button><p>Two volumes. One deeper encounter with Toras Rav Tzadok.</p></div><div class="dover-copy"><span class="dover-live">Now available · The complete two-volume set</span><h2 id="dover-title">Dover Tzedek</h2><p class="lead">The inner life of Torah. The yearning of the neshamah.</p><p>From the sanctity of a shared courtyard to the deepest longings of the Jewish soul, Rav Tzadok HaKohen of Lublin draws the words of Torah and Chazal into the heart of avodas Hashem.</p><p>This Hebrew–English edition brings the full work to your shtender, with vocalized Hebrew, interlinear translation, and annotated footnotes containing translated source quotations and illuminating parallels from Kisvei Rav Tzadok and the Ishbitz–Radzin tradition.</p><div class="dover-edition-note">Volumes I &amp; II · 690 pages combined · Hardcover &amp; paperback</div><a class="dover-series" href="${catalog.series}" target="_blank" rel="noopener noreferrer">Explore the two-volume series on Amazon ↗</a></div></div><div class="dover-volume-grid">${cards}</div><div class="dover-sample-heading"><div><div class="eyebrow">Open the sefer</div><h3>See the learning on the page.</h3></div><p>Actual pages from the new KDP interiors, with the Hebrew, English, and footnotes in their original print layout. Tap a page to enlarge it, or turn through the full samples above.</p></div><div class="dover-page-grid">${catalog.books.map(book=>`<figure><button class="zoom" type="button" data-img="editions/${book.pageDirectory}/page-03.webp" data-label="${esc(book.title)} · ${esc(book.sampleSection)} · original PDF page ${book.sourcePages[2]}" aria-label="Enlarge ${esc(book.title)} sample page"><img src="editions/${book.pageDirectory}/page-03.webp" alt="Actual ${esc(book.sampleSection)} text and source footnotes from ${esc(book.title)}" width="1008" height="1440" loading="lazy" decoding="async"></button><figcaption>${esc(book.title)} · ${esc(book.sampleSection)} · page ${book.sourcePages[2]}</figcaption></figure>`).join('')}</div></div></section>`;
let home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.equal((home.match(/<section class="dover"/g)||[]).length, 1, 'Expected one Dover feature');
home = home.replace(/<section class="dover"[\s\S]*?<\/section>\s*/, '');
assert(home.includes('<section class="livyasan"'));
home = home.replace('<section class="livyasan"', feature + '\n<section class="livyasan"');
home = home.replace(/<a href="#dover">Dover Tzedek<\/a>/g, '');
home = home.replace('<a href="#livyasan">', '<a href="#dover">Dover Tzedek</a><a href="#livyasan">');
const collection = `<section class="collection" id="collection" aria-labelledby="collection-title"><div class="wrap collection-copy"><div class="eyebrow">Akiva Publishing · The collection</div><h2 id="collection-title">Nine sefarim. A growing world of Torah.</h2><p>Discover the <em>Pri Tzaddik</em> editions alongside <em>Takanas HaShavin</em>, Volumes I and II; <em>Resisei Layla</em>, Volumes I and II; the newly published <em>Dover Tzedek</em>, Volumes I and II; and <em>The Livyasan and Shavuos</em>.</p></div><button class="collection-photo zoom" type="button" data-img="editions/akiva-nine-book-collection.webp" data-label="Akiva Publishing · nine published sefarim" aria-label="Enlarge the nine-book Akiva Publishing collection"><img src="editions/akiva-nine-book-collection.webp" width="2048" height="683" loading="lazy" decoding="async" alt="Nine sefarim on walnut shtenders in a beis midrash, from left: Takanas HaShavin I and II; Pri Tzaddik Rosh Chodesh to Tu BiShvat; Pri Tzaddik Kedushas Shabbos and Shevisas Shabbos; Resisei Layla I and II; Dover Tzedek I and II; The Livyasan and Shavuos"></button></section>`;
home = home.replace(/<section class="collection"[\s\S]*?<\/section>/, collection);
const style = `<link rel="stylesheet" href="editions/dover-tzedek.css?v=${version}">`;
if (!home.includes(style)) home = home.replace('</head>', style + '\n</head>');
fs.writeFileSync(path.join(root, 'index.html'), home);

let reader = fs.readFileSync(path.join(root, 'library/index.html'), 'utf8');
const start='<!-- akiva-dover-print-start -->', end='<!-- akiva-dover-print-end -->';
if (reader.includes(start)) reader=reader.slice(0,reader.indexOf(start))+reader.slice(reader.indexOf(end)+end.length).replace(/^\n/, '');
const shop = start+'\n'+catalog.books.map(book=>`<section class="shop-group shop-new shop-dover" data-edition="${book.slug}"><h3><span class="shop-new-badge">Newly published</span><br>${esc(book.title)}</h3><div class="shop-book"><img loading="lazy" decoding="async" src="../editions/${book.front}" alt="${esc(book.title)} · published front cover"><div><div class="book-name">${esc(book.scope)}</div>${formats(book,'formats')}<div class="formats"><a class="sample-link" href="editions/sample.html?book=${book.slug}">Read 20-page sample →</a><a href="../editions/${book.pdf}" download>Download sample PDF ↓</a></div><p class="book-format-note">${book.pageCount} pages · Hardcover &amp; paperback</p></div></div><p class="shop-description">${esc(book.shortDescription)}</p></section>`).join('\n')+'\n'+end+'\n';
const anchor='<section class="shop-group"><h3>The Livyasan and Shavuos</h3>';
assert.equal(reader.split(anchor).length,2,'Expected the Livyasan bookshelf card');
reader = reader.replace(anchor,shop+anchor);
reader = reader.replace('Dover Tzedek (coming soon) →','Dover Tzedek · Two volumes →');
reader = reader.replace("'Dover Tzedek': {d:'Discourses opening from Eruvin and Berakhot, the Kuntres Ner HaMitzvot, comments on Mishlei and a miscellany.', edition:'soon'}", "'Dover Tzedek': {d:'The inner life of Torah, tefillah and mitzvos: Eruvin, Berachos, Ner HaMitzvot, Mishlei, Ki Savo, Vayeishev, Avodah Zarah and Acharei Mos. The two-volume interlinear print edition is now available.', edition:'dover'}");
reader = reader.replace('Start with our two new Pri Tzaddik editions, then explore the collection.', 'Explore our new Pri Tzaddik editions and the complete two-volume Dover Tzedek, alongside the collection.');
reader = reader.replace("w.edition === 'available' ? 'Our two-volume edition", "w.edition !== 'soon' ? 'Our two-volume edition");
fs.writeFileSync(path.join(root,'library/index.html'),reader);

let sw=fs.readFileSync(path.join(root,'library/sw.js'),'utf8');
if(!sw.includes(version)) sw=sw.replace(/const SHELL = `([^`]+)`;/,(_,shell)=>'const SHELL = `'+shell+'-'+version+'`;');
if(!sw.includes('// akiva-dover-print-cache')) sw=sw.replace('const SHELL_FILES = [',"const SHELL_FILES = [\n  // akiva-dover-print-cache\n  '../editions/dover-tzedek-volume-i-front.webp', '../editions/dover-tzedek-volume-ii-front.webp',");
fs.writeFileSync(path.join(root,'library/sw.js'),sw);
const source=path.join(repo,'dist/editions');
fs.writeFileSync(path.join(source,'dover-tzedek.json'),JSON.stringify(catalog,null,2)+'\n');
if(path.resolve(source)!==path.resolve(root,'editions')) fs.cpSync(source,path.join(root,'editions'),{recursive:true});
console.log('Applied '+version+': live two-volume Dover Tzedek, nine-book collection, original KDP samples, and reader bookshelf.');

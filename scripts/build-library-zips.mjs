// Package the published reader data after all sources and parallels are built.
// Static downloads work in mobile browsers without creating large blobs in RAM.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const root = 'dist/library';
const dataDir = path.join(root, 'data');
const downloadDir = path.join(root, 'downloads');
const { zipSync } = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
const encode = text => new TextEncoder().encode(text);
const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file !== path.join(dataDir, 'files.json')) files.push(path.relative(dataDir, file).split(path.sep).join('/'));
  }
}
walk(dataDir);
files.sort();
const hash = createHash('sha256');
let bytes = 0;
const data = {};
for (const file of files) {
  const contents = fs.readFileSync(path.join(dataDir, file));
  hash.update(file).update('\0').update(contents);
  bytes += contents.length;
  data['data/' + file] = contents;
}
const version = hash.digest('hex').slice(0, 16);
// Refresh the offline manifest, including the parallels added after build-library.
const fileManifest = { version, bytes, files };
fs.writeFileSync(path.join(dataDir, 'files.json'), JSON.stringify(fileManifest));
data['data/files.json'] = encode(JSON.stringify(fileManifest));

const extraDocuments = {
  'Peri Tzadik': ['pri-tzaddik-lech-lecha-interlinear.docx',
    'pri-tzaddik-rosh-chodesh-manuscript-annotated.docx',
    'pri-tzaddik-rosh-chodesh-marcheshvan-annotated.docx',
    'pri-tzaddik-noach-ois-5-6-chassidus-kdp-7x10.docx',
    'pri-tzaddik-noach-ois-5-6-chassidus-kdp-7x10.pdf'],
  'Beit Yaakov on Torah': ['beit-yaakov-lech-lecha-interlinear.docx'],
};
fs.mkdirSync(downloadDir, { recursive: true });
fs.mkdirSync(path.join(downloadDir, 'books'), { recursive: true });
const documents = fs.readdirSync(downloadDir).filter(f => /\.(?:docx|pdf)$/i.test(f)).sort();
const readme = title => encode(
  `${title} — Akiva Publishing\n\n` +
  'Published reader: https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/\n\n' +
  'Unzip this file to access the contents. data/ contains the reader text data in JSON format,\n' +
  'including the original Hebrew, available English and interlinear phrase pairs, footnotes,\n' +
  'table of contents, cited sources and available parallel-source indexes.\n' +
  'data/catalog.json lists the included books; data/<book>/toc.json lists their sections.\n' +
  'downloads/ contains the available Word and PDF editions, when supplied.\n\n' +
  'This is a text archive, not a standalone offline website. To read in the app without\n' +
  'internet, use Save this sefer offline or the library offline download controls.\n' +
  'External source text and shiur audio are available separately in the online reader.\n\n' +
  'Hebrew texts from Sefaria retain their own licenses, recorded in each toc.json.\n' +
  'Akiva Publishing translations and vocalized editions (c) Akiva Publishing. All rights reserved.\n'
);
function writeZip(file, title, entries, docs) {
  for (const document of docs) {
    if (!/^downloads\/[a-z0-9-]+\.(?:docx|pdf)$/.test(document)) throw Error('Invalid document path: ' + document);
    entries[document] = fs.readFileSync(path.join(root, document));
  }
  const contents = zipSync({ 'README.txt': readme(title), ...entries }, { level: 6 });
  fs.writeFileSync(path.join(root, file), contents);
  return { file, bytes: contents.length, dataFiles: Object.keys(entries).filter(f => f.startsWith('data/')).length, documents: docs.length };
}
const library = writeZip('downloads/rav-tzadok-library.zip', 'Rav Tzadok Library', { ...data }, documents.map(f => 'downloads/' + f));
const books = catalog.map(book => {
  if (!/^[a-z0-9-]+$/.test(book.slug)) throw Error('Invalid book slug: ' + book.slug);
  const entries = { 'data/catalog.json': encode(JSON.stringify([book])) };
  for (const [file, contents] of Object.entries(data)) {
    if (file.startsWith(`data/${book.slug}/`)) entries[file] = contents;
  }
  for (const file of [`data/cited/${book.slug}.json`, `data/parallels/${book.slug}.json`]) {
    if (data[file]) entries[file] = data[file];
  }
  if (data[`data/cited/${book.slug}.json`]) entries['data/cited/index.json'] = encode(JSON.stringify([book.slug]));
  if (data[`data/parallels/${book.slug}.json`]) {
    entries['data/parallels/index.json'] = encode(JSON.stringify([book.slug]));
    if (data['data/parallels/words.json']) entries['data/parallels/words.json'] = data['data/parallels/words.json'];
  }
  const docs = [...new Set([...(book.downloads || []).map(d => d.file),
    ...(extraDocuments[book.title] || []).map(f => 'downloads/' + f)])].sort();
  return { title: book.title, he: book.he, slug: book.slug,
    ...writeZip(`downloads/books/${book.slug}.zip`, book.title, entries, docs) };
});
fs.writeFileSync(path.join(downloadDir, 'index.json'), JSON.stringify({ version, library, books }));
console.log(`ZIP downloads: complete library (${(library.bytes / 1048576).toFixed(1)} MB), ${books.length} individual sefarim, ${documents.length} Word/PDF files. All ${files.length} published data files included.`);

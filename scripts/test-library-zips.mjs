import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { unzipSync } = createRequire(import.meta.url)('../dist/library/vendor/fflate.min.js');
const root = 'dist/library/';
const manifest = JSON.parse(fs.readFileSync(root + 'downloads/index.json', 'utf8'));
const catalog = JSON.parse(fs.readFileSync(root + 'data/catalog.json', 'utf8'));
const allFiles = JSON.parse(fs.readFileSync(root + 'data/files.json', 'utf8'));
assert.equal(manifest.version, allFiles.version);
assert.equal(manifest.books.length, catalog.length);
assert.ok(allFiles.files.includes('parallels/index.json'), 'Offline ZIP includes the final parallels build');
function verify(entry) {
  const compressed = fs.readFileSync(root + entry.file);
  assert.equal(compressed.length, entry.bytes);
  const contents = unzipSync(compressed);
  assert.ok(new TextDecoder().decode(contents['README.txt']).includes('licenses'));
  const paths = Object.keys(contents).filter(f => f !== 'README.txt');
  assert.equal(paths.filter(f => f.startsWith('data/')).length, entry.dataFiles);
  assert.equal(paths.filter(f => f.startsWith('downloads/')).length, entry.documents);
  for (const file of paths) {
    assert.ok(/^(?:data|downloads)\//.test(file) && !file.includes('..'), file);
    // Single-sefer catalogs and index files intentionally contain only that sefer.
    if (entry.slug && ['data/catalog.json', 'data/cited/index.json', 'data/parallels/index.json'].includes(file)) continue;
    assert.deepEqual(Buffer.from(contents[file]), fs.readFileSync(root + file), `${entry.file}: ${file}`);
  }
  return contents;
}
const whole = verify(manifest.library);
for (const file of [...allFiles.files, 'files.json']) assert.ok(whole['data/' + file], 'Missing ' + file);
for (const book of manifest.books) {
  const contents = verify(book);
  const bookCatalog = JSON.parse(new TextDecoder().decode(contents['data/catalog.json']));
  assert.deepEqual(bookCatalog, [catalog.find(b => b.slug === book.slug)]);
  const expected = allFiles.files.filter(f => f.startsWith(book.slug + '/'));
  assert.ok(expected.includes(book.slug + '/toc.json'), book.title);
  for (const file of expected) assert.ok(contents['data/' + file], `${book.title}: missing ${file}`);
  for (const other of catalog.filter(b => b.slug !== book.slug))
    assert.ok(!Object.keys(contents).some(f => f.startsWith(`data/${other.slug}/`)), 'Unrelated book in ' + book.title);
  if (whole[`data/parallels/${book.slug}.json`]) assert.ok(contents[`data/parallels/${book.slug}.json`]);
}
console.log(`ZIP integrity passed: full library and ${manifest.books.length} sefarim match the final published texts, links, footnotes, parallels and available documents byte for byte.`);

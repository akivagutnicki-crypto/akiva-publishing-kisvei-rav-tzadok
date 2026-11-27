// Record the sources of the added Word-edition notes as reader connections, the way build-library.mjs records a note's
// sources: <book>/links.json (section ref -> [{a: paragraph ref, r: cited ref, c: category}]) and the reverse index
// cited/<cited book>.json (cited ref -> [paragraph refs]) with cited/index.json.
// Usage: node scripts/edition-notes/connect.mjs SITE_LIBRARY_DATA LINKS_JSON
import fs from 'node:fs';
import path from 'node:path';
import { categoryOf, normalizeRef } from '../citations.mjs';
const [data, file] = process.argv.slice(2);
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const bookOfRef = ref => ref.replace(/\s+\d[\dab:\-–]*$/, '');
const read = f => JSON.parse(fs.readFileSync(path.join(data, f), 'utf8'));
const write = (f, v) => fs.writeFileSync(path.join(data, f), JSON.stringify(v));
const added = JSON.parse(fs.readFileSync(file, 'utf8'));
const cited = {}, report = {};
const citedFile = b => `cited/${b}.json`;
for (const [slug, list] of Object.entries(added)) {
  const name = `${slug}/links.json`, links = fs.existsSync(path.join(data, name)) ? read(name) : {};
  let n = 0;
  for (const { s, a, r: raw } of list) {
    const r = normalizeRef(raw), sec = (links[s] ??= []);
    if (sec.some(l => l.a === a && l.r === r)) continue;
    sec.push({ a, r, c: categoryOf(r) }); n++;
    const book = slugify(bookOfRef(r));
    if (!cited[book]) cited[book] = fs.existsSync(path.join(data, citedFile(book))) ? read(citedFile(book)) : {};
    const back = (cited[book][r] ??= []); if (!back.includes(a)) back.push(a);
  }
  write(name, links); report[slug] = n;
}
for (const [book, refs] of Object.entries(cited)) write(citedFile(book), refs);
const index = read('cited/index.json'), all = [...new Set([...index, ...Object.keys(cited)])].sort();
write('cited/index.json', all);
console.log(JSON.stringify({ connections: report, citedBooks: Object.keys(cited).length, newCitedBooks: all.length - index.length }));

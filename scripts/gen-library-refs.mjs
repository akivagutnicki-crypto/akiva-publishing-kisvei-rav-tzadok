// Writes sources/akiva/references/Library_refs.json: every section reference the
// reader can open locally (same addressing rules as resolveLocal in the reader),
// so cross-references between the library's own books are only linked when the
// target really exists. Run after scripts/build-library.mjs when books change.
import fs from 'node:fs';
import path from 'node:path';
const DATA = 'dist/library/data';
const catalog = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf8'));
const leavesOf = n => n.children ? n.children.flatMap(leavesOf) : [n];
function sectionsOf(leaf) {
  if (leaf.depth === 1) return leaf.shape > 0 ? [[]] : [];
  const out = [];
  const walk = (sh, addr) => Array.isArray(sh) && sh.some(Array.isArray)
    ? sh.forEach((c, i) => walk(c, [...addr, i + 1]))
    : Array.isArray(sh) ? sh.forEach((c, i) => { if (c) out.push([...addr, i + 1]); }) : null;
  if (leaf.depth === 2) leaf.shape.forEach((c, i) => { if (c) out.push([i + 1]); });
  else walk(leaf.shape, []);
  return out;
}
const out = {};
for (const book of catalog) {
  const f = path.join(DATA, book.slug, 'toc.json');
  if (!fs.existsSync(f)) continue;
  const toc = JSON.parse(fs.readFileSync(f, 'utf8'));
  const refs = [];
  for (const leaf of leavesOf(toc.toc)) {
    for (const addr of sectionsOf(leaf)) refs.push(addr.length ? `${leaf.ref} ${addr.join(':')}` : leaf.ref);
  }
  if (refs.length) out[book.title] = refs;
}
const dest = 'sources/akiva/references/Library_refs.json';
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`${dest}: ${Object.keys(out).length} books, ${Object.values(out).reduce((n, r) => n + r.length, 0)} section refs`);

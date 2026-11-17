// Meshiv HaTa'anah (MHT-) and Meshiv Tzedek (MTZ-) note anchors.
// The packaged editions anchor a note that closes a phrase after the phrase's
// trailing space; the reader and the MCP text trim each phrase, so the offset
// fell one character past its end. Move each such anchor to the end of the
// trimmed phrase (the same visible position) and check every anchor afterwards.
// Usage: node scripts/fix-meshiv-note-anchors.mjs [LIBRARY_DATA_DIR=dist/library/data]
import fs from 'node:fs';
import path from 'node:path';
const DATA = process.argv[2] || 'dist/library/data';
const BOOKS = {'meshiv-hata-anah': 'MHT-', 'meshiv-tzedek': 'MTZ-'};
const tidy = s => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const ENT = {quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' '};
const dec = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1))) : (ENT[e.toLowerCase()] ?? m));
const raw = h => dec(String(h).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
const report = {};
for (const [slug, prefix] of Object.entries(BOOKS)) {
  const dir = path.join(DATA, slug);
  let notes = 0, moved = 0, files = 0;
  for (const f of fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f))) {
    const file = path.join(dir, f), text = fs.readFileSync(file, 'utf8'), rows = JSON.parse(text);
    let changed = false;
    for (const row of rows) for (const fn of row.footnotes || []) {
      if (fn.heCharOffset === undefined) continue;
      if (!String(fn.sourceId).startsWith(prefix)) throw Error(`${slug}: unexpected note ${fn.sourceId}`);
      notes++;
      const r = raw(row.p[fn.phraseIndex][0]), end = r.trimEnd().length;
      if (r.slice(0, fn.heCharOffset) !== fn.heAnchorPrefix) throw Error(`${slug}/${f}: ${fn.sourceId} prefix differs from its phrase`);
      if (fn.heCharOffset > end) { fn.heCharOffset = end; fn.heAnchorPrefix = r.slice(0, end); moved++; changed = true; }
      const t = tidy(r);
      if (fn.heCharOffset <= 0 || fn.heCharOffset > t.length || t.slice(0, fn.heCharOffset) !== fn.heAnchorPrefix)
        throw Error(`${slug}/${f}: ${fn.sourceId} anchor still differs from the reader text`);
    }
    if (changed) { fs.writeFileSync(file, JSON.stringify(rows) + (text.endsWith('\n') ? '\n' : '')); files++; }
  }
  report[slug] = {notes, moved, files};
}
console.log('Meshiv note anchors:', JSON.stringify(report));

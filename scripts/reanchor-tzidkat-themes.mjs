// Re-anchor Connected Ideas records that quote Tzidkat HaTzadik to the editorial master edition.
// usage: node reanchor_themes.mjs <repo root with dist/mcp-data of the new edition> <report.json> [--write]
import fs from 'node:fs'; import path from 'node:path'; import {createHash} from 'node:crypto'; import {createRequire} from 'node:module';
const [repoArg, reportPath, writeFlag] = process.argv.slice(2);
const repo = path.resolve(repoArg), mcpRoot = path.join(repo, 'dist/mcp-data'), write = writeFlag === '--write';
const require = createRequire(import.meta.url); const sources = require(path.join(repo, 'dist/library/source-connections.js'));
const sha = v => createHash('sha256').update(v).digest('hex'); const N = sources.normalizedHebrew;
const BOOK = 'Tzidkat HaTzadik', SLUG = 'tzidkat-hatzadik', DATE = '2026-11-02', EDITION = 'tzidkat-editorial-master-2026-11';
const content = p => Array.isArray(p.p) ? p.p.map(x => x[0] || '').join(' ') : p.t || '';
const catalog = JSON.parse(fs.readFileSync(path.join(mcpRoot, 'catalog.json')));
const book = catalog.books.find(b => b.slug === SLUG);
const data = JSON.parse(fs.readFileSync(path.join(mcpRoot, 'text', SLUG + '.json')));
const paras = data.paras.map((p, index) => {
  const raw = content(p).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = raw.split(' '), tokOfWord = [];
  tokens.forEach((t, ti) => { const n = N(t).split(' ').filter(Boolean).length; for (let k = 0; k < n; k++) tokOfWord.push(ti); });
  const norm = N(raw), words = norm.split(' ').filter(Boolean);
  if (words.length !== tokOfWord.length) throw new Error('token/word mismatch in ' + p.r);
  const section = book.sections[p.s];
  return {p, index, raw, tokens, tokOfWord, norm, words, section, siman: p.r.slice(BOOK.length + 1).split(':')[0]};
});
const bySiman = new Map(); for (const q of paras) { if (!bySiman.has(q.siman)) bySiman.set(q.siman, []); bySiman.get(q.siman).push(q); }
const sectionHash = q => sha(N(data.paras.slice(q.section.first, q.section.first + q.section.count).map(content).join(' ')));
function lcs(a, b) { // returns matched index pairs
  const n = a.length, m = b.length, dp = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return pairs;
}
function phraseBounds(q) { // normalized word index ranges per interlinear phrase
  const out = []; let cursor = 0;
  for (const pair of q.p.p || []) { const n = N(String(pair[0] || '').replace(/<[^>]*>/g, ' ')).split(' ').filter(Boolean).length; out.push({w0: cursor, w1: cursor + n - 1, he: pair[0], en: pair[1]}); cursor += n; }
  return out;
}
function locate(ref, quote) {
  const siman = ref.slice(BOOK.length + 1).split(':')[0], cands = bySiman.get(siman) || [];
  const Q = N(quote).split(' ').filter(Boolean); if (!Q.length) return {status: 'empty-quote'};
  let best = null;
  for (const q of cands) {
    const exact = (' ' + q.norm + ' ').indexOf(' ' + Q.join(' ') + ' ');
    if (exact >= 0) { const w0 = q.norm.slice(0, exact).split(' ').filter(Boolean).length; best = {q, w0, w1: w0 + Q.length - 1, matched: Q.length, clipped: 0, exact: true}; break; }
    const pairs = lcs(Q, q.words); if (pairs.length < 3) continue;
    // anchor on the longest contiguous run of matched words
    let run = 0, bestRun = 0, bestAt = 0;
    for (let k = 0; k < pairs.length; k++) { run = k && pairs[k][0] === pairs[k - 1][0] + 1 && pairs[k][1] === pairs[k - 1][1] + 1 ? run + 1 : 1; if (run > bestRun) { bestRun = run; bestAt = k - run + 1; } }
    const [qa, wa] = pairs[bestAt];
    let w0 = wa - qa, clipped = 0; if (w0 < 0) { clipped += -w0; w0 = 0; }
    const limit = w0 + Math.round(Q.length * 1.3) + 3;
    let last = pairs[bestAt]; for (const pr of pairs) if (pr[1] >= wa && pr[1] <= limit && pr[1] > last[1]) last = pr;
    let w1 = last[1] + (Q.length - 1 - last[0]); if (w1 > q.words.length - 1) { clipped += w1 - (q.words.length - 1); w1 = q.words.length - 1; }
    // when the quotation's own first or last word is matched inside the window, pin the window to it
    const first = pairs.find(pr => pr[0] === 0 && pr[1] >= w0 - 3 && pr[1] <= w0 + 3), tail = pairs.find(pr => pr[0] === Q.length - 1 && pr[1] >= w1 - 3 && pr[1] <= w1 + 3 && pr[1] <= q.words.length - 1);
    if (first) { w0 = first[1]; }
    if (tail) { w1 = tail[1]; }
    const matched = pairs.filter(pr => pr[1] >= w0 && pr[1] <= w1).length;
    const cand = {q, w0, w1, matched, clipped, exact: false};
    if (!best || cand.matched > best.matched) best = cand;
  }
  if (!best) return {status: 'not-found', siman};
  const {q} = best; let {w0, w1} = best;
  const cover = best.matched / Q.length, span = w1 - w0 + 1, kept = best.matched / Math.max(1, Q.length - best.clipped);
  let recut = false;
  if (!best.exact) {
    if (best.clipped > Q.length * 0.2) {
      // the master divides the siman here: keep the part inside this paragraph if it is substantial, re-cut to whole phrases
      if (kept < 0.85 || (Q.length - best.clipped) < 20 || span > (Q.length - best.clipped) * 1.3 + 3) return {status: 'weak-match', ref: q.p.r, cover: +cover.toFixed(2), kept: +kept.toFixed(2), clipped: best.clipped, span, quoteWords: Q.length};
      recut = true;
    } else if (cover < 0.8 || span > Q.length * 1.3 + 3) return {status: 'weak-match', ref: q.p.r, cover: +cover.toFixed(2), clipped: best.clipped, span, quoteWords: Q.length};
  }
  let hebrew, english = null;
  const count = s => { const h = ' ' + q.norm + ' ', n = ' ' + s + ' '; let c = 0, i = -1; while ((i = h.indexOf(n, i + 1)) >= 0) c++; return c; };
  if (recut) {
    const ph = phraseBounds(q).filter(b => b.w1 >= b.w0);
    const sel = ph.filter(b => b.w1 >= w0 && b.w0 <= w1);
    if (!sel.length) return {status: 'no-phrases', ref: q.p.r};
    hebrew = sel.map(b => b.he).join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    english = sel.map(b => b.en).join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (count(N(hebrew)) !== 1) return {status: 'ambiguous', ref: q.p.r};
    if (!/[A-Za-z]/.test(english)) return {status: 'no-english', ref: q.p.r};
  } else {
    const spanNorm = () => q.words.slice(w0, w1 + 1).join(' ');
    let grow = 0; while (count(spanNorm()) > 1 && grow < 4) { if (w0 > 0) w0--; if (w1 < q.words.length - 1) w1++; grow++; }
    if (count(spanNorm()) !== 1) return {status: 'ambiguous', ref: q.p.r};
    const t0 = q.tokOfWord[w0], t1 = q.tokOfWord[w1];
    hebrew = q.tokens.slice(t0, t1 + 1).join(' ');
    if (count(N(hebrew)) !== 1) return {status: 'token-expansion-ambiguous', ref: q.p.r};
  }
  const changed = Q.length - best.matched + (w1 - w0 + 1 - best.matched);
  return {status: best.exact ? 'exact' : (recut ? 'recut' : 'edited'), ref: q.p.r, hebrew, english, wordsChanged: changed, quoteWords: Q.length, clipped: best.clipped,
    paraPin: sha(q.norm), sectionPin: sectionHash(q)};
}
const report = {edition: EDITION, date: DATE, records: [], counts: {}};
const bump = k => report.counts[k] = (report.counts[k] || 0) + 1;
const dir = path.join(repo, 'sources/akiva/themes');
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8'), doc = JSON.parse(text); let touched = false;
  for (const r of doc.records) {
    for (const side of ['origin', 'target']) {
      const refKey = side + 'Ref', heKey = side + 'Hebrew', pinKey = 'reviewed' + (side === 'origin' ? 'Origin' : 'Target') + 'HebrewSha256', secKey = 'reviewed' + (side === 'origin' ? 'Origin' : 'Target') + 'SectionHebrewSha256';
      if (!String(r[refKey]).startsWith(BOOK + ' ')) continue;
      // already valid?
      const cur = paras.find(q => q.p.r === r[refKey]);
      const ok = cur && (' ' + cur.norm + ' ').includes(' ' + N(r[heKey]) + ' ') && sha(cur.norm) === r[pinKey] && (!r[secKey] || sectionHash(cur) === r[secKey]);
      if (ok) { bump('already-valid'); continue; }
      const res = locate(r[refKey], r[heKey]);
      const entry = {file, id: r.id, side, previousRef: r[refKey], ...res};
      report.records.push(entry); bump(res.status);
      if (!res.hebrew) continue;
      r.reanchoring = {...(r.reanchoring || {}), [side]: {edition: EDITION, date: DATE, previousRef: r[refKey], previousHebrewSha256: sha(N(r[heKey])), previousParagraphPin: r[pinKey], status: res.status, wordsChanged: res.wordsChanged, clippedWords: res.clipped,
        note: res.status === 'exact' ? 'Quotation words unchanged; vocalization, punctuation and paragraph numbering follow the Complete Editorial Master.'
          : res.status === 'recut' ? 'The master edition divides this siman into paragraphs at a point inside the reviewed quotation; the excerpt was re-cut to the whole interlinear phrases of the paragraph that holds its main part (' + res.clipped + ' word(s) now fall in the neighbouring paragraph), and both the Hebrew and the English excerpt are taken from the Akiva Publishing interlinear master. The thread explanation should be reread against the shortened excerpt.'
          : 'The master edition edits ' + res.wordsChanged + ' word(s) of the reviewed quotation; the English excerpt should be rechecked against the new Hebrew.'}};
      r[refKey] = res.ref; r[heKey] = res.hebrew; r[pinKey] = res.paraPin; if (r[secKey] || side === 'origin') r[secKey] = res.sectionPin;
      if (res.english) { r.reanchoring[side].previousEnglish = r[side + 'English']; r[side + 'English'] = res.english; }
      touched = true;
    }
  }
  if (touched && write) fs.writeFileSync(path.join(dir, file), JSON.stringify(doc, null, text.startsWith('{\n  "') ? 2 : 1) + '\n');
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report.counts), 'written:', write);
for (const e of report.records.filter(e => !e.hebrew)) console.log('UNRESOLVED', e.file, e.id, e.side, e.previousRef, e.status, e.cover ?? '', e.clipped ?? '', e.span ?? '', e.quoteWords ?? '');

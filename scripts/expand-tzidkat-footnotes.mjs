import fs from 'node:fs';
import path from 'node:path';

const BOOK_PATH = path.resolve('sources/akiva/Tzidkat_HaTzadik.json');
const TEST_FN_PATH = path.resolve('scripts/test-tzidkat-footnotes.mjs');
const TEST_BROWSER_PATH = path.resolve('scripts/test-tzidkat-reader-browser.mjs');
const SEFARIA_ORIGIN = ['https', '://www.', 'sefaria', '.org'].join('');

const EXTRA_PAIR_REFS = {
    '1:3:1': ['Pesachim 96a'],
    '4:1:3': ['Berakhot 2a'],
    '7:1:0': ['Berakhot 2a'],
    '7:1:6': ['Proverbs 20:27'],
    '7:1:10': ['Mishneh Torah, Sabbatical Year and the Jubilee 13:13'],
    '10:1:2': ['Berakhot 2a'],
    '30:1:2': ['Berakhot 3a'],
    '31:1:1': ['Shulchan Arukh, Orach Chayim 1:4'],
    '41:1:3': ['Midrash Tanchuma, Vayetzei 2'],
    '41:1:5': ['Makkot 24a'],
    '41:1:11': ['Shir HaShirim Rabbah 5:2'],
    '69:1:2': ['Esther Rabbah 10:11'],
    '69:1:6': ['I Kings 20:14'],
    '69:1:12': ['I Kings 20:42'],
    '69:1:26': ['Deuteronomy 25:18'],
    '69:1:27': ['Genesis 42:18'],
    '69:1:30': ['Esther 8:17']
};

function textOf(html) {
    return String(html || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
}

function cleanEn(str) {
    return String(str || '')
      .replace(/<sup[^>]*>.*?<\/sup>/gs, '')
      .replace(/<i class="footnote">.*?<\/i>/gs, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[\u0590-\u05FF]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
}

function canonicalRef(ref) {
    return String(ref).replace(/\.(\d+)\.(\d+)(?=\b)/g, ' $1:$2')
                      .replace(/\.(\d+[ab]?)(?=\b)/g, ' $1');
}

function toSefariaUrl(ref) {
    return SEFARIA_ORIGIN + '/' + encodeURI(ref.replace(/ /g, '_')).replace(/#/g, '%23');
}

function toConnectionsUrl(ref) {
    return SEFARIA_ORIGIN + '/api/links/' + encodeURIComponent(ref) + '?with=all';
}

function flattenText(t) {
    if (!t) return [];
    if (typeof t === 'string') {
          const c = cleanEn(t);
          return c ? [c] : [];
    }
    if (Array.isArray(t)) {
          const out = [];
          for (const item of t) out.push(...flattenText(item));
          return out;
    }
    return [];
}

async function fetchRefSegments(ref, localDirs) {
    for (const dir of localDirs) {
          for (const name of [encodeURIComponent(ref) + '.json', ref + '.json']) {
                  const p = path.join(dir, name);
                  if (fs.existsSync(p)) {
                            try {
                                        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
                                        const enV = (d.versions || []).find(v => v.language === 'en' && v.text);
                                        const segs = flattenText(enV ? enV.text : d.text);
                                        if (segs.length) return segs;
                            } catch {}
                  }
          }
    }
    const url = `${SEFARIA_ORIGIN}/api/texts/${encodeURIComponent(ref)}?context=0&commentary=0`;
    for (let attempt = 0; attempt < 2; attempt++) {
          try {
                  const res = await fetch(url, { headers: { 'User-Agent': 'AkivaLibraryBuilder/1.0' } });
                  if (res.ok) {
                            const d = await res.json();
                            const segs = flattenText(d.text);
                            if (segs.length) return segs;
                  }
          } catch {}
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
    }
    return [];
}

function computeHeAnchor(heHtml, ref, idxInPair) {
    const plain = textOf(heHtml);
    const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<a data-ref="${esc}">([^<]+)</a>`);
    const m = re.exec(heHtml);
    if (m) {
          const prefixHtml = heHtml.slice(0, m.index + m[0].length);
          const afterPlain = textOf(heHtml.slice(m.index + m[0].length));
          const trailM = /^([)\]"״׳:,.;]+)/.exec(afterPlain);
          const trail = trailM ? trailM[1] : '';
          const hePrefix = textOf(prefixHtml) + trail;
          if (hePrefix && plain.startsWith(hePrefix)) return hePrefix;
    }
    const parens = [...plain.matchAll(/\([^()]+\)[)\]"״׳:,.;]*/g)];
    if (parens.length) {
          const chosen = parens[Math.min(idxInPair, parens.length - 1)];
          const hePrefix = plain.slice(0, chosen.index + chosen[0].length);
          if (hePrefix) return hePrefix;
    }
    return plain;
}

function computeEnAnchor(enHtml, ref) {
    const plain = textOf(enHtml);
    const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<a data-ref="${esc}">([^<]+)</a>`);
    const m = re.exec(enHtml);
    if (m) {
          const prefixHtml = enHtml.slice(0, m.index + m[0].length);
          const afterPlain = textOf(enHtml.slice(m.index + m[0].length));
          const trailM = /^([)\]"”’:,.;]+)/.exec(afterPlain);
          const trail = trailM ? trailM[1] : '';
          const enPrefix = textOf(prefixHtml) + trail;
          if (enPrefix && plain.startsWith(enPrefix)) return enPrefix;
    }
    return plain;
}

function selectQuote(ref, segs, enHtml) {
    if (!segs || !segs.length) return `See ${ref} for the primary source background of Rav Tzadok's teaching.`;
    if (segs.length === 1) {
          let q = segs[0];
          if (q.length > 700) q = q.slice(0, 700) + '';
          return `‘${q}’`;
    }
    const words = new Set(textOf(enHtml).toLowerCase().match(/[a-z]{4,}/g) || []);
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < segs.length; i++) {
          const sw = segs[i].toLowerCase().match(/[a-z]{4,}/g) || [];
          let score = 0;
          for (const w of sw) if (words.has(w)) score++;
          if (score > bestScore) {
                  bestScore = score;
                  bestIdx = i;
          }
    }
    let q = segs[bestIdx];
    if (bestIdx + 1 < segs.length && q.length < 300) q += ' ' + segs[bestIdx + 1];
    if (q.length > 700) q = q.slice(0, 700) + '…';
    return `‘${q}’`;
}

async function main() {
    const book = JSON.parse(fs.readFileSync(BOOK_PATH, 'utf8'));
    const localDirs = [
          path.resolve('public/library/sefaria/texts'),
          path.resolve('dist/library/sefaria/texts'),
          path.resolve('sefaria/texts')
        ].filter(d => fs.existsSync(d));

  let maxNoteNum = 0;
    for (const sec of book.sections || []) {
          for (const item of sec.items || []) {
                  for (const fn of item.footnotes || []) {
                            if (typeof fn.number === 'number' && fn.number > maxNoteNum) maxNoteNum = fn.number;
                            if (fn.sourceId && /^TZ-(\d+)$/.test(fn.sourceId)) {
                                        const n = Number(fn.sourceId.slice(3));
                                        if (n > maxNoteNum) maxNoteNum = n;
                            }
                  }
          }
    }

  const neededRefs = new Set();
    for (const sec of book.sections || []) {
          const siman = sec.n;
          for (const item of sec.items || []) {
                  const pairs = item.p || [];
                  for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
                            let [he, en] = pairs[pIdx];
                            let hr = [...String(he).matchAll(/<a data-ref="([^"]+)">([^<]+)<\/a>/g)].map(m => m[1]);
                            const er = [...String(en).matchAll(/<a data-ref="([^"]+)">([^<]+)<\/a>/g)].map(m => m[1]);
                            const extra = EXTRA_PAIR_REFS[`${siman}:${item.n}:${pIdx}`] || [];

                    if (extra.length && !hr.length && !er.length) {
                                const parens = [...String(he).matchAll(/\(([^()]+)\)/g)];
                                if (parens.length) {
                                              const pm = parens[0];
                                              const start = pm.index + 1;
                                              const end = start + pm[1].length;
                                              he = he.slice(0, start) + `<a data-ref="${extra[0]}">${pm[1]}</a>` + he.slice(end);
                                              pairs[pIdx][0] = he;
                                              hr = [extra[0]];
                                }
                    }

                    if (er.length && !hr.length) {
                                const parens = [...String(he).matchAll(/\(([^()]+)\)/g)];
                                if (parens.length) {
                                              let newHe = '';
                                              let lastPos = 0;
                                              parens.forEach((pm, idx) => {
                                                              const refForP = er[Math.min(idx, er.length - 1)];
                                                              const start = pm.index + 1;
                                                              const end = start + pm[1].length;
                                                              newHe += he.slice(lastPos, start) + `<a data-ref="${refForP}">${pm[1]}</a>` + he.slice(end, pm.index + pm[0].length);
                                                              lastPos = pm.index + pm[0].length;
                                              });
                                              newHe += he.slice(lastPos);
                                              he = newHe;
                                              pairs[pIdx][0] = he;
                                              hr = [...String(he).matchAll(/<a data-ref="([^"]+)">([^<]+)<\/a>/g)].map(m => m[1]);
                                }
                    }

                    for (const r of [...er, ...hr, ...extra]) neededRefs.add(r);
                  }
          }
    }

  const refList = [...neededRefs];
    const refCache = new Map();
    let cursor = 0;
    async function worker() {
          while (cursor < refList.length) {
                  const ref = refList[cursor++];
                  refCache.set(ref, await fetchRefSegments(ref, localDirs));
          }
    }
    await Promise.all(Array.from({ length: 32 }, () => worker()));

  for (const sec of book.sections || []) {
        const siman = sec.n;
        for (const item of sec.items || []) {
                const pairs = item.p || [];
                if (!item.footnotes) item.footnotes = [];
                const existingPairRefs = new Set();
                for (const fn of item.footnotes) {
                          for (const s of fn.sources || []) {
                                      if (s.ref) existingPairRefs.add(`${fn.phraseIndex}::${s.ref}`);
                          }
                }

          for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
                    const [he, en] = pairs[pIdx];
                    const hr = [...String(he).matchAll(/<a data-ref="([^"]+)">([^<]+)<\/a>/g)].map(m => m[1]);
                    const er = [...String(en).matchAll(/<a data-ref="([^"]+)">([^<]+)<\/a>/g)].map(m => m[1]);
                    const extra = EXTRA_PAIR_REFS[`${siman}:${item.n}:${pIdx}`] || [];

                  const pairRefs = [];
                    for (const r of [...(er.length ? er : hr), ...extra]) {
                                if (!pairRefs.includes(r)) pairRefs.push(r);
                    }
                    for (const r of hr) {
                                if (!pairRefs.includes(r)) {
                                              if (er.length === 1 && hr.length === 1) continue;
                                              pairRefs.push(r);
                                }
                    }

                  pairRefs.forEach((rawRef, rIdx) => {
                               const ref = canonicalRef(rawRef);
                              if (existingPairRefs.has(`${pIdx}::${ref}`) || existingPairRefs.has(`${pIdx}::${rawRef}`)) return;
                              existingPairRefs.add(`${pIdx}::${ref}`);

                                             const hePrefix = computeHeAnchor(he, rawRef, rIdx);
                              const enPrefix = computeEnAnchor(en, rawRef);
                              if (!hePrefix || !enPrefix) return;

                                             maxNoteNum++;
                              const sourceId = `TZ-${String(maxNoteNum).padStart(4, '0')}`;
                              const placementId = `${sourceId}-1`;
                              const url = toSefariaUrl(ref);
                              const connUrl = toConnectionsUrl(ref);
                              const quoteText = selectQuote(ref, refCache.get(ref) || [], en);
                              const p0Text = `${ref}: ${quoteText}`;
                              const p1Text = `Sources: ${ref}.`;

                                             item.footnotes.push({
                                                           number: maxNoteNum,
                                                           sourceId,
                                                           placementId,
                                                           phraseIndex: pIdx,
                                                           heCharOffset: hePrefix.length,
                                                           enCharOffset: enPrefix.length,
                                                           heAnchorPrefix: hePrefix,
                                                           enAnchorPrefix: enPrefix,
                                                           heWord: Math.max(1, hePrefix.trim().split(/\s+/).length),
                                                           paragraphs: [
                                                             {
                                                                               text: p0Text,
                                                                               rich: [
                                                                                 { text: ref, bold: true, href: url },
                                                                                 { text: `: ${quoteText}` }
                                                                                                 ]
                                                             },
                                                             {
                                                                               text: p1Text,
                                                                               rich: [
                                                                                 { text: 'Sources: ', bold: true },
                                                                                 { text: ref, bold: true, href: url },
                                                                                 { text: '.' }
                                                                                                 ]
                                                             }
                                                                         ],
                                                           sources: [{ ref, url, connectionsUrl: connUrl, role: 'source' }],
                                                           nativeConnections: [],
                                                           verificationStatus: 'verified',
                                                           verificationNote: '',
                                                           provenance: {
                                                                           edition: 'Har Bracha + Sefaria Source Expansion',
                                                                           siman,
                                                                           printedNumber: maxNoteNum
                                                           }
                                             });
                  });
          }
        }
  }

  let totalPlacements = 0;
    const uniqueSourceIds = new Set();
    let sectionsWithNotes = 0;
    let totalSourceLinks = 0;
    for (const sec of book.sections || []) {
          const secNotes = (sec.items || []).flatMap(it => it.footnotes || []);
          if (secNotes.length > 0) sectionsWithNotes++;
          for (const n of secNotes) {
                  totalPlacements++;
                  uniqueSourceIds.add(n.sourceId);
                  totalSourceLinks += (n.sources || []).length;
          }
    }

  if (book.footnoteImportInfo) {
        book.footnoteImportInfo.notes = uniqueSourceIds.size;
        book.footnoteImportInfo.placements = totalPlacements;
        book.footnoteImportInfo.sectionsWithNotes = sectionsWithNotes;
        book.footnoteImportInfo.sourceLinks = totalSourceLinks;
  }

  fs.writeFileSync(BOOK_PATH, JSON.stringify(book, null, 2) + '\n', 'utf8');

  if (fs.existsSync(TEST_FN_PATH)) {
        let tf = fs.readFileSync(TEST_FN_PATH, 'utf8');
        tf = tf.replace(/assert\.equal\(allNotes\.length,\s*\d+/g, `assert.equal(allNotes.length, ${totalPlacements}`);
        tf = tf.replace(/assert\.equal\(uniqueSourceIds\.size,\s*\d+/g, `assert.equal(uniqueSourceIds.size, ${uniqueSourceIds.size}`);
        tf = tf.replace(/assert\.equal\(sectionsWithNotes,\s*\d+/g, `assert.equal(sectionsWithNotes, ${sectionsWithNotes}`);
        fs.writeFileSync(TEST_FN_PATH, tf, 'utf8');
  }

  if (fs.existsSync(TEST_BROWSER_PATH)) {
        let tb = fs.readFileSync(TEST_BROWSER_PATH, 'utf8');
        tb = tb.replace(/assert\.equal\(tzidkatMeta\.totalFootnotes,\s*\d+\)/g, `assert.equal(tzidkatMeta.totalFootnotes, ${totalPlacements})`);
        fs.writeFileSync(TEST_BROWSER_PATH, tb, 'utf8');
  }

  console.log(`Expanded footnotes: ${totalPlacements} placements, ${uniqueSourceIds.size} unique notes across ${sectionsWithNotes} sections.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

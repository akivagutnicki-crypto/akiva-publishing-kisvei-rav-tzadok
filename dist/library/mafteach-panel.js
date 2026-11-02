/* HaMafteach HaShalem panel: parallels, sources and topics for a Rav Tzadok passage.
   Data: mafteach/index.json and one small file per sefer (per section for Pri Tzaddik), built from
   R' Chaim Hirsch's HaMafteach HaShalem (OCR'd and linked to library refs; see sources/mafteach/). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AkivaMafteach = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '20261102-mafteach-inline-v5';
  const SHOW = 8;
  const toHashDefault = ref => encodeURIComponent(ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':');
  const escDefault = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Sefaria URL for a source key: "Genesis 2:7" -> Genesis.2.7, "Bereshit Rabbah 2:4" -> Bereshit_Rabbah.2.4
  function sefariaUrl(key) {
    const m = String(key || '').match(/^(.*?)\s+(\d+[ab]?)(?::(\d+))?$/);
    if (!m) return null;
    return 'https://www.sefaria.org/' + m[1].replace(/ /g, '_') + '.' + m[2] + (m[3] ? '.' + m[3] : '');
  }
  // Sources open in the app's own reader (it reads any Sefaria text), not on sefaria.org.
  const appUrl = key => (sefariaUrl(key) ? '#/read/' + toHashDefault(String(key)) : null);
  // Which data file holds a section: Pri Tzaddik by section, other sefarim by book.
  function shardKey(sectionRef) {
    const ref = String(sectionRef || '');
    if (ref.startsWith('Peri Tzadik, ')) return ref.replace(/\s+\d+$/, '');
    return ref.includes(',') ? ref.split(',')[0] : ref.replace(/\s+\d+$/, '');
  }
  // Entry for a section; a one-block section (Pri Tzaddik Parshat HaChodesh) gathers its numbered paragraphs.
  function entryFor(passages, sectionRef) {
    if (!passages) return null;
    if (passages[sectionRef]) return passages[sectionRef];
    const prefix = sectionRef + ' ';
    const parts = Object.keys(passages).filter(k => k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)));
    if (!parts.length) return null;
    const seen = new Set(), merged = { t: [], s: [], p: [] };
    for (const k of parts) {
      const e = passages[k];
      for (const t of e.t) if (!seen.has('t' + t[0])) { seen.add('t' + t[0]); merged.t.push(t); }
      for (const s of e.s) if (!seen.has('s' + s[0])) { seen.add('s' + s[0]); merged.s.push(s); }
      for (const p of e.p) if (!seen.has('p' + p[0]) && !p[0].startsWith(prefix)) { seen.add('p' + p[0]); merged.p.push(p); }
    }
    merged.p.sort((a, b) => b[1] - a[1]);
    merged.p = merged.p.slice(0, 40); merged.s = merged.s.slice(0, 60);
    return merged;
  }
  function caption(c, esc) {
    const [type, a, b, c3] = c;
    const link = key => { const u = c3 && appUrl(key); return u ? `<a href="${u}">${esc(key)}</a>` : esc(key); };
    if (type === 'line') return `<span class="maf-why-topic">${esc(b)}${c[3] ? ` — ${esc(c[3])}` : ''}</span> <span lang="he" class="maf-he">${esc(a)}</span>${c[4] ? ` <span class="maf-why-en">(${esc(c[4])})</span>` : ''}`;
    if (type === 'quote') return `Both draw on ${link(b)}: <span lang="he" class="maf-he">${esc(a)}</span>`;
    if (type === 'source') return `Both cite ${link(a)}`;
    if (type === 'chapter') return `Both draw on ${esc(a)}${b ? ` (${esc(b)})` : ''}`;
    return `Both under <span lang="he" class="maf-he">${esc(a)}</span>${b ? ` — ${esc(b)}` : ''}`;
  }
  // One plain line: what the two passages share, strongest reason first.
  function whyLine(why, esc) {
    const link = (key, sef) => { const u = sef !== 0 && appUrl(key); return u ? `<a href="${u}">${esc(key)}</a>` : esc(key); };
    const one = (c, first) => {
      const [type, a, b] = c;
      if (type === 'quote') return `${first ? 'Both quote' : 'both quote'} ${link(b, c[3])}: <span lang="he" class="maf-he">“${esc(a)}”</span>`;
      if (type === 'line') return `${first ? 'Both' : 'both'} indexed under <b>${esc(c[3] || b)}</b>${c[4] ? `: “${esc(c[4])}”` : ''}${first ? ` <span lang="he" class="maf-he maf-why-he">${esc(a)}</span>` : ''}`;
      if (type === 'source') return `${first ? 'Both cite' : 'both cite'} ${link(a, c[3])}`;
      if (type === 'chapter') return `${first ? 'Both draw on' : 'both draw on'} ${esc(a)}`;
      return `${first ? 'Both under' : 'both under'} <span lang="he" class="maf-he">${esc(a)}</span>${b ? ` (${esc(b)})` : ''}`;
    };
    if (!why || !why.length) return '';
    const n = why.length;
    return `<span class="maf-why-label">${n > 1 ? `Why · ${n} connections` : 'Why'}</span> ${one(why[0], true)}${why[1] ? `; and ${one(why[1], false)}` : ''}.`;
  }
  // Machine-learned parallels (dist/library/ml-parallels): [ref, probability, tier, [shared sources], [shared rare words]]
  function mlKey(books, sectionRef) {
    let best = null;
    for (const k of Object.keys(books || {})) if ((sectionRef === k || sectionRef.startsWith(k + ',') || sectionRef.startsWith(k + ' ')) && (!best || k.length > best.length)) best = k;
    return best;
  }
  const TIER_ORDER = { strong: 0, likely: 1, possible: 2 };
  function mlFor(passages, sectionRef, exclude = new Set()) {
    if (!passages) return [];
    const keys = passages[sectionRef] ? [sectionRef] : Object.keys(passages).filter(k => k.startsWith(sectionRef + ' ') && /^\d+$/.test(k.slice(sectionRef.length + 1)));
    const seen = new Set(), out = [];
    for (const k of keys) for (const item of passages[k]) {
      const base = item[0].replace(/:\d+$/, '');
      if (seen.has(item[0]) || exclude.has(base) || exclude.has(item[0]) || base === sectionRef || base.startsWith(sectionRef + ' ')) continue;
      seen.add(item[0]); out.push(item);
    }
    return out.sort((a, b) => TIER_ORDER[a[2]] - TIER_ORDER[b[2]] || b[1] - a[1]).slice(0, 20);
  }
  const TIER_LABEL = { strong: 'Strong', likely: 'Likely', possible: 'Possible' };
  // Outside parallels (dist/library/genre-parallels): [sefaria ref, Hebrew title, genre, probability, tier, [shared rare words]]
  const GENRES = [['Chassidus', 'חסידות'], ['Kabbalah', 'קבלה'], ['Machshava', 'מחשבה'], ['Mussar', 'מוסר']];
  function sefariaRefUrl(ref) {
    const m = String(ref).match(/^(.*?)\s+([\d:]+(?:-\d+)?)$/);
    const base = (m ? m[1] : String(ref)).replace(/ /g, '_');
    return 'https://www.sefaria.org/' + encodeURIComponent(base).replace(/%2C/g, ',') + (m ? '.' + m[2].replace(/:/g, '.') : '');
  }
  function genreFor(passages, sectionRef) {
    if (!passages) return [];
    const keys = passages[sectionRef] ? [sectionRef] : Object.keys(passages).filter(k => k.startsWith(sectionRef + ' ') && /^\d+$/.test(k.slice(sectionRef.length + 1)));
    const seen = new Set(), out = [];
    for (const k of keys) for (const item of passages[k]) if (!seen.has(item[0])) { seen.add(item[0]); out.push(item); }
    return out.sort((a, b) => TIER_ORDER[a[4]] - TIER_ORDER[b[4]] || b[3] - a[3]).slice(0, 16);
  }
  function renderGenre(items, opts) {
    const esc = opts.esc || escDefault;
    return GENRES.map(([g, he]) => {
      const list = items.filter(x => x[2] === g);
      if (!list.length) return '';
      return `<div class="maf-genre"><h5>${g} · <span lang="he">${he}</span></h5><ul class="maf-list">${list.map(([ref, title, , p, tier, words]) =>
        `<li class="maf-par"><span class="maf-tier maf-${tier}">${TIER_LABEL[tier]}</span> <a class="maf-ref" href="#/read/${(opts.toHash || toHashDefault)(ref)}">${esc(ref)}</a><div class="maf-why">${title && /[א-ת]/.test(title) ? `<span lang="he" class="maf-he">${esc(title)}</span>` : ''}${title && /[א-ת]/.test(title) && words && words.length ? ' · ' : ''}${words && words.length ? `Shared words: <span lang="he" class="maf-he">${esc(words.slice(0, 4).join(' · '))}</span>` : ''}</div></li>`).join('')}</ul></div>`;
    }).join('');
  }

  function renderMl(items, opts) {
    const esc = opts.esc || escDefault, toHash = opts.toHash || toHashDefault;
    return items.map(([ref, p, tier, cites, words], i) => {
      const cl = (cites || []).slice(0, 3).map(c => { const u = appUrl(c); return u ? `<a href="${u}">${esc(c)}</a>` : esc(c); });
      const parts = [cl.length && `both cite ${cl.join(' and ')}`, words && words.length && `both use the uncommon words <span lang="he" class="maf-he">${esc(words.slice(0, 4).join(' · '))}</span>`].filter(Boolean);
      const ev = parts.length ? `<span class="maf-why-label">Why · ${TIER_LABEL[tier].toLowerCase()} match</span> ${parts.join('; ')}.` : '';
      return `<li class="maf-par${i >= SHOW ? ' maf-more' : ''}"><span class="maf-tier maf-${tier}">${TIER_LABEL[tier]}</span> <a class="maf-ref" href="#/read/${toHash(ref)}">${esc(ref)}</a>${ev ? `<div class="maf-why">${ev}</div>` : ''}</li>`;
    }).join('');
  }
  function render(entry, sectionRef, opts = {}, ml = [], outside = []) {
    const esc = opts.esc || escDefault, toHash = opts.toHash || toHashDefault;
    entry = entry || { t: [], s: [], p: [] };
    const par = entry.p.map(([ref, score, why], i) => `<li class="maf-par${i >= SHOW ? ' maf-more' : ''}"><a class="maf-ref" href="#/read/${toHash(ref)}">${esc(ref)}</a>${why[0] ? `<div class="maf-why">${whyLine(why, esc)}</div>` : ''}</li>`).join('');
    const src = entry.s.map(([key, quote, sef, atLength], i) => {
      const u = sef && appUrl(key);
      return `<li class="maf-src${i >= SHOW ? ' maf-more' : ''}">${atLength ? '<span class="maf-star" title="Discussed at length (marked in the index)">★</span> ' : ''}${u ? `<a href="${u}">${esc(key)}</a>` : `<span>${esc(key)}</span>`}${quote ? ` <span lang="he" class="maf-he">${esc(quote)}</span>` : ''}</li>`;
    }).join('');
    const topics = entry.t.map(([he, en], i) => `<span class="maf-topic${i >= 10 ? ' maf-more' : ''}"><span lang="he">${esc(he)}</span>${en ? ` · ${esc(en)}` : ''}</span>`).join('');
    const more = (n, what, k = SHOW) => n > k ? `<button type="button" class="btn maf-toggle" data-what="${what}">Show all ${n}</button>` : '';
    return `<details class="mafteach-panel" data-section="${esc(sectionRef)}">
<summary><span class="note-en">Parallels — ${entry.p.length ? `${entry.p.length} from HaMafteach HaShalem` : ''}${entry.p.length && ml.length ? ', ' : ''}${ml.length ? `${ml.length} suggested` : ''}${outside.length ? `${entry.p.length || ml.length ? ', ' : ''}${outside.length} in other sefarim` : ''}${entry.s.length ? `, ${entry.s.length} source${entry.s.length === 1 ? '' : 's'}` : ''}</span><span class="note-he" lang="he">מקבילות</span></summary>
${par ? `<div class="maf-block"><h4>Parallel passages · HaMafteach HaShalem</h4><ol class="maf-list" data-list="par">${par}</ol>${more(entry.p.length, 'par')}</div>` : ''}
${ml.length ? `<div class="maf-block"><h4>More parallels · suggested by machine learning</h4><ol class="maf-list" data-list="ml">${renderMl(ml, opts)}</ol>${more(ml.length, 'ml')}</div>` : ''}
${outside.length ? `<div class="maf-block"><h4>In Chassidus, Kabbalah, Machshava and Mussar · suggested by machine learning</h4>${renderGenre(outside, opts)}</div>` : ''}
${src ? `<div class="maf-block"><h4>Sources it draws on</h4><ul class="maf-list" data-list="src">${src}</ul>${more(entry.s.length, 'src')}</div>` : ''}
${topics ? `<div class="maf-block"><h4>Indexed under</h4><div class="maf-topics" data-list="top">${topics}</div>${more(entry.t.length, 'top', 10)}</div>` : ''}
<p class="maf-note">${entry.p.length || entry.s.length ? `HaMafteach HaShalem: R' Chaim Hirsch's complete index to Rav Tzadok's works (OCR'd and linked by Akiva Publishing); ★ = discussed at length. ` : ''}${outside.length ? `Chassidus, Kabbalah, Machshava and Mussar passages open in the reader. ` : ''}${ml.length ? `Suggested parallels: a model trained on HaMafteach's parallels, scoring shared sources, wording and rare words across Rav Tzadok and Ishbitz-Radzin. Strong ≈ 4 in 5 confirmed in testing, Likely ≈ 3 in 5, Possible ≈ 1 in 2. ` : ''}Check a passage before citing it.</p>
</details>`;
  }
  const STYLE = `.mafteach-panel{margin:1.2em 0;border:1px solid var(--line,#ddd);border-radius:10px;padding:.4em .9em;background:var(--card,transparent)}
.mafteach-panel summary{cursor:pointer;font-weight:600;display:flex;gap:.8em;flex-wrap:wrap;justify-content:space-between;padding:.35em 0}
.mafteach-panel h4{margin:.8em 0 .35em;font-size:.95em}
.maf-topics{display:flex;flex-wrap:wrap;gap:.35em}.maf-topic{border:1px solid var(--line,#ddd);border-radius:999px;padding:.1em .6em;font-size:.88em}
.maf-list{margin:.2em 0;padding-inline-start:1.4em}.maf-list li{margin:.35em 0}.maf-ref{font-weight:600;unicode-bidi:isolate}
.maf-why{font-size:.88em;opacity:.85}.maf-he{font-family:inherit;direction:rtl;unicode-bidi:isolate}
.maf-why-topic{font-style:italic}.maf-why-en{color:var(--muted)}.maf-star{color:#b8860b}.maf-more{display:none}.mafteach-panel.maf-open-par [data-list=par] .maf-more,.mafteach-panel.maf-open-src [data-list=src] .maf-more{display:list-item}.mafteach-panel.maf-open-top [data-list=top] .maf-more{display:inline-block}
.maf-tier{font-size:.72em;border-radius:4px;padding:.05em .4em;vertical-align:.1em;border:1px solid currentColor}.maf-strong{color:#2e7d32}.maf-likely{color:#1565c0}.maf-possible{color:#8d6e63}.mafteach-panel.maf-open-ml [data-list=ml] .maf-more{display:list-item}
.maf-genre h5{margin:.6em 0 .2em;font-size:.88em;opacity:.85}
.maf-note{font-size:.8em;opacity:.75;margin:.8em 0 .3em}.maf-toggle{margin:.2em 0}
.maf-why-label{font-size:.78em;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--brass,#8a6d2f);margin-inline-end:.3em}.maf-why-he{opacity:.75;font-size:.95em}
.maf-hl{text-decoration:underline dotted var(--brass,#8a6d2f);text-decoration-thickness:2px;text-underline-offset:.28em;cursor:pointer;border-radius:3px}
.maf-hl:hover,.maf-hl.on{background:rgba(184,134,11,.13)}
#maf-pop{position:fixed;z-index:1000;max-width:min(420px,calc(100vw - 24px));max-height:min(60vh,520px);overflow:auto;background:var(--bg,#fff);color:var(--ink,#222);border:1px solid var(--line,#ccc);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px 14px;font:400 .92rem/1.5 var(--ui,system-ui)}
#maf-pop h6{margin:0 0 4px;font:700 .72rem var(--ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--brass,#8a6d2f)}
#maf-pop .ttl{font-weight:600;margin:0 0 6px}#maf-pop ul{margin:4px 0 8px;padding-inline-start:1.1em}#maf-pop li{margin:.3em 0}#maf-pop .x{position:absolute;top:6px;inset-inline-end:8px;border:0;background:none;font-size:1.2rem;cursor:pointer;color:inherit}
#maf-pop .sub{font-size:.85em;opacity:.8}#maf-pop .lnk{display:inline-block;margin-top:4px;font-weight:600}
@media(max-width:600px){#maf-pop{left:8px!important;right:8px!important;bottom:8px!important;top:auto!important;max-width:none;max-height:55vh}}`;
  let indexPromise = null;
  const shardPromises = new Map();
  function getJson(url) { return fetch(url).then(r => { if (!r.ok) throw new Error('Mafteach HTTP ' + r.status); return r.json(); }); }
  function index(base) {
    if (!indexPromise) indexPromise = getJson(base + 'mafteach/index.json?v=' + VERSION).catch(e => { indexPromise = null; throw e; });
    return indexPromise;
  }
  function shard(base, file) {
    if (!shardPromises.has(file)) shardPromises.set(file, getJson(base + 'mafteach/' + file + '?v=' + VERSION).catch(e => { shardPromises.delete(file); throw e; }));
    return shardPromises.get(file);
  }
  let mlIndexPromise = null;
  const mlShardPromises = new Map();
  function mlIndex(base) {
    if (!mlIndexPromise) mlIndexPromise = getJson(base + 'ml-parallels/index.json?v=' + VERSION).catch(e => { mlIndexPromise = null; throw e; });
    return mlIndexPromise;
  }
  function mlShard(base, file) {
    if (!mlShardPromises.has(file)) mlShardPromises.set(file, getJson(base + 'ml-parallels/' + file + '?v=' + VERSION).catch(e => { mlShardPromises.delete(file); throw e; }));
    return mlShardPromises.get(file);
  }
  async function mafteachEntry(base, sectionRef) {
    try {
      const idx = await index(base);
      const info = idx.books?.[shardKey(sectionRef)];
      if (!info) return null;
      return entryFor((await shard(base, info.file)).passages, sectionRef);
    } catch { return null; }
  }
  async function mlEntries(base, sectionRef, exclude) {
    try {
      const idx = await mlIndex(base);
      const key = mlKey(idx.books, sectionRef);
      if (!key) return [];
      return mlFor((await mlShard(base, idx.books[key].file)).passages, sectionRef, exclude);
    } catch { return []; }
  }
  let genreIndexPromise = null;
  const genreShardPromises = new Map();
  async function genreEntries(base, sectionRef) {
    try {
      if (!genreIndexPromise) genreIndexPromise = getJson(base + 'genre-parallels/index.json?v=' + VERSION).catch(e => { genreIndexPromise = null; throw e; });
      const idx = await genreIndexPromise;
      const key = mlKey(idx.books, sectionRef);
      if (!key) return [];
      const file = idx.books[key].file;
      if (!genreShardPromises.has(file)) genreShardPromises.set(file, getJson(base + 'genre-parallels/' + file + '?v=' + VERSION).catch(e => { genreShardPromises.delete(file); throw e; }));
      return genreFor((await genreShardPromises.get(file)).passages, sectionRef);
    } catch { return []; }
  }
  // ---- parallels at the phrase: underline the words Rav Tzadok quotes (a pasuk, a Chazal) and the heading words the
  // Mafteach files the passage under; tapping one shows the source and the other passages that share it.
  const NORM_OUT = /[\u0591-\u05C7]/g;
  const fin = s => s.replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
  const loose = w => fin(w).replace(/[וי]/g, '');
  const words = s => fin(String(s).replace(NORM_OUT, '').replace(/[״׳"'`]/g, '')).split(/[^א-ת]+/).filter(w => w.length > 1 && !/^(וגו|וכו|וכוי|וגוי|דף|עמוד)$/.test(w));
  // the Hebrew text nodes of a section, as words with their DOM positions
  function textWords(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('a,sup,button,.maf-hl,.reader-footnote,.footnote,i.footnote,.mafteach-panel,.seg-en,.ph-en,.num') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let n; (n = walker.nextNode());) {
      const t = n.nodeValue; const re = /[\u05D0-\u05EA\u0591-\u05C7״׳"']+/g; let m;
      while ((m = re.exec(t))) { const w = fin(m[0].replace(NORM_OUT, '').replace(/[״׳"']/g, '')); if (w.replace(/[^א-ת]/g, '').length) out.push({ node: n, start: m.index, end: m.index + m[0].length, w, l: loose(w) }); }
    }
    return out;
  }
  const PREFIX = /^[והבלמשכ]{1,2}/;
  const same = (tw, qw) => { const a = tw.l, b = loose(qw), b2 = loose(qw.replace(/ס$/, 'מ')); return a === b || a === b2 || (a.replace(PREFIX, '') === b && b.length >= 3) || (a.replace(PREFIX, '') === b2 && b2.length >= 3); };
  // the longest run (3+ words, or a whole short phrase) of q found in the text
  function findPhrase(tws, q, min = 3) {
    const qw = words(q).slice(0, 12);
    if (qw.length < min) min = qw.length;
    if (!min || qw.join('').length < 5) return null;
    let best = null;
    for (let qi = 0; qi + min <= qw.length; qi++) for (let ti = 0; ti < tws.length; ti++) {
      let k = 0; while (qi + k < qw.length && ti + k < tws.length && same(tws[ti + k], qw[qi + k])) k++;
      if (k >= min && (!best || k > best.k)) best = { ti, k };
    }
    return best;
  }
  function wrap(tws, ti, k, id) {
    const pieces = new Map();                       // node -> [start, end]
    for (let i = ti; i < ti + k; i++) { const t = tws[i]; const p = pieces.get(t.node); if (p) p[1] = t.end; else pieces.set(t.node, [t.start, t.end]); }
    for (const [node, [a, b]] of pieces) {
      if (!node.parentNode) continue;
      const r = document.createRange(); r.setStart(node, a); r.setEnd(node, b);
      const span = document.createElement('span'); span.className = 'maf-hl'; span.dataset.maf = id; span.title = 'HaMafteach HaShalem: tap for parallels';
      try { r.surroundContents(span); } catch {}
    }
  }
  function annotate(sectionElement, sectionRef, entry, ml, opts = {}) {
    if (typeof document === 'undefined' || !entry || sectionElement.dataset.mafInline) return 0;
    sectionElement.dataset.mafInline = '1';
    const esc = opts.esc || escDefault, toHash = opts.toHash || toHashDefault;
    const anchors = [];
    // quoted sources
    for (const [key, quote, sef] of entry.s) {
      if (!quote) continue;
      const pars = entry.p.filter(p => p[2].some(w => (w[0] === 'quote' && w[2] === key) || (w[0] === 'source' && w[1] === key)));
      const mls = (ml || []).filter(x => (x[3] || []).includes(key));
      anchors.push({ kind: 'source', key, quote, sef, pars, mls });
    }
    // headings the Mafteach files this passage under, when the passage shares them with others
    for (const [he, en] of entry.t) {
      const pars = entry.p.filter(p => p[2].some(w => w[0] === 'line' && w[2] === he));
      if (pars.length) anchors.push({ kind: 'topic', he, en, quote: he, pars, mls: [] });
    }
    // the Hebrew appears twice in interlinear editions (running text and phrase by phrase): mark the phrase in each
    const groups = ['.seg-he', '.ph-he'].map(sel => [...sectionElement.querySelectorAll(sel)].filter(b => !b.closest('.mafteach-panel')));
    const COMMON = new Set(['ישראל', 'תורה', 'קדושה', 'השמ', 'עולמ', 'אדמ', 'מצוה', 'מצות', 'נפש', 'לב']);
    let made = 0;
    anchors.forEach((a, id) => {
      if (a.kind === 'topic') { const w = words(a.quote); if (w.length < 2 && (COMMON.has(fin(w[0] || '')) || (w[0] || '').length < 4)) return; }
      for (const blocks of groups) for (const b of blocks) {
        const tws = textWords(b);
        const hit = findPhrase(tws, a.quote, a.kind === 'topic' ? words(a.quote).length : 3);
        if (hit) { wrap(tws, hit.ti, hit.k, sectionRef + '#' + id); made++; break; }
      }
    });
    sectionElement._mafAnchors = anchors;
    if (made && !sectionElement.dataset.mafClick) {
      sectionElement.dataset.mafClick = '1';
      sectionElement.addEventListener('click', e => {
        const hl = e.target.closest('.maf-hl'); if (!hl) return;
        e.preventDefault(); e.stopPropagation();
        const a = sectionElement._mafAnchors[+hl.dataset.maf.split('#').pop()];
        if (a) popover(hl, a, { esc, toHash });
      }, true);
    }
    return made;
  }
  function popover(el, a, { esc, toHash }) {
    let pop = document.getElementById('maf-pop');
    if (!pop) { pop = document.createElement('div'); pop.id = 'maf-pop'; pop.setAttribute('role', 'dialog'); document.body.appendChild(pop); }
    document.querySelectorAll('.maf-hl.on').forEach(x => x.classList.remove('on'));
    el.classList.add('on');
    const q = encodeURIComponent;
    const parList = a.pars.slice(0, 8).map(([ref, , why]) => {
      const w = why.find(w => (a.kind === 'source' && ((w[0] === 'quote' && w[2] === a.key) || (w[0] === 'source' && w[1] === a.key))) || (a.kind === 'topic' && w[0] === 'line' && w[2] === a.he));
      const note = w && w[0] === 'line' ? (w[4] ? `“${esc(w[4])}”` : `<span lang="he" class="maf-he">${esc(w[1])}</span>`) : '';
      return `<li><a href="#/read/${toHash(ref)}">${esc(ref)}</a>${note ? `<div class="sub">${note}</div>` : ''}</li>`;
    }).join('');
    const mlList = a.mls.slice(0, 5).map(([ref, , tier]) => `<li><a href="#/read/${toHash(ref)}">${esc(ref)}</a> <span class="sub">(${TIER_LABEL[tier].toLowerCase()} match)</span></li>`).join('');
    const u = a.kind === 'source' && a.sef !== 0 && appUrl(a.key);
    pop.innerHTML = `<button class="x" aria-label="Close">×</button>` + (a.kind === 'source'
      ? `<h6>Rav Tzadok quotes</h6><div class="ttl">${u ? `<a href="${u}">${esc(a.key)} ›</a>` : esc(a.key)}</div><div lang="he" class="maf-he">${esc(a.quote)}</div>
         ${parList ? `<h6 style="margin-top:10px">Also quoting it · HaMafteach HaShalem</h6><ul>${parList}</ul>` : ''}${mlList ? `<h6>Suggested parallels citing it</h6><ul>${mlList}</ul>` : ''}
         <a class="lnk" href="#/mafteach?q=${q(a.key)}">Everywhere Rav Tzadok draws on ${esc(a.key)} ›</a>`
      : `<h6>Indexed under</h6><div class="ttl"><span lang="he" class="maf-he">${esc(a.he)}</span>${a.en ? ` · ${esc(a.en)}` : ''}</div>
         ${parList ? `<h6 style="margin-top:10px">Parallels on this · HaMafteach HaShalem</h6><ul>${parList}</ul>` : ''}
         <a class="lnk" href="#/mafteach?q=${q(a.he)}">All of “${esc(a.en || a.he)}” in the Mafteach ›</a>`);
    const r = el.getBoundingClientRect(), W = Math.min(420, innerWidth - 24);
    pop.style.left = Math.max(12, Math.min(innerWidth - W - 12, r.left + r.width / 2 - W / 2)) + 'px';
    pop.style.top = (r.bottom + 8 + 300 < innerHeight ? r.bottom + 8 : Math.max(12, r.top - 8 - Math.min(360, innerHeight * .6))) + 'px';
    pop.style.right = 'auto'; pop.style.bottom = 'auto';
    pop.hidden = false;
    const close = () => { pop.hidden = true; el.classList.remove('on'); document.removeEventListener('click', outside, true); removeEventListener('keydown', key); };
    const outside = e => { if (!pop.contains(e.target) || e.target.closest('.x') || e.target.closest('a')) { if (!e.target.closest('.maf-hl') || e.target.closest('#maf-pop')) setTimeout(close, 0); } };
    const key = e => { if (e.key === 'Escape') close(); };
    setTimeout(() => { document.addEventListener('click', outside, true); addEventListener('keydown', key); }, 0);
  }
  async function mount(data, sectionElement, opts = {}) {
    try {
      if (!data?.sectionRef || !sectionElement || sectionElement.querySelector('.mafteach-panel')) return false;
      const base = opts.base || '';
      const entry = await mafteachEntry(base, data.sectionRef);
      const exclude = new Set((entry?.p || []).map(p => p[0]));
      const [ml, outside] = await Promise.all([mlEntries(base, data.sectionRef, exclude), genreEntries(base, data.sectionRef)]);
      if ((!entry || (!entry.p.length && !entry.s.length)) && !ml.length && !outside.length) return false;
      if (!sectionElement.isConnected || sectionElement.querySelector('.mafteach-panel')) return false;
      if (typeof document !== 'undefined' && !document.getElementById('mafteach-panel-style')) {
        const st = document.createElement('style'); st.id = 'mafteach-panel-style'; st.textContent = STYLE; document.head.appendChild(st);
      }
      sectionElement.insertAdjacentHTML('beforeend', render(entry, data.sectionRef, opts, ml, outside));
      try { annotate(sectionElement, data.sectionRef, entry, ml, opts); } catch {}
      const panel = sectionElement.querySelector('.mafteach-panel');
      panel.querySelectorAll('.maf-toggle').forEach(b => b.addEventListener('click', () => { panel.classList.add('maf-open-' + b.dataset.what); b.remove(); }));
      return true;
    } catch { return false; }   // the panel is optional: never disturb reading
  }
  // ---- the reader's side panel: a Mafteach tab, and a line at the top of Connections
  function ensureStyle() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('mafteach-panel-style')) { const st = document.createElement('style'); st.id = 'mafteach-panel-style'; st.textContent = STYLE; document.head.appendChild(st); }
    if (!document.getElementById('mafteach-side-style')) {
      const st = document.createElement('style'); st.id = 'mafteach-side-style';
      st.textContent = `.maf-side .mafteach-panel{border:0;padding:0;margin:0}.maf-side .mafteach-panel>summary{display:none}
.maf-side-actions{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 14px}.maf-side-actions a{flex:1 1 auto;text-align:center}
.maf-side .maf-topic a{color:inherit;text-decoration:none}.maf-banner{display:flex;width:100%;justify-content:space-between;gap:10px;align-items:center;text-align:start;
border:1px solid var(--line,#ddd);border-radius:10px;padding:10px 12px;margin:0 0 12px;background:var(--soft,transparent);cursor:pointer;font:inherit;color:inherit}
.maf-banner b{display:block;font-size:.95em}.maf-banner span{font-size:.85em;opacity:.8}`;
      document.head.appendChild(st);
    }
  }
  async function gather(sectionRef, base) {
    const entry = await mafteachEntry(base, sectionRef);
    const exclude = new Set((entry?.p || []).map(p => p[0]));
    const [ml, outside] = await Promise.all([mlEntries(base, sectionRef, exclude), genreEntries(base, sectionRef)]);
    return { entry, ml, outside };
  }
  async function panelTab(ref, container, opts = {}) {
    const esc = opts.esc || escDefault, alive = opts.alive || (() => true);
    const sectionRef = opts.sectionRef || ref;
    ensureStyle();
    container.innerHTML = '<div class="loading">Looking in HaMafteach HaShalem…</div>';
    let g;
    try { g = await gather(sectionRef, opts.base || ''); } catch { g = { entry: null, ml: [], outside: [] }; }
    if (!alive()) return;
    const { entry, ml, outside } = g;
    const topics = entry?.t || [];
    const q = encodeURIComponent;
    const S = typeof window !== 'undefined' && window.AkivaMafteachSearch;
    const parsha = S && /^Peri Tzadik, /.test(sectionRef) ? S.findParsha(sectionRef.replace(/^Peri Tzadik, /, '').replace(/\s+\d+(:\d+)?$/, '')) : null;
    const actions = `<div class="maf-side-actions">${parsha ? `<a class="btn" href="#/shiur?parsha=${q(parsha.key)}">Build a shiur on Parshas ${esc(parsha.ashk)}</a>` : ''}${topics.length ? `<a class="btn" href="#/mafteach?q=${q(topics[0][0])}">Topic: ${esc(topics[0][1] || topics[0][0])}</a>` : ''}<a class="btn" href="#/mafteach">Search the Mafteach</a></div>`;
    if ((!entry || (!entry.p.length && !entry.s.length && !topics.length)) && !ml.length && !outside.length) {
      container.innerHTML = `<div class="maf-side">${actions}<div class="empty">HaMafteach HaShalem has no entry for ${esc(sectionRef)}. (Some sefarim, like Dover Tzedek, are indexed by page and not linked to the library.)</div></div>`;
      return;
    }
    const html = render(entry, sectionRef, opts, ml, outside).replace('<details class="mafteach-panel"', '<details open class="mafteach-panel"');
    container.innerHTML = `<div class="maf-side"><p class="empty" style="padding:0 0 8px;font-size:.9rem">${esc(sectionRef)} in HaMafteach HaShalem: its parallels, the sources it draws on and the topics it is indexed under.</p>${actions}${html}</div>`;
    container.querySelectorAll('.maf-topic').forEach(el => {          // a topic opens its heading in the Mafteach search
      const he = el.querySelector('[lang=he]')?.textContent || '';
      const a = document.createElement('a'); a.href = '#/mafteach?q=' + q(he);
      while (el.firstChild) a.appendChild(el.firstChild);
      el.appendChild(a);
    });
    const panel = container.querySelector('.mafteach-panel');
    panel?.querySelectorAll('.maf-toggle').forEach(b => b.addEventListener('click', () => { panel.classList.add('maf-open-' + b.dataset.what); b.remove(); }));
  }
  async function connectionsBanner(sectionRef, container, openTab, opts = {}) {
    const alive = opts.alive || (() => true);
    try {
      const { entry, ml, outside } = await gather(sectionRef, opts.base || '');
      if (!alive() || !container.isConnected || container.querySelector('.maf-banner')) return;
      const n = (entry?.p.length || 0) + ml.length, t = entry?.t.length || 0, sCount = entry?.s.length || 0;
      if (!n && !t && !sCount && !outside.length) return;
      ensureStyle();
      const bits = [n && `${n} parallel${n === 1 ? '' : 's'}`, sCount && `${sCount} source${sCount === 1 ? '' : 's'}`, t && `${t} topic${t === 1 ? '' : 's'}`, outside.length && `${outside.length} in other sefarim`].filter(Boolean).join(' · ');
      container.insertAdjacentHTML('afterbegin', `<button type="button" class="maf-banner"><div><b>HaMafteach HaShalem</b><span>${bits}</span></div><span aria-hidden="true">›</span></button>`);
      container.querySelector('.maf-banner').addEventListener('click', e => { e.stopPropagation(); openTab(); });
    } catch {}
  }
  return { VERSION, mount, render, whyLine, findPhrase, words, entryFor, shardKey, sefariaUrl, mlKey, mlFor, genreFor, sefariaRefUrl, panelTab, connectionsBanner };
});

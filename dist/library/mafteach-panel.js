/* HaMafteach HaShalem panel: parallels, sources and topics for a Rav Tzadok passage.
   Data: mafteach/index.json and one small file per sefer (per section for Pri Tzaddik), built from
   R' Chaim Hirsch's HaMafteach HaShalem (OCR'd and linked to library refs; see sources/mafteach/). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AkivaMafteach = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '20261102-mafteach-ml-genre-en-v2';
  const SHOW = 8;
  const toHashDefault = ref => encodeURIComponent(ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':');
  const escDefault = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Sefaria URL for a source key: "Genesis 2:7" -> Genesis.2.7, "Bereshit Rabbah 2:4" -> Bereshit_Rabbah.2.4
  function sefariaUrl(key) {
    const m = String(key || '').match(/^(.*?)\s+(\d+[ab]?)(?::(\d+))?$/);
    if (!m) return null;
    return 'https://www.sefaria.org/' + m[1].replace(/ /g, '_') + '.' + m[2] + (m[3] ? '.' + m[3] : '');
  }
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
    const link = key => { const u = c3 && sefariaUrl(key); return u ? `<a href="${u}" target="_blank" rel="noopener">${esc(key)}</a>` : esc(key); };
    if (type === 'line') return `<span class="maf-why-topic">${esc(b)}${c[3] ? ` — ${esc(c[3])}` : ''}</span> <span lang="he" class="maf-he">${esc(a)}</span>${c[4] ? ` <span class="maf-why-en">(${esc(c[4])})</span>` : ''}`;
    if (type === 'quote') return `Both draw on ${link(b)}: <span lang="he" class="maf-he">${esc(a)}</span>`;
    if (type === 'source') return `Both cite ${link(a)}`;
    if (type === 'chapter') return `Both draw on ${esc(a)}${b ? ` (${esc(b)})` : ''}`;
    return `Both under <span lang="he" class="maf-he">${esc(a)}</span>${b ? ` — ${esc(b)}` : ''}`;
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
        `<li class="maf-par"><span class="maf-tier maf-${tier}">${TIER_LABEL[tier]}</span> <a class="maf-ref" href="${sefariaRefUrl(ref)}" target="_blank" rel="noopener">${esc(ref)}</a><div class="maf-why">${title && /[א-ת]/.test(title) ? `<span lang="he" class="maf-he">${esc(title)}</span>` : ''}${title && /[א-ת]/.test(title) && words && words.length ? ' · ' : ''}${words && words.length ? `Shared words: <span lang="he" class="maf-he">${esc(words.slice(0, 4).join(' · '))}</span>` : ''}</div></li>`).join('')}</ul></div>`;
    }).join('');
  }

  function renderMl(items, opts) {
    const esc = opts.esc || escDefault, toHash = opts.toHash || toHashDefault;
    return items.map(([ref, p, tier, cites, words], i) => {
      const ev = cites && cites.length
        ? 'Both cite ' + cites.slice(0, 2).map(c => { const u = sefariaUrl(c); return u ? `<a href="${u}" target="_blank" rel="noopener">${esc(c)}</a>` : esc(c); }).join(', ')
        : (words && words.length ? `Shared words: <span lang="he" class="maf-he">${esc(words.slice(0, 4).join(' · '))}</span>` : '');
      return `<li class="maf-par${i >= SHOW ? ' maf-more' : ''}"><span class="maf-tier maf-${tier}">${TIER_LABEL[tier]}</span> <a class="maf-ref" href="#/read/${toHash(ref)}">${esc(ref)}</a>${ev ? `<div class="maf-why">${ev}</div>` : ''}</li>`;
    }).join('');
  }
  function render(entry, sectionRef, opts = {}, ml = [], outside = []) {
    const esc = opts.esc || escDefault, toHash = opts.toHash || toHashDefault;
    entry = entry || { t: [], s: [], p: [] };
    const par = entry.p.map(([ref, score, why], i) => `<li class="maf-par${i >= SHOW ? ' maf-more' : ''}"><a class="maf-ref" href="#/read/${toHash(ref)}">${esc(ref)}</a>${why[0] ? `<div class="maf-why">${caption(why[0], esc)}</div>` : ''}</li>`).join('');
    const src = entry.s.map(([key, quote, sef, atLength], i) => {
      const u = sef && sefariaUrl(key);
      return `<li class="maf-src${i >= SHOW ? ' maf-more' : ''}">${atLength ? '<span class="maf-star" title="Discussed at length (marked in the index)">★</span> ' : ''}${u ? `<a href="${u}" target="_blank" rel="noopener">${esc(key)}</a>` : `<span>${esc(key)}</span>`}${quote ? ` <span lang="he" class="maf-he">${esc(quote)}</span>` : ''}</li>`;
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
<p class="maf-note">${entry.p.length || entry.s.length ? `HaMafteach HaShalem: R' Chaim Hirsch's complete index to Rav Tzadok's works (OCR'd and linked by Akiva Publishing); ★ = discussed at length. ` : ''}${outside.length ? `Chassidus, Kabbalah, Machshava and Mussar links open the passage on Sefaria. ` : ''}${ml.length ? `Suggested parallels: a model trained on HaMafteach's parallels, scoring shared sources, wording and rare words across Rav Tzadok and Ishbitz-Radzin. Strong ≈ 4 in 5 confirmed in testing, Likely ≈ 3 in 5, Possible ≈ 1 in 2. ` : ''}Check a passage before citing it.</p>
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
.maf-note{font-size:.8em;opacity:.75;margin:.8em 0 .3em}.maf-toggle{margin:.2em 0}`;
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
      const panel = sectionElement.querySelector('.mafteach-panel');
      panel.querySelectorAll('.maf-toggle').forEach(b => b.addEventListener('click', () => { panel.classList.add('maf-open-' + b.dataset.what); b.remove(); }));
      return true;
    } catch { return false; }   // the panel is optional: never disturb reading
  }
  return { VERSION, mount, render, entryFor, shardKey, sefariaUrl, mlKey, mlFor, genreFor, sefariaRefUrl };
});

/* HaMafteach HaShalem panel: parallels, sources and topics for a Rav Tzadok passage.
   Data: mafteach/index.json and one small file per sefer (per section for Pri Tzaddik), built from
   R' Chaim Hirsch's HaMafteach HaShalem (OCR'd and linked to library refs; see sources/mafteach/). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AkivaMafteach = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '20261102-mafteach-v1';
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
    if (type === 'line') return `<span class="maf-why-topic">${esc(b)}${c[3] ? ` — ${esc(c[3])}` : ''}</span> <span lang="he" class="maf-he">${esc(a)}</span>`;
    if (type === 'quote') return `Both draw on ${link(b)}: <span lang="he" class="maf-he">${esc(a)}</span>`;
    if (type === 'source') return `Both cite ${link(a)}`;
    if (type === 'chapter') return `Both draw on ${esc(a)}${b ? ` (${esc(b)})` : ''}`;
    return `Both under <span lang="he" class="maf-he">${esc(a)}</span>${b ? ` — ${esc(b)}` : ''}`;
  }
  function render(entry, sectionRef, opts = {}) {
    const esc = opts.esc || escDefault, toHash = opts.toHash || toHashDefault;
    const par = entry.p.map(([ref, score, why], i) => `<li class="maf-par${i >= SHOW ? ' maf-more' : ''}"><a class="maf-ref" href="#/read/${toHash(ref)}">${esc(ref)}</a>${why[0] ? `<div class="maf-why">${caption(why[0], esc)}</div>` : ''}</li>`).join('');
    const src = entry.s.map(([key, quote, sef, atLength], i) => {
      const u = sef && sefariaUrl(key);
      return `<li class="maf-src${i >= SHOW ? ' maf-more' : ''}">${atLength ? '<span class="maf-star" title="Discussed at length (marked in the index)">★</span> ' : ''}${u ? `<a href="${u}" target="_blank" rel="noopener">${esc(key)}</a>` : `<span>${esc(key)}</span>`}${quote ? ` <span lang="he" class="maf-he">${esc(quote)}</span>` : ''}</li>`;
    }).join('');
    const topics = entry.t.map(([he, en], i) => `<span class="maf-topic${i >= 10 ? ' maf-more' : ''}"><span lang="he">${esc(he)}</span>${en ? ` · ${esc(en)}` : ''}</span>`).join('');
    const more = (n, what, k = SHOW) => n > k ? `<button type="button" class="btn maf-toggle" data-what="${what}">Show all ${n}</button>` : '';
    return `<details class="mafteach-panel" data-section="${esc(sectionRef)}">
<summary><span class="note-en">HaMafteach HaShalem — ${entry.p.length} parallel${entry.p.length === 1 ? '' : 's'}, ${entry.s.length} source${entry.s.length === 1 ? '' : 's'}</span><span class="note-he" lang="he">המפתח השלם</span></summary>
${par ? `<div class="maf-block"><h4>Parallel passages</h4><ol class="maf-list" data-list="par">${par}</ol>${more(entry.p.length, 'par')}</div>` : ''}
${src ? `<div class="maf-block"><h4>Sources it draws on</h4><ul class="maf-list" data-list="src">${src}</ul>${more(entry.s.length, 'src')}</div>` : ''}
${topics ? `<div class="maf-block"><h4>Indexed under</h4><div class="maf-topics" data-list="top">${topics}</div>${more(entry.t.length, 'top', 10)}</div>` : ''}
<p class="maf-note">From R' Chaim Hirsch's <i>HaMafteach HaShalem</i>, the complete index to Rav Tzadok's works (OCR'd and linked by Akiva Publishing). ★ = discussed at length. Check a passage before citing it.</p>
</details>`;
  }
  const STYLE = `.mafteach-panel{margin:1.2em 0;border:1px solid var(--line,#ddd);border-radius:10px;padding:.4em .9em;background:var(--card,transparent)}
.mafteach-panel summary{cursor:pointer;font-weight:600;display:flex;gap:.8em;flex-wrap:wrap;justify-content:space-between;padding:.35em 0}
.mafteach-panel h4{margin:.8em 0 .35em;font-size:.95em}
.maf-topics{display:flex;flex-wrap:wrap;gap:.35em}.maf-topic{border:1px solid var(--line,#ddd);border-radius:999px;padding:.1em .6em;font-size:.88em}
.maf-list{margin:.2em 0;padding-inline-start:1.4em}.maf-list li{margin:.35em 0}.maf-ref{font-weight:600}
.maf-why{font-size:.88em;opacity:.85}.maf-he{font-family:inherit;direction:rtl;unicode-bidi:isolate}
.maf-why-topic{font-style:italic}.maf-star{color:#b8860b}.maf-more{display:none}.mafteach-panel.maf-open-par [data-list=par] .maf-more,.mafteach-panel.maf-open-src [data-list=src] .maf-more{display:list-item}.mafteach-panel.maf-open-top [data-list=top] .maf-more{display:inline-block}
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
  async function mount(data, sectionElement, opts = {}) {
    try {
      if (!data?.sectionRef || !sectionElement || sectionElement.querySelector('.mafteach-panel')) return false;
      const base = opts.base || '';
      const idx = await index(base);
      const info = idx.books?.[shardKey(data.sectionRef)];
      if (!info) return false;
      const sh = await shard(base, info.file);
      const entry = entryFor(sh.passages, data.sectionRef);
      if (!entry || (!entry.p.length && !entry.s.length) || !sectionElement.isConnected || sectionElement.querySelector('.mafteach-panel')) return false;
      if (typeof document !== 'undefined' && !document.getElementById('mafteach-panel-style')) {
        const st = document.createElement('style'); st.id = 'mafteach-panel-style'; st.textContent = STYLE; document.head.appendChild(st);
      }
      sectionElement.insertAdjacentHTML('beforeend', render(entry, data.sectionRef, opts));
      const panel = sectionElement.querySelector('.mafteach-panel');
      panel.querySelectorAll('.maf-toggle').forEach(b => b.addEventListener('click', () => { panel.classList.add('maf-open-' + b.dataset.what); b.remove(); }));
      return true;
    } catch { return false; }   // the panel is optional: never disturb reading
  }
  return { VERSION, mount, render, entryFor, shardKey, sefariaUrl };
});

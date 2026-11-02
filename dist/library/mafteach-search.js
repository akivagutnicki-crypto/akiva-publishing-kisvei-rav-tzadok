/* HaMafteach HaShalem search and shiur builder for the Rav Tzadok Library reader.
   #/mafteach?q=…      ask anything: a question, a word or topic, a pasuk, a daf, a midrash, a parsha
   #/mafteach?topic=ID one Mafteach heading with all its entries
   #/shiur?topic=ID    a source sheet on a topic, built from the Mafteach
   #/shiur?parsha=KEY  a source sheet on a parsha: Pri Tzaddik on the parsha, its pesukim in Rav Tzadok, its themes
   Data: ../mcp-data/mafteach/ (the same files the MCP server reads; scripts/build-mafteach-index.mjs) and
   mafteach/ (the reader panel's per-sefer files). Queries may be Hebrew, English or Ashkenazi/Sefardi transliteration.
   The matching logic is a port of cloudflare/mcp.mjs (mafteach_* tools); scripts/test-mafteach-search.mjs checks parity. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AkivaMafteachSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '20261102-mafteach-search-inapp-v7';
  let BASE = '../mcp-data/mafteach/';
  let PANEL_BASE = 'mafteach/';
  const memo = new Map();
  let loader = async url => { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return url.endsWith('.txt') ? r.text() : r.json(); };
  const load = url => { if (!memo.has(url)) { const p = loader(url); memo.set(url, p); p.catch(() => memo.delete(url)); } return memo.get(url); };
  const loadMaf = rel => load(BASE + rel);
  const loadShard = rel => loadMaf(rel).catch(() => []);
  function configure(o = {}) { if (o.base) BASE = o.base; if (o.panelBase) PANEL_BASE = o.panelBase; if (o.loader) loader = o.loader; memo.clear(); M = null; }

  // ------------------------------------------------------------ normalization (as cloudflare/mcp.mjs)
  function table() {
    const t = new Array(65536);
    for (let c = 0; c < 65536; c++) t[c] = String.fromCharCode(c);
    for (let c = 0x41; c <= 0x5a; c++) t[c] = String.fromCharCode(c + 32);
    for (let c = 0xc0; c <= 0x24f; c++) t[c] = String.fromCharCode(c).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let c = 0x300; c <= 0x36f; c++) t[c] = '';
    for (let c = 0x591; c <= 0x5c7; c++) t[c] = '';
    for (const c of [0x5be, 0x5c0, 0x5c3, 0x5c6]) t[c] = ' ';
    t[0x5da] = 'כ'; t[0x5dd] = 'מ'; t[0x5df] = 'נ'; t[0x5e3] = 'פ'; t[0x5e5] = 'צ';
    for (let c = 0xfb1d; c <= 0xfb4f; c++) t[c] = [...String.fromCharCode(c).normalize('NFKD')].map(x => t[x.charCodeAt(0)]).join('');
    for (const ch of '׳״\'"`´ʼ‘’‚‛“”„​‌‍‎‏­⁠﻿') t[ch.charCodeAt(0)] = '';
    for (const ch of ' \t\n\r\f\v              　.,;:!?()[]{}<>«»‹›–—―‐‑‒-…/\\|*~_=+•·§¶#@$%^&') t[ch.charCodeAt(0)] = ' ';
    return t;
  }
  let TABLE = null;
  function norm(s) {
    TABLE = TABLE || table();
    let out = ' ', sp = true;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) {
      const r = TABLE[s.charCodeAt(i)];
      if (r === ' ') { if (!sp) { out += ' '; sp = true; } } else if (r) { out += r; sp = false; }
    }
    if (!sp) out += ' ';
    return out;
  }
  function skel(s) {
    return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z]+/).map(w => w.replace(/([aeiou])h$/, '$1')).join('')
      .replace(/c(?!h)/g, 'k').replace(/kh/g, 'ch').replace(/s/g, 't').replace(/th/g, 't').replace(/ph/g, 'f')
      .replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
  }
  const wordSkels = s => String(s).split(/[^A-Za-zÀ-ɏ']+/).filter(Boolean).map(skel).filter(Boolean);
  function wordsIn(needle, hay) {
    const h = wordSkels(hay);
    for (let i = 0; i + needle.length <= h.length; i++) if (needle.every((w, j) => h[i + j] === w)) return true;
    return false;
  }
  const heKey = s => norm(String(s || '')).replace(/[^א-ת]/g, '');
  function refKey(s) { return String(s).split(/(\d+)/).map((part, i) => (i % 2 ? String(+part) : skel(part))).filter(Boolean).join('|'); }
  const fileKey = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const MAF_STOP = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'to', 'rav', 'tzadok', 'r']);
  const latinKeys = s => {
    const words = String(s).toLowerCase().split(/[^a-z']+/).filter(Boolean);
    const all = skel(words.join(' ')), core = skel(words.filter(w => !MAF_STOP.has(w)).join(' '));
    return [...new Set([all, core].filter(Boolean))];
  };
  function translitKey(s) {
    return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z']+/).filter(w => w && !MAF_STOP.has(w)).map(w => w.replace(/'/g, '')
        .replace(/kh/g, 'ch').replace(/ck/g, 'k').replace(/c(?!h)/g, 'k').replace(/ph/g, 'f').replace(/ts/g, 'tz')
        .replace(/th/g, 't').replace(/(?<=.)s(?!h)/g, 't').replace(/(ei|ai|ay|ey)/g, 'e').replace(/oi|oy/g, 'o')
        .replace(/o/g, 'a').replace(/y(?=[^aeiou]|$)/g, 'i').replace(/([aeiou])h$/, '$1').replace(/h$/, '')
        .replace(/(.)\1+/g, '$1')).join('');
  }
  const GEM = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
  const gematria = s => [...String(s).replace(/[^א-ת]/g, '')].reduce((n, c) => n + (GEM[c] || 0), 0);
  const RABBAH_EN = {
    'Bereshit Rabbah': ['Bereishis Rabbah', 'Genesis Rabbah', 'Breishis Rabba', 'בראשית רבה'], 'Shemot Rabbah': ['Shemos Rabbah', 'Exodus Rabbah', 'שמות רבה'],
    'Vayikra Rabbah': ['Leviticus Rabbah', 'ויקרא רבה'], 'Bamidbar Rabbah': ['Numbers Rabbah', 'במדבר רבה'], 'Devarim Rabbah': ['Deuteronomy Rabbah', 'דברים רבה'],
    'Shir HaShirim Rabbah': ['Song of Songs Rabbah', 'Shir Hashirim Rabba', 'שיר השירים רבה'], 'Ruth Rabbah': ['Rus Rabbah', 'רות רבה'],
    'Eichah Rabbah': ['Lamentations Rabbah', 'Eicha Rabba', 'איכה רבה'], 'Kohelet Rabbah': ['Koheles Rabbah', 'Ecclesiastes Rabbah', 'קהלת רבה'],
    'Esther Rabbah': ['Esther Rabba', 'אסתר רבה'],
  };

  // ------------------------------------------------------------ index (as mcp.mjs mafteach())
  let M = null;
  function buildIndex(g) {
    const keys = new Map();
    const add = (k, t, w) => {
      if (!k || k.length < 2) return;
      const l = keys.get(k) || [];
      const prev = l.find(x => x.t === t);
      if (prev) prev.w = Math.max(prev.w, w); else l.push({ t, w });
      keys.set(k, l);
    };
    const addAlias = (a, t, w) => {
      if (!a) return;
      if (/[א-ת]/.test(a)) { add('h:' + heKey(a), t, w); return; }
      for (const k of latinKeys(a)) add('l:' + k, t, w);
      add('v:' + translitKey(a), t, w);
    };
    for (const t of g.terms) {
      addAlias(t.he, t, 3); for (const h of t.he_raw || []) addAlias(h, t, 1);
      addAlias(t.en, t, 3);
      for (const a of [...(t.ashk || []), ...(t.sef || [])]) addAlias(a, t, 2.5);
      for (const a of t.en_alt || []) addAlias(a, t, 2);
    }
    const sourceNames = new Map(), sourceAliases = new Map();
    const addSource = (a, v) => {
      const al = sourceAliases.get(v.title) || new Set(); al.add(/[א-ת]/.test(a) ? 'h:' + heKey(a) : 'v:' + translitKey(a)); sourceAliases.set(v.title, al); const k = /[א-ת]/.test(a) ? 'h:' + heKey(a) : 'l:' + skel(a); if (k.length > 3 && !sourceNames.has(k)) sourceNames.set(k, v); };
    for (const b of g.books) for (const a of [b.en, b.he, ...(b.he_alt || []), ...(b.variants || [])]) addSource(a, { title: b.en, kind: b.kind });
    for (const [en, alts] of Object.entries(RABBAH_EN)) for (const a of [en, ...alts]) addSource(a, { title: en, kind: 'rabbah' });
    for (const t of g.terms.filter(t => t.kind === 'source_book')) for (const a of [t.he, ...(t.he_raw || []), t.en, ...(t.en_alt || []), ...(t.ashk || []), ...(t.sef || [])]) {
      if (!a) continue;
      for (const v of [a, ...String(a).split(/\s*\/\s*/), String(a).replace(/^(midrash|sefer|the)\s+/i, '')]) if (v) addSource(v, { title: t.he, kind: 'named', term: t });
    }
    return { raw: g, keys, sourceNames, sourceAliases, byId: new Map(g.terms.map(t => [t.id, t])) };
  }
  async function index() { if (!M) M = buildIndex(await loadMaf('glossary.json')); return M; }

  function findTerms(M, query, kinds = ['topic']) {
    const q = String(query).trim();
    const scores = new Map();
    const bump = (t, s) => { if (kinds.includes(t.kind)) scores.set(t, Math.max(scores.get(t) || 0, s)); };
    if (!q) return [];
    if (/[א-ת]/.test(q)) {
      const k = heKey(q);
      const variants = [k, k.replace(/^[והבלמש]/, ''), k.replace(/^ה/, '')].filter(x => x.length >= 2);
      for (const v of variants) for (const { t, w } of M.keys.get('h:' + v) || []) bump(t, 100 + w * 10 - (v === k ? 0 : 5));
      if (k.length >= 2) for (const [key, l] of M.keys) {
        if (!key.startsWith('h:')) continue;
        const hk = key.slice(2);
        if (hk.includes(k) || (k.length >= 4 && k.includes(hk) && hk.length >= 3)) for (const { t, w } of l) bump(t, (hk.startsWith(k) ? 60 : 40) + w);
      }
    } else {
      const qk = latinKeys(q), qwords = wordSkels(q).filter((w, i) => w && !MAF_STOP.has(q.toLowerCase().split(/[^a-z']+/).filter(Boolean)[i]));
      for (const { t, w } of M.keys.get('v:' + translitKey(q)) || []) bump(t, 160 + w * 10);
      for (const k of qk) for (const { t, w } of M.keys.get('l:' + k) || []) bump(t, 100 + w * 10);
      for (const t of M.raw.terms) {
        if (!kinds.includes(t.kind)) continue;
        for (const a of [t.en, ...(t.en_alt || []), ...(t.ashk || []), ...(t.sef || [])]) {
          if (!a) continue;
          if (qwords.length && wordsIn(qwords, a)) { bump(t, qwords.length === wordSkels(a).length ? 90 : 55); continue; }
          const ak = skel(a);
          for (const k of qk) if (k.length >= 4 && ak.includes(k)) bump(t, 35);
        }
      }
    }
    return [...scores].sort((a, b) => b[1] - a[1] || b[0].n - a[0].n).map(([t, s]) => ({ t, s }));
  }

  function parseSource(M, input) {
    let s = String(input).trim().replace(/\s+/g, ' ').replace(/^(the\s+)?(book of\s+)?/i, '');
    let jt = false;
    if (/^(yerushalmi|jerusalem talmud|talmud yerushalmi|ירושלמי)\s+/i.test(s)) { jt = true; s = s.replace(/^(yerushalmi|jerusalem talmud|talmud yerushalmi|ירושלמי)\s+/i, ''); }
    s = s.replace(/^(bavli|talmud bavli|tb|בבלי|מסכת|masechta|masechet|tractate)\s+/i, '');
    const words = s.split(' ');
    for (let n = Math.min(words.length, 5); n >= 1; n--) {
      const name = words.slice(0, n).join(' '), rest = words.slice(n).join(' ').trim();
      if (/\d/.test(name)) continue;
      const key = /[א-ת]/.test(name) ? 'h:' + heKey(name) : 'l:' + skel(name);
      const hit = M.sourceNames.get(key);
      if (!hit) continue;
      let addr = '';
      const d = rest.match(/^(\d+)\s*([ab]|[:.]\s*(\d+))?\s*$/i);
      if (d) addr = d[3] ? `${d[1]}:${d[3]}` : d[2] && /[ab]/i.test(d[2]) ? `${d[1]}${d[2].toLowerCase()}` : d[1];
      else if (/^[א-ת"'׳״\s:.,]+$/.test(rest) && rest) {
        const tok = rest.replace(/[:.,]/g, ' ').split(/\s+/).filter(Boolean);
        const a = gematria(tok[0]);
        if (hit.kind === 'shas' && tok[1] && /^(ע"?[אב]|[אב]|עמוד [אב])$/.test(tok.slice(1).join(' ').replace(/['׳״]/g, '"'))) addr = `${a}${/ב/.test(tok.slice(1).join(' ')) ? 'b' : 'a'}`;
        else addr = tok[1] ? `${a}:${gematria(tok[1])}` : String(a);
      } else if (rest) continue;
      let title = hit.title;
      if (hit.kind === 'shas' && jt) title = `Jerusalem Talmud ${title}`;
      return { ...hit, title, addr };
    }
    const best = findTerms(M, s, ['source_book'])[0];
    if (best && best.s >= 100) return { title: best.t.he, kind: 'named', term: best.t, addr: '' };
    return null;
  }

  // ------------------------------------------------------------ parshiyos (Hebrew chapter:verse numbering, as Sefaria)
  const PARSHIYOS = [
    ['Bereshit', 'בראשית', 'Bereishis', 'Genesis', '1:1', '6:8'], ['Noach', 'נח', 'Noach', 'Genesis', '6:9', '11:32'],
    ['Lech Lecha', 'לך לך', 'Lech Lecha', 'Genesis', '12:1', '17:27'], ['Vayera', 'וירא', 'Vayeira', 'Genesis', '18:1', '22:24'],
    ['Chayei Sara', 'חיי שרה', 'Chayei Sarah', 'Genesis', '23:1', '25:18'], ['Toldot', 'תולדות', 'Toldos', 'Genesis', '25:19', '28:9'],
    ['Vayetzei', 'ויצא', 'Vayeitzei', 'Genesis', '28:10', '32:3'], ['Vayishlach', 'וישלח', 'Vayishlach', 'Genesis', '32:4', '36:43'],
    ['Vayeshev', 'וישב', 'Vayeishev', 'Genesis', '37:1', '40:23'], ['Miketz', 'מקץ', 'Mikeitz', 'Genesis', '41:1', '44:17'],
    ['Vayigash', 'ויגש', 'Vayigash', 'Genesis', '44:18', '47:27'], ['Vayechi', 'ויחי', 'Vayechi', 'Genesis', '47:28', '50:26'],
    ['Shemot', 'שמות', 'Shemos', 'Exodus', '1:1', '6:1'], ['Vaera', 'וארא', "Va'eira", 'Exodus', '6:2', '9:35'],
    ['Bo', 'בא', 'Bo', 'Exodus', '10:1', '13:16'], ['Beshalach', 'בשלח', 'Beshalach', 'Exodus', '13:17', '17:16'],
    ['Yitro', 'יתרו', 'Yisro', 'Exodus', '18:1', '20:23'], ['Mishpatim', 'משפטים', 'Mishpatim', 'Exodus', '21:1', '24:18'],
    ['Terumah', 'תרומה', 'Terumah', 'Exodus', '25:1', '27:19'], ['Tetzaveh', 'תצוה', 'Tetzaveh', 'Exodus', '27:20', '30:10'],
    ['Ki Tisa', 'כי תשא', 'Ki Sisa', 'Exodus', '30:11', '34:35'], ['Vayakhel', 'ויקהל', 'Vayakhel', 'Exodus', '35:1', '38:20'],
    ['Pekudei', 'פקודי', 'Pekudei', 'Exodus', '38:21', '40:38'], ['Vayikra', 'ויקרא', 'Vayikra', 'Leviticus', '1:1', '5:26'],
    ['Tzav', 'צו', 'Tzav', 'Leviticus', '6:1', '8:36'], ['Shmini', 'שמיני', 'Shemini', 'Leviticus', '9:1', '11:47'],
    ['Tazria', 'תזריע', 'Tazria', 'Leviticus', '12:1', '13:59'], ['Metzora', 'מצורע', 'Metzora', 'Leviticus', '14:1', '15:33'],
    ['Achrei Mot', 'אחרי מות', 'Acharei Mos', 'Leviticus', '16:1', '18:30'], ['Kedoshim', 'קדושים', 'Kedoshim', 'Leviticus', '19:1', '20:27'],
    ['Emor', 'אמור', 'Emor', 'Leviticus', '21:1', '24:23'], ['Behar', 'בהר', 'Behar', 'Leviticus', '25:1', '26:2'],
    ['Bechukotai', 'בחוקותי', 'Bechukosai', 'Leviticus', '26:3', '27:34'], ['Bamidbar', 'במדבר', 'Bamidbar', 'Numbers', '1:1', '4:20'],
    ['Nasso', 'נשא', 'Naso', 'Numbers', '4:21', '7:89'], ["Beha'alotcha", 'בהעלותך', "Beha'aloscha", 'Numbers', '8:1', '12:16'],
    ["Sh'lach", 'שלח', 'Shelach', 'Numbers', '13:1', '15:41'], ['Korach', 'קרח', 'Korach', 'Numbers', '16:1', '18:32'],
    ['Chukat', 'חקת', 'Chukas', 'Numbers', '19:1', '22:1'], ['Balak', 'בלק', 'Balak', 'Numbers', '22:2', '25:9'],
    ['Pinchas', 'פינחס', 'Pinchas', 'Numbers', '25:10', '30:1'], ['Matot', 'מטות', 'Mattos', 'Numbers', '30:2', '32:42'],
    ['Masei', 'מסעי', 'Masei', 'Numbers', '33:1', '36:13'], ['Devarim', 'דברים', 'Devarim', 'Deuteronomy', '1:1', '3:22'],
    ['Vaetchanan', 'ואתחנן', "Va'eschanan", 'Deuteronomy', '3:23', '7:11'], ['Eikev', 'עקב', 'Eikev', 'Deuteronomy', '7:12', '11:25'],
    ["Re'eh", 'ראה', "Re'eh", 'Deuteronomy', '11:26', '16:17'], ['Shoftim', 'שופטים', 'Shoftim', 'Deuteronomy', '16:18', '21:9'],
    ['Ki Teitzei', 'כי תצא', 'Ki Seitzei', 'Deuteronomy', '21:10', '25:19'], ['Ki Tavo', 'כי תבוא', 'Ki Savo', 'Deuteronomy', '26:1', '29:8'],
    ['Nitzavim', 'נצבים', 'Nitzavim', 'Deuteronomy', '29:9', '30:20'], ['Vayeilech', 'וילך', 'Vayeilech', 'Deuteronomy', '31:1', '31:30'],
    ["Ha'Azinu", 'האזינו', 'Haazinu', 'Deuteronomy', '32:1', '32:52'], ["V'Zot HaBerachah", 'וזאת הברכה', "V'zos HaBerachah", 'Deuteronomy', '33:1', '34:12'],
  ].map(([key, he, ashk, book, from, to]) => ({ key, he, ashk, book, from: from.split(':').map(Number), to: to.split(':').map(Number) }));
  const PARSHA_EXTRA = { Shmini: ['Shemini', 'Shmini'], Nasso: ['Naso', 'Nasso'], "Sh'lach": ['Shelach', 'Shlach', 'Shelach Lecha', "Sh'lach Lecha"], Achrei: [],
    "V'Zot HaBerachah": ['Vezos Habracha', 'Zos Habracha', 'VeZot HaBracha'], Chukat: ['Chukas', 'Chukat', 'Hukkat'], Vayera: ['Vayeira', 'Vayera'],
    "Ha'Azinu": ['Haazinu', 'Haazinu'], Bereshit: ['Bereishis', 'Bereshit', 'Breishis', 'Bereishit'], Toldot: ['Toldos', 'Toldot', 'Toledot'] };
  function parshaNames(p) { return [p.key, p.ashk, ...(PARSHA_EXTRA[p.key] || [])]; }
  // A parsha named in the query: the whole query ("Vayeishev", "פרשת וישב"), or after "parshas/parashat/פרשת" in a question.
  function findParsha(q) {
    const s = String(q || '').trim();
    const named = s.match(/(?:^|\s)(?:parshas|parashas|parshat|parashat|parsha|parasha|parshat|sidra|sedra|פרשת|פרשה|פ')\s+(.+)$/i);
    if (!named && /\d/.test(s)) return null;
    const cands = named ? [named[1], ...named[1].split(/\s+/).slice(0, 2).map((w, i, a) => a.slice(0, i + 1).join(' '))] : [s.replace(/[?!.]+$/, '')];
    for (const c of cands) {
      const isHe = /[א-ת]/.test(c);
      for (const p of PARSHIYOS) {
        if (isHe ? heKey(c) === heKey(p.he) : parshaNames(p).some(n => translitKey(n) === translitKey(c) && translitKey(c).length >= 2)) return { ...p, span: c };
      }
    }
    // a parsha named anywhere in a question: "themes in Chayei Sarah", "what does Pri Tzaddik say on parshas Vayeishev"
    const words = (named ? named[1] : s).replace(/[?!.,;:()"“”]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let n = 3; n >= 1; n--) for (let i = 0; i + n <= words.length; i++) {
      const c = words.slice(i, i + n).join(' ');
      const isHe = /[א-ת]/.test(c);
      if (!named && (n === 1 ? (isHe ? heKey(c).length < 3 : c.length < 4) : false)) continue;   // a lone short word needs "parshas"
      const p = PARSHIYOS.find(p => isHe ? heKey(c) === heKey(p.he) && (named || n > 1 || heKey(p.he).length >= 4) : parshaNames(p).some(x => translitKey(x) === translitKey(c)));
      if (p && (named || n > 1 || p.he.includes(' ') === false)) return { ...p, span: c };
    }
    return null;
  }
  const verseCmp = (a, b) => a[0] - b[0] || a[1] - b[1];
  const inParsha = (p, ch, vs) => verseCmp([ch, vs], p.from) >= 0 && verseCmp([ch, vs], p.to) <= 0;

  // ------------------------------------------------------------ understanding a query
  const EN_STOP = new Set(('a an the of in on to and or for with by from at as is are was were be been being do does did what why how when where who whom which whose ' +
    'that this these those there here it its he his him she her they them their we our us i me my you your can could should would will shall may might must ' +
    'about according say says said saying mean means meaning teach teaches taught explain explains explanation idea ideas concept view views opinion ' +
    'relationship connection between rav tzadok tzaddok tzadik hakohen r reb rebbe pri peri tzaddik sefer seforim sefarim book books write writes wrote ' +
    'discuss discusses discussed talk talks speak speaks find show tell me please source sources mafteach also other some any all more most very much many ' +
    'not no yes than then so if but because into over under up down out just only even like').split(' '));
  const HE_STOP = new Set('מה למה מדוע איך היכן איפה מי מתי האם של על את אל עם כי לא הוא היא הם הן זה זו זאת יש אין גם רק כל או אם בין לבין מן לפי עוד אצל ענין עניין רבי צדוק הכהן ר צדקת פרי צדיק בספר ספר'.split(' '));
  function tokens(q) {
    const isHe = /[א-ת]/.test(q);
    const raw = String(q).replace(/[?!.,;:()"“”]+/g, ' ').split(/\s+/).filter(Boolean);
    return raw.map(w => ({ w, keep: isHe || /[א-ת]/.test(w) ? !HE_STOP.has(heKey(w)) && heKey(w).length >= 2 : !EN_STOP.has(w.toLowerCase().replace(/'s$/, '')) && w.length >= 2 }));
  }
  // English/transliteration: an alias spelled exactly so, or the same word in another transliteration, counts;
  // a bare consonant skeleton (emunah ~ moon, called ~ cloud, faith ~ feast) counts only inside a longer phrase.
  function gateLatin(found, phrase, n) {
    const pl = phrase.toLowerCase().replace(/'s$/, '').trim(), pk = translitKey(phrase);
    return found.map(x => {
      const al = [x.t.en, ...(x.t.en_alt || []), ...(x.t.ashk || []), ...(x.t.sef || [])].filter(Boolean);
      const exact = al.some(a => a.toLowerCase() === pl || a.toLowerCase() === pl + 's' || a.toLowerCase() + 's' === pl);
      const tr = pk.length >= 3 && al.some(a => translitKey(a) === pk || (n === 1 && a.split(/\s+/).length <= 3 && translitKey(a.split(/\s+/)[0]) === pk));
      return { ...x, s: x.s + (exact ? 60 : tr ? 40 : 0), ok: exact || tr || (n > 1 && x.s >= 100) };
    }).filter(x => x.ok).sort((a, b) => b.s - a.s);
  }
  // Misspellings: "Ishamel", "dYishamel" -> Ishmael. Compares the transliteration key of the word with each heading's
  // names (and their first word: "Avraham" in "Avraham Avinu"), allowing about one slip per four letters.
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }
  function fuzzyTerms(M, phrase) {
    const k = translitKey(phrase);
    if (k.length < 4) return [];
    const max = Math.max(1, Math.floor(k.length / 4));
    const out = [];
    for (const t of M.raw.terms) {
      if (t.kind !== 'topic' || !t.n) continue;
      let best = 99;
      for (const a of [t.en, ...(t.en_alt || []), ...(t.ashk || []), ...(t.sef || [])]) {
        if (!a) continue;
        const words = a.split(/\s+/);
        for (const c of words.length <= 3 ? [a, words[0]] : [a]) { const ck = translitKey(c); if (ck.length >= 3) best = Math.min(best, dist(k, ck, max)); }
      }
      if (best <= max) out.push({ t, s: 150 - 20 * best });
    }
    return out.sort((a, b) => b.s - a.s || b.t.n - a.t.n).slice(0, 6);
  }
  // Find topics for a whole question: each phrase of 1-3 content words is matched to headings; topics that match more of the
  // question rank first. Returns [{t, score, words:Set}] best first.
  function questionTopics(M, q, { fuzzy = true } = {}) {
    const tok = tokens(q);
    const out = new Map();
    const note = (t, s, from, to) => {
      const cur = out.get(t) || { t, score: 0, words: new Set(), best: 0 };
      for (let i = from; i < to; i++) cur.words.add(i);
      cur.best = Math.max(cur.best, s); out.set(t, cur);
    };
    for (let i = 0; i < tok.length; i++) {
      if (!tok[i].keep) continue;
      for (let n = 3; n >= 1; n--) {
        if (i + n > tok.length) continue;
        const span = tok.slice(i, i + n);
        if (!span[n - 1].keep) continue;
        const phrase = span.map(x => x.w).join(' ');
        const isHe = /[א-ת]/.test(phrase);
        let found = findTerms(M, phrase, ['topic']).filter(x => x.t.n > 0);
        if (!isHe) found = gateLatin(found, phrase, n);
        if (!isHe && !found.length && n === 1 && fuzzy) found = fuzzyTerms(M, phrase);
        const top = found.length ? found[0].s : 0;
        const min = isHe ? 100 : 90;
        for (const { t, s } of found.slice(0, 6)) if (s >= min && s >= top - 35) note(t, s + 15 * (n - 1), i, i + n);
      }
    }
    for (const v of out.values()) v.score = v.best + 40 * (v.words.size - 1) + Math.log2(1 + v.t.n) * 3;
    return [...out.values()].sort((a, b) => b.score - a.score);
  }
  // A pasuk/daf/midrash anywhere in the query: "what does Rav Tzadok say on Bereishis 2:7?"
  function findSourceIn(M, q) {
    const bare = q.replace(/[?!]+$/, '').trim();
    const whole = parseSource(M, bare);
    const named = ps => {                              // "Ishmael" must not become Shmuel, nor "Moshe" Amos
      const k = /[א-ת]/.test(bare) ? 'h:' + heKey(bare) : 'v:' + translitKey(bare.replace(/^(the\s+)?(book of\s+)?/i, ''));
      if (ps.kind === 'named') return [ps.term.he, ...(ps.term.he_raw || []), ps.term.en, ...(ps.term.en_alt || []), ...(ps.term.ashk || []), ...(ps.term.sef || [])].filter(Boolean)
        .some(a => (/[א-ת]/.test(a) ? 'h:' + heKey(a) : 'v:' + translitKey(a)) === k);
      return (M.sourceAliases.get(ps.title) || new Set()).has(k);
    };
    if (whole && (whole.addr || named(whole))) return { ...whole, span: q };
    const words = q.replace(/[?!,;()"“”]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) for (let j = Math.min(words.length, i + 6); j > i; j--) {
      const span = words.slice(i, j).join(' ');
      if (!/\d/.test(words[j - 1]) && !(j < words.length && false)) continue;
      const ps = parseSource(M, span);
      if (ps && ps.addr) return { ...ps, span };
    }
    // Hebrew address in a Hebrew question: "בראשית ב ז"
    if (/[א-ת]/.test(q)) for (let i = 0; i < words.length; i++) for (let j = Math.min(words.length, i + 5); j > i + 1; j--) {
      const span = words.slice(i, j).join(' ');
      const ps = parseSource(M, span);
      if (ps && ps.addr && ps.kind !== 'named') return { ...ps, span };
    }
    return null;
  }
  async function analyze(q) {
    const M = await index();
    const query = String(q || '').trim();
    const source = findSourceIn(M, query);
    const parsha = findParsha(query);
    let rest = source && source.addr ? query.replace(source.span, ' ').replace(/\s+/g, ' ').trim() : query;
    // a parsha in a question: its name is not a topic ("Chayei Sarah" is not Living or Barley); the rest of the question is
    if (parsha && parsha.span && !(parsha.span === query && parsha.he.includes(' ') === false && /^[A-Za-z]+$/.test(query) && false)) {
      const r2 = rest.replace(parsha.span, ' ').replace(/(^|\s)(parshas|parashas|parshat|parashat|parsha|parasha|sidra|sedra|פרשת|פרשה)(?=\s|$)/gi, ' ')
        .replace(/(^|\s)(themes?|ideas?|topics?|in|of|on|the|for|about|what|are|is)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
      if (r2 !== rest.trim() && parsha.span !== query.trim()) rest = r2;
    }
    let whole = rest ? findTerms(M, rest, ['topic']).filter(x => x.t.n > 0) : [];
    const weakAll = whole;
    if (rest && !/[א-ת]/.test(rest)) whole = gateLatin(whole, rest, tokens(rest).filter(x => x.keep).length);
    let topics = rest ? questionTopics(M, rest, { fuzzy: !source && !parsha }) : [];
    // whole-query matches first when strong (an exact heading), then the question's topics
    const strongWhole = whole.filter(x => x.s >= 90).map(x => ({ t: x.t, score: x.s + 100, words: new Set(), best: x.s }));
    const seen = new Set(); const merged = [];
    for (const x of [...strongWhole, ...topics]) if (!seen.has(x.t.id)) { seen.add(x.t.id); merged.push(x); }
    topics = merged;
    const weak = (topics.length ? whole : weakAll).filter(x => !seen.has(x.t.id)).slice(0, 12).map(x => x.t);
    return { query, source, parsha, topics, weak, hebrew: /[א-ת]/.test(query) };
  }

  // ------------------------------------------------------------ entries
  const FLAG = /^[*?~]+$/;
  function refInfo(r) {
    const [label, ref, bookEn, flags = ''] = r.length === 3 && FLAG.test(r[2] || '') ? [r[0], r[1], null, r[2]] : r;
    const loc = String(label || '').replace(/^[א-ת]{2}-/, '');
    const text = ref || (bookEn ? `${bookEn} ${loc}` : label);
    return { ref: ref || null, text, long: String(flags).includes('*'), unsure: String(flags).includes('?') };
  }
  async function topicEntries(id) { return loadShard(`topic/${id}.json`); }
  async function sourceEntries(ps) {
    if (ps.kind === 'named') return loadShard(`source/b-${ps.term.id}.json`);
    if (!ps.addr) return null;
    const chapter = ps.addr.match(/^\d+/)[0];
    const shard = await loadShard(`source/${fileKey(`${ps.title} ${chapter}`)}.json`);
    const exact = ps.addr.includes(':') || /[ab]$/.test(ps.addr);
    if (exact) return shard.filter(e => e.k === `${ps.title} ${ps.addr}`);
    const re = new RegExp(`^${ps.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${chapter}(?:[ab]|:|$)`);
    return shard.filter(e => re.test(e.k || ''));
  }
  const corpusFilter = (list, corpus) => (corpus === 'pt' || corpus === 'rt') ? list.filter(e => e.c === corpus) : list;
  const sndKey = w => skel(w).replace(/v/g, 'b').replace(/w/g, 'b');   // by sound: Lavan = Laban, Efron = Ephron
  // Full-text search inside entry texts (Hebrew words), loading the parts on demand.
  // q's words must all occur (Hebrew as written, English also by sound: Efron = Ephron). A word no entry contains is
  // dropped ("Mearas Machpeilah": the English says "Cave of Machpelah"). alt: Hebrew phrases that match on their own
  // (the Hebrew of the heading the query found, e.g. המכפלה).
  async function searchEntries(M, q, corpus, limit = 200, { alt = [] } = {}) {
    let terms = [...q.matchAll(/"([^"]+)"|(\S+)/g)].map(m => norm(m[1] || m[2]).trim()).filter(Boolean)
      .filter(t => /[א-ת]/.test(t) ? !HE_STOP.has(t.replace(/ /g, '')) : t.length >= 3 && !EN_STOP.has(t));
    const alts = alt.map(a => norm(a).trim()).filter(a => a.replace(/ /g, '').length >= 3);
    if (!terms.length && !alts.length) return { total: 0, hits: [] };
    const parts = corpus === 'rt' ? ['1-2', '3'] : corpus === 'pt' ? ['4', '5', '7'] : M.raw.parts;
    const texts = [];
    for (const p of parts) { try { texts.push(await loadMaf(`text/${p}.txt`)); } catch {} }
    const run = (terms, count) => {
      const skels = terms.map(t => !/[א-ת]/.test(t) && !t.includes(' ') ? (k => k.length >= 3 ? k : null)(sndKey(t)) : null);
      const seen = terms.map(() => 0), hits = []; let total = 0;
      for (const text of texts) for (const line of text.split('\n')) {
        const tab = line.indexOf('\t');
        const hay = line.slice(0, tab);
        let sk = null;
        const has = (t, i) => hay.includes(t) || (skels[i] && (sk = sk || new Set((hay.match(/[a-z]{3,}/g) || []).map(sndKey))).has(skels[i]));
        let all = terms.length > 0;
        terms.forEach((t, i) => { if (has(t, i)) seen[i]++; else all = false; });
        if (all || alts.some(a => hay.includes(' ' + a + ' ') || hay.includes(a))) { total++; if (hits.length < limit) hits.push(JSON.parse(line.slice(tab + 1))); }
      }
      return { total, hits, seen };
    };
    let r = run(terms);
    if (!r.total && terms.length > 1 && r.seen.some(n => n > 0)) r = run(terms.filter((t, i) => r.seen[i] > 0));
    return { total: r.total, hits: r.hits };
  }
  const appUrl = key => (sefariaUrl(key) ? '#/read/' + API.toHash(String(key)) : null);   // sources open in the app's reader
  function sefariaUrl(key) {
    const m = String(key || '').match(/^(.*?)\s+(\d+[ab]?)(?::(\d+))?$/);
    return m ? 'https://www.sefaria.org/' + m[1].replace(/ /g, '_') + '.' + m[2] + (m[3] ? '.' + m[3] : '') : null;
  }

  // ------------------------------------------------------------ shiur builder (pure: data in, outline out)
  // Topic: the sub-topics with most entries become the sections; in each, the entries the Mafteach marks as treated at
  // length come first, then those with library links, spread across sefarim.
  function planTopicShiur(M, topic, entries, { sections = 6, perSection = 3 } = {}) {
    const linked = entries.filter(e => e.r.some(r => refInfo(r).ref));
    const groups = new Map();
    for (const e of linked) {
      const k = e.U != null ? 'u' + e.U : e.Uh ? 'h' + e.Uh : '_';
      if (!groups.has(k)) groups.set(k, { key: k, sub: e.U != null ? M.byId.get(e.U) : null, subHe: e.Uh || null, entries: [] });
      groups.get(k).entries.push(e);
    }
    let list = [...groups.values()].sort((a, b) => b.entries.length - a.entries.length);
    const general = list.find(g => g.key === '_');
    list = list.filter(g => g.key !== '_' && g.entries.length >= 2).slice(0, general ? sections - 1 : sections);
    if (general) list.unshift(general);
    if (!list.length && linked.length) list = [{ key: '_', sub: null, entries: linked }];
    if (list.length === 1) perSection = Math.max(perSection, 8);          // a heading without sub-headings: one longer section
    else if (list.length <= 3) perSection = Math.max(perSection, 5);
    const usedBooks = new Map(), usedRefs = new Set();
    const bookOf = ref => String(ref).replace(/\s+\d+(:\d+)?$/, '').replace(/^(Peri Tzadik),.*$/, '$1');
    const out = [];
    for (const g of list) {
      const scored = g.entries.map(e => {
        const refs = e.r.map(refInfo).filter(x => x.ref);
        const primary = refs.find(x => x.long) || refs[0];
        const len = e.t.length;
        const score = (primary.long ? 4 : 0) + Math.min(refs.length, 4) * 0.6 + (len > 18 && len < 140 ? 1 : 0) - (usedBooks.get(bookOf(primary.ref)) || 0) * 0.8 - (usedRefs.has(primary.ref) ? 5 : 0);
        return { e, refs, primary, score };
      }).sort((a, b) => b.score - a.score);
      const picks = [];
      for (const x of scored) {
        if (picks.length >= perSection) break;
        if (usedRefs.has(x.primary.ref)) continue;
        picks.push(x); usedRefs.add(x.primary.ref);
        usedBooks.set(bookOf(x.primary.ref), (usedBooks.get(bookOf(x.primary.ref)) || 0) + 1);
      }
      if (picks.length) out.push({ heading: g.sub ? { he: g.sub.he, en: g.sub.en } : g.subHe ? { he: g.subHe, en: '' } : { he: topic.he, en: topic.en, general: true },
        total: g.entries.length, items: picks.map(x => ({ caption: x.e.t, en: x.e.e || '', ref: x.primary.ref, long: x.primary.long, also: x.refs.filter(r => r.ref !== x.primary.ref).map(r => r.ref) })) });
    }
    const books = new Set(entries.flatMap(e => e.r.map(r => refInfo(r)).map(x => x.ref ? bookOf(x.ref) : x.text.replace(/\s+\S+$/, ''))));
    return { kind: 'topic', title: { he: topic.he, en: topic.en }, entries: entries.length, linked: linked.length, books: books.size, sections: out };
  }
  // Parsha: Pri Tzaddik's maamarim on the parsha with their themes; the parsha's pesukim in order with what Rav Tzadok
  // draws from each; the themes that recur.
  function planParshaShiur(p, ptPassages, sourceEntriesList, { perPasuk = 4 } = {}) {
    const maamarim = Object.entries(ptPassages || {}).map(([ref, e]) => ({ ref, topics: (e.t || []).slice(0, 5), sources: (e.s || []).filter(s => /\d/.test(s[0])).slice(0, 4).map(s => s[0]) }))
      .sort((a, b) => (+a.ref.match(/(\d+)$/)?.[1] || 0) - (+b.ref.match(/(\d+)$/)?.[1] || 0));
    const byVerse = new Map();
    for (const e of sourceEntriesList) {
      const m = String(e.k || '').match(/^(\w+) (\d+):(\d+)$/);
      if (!m || m[1] !== p.book || !inParsha(p, +m[2], +m[3])) continue;
      if (!byVerse.has(e.k)) byVerse.set(e.k, { key: e.k, ch: +m[2], vs: +m[3], entries: [] });
      byVerse.get(e.k).entries.push(e);
    }
    const pesukim = [...byVerse.values()].sort((a, b) => a.ch - b.ch || a.vs - b.vs).map(v => {
      const ranked = v.entries.map(e => ({ e, refs: e.r.map(refInfo) })).sort((a, b) => (b.refs.some(r => r.ref) - a.refs.some(r => r.ref)) || b.refs.length - a.refs.length);
      const caps = v.entries.map(e => e.t).filter(t => t.replace(/[^א-ת]/g, '').length > 5).sort((a, b) => a.length - b.length);
      return { key: v.key, quote: caps[0] || ranked[0].e.t, total: v.entries.length,
        items: ranked.slice(0, perPasuk).map(x => ({ caption: x.e.t, refs: x.refs })) };
    });
    const themeCount = new Map();
    for (const m of maamarim) for (const [he, en] of m.topics) { const k = he; const c = themeCount.get(k) || { he, en, n: 0 }; c.n++; themeCount.set(k, c); }
    const themes = [...themeCount.values()].filter(t => t.n >= 2).sort((a, b) => b.n - a.n).slice(0, 14);
    return { kind: 'parsha', title: { he: 'פרשת ' + p.he, en: 'Parshas ' + p.ashk }, parsha: p, maamarim, pesukim, themes,
      range: `${p.book} ${p.from.join(':')}–${p.to.join(':')}` };
  }
  async function ptSectionPassages(p) {
    let ix;
    try { ix = await load(PANEL_BASE + 'index.json'); } catch { return {}; }
    const name = Object.keys(ix.books || {}).find(k => k === 'Peri Tzadik, ' + p.key)
      || Object.keys(ix.books || {}).find(k => k.startsWith('Peri Tzadik, ') && parshaNames(p).some(n => translitKey(k.slice(13)) === translitKey(n)));
    if (!name) return {};
    try { return (await load(PANEL_BASE + ix.books[name].file)).passages || {}; } catch { return {}; }
  }
  async function parshaSources(p) {
    const chapters = []; for (let c = p.from[0]; c <= p.to[0]; c++) chapters.push(c);
    const lists = await Promise.all(chapters.map(c => loadShard(`source/${fileKey(`${p.book} ${c}`)}.json`)));
    return lists.flat();
  }
  function shiurText(plan) {
    const L = [];
    if (plan.kind === 'topic') {
      L.push(`${plan.title.en} — ${plan.title.he}`, `Rav Tzadok HaKohen on this topic. Built from HaMafteach HaShalem (${plan.entries} entries in ${plan.books} sefarim).`, '');
      plan.sections.forEach((s, i) => {
        L.push(`${i + 1}. ${s.heading.general ? 'General' : `${s.heading.en || ''}${s.heading.en ? ' — ' : ''}${s.heading.he}`}`);
        for (const it of s.items) L.push(`   • ${it.en ? it.en + ' — ' : ''}${it.caption.replace(/(^|\s)-(?=\s|$)/g, '$1' + plan.title.he)} — ${it.ref}${it.long ? ' (at length)' : ''}${it.also.length ? `; see also ${it.also.join(', ')}` : ''}`);
        L.push('');
      });
    } else {
      L.push(`${plan.title.en} — ${plan.title.he}`, `Rav Tzadok HaKohen on the parsha (${plan.range}). Built from HaMafteach HaShalem and the Pri Tzaddik.`, '');
      if (plan.maamarim.length) {
        L.push('Pri Tzaddik on the parsha:');
        for (const m of plan.maamarim) L.push(`   • ${m.ref}: ${m.topics.map(t => t[1] || t[0]).join(', ')}`);
        L.push('');
      }
      if (plan.pesukim.length) {
        L.push('Pesukim of the parsha in Rav Tzadok\'s writings:');
        for (const v of plan.pesukim) {
          L.push(`   ${v.key} — ${v.quote}`);
          for (const it of v.items) L.push(`      • ${it.refs.map(r => r.text).join('; ')}`);
        }
        L.push('');
      }
      if (plan.themes.length) L.push('Recurring themes: ' + plan.themes.map(t => `${t.en || t.he} (${t.he})`).join(', '));
    }
    return L.join('\n');
  }

  // ------------------------------------------------------------ UI
  const CSS = `
.maf-page{max-width:980px;margin:0 auto;padding:22px 18px 60px}
.maf-page h1{font:500 1.7rem var(--en,Georgia,serif);margin:0 0 4px}
.maf-page .maf-sub{color:var(--muted);margin:0 0 16px;font:400 .92rem var(--ui,system-ui)}
.maf-form{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.maf-form input[type=search]{flex:1 1 320px;min-width:0;height:44px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);padding:0 14px;font:400 1rem var(--ui,system-ui)}
.maf-form input[type=search]:focus{outline:2px solid var(--brass);border-color:transparent}
.maf-form select{height:44px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);padding:0 10px;font:500 .85rem var(--ui,system-ui)}
.maf-form button,.maf-btn{height:44px;padding:0 16px;border-radius:8px;border:1px solid var(--forest,#2f4a3a);background:var(--forest,#2f4a3a);color:#fff;font:600 .88rem var(--ui,system-ui);cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.maf-btn.ghost{background:transparent;color:var(--forest,#2f4a3a)}
.maf-examples{font:400 .84rem var(--ui,system-ui);color:var(--muted);margin:0 0 22px}
.maf-examples a{color:var(--forest,#2f4a3a);margin:0 4px;white-space:nowrap}
.maf-card{border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:0 0 16px;background:var(--paper,transparent)}
.maf-card h2{font:600 1.08rem var(--ui,system-ui);margin:0 0 4px;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.maf-card h3{font:600 .95rem var(--ui,system-ui);margin:16px 0 6px;color:var(--forest,#2f4a3a)}
.maf-card .maf-meta{font:400 .82rem var(--ui,system-ui);color:var(--muted);margin:0 0 10px}
.maf-he{font-family:"Frank Ruhl Libre","Taamey Frank CLM","SBL Hebrew",serif;font-size:1.08em;direction:rtl;unicode-bidi:isolate}
.maf-list{list-style:none;margin:0;padding:0}
.maf-list li{padding:7px 0;border-top:1px solid var(--line);line-height:1.55}
.maf-list li:first-child{border-top:0}
.maf-refs{font:500 .84rem var(--ui,system-ui);margin-top:2px;display:flex;flex-wrap:wrap;gap:4px 12px}
.maf-refs a{color:var(--forest,#2f4a3a)}
.maf-refs span{color:var(--muted)}
.maf-en{font:400 .9rem/1.45 var(--en,Georgia,serif);color:var(--muted);margin-top:1px}
.maf-dash{color:var(--muted);font-weight:600}
.maf-tag{font:600 .66rem var(--ui,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--brass,#8a6d2f);margin-inline-start:4px}
.maf-chips{display:flex;flex-wrap:wrap;gap:6px}
.maf-chips a{border:1px solid var(--line);border-radius:999px;padding:5px 11px;font:500 .82rem var(--ui,system-ui);color:var(--ink);text-decoration:none}
.maf-chips a:hover{border-color:var(--forest,#2f4a3a)}
.maf-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}
.maf-more{background:none;border:0;color:var(--forest,#2f4a3a);font:600 .85rem var(--ui,system-ui);cursor:pointer;padding:8px 0}
.maf-note{font:400 .8rem var(--ui,system-ui);color:var(--muted);margin-top:18px}
.maf-shiur h2.sec{font:600 1.12rem var(--ui,system-ui);margin:26px 0 8px;padding-top:12px;border-top:2px solid var(--line)}
.maf-src{margin:0 0 16px}
.maf-src .cap{line-height:1.6}
.maf-src .txt{margin:6px 0 0;padding:10px 14px;border-inline-start:3px solid var(--brass,#8a6d2f);background:var(--soft,rgba(0,0,0,.03));border-radius:4px;line-height:1.9;font-size:1.05rem}
.maf-src .txt .en{direction:ltr;font:400 .92rem/1.6 var(--en,Georgia,serif);color:var(--muted);margin-top:6px}
.maf-src .src-ref{font:600 .86rem var(--ui,system-ui)}
.maf-home{border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:0 0 18px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.maf-home b{font:600 1rem var(--ui,system-ui)}.maf-home p{margin:2px 0 0;color:var(--muted);font:400 .86rem var(--ui,system-ui)}
.maf-home form{display:flex;gap:8px;flex:1 1 340px}.maf-home input{flex:1;min-width:0;height:40px;border:1px solid var(--line);border-radius:8px;padding:0 12px;background:var(--bg);color:var(--ink);font:400 .95rem var(--ui,system-ui)}
.maf-suggest-head{padding:6px 12px 2px;font:700 .66rem var(--ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--faint,#999);border-top:1px solid var(--line)}
@media print{.top,.maf-actions,.maf-form,.maf-examples,.maf-more,.offline-pill,.toast,.maf-noprint{display:none!important}.maf-page{padding:0}.maf-card{border:0;padding:0}.maf-src{break-inside:avoid}a{color:inherit;text-decoration:none}}
@media(max-width:600px){.maf-page{padding:16px 12px 50px}.maf-page h1{font-size:1.35rem}.maf-card{padding:13px 12px}}`;
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('maf-search-css')) return;
    const st = document.createElement('style'); st.id = 'maf-search-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const escD = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toHashD = ref => encodeURIComponent(ref).replace(/%20/g, '_').replace(/%2C/g, ',').replace(/%3A/g, ':');
  let API = { esc: escD, toHash: toHashD, fetchText: null };
  const E = s => API.esc(s);
  const readLink = ref => '#/read/' + API.toHash(ref);
  const qs = o => Object.entries(o).filter(([, v]) => v != null && v !== '' && v !== 'all').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const mafHash = o => '#/mafteach?' + qs(o);
  const shiurHash = o => '#/shiur?' + qs(o);

  // The Mafteach writes "-" for the heading word; show the word itself (muted) when the heading is short.
  function capHTML(text, headHe) {
    const t = String(text || '');
    if (!headHe || headHe.split(/\s+/).length > 3) return `<span class="maf-he" lang="he">${E(t)}</span>`;
    const parts = t.split(/(^|\s)-(?=\s|$)/);
    return `<span class="maf-he" lang="he">${parts.map((x, i) => i % 2 ? E(x) + `<span class="maf-dash" title="the heading word">${E(headHe)}</span>` : E(x)).join('')}</span>`;
  }
  const headOf = e => (e && e.T != null && M ? M.byId.get(e.T)?.he : null) || e?.Th || null;
  function refsHTML(e) {
    const refs = e.r.map(refInfo);
    if (!refs.length) return '<span>(no reference legible in the printed index)</span>';
    return refs.map(x => x.ref
      ? `<a href="${readLink(x.ref)}">${E(x.ref)}</a>${x.long ? '<span class="maf-tag">at length</span>' : ''}`
      : `<span>${E(x.text)}${x.unsure ? ' ?' : ''}</span>`).join('');
  }
  function entryHTML(M, e, { topic = false } = {}) {
    let head = '';
    if (topic) {
      const T = e.T != null ? M.byId.get(e.T) : null;
      if (T) head = `<a href="${mafHash({ topic: T.id })}" class="maf-tag" style="text-transform:none;letter-spacing:0">${E(T.en || T.he)}</a> `;
    }
    if (e.x === 's' && e.k) head += `<a class="maf-tag" style="text-transform:none;letter-spacing:0" href="${appUrl(e.k) || '#'}">${E(e.k)}</a> `;
    return `<li>${head}${e.x === 't' ? capHTML(e.t, headOf(e)) : `<span class="maf-he" lang="he">${E(e.t)}</span>`}${e.e ? `<div class="maf-en">${E(e.e)}</div>` : ''}<div class="maf-refs">${refsHTML(e)}</div></li>`;
  }
  function entryListHTML(M, entries, { show = 25, grouped = false, topic = false } = {}) {
    let html = '', sub;
    const row = (e, i) => {
      let h = '';
      if (grouped && e.U !== sub) { sub = e.U; const S = sub != null ? M.byId.get(sub) : null; if (S) h += `</ul><h3><span class="maf-he" lang="he">${E(S.he)}</span>${S.en ? ` — ${E(S.en)}` : ''}</h3><ul class="maf-list">`; }
      return h + (i >= show ? entryHTML(M, e, { topic }).replace('<li>', '<li hidden data-more>') : entryHTML(M, e, { topic }));
    };
    html = '<ul class="maf-list">' + entries.map(row).join('') + '</ul>';
    if (entries.length > show) html += `<button class="maf-more" data-show-more>Show all ${entries.length}</button>`;
    return html.replace(/<ul class="maf-list"><\/ul>/g, '');
  }
  function corpusSelect(corpus) {
    return `<select name="corpus" aria-label="Which sefarim"><option value="all"${corpus === 'all' ? ' selected' : ''}>All Rav Tzadok</option><option value="rt"${corpus === 'rt' ? ' selected' : ''}>His sefarim (not Pri Tzaddik)</option><option value="pt"${corpus === 'pt' ? ' selected' : ''}>Pri Tzaddik</option></select>`;
  }
  function header(q, corpus) {
    return `<h1>Search HaMafteach HaShalem</h1>
      <p class="maf-sub">Ask anything — a question, a word or idea, a person, a pasuk, a daf, a midrash or a parsha — in English, Hebrew, or Ashkenazi or Sefardi transliteration. The Mafteach (R' Chaim Hirsch's complete index to Rav Tzadok) shows where Rav Tzadok discusses it.</p>
      <form class="maf-form" data-maf-form><input type="search" name="q" value="${E(q || '')}" placeholder="e.g. emunah · Bereishis 2:7 · Berachos 6b · why is Shabbos a gift?" aria-label="Ask the Mafteach" autocomplete="off">${corpusSelect(corpus)}<button type="submit">Search</button></form>
      <p class="maf-examples">Try: <a href="${mafHash({ q: 'emunah' })}">emunah</a><a href="${mafHash({ q: 'Avrohom Avinu' })}">Avrohom Avinu</a><a href="${mafHash({ q: 'Bereishis 2:7' })}">Bereishis 2:7</a><a href="${mafHash({ q: 'Berachos 6b' })}">Berachos 6b</a><a href="${mafHash({ q: 'teshuvah and simcha' })}">teshuvah and simcha</a><a href="${mafHash({ q: 'Parshas Vayeishev' })}">Parshas Vayeishev</a><a href="${mafHash({ q: 'חנוכה' })}">חנוכה</a></p>`;
  }
  function wire(el) {
    el.querySelectorAll('[data-maf-form]').forEach(f => f.addEventListener('submit', ev => {
      ev.preventDefault();
      const q = f.q.value.trim(); if (!q) return;
      location.hash = mafHash({ q, corpus: f.corpus ? f.corpus.value : '' });
    }));
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-show-more]');
      if (b) { b.parentElement.querySelectorAll('[data-more]').forEach(x => { x.hidden = false; }); b.remove(); }
    });
  }

  async function renderSearch(app, params) {
    const q = params.get('q') || '', corpus = params.get('corpus') || 'all', topicId = params.get('topic');
    document.title = (q ? q + ' · ' : '') + 'HaMafteach HaShalem · Rav Tzadok Library';
    app.innerHTML = `<div class="page maf-page">${header(q, corpus)}<div data-maf-results><div class="loading">Searching the Mafteach…</div></div></div>`;
    wire(app);
    const out = app.querySelector('[data-maf-results]');
    let M;
    try { M = await index(); } catch (e) { out.innerHTML = '<div class="maf-card">The Mafteach could not be loaded. Check your connection and try again.</div>'; return; }
    if (topicId != null && topicId !== '') {
      const t = M.byId.get(+topicId);
      if (!t) { out.innerHTML = '<div class="maf-card">That heading was not found.</div>'; return; }
      out.innerHTML = await topicCard(M, t, corpus, { show: 60 });
      return;
    }
    if (!q) { out.innerHTML = ''; return; }
    const a = await analyze(q);
    const cards = [];
    if (a.source) cards.push(await sourceCard(M, a.source, corpus));
    if (a.parsha) cards.push(parshaCard(a.parsha));
    const top = a.topics.slice(0, 1);
    for (const x of top) cards.push(await topicCard(M, x.t, corpus, { show: 20 }));
    // a question touching two or more topics: passages the Mafteach lists under both
    const distinct = [];
    for (const x of a.topics) if (distinct.length < 3 && x.words.size && !distinct.some(d => [...x.words].every(w => d.words.has(w)))) distinct.push(x);
    if (distinct.length >= 2) { const both = await bothCard(M, distinct, corpus); if (both) cards.splice(a.source || a.parsha ? 1 : 0, 0, both); }
    const others = a.topics.slice(1, 16).map(x => x.t).concat(a.weak).filter((t, i, arr) => arr.findIndex(u => u.id === t.id) === i).slice(0, 18);
    if (others.length) cards.push(`<div class="maf-card"><h2>${top.length ? 'Other headings that match' : 'Headings that match'}</h2><div class="maf-chips">${others.map(t => `<a href="${mafHash({ topic: t.id, corpus })}"><span class="maf-he" lang="he">${E(t.he)}</span> · ${E(t.en)} <span style="color:var(--muted)">${t.n}</span></a>`).join('')}</div></div>`);
    if (a.hebrew || tokens(q).filter(x => x.keep).length) {
      const topE = top.length ? corpusFilter(await topicEntries(top[0].t.id), corpus).length : 0;
      const auto = !cards.length || (top.length && topE < 10);
      cards.push(`<div class="maf-card" data-fulltext><h2>Inside the entries</h2><p class="maf-meta">Every Mafteach entry whose Hebrew or English includes ${a.hebrew ? `“<span class="maf-he" lang="he">${E(q)}</span>”` : `the words “${E(tokens(q).filter(x => x.keep).map(x => x.w).join(' '))}”${top.length ? ` or “<span class="maf-he" lang="he">${E(top[0].t.he)}</span>”` : ''}`}.</p>${auto ? '<div class="loading">Searching…</div>' : '<button class="maf-btn ghost" data-run-fulltext>Search inside all entries</button>'}</div>`);
    }
    if (!cards.length) cards.push(`<div class="maf-card"><h2>Nothing in the Mafteach matched</h2><p class="maf-meta">Try one key word, the Hebrew term, another spelling (Shabbos / Shabbat), or a pasuk or daf with its number (Bereishis 2:7, Shabbos 88b).</p></div>`);
    out.innerHTML = cards.join('');
    const ft = out.querySelector('[data-fulltext]');
    const runFull = async () => {
      ft.querySelector('[data-run-fulltext]')?.remove();
      if (!ft.querySelector('.loading')) ft.insertAdjacentHTML('beforeend', '<div class="loading">Searching…</div>');
      const { total, hits } = await searchEntries(M, q, corpus, 200, { alt: !a.hebrew && top.length ? [top[0].t.he] : [] });
      ft.querySelector('.loading')?.remove();
      ft.insertAdjacentHTML('beforeend', total ? `<p class="maf-meta">${total} entr${total === 1 ? 'y' : 'ies'}${total > hits.length ? `; showing the first ${hits.length}` : ''}.</p>${entryListHTML(M, hits, { topic: true, show: 25 })}` : '<p class="maf-meta">No entry contains these words.</p>');
    };
    if (ft) { if (ft.querySelector('.loading')) runFull(); else ft.querySelector('[data-run-fulltext]').addEventListener('click', runFull); }
  }
  // "ראה: חברון" — a heading that only points to others ("see Hebron"); the targets as headings.
  function seeAlso(M, entries) {
    const out = [];
    for (const e of entries) {
      const m = String(e.t).match(/^\s*ראה\s*(?:מפתח\s+\S+\s*)?[:\-]?\s*(.+)$/);
      if (!m) continue;
      for (const part of m[1].split(/[,;]/)) {
        const name = part.replace(/[.\-–]+\s*$/, '').trim();
        if (heKey(name).length < 2) continue;
        let hit = findTerms(M, name, ['topic']).find(x => x.s >= 100 && x.t.n > 0);
        if (!hit && heKey(name).length >= 4) {             // OCR slips in the printed index: חברוו for חברון
          const k = heKey(name).replace(/ו$/, 'נ');
          const bare = t => heKey(String(t.he).replace(/\([^)]*\)/g, ''));          // "חברון (העיר)" is חברון
          hit = findTerms(M, k, ['topic']).find(x => x.s >= 100 && x.t.n > 0);
          const t = hit ? null : M.raw.terms.filter(t => t.kind === 'topic' && t.n > 0 && bare(t) === k)[0]
            || M.raw.terms.filter(t => t.kind === 'topic' && t.n > 0 && dist(bare(t), k, 1) <= 1).sort((a, b) => b.n - a.n)[0];
          if (t) hit = { t };
        }
        if (hit && !out.some(t => t.id === hit.t.id)) out.push(hit.t);
      }
    }
    return out;
  }
  async function topicCard(M, t, corpus, { show }) {
    const entries = corpusFilter(await topicEntries(t.id), corpus);
    const see = seeAlso(M, entries);
    const linked = entries.filter(e => e.r.some(r => refInfo(r).ref)).length;
    let follow = '';
    if (see.length && linked < 5) {                     // the heading only points elsewhere: show where it points
      const T = see[0], te = corpusFilter(await topicEntries(T.id), corpus);
      follow = `<h3>See: <a href="${mafHash({ topic: T.id, corpus })}"><span class="maf-he" lang="he">${E(T.he)}</span> · ${E(T.en)}</a> (${te.length})</h3>${entryListHTML(M, te, { show: 15, grouped: true })}`;
    }
    const seeChips = see.length ? `<div class="maf-chips" style="margin:6px 0 10px"><span class="maf-meta" style="margin:0 4px 0 0;align-self:center">See also:</span>${see.map(T => `<a href="${mafHash({ topic: T.id, corpus })}"><span class="maf-he" lang="he">${E(T.he)}</span> · ${E(T.en)} <span style="color:var(--muted)">${T.n}</span></a>`).join('')}</div>` : '';
    const also = [...new Set([...(t.ashk || []), ...(t.sef || []), ...(t.en_alt || [])])].slice(0, 6);
    return `<div class="maf-card"><h2><span class="maf-he" lang="he">${E(t.he)}</span><span>${E(t.en)}</span></h2>
      <p class="maf-meta">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in HaMafteach HaShalem${also.length ? ` · also: ${E(also.join(', '))}` : ''}. In an entry, “-” stands for the heading word.</p>
      <div class="maf-actions" style="margin:0 0 10px"><a class="maf-btn" href="${shiurHash({ topic: t.id, corpus })}">Build a shiur on this topic</a>${t.n > entries.length || show < 60 ? `<a class="maf-btn ghost" href="${mafHash({ topic: t.id, corpus })}">Open this heading</a>` : ''}</div>
      ${seeChips}${entries.length ? entryListHTML(M, entries, { show, grouped: true }) : '<p class="maf-meta">No entries in these sefarim; choose “All Rav Tzadok”.</p>'}${follow}</div>`;
  }
  async function sourceCard(M, ps, corpus) {
    const label = ps.kind === 'named' ? ps.title : `${ps.title}${ps.addr ? ' ' + ps.addr : ''}`;
    if (ps.kind !== 'named' && !ps.addr) {
      const info = M.raw.source_titles[ps.title];
      return `<div class="maf-card"><h2>${E(ps.title)}</h2><p class="maf-meta">${info ? `${info.n} entries. Add a chapter or daf, e.g. ` + info.chapters.slice(0, 8).map(c => `<a href="${mafHash({ q: ps.title + ' ' + c, corpus })}">${E(ps.title)} ${c}</a>`).join(', ') : 'The Mafteach has no entries for it.'}</p></div>`;
    }
    const entries = corpusFilter(await sourceEntries(ps) || [], corpus);
    const url = ps.kind !== 'named' && appUrl(label);
    return `<div class="maf-card"><h2><span>${E(label)}</span>${url ? `<a href="${url}" style="font:500 .8rem var(--ui,system-ui)">Read it ›</a>` : ''}</h2>
      <p class="maf-meta">${entries.length ? `Where Rav Tzadok draws on it: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}. Each shows the words he quotes, then the passages.` : 'HaMafteach HaShalem lists no entries for it.'}</p>
      ${entries.length ? entryListHTML(M, entries, { show: 25 }) : ''}</div>`;
  }
  function parshaCard(p) {
    return `<div class="maf-card"><h2><span class="maf-he" lang="he">פרשת ${E(p.he)}</span><span>Parshas ${E(p.ashk)}</span></h2>
      <p class="maf-meta">${E(p.book)} ${p.from.join(':')}–${p.to.join(':')}. A source sheet with the Pri Tzaddik on the parsha, its pesukim as Rav Tzadok uses them, and its recurring themes.</p>
      <div class="maf-actions"><a class="maf-btn" href="${shiurHash({ parsha: p.key })}">Build a shiur on Parshas ${E(p.ashk)}</a></div></div>`;
  }
  async function bothCard(M, topics, corpus) {
    const lists = await Promise.all(topics.map(x => topicEntries(x.t.id).then(l => corpusFilter(l, corpus))));
    const refSets = lists.map(l => { const m = new Map(); for (const e of l) for (const r of e.r) { const i = refInfo(r); if (i.ref) { if (!m.has(i.ref)) m.set(i.ref, []); m.get(i.ref).push(e); } } return m; });
    const counts = new Map();
    refSets.forEach((m, k) => { for (const ref of m.keys()) { const c = counts.get(ref) || new Set(); c.add(k); counts.set(ref, c); } });
    const shared = [...counts].filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size).slice(0, 30);
    if (!shared.length) return null;
    const names = topics.map(x => `${E(x.t.en)} · <span class="maf-he" lang="he">${E(x.t.he)}</span>`).join(' + ');
    return `<div class="maf-card"><h2>Passages on ${names.replace(/ \+ /g, ' and ')}</h2><p class="maf-meta">${shared.length} passage${shared.length === 1 ? '' : 's'} the Mafteach lists under more than one of these headings — the likeliest places Rav Tzadok connects them.</p>
      <ul class="maf-list">${shared.map(([ref, s]) => `<li><a href="${readLink(ref)}" style="font-weight:600">${E(ref)}</a>${[...s].map(k => { const e = refSets[k].get(ref)[0]; return `<div><span class="maf-tag" style="text-transform:none;letter-spacing:0">${E(topics[k].t.en)}</span> ${capHTML(e.t, topics[k].t.he)}${e.e ? `<div class="maf-en">${E(e.e)}</div>` : ''}</div>`; }).join('')}</li>`).join('')}</ul></div>`;
  }

  // ------------------------------------------------------------ shiur page
  function excerpt(d, ref, words = 90) {
    if (!d) return null;
    const flat = x => Array.isArray(x) ? x.flatMap(flat) : x == null ? [] : [String(x)];
    let he = flat(d.he), en = flat(d.en);
    const para = String(ref).match(/[: ](\d+)$/) && d.sectionRef && ref !== d.sectionRef && ref.startsWith(d.sectionRef) ? +ref.slice(d.sectionRef.length + 1) : null;
    if (para && he.length >= para) { he = [he[para - 1]]; en = en.length >= para ? [en[para - 1]] : []; }
    const clean = s => s.replace(/<sup[^>]*>.*?<\/sup>|<i class="footnote">.*?<\/i>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const cut = (s, n) => { const w = clean(s).split(' '); return w.length > n ? w.slice(0, n).join(' ') + ' …' : w.join(' '); };
    const H = he.map(clean).filter(Boolean).join(' '), N = en.map(clean).filter(Boolean).join(' ');
    if (!H && !N) return null;
    return { he: H ? cut(H, words) : '', en: N ? cut(N, Math.round(words * 1.4)) : '', more: H.split(' ').length > words };
  }
  async function fillTexts(el) {
    if (!API.fetchText) return;
    const slots = [...el.querySelectorAll('[data-text-ref]')];
    let i = 0;
    const worker = async () => {
      while (i < slots.length) {
        const s = slots[i++];
        try {
          const d = await API.fetchText(s.dataset.textRef);
          const x = excerpt(d, s.dataset.textRef, +(s.dataset.words || 90));
          s.innerHTML = x ? `${x.he ? `<div class="maf-he" lang="he">${E(x.he)}</div>` : ''}${x.en ? `<div class="en">${E(x.en)}</div>` : ''}` : '';
          if (!x) s.remove();
        } catch { s.remove(); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }
  async function renderShiur(app, params) {
    const corpus = params.get('corpus') || 'all';
    app.innerHTML = '<div class="page maf-page maf-shiur"><div class="loading">Building the shiur from the Mafteach…</div></div>';
    const page = app.firstElementChild;
    let M;
    try { M = await index(); } catch { page.innerHTML = '<div class="maf-card">The Mafteach could not be loaded. Check your connection and try again.</div>'; return; }
    let plan;
    if (params.get('parsha')) {
      const p = PARSHIYOS.find(x => x.key === params.get('parsha')) || findParsha(params.get('parsha'));
      if (!p) { page.innerHTML = '<div class="maf-card">That parsha was not recognized.</div>'; return; }
      const [pt, src] = await Promise.all([ptSectionPassages(p), parshaSources(p)]);
      plan = planParshaShiur(p, pt, src);
    } else {
      const t = M.byId.get(+params.get('topic'));
      if (!t) { page.innerHTML = '<div class="maf-card">That topic was not found.</div>'; return; }
      let entries = corpusFilter(await topicEntries(t.id), corpus);
      if (entries.filter(e => e.r.some(r => refInfo(r).ref)).length < 5)      // "see Hebron": build from the headings it points to
        for (const T of seeAlso(M, entries).slice(0, 3)) entries = entries.concat(corpusFilter(await topicEntries(T.id), corpus));
      plan = planTopicShiur(M, t, entries);
    }
    document.title = `Shiur: ${plan.title.en} · Rav Tzadok Library`;
    page.innerHTML = shiurHTML(plan, corpus);
    page.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'print') window.print();
      if (b.dataset.act === 'copy') { try { await navigator.clipboard.writeText(shiurText(plan) + '\n\n' + location.href); b.textContent = 'Copied ✓'; } catch { b.textContent = 'Copy failed'; } }
      if (b.dataset.act === 'share') {
        const data = { title: `Shiur: ${plan.title.en}`, url: location.href };
        if (navigator.share) navigator.share(data).catch(() => {}); else { try { await navigator.clipboard.writeText(location.href); b.textContent = 'Link copied ✓'; } catch {} }
      }
    });
    page.addEventListener('click', ev => { const b = ev.target.closest('[data-show-more]'); if (b) { b.parentElement.querySelectorAll('[data-more]').forEach(x => { x.hidden = false; }); b.remove(); } });
    fillTexts(page);
  }
  function shiurHTML(plan, corpus) {
    const actions = `<div class="maf-actions maf-noprint"><button class="maf-btn" data-act="print">Print / save as PDF</button><button class="maf-btn ghost" data-act="copy">Copy as text</button><button class="maf-btn ghost" data-act="share">Share link</button><a class="maf-btn ghost" href="${plan.kind === 'topic' ? mafHash({ q: plan.title.en, corpus }) : mafHash({ q: 'Parshas ' + plan.parsha.ashk })}">Back to search</a></div>`;
    if (plan.kind === 'topic') {
      if (!plan.sections.length) return `<h1>${E(plan.title.en)}</h1><div class="maf-card">The Mafteach's entries on this heading are not linked to passages in the library, so a source sheet can't be built. <a href="${mafHash({ q: plan.title.he })}">See the entries</a>.</div>`;
      let n = 0;
      return `<h1>${E(plan.title.en)} · <span class="maf-he" lang="he">${E(plan.title.he)}</span></h1>
        <p class="maf-sub">A shiur in Rav Tzadok HaKohen's words, arranged from HaMafteach HaShalem: ${plan.entries} entries in ${plan.books} sefarim on this topic; these ${plan.sections.reduce((a, s) => a + s.items.length, 0)} sources are the ones the Mafteach marks as treated at length or that best represent each aspect.</p>${actions}
        ${plan.sections.map((s, si) => `<h2 class="sec">${si + 1}. ${s.heading.general ? `${E(plan.title.en)} — in general` : `<span class="maf-he" lang="he">${E(s.heading.he)}</span>${s.heading.en ? ` · ${E(s.heading.en)}` : ''}`}</h2>
          ${s.items.map(it => `<div class="maf-src"><div class="cap"><span class="src-ref">${++n}. <a href="${readLink(it.ref)}">${E(it.ref)}</a></span>${it.long ? '<span class="maf-tag">treated at length</span>' : ''} — ${capHTML(it.caption, plan.title.he)}${it.en ? `<div class="maf-en">${E(it.en)}</div>` : ''}</div>
            <div class="txt" data-text-ref="${E(it.ref)}"><span class="maf-noprint" style="color:var(--muted);font-size:.85rem">Loading the text…</span></div>
            ${it.also.length ? `<div class="maf-refs" style="margin-top:6px"><span>See also:</span>${it.also.slice(0, 4).map(r => `<a href="${readLink(r)}">${E(r)}</a>`).join('')}</div>` : ''}</div>`).join('')}
          ${s.total > s.items.length ? `<p class="maf-meta maf-noprint">${s.total - s.items.length} more in the Mafteach under this heading.</p>` : ''}`).join('')}
        <p class="maf-note">Captions are the Mafteach's own summary lines (OCR'd from the printed index); texts are excerpts from the library — open each passage to read it whole. <a href="${mafHash({ q: plan.title.he, corpus })}" class="maf-noprint">All entries on this topic</a></p>`;
    }
    const p = plan.parsha;
    return `<h1>Parshas ${E(p.ashk)} · <span class="maf-he" lang="he">${E(plan.title.he)}</span></h1>
      <p class="maf-sub">Rav Tzadok HaKohen on the parsha (${E(plan.range)}), arranged from HaMafteach HaShalem and the Pri Tzaddik: ${plan.maamarim.length} maamarim in Pri Tzaddik and ${plan.pesukim.length} pesukim of the parsha that his sefarim draw on.</p>${actions}
      ${plan.themes.length ? `<h2 class="sec">Themes of the parsha in Pri Tzaddik</h2><div class="maf-chips">${plan.themes.map(t => `<a href="${mafHash({ q: t.he })}"><span class="maf-he" lang="he">${E(t.he)}</span>${t.en ? ` · ${E(t.en)}` : ''} <span style="color:var(--muted)">${t.n}</span></a>`).join('')}</div>` : ''}
      ${plan.maamarim.length ? `<h2 class="sec">Pri Tzaddik on Parshas ${E(p.ashk)}</h2>
        ${plan.maamarim.map((m, i) => `<div class="maf-src"><div class="cap"><span class="src-ref"><a href="${readLink(m.ref)}">${E(m.ref.replace(/^Peri Tzadik, /, 'Pri Tzaddik, '))}</a></span>${m.topics.length ? ` — ${m.topics.map(t => `${t[1] ? E(t[1]) + ' ' : ''}<span class="maf-he" lang="he">${E(t[0])}</span>`).join(' · ')}` : ''}</div>
          ${i < 12 ? `<div class="txt" data-text-ref="${E(m.ref)}" data-words="70"><span class="maf-noprint" style="color:var(--muted);font-size:.85rem">Loading the text…</span></div>` : ''}
          ${m.sources.length ? `<div class="maf-refs" style="margin-top:6px"><span>Draws on:</span>${m.sources.map(s => `<a href="${appUrl(s) || '#'}">${E(s)}</a>`).join('')}</div>` : ''}</div>`).join('')}` : ''}
      ${plan.pesukim.length ? `<h2 class="sec">The pesukim of the parsha in Rav Tzadok's sefarim</h2><p class="maf-meta">In order, each pasuk with the passages where Rav Tzadok draws on it (Mafteach part 3 and part 7).</p>
        <ul class="maf-list">${plan.pesukim.map((v, i) => `<li${i >= 30 ? ' hidden data-more' : ''}><a class="src-ref" href="${appUrl(v.key)}">${E(v.key)}</a> <span class="maf-he" lang="he">${E(v.quote)}</span>
          ${v.items.map(it => `<div class="maf-refs">${it.refs.map(r => r.ref ? `<a href="${readLink(r.ref)}">${E(r.ref)}</a>` : `<span>${E(r.text)}</span>`).join('')}</div>`).join('')}${v.total > v.items.length ? `<div class="maf-meta" style="margin:2px 0 0">+${v.total - v.items.length} more</div>` : ''}</li>`).join('')}</ul>
        ${plan.pesukim.length > 30 ? '<button class="maf-more" data-show-more>Show all ' + plan.pesukim.length + ' pesukim</button>' : ''}` : ''}
      ${!plan.maamarim.length && !plan.pesukim.length ? '<div class="maf-card">The Mafteach has no entries for this parsha yet.</div>' : ''}
      <p class="maf-note">Built from HaMafteach HaShalem (OCR'd from the printed index) and the library's Pri Tzaddik. Open each passage to read it whole.</p>`;
  }

  // ------------------------------------------------------------ header search suggestions and home card
  function suggestRows(M, q) {
    const s = String(q || '').trim();
    if (s.length < 2) return [];
    const rows = [];
    const ps = findSourceIn(M, s);
    if (ps && (ps.addr || ps.kind === 'named')) rows.push({ href: mafHash({ q: s }), label: `${ps.kind === 'named' ? ps.title : ps.title + ' ' + ps.addr} — where Rav Tzadok uses it`, kind: 'Mafteach' });
    const p = findParsha(s);
    if (p) rows.push({ href: shiurHash({ parsha: p.key }), label: `Build a shiur on Parshas ${p.ashk}`, kind: 'Shiur' });
    const topics = questionTopics(M, s).slice(0, 3);
    for (const x of topics) rows.push({ href: mafHash({ topic: x.t.id }), label: `${x.t.he} — ${x.t.en} (${x.t.n})`, kind: 'Mafteach' });
    rows.push({ href: mafHash({ q: s }), label: `Ask the Mafteach: “${s}”`, kind: 'Mafteach' });
    return rows;
  }
  function attach(api = {}) {
    API = { ...API, ...api };
    injectCss();
    if (typeof document === 'undefined') return;
    const q = document.getElementById('q'), sug = document.getElementById('suggest'), form = document.getElementById('searchForm');
    if (q && sug && !sug.dataset.mafAttached) {
      sug.dataset.mafAttached = '1';
      let loading = false;
      const add = () => {
        if (sug.hidden || sug.querySelector('[data-maf-row]') || !q.value.trim()) return;
        if (!M) { if (!loading) { loading = true; index().then(() => { loading = false; add(); }).catch(() => { loading = false; }); } return; }
        const rows = suggestRows(M, q.value);
        if (!rows.length) return;
        sug.insertAdjacentHTML('beforeend', `<div class="maf-suggest-head" data-maf-row>HaMafteach HaShalem</div>` + rows.map(r => `<a href="${E(r.href)}" data-maf-row><span>${E(r.label)}</span><span class="kind">${E(r.kind)}</span></a>`).join(''));
      };
      new MutationObserver(add).observe(sug, { childList: true, attributes: true, attributeFilter: ['hidden'] });
      q.addEventListener('focus', () => { index().catch(() => {}); }, { once: true });
      if (form) form.addEventListener('submit', ev => {          // no text matched: send the query to the Mafteach
        if (sug.querySelector('.note') && q.value.trim()) { ev.preventDefault(); ev.stopImmediatePropagation(); location.hash = mafHash({ q: q.value.trim() }); q.value = ''; q.blur(); sug.hidden = true; }
      }, true);
    }
    const app = document.getElementById('app');
    if (app && !app.dataset.mafHome) {
      app.dataset.mafHome = '1';
      const home = () => {
        if (location.hash.replace(/^#\/?/, '') || app.querySelector('.maf-home')) return;
        const pg = app.querySelector('.page.home-grid') || app.querySelector('.page');
        if (!pg || pg.querySelector('.loading')) return;
        pg.insertAdjacentHTML('afterbegin', `<div class="maf-home" style="grid-column:1/-1"><div><b>Search HaMafteach HaShalem</b><p>A question, a topic, a pasuk or daf — or build a shiur on a topic or parsha.</p></div><form data-maf-form><input name="q" type="search" placeholder="e.g. emunah, Bereishis 2:7, Parshas Vayeishev" aria-label="Ask the Mafteach"><button class="maf-btn" type="submit">Search</button></form></div>`);
        wire(pg.querySelector('.maf-home'));
      };
      new MutationObserver(home).observe(app, { childList: true });
      home();
    }
  }
  function render(app, kind, params, api = {}) {
    API = { ...API, ...api };
    injectCss();
    const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '');
    if (kind === 'shiur') return renderShiur(app, p);
    return renderSearch(app, p);
  }

  return { VERSION, configure, index, buildIndex, findTerms, parseSource, findParsha, findSourceIn, questionTopics, analyze, refInfo, topicEntries, sourceEntries,
    searchEntries, seeAlso, planTopicShiur, planParshaShiur, ptSectionPassages, parshaSources, shiurText, suggestRows, excerpt, render, attach, PARSHIYOS, translitKey, heKey, norm };
});
// Attach to the reader's header search and home page as soon as the page is ready.
if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.AkivaMafteachSearch) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.AkivaMafteachSearch.attach());
  else window.AkivaMafteachSearch.attach();
}

// Finds source citations in English translation text ("Berachos 6b",
// "Bereishis Rabbah 63:2", "Hilchos Teshuvah 2:4", "Tzidkas HaTzadik §100")
// and maps them to Sefaria-style references, so the library can link them
// and build its own connections for texts Sefaria does not have.

const TANAKH = {
  Genesis: ['Genesis', 'Bereishis', 'Bereishit', 'Bereshit', 'Bereisheet'],
  Exodus: ['Exodus', 'Shemos', 'Shemot'],
  Leviticus: ['Leviticus', 'Vayikra'],
  Numbers: ['Numbers', 'Bamidbar', 'Bemidbar'],
  Deuteronomy: ['Deuteronomy', 'Devarim'],
  Joshua: ['Joshua', 'Yehoshua'],
  Judges: ['Judges', 'Shoftim', 'Shofetim'],
  'I Samuel': ['I Samuel', '1 Samuel', 'I Shmuel', '1 Shmuel', 'Shmuel I'],
  'II Samuel': ['II Samuel', '2 Samuel', 'II Shmuel', '2 Shmuel', 'Shmuel II'],
  'I Kings': ['I Kings', '1 Kings', 'I Melachim', '1 Melachim', 'Melachim I'],
  'II Kings': ['II Kings', '2 Kings', 'II Melachim', '2 Melachim', 'Melachim II'],
  Isaiah: ['Isaiah', 'Yeshayah', 'Yeshayahu', 'Yeshaya', 'Yeshaiah'],
  Jeremiah: ['Jeremiah', 'Yirmeyah', 'Yirmiyah', 'Yirmiyahu', 'Yirmeyahu'],
  Ezekiel: ['Ezekiel', 'Yechezkel', 'Yechezkiel'],
  Hosea: ['Hosea', 'Hoshea'],
  Joel: ['Joel', 'Yoel'],
  Amos: ['Amos'],
  Obadiah: ['Obadiah', 'Ovadiah', 'Ovadyah'],
  Jonah: ['Jonah', 'Yonah'],
  Micah: ['Micah', 'Michah'],
  Nahum: ['Nahum', 'Nachum'],
  Habakkuk: ['Habakkuk', 'Chavakuk'],
  Zephaniah: ['Zephaniah', 'Tzefaniah', 'Tzephaniah'],
  Haggai: ['Haggai', 'Chaggai'],
  Zechariah: ['Zechariah', 'Zecharyah', 'Zecharia'],
  Malachi: ['Malachi'],
  Psalms: ['Psalms', 'Psalm', 'Tehillim'],
  Proverbs: ['Proverbs', 'Mishlei'],
  Job: ['Job', 'Iyov'],
  'Song of Songs': ['Song of Songs', 'Shir HaShirim'],
  Ruth: ['Ruth', 'Rus', 'Rut'],
  Lamentations: ['Lamentations', 'Eichah', 'Eicha'],
  Ecclesiastes: ['Ecclesiastes', 'Koheles', 'Kohelet', 'Qohelet'],
  Esther: ['Esther'],
  Daniel: ['Daniel'],
  Ezra: ['Ezra'],
  Nehemiah: ['Nehemiah', 'Nechemyah', 'Nechemiah'],
  'I Chronicles': ['I Chronicles', '1 Chronicles', 'I Divrei HaYamim', 'Divrei HaYamim I'],
  'II Chronicles': ['II Chronicles', '2 Chronicles', 'II Divrei HaYamim', 'Divrei HaYamim II'],
};
const TRACTATES = {
  Berakhot: ['Berakhot', 'Berachos', 'Berachot', 'Brachos'],
  Shabbat: ['Shabbat', 'Shabbos'],
  Eruvin: ['Eruvin'],
  Pesachim: ['Pesachim'],
  Shekalim: ['Shekalim'],
  Yoma: ['Yoma'],
  Sukkah: ['Sukkah', 'Succah'],
  Beitzah: ['Beitzah', 'Beitza', 'Betzah'],
  'Rosh Hashanah': ['Rosh Hashanah', 'Rosh HaShanah'],
  Taanit: ['Taanit', "Ta'anit", 'Taanis', "Ta'anis"],
  Megillah: ['Megillah'],
  'Moed Katan': ['Moed Katan', "Mo'ed Katan"],
  Chagigah: ['Chagigah'],
  Yevamot: ['Yevamot', 'Yevamos'],
  Ketubot: ['Ketubot', 'Kesubos', 'Ketubos', 'Kesuvos'],
  Nedarim: ['Nedarim'],
  Nazir: ['Nazir'],
  Sotah: ['Sotah'],
  Gittin: ['Gittin'],
  Kiddushin: ['Kiddushin'],
  'Bava Kamma': ['Bava Kamma', 'Bava Kama'],
  'Bava Metzia': ['Bava Metzia'],
  'Bava Batra': ['Bava Batra', 'Bava Basra'],
  Sanhedrin: ['Sanhedrin'],
  Makkot: ['Makkot', 'Makkos', 'Makos'],
  Shevuot: ['Shevuot', 'Shevuos'],
  'Avodah Zarah': ['Avodah Zarah'],
  Horayot: ['Horayot', 'Horayos'],
  Zevachim: ['Zevachim'],
  Menachot: ['Menachot', 'Menachos'],
  Chullin: ['Chullin'],
  Bekhorot: ['Bekhorot', 'Bechoros', 'Bechorot'],
  Arakhin: ['Arakhin', 'Arachin'],
  Temurah: ['Temurah'],
  Keritot: ['Keritot', 'Kerisos', 'Kereisos'],
  Meilah: ['Meilah', "Me'ilah"],
  Tamid: ['Tamid'],
  Niddah: ['Niddah'],
};
// Midrash, codes and other works cited by chapter (and verse/paragraph).
const WORKS = {
  'Sifrei Devarim': ['Sifrei Devarim', 'Sifrei, Devarim', 'Sifre Devarim', 'Sifrei Deuteronomy'],
  'Sifrei Bamidbar': ['Sifrei Bamidbar', 'Sifrei, Bamidbar', 'Sifre Bamidbar', 'Sifrei Numbers'],
  'Bereshit Rabbah': ['Bereishis Rabbah', 'Bereishit Rabbah', 'Bereshit Rabbah', 'Genesis Rabbah'],
  'Shemot Rabbah': ['Shemos Rabbah', 'Shemot Rabbah', 'Exodus Rabbah'],
  'Vayikra Rabbah': ['Vayikra Rabbah', 'Leviticus Rabbah'],
  'Bamidbar Rabbah': ['Bamidbar Rabbah', 'Bemidbar Rabbah', 'Numbers Rabbah'],
  'Avot DeRabbi Natan': ['Avot DeRabbi Natan', "Avot d'Rabbi Natan", 'Avot D’Rabbi Natan'],
  'Tanna DeBei Eliyahu Rabbah': ['Tanna DeBei Eliyahu Rabbah'],
  'Devarim Rabbah': ['Devarim Rabbah', 'Deuteronomy Rabbah'],
  'Shir HaShirim Rabbah': ['Shir HaShirim Rabbah', 'Song of Songs Rabbah'],
  'Ruth Rabbah': ['Rus Rabbah', 'Ruth Rabbah'],
  'Eichah Rabbah': ['Eichah Rabbah', 'Eicha Rabbah', 'Lamentations Rabbah'],
  'Kohelet Rabbah': ['Koheles Rabbah', 'Kohelet Rabbah', 'Ecclesiastes Rabbah'],
  'Esther Rabbah': ['Esther Rabbah'],
  'Pirkei Avot': ['Pirkei Avos', 'Pirkei Avot', 'Avos', 'Avot'],
  'Pirkei DeRabbi Eliezer': ['Pirkei DeRabbi Eliezer', "Pirkei d'Rabbi Eliezer", 'Pirkei D’Rabbi Eliezer'],
  'Midrash Tehillim': ['Shocher Tov', 'Midrash Tehillim'],
  'Sefer Yetzirah': ['Sefer Yetzirah'],
  'Mishneh Torah, Repentance': ['Hilchos Teshuvah', 'Hilchot Teshuvah', 'Laws of Repentance'],
  'Mishneh Torah, Foundations of the Torah': ['Hilchos Yesodei HaTorah', 'Hilchot Yesodei HaTorah'],
  'Mishneh Torah, Human Dispositions': ['Hilchos De’os', "Hilchos De'os", 'Hilchot Deot'],
  'Mishneh Torah, Forbidden Intercourse': ['Hilchos Issurei Biah', 'Hilchot Issurei Biah'],
  'Mishneh Torah, Torah Study': ['Hilchos Talmud Torah', 'Hilchot Talmud Torah'],
  'Mishneh Torah, Prayer and the Priestly Blessing': ['Hilchos Tefillah', 'Hilchot Tefillah'],
  'Mishneh Torah, Kings and Wars': ['Hilchos Melachim', 'Hilchot Melachim'],
  'Shulchan Arukh, Orach Chayim': ['Orach Chaim', 'Orach Chayim', 'Orach Chayyim'],
  'Shulchan Arukh, Yoreh De\'ah': ["Yoreh De'ah", 'Yoreh De’ah', 'Yoreh Deah'],
  'Shulchan Arukh, Even HaEzer': ['Even HaEzer', 'Even Ha’ezer', "Even Ha'ezer"],
  'Shulchan Arukh, Choshen Mishpat': ['Choshen Mishpat'],
};
// Rav Tzadok's own works, cited by siman / chapter (linked inside the library).
const LIBRARY = {
  'Tzidkat HaTzadik': ['Tzidkas HaTzadik', 'Tzidkat HaTzadik', 'Tzidkas Hatzadik'],
  'Resisei Layla': ['Resisei Layla', 'Resisei Laylah', 'Resisei Lailah'],
  'Takanat HaShavin': ['Takanas HaShavin', 'Takanat HaShavin'],
  'Machshavot Charutz': ['Machshavos Charutz', 'Machshavot Charutz'],
  'Yisrael Kedoshim': ['Yisrael Kedoshim'],
  'Divrei Soferim': ['Divrei Soferim', 'Divrei Sofrim'],
  'Divrei Chalomot': ['Divrei Chalomot', 'Divrei Chalomos'],
  'Likkutei Maamarim': ['Likkutei Maamarim', 'Likutei Maamarim'],
  'Sichat Malakhei HaSharet': ['Sichas Malachei HaShareis', 'Sichat Malachei HaSharet'],
  'Peri Tzadik': ['Pri Tzaddik', 'Peri Tzadik', 'Pri Tzadik'],
};
import { referenceMatches } from './reference-finders.mjs';
import { hebrewMatchesVocalized } from './hebrew-citations.mjs';
import { TANAKH as TANAKH_CHAPTERS, SHAS } from './packs.mjs';
// Bounds, so a citation to a chapter or daf that does not exist is not linked.
const MAX_CHAPTER = Object.fromEntries(TANAKH_CHAPTERS.flatMap(([, books]) => books));
const amud = s => { const m = /^(\d+)([ab])$/.exec(s); return m ? +m[1] * 2 + (m[2] === 'b' ? 1 : 0) : null; };
const DAF_RANGE = Object.fromEntries(SHAS.flatMap(([, ts]) => ts.map(([t, , a, z]) => [t, [amud(a), amud(z)]])));
const inBounds = ref => {
  let m = /^(.*) (\d+):\d+/.exec(ref);
  if (m && MAX_CHAPTER[m[1]] && +m[2] > MAX_CHAPTER[m[1]]) return false;
  m = /^(.*) (\d+[ab])$/.exec(ref);
  if (m && DAF_RANGE[m[1]]) { const x = amud(m[2]); if (x < DAF_RANGE[m[1]][0] || x > DAF_RANGE[m[1]][1]) return false; }
  return true;
};
export const CATEGORY = {};
const ALIASES = [];
const add = (table, kind, cat) => {
  for (const [title, names] of Object.entries(table)) {
    CATEGORY[title] = typeof cat === 'function' ? cat(title) : cat;
    for (const n of names) ALIASES.push({ name: n, title, kind });
  }
};
add(TANAKH, 'tanakh', 'Tanakh');
add(TRACTATES, 'talmud', 'Talmud');
add(WORKS, 'work', t => /Rabbah|Tehillim|Eliezer|Sifrei/.test(t) ? 'Midrash' : /Avot/.test(t) && !/Natan/.test(t) ? 'Mishnah'
  : /Mishneh Torah|Shulchan/.test(t) ? 'Halakhah' : /Yetzirah/.test(t) ? 'Kabbalah' : 'Midrash');
add(LIBRARY, 'library', 'Rav Tzadok');
ALIASES.sort((a, b) => b.name.length - a.name.length); // longest first: "Shemos Rabbah" before "Shemos"

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAMES = ALIASES.map(a => esc(a.name).replace(/['’]/g, "['’]")).join('|');
// Name, optional "Yerushalmi"/"Mishnah", then a location: 6b, 86a–b, 14:5, 63:2, §100, 54, 2:4
const RE = new RegExp(
  `\\b(Yerushalmi |Jerusalem Talmud |Mishnah )?(${NAMES})(?:,?\\s+|\\s*[(\\[]\\s*|,\\s*)(?:(?:(?:[Ss]tart|[Bb]eginning|[Ee]nd) of )?(?:[Cc]hapter|[Cc]h\\.|[Pp]erek|[Ss]iman|[Ss]ection|daf)\\s*)?(§\\s*)?(\\d{1,3})([ab]|:\\d{1,3})?`,
  'g');

const lookup = name => ALIASES.find(a => a.name.replace(/’/g, "'") === name.replace(/’/g, "'"));

// Returns [{index, length, ref, category}] for citations found in plain text.
export function findCitations(text) {
  const out = [];
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(text))) {
    const [whole, prefix = '', name, , num, tail = ''] = m;
    const alias = lookup(name);
    if (!alias) continue;
    let ref = null, category = CATEGORY[alias.title];
    if (alias.kind === 'talmud') {
      if (/^[ab]$/.test(tail) && !prefix) ref = `${alias.title} ${num}${tail}`;
      else if (tail.startsWith(':')) {
        if (/Yerushalmi|Jerusalem/.test(prefix)) { ref = `Jerusalem Talmud ${alias.title} ${num}${tail}`; }
        else { ref = `Mishnah ${alias.title} ${num}${tail}`; category = 'Mishnah'; }
      }
    } else if (alias.kind === 'tanakh') {
      if (tail.startsWith(':')) ref = `${alias.title} ${num}${tail}`; // chapter:verse only
    } else if (!/[ab]/.test(tail)) {
      ref = `${alias.title} ${num}${tail}`;
    }
    let length = whole.length - prefix.length;
    // "Berakhot (6b)" / "Yoma [86a–b]": take the closing bracket into the link
    const open = /[(\[]/.exec(whole);
    if (open) {
      const close = text.slice(m.index + whole.length).match(/^[^)\]]{0,4}[)\]]/);
      if (close) length += close[0].length;
    }
    // "Sulam on Zohar, Vayikra 285:1" is not Leviticus
    if (ref && alias.kind === 'tanakh' && /Zohar,?\s*$/.test(text.slice(Math.max(0, m.index - 8), m.index))) ref = null;
    if (ref && inBounds(ref)) out.push({ index: m.index + prefix.length, length, ref, category });
  }
  return out;
}

// Additional source forms used by the Akiva Publishing study editions.
// Link to the *existing* Sefaria work, never a fabricated paragraph of a
// text unavailable on Sefaria. Ambiguous Zohar folios link to the parashah.
const SPECIAL_REFERENCES = [
  { re: /\b(?:Holy\s+)?Zohar\s*\(\s*(Bo|Balak|Tetzaveh|Emor|Beshalach|Noach|Bereshit|Bereishit|Vayera|Vayechi|Vayikra|Pinchas|Kedoshim|Acharei Mot|Acharei Mos|Ki Tisa|Terumah|Behar|Naso)\s+\d+[ab]\s*\)/gi,
    ref: m => 'Zohar, ' + ({Bereishit:'Bereshit','Acharei Mos':'Acharei Mot'}[m[1]] || m[1]) },
  { re: /\bRashi on\s+(Genesis|Exodus|Leviticus|Numbers|Deuteronomy)\s+(\d{1,3}:\d{1,3})\b/gi,
    ref: m => 'Rashi on ' + m[1] + ' ' + m[2] },
  { re: /\b(?:Bereishit|Bereshit) Rabbah,?\s+parashah\s+(\d{1,3})\b/gi,
    ref: m => 'Bereshit Rabbah ' + m[1] },
  { re: /\bSefer HaBahir\b/gi, ref: () => 'Sefer HaBahir' },
  // Mei HaShiloach study edition: forms the Word edition links to Sefaria.
  { re: /\b(?:Tractate )?Middot\s*\(\s*(\d{1,2}):(\d{1,2})\s*\)/gi,
    ref: m => 'Mishnah Middot ' + m[1] + ':' + m[2] },
  { re: /\b(?:Midrash Rabbah|Midrash)\s*\(\s*(?:Bereishit|Bereshit)(?:\s+Rabbah)?\s+(\d{1,3}):(\d{1,3})\s*\)/gi,
    ref: m => 'Bereshit Rabbah ' + m[1] + ':' + m[2] },
  { re: /\bMidrash Rabbah\s*\(\s*(?:Bereishit|Bereshit)\s+(\d{1,3}):(\d{1,3})\s*\)/gi,
    ref: m => 'Bereshit Rabbah ' + m[1] + ':' + m[2] },
  { re: /\bSod Yesharim,\s*Rosh Hashanah\s+(\d{1,3})\b/gi,
    ref: m => 'Sod Yesharim, Rosh Hashanah ' + m[1] },
  { re: /\(\s*Tetzaveh\s*\)/g, ref: () => 'Exodus 27:20-30:10' },
  { re: /\(\s*Va['’]etchanan\s*[;)]/g, ref: () => 'Deuteronomy 3:23-7:11' },
];
// Runs `finder(plainText)` over the text of an HTML string and wraps every match
// in <a data-ref>. Inline formatting tags (<i>, <b>, <em> ...) are transparent,
// so "<i>Sefer Yetzirah</i> 1:3" is still one citation; a match that crosses a
// tag is wrapped piece by piece so the markup stays well formed. Existing links,
// footnote markers and any other tag act as barriers.
const TRANSPARENT = /^<\/?(?:i|b|em|strong|u|span|small|big)\b/i;
export function linkWith(html, finder) {
  const tokens = html.split(/(<[^>]+>)/);
  const pieces = [];           // {tokenIndex, start, end} text pieces inside the plain string
  let plain = '', inLink = 0, inSup = 0;
  tokens.forEach((tok, ti) => {
    if (ti % 2) {
      if (/^<a\b/i.test(tok)) { inLink++; plain += '\u0001'; }
      else if (/^<\/a>/i.test(tok)) { inLink = Math.max(0, inLink - 1); plain += '\u0001'; }
      else if (/^<sup\b/i.test(tok)) { inSup++; plain += '\u0001'; }
      else if (/^<\/sup>/i.test(tok)) { inSup = Math.max(0, inSup - 1); plain += '\u0001'; }
      else if (!TRANSPARENT.test(tok)) plain += '\u0001';
      return;
    }
    if (!tok) return;
    if (inLink || inSup) { plain += '\u0001'.repeat(Math.min(tok.length, 1)); return; }
    pieces.push({ ti, start: plain.length, end: plain.length + tok.length });
    plain += tok;
  });
  const found = finder(plain);
  if (!found.length) return html;
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  const edits = new Map();     // tokenIndex -> [{from,to,ref}]
  let at = 0;
  for (const f of found) {
    if (f.index < at) continue;
    const to = f.index + f.length;
    for (const p of pieces) {
      const from = Math.max(f.index, p.start), end = Math.min(to, p.end);
      if (from >= end || !plain.slice(from, end).trim()) continue;
      if (!edits.has(p.ti)) edits.set(p.ti, []);
      edits.get(p.ti).push({ from: from - p.start, to: end - p.start, ref: f.ref });
    }
    at = to;
  }
  for (const [ti, list] of edits) {
    let out = '', pos = 0;
    for (const e of list.sort((a, b) => a.from - b.from)) {
      out += tokens[ti].slice(pos, e.from) + `<a data-ref="${e.ref.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` + tokens[ti].slice(e.from, e.to) + '</a>';
      pos = e.to;
    }
    tokens[ti] = out + tokens[ti].slice(pos);
  }
  return tokens.join('');
}
function specialMatches(text) {
  const matches = referenceMatches(text);
  for (const rule of SPECIAL_REFERENCES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const ref = rule.ref(m);
      if (ref) matches.push({ index: m.index, length: m[0].length, ref });
    }
  }
  return matches;
}
const linkSpecialReferences = html => linkWith(html, specialMatches);

// Wraps citations found in the text of an HTML string in <a data-ref>,
// leaving existing links, tags and footnote markers alone.
export function linkCitations(html) {
  html = linkSpecialReferences(html);
  return linkWith(html, text => findCitations(text));
}

// Citations written in Hebrew (e.g. "ברכות ז׳ ע״ב", "זוה״ק (לך פד.)").
export const linkHebrewCitations = html => linkWith(html, hebrewMatchesVocalized);

// Category for any Sefaria-style ref (used for links already in the source files).
export function categoryOf(ref) {
  if (/^Mishnah /.test(ref)) return 'Mishnah';
  if (/^Jerusalem Talmud /.test(ref)) return 'Talmud';
  const title = Object.keys(CATEGORY).filter(t => ref === t || ref.startsWith(t + ' ') || ref.startsWith(t + ','))
    .sort((a, b) => b.length - a.length)[0];
  if (title) return CATEGORY[title];
  if (/^Zohar|^Tikkunei|^Sefer Etz Chaim|^Pri Etz Chaim/.test(ref)) return 'Kabbalah';
  if (/^Tanna DeBei Eliyahu/.test(ref)) return 'Midrash';
  if (/^(Rashi|Tosafot|Ramban|Ibn Ezra|Maharsha)/.test(ref)) return 'Commentary';
  if (/^Mishneh Torah|^Shulchan/.test(ref)) return 'Halakhah';
  if (/Rabbah|Tanchuma|Midrash|Sifrei|Sifra|Mekhilta|Yalkut/.test(ref)) return 'Midrash';
  return 'Other';
}

// "Avodah Zarah.19a.8" (Sefaria URL form) -> "Avodah Zarah 19a:8"
export function normalizeRef(ref) {
  const m = ref.match(/^(.*?[^\d\s])\.(\d+[ab]?)((?:\.\d+[ab]?)*)(-.*)?$/);
  return m ? `${m[1]} ${m[2]}${m[3].replace(/\./g, ':')}${(m[4] || '').replace(/\./g, ':')}` : ref;
}

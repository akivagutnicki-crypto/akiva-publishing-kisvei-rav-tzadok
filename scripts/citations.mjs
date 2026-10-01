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
  'Bereshit Rabbah': ['Bereishis Rabbah', 'Bereishit Rabbah', 'Bereshit Rabbah', 'Genesis Rabbah'],
  'Shemot Rabbah': ['Shemos Rabbah', 'Shemot Rabbah', 'Exodus Rabbah'],
  'Vayikra Rabbah': ['Vayikra Rabbah', 'Leviticus Rabbah'],
  'Bamidbar Rabbah': ['Bamidbar Rabbah', 'Numbers Rabbah'],
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
add(WORKS, 'work', t => /Rabbah|Tehillim|Eliezer/.test(t) ? 'Midrash' : /Avot/.test(t) ? 'Mishnah'
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
    if (ref) out.push({ index: m.index + prefix.length, length, ref, category });
  }
  return out;
}

// Wraps citations found in the text parts of an HTML string in <a data-ref>,
// leaving existing links, tags and footnote markers alone.
export function linkCitations(html) {
  let inLink = 0, inSup = 0;
  return html.split(/(<[^>]+>)/).map(part => {
    if (part.startsWith('<')) {
      if (/^<a\b/i.test(part)) inLink++;
      else if (/^<\/a>/i.test(part)) inLink = Math.max(0, inLink - 1);
      else if (/^<sup\b/i.test(part)) inSup++;
      else if (/^<\/sup>/i.test(part)) inSup = Math.max(0, inSup - 1);
      return part;
    }
    if (inLink || inSup || !part) return part;
    const found = findCitations(part);
    if (!found.length) return part;
    let out = '', at = 0;
    for (const f of found) {
      out += part.slice(at, f.index) + `<a data-ref="${f.ref.replace(/"/g, '&quot;')}">${part.slice(f.index, f.index + f.length)}</a>`;
      at = f.index + f.length;
    }
    return out + part.slice(at);
  }).join('');
}

// Category for any Sefaria-style ref (used for links already in the source files).
export function categoryOf(ref) {
  if (/^Mishnah /.test(ref)) return 'Mishnah';
  if (/^Jerusalem Talmud /.test(ref)) return 'Talmud';
  const title = Object.keys(CATEGORY).filter(t => ref === t || ref.startsWith(t + ' ') || ref.startsWith(t + ','))
    .sort((a, b) => b.length - a.length)[0];
  if (title) return CATEGORY[title];
  if (/^Zohar|^Tikkunei/.test(ref)) return 'Kabbalah';
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

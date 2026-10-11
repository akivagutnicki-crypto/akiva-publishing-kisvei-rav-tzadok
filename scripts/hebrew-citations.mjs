// Citations written in Hebrew (verse and daf in Hebrew numerals) -> Sefaria and
// library refs. hebrewMatches(plain) works on text with vowels and cantillation
// already removed; hebrewMatchesVocalized() maps results back onto the original
// string. Only forms that carry enough to name a real passage are linked: a
// tractate with chapter and amud, a book with chapter and verse, a Zohar
// parashah with a folio, "Hilchos X perek Y halachah Z", and so on.
import { TANAKH, SHAS } from './packs.mjs';
import { PARASHOT, MISHNAH, RAMBAM, LIB, map } from './reference-finders.mjs';

const MAX_CHAPTER = Object.fromEntries(TANAKH.flatMap(([, books]) => books));
const amudIndex = s => { const m = /^(\d+)([ab])$/.exec(s); return m ? +m[1] * 2 + (m[2] === 'b' ? 1 : 0) : null; };
const DAF_RANGE = Object.fromEntries(SHAS.flatMap(([, ts]) => ts.map(([t, , a, z]) => [t, [amudIndex(a), amudIndex(z)]])));

// ---- Hebrew numerals ----
const FINAL = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const VAL = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ל: 30, מ: 40, נ: 50, ס: 60, ע: 70, פ: 80, צ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
export function gematria(tok) {
  const s = tok.replace(/["״”'׳’]/g, '').replace(/[ךםןףץ]/g, c => FINAL[c]);
  if (!s || s.length > 5 || !/^ת{0,2}[קרש]?(?:ט[וז]|[יכלמנסעפצ]?[א-ט]?)$/.test(s)) return 0;
  return [...s].reduce((n, c) => n + VAL[c], 0);
}
const Q = `["״”'׳’]`;
const NUM = String.raw`([א-ת]{1,4}${Q}?[א-ת]?|[א-ת]${Q})`;
const AMUD = String.raw`(ע${Q}?\s*[אב]|עמוד\s*[אב]${Q}?|[.:])`;
const amudOf = s => (/[ב]|:/.test(s.replace(/^עמוד/, '').replace(/^ע/, '')) ? 'b' : 'a');
const B = String.raw`(?<![א-ת])`;                 // not inside a word
const PRE = String.raw`(?:[ובלהמכשד]{1,2})?`;      // attached prefix letters
const sp = names => names.map(n => n.replace(/ /g, String.raw`\s+`)).join('|');
const out = (index, length, ref) => ({ index, length, ref });

// ---- Tanakh ----
const BOOKS = [
  ['Genesis', 'בראשית'], ['Exodus', 'שמות'], ['Leviticus', 'ויקרא'], ['Numbers', 'במדבר'], ['Deuteronomy', 'דברים'],
  ['Joshua', 'יהושע'], ['Judges', 'שופטים'], ['Isaiah', 'ישעיה', 'ישעיהו'], ['Jeremiah', 'ירמיה', 'ירמיהו'], ['Ezekiel', 'יחזקאל'],
  ['Hosea', 'הושע'], ['Joel', 'יואל'], ['Amos', 'עמוס'], ['Obadiah', 'עובדיה'], ['Jonah', 'יונה'], ['Micah', 'מיכה'], ['Nahum', 'נחום'],
  ['Habakkuk', 'חבקוק'], ['Zephaniah', 'צפניה'], ['Haggai', 'חגי'], ['Zechariah', 'זכריה'], ['Malachi', 'מלאכי'],
  ['Psalms', 'תהלים', 'תהילים'], ['Proverbs', 'משלי'], ['Job', 'איוב'], ['Song of Songs', 'שיר השירים'], ['Ruth', 'רות'],
  ['Lamentations', 'איכה'], ['Ecclesiastes', 'קהלת'], ['Esther', 'אסתר'], ['Daniel', 'דניאל'], ['Ezra', 'עזרא'], ['Nehemiah', 'נחמיה'],
];
const BOOK_BY_HE = new Map(BOOKS.flatMap(([en, ...hes]) => hes.map(h => [h, en])));
const TWO_PART = { שמואל: ['I Samuel', 'II Samuel'], מלכים: ['I Kings', 'II Kings'], 'דברי הימים': ['I Chronicles', 'II Chronicles'] };
const BOOK_ALT = sp([...BOOK_BY_HE.keys(), ...Object.keys(TWO_PART)].sort((a, b) => b.length - a.length));
function tanakhMatches(t) {
  const found = [];
  const re = new RegExp(`${B}(${PRE})(${BOOK_ALT})(?:\\s*[־-]?\\s*([אב])${Q}?)?\\s*,?\\s*(?:פרק\\s*)?${NUM}(?:\\s*[,:.]\\s*|\\s+)(?:פסוק\\s*)?${NUM}(?![א-ת])`, 'g');
  for (const m of t.matchAll(re)) {
    const name = m[2].replace(/\s+/g, ' ');
    let en = BOOK_BY_HE.get(name);
    if (TWO_PART[name]) { if (!m[3]) continue; en = TWO_PART[name][m[3] === 'א' ? 0 : 1]; }
    else if (m[3]) continue;                       // "שמות א׳ …": the א is the chapter
    if (!en) continue;
    const ch = gematria(m[4]), v = gematria(m[5]);
    if (!ch || !v || ch > (MAX_CHAPTER[en] || 0) || v > 176) continue;
    found.push(out(m.index + m[1].length, m[0].length - m[1].length, `${en} ${ch}:${v}`));
  }
  return found;
}

// ---- Talmud Bavli, and Mishnah by perek / mishnah ----
const TRACT_ALIASES = {
  'Bava Kamma': ['בבא קמא', 'ב"ק', 'בב"ק'], 'Bava Metzia': ['בבא מציעא', 'ב"מ'], 'Bava Batra': ['בבא בתרא', 'ב"ב'],
  'Avodah Zarah': ['עבודה זרה', 'ע"ז'], 'Rosh Hashanah': ['ראש השנה', 'ר"ה'], 'Moed Katan': ['מועד קטן', 'מו"ק'],
};
const TRACTATES = SHAS.flatMap(([, ts]) => ts.map(([en, he]) => [en, [he, ...(TRACT_ALIASES[en] || [])]]));
const TRACT_BY_HE = new Map();
for (const [en, hes] of TRACTATES) for (const h of hes) TRACT_BY_HE.set(h.replace(/["״”]/g, '"'), en);
const TRACT_ALT = [...TRACT_BY_HE.keys()].sort((a, b) => b.length - a.length).map(h => h.replace(/ /g, String.raw`\s+`).replace(/"/g, '["״”]')).join('|');
const tractKey = s => s.replace(/\s+/g, ' ').replace(/[״”]/g, '"');
function talmudMatches(t) {
  const found = [];
  const re = new RegExp(`${B}(${PRE})(?:מסכת\\s+)?(${TRACT_ALT})\\s*,?\\s*(?:דף\\s*)?${NUM}\\s*,?\\s*${AMUD}`, 'g');
  for (const m of t.matchAll(re)) {
    const en = TRACT_BY_HE.get(tractKey(m[2]));
    const daf = gematria(m[3]);
    if (!en || !daf) continue;
    if (/^[.:]$/.test(m[4]) && !(m[3].replace(/["״”'׳’]/g, '').length >= 2 || /['׳’]/.test(m[3]))) continue;
    const ref = `${en} ${daf}${amudOf(m[4])}`;
    const r = DAF_RANGE[en], i = amudIndex(`${daf}${amudOf(m[4])}`);
    if (!r || i < r[0] || i > r[1]) continue;
    // "ב"ב"/"ע"ז" abbreviations only link with an explicit amud mark, never a bare period
    found.push(out(m.index + m[1].length, m[0].length - m[1].length, ref));
  }
  return found;
}
const MISHNAH_HE = {
  Peah: 'פאה', Demai: 'דמאי', Kilayim: 'כלאים', Sheviit: 'שביעית', Terumot: 'תרומות', Maasrot: 'מעשרות', 'Maaser Sheni': 'מעשר שני',
  Challah: 'חלה', Orlah: 'ערלה', Bikkurim: 'ביכורים', Parah: 'פרה', Tahorot: 'טהרות', Mikvaot: 'מקואות', Eduyot: 'עדיות', Middot: 'מדות',
  Kinnim: 'קנים', Kelim: 'כלים', Oholot: 'אהלות', Negaim: 'נגעים', 'Tevul Yom': 'טבול יום', Yadayim: 'ידים', Oktzin: 'עוקצין', Zavim: 'זבים',
  Makhshirin: 'מכשירין', Avot: 'אבות',
};
const MISH_BY_HE = new Map(Object.entries(MISHNAH_HE).map(([en, he]) => [he, en]));
for (const [en, hes] of TRACTATES) for (const h of hes) MISH_BY_HE.set(tractKey(h), en);
const YERUSHALMI_OK = new Set(MISHNAH.filter(r => r[2]).map(r => r[0]));
const MISH_ALT = [...MISH_BY_HE.keys()].sort((a, b) => b.length - a.length).map(h => h.replace(/ /g, String.raw`\s+`).replace(/"/g, '["״”]')).join('|');
function mishnahMatches(t) {
  const found = [];
  const re = new RegExp(`${B}(${PRE})(?:מסכת\\s+|פרק\\s+[א-ת${Q}]{1,5}\\s+(?:ד|די)?)?(${MISH_ALT})\\s*,?\\s*(?:פרק|פ${Q}?)\\s*${NUM}\\s*,?\\s*(?:משנה|מ${Q}?)\\s*${NUM}(?![א-ת])`, 'g');
  for (const m of t.matchAll(re)) {
    const en = MISH_BY_HE.get(tractKey(m[2]));
    const c = gematria(m[3]), n = gematria(m[4]);
    if (!en || !c || !n || c > 40 || n > 30) continue;
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    const yer = /ירושלמי|ירוש${Q}/.test(before) && YERUSHALMI_OK.has(en);
    found.push(out(m.index + m[1].length, m[0].length - m[1].length, `${yer ? 'Jerusalem Talmud' : 'Mishnah'} ${en} ${c}:${n}`));
  }
  return found;
}

// ---- Zohar, Tikkunei Zohar, Midrash Tanchuma ----
const HE_PARASHOT = [
  'בראשית', 'נח', 'לך לך|לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי',
  'שמות', 'וארא', 'בא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא|תשא', 'ויקהל', 'פקודי',
  'ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות|אחרי', 'קדושים', 'אמור', 'בהר', 'בחוקותי|בחקותי',
  'במדבר', 'נשא', 'בהעלותך|בהעלתך', 'שלח לך|שלח', 'קרח', 'חקת|חוקת', 'בלק', 'פינחס', 'מטות', 'מסעי',
  'דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים', 'כי תצא|תצא', 'כי תבוא|תבוא', 'נצבים', 'וילך', 'האזינו',
];
const PAR_BY_HE = new Map(HE_PARASHOT.flatMap((s, i) => s.split('|').map(h => [h, PARASHOT[i]])));
const PAR_ALT = [...PAR_BY_HE.keys()].sort((a, b) => b.length - a.length).map(h => h.replace(/ /g, String.raw`\s+`)).join('|');
const ZOHAR_KW = String.raw`(?:זוה${Q}?ק|זוהר(?:\s+הקדוש)?|זהר|רע${Q}?מ|רעיא\s+מהימנא|מדרש\s+הנעלם)`;
const zoharRef = (vol, node, daf) => {
  const r = map.zohar[vol]?.[daf];
  return r && r.startsWith(`Zohar, ${node} `) ? r : `Zohar, ${node}`;
};
function zoharMatches(t) {
  const found = [];
  const re = new RegExp(`${B}(${PRE})(${ZOHAR_KW})\\s*[(\\[,]?\\s*(?:(?:חלק|ח${Q}?)\\s*([אבג])${Q}?\\s*[,]?\\s*)?(?:פרשת\\s+)?(?:(${PAR_ALT})\\s*,?\\s*)?(?:דף\\s*)?${NUM}\\s*(?:${AMUD})?`, 'g');
  for (const m of t.matchAll(re)) {
    const p = m[4] && PAR_BY_HE.get(m[4].replace(/\s+/g, ' '));
    const volLetter = m[3];
    const daf = gematria(m[5]);
    if (!daf || (!p && !volLetter)) continue;
    const vol = volLetter ? { א: 1, ב: 2, ג: 3 }[volLetter] : map.parashot[p[1]];
    if (!vol) continue;
    const amud = m[6] && /[אב]|[.:]/.test(m[6]) ? amudOf(m[6]) : null;
    let ref;
    if (amud && map.zohar[vol]?.[`${daf}${amud}`]) {
      const r = map.zohar[vol][`${daf}${amud}`];
      if (p && !r.startsWith(`Zohar, ${p[1]} `)) ref = `Zohar, ${p[1]}`; else ref = r;
    } else if (p) ref = `Zohar, ${p[1]}`;
    else continue;
    found.push(out(m.index + m[1].length, m[0].length - m[1].length, ref));
  }
  // Tikkunei Zohar: "תיקוני זוהר דף י״ז ע״ב" / "תיקו״ז תיקון כ״א"
  const tik = new RegExp(`${B}(${PRE})(?:תיקוני\\s+זוהר|תיקו${Q}?ז|ת${Q}ז)\\s*[(\\[,]?\\s*(?:(?:דף\\s*)${NUM}\\s*${AMUD}|(?:תיקון|ת${Q})\\s*${NUM})`, 'g');
  for (const m of t.matchAll(tik)) {
    let ref;
    if (m[2] !== undefined && m[3] !== undefined) {
      const d = gematria(m[2]); if (!d || d > 150) continue;
      ref = `Tikkunei Zohar ${d}${amudOf(m[3])}`;
    } else {
      const n = gematria(m[4] ?? '');
      ref = n && map.tikkunim[n];
    }
    if (ref) found.push(out(m.index + m[1].length, m[0].length - m[1].length, ref));
  }
  // Midrash Tanchuma
  const tan = new RegExp(`${B}(${PRE})תנחומא\\s*[(\\[,]?\\s*(?:פרשת\\s+)?(${PAR_ALT})\\s*,?\\s*(?:סימן\\s*|סי${Q}?\\s*)?${NUM}(?![א-ת])`, 'g');
  for (const m of t.matchAll(tan)) {
    const p = PAR_BY_HE.get(m[2].replace(/\s+/g, ' '));
    const n = gematria(m[3]);
    if (p && n && n <= 40) found.push(out(m.index + m[1].length, m[0].length - m[1].length, `Midrash Tanchuma, ${p[0]} ${n}`));
  }
  return found;
}

// ---- Mishneh Torah, Midrash, later works ----
const RAMBAM_HE = {
  'תשובה': 'teshuvah', 'יסודי התורה': 'yesodeihatorah', 'דעות': 'deot', 'תלמוד תורה': 'talmudtorah', 'עבודה זרה': 'avodahzarah',
  'עבודת כוכבים': 'avodatkochavim', 'איסורי ביאה': 'issureibiah', 'אישות': 'ishut', 'גירושין': 'geirushin', 'מלכים': 'melachim',
  'ממרים': 'mamrim', 'סנהדרין': 'sanhedrin', 'שבת': 'shabbat', 'שקלים': 'shekalim', 'רוצח': 'rotzeach', 'נחלות': 'nachalot',
  'חובל ומזיק': 'chovelumazik', 'מגילה וחנוכה': 'megillahvachanukah', 'מאכלות אסורות': 'maachalotassurot', 'חמץ ומצה': 'chametzumatzah',
  'שמיטה ויובל': 'shemitahveyovel', 'טומאת צרעת': 'tumattzaraat', 'ביכורים': 'bikkurim', 'ביאת מקדש': 'biatmikdash',
  'תפילה': 'tefillah', 'מלוה ולוה': 'malveh',
};
const RAMBAM_HE_ALT = Object.keys(RAMBAM_HE).sort((a, b) => b.length - a.length).map(s => s.replace(/ /g, String.raw`\s+`)).join('|');
const MISHNEH_TORAH = (k) => RAMBAM[k];
function worksMatches(t) {
  const found = [];
  for (const m of t.matchAll(new RegExp(`${B}(${PRE})הלכות\\s+(${RAMBAM_HE_ALT})\\s*,?\\s*(?:פרק|פ${Q}?)\\s*${NUM}\\s*,?\\s*(?:הלכה|ה${Q}?)\\s*${NUM}(?![א-ת])`, 'g'))) {
    const title = MISHNEH_TORAH(RAMBAM_HE[m[2].replace(/\s+/g, ' ')]);
    const c = gematria(m[3]), h = gematria(m[4]);
    if (title && c && h && c <= 40 && h <= 30) found.push(out(m.index + m[1].length, m[0].length - m[1].length, `Mishneh Torah, ${title} ${c}:${h}`));
  }
  const RABBAH = { 'בראשית': 'Bereshit Rabbah', 'שמות': 'Shemot Rabbah', 'ויקרא': 'Vayikra Rabbah', 'במדבר': 'Bamidbar Rabbah', 'דברים': 'Devarim Rabbah' };
  for (const m of t.matchAll(new RegExp(`${B}(${PRE})(בראשית|שמות|ויקרא|במדבר|דברים)\\s+רבה\\s*,?\\s*(?:פרשה|פ${Q}?)\\s*${NUM}`, 'g'))) {
    const n = gematria(m[3]);
    if (n && n <= 100) found.push(out(m.index + m[1].length, m[0].length - m[1].length, `${RABBAH[m[2]]} ${n}`));
  }
  const num1 = (re, ref) => { for (const m of t.matchAll(re)) { const n = gematria(m[2]); if (n) { const r = ref(n); if (r) found.push(out(m.index + m[1].length, m[0].length - m[1].length, r)); } } };
  num1(new RegExp(`${B}(${PRE})(?:שוחר טוב|מדרש תהילים|מדרש תהלים)\\s*[(\\[,]?\\s*(?:מזמור\\s*)?${NUM}(?![א-ת])`.replace('(?:שוחר טוב|', '(?:שוחר\\s+טוב|'), 'g'), n => n <= 150 && `Midrash Tehillim ${n}`);
  num1(new RegExp(`${B}(${PRE})ספר\\s+חסידים\\s*[(\\[,]?\\s*(?:סימן\\s*|סי${Q}?\\s*)${NUM}(?![א-ת])`, 'g'), n => n <= 1200 && `Sefer Chasidim ${n}`);
  num1(new RegExp(`${B}(${PRE})ספר\\s+החינוך\\s*[(\\[,]?\\s*(?:מצוה\\s*|מצווה\\s*)${NUM}(?![א-ת])`, 'g'), n => n <= 613 && `Sefer HaChinukh ${n}`);
  num1(new RegExp(`${B}(${PRE})(?:תניא|ליקוטי\\s+אמרים)\\s*[(\\[,]?\\s*(?:פרק\\s*|פ${Q}?\\s*)${NUM}(?![א-ת])`, 'g'), n => n <= 53 && `Tanya, Part I; Likkutei Amarim ${n}`);
  return found;
}

// ---- Rav Tzadok's library and the Izhbitz-Radzin works ----
const LIB_HE = [
  ['Tzidkat HaTzadik', 'צדקת הצדיק'], ['Resisei Layla', 'רסיסי לילה'], ['Machshavot Charutz', 'מחשבות חרוץ'], ['Takanat HaShavin', 'תקנת השבין'],
  ['Divrei Soferim', 'דברי סופרים'], ['Yisrael Kedoshim', 'ישראל קדושים'], ['Divrei Chalomot', 'דברי חלומות'], ['Poked Akarim', 'פוקד עקרים'],
  ['Et HaOchel', 'עת האוכל'], ['Likkutei Maamarim', 'לקוטי מאמרים'],
];
function libraryMatches(t) {
  const found = [];
  for (const [en, he] of LIB_HE) {
    const re = new RegExp(`${B}(${PRE})${he.replace(/ /g, String.raw`\s+`)}\\s*[(\\[,]?\\s*(?:אות|סימן|סי${Q}|פרק|אות\\s+ה?)\\s*${NUM}(?![א-ת])`, 'g');
    for (const m of t.matchAll(re)) {
      const n = gematria(m[2]); const ref = `${en} ${n}`;
      if (n && LIB.has(ref)) found.push(out(m.index + m[1].length, m[0].length - m[1].length, ref));
    }
  }
  // Mei HaShiloach (part, parashah)
  const mei = new RegExp(`${B}(${PRE})מי\\s+השלוח\\s*[(\\[,]?\\s*(?:(?:חלק|ח${Q}?)\\s*([אב])${Q}?\\s*,?\\s*)?(?:פרשת\\s+)?(${PAR_ALT})`, 'g');
  for (const m of t.matchAll(mei)) {
    const p = PAR_BY_HE.get(m[3].replace(/\s+/g, ' '));
    if (p) found.push(out(m.index + m[1].length, m[0].length - m[1].length, `Mei HaShiloach, Volume ${m[2] === 'ב' ? 'II' : 'I'}, ${p[2]}, ${p[0]}`));
  }
  return found;
}

export function hebrewMatches(plain) {
  if (!/[א-ת]/.test(plain)) return [];
  return [...tanakhMatches(plain), ...talmudMatches(plain), ...mishnahMatches(plain), ...zoharMatches(plain), ...worksMatches(plain), ...libraryMatches(plain)];
}

// Vowels and cantillation (U+0591-05C7) are skipped for matching; indices are
// mapped back onto the vocalized string, extending each match over trailing marks.
export function hebrewMatchesVocalized(text) {
  if (!/[א-ת]/.test(text)) return [];
  let plain = '';
  const back = [];
  for (let i = 0; i < text.length; i++) {
    if (/[֑-ֽֿ-ׇ]/.test(text[i])) continue;
    plain += text[i]; back.push(i);
  }
  return hebrewMatches(plain).map(f => {
    const start = back[f.index];
    let end = back[f.index + f.length - 1] + 1;
    while (end < text.length && /[֑-ֽֿ-ׇ]/.test(text[end])) end++;
    return { index: start, length: end - start, ref: f.ref };
  });
}

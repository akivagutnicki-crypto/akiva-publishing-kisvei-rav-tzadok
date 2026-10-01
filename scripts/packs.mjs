// Offline packs of Sefaria texts for the web app: the reader saves the same
// Sefaria API answers it would fetch when a section is opened, so they open
// without a connection afterwards.

// Chapters per book, in Sefaria's (Hebrew) numbering.
export const TANAKH = [
  ['Torah', [['Genesis', 50], ['Exodus', 40], ['Leviticus', 27], ['Numbers', 36], ['Deuteronomy', 34]]],
  ['Prophets', [['Joshua', 24], ['Judges', 21], ['I Samuel', 31], ['II Samuel', 24], ['I Kings', 22], ['II Kings', 25],
    ['Isaiah', 66], ['Jeremiah', 52], ['Ezekiel', 48], ['Hosea', 14], ['Joel', 4], ['Amos', 9], ['Obadiah', 1],
    ['Jonah', 4], ['Micah', 7], ['Nahum', 3], ['Habakkuk', 3], ['Zephaniah', 3], ['Haggai', 2], ['Zechariah', 14], ['Malachi', 3]]],
  ['Writings', [['Psalms', 150], ['Proverbs', 31], ['Job', 42], ['Song of Songs', 8], ['Ruth', 4], ['Lamentations', 5],
    ['Ecclesiastes', 12], ['Esther', 10], ['Daniel', 12], ['Ezra', 10], ['Nehemiah', 13], ['I Chronicles', 29], ['II Chronicles', 36]]],
];
export const HE_TANAKH = {
  Genesis: 'בראשית', Exodus: 'שמות', Leviticus: 'ויקרא', Numbers: 'במדבר', Deuteronomy: 'דברים', Joshua: 'יהושע', Judges: 'שופטים',
  'I Samuel': 'שמואל א', 'II Samuel': 'שמואל ב', 'I Kings': 'מלכים א', 'II Kings': 'מלכים ב', Isaiah: 'ישעיהו', Jeremiah: 'ירמיהו',
  Ezekiel: 'יחזקאל', Hosea: 'הושע', Joel: 'יואל', Amos: 'עמוס', Obadiah: 'עובדיה', Jonah: 'יונה', Micah: 'מיכה', Nahum: 'נחום',
  Habakkuk: 'חבקוק', Zephaniah: 'צפניה', Haggai: 'חגי', Zechariah: 'זכריה', Malachi: 'מלאכי', Psalms: 'תהילים', Proverbs: 'משלי',
  Job: 'איוב', 'Song of Songs': 'שיר השירים', Ruth: 'רות', Lamentations: 'איכה', Ecclesiastes: 'קהלת', Esther: 'אסתר', Daniel: 'דניאל',
  Ezra: 'עזרא', Nehemiah: 'נחמיה', 'I Chronicles': 'דברי הימים א', 'II Chronicles': 'דברי הימים ב',
};

// Bavli tractates: [title, Hebrew, first amud, last amud] in Sefaria's pagination.
export const SHAS = [
  ['Zeraim', [['Berakhot', 'ברכות', '2a', '64a']]],
  ['Moed', [['Shabbat', 'שבת', '2a', '157b'], ['Eruvin', 'עירובין', '2a', '105a'], ['Pesachim', 'פסחים', '2a', '121b'],
    ['Shekalim', 'שקלים', '2a', '22b'], ['Yoma', 'יומא', '2a', '88a'], ['Sukkah', 'סוכה', '2a', '56b'], ['Beitzah', 'ביצה', '2a', '40b'],
    ['Rosh Hashanah', 'ראש השנה', '2a', '35a'], ['Taanit', 'תענית', '2a', '31a'], ['Megillah', 'מגילה', '2a', '32a'],
    ['Moed Katan', 'מועד קטן', '2a', '29a'], ['Chagigah', 'חגיגה', '2a', '27a']]],
  ['Nashim', [['Yevamot', 'יבמות', '2a', '122b'], ['Ketubot', 'כתובות', '2a', '112b'], ['Nedarim', 'נדרים', '2a', '91b'],
    ['Nazir', 'נזיר', '2a', '66b'], ['Sotah', 'סוטה', '2a', '49b'], ['Gittin', 'גיטין', '2a', '90b'], ['Kiddushin', 'קידושין', '2a', '82b']]],
  ['Nezikin', [['Bava Kamma', 'בבא קמא', '2a', '119b'], ['Bava Metzia', 'בבא מציעא', '2a', '119a'], ['Bava Batra', 'בבא בתרא', '2a', '176b'],
    ['Sanhedrin', 'סנהדרין', '2a', '113b'], ['Makkot', 'מכות', '2a', '24b'], ['Shevuot', 'שבועות', '2a', '49b'],
    ['Avodah Zarah', 'עבודה זרה', '2a', '76b'], ['Horayot', 'הוריות', '2a', '14a']]],
  ['Kodashim', [['Zevachim', 'זבחים', '2a', '120b'], ['Menachot', 'מנחות', '2a', '110a'], ['Chullin', 'חולין', '2a', '142a'],
    ['Bekhorot', 'בכורות', '2a', '61a'], ['Arakhin', 'ערכין', '2a', '34a'], ['Temurah', 'תמורה', '2a', '34a'],
    ['Keritot', 'כריתות', '2a', '28b'], ['Meilah', 'מעילה', '2a', '22a'], ['Tamid', 'תמיד', '25b', '33b']]],
  ['Tahorot', [['Niddah', 'נדה', '2a', '73a']]],
];

function amudim(first, last) {
  const out = [];
  let daf = parseInt(first, 10), side = first.slice(-1);
  const end = [parseInt(last, 10), last.slice(-1)];
  while (daf < end[0] || (daf === end[0] && side <= end[1])) {
    out.push(`${daf}${side}`);
    if (side === 'a') side = 'b'; else { side = 'a'; daf++; }
  }
  return out;
}

export function packs(citedRefs) {
  const tanakh = TANAKH.flatMap(([, books]) => books.flatMap(([b, n]) => Array.from({ length: n }, (_, i) => `${b} ${i + 1}`)));
  const shas = SHAS.flatMap(([, ts]) => ts.flatMap(([t, , a, z]) => amudim(a, z).map(x => `${t} ${x}`)));
  return {
    sources: { title: 'Sources cited in the library', refs: citedRefs, shapes: [] },
    tanakh: { title: 'Tanakh', refs: tanakh, shapes: TANAKH.flatMap(([, b]) => b.map(x => x[0])) },
    shas: { title: 'Talmud Bavli', refs: shas, shapes: SHAS.flatMap(([, t]) => t.map(x => x[0])) },
  };
}

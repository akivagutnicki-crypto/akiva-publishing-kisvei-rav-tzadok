"""Hebrew text normalisation used across the engine."""
import re
import unicodedata

NIKKUD_RE = re.compile('[֑-ֽֿ-ׇ]')
MAQAF = '־'
GERESH = '׳'
GERSHAYIM = '״'
HEB_LETTER_RE = re.compile('[א-ת]')
NON_HEB_RE = re.compile('[^א-ת"\'׳״\\s]')
PREFIXES = 'ובכלמשה'
FINAL_MAP = str.maketrans('ךםןףץ', 'כמנפצ')

# Common rabbinic abbreviations in Rav Tzadok's prose (expanded for matching, not for display).
ABBREVIATIONS = {
    'כמ"ש': 'כמו שכתוב', 'כמש"כ': 'כמו שכתוב', 'וכמ"ש': 'וכמו שכתוב', 'כמשאחז"ל': 'כמו שאמרו חכמינו זכרונם לברכה',
    'כמשאז"ל': 'כמו שאמרו זכרונם לברכה', 'כמ"ש בזוה"ק': 'כמו שכתוב בזוהר הקדוש', 'הקב"ה': 'הקדוש ברוך הוא',
    'הקדב"ה': 'הקדוש ברוך הוא', 'ית"ש': 'יתברך שמו', 'ית\'': 'יתברך', 'עוה"ז': 'עולם הזה', 'עוה"ב': 'עולם הבא',
    'יצה"ר': 'יצר הרע', 'יצ"ט': 'יצר טוב', 'תושב"כ': 'תורה שבכתב', 'תושבע"פ': 'תורה שבעל פה', 'שבע"פ': 'שבעל פה',
    'שבכ': 'שבכתב', 'ז"ל': 'זכרונם לברכה', 'זצ"ל': 'זכר צדיק לברכה', 'דהיינו': 'דהיינו', 'א"א': 'אי אפשר',
    'א"כ': 'אם כן', 'אעפ"כ': 'אף על פי כן', 'אע"פ': 'אף על פי', 'אעפ"י': 'אף על פי', 'ע"י': 'על ידי', 'עי"ז': 'על ידי זה',
    'ע"ז': 'על זה', 'ע"כ': 'על כן', 'וע"כ': 'ועל כן', 'כ"כ': 'כל כך', 'כ"א': 'כי אם', 'ח"ו': 'חס ושלום', 'ר"ל': 'רוצה לומר',
    'ד"ת': 'דברי תורה', 'ת"ת': 'תלמוד תורה', 'ת"ח': 'תלמיד חכם', 'ת"ח': 'תלמידי חכמים', 'ב"א': 'בני אדם',
    'בנ"י': 'בני ישראל', 'כנ"י': 'כנסת ישראל', 'א"י': 'ארץ ישראל', 'ביהמ"ק': 'בית המקדש', 'בהמ"ק': 'בית המקדש',
    'ביהכ"נ': 'בית הכנסת', 'ר"ח': 'ראש חודש', 'ר"ה': 'ראש השנה', 'יוה"כ': 'יום הכיפורים', 'יו"כ': 'יום כיפור',
    'ש"ק': 'שבת קודש', 'שבה"ק': 'שבת קודש', 'מ"ת': 'מתן תורה', 'יצ"מ': 'יציאת מצרים', 'משארז"ל': 'מה שאמרו רבותינו זכרונם לברכה',
    'שארז"ל': 'שאמרו רבותינו זכרונם לברכה', 'ארז"ל': 'אמרו רבותינו זכרונם לברכה', 'רז"ל': 'רבותינו זכרונם לברכה',
    'חז"ל': 'חכמינו זכרונם לברכה', 'בש"ס': 'בשס', 'ש"ס': 'שס', 'הש"י': 'השם יתברך', 'השי"ת': 'השם יתברך', 'ד\'': 'השם',
    'מ"מ': 'מכל מקום', 'ממ"נ': 'ממה נפשך', 'דהו"ל': 'דהוה ליה', 'הו"ל': 'הוה ליה', 'וכו\'': 'וכולי', 'וגו\'': 'וגומר',
    'וכיוצ"ב': 'וכיוצא בזה', 'כיו"ב': 'כיוצא בזה', 'בחי\'': 'בחינת', 'בחי"': 'בחינת', 'מדריגה': 'מדרגה',
    'ענין': 'עניין', 'נק\'': 'נקרא', 'פי\'': 'פירוש', 'עיי"ש': 'עיין שם', 'ע"ש': 'עיין שם', 'עיי\'': 'עיין',
}


def strip_nikkud(s):
    return NIKKUD_RE.sub('', s)


def normalize(s, keep_quotes=False):
    """Lowercase-equivalent for Hebrew: no nikkud, final letters folded, maqaf -> space, punctuation out."""
    s = unicodedata.normalize('NFC', s)
    s = strip_nikkud(s).replace(MAQAF, ' ')
    s = s.replace(GERSHAYIM, '"').replace(GERESH, "'")
    if not keep_quotes:
        s = s.replace('"', '').replace("'", '')
    s = re.sub('[^א-ת\\s]', ' ', s)
    s = s.translate(FINAL_MAP)
    return re.sub(r'\s+', ' ', s).strip()


def words(s):
    return normalize(s).split()


def strip_prefix(word):
    """Return the candidate stems of a word by stripping up to two proclitic prefixes (ו, ב, כ, ל, מ, ש, ה)."""
    out = {word}
    w = word
    for _ in range(2):
        if len(w) > 3 and w[0] in PREFIXES:
            w = w[1:]
            out.add(w)
    return out


def expand_abbreviations(s):
    for k, v in ABBREVIATIONS.items():
        s = s.replace(k, v)
    return s


def ngrams(tokens, n):
    return [' '.join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]


def shingles(s, n=3):
    """Word shingles over normalised Hebrew, for near-duplicate/quotation detection."""
    t = words(s)
    return set(ngrams(t, n)) if len(t) >= n else {' '.join(t)} if t else set()


HEBREW_NUMERALS = {'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40,
                   'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400, 'ך': 20, 'ם': 40, 'ן': 50, 'ף': 80, 'ץ': 90}


def gematria_number(s):
    """Hebrew numeral (e.g. מ"ח, קכ"ו, ט"ו) -> int. Returns None if the string is not a numeral."""
    t = s.replace('"', '').replace("'", '').replace(GERESH, '').replace(GERSHAYIM, '').strip()
    if not t or not all(ch in HEBREW_NUMERALS for ch in t):
        return None
    if t in ('טו', 'טז'):
        return 15 if t == 'טו' else 16
    total = 0
    for ch in t:
        total += HEBREW_NUMERALS[ch]
    # Reject implausible orders such as "אק" (ascending values in the wrong order) except the 15/16 forms
    vals = [HEBREW_NUMERALS[c] for c in t]
    if any(vals[i] < vals[i + 1] for i in range(len(vals) - 1)) and t not in ('טו', 'טז'):
        return None
    return total

#!/usr/bin/env python3
"""Validate the seven new phrase-pair translations against the source letters.

Document context-specific abbreviation expansions; preserve source spellings,
including the readings called out in the edition's transcription notes.
"""
import difflib
import html
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / 'sources/akiva/supplements/likkutei-maamarim'
spec = importlib.util.spec_from_file_location('imp', ROOT / 'scripts/import-likkutei-maamarim.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)
SOURCE = json.loads(imp.ORIGINAL.read_text())
NAMES = ['joshua-26', 'festivals-16-26', 'festivals-16-27', 'festivals-16-28', 'talmud-10', 'talmud-11', 'talmud-12']
KEYS = [('On Book of Joshua', None, 26), ('Compositions on the Festivals', 16, 26),
        ('Compositions on the Festivals', 16, 27), ('Compositions on the Festivals', 16, 28),
        ('Upon Completion of Talmud', None, 10), ('Upon Completion of Talmud', None, 11),
        ('Upon Completion of Talmud', None, 12)]
COMMON = {
    'כדחז"ל': 'כדברי חכמינו זכרונם לברכה', 'כדש"נ': 'כמו שנאמר',
    'כנז"ל': 'כנזכר לעיל', 'כנ"ל': 'כנזכר לעיל', 'כמש"נ': 'כמו שנאמר',
    'או,ה': 'אומות העולם', 'או"ה': 'אומות העולם', 'ע"כ': 'על כן',
    'ע"י': 'על ידי', 'ז"ל': 'זכרונם לברכה', 'שמו"ר': 'שמות רבה',
    'שמ"ר': 'שמות רבה', 'שי"ר': 'שיר השירים רבה', 'איכ"ר': 'איכה רבה',
    'קה"ר': 'קהלת רבה', 'תיקו"ז': 'תיקוני זוהר', 'זוה"ק': 'זוהר הקדוש',
    'חז"ל': 'חכמינו זכרונם לברכה', 'הקב"ה': 'הקדוש ברוך הוא',
    'כה"ג': 'כהן גדול', 'ת"ח': 'תלמידי חכמים', 'ג"ע': 'גן עדן',
    'הוז"ל': 'הוצאת זרע לבטלה', 'עכו"ם': 'עובדי כוכבים ומזלות',
    'ע"ז': 'עבודה זרה', 'מק"א': 'מקום אחר', 'אכ"מ': 'אין כאן מקומו',
    "וגו'": 'וגומר', "וכו'": 'וכולי', "נוק'": 'נוקבא', 'ר"ל': 'רוצה לומר',
    'ד"מ': 'ד מיתות', 'מ"ק': 'מועד קטן', 'ס"פ': 'סוף פרשת',
    'תשב"ץ': 'רבי שמעון בן צמח', "מס'": 'מסכת', 'ב"נ': 'בן נון',
    "עי'": 'עיין', "ע" + '"ש': 'עיין שם', "השתחוי'": 'השתחויה',
    "סגי'": 'סגי', "לבעלי'": 'לבעליה', "מצוי'": 'מצויה',
    "גלוי'": 'גלויה', "מסיטרי'": 'מסיטריה', 'לכנ"י': 'לכנסת ישראל',
    'כדפירוש רש ': 'כדפירוש רבי שלמה יצחקי ', 'הרמב"ן': 'הרב משה בן נחמן',
    'האריז"ל': 'האלהי רבי יצחק זכרונו לברכה', 'עפ"ה': 'על פי',
}
CONTEXT = [
    {'שמו"ר פ"א': 'שמות רבה פרק א', 'בראשית רבה פצ"ח': 'בראשית רבה פרק צח',
     'משה רבינו ע"ה': 'משה רבינו עליו השלום', 'דוד המלך ע"ה': 'דוד המלך עליו השלום'},
    {'שמ"ר פ"א': 'שמות רבה פרק א', 'בראשית רבה פצ"ח': 'בראשית רבה פרק צח'},
    {'קה"ר פ"א': 'קהלת רבה פרק א'},
    {'שי"ר פ"ג': 'שיר השירים רבה פרק ג', 'ויקרא רבה פי"ג': 'ויקרא רבה פרק יג',
     'בראשית רבה פס"ג': 'בראשית רבה פרק סג', 'איכ"ר פ"ב': 'איכה רבה פרק ב'},
    {'ויקרא רבה פי"ג': 'ויקרא רבה פרק יג', 'איכ"ר פ"ב': 'איכה רבה פרק ב',
     "ר' יוחנן": 'רבי יוחנן', 'ב ע': 'בעמי הארץ'},
    {'שיר השירים רבה (פ"ז)': 'שיר השירים רבה (פרק ז)',
     'שיר השירים רבה (פ״ז)': 'שיר השירים רבה (פרק ז)'},
    {},
]
NOTES = [
    ['The source itself marks one word as illegible after “רק”.',
     'The joined reading “אלעתיד” is retained; the English follows the apparent sense “in the future”.'],
    ['“ואעל פסוק” and “דור שהחיה שמעי” are retained as transcribed; the English follows their apparent contextual senses “although” and David sparing Shimei.',
     'The abbreviation מ״ה in “כי אין העונש מ״ה” remains unresolved and is retained.'],
    ['The malformed “עדבר זה” is retained; the English follows the surrounding argument.',
     'The corrupted reference “לא דמי:” is retained; the quoted rule is found in Berakhot 34b.'],
    ['“ואדום”, “דעיקב”, “סזוהר”, “חכמייון”, and “יפרוס” are retained as transcribed; contextual meanings are indicated in English.',
     'The apparent abbreviated reading עפ״ה is expanded contextually as על פי.'],
    ['ס״ר and ר״ק remain unidentified; neither has been assigned a speculative expansion.',
     '“כך שמן” and “בתותמו” are retained as transcribed.'],
    ['The spellings “נטמטאה”, “בתחלהת”, and “מתורך” are retained as transcribed.'],
    ['“מצריך”, “פרשץ”, “דאולם”, and the isolated י after “הישראל” are retained as transcribed; contextual meanings are indicated in English.'],
]

def consonants(text):
    return ''.join(re.findall('[א-ת]', text))

def expand(original, context):
    text, accounted = html.unescape(re.sub(r'<[^>]+>', '', original)), []
    for a, b in sorted(context.items(), key=lambda x: -len(x[0])):
        if a in text:
            accounted.append([a, b]); text = text.replace(a, b)
    for a, b in sorted(COMMON.items(), key=lambda x: -len(x[0])):
        if a in text:
            accounted.append([a, b]); text = text.replace(a, b)
    for pattern, replacement in [
        (r'(יעקב|אברהם) א ע(?![א-ת])', r'\1 אבינו עליו השלום'),
        (r'(דוד המלך|דהמלך|שלמה המלך) ע(?![א-ת])', r'\1 עליו השלום'),
        (r'אמרו ז(?![א-ת])', 'אמרו זכרונם לברכה'),
        (r'(?<![א-ת])ד\'(?![א-ת]|\s*(?:מינים|מלכיות|ספירות))', 'השם'),
        (r'וד\'(?= נתן)', 'והשם'),
        (r'(?<![א-ת])לד\'(?![א-ת])', 'להשם'),
    ]:
        for m in re.finditer(pattern, text):
            accounted.append([m.group(), m.expand(replacement)])
        text = re.sub(pattern, replacement, text)
    return text, accounted

def read_pairs(name):
    return [line.split('\t') for line in (DIR / (name + '.tsv')).read_text().splitlines() if line.strip()]

def review():
    output, errors = [], []
    for idx, ((node, ch, n), name) in enumerate(zip(KEYS, NAMES)):
        original = SOURCE['text'][node][ch-1][n-1] if ch else SOURCE['text'][node][n-1]
        expected, expansions = expand(original, CONTEXT[idx])
        pairs = read_pairs(name)
        assert all(len(p) == 2 and all(s.strip() for s in p) for p in pairs), name
        actual = ' '.join(p[0] for p in pairs)
        a, b = consonants(expected), consonants(actual)
        if a != b:
            sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
            for tag, i, j, k, l in sm.get_opcodes():
                if tag != 'equal':
                    errors.append((name, tag, a[max(0,i-12):i], a[i:j], b[k:l], a[j:j+12]))
        ref = f'Likkutei Maamarim, {node} ' + (f'{ch}:' if ch else '') + str(n)
        output.append({'ref': ref, 'node': node, 'chapter': ch, 'paragraph': n, 'original': original,
                       'expansions': expansions, 'transcriptionNotes': NOTES[idx], 'pairs': pairs})
        print(name, len(pairs), 'pairs;', 'source consonants preserved' if a == b else 'review needed')
    for error in errors:
        print(*error, sep=' | ')
    if errors:
        raise SystemExit(f'{len(errors)} source-letter differences remain')
    (DIR / 'reviewed.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    review()

"""Ingest an OCR'd elucidated edition of Tzidkat HaTzadik ("עם ביאור משולב": Rav Tzadok's text,
ביאורי החסידות, מקורות וציונים on every page) as training data.

The book itself is copyrighted and is never stored in the repository. What is kept are facts derived
from it: for each siman, which sources the editors cite (with the phrase the note marker sits on),
and which places in Rav Tzadok's other writings (and earlier / later in Tzidkat) they cross-reference.

    python3 run.py ingest-biur <ocr.docx|ocr.txt> <mcp-data dir> <out.json>
"""
import html
import json
import os
import re
import zipfile
from collections import Counter, defaultdict

from .citations import detect
from .hebrew import gematria_number, strip_nikkud
from .sefaria import normalize_ref

LABEL_SOURCES = re.compile(r'^\s*מ\S*ק\S*ו?\S*ר\S*ו\S*ת\s+ו\S*צ\S*י?\S*ו\S*נ\S*י\S*ם\s*$')
LABEL_BIUR = re.compile(r'^\s*ב\S*י?\S*א\S*ו\S*ר\S*י\s+ה\S*ח\S*ס\S*י\S*ד\S*ו\S*ת\s*$')
PAGE = re.compile(r'^— עמוד (\d+) —')
HEADER_OT = re.compile(r'אות\s+([א-ת"\'׳״]{1,4})')
ENTRY = re.compile(r'(?:^|(?<=[\s.]))([א-ת]{1,3})\.\s')         # "כג. ..." source entry
MARKER = re.compile(r'([א-ת]{1,3})[\'׳](?=[\s.,:;)\]]|$)')        # "קודם כג'" note marker in the text

# Rav Tzadok / Ishbitz-Radzin works as named in Hebrew -> reader titles
LIB_HE = {
    'צדקת הצדיק': 'Tzidkat HaTzadik', 'רסיסי לילה': 'Resisei Layla', 'דברי סופרים': 'Divrei Soferim', 'תקנת השבין': 'Takanat HaShavin',
    'מחשבות חרוץ': 'Machshavot Charutz', 'ישראל קדושים': 'Yisrael Kedoshim', 'פרי צדיק': 'Peri Tzadik', 'דובר צדק': 'Dover Tzedek',
    'קומץ המנחה': 'Kometz HaMinchah', 'פוקד עקרים': 'Poked Akarim', 'ספר הזכרונות': 'Sefer HaZikhronot', 'ליקוטי מאמרים': 'Likkutei Maamarim',
    'לקוטי מאמרים': 'Likkutei Maamarim', 'אור זרוע לצדיק': 'Ohr Zarua LaTzadik', 'שיחת מלאכי השרת': 'Sichat Malakhei HaSharet',
    'דברי חלומות': 'Divrei Chalomot', 'עת האוכל': 'Et HaOchel', 'מי השילוח': 'Mei HaShiloach', 'בית יעקב': 'Beit Yaakov on Torah',
    'משיב הטענה': "Meshiv HaTa'anah", 'סוד ישרים': 'Sod Yesharim', 'תפארת יוסף': 'Tiferet Yosef',
}
LIB_RE = re.compile(r'(?:ב|ו|וב|ע\' |עיין |וע\' |ועיין )?(' + '|'.join(sorted(map(re.escape, LIB_HE), key=len, reverse=True)) + r')(?![א-ת])([^()\n]{0,30})\(([^()]{1,60})\)')
INTERNAL_RE = re.compile(r'(לעיל|להלן|לקמן)\s*(?:ב?אות|סי(?:מן|\'))\s*([א-ת"\'׳״]{1,5})')
NUM_IN = re.compile(r'(?:אות|סי(?:מן|\')|סימן|פרק|פ\')\s*([א-ת"\'׳״]{1,5})')


def _plain(s):
    s = strip_nikkud(html.unescape(s))
    return s.replace('׳', "'").replace('״', '"')


def read_lines(path):
    if path.endswith('.docx'):
        x = zipfile.ZipFile(path).read('word/document.xml').decode('utf-8')
        lines = [re.sub(r'<[^>]+>', '', p) for p in re.findall(r'<w:p[ >].*?</w:p>', x, re.S)]
    else:
        lines = open(path, encoding='utf-8').read().split('\n')
    return [html.unescape(l) for l in lines]


def pages(lines):
    """[(page number, siman number or None, [lines])] using the running header 'צדקת אות X הצדיק'."""
    out, cur = [], None
    for l in lines:
        m = PAGE.match(l.strip())
        if m:
            cur = [int(m.group(1)), None, []]
            out.append(cur)
            continue
        if cur is None:
            continue
        if cur[1] is None and not cur[2]:
            h = HEADER_OT.search(_plain(l))
            if h:
                cur[1] = gematria_number(h.group(1))
                continue
        cur[2].append(l)
    return out


class LibraryResolver:
    """Hebrew work + locator -> reader section ref, from the catalog's Hebrew section titles."""

    def __init__(self, mcp_dir):
        cat = json.load(open(os.path.join(mcp_dir, 'catalog.json'), encoding='utf-8'))
        self.by_key = {}
        for b in cat['books']:
            for s in b['sections']:
                he = _plain(s.get('he') or '')
                nums = re.findall(r"([א-ת]{1,4})'?\s*$", he.replace('·', ' ').strip())
                parts = [p.strip() for p in re.split(r'[,·]', he) if p.strip()]
                n = gematria_number(nums[0]) if nums else None
                m = re.search(r'(\d+)$', s['ref'])
                if m:
                    n = int(m.group(1))
                if n is None:
                    continue
                middle = ' '.join(parts[1:-1]) if len(parts) > 2 else ''
                self.by_key[(b['title'], re.sub(r'\s+', ' ', middle), n)] = s['ref']
                self.by_key.setdefault((b['title'], '', n), s['ref'])

    def resolve(self, title, between, locator):
        loc = _plain(locator)
        m = NUM_IN.search(loc) or re.search(r'^\s*([א-ת"\']{1,5})\s*$', loc)
        if not m:
            return None
        n = gematria_number(m.group(1))
        if not n:
            return None
        ctx = _plain(between + ' ' + loc)
        parsha = re.search(r'(?:פרשת|פר\'|פ\')\s*([א-ת]+(?:\s[א-ת]+)?)', ctx)
        if parsha:
            for (t, mid, k), ref in self.by_key.items():
                if t == title and k == n and mid and parsha.group(1).split()[0] in mid:
                    return ref
        return self.by_key.get((title, '', n))


def ingest(path, mcp_dir):
    lines = read_lines(path)
    resolver = LibraryResolver(mcp_dir)
    records, stats = [], Counter()
    siman = None
    for page, ot, body in pages(lines):
        if ot:
            siman = ot
        if siman is None:
            continue
        part, text, biur, sources = 'text', [], [], []
        for l in body:
            p = _plain(l).strip()
            if LABEL_SOURCES.match(p):
                part = 'sources'
                continue
            if LABEL_BIUR.match(p):
                part = 'biur'
                continue
            {'text': text, 'biur': biur, 'sources': sources}[part].append(l)
        stats['pages'] += 1
        # Citations sit inline, in parentheses right after the words they support, in the explanation
        # and in the sources section alike; the ~8 words before each one are its anchor.
        for part_name, chunk in (('biur', biur), ('sources', sources)):
            plain = _plain(' '.join(chunk))
            for d in detect(plain):
                if not d.get('ref') or d.get('kind') == 'work':
                    continue
                anchor = ' '.join(plain[:d['span'][0]].split()[-8:] + plain[d['span'][1]:].split()[:6])
                records.append({'siman': siman, 'page': page, 'part': part_name, 'kind': 'source', 'ref': normalize_ref(d['ref']),
                                'anchorHe': anchor, 'confidence': d.get('confidence')})
                stats[part_name + 'Sources'] += 1
            for m in LIB_RE.finditer(plain):
                stats['libMentions'] += 1
                r = resolver.resolve(LIB_HE[m.group(1)], m.group(2), m.group(3))
                if r and not r.startswith(f'Tzidkat HaTzadik {siman}'):
                    anchor = ' '.join(plain[:m.start()].split()[-8:])
                    records.append({'siman': siman, 'page': page, 'part': part_name, 'kind': 'parallel', 'ref': r, 'anchorHe': anchor})
                    stats[part_name + 'Library'] += 1
            for m in INTERNAL_RE.finditer(plain):
                n = gematria_number(m.group(2))
                if n and n != siman:
                    records.append({'siman': siman, 'page': page, 'part': part_name, 'kind': 'parallel', 'ref': f'Tzidkat HaTzadik {n}',
                                    'anchorHe': ' '.join(plain[:m.start()].split()[-8:])})
                    stats[part_name + 'Internal'] += 1
    stats['simanim'] = len({r['siman'] for r in records})
    stats['records'] = len(records)
    return records, dict(stats)


def _base(ref):
    r = re.sub(r':\d+(?::\d+)?$', '', ref)
    return re.sub(r'(\d+)[ab]$', r'\1', r)


def compare_with_master(records, master_path):
    """Share of the elucidation's sources and cross-references the editorial master already has for that siman."""
    d = json.load(open(master_path, encoding='utf-8'))
    master = defaultdict(set)
    for c in d.get('connections', []):
        m = re.match(r'Tzidkat HaTzadik (\d+)', c.get('anchorRef', ''))
        r = c.get('canonicalRef') or c.get('displayRef')
        if m and r:
            master[int(m.group(1))].add(_base(normalize_ref(r)))
    out = Counter()
    for r in records:
        out[r['kind']] += 1
        out[r['kind'] + 'InMaster'] += _base(r['ref']) in master[r['siman']]
    return dict(out)


def anchor_to_master(records, mcp_dir, book_slug='tzidkat-hatzadik', book='Tzidkat HaTzadik'):
    """Replace each record's OCR anchor with the closest phrase of the reader's own edition of that siman,
    so that no text of the elucidated book is kept. Records with no phrase sharing 2+ words keep only the siman."""
    from .footnote_memory import he_words
    paras = json.load(open(os.path.join(mcp_dir, 'text', book_slug + '.json'), encoding='utf-8'))['paras']
    by_siman = defaultdict(list)
    for p in paras:
        m = re.match(re.escape(book) + r' (\d+):', p['r'])
        if m:
            for k, pair in enumerate(p.get('p') or []):
                by_siman[int(m.group(1))].append((p['r'], k, pair[0], set(he_words(pair[0]))))
    out, matched = [], 0
    for r in records:
        words = set(he_words(r.get('anchorHe', '')))
        best = max(by_siman.get(r['siman'], []), key=lambda x: len(words & x[3]), default=None)
        rec = {k: v for k, v in r.items() if k != 'anchorHe'}
        if best and len(words & best[3]) >= 2:
            rec.update({'para': best[0], 'phrase': best[1], 'anchorHe': best[2], 'overlap': len(words & best[3])})
            matched += 1
        else:
            rec.update({'para': f'{book} {r["siman"]}', 'phrase': None, 'anchorHe': ''})
        out.append(rec)
    return out, matched


def suggestions(training_json, master_path, title='Biur Meshulav'):
    """Per siman: sources and cross-references the elucidation cites that the editorial master lacks (markdown, records)."""
    d = json.load(open(training_json, encoding='utf-8'))
    m = json.load(open(master_path, encoding='utf-8'))
    master = defaultdict(set)
    for c in m.get('connections', []):
        mm = re.match(r'Tzidkat HaTzadik (\d+)', c.get('anchorRef', ''))
        r = c.get('canonicalRef') or c.get('displayRef')
        if mm and r:
            master[int(mm.group(1))].add(_base(normalize_ref(r)))
    new = defaultdict(dict)
    for r in d['records']:
        if _base(r['ref']) in master[r['siman']]:
            continue
        e = new[r['siman']].setdefault(r['ref'], {'ref': r['ref'], 'kind': r['kind'], 'mentions': 0, 'anchors': set()})
        e['mentions'] += 1
        if r.get('phrase') is not None:
            e['anchors'].add(f"{r['para']} phrase {r['phrase'] + 1}")
    tot, out, body = Counter(), [], []
    for s in sorted(new):
        body.append(f'## Siman {s}')
        for x in sorted(new[s].values(), key=lambda x: (x['kind'] != 'parallel', -x['mentions'], x['ref'])):
            tot[x['kind']] += 1
            anc = ', '.join(sorted(x['anchors'])[:2])
            body.append(f"- {'**parallel** ' if x['kind'] == 'parallel' else ''}{x['ref']}" + (f' — near {anc}' if anc else '')
                        + (f" ({x['mentions']}×)" if x['mentions'] > 1 else ''))
            out.append({'siman': s, **{k: (sorted(v) if isinstance(v, set) else v) for k, v in x.items()}})
        body.append('')
    head = [f'# Tzidkat HaTzadik — sources and cross-references in {title} not yet in the editorial master', '',
            f'Derived from an OCR of the elucidated edition ({d.get("origin")}). Refs only; review each before adding.',
            'Found automatically in the OCR: expect some wrong refs (misread numerals, daf without amud, verse past the end of a chapter).', '',
            f"{tot['source']} sources and {tot['parallel']} cross-references across {len(new)} simanim.", '']
    return '\n'.join(head + body), out

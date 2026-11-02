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
LIB_RE2 = re.compile(r'(' + '|'.join(sorted(map(re.escape, LIB_HE), key=len, reverse=True)) + r')(?![א-ת])([^()"\n:]{0,30}?)\s*((?:אות|סימן|מאמר|סי\'|ס\')\s*[א-ת"\'׳״]{1,5})')
INTERNAL_RE = re.compile(r'(לעיל|להלן|לקמן)\s*(?:ב?אות|סי(?:מן|\'))\s*([א-ת"\'׳״]{1,5})')
NUM_IN = re.compile(r'(?:אות|סי(?:מן|\')|סימן|מאמר|פרק|פ\')\s*([א-ת"\'׳״]{1,5})')


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
                if len(parts) == 2 and len(parts[1].split()) > 1:  # "פרי צדיק, לחג השבועות א"
                    middle = re.sub(r"\s*[א-ת]{1,4}'?\s*$", '', parts[1])
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
        words = {w for w in re.findall(r'[א-ת]{2,}', ctx) if w not in ('פרשת', 'אות', 'סימן', 'מאמר')}
        best, score = None, 0
        for (t, mid, k), ref in self.by_key.items():
            if t == title and k == n and mid:
                mw = set(re.findall(r'[א-ת]{2,}', mid))
                sc = len(words & mw) + sum(1 for w in words for x in mw if len(w) > 2 and (w in x or x in w)) * 0.5
                if sc > score:
                    best, score = ref, sc
        if best:
            return best
        if any(t == title and mid for (t, mid, k) in self.by_key) and words:
            return None  # a sefer arranged by parashah needs the parashah to resolve
        return self.by_key.get((title, '', n))


def lib_mentions(text):
    """(title, between, locator, span) for every cross-reference to Rav Tzadok's writings, with or without parentheses."""
    seen = set()
    for rx in (LIB_RE, LIB_RE2):
        for m in rx.finditer(text):
            if m.start(1) in seen:
                continue
            seen.add(m.start(1))
            yield LIB_HE[m.group(1)], m.group(2), m.group(3), m.span()


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
            for title, between, loc, span in lib_mentions(plain):
                stats['libMentions'] += 1
                r = resolver.resolve(title, between, loc)
                if r and not r.startswith(f'Tzidkat HaTzadik {siman}'):
                    anchor = ' '.join(plain[:span[0]].split()[-8:])
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


# ---------------------------------------------------------------------------------------------
# Peri Tzadik with sources and numbered notes (e.g. the Moadim volume: Chanukah, Tu BiShvat,
# Pesach Sheni, Lag BaOmer, Shavuot, Tu BeAv). Header: "<page> פרי <section> / <ois> צדיק".
PERI_SECTIONS = [  # header text (no nikkud) -> reader section prefix; longest first
    ('לזאת חנכה', 'Peri Tzadik, Chanukah'), ('זאת חנכה', 'Peri Tzadik, Chanukah'), ('לחנכה', 'Peri Tzadik, Chanukah'),
    ('דחנכה', 'Peri Tzadik, Chanukah'), ('חנכה', 'Peri Tzadik, Chanukah'), ('חנוכה', 'Peri Tzadik, Chanukah'),
    ('חג השבועות', 'Peri Tzadik, Shavuot'), ('חמשה עשר באב', 'Peri Tzadik, The Fifteenth of Av'),
    ('חמשה עשר בשבט', 'Peri Tzadik, Tu BiShvat'), ('ל"ג בעמר', 'Peri Tzadik, Lag BaOmer'), ('ל"ג בעומר', 'Peri Tzadik, Lag BaOmer'),
    ('פסח שני', 'Peri Tzadik, Pesach Sheni'), ('פרשת מקץ', 'Peri Tzadik, Miketz'), ('לראש חדש טבת', None),
]
PERI_HEADER = re.compile(r'פרי\s+(.+?)\s*(?:/\s*([א-ת"\'-]{1,9}))?\s*(?:צדיק)?\s*$')
NOTE_START = re.compile(r'^\s*([א-ת"]{1,4})\.\s')
NOTE_SPLIT = re.compile(r'(?:^|(?<=\s))([א-ת"]{1,4})\.\s')
TOKEN_NUM = re.compile(r'(?<![א-ת"\'])([א-ת]{1,4})(?=[,.:;]?(?:\s|$))')


def _units(p):
    """('phrase', [hebrew phrases]) for interlinear paragraphs, ('window', [8-word windows]) for Hebrew-only."""
    if p.get('p'):
        return 'phrase', [pair[0] for pair in p['p']]
    w = (p.get('t') or '').split()
    return 'window', [' '.join(w[i:i + 8]) for i in range(0, len(w), 8)]


def ingest_peri(path, mcp_dir):
    from .footnote_memory import he_words
    lines = read_lines(path)
    resolver = LibraryResolver(mcp_dir)
    paras = json.load(open(os.path.join(mcp_dir, 'text', 'peri-tzadik.json'), encoding='utf-8'))['paras']
    units = defaultdict(list)                       # section prefix -> [(para ref, unit, index, words)]
    for p in paras:
        kind, us = _units(p)
        for prefix in {v for _, v in PERI_SECTIONS if v}:
            if p['r'].startswith(prefix + ' '):
                for k, u in enumerate(us):
                    units[prefix].append((p['r'], kind, k, set(he_words(u))))
    records, stats = [], Counter()
    for page, _, body in pages_any(lines):
        if not body:
            continue
        head = _plain(body[0]).replace('״', '"')
        m = PERI_HEADER.search(head)
        if not m or 'משנת' in head or 'תוכן' in head:
            stats['pagesSkipped'] += 1
            continue
        section = next((v for k, v in PERI_SECTIONS if k in m.group(1)), 'unknown')
        if not section or section == 'unknown':
            stats['pagesNoReaderSection'] += 1
            continue
        stats['pages'] += 1
        text, notes, in_notes = [], [], False
        for l in body[1:]:
            pl = _plain(l)
            nums = [gematria_number(x) for x in NOTE_SPLIT.findall(pl)]
            nums = [x for x in nums if x]
            consecutive = sum(1 for a, b in zip(nums, nums[1:]) if b == a + 1)
            if not in_notes and (NOTE_START.match(pl) or consecutive >= 2):
                in_notes = True
            (notes if in_notes else text).append(l)
        tp, np_ = _plain(' '.join(text)), _plain(' '.join(notes))
        # numbered notes, accepting only consecutive numbers (so "שם." is not taken for a note)
        cuts, expect = [], None
        for nm in NOTE_SPLIT.finditer(np_):
            n = gematria_number(nm.group(1))
            if n and (expect is None or n == expect or n == expect + 1):
                cuts.append((nm.start(), n))
                expect = n
        note_text = {n: np_[s:(cuts[i + 1][0] if i + 1 < len(cuts) else len(np_))] for i, (s, n) in enumerate(cuts)}
        marker_anchor = {}
        for tm in TOKEN_NUM.finditer(tp):
            n = gematria_number(tm.group(1))
            if n in note_text and n not in marker_anchor and n > 10:
                marker_anchor[n] = ' '.join(tp[:tm.start()].split()[-8:])

        para_words = None

        def emit(kind, ref, anchor, part):
            nonlocal para_words
            if anchor is tp:  # page-level: best paragraph by shared words with the whole page
                if para_words is None:
                    pw = defaultdict(set)
                    for r_, _, _, w in units.get(section, []):
                        pw[r_] |= w
                    words = set(he_words(tp))
                    para_words = max(pw.items(), key=lambda x: len(words & x[1]), default=(None, set()))
                    para_words = para_words[0] if para_words[0] and len(words & para_words[1]) >= 8 else ''
                records.append({'section': section, 'page': page, 'part': part + '-page', 'kind': kind, 'ref': ref,
                                'para': para_words or None, 'unit': None, 'phrase': None})
                stats[part + ('PageAnchored' if para_words else 'Unanchored')] += 1
                return
            words = set(he_words(anchor))
            best = max(units.get(section, []), key=lambda x: len(words & x[3]), default=None)
            ok = best and len(words & best[3]) >= 3
            records.append({'section': section, 'page': page, 'part': part, 'kind': kind, 'ref': ref,
                            'para': best[0] if ok else None, 'unit': best[1] if ok else None, 'phrase': best[2] if ok else None})
            stats[part + ('Anchored' if ok else 'Unanchored')] += 1

        for d in detect(tp):
            if d.get('ref') and d.get('kind') != 'work-mention':
                emit('source', normalize_ref(d['ref']), ' '.join(tp[:d['span'][0]].split()[-8:]), 'text')
        for n, nt in note_text.items():
            anchor = marker_anchor.get(n, '')
            stats['notes'] += 1
            stats['notesWithMarker'] += bool(anchor)
            if not anchor:  # marker not found: anchor to the reader paragraph closest to the page's text
                anchor = tp
            for d in detect(nt):
                if d.get('ref') and d.get('kind') != 'work-mention':
                    emit('source', normalize_ref(d['ref']), anchor, 'note')
            for title, between, loc, span in lib_mentions(nt):
                stats['libMentions'] += 1
                r = resolver.resolve(title, between, loc)
                stats['libResolved'] += bool(r)
                if r:
                    emit('parallel', r, anchor, 'note')
    stats['records'] = len(records)
    return [r for r in records if r['para']], dict(stats)


def pages_any(lines):
    """[(page, None, [lines])] split on the OCR page markers only."""
    out, cur = [], None
    for l in lines:
        m = PAGE.match(l.strip())
        if m:
            cur = (int(m.group(1)), None, [])
            out.append(cur)
        elif cur is not None and l.strip():
            cur[2].append(l)
    return out

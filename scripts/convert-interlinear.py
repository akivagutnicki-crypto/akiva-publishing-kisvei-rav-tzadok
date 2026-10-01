#!/usr/bin/env python3
"""Convert Akiva Publishing interlinear Word files into library sources.

Usage: python3 scripts/convert-interlinear.py sources/akiva/docx/*.docx

Two kinds of file:
- A whole book (Word header names it, e.g. "Eis Haochel"): Heading 3 section
  titles, written to sources/akiva/<Title>.json.
- One part of a larger book (e.g. Dover Tzedek, Eruvin), recognized from its
  opening title line, with "Chapter N" lines between chapters. Written to
  sources/akiva/parts/<Book>__<Part>.json and laid over that part of the
  Sefaria text by scripts/build-library.mjs; untranslated parts stay Hebrew.

Within paragraphs, each vocalized Hebrew phrase is followed by its English in
one of three layouts: bold Hebrew then plain English, Hebrew then English in
parentheses, or "Hebrew — English". Citations are hyperlinks to Sefaria.
"""
import html
import json
import re
import sys
import urllib.parse
import zipfile
from pathlib import Path

# Header text in the .docx -> (library title, Hebrew title). The library title
# matches Sefaria's so connections line up.
BOOKS = {
    'eis haochel': ('Et HaOchel', 'עת האוכל'),
    'divrei chalomot': ('Divrei Chalomot', 'דברי חלומות'),
    'divrei sofrim': ('Divrei Soferim', 'דברי סופרים'),
    'sefer hazichronos': ('Sefer HaZikhronot', 'ספר הזכרונות'),
    'resisei layla': ('Resisei Layla', 'רסיסי לילה'),
    'takanas hashavin': ('Takanat HaShavin', 'תקנת השבין'),
}
# Print editions in volumes: "Siman N" (Heading 1) and "Se'if N" (Heading 3)
# sections with footnotes; volumes merge into one book.
VOLUME_BOOKS = {'Takanat HaShavin'}
BOOK_SECTIONS = {}  # title -> {section key: section}
# Books laid out as "Siman N - Title" / "Seif N - Title" lines, each followed by
# an italic summary; Siman and Seif match Sefaria's chapter and paragraph.
SIMAN_BOOKS = {'Resisei Layla'}
# Opening title of a part file -> (book, Sefaria node path within the book).
PARTS = [
    (r'Tractate Eruvin|\bEruvin\b', ('Dover Tzedek', 'Kuntres Dover Tzedek, Eruvin')),
    (r'Tractate Berakhot|\bBerakhot\b', ('Dover Tzedek', 'Kuntres Dover Tzedek, Berakhot')),
    (r'Ner HaMitzvo[st]', ('Dover Tzedek', 'Kuntres Ner HaMitzvot')),
    (r'Mishlei Commentary', ('Dover Tzedek', 'Mishlei Commentary')),
    (r'Miscellany', ('Dover Tzedek', 'Miscellany')),
    (r'Mach?sh?avo[st][ _]Charutz|מחשבות חרוץ', ('Machshavot Charutz', '')),
]
# Parts whose unnumbered paragraphs are placed by matching their opening words
# against the Sefaria Hebrew in sources/sefaria.
ALIGN = {'Machshavot Charutz'}
OUT = Path('sources/akiva')

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def rels_of(z):
    xml = z.read('word/_rels/document.xml.rels').decode('utf-8')
    return dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', xml))


def runs_of(p, rels):
    """Yield (text, bold, italic, link) for each text run in a paragraph."""
    for m in re.finditer(r'<w:hyperlink[^>]*r:id="(rId\d+)"[^>]*>(.*?)</w:hyperlink>|<w:r[ >](.*?)</w:r>', p, re.S):
        link = html.unescape(rels.get(m.group(1), '')) if m.group(1) else None
        inner = re.findall(r'<w:r[ >](.*?)</w:r>', m.group(2), re.S) if m.group(1) else [m.group(3)]
        for r in inner:
            t = html.unescape(''.join(re.findall(r'<w:t(?: [^>]*)?>(.*?)</w:t>', r, re.S)))
            fn = re.search(r'<w:footnoteReference [^>]*w:id="(\d+)"', r)
            if fn:
                t += f'\ue000{fn.group(1)}\ue001'  # replaced by the note in finish()
            t = re.sub('[\u200e\u200f\u202a-\u202e]', '', t)  # directional marks
            if not t:
                continue
            bold = bool(re.search(r'<w:b(?: w:val="(?:1|true)")?/>', r))
            ital = bool(re.search(r'<w:i(?: w:val="(?:1|true)")?/>', r))
            yield t, bold, ital, link


def sefaria_ref(url):
    """https://www.sefaria.org/Berakhot%2053b?lang=bi -> 'Berakhot 53b'."""
    u = urllib.parse.urlparse(url)
    if 'sefaria.org' not in u.netloc or not u.path.strip('/'):
        return None
    return urllib.parse.unquote(u.path.strip('/')).replace('_', ' ')


def to_html(parts):
    """Runs -> HTML; italics kept, consecutive runs with one link joined into one anchor."""
    out, i = [], 0
    while i < len(parts):
        link = parts[i][3]
        j = i
        while j < len(parts) and parts[j][3] == link:
            j += 1
        body = ''.join(f'<i>{html.escape(t, quote=False)}</i>' if ital else html.escape(t, quote=False)
                       for t, _, ital, _ in parts[i:j]).replace('</i><i>', '')
        ref = sefaria_ref(link) if link else None
        out.append(f'<a data-ref="{html.escape(ref)}">{body}</a>' if ref else body)
        i = j
    return ''.join(out)


def pairs_of(runs):
    """Group runs into [hebrew_html, english_html] phrase pairs.

    Two layouts occur: bold Hebrew followed by plain English (" – ..."), or
    plain Hebrew followed by the English in parentheses.
    """
    if any(r[1] for r in runs) and any(not r[1] and LAT.search(r[0]) for r in runs):
        return bold_pairs(runs)
    text = ''.join(r[0] for r in runs)
    parens = len(re.findall(r'[\u05D0-\u05EA][^A-Za-z\u05D0-\u05EA]{0,4}\(\s*["\u201c\'\[]*[A-Za-z]', text))
    dashes = len(re.findall(r'[\u05D0-\u05EA][^A-Za-z\u05D0-\u05EA]{0,6}\s[\u2014\u2013-]\s', text))
    return dash_pairs(runs) if dashes > parens else paren_pairs(runs)


FOOTNOTES = {}  # footnote id -> (number shown, html) for the file being converted


def footnotes_of(z):
    """Read word/footnotes.xml; number notes in order of their references."""
    FOOTNOTES.clear()
    if 'word/footnotes.xml' not in z.namelist():
        return
    xml = z.read('word/footnotes.xml').decode('utf-8')
    order = re.findall(r'<w:footnoteReference [^>]*w:id="(\d+)"', z.read('word/document.xml').decode('utf-8'))
    number = {fid: k + 1 for k, fid in enumerate(order)}
    for fid, body in re.findall(r'<w:footnote [^>]*w:id="(\d+)"[^>]*>(.*?)</w:footnote>', xml, re.S):
        parts = []
        for r in re.findall(r'<w:r[ >](.*?)</w:r>', body, re.S):
            t = html.unescape(''.join(re.findall(r'<w:t(?: [^>]*)?>(.*?)</w:t>', r, re.S)))
            t = re.sub('[\u200e\u200f\u202a-\u202e]', '', t)
            if t:
                ital = bool(re.search(r'<w:i(?: w:val="(?:1|true)")?/>', r))
                parts.append(f'<i>{html.escape(t, quote=False)}</i>' if ital else html.escape(t, quote=False))
        FOOTNOTES[fid] = (number.get(fid, fid), ''.join(parts).replace('</i><i>', '').strip())


def notes_html(s):
    def sub(m):
        num, body = FOOTNOTES.get(m.group(1), (m.group(1), ''))
        return f'<sup class="footnote-marker">{num}</sup><i class="footnote">{body}</i>'
    return re.sub('\ue000(\\d+)\ue001', sub, s)


def finish(pairs):
    result = []
    for he, en in pairs:
        h = to_html(he).strip()
        h = re.sub(r'\s*[–—-]\s*$', '', h)
        e = re.sub(r'^\s*[–—-]\s*', '', to_html(en)).strip()
        h = h.replace('**', '')
        e = re.sub(r'\*([^*\n]+)\*', r'<i>\1</i>', e.replace('**', ''))
        h, e = notes_html(h), notes_html(e)
        if h or e:
            result.append([h, e])
    return result


def bold_pairs(runs):
    pairs, he, en = [], [], []
    for r in runs:
        if r[1]:  # bold = Hebrew
            if en:
                pairs.append([he, en]); he, en = [], []
            he.append(r)
        else:
            en.append(r)
    if he or en:
        pairs.append([he, en])
    return finish(pairs)


HEB = re.compile(r'[\u05D0-\u05EA]')
LAT = re.compile(r'[A-Za-z]')


def paren_pairs(runs):
    # Work character by character so links and italics survive the split.
    chars = [(c, b, i, l) for t, b, i, l in runs for c in t]
    text = ''.join(c[0] for c in chars)
    pairs, he_start, k = [], 0, 0
    while k < len(text):
        if text[k] == '(':
            m = re.search(r'[A-Za-z\u05D0-\u05EA]', text[k + 1:])
            if m and LAT.match(m.group(0)):
                depth, j = 0, k
                while j < len(text):
                    depth += {'(': 1, ')': -1}.get(text[j], 0)
                    if depth == 0:
                        break
                    j += 1
                he = chars[he_start:k]
                en = chars[k + 1:j]
                pairs.append([group(he), group(en)])
                k = he_start = j + 1
                continue
        k += 1
    if he_start < len(text):
        pairs.append([group(chars[he_start:]), []])
    return finish(pairs)


def dash_pairs(runs):
    """'Hebrew — English; Hebrew — English': split wherever the script changes.

    Punctuation between the two scripts is divided at the last space: what
    precedes it closes the previous phrase, what follows opens the next.
    """
    chars = [(c, b, i, l) for t, b, i, l in runs for c in t]
    pairs, he, en = [], [], []
    cur, cur_is_he, pending = he, True, []
    for ch in chars:
        c = ch[0]
        script = 'he' if HEB.match(c) else 'la' if LAT.match(c) else None
        if script is None:
            pending.append(ch)
            continue
        is_he = script == 'he'
        if is_he != cur_is_he:
            cut = max((k for k, p in enumerate(pending) if p[0].isspace()), default=-1)
            cur.extend(pending[:cut + 1])
            pending = pending[cut + 1:]
            if is_he:  # English finished: close the pair
                pairs.append([group(he), group(en)])
                he, en = [], []
                cur = he
            else:
                cur = en
            cur_is_he = is_he
        cur.extend(pending); pending = []
        cur.append(ch)
    cur.extend(pending)
    if he or en:
        pairs.append([group(he), group(en)])
    return finish(pairs)


def group(chars):
    """Characters back into runs of equal formatting."""
    out = []
    for c, b, i, l in chars:
        if out and out[-1][1:] == (b, i, l):
            out[-1] = (out[-1][0] + c, b, i, l)
        else:
            out.append((c, b, i, l))
    return out


def convert(path):
    z = zipfile.ZipFile(path)
    header = ' '.join(html.unescape(re.sub(r'<[^>]+>', '', z.read(n).decode('utf-8')))
                      for n in z.namelist() if n.startswith('word/header'))
    key = next((k for k in BOOKS if k in header.lower()), None)
    if not key:
        return convert_part(path, z)
    title, he_title = BOOKS[key]
    if title in SIMAN_BOOKS:
        return convert_simanim(path, z, title, he_title)
    if title in VOLUME_BOOKS:
        return convert_volume(path, z, title, he_title)
    rels = rels_of(z)
    doc = z.read('word/document.xml').decode('utf-8')

    sections, cur, seq = [], None, 0
    for pm in re.finditer(r'<w:p[ >].*?</w:p>', doc, re.S):
        p = pm.group(0)
        runs = list(runs_of(p, rels))
        text = ''.join(r[0] for r in runs).strip()
        if not text:
            continue
        if re.search(r'<w:pStyle w:val="Heading\d"/>', p):
            m = re.search(r'\((?:Section|Chapter)\s+(\d+)\)', text)
            he_name = re.sub(r'\s*\([^)]*\)\s*$', '', text)
            en_name = (re.search(r'\(([^)]*)\)\s*$', text) or [None, ''])[1]
            plain = re.sub(r'[\u0591-\u05C7]', '', text)
            if re.match(r'^\[(המשך|סיום|סוף)', plain) and cur:
                cur['items'].append({'h': text})
                continue
            if m:
                cur = {'n': int(m.group(1)), 'he': he_name, 'en': en_name}
            elif re.search(r'Opening|Introduction', en_name):
                cur = {'key': 'Introduction', 'he': he_name, 'en': 'Introduction'}
            elif re.search(r'Epilogue|Conclu', en_name):
                cur = {'key': 'Epilogue', 'he': he_name, 'en': 'Epilogue'}
            else:  # descriptive heading: number sequentially
                seq += 1
                cur = {'n': None, 'he': text, 'en': ''}
            cur['items'] = []
            sections.append(cur)
            continue
        if cur is None:
            cur = {'key': 'Introduction', 'he': '', 'en': 'Introduction', 'items': []}
            sections.append(cur)
        cur['items'].append({'p': pairs_of(runs)})

    # Number descriptive sections after any explicitly numbered ones.
    n = max([s['n'] for s in sections if s.get('n')] or [0])
    for s in sections:
        if 'key' not in s and not s.get('n'):
            n += 1
            s['n'] = n
    for s in sections:
        if 'key' not in s and not s['en']:
            s['en'] = f'Section {s["n"]}'

    out = {
        'title': title, 'heTitle': he_title, 'language': 'he',
        'versionTitle': 'Akiva Publishing interlinear edition',
        'versionSource': '', 'license': '© Akiva Publishing',
        'categories': ['Chasidut', "R' Tzadok HaKohen"],
        'akiva': True, 'interlinear': True, 'sections': sections,
    }
    dest = OUT / (re.sub(r'[^A-Za-z0-9]+', '_', title).strip('_') + '.json')
    dest.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    paras = sum(1 for s in sections for i in s['items'] if 'p' in i)
    phrases = sum(len(i['p']) for s in sections for i in s['items'] if 'p' in i)
    print(f'{title}: {len(sections)} sections, {paras} paragraphs, {phrases} phrase pairs -> {dest}')


NIQQUD = re.compile(r'[֑-ׇ]')
GEM = dict(zip('אבגדהוזחטיכלמנסעפצקרשת', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400]))
GEM.update({'ך': 20, 'ם': 40, 'ן': 50, 'ף': 80, 'ץ': 90})


def gematria(word):
    return sum(GEM.get(c, 0) for c in NIQQUD.sub('', word))


def plain_he(text):
    """Hebrew letters only, for matching against the Sefaria text. Vav and yod
    are dropped because vocalized and plain spellings differ (עקר / עיקר)."""
    words = re.findall(r'[א-ת]+', NIQQUD.sub('', re.sub(r'<[^>]+>', '', text)))
    return ' '.join(w for w in (re.sub('[וי]', '', w) for w in words) if w)


def sefaria_index(book):
    """[(chapter, paragraph, plain text)] from the bundled Sefaria export, if any."""
    f = Path('sources/sefaria') / (re.sub(r'[^A-Za-z0-9]+', '_', book).strip('_') + '.json')
    if not f.exists():
        return []
    text = json.loads(f.read_text(encoding='utf-8'))['text']
    return [(c + 1, k + 1, plain_he(seg)) for c, chap in enumerate(text) if isinstance(chap, list)
            for k, seg in enumerate(chap) if isinstance(seg, str)]


def locate(index, hebrew):
    """Chapter and paragraph of the Sefaria segment that starts like this Hebrew."""
    words = plain_he(hebrew).split()
    for n in (6, 5, 4):
        key = ' '.join(words[:n])
        if len(key) < 8:
            continue
        hits = [(c, k) for c, k, t in index if t.startswith(key) or t[:200].find(key) >= 0]
        if len(hits) == 1:
            return hits[0]
    return None


def heb_num(n):
    ones, tens, hundreds = ' אבגדהוזחט', ' יכלמנסעפצ', ' קרשת'
    out = hundreds[n // 100] if n >= 100 else ''
    r = n % 100
    out += 'טו' if r == 15 else 'טז' if r == 16 else (tens[r // 10] if r >= 10 else '') + (ones[r % 10] if r % 10 else '')
    out = out.replace(' ', '')
    return out[:-1] + '״' + out[-1] if len(out) > 1 else out + '׳'


def convert_simanim(path, z, title, he_title):
    rels = rels_of(z)
    doc = z.read('word/document.xml').decode('utf-8')
    paras = [list(runs_of(pm.group(0), rels)) for pm in re.finditer(r'<w:p[ >].*?</w:p>', doc, re.S)]
    paras = [p for p in paras if ''.join(r[0] for r in p).strip()]
    texts = [''.join(r[0] for r in p).strip() for p in paras]
    # The body starts at the second "Siman 1" (the first is the table of contents).
    starts = [k for k, t in enumerate(texts) if re.match(r'^Siman 1 - ', t)]
    begin = starts[1] if len(starts) > 1 else starts[0]
    sections, sec, current, last_title = [], None, None, None
    for runs, text in zip(paras[begin:], texts[begin:]):
        m = re.match(r'^Siman (\d+) - (.*)$', text)
        if m:
            sec = {'n': int(m.group(1)), 'he': f'סימן {heb_num(int(m.group(1)))}', 'en': m.group(2).strip(), 'items': []}
            sections.append(sec); current = None; last_title = 'siman'
            continue
        m = re.match(r'^Seif (\d+) - (.*)$', text)
        if m:
            sec['items'].append({'h': f'Seif {m.group(1)} — {m.group(2).strip()}'})
            current = {'p': [], 'n': int(m.group(1))}; last_title = 'seif'
            continue
        if not HEB.search(text) and all(r[2] for r in runs if r[0].strip()):  # italic summary
            if last_title == 'seif':
                sec['items'][-1]['h'] += '\n' + text
            elif last_title == 'siman':
                sec['items'].append({'h': '\n' + text})  # summary only, no title line
            last_title = None
            continue
        if current is None:  # text before any Seif title
            current = {'p': [], 'n': 1}
        if not current['p']:
            sec['items'].append(current)
        current['p'] += pairs_of(runs)
    out = {
        'title': title, 'heTitle': he_title, 'language': 'he',
        'versionTitle': 'Akiva Publishing interlinear edition', 'versionSource': '',
        'license': '© Akiva Publishing', 'categories': ['Chasidut', "R' Tzadok HaKohen"],
        'akiva': True, 'interlinear': True, 'sections': sections,
    }
    dest = OUT / (re.sub(r'[^A-Za-z0-9]+', '_', title).strip('_') + '.json')
    dest.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    paras_n = sum(1 for s_ in sections for i in s_['items'] if 'p' in i)
    phrases = sum(len(i['p']) for s_ in sections for i in s_['items'] if 'p' in i)
    print(f'{title}: {len(sections)} simanim, {paras_n} seifim, {phrases} phrase pairs -> {dest}')


def convert_volume(path, z, title, he_title):
    rels = rels_of(z)
    footnotes_of(z)
    doc = z.read('word/document.xml').decode('utf-8')
    secs = BOOK_SECTIONS.setdefault(title, {})
    sec = current = None
    header = False  # inside the title block that follows a Siman heading
    for pm in re.finditer(r'<w:p[ >].*?</w:p>', doc, re.S):
        p = pm.group(0)
        runs = list(runs_of(p, rels))
        text = re.sub('\ue000\\d+\ue001', '', ''.join(r[0] for r in runs)).strip()
        if not text:
            continue
        style = (re.search(r'<w:pStyle w:val="([^"]+)"', p) or [None, ''])[1]
        if style == 'Heading1':
            m = re.match(r'Siman (\d+)', text)
            key = int(m.group(1)) if m else 'Introduction'
            sec = {'n': key, 'he': '', 'en': '', 'items': []} if m else {'key': key, 'he': '', 'en': 'Introduction', 'items': []}
            secs[key] = sec
            current, header = None, True
            continue
        if sec is not None and (re.search(r'Table of Contents|Detailed Contents', text)
                                or NIQQUD.sub('', text).startswith('תכן הענינים')):
            sec = current = None  # back matter: contents pages after the last Siman
            continue
        if sec is None or text.startswith('§'):
            continue  # front matter, contents, and the closing summary index
        if style == 'Heading3':
            m = re.search(r'Se.if (\d+)', text)
            current = {'p': [], 'n': int(m.group(1))} if m else None
            header = False
            continue
        if header and style not in ('BodyText', 'FirstParagraph'):
            if HEB.search(text) and not LAT.search(text) and not sec['he']:
                sec['he'] = text  # "סִימָן א"
            elif not HEB.search(text) and not sec['en'] and 'n' in sec:
                sec['en'] = text  # English title
            elif HEB.search(text):
                sec['items'].append({'h': text})  # Hebrew subject line
            continue
        if style == 'FirstParagraph' or re.match(r'^(The )?theme:', text, re.I):
            sec['items'].append({'h': '\n' + text})  # summary
            continue
        if len(text) < 120 and not LAT.search(text) and re.search(r'סעיף|סעיפים', NIQQUD.sub('', text)):
            sec['items'].append({'h': re.sub(r'^תַּקָּנַת הַשָּׁבִין — ', '', text)})  # "סִימָן ט״ו: סְעִיפִים ד׳–ז׳"
            continue
        if text in (he_title, 'תַּקָּנַת הַשָּׁבִין', 'Takanas HaShavin'):
            continue  # running title before each Siman
        if current is None:
            current = {'p': [], 'n': 1}
        if not current['p']:
            sec['items'].append(current)
        current['p'] += dash_pairs(runs)
        header = False
    n_p = sum(1 for s_ in secs.values() for i in s_['items'] if 'p' in i)
    print(f'{path}: {title}, {len(secs)} sections so far, {n_p} paragraphs, {len(FOOTNOTES)} footnotes')


def write_books():
    for title, secs in BOOK_SECTIONS.items():
        he_title = next(h for t, h in BOOKS.values() if t == title)
        order = sorted(secs.values(), key=lambda s_: (0, 0) if 'key' in s_ else (1, s_['n']))
        for s_ in order:
            if 'n' in s_ and not s_['en']:
                s_['en'] = f'Siman {s_["n"]}'
        out = {
            'title': title, 'heTitle': he_title, 'language': 'he',
            'versionTitle': 'Akiva Publishing interlinear edition', 'versionSource': '',
            'license': '© Akiva Publishing', 'categories': ['Chasidut', "R' Tzadok HaKohen"],
            'akiva': True, 'interlinear': True, 'sections': order,
        }
        dest = OUT / (re.sub(r'[^A-Za-z0-9]+', '_', title).strip('_') + '.json')
        dest.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
        pairs = [pr for s_ in order for i in s_['items'] if 'p' in i for pr in i['p']]
        notes = sum(len(re.findall('footnote-marker', a + b)) for a, b in pairs)
        print(f'{title}: {len(order)} sections, {len(pairs)} phrase pairs, {notes} footnotes -> {dest}')


PART_DATA = {}  # (book, node) -> merged chapters from every file of that part


def convert_part(path, z):
    rels = rels_of(z)
    doc = z.read('word/document.xml').decode('utf-8')
    paras = []
    for pm in re.finditer(r'<w:p[ >].*?</w:p>', doc, re.S):
        runs = list(runs_of(pm.group(0), rels))
        if re.search(r'[A-Za-zא-ת]', ''.join(r[0] for r in runs)):
            paras.append((bool(re.search(r'<w:pStyle w:val="Heading\d"/>', pm.group(0))), runs))
    first = ''.join(r[0] for r in paras[0][1])
    part = (next((v for pat, v in PARTS if re.search(pat, Path(path).name)), None)
            or next((v for pat, v in PARTS if re.search(pat, first)), None))
    if not part:
        sys.exit(f'{path}: cannot tell which book this is (first line: {first[:80]})')
    chapters = PART_DATA.setdefault(part, {})
    index = sefaria_index(part[0]) if part[0] in ALIGN else []
    ch, n, fresh, current, marked = 1, 0, True, None, False

    def start(c, k):  # the next text paragraph opens paragraph k+1 of chapter c
        nonlocal ch, n, fresh, marked
        ch, n, fresh, marked = c, k, True, True

    for k, (is_heading, runs) in enumerate(paras):
        text = ''.join(r[0] for r in runs).strip()
        plain = NIQQUD.sub('', text)
        short = len(text) < 200
        # "Dover Tzedek, Miscellany 4, Section 41"
        m = short and re.search(r'(?:Miscellany|Chapter),? (\d+), Section (\d+)\s*$', text)
        if m:
            start(int(m.group(1)), int(m.group(2)) - 1); continue
        # "מחשבות חרוץ — פרק ז׳, סעיפים ב׳–ד׳" or "— אות ג׳, פסקא ג׳"
        if (is_heading or short) and plain.startswith('מחשבות חרוץ'):
            m = re.search(r'פרק ([א-ת"\'׳״]+)', plain) or re.search(r'אות ([א-ת"\'׳״]+)', plain)
            m2 = re.search(r'(?:סעיפים|סעיף|אותיות|פסקא)\s+([א-ת"\'׳״]+)', plain[m.end():] if m else plain)
            if m:
                start(gematria(m.group(1)), gematria(m2.group(1)) - 1 if m2 else 0)
            continue
        # "פסקא ג (סעיף 3) — Paragraph 3 (Se'if 3)", "(Chapter 9, Paragraph 17)", "Segment 2"
        if re.match(r'^(פסקא|סגמנט)\s', plain):
            m = re.search(r'\(Chapter (\d+), Paragraph (\d+)\)', text)
            if m:
                start(int(m.group(1)), int(m.group(2)) - 1)
            elif not re.search(r'Segment \d', text):
                m = re.search(r'(?:Paragraph|Section) (\d+)', text)
                if m:
                    start(ch, int(m.group(1)) - 1)
            rest = re.split(r'\)\s*(?=The theme|Theme)', text, maxsplit=1)
            if len(rest) == 2:
                chapters.setdefault(ch, []).append({'h': rest[1].strip()})
            continue
        m = short and re.search(r'\bChapter (\d+)\b', text)
        if m:  # "Miscellany, Chapter 3 - Avodah Zara", "... Berakhot, Chapter 2:"
            start(int(m.group(1)), 0); continue
        if k == 0 and short:  # opening title line, e.g. "Eruvin — Tractate Eruvin:"
            continue
        items = chapters.setdefault(ch, [])
        if short and all(r[1] for r in runs if r[0].strip() and HEB.search(r[0])) and any(r[1] for r in runs):
            items.append({'h': re.sub(r'([א-ת׳״])([A-Z])', r'\1 — \2', text).rstrip(':')})
            continue
        if not HEB.search(text) and re.match(r'^(The )?theme:', text, re.I):
            items.append({'h': text}); continue
        if short and not HEB.search(text) and items and 'h' in items[-1]:
            items[-1]['h'] += ' — ' + text  # English line under a Hebrew heading (colophon)
            continue
        pairs = pairs_of(runs)
        # Before the first chapter/paragraph marker, place paragraphs by their opening words.
        if index and not marked:
            hit = locate(index, ' '.join(p[0] for p in pairs[:2]))
            if hit and (current is None or hit != (ch, current['n'])):
                ch, n, fresh = hit[0], hit[1] - 1, True
                items = chapters.setdefault(ch, [])
        if fresh or not index and not current:
            n += 1
            current = {'p': pairs, 'n': n}
            items.append(current)
            fresh = not index  # without markers every paragraph is its own; with them, merge until the next
        else:
            current['p'] = current['p'] + pairs
    print(f'{path}: {part[0]} / {part[1] or "(whole book)"}')


def write_parts():
    for (book, node), chapters in PART_DATA.items():
        for ch, items in chapters.items():
            # Parts may arrive in any file order; numbered paragraphs sort into place.
            seen = {}
            for i in items:
                if 'p' in i:
                    seen[i['n']] = i  # a later file replaces a repeated paragraph
            items[:] = [i for i in items if 'p' not in i or seen[i['n']] is i]
            if all('n' in i for i in items if 'p' in i):
                order = {id(i): (i.get('n', 0), k) for k, i in enumerate(items)}
                last = 0
                for i in items:  # headings sort just before the next paragraph
                    if 'n' in i: last = i['n']
                    order[id(i)] = (last + (0 if 'n' in i else 0.5), order[id(i)][1])
                items.sort(key=lambda i: order[id(i)])
        out = {'book': book, 'node': node, 'versionTitle': 'Akiva Publishing interlinear edition',
               'license': '© Akiva Publishing', 'chapters': {str(k): v for k, v in sorted(chapters.items())}}
        dest = OUT / 'parts' / (re.sub(r'[^A-Za-z0-9]+', '_', f'{book}__{node}').strip('_') + '.json')
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
        n_p = sum(1 for c in chapters.values() for i in c if 'p' in i)
        n_ph = sum(len(i['p']) for c in chapters.values() for i in c if 'p' in i)
        print(f'{book} / {node}: chapters {sorted(chapters)}, {n_p} paragraphs, {n_ph} phrase pairs -> {dest}')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for f in sys.argv[1:]:
        convert(f)
    write_parts()
    write_books()

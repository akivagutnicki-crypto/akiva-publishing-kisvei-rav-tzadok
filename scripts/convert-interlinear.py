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
}
# Opening title of a part file -> (book, Sefaria node path within the book).
PARTS = [
    (r'Tractate Eruvin|\bEruvin\b', ('Dover Tzedek', 'Kuntres Dover Tzedek, Eruvin')),
    (r'Tractate Berakhot|\bBerakhot\b', ('Dover Tzedek', 'Kuntres Dover Tzedek, Berakhot')),
    (r'Ner HaMitzvo[st]', ('Dover Tzedek', 'Kuntres Ner HaMitzvot')),
    (r'Mishlei Commentary', ('Dover Tzedek', 'Mishlei Commentary')),
    (r'Miscellany', ('Dover Tzedek', 'Miscellany')),
]
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


def finish(pairs):
    result = []
    for he, en in pairs:
        h = to_html(he).strip()
        h = re.sub(r'\s*[–—-]\s*$', '', h)
        e = re.sub(r'^\s*[–—-]\s*', '', to_html(en)).strip()
        e = re.sub(r'\*([^*\n]+)\*', r'<i>\1</i>', e)
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


PART_DATA = {}  # (book, node) -> merged chapters from every file of that part


def convert_part(path, z):
    rels = rels_of(z)
    doc = z.read('word/document.xml').decode('utf-8')
    paras = [list(runs_of(pm.group(0), rels)) for pm in re.finditer(r'<w:p[ >].*?</w:p>', doc, re.S)]
    paras = [p for p in paras if re.search(r'[A-Za-z\u05D0-\u05EA]', ''.join(r[0] for r in p))]
    first = ''.join(r[0] for r in paras[0])
    part = next((v for pat, v in PARTS if re.search(pat, first)), None)
    if not part:
        sys.exit(f'{path}: cannot tell which book this is (first line: {first[:80]})')
    chapters = PART_DATA.setdefault(part, {})
    ch, n = 1, 0
    for k, runs in enumerate(paras):
        text = ''.join(r[0] for r in runs).strip()
        short = len(text) < 200
        # "Dover Tzedek, Miscellany 4, Section 41": chapter and paragraph number
        m = short and re.search(r'(?:Miscellany|Chapter),? (\d+), Section (\d+)\s*$', text)
        if m:
            ch, n = int(m.group(1)), int(m.group(2)) - 1
            continue
        m = short and re.search(r'\bChapter (\d+)\b', text)
        if m:  # "Miscellany, Chapter 3 - Avodah Zara", "... Berakhot, Chapter 2:"
            ch, n = int(m.group(1)), 0
            continue
        if k == 0 and short:  # opening title line, e.g. "Eruvin — Tractate Eruvin:"
            continue
        items = chapters.setdefault(ch, [])
        if short and all(r[1] for r in runs if r[0].strip() and HEB.search(r[0])) and any(r[1] for r in runs):
            items.append({'h': re.sub(r'([\u05D0-\u05EA\u05F3\u05F4])([A-Z])', r'\1 — \2', text).rstrip(':')})
            continue
        n += 1
        items.append({'p': pairs_of(runs), 'n': n})
    print(f'{path}: {part[0]} / {part[1]}')


def write_parts():
    for (book, node), chapters in PART_DATA.items():
        for ch, items in chapters.items():
            # Parts may arrive in any file order; numbered paragraphs sort into place.
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

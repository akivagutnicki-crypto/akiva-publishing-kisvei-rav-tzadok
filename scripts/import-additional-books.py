#!/usr/bin/env python3
"""Import the supplied Poked Akarim, Ohr Zarua, and Sefer HaZichronot Mitzvot.

Run from the repository root. Original paragraph markers are navigation metadata;
all body text, vocalization, hyperlinks, and the Mitzvot table are retained.
The Mitzvot portion is appended to, rather than replacing, Sefer HaZikhronot.
"""
import importlib.util
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

spec = importlib.util.spec_from_file_location('interlinear', Path(__file__).with_name('convert-interlinear.py'))
il = importlib.util.module_from_spec(spec)
spec.loader.exec_module(il)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
DOCS = Path('sources/akiva/docx')
OUT = Path('sources/akiva')


def bare(text):
    return re.sub(r'[\u0591-\u05C7]', '', text)


def on(element, tag):
    e = element.find(W + 'rPr/' + W + tag)
    return e is not None and e.get(W + 'val', '1') not in ('0', 'false', 'off')


def runs_of(p, rels):
    out = []
    for child in p:
        link = rels.get(child.get(R + 'id')) if child.tag == W + 'hyperlink' else None
        runs = [child] if child.tag == W + 'r' else child.iter(W + 'r')
        for r in runs:
            text = ''.join(t.text or '' for t in r.iter(W + 't'))
            text = re.sub(r'[\u200e\u200f\u202a-\u202e]', '', text)
            if text:
                flags = (on(r, 'b'), on(r, 'i'), link)
                if out and out[-1][1:] == flags:
                    out[-1] = (out[-1][0] + text, *flags)
                else:
                    out.append((text, *flags))
    return out


def read_doc(name):
    with zipfile.ZipFile(DOCS / name) as z:
        rels = {e.get('Id'): e.get('Target') for e in ET.fromstring(z.read('word/_rels/document.xml.rels'))}
        body = ET.fromstring(z.read('word/document.xml')).find(W + 'body')
        blocks = []
        for child in body:
            if child.tag == W + 'tbl':
                rows = []
                for row in child.findall(W + 'tr'):
                    rows.append([' '.join(''.join(t.text or '' for t in p.iter(W + 't'))
                                          for p in cell.findall(W + 'p')).strip()
                                 for cell in row.findall(W + 'tc')])
                blocks.append({'table': {'headers': rows[0], 'rows': rows[1:]}})
            else:
                for p in ([child] if child.tag == W + 'p' else child.iter(W + 'p')):
                    runs = runs_of(p, rels)
                    text = ''.join(r[0] for r in runs).strip()
                    if text:
                        style = p.find(W + 'pPr/' + W + 'pStyle')
                        blocks.append({'text': text, 'runs': runs, 'style': style.get(W + 'val') if style is not None else ''})
        return blocks


def slice_runs(runs, start):
    out, offset = [], 0
    for text, *flags in runs:
        end = offset + len(text)
        if end > start:
            out.append((text[max(0, start - offset):], *flags))
        offset = end
    return out


def without_marker(runs):
    text = ''.join(r[0] for r in runs)
    # Some numbered labels share a Word paragraph with their body text.
    if bare(text).startswith(('פסקה ', 'פסקא ')):
        m = re.match(r'^.*?\(Paragraph \d+\)\s*', text)
        if m:
            return slice_runs(runs, m.end()), True
    return runs, False


def source(title, he, sections):
    return {'title': title, 'heTitle': he, 'language': 'he',
            'versionTitle': 'Akiva Publishing interlinear edition', 'versionSource': '',
            'license': '© Akiva Publishing', 'categories': ['Chasidut', "R' Tzadok HaKohen"],
            'akiva': True, 'interlinear': True, 'sections': sections}


def write(src):
    dest = OUT / (re.sub(r'[^A-Za-z0-9]+', '_', src['title']).strip('_') + '.json')
    dest.write_text(json.dumps(src, ensure_ascii=False), encoding='utf-8')
    paragraphs = [i for s in src['sections'] for i in s['items'] if 'p' in i]
    print(f"{src['title']}: {len(src['sections'])} sections, {len(paragraphs)} paragraphs, "
          f"{sum(len(i['p']) for i in paragraphs)} phrase pairs")


def import_poked():
    sections, sec, current = [], None, None
    for block in read_doc('Poked_Akarim.docx'):
        runs, marked = without_marker(block['runs'])
        text = ''.join(r[0] for r in runs).strip()
        if marked:
            current = None
        m = re.match(r'^אוֹת\s+\S+:\s*[–—-]\s*Section (\d+):\s*', text)
        if m:
            n = int(m[1])
            sec = {'n': n, 'en': f'Section {n}', 'he': f'אוֹת {il.heb_num(n)}', 'items': []}
            sections.append(sec)
            current = None
            raw = ''.join(r[0] for r in runs)
            runs = slice_runs(runs, m.end() + len(raw) - len(raw.lstrip()))
        if not ''.join(r[0] for r in runs).strip():
            continue
        if sec is None:
            raise ValueError('Poked Akarim body before its first section')
        if current is None:
            current = {'p': [], 'n': 1 + sum('p' in i for i in sec['items'])}
            sec['items'].append(current)
        current['p'].extend(il.dash_pairs(runs))
    assert [s['n'] for s in sections] == list(range(1, 7))
    write(source('Poked Akarim', 'פוקד עקרים', sections))


def split_heading(text):
    m = re.search(r'\s*\(([^()]*)\)\s*$', text)
    if m:
        return text[:m.start()].strip(), m[1]
    return text, ''


def import_ohr():
    sections, by_key = [], {}
    sec = current = None
    reset = False

    def select(key, he, en, sep=' '):
        nonlocal sec, current
        if sec is not None and sec['key'] == key:
            return
        if key in by_key:
            sec = by_key[key]
        else:
            sec = {'key': key, 'en': en, 'he': he, 'sep': sep, 'items': []}
            by_key[key] = sec
            sections.append(sec)
        current = None

    select('Introduction', 'הַקְדָּמַת הַמַּעְתִּיק', 'Introduction of the Copyist')
    for block in read_doc('Ohr_Zarua_LaTzadik.docx'):
        text, runs = block['text'], block['runs']
        plain = bare(text)
        stripped, marked = without_marker(runs)
        if marked:
            current = None
            reset = bool(re.search(r'\(Paragraph 1\)', text))
            runs = stripped
            text = ''.join(r[0] for r in runs).strip()
            plain = bare(text)
            if not text:
                continue
        he, en = split_heading(text)
        is_heading = block['style'].startswith('Heading') and not marked
        target = None
        if re.search(r'\(Principle \d+\)$', text):
            target = ('Thirteen Principles of Conduct', 'י״ג מִדּוֹת וְהַדְרָכוֹת', 'Thirteen Principles of Conduct', ' ')
        elif 'The Usages of the Letters' in text and is_heading:
            target = ('Formative Letters', he, en, ' ')
        elif plain.startswith('ענין גלות מצרים'):
            m = re.search(r'Section (\d+)', text[:200])
            n = int(m[1]) if m else 1
            target = (f'The Egyptian Exile {n}', f'עִנְיַן גָּלוּת מִצְרַיִם, אוֹת {il.heb_num(n)}', f'The Egyptian Exile · Section {n}', ':')
        elif plain.startswith('אל״ף רבתי'):
            target = ('Large Aleph; Small Aleph', 'אַלֶ״ף רַבָּתִי וְאַלֶ״ף זְעֵירָא', 'Large Aleph; Small Aleph', ' ')
        elif plain.startswith('בי״ת רבתי'):
            target = ('Large Beth; Small Beth', 'בֵּי״ת רַבָּתִי וּבֵי״ת זְעֵירָא', 'Large Beit; Small Beit', ' ')
        elif plain.startswith('בשם השם:') and sec['key'] == 'Formative Letters':
            target = ('On the Sacred Language', 'מַאֲמָר עַל מַהוּת לְשׁוֹן הַקֹּדֶשׁ', 'On the Sacred Language', ' ')
        elif is_heading and en == 'Introduction of the Copyist':
            key = 'Novellae, Rif, Introduction' if ', Rambam,' in sec['key'] else 'Novellae, Introduction'
            target = (key, he, 'Novellae · ' + ('Rif · ' if ', Rif,' in key else '') + en, ' ')
        elif is_heading and en == 'Conclusion of the Copyist':
            target = ('Novellae, Epilogue', he, 'Novellae · Conclusion of the Copyist', ' ')
        elif is_heading and re.fullmatch(r'Novellae, Part \d+', en):
            n = int(re.search(r'\d+', en)[0])
            target = (f'Novellae, On Mitzvot {n}', he, f'Novellae · On Mitzvot · Part {n}', ':')
        elif 'הלכות קריאת שמע' in plain[:200] and re.match(r'^ח[י]?דושים', plain):
            target = ('Novellae, Rambam, Kriat Shema 1', 'חִדּוּשִׁים, רַמְבַּ״ם, הִלְכוֹת קְרִיאַת שְׁמַע', 'Novellae · Rambam · Kriat Shema', ':')
        elif is_heading and 'Laws of the Sanhedrin' in en:
            target = ('Novellae, Rambam, Sanhedrin 1', he, 'Novellae · Rambam · Sanhedrin · Chapter 1', ':')
        elif is_heading and 'Laws of Rebels' in en:
            m = re.search(r'(?:Rebels |Chapter )(\d+)', en)
            n = int(m[1])
            if en.startswith('Kunteres'):
                target = (f'Novellae, Rambam, Mamrim, Kuntres Acharon {n}', he, f'Kuntres Acharon · Mamrim · Chapter {n}', ':')
            else:
                target = (f'Novellae, Rambam, Mamrim {n}', f'חִדּוּשִׁים, רַמְבַּ״ם, הִלְכוֹת מַמְרִים, פֶּרֶק {il.heb_num(n)}', f'Novellae · Rambam · Mamrim · Chapter {n}', ':')
        elif is_heading and ('Laws of Kings' in en or 'הלכות מלכים' in plain):
            m = re.search(r'Chapter (\d+)|Kings (\d+)', en)
            n = int(next(v for v in m.groups() if v)) if m else il.gematria(re.search(r'פרק ([א-ת׳״]+)', plain)[1])
            target = (f'Novellae, Rambam, Melachim {n}', f'חִדּוּשִׁים, רַמְבַּ״ם, הִלְכוֹת מְלָכִים, פֶּרֶק {il.heb_num(n)}', f'Novellae · Rambam · Melachim · Chapter {n}', ':')
        elif is_heading and 'Novellae, Rif, Tractate Berakhot' in en:
            target = ('Novellae, Rif, Berachot 1', he, 'Novellae · Rif · Berakhot', ':')
        elif is_heading and 'Novellae, Rif, Tractate Shabbat' in en:
            m = re.search(r'(?:Part|Chapter) (\d+)', en)
            n = int(m[1]) if m else 1
            target = (f'Novellae, Rif, Shabbat {n}', he, f'Novellae · Rif · Shabbat · Chapter {n}', ':')
        elif is_heading and re.search(r'ח[י]?דושים על המרדכי', plain):
            n = il.gematria(re.search(r'פרק ([א-ת׳״]+)', plain)[1])
            target = (f'Novellae, Mordechai, Shabbat {n}', he, f'Novellae · Mordechai · Shabbat · Chapter {n}', ':')
        elif reset and sec['key'].startswith('The Egyptian Exile '):
            n = int(sec['key'].rsplit(' ', 1)[1]) + 1
            target = (f'The Egyptian Exile {n}', f'עִנְיַן גָּלוּת מִצְרַיִם, אוֹת {il.heb_num(n)}', f'The Egyptian Exile · Section {n}', ':')
        if target:
            select(*target)
        if is_heading:
            if not re.search(r'\(Principle \d+\)$', text):
                sec['items'].append({'h': he + ('\n' + en if en else '')})
            current = None
            reset = False
            continue
        if current is None:
            current = {'p': [], 'n': 1 + sum('p' in i for i in sec['items'])}
            sec['items'].append(current)
        pairs = il.pairs_of(runs) if il.HEB.search(text) else [['', il.to_html(runs)]]
        current['p'].extend(pairs)
        reset = False
    assert [s['key'] for s in sections if s['key'].startswith('The Egyptian Exile ')] == [f'The Egyptian Exile {n}' for n in range(1, 8)]
    write(source('Ohr Zarua LaTzadik', 'אור זרוע לצדיק', sections))


def import_mitzvot():
    dest = OUT / 'Sefer_HaZikhronot.json'
    src = json.loads(dest.read_text(encoding='utf-8'))
    # Re-running the import updates just this uploaded portion.
    src['sections'] = [s for s in src['sections'] if not s.get('key', '').startswith('Mitzvot,')]
    sections = []
    sec = None
    kind, number, chapter = 'Positive', 1, 1

    def select(key, he, en):
        nonlocal sec
        sec = {'key': 'Mitzvot, ' + key, 'en': 'Mitzvot · ' + en, 'he': he, 'items': []}
        sections.append(sec)

    def commandment():
        he_kind = 'עֲשֵׂה' if kind == 'Positive' else 'לֹא תַעֲשֶׂה'
        select(f'{kind} Commandment {number}, Chapter {chapter}',
               f'מִצְוַת {he_kind} {il.heb_num(number)}, פֶּרֶק {il.heb_num(chapter)}',
               f'{kind} Commandment {number} · Chapter {chapter}')

    for block in read_doc('Sefer_HaZichronos_Mitzvos.docx'):
        if 'table' in block:
            sec['items'].append(block)
            continue
        text, runs = block['text'], block['runs']
        plain = bare(text)
        m = re.search(r'(Positive|Negative) Commandment (\d+)\s*[—–-]\s*Chapter (\d+)', text[:600])
        if m:
            kind, number, chapter = m[1], int(m[2]), int(m[3])
            commandment()
        elif plain.startswith('פרק '):
            m = re.search(r'Chapter (Two|Three|Five|\d+)', text[:200])
            if m:
                chapter = {'Two': 2, 'Three': 3, 'Five': 5}.get(m[1], int(m[1]) if m[1].isdigit() else None)
                commandment()
        elif text == 'מִצְוַת עֲשֵׂה ד׳':
            kind, number, chapter = 'Positive', 4, 1
            commandment()
        elif text == 'מִצְוַת עֲשֵׂה — אָנֹכִי':
            select('Anokhi', text, 'Anokhi — “I am”')
        elif text == 'פָּרָשַׁת יִתְרוֹ — מִצְוַת עֲשֵׂה':
            sec['en'] = 'Mitzvot · Anokhi · Parashat Yitro'
        elif block['style'] == 'Heading3' and text.startswith('Laws of Expelling'):
            select('Expelling the Impure', 'מִצְוַת עֲשֵׂה — שִׁלּוּחַ טְמֵאִים', 'Expelling the Impure')
        elif len(text) < 220 and plain.startswith('מצות לא תעשה — סימן'):
            select('Sanctuary, Negative Commandment', text.split(' — Negative')[0], 'Sanctuary · Negative Commandment')
        elif len(text) < 220 and plain.startswith('מצות עשה של תשובה'):
            select('Repentance', text.split(' — Positive')[0], 'Repentance')
        if sec is None:
            raise ValueError('Mitzvot body before its opening section')
        if len(text) < 230 and (block['style'] or not il.HEB.search(text) or plain.startswith(('פרק ', 'מצות עשה —', 'פרשת יתרו —', 'מצות לא תעשה —', 'מצות עשה של תשובה')) or text == 'מִצְוַת עֲשֵׂה ד׳'):
            sec['items'].append({'h': text})
            continue
        # English is italic throughout this file; use the existing reader's
        # normal English type, rather than italicizing the entire translation.
        runs = [(t, b, False, link) for t, b, i, link in runs]
        # The end of the upload switches from parentheses to dash-separated text.
        parens = len(re.findall(r'[\u05D0-\u05EA][^A-Za-z\u05D0-\u05EA]{0,4}\(\s*["\u201c\'\[]*[A-Za-z]', text))
        dashes = len(re.findall(r'[\u05D0-\u05EA][^A-Za-z\u05D0-\u05EA]{0,6}\s[\u2014\u2013-]\s', text))
        he_bold = sum(len(re.findall('[א-ת]', t)) for t, b, _, _ in runs if b)
        he_total = sum(len(re.findall('[א-ת]', t)) for t, _, _, _ in runs)
        if he_total and he_bold / he_total > 0.8:
            # Formatting boundaries remain reliable even when an author's
            # Hebrew parenthesis encloses several separately translated phrases.
            pairs = il.bold_pairs(runs)
            pairs = [[h, e[1:-1].strip() if e.startswith('(') and e.endswith(')') else e]
                     for h, e in pairs]
        else:
            pairs = il.dash_pairs(runs) if dashes > parens else il.paren_pairs(runs)
        sec['items'].append({'p': pairs, 'n': 1 + sum('p' in i for i in sec['items'])})
    assert len(sections) == 15, f'Unexpected Mitzvot contents: {[s["en"] for s in sections]}'
    src['sections'].extend(sections)
    write(src)


if __name__ == '__main__':
    import_poked()
    import_ohr()
    import_mitzvot()

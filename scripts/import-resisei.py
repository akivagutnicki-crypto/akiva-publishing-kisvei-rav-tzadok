#!/usr/bin/env python3
"""Import the complete supplied Resisei Layla edition, including every Word footnote.

Run from the repository root with the original in sources/akiva/docx.
The source table of contents is represented by reader navigation; titles,
summaries, interlinear body text, hyperlinks, and notes remain in reading order.
"""
import html
import importlib.util
import json
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET
from urllib.parse import parse_qs, unquote, urlparse

spec = importlib.util.spec_from_file_location('additional', Path(__file__).with_name('import-additional-books.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
il = helper.il
W = helper.W
DOC = Path('sources/akiva/docx/Resisei_Layla_Interlinear.docx')
OUT = Path('sources/akiva/Resisei_Layla.json')


class TextOnly(HTMLParser):
    def __init__(self, omit_notes=False):
        super().__init__()
        self.text = []
        self.skip = 0
        self.omit_notes = omit_notes

    def handle_starttag(self, tag, attrs):
        if self.skip:
            self.skip += 1
        elif self.omit_notes and dict(attrs).get('class') in ('footnote', 'footnote-marker'):
            self.skip = 1

    def handle_endtag(self, tag):
        if self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.text.append(data)


def letters(text, omit_notes=False):
    parser = TextOnly(omit_notes)
    parser.feed(text)
    return re.sub('[^A-Za-zא-ת0-9]', '', ''.join(parser.text))


def main():
    with zipfile.ZipFile(DOC) as z:
        rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('word/_rels/document.xml.rels'))}
        # Some supplied links wrap their Sefaria target in a Google search URL.
        for rid, url in rels.items():
            parsed = urlparse(url)
            if parsed.hostname in ('google.com', 'www.google.com') and parsed.path == '/search':
                target = unquote(parse_qs(parsed.query).get('q', [''])[0])
                if urlparse(target).hostname in ('sefaria.org', 'www.sefaria.org'):
                    # Sefaria resolves the old Genesis folio at this legacy segment address.
                    if unquote(urlparse(target).path).strip('/') == 'Zohar,_Genesis.137a':
                        target = 'https://www.sefaria.org/Zohar.1.137a.1'
                    rels[rid] = target
        body = ET.fromstring(z.read('word/document.xml')).find(W + 'body')
        assert not body.findall(W + 'tbl'), 'Unexpected table layout'
        raw = body.findall(W + 'p')
        texts = [''.join(t.text or '' for t in p.iter(W + 't')).strip() for p in raw]
        starts = [i for i, text in enumerate(texts) if text.startswith('Siman 1 - ')]
        assert len(starts) == 2
        begin = starts[1]
        references = [r.get(W + 'id') for p in raw[begin:] for r in p.iter(W + 'footnoteReference')]
        assert len(references) == len(set(references)) == 1359
        order = {fid: n for n, fid in enumerate(references, 1)}
        il.FOOTNOTES.clear()
        for note in ET.fromstring(z.read('word/footnotes.xml')).findall(W + 'footnote'):
            fid = note.get(W + 'id')
            if fid in order:
                note_html = '<br>'.join(il.to_html(helper.runs_of(p, {})) for p in note.findall(W + 'p'))
                raw_text = ''.join(t.text or '' for t in note.iter(W + 't'))
                assert letters(note_html) == letters(html.escape(raw_text)), fid
                il.FOOTNOTES[fid] = (order[fid], note_html)
        assert set(il.FOOTNOTES) == set(references)
        sections, sec, current, last_title = [], None, None, None
        imported_notes = 0
        for p, text in zip(raw[begin:], texts[begin:]):
            if not text:
                continue
            # Insert reference tokens into this in-memory XML so empty note runs survive.
            for run in p.iter(W + 'r'):
                for child in list(run):
                    if child.tag == W + 'footnoteReference':
                        token = ET.Element(W + 't')
                        token.text = '\ue000' + child.get(W + 'id') + '\ue001'
                        run.insert(list(run).index(child), token)
            runs = helper.runs_of(p, rels)
            m = re.fullmatch(r'Siman (\d+) - (.+)', text)
            if m:
                assert not p.findall('.//' + W + 'footnoteReference')
                n = int(m[1])
                sec = {'n': n, 'en': m[2], 'he': 'סימן ' + il.heb_num(n), 'items': []}
                sections.append(sec)
                current, last_title = None, 'siman'
                continue
            m = re.fullmatch(r'Seif (\d+) - (.+)', text)
            if m:
                assert sec is not None and not p.findall('.//' + W + 'footnoteReference')
                sec['items'].append({'h': f'Seif {m[1]} — {m[2]}'})
                current, last_title = {'n': int(m[1]), 'p': []}, 'seif'
                continue
            if not il.HEB.search(text) and all(r[2] for r in runs if r[0].strip()) and last_title:
                assert not p.findall('.//' + W + 'footnoteReference')
                if last_title == 'seif':
                    sec['items'][-1]['h'] += '\n' + text
                else:
                    sec['items'].append({'h': '\n' + text})
                last_title = None
                continue
            assert sec is not None
            if current is None:
                current = {'n': 1, 'p': []}
            if not current['p']:
                sec['items'].append(current)
            pairs = il.dash_pairs(runs)
            assert letters(''.join(h + e for h, e in pairs), True) == letters(html.escape(text)), f'Body text lost in Siman {sec["n"]}'
            for pair in pairs:
                pair[1] = pair[1].replace('[', '').replace(']', '')
            count = sum((h + e).count('class="footnote-marker"') for h, e in pairs)
            assert count == len(p.findall('.//' + W + 'footnoteReference'))
            imported_notes += count
            current['p'].extend(pairs)
            last_title = None
        assert [s['n'] for s in sections] == list(range(1, 59))
        assert imported_notes == 1359
        assert all(i['p'] and any(en for he, en in i['p']) for s in sections for i in s['items'] if 'p' in i)
        src = helper.source('Resisei Layla', 'רסיסי לילה', sections)
        src['downloads'] = [{'source': str(DOC), 'file': 'downloads/resisei-layla-interlinear.docx', 'label': 'Download complete Word edition'}]
        OUT.write_text(json.dumps(src, ensure_ascii=False), encoding='utf-8')
        paras = [i for s in sections for i in s['items'] if 'p' in i]
        print(f'{len(sections)} simanim, {len(paras)} seifim, {sum(len(i["p"]) for i in paras)} phrase pairs, {imported_notes} footnotes')


if __name__ == '__main__':
    main()

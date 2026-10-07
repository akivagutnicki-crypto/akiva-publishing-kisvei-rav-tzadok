#!/usr/bin/env python3
"""Import the supplied complete Tzidkas HaTzaddik Word edition.

Retain the edition's phrase pairs, topic titles, source hyperlinks, and
paragraph breaks. Match Sefaria's 264 chapter addresses and its special
paragraph numbering in chapters 1, 54, and 264. The original Word download
is copied without modification. Conversation introductions are excluded
from the reader; the edition's bibliographical notes remain with their text.
"""
import collections
import html
import importlib.util
import json
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

spec = importlib.util.spec_from_file_location('additional', Path(__file__).with_name('import-additional-books.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
il, W = helper.il, helper.W
# The two legacy folio URLs no longer resolve in Sefaria's Zohar schema.
# Resolve the quoted wording to the current passages: "חמידו דאורייתא"
# and "ה' ד' הות בקדמיתא". Keep the edition's visible citations intact.
il.LINK_FIXES.update({
    'Zohar.1.138a': 'Zohar, Lech Lecha 26:286',
    'Zohar.2.178b': 'Zohar, Sifra DiTzniuta 5:53',
})
DOC = Path('sources/akiva/docx/Tzidkas_HaTzaddik_Complete.docx')
OUT = Path('sources/akiva/Tzidkat_HaTzadik.json')


class TextOnly(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(markup):
    parser = TextOnly()
    parser.feed(markup)
    return ''.join(parser.parts)


def letters(text):
    return re.sub('[^A-Za-zא-ת0-9]', '', plain(text))


def introduction(text):
    bare = helper.bare(text).strip()
    return (bare.startswith('Here is ') or bare.startswith('הנה התרגום')
            or bare.startswith('להלן תרגום מילולי') or bare.startswith('המשך התרגום המילולי'))


def main():
    with zipfile.ZipFile(DOC) as z:
        rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('word/_rels/document.xml.rels'))}
        body = ET.fromstring(z.read('word/document.xml')).find(W + 'body')
        assert not body.findall(W + 'tbl') and not body.findall('.//' + W + 'footnoteReference')
        blocks = []
        skipped = []
        for i, p in enumerate(body.findall(W + 'p')):
            runs = helper.runs_of(p, rels)
            text = ''.join(r[0] for r in runs).strip()
            if not text:
                continue
            if introduction(text):
                assert not p.findall(W + 'hyperlink'), 'An excluded introduction contains a source link'
                skipped.append(i)
                continue
            blocks.append({'index': i, 'text': text, 'runs': runs})

        starts = [i for i, b in enumerate(blocks) if re.fullmatch(r'Siman \d+', b['text'])]
        assert [int(blocks[i]['text'].split()[1]) for i in starts] == list(range(1, 265))
        before = blocks[:starts[0]]
        assert len(before) == 2
        chapters = []
        for n, start in enumerate(starts, 1):
            end = starts[n] if n < len(starts) else len(blocks)
            chapter = blocks[start + 1:end]
            title = chapter.pop(0)['text']
            assert il.LAT.search(title) and not il.HEB.search(title)
            chapters.append({'n': n, 'en': title, 'he': 'סימן ' + il.heb_num(n),
                             'items': [], 'body': chapter})

        # The document places these introductions immediately before the next
        # Siman heading. Attach them to the restored text they describe.
        for previous, target in ((68, 69), (74, 75)):
            chapter = chapters[previous - 1]['body']
            note_start = next(i for i, b in enumerate(chapter)
                              if b['text'] == 'Introduction & Censorship Note')
            note = chapter[note_start:]
            del chapter[note_start:]
            text = ' '.join(b['text'].lstrip('> ').strip() for b in note[2:]).strip()
            chapters[target - 1]['items'].append({'h': 'Bibliographical Note on Censorship\n' + text})
        chapters[0]['body'] = before + chapters[0]['body']

        imported_paragraphs = imported_links = pairs_count = 0
        source_targets = set()
        canonical = json.loads(Path('sources/sefaria/Tzidkat_HaTzadik.json').read_text())
        for section in chapters:
            n = section['n']
            paragraphs = []
            for block in section.pop('body'):
                text = block['text']
                if text == 'Tzidkas HaTzaddik, Ot 69 (Top Core Text)':
                    section['items'].append({'h': text})
                    continue
                pairs = il.dash_pairs(block['runs'])
                assert letters(''.join(h + e for h, e in pairs)) == letters(html.escape(text)), (n, block['index'])
                assert not any(il.LAT.search(plain(h)) for h, e in pairs), (n, block['index'], 'English in Hebrew')
                # The source records the missing Siman in Hebrew only.
                if n == 74:
                    assert helper.bare(text) == 'אות עד חסר'
                    assert len(pairs) == 1
                    pairs[0][1] = 'Siman 74 is missing from the source text.'
                expected = collections.Counter(il.sefaria_ref(r[3]) for r in block['runs'] if r[3])
                actual = re.findall(r'data-ref="([^"]+)"', ''.join(h + e for h, e in pairs))
                assert set(map(html.unescape, actual)) == set(expected), (n, block['index'], 'Source link lost')
                source_targets.update(expected)
                imported_links += len(actual)
                imported_paragraphs += 1
                pairs_count += len(pairs)
                paragraphs.append(pairs)

            # A Sefaria paragraph may contain several paragraphs in the Word
            # edition. Keep visible breaks while retaining canonical addresses.
            groups = []
            if n == 1:
                assert len(paragraphs) == 3
                groups = paragraphs
            elif n == 54:
                assert len(paragraphs) == 1
                ps = paragraphs[0]
                boundaries = [0]
                for prefix in ('ובזהיובן', 'ולכןגםאצלההמון'):
                    boundaries.append(next(i for i, (h, e) in enumerate(ps)
                                           if letters(h).startswith(prefix)))
                boundaries.append(len(ps))
                groups = [ps[a:b] for a, b in zip(boundaries, boundaries[1:])]
            elif n == 264:
                assert len(paragraphs) >= 4
                combined = []
                for ps in paragraphs[:-3]:
                    if combined:
                        combined.append(['<br>', '<br>'])
                    combined.extend(ps)
                groups = [combined, *paragraphs[-3:]]
                assert letters(groups[1][0][0]).startswith('סליקספרצדקתהצדיק')
            else:
                combined = []
                for ps in paragraphs:
                    if combined:
                        combined.append(['<br>', '<br>'])
                    combined.extend(ps)
                groups = [combined]
            assert len(groups) == len(canonical['text'][n - 1])
            for k, ps in enumerate(groups, 1):
                assert ps and any(e.strip() for h, e in ps), n
                section['items'].append({'n': k, 'p': ps})

        src = helper.source('Tzidkat HaTzadik', 'צדקת הצדיק', chapters)
        src['downloads'] = [{'source': str(DOC), 'file': 'downloads/tzidkas-hatzaddik-complete.docx',
                             'label': 'Download complete Word edition'}]
        src['importInfo'] = {'simanim': 264, 'documentParagraphs': imported_paragraphs,
                             'phrasePairs': pairs_count, 'sefariaTargets': len(source_targets),
                             'hyperlinkSpans': imported_links, 'correctedLegacyZoharLinks': 2,
                             'excludedConversationParagraphs': skipped}
        OUT.write_text(json.dumps(src, ensure_ascii=False), encoding='utf-8')
        print(json.dumps(src['importInfo']))


if __name__ == '__main__':
    main()

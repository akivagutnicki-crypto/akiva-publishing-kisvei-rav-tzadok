#!/usr/bin/env python3
"""Import the supplied Kometz HaMinchah Word files, retaining canonical references.

Part 1 covers 1:1–1:115 and 2:1–2:78 with interlinear English. Part 2
contains the Hebrew of 2:79 and its source appendix; it has no translation.
Run from the repository root after copying the originals into sources/akiva/docx.
"""
import html
import importlib.util
import json
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location('additional', Path(__file__).with_name('import-additional-books.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
il = helper.il
OUT = Path('sources/akiva/Kometz_HaMinchah.json')


def letters(text):
    return re.sub(r'[^A-Za-zא-ת0-9]', '', html.unescape(re.sub(r'<[^>]*>', '', text)))


def append_pairs(target, pairs):
    for he, en in pairs:
        en = en.replace('[', '').replace(']', '')
        if not he and en and target and target[-1][0] and not target[-1][1]:
            target[-1][1] = en
        else:
            target.append([he, en])


def main():
    sections = []
    section = current = None
    body_text = []
    for block in helper.read_doc('Kometz_HaMincha_Part_1.docx'):
        text, runs = block['text'], block['runs']
        bare = helper.bare(text)
        he = re.fullmatch(r'אות\s+([א-ת׳״\'\"]+):([א-ת׳״\'\"]+)', bare)
        en = re.fullmatch(r'(?:###\s*)?Section (\d+):(\d+)', bare)
        if he or en:
            volume, chapter = (il.gematria(he[1]), il.gematria(he[2])) if he else (int(en[1]), int(en[2]))
            section = {'n': f'{volume}:{chapter}', 'en': f'Section {volume}:{chapter}',
                       'he': f'אות {il.heb_num(volume)}:{il.heb_num(chapter)}', 'items': [{'n': 1, 'p': []}]}
            sections.append(section)
            current = section['items'][0]
            continue
        if section is None:
            assert helper.bare(text) == 'קומץ המנחה', text
            continue
        # The dedication/poem and the opening discourse are separate canonical paragraphs.
        if section['n'] == '1:1' and helper.bare(text).startswith('"צו את אהרן"'):
            current = {'n': 2, 'p': []}
            section['items'].append(current)
        body_text.append(text)
        append_pairs(current['p'], il.dash_pairs(runs))
    expected = [f'1:{n}' for n in range(1, 116)] + [f'2:{n}' for n in range(1, 79)]
    assert [s['n'] for s in sections] == expected
    assert len(sections[0]['items']) == 2
    extracted = ''.join(h + e for s in sections for item in s['items'] for h, e in item['p'])
    assert letters(extracted) == letters(''.join(body_text)), 'Word body content was lost or reordered'

    part2 = helper.read_doc('Kometz_Hamincha_Part_2.docx')
    marker = next(i for i, b in enumerate(part2) if b['text'] == 'SECTION 2:79')
    hebrew = part2[marker + 1]['text']
    original = json.loads(Path('sources/sefaria/Kometz_HaMinchah.json').read_text())
    paragraphs = original['text'][1][78]
    assert letters(hebrew) == letters(''.join(paragraphs)), 'Part 2 differs from canonical Hebrew'
    assert not re.search('[A-Za-z]', hebrew), 'Part 2 unexpectedly contains English'
    refs = []
    for block in part2[marker + 2:]:
        for _, _, _, link in block['runs']:
            ref = il.sefaria_ref(link) if link else None
            if ref and ref not in refs:
                refs.append(ref)
    assert len(refs) == 49, len(refs)
    sections.append({'n': '2:79', 'en': 'Section 2:79 (Hebrew)', 'he': 'אות ב׳:ע״ט',
                     'items': [{'n': n, 'p': [[p, '']]} for n, p in enumerate(paragraphs, 1)] +
                              [{'table': {'references': True, 'headers': ['Sources listed in Part 2'],
                                          'rows': [[ref] for ref in refs]}}]})
    src = helper.source('Kometz HaMinchah', 'קומץ המנחה', sections)
    src['downloads'] = [
        {'source': 'sources/akiva/docx/Kometz_HaMincha_Part_1.docx', 'file': 'downloads/kometz-haminchah-part-1.docx', 'label': 'Download Part 1 (Word)'},
        {'source': 'sources/akiva/docx/Kometz_Hamincha_Part_2.docx', 'file': 'downloads/kometz-haminchah-part-2.docx', 'label': 'Download Part 2 (Word — Hebrew)'}]
    OUT.write_text(json.dumps(src, ensure_ascii=False), encoding='utf-8')
    print(f'{len(sections)} sections; {sum(len([i for i in s["items"] if "p" in i]) for s in sections)} paragraphs; {len(refs)} Part 2 sources')


if __name__ == '__main__':
    main()

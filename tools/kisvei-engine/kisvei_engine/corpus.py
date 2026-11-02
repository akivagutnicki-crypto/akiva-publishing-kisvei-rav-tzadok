"""Load the Akiva Publishing Kisvei Rav Tzadok library into uniform paragraph records.

Sources understood
  sources/akiva/<Book>.json           interlinear: sections[{n, en, he, items[{n, p:[[he,en],...], footnotes?}]}]
  sources/akiva/parts/<part>.json     interlinear parts: {book, node, chapters:{"1":[{n, p}]}}
  sources/sefaria/<Book>.json         Sefaria export: {title, text: nested lists or {node: nested lists}}
  dist/library/data/<slug>/<i>.json   built reader rows (optional, richer: footnotes, citations)

Each record: {'book', 'school', 'ref', 'section', 'paragraph', 'he', 'en', 'phrases': [[he,en],...], 'notes': [...]} .
"""
import json
import os
import re
from pathlib import Path

from .hebrew import strip_nikkud

TAG_RE = re.compile(r'<[^>]+>')
ISHBITZ = {'Beit Yaakov on Torah', 'Sod Yesharim', 'Tiferet Yosef', 'Mei HaShiloach', "Sha'ar HaEmunah VeYesod HaChasidut"}
HEB_NUM = {1: 'א', 2: 'ב', 3: 'ג', 4: 'ד', 5: 'ה', 6: 'ו', 7: 'ז', 8: 'ח', 9: 'ט', 10: 'י', 20: 'כ', 30: 'ל', 40: 'מ', 50: 'נ', 60: 'ס',
           70: 'ע', 80: 'פ', 90: 'צ', 100: 'ק', 200: 'ר', 300: 'ש', 400: 'ת'}


def plain(s):
    return TAG_RE.sub('', str(s or '')).replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'").replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ')


class Corpus:
    def __init__(self):
        self.records = []
        self.by_ref = {}

    # ---- loaders ----
    def add(self, rec):
        rec['heBare'] = strip_nikkud(plain(rec['he']))
        self.records.append(rec)
        self.by_ref[rec['ref']] = rec
        return rec

    def load_akiva_book(self, path):
        d = json.load(open(path, encoding='utf-8'))
        book = d['title']
        school = 'Ishbitz–Radzin' if book in ISHBITZ else 'Kisvei Rav Tzadok'
        for sec in d.get('sections', []):
            n = sec.get('n')
            sec_label = f'{book} {n}' if isinstance(n, int) or (isinstance(n, str) and n.isdigit()) else f'{book}, {sec.get("en") or n}'
            k = 0
            for item in sec.get('items', []):
                if 'p' not in item:
                    continue
                k += 1
                pn = item.get('n', k)
                pairs = [[plain(pr[0]), plain(pr[1])] for pr in item['p']]
                self.add({'book': book, 'school': school, 'ref': f'{sec_label}:{pn}', 'sectionRef': sec_label, 'sectionTitle': sec.get('en'),
                          'section': n, 'paragraph': pn, 'he': ' '.join(p[0] for p in pairs), 'en': ' '.join(p[1] for p in pairs),
                          'phrases': pairs, 'notes': item.get('footnotes', []), 'source': 'akiva'})
        return d

    def load_akiva_part(self, path):
        d = json.load(open(path, encoding='utf-8'))
        book, node = d['book'], d['node']
        school = 'Ishbitz–Radzin' if book in ISHBITZ else 'Kisvei Rav Tzadok'
        for ch, items in d.get('chapters', {}).items():
            k = 0
            for item in items:
                if 'p' not in item:
                    continue
                k += 1
                pn = item.get('n', k)
                pairs = [[plain(pr[0]), plain(pr[1])] for pr in item['p']]
                sec_label = f'{book}, {node} {ch}'
                self.add({'book': book, 'school': school, 'ref': f'{sec_label}:{pn}', 'sectionRef': sec_label, 'sectionTitle': None,
                          'section': ch, 'paragraph': pn, 'he': ' '.join(p[0] for p in pairs), 'en': ' '.join(p[1] for p in pairs),
                          'phrases': pairs, 'notes': item.get('footnotes', []), 'source': 'akiva-part', 'node': node})
        return d

    def load_sefaria_export(self, path, skip_if_interlinear=None):
        d = json.load(open(path, encoding='utf-8'))
        book = d['title']
        school = 'Ishbitz–Radzin' if book in ISHBITZ else 'Kisvei Rav Tzadok'
        text = d.get('text')

        def walk(node_title, value, path_idx):
            if isinstance(value, dict):
                for k, v in value.items():
                    walk((node_title + ', ' if node_title else '') + k, v, [])
            elif isinstance(value, list):
                if value and all(isinstance(x, str) for x in value):
                    # leaf list of segments
                    sec_label = f'{book}, {node_title}' if node_title else book
                    if path_idx:
                        sec_label += ' ' + ':'.join(str(i) for i in path_idx)
                    for j, seg in enumerate(value, 1):
                        if not seg or not seg.strip():
                            continue
                        ref = f'{sec_label}:{j}' if path_idx else f'{sec_label} {j}'
                        if skip_if_interlinear and ref in self.by_ref:
                            continue
                        self.add({'book': book, 'school': school, 'ref': ref, 'sectionRef': sec_label, 'sectionTitle': None,
                                  'section': path_idx[-1] if path_idx else None, 'paragraph': j, 'he': plain(seg), 'en': '',
                                  'phrases': [], 'notes': [], 'source': 'sefaria-export', 'node': node_title})
                else:
                    for i, v in enumerate(value, 1):
                        if isinstance(v, str):
                            if v.strip():
                                sec_label = f'{book}, {node_title}' if node_title else book
                                ref = f'{sec_label} ' + ':'.join(str(x) for x in path_idx + [i])
                                self.add({'book': book, 'school': school, 'ref': ref, 'sectionRef': sec_label, 'sectionTitle': None,
                                          'section': i, 'paragraph': 1, 'he': plain(v), 'en': '', 'phrases': [], 'notes': [], 'source': 'sefaria-export', 'node': node_title})
                        else:
                            walk(node_title, v, path_idx + [i])

        walk('', text, [])
        return d

    def load_repo(self, repo, include_sefaria=True):
        repo = Path(repo)
        for f in sorted((repo / 'sources/akiva').glob('*.json')):
            try:
                self.load_akiva_book(f)
            except Exception as e:  # noqa: BLE001
                print('skip', f.name, e)
        for f in sorted((repo / 'sources/akiva/parts').glob('*.json')):
            try:
                self.load_akiva_part(f)
            except Exception as e:  # noqa: BLE001
                print('skip part', f.name, e)
        if include_sefaria:
            have = {r['book'] for r in self.records}
            for f in sorted((repo / 'sources/sefaria').glob('*.json')):
                d = json.load(open(f, encoding='utf-8'))
                if d.get('title') in have and d.get('title') not in ('Peri Tzadik',):
                    continue  # interlinear edition already loaded
                try:
                    self.load_sefaria_export(f)
                except Exception as e:  # noqa: BLE001
                    print('skip export', f.name, e)
        return self

    # ---- helpers ----
    def books(self):
        out = {}
        for r in self.records:
            out[r['book']] = out.get(r['book'], 0) + 1
        return out

    def section_records(self, section_ref):
        return [r for r in self.records if r['sectionRef'] == section_ref]

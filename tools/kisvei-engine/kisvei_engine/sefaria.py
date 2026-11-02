#!/usr/bin/env python3
"""Sefaria reference canonicalization helpers (engine module).

- normalize_ref(text): rewrite common editorial citation spellings into the names Sefaria resolves
  (Yerushalmi -> Jerusalem Talmud, Rema on Shulchan Arukh -> Shulchan Arukh, Mishnah Avot -> Pirkei Avot ...).
- ZoharDafResolver: maps "Zohar III, 232a" / "Zohar 1:138a" / "Zohar II 178b" style citations to Sefaria's
  parashah-based Zohar refs using the "Daf" alternate structure of the Zohar index.
- sefaria_url(ref): canonical https://www.sefaria.org/<Title>.<a>.<b> link, the form Sefaria itself generates.
"""
import json
import re
from pathlib import Path
from urllib.parse import quote

SEFARIA = 'https://www.sefaria.org/'
ROMAN = {'I': 1, 'II': 2, 'III': 3, '1': 1, '2': 2, '3': 3, 'A': 1, 'B': 2, 'C': 3, 'א': 1, 'ב': 2, 'ג': 3}

NAME_FIXES = [
    (re.compile(r'^(?:Talmud )?Yerushalmi,?\s+'), 'Jerusalem Talmud '),
    (re.compile(r'^Y\.\s*'), 'Jerusalem Talmud '),
    (re.compile(r'^JT\s+'), 'Jerusalem Talmud '),
    (re.compile(r'^Rema(?:,| on)\s+Shulchan Arukh,'), 'Shulchan Arukh,'),
    (re.compile(r'^Mishnah Avot\b'), 'Pirkei Avot'),
    (re.compile(r'^Avot\s+(?=\d)'), 'Pirkei Avot '),
    (re.compile(r'^Avot DeRabbi Natan'), 'Avot DeRabbi Natan'),
    (re.compile(r'^Bereishit Rabbah'), 'Bereshit Rabbah'),
    (re.compile(r'^Shemos Rabbah'), 'Shemot Rabbah'),
    (re.compile(r'^Koheles Rabbah'), 'Kohelet Rabbah'),
    (re.compile(r'^Eichah Rabbah'), 'Eichah Rabbah'),
    (re.compile(r'^Tanchuma\b'), 'Midrash Tanchuma'),
    (re.compile(r'^Tehillim\s+(?=\d)'), 'Psalms '),
    (re.compile(r'^Mishlei\s+(?=\d)'), 'Proverbs '),
    (re.compile(r'^Kohelet\s+(?=\d)'), 'Ecclesiastes '),
    (re.compile(r'^Bereshit\s+(?=\d)'), 'Genesis '),
    (re.compile(r'^Shemot\s+(?=\d)'), 'Exodus '),
    (re.compile(r'^Vayikra\s+(?=\d)'), 'Leviticus '),
    (re.compile(r'^Bamidbar\s+(?=\d)'), 'Numbers '),
    (re.compile(r'^Devarim\s+(?=\d)'), 'Deuteronomy '),
    (re.compile(r'^Yeshayahu\s+(?=\d)'), 'Isaiah '),
    (re.compile(r'^Yirmiyahu\s+(?=\d)'), 'Jeremiah '),
    (re.compile(r'^Yechezkel\s+(?=\d)'), 'Ezekiel '),
    (re.compile(r'^Shir HaShirim\s+(?=\d)'), 'Song of Songs '),
    (re.compile(r'^Iyov\s+(?=\d)'), 'Job '),
    (re.compile(r'^Divrei HaYamim I\s+'), 'I Chronicles '),
    (re.compile(r'^Divrei HaYamim II\s+'), 'II Chronicles '),
    (re.compile(r'^Melachim I\s+'), 'I Kings '),
    (re.compile(r'^Melachim II\s+'), 'II Kings '),
    (re.compile(r'^Shmuel I\s+'), 'I Samuel '),
    (re.compile(r'^Shmuel II\s+'), 'II Samuel '),
]


def normalize_ref(text):
    r = re.sub(r'\s+', ' ', text.strip().rstrip('.;,'))
    r = r.replace('–', '-').replace('—', '-')
    for pat, rep in NAME_FIXES:
        r = pat.sub(rep, r)
    # "Berakhot 6b." -> "Berakhot 6b"; "Berakhot, 6b" -> "Berakhot 6b"
    r = re.sub(r'^([A-Za-z\' ]+?),\s+(\d+[ab]?(?::\d+)?)$', r'\1 \2', r)
    return r


def split_title_address(ref):
    """('Pesachim', '96a:24') ; ('Tanya, Part I; Likkutei Amarim', '31:14-16') ; ('Berakhot', '48a')"""
    m = re.match(r'^(.*?)(?:\s+(\d+[ab]?(?::\d+[ab]?)*(?:-\d+[ab]?(?::\d+[ab]?)*)?))?$', ref.strip())
    if not m or not m.group(2):
        return ref.strip(), None
    return m.group(1).strip(), m.group(2)


def sefaria_url(ref, lang=None):
    title, addr = split_title_address(ref)
    path = title.replace(' ', '_')
    if addr:
        path += '.' + addr.replace(':', '.')
    url = SEFARIA + quote(path, safe="_.,;'()-")
    return url + ('?lang=' + lang if lang else '')


def dotted_data_ref(ref):
    """The reader's inline data-ref form: 'I Chronicles.28.9', 'Berakhot.48a'."""
    title, addr = split_title_address(ref)
    return title + ('.' + addr.replace(':', '.') if addr else '')


class ZoharDafResolver:
    """Resolve Zohar citations given by volume and daf to Sefaria's parashah refs.

    Built from the 'Daf' alternate structure of Sefaria's Zohar index (/api/v2/index/Zohar -> alts.Daf):
    Volume I/II/III -> parashah nodes with startingAddress (e.g. '165b') and one ref per amud.
    """

    def __init__(self, alt_structs_path):
        alts = json.load(open(alt_structs_path, encoding='utf-8'))
        daf = alts.get('Daf') or {}
        self.table = {1: {}, 2: {}, 3: {}}
        self.volumes = {1: 'Volume I', 2: 'Volume II', 3: 'Volume III'}
        for vnode in daf.get('nodes', []):
            vol = {'Volume I': 1, 'Volume II': 2, 'Volume III': 3}.get(vnode.get('title') or vnode.get('sharedTitle'))
            if not vol:
                continue
            self._walk(vnode, vol, vnode.get('title'))

    @staticmethod
    def _amud_iter(start):
        m = re.match(r'^(\d+)([ab])$', start)
        n, side = int(m.group(1)), m.group(2)
        while True:
            yield f'{n}{side}'
            if side == 'a':
                side = 'b'
            else:
                side = 'a'
                n += 1

    def _walk(self, node, vol, parent_title):
        title = node.get('title') or node.get('sharedTitle') or parent_title
        refs = node.get('refs')
        if isinstance(refs, list) and node.get('startingAddress'):
            it = self._amud_iter(str(node['startingAddress']))
            for ref in refs:
                amud = next(it)
                if ref:
                    self.table[vol].setdefault(amud, []).append({'ref': ref, 'parashah': title})
        for child in node.get('nodes', []) or []:
            self._walk(child, vol, title)

    PATTERNS = [
        re.compile(r'^Zohar(?:,|\s)\s*(?:Vol(?:ume)?\.?\s*)?(I{1,3}|[123]|[אבג])\s*[,:]?\s*(?:daf\s*|p\.?\s*|fol\.?\s*)?(\d+)\s*([ab])?', re.I),
        re.compile(r'^Zohar\s+(?:Chelek|Helek)\s*(I{1,3}|[123]|[אבג])\s*[,:]?\s*(\d+)\s*([ab])?', re.I),
    ]

    def resolve(self, text):
        t = text.strip().replace('–', '-')
        for pat in self.PATTERNS:
            m = pat.match(t)
            if m:
                vol = ROMAN.get(m.group(1).upper()) or ROMAN.get(m.group(1))
                daf = int(m.group(2))
                side = (m.group(3) or 'a').lower()
                hits = self.table.get(vol, {}).get(f'{daf}{side}')
                if hits:
                    return {'ok': True, 'volume': vol, 'daf': f'{daf}{side}', 'ref': hits[0]['ref'], 'parashah': hits[0]['parashah'],
                            'url': sefaria_url(hits[0]['ref']), 'all': hits}
                return {'ok': False, 'volume': vol, 'daf': f'{daf}{side}', 'error': 'daf not in Sefaria Daf structure'}
        return None


if __name__ == '__main__':
    import sys
    here = Path(__file__).resolve().parent
    z = ZoharDafResolver(here.parent / 'out' / 'zohar_alt_structs.json')
    for t in ['Zohar III, 232a', 'Zohar I 219b', 'Zohar 1:138a', 'Zohar II 178b', 'Zohar III 232a (Ra’aya Mehemna, Pinchas)', 'Zohar I, 1a', 'Zohar II 2b']:
        print(t, '->', z.resolve(t))
    for t in ['Yerushalmi Berakhot 1:1', 'Rema on Shulchan Arukh, Orach Chayim 1:1', 'Mishnah Avot 2:12', 'Pesachim 96a:24', 'Tanya, Part I; Likkutei Amarim 31:14-16']:
        n = normalize_ref(t)
        print(t, '->', n, '|', sefaria_url(n), '|', dotted_data_ref(n))
    print('table sizes', {k: len(v) for k, v in z.table.items()})

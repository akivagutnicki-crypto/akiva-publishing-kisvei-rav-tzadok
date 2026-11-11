#!/usr/bin/env python3
"""Import the two finished Pri Tzaddik Moadim interlinear editions (Iyar–Menachem Av, Elul–Sukkos).

The reviewed translation files (revNN.jsonl) are the publication source; nothing is translated or reworded here.
Each maamar becomes one reader chapter in the shape of the Shemos edition (scripts/pri-shemos/build.py):
[{"h": heading}, {"p": [[hebrew phrase, english phrase], …], "n": k}, …].

So that the study edition's paragraph numbers line up with the library's original Hebrew paragraphs:
  - a subheading (e.g. "(אושפיזא דיצחק)") is its own paragraph, as it is in the library's Hebrew;
  - Rosh Chodesh Av 7 ends with the colophon of Sefer Bamidbar, a separate paragraph in the library's Hebrew
    (COLOPHONS below; supplied by the editor).
No footnotes yet: the interlinear text only.
"""
import hashlib
import html
import json
from pathlib import Path

SOURCE = Path('sources/akiva/pri-moadim-20261111')
OUTPUT = Path('sources/akiva/overlays/pri-moadim-20261111')
EDITION = 'pri-moadim-20261111-v1'
FIRST_ID = 3600            # Shemos 3000–3147, Bereishis 3400–3549
VOLUMES = [
    {'volume': 1, 'dir': 'iyar-av', 'revs': 33, 'file': 'Pri_Tzaddik_Iyar_through_Menachem_Av_Interlinear.docx',
     'download': 'pri-tzaddik-iyar-through-menachem-av-interlinear.docx',
     'label': 'Iyar through Menachem Av', 'he': 'אייר – מנחם אב'},
    {'volume': 2, 'dir': 'elul-sukkos', 'revs': 47, 'file': 'Pri_Tzaddik_Elul_through_Sukkos_7x10_KDP.docx',
     'download': 'pri-tzaddik-elul-through-sukkos-interlinear.docx',
     'label': 'Elul through Sukkos', 'he': 'אלול – סוכות'},
]
# Group (festival) names in the contents, by the library ref's section name
GROUPS = {'Rosh Chodesh Iyar': 'Rosh Chodesh Iyar', 'Pesach Sheni': 'Pesach Sheni', 'Lag BaOmer': 'Lag BaOmer',
          'Kuntres Amalah shel Torah': 'Kuntres Amalah Shel Torah', 'Rosh Chodesh Sivan': 'Rosh Chodesh Sivan',
          'Shavuot': 'Shavuos', 'Rosh Chodesh Tammuz': 'Rosh Chodesh Tammuz', 'Rosh Chodesh Av': 'Rosh Chodesh Menachem Av',
          'The Fifteenth of Av': "Tu B'Av", 'Rosh Chodesh Elul': 'Rosh Chodesh Elul', 'Rosh Hashanah': 'Rosh Hashanah',
          'Vayeilech and Shabbat Shuvah': 'Vayeilech and Shabbos Shuvah', 'Erev Yom Kippur': 'Erev Yom Kippur',
          'Motzei Yom Kippur': 'Motzaei Yom Kippur', 'Sukkot': 'Sukkos'}
# Paragraphs the library's Hebrew has that the Word edition does not: (ref, after unit id, [hebrew, english])
COLOPHONS = {'Peri Tzadik, Rosh Chodesh Av 7': ['נִשְׁלַם סֵפֶר בְּמִדְבַּר בְּסִיַּעְתָּא דִשְׁמַיָּא',
                                               'Sefer Bamidbar is completed, with the help of Heaven']}


def read_json(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def write_json(p, value):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def esc(s): return html.escape(s, quote=False)


def revs(v):
    d = SOURCE / v['dir']; out = []
    for i in range(1, v['revs'] + 1):
        out += [json.loads(l) for l in (d / f'rev{i:02d}.jsonl').read_text(encoding='utf-8').splitlines() if l.strip()]
    return out


def section_ref(v, unit, refs):
    if v['dir'] == 'iyar-av': return refs[str(unit['m'])]['sefaria_lublin_ref']
    return f"Peri Tzadik, {unit['sec']} {unit['n']}"


def build():
    sections = []; volumes = []; used = set()
    refs = read_json(SOURCE / 'iyar-av/refs.json')
    for v in VOLUMES:
        d = SOURCE / v['dir']; units = read_json(d / 'units.json'); rev = revs(v)
        assert [u['id'] for u in units] == [r['id'] for r in rev], v['dir'] + ': revision ids differ from units.json'
        cur = None; maamar = None
        for u, r in zip(units, rev):
            if u['type'] == 'heading':
                assert 'he' in r and 'en' in r and 'segs' not in r, r['id']
                ref = section_ref(v, u, refs); assert ref not in used, 'Duplicate ref ' + ref; used.add(ref)
                group = ref[len('Peri Tzadik, '):].rsplit(' ', 1)[0]
                cur = {'ref': ref, 'en': r['en'], 'he': r['he'], 'parashah': GROUPS[group],
                       'heGroup': r['he'].rsplit(',', 1)[0], 'ois': int(ref.rsplit(' ', 1)[1]),
                       'id': FIRST_ID + len(sections), 'volume': v['volume'], 'items': [], 'units': []}
                sections.append(cur); maamar = u['m']
                cur['items'].append({'h': r['he'] + ' ' + r['en'], 'unit': r['id']})
            else:
                assert cur is not None and u['m'] == maamar, r['id'] + ': unit outside its maamar'
                if u['type'] == 'subheading':
                    assert 'segs' not in r and r['he'].strip() and r['en'].strip(), r['id']
                    pairs = [[r['he'], r['en']]]
                else:
                    assert u['type'] == 'para' and r['segs'], r['id']
                    pairs = r['segs']
                assert all(isinstance(h, str) and isinstance(e, str) and h.strip() and e.strip() for h, e in pairs), r['id']
                n = sum('p' in x for x in cur['items']) + 1
                cur['items'].append({'p': [[esc(h), esc(e)] for h, e in pairs], 'keepPairs': True, 'n': n,
                                     'unit': r['id'], **({'subheading': True} if u['type'] == 'subheading' else {})})
            cur['units'].append(r['id'])
        volumes.append({'volume': v['volume'], 'label': v['label'], 'he': v['he'], 'file': v['dir'] + '/' + v['file'],
                        'sha256': digest(d / v['file']), 'bytes': (d / v['file']).stat().st_size, 'download': v['download'],
                        'units': len(units), 'revisionFiles': {f'rev{i:02d}.jsonl': digest(d / f'rev{i:02d}.jsonl') for i in range(1, v['revs'] + 1)}})
    for ref, pair in COLOPHONS.items():
        sec = next(s for s in sections if s['ref'] == ref)
        sec['items'].append({'p': [[esc(pair[0]), esc(pair[1])]], 'keepPairs': True,
                             'n': sum('p' in x for x in sec['items']) + 1, 'colophon': True})
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for old in OUTPUT.glob('*.json'): old.unlink()
    for sec in sections:
        items = sec.pop('items')
        write_json(OUTPUT / f"{sec['id']}.json", items)
        sec['paragraphs'] = sum('p' in x for x in items)
        sec['pairs'] = sum(len(x.get('p', [])) for x in items)
        sec['subheadings'] = sum(bool(x.get('subheading')) for x in items)
        sec['colophons'] = sum(bool(x.get('colophon')) for x in items)
        sec['notes'] = 0
        sec['heRef'] = 'פרי צדיק, ' + sec['he']
    report = {'edition': EDITION, 'volumes': volumes, 'sections': sections,
              'groups': list(dict.fromkeys(s['parashah'] for s in sections)),
              'footnotes': 0, 'pairs': sum(s['pairs'] for s in sections), 'paragraphs': sum(s['paragraphs'] for s in sections)}
    write_json(OUTPUT / 'manifest.json', report)
    for v in volumes:
        vs = [s for s in sections if s['volume'] == v['volume']]
        print(json.dumps({'volume': v['label'], 'sections': len(vs), 'paragraphs': sum(s['paragraphs'] for s in vs),
                          'pairs': sum(s['pairs'] for s in vs), 'subheadings': sum(s['subheadings'] for s in vs),
                          'colophons': sum(s['colophons'] for s in vs)}))
    return report


if __name__ == '__main__': build()

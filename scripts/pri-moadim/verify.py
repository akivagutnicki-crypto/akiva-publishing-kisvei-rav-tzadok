#!/usr/bin/env python3
"""Independent check of the Pri Tzaddik Moadim editions (scripts/pri-moadim/build.py).

Reads units.json and the revNN.jsonl files directly and proves that every unit of every maamar is in the overlay, in
order, with its phrase pairs exactly as in the revision files; that every ref is a library section; and, given a site,
that every study chapter has as many paragraphs as the library's original Hebrew of that ref (subheadings and the
colophon at the library's own positions), and that the reader, the MCP text, the downloads and (--archives) both text
archives carry the edition.

Usage: verify.py [SITE] [--archives]
"""
import hashlib
import html
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile

SOURCE = Path('sources/akiva/pri-moadim-20261111')
OUTPUT = Path('sources/akiva/overlays/pri-moadim-20261111')
DIRS = {1: ('iyar-av', 33), 2: ('elul-sukkos', 47)}
EXPECTED = {1: (72, 222), 2: (128, 324)}      # maamarim, units
COLOPHON = 'Peri Tzadik, Rosh Chodesh Av 7'


def rd(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def plain(s): return html.unescape(re.sub('<[^>]*>', '', s))
def leaves(x): return sum((leaves(c) for c in x['children']), []) if 'children' in x else [x]


def verify(site=None, archives=False):
    m = rd(OUTPUT / 'manifest.json'); secs = m['sections']
    valid = {l.strip() for l in open('sources/mafteach/library-refs.txt', encoding='utf-8') if l.strip()}
    assert len({s['id'] for s in secs}) == len(secs) and len({s['ref'] for s in secs}) == len(secs)
    assert all(s['ref'] in valid for s in secs), [s['ref'] for s in secs if s['ref'] not in valid]
    info = rd(SOURCE / 'iyar-av/refs.json')
    totals = {'paragraphs': 0, 'pairs': 0, 'subheadings': 0}
    for v in m['volumes']:
        d, n = DIRS[v['volume']]; base = SOURCE / d
        assert sha(SOURCE / v['file']) == v['sha256'] and (SOURCE / v['file']).stat().st_size <= 10_000_000
        units = rd(base / 'units.json')
        rev = []
        for i in range(1, n + 1):
            f = base / f'rev{i:02d}.jsonl'; assert sha(f) == v['revisionFiles'][f.name], 'Revision file changed: ' + f.name
            rev += [json.loads(l) for l in f.read_text(encoding='utf-8').splitlines() if l.strip()]
        assert [u['id'] for u in units] == [r['id'] for r in rev]
        heads = [u for u in units if u['type'] == 'heading']
        assert (len(heads), len(units)) == EXPECTED[v['volume']], (v['label'], len(heads), len(units))
        vsecs = [s for s in secs if s['volume'] == v['volume']]
        assert len(vsecs) == len(heads)
        # the reference of each maamar, from the source's own heading data
        for h, s in zip(heads, vsecs):
            want = info[str(h['m'])]['sefaria_lublin_ref'] if d == 'iyar-av' else f"Peri Tzadik, {h['sec']} {h['n']}"
            assert s['ref'] == want, (s['ref'], want)
            if d == 'iyar-av': assert info[str(h['m'])]['heading'] == h['text'], h['text']
        # every unit, in order, exactly
        k = -1; items = []; pos = 0
        for u, r in zip(units, rev):
            if u['type'] == 'heading':
                k += 1; s = vsecs[k]; items = rd(OUTPUT / f"{s['id']}.json"); pos = 0
                assert items[0] == {'h': r['he'] + ' ' + r['en'], 'unit': r['id']}; pos = 1
                assert s['he'] == r['he'] and s['en'] == r['en']
                continue
            it = items[pos]; pos += 1
            assert it['unit'] == r['id'], (s['ref'], r['id'], 'order')
            want = [[r['he'], r['en']]] if u['type'] == 'subheading' else r['segs']
            assert [[plain(h), plain(e)] for h, e in it['p']] == want, (s['ref'], r['id'], 'phrase pairs differ')
            assert bool(it.get('subheading')) == (u['type'] == 'subheading')
            totals['subheadings'] += u['type'] == 'subheading'
            if pos == len(items) or 'unit' not in items[pos]:   # end of the maamar's units
                rest = items[pos:]
                assert all(x.get('colophon') for x in rest) and (len(rest) == (s['ref'] == COLOPHON))
        for s in vsecs:
            items = rd(OUTPUT / f"{s['id']}.json")
            assert [x['n'] for x in items if 'p' in x] == list(range(1, s['paragraphs'] + 1))
            assert all('h' in x for x in items[:1]) and not any('h' in x for x in items[1:])
            totals['paragraphs'] += s['paragraphs']; totals['pairs'] += s['pairs']
    assert totals['paragraphs'] == m['paragraphs'] and totals['pairs'] == m['pairs'] and totals['subheadings'] == 9
    result = {'ok': True, 'edition': m['edition'], 'sections': len(secs), **totals}
    if site:
        site = Path(site); lib = site / 'library'; data = lib / 'data'
        cat = rd(site / 'mcp-data/catalog.json'); book = next(b for b in cat['books'] if b['slug'] == 'peri-tzadik')
        text = rd(site / 'mcp-data/text/peri-tzadik.json')
        hebrew = {}
        for sc in book['sections']:
            if sc.get('il') or sc.get('edition') == 'interlinear': continue
            hebrew.setdefault(sc['ref'], text['paras'][sc['first']:sc['first'] + sc['count']])
        mismatch = []
        for s in secs:
            paras = hebrew.get(s['ref']); assert paras, 'No original Hebrew section: ' + s['ref']
            if len(paras) != s['paragraphs']: mismatch.append((s['ref'], s['paragraphs'], len(paras)))
            items = [x for x in rd(OUTPUT / f"{s['id']}.json") if 'p' in x]
            for x, hp in zip(items, paras):
                he = ''.join(a for a, b in hp.get('p') or []) or hp.get('t') or json.dumps(hp, ensure_ascii=False)
                short = len(re.sub(r'[^א-ת]', '', he)) <= 20
                if x.get('subheading') or x.get('colophon'): assert short, (s['ref'], x['n'], 'subheading/colophon position')
        assert not mismatch, 'Paragraph counts differ from the library Hebrew: ' + str(mismatch)
        toc = rd(data / 'peri-tzadik/toc.json'); published = leaves(toc['toc'])
        for s in secs:
            assert rd(data / f"peri-tzadik/{s['id']}.json") == rd(OUTPUT / f"{s['id']}.json"), 'Published chapter differs: ' + s['ref']
            found = [l for l in published if l.get('ref') == s['ref'] and l.get('interlinear')]
            assert len(found) == 1 and found[0]['id'] == s['id'] and found[0]['shape'] == s['paragraphs'], s['ref']
            sc = [x for x in book['sections'] if x['ref'] == s['ref'] and x.get('moadimEdition')]
            assert len(sc) == 1, s['ref']; sc = sc[0]
            paras = text['paras'][sc['first']:sc['first'] + sc['count']]
            assert len(paras) == s['paragraphs'] and [p['r'] for p in paras] == [f"{s['ref']}:{i}" for i in range(1, s['paragraphs'] + 1)]
            items = [x for x in rd(OUTPUT / f"{s['id']}.json") if 'p' in x]
            assert [p['p'] for p in paras] == [[[plain(h), plain(e)] for h, e in x['p']] for x in items], s['ref'] + ' MCP text'
        for v in m['volumes']:
            assert sha(lib / 'downloads' / v['download']) == v['sha256'], 'Download differs: ' + v['download']
        assert (site / 'mcp-data/text/peri-tzadik.json').stat().st_size <= 45_000_000
        if archives:
            files = rd(data / 'files.json'); index = rd(lib / 'downloads/index.json')
            assert files['version'] == index['version']
            entries = [index['library'], next(b for b in index['books'] if b['slug'] == 'peri-tzadik')]
            for entry in entries:
                f = lib / entry['file']; assert f.stat().st_size == entry['bytes']
                with ZipFile(f) as z:
                    assert z.testzip() is None
                    assert len([x for x in z.namelist() if x.startswith('data/')]) == entry['dataFiles']
                    for s in secs: assert z.read(f"data/peri-tzadik/{s['id']}.json") == (data / 'peri-tzadik' / f"{s['id']}.json").read_bytes()
                    for v in m['volumes']: assert z.read('downloads/' + v['download']) == (SOURCE / v['file']).read_bytes()
                    if entry is index['library']:
                        for x in files['files'] + ['files.json']: assert z.read('data/' + x) == (data / x).read_bytes(), 'Library ZIP differs: ' + x
        result |= {'site': True, 'hebrewParagraphCountsMatch': True, 'archives': archives}
    print(json.dumps(result)); return result


if __name__ == '__main__': verify(next((x for x in sys.argv[1:] if not x.startswith('--')), None), '--archives' in sys.argv)

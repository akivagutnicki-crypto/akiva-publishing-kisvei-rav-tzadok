#!/usr/bin/env python3
"""Prove the Pri Tzaddik Vayikra, Bamidbar and Devarim editions transferred whole (adapted from scripts/pri-moadim/verify.py).

Offline: the committed reader chapters match the manifest (ids, refs known to the library, paragraph numbering, note
numbering in reading order, Sefaria-only links, the Word source unchanged and under 10 MB). With SITE: the reader, the MCP
text and the downloads carry the edition, paragraph counts equal the library's own Hebrew, and (--archives) both text
archives hold it.

Usage: verify.py [SITE] [--archives]
"""
import hashlib, html, json, re, sys
from pathlib import Path
from zipfile import ZipFile

SOURCE = Path('sources/akiva/pri-vbd-20261126'); OUTPUT = Path('sources/akiva/overlays/pri-vbd-20261126'); KEY = 'vbdEdition'


def rd(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def plain(s): return html.unescape(re.sub('<[^>]*>', '', s))
def leaves(x): return sum((leaves(c) for c in x['children']), []) if 'children' in x else [x]


def verify(site=None, archives=False):
    m = rd(OUTPUT / 'manifest.json'); secs = m['sections']
    valid = {l.strip() for l in open('sources/mafteach/library-refs.txt', encoding='utf-8') if l.strip()}
    assert len({s['id'] for s in secs}) == len(secs) and len({s['ref'] for s in secs}) == len(secs)
    assert all(s['ref'] in valid for s in secs), [s['ref'] for s in secs if s['ref'] not in valid][:10]
    totals = {'paragraphs': 0, 'pairs': 0, 'footnotes': 0}
    for v in m['volumes']:
        f = SOURCE / v['file']; assert sha(f) == v['sha256'] and f.stat().st_size <= 10_000_000, v['file']
        seen = []
        for s in [s for s in secs if s['volume'] == v['volume']]:
            items = rd(OUTPUT / f"{s['id']}.json")
            assert [x['n'] for x in items if 'p' in x] == list(range(1, s['paragraphs'] + 1)), s['ref']
            pairs = sum(len(x['p']) for x in items if 'p' in x); assert pairs == s['pairs'], s['ref']
            notes = 0
            for it in items:
                for ih in it.get('inlineHeadings', []): assert 0 <= ih['phraseIndex'] < len(it['p'])
                for fn in it.get('footnotes', []):
                    assert 0 <= fn['phraseIndex'] < len(it['p']), (s['ref'], fn['sourceId'])
                    he = plain(it['p'][fn['phraseIndex']][0]).strip()
                    assert he.startswith(fn['heAnchorPrefix']) and fn['heCharOffset'] == len(fn['heAnchorPrefix']), (s['ref'], fn['sourceId'], 'anchor')
                    for p in fn['paragraphs']:
                        assert p['text'].strip(), (s['ref'], fn['sourceId'], 'empty note')
                        for r in p['rich']: assert not r.get('href') or r['href'].startswith('https://www.sefaria.org/'), 'Non-Sefaria link'
                    seen.append(fn['number']); notes += 1
            assert notes == s['notes'], s['ref']
            totals['paragraphs'] += s['paragraphs']; totals['pairs'] += pairs
        assert seen == list(range(1, v['footnotes'] + 1)), (v['label'], 'numbering')
        totals['footnotes'] += v['footnotes']
    assert (totals['paragraphs'], totals['pairs'], totals['footnotes']) == (m['paragraphs'], m['pairs'], m['footnotes']), totals
    result = {'ok': True, 'edition': m['edition'], 'sections': len(secs), **totals}
    if site:
        site = Path(site); lib = site / 'library'; data = lib / 'data'
        cat = rd(site / 'mcp-data/catalog.json'); book = next(b for b in cat['books'] if b['slug'] == 'peri-tzadik')
        tp = site / 'mcp-data/text/peri-tzadik.json'; text = rd(tp)
        if text.get('parts'):   # published in parts under 10 MB (release.py write_text)
            paras = [q for k in range(1, text['parts'] + 1) for q in rd(tp.with_name(f'peri-tzadik.part{k}.json'))['paras']]
            assert len(paras) == text['n']; text = {'paras': paras}
        hebrew = {}
        for sc in book['sections']:
            if sc.get('il') or sc.get('edition') == 'interlinear': continue
            hebrew.setdefault(sc['ref'], text['paras'][sc['first']:sc['first'] + sc['count']])
        mismatch = [(s['ref'], s['paragraphs'], len(hebrew.get(s['ref'], []))) for s in secs if len(hebrew.get(s['ref'], [])) != s['paragraphs']]
        assert not mismatch, 'Paragraph counts differ from the library Hebrew: ' + str(mismatch[:10])
        toc = rd(data / 'peri-tzadik/toc.json'); published = leaves(toc['toc'])
        for s in secs:
            assert rd(data / f"peri-tzadik/{s['id']}.json") == rd(OUTPUT / f"{s['id']}.json"), 'Published chapter differs: ' + s['ref']
            found = [l for l in published if l.get('ref') == s['ref'] and l.get('interlinear')]
            assert len(found) == 1 and found[0]['id'] == s['id'] and found[0]['shape'] == s['paragraphs'] and found[0]['en'] == s['title'], s['ref']
            sc = [x for x in book['sections'] if x['ref'] == s['ref'] and x.get(KEY)]
            assert len(sc) == 1, s['ref']; sc = sc[0]
            paras = text['paras'][sc['first']:sc['first'] + sc['count']]
            items = [x for x in rd(OUTPUT / f"{s['id']}.json") if 'p' in x]
            assert [p['r'] for p in paras] == [f"{s['ref']}:{i}" for i in range(1, s['paragraphs'] + 1)], s['ref']
            assert [p['p'] for p in paras] == [[[plain(h), plain(e)] for h, e in x['p']] for x in items], s['ref'] + ' MCP text'
            assert [len(p.get('f', [])) for p in paras] == [len(x.get('footnotes', [])) for x in items], s['ref'] + ' MCP notes'
        for v in m['volumes']:
            assert sha(lib / 'downloads' / v['download']) == v['sha256'], 'Download differs: ' + v['download']
            if v.get('pdfSha256'): assert sha(lib / 'downloads' / v['pdfDownload']) == v['pdfSha256']
        assert all(f.stat().st_size <= 10_000_000 for f in (site / 'mcp-data/text').glob('peri-tzadik*.json')), 'Pri Tzaddik MCP file over 10 MB'
        if archives:
            files = rd(data / 'files.json'); index = rd(lib / 'downloads/index.json')
            assert files['version'] == index['version']
            for entry in [index['library'], next(b for b in index['books'] if b['slug'] == 'peri-tzadik')]:
                f = lib / entry['file']; assert f.stat().st_size == entry['bytes']
                with ZipFile(f) as z:
                    assert z.testzip() is None
                    for s in secs: assert z.read(f"data/peri-tzadik/{s['id']}.json") == (data / 'peri-tzadik' / f"{s['id']}.json").read_bytes()
                    for v in m['volumes']: assert z.read('downloads/' + v['download']) == (SOURCE / v['file']).read_bytes()
        result |= {'site': True, 'hebrewParagraphCountsMatch': True, 'archives': archives}
    print(json.dumps(result)); return result


if __name__ == '__main__': verify(next((x for x in sys.argv[1:] if not x.startswith('--')), None), '--archives' in sys.argv)

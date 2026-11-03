#!/usr/bin/env python3
"""Put the reviewed footnotes of Pri Tzaddik Toldos 1-10 into a complete site (the live publication restored by the
release): each paragraph's footnotes are replaced by the reviewed ones (the automatic notes go); the text itself is
checked to be the published Toldos text and is not changed. Also the MCP text's notes for these paragraphs, the
offline manifest and the cache keys. Run by scripts/mafteach-release.py apply and by pages.yml before upload.

Usage: python3 scripts/pri-toldos-review/apply.py SITE
"""
import json, re, sys, os, gzip, base64, hashlib, html as H
from pathlib import Path

NOTES = Path('sources/akiva/overlays/pri-toldos-review/reader-notes.json')
PACK = Path('sources/akiva/overlays/pri-toldos.json.gz.b64')
def rd(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def wr(p, v): Path(p).write_text(json.dumps(v, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
def plain(s): return H.unescape(re.sub(r'<[^>]+>', '', s or ''))
def squash(s): return re.sub(r'\s+', '', plain(s))

def apply(site):
    if not NOTES.exists(): print('Toldos review: no notes'); return []
    site = Path(site); lib = site / 'library'; data = lib / 'data'; pt = data / 'peri-tzadik'
    notes = rd(NOTES)
    edition = 'pri-toldos-review-' + hashlib.sha256(NOTES.read_bytes()).hexdigest()[:10]
    pack = json.loads(gzip.decompress(base64.b64decode(PACK.read_text())))
    packtext = {f"Peri Tzadik, Toldot {s['chapter']}": {it['n']: [squash(h) for h, _ in it['p']] for it in s['items'] if 'p' in it} for s in pack['sections']}
    toc = rd(pt / 'toc.json')
    ids = {}
    def walk(n):
        if n.get('ref') in notes and n.get('interlinear') and n.get('id') is not None: ids[n['ref']] = n['id']
        for c in n.get('children', []): walk(c)
    walk(toc['toc'])
    changed, total = set(), 0
    for ref, per in notes.items():
        assert ref in ids, f'{ref}: not in the reader contents'
        f = pt / f'{ids[ref]}.json'; items = rd(f)
        for it in items:
            if 'p' not in it or 'n' not in it: continue
            want = packtext[ref].get(it['n'])
            assert want == [squash(h) for h, _ in it['p']], f'{ref}:{it["n"]}: the text differs from the published Toldos text'
            new = per.get(str(it['n']), [])
            for fn in new:
                ph = plain(it['p'][fn['phraseIndex']][0])
                assert ph[:fn['heCharOffset']] == fn['heAnchorPrefix'], f'{ref}:{it["n"]}: note {fn["number"]} anchor moved'
            if new: it['footnotes'] = new
            else: it.pop('footnotes', None)
            total += len(new)
        wr(f, items); changed.add(f)
    # MCP text: the notes of these paragraphs (scripts/build-mcp-index.mjs format), no larger than the live file
    mcp = site / 'mcp-data/text/peri-tzadik.json'
    if mcp.exists():
        old_size = mcp.stat().st_size; text = rd(mcp)
        mine = []
        for p in text['paras']:
            m = re.match(r'^(Peri Tzadik, Toldot \d+):(\d+)$', p['r'])
            if not m or m.group(1) not in notes or not isinstance(p.get('p'), list): continue
            new = notes[m.group(1)].get(m.group(2), [])
            p['_full'] = [[str(x['number']), '\n'.join(q['text'] for q in x['paragraphs']), x['phraseIndex'], 'h', x['heCharOffset']] for x in new]
            mine.append(p)
        for cap in [None] + list(range(1600, 99, -100)) + [80, 60, 40]:   # down to the reference line alone
            for p in mine:
                fs = [[a, b if cap is None or len(b) <= cap else b[:cap].rsplit(' ', 1)[0] + ' … (full note in the reader)', *c] for a, b, *c in p['_full']]
                if fs: p['f'] = fs
                else: p.pop('f', None)
            body = {**text, 'paras': [{k: v for k, v in p.items() if k != '_full'} for p in text['paras']]}
            size = len(json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode())
            if size <= old_size or old_size <= 10_000_000: break
        wr(mcp, body); changed.add(mcp)
        print('MCP text:', old_size, '->', size, 'bytes')
    # offline manifest and cache keys
    files = rd(data / 'files.json')['files']
    h, n = hashlib.sha256(), 0
    for name in files:
        b = (data / name).read_bytes(); h.update(name.encode()); h.update(b'\0'); h.update(b); n += len(b)
    wr(data / 'files.json', {'version': h.hexdigest()[:16], 'bytes': n, 'files': files}); changed.add(data / 'files.json')
    page = lib / 'index.html'; s = page.read_text(encoding='utf-8')
    s = re.sub(r'/\* Toldos review data revision \*/[^\n]*\n', '', s)
    prefix = 'const editionDataUrl = url => '
    assert s.count(prefix) == 1
    s = s.replace(prefix, prefix + f"/* Toldos review data revision */ (url.startsWith('data/peri-tzadik/') || url === 'data/files.json') ? url + '?edition={edition}' :\n")
    page.write_text(s, encoding='utf-8'); changed.add(page)
    sw = lib / 'sw.js'; t = sw.read_text(encoding='utf-8')
    t = re.sub(r'-pri-toldos-review-[a-z0-9]+', '', t)
    t = re.sub(r'const SHELL = `([^`]+)`;', lambda m: 'const SHELL = `' + m.group(1) + '-pri-toldos-review-' + edition[-10:] + '`;', t, count=1)
    sw.write_text(t, encoding='utf-8'); changed.add(sw)
    print(f'Toldos reviewed footnotes {edition}: {len(notes)} maamarim, {total} notes')
    return sorted(str(p.relative_to(site)) for p in changed)

if __name__ == '__main__':
    print('\n'.join(apply(sys.argv[1])))

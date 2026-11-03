#!/usr/bin/env python3
"""Put the reviewed Pri Tzaddik Chayei Sarah 1-11 into a complete site (the live publication restored by the
release workflow): the reader's chapter files, contents, citation index, offline-download manifest and cache
keys, and the MCP server's text of these maamarim. Nothing else changes; run by scripts/mafteach-release.py apply.

Usage: python3 scripts/pri-chayei-review/apply.py SITE   (SITE contains library/ and mcp-data/)
"""
import json, os, re, sys, glob, hashlib, shutil, subprocess, tempfile, html as H
from pathlib import Path

SRC = Path('sources/akiva/overlays/pri-chayei-sara-review/reader')
META = json.loads((SRC / 'meta.json').read_text(encoding='utf-8'))
EDITION = META['edition'] + '-' + hashlib.sha256(b''.join((SRC / f"{m['id']}.json").read_bytes() for m in META['maamarim'])).hexdigest()[:10]

def rd(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def wr(p, v, sort=False): Path(p).write_text(json.dumps(v, ensure_ascii=False, separators=(',', ':'), sort_keys=sort), encoding='utf-8')
def plain(s): return H.unescape(re.sub(r'<[^>]+>', '', s or ''))

def category(ref):
    if re.match(r'^(Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|I+ Samuel|I+ Kings|Isaiah|Jeremiah|Ezekiel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Psalms|Proverbs|Job|Song of Songs|Ruth|Lamentations|Ecclesiastes|Esther|Daniel|Ezra|Nehemiah|I+ Chronicles) ', ref): return 'Tanakh'
    if ref.startswith(('Zohar', 'Tikkunei')): return 'Kabbalah'
    if 'Rabbah' in ref or ref.startswith(('Midrash', 'Pesikta', 'Pirkei DeRabbi', 'Mekhilta', 'Sifrei', 'Sifra', 'Yalkut')): return 'Midrash'
    if ref.startswith(('Rashi', 'Tosafot', 'Ramban', 'Rabbeinu')): return 'Commentary'
    return 'Talmud'

def apply(site):
    site = Path(site); lib = site / 'library'; data = lib / 'data'; pt = data / 'peri-tzadik'
    changed = set()
    refs = {m['ref']: m for m in META['maamarim']}
    # 1. chapter files
    new_items = {}
    for m in META['maamarim']:
        items = rd(SRC / f"{m['id']}.json"); new_items[m['ref']] = items
        target = pt / f"{m['id']}.json"
        assert target.exists(), f'{target} missing: is this the Pri Tzaddik study edition?'
        shutil.copyfile(SRC / f"{m['id']}.json", target); changed.add(target)
    # 2. contents: titles and paragraph counts; catalog segment count
    toc = rd(pt / 'toc.json'); delta = 0
    def walk(n):
        nonlocal delta
        if n.get('ref') in refs and n.get('interlinear') and n.get('id') == refs[n['ref']]['id']:
            m = refs[n['ref']]; delta += m['paragraphs'] - (n.get('shape') or 0)
            n['en'] = m['title']; n['shape'] = m['paragraphs']; n['reviewedEdition'] = META['edition']
        for c in n.get('children', []): walk(c)
    walk(toc['toc']); wr(pt / 'toc.json', toc); changed.add(pt / 'toc.json')
    cat = rd(data / 'catalog.json')
    for b in cat:
        if b['slug'] == 'peri-tzadik': b['segments'] = b.get('segments', 0) + delta
    wr(data / 'catalog.json', cat); changed.add(data / 'catalog.json')
    # 3. citation links: each source keeps its link, anchored at the new paragraph whose notes name it
    links = rd(pt / 'links.json')
    def where(items, r):
        words = [w for w in re.split(r'[\s,:]+', r) if w]
        best, n0 = None, 0
        for it in items:
            if 'p' not in it: continue
            text = ' '.join(p['text'] for f in it.get('footnotes', []) for p in f['paragraphs'])
            score = sum(1 for w in words if w in text)
            if score > n0: best, n0 = it['n'], score
        return best or 1
    for ref, items in new_items.items():
        old = links.get(ref, [])
        links[ref] = [dict(l, a=f"{ref}:{where(items, l['r'])}") for l in old]
    wr(pt / 'links.json', dict(sorted(links.items())), sort=False); changed.add(pt / 'links.json')
    # reverse index (data/cited/<source>.json): replace these maamarim's anchors
    cited = data / 'cited'
    for f in cited.glob('*.json'):
        if f.name in ('index.json', 'search.json'): continue
        d = rd(f); mod = False
        for src, anchors in list(d.items()):
            keep = [a for a in anchors if not any(a.startswith(r + ':') for r in refs)]
            add = [l['a'] for r in refs for l in links.get(r, []) if l['r'] == src]
            new = keep + [a for a in dict.fromkeys(add) if a not in keep]
            if new != anchors: d[src] = new; mod = True
        if mod: wr(f, d); changed.add(f)
    # 4. offline-download manifest
    files = rd(data / 'files.json')['files']          # the same file list as published; only the contents changed
    h, total = hashlib.sha256(), 0
    for f in files:
        b = (data / f).read_bytes(); h.update(f.encode()); h.update(b'\0'); h.update(b); total += len(b)
    wr(data / 'files.json', {'version': h.hexdigest()[:16], 'bytes': total, 'files': files}); changed.add(data / 'files.json')
    # 5. cache keys: a new edition query for Pri Tzaddik data, a new service-worker shell
    page = lib / 'index.html'; s = page.read_text(encoding='utf-8')
    s = re.sub(r'/\* Chayei Sarah review data revision \*/[^\n]*\n', '', s)
    prefix = 'const editionDataUrl = url => '
    assert s.count(prefix) == 1, 'reader data URL function not found'
    s = s.replace(prefix, prefix + f"/* Chayei Sarah review data revision */ (url.startsWith('data/peri-tzadik/') || url === 'data/catalog.json' || url.startsWith('data/cited/') || url === 'data/files.json') ? url + '?edition={EDITION}' :\n")
    page.write_text(s, encoding='utf-8'); changed.add(page)
    sw = lib / 'sw.js'; t = sw.read_text(encoding='utf-8')
    t = re.sub(r'-pri-chayei-review-[a-z0-9-]+', '', t)
    t = re.sub(r'const SHELL = `([^`]+)`;', lambda m: 'const SHELL = `' + m.group(1) + '-pri-chayei-review-' + EDITION[-10:] + '`;', t, count=1)
    sw.write_text(t, encoding='utf-8'); changed.add(sw)
    # 6. the MCP server's text of these maamarim, in its own paragraph format (scripts/build-mcp-index.mjs)
    mcp = site / 'mcp-data'
    if (mcp / 'text/peri-tzadik.json').exists():
        text, mcat = rd(mcp / 'text/peri-tzadik.json'), rd(mcp / 'catalog.json')
        book = next(b for b in mcat['books'] if b['slug'] == 'peri-tzadik')
        secs = book['sections']
        for ref, items in new_items.items():
            si = next((i for i, x in enumerate(secs) if x['ref'] == ref and x.get('il')), None)
            if si is None: continue
            paras, pending = [], [ ]
            for it in items:
                if 'h' in it and 'p' not in it: pending.append(it['h']); continue
                pairs = [[re.sub(r'\s+', ' ', plain(h)).strip(), re.sub(r'\s+', ' ', plain(e)).strip()] for h, e in it['p']]
                para = {'r': f"{ref}:{it['n']}", 's': si, 'n': it['n'], 'p': pairs}
                notes = [[str(f['number']), '\n'.join(x['text'] for x in f['paragraphs']), f['phraseIndex'], 'h', f['heCharOffset']] for f in it.get('footnotes', [])]
                if notes: para['f'] = notes
                if pending: para['h'] = pending; pending = []
                paras.append(para)
            if pending and paras: paras[-1]['h2'] = pending
            old = [i for i, p in enumerate(text['paras']) if p['s'] == si]
            at = old[0] if old else len(text['paras'])
            text['paras'] = [p for p in text['paras'] if p['s'] != si]
            text['paras'][at:at] = paras
        # sections' first paragraph and count, in reading order
        first, count = {}, {}
        for i, p in enumerate(text['paras']):
            first.setdefault(p['s'], i); count[p['s']] = count.get(p['s'], 0) + 1
        for i, x in enumerate(secs):
            if i in first: x['first'], x['count'] = first[i], count[i]
        book['paragraphs'] = len(text['paras'])
        wr(mcp / 'text/peri-tzadik.json', text); wr(mcp / 'catalog.json', mcat)
        changed |= {mcp / 'text/peri-tzadik.json', mcp / 'catalog.json'}
    print(f'Chayei Sarah reviewed edition {EDITION}: {len(META["maamarim"])} maamarim, {sum(m["paragraphs"] for m in META["maamarim"])} paragraphs, '
          f'{sum(m["notes"] for m in META["maamarim"])} notes; {len(changed)} files changed')
    return sorted(str(p.relative_to(site)).replace(os.sep, '/') for p in changed)

if __name__ == '__main__':
    print('\n'.join(apply(sys.argv[1])))

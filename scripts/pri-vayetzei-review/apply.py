#!/usr/bin/env python3
"""Add the Akiva Publishing interlinear study edition of Pri Tzaddik Vayetzei 1-10 (with reviewed footnotes) to a complete
site (the live publication restored by the release, or dist/ in pages.yml): the reader's chapter files and contents, the source
links and citation index, the offline manifest and cache keys, and the MCP server's catalog and text. Idempotent: running it
twice gives the same site. Built by scripts/pri-vayetzei-review/build.py.

Usage: python3 scripts/pri-vayetzei-review/apply.py SITE
"""
import json, re, sys, hashlib, shutil, html as H
from pathlib import Path

SRC = Path('sources/akiva/overlays/pri-vayetzei-review/reader')
GROUP = {'en': 'Vayetzei · 10 teachings', 'he': 'ויצא', 'vayetzeiEdition': True}
STUDY = 'Akiva Publishing — Interlinear Study Edition'
def rd(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def wr(p, v): Path(p).write_text(json.dumps(v, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
def plain(s): return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', '', s or ''))).strip()

def apply(site):
    if not (SRC / 'meta.json').exists(): print('Vayetzei edition: not built'); return []
    meta = rd(SRC / 'meta.json'); ms = meta['maamarim']
    edition = 'pri-vayetzei-review-' + hashlib.sha256(b''.join((SRC / f"{m['id']}.json").read_bytes() for m in ms) + (SRC / 'meta.json').read_bytes()).hexdigest()[:10]
    site = Path(site); lib = site / 'library'; data = lib / 'data'; pt = data / 'peri-tzadik'
    changed = set(); refs = {m['ref']: m for m in ms}
    # 1. chapter files
    for m in ms:
        shutil.copyfile(SRC / f"{m['id']}.json", pt / f"{m['id']}.json"); changed.add(pt / f"{m['id']}.json")
    # 2. contents: a Vayetzei group in the study edition, after Toldos
    toc = rd(pt / 'toc.json')
    study = next(n for n in toc['toc']['children'] if n.get('en') == STUDY)
    old = next((g for g in study['children'] if g.get('vayetzeiEdition')), None)
    before = sum(l.get('shape') or 0 for l in old['children']) if old else 0
    if old: study['children'].remove(old)
    leaves = [{'en': f"Vayetzei Ois {m['ois']} · {m['title']}", 'he': m['he'], 'id': m['id'], 'depth': 1, 'shape': m['paragraphs'],
               'il1': True, 'interlinear': True, 'ref': m['ref'], 'heRef': f"פרי צדיק, ויצא {m['ois']}", 'sep': ':',
               'parashah': 'Vayetzei', 'ois': m['ois'], 'sourceUrl': f"https://www.sefaria.org/Peri_Tzadik,_Vayetzei.{m['ois']}",
               'editorialHeadings': True, 'reviewedEdition': meta['edition']} for m in ms]
    group = dict(GROUP, children=leaves)
    at = next((i + 1 for i, g in enumerate(study['children']) if g.get('toldosEdition')), len(study['children']))
    study['children'].insert(at, group)
    wr(pt / 'toc.json', toc); changed.add(pt / 'toc.json')
    delta = sum(m['paragraphs'] for m in ms) - before
    cat = rd(data / 'catalog.json')
    for b in cat:
        if b['slug'] == 'peri-tzadik': b['segments'] = b.get('segments', 0) + delta
    wr(data / 'catalog.json', cat); changed.add(data / 'catalog.json')
    # 3. source links of these maamarim (the reader's source connections), and the reverse index data/cited/<source>.json
    links = rd(pt / 'links.json')
    for ref, m in refs.items(): links[ref] = [{'a': l['a'], 'c': l['c'], 'r': l['r']} for l in m['links']]
    wr(pt / 'links.json', dict(sorted(links.items()))); changed.add(pt / 'links.json')
    cited = data / 'cited'
    if cited.is_dir():
        for f in cited.glob('*.json'):
            if f.name in ('index.json', 'search.json'): continue
            d = rd(f); mod = False
            for src, anchors in list(d.items()):
                if not isinstance(anchors, list): continue
                keep = [a for a in anchors if not any(isinstance(a, str) and a.startswith(r + ':') for r in refs)]
                add = [l['a'] for r in refs for l in links.get(r, []) if l['r'] == src]
                new = keep + [a for a in dict.fromkeys(add) if a not in keep]
                if new != anchors: d[src] = new; mod = True
            if mod: wr(f, d); changed.add(f)
    # 4. offline manifest: the new chapter files join the list
    man = rd(data / 'files.json'); files = man['files']
    for m in ms:
        name = f"peri-tzadik/{m['id']}.json"
        if name not in files: files.append(name)
    h, n = hashlib.sha256(), 0
    for name in files:
        b = (data / name).read_bytes(); h.update(name.encode()); h.update(b'\0'); h.update(b); n += len(b)
    wr(data / 'files.json', {**man, 'version': h.hexdigest()[:16], 'bytes': n, 'files': files}); changed.add(data / 'files.json')
    # 5. cache keys
    page = lib / 'index.html'; s = page.read_text(encoding='utf-8')
    s = re.sub(r'/\* Vayetzei edition data revision \*/[^\n]*\n', '', s)
    prefix = 'const editionDataUrl = url => '
    assert s.count(prefix) == 1, 'reader data URL function not found'
    s = s.replace(prefix, prefix + f"/* Vayetzei edition data revision */ (url.startsWith('data/peri-tzadik/') || url === 'data/catalog.json' || url.startsWith('data/cited/') || url === 'data/files.json') ? url + '?edition={edition}' :\n")
    page.write_text(s, encoding='utf-8'); changed.add(page)
    sw = lib / 'sw.js'; t = sw.read_text(encoding='utf-8')
    t = re.sub(r'-pri-vayetzei-review-[a-z0-9]+', '', t)
    t = re.sub(r'const SHELL = `([^`]+)`;', lambda mm: 'const SHELL = `' + mm.group(1) + '-pri-vayetzei-review-' + edition[-10:] + '`;', t, count=1)
    sw.write_text(t, encoding='utf-8'); changed.add(sw)
    # 6. MCP server: the interlinear sections (after Toldos) and their paragraphs (scripts/build-mcp-index.mjs format)
    mcp = site / 'mcp-data'
    if (mcp / 'text/peri-tzadik.json').exists():
        old_size = (mcp / 'text/peri-tzadik.json').stat().st_size
        text, mcat = rd(mcp / 'text/peri-tzadik.json'), rd(mcp / 'catalog.json')
        book = next(b for b in mcat['books'] if b['slug'] == 'peri-tzadik')
        secs = book['sections']
        # remove an earlier run of this edition
        gone = [i for i, x in enumerate(secs) if x.get('il') and x['ref'] in refs]
        if gone:
            keep = [i for i in range(len(secs)) if i not in gone]
            remap = {o: j for j, o in enumerate(keep)}
            text['paras'] = [dict(p, s=remap[p['s']]) for p in text['paras'] if p['s'] not in gone]
            secs[:] = [secs[i] for i in keep]
        ins = next((i + 1 for i in range(len(secs) - 1, -1, -1) if secs[i].get('il') and secs[i]['ref'].startswith('Peri Tzadik, Toldot')), len(secs))
        path = f"{STUDY} › {GROUP['en']}"
        new_secs = [{'ref': m['ref'], 'he': f"פרי צדיק, ויצא {m['ois']}", 'title': f"Vayetzei Ois {m['ois']} · {m['title']}", 'heTitle': m['he'],
                     'path': path, 'il': True, 'first': 0, 'count': m['paragraphs'], 'parashah': 'Vayetzei', 'ois': m['ois'], 'edition': 'interlinear'} for m in ms]
        for p in text['paras']:
            if p['s'] >= ins: p['s'] += len(new_secs)
        secs[ins:ins] = new_secs
        paras_new = []
        for j, m in enumerate(ms):
            si = ins + j; pending = []
            for it in rd(SRC / f"{m['id']}.json"):
                if 'h' in it and 'p' not in it: pending.append(it['h']); continue
                pairs = [[plain(h), plain(e)] for h, e in it['p']]
                para = {'r': f"{m['ref']}:{it['n']}", 's': si, 'n': it['n'], 'p': pairs}
                c = [[l['r'], l['c']] for l in m['links'] if l['a'] == para['r']]
                if c: para['c'] = c
                notes = [[str(f['number']), '\n'.join(x['text'] for x in f['paragraphs']), f['phraseIndex'], 'h', f['heCharOffset']] for f in it.get('footnotes', [])]
                if notes: para['f'] = notes
                if pending: para['h'] = pending; pending = []
                paras_new.append(para)
        # in reading order: just after the paragraphs of the section before
        pos = max((i + 1 for i, p in enumerate(text['paras']) if p['s'] < ins), default=0)
        text['paras'][pos:pos] = paras_new
        first, count = {}, {}
        for i, p in enumerate(text['paras']): first.setdefault(p['s'], i); count[p['s']] = count.get(p['s'], 0) + 1
        for i, x in enumerate(secs):
            if i in first: x['first'], x['count'] = first[i], count[i]
        book['paragraphs'] = len(text['paras'])
        # the file was already over 10 MB on the live site and may not grow: the MCP copies of footnotes are shortened, longest
        # first, everywhere in Pri Tzaddik as far as needed (the reader keeps every note in full; kisvei_get_text links to it)
        full = [(p, [list(f) for f in p['f']]) for p in text['paras'] if p.get('f')]
        size = None
        for cap in [None] + list(range(3000, 199, -100)):
            for p, fs in full:
                p['f'] = [[f[0], f[1] if cap is None or len(f[1]) <= cap else f[1][:cap].rsplit(' ', 1)[0] + ' … (full note in the reader)', *f[2:]] for f in fs]
            size = len(json.dumps(text, ensure_ascii=False, separators=(',', ':')).encode())
            if size <= old_size or old_size <= 10_000_000: break
        assert size <= old_size or old_size <= 10_000_000, f'MCP text would grow: {old_size} -> {size}'
        print('MCP text:', old_size, '->', size, 'bytes; note copies', 'in full' if cap is None else f'capped at {cap} characters')
        wr(mcp / 'text/peri-tzadik.json', text); wr(mcp / 'catalog.json', mcat)
        changed |= {mcp / 'text/peri-tzadik.json', mcp / 'catalog.json'}
    print(f"Vayetzei edition {edition}: {len(ms)} maamarim, {sum(m['paragraphs'] for m in ms)} paragraphs, {sum(m['notes'] for m in ms)} notes")
    return sorted(str(p.relative_to(site)) for p in changed)

if __name__ == '__main__':
    print('\n'.join(apply(sys.argv[1])))

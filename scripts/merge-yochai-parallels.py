#!/usr/bin/env python3
"""Merge sources/mafteach/yochai-parallels.json into the Parallels panel's outside parallels (dist/library/genre-parallels/).
Each lead becomes [Sefaria ref, Hebrew title, genre, 1.0, 'yochai', [], 'Yochai: both cite <source>']; earlier Yochai items
are replaced, so the merge can run again. A passage keeps at most 4 Yochai leads, after its model-found parallels."""
import json, os, re
D = 'dist/library/genre-parallels'
y = json.load(open('sources/mafteach/yochai-parallels.json'))['passages']
idx = json.load(open(f'{D}/index.json'))
SHOW = {'Genesis': 'Bereishis', 'Bereshit Rabbah': 'Bereishis Rabbah', 'Shabbat': 'Shabbos'}
def show(ref):
    m = re.match(r'(.+?) ([\d:ab]+)$', ref)
    return f"{SHOW.get(m[1], m[1])} {m[2]}" if m else ref
def key_of(ref):
    if ref.startswith('Peri Tzadik, '): return re.sub(r'\s+\d+$', '', ref)
    return max((k for k in idx['books'] if ref == k or ref.startswith(k + ' ') or ref.startswith(k + ',')), key=len, default=None)
slug = lambda b: re.sub(r'[^a-z0-9]+', '-', b.lower()).strip('-')
files = {}; added = missing = 0
def load(k):
    if k not in files:
        f = (idx['books'].get(k) or {}).get('file') or slug(k) + '.json'
        p = f'{D}/{f}'
        files[k] = (f, json.load(open(p)) if os.path.exists(p) else {'version': idx['version'], 'passages': {}})
    return files[k][1]
# drop earlier Yochai items everywhere
for k in list(idx['books']):
    for items in load(k)['passages'].values(): items[:] = [x for x in items if x[4] != 'yochai']
for ref, leads in y.items():
    k = key_of(ref)
    if not k: missing += 1; continue
    items = load(k)['passages'].setdefault(ref, [])
    have = {x[0] for x in items}
    for sref, he, genre, via in leads:
        if sref in have: continue
        items.append([sref, he, genre, 1.0, 'yochai', [], f'Yochai: both cite {show(via)}']); have.add(sref); added += 1
for k, (f, data) in files.items():
    p = f'{D}/{f}'
    json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    e = idx['books'].setdefault(k, {}); e.update(file=f, passages=len(data['passages']), bytes=os.path.getsize(p))
idx['yochai'] = 'Leads from the Yochai Knowledge Graph (sources/mafteach/yochai-parallels.json): outside passages that quote the same source as an edition note.'
json.dump(idx, open(f'{D}/index.json', 'w'), ensure_ascii=False, indent=1)
print('Yochai leads added', added, 'passages without a panel file', missing)

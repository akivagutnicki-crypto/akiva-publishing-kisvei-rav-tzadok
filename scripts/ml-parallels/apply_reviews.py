#!/usr/bin/env python3
"""Write reviewers' verdicts into the outside-genre parallels (dist/library/genre-parallels).

Each file in sources/parallels-reviewed/ is one passage read against every parallel the model proposed for it and
against Sefaria (Chassidus, Kabbalah, Machshava, Mussar): candidates graded weak or wrong are removed, those graded
strong or related become tier "reviewed" with the reviewer's one-line reason, and parallels the model missed are added.
Run after scripts/ml-parallels/genre_parallels.py (it rebuilds the shards). Usage: python3 scripts/ml-parallels/apply_reviews.py
"""
import json, glob, os
D, R = 'dist/library/genre-parallels', 'sources/parallels-reviewed'
idx = json.load(open(f'{D}/index.json', encoding='utf-8'))
def shard_of(ref):
    best = None
    for k in idx['books']:
        if (ref == k or ref.startswith(k + ',') or ref.startswith(k + ' ')) and (not best or len(k) > len(best)): best = k
    return best
GENRES = ('Chassidus', 'Kabbalah', 'Machshava', 'Mussar')   # the reader's four outside genres
shards, stats = {}, {'removed': 0, 'reviewed': 0, 'added': 0}
for f in sorted(glob.glob(f'{R}/*.json')):
    rv = json.load(open(f, encoding='utf-8'))
    key = shard_of(rv['ref'])
    if not key: continue
    file = idx['books'][key]['file']
    data = shards.get(file) or shards.setdefault(file, json.load(open(f'{D}/{file}', encoding='utf-8')))
    items = data['passages'].get(rv['ref'], [])
    grade = {c['ref']: c for c in rv.get('candidates', [])}
    out = []
    for it in items:
        g = grade.get(it[0])
        if g and g['grade'] in ('weak', 'wrong'): stats['removed'] += 1; continue
        if g and g['grade'] in ('strong', 'related'):
            it = [it[0], it[1], it[2], 1.0 if g['grade'] == 'strong' else 0.9, 'reviewed', it[5] if len(it) > 5 else [], g['why']]; stats['reviewed'] += 1
        out.append(it)
    have = {it[0] for it in out}
    for x in rv.get('found', []):
        if x['grade'] in ('strong', 'related') and x['ref'] not in have and x.get('genre') in GENRES:
            out.append([x['ref'], '', x['genre'], 1.0 if x['grade'] == 'strong' else 0.9, 'reviewed', [], x['why']]); stats['added'] += 1
    data['passages'][rv['ref']] = out
for file, data in shards.items():
    json.dump(data, open(f'{D}/{file}', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('reviewed parallels applied:', stats)

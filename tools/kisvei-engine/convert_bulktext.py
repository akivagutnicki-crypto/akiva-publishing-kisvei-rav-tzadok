#!/usr/bin/env python3
"""Convert a saved Sefaria bulktext response (tool-result file) into verification records."""
import json, re, sys
src, group_idx, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
groups = json.load(open('out/verify/direct_groups120.json'))
refs = groups[group_idx]
data = json.load(open(src, encoding='utf-8'))
strip = lambda s: re.sub(r'<[^>]+>', '', s)
rows = []
for r in refs:
    v = data.get(r)
    if not v or v.get('error'):
        rows.append({'input': r, 'ok': False, 'ref': None, 'heRef': None, 'url': None, 'category': None, 'he': None, 'en': None, 'resolvedRef': None, 'error': 'not-found'})
        continue
    he = v.get('he'); en = v.get('en')
    def flat(x):
        if isinstance(x, list):
            return ' | '.join(t for t in (flat(y) for y in x) if t)
        return x or ''
    he = flat(he); en = flat(en)
    rows.append({'input': r, 'ok': True, 'ref': v.get('ref'), 'heRef': v.get('heRef'), 'url': v.get('url'), 'category': v.get('primary_category'),
                 'he': strip(he)[:700], 'en': strip(en)[:400], 'resolvedRef': None, 'error': None})
json.dump(rows, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(out, len(rows), 'ok', sum(1 for x in rows if x['ok']), 'missing', [x['input'] for x in rows if not x['ok']])

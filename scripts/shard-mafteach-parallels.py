"""Split mafteach_parallels.json into the reader's per-sefer files (dist/library/mafteach/).
Usage: python3 scripts/shard-mafteach-parallels.py mafteach_parallels.json dist/library/mafteach"""
import json, re, os, sys, collections
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
R = d['reasons']
def cap(i):
    r = R[i]; t = r['type']
    if t == 'line': return ['line', r['he'], r.get('topic') or '', r.get('topic_en') or '']
    if t == 'source_line': return ['quote', r['he'], r.get('source') or '', r.get('sefaria', 0)]
    if t in ('topic', 'subtopic'): return [t, r['he'], r.get('en') or '']
    if t == 'source': return ['source', r.get('key'), '', r.get('sefaria', 0)]
    return ['chapter', r.get('key') or '', r.get('en') or '', r.get('sefaria', 0)]
def book(ref):
    # Pri Tzaddik: one file per section (parsha / festival); other books: one file per book
    if ref.startswith('Peri Tzadik, '): return re.sub(r'\s+\d+$', '', ref)
    return ref.split(',')[0] if ',' in ref else re.sub(r'\s+\d+(?::\d+)*$', '', ref)
slug = lambda b: re.sub(r'[^a-z0-9]+', '-', b.lower()).strip('-')
shards = collections.defaultdict(dict)
for ref, v in d['passages'].items():
    shards[book(ref)][ref] = dict(t=v['topics'], s=v['sources'], p=[[q, sc, [cap(i) for i in rs[:2]]] for q, sc, rs in v['parallels']])
os.makedirs(out, exist_ok=True)
index = {}
for b, ps in shards.items():
    f = slug(b) + '.json'
    json.dump(dict(version=d['meta']['version'], book=b, passages=ps), open(os.path.join(out, f), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    index[b] = dict(file=f, passages=len(ps), bytes=os.path.getsize(os.path.join(out, f)))
json.dump(dict(version=d['meta']['version'], source="HaMafteach HaShalem (R' Chaim Hirsch), OCR", books=index), open(os.path.join(out, 'index.json'), 'w'), ensure_ascii=False, indent=1)
for b, i in sorted(index.items(), key=lambda x: -x[1]['bytes'])[:6]: print(f"{i['bytes']/1e6:6.2f} MB {i['passages']:5d}  {b}")
print('files', len(index), 'total', round(sum(i['bytes'] for i in index.values())/1e6, 2), 'MB')

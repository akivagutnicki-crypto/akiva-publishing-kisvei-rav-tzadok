#!/usr/bin/env python3
"""Link HaMafteach page references to library passages, using the print-page maps (sources/mafteach/print-pages/).

For each reference of a mapped sefer that the index left without a library passage and that cites the original print
by page (דצ-35, תה-57-55, מח-חה(2) …), the candidates are the passages on the cited page(s); the one sharing the most
of the index line's words is chosen. The reference keeps its label and gets the flag "p" (linked by print page), which
the MCP tools show. Only maps whose paragraph-level check is at least twice a random page and at least 20% are used.
Usage: link.py [DIST=dist/mcp-data]   (reads/writes sources/mafteach/entries.jsonl.gz)
"""
import collections, gzip, json, re, sys, glob
from pathlib import Path

DIST = sys.argv[1] if len(sys.argv) > 1 else 'dist/mcp-data'
FIN = str.maketrans('ךםןףץ', 'כמנפצ')
B = lambda s: re.sub(r'[֑-ׇ"\'״׳]', '', s or '').translate(FIN)
W = lambda s: re.findall(r'[א-ת]{3,}', B(s))
heOf = lambda p: ' '.join(x[0] for x in p['p']) if p.get('p') else p.get('t', '')
sectionOf = lambda ref: re.sub(r':\d+$', '', ref)

maps = {}
for f in sorted(glob.glob('sources/mafteach/print-pages/*.json')):
    m = json.loads(Path(f).read_text(encoding='utf-8')); c = m['check']
    ok = c['paragraph_words_found'] >= 0.20 and c['paragraph_words_found'] >= 2 * c['paragraph_random_page']
    print(f"{m['book'][:40]:40} {'use' if ok else 'skip'}  paragraph check {c['paragraph_words_found']:.0%} vs random {c['paragraph_random_page']:.0%}")
    if ok: maps[m['book']] = m

def pages_of(code, label):
    m = re.fullmatch(re.escape(code) + r'-(\d+)(?:-(\d+))?', label) or re.fullmatch(re.escape(code) + r'-[א-ת]+\((\d+)(?:-(\d+))?\)(?:\(\d+\))?', label)
    if not m: return None
    a, b = int(m.group(1)), int(m.group(2) or m.group(1))
    return list(range(min(a, b), max(a, b) + 1)) if abs(a - b) <= 6 else None

words = {}
for m in maps.values():
    t = json.loads(Path(f"{DIST}/text/{m['library']}.json").read_text(encoding='utf-8'))
    acc = collections.defaultdict(str)
    for p in t['paras']: acc[sectionOf(p['r'])] += ' ' + heOf(p)
    words.update({s: set(W(v)) for s, v in acc.items()})

path = Path('sources/mafteach/entries.jsonl.gz')
lines = gzip.open(path, 'rt', encoding='utf-8').read().splitlines()
out, linked, per = [], 0, collections.Counter()
for line in lines:
    e = json.loads(line); changed = False
    ews = set(W(e.get('t', '')))
    for r in e.get('r', []):
        if r[1] or len(r) < 3 or r[2] not in maps: continue
        m = maps[r[2]]; pg = pages_of(m['code'], r[0])
        if not pg: continue
        cands = list(dict.fromkeys(s for x in pg for s in m['pages'].get(str(x), [])))
        if not cands: continue
        best = max(cands, key=lambda s: (len(ews & words.get(s, set())), -cands.index(s)))
        r[1] = best
        flags = r[3] if len(r) > 3 else ''
        if len(r) < 4: r.append('')
        r[3] = flags + ('' if 'p' in flags else 'p')
        changed = True; linked += 1; per[r[2]] += 1
    out.append(json.dumps(e, ensure_ascii=False, separators=(',', ':')) if changed else line)
with gzip.open(path, 'wt', encoding='utf-8') as f: f.write('\n'.join(out) + '\n')
print('linked', linked, dict(per))

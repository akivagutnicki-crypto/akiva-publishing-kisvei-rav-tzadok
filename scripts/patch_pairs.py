#!/usr/bin/env python3
"""Replace the English of source interlinear pairs, addressed by the start of their (tag-stripped) Hebrew.
usage: patch_pairs.py fixes.json   where fixes.json = [[hebrew_prefix, new_english], ...]
Fails loudly when a prefix matches zero or several pairs (nothing is written for that entry)."""
import json, glob, re, sys, unicodedata
TAG = re.compile(r'<[^>]+>')
norm = lambda s: re.sub(r'\s+', ' ', unicodedata.normalize('NFC', TAG.sub('', s or ''))).strip()
bare = lambda s: re.sub(r'[\u0591-\u05c7]', '', norm(s))
FILES = [f for f in sorted(glob.glob('sources/akiva/**/*.json', recursive=True))
         if not any(x in f for x in ('annotations', 'editions', 'references', 'hebrew', 'nikud', 'supplements'))]
def pairs(o):
    if isinstance(o, list):
        if len(o) == 2 and all(isinstance(x, str) for x in o): yield o
        else:
            for x in o: yield from pairs(x)
    elif isinstance(o, dict):
        for v in o.values(): yield from pairs(v)
def enc(x): return json.dumps(x, ensure_ascii=False)
def main(fixfile):
    fixes = json.load(open(fixfile, encoding='utf8')); docs = {}
    for f in FILES:
        raw = open(f, encoding='utf8').read(); docs[f] = [raw, json.loads(raw)]
    done = bad = 0
    for pre, new in fixes:
        p = norm(pre); hits = []
        for f, (_, d) in docs.items():
            hits += [(f, pr) for pr in pairs(d) if norm(pr[0]).startswith(p)]
        if not hits:
            q = bare(pre)
            for f, (_, d) in docs.items(): hits += [(f, pr) for pr in pairs(d) if bare(pr[0]).startswith(q)]
        if len(hits) != 1: print('SKIP', len(hits), 'matches for', p[:60]); bad += 1; continue
        f, pr = hits[0]
        pat = re.compile(re.escape(enc(pr[0])) + r'(\s*,\s*)' + re.escape(enc(pr[1])))
        raw = docs[f][0]
        if len(pat.findall(raw)) != 1: print('SKIP raw-match', len(pat.findall(raw)), p[:60]); bad += 1; continue
        docs[f][0] = pat.sub(lambda m: enc(pr[0]) + m.group(1) + enc(new), raw, count=1)
        pr[1] = new; done += 1
    for f, (raw, _) in docs.items():
        if raw != open(f, encoding='utf8').read(): open(f, 'w', encoding='utf8').write(raw)
    print('patched', done, 'skipped', bad)
if __name__ == '__main__': main(sys.argv[1])

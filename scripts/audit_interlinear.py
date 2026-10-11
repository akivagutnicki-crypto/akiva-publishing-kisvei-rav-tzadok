#!/usr/bin/env python3
"""Lint every built interlinear leaf (dist/library/data/<book>/*.json) for alignment/translation defects.

  python3 -I scripts/audit_interlinear.py [DATA_DIR] [--json out.json] [--book slug]

Checks (per [hebrew, english] pair): EMPTY side, HEB_IN_EN (Hebrew run in English column), EN_IN_HE (Latin text in
Hebrew column), GARBLED (letters spaced apart / detached vowels), PUNCT_LEAK (English starts with closing punctuation
or Hebrew ends mid-token), UNBALANCED (parens/brackets), RATIO (English/Hebrew word ratio far from the book's
median = likely drift), DUP (identical consecutive pairs).
"""
import sys, os, re, json, html, glob, statistics, collections
H = re.compile(r'[א-ת]'); L = re.compile(r'[A-Za-z]'); MARK = re.compile(r'[֑-ׇ]')
def strip_footnotes(s):
    """Remove <sup class="footnote-marker">..</sup><i class="footnote">..</i> (nested <i> aware): footnote bodies are expandable notes, not phrase text."""
    s = re.sub(r'<sup class="footnote-marker">.*?</sup>', '', s or '')
    while True:
        m = re.search(r'<i class="footnote">', s)
        if not m: return s
        depth, i = 1, m.end()
        while depth and i < len(s):
            a, b = s.find('<i', i), s.find('</i>', i)
            if b < 0: i = len(s); break
            if 0 <= a < b and (s[a:a+3] in ('<i>', '<i ')): depth += 1; i = a + 2
            else: depth -= 1; i = b + 4
        s = s[:m.start()] + s[i:]
def clean(s): return html.unescape(re.sub(r'<[^>]+>', '', strip_footnotes(s)))
def words(s): return len(s.split())

def pairs_of(items):
    for it in items:
        if isinstance(it, dict) and 'p' in it:
            for k, p in enumerate(it['p']):
                if isinstance(p, list) and len(p) >= 2 and isinstance(p[0], str): yield it.get('n'), k, clean(p[0]), clean(p[1])

def audit_book(book_dir):
    leaves = {}
    for f in sorted(glob.glob(os.path.join(book_dir, '*.json'))):
        name = os.path.basename(f)
        if name in ('toc.json', 'links.json', 'headings.json'): continue
        try: data = json.load(open(f))
        except Exception: continue
        if name == 'interlinear.json' and isinstance(data, dict):          # Mei overlay: ref -> [[pairs] per paragraph]
            for ref, paras in data.items():
                leaves['interlinear:' + ref] = [(i, k, clean(p[0]), clean(p[1])) for i, para in enumerate(paras) for k, p in enumerate(para)]
        elif isinstance(data, list):
            ps = list(pairs_of(data))
            if ps and any(H.search(p[2]) for p in ps): leaves[name] = ps
    allr = [words(e) / max(1, words(h)) for ps in leaves.values() for _, _, h, e in ps if words(h) >= 3 and words(e) >= 3]
    med = statistics.median(allr) if allr else 1.0
    issues = []
    for leaf, ps in leaves.items():
        prev = None
        for n, k, he, en in ps:
            def add(code, detail=''): issues.append({'leaf': leaf, 'para': n, 'pair': k, 'code': code, 'he': he[:90], 'en': en[:110], 'detail': detail})
            if not he.strip() or not en.strip():
                if words(he) >= 4 or (en.strip() and words(en) >= 4): add('EMPTY')
                continue
            if len(H.findall(en)) > 12: add('HEB_IN_EN', str(len(H.findall(en))))
            if len(L.findall(he)) > 4: add('EN_IN_HE', str(len(L.findall(he))))
            toks = [t for t in he.split() if H.search(t)]
            if len(toks) >= 4:
                short = sum(1 for t in toks if len(H.findall(t)) <= 1)
                if short / len(toks) > .5: add('GARBLED', f'{short}/{len(toks)} one-letter tokens')
            if re.match(r'^[\s,.;:)\]]+\S', en) and not re.match(r'^\s*[\'"“‘(\[–—-]', en): add('PUNCT_LEAK', 'English starts with ' + repr(en[:3]))
            if re.search(r',\s*\)', en): add('UNBALANCED', 'stray ", )"')
            if words(he) >= 6 and words(en) >= 3:
                r = words(en) / words(he)
                if r < med * .35 or r > med * 3.2: add('RATIO', f'{r:.2f} vs median {med:.2f}')
            if prev == (he, en) and words(he) > 2: add('DUP')
            prev = (he, en)
    return {'pairs': sum(len(p) for p in leaves.values()), 'leaves': len(leaves), 'median_ratio': round(med, 2), 'issues': issues}

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    data = args[0] if args else 'dist/library/data'
    only = sys.argv[sys.argv.index('--book') + 1] if '--book' in sys.argv else None
    out = {}
    for b in sorted(os.listdir(data)):
        d = os.path.join(data, b)
        if not os.path.isdir(d) or b in ('cited', 'packs') or (only and b != only): continue
        out[b] = audit_book(d)
    for b, r in out.items():
        c = collections.Counter(i['code'] for i in r['issues'])
        print(f"{b:26} leaves {r['leaves']:4} pairs {r['pairs']:6} median {r['median_ratio']:<5} issues {len(r['issues']):5} {dict(c)}")
    if '--json' in sys.argv: json.dump(out, open(sys.argv[sys.argv.index('--json') + 1], 'w'), ensure_ascii=False)

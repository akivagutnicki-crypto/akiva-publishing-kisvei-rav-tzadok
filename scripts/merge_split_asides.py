#!/usr/bin/env python3
"""Rejoin sentences whose English was cut around a Hebrew aside such as "(ל)" or "(ע-ר-ב".

Pattern in the source pairs: a Hebrew row with a whole clause but only a stub of English that stops mid-sentence,
followed by short Hebrew-only asides each carrying a fragment of the same English sentence. We merge the stub, its
aside rows and the finishing fragment into one pair; the Hebrew asides are kept (appended after the clause).

  python3 -I scripts/merge_split_asides.py [--apply]     (dry run by default; prints each merge)
"""
import json, glob, re, sys
TAG = re.compile(r'<[^>]+>'); HEB = re.compile(r'[א-ת]')
plain = lambda s: TAG.sub('', s or '')
wc = lambda s: len(plain(s).split())
END = re.compile(r'[.;:?!]["\'”’)\]]*$')
def is_aside(p):
    he = plain(p[0]).strip()
    if 'footnote' in p[0] + p[1] or not he or wc(he) > 3 or not HEB.search(he) or re.match(r'^[(\[]\s*אות\s', he): return False
    return bool(re.match(r'^[(\[]', he) or re.search(r'[)\]][.,;:]*$', he) or re.match(r'^[א-ת֑-ׇ]+-[א-ת]', he))
def is_stub(p):
    if 'footnote' in p[0] + p[1]: return False
    ew = wc(p[1])
    return 1 <= ew <= 10 and wc(p[0]) >= 2 * ew and HEB.search(plain(p[0])) and not END.search(plain(p[1]).strip())
def merge_list(ps, log):
    out, i = [], 0
    while i < len(ps):
        p = ps[i]
        if is_stub(p) and i + 1 < len(ps) and is_aside(ps[i + 1]):
            j, group = i + 1, []
            while j < len(ps) and len(group) < 5 and is_aside(ps[j]):
                group.append(ps[j]); j += 1
                if END.search(plain(group[-1][1]).strip()): break
            if group and END.search(plain(group[-1][1]).strip()) and wc(group[-1][1]) >= 4:
                he = ' '.join([p[0].rstrip()] + [plain(g[0]).strip() for g in group])
                en = ' '.join(x.strip() for x in [p[1]] + [g[1] for g in group] if x.strip())
                log.append((p, group, [he, en]))
                out.append([he, en]); i = j; continue
        out.append(p); i += 1
    return out
def walk(o, log):
    n = 0
    if isinstance(o, dict):
        if isinstance(o.get('p'), list) and o['p'] and isinstance(o['p'][0], list):
            new = merge_list(o['p'], log); n += len(o['p']) - len(new); o['p'] = new
        for v in o.values(): n += walk(v, log)
    elif isinstance(o, list):
        for v in o: n += walk(v, log)
    return n
if __name__ == '__main__':
    apply = '--apply' in sys.argv; total = 0
    for f in sorted(glob.glob('sources/akiva/**/*.json', recursive=True)):
        if any(x in f for x in ('annotations', 'editions', 'references', 'hebrew', 'nikud', 'supplements', 'overlays')): continue
        raw = open(f, encoding='utf8').read(); d = json.loads(raw); log = []
        n = walk(d, log)
        if not n: continue
        total += n; print(f, n)
        for stub, group, new in log:
            print('   STUB', plain(stub[1])[:70], '|', ' + '.join(plain(g[1])[:40] for g in group)); print('   ->  ', plain(new[1])[:200])
        if apply: open(f, 'w', encoding='utf8').write(json.dumps(d, ensure_ascii=False, indent=2) if raw.startswith('{\n') else json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    print('rows removed:', total)

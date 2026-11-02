#!/usr/bin/env python3
"""Export the model's parallels: per teaching, up to 15 parallels with a confidence tier and evidence
(sources both cite, rare words both use). Per-book files for the reader, each well under 10 MB."""
import json, pickle, re, collections, os, sys, math
import numpy as np
import os
S = os.environ.get('ML_WORK', 'ml-work')   # work dir: needs S/ci/dist/mcp-data (built site) and S/par/mafteach_parallels.json
OUT = sys.argv[1]
C = pickle.load(open(f'{S}/ml/corpus.pkl', 'rb')); U = C['units']
D = pickle.load(open(f'{S}/ml/scored.pkl', 'rb'))
refs, cand, P, cuts = D['refs'], D['cand'], D['P'], D['cuts']
TIERS = [('strong', cuts[0.8]), ('likely', cuts[0.6]), ('possible', cuts[0.5])]
tier = lambda p: next((t for t, c in TIERS if p >= c), None)
MAXN = 15

# evidence helpers
docs = [U[r]['he'].split() for r in refs]
df = collections.Counter(w for d in docs for w in set(d))
cdf = collections.Counter(c for r in refs for c in set(U[r]['cites']))
N = len(refs)
STOP = set('את של על אל כי לא הוא היא הם זה זו וזה וזהו כמו שהוא אשר גם רק כל אבל או אם עם מה מי יש אין היה היו להיות כן לו לה להם בו בה בהם הנה ולכן לכן ועל אחר כך עד ידי ואמר אמר שנאמר דכתיב כתיב וכמו וכן אך הרי והוא והיא מן לפי בין עוד שם עליו אלא וגו וכו'.split())
def evidence(i, j):
    a, b = U[refs[i]], U[refs[j]]
    shared_c = sorted(set(a['cites']) & set(b['cites']), key=lambda c: cdf[c])[:3]
    sw = [w for w in set(docs[i]) & set(docs[j]) if w not in STOP and len(w) > 2 and 2 <= df[w] <= 40]
    shared_w = sorted(sw, key=lambda w: df[w])[:5]
    return shared_c, shared_w

# ---- paragraph texts for giant sections (link to the matching paragraph, not the whole chapter) ----
import glob as _g
from sklearn.feature_extraction.text import TfidfVectorizer
nw = {r: len(U[r]['he'].split()) for r in refs}
BIG = 2500
paras = collections.defaultdict(list)          # unit ref -> [(para ref, text)]
import re as _re
def _norm(s):
    s = _re.sub(r'[\u0591-\u05C7]', '', s)
    for a_, b_ in zip('ךםןףץ', 'כמנפצ'): s = s.replace(a_, b_)
    s = _re.sub(r'[׳״\'"`]', '', s); s = _re.sub(r'[^\u05D0-\u05EA]+', ' ', s)
    return ' '.join(s.split())
cat = json.load(open(f'{S}/ci/dist/mcp-data/catalog.json'))
for b in cat['books']:
    t = json.load(open(f"{S}/ci/dist/mcp-data/text/{b['slug']}.json"))
    for p_ in t['paras']:
        si = int(p_['s']) if str(p_.get('s', '')).isdigit() else None
        sec = b['sections'][si] if si is not None and si < len(b['sections']) else None
        uref = sec['ref'] if sec else None
        if uref in nw and nw[uref] > BIG and _re.search(r':\d+$', p_['r']):
            phr = p_.get('p'); he = ' '.join(x[0] for x in (phr if isinstance(phr, list) else json.loads(phr))) if phr else (p_.get('t') or '')
            paras[uref].append((p_['r'], _norm(he)))
vec = TfidfVectorizer(min_df=2, max_df=0.25, sublinear_tf=True, token_pattern=r'\S{2,}').fit([U[r]['he'] for r in refs])
pvec = {u: (lst, vec.transform([t for _, t in lst])) for u, lst in paras.items() if lst}
uvec_cache = {}
def anchor(i, j):
    """paragraph of giant unit j that best matches unit i"""
    rj = refs[j]
    if rj not in pvec: return rj
    lst, M_ = pvec[rj]
    if i not in uvec_cache: uvec_cache[i] = vec.transform([U[refs[i]]['he']])
    sims = (M_ @ uvec_cache[i].T).toarray().ravel()
    return lst[int(sims.argmax())][0]

FI = {n: k for k, n in enumerate(D['FEATS'])}
X = D['X']
def adjusted(k, i, j, p):
    # size damping for giant targets, then evidence requirements per tier
    if nw[refs[j]] > BIG: p *= (BIG / nw[refs[j]]) ** 0.25
    wc, cc, rs = X[k, FI['word_cos']], X[k, FI['cite_cos']], X[k, FI['rare_shared']]
    t = tier(p)
    if t == 'strong' and not (wc >= 0.08 and (cc > 0 or rs >= 10)): t = 'likely'
    if t == 'likely' and not (wc >= 0.06 or cc > 0.05): t = 'possible'
    if t == 'possible' and not (wc >= 0.05 or cc > 0.05 or rs >= 15): t = None
    # across the two schools the model is less certain (it learned from Rav Tzadok only): demand more evidence
    if t and U[refs[i]]['school'] != U[refs[j]]['school'] and not (cc > 0 or (wc >= 0.08 and rs >= 15)):
        t = {'strong': 'likely', 'likely': 'possible', 'possible': None}[t]
    return p, t

best = collections.defaultdict(list)
for k, ((i, j), p) in enumerate(zip(cand, P)):
    p2, t = adjusted(k, i, j, p)
    if t: best[i].append((p2, j, t))
ORDER = {'strong': 0, 'likely': 1, 'possible': 2}
out = collections.defaultdict(dict)
stats = collections.Counter()
for i, lst in best.items():
    lst.sort(key=lambda x: (ORDER[x[2]], -x[0]))
    me = U[refs[i]]['school']
    same = [x for x in lst if U[refs[x[1]]]['school'] == me][:10]
    other = [x for x in lst if U[refs[x[1]]]['school'] != me][:5]
    items = []
    for p, j, t in sorted(same + other, key=lambda x: (ORDER[x[2]], -x[0])):
        c, w = evidence(i, j)
        items.append([anchor(i, j), round(float(p), 2), t, c, w])
        stats[f"{me} -> {U[refs[j]]['school']}"] += 1; stats[t] += 1
    r = refs[i]
    key = re.sub(r'\s+\d+$', '', r) if r.startswith('Peri Tzadik, ') else (U[r]['book'] if not r.startswith('Mei HaShiloach') else re.sub(r'\s+\d+$', '', r.split(', ', 2)[0] + ', ' + r.split(', ')[1]))
    out[key][r] = items

slug = lambda b: re.sub(r'[^a-z0-9]+', '-', b.lower()).strip('-')
os.makedirs(OUT, exist_ok=True)
index = {}
for k, ps in out.items():
    f = slug(k) + '.json'
    json.dump(dict(version='20261102-ml-v1', passages=ps), open(os.path.join(OUT, f), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    index[k] = dict(file=f, passages=len(ps), bytes=os.path.getsize(os.path.join(OUT, f)))
rep = D['report']
json.dump(dict(version='20261102-ml-v1',
               method='Gradient-boosted model trained on HaMafteach HaShalem parallels (Rav Tzadok) using wording, letter n-grams, LSA meaning similarity, shared citations, shared rare words and the library engine score; applied to all Rav Tzadok and Ishbitz-Radzin teachings.',
               evaluation={k: {a: round(b, 3) for a, b in v.items()} for k, v in rep.items()},
               tiers={t: dict(min_probability=round(c, 3), heldout_precision=p) for (t, c), p in zip(TIERS, (0.8, 0.6, 0.5))},
               books=index), open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
tot = sum(i['bytes'] for i in index.values())
print('files', len(index), 'total MB', round(tot / 1e6, 2), 'largest MB', round(max(i['bytes'] for i in index.values()) / 1e6, 2))
print('teachings with parallels', sum(len(v) for v in out.values()), 'of', N)
for k, v in sorted(stats.items()): print(f'  {k}: {v}')

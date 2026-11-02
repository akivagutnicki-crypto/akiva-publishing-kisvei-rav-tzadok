#!/usr/bin/env python3
"""Add the full Mei HaShiloach (sources/held/Mei_HaShiloach.json: Volumes I, II and the Anthology, one unit per teaching)
to the corpus built by prep.py. Run after prep.py, before train.py."""
import json, pickle, re, os
S = os.environ.get('ML_WORK', 'ml-work')
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
def flat(x): return x if isinstance(x, str) else ' '.join(flat(i) for i in x) if isinstance(x, list) else ''
def norm_he(s):
    s = re.sub(r'<[^>]+>', ' ', flat(s)); s = re.sub(r'[֑-ׇ]', '', s)
    for a, b in zip('ךםןףץ', 'כמנפצ'): s = s.replace(a, b)
    s = re.sub(r'[׳״\'"`]', '', s); s = re.sub(r'[^א-ת]+', ' ', s)
    return ' '.join(s.split())
C = pickle.load(open(f'{S}/ml/corpus.pkl', 'rb')); U = C['units']
old = {k: v for k, v in U.items() if v['slug'] == 'mei-hashiloach'}
for k in old: U.pop(k)
d = json.load(open(os.path.join(REPO, 'sources/held/Mei_HaShiloach.json')))['text']
n = 0
def add(ref, txt, cites):
    global n
    he = norm_he(txt)
    if len(he.split()) < 25: return
    U[ref] = dict(ref=ref, book='Mei HaShiloach', slug='mei-hashiloach', school='Ishbitz-Radzin', he=' ' + he, cites=cites, sec=None, title='', he_title=''); n += 1
for vol, books in d.items():
    if not isinstance(books, dict): continue
    for bk, parshiyot in books.items():
        if not isinstance(parshiyot, dict):
            for i, t in enumerate(parshiyot): add(f'Mei HaShiloach, {vol}, {bk} {i+1}', t, [])
            continue
        for par, paras in parshiyot.items():
            for i, t in enumerate(paras):
                ref = f'Mei HaShiloach, {vol}, {bk}, {par} {i+1}'
                add(ref, t, old.get(ref, {}).get('cites', []))
pickle.dump(C, open(f'{S}/ml/corpus.pkl', 'wb'))
print('Mei HaShiloach teachings', n, '| corpus', len(U))

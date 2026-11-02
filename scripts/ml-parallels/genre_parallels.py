#!/usr/bin/env python3
"""Parallels from each Rav Tzadok / Ishbitz-Radzin teaching out into Chassidus, Kabbalah, Machshava and Mussar.
Model: text-only version of the parallels model (wording, letter n-grams, LSA meaning, rare shared words, length),
trained on HaMafteach HaShalem's parallels inside the library, applied to (library teaching, outside passage) pairs."""
import json, gzip, pickle, re, collections, time, sys, os
import numpy as np
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer, HashingVectorizer, TfidfTransformer
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import normalize
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score, average_precision_score

import os
S = os.environ.get('ML_WORK', 'ml-work')   # work dir with ml/corpus.pkl and ml/scored.pkl from the library model
CORPUS, OUT = sys.argv[1], sys.argv[2]
t0 = time.time()
log = lambda *a: print(f'[{time.time()-t0:5.0f}s]', *a, flush=True)
C = pickle.load(open(f'{S}/ml/corpus.pkl', 'rb')); LU = list(C['units'].values()); NL = len(LU)
D = pickle.load(open(f'{S}/ml/scored.pkl', 'rb'))
assert D['refs'] == [u['ref'] for u in LU]
EXT = [json.loads(l) for l in gzip.open(CORPUS, 'rt', encoding='utf-8')]
NE = len(EXT)
log('library', NL, 'outside passages', NE, collections.Counter(e['genre'] for e in EXT))
texts = [u['he'] for u in LU] + [e['he'] for e in EXT]
STOP = set('את של על אל כי לא הוא היא הם זה זו וזה וזהו כמו שהוא אשר גם רק כל אבל או אם עם מה מי יש אין היה היו להיות כן לו לה להם בו בה בהם הנה ולכן לכן ועל אחר כך עד ידי ואמר אמר שנאמר דכתיב כתיב וכמו וכן אך הרי והוא והיא מן לפי בין עוד שם עליו אלא וגו וכו'.split())
def tok(s):
    s = s.replace('ך', 'כ').replace('ם', 'מ').replace('ן', 'נ').replace('ף', 'פ').replace('ץ', 'צ')
    return [w for w in s.split() if w not in STOP and len(w) > 1]
WV = TfidfVectorizer(tokenizer=tok, lowercase=False, token_pattern=None, min_df=3, max_df=0.2, sublinear_tf=True, dtype=np.float32)
W = WV.fit_transform(texts)
log('words', W.shape)
H = HashingVectorizer(analyzer='char_wb', ngram_range=(4, 4), n_features=2**19, alternate_sign=False, norm=None, dtype=np.float32)
CH = normalize(TfidfTransformer(sublinear_tf=True).fit_transform(H.transform([t.replace('ך','כ').replace('ם','מ').replace('ן','נ').replace('ף','פ').replace('ץ','צ') for t in texts])))
log('char n-grams', CH.shape)
svd = TruncatedSVD(256, random_state=0)
L = normalize(svd.fit_transform(W)).astype(np.float32)
log('LSA')
B = (W > 0).astype(np.float32).tocsc()
df = np.asarray(B.sum(0)).ravel(); N = W.shape[0]
rare = (df >= 2) & (df <= 60)
idf = np.log(N / np.maximum(df, 1)).astype(np.float32)
R = sparse.csr_matrix(B[:, rare].multiply(idf[rare])); RB = sparse.csr_matrix((R > 0).astype(np.float32))
vocab = np.array(WV.get_feature_names_out())[rare]
nwords = np.array([len(t.split()) for t in texts])

def feats(I, J):
    wc = np.asarray(W[I].multiply(W[J]).sum(1)).ravel()
    cc = np.asarray(CH[I].multiply(CH[J]).sum(1)).ravel()
    lc = (L[I] * L[J]).sum(1)
    rs = np.asarray(R[I].multiply(RB[J]).sum(1)).ravel()
    return np.column_stack([wc, cc, lc, rs, np.log1p(nwords[I]), np.log1p(nwords[J])]).astype(np.float32)
FEATS = ['word_cos', 'char_cos', 'lsa_cos', 'rare_shared', 'len_i', 'len_j']

# ---------- train text-only model on the library's Mafteach labels ----------
refs = D['refs']; cand = D['cand']; pos = D['pos']; covered = D['covered']
grp = np.array([1 if r.startswith('Peri Tzadik') else 0 for r in refs])
I, J = cand[:, 0], cand[:, 1]
lab = covered[I] & covered[J] & (grp[I] == grp[J])
I, J = I[lab], J[lab]
y = np.array([(i, j) in pos for i, j in zip(I, J)])
X = np.vstack([feats(I[k:k + 20000], J[k:k + 20000]) for k in range(0, len(I), 20000)])
oof = np.zeros(len(y))
for tr, te in GroupKFold(5).split(X, y, I):
    m = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, random_state=0).fit(X[tr], y[tr]); oof[te] = m.predict_proba(X[te])[:, 1]
def prec10(pred):
    by = collections.defaultdict(list)
    for s, i, yy in zip(pred, I, y): by[i].append((s, yy))
    return float(np.mean([np.mean([yy for _, yy in sorted(l, key=lambda x: -x[0])[:10]]) for l in by.values() if any(yy for _, yy in l)]))
ev = dict(auc=roc_auc_score(y, oof), ap=average_precision_score(y, oof), prec10=prec10(oof), prec10_words_only=prec10(X[:, 0]))
order = np.argsort(-oof); cum = np.cumsum(y[order]) / np.arange(1, len(order) + 1)
cuts = {t: float(oof[order][np.where(cum >= t)[0][-1]]) for t in (0.8, 0.6, 0.5)}
log('text-only model (held-out):', {k: round(v, 3) for k, v in ev.items()}, 'cuts', {k: round(v, 3) for k, v in cuts.items()})
model = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, random_state=0).fit(X, y)

# ---------- candidates: library teaching -> outside passages ----------
K = 40
cands = set()
WL, WE = W[:NL], W[NL:]; CL, CE = CH[:NL], CH[NL:]; LL, LE = L[:NL], L[NL:]
for qs in range(0, NL, 500):
    q = slice(qs, min(NL, qs + 500))
    for M_ in ((WL[q] @ WE.T).toarray(), (CL[q] @ CE.T).toarray(), LL[q] @ LE.T):
        top = np.argpartition(-M_, K, axis=1)[:, :K]
        for r, row in enumerate(top):
            for j in row:
                if M_[r, j] > 0: cands.add((qs + r, int(j)))
    log('candidates', len(cands), 'after', min(NL, qs + 500))
cands = np.array(sorted(cands)); CI, CJ = cands[:, 0], cands[:, 1] + NL
XC = np.vstack([feats(CI[k:k + 20000], CJ[k:k + 20000]) for k in range(0, len(CI), 20000)])
P = model.predict_proba(XC)[:, 1]
log('scored', len(P))

# ---------- tiers with strict evidence (outside books: like cross-school) ----------
def tier(p, wc, rs):
    t = 'strong' if p >= cuts[0.8] else 'likely' if p >= cuts[0.6] else 'possible' if p >= cuts[0.5] else None
    if t == 'strong' and not (wc >= 0.10 and rs >= 20): t = 'likely'
    if t == 'likely' and not (wc >= 0.07 and rs >= 12): t = 'possible'
    if t == 'possible' and not (wc >= 0.06 and rs >= 8): t = None
    return t
best = collections.defaultdict(list)
for k in range(len(P)):
    t = tier(P[k], XC[k, 0], XC[k, 3])
    if t: best[CI[k]].append((P[k], CJ[k] - NL, t))
ORDER = {'strong': 0, 'likely': 1, 'possible': 2}
def shared_words(i, j):
    a = set(R[i].indices) & set(R[NL + j].indices)
    w = sorted(a, key=lambda c: -idf[np.where(rare)[0][c]])[:4]
    return [vocab[c] for c in w]
out = collections.defaultdict(dict); stats = collections.Counter()
for i, lst in best.items():
    lst.sort(key=lambda x: (ORDER[x[2]], -x[0]))
    per = collections.Counter(); items = []; seen_books = collections.Counter()
    for p, j, t in lst:
        e = EXT[j]
        if per[e['genre']] >= 3 or seen_books[e['title']] >= 2: continue
        per[e['genre']] += 1; seen_books[e['title']] += 1
        items.append([e['ref'], e['he_title'] or e['title'], e['genre'], round(float(p), 2), t, shared_words(i, j)])
        stats[e['genre']] += 1; stats[t] += 1
        if len(items) >= 10: break
    r = LU[i]['ref']
    key = re.sub(r'\s+\d+$', '', r) if r.startswith('Peri Tzadik, ') else (LU[i]['book'] if not r.startswith('Mei HaShiloach') else ', '.join(r.split(', ')[:2]))
    out[key][r] = items
slug = lambda b: re.sub(r'[^a-z0-9]+', '-', b.lower()).strip('-')
os.makedirs(OUT, exist_ok=True); index = {}
for k, ps in out.items():
    f = slug(k) + '.json'
    json.dump(dict(version='20261102-genre-v1', passages=ps), open(os.path.join(OUT, f), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    index[k] = dict(file=f, passages=len(ps), bytes=os.path.getsize(os.path.join(OUT, f)))
json.dump(dict(version='20261102-genre-v1', source="Sefaria public export: Chasidut, Kabbalah, Jewish Thought, Musar (Hebrew)",
               evaluation={k: round(v, 3) for k, v in ev.items()}, cutoffs={str(k): round(v, 3) for k, v in cuts.items()},
               outside_passages=NE, books=index), open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
log('teachings with outside parallels', sum(len(v) for v in out.values()), 'of', NL, dict(stats),
    'files', len(index), 'MB', round(sum(i['bytes'] for i in index.values()) / 1e6, 2), 'largest', round(max(i['bytes'] for i in index.values()) / 1e6, 2))

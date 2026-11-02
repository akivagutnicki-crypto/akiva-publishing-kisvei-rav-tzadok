#!/usr/bin/env python3
"""Learn what a parallel looks like from HaMafteach HaShalem's human-indexed parallels, then score every pair of
teachings in the library (Rav Tzadok and Ishbitz-Radzin)."""
import json, pickle, re, collections, math, time, sys
import numpy as np
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import normalize
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score, average_precision_score

import os
S = os.environ.get('ML_WORK', 'ml-work')   # work dir: needs S/ci/dist/mcp-data (built site) and S/par/mafteach_parallels.json
t0 = time.time()
C = pickle.load(open(f'{S}/ml/corpus.pkl', 'rb'))
U = list(C['units'].values()); refs = [u['ref'] for u in U]; idx = {r: i for i, r in enumerate(refs)}; N = len(U)
texts = [u['he'] for u in U]
book = np.array([u['book'] for u in U]); school = np.array([u['school'] for u in U])
nwords = np.array([len(t.split()) for t in texts])

# ---------- representations ----------
STOP = set('את של על אל כי לא הוא היא הם זה זו וזה וזהו כמו כמש שהוא אשר גם רק כל אבל או אם עם מה מי יש אין היה היו להיות כן לו לה להם בו בה בהם הנה ולכן לכן ועל אחר כך עד ידי עי ואמר אמר שנאמר דכתיב כתיב וכמו וכן אך הרי והוא והיא דהא ודאי מן לפי בין עוד שם עליו אלא וגו וכו וגו וכוי'.split())
tok = lambda s: [w for w in s.split() if w not in STOP and len(w) > 1]
W = TfidfVectorizer(tokenizer=tok, lowercase=False, token_pattern=None, min_df=2, max_df=0.25, sublinear_tf=True).fit_transform(texts)
CH = TfidfVectorizer(analyzer='char_wb', ngram_range=(4, 5), min_df=3, max_df=0.2, sublinear_tf=True, lowercase=False).fit_transform(texts)
L = normalize(TruncatedSVD(256, random_state=0).fit_transform(W))
def chap(r):
    m = re.match(r'^(.*?\s\d+)', r); return 'CH:' + m.group(1) if m else None
cite_docs = [[c for c in u['cites']] + [x for x in (chap(c) for c in u['cites']) if x] for u in U]
CI = TfidfVectorizer(analyzer=lambda d: d, min_df=2, max_df=0.05, sublinear_tf=True).fit_transform(cite_docs)
has_cites = np.array([len(u['cites']) > 0 for u in U])
# rare words (document frequency 2..20), idf-weighted overlap
B = (W > 0).astype(np.float32).tocsc()
df = np.asarray(B.sum(0)).ravel()
rare = (df >= 2) & (df <= 20)
idf = np.log(N / np.maximum(df, 1))
R = sparse.csr_matrix(B[:, rare].multiply(idf[rare]))
print(f'vectors: words {W.shape[1]}, char-ngrams {CH.shape[1]}, cites {CI.shape[1]}, rare words {int(rare.sum())}  ({time.time()-t0:.0f}s)', flush=True)

def dense_sim(X): return (X @ X.T).toarray().astype(np.float32) if sparse.issparse(X) else (X @ X.T).astype(np.float32)
SW, SC, SL, SI = dense_sim(W), dense_sim(CH), dense_sim(L), dense_sim(CI)
RB = sparse.csr_matrix((R > 0).astype(np.float32))
SR = (R @ RB.T).toarray().astype(np.float32)          # summed idf of shared rare words
for M_ in (SW, SC, SL, SI, SR): np.fill_diagonal(M_, 0)
print(f'similarities ({time.time()-t0:.0f}s)', flush=True)

# ---------- candidates ----------
K = 60
cand = set()
for M_ in (SW, SC, SL, SI, SR):
    top = np.argpartition(-M_, K, axis=1)[:, :K]
    for i in range(N):
        for j in top[i]:
            if M_[i, j] > 0: cand.add((i, int(j)))
eng = C['engine']
for (a, b), v in eng.items():
    if a in idx and b in idx: cand.add((idx[a], idx[b]))
cand = np.array(sorted(cand)); I, J = cand[:, 0], cand[:, 1]
E = np.array([eng.get((refs[i], refs[j]), eng.get((refs[j], refs[i]), 0.0)) for i, j in cand], dtype=np.float32)
def rank_feat(M_):
    # rank of j among i's neighbours (0 = best), from row-wise ordering, on candidates
    order = np.argsort(-M_, axis=1)
    rk = np.empty_like(order); rows = np.arange(N)[:, None]
    rk[rows, order] = np.arange(N)[None, :]
    return rk
RW, RL_, RI = rank_feat(SW), rank_feat(SL), rank_feat(SI)
X = np.column_stack([SW[I, J], SC[I, J], SL[I, J], SI[I, J], SR[I, J], E,
                     np.log1p(RW[I, J]), np.log1p(RW[J, I]), np.log1p(RL_[I, J]), np.log1p(RI[I, J]),
                     has_cites[I] & has_cites[J],
                     np.log1p(nwords[I]), np.log1p(nwords[J])]).astype(np.float32)
FEATS = ['word_cos', 'char_cos', 'lsa_cos', 'cite_cos', 'rare_shared', 'engine', 'rank_w_ij', 'rank_w_ji', 'rank_lsa', 'rank_cite',
         'both_cite', 'len_i', 'len_j']
print(f'candidates {len(cand):,} ({len(cand)/N:.0f} per teaching)  ({time.time()-t0:.0f}s)', flush=True)

# ---------- labels from the Mafteach ----------
M = json.load(open(f'{S}/par/mafteach_parallels.json'))['passages']
covered = np.array([r in M for r in refs])
pos = set()
for p, v in M.items():
    if p not in idx: continue
    for q, sc, _ in v['parallels']:
        if q in idx: pos.add((idx[p], idx[q])); pos.add((idx[q], idx[p]))
# The Mafteach indexes Pri Tzaddik (parts 4-7) and the other sefarim (parts 1-3) separately, so pairs across the two
# were never eligible to be listed: label only pairs inside one index. No book/school features: judge content alone.
grp = np.array([1 if r.startswith('Peri Tzadik') else 0 for r in refs])
lab = covered[I] & covered[J] & (grp[I] == grp[J])
y = np.array([(i, j) in pos for i, j in cand])
Xl, yl, gl = X[lab], y[lab], I[lab]
print(f'labeled pairs {lab.sum():,}, positives {yl.sum():,} ({yl.mean():.1%}); Mafteach pairs reachable as candidates: {yl.sum()/len(pos):.0%}', flush=True)

# ---------- cross-validated evaluation (held-out teachings) ----------
def recall_at(pred, k=20):
    hit = tot = 0
    by = collections.defaultdict(list)
    for s, i, yy in zip(pred, gl, yl): by[i].append((s, yy))
    for i, l in by.items():
        npos = sum(yy for _, yy in l)
        if not npos: continue
        l.sort(key=lambda x: -x[0]); hit += sum(yy for _, yy in l[:k]); tot += min(npos, k)
    return hit / tot
def prec_at(pred, k=10):
    by = collections.defaultdict(list); vals = []
    for s, i, yy in zip(pred, gl, yl): by[i].append((s, yy))
    for i, l in by.items():
        if not any(yy for _, yy in l): continue
        l.sort(key=lambda x: -x[0]); vals.append(np.mean([yy for _, yy in l[:k]]))
    return float(np.mean(vals))
oof = np.zeros(len(yl))
for tr, te in GroupKFold(5).split(Xl, yl, gl):
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=1.0, random_state=0)
    m.fit(Xl[tr], yl[tr]); oof[te] = m.predict_proba(Xl[te])[:, 1]
report = {'model': dict(auc=roc_auc_score(yl, oof), ap=average_precision_score(yl, oof), recall20=recall_at(oof), prec10=prec_at(oof))}
for k, f in [('engine only', 5), ('wording only', 0), ('char n-grams', 1), ('LSA only', 2), ('citations only', 3)]:
    s = Xl[:, f]
    report[k] = dict(auc=roc_auc_score(yl, s), ap=average_precision_score(yl, s), recall20=recall_at(s), prec10=prec_at(s))
for k, v in report.items(): print(f'{k:15s} ' + '  '.join(f'{a}={b:.3f}' for a, b in v.items()), flush=True)
# probability cut-offs by precision on held-out data
order = np.argsort(-oof); cum = np.cumsum(yl[order]) / np.arange(1, len(order) + 1)
cuts = {}
for target in (0.8, 0.6, 0.5, 0.4, 0.3):
    ok = np.where(cum >= target)[0]
    cuts[target] = float(oof[order][ok[-1]]) if len(ok) else 1.0
print('cut-offs (held-out precision -> min probability):', {k: round(v, 3) for k, v in cuts.items()}, flush=True)

# ---------- final model, score everything ----------
m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=1.0, random_state=0).fit(Xl, yl)
P = m.predict_proba(X)[:, 1]
pickle.dump(dict(refs=refs, cand=cand, P=P, X=X, FEATS=FEATS, report=report, cuts=cuts, covered=covered, pos=pos), open(f'{S}/ml/scored.pkl', 'wb'))
from sklearn.inspection import permutation_importance
imp = permutation_importance(m, Xl[::7], yl[::7], n_repeats=3, random_state=0, scoring='average_precision')
print('feature importance:', sorted(zip(FEATS, np.round(imp.importances_mean, 4)), key=lambda x: -x[1])[:8])
print(f'done ({time.time()-t0:.0f}s)')

"""Learn the parallel-ranking weights from reviewed editorial parallels (pairwise ranking).

Gold sources (reviewed by editors, with explanations):
  (a) the editorial master's Kisvei Rav Tzadok / Ishbitz-Radzin parallel notes  (connections.json, kind 'library')
  (b) the reader's reviewed source connections                                   (sources/akiva/connections/*.json)
  (c) the reader's Connected Ideas threads                                        (sources/akiva/themes/*.json)
  (d) optional extra pairs                                                        ([{"a": ref, "b": ref}])
Automated 'Parallel Sources' citations of older layers are deliberately NOT used as gold.

A target given at section level ("Resisei Layla 5") is resolved to the paragraph of that section with the
strongest feature overlap (weak labelling). Training uses pairwise logistic loss on (positive − negative)
feature differences, negatives drawn from the candidate list, fitted with numpy.
"""
import glob
import json
import os
import random
import sys
from collections import defaultdict

import numpy as np

from .parallels import ParallelIndex

FEATS = ParallelIndex.FEATURE_KEYS


def _resolve_target(index, a, b):
    if b in index.paras:
        return b
    paras = index.section_paragraphs(b)
    if not paras:
        return None
    if len(paras) == 1:
        return paras[0]
    best = max(paras, key=lambda r: index.score(index.features(a, r)))
    return best


def gold_pairs(index, connections_path=None, repo=None, extra=None):
    raw = set()
    if connections_path and os.path.exists(connections_path):
        d = json.load(open(connections_path, encoding='utf-8'))
        for c in d.get('connections', []):
            if c.get('kind') == 'library' and (c.get('canonicalRef') or c.get('displayRef')):
                raw.add((c['anchorRef'], c.get('canonicalRef') or c['displayRef']))
    if repo:
        for f in glob.glob(os.path.join(repo, 'sources/akiva/connections/*.json')):
            try:
                d = json.load(open(f, encoding='utf-8'))
            except Exception:  # noqa: BLE001
                continue
            for r in d.get('records', []):
                t = r.get('targetRef')
                origins = r.get('originRefs') or []
                for o in origins:
                    if t and o:
                        raw.add((o, t))
        for f in glob.glob(os.path.join(repo, 'sources/akiva/themes/*.json')):
            try:
                d = json.load(open(f, encoding='utf-8'))
            except Exception:  # noqa: BLE001
                continue
            recs = d.get('records') or d.get('threads') or []
            for r in recs:
                o = r.get('originRef') or r.get('origin', {}).get('ref') if isinstance(r.get('origin'), dict) else r.get('originRef')
                for p in r.get('parallels', []) or []:
                    t = p.get('ref') if isinstance(p, dict) else p
                    if o and t:
                        raw.add((o, t))
    for p in extra or []:
        raw.add((p['a'], p['b']))
    pairs = set()
    for a, b in raw:
        if a not in index.paras:
            cands = index.section_paragraphs(a)
            if len(cands) == 1:
                a = cands[0]
            else:
                continue
        t = _resolve_target(index, a, b)
        if t and t != a:
            pairs.add((a, t))
    return sorted(pairs)


def pairwise_dataset(index, pairs, negatives=8, seed=7):
    rng = random.Random(seed)
    by_a = defaultdict(set)
    for a, b in pairs:
        by_a[a].add(b)
    diffs = []
    for a, bs in by_a.items():
        cands = [c for c in index.candidates(a, limit=300) if c not in bs
                 and not (index.paras[c]['book'] == index.paras[a]['book'] and index.paras[c]['section'] == index.paras[a]['section'])]
        rng.shuffle(cands)
        allrefs = list(index.paras.keys())
        negs = cands[:negatives] + [rng.choice(allrefs) for _ in range(3)]
        for b in bs:
            fp = index.features(a, b)
            vp = np.array([fp[k] for k in FEATS], dtype=float)
            for n in negs:
                if n == b or n in bs:
                    continue
                fn = index.features(a, n)
                vn = np.array([fn[k] for k in FEATS], dtype=float)
                diffs.append(vp - vn)
    return np.array(diffs)


def fit_pairwise(D, l2=0.02, iters=4000, lr=0.05):
    n, d = D.shape
    sd = D.std(axis=0) + 1e-9
    Ds = D / sd
    w = np.zeros(d)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(Ds @ w)))
        g = ((p - 1.0) @ Ds) / n + l2 * w
        w -= lr * g
    w_raw = w / sd
    out = {k: float(v) for k, v in zip(FEATS, w_raw)}
    out['bias'] = -2.0
    return out


def evaluate(index, pairs, weights, sample=300, seed=3):
    rng = random.Random(seed)
    by_a = defaultdict(set)
    for a, b in pairs:
        by_a[a].add(b)
    queries = list(by_a.keys())
    rng.shuffle(queries)
    queries = queries[:sample]
    h1 = h5 = h10 = h20 = 0
    for a in queries:
        ranked = [r['ref'] for r in index.find(a, limit=20, weights=weights)]
        gold = by_a[a]
        if ranked[:1] and ranked[0] in gold:
            h1 += 1
        if any(r in gold for r in ranked[:5]):
            h5 += 1
        if any(r in gold for r in ranked[:10]):
            h10 += 1
        if any(r in gold for r in ranked[:20]):
            h20 += 1
    n = len(queries) or 1
    return {'queries': n, 'recall@1': round(h1 / n, 3), 'recall@5': round(h5 / n, 3), 'recall@10': round(h10 / n, 3), 'recall@20': round(h20 / n, 3)}


def main(mcp_dir, connections_path, out_path, repo=None):
    index = ParallelIndex().load_mcp_dir(mcp_dir)
    pairs = gold_pairs(index, connections_path, repo=repo)
    print('paragraphs', index.N, 'reviewed gold pairs', len(pairs))
    rng = random.Random(11)
    rng.shuffle(pairs)
    cut = int(len(pairs) * 0.8)
    train, test = pairs[:cut], pairs[cut:]
    D = pairwise_dataset(index, train)
    print('pairwise differences', D.shape)
    weights = fit_pairwise(D)
    print('weights', json.dumps(weights, indent=1))
    hand = dict(index.weights)
    candidates = {'hand': hand, 'learned': weights}
    if os.path.exists(out_path):  # the weights currently in use compete too, so a retrain never makes things worse
        try:
            candidates['previous'] = json.load(open(out_path, encoding='utf-8'))['weights']
        except Exception:  # noqa: BLE001
            pass
    results = {name: evaluate(index, test, w) for name, w in candidates.items()}
    for name, r in results.items():
        print(f'{name} weights test:', r)
    rank = lambda n: (results[n]['recall@10'], results[n]['recall@20'], results[n]['recall@5'])  # noqa: E731
    best = max(results, key=rank)
    print('keeping', best, 'weights')
    json.dump({'features': list(FEATS), 'weights': candidates[best], 'chosen': best, 'evaluation': results,
               'trainPairs': len(train), 'testPairs': len(test), 'paragraphs': index.N,
               'gold': 'reviewed editorial parallels (editorial master connections + reader reviewed connections + connected ideas)'},
              open(out_path, 'w', encoding='utf-8'), indent=1)
    return best, results

if __name__ == '__main__':
    main(*sys.argv[1:6])

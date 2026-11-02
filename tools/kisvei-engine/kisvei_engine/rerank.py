"""Claude review of parallel candidates.

The ranker can only see shared sources and shared wording; parallels that make the same point in other
words (thematic parallels) need a reader. This module
  1. builds a candidate pool: the ranker's top N plus passages the subject index (Sefer Mafteach) files
     under the same headwords as the query passage,
  2. asks a judge (Claude) to rate each candidate against the query passage,
  3. reranks by the judge's rating, keeping the ranker's order as the tie-break.

The judge is pluggable: `judge_api` calls the Claude API (needs ANTHROPIC_API_KEY); a pilot can also
write the prompts out (`write_batches`) and read ratings back (`read_ratings`).
"""
import json
import os
import re
from collections import defaultdict

from .hebrew import strip_nikkud

MAFTEACH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'training', 'thematic', 'sefer-mafteach.json')


class TopicNeighbors:
    """Paragraphs filed under the same Sefer Mafteach headwords as a query paragraph (or its section)."""

    def __init__(self, path=MAFTEACH, max_topic=60):
        d = json.load(open(path, encoding='utf-8'))
        self.by_para, self.by_topic = defaultdict(set), defaultdict(set)
        for r in d['records']:
            self.by_para[r['para']].add(r['head'])
            self.by_topic[r['head']].add(r['para'])
        self.max_topic = max_topic

    @staticmethod
    def section(ref):
        return ref.rsplit(':', 1)[0] if ':' in ref else ref

    def topics(self, ref):
        t = set(self.by_para.get(ref, ()))
        if not t:  # fall back to topics of other paragraphs of the same section
            sec = self.section(ref)
            for p, ts in self.by_para.items():
                if self.section(p) == sec:
                    t |= ts
        return t

    def neighbors(self, ref):
        out = []
        for t in sorted(self.topics(ref), key=lambda t: len(self.by_topic[t])):
            if len(self.by_topic[t]) <= self.max_topic:  # broad headwords (שבת, ישראל) say little
                out += [p for p in sorted(self.by_topic[t]) if self.section(p) != self.section(ref)]
        seen, uniq = set(), []
        for p in out:
            if p not in seen:
                seen.add(p)
                uniq.append(p)
        return uniq


def candidate_pool(index, topics, ref, ranker_n=30, topic_n=20):
    ranked = [r['ref'] for r in index.find(ref, limit=ranker_n)]
    extra = [p for p in topics.neighbors(ref) if p in index.paras and p not in ranked][:topic_n] if topics else []
    return ranked + extra


def passage(index, ref, max_words=170):
    P = index.paras[ref]
    he = strip_nikkud(P['he'])
    words = he.split()
    he = ' '.join(words[:max_words]) + (' …' if len(words) > max_words else '')
    en = ' '.join((P.get('en') or '').split()[:max_words])
    return he, en


JUDGE_INSTRUCTIONS = """You are an editor of the writings of R. Tzadok HaKohen of Lublin and the Ishbitz–Radzin school.
For the QUERY passage, rate each CANDIDATE passage as a parallel for a footnote reading "see also":
  3 = the same idea or teaching (even in different words or with different proof-texts)
  2 = a closely related idea a reader of the query would clearly benefit from
  1 = shares a topic, verse or term but makes a different point
  0 = unrelated
Judge the idea, not shared vocabulary. Answer only with JSON: {"ratings": {"<candidate id>": <0-3>, ...}}"""


def judge_prompt(index, query, cands):
    qhe, qen = passage(index, query)
    lines = [f'QUERY ({query}):\n{qhe}' + (f'\n[English] {qen}' if qen else ''), '']
    for i, c in enumerate(cands, 1):
        che, cen = passage(index, c, max_words=120)
        lines.append(f'CANDIDATE c{i} ({c}):\n{che}' + (f'\n[English] {cen}' if cen else ''))
        lines.append('')
    return '\n'.join(lines)


def rerank(cands, ratings):
    """Order by the judge's rating (desc), ranker order as tie-break."""
    pos = {c: i for i, c in enumerate(cands)}
    return sorted(cands, key=lambda c: (-ratings.get(c, 0), pos[c]))


def recall_at(ranked, gold, k):
    return any(r in gold for r in ranked[:k])


def write_batches(index, topics, queries, out_dir, per_batch=4, ranker_n=30, topic_n=20):
    """Pilot: write the judge prompts in batches (for judges run outside the API) and the candidate pools."""
    os.makedirs(out_dir, exist_ok=True)
    pools = {}
    for q in queries:
        pools[q] = candidate_pool(index, topics, q, ranker_n, topic_n)
    json.dump(pools, open(os.path.join(out_dir, 'pools.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    qs = list(pools)
    for b in range(0, len(qs), per_batch):
        parts = [JUDGE_INSTRUCTIONS, '', 'There are several QUERY blocks below; rate the candidates of each block separately.',
                 'Answer with one JSON object: {"<query ref>": {"c1": <0-3>, ...}, ...}', '']
        for q in qs[b:b + per_batch]:
            parts.append('=' * 60)
            parts.append(judge_prompt(index, q, pools[q]))
        open(os.path.join(out_dir, f'batch_{b // per_batch:02d}.txt'), 'w', encoding='utf-8').write('\n'.join(parts))
    return pools


def read_ratings(out_dir, pools):
    """Pilot: ratings files rated_*.json ({query: {"c1": n, ...}}) -> {query: {candidate ref: n}}."""
    ratings = {}
    for f in sorted(os.listdir(out_dir)):
        if f.startswith('rated_') and f.endswith('.json'):
            for q, rs in json.load(open(os.path.join(out_dir, f), encoding='utf-8')).items():
                if q in pools:
                    ratings[q] = {pools[q][int(re.sub(r'\D', '', k)) - 1]: int(v) for k, v in rs.items()
                                  if re.sub(r'\D', '', k) and int(re.sub(r'\D', '', k)) <= len(pools[q])}
    return ratings


RATINGS_SCHEMA = {
    'type': 'object',
    'properties': {
        'ratings': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {'id': {'type': 'string'}, 'rating': {'type': 'integer'}},
                'required': ['id', 'rating'],
                'additionalProperties': False,
            },
        },
    },
    'required': ['ratings'],
    'additionalProperties': False,
}


def judge_api(index, query, cands, client=None, model='claude-opus-5-5', effort='medium'):
    """Rate candidates with the Claude API. Needs ANTHROPIC_API_KEY (or another credential the SDK resolves).
    Returns {candidate ref: rating}, or {} when the request was declined."""
    import anthropic
    client = client or anthropic.Anthropic()
    response = client.beta.messages.create(
        model=model,
        max_tokens=16000,
        betas=['server-side-fallback-2026-07-01'],
        fallbacks='default',                                   # a declined request is re-run on Anthropic's fallback model
        system=[{'type': 'text', 'text': JUDGE_INSTRUCTIONS.replace(
            'Answer only with JSON: {"ratings": {"<candidate id>": <0-3>, ...}}',
            'Return one rating per candidate id (c1, c2, ...).'),
            'cache_control': {'type': 'ephemeral'}}],          # the instructions are identical on every call
        output_config={'effort': effort, 'format': {'type': 'json_schema', 'schema': RATINGS_SCHEMA}},
        messages=[{'role': 'user', 'content': judge_prompt(index, query, cands)}],
    )
    if response.stop_reason == 'refusal':
        return {}
    text = next(b.text for b in response.content if b.type == 'text')
    out = {}
    for r in json.loads(text)['ratings']:
        k = re.sub(r'\D', '', r['id'])
        if k and 1 <= int(k) <= len(cands):
            out[cands[int(k) - 1]] = max(0, min(3, int(r['rating'])))
    return out


def evaluate_rerank(index, topics, pairs, judge, queries=40, seed=5, ranker_n=30, topic_n=20):
    """Recall@k of the ranker alone vs. the ranker + candidate pool + judge, on held-out gold pairs."""
    import random
    gold = defaultdict(set)
    for a, b in pairs:
        gold[a].add(b)
    qs = sorted(gold)
    random.Random(seed).shuffle(qs)
    res = {'queries': 0, 'ranker': {5: 0, 10: 0}, 'reranked': {5: 0, 10: 0}, 'inPool': 0}
    for q in qs[:queries]:
        pool = candidate_pool(index, topics, q, ranker_n, topic_n)
        ratings = judge(index, q, pool)
        new = rerank(pool, ratings)
        res['queries'] += 1
        res['inPool'] += any(c in gold[q] for c in pool)
        for k in (5, 10):
            res['ranker'][k] += recall_at(pool[:ranker_n], gold[q], k)
            res['reranked'][k] += recall_at(new, gold[q], k)
    n = res['queries'] or 1
    return {'queries': res['queries'], 'inPool': round(res['inPool'] / n, 3),
            **{f'{w}@{k}': round(res[w][k] / n, 3) for w in ('ranker', 'reranked') for k in (5, 10)}}

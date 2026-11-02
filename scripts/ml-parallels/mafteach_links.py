#!/usr/bin/env python3
"""For every HaMafteach HaShalem topic and every pasuk / daf / midrash it indexes: the strongest passages in the
Ishbitz-Radzin works and in Chassidus, Kabbalah, Machshava and Mussar, reached through the Rav Tzadok passages the
Mafteach lists there (the machine-learned parallels in dist/library/ml-parallels and genre-parallels, both
directions). Each result keeps its evidence: the Rav Tzadok passages it comes through, shared sources, shared words.

Output: dist/library/mafteach-links/topics-NN.json  {topic id: {"ish": [...], "out": [...], "n": passages}}
        dist/library/mafteach-links/sources-<chapter>.json  {"Genesis 2:7": {...}}
        ish item: [ref, tier, score, [via refs], [shared sources], [shared words], 1 if its own text uses the topic word / quotes the source]
        out item: [sefaria ref, Hebrew title, genre, tier, score, [via refs], [shared words], text flag as above]
Usage: mafteach_links.py MCP_DATA_DIR GENRE_CORPUS.jsonl.gz   (texts for the relevance check)
"""
import gzip, json, re, os, collections, math
from pathlib import Path

LIB = Path('dist/library')
OUT = LIB / 'mafteach-links'
ISH = ('Beit Yaakov on Torah', 'Mei HaShiloach', 'Sod Yesharim', 'Tiferet Yosef', "Sha'ar HaEmunah VeYesod HaChasidut")
is_ish = lambda r: r.startswith(ISH)
W = {'strong': 3.0, 'likely': 2.0, 'possible': 1.0}
ORDER = {'strong': 0, 'likely': 1, 'possible': 2}
fkey = lambda s: re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))

def load(dirname):
    ix = json.loads((LIB / dirname / 'index.json').read_text())
    out = {}
    for info in ix['books'].values():
        out.update(json.loads((LIB / dirname / info['file']).read_text())['passages'])
    return out
ml, genre = load('ml-parallels'), load('genre-parallels')
base = lambda r: re.sub(r':\d+$', '', r)
# units for a Mafteach ref: the ref itself, or its numbered paragraphs (a one-block Pri Tzaddik section)
ml_by_prefix = collections.defaultdict(list)
for k in ml: ml_by_prefix[re.sub(r'\s+\d+$', '', k)].append(k)
def units(ref, table):
    if ref in table: return [ref]
    return [k for k in ml_by_prefix.get(ref, []) if k in table]
# reverse: Ishbitz-Radzin teachings pointing at a Rav Tzadok passage
reverse = collections.defaultdict(list)
for src, items in ml.items():
    if not is_ish(src): continue
    for ref, p, tier, cites, words in items:
        if not is_ish(ref): reverse[base(ref)].append((src, p, tier, cites, words))

def aggregate(refs, rel=None):
    """refs: {rav tzadok ref: weight}"""
    ish = {}
    out = {}
    def add_ish(target, rt, p, tier, cites, words, w):
        t = ish.setdefault(target, {'score': 0, 'tier': tier, 'via': collections.Counter(), 'cites': collections.Counter(), 'words': collections.Counter()})
        t['score'] += W[tier] * p * w; t['via'][rt] += W[tier] * p
        if ORDER[tier] < ORDER[t['tier']]: t['tier'] = tier
        t['cites'].update(cites or []); t['words'].update(words or [])
    for ref, w in refs.items():
        for u in units(ref, ml):
            for target, p, tier, cites, words in ml[u]:
                if is_ish(target): add_ish(target, ref, p, tier, cites, words, w)
        for src, p, tier, cites, words in reverse.get(ref, []):
            add_ish(src, ref, p, tier, cites, words, w)
        for u in units(ref, genre):
            for target, title, g, p, tier, words in genre[u]:
                t = out.setdefault(target, {'title': title, 'genre': g, 'score': 0, 'tier': tier, 'via': collections.Counter(), 'words': collections.Counter()})
                t['score'] += W[tier] * p * w; t['via'][ref] += W[tier] * p; t['words'].update(words or [])
                if ORDER[tier] < ORDER[t['tier']]: t['tier'] = tier
    # several Rav Tzadok passages leading to the same place make it stronger; a single weak link stays "possible"
    # weigh: long sections down; results whose own text speaks of the topic (or quotes the source) up, others well down
    for r, t in list(ish.items()) + list(out.items()):
        ok = rel(r, tuple(t.get('cites', {}))) if rel else None
        t['rel'] = ok
        t['score'] *= length_factor(r) * (1.6 if ok else 0.3 if ok is False else 1)
    def tier_of(t):
        n = len(t['via'])
        if t.get('rel') is False: return 'possible'
        if t['tier'] == 'strong' or (t['tier'] == 'likely' and n >= 3): return 'strong'
        if t['tier'] == 'likely' or n >= 3 or (t.get('rel') and n >= 2): return 'likely'
        return 'possible'
    ish_list = sorted(ish.items(), key=lambda kv: (-(kv[1].get('rel') is not False), -kv[1]['score']))[:14]
    ish_out = [[r, tier_of(t), round(t['score'], 2), [v for v, _ in t['via'].most_common(3)], [c for c, _ in t['cites'].most_common(3)], [x for x, _ in t['words'].most_common(4)], 1 if t.get('rel') else 0] for r, t in ish_list]
    by_g = collections.defaultdict(list)
    for r, t in sorted(out.items(), key=lambda kv: (-(kv[1].get('rel') is not False), -kv[1]['score'])):
        if len(by_g[t['genre']]) < 5: by_g[t['genre']].append([r, t['title'], t['genre'], tier_of(t), round(t['score'], 2), [v for v, _ in t['via'].most_common(3)], [x for x, _ in t['words'].most_common(4)], 1 if t.get('rel') else 0])
    out_list = [x for g in ('Chassidus', 'Kabbalah', 'Machshava', 'Mussar') for x in by_g.get(g, [])]
    return ish_out, out_list

# ---- texts, to check that a result really speaks of the topic / quotes the source, and to weigh long sections down
import sys
MCP = Path(sys.argv[1] if len(sys.argv) > 1 else 'dist/mcp-data')
CORPUS = sys.argv[2] if len(sys.argv) > 2 else None
def norm(s):
    s = re.sub(r'[\u0591-\u05C7]', '', s or '')
    for a, b in zip('ךםןףץ', 'כמנפצ'): s = s.replace(a, b)
    s = re.sub(r'[׳״\'"`]', '', s); s = re.sub(r'[^\u05D0-\u05EA]+', ' ', s)
    return ' ' + ' '.join(s.split()) + ' '
TEXT = {}
cat = json.loads((MCP / 'catalog.json').read_text())
for b in cat['books']:
    if not b['title'].startswith(ISH): continue
    paras = json.loads((MCP / 'text' / (b['slug'] + '.json')).read_text())['paras']
    def pt(x):
        ph = x.get('p'); ph = json.loads(ph) if isinstance(ph, str) else ph
        return ' '.join(y[0] for y in ph) if ph else (x.get('t') or '')
    for sec in b['sections']:
        TEXT[sec['ref']] = norm(' '.join(pt(x) for x in paras[sec['first']:sec['first'] + sec['count']]))
    for x in paras: TEXT.setdefault(x['r'], norm(pt(x)))
if CORPUS:
    for line in gzip.open(CORPUS, 'rt', encoding='utf-8'):
        e = json.loads(line); TEXT[e['ref']] = norm(e['he'])
def text_of(ref):
    if ref in TEXT: return TEXT[ref]
    b = base(ref)
    if b in TEXT: return TEXT[b]
    parts = [v for k, v in TEXT.items() if k.startswith(ref + ':')] if False else []
    return ''
print('texts', len(TEXT))
STOPW = set('של את על אל עם כל זה זו הוא היא ענין עניין בין לבין או גם רק אצל כמו'.split())
def topic_terms(he):
    ws = [w for w in norm(re.sub(r'\([^)]*\)', '', he)).split() if len(w) >= 3 and w not in STOPW]
    ws = [re.sub(r'^ה(?=...)', '', w) for w in ws]
    return sorted(ws, key=len, reverse=True)[:2]
def relevant_topic(terms):
    return lambda ref: (lambda t: bool(t) and all(w in t for w in terms))(text_of(ref)) if terms else None
def relevant_source(key, quotes):
    runs = set()
    for q in quotes:
        ws = [w for w in norm(q).split() if len(w) >= 2 and w not in ('וגו', 'וכו', 'וכוי')]
        for i in range(len(ws) - 2): runs.add(' ' + ' '.join(ws[i:i + 3]) + ' ')
    return lambda ref, cites=(): key in (cites or ()) or (lambda t: any(r in t for r in runs))(text_of(ref))
def length_factor(ref):
    t = text_of(ref)
    n = len(t.split()) if t else 600
    return 1 / max(1.0, n / 600) ** 0.5

entries = [json.loads(l) for l in gzip.open('sources/mafteach/entries.jsonl.gz', 'rt', encoding='utf-8')]
HEAD = {t['id']: t['he'] for t in json.loads(Path('sources/mafteach/glossary.json').read_text())['terms']}
QUOTES = collections.defaultdict(list)
for e in entries:
    if e['x'] == 's' and e.get('k'): QUOTES[e['k']].append(e['t'])
by_topic = collections.defaultdict(collections.Counter)
by_source = collections.defaultdict(collections.Counter)
for e in entries:
    for r in e['r']:
        if not r[1]: continue
        w = 2.0 if len(r) > 2 and '*' in str(r[-1]) else 1.0
        if e['x'] == 't':
            for T in {e.get('T'), e.get('U')} - {None}: by_topic[T][r[1]] = max(by_topic[T][r[1]], w)
        elif e.get('k'): by_source[e['k']][r[1]] = max(by_source[e['k']][r[1]], w)

OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('*.json'): f.unlink()
chunks = collections.defaultdict(dict)
stat = collections.Counter()
for T, refs in by_topic.items():
    terms = topic_terms(HEAD.get(T, ''))
    ish, out = aggregate(refs, (lambda f: (lambda r, c=(): f(r)))(relevant_topic(terms)) if terms else None)
    if ish or out:
        chunks[T // 100][str(T)] = {'ish': ish, 'out': out, 'n': len(refs)}
        stat['topics'] += 1; stat['ish'] += len(ish); stat['out'] += len(out)
for c, d in chunks.items():
    (OUT / f'topics-{c:02d}.json').write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
src_files = collections.defaultdict(dict)
for k, refs in by_source.items():
    ish, out = aggregate(refs, relevant_source(k, QUOTES[k]))
    if not (ish or out): continue
    m = re.match(r'^(.*?)\s+(\d+)[ab]?(?::\d+)?$', k)
    fk = fkey(f'{m.group(1)} {m.group(2)}') if m else fkey(k)
    src_files[fk][k] = {'ish': ish[:8], 'out': out[:12], 'n': len(refs)}
    stat['sources'] += 1
for fk, d in src_files.items():
    (OUT / f'sources-{fk}.json').write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
sizes = [f.stat().st_size for f in OUT.glob('*.json')]
print(dict(stat), 'files', len(sizes), 'MB', round(sum(sizes) / 1e6, 2), 'largest KB', round(max(sizes) / 1e3))

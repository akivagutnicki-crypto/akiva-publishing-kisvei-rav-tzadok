#!/usr/bin/env python3
"""Usage: python3 scripts/build-mafteach-parallels.py OUT.json  (then scripts/shard-mafteach-parallels.py OUT.json dist/library/mafteach)
Build mafteach_parallels.json: Mafteach-based parallels, footnote leads and Sefaria links for every
library passage the index points to.

Signals (two passages are parallels when the index groups them together):
  line      both listed on the same index line (same topic sentence / same quoted source words)   strongest
  subtopic  both under the same numbered sub-heading of a topic
  verse     both draw on the same pasuk / amud / midrash siman (source key, e.g. Genesis 2:7)
  topic     both under the same topic heading
  chapter   both draw on the same chapter / daf (Genesis 2, Berakhot 6)
Each shared group adds weight / log2(1 + group size), so small, specific groups count far more than broad ones.
A target the index marks "discussed at length" gets a boost; OCR-uncertain references count half.
"""
import json, gzip, math, re, sys, collections, glob

import os
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sources', 'mafteach')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'mafteach_parallels.json'
TOPK = 20

G = json.load(open(f'{REPO}/glossary.json'))
terms = {t['id']: t for t in G['terms']}
entries = [json.loads(l) for l in gzip.open(f'{REPO}/entries.jsonl.gz', 'rt', encoding='utf-8')]

# ---------- valid library refs ----------
valid = set(l.strip() for l in open(f'{REPO}/library-refs.txt', encoding='utf-8') if l.strip())   # library section refs

# ---------- Sefaria links ----------
CHAPTERS = {'Genesis': 50, 'Exodus': 40, 'Leviticus': 27, 'Numbers': 36, 'Deuteronomy': 34, 'Joshua': 24, 'Judges': 21, 'I Samuel': 31,
            'II Samuel': 24, 'I Kings': 22, 'II Kings': 25, 'Isaiah': 66, 'Jeremiah': 52, 'Ezekiel': 48, 'Hosea': 14, 'Joel': 4, 'Amos': 9,
            'Obadiah': 1, 'Jonah': 4, 'Micah': 7, 'Nahum': 3, 'Habakkuk': 3, 'Zephaniah': 3, 'Haggai': 2, 'Zechariah': 14, 'Malachi': 3,
            'Psalms': 150, 'Proverbs': 31, 'Job': 42, 'Song of Songs': 8, 'Ruth': 4, 'Lamentations': 5, 'Ecclesiastes': 12, 'Esther': 10,
            'Daniel': 12, 'Ezra': 10, 'Nehemiah': 13, 'I Chronicles': 29, 'II Chronicles': 36}
DAPIM = {'Berakhot': 64, 'Shabbat': 157, 'Eruvin': 105, 'Pesachim': 121, 'Shekalim': 22, 'Yoma': 88, 'Sukkah': 56, 'Beitzah': 40,
         'Rosh Hashanah': 35, 'Taanit': 31, 'Megillah': 32, 'Moed Katan': 29, 'Chagigah': 27, 'Yevamot': 122, 'Ketubot': 112,
         'Nedarim': 91, 'Nazir': 66, 'Sotah': 49, 'Gittin': 90, 'Kiddushin': 82, 'Bava Kamma': 119, 'Bava Metzia': 119,
         'Bava Batra': 176, 'Sanhedrin': 113, 'Makkot': 24, 'Shevuot': 49, 'Avodah Zarah': 76, 'Horayot': 14, 'Zevachim': 120,
         'Menachot': 110, 'Chullin': 142, 'Bekhorot': 61, 'Arakhin': 34, 'Temurah': 34, 'Keritot': 28, 'Meilah': 22, 'Tamid': 33,
         'Niddah': 73}
def plausible(key):
    md = re.match(r'^(.*?)\s+(\d+)[ab]?$', key or '')
    if md and md.group(1) in DAPIM:
        d = int(md.group(2)); return 2 <= d <= DAPIM[md.group(1)]
    m = re.match(r'^(.*?)\s+(\d+)', key or '')
    if not m: return False
    book, ch = m.group(1), int(m.group(2))
    return ch >= 1 and (book not in CHAPTERS or ch <= CHAPTERS[book])
def sefaria(key):
    if not key or not plausible(key): return None
    m = re.match(r'^(.*?)\s+(\d+[ab]?)(?::(\d+))?$', key)
    if not m: return None
    book, a, b = m.groups()
    path = book.replace(' ', '_') + '.' + a + ('.' + b if b else '')
    return f'https://www.sefaria.org/{path}'

# ---------- groups ----------
WEIGHT = {'line': 3.0, 'subtopic': 1.6, 'verse': 2.2, 'topic': 0.9, 'chapter': 0.7}
groups = collections.defaultdict(lambda: collections.defaultdict(float))   # (type, key) -> {ref: strength}
reasons_meta = {}
passage_topics = collections.defaultdict(set)
passage_sources = collections.defaultdict(dict)
invalid = collections.Counter()

def chapter_of(key):
    m = re.match(r'^(.*?\s\d+)[ab]?(?::\d+)?$', key or '')
    return m.group(1) if m else None

for e in entries:
    refs = []
    for r in e['r']:
        kr = r[1]
        if not kr: continue
        if kr not in valid:
            invalid[kr.rsplit(' ', 1)[0]] += 1
            continue
        flags = r[-1] if isinstance(r[-1], str) and re.fullmatch(r'[*?~]+', r[-1] or '') else ''
        strength = (1.25 if '*' in flags else 1.0) * (0.5 if '?' in flags else 1.0)
        refs.append((kr, strength, '*' in flags))
    if not refs: continue
    tlabel = lambda tid: (terms[tid]['he'], terms[tid].get('en')) if tid in terms else (None, None)
    keys = [('line', e['id'])]
    if e['x'] == 't':
        if e.get('T') is not None:
            keys.append(('topic', f"T{e['T']}"))
            reasons_meta.setdefault(('topic', f"T{e['T']}"), dict(type='topic', he=terms[e['T']]['he'], en=terms[e['T']].get('en')))
        if e.get('U') is not None:
            keys.append(('subtopic', f"U{e['U']}"))
            reasons_meta.setdefault(('subtopic', f"U{e['U']}"), dict(type='subtopic', he=terms[e['U']]['he'], en=terms[e['U']].get('en'),
                                                                    topic=terms[e['T']]['he'] if e.get('T') in terms else None))
        tid = e.get('U', e.get('T'))
        topic_he, topic_en = tlabel(e['T']) if e.get('T') is not None else (e.get('Th'), None)
        reasons_meta[('line', e['id'])] = dict(type='line', he=e["t"][:70], topic=topic_he, topic_en=topic_en)
        for kr, _, _ in refs:
            if e.get('T') is not None: passage_topics[kr].add(e['T'])
    else:
        k = e.get('k')
        label = k or ' '.join(x for x in (e.get('b'), e.get('ch'), e.get('vs')) if x)
        reasons_meta[('line', e['id'])] = dict(type='source_line', he=e["t"][:70], source=label, sefaria=1 if sefaria(k) else 0)
        if k:
            keys.append(('verse', k))
            reasons_meta.setdefault(('verse', k), dict(type='source', key=k, sefaria=1 if sefaria(k) else 0))
            ch = chapter_of(k)
            if ch and ch != k:
                keys.append(('chapter', ch))
                reasons_meta.setdefault(('chapter', ch), dict(type='source_chapter', key=ch, sefaria=1 if sefaria(ch) else 0))
        elif e.get('B') is not None:
            keys.append(('chapter', f"B{e['B']}:{e.get('ch') or ''}"))
            reasons_meta.setdefault(('chapter', f"B{e['B']}:{e.get('ch') or ''}"), dict(type='source_chapter', key=' '.join(x for x in (terms[e['B']]['he'], e.get('ch')) if x), en=terms[e['B']].get('en')))
        for kr, _, at_len in refs:
            sk = k or label
            cur = passage_sources[kr].get(sk)
            item = dict(source=sk, quote=e['t'], sefaria=sefaria(k), at_length=at_len, corpus=e['c'])
            if not cur or (at_len and not cur['at_length']): passage_sources[kr][sk] = item
    for gk in keys:
        for kr, st, _ in refs:
            groups[gk][kr] = max(groups[gk][kr], st)

# ---------- score pairs ----------
scores = collections.defaultdict(lambda: collections.defaultdict(float))
why = collections.defaultdict(lambda: collections.defaultdict(list))
for gk, members in groups.items():
    n = len(members)
    if n < 2 or n > 400: continue
    base = WEIGHT[gk[0]] / math.log2(1 + n)
    items = list(members.items())
    for a, sa in items:
        for b, sb in items:
            if a == b: continue
            w = base * sb * (0.5 + 0.5 * sa)
            scores[a][b] += w
            why[a][b].append((w, gk))

# ---------- reasons table + output ----------
reason_ids = {}
reasons = []
def rid(gk):
    if gk not in reason_ids:
        reason_ids[gk] = len(reasons)
        reasons.append(reasons_meta.get(gk, dict(type=gk[0], key=gk[1])))
    return reason_ids[gk]

passages = {}
allrefs = set(scores) | set(passage_topics) | set(passage_sources)
for p in sorted(allrefs):
    par = sorted(scores[p].items(), key=lambda x: -x[1])[:TOPK]
    plist = []
    for q, sc in par:
        if sc < 0.35: continue
        top = sorted(why[p][q], key=lambda x: -x[0])
        rs, seen = [], set()
        for w, gk in top:
            if gk in seen: continue
            seen.add(gk); rs.append(rid(gk))
            if len(rs) == 3: break
        plist.append([q, round(sc, 2), rs])
    srcs = sorted(passage_sources[p].values(), key=lambda x: (not x['at_length'], x['source']))
    passages[p] = dict(
        topics=[[terms[t]['he'], terms[t].get('en')] for t in sorted(passage_topics[p], key=lambda t: -terms[t]['n'])][:30],
        sources=[[s['source'], s["quote"][:70], 1 if s['sefaria'] else 0, 1 if s['at_length'] else 0] for s in srcs][:50],
        parallels=plist)

out = dict(
    meta=dict(name='HaMafteach HaShalem parallels', version='2026-11-02',
              description="Parallels between R. Tzadok passages derived from R' Chaim Hirsch's HaMafteach HaShalem (OCR). "
                          'parallels: [ref, score, [reason ids]] best first; sources: [source, quoted words, sefaria url, at_length]; '
                          'topics: [hebrew, english]. sefaria=1 means the source key has a Sefaria page: '
                          'url = "https://www.sefaria.org/" + key with spaces as "_" and ":" or the space before the address as "." '
                          '(Genesis 2:7 -> Genesis.2.7, Berakhot 6b -> Berakhot.6b, Bereshit Rabbah 2:4 -> Bereshit_Rabbah.2.4).',
              passages=len(passages), parallel_links=sum(len(v['parallels']) for v in passages.values()),
              weights=WEIGHT, top_k=TOPK, min_score=0.35,
              dropped_invalid_refs=dict(invalid.most_common())),
    reasons=reasons,
    passages=passages)
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
import os
print('passages', len(passages), 'links', out['meta']['parallel_links'], 'reasons', len(reasons),
      'size MB', round(os.path.getsize(OUT) / 1e6, 2), 'invalid dropped', sum(invalid.values()), dict(invalid.most_common(8)))

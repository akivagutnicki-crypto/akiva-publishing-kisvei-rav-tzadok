#!/usr/bin/env python3
"""Correct HaMafteach HaShalem's OCR'd data: every change is logged and reversible.

Input:  sources/mafteach/entries-ocr.jsonl.gz   the index as OCR'd and parsed (made from entries.jsonl.gz on first run)
Output: sources/mafteach/entries.jsonl.gz       the corrected index (read by every build)
        sources/mafteach/fixes-log.jsonl        one line per change: {id, step, field, was, now, why}
        sources/mafteach/fixes-summary.json     counts per step

Steps
  blocks   merged OCR blocks (a whole page of a section run together, hundreds of refs) are removed
  zohar    part ז's Zohar run (pp. 556–661), labelled "הגדה של פסח" by a missed heading, becomes Zohar I/II/III by daf;
           daf numbers that break the index's own order are repaired by the OCR's usual letter confusions (קנח→קכח, תו→רנו)
  texts    every quoted pasuk / Mishnah / Gemara / Midrash / Tikkunim is looked up in the text itself
           (source-texts.jsonl.gz); a wrong chapter, verse, daf or book is corrected when the quote is found elsewhere
  reviewed corrections checked by hand against the passage, maamar by maamar (sources/mafteach/reviewed/*-corrections.json;
           so far Pri Tzaddik Chayei Sarah 1-11): addresses and books fixed, misplaced references moved or removed,
           sources the index missed added (marked "added": "reviewed")

Every source entry gets "vq": c confirmed in the text · a address fixed · b book fixed · l address supplied ·
u not found · s quote too short · n text not available (Zohar I-III, Sifrei, Rambam ...).

Usage (from the repository root):
  python3 scripts/mafteach/perfect.py source-texts.jsonl.gz [sources/mafteach/reviewed]
  source-texts.jsonl.gz: the asset of the genre-corpus-2026-11 pre-release (scripts/genre-corpus/build_source_texts.py)
"""
import gzip, json, re, sys, os, collections, glob

D = 'sources/mafteach'
RAW, OUT = f'{D}/entries-ocr.jsonl.gz', f'{D}/entries.jsonl.gz'
if not os.path.exists(RAW):
    os.replace(OUT, RAW)
entries = [json.loads(l) for l in gzip.open(RAW, 'rt', encoding='utf-8')]
log, count = [], collections.Counter()
def note(e, step, field, was, now, why):
    log.append(dict(id=e['id'], step=step, field=field, was=was, now=now, why=why)); count[step] += 1

GEM = dict(zip('אבגדהוזחטיכלמנסעפצקרשתךםןףץ', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 20, 40, 50, 80, 90]))
gem = lambda s: sum(GEM.get(c, 0) for c in str(s or ''))
def heb(n):
    out = ''
    for v, c in ((400, 'ת'), (300, 'ש'), (200, 'ר'), (100, 'ק')):
        while n >= v: out += c; n -= v
    if n in (15, 16): return out + ('טו' if n == 15 else 'טז')
    for v, c in ((90, 'צ'), (80, 'פ'), (70, 'ע'), (60, 'ס'), (50, 'נ'), (40, 'מ'), (30, 'ל'), (20, 'כ'), (10, 'י')):
        if n >= v: out += c; n -= v
    return out + ('אבגדהוזחט'[n - 1] if n else '')

# ---------------------------------------------------------------- blocks
keep = []
for e in entries:
    if len(e['t']) > 300 and len(e['r']) > 25:
        note(e, 'blocks', 'entry', e['t'][:120], None, f'merged OCR block with {len(e["r"])} refs'); continue
    keep.append(e)
entries = keep

# ---------------------------------------------------------------- zohar (part ז)
MAXDAF = {1: 251, 2: 280, 3: 300}
CONF = [('נ', 'כ'), ('כ', 'נ'), ('ת', 'רנ'), ('ס', 'ט'), ('ט', 'ס'), ('ח', 'ה'), ('ה', 'ח'), ('ג', 'נ'), ('נ', 'ג'), ('ז', 'ו'), ('ו', 'ז'),
        ('ר', 'ד'), ('ד', 'ר'), ('ב', 'כ'), ('כ', 'ב'), ('ע', 'צ'), ('צ', 'ע'), ('ל', 'ג'), ('י', 'ו'), ('ו', 'י'), ('ם', 'ס'), ('ש', 'ע')]
def variants(s):
    for a, b in CONF:
        for i in range(len(s)):
            if s[i:i + len(a)] == a: yield s[:i] + b + s[i + len(a):]
    for i in range(len(s)):                                             # a letter lost or added by the OCR
        yield s[:i] + s[i + 1:]
    for c in 'קרשת':                                                     # a lost hundreds letter (ח for רח)
        yield c + s
zoh = [e for e in entries if e['v'] == '7' and e['x'] == 's' and e.get('b') == 'הגדה של פסח' and e['p'] >= 556 and e.get('ch') and gem(e['ch'])]
zoh.sort(key=lambda e: e['id'])
# volumes: the index starts each Zohar volume again at daf א; a reset is a high daf followed by a long run of low ones
ds = [gem(e['ch']) for e in zoh]
vol, high = 1, 0
for i, e in enumerate(zoh):
    ahead = sorted(ds[i:i + 25])
    if high > 150 and ds[i] < 40 and ahead[len(ahead) // 2] < 40 and vol < 3: vol, high = vol + 1, 0
    e['_vol'], e['_daf'] = vol, ds[i]
    if ds[i] <= MAXDAF[vol]: high = max(high, ds[i])
# within a volume the index runs in daf order: the longest non-decreasing chain is trusted,
# and every daf off the chain is repaired by an OCR confusion that puts it back between its neighbours
import bisect
for v in (1, 2, 3):
    run = [e for e in zoh if e['_vol'] == v]
    tails, tidx, parent = [], [], [None] * len(run)
    for i, e in enumerate(run):
        d = e['_daf'] if e['_daf'] <= MAXDAF[v] else 10 ** 6
        j = bisect.bisect_right(tails, d)
        if j == len(tails): tails.append(d); tidx.append(i)
        else: tails[j], tidx[j] = d, i
        parent[i] = tidx[j - 1] if j else None
    chain, k = set(), tidx[-1] if tidx else None
    while k is not None: chain.add(k); k = parent[k]
    order = sorted(chain)
    for i, e in enumerate(run):
        if i in chain: continue
        j = bisect.bisect_left(order, i)
        lo = run[order[j - 1]]['_daf'] if j else 1
        hi = run[order[j]]['_daf'] if j < len(order) else MAXDAF[v]
        best = None
        for s2 in variants(e['ch']):
            d2 = gem(s2)
            if lo <= d2 <= hi and d2 <= MAXDAF[v]:
                if best is None or abs(d2 - (lo + hi) / 2) < abs(best[1] - (lo + hi) / 2): best = (s2, d2)
        if best:
            note(e, 'zohar', 'daf', e['ch'], best[0], f'out of the index order ({heb(lo)}–{heb(hi)}); OCR letter confusion')
            e['ch'], e['_daf'] = best
        else:
            e['_uncertain'] = 1
ROMAN = {1: 'I', 2: 'II', 3: 'III'}
HE_VOL = {1: "זהר חלק א'", 2: "זהר חלק ב'", 3: "זהר חלק ג'"}
for e in zoh:
    amud = 'b' if e.get('vs') == 'ב' else 'a'
    key = f"Zohar {ROMAN[e['_vol']]} {e['_daf']}{amud}"
    note(e, 'zohar', 'source', f"הגדה של פסח {e.get('ch')} {e.get('vs') or ''}".strip(), key, 'part ז: the Zohar heading after the Haggadah was missed')
    e.update(b=HE_VOL[e['_vol']], bn=HE_VOL[e['_vol']], cat='Kabbalah', k=key, B=1622)
    if e.pop('_uncertain', None):
        for r in e['r']:
            if len(r) == 4 and '?' not in r[3]: r[3] += '?'
    e.pop('_vol', None); e.pop('_daf', None)

for e in entries:
    if e['x'] == 's' and e.get('cat') == 'Shulchan Arukh' and 'זהר' in (e.get('b') or ''):
        note(e, 'zohar', 'category', 'Shulchan Arukh', 'Kabbalah', 'a Zohar book filed under Shulchan Arukh'); e['cat'] = 'Kabbalah'

# ---------------------------------------------------------------- texts
def run_texts(path):
    if not path or not os.path.exists(path): print('texts: no source texts given, skipped'); return
    import importlib.util
    spec = importlib.util.spec_from_file_location('verify', os.path.join(os.path.dirname(__file__), 'verify_quotes.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    mod.verify(entries, path, note)

# ---------------------------------------------------------------- reviewed corrections
def run_reviewed(folder):
    """corrections checked by hand against the passage, one file per maamar (scratch output of the Chayei Sarah review)"""
    if not folder: return
    byid = {e['id']: e for e in entries}
    label = {r[1]: r[0] for e in entries for r in e.get('r', []) if len(r) > 1}
    bookinfo = {}
    for e in entries:
        if e['x'] == 's' and e.get('k') and e.get('cat'):
            bookinfo.setdefault(re.match(r'(.+) \S+$', e['k']).group(1), {x: e.get(x) for x in ('b', 'bn', 'cat', 'B')})
    def unref(e, ref, why):
        keep = [r for r in e['r'] if r[1] != ref]
        if len(keep) == len(e['r']): return False
        note(e, 'reviewed', 'ref', ref, None, why); e['r'] = keep
        if not keep: e['_drop'] = 1
        return True
    seen = set()
    for f in sorted(glob.glob(os.path.join(folder, '*-corrections.json'))):
        try: items = json.load(open(f, encoding='utf-8'))
        except Exception: continue
        for c in items if isinstance(items, list) else []:
            e = byid.get(c.get('id'))
            act, ref, cor = c.get('action'), c.get('ref'), c.get('correct')
            sig = (c.get('id'), act, ref, cor)
            if sig in seen: continue
            seen.add(sig)
            why = 'checked against the passage: ' + (c.get('note') or '')[:200]
            iskey = bool(cor and re.match(r'^[A-Z][\w\' ,]+ \d+[ab]?(:\d+)*$', cor))
            if act in ('fix_address', 'fix_book') and e and e['x'] == 's' and iskey and cor != e.get('k'):
                note(e, 'reviewed', 'source', e.get('k'), cor, why); e['k'] = cor
                info = bookinfo.get(re.match(r'(.+) \S+$', cor).group(1))
                if act == 'fix_book' and info: e.update({x: v for x, v in info.items() if v})
            elif act == 'drop' and e:
                if len(e['t']) > 300 or len(e['r']) <= 1:
                    if not e.get('_drop'): note(e, 'reviewed', 'entry', e['t'][:120], None, why); e['_drop'] = 1
                else:
                    unref(e, ref, why)
            elif act == 'move' and e:
                if e['x'] == 's' and iskey and cor != e.get('k'):
                    note(e, 'reviewed', 'source', e.get('k'), cor, why); e['k'] = cor
                to = c.get('correct_ref')
                if to and to != ref and any(r[1] == ref for r in e['r']):
                    if any(r[1] == to for r in e['r']): unref(e, ref, why)
                    else:
                        for r in e['r']:
                            if r[1] == ref:
                                note(e, 'reviewed', 'ref', ref, to, why); r[0], r[1] = label.get(to, r[0]), to
                elif not to:
                    unref(e, ref, why)
            elif act == 'add_source' and iskey and ref:
                nid = f"rev-{len(log):06d}"
                info = bookinfo.get(re.match(r'(.+) \S+$', cor).group(1)) or {}
                pt = ref.startswith('Peri Tzadik')
                ne = dict(id=nid, v='7' if pt else '3', x='s', c='pt' if pt else 'rt', p=0, t=c.get('quote') or c.get('index_text') or '',
                          k=cor, r=[[label.get(ref, ref), ref]], added='reviewed', **{x: v for x, v in info.items() if v})
                entries.append(ne)
                log.append(dict(id=nid, step='reviewed', field='entry', was=None, now=cor, why='added (missing from the index); ' + why)); count['reviewed'] += 1

run_texts(sys.argv[1] if len(sys.argv) > 1 else None)
run_reviewed(sys.argv[2] if len(sys.argv) > 2 else f'{D}/reviewed')
entries = [e for e in entries if not e.pop('_drop', None)]
with gzip.open(OUT, 'wt', encoding='utf-8') as f:
    for e in entries: f.write(json.dumps(e, ensure_ascii=False, separators=(',', ':')) + '\n')
with open(f'{D}/fixes-log.jsonl', 'w', encoding='utf-8') as f:
    for x in log: f.write(json.dumps(x, ensure_ascii=False) + '\n')
json.dump(dict(entries=len(entries), changes=dict(count)), open(f'{D}/fixes-summary.json', 'w'), indent=1)
print('entries', len(entries), dict(count))

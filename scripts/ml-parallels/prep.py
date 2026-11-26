#!/usr/bin/env python3
"""Corpus for the parallels model: one unit per teaching (reader section; a Mei HaShiloach paragraph),
with normalized Hebrew text and the sources it cites. Also the library engine's existing parallels, mapped to units."""
import json, glob, re, collections, os, pickle
def load_text(d, slug):   # a large book's text comes in parts (scripts/mcp-text-parts.mjs)
    t = json.load(open(f"{d}/{slug}.json"))
    if t.get('parts'): t = dict(slug=slug, paras=[p for k in range(1, t['parts'] + 1) for p in json.load(open(f"{d}/{slug}.part{k}.json"))['paras']])
    return t
import os
S = os.environ.get('ML_WORK', 'ml-work')   # work dir: needs S/ci/dist/mcp-data (built site) and S/par/mafteach_parallels.json
D = f'{S}/ci/dist/mcp-data'
ISHBITZ = {'torat-emet', 'imrei-emet', 'beit-yaakov-on-torah', 'beit-yaakov-shemos', 'beit-yaakov-vayikra', 'beit-yaakov-bamidbar', 'beit-yaakov-devarim', 'beit-yaakov-moadim', 'mei-hashiloach', 'sod-yesharim', 'tiferet-yosef', 'sha-ar-haemunah-veyesod-hachasidut',
           'ne-ot-deshe', 'tiferet-hachanokhi', 'ein-hatekhelet', 'ptil-tekhelet', 'sefunei-temunei-chol', 'orchot-chaim-and-eser-milin',
           'sidrei-taharot-ohalot', 'sidrei-taharot-kelim'}
SKIP_SEC = re.compile(r'(Title|Introduction(?! to Beit Yaakov)|Preface|Approbation|Haskamah|Table of Contents|Publisher)', re.I)

def norm_he(s):
    s = re.sub(r'[֑-ׇ]', '', s)
    s = s.replace('ך', 'כ').replace('ם', 'מ').replace('ן', 'נ').replace('ף', 'פ').replace('ץ', 'צ')
    s = re.sub(r'[׳״\'"`]', '', s)
    s = re.sub(r'[^א-ת]+', ' ', s)
    return ' '.join(s.split())

cat = json.load(open(f'{D}/catalog.json'))
units = collections.OrderedDict()          # ref -> dict
para2unit = {}
for b in cat['books']:
    t = load_text(f"{D}/text", b['slug'])
    secs = b['sections']
    for p in t['paras']:
        si = int(p['s']) if str(p.get('s', '')).isdigit() else None
        sec = secs[si] if si is not None and si < len(secs) else None
        if b['slug'] == 'mei-hashiloach':
            uref = p['r']
        else:
            uref = sec['ref'] if sec else re.sub(r':\d+$', '', p['r'])
        if SKIP_SEC.search(uref): continue
        # Pri Tzaddik has two editions of some sections under one ref: keep the first edition's paragraphs only
        u = units.get(uref)
        if u is None:
            u = units[uref] = dict(ref=uref, book=b['title'], slug=b['slug'], school='Ishbitz-Radzin' if b['slug'] in ISHBITZ else 'Rav Tzadok',
                                   he='', cites=[], sec=si, title=(sec or {}).get('title', ''), he_title=(sec or {}).get('he', ''))
        elif u['sec'] != si and b['slug'] != 'mei-hashiloach':
            continue
        if p.get('p'):
            phr = p['p'] if isinstance(p['p'], list) else json.loads(p['p'])
            he = ' '.join(x[0] for x in phr)
        else:
            he = p.get('t') or ''
        u['he'] += ' ' + norm_he(he)
        cs = p.get('c') or []
        if isinstance(cs, str): cs = json.loads(cs.replace("'", '"'))
        u['cites'] += [c[0] for c in cs]
        para2unit[p['r']] = uref

units = {k: v for k, v in units.items() if len(v['he'].split()) >= 25}
# library engine parallels (paragraph level) -> unit pairs, max score
engine = collections.defaultdict(float)
for f in glob.glob(f'{D}/parallels/*.json'):
    if f.endswith('index.json'): continue
    for pref, v in json.load(open(f)).items():
        a = para2unit.get(pref)
        for item in v.get('p', []):
            b2 = para2unit.get(item[0])
            if a and b2 and a != b2 and a in units and b2 in units:
                engine[(a, b2)] = max(engine[(a, b2)], float(item[1]))
pickle.dump(dict(units=units, engine=dict(engine)), open(f'{S}/ml/corpus.pkl', 'wb'))
c = collections.Counter((u['school'], u['book']) for u in units.values())
for k, n in sorted(c.items()): print(f'{n:5d}  {k[0]:15s} {k[1]}')
print('units', len(units), 'engine pairs', len(engine), 'words', sum(len(u['he'].split()) for u in units.values()))

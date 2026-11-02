"""Learn from the reader's existing footnotes: which source a phrase cites, which words of that
source the editors quoted, and how they wrote the context.

Every reader footnote is anchored to a Hebrew phrase and usually reads
    <Source ref>: “<quoted source text>” Context / Context and connection: <explanation>
(Tzidkat, Peri Tzadik, Dover Tzedek, Takanat HaShavin ... use variants of this shape).

`extract` turns every footnote into a structured record. `SourceMemory` indexes the Hebrew anchor
phrases so that, for a new phrase, it proposes the sources editors attached to the same or similar
wording elsewhere, together with those footnotes' quotations and context as worked examples.
Only footnotes and in-text editorial links are used; the reader's side-panel links are ignored.
"""
import json
import math
import os
import re
from collections import Counter, defaultdict

from .hebrew import strip_nikkud
from .sefaria import normalize_ref

# Seforim whose footnotes are edited to standard and are learned from. The other seforim's footnotes and
# parallels still need editorial work, so they are not used as examples (their text is still searched).
TRUSTED_SLUGS = ('peri-tzadik', 'tzidkat-hatzadik', 'resisei-layla', 'takanat-hashavin', 'dover-tzedek')
TRUSTED_BOOKS = ('Peri Tzadik', 'Tzidkat HaTzadik', 'Resisei Layla', 'Takanat HaShavin', 'Dover Tzedek')

QUOTE_OPEN = '“‘"«'
LIB_TITLES = {  # Ashkenazi / variant spellings used in footnotes -> reader titles
    'Machshavos Charutz': 'Machshavot Charutz', 'Tzidkas HaTzaddik': 'Tzidkat HaTzadik', 'Tzidkas HaTzadik': 'Tzidkat HaTzadik',
    'Pri Tzaddik': 'Peri Tzadik', 'Pri Tzadik': 'Peri Tzadik', 'Resisei Laylah': 'Resisei Layla', 'Takanas HaShavin': 'Takanat HaShavin',
    'Sefer HaZichronos': 'Sefer HaZikhronot', 'Sefer HaZikhronos': 'Sefer HaZikhronot', 'Dover Tzedek': 'Dover Tzedek',
    'Yisrael Kedoshim': 'Yisrael Kedoshim', 'Kometz HaMinchah': 'Kometz HaMinchah', 'Ohr Zarua LaTzaddik': 'Ohr Zarua LaTzadik',
    'Ohr Zarua LaTzadik': 'Ohr Zarua LaTzadik', 'Mei HaShiloach': 'Mei HaShiloach', 'Beis Yaakov': 'Beit Yaakov on Torah',
    'Beit Yaakov': 'Beit Yaakov on Torah', 'Sichas Malachei HaShareis': 'Sichat Malakhei HaSharet', 'Poked Akarim': 'Poked Akarim',
    'Divrei Sofrim': 'Divrei Soferim', 'Divrei Soferim': 'Divrei Soferim', 'Likkutei Maamarim': 'Likkutei Maamarim',
}
ASHKENAZI = [  # tractate and work spellings in the footnotes -> Sefaria titles
    ('Berachos', 'Berakhot'), ('Brachos', 'Berakhot'), ('Shabbos', 'Shabbat'), ('Eruvin', 'Eruvin'), ('Pesachim', 'Pesachim'),
    ('Yoma', 'Yoma'), ('Sukkah', 'Sukkah'), ('Beitzah', 'Beitzah'), ('Rosh Hashanah', 'Rosh Hashanah'), ('Taanis', 'Taanit'),
    ("Ta'anis", 'Taanit'), ('Ta’anit', 'Taanit'), ("Ta'anit", 'Taanit'), ('Megillah', 'Megillah'), ('Moed Katan', 'Moed Katan'),
    ('Chagigah', 'Chagigah'), ('Yevamos', 'Yevamot'), ('Kesubos', 'Ketubot'), ('Kesuvos', 'Ketubot'), ('Ketubos', 'Ketubot'),
    ('Nedarim', 'Nedarim'), ('Nazir', 'Nazir'), ('Sotah', 'Sotah'), ('Gittin', 'Gittin'), ('Kiddushin', 'Kiddushin'),
    ('Bava Kama', 'Bava Kamma'), ('Bava Metzia', 'Bava Metzia'), ('Bava Basra', 'Bava Batra'), ('Bava Bathra', 'Bava Batra'),
    ('Sanhedrin', 'Sanhedrin'), ('Makkos', 'Makkot'), ('Shevuos', 'Shevuot'), ('Avodah Zarah', 'Avodah Zarah'), ('Horayos', 'Horayot'),
    ('Zevachim', 'Zevachim'), ('Menachos', 'Menachot'), ('Chullin', 'Chullin'), ('Bechoros', 'Bekhorot'), ('Arachin', 'Arakhin'),
    ('Temurah', 'Temurah'), ('Kerisos', 'Keritot'), ('Meilah', 'Meilah'), ('Niddah', 'Niddah'), ('Tosafos', 'Tosafot'),
    ('Chovos HaLevavos', 'Duties of the Heart'), ('Bereishis', 'Genesis'), ('Shemos', 'Exodus'), ('Vayikra', 'Leviticus'),
    ('Bamidbar', 'Numbers'), ('Devarim', 'Deuteronomy'), ('Tractate ', ''),
]
LIB_MARK = re.compile(r'(?:^|\n)\s*(?:Kisvei (?:Rav Tzadok|Ishbitz[–-]Radzin)\s*(?:Parallel\s*[—-]|·)|Further parallel\s*[—-])\s*([^:“"\n]+?)\s*:\s*', re.I)
PLACEHOLDER = re.compile(r'Primary source background in .{0,120}? illuminating Rav Tzadok')
ADDRESS = re.compile(r'(\d+[ab]?(?:[:.]\d+[ab]?)*(?:\s*[-–]\s*\d+[ab]?(?:[:.]\d+)?)?|§\s*\d+)\s*$')
CONTEXT = re.compile(r'\b(Context(?: and connection)?|Explanation|Connection|R[’\']\s*Tzadok)\s*[:—-]\s*', re.I)


def he_norm(s):
    s = strip_nikkud(s or '')
    s = re.sub(r'[^א-ת\s]', ' ', s)
    s = s.translate(str.maketrans('ךםןףץ', 'כמנפצ'))
    return re.sub(r'\s+', ' ', s).strip()


def he_words(s):
    return [w for w in he_norm(s).split() if len(w) > 1]


def title_of(ref):
    m = ADDRESS.search(ref)
    return ref[:m.start()].rstrip(' ,') if m else ref


def ashkenazi(head):
    for a, b in ASHKENAZI:
        if head.startswith(a + ' ') or head.startswith(a + ','):
            return b + head[len(a):] if b else head[len(a):]
    return head


def _parse_one(text):
    """Split a footnote into (ref head, quotation, context). Returns None when no ref head is found.
    Placeholder notes (generated filler with no real quotation) are reported with placeholder=True."""
    raw = text or ''
    placeholder = bool(PLACEHOLDER.search(raw))
    lm = LIB_MARK.search(raw)
    if lm:  # "headline / bridge / Kisvei Rav Tzadok · <ref>: “quote” Explanation: ..." (editorial-master parallels)
        rest = re.sub(r'\s+', ' ', raw[lm.end():]).strip()
        headline = re.sub(r'\s+', ' ', raw[:lm.start()]).strip()
        if placeholder:
            headline = ''
        head = lm.group(1).strip()
        for k, v in LIB_TITLES.items():
            if head.startswith(k + ' ') or head.startswith(k + ','):
                head = v + head[len(k):]
        ctx = ''
        cm = CONTEXT.search(rest)
        if cm:
            ctx, rest = rest[cm.end():].strip(), rest[:cm.start()].strip()
        qm = re.search(r'[“‘"«](.+)[”’"»]', rest)
        return {'ref': normalize_ref(head), 'kind': 'parallel', 'quote': (qm.group(1) if qm else rest).strip(),
                'context': ctx or (rest[qm.end():].strip() if qm else ''), 'headline': headline, 'placeholder': False}
    if placeholder:
        return {'ref': None, 'kind': 'placeholder', 'quote': '', 'context': '', 'placeholder': True}
    t = re.sub(r'\s+', ' ', raw).strip()
    if not t or re.match(r'^See notes? \d', t):
        return None
    t = re.sub(r'^(?:Source|Sources|See|Cf\.|Compare)\s*[:—-]?\s*', '', t)
    kind = 'source'
    m = re.match(r'^(?:R[’\']\s*Tzadok|Rav Tzadok)\s*[—-]\s*(?:parallel|see)\s*\(([^)]+)\)\s*:?\s*', t, re.I)
    if m:
        head, rest, kind = m.group(1), t[m.end():], 'parallel'
    else:
        cut = len(t)
        for ch in QUOTE_OPEN:
            i = t.find(ch)
            if 0 < i < cut:
                cut = i
        for mk in ('English translation', 'Translation', ' — ', ' – '):
            i = t.find(mk)
            if 0 < i < cut:
                cut = i
        # the head ends at the first ': ' or '. ' that follows an address
        hm = re.match(r'^(.{3,140}?\d[ab]?(?:[-–:.]\d+[ab]?)*(?:\s*[-–]\s*\d+[ab]?(?::\d+)?)?)\s*[:.,]\s', t[:cut + 1] + ' ')
        if not hm:
            return None
        head, rest = hm.group(1), t[hm.end():]
    head = ashkenazi(head.strip().rstrip('.:,'))
    head = re.sub(r'^(\w[\w\' ]+?)\s*§\s*(\d+)', r'\1 \2', head)
    for k, v in LIB_TITLES.items():
        if head.startswith(k + ' ') or head.startswith(k + ','):
            head = v + head[len(k):]
            kind = 'parallel'
    ctx = ''
    cm = CONTEXT.search(rest)
    if cm:
        ctx, rest = rest[cm.end():].strip(), rest[:cm.start()].strip()
    rest = re.sub(r'^(?:English translation(?: of (?:the )?(?:verified )?source)?|Translation)\s*:\s*', '', rest).strip()
    qm = re.search(r'[“‘"«](.+)[”’"»]', rest)
    quote = qm.group(1).strip() if qm else rest.strip()
    tail = rest[qm.end():].strip() if qm else ''
    if not ctx and tail.startswith('(') and tail.endswith(')'):
        ctx = tail[1:-1]
    elif not ctx and len(tail) > 40:
        ctx = tail
    return {'ref': normalize_ref(head), 'kind': kind, 'quote': quote, 'context': ctx, 'placeholder': False}


def parse_note(text):
    """All (source / parallel) parts of a footnote, the head source first."""
    raw = text or ''
    lm = LIB_MARK.search(raw)
    if lm and lm.start() > 0 and not PLACEHOLDER.search(raw[:lm.start()]):
        first = _parse_one(raw[:lm.start()])
        if first and first.get('ref') and ADDRESS.search(first['ref']):
            return [first, _parse_one(raw[lm.start():])]
    one = _parse_one(raw)
    return [one] if one else []


def extract(mcp_dir, library_books=(), books=TRUSTED_SLUGS):
    """Every footnote of the trusted seforim (books=None for all) as a structured record anchored to its Hebrew phrase."""
    text_dir = os.path.join(mcp_dir, 'text')
    records = []
    known_titles = Counter()
    for f in sorted(os.listdir(text_dir)):
        if not f.endswith('.json'):
            continue
        for p in json.load(open(os.path.join(text_dir, f), encoding='utf-8')).get('paras', []):
            for r in (p.get('a') or {}):
                known_titles[title_of(r)] += 1
    for f in sorted(os.listdir(text_dir)):
        if not f.endswith('.json'):
            continue
        slug = f[:-5]
        if books is not None and slug not in books:
            continue
        for p in json.load(open(os.path.join(text_dir, f), encoding='utf-8')).get('paras', []):
            pairs = p.get('p') or []
            linked = defaultdict(list)
            for r, place in (p.get('a') or {}).items():
                if place and place[0] == 'n':
                    linked[str(place[1])].append(r)
            for num, text, k, side, at in p.get('f', []):
                if pairs and 0 <= k < len(pairs):
                    anchor_he, anchor_en = pairs[k][0], pairs[k][1]
                else:  # Hebrew-only paragraph: the words just before the note marker
                    body = p.get('t') or ''
                    anchor_he, anchor_en = body[max(0, at - 80):at], ''
                parts = [x for x in parse_note(text) if not x.get('placeholder')] or [{}]
                for j, parsed in enumerate(parts):
                    head = parsed.get('ref')
                    extra = [r for r in linked.get(str(num), []) if r != head] if j == 0 else []
                    refs = ([head] if head else []) + extra
                    ref = refs[0] if refs else None
                    is_lib = bool(ref) and any(ref == b or ref.startswith(b + ' ') or ref.startswith(b + ',') for b in library_books)
                    kind = 'parallel' if (parsed.get('kind') == 'parallel' or is_lib) else 'source'
                    rec = {'book': slug, 'para': p['r'], 'note': str(num), 'part': j, 'phrase': k, 'anchorHe': anchor_he,
                           'anchorEn': anchor_en, 'ref': ref, 'refs': refs, 'linked': bool(linked.get(str(num))), 'kind': kind,
                           'quote': parsed.get('quote', ''), 'context': parsed.get('context', ''),
                           'headline': parsed.get('headline', ''), 'text': text}
                    if ref:
                        rec['knownTitle'] = known_titles[title_of(ref)] > 0 or is_lib
                    records.append(rec)
    return records


TRAINING_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'training')


def extra_records(mcp_dir, training_dir=TRAINING_DIR):
    """Derived records from outside editions (e.g. Biur Meshulav on Tzidkat), anchored to the reader's own phrases."""
    out = []
    if not os.path.isdir(training_dir):
        return out
    texts = {}
    for f in sorted(os.listdir(training_dir)):
        if not f.endswith('.json'):
            continue
        d = json.load(open(os.path.join(training_dir, f), encoding='utf-8'))
        slug = d['book']
        if slug not in texts:
            texts[slug] = {p['r']: p for p in json.load(open(os.path.join(mcp_dir, 'text', slug + '.json'), encoding='utf-8'))['paras']}
        for r in d['records']:
            p = texts[slug].get(r['para'])
            if p is None or r.get('phrase') is None or not p.get('p'):
                continue
            pair = p['p'][r['phrase']]
            out.append({'book': slug, 'para': r['para'], 'note': None, 'part': 0, 'phrase': r['phrase'], 'anchorHe': pair[0],
                        'anchorEn': pair[1], 'ref': r['ref'], 'refs': [r['ref']], 'linked': False, 'kind': r['kind'],
                        'quote': '', 'context': '', 'headline': '', 'text': '', 'origin': d['origin']})
    return out


class SourceMemory:
    """Hebrew anchor wording -> sources the editors attached to it, with their quotes and context."""

    def __init__(self, records, min_df=1):
        self.records = [r for r in records if r.get('ref') and r.get('anchorHe')]
        self.post = defaultdict(set)      # 3-word shingle or rare word -> record ids
        self.df = Counter()
        for i, r in enumerate(self.records):
            keys = self._keys(r['anchorHe'])
            for key in keys:
                self.post[key].add(i)
            self.df.update(keys)
        self.N = len(self.records) or 1

    @staticmethod
    def _keys(he):
        w = he_words(he)
        keys = {' '.join(w[i:i + 3]) for i in range(len(w) - 2)}
        keys |= {' '.join(w[i:i + 2]) for i in range(len(w) - 1)}
        keys |= {x for x in w if len(x) > 3}
        return keys

    def suggest(self, he, limit=5, exclude=None):
        """Rank sources for a Hebrew phrase. exclude(record) -> True hides records (e.g. the same book)."""
        keys = self._keys(he)
        score = defaultdict(float)
        evidence = defaultdict(list)
        for key in keys:
            ids = self.post.get(key)
            if not ids or len(ids) > 400:
                continue
            idf = math.log(1 + self.N / len(ids)) * (2.0 if key.count(' ') == 2 else 1.3 if ' ' in key else 0.6)
            for i in ids:
                r = self.records[i]
                if exclude and exclude(r):
                    continue
                score[r['ref']] += idf
                if len(evidence[r['ref']]) < 3 and i not in [e[0] for e in evidence[r['ref']]]:
                    evidence[r['ref']].append((i, key))
        ranked = sorted(score.items(), key=lambda x: -x[1])[:limit]
        out = []
        for ref, s in ranked:
            ex = [self.records[i] for i, _ in evidence[ref]]
            out.append({'ref': ref, 'score': round(s, 2), 'sharedWording': [k for _, k in evidence[ref]],
                        'examples': [{'para': e['para'], 'anchorHe': strip_nikkud(e['anchorHe'])[:120], 'quote': e['quote'][:400],
                                      'context': e['context'][:400]} for e in ex]})
        return out

    def quotes_for(self, ref, limit=3, phrase=None):
        """How the editors quoted this source before (the words chosen and the context written),
        most similar anchor wording first."""
        keys = self._keys(phrase) if phrase else set()
        cands = [r for r in self.records if r['ref'] == ref and r['quote']]
        cands.sort(key=lambda r: (-len(keys & self._keys(r['anchorHe'])), -bool(r['context'])))
        seen, out = set(), []
        for r in cands:
            if r['quote'] in seen:
                continue
            seen.add(r['quote'])
            out.append({'para': r['para'], 'anchorHe': strip_nikkud(r['anchorHe'])[:120], 'quote': r['quote'], 'context': r['context']})
            if len(out) >= limit:
                break
        return out


def _same_ref(a, b):
    if not a or not b:
        return False
    a, b = a.replace('–', '-'), b.replace('–', '-')
    return a == b or a.startswith(b + ':') or b.startswith(a + ':') or a.split('-')[0] == b.split('-')[0]


def evaluate(records, detect=None):
    """Leave-one-book-out: for each footnoted phrase, can memory built from the OTHER seforim name its source?

    Also measures, for sources quoted more than once, how often an earlier quotation of the same source
    shares most of its words with the one the editor chose (i.e. whether quote memory would have helped)."""
    mem = SourceMemory(records)
    by_book = defaultdict(list)
    for r in mem.records:
        if r['kind'] == 'source' and not r.get('origin'):  # score only the reader's own footnotes
            by_book[r['book']].append(r)
    totals = Counter()
    per_book = {}
    for book, recs in by_book.items():
        c = Counter()
        for r in recs:
            sug = mem.suggest(r['anchorHe'], limit=5, exclude=lambda x, b=book: x['book'] == b)
            refs = [s['ref'] for s in sug]
            c['n'] += 1
            c['top1'] += bool(refs[:1] and _same_ref(refs[0], r['ref']))
            c['top3'] += any(_same_ref(x, r['ref']) for x in refs[:3])
            c['top5'] += any(_same_ref(x, r['ref']) for x in refs[:5])
            if detect:
                det = [d['ref'] for d in detect(r['anchorHe']) if d.get('ref')]
                hit = any(_same_ref(normalize_ref(x), r['ref']) for x in det)
                c['detector'] += hit
                c['either'] += hit or any(_same_ref(x, r['ref']) for x in refs[:3])
        per_book[book] = {k: (round(v / c['n'], 3) if k != 'n' else v) for k, v in c.items()}
        totals.update(c)
    n = totals['n'] or 1
    summary = {k: (round(v / n, 3) if k != 'n' else v) for k, v in totals.items()}
    # quote memory
    q = defaultdict(list)
    for r in mem.records:
        if r['quote'] and len(r['quote']) > 20:
            q[r['ref']].append(r['quote'])
    reuse = Counter()
    for ref, quotes in q.items():
        for i in range(1, len(quotes)):
            cur = set(re.findall(r"\w+", quotes[i].lower()))
            best = max(len(cur & set(re.findall(r"\w+", p.lower()))) / (len(cur) or 1) for p in quotes[:i])
            reuse['n'] += 1
            reuse['half'] += best >= 0.5
            reuse['most'] += best >= 0.8
    summary['quoteReuse'] = {'repeatQuotations': reuse['n'], 'shareHalfTheWords': round(reuse['half'] / (reuse['n'] or 1), 3),
                             'shareMostWords': round(reuse['most'] / (reuse['n'] or 1), 3)}
    return summary, per_book

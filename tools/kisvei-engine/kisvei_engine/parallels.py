"""Parallel-passage finder for Kisvei Rav Tzadok and the Ishbitz-Radzin works.

Rav Tzadok repeats his ideas across his works, usually with the same proof-texts and the same
distinctive phrases. The finder scores a candidate parallel B for a query paragraph A by
combining evidence channels, each weighted by learned coefficients (see learn.py):

  shared_sources   IDF-weighted sum over cited sources (verses, dapim, midrashim) both cite
  shared_quotes    IDF-weighted sum over verbatim 3-word Hebrew shingles both contain
  term_cosine      cosine similarity of TF-IDF vectors over normalised Hebrew words (prefixes stripped)
  rare_terms       IDF-weighted count of shared rare content words
  same_book        1 when both passages come from the same sefer (usually a mild penalty)
  explicit_xref    1 when A explicitly names B's sefer (e.g. "כמו שכתבתי בספר צדקת הצדיק")

Inputs: the reader's built MCP data (dist/mcp-data/text/*.json) or a Corpus (corpus.py).
"""
import json
import math
import os
import re
from collections import Counter, defaultdict

from .hebrew import normalize, strip_prefix, ngrams

STOP = set('''את של על אל כל לא זה זו זאת הוא היא הם הן אני אתה אנו כי אם או גם רק עד מן מה מי איך כך כן אין יש היה היו יהיה תהיה
אשר כאשר כמו שם אז עוד אך אבל שהוא שהיא שהם ידי כמ"ש כמש"כ וכו וכו' וגו וגו' דהיינו היינו ועל ואם ואת ובו בו בה בהם בהן לו לה להם
ממנו ממנה מהם אותו אותה אותם עצמו עצמה עצמם ענין בחינת בחי מצד ומצד אחר אחרי לפני אחד אחת שני שתי שלש ולא ולכן לכן ולכך לכך ואז
דבר דברי ה' השם יתברך ית' הקב"ה הקדוש ברוך הוא ז"ל רז"ל חז"ל ש"ס'''.split())


class ParallelIndex:
    def __init__(self):
        self.paras = {}          # ref -> {'book','section','n','he','words','shingles','sources'}
        self.by_source = defaultdict(set)
        self.by_shingle = defaultdict(set)
        self.by_word = defaultdict(set)
        self.df_source = Counter()
        self.df_shingle = Counter()
        self.df_word = Counter()
        self.N = 0
        self.weights = {'shared_sources': 1.0, 'shared_quotes': 1.2, 'term_cosine': 2.0, 'rare_terms': 0.4, 'same_book': -0.6, 'explicit_xref': 1.5, 'english_cosine': 2.0, 'bias': -3.0}

    # ---------- building ----------
    SUFFIXES = ('ותיהם', 'ותיו', 'ותינו', 'יהם', 'יהן', 'ינו', 'כם', 'כן', 'הם', 'הן', 'נו', 'ות', 'ים', 'יו', 'יה', 'ית', 'ה', 'י', 'ו', 'ך', 'ם', 'ן')

    @classmethod
    def stem(cls, w):
        """Light Hebrew stemming: strip proclitic prefixes (up to two) and common suffixes, keep ≥3 letters."""
        stems = strip_prefix(w)
        s = min(stems, key=len) if len(w) > 4 else w
        for suf in cls.SUFFIXES:
            if len(s) - len(suf) >= 3 and s.endswith(suf):
                s = s[:-len(suf)]
                break
        return s

    @classmethod
    def tokens(cls, he):
        out = []
        for w in normalize(he).split():
            if len(w) < 2 or w in STOP:
                continue
            out.append(cls.stem(w))
        return out

    EN_STOP = set('the of and to in a is that it this for as with his he be by one who on from which are not or their its was all but they have has an so when what there them them\'s'.split())

    @classmethod
    def en_tokens(cls, en):
        out = []
        for w in re.findall(r"[a-z]+", en.lower()):
            if len(w) < 4 or w in cls.EN_STOP:
                continue
            if w.endswith('ies'):
                w = w[:-3] + 'y'
            elif w.endswith('es') and len(w) > 5:
                w = w[:-2]
            elif w.endswith('s') and len(w) > 4:
                w = w[:-1]
            if w.endswith('ing') and len(w) > 6:
                w = w[:-3]
            elif w.endswith('ed') and len(w) > 5:
                w = w[:-2]
            out.append(w)
        return out

    def add(self, ref, book, section, n, he, sources, english=''):
        toks = self.tokens(he)
        sh = set(ngrams(normalize(he).split(), 3))
        srcs = set(self._source_key(s) for s in sources if s)
        etoks = self.en_tokens(english or '')
        self.paras[ref] = {'ref': ref, 'book': book, 'section': section, 'n': n, 'he': he, 'en': english,
                           'words': Counter(toks), 'shingles': sh, 'sources': srcs, 'ewords': Counter(etoks)}
        for s in srcs:
            self.by_source[s].add(ref)
        for g in sh:
            self.by_shingle[g].add(ref)
        for w in set(toks):
            self.by_word[w].add(ref)
        if not hasattr(self, 'by_eword'):
            self.by_eword = defaultdict(set)
            self.df_eword = Counter()
        for w in set(etoks):
            self.by_eword[w].add(ref)
        self.N += 1

    @staticmethod
    def _source_key(ref):
        """Normalise a cited ref to a comparable key: drop segment detail for Talmud (daf level) and keep verse level for Tanakh."""
        r = re.sub(r'\s+', ' ', str(ref)).strip()
        m = re.match(r'^(.*?)\s(\d+[ab])(?::\d+.*)?$', r)
        if m:
            return f'{m.group(1)} {m.group(2)}'
        m = re.match(r'^(.*?)\s(\d+):(\d+)(?:-\d+)?$', r)
        if m:
            return f'{m.group(1)} {m.group(2)}:{m.group(3)}'
        return r

    def finalize(self):
        self.df_source = Counter({k: len(v) for k, v in self.by_source.items()})
        self.df_shingle = Counter({k: len(v) for k, v in self.by_shingle.items()})
        self.df_word = Counter({k: len(v) for k, v in self.by_word.items()})
        if hasattr(self, 'by_eword'):
            self.df_eword = Counter({k: len(v) for k, v in self.by_eword.items()})

    def en_cosine(self, A, B):
        if not A.get('ewords') or not B.get('ewords'):
            return 0.0
        num = 0.0
        for w, c in A['ewords'].items():
            if w in B['ewords']:
                idf = self.idf(self.df_eword[w])
                num += (c * idf) * (B['ewords'][w] * idf)
        na = math.sqrt(sum((c * self.idf(self.df_eword[w])) ** 2 for w, c in A['ewords'].items())) or 1.0
        nb = math.sqrt(sum((c * self.idf(self.df_eword[w])) ** 2 for w, c in B['ewords'].items())) or 1.0
        return num / (na * nb)

    def idf(self, df):
        return math.log((self.N + 1) / (df + 1)) + 1.0

    # ---------- loading ----------
    LIBRARY_BOOKS = ('Beit Yaakov on Torah', 'Divrei Chalomot', 'Divrei Soferim', 'Et HaOchel', 'Kometz HaMinchah', 'Machshavot Charutz',
                     "Meshiv HaTa'anah", 'Meshiv Tzedek', 'Ohr Zarua LaTzadik', 'Poked Akarim', 'Resisei Layla', 'Sefer HaZikhronot',
                     'Takanat HaShavin', 'Toldos HaKohen', 'Tzidkat HaTzadik', 'Dover Tzedek', 'Likkutei Maamarim', 'Peri Tzadik',
                     'Sichat Malakhei HaSharet', 'Sichat Shedim', 'Sod Yesharim', 'Yisrael Kedoshim', 'Tiferet Yosef', 'Mei HaShiloach',
                     "Sha'ar HaEmunah VeYesod HaChasidut")

    @classmethod
    def is_library_ref(cls, ref):
        return any(ref == b or ref.startswith(b + ' ') or ref.startswith(b + ',') for b in cls.LIBRARY_BOOKS)

    def load_mcp_dir(self, mcp_dir, skip_books=()):
        """Load the reader's built MCP text. Cited primary sources become similarity evidence; citations of
        other library passages (reviewed parallels, 'Parallel Sources') are kept aside as gold labels."""
        text_dir = os.path.join(mcp_dir, 'text')
        self.gold = defaultdict(set)
        for f in sorted(os.listdir(text_dir)):
            if not f.endswith('.json'):
                continue
            d = json.load(open(os.path.join(text_dir, f), encoding='utf-8'))
            for p in d.get('paras', []):
                ref = p['r']
                book = next((b for b in self.LIBRARY_BOOKS if ref == b or ref.startswith(b + ' ') or ref.startswith(b + ',')), ref.split(',')[0])
                if book in skip_books:
                    continue
                he = ' '.join(pair[0] for pair in p.get('p', [])) if p.get('p') else (p.get('he') or '')
                en = ' '.join(pair[1] for pair in p.get('p', [])) if p.get('p') else (p.get('en') or '')
                he = re.sub(r'<[^>]+>', '', he)
                sources = []
                for c in p.get('c', []):
                    r, cat = (c[0], c[1] if len(c) > 1 else '') if isinstance(c, list) else (c, '')
                    if self.is_library_ref(r):
                        self.gold[ref].add(r)
                    elif cat != 'Parallel Sources':
                        sources.append(r)
                self.add(ref, book, p.get('s'), p.get('n'), he, sources, en)
        self.finalize()
        return self

    def load_corpus(self, corpus, detect_fn=None):
        for r in corpus.records:
            sources = []
            for note in r.get('notes', []):
                for s in note.get('sources', []):
                    if s.get('ref'):
                        sources.append(s['ref'])
            if detect_fn:
                sources += [d['ref'] for d in detect_fn(r['he']) if d.get('ref')]
            self.add(r['ref'], r['book'], r.get('section'), r.get('paragraph'), r['he'], sources, r.get('en', ''))
        self.finalize()
        return self

    # ---------- scoring ----------
    def features(self, a, b):
        A, B = self.paras[a], self.paras[b]
        shared_src = A['sources'] & B['sources']
        f_src = sum(self.idf(self.df_source[s]) for s in shared_src)
        shared_sh = A['shingles'] & B['shingles']
        f_q = sum(self.idf(self.df_shingle[g]) for g in shared_sh if self.df_shingle[g] < 400)
        # cosine over tf-idf
        num = 0.0
        for w, c in A['words'].items():
            if w in B['words']:
                idf = self.idf(self.df_word[w])
                num += (c * idf) * (B['words'][w] * idf)
        na = math.sqrt(sum((c * self.idf(self.df_word[w])) ** 2 for w, c in A['words'].items())) or 1.0
        nb = math.sqrt(sum((c * self.idf(self.df_word[w])) ** 2 for w, c in B['words'].items())) or 1.0
        f_cos = num / (na * nb)
        rare = [w for w in A['words'] if w in B['words'] and self.df_word[w] <= 60]
        f_rare = sum(self.idf(self.df_word[w]) for w in rare)
        f_same = 1.0 if A['book'] == B['book'] else 0.0
        f_x = 1.0 if B['book'] and B['book'] in A['he'] else 0.0
        f_srcmax = max((self.idf(self.df_source[s]) for s in shared_src), default=0.0)
        f_srccount = float(len(shared_src))
        f_long = 1.0 if any(len(g.split()) >= 3 and self.df_shingle[g] <= 30 for g in shared_sh) else 0.0
        f_en = self.en_cosine(A, B)
        return {'shared_sources': f_src, 'shared_quotes': f_q, 'term_cosine': f_cos, 'rare_terms': f_rare, 'same_book': f_same, 'explicit_xref': f_x,
                'max_source_idf': f_srcmax, 'source_count': f_srccount, 'rare_quote': f_long, 'english_cosine': f_en,
                'sharedSources': sorted(shared_src), 'sharedQuotes': sorted(shared_sh)[:6], 'rareTerms': rare[:10]}

    FEATURE_KEYS = ('shared_sources', 'shared_quotes', 'term_cosine', 'rare_terms', 'same_book', 'explicit_xref', 'max_source_idf', 'source_count', 'rare_quote', 'english_cosine')

    def score(self, feats, weights=None):
        w = weights or self.weights
        z = w.get('bias', 0.0)
        for k in self.FEATURE_KEYS:
            z += w.get(k, 0.0) * feats.get(k, 0.0)
        return 1.0 / (1.0 + math.exp(-z))

    def candidates(self, a, limit=400):
        """Candidate generation: BM25-style accumulation over shared cited sources, verbatim shingles and
        content words (inverted indexes), so that thematically related passages are reachable even when
        they share no proof-text."""
        A = self.paras[a]
        cand = Counter()
        for s in A['sources']:
            df = self.df_source[s]
            if df <= 1500:
                w = 3.0 * self.idf(df)
                for r in self.by_source[s]:
                    cand[r] += w
        for g in A['shingles']:
            df = self.df_shingle[g]
            if df <= 300:
                w = 2.0 * self.idf(df)
                for r in self.by_shingle[g]:
                    cand[r] += w
        avg = getattr(self, '_avg_len', None)
        if avg is None:
            avg = self._avg_len = (sum(sum(p['words'].values()) for p in self.paras.values()) / max(self.N, 1)) or 1.0
        for w, tf_a in A['words'].items():
            df = self.df_word[w]
            if 1 < df <= 2500:
                idf = self.idf(df)
                for r in self.by_word[w]:
                    P = self.paras[r]
                    tf = P['words'][w]
                    dl = sum(P['words'].values()) or 1
                    cand[r] += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * dl / avg))
        if A.get('ewords') and hasattr(self, 'by_eword'):
            for w in A['ewords']:
                df = self.df_eword[w]
                if 1 < df <= 1500:
                    idf = self.idf(df)
                    for r in self.by_eword[w]:
                        cand[r] += 0.6 * idf
        cand.pop(a, None)
        return [r for r, _ in cand.most_common(limit)]

    def section_paragraphs(self, section_ref):
        """All paragraph refs of a section ref such as 'Resisei Layla 5' or 'Peri Tzadik, Noach 3'."""
        out = []
        for r in self.paras:
            if r == section_ref or r.startswith(section_ref + ':'):
                out.append(r)
        return out

    def find(self, a, limit=20, weights=None, exclude_same_section=True):
        out = []
        A = self.paras[a]
        for b in self.candidates(a):
            B = self.paras[b]
            if exclude_same_section and B['book'] == A['book'] and B['section'] == A['section']:
                continue
            f = self.features(a, b)
            out.append({'ref': b, 'book': B['book'], 'score': round(self.score(f, weights), 4), 'features': f})
        out.sort(key=lambda x: -x['score'])
        return out[:limit]

    def find_for_text(self, he, sources=(), limit=20, weights=None, book=None):
        """Query with raw Hebrew (and optional detected sources) that is not in the index."""
        tmp = '__query__'
        self.add(tmp, book or '', None, None, he, sources)
        self.N -= 1
        try:
            return self.find(tmp, limit=limit, weights=weights, exclude_same_section=False)
        finally:
            P = self.paras.pop(tmp)
            for s in P['sources']:
                self.by_source[s].discard(tmp)
            for g in P['shingles']:
                self.by_shingle[g].discard(tmp)
            for w in P['words']:
                self.by_word[w].discard(tmp)

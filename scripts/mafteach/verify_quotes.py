"""Check every quoted source in the Mafteach against the text itself (Sefaria export: Tanakh, Mishnah, Bavli,
Yerushalmi, Midrash, Tikkunei Zohar, Zohar Chadash). Called by perfect.py as verify(entries, path, note).

A quote is cut into 7-letter pieces (letters only, so the OCR's run-together words still match; וכו' splits it).
  confirmed     most pieces are at the address the index gives (either amud of the daf counts)
  address fixed the address scores low and one place in the same book holds the quote clearly
  book fixed    the quote is not in the named book but clearly in one other book of the same kind
  located       the index gave no usable address (OCR lost the chapter) and the quote is found in the named book
  unverified    too short, not in these texts, or not found; left as printed
Every entry gets e['vq'] = one of c / a / b / l / u / s (short) / n (no text) for the scorecard.
"""
import gzip, json, re, bisect, collections, os

N = 6
FINAL = str.maketrans('ךםןףץ', 'כמנפצ')
def letters(s):
    s = re.sub(r'[֑-ׇ]', '', s or '')
    return re.sub(r'[^א-ת]|[וי]', '', s).translate(FINAL)      # ו/י dropped: full and defective spelling, and the OCR's ו/י, match
def pieces(t):
    t = re.sub(r"\\", ' ', t or '')
    parts = re.split(r"וכו['י]?|וגו['י]?|וכוי|וגוי|\.\.\.", t)
    out = []
    for p in parts:
        L = letters(p)
        out += [L[i:i + N] for i in range(0, len(L) - N + 1, N)]
    return out

ALIAS = {'Eichah Rabbah': 'Eikhah Rabbah', 'Shir HaShirim Rabbah': 'Shir HaShirim Rabbah', 'Esther Rabbah': 'Esther Rabbah'}
HEB = {'תנחומא': 'Midrash Tanchuma', 'שוחר טוב': 'Midrash Tehillim', 'מדרש תהלים': 'Midrash Tehillim', 'פרקי דרבי אליעזר': 'Pirkei DeRabbi Eliezer',
       'פסיקתא רבתי': 'Pesikta Rabbati', 'פסיקתא דרב כהנא': 'Pesikta DeRav Kahana', 'תקוני זהר': 'Tikkunei Zohar', 'זהר חדש': 'Zohar Chadash',
       'אבות דרבי נתן': 'Avot DeRabbi Natan', 'תנחומא בובר': 'Midrash Tanchuma Buber', 'ילקוט שמעוני': ['Yalkut Shimoni on Torah', 'Yalkut Shimoni on Nach'],
       'ספרי': ['Sifrei Devarim', 'Sifrei Bamidbar'], 'מכילתא': ['Mekhilta DeRabbi Yishmael', 'Mekhilta DeRabbi Shimon Bar Yochai'],
       'תורת כהנים': 'Sifra', 'ספרא': 'Sifra', 'ספר יצירה': 'Sefer Yetzirah', 'ספר המצוות': 'Sefer HaMitzvot', 'ספר המצות': 'Sefer HaMitzvot',
       'טור וטולחן ערוך': 'Shulchan Arukh, *', 'טור ושולחן ערוך': 'Shulchan Arukh, *', 'שולחן ערוך': 'Shulchan Arukh, *',
       'רמב"ם': 'Mishneh Torah, *', 'משנה תורה': 'Mishneh Torah, *', 'מדרש משלי': 'Midrash Mishlei', 'מדרש שמואל': 'Midrash Shmuel',
       'סדר עולם': 'Seder Olam Rabbah', 'תנא דבי אליהו': ['Tanna DeBei Eliyahu Rabbah', 'Tanna DeBei Eliyahu Zuta']}
# the Zohar's volumes by parasha (Sefaria's Zohar is arranged by parasha, not by daf)
ZOHAR_VOL = {}
for v, names in ((1, 'Hakdamat Zohar|Introduction|Bereshit|Noach|Lech Lecha|Vayera|Chayei Sara|Toldot|Vayetzei|Vayishlach|Vayeshev|Miketz|Vayigash|Vayechi'),
                 (2, 'Shemot|Vaera|Bo|Beshalach|Yitro|Mishpatim|Terumah|Sifra DeTzniuta|Tetzaveh|Ki Tisa|Vayakhel|Pekudei'),
                 (3, 'Vayikra|Tzav|Shmini|Tazria|Metzora|Achrei Mot|Kedoshim|Emor|Behar|Bechukotai|Bamidbar|Nasso|Idra Rabba|Beha\'alotcha|Shelach Lecha|Korach|Chukat|Balak|Pinchas|Idra Zuta|Matot|Vaetchanan|Eikev|Shoftim|Ki Teitzei|Vayeilech|Ha\'Azinu|V\'Zot HaBerachah')):
    for n in names.split('|'): ZOHAR_VOL[n.lower()] = v
def zohar_vol(unit):
    head = unit.rsplit(' ', 1)[0].lower() if ' ' in unit else unit.lower()
    for n, v in ZOHAR_VOL.items():
        if head == n or head.startswith(n): return v
    return None
def he_norm(h):
    h = re.sub(r'[^א-ת ]', '', h or '').strip()
    return re.sub(r' (א|ב)י$', r' \1', h)                     # "דברי הימים אי": the OCR's א' 
KIND = {'Tanakh': 'Tanakh', 'Bavli': 'Talmud/Bavli', 'Yerushalmi': 'Talmud/Yerushalmi', 'Midrash Rabbah': 'Midrash', 'Midrash': 'Midrash'}

class Book:
    def __init__(self, name, cat):
        self.name, self.cat, self.addr, self.start, self.buf = name, cat, [], [], []
        self.n = 0
    def add(self, addr, he):
        L = letters(he)
        self.addr.append(addr); self.start.append(self.n); self.buf.append(L); self.n += len(L) + 1
    def done(self):
        self.text = '|'.join(self.buf); del self.buf
    def unit(self, a):                     # the place an address names: amud for Bavli, verse / siman otherwise
        return a.split(':')[0] if self.cat == 'Talmud/Bavli' else (a.rsplit(':', 1)[0] if self.cat == 'Talmud/Yerushalmi' else a)
    def hits(self, ps):
        tally = collections.defaultdict(set)
        for j, p in enumerate(ps):
            i = self.text.find(p)
            while i >= 0:
                k = bisect.bisect_right(self.start, i) - 1
                tally[self.unit(self.addr[k])].add(j)
                i = self.text.find(p, i + 1)
        return {u: len(s) / len(ps) for u, s in tally.items()}

def address(e, book):
    k = e.get('k') or ''
    m = re.match(r'.+ (\S+)$', k)
    if not m: return None
    a = m.group(1)
    if book.cat == 'Talmud/Yerushalmi': return a.rsplit(':', 1)[0] if a.count(':') == 2 else a
    if book.cat == 'Talmud/Bavli' and ':' in a: return a.split(':')[0]
    return a

def other_amud(a):
    m = re.match(r'(\d+)([ab])$', a)
    return m and f"{m.group(1)}{'b' if m.group(2) == 'a' else 'a'}"

def verify(entries, path, note):
    books = {}
    for line in gzip.open(path, 'rt', encoding='utf-8'):
        r = json.loads(line)
        b = books.get(r['book']) or books.setdefault(r['book'], Book(r['book'], r['cat']))
        b.add(f"{r['path']} {r['addr']}" if r.get('path') else r['addr'], r['he'])   # Tanchuma: "Bereshit 1:1" 
    for b in books.values(): b.done()
    bykind = collections.defaultdict(list)
    for b in books.values(): bykind[b.cat.split('/')[0] if b.cat.startswith(('Tanakh', 'Midrash')) else b.cat].append(b)
    # Hebrew book names the index uses -> library names, learnt from entries that have both
    he2en = collections.defaultdict(collections.Counter)
    for e in entries:
        if e['x'] == 's' and e.get('k') and e.get('b'): he2en[e['b']][re.match(r'(.+) \S+$', e['k']).group(1)] += 1
    he2en = {h: c.most_common(1)[0][0] for h, c in he2en.items()}
    try:
        g = json.load(open(os.path.join(os.path.dirname(path) if False else 'sources/mafteach', 'glossary.json'), encoding='utf-8'))
        for b in g.get('books', []):
            for h in [b['he'], *(b.get('he_alt') or [])]: he2en.setdefault(he_norm(h), b['en'])
    except Exception: pass
    def names_for(e, k):
        if k:
            n = re.match(r'(.+) \S+$', k).group(1)
            if re.match(r'^Zohar (I|II|III)$', n): return ['Zohar']
            return [ALIAS.get(n, n)]
        h = e.get('b') or ''
        v = HEB.get(h) or HEB.get(he_norm(h)) or he2en.get(h) or he2en.get(he_norm(h))
        v = v if isinstance(v, list) else [v] if v else []
        out = []
        for n in v:
            if n.endswith(', *'): out += [b for b in books if b.startswith(n[:-1])]
            else: out.append(ALIAS.get(n, n))
        return out
    stats = collections.Counter()
    for e in entries:
        if e['x'] != 's': continue
        k = e.get('k') or ''
        cands = [books[n] for n in names_for(e, k) if n in books]
        if not cands: e['vq'] = 'n'; stats['n'] += 1; continue
        ps = pieces(e.get('t'))
        if len(ps) < 2: e['vq'] = 's'; stats['s'] += 1; continue
        if len(cands) > 1:
            scored = [(max(b.hits(ps).values() or [0]), b) for b in cands]
            book = max(scored, key=lambda x: x[0])[1]
        else: book = cands[0]
        sc = book.hits(ps)
        if book.name == 'Zohar':                 # by daf in the index, by parasha in the text: check the quote and the volume
            ranked = sorted(sc.items(), key=lambda x: -x[1])
            vol = {'I': 1, 'II': 2, 'III': 3}.get((re.match(r'Zohar (I+)', k or '') or [None, None])[1])
            if ranked and ranked[0][1] >= .5:
                v = zohar_vol(ranked[0][0])
                if vol and v and v != vol and (len(ranked) == 1 or ranked[1][1] < ranked[0][1] - .2 or zohar_vol(ranked[1][0]) != vol):
                    note(e, 'texts', 'flag', k, f'Zohar, {ranked[0][0]}', f'the quote is in Zohar volume {v} ({ranked[0][0]}), not volume {vol}: check the daf')
                    e['vq'] = 'z'; stats['z'] += 1
                else:
                    e['vq'] = 'c'; stats['c'] += 1
                    if not vol: e['zp'] = f'Zohar, {ranked[0][0]}'
            else: e['vq'] = 'u'; stats['u'] += 1
            continue
        a = address(e, book) if k else None
        here = max(sc.get(a, 0), 0) if a else 0
        if a and book.cat == 'Talmud/Bavli': here = max(here, sc.get(other_amud(a) or '', 0) * .9)
        if a and (here >= .5 or (book.cat == 'Talmud/Bavli' and here >= .25)):   # a sugya runs over the amud: part of it there is enough
            e['vq'] = 'c'; stats['c'] += 1; continue
        ranked = sorted(sc.items(), key=lambda x: -x[1])
        best, second = (ranked + [(None, 0), (None, 0)])[:2]
        if best[1] >= .6 and best[1] - second[1] >= .2 and best[1] > here + .3:
            ref = f"{book.name}{',' if ' ' in best[0] else ''} {best[0]}"
            if a and best[0].startswith(a + ':'):
                note(e, 'texts', 'source', k, ref, f'the index gave {k} without the verse; the quote is at {ref}')
                e['vq'] = 'l'; stats['l'] += 1
            elif a:
                same = a and best[0].count(':') != a.count(':')
                note(e, 'texts', 'source', k, ref, f'the quote is at {ref} in the library\'s numbering' if same else
                     f'the quote is at {ref} ({round(best[1] * 100)}% of it), not at {k} ({round(here * 100)}%)')
                e['vq'] = 'a'; stats['a'] += 1
            else:
                note(e, 'texts', 'source', None, ref, f'the index gave no usable address; the quote is at {ref}')
                e['vq'] = 'l'; stats['l'] += 1
            e['k'] = ref; continue
        # not in the named book: another book of the same kind?
        kind = book.cat.split('/')[0] if book.cat.startswith(('Tanakh', 'Midrash')) else book.cat
        found = []
        if here < .25 and best[1] < .4 and kind in ('Tanakh', 'Talmud/Bavli', 'Talmud/Yerushalmi'):   # midrashim are quoted in each other: no book changes there
            for b2 in bykind[kind]:
                if b2 is book: continue
                s2 = b2.hits(ps)
                if s2:
                    u, v = max(s2.items(), key=lambda x: x[1]); found.append((v, b2.name, u))
        found.sort(reverse=True)
        if found and found[0][0] >= .75 and (len(found) == 1 or found[0][0] - found[1][0] >= .3):
            v, bn, u = found[0]
            ref = f"{bn}{',' if ' ' in u else ''} {u}"
            note(e, 'texts', 'source', k or e.get('b'), ref, f'the quote is in {bn} ({round(v * 100)}%), not in {book.name}')
            e['k'] = ref; e['vq'] = 'b'; stats['b'] += 1; continue
        e['vq'] = 'u'; stats['u'] += 1
    print('texts:', dict(stats))

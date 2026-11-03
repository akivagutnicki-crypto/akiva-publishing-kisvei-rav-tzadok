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

ROMAN = {1: 'I', 2: 'II', 3: 'III'}
def amud(a):                                   # "31b" -> 61 (1a = 0)
    m = re.match(r'^(\d+)([ab])$', a or '')
    return m and (int(m.group(1)) - 1) * 2 + (m.group(2) == 'b')
def amud_name(i): return f"{i // 2 + 1}{'ab'[i % 2]}"
def heb(n):
    out = ''
    for v, c in ((400, 'ת'), (300, 'ש'), (200, 'ר'), (100, 'ק')):
        while n >= v: out += c; n -= v
    if n in (15, 16): return out + ('טו' if n == 15 else 'טז')
    for v, c in ((90, 'צ'), (80, 'פ'), (70, 'ע'), (60, 'ס'), (50, 'נ'), (40, 'מ'), (30, 'ל'), (20, 'כ'), (10, 'י')):
        if n >= v: out += c; n -= v
    return out + ('אבגדהוזחט'[n - 1] if n else '')

def zohar_dafs(book, mapfile='sources/mafteach/zohar-daf.json'):
    """the Zohar's standard pages: each paragraph of the source text -> the dafim it stands on ((vol, amud), ...),
    from Sefaria's Daf structure, whose refs number the paragraphs through each parasha (Bereshit 35:339) while
    the source text numbers them within the chapter (Bereshit 35:9)"""
    try: daf = json.load(open(mapfile, encoding='utf-8'))['daf']
    except OSError: return {}
    chapters = collections.OrderedDict()
    for a in book.addr:
        m = re.match(r'^(.+) (\d+):(\d+)$', a)
        if m: chapters.setdefault((m.group(1), int(m.group(2))), []).append(a)
    first, upto = {}, collections.Counter()
    for (p, c), units in chapters.items(): first[(p, c)] = upto[p] + 1; upto[p] += len(units)
    def local(p, c, v):
        units = chapters.get((p, c)); i = v - first.get((p, c), 0) if units else -1
        return units[i] if units and 0 <= i < len(units) else None
    pos = {a: i for i, a in enumerate(book.addr)}
    out = collections.defaultdict(set)
    for key, refs in daf.items():
        vol, a = key.split(':'); place = (int(vol), amud(a))
        for r in refs:
            m = re.match(r'^Zohar, (.+?) (\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$', r)
            if not m: continue
            p, c1, v1, c2, v2 = m.groups(); c1, v1 = int(c1), int(v1); c2 = int(c2) if c2 else c1; v2 = int(v2) if v2 else v1
            s, e = local(p, c1, v1), local(p, c2, v2)
            if s and e:
                for i in range(pos[s], pos[e] + 1): out[book.addr[i]].add(place)
    return out

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
    zd = zohar_dafs(books['Zohar']) if 'Zohar' in books else {}
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
            # the daf itself, through Sefaria's page division: within a daf either way of the index's amud is a match
            # (the division is not exact at the edges); a quote clearly on one other page moves the entry there
            km = re.match(r'^Zohar (I+) (\d+[ab])$', k)
            if zd and km:
                here = (vol, amud(km.group(2)))
                byplace = collections.defaultdict(float)
                for u, s in sc.items():
                    for pl in zd.get(u, ()): byplace[pl] = max(byplace[pl], s)
                near = max([s for pl, s in byplace.items() if pl[0] == here[0] and abs(pl[1] - here[1]) <= 2] or [0])
                if near >= .5:
                    e['vq'] = 'c'; stats['c'] += 1; continue
                top = sorted(byplace.items(), key=lambda x: -x[1])
                # moved only within the volume, only far from the index's page (near it the page division and the
                # Ra'aya Mehemna's parallel columns blur), and only when no other page has a fair share of the words
                if top and top[0][1] >= .75 and near < .34 and top[0][0][0] == vol and abs(top[0][0][1] - here[1]) > 4:
                    best = top[0][0]
                    rivals = [s for pl, s in top[1:] if not (pl[0] == best[0] and abs(pl[1] - best[1]) <= 2)]
                    if not rivals or rivals[0] < .34:
                        unit = next(u for u, s in sc.items() if best in zd.get(u, ()) and s == top[0][1])
                        ref = f'Zohar {ROMAN[best[0]]} {amud_name(best[1])}'
                        note(e, 'texts', 'source', k, ref, f'the quoted words are on {ref} (Zohar, {unit}; Sefaria\'s page division), not on {k}')
                        e['k'] = ref; e['ch'], e['vs'] = heb(best[1] // 2 + 1), 'אב'[best[1] % 2]
                        e['b'] = e['bn'] = {1: "זהר חלק א'", 2: "זהר חלק ב'", 3: "זהר חלק ג'"}[best[0]]
                        e['vq'] = 'a'; stats['zohar daf'] += 1; continue
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

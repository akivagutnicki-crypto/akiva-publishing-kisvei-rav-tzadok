"""Check each Mafteach reference against the Rav Tzadok passage it points to, and link the references that point nowhere.
Called by perfect.py as run(entries, textdir, note, gem); textdir = mcp-data/text (the library, one JSON per book).

  letters   a reference that gives the siman/os in letters (דס-יא(9), קש-ד) is linked to that section when the library has it
  quotes    a source entry's quoted words are looked for in the passage; when they are not there but are clearly in one
            other section of the same book, the reference is moved there (the OCR misread the os, or the line was misfiled);
            an unlinked reference (page number only, or a garbled section name) is linked where the quote is found
  pages     page-only references (דצ-194, למ-84) are linked through the pages whose section is already known: a page between
            two known pages of the same section is in that section
  garbled   Pri Tzaddik references whose section name the OCR mangled ("יי ליה שמהן בלק-ח") are read by the last section
            name in them (Balak 8)
"""
import json, re, glob, os, bisect, collections

FINAL = str.maketrans('ךםןףץ', 'כמנפצ')
def letters(s):
    s = re.sub(r'[֑-ׇ]', '', s or '')
    return re.sub(r'[^א-ת]|[וי]', '', s).translate(FINAL)
N = 6
def pieces(t):
    out = []
    for p in re.split(r"וכו['י]?|וגו['י]?|וכוי|וגוי|\.\.\.|\\", t or ''):
        L = letters(p)
        out += [L[i:i + N] for i in range(0, len(L) - N + 1, N)]
    return out

CODES = {   # Mafteach sefer code -> (library book, section from the siman letters)
    'רל': ('resisei-layla', 'Resisei Layla {}'), 'צה': ('tzidkat-hatzadik', 'Tzidkat HaTzadik {}'),
    'מח': ('machshavot-charutz', 'Machshavot Charutz {}'), 'תה': ('takanat-hashavin', 'Takanat HaShavin {}'),
    'דס': ('divrei-soferim', 'Divrei Soferim {}'), 'דח': ('divrei-chalomot', 'Divrei Chalomot {}'),
    'פע': ('poked-akarim', 'Poked Akarim {}'), 'סה': ('sefer-hazikhronot', 'Sefer HaZikhronot {}'),
    'זכ': ('sefer-hazikhronot', 'Sefer HaZikhronot {}'), 'יק': ('yisrael-kedoshim', 'Yisrael Kedoshim {}'),
    'קש': ('peri-tzadik', 'Peri Tzadik, Sefer Kedushat Shabbat {}'), 'שש': ('peri-tzadik', 'Peri Tzadik, Kuntres Shvitat Shabbat {}'),
    'עא': ('et-haochel', 'Et HaOchel {}'), 'דצ': ('dover-tzedek', None), 'למ': ('likkutei-maamarim', None),
    'קמ': ('kometz-haminchah', None), 'שמ': ('sichat-malakhei-hasharet', None), 'אז': ('ohr-zarua-latzadik', None),
    'מט': ('meshiv-hata-anah', None), 'מצ': ('meshiv-tzedek', None),
}
# checked against references whose quote fixes the passage (2026-11-02): siman letters do not match the library's
# numbering in Sefer HaZichronos, and the references the first parse left unlinked in these sefarim are mostly OCR
# misreadings; pages are too coarse in Kometz HaMincha (74% right) and Ohr Zarua (81%). Pages elsewhere: 93-100%.
NO_LETTERS = {'סה', 'זכ', 'רל', 'צה', 'מח', 'תה', 'יק'}
NO_PAGES = {'kometz-haminchah', 'ohr-zarua-latzadik'}
LABEL = re.compile(r'^(..)-([א-ת"\'׳״]+)?\s*(?:\((\d+)(?:-\d+)?\))?(?:(\d+)(?:-(\d+))?)?')

class Lib:
    def __init__(self, textdir):
        self.secs, self.order, self.text, self.start, self.book_of = {}, collections.defaultdict(list), {}, {}, {}
        for f in glob.glob(os.path.join(textdir, '*.json')):
            d = json.load(open(f, encoding='utf-8'))
            slug, buf = d['slug'], collections.OrderedDict()
            for p in d['paras']:
                if 'p' not in p: continue
                sec = p['r'].rsplit(':', 1)[0] if re.search(r':\d+$', p['r']) else p['r']
                buf[sec] = buf.get(sec, '') + letters(' '.join(x[0] for x in p['p'] if x))
            starts, n, parts = [], 0, []
            for sec, L in buf.items():
                self.secs[sec] = L; self.book_of[sec] = slug; self.order[slug].append(sec)
                starts.append(n); parts.append(L); n += len(L) + 1
            self.text[slug], self.start[slug] = '|'.join(parts), starts
    def score(self, sec, ps):
        L = self.secs.get(sec)
        return sum(1 for p in ps if p in L) / len(ps) if L and ps else 0
    def find(self, slug, ps, within=None):
        """best sections of a book for the quote pieces: [(score, section)], best first"""
        T, st, order = self.text.get(slug), self.start.get(slug), self.order.get(slug)
        if not T or not ps: return []
        tally = collections.defaultdict(set)
        for j, p in enumerate(ps):
            i = T.find(p)
            while i >= 0:
                sec = order[bisect.bisect_right(st, i) - 1]
                if not within or sec.startswith(within): tally[sec].add(j)
                i = T.find(p, i + 1)
        return sorted(((len(s) / len(ps), sec) for sec, s in tally.items()), reverse=True)

def strong(found, floor=.6, gap=.25):
    if not found or found[0][0] < floor: return None
    if len(found) > 1 and found[0][0] - found[1][0] < gap: return None
    return found[0][1]

def run(entries, textdir, note, gem, pt_sections):
    lib = Lib(textdir)
    stats = collections.Counter()
    # Pri Tzaddik section names as the index writes them (longest first, for garbled labels)
    pt_names = sorted(((s['he'], s['ref_prefix']) for s in pt_sections if s.get('he')), key=lambda x: -len(x[0]))
    pt_re = re.compile(r'(' + '|'.join(re.escape(h) for h, _ in pt_names) + r')[\s\-–]+\*?([א-ת"\'׳״]{1,4})(?![א-ת])')
    pt_prefix = dict(pt_names)
    label_ref = {}
    for e in entries:
        for r in e['r']:
            if r[1]: label_ref.setdefault(r[0], r[1])

    def setref(e, r, ref, how):
        note(e, 'links', 'ref', r[1] or r[0], ref, how)
        while len(r) < 2: r.append(None)
        r[1] = ref; stats[how.split(':')[0]] += 1

    anchors = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))   # slug -> page -> sections
    pageonly = []
    for e in entries:
        ps = pieces(e['t']) if e['x'] == 's' else []
        for r in e['r']:
            lab = r[0] or ''
            m = LABEL.match(lab)
            code = m and m.group(1) in CODES and m.group(1)
            if code:
                slug, tmpl = CODES[code]
                lets, page = m.group(2), m.group(3) or m.group(4)
                if not r[1] and lets and tmpl and gem(lets) and code not in NO_LETTERS:
                    sec = tmpl.format(gem(lets))
                    if sec in lib.secs: setref(e, r, sec, 'letters: the siman is given in letters')
                if r[1] and page: anchors[slug][int(page)][r[1]] += 1
                if not r[1]:
                    if len(ps) >= 2:
                        sec = strong(lib.find(slug, ps))
                        if sec:
                            setref(e, r, sec, 'quotes: the quoted words are in this section')
                            if page: anchors[slug][int(page)][sec] += 1
                            continue
                    if page and not lets: pageonly.append((e, r, slug, int(page)))
                continue
            if not r[1] and (len(r) < 3 or r[2] is None):      # a Pri Tzaddik reference whose section name was garbled
                hits = list(pt_re.finditer(lab))
                ref = None
                if hits:
                    h = hits[-1]; n = gem(h.group(2))
                    cand = f'{pt_prefix[h.group(1)]} {n}'
                    if cand in lib.secs and (len(ps) < 2 or lib.score(cand, ps) > 0 or not strong(lib.find('peri-tzadik', ps))): ref = cand
                if not ref and len(ps) >= 2: ref = strong(lib.find('peri-tzadik', ps), .7)
                if ref and all(x[1] != ref for x in e['r']): setref(e, r, ref, 'garbled: the section name was misread by the OCR')

    # pages: a page between two known pages of one section is in that section
    for e, r, slug, page in pageonly:
        A = anchors.get(slug)
        if not A or slug in NO_PAGES: continue
        pages = sorted(A)
        sec = None
        if page in A and len(A[page]) == 1: sec = next(iter(A[page]))
        else:
            i = bisect.bisect_left(pages, page)
            if 0 < i < len(pages):
                lo, hi = A[pages[i - 1]], A[pages[i]]
                if len(lo) == 1 and lo.keys() == hi.keys(): sec = next(iter(lo))
        if sec and all(x[1] != sec for x in e['r']): setref(e, r, sec, 'pages: between two pages of this section')

    # references to an os the library does not have ("בא פדיון" read as Bo 150, "הבדלה" as 46, misread numbers):
    # a source entry is relinked where its quote is, otherwise the broken link is removed (the label stays)
    valid = set(lib.secs)
    try: valid |= {l.strip() for l in open('sources/mafteach/library-refs.txt', encoding='utf-8') if l.strip()}
    except OSError: pass
    for e in entries:
        ps = pieces(e['t']) if e['x'] == 's' else []
        for r in list(e['r']):
            sec = r[1]
            if not sec or sec in valid: continue
            book = next((lib.book_of[x] for x in (re.sub(r' \d+$', ' 1', sec), re.sub(r' \d+$', '', sec)) if x in lib.book_of), None)
            best = None
            if book and len(ps) >= 2:
                top = re.sub(r' \d+$', '', sec)
                best = strong(lib.find(book, ps, within=top), .5) or strong(lib.find(book, ps), .75, .4)
            if best and all(x[1] != best for x in e['r']):
                note(e, 'links', 'ref', sec, best, f'quotes: the library has no {sec}; the quoted words are in {best}')
                r[1] = best; stats['relinked'] += 1
            else:
                note(e, 'links', 'ref', sec, None, f'the library has no {sec} (label "{r[0]}"): link removed')
                r[1] = None; stats['unlinked'] += 1

    # linked references of source entries: are the quoted words in the passage?
    for e in entries:
        if e['x'] != 's': continue
        ps = pieces(e['t'])
        if len(ps) < 3: continue
        for r in list(e['r']):
            sec = r[1]
            if not sec or sec not in lib.secs: continue
            if lib.score(sec, ps) > 0: stats['in passage'] += 1; continue
            slug = lib.book_of[sec]
            top = re.sub(r' \d+$', '', sec)
            found = lib.find(slug, ps, within=top) or []
            best = strong(found, .5)
            if not best:
                allb = lib.find(slug, ps)
                best = strong(allb, .75, .4)
            if best and best != sec:
                if any(x[1] == best for x in e['r']):
                    note(e, 'links', 'ref', sec, None, f'the quoted words are not in {sec}; the entry already lists {best}, where they are')
                    e['r'].remove(r); stats['moved'] += 1
                else:
                    note(e, 'links', 'ref', sec, best, f'the quoted words are not in {sec} but in {best}')
                    r[1] = best; stats['moved'] += 1
            else:
                stats['not in passage'] += 1
    print('links:', dict(stats))

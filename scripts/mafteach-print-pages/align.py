#!/usr/bin/env python3
"""HaMafteach page references -> library passages, by aligning an original print's pages with the library text.

HaMafteach cites many of R. Tzadok's sefarim by page of the original print (e.g. דצ-35 = Dover Tzedek p. 35). This finds
which library passage stands on each printed page:
  1. offset: printed page -> PDF page, from where the index lines' own words appear in the print's OCR;
  2. alignment: each library paragraph is placed on the PDF page whose OCR shares the most distinctive words with it
     (moving forward through the book);
  3. check: for every index line citing the sefer by page, are its words in the mapped passage? Compared with a random
     page and with the index's own (already linked) references, which score 36-51% on the same test.
Writes sources/mafteach/print-pages/<slug>.json: {"book", "code", "print", "offset", "check", "pages": {page: [section refs]}}.

Usage: align.py SLUG "MAFTEACH BOOK NAME" CODE OCR_TXT "PRINT DESCRIPTION"
OCR_TXT: the print's OCR, pages separated by form feeds (kept outside the repository: the scans are the user's files).
Needs dist/mcp-data (scripts/build-mcp-index.mjs) for the library text.
"""
import collections, gzip, json, math, random, re, sys
from pathlib import Path

slug, bookname, code, ocr, printdesc = sys.argv[1:6]
FIN = str.maketrans('ךםןףץ', 'כמנפצ')
B = lambda s: re.sub(r'[֑-ׇ"\'״׳]', '', s or '').translate(FIN)
W = lambda s: re.findall(r'[א-ת]{3,}', B(s))
STOP = set('אשר הוא היא שהוא שהיא היה הם להם עלי אלא כמו וכו גם כי לא על את של מה זה זו בזה לכן'.split())
heOf = lambda p: ' '.join(x[0] for x in p['p']) if p.get('p') else p.get('t', '')
sectionOf = lambda ref: re.sub(r':\d+$', '', ref)
valid = set(l.strip() for l in open('sources/mafteach/library-refs.txt', encoding='utf-8') if l.strip())

t = json.load(open(f'dist/mcp-data/text/{slug}.json'))
pages = [collections.Counter(W(p)) for p in open(ocr, encoding='utf-8').read().split('\f')]
N = len(pages)
df = collections.Counter(w for p in pages for w in p)
idf = lambda w: math.log(N / (1 + df[w]))

# index lines citing the sefer by page: (pages, words)
E = [json.loads(l) for l in gzip.open('sources/mafteach/entries.jsonl.gz', 'rt', encoding='utf-8')]
def pages_of(label):
    m = re.fullmatch(re.escape(code) + r'-(\d+)(?:-(\d+))?', label) or re.fullmatch(re.escape(code) + r'-[א-ת]+\((\d+)(?:-(\d+))?\)(?:\(\d+\))?', label)
    if not m: return None
    a, b = int(m.group(1)), int(m.group(2) or m.group(1))
    a, b = min(a, b), max(a, b)
    return list(range(a, b + 1)) if b - a <= 6 else None
refs = []
for e in E:
    for r in e.get('r', []):
        if len(r) > 2 and r[2] == bookname and not r[1]:
            pg = pages_of(r[0])
            if pg: refs.append((pg, [w for w in W(e['t']) if w not in STOP]))

# 1. offset
def ocr_rate(off):
    hit = n = 0
    for pg, ws in refs:
        if len(ws) < 2: continue
        i = pg[0] + off - 1
        if 0 <= i < N:
            n += 1
            seen = set().union(*(pages[j] for j in range(i, min(N, pg[-1] + off))))
            hit += sum(w in seen for w in ws) / len(ws) >= 0.5
    return hit / max(n, 1)
offset = max(range(-40, 60), key=ocr_rate)

# 2. alignment (one paragraph per ref, in reading order)
seen, P = set(), []
for p in t['paras']:
    if p['r'] not in seen: seen.add(p['r']); P.append(p)
placed, last = [], 0
for p in P:
    ws = set(w for w in W(heOf(p)) if df[w] and df[w] < N * 0.3)
    if len(ws) < 3: placed.append((p['r'], None)); continue
    tot = sum(idf(w) for w in ws)
    s, pg = max((sum(idf(w) for w in ws if w in pages[g]), g) for g in range(max(0, last - 2), N))
    if tot and s / tot > 0.35: last = pg; placed.append((p['r'], pg))
    else: placed.append((p['r'], None))
bypdf = collections.defaultdict(list)
for ref, pg in placed:
    if pg is not None and sectionOf(ref) not in bypdf[pg]: bypdf[pg].append(sectionOf(ref))
full, cur = {}, None
for g in range(N):
    if bypdf.get(g):
        full[g] = ([cur] if cur and cur not in bypdf[g] else []) + bypdf[g]   # the page also continues the previous passage
        cur = bypdf[g][-1]
    elif cur: full[g] = [cur]
printed = {str(g + 1 - offset): [s for s in v if s in valid] for g, v in full.items() if g + 1 - offset >= 1}
printed = {k: v for k, v in printed.items() if v}

# 3. check
txt = collections.defaultdict(str)
for p in t['paras']: txt[sectionOf(p['r'])] += ' ' + heOf(p)
words_of = {s: set(W(v)) for s, v in txt.items()}
def found(pg, ws, mp):
    secs = [s for x in pg for s in mp.get(str(x), [])]
    tw = set().union(*(words_of.get(s, set()) for s in secs)) if secs else set()
    return sum(w in tw for w in ws) / len(ws) >= 0.5
tests = [(pg, ws) for pg, ws in refs if len(ws) >= 2]
# paragraph-level check (independent of how large the library's sections are): the paragraphs placed on the cited page(s)
ptxt = collections.defaultdict(str)
for p in t['paras']: ptxt[p['r']] += ' ' + heOf(p)
pwords = {r: set(W(v)) for r, v in ptxt.items()}
onpage = collections.defaultdict(list)
for ref, pg in placed:
    if pg is not None: onpage[pg + 1 - offset].append(ref)
def pfound(pg, ws):
    rs = [r for x in pg for r in onpage.get(x, []) + onpage.get(x - 1, [])[-1:]]
    tw = set().union(*(pwords[r] for r in rs)) if rs else set()
    return sum(w in tw for w in ws) / len(ws) >= 0.5
preal = sum(pfound(pg, ws) for pg, ws in tests) / max(len(tests), 1)
random.seed(2); pk = list(onpage)
prnd = sum(pfound([random.choice(pk)], ws) for pg, ws in tests) / max(len(tests), 1) if pk else 0
real = sum(found(pg, ws, printed) for pg, ws in tests) / max(len(tests), 1)
random.seed(1); keys = list(printed)
rnd = sum(found([int(random.choice(keys))], ws, printed) for pg, ws in tests) / max(len(tests), 1) if keys else 0
covered = sum(all(str(x) in printed for x in pg) for pg, ws in refs) / max(len(refs), 1)
out = {'book': bookname, 'code': code, 'library': slug, 'print': printdesc, 'offset': offset,
       'check': {'index_lines': len(tests), 'words_found': round(real, 3), 'random_page': round(rnd, 3), 'pages_covered': round(covered, 3),
                 'paragraphs_placed': sum(1 for r in placed if r[1] is not None), 'paragraphs': len(placed),
                 'paragraph_words_found': round(preal, 3), 'paragraph_random_page': round(prnd, 3)},
       'pages': printed}
Path('sources/mafteach/print-pages').mkdir(parents=True, exist_ok=True)
Path(f'sources/mafteach/print-pages/{slug}.json').write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding='utf-8')
print(f"{bookname:28} refs {len(refs):5d}  offset {offset:+3d}  placed {out['check']['paragraphs_placed']}/{len(placed)}  pages {len(printed):4d}  covered {covered:.0%}  section: found {real:.0%} vs random {rnd:.0%}  | paragraph: found {preal:.0%} vs random {prnd:.0%}")

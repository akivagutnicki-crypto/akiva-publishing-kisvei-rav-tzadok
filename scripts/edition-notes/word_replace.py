#!/usr/bin/env python3
"""The November 2026 Word editions replace the reader's text and notes of fourteen books (the editor's instruction,
2026-11-27): each section of the reader takes the Word file's interlinear translation and its notes (sources and
parallels) for that section. Sections keep their refs; a Word paragraph goes to the reader section whose Hebrew it
shares (headings split the Word file into blocks, each going to the section most of its paragraphs match). A reader
section the Word file does not cover keeps its text. A Talmud note that sits on a phrase not naming its masechta moves
to the one phrase of the paragraph that names that masechta and daf.

Input: sources/akiva/word-editions/parsed/<slug>.json.gz (scripts: parse of the Word files: headings, pairs, notes).
  word_replace.py SITE_LIBRARY_DATA   -> prints the report; writes the sections, toc shapes, links and cited indexes
"""
import json, re, os, sys, gzip, html, glob, collections, urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_notes as A

ROOT = Path(__file__).resolve().parent.parent.parent
PARSED = ROOT / 'sources/akiva/word-editions/parsed'
NIK = re.compile(r'[֑-ׇ]')
OSHEAD = re.compile(r'^(?:\(?\[?[א-ת]{1,3}["׳״\']?[א-ת]?\]?\)?|(?:Section|Seif|Chapter|Os)\s*\d+.*|\d+\s+.*|אוֹת\s.*|אות\s.*|סִימָן\s.*|פֶּרֶק\s.*)$')
TALMUD = {'Berachos': 'ברכות', 'Shabbos': 'שבת', 'Eruvin': 'עירובין', 'Pesachim': 'פסחים', 'Yoma': 'יומא', 'Sukkah': 'סוכה',
          'Beitzah': 'ביצה', 'Rosh Hashanah': 'ראש השנה', 'Taanis': 'תענית', 'Megillah': 'מגילה', 'Moed Katan': 'מועד קטן',
          'Chagigah': 'חגיגה', 'Yevamos': 'יבמות', 'Kesubos': 'כתובות', 'Nedarim': 'נדרים', 'Nazir': 'נזיר', 'Sotah': 'סוטה',
          'Gittin': 'גיטין', 'Kiddushin': 'קידושין', 'Bava Kamma': 'בבא קמא', 'Bava Metzia': 'בבא מציעא', 'Bava Basra': 'בבא בתרא',
          'Sanhedrin': 'סנהדרין', 'Makkos': 'מכות', 'Shevuos': 'שבועות', 'Avodah Zarah': 'עבודה זרה', 'Horayos': 'הוריות',
          'Zevachim': 'זבחים', 'Menachos': 'מנחות', 'Chullin': 'חולין', 'Bechoros': 'בכורות', 'Arachin': 'ערכין',
          'Temurah': 'תמורה', 'Niddah': 'נדה'}
GEM = dict(zip('אבגדהוזחטיכלמנסעפצקרשת', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400]))
rd = lambda p: json.load(open(p))
wr = lambda p, v: json.dump(v, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))


def g3(w): return {' '.join(w[i:i + 3]) for i in range(max(1, len(w) - 2))}
def words(s): return A.bare(s).split()
def heb_num(n):
    out = ''
    for v, ch in [(400, 'ת'), (300, 'ש'), (200, 'ר'), (100, 'ק')]:
        while n >= v: out += ch; n -= v
    if n in (15, 16): return out + ('טו' if n == 15 else 'טז')
    for v, ch in [(90, 'צ'), (80, 'פ'), (70, 'ע'), (60, 'ס'), (50, 'נ'), (40, 'מ'), (30, 'ל'), (20, 'כ'), (10, 'י')]:
        if n >= v: out += ch; n -= v
    return out + ('אבגדהוזחט'[n - 1] if n else '')
def flat(s): return re.sub(r'[\s"׳״\'״]', '', NIK.sub('', s)).replace('ו', '').replace('י', '')
def sef_ref(url):
    ref = urllib.parse.unquote(url.split('sefaria.org/', 1)[1]).split('?')[0].replace('_', ' ')
    ref = re.sub(r'(?<=\d[ab])\.(?=\d)', ':', ref)
    return re.sub(r'(?<=\d)\.(?=\d)', ':', re.sub(r'(?<=[a-z])\.(?=\d)', ' ', ref)).strip()


def note_of(slug, n, src, he, en):
    paras = src['paragraphs']; text = ' '.join(p.get('text', '') for p in paras)
    role = 'parallel' if re.match(r'\s*(Parallels|Compare)\b', text) else 'source'
    sources, seen = [], set()
    for p in paras:
        for r in p.get('rich') or []:
            h = r.get('href') or ''
            if 'sefaria.org' in h and h not in seen:
                seen.add(h); sources.append({'ref': r['text'].strip(' ,;.()'), 'url': h, 'role': role})
    hp, ep = A.plain(he), A.plain(en)
    x = {'number': 0, 'sourceId': f'WE-{slug}-{n:05d}', 'placementId': f'WE-{slug}-{n:05d}-1', 'phraseIndex': src['pi'],
         'kind': 'parallel' if role == 'parallel' else 'source', 'paragraphs': paras, 'sources': sources,
         'heWord': len(hp.split()), 'heCharOffset': len(hp), 'heAnchorPrefix': hp,
         'verificationStatus': 'verified', 'verificationNote': 'Word edition, November 2026'}
    if ep: ec = max(1, min(src['eo'] or len(ep), len(ep))); x['enCharOffset'] = ec; x['enAnchorPrefix'] = ep[:ec]
    return x


# Hebrew names by which a passage cites a work (a note on its own citation stays there)
NAMES = {'Bereishis': 'בראשית', 'Shemos': 'שמות', 'Vayikra': 'ויקרא', 'Bamidbar': 'במדבר', 'Devarim': 'דברים', 'Yehoshua': 'יהושע',
         'Shoftim': 'שופטים', 'Shmuel': 'שמואל', 'Melachim': 'מלכים', 'Yeshayahu': 'ישעיה', 'Yirmiyahu': 'ירמיה', 'Yechezkel': 'יחזקאל',
         'Hoshea': 'הושע', 'Yoel': 'יואל', 'Amos': 'עמוס', 'Ovadiah': 'עובדיה', 'Yonah': 'יונה', 'Michah': 'מיכה', 'Nachum': 'נחום',
         'Chavakuk': 'חבקוק', 'Tzefaniah': 'צפניה', 'Chaggai': 'חגי', 'Zechariah': 'זכריה', 'Malachi': 'מלאכי', 'Tehillim': 'תהלים',
         'Mishlei': 'משלי', 'Iyov': 'איוב', 'Shir HaShirim': 'שיר', 'Rus': 'רות', 'Eichah': 'איכה', 'Koheles': 'קהלת', 'Esther': 'אסתר',
         'Daniel': 'דניאל', 'Ezra': 'עזרא', 'Nechemiah': 'נחמיה', 'Divrei HaYamim': 'הימים', 'Rabbah': 'רבה', 'Bereshit': 'בראשית',
         'Shemot': 'שמות', 'Kohelet': 'קהלת', 'Zohar': 'זהר', 'Tikkunei': 'תקוני', 'Tanchuma': 'תנחומא', 'Sifrei': 'ספרי', 'Sifra': 'ספרא',
         'Mekhilta': 'מכילתא', 'Pesikta': 'פסיקתא', 'Yalkut': 'ילקוט', 'Midrash Tehillim': 'שוחר', 'Yerushalmi': 'ירושלמי',
         'Rambam': 'רמבם', 'Avos': 'אבות', 'Pirkei': 'פרקי', 'Mishnah': 'משנה'}


def names_source(label, phrase):
    f = flat(phrase).replace('ה', '')
    return any(k in label and flat(v).replace('ה', '') in f for k, v in NAMES.items()) or \
        any(k in label and flat(v) in flat(phrase) for k, v in TALMUD.items())


def cites_other(phrase):
    """The phrase carries a citation in parentheses of some work (a note for another source does not move onto it)."""
    m = re.findall(r'\(([^)]*)\)', NIK.sub('', phrase))
    return any(flat(v) in flat(c) for c in m for v in list(NAMES.values()) + list(TALMUD.values()))


def bigrams(s):
    w = [x for x in A.bare(s).split() if len(x) > 1]
    return {(w[i], w[i + 1]) for i in range(len(w) - 1)}


def mover(pairs, notes, common=frozenset()):
    """A source note on a phrase that neither names its source nor shares words with its quotation moves to the phrase
    of the paragraph that does: for the Talmud the one phrase naming masechta and daf, otherwise the phrase sharing the
    most word pairs (at least two) with the note's quotation. Notes on a phrase that names or quotes their source stay."""
    moved = 0; hes = [flat(h) for h, e in pairs]; bg = [bigrams(h) - common for h, e in pairs]
    for x in notes:
        t = ' '.join(p.get('text', '') for p in x['paragraphs'])
        if not re.match(r'\s*Source', t): continue
        cur = x['phraseIndex']; target = None
        lab = re.match(r'\s*Source(?: of the quoted words)?: ([^—“]+)', t)
        if lab and names_source(lab.group(1), pairs[cur][0]): continue      # the note sits on the citation of its source
        quote = bigrams(' '.join(re.findall(r'“([^”]*)”', t)[:1])) - common
        m = re.match(r'\s*Source(?: of the quoted words)?: (?:Tosafos, |Rashi, )?([A-Z][a-z]+(?: [A-Z][a-z]+)?) (\d+)([ab])\b', t)
        if m and m.group(1) in TALMUD:
            name = flat(TALMUD[m.group(1)]); daf = flat(heb_num(int(m.group(2))))
            if name in hes[cur] or 'שם' in NIK.sub('', pairs[cur][0]): continue
            cands = [i for i, h in enumerate(hes) if name in h and daf in h.replace(name, ' ')]
            if len(cands) == 1: target = cands[0]
        qw = {w for w in A.bare(' '.join(re.findall(r'“([^”]*)”', t)[:1])).split() if len(w) >= 4}
        if target is None and quote and not (bg[cur] & quote) and not (qw & {w for w in A.bare(pairs[cur][0]).split() if len(w) >= 4}):
            sc = [len(b & quote) for b in bg]; best = max(range(len(sc)), key=lambda i: (sc[i], -abs(i - cur)))
            if sc[best] >= 2 and not (cites_other(pairs[best][0]) and not (lab and names_source(lab.group(1), pairs[best][0]))): target = best
        if target is not None and target != cur:
            he, en = pairs[target]; hp, ep = A.plain(he), A.plain(en)
            x.update(phraseIndex=target, heWord=len(hp.split()), heCharOffset=len(hp), heAnchorPrefix=hp)
            if ep: x.update(enCharOffset=len(ep), enAnchorPrefix=ep)
            moved += 1
    return moved



def unrelated(L):
    """Talmud source notes with nothing linking them to their paragraph: the paragraph neither names the masechta nor
    shares one uncommon word (four letters or more, in at most a tenth of the book's paragraphs) with the quotation.
    Returned as the set of (paragraph index in L, note index); these notes are dropped (the editor's instruction)."""
    B = [k for k, it in enumerate(L) if it['t'] == 'b']; nb = len(B)
    df = collections.Counter(w for k in B for w in set(A.bare(' '.join(h for h, e in L[k]['pairs'])).split()))
    out = set()
    for k in B:
        it = L[k]; ptxt = ' '.join(h for h, e in it['pairs']); pw = set(A.bare(ptxt).split()); pf = flat(ptxt)
        for j, n in enumerate(it['notes']):
            t = ' '.join(p.get('text', '') for p in n['paragraphs'])
            m = re.match(r'\s*Source(?: of the quoted words)?: (?:Tosafos, |Rashi, )?([A-Z][a-z]+(?: [A-Z][a-z]+)?) \d+[ab]\b', t)
            if not m or m.group(1) not in TALMUD or flat(TALMUD[m.group(1)]) in pf: continue
            qw = set(A.bare(' '.join(re.findall(r'“([^”]*)”', t)[:1])).split())
            if len(qw) < 4 or {w for w in qw & pw if len(w) >= 4 and df[w] <= nb * 0.10}: continue
            out.add((k, j))
    return out

def replace_book(data, slug, rep):
    L = json.loads(gzip.open(PARSED / f'{slug}.json.gz').read())
    drop = unrelated(L)
    for k, it in enumerate(L):
        if it['t'] == 'b': it['notes'] = [n for j, n in enumerate(it['notes']) if (k, j) not in drop]
    rep_dropped = len(drop)
    d = os.path.join(data, slug); S = A.sections(d)
    files = {f: rd(os.path.join(d, f)) for f, _, _ in S}
    lk = os.path.join(d, 'links.json'); links = rd(lk) if os.path.exists(lk) else {}
    # reader sections: their Hebrew 3-grams
    G = []
    for f, ref, sep in S:
        w = []
        for it in files[f]:
            if isinstance(it, dict) and it.get('p'): w += words(' '.join(A.strip_notes(p[0] if isinstance(p, list) else p) for p in it['p']))
        G.append(g3(w) if w else set())
    idx = collections.defaultdict(set)
    for j, g in enumerate(G):
        for x in g: idx[x].add(j)
    # each Word paragraph goes to the section most of its rare 3-grams come from; one without a match follows the paragraph
    # before it (the first ones, the paragraph after them); a heading goes with the paragraph that follows it
    def place(seq):
        """Phrase by phrase: each phrase pair goes to the section its rare 3-grams come from; the matches kept are the
        longest run that never goes back (a phrase quoting another passage drops out); a phrase without a match follows
        the one before it. A Word paragraph whose phrases fall in two sections is split there, its notes going with their
        phrases; a heading goes with what follows it."""
        units = []      # (kind, item, pair index)
        for it in seq:
            if it['t'] == 'h': units.append(('h', it, None))
            else: units += [('p', it, i) for i in range(len(it['pairs']))]
        vote = []
        for kind, it, i in units:
            if kind != 'p': vote.append(None); continue
            w = words(' '.join(h for h, e in it['pairs'][max(0, i - 1):i + 2]))   # the phrase with its neighbours
            own = set(words(it['pairs'][i][0]))
            gg = {g for g in g3(w) if own & set(g.split())}; votes = collections.Counter()
            for x in gg:
                js = idx.get(x, ())
                if 0 < len(js) <= 3:
                    for j in js: votes[j] += 1 / len(js)
            j, v = votes.most_common(1)[0] if votes else (None, 0)
            vote.append(j if j is not None and v >= 1 else None)
        import bisect
        got = [k for k, j in enumerate(vote) if j is not None]; tails = []; tail_k = []; prev = {}
        for k in got:
            q = bisect.bisect_right(tails, vote[k])
            prev[k] = tail_k[q - 1] if q else None
            if q == len(tails): tails.append(vote[k]); tail_k.append(k)
            else: tails[q] = vote[k]; tail_k[q] = k
        keep = set(); k = tail_k[-1] if tail_k else None
        while k is not None: keep.add(k); k = prev[k]
        assign = [None] * len(units); last = None
        for k, (kind, it, i) in enumerate(units):
            if kind == 'p':
                assign[k] = vote[k] if k in keep else last; last = assign[k]
        nxt = None
        for k in range(len(units) - 1, -1, -1):
            if units[k][0] == 'p':
                if assign[k] is None: assign[k] = nxt
                nxt = assign[k]
            else: assign[k] = nxt
        per = collections.defaultdict(list); cur = None
        for (kind, it, i), j in zip(units, assign):
            if j is None: continue
            if kind == 'h': per[j].append(it); cur = None; continue
            if cur is None or cur[0] is not it or cur[1] != j:
                piece = {'t': 'b', 'pairs': [], 'notes': [], 'src': it['src']}; per[j].append(piece); cur = (it, j, piece, i)
            piece = cur[2]
            base = cur[3]
            piece['pairs'].append(it['pairs'][i])
            piece['notes'] += [dict(n, pi=len(piece['pairs']) - 1) for n in it['notes'] if min(n['pi'], len(it['pairs']) - 1) == i]
        return per
    per = collections.defaultdict(list); owner = {}
    for src in dict.fromkeys(it['src'] for it in L):
        part = place([it for it in L if it['t'] != 'e' and it['src'] == src])
        for j, its in part.items():
            mass = sum(len(g3(words(' '.join(h for h, e in it['pairs']))) & G[j]) for it in its if it['t'] == 'b')
            if j not in owner or mass > owner[j][1]: owner[j] = (src, mass); per[j] = its
    # a reader section is replaced when the Word text assigned to it covers most of its Hebrew
    n = 0; out = {'sections': len(S), 'replaced': 0, 'kept': [], 'paragraphs': 0, 'notes': 0, 'moved': 0, 'links': []}
    # word pairs found in many paragraphs of the book (הקדוש ברוך, ברוך הוא) do not count as a shared quotation
    dfb = collections.Counter(b for it in L if it['t'] == 'b' for b in set().union(*[bigrams(h) for h, e in it['pairs']]))
    nb = sum(1 for it in L if it['t'] == 'b'); common = frozenset(b for b, c in dfb.items() if c > max(3, nb * 0.03))
    cover = {}
    for j in range(len(S)):
        items = per.get(j)
        if items and G[j] and any(it['t'] == 'b' for it in items):
            mine = set().union(*[g3(words(' '.join(h for h, e in it['pairs']))) for it in items if it['t'] == 'b'])
            cover[j] = len(G[j] & mine) / len(G[j])
    # a section is replaced when the Word text given it covers most of its Hebrew, or, when the Word wording differs
    # more (the reader's Hebrew was re-edited), when it lies between two sections that are replaced
    ok = lambda j: cover.get(j, 0) >= 0.35
    for j, (f, ref, sep) in enumerate(S):
        items = per.get(j)
        if j not in cover: out['kept'].append(ref); continue
        if not ok(j) and not (cover[j] >= 0.05 and (j == 0 or ok(j - 1)) and (j == len(S) - 1 or ok(j + 1))):
            out['kept'].append(f'{ref} ({cover[j]:.2f})'); continue
        old_p = [it for it in files[f] if isinstance(it, dict) and it.get('p')]
        used = [l['a'][len(ref)] for l in links.get(ref, []) if l['a'].startswith(ref) and re.fullmatch(r'[: ]\d+', l['a'][len(ref):])]
        if used: sep = max(set(used), key=used.count)
        # os headings inside the section, one per reader paragraph: the Word paragraphs of an os become one paragraph
        heads = [k for k, it in enumerate(items) if it['t'] == 'h' and OSHEAD.match(it['he'].strip()) and k > 0]
        merge = len(heads) + 1 == len(old_p) and len(old_p) > 1
        new = []; started = False
        for k, it in enumerate(items):
            if it['t'] == 'h':
                lab = it['he'] if it['he'] == it['en'] else f"{it['he']} — {it['en']}"
                own = OSHEAD.match(it['he'].strip()) or re.match(r'^(Section|Seif|Chapter|Part|Os)\s+\d+', lab.strip(' —'))
                if not started and own: continue       # the section's own number
                if merge and own: new.append({'_os': True}); continue
                new.append({'h': html.escape(lab, quote=False)}); continue
            started = True
            pairs = [[html.escape(h, quote=False), html.escape(e, quote=False)] for h, e in it['pairs']]
            notes = []
            for s in it['notes']:
                n += 1; he, en = it['pairs'][min(s['pi'], len(it['pairs']) - 1)]
                notes.append(note_of(slug, n, dict(s, pi=min(s['pi'], len(it['pairs']) - 1)), he, en))
            out['moved'] += mover(it['pairs'], notes, common)
            if merge and new and 'p' in new[-1]:
                base = len(new[-1]['p']); new[-1]['p'] += pairs
                for x in notes: x['phraseIndex'] += base
                new[-1].setdefault('footnotes', []).extend(notes)
            else:
                new.append({'p': pairs, 'keepPairs': True, **({'footnotes': notes} if notes else {})})
        new = [x for x in new if not x.get('_os')]
        k = 0
        for x in new:
            if 'p' in x:
                k += 1; x['n'] = k; x['footnotes'] = sorted(x.get('footnotes', []), key=lambda y: (y['phraseIndex'], y['heCharOffset']))
                if not x['footnotes']: x.pop('footnotes')
                a = f'{ref}{sep}{k}'
                for y in x.get('footnotes', []):
                    for s_ in y['sources']: out['links'].append({'s': ref, 'a': a, 'r': sef_ref(s_['url'])})
        files[f] = new; links[ref] = []
        out.setdefault('replacedRefs', []).append(ref); out['replaced'] += 1; out['paragraphs'] += k; out['notes'] += sum(len(x.get('footnotes', [])) for x in new)
    # a kept section whose Hebrew now also stands in a replaced one (the Word text absorbed it) is reported
    newg = set()
    for j, (f, ref, sep) in enumerate(S):
        if ref in out.get('replacedRefs', []):
            for it in files[f]:
                if isinstance(it, dict) and it.get('p'): newg |= g3(words(' '.join(p[0] for p in it['p'])))
    out['doubled'] = [ref for j, (f, ref, sep) in enumerate(S) if ref not in out.get('replacedRefs', []) and G[j] and len(G[j] & newg) / len(G[j]) > 0.3]
    # renumber the book's notes in reading order; write; toc shapes follow the paragraph counts
    num = 0
    for f, _, _ in S:
        for it in files[f]:
            if isinstance(it, dict):
                for y in it.get('footnotes') or []: num += 1; y['number'] = num
        wr(os.path.join(d, f), files[f])
    if os.path.exists(lk) or links: wr(lk, links)
    toc = rd(os.path.join(d, 'toc.json'))
    def walk(node):
        i = node.get('id')
        if isinstance(node.get('shape'), list) and i is not None:
            node['shape'] = [sum(1 for it in rd(os.path.join(d, f'{i}-{k}.json')) if isinstance(it, dict) and it.get('p'))
                             if os.path.exists(os.path.join(d, f'{i}-{k}.json')) else v for k, v in enumerate(node['shape'], 1)]
        elif isinstance(node.get('shape'), int) and i is not None and os.path.exists(os.path.join(d, f'{i}.json')):
            node['shape'] = sum(1 for it in rd(os.path.join(d, f'{i}.json')) if isinstance(it, dict) and it.get('p'))
        for c in node.get('children') or []: walk(c)
    walk(toc['toc']); wr(os.path.join(d, 'toc.json'), toc)
    out['notesNow'] = num; out['unrelatedDropped'] = rep_dropped
    rep[slug] = out
    return set(out.get('replacedRefs', []))


def drop_cited(data, prefixes):
    """Anchors of the replaced sections leave the reverse citation index (they are recorded afresh from the new notes)."""
    pre = tuple(p + sep for p in prefixes for sep in (':', ' ', ','))
    changed = 0
    for f in glob.glob(os.path.join(data, 'cited', '*.json')):
        if f.endswith('index.json'): continue
        v = rd(f); dirty = False
        for r in list(v):
            keep = [a for a in v[r] if not a.startswith(pre)]
            if len(keep) != len(v[r]):
                dirty = True
                if keep: v[r] = keep
                else: del v[r]
        if dirty: wr(f, v); changed += 1
    return changed


def main(data):
    rep = {}; secs = set()
    for p in sorted(PARSED.glob('*.json.gz')):
        slug = p.name[:-8]
        if os.path.isdir(os.path.join(data, slug)): secs |= replace_book(data, slug, rep)
    rep['citedFilesCleaned'] = drop_cited(data, sorted(secs))
    return rep


if __name__ == '__main__':
    r = main(sys.argv[1])
    print(json.dumps({k: ({x: y for x, y in v.items() if x not in ('links', 'replacedRefs')} if isinstance(v, dict) else v) for k, v in r.items()}, ensure_ascii=False, indent=1))

"""Ingest an OCR of Sefer Mafteach le-Kitvei R. Tzadok HaKohen (an alphabetical subject index to all his
writings: under each headword, one-line summaries of what he says, each with a reference to the old
printed editions' pages, or [siman] for Tzidkat HaTzadik).

The references are to printed pages and the OCR garbles the abbreviations, so each summary is located in
the reader by its own words (the summaries keep Rav Tzadok's wording); which sefer each abbreviation means
is then learned from where its confident matches land, and used to place the weaker summaries.
Summaries under one headword in different places become thematic pairs; each located paragraph gets the
headword as a topic. The index's text is never stored, only headwords and reader refs.

    python3 run.py ingest-mafteach <ocr.docx|txt> <mcp-data dir> <training/thematic/out.json>
"""
import json
import os
import re
from collections import Counter, defaultdict

from .biur import read_lines, pages_any, _plain
from .footnote_memory import he_words
from .hebrew import gematria_number
from .otzar import LibraryShingles, thematic_pairs

REF = re.compile(r'\(([^()]{2,40})\)')
SKIP = re.compile(r'כל הזכויות שמורות|מותר להדפיס|מפתח כתבי ר|hebrewbooks|^\s*\d+\s*$')
TZIDKAT_BRACKET = re.compile(r'\[\s*([א-ת"\']{1,5})\s*\]')


class BookWords:
    """Word-overlap search inside one book, for summaries too short or too paraphrased for shingles."""

    def __init__(self, mcp_dir):
        self.paras = defaultdict(list)
        self.df = Counter()
        for f in sorted(os.listdir(os.path.join(mcp_dir, 'text'))):
            if f.endswith('.json'):
                for p in json.load(open(os.path.join(mcp_dir, 'text', f), encoding='utf-8'))['paras']:
                    he = ' '.join(x[0] for x in p['p']) if p.get('p') else (p.get('t') or '')
                    w = set(he_words(he))
                    self.paras[f[:-5]].append((p['r'], w))
                    self.df.update(w)

    def locate(self, book, text, min_score=4.0):
        import math
        q = {w for w in he_words(text) if len(w) > 2}
        best, second = (None, 0.0), 0.0
        for ref, w in self.paras.get(book, []):
            sc = sum(math.log(20000 / (1 + self.df[x])) for x in q & w)
            if sc > best[1]:
                second, best = best[1], (ref, sc)
            elif sc > second:
                second = sc
        if best[0] and best[1] >= min_score * 3 and best[1] >= 1.4 * second:
            return best[0], round(best[1], 1)
        return None


def entries(path):
    """(headword, summary text, reference) for every indexed statement."""
    out, head = [], None
    started = False
    for page, _, body in pages_any(read_lines(path)):
        for l in body:
            pl = _plain(l).strip()
            if not pl or SKIP.search(pl):
                continue
            if not started:  # skip the front matter up to the first headword block
                started = page >= 20
                if not started:
                    continue
            refs = list(REF.finditer(pl))
            if not refs:
                h = pl.split('ע"ע')[0].strip()          # "אברהם ע"ע אבות": headword with a see-also
                if h and len(h.split()) <= 4 and not re.search(r'[.:!?]', h):
                    head = re.sub(r'^\[|\]$', '', h).strip()
                continue
            start = 0
            for m in refs:
                text = pl[start:m.start()].strip(' ;,.')
                text = re.sub(r'^\[[^\]]{1,25}\]\s*', '', text)
                start = m.end()
                if head and len(text.split()) >= 5:
                    out.append((head, text, m.group(1).strip()))
    return out


def ingest(path, mcp_dir):
    E = entries(path)
    lib = LibraryShingles(mcp_dir)
    bw = BookWords(mcp_dir)
    stats = Counter(entries=len(E))
    located, abbr_books = [], defaultdict(Counter)
    pending = []
    for head, text, ref in E:
        abbr = ref.split()[0]
        tz = TZIDKAT_BRACKET.search(ref)
        if tz and gematria_number(tz.group(1)):
            # [רמט] is a Tzidkat siman, but the OCR garbles these numbers: where the wording is found it is
            # right every time the two disagree, so the bracket number is never used on its own
            stats['tzidkatBracket'] += 1
        hit = lib.locate(text, min_shared=3)
        if hit:
            ref_, n, _ = hit
            book = lib.book[ref_]
            located.append({'head': head, 'para': ref_, 'book': book, 'abbr': abbr, 'how': 'shingles'})
            abbr_books[abbr][book] += 1
            stats['shingles'] += 1
        else:
            pending.append((head, text, abbr))
    # which sefer each (garbled) abbreviation means, from where its confident matches land
    abbr_map = {a: c.most_common(1)[0][0] for a, c in abbr_books.items() if c.most_common(1)[0][1] >= 3
                and c.most_common(1)[0][1] >= 0.6 * sum(c.values())}
    for head, text, abbr in pending:
        book = abbr_map.get(abbr)
        if not book:
            stats['unknownAbbr'] += 1
            continue
        hit = bw.locate(book, text)
        if hit:
            located.append({'head': head, 'para': hit[0], 'book': book, 'abbr': abbr, 'how': 'words'})
            stats['words'] += 1
        else:
            stats['unlocated'] += 1
    stats['located'] = len(located)
    stats['headwords'] = len({r['head'] for r in located})
    stats['paragraphs'] = len({r['para'] for r in located})
    return located, dict(stats), abbr_map


def as_topic_records(located):
    """Shape for otzar.thematic_pairs: one topic per headword."""
    return [{'topic': r['head'], 'sub': r['head'], 'para': r['para'], 'book': r['book']} for r in located]

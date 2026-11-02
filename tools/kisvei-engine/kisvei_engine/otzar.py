"""Ingest an OCR of a thematic anthology of Rav Tzadok (Otzar HaMachshavah shel R. Tzadok HaKohen):
passages from across his writings arranged under topics and sub-headings.

Each quoted passage is located in the reader by its own words (3-word shingles), so a citation is not
needed. Passages gathered under the same sub-heading become *thematic* parallel pairs (the kind that
share no proof-text and no wording), and every located paragraph gets the topic labels.
The anthology's text is never stored; only topic labels and reader paragraph refs are kept.

    python3 run.py ingest-otzar <ocr.docx|txt> <mcp-data dir> <training/out.json>
"""
import itertools
import json
import os
import re
from collections import Counter, defaultdict

from .biur import read_lines, pages_any, _plain
from .footnote_memory import he_words

SKIP_LINE = re.compile(r'הודפס מאתר|אוצר המחשבה של|^\s*\d+\s*$|^©')
FOOT_NOTE = re.compile(r'^\s*\d{1,3}\s+\S')   # editor's numbered explanations ("37 לית אנא...")


def _shingles(words):
    return {' '.join(words[i:i + 3]) for i in range(len(words) - 2)}


class LibraryShingles:
    def __init__(self, mcp_dir):
        self.post = defaultdict(set)
        self.book = {}
        for f in sorted(os.listdir(os.path.join(mcp_dir, 'text'))):
            if not f.endswith('.json'):
                continue
            for p in json.load(open(os.path.join(mcp_dir, 'text', f), encoding='utf-8'))['paras']:
                he = ' '.join(x[0] for x in p['p']) if p.get('p') else (p.get('t') or '')
                for s in _shingles(he_words(he)):
                    self.post[s].add(p['r'])
                self.book[p['r']] = f[:-5]

    def locate(self, text, min_shared=4):
        """Best reader paragraph for a passage: (ref, shared shingles, runner-up shared) or None."""
        sh = _shingles(he_words(text))
        score = Counter()
        for s in sh:
            refs = self.post.get(s)
            if refs and len(refs) <= 30:      # ignore stock phrases found everywhere
                for r in refs:
                    score[r] += 1
        if not score:
            return None
        (best, n), *rest = score.most_common(2) + [(None, 0)]
        second = rest[0][1] if rest else 0
        if n >= min_shared and n >= 2 * second:
            return best, n, second
        return None


def _topic(header):
    h = _plain(header)
    h = re.sub(r'^\s*\d+\s*|\s*\d+\s*$', '', h)
    h = re.sub(r'(?:^|\s)[א-ת]{1,3}\s*$', '', h).strip()
    h = re.sub(r'^\s*[א-ת]{1,3}\s+(?=\S{3,})', '', h).strip()
    if not h or 'אוצר המח' in h or len(h) > 40:
        return None
    return h


def ingest(path, mcp_dir):
    lines = read_lines(path)
    lib = LibraryShingles(mcp_dir)
    records, stats = [], Counter()
    topic = sub = None
    for page, _, body in pages_any(lines):
        if not body:
            continue
        t = _topic(body[0])
        if t:
            if t != topic:
                sub = None
            topic = t
        for l in body[1:]:
            pl = _plain(l).strip()
            if not pl or SKIP_LINE.search(pl):
                continue
            words = pl.split()
            if len(words) <= 6 and not re.search(r'[„"״().:!?]', pl):
                sub = pl                      # a sub-heading
                stats['subheadings'] += 1
                continue
            if FOOT_NOTE.match(pl) or len(words) < 10 or topic is None:
                continue
            stats['passages'] += 1
            hit = lib.locate(pl)
            if not hit:
                continue
            ref, n, second = hit
            stats['located'] += 1
            records.append({'topic': topic, 'sub': sub or topic, 'page': page, 'para': ref, 'book': lib.book[ref], 'shared': n})
    stats['topics'] = len({r['topic'] for r in records})
    stats['subtopics'] = len({(r['topic'], r['sub']) for r in records})
    stats['paragraphs'] = len({r['para'] for r in records})
    return records, dict(stats)


def normalize_topics(records, min_count=15):
    """Collapse OCR variants of topic names ("א ה ב ה", "דצון חשק", trailing page numbers) onto the common ones."""
    import difflib
    clean = lambda t: re.sub(r'\s+\d.*$', '', re.sub(r'(?<=\b[א-ת]) (?=[א-ת]\b)', '', t)).replace('אוצר החכמה', '').strip()  # noqa: E731
    counts = Counter(clean(r['topic']) for r in records)
    canon = [t for t, c in counts.items() if c >= min_count]
    for r in records:
        t = clean(r['topic'])
        t = re.sub(r'^[א-ת]{1,3}\s+(?=[א-ת]{3,})', '', t) if t not in canon else t
        if t not in canon:
            m = difflib.get_close_matches(t, canon, n=1, cutoff=0.6) or [x for x in canon if x.replace(' ', '') in t.replace(' ', '')]
            t = m[0] if m else t
        if r['sub'] == r['topic']:
            r['sub'] = t
        r['topic'] = t
    return records


def thematic_pairs(records, max_group=12):
    """Pairs of reader paragraphs gathered under the same sub-heading, from different sections."""
    groups = defaultdict(list)
    for r in records:
        if r['para'] not in groups[(r['topic'], r['sub'])]:
            groups[(r['topic'], r['sub'])].append(r['para'])
    pairs = set()
    section = lambda ref: ref.rsplit(':', 1)[0] if ':' in ref else ref  # noqa: E731
    for g in groups.values():
        g = g[:max_group]
        for a, b in itertools.permutations(g, 2):
            if section(a) != section(b):
                pairs.add((a, b))
    return sorted(pairs)

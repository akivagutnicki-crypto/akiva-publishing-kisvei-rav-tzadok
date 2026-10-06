#!/usr/bin/env python3
"""Import the supplied unified Likkutei Maamarim DOCX into the standard reader.

Match original Sefaria paragraphs by their opening Hebrew, retain the vocalized
Hebrew/English phrase sequence, and overlay all four existing schema nodes.
The supplied file omits seven source paragraphs and repeats four near its end.
Reviewed supplements complete those omissions; the repeated block is read once.
"""
import collections
import difflib
import html
import importlib.util
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('il', ROOT / 'scripts/convert-interlinear.py')
il = importlib.util.module_from_spec(spec)
spec.loader.exec_module(il)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
TITLE = 'Likkutei Maamarim'
DOCX = ROOT / 'sources/akiva/docx/Likkutei_Maamarim.docx'
ORIGINAL = ROOT / 'sources/sefaria/Likkutei_Maamarim.json'
SUPPLEMENTS = ROOT / 'sources/akiva/supplements/likkutei-maamarim/reviewed.json'
MISSING = {('On Book of Joshua', None, 26),
           ('Compositions on the Festivals', 16, 26),
           ('Compositions on the Festivals', 16, 27),
           ('Compositions on the Festivals', 16, 28),
           ('Upon Completion of Talmud', None, 10),
           ('Upon Completion of Talmud', None, 11),
           ('Upon Completion of Talmud', None, 12)}
ARTIFACT_LABELS = {
    'Hebrew English Interlinear Translation', 'Custom Gem',
    'להלן התרגום הבין־שורי המבוקש עבור הקטע המצורף, על פי השלבים שהוגדרו (חלוקה לקטעים, פתיחת ראשי תיבות, ניקוד מלא, ותרגום ביטוי אחר ביטוי בהקשר המדויק):',
}


def letters(text):
    return ''.join(re.findall(r'[A-Za-zא-ת]', html.unescape(re.sub(r'<[^>]+>', '', text))))


def read_blocks():
    blocks, tokens, owners = [], [], []
    with zipfile.ZipFile(DOCX) as z:
        rels = il.rels_of(z)
        doc = ET.fromstring(z.read('word/document.xml'))
        for n, p in enumerate(doc.iter(W + 'p')):
            runs = list(il.runs_of(ET.tostring(p, encoding='unicode').replace('ns0:', 'w:').replace('ns1:', 'r:'), rels))
            text = ''.join(r[0] for r in runs).strip()
            if not text or text in ARTIFACT_LABELS:
                continue
            style = p.find(W + 'pPr/' + W + 'pStyle')
            if n == 0 or (style is not None and style.get(W + 'val', '').startswith('Heading')):
                blocks.append({'i': n, 'h': re.sub(r'^\d+\.\s*', '', text), 'start': len(tokens)})
                continue
            pairs = il.dash_pairs(runs)
            assert letters(text) == letters(''.join(h + e for h, e in pairs)), f'Text loss in Word paragraph {n}'
            words = il.plain_he(' '.join(h for h, e in pairs)).split()
            b = len(blocks)
            blocks.append({'i': n, 'p': pairs, 'start': len(tokens), 'words': words})
            tokens.extend(words)
            owners.extend([b] * len(words))
    return blocks, tokens, owners


def canonical_paragraphs(src):
    out = []
    for node, text in src['text'].items():
        segs = [(c + 1, n + 1, s) for c, ch in enumerate(text) for n, s in enumerate(ch)] if text and isinstance(text[0], list) else [(None, n + 1, s) for n, s in enumerate(text)]
        for ch, n, text in segs:
            out.append({'node': node, 'ch': ch, 'n': n, 'original': text, 'words': il.plain_he(text).split()})
    return out


def align(blocks, tokens, owners, canonical):
    index = collections.defaultdict(list)
    for k in range(len(tokens) - 3):
        index[tuple(tokens[k:k + 4])].append(k)
    manual = {('On Book of Joshua', None, 1): 1,
              ('Upon Completion of Talmud', None, 1): 5425,
              ('Upon Completion of Talmud', None, 15): 5869,
              ('Upon Completion of Talmud', None, 16): 5870,
              ('Upon Completion of Talmud', None, 17): 5872}
    last, missing = -1, set()
    for s in canonical:
        w, candidates = s['words'], {}
        for offset in range(min(26, len(w) - 3)):
            for k in index.get(tuple(w[offset:offset + 4]), []):
                b = owners[k]
                if b > last and k - blocks[b]['start'] <= 24:
                    candidates[b] = min(offset, candidates.get(b, 100))
        scored = []
        for b, offset in candidates.items():
            sample = w[:85]
            target = tokens[blocks[b]['start']:blocks[b]['start'] + 115]
            m = difflib.SequenceMatcher(None, sample, target, autojunk=False)
            score = sum(v.size for v in m.get_matching_blocks()) / max(1, len(sample)) - offset * .004
            scored.append((score, b))
        scored.sort(key=lambda v: (-v[0], v[1]))
        hit = scored[0] if scored and scored[0][0] >= .7 else None
        key = (s['node'], s['ch'], s['n'])
        if key in manual:
            hit = (1, next(k for k, b in enumerate(blocks) if b['i'] == manual[key]))
        if hit:
            s['score'], last = hit
            s['block'] = last
        else:
            s['block'] = None
            missing.add(key)
    assert missing == MISSING, f'Unexpected unmatched paragraphs: {missing.symmetric_difference(MISSING)}'
    assert len(canonical) == 171


def repeated_block(blocks, canonical):
    six = next(s for s in canonical if s['node'] == 'Upon Completion of Talmud' and s['n'] == 6)
    key = six['words'][:4]
    hits = [k for k, b in enumerate(blocks) if 'p' in b and b['words'][:4] == key]
    assert len(hits) == 2, 'The supplied repeated passage needs review'
    a, b = hits
    end = next(s['block'] for s in canonical if s['node'] == 'Upon Completion of Talmud' and s['n'] == 13)
    words = lambda lo, hi: [w for v in blocks[lo:hi] for w in v.get('words', [])]
    assert difflib.SequenceMatcher(None, words(a, b), words(b, end), autojunk=False).ratio() > .98
    return set(range(b, end))


def write_parts(blocks, canonical, omit):
    supplements = {(s['node'], s['chapter'], s['paragraph']): s
                   for s in json.loads(SUPPLEMENTS.read_text())}
    assert set(supplements) == MISSING, 'All seven reviewed supplements are required'
    parts = collections.defaultdict(lambda: collections.defaultdict(list))
    known = [s for s in canonical if s['block'] is not None]
    used = set()
    for s in canonical:
        items = parts[s['node']][str(s['ch'] or 1)]
        if s['block'] is None:
            extra = supplements[(s['node'], s['ch'], s['n'])]
            assert extra['original'] == s['original'], f'Supplement source changed: {extra["ref"]}'
            items.append({'p': extra['pairs'], 'n': s['n'], 'transcriptionNotes': extra['transcriptionNotes']})
            continue
        k = known.index(s)
        start = s['block']
        while start > 0 and 'h' in blocks[start - 1]:
            start -= 1
        end = known[k + 1]['block'] if k + 1 < len(known) else len(blocks)
        while end > start and 'h' in blocks[end - 1]:
            end -= 1
        item = {'p': [], 'n': s['n']}
        for b in range(start, end):
            if b in omit:
                continue
            assert b not in used, f'Duplicate Word paragraph {blocks[b]["i"]}'
            used.add(b)
            block = blocks[b]
            if 'h' in block:
                if not item['p']:
                    items.append({'h': block['h']})
                else:
                    item['p'].append(['', '<b>' + html.escape(block['h']) + '</b>'])
                continue
            for he, en in block['p']:
                if not he and en and item['p'] and item['p'][-1][0] and not item['p'][-1][1]:
                    item['p'][-1][1] = en
                else:
                    item['p'].append([he, en])
        assert item['p'], f'Empty paragraph {s}'
        items.append(item)
    assert used == set(range(len(blocks))) - omit, 'Unimported Word paragraphs'
    out = ROOT / 'sources/akiva/parts'
    for node, chapters in parts.items():
        part = {'book': TITLE, 'node': node, 'versionTitle': 'Akiva Publishing interlinear edition',
                'license': '© Akiva Publishing', 'chapters': dict(chapters)}
        filename = re.sub(r'[^A-Za-z0-9]+', '_', TITLE + '_' + node) + '.json'
        (out / filename).write_text(json.dumps(part, ensure_ascii=False), encoding='utf-8')
        print(node, len(chapters), 'sections,', sum('p' in i for v in chapters.values() for i in v), 'paragraphs,', sum(len(i['p']) for v in chapters.values() for i in v if 'p' in i), 'phrase pairs')
    print('Completed all 7 missing source paragraphs with reviewed translations; imported the repeated final passage once.')


if __name__ == '__main__':
    blocks, tokens, owners = read_blocks()
    canonical = canonical_paragraphs(json.loads(ORIGINAL.read_text()))
    align(blocks, tokens, owners, canonical)
    write_parts(blocks, canonical, repeated_block(blocks, canonical))

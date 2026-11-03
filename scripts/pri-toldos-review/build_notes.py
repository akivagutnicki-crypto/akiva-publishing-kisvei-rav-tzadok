#!/usr/bin/env python3
"""Pri Tzaddik Toldos 1-10, reviewed footnotes (2026-11-03): reviewers' notes -> the reader's footnote objects.

Input:  sources/akiva/overlays/pri-toldos-review/osNN-notes.json   notes anchored to [paragraph n, phrase i] by exact Hebrew words
        sources/akiva/overlays/pri-toldos.json.gz.b64              the published Toldos text (phrase pairs), which does not change
Output: sources/akiva/overlays/pri-toldos-review/reader-notes.json {ref: {n: [footnote, ...]}} in the reader's format
        {number, phraseIndex, heCharOffset, heAnchorPrefix, heWord, nativeConnections, paragraphs:[{rich, text}]}
Numbers run in reading order within each os; a source note comes before the parallel notes on the same word.
"""
import json, gzip, base64, re, html, glob, os, unicodedata, sys

D = 'sources/akiva/overlays/pri-toldos-review'
PACK = 'sources/akiva/overlays/pri-toldos.json.gz.b64'
KIND = {'source': 0, 'parallels': 1, 'beyond': 2}

def plain(s): return html.unescape(re.sub(r'<[^>]+>', '', s or ''))
def bare(s): return re.sub(r'[֑-ׇ]', '', s)

def rich(md):
    runs, pos = [], 0
    for m in re.finditer(r'\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?://[^)]+)\)', md):
        if m.start() > pos: runs.append({'text': md[pos:m.start()]})
        if m.group(1) is not None: runs.append({'bold': True, 'text': m.group(1)})
        elif m.group(2) is not None: runs.append({'italic': True, 'text': m.group(2)})
        else: runs.append({'href': m.group(4), 'text': m.group(3)})
        pos = m.end()
    if pos < len(md): runs.append({'text': md[pos:]})
    runs = [r for r in runs if r['text']]
    return {'rich': runs, 'text': ''.join(r['text'] for r in runs)}

def locate(phrase, anchor):
    """offset just after the anchor words in the phrase; nikkud-insensitive fallback; None if absent"""
    a = (anchor or '').strip()
    if a and a in phrase: return phrase.index(a) + len(a)
    # compare without nikkud, mapping back to the phrase's own characters
    idx = [i for i, c in enumerate(phrase) if not ('֑' <= c <= 'ׇ')]
    pb, ab = ''.join(phrase[i] for i in idx), bare(a)
    if ab and ab in pb:
        end = pb.index(ab) + len(ab) - 1
        j = idx[end] + 1
        while j < len(phrase) and '֑' <= phrase[j] <= 'ׇ': j += 1
        return j
    return None

def main():
    pack = json.loads(gzip.decompress(base64.b64decode(open(PACK).read())))
    text = {s['chapter']: {it['n']: [plain(h) for h, _ in it['p']] for it in s['items'] if 'p' in it} for s in pack['sections']}
    out, problems = {}, []
    for f in sorted(glob.glob(os.path.join(D, 'os[0-9][0-9]-notes.json'))):
        d = json.load(open(f, encoding='utf-8')); k = int(d['os']); ref = f'Peri Tzadik, Toldot {k}'
        placed = []
        for x in d['notes']:
            n, i = int(x['n']), int(x['i'])
            phrases = text[k].get(n)
            if not phrases or i >= len(phrases): problems.append((k, n, i, 'no such phrase')); continue
            at = locate(phrases[i], x.get('anchor'))
            if at is None:                                   # anchor not in its phrase: the end of the phrase
                problems.append((k, n, i, 'anchor not found: ' + (x.get('anchor') or '')[:30])); at = len(phrases[i].rstrip())
            # the marker goes after the word, before closing punctuation only if the anchor ended mid-word
            while at < len(phrases[i]) and phrases[i][at] not in ' ־,.;:)"\'״׳”—-!?' and phrases[i][at - 1:at].strip(): at += 1
            placed.append((n, i, at, KIND.get(x.get('kind'), 0), x))
        placed.sort(key=lambda t: (t[0], t[1], t[2], t[3]))
        notes = {}
        for num, (n, i, at, _, x) in enumerate(placed, 1):
            prefix = text[k][n][i][:at]
            paras = [rich(p.strip()) for p in re.split(r'\n+', x['text']) if p.strip()]
            notes.setdefault(str(n), []).append({'number': num, 'phraseIndex': i, 'heCharOffset': at, 'heAnchorPrefix': prefix,
                                                 'heWord': len(prefix.split()), 'nativeConnections': [], 'paragraphs': paras})
        out[ref] = notes
        print(ref, 'notes', len(placed))
    json.dump(out, open(os.path.join(D, 'reader-notes.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    for p in problems: print('CHECK', p)
    return problems

if __name__ == '__main__':
    sys.exit(1 if main() and '--strict' in sys.argv else 0)

#!/usr/bin/env python3
"""Pri Tzaddik Chayei Sarah 1-11, reviewed edition (2026-11-02), as reader chapter files.

Input:  sources/akiva/overlays/pri-chayei-sara-review/chNN.md   Hebrew phrase [English] ... with ^n^ note markers,
        the numbered footnotes (sources, parallels in the library, parallels beyond the library) and the Mafteach check
Output: sources/akiva/overlays/pri-chayei-sara-review/reader/<id>.json  the reader's chapter format: headings {h},
        paragraphs {n, p: [[he, en], ...], keepPairs, footnotes: [{number, heCharOffset, heAnchorPrefix, heWord, paragraphs}]}
        sources/akiva/overlays/pri-chayei-sara-review/reader/meta.json  ref, id, title, paragraph count per maamar
A note is placed after the Hebrew word it was written on; a marker written after an English gloss belongs to the end
of that phrase's Hebrew. The Hebrew of every paragraph is checked to come through whole.
"""
import json, re, os, glob, html

D = 'sources/akiva/overlays/pri-chayei-sara-review'
IDS = {n: 165 + n for n in range(1, 12)}          # the reader's chapter files for Peri Tzadik, Chayei Sara 1-11
MARK = re.compile(r'\^(\d+(?:,\d+)*)\^')

def rich(md):
    """**bold**, *italic*, [text](url) -> the reader's rich runs"""
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

def paragraph(line):
    """'HEB [EN]^3^ HEB [EN] ...' -> pairs and note anchors (number -> (pair index, chars into that pair's Hebrew))"""
    line = re.sub(r'\s+', ' ', line)
    pairs, anchors, outside = [], {}, ''
    parts = re.split(r'(\[[^\]]*\])', line)
    pending = []                                   # markers in the Hebrew run before its gloss: (number, chars in)
    for part in parts:
        if part.startswith('[') and part.endswith(']'):
            he = outside.strip(); lead = len(outside) - len(outside.lstrip())
            pairs.append([he, part[1:-1].strip()])
            for num, at in pending: anchors.setdefault(num, (len(pairs) - 1, max(0, min(len(he), at - lead))))
            outside, pending = '', []
        else:
            text, k = '', 0
            for m in MARK.finditer(part):
                text += part[k:m.start()]; k = m.end()
                nums = [int(x) for x in m.group(1).split(',')]
                if not text.strip() and pairs and not outside.strip():      # right after a gloss: end of that phrase
                    for n in nums: anchors.setdefault(n, (len(pairs) - 1, len(pairs[-1][0])))
                else:
                    for n in nums: pending.append((n, len(outside) + len(text.rstrip())))
            outside += text + part[k:]
    if outside.strip():                            # Hebrew after the last gloss joins the last phrase
        if pairs:
            base = len(pairs[-1][0]) + 1
            lead = len(outside) - len(outside.lstrip())
            pairs[-1][0] = pairs[-1][0] + ' ' + outside.strip()
            for num, at in pending: anchors.setdefault(num, (len(pairs) - 1, base + max(0, at - lead)))
        else:
            pairs.append([outside.strip(), ''])
    return pairs, anchors

def build(path):
    s = open(path, encoding='utf-8').read()
    body, rest = s.split('### Footnotes', 1)
    notes_md = rest.split('\n### ', 1)[0]
    notes, cur = {}, None
    for line in notes_md.split('\n'):
        m = re.match(r'^(\d+)\. (.*)$', line)
        if m: cur = int(m.group(1)); notes[cur] = [m.group(2)]
        elif cur and line.strip(): notes[cur].append(line.strip())
    lines = body.split('\n')
    title = re.sub(r'^##\s*Maamar \d+\s*[—-]\s*', '', lines[0]).strip()
    items, n, used = [], 0, set()                # the title is the contents entry; the chapter starts with its first heading
    for line in lines[1:]:
        t = line.strip()
        if not t or (t.startswith('*') and not t.startswith('**') and t.endswith('*')): continue   # the opening words, as printed
        if t.startswith('**') and t.endswith('**'): items.append({'h': t.strip('*').strip()}); continue
        pairs, anchors = paragraph(t)
        n += 1
        he_join = ' '.join(p[0] for p in pairs)
        assert re.sub(r'\s', '', MARK.sub('', re.sub(r'\[[^\]]*\]', '', t))) == re.sub(r'\s', '', he_join), f'{path} paragraph {n}: Hebrew changed'
        fns = []
        for num, (i, at) in sorted(anchors.items()):
            if num not in notes or num in used: continue
            used.add(num)
            prefix = pairs[i][0][:at]                 # the reader anchors a note inside its phrase
            fns.append({'number': num, 'phraseIndex': i, 'heCharOffset': at, 'heAnchorPrefix': prefix, 'heWord': len(prefix.split()),
                        'nativeConnections': [], 'paragraphs': [rich(x) for x in notes[num]]})
        item = {'n': n, 'p': [[html.escape(h, quote=False), html.escape(e, quote=False)] for h, e in pairs], 'keepPairs': True}
        if fns: item['footnotes'] = sorted(fns, key=lambda f: (f['phraseIndex'], f['heCharOffset']))
        items.append(item)
    missing = sorted(set(notes) - used)
    return title, items, n, missing

if __name__ == '__main__':
    out = os.path.join(D, 'reader'); os.makedirs(out, exist_ok=True)
    meta = []
    for path in sorted(glob.glob(os.path.join(D, 'ch[0-9][0-9].md'))):
        k = int(path[-5:-3])
        title, items, paras, missing = build(path)
        assert not missing, f'maamar {k}: notes with no marker in the text: {missing}'
        json.dump(items, open(os.path.join(out, f'{IDS[k]}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        meta.append({'ref': f'Peri Tzadik, Chayei Sara {k}', 'id': IDS[k], 'title': title, 'paragraphs': paras,
                     'notes': sum(len(i.get('footnotes', [])) for i in items)})
        print(k, title[:60], 'paragraphs', paras, 'notes', meta[-1]['notes'])
    json.dump({'edition': 'pri-chayei-sara-review-20261102', 'maamarim': meta}, open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

"""English for HaMafteach HaShalem's index lines (topic volumes 1-2, 4, 5-6).

The Mafteach writes "-" for the heading word, so a line's English depends on its heading: the key of a line is
its Hebrew text, plus "|" and the heading's Hebrew when the line contains the dash.

  merge UNITS.json OUT_DIR     translations (TSV: id TAB English) -> sources/mafteach/captions-en.json
  panel                        add the English to the reader panel's data (dist/library/mafteach/*.json)
"""
import json, re, sys, glob, gzip
from pathlib import Path

DASH = re.compile(r'(^|\s)-(?=\s|$)')
CAPTIONS = Path('sources/mafteach/captions-en.json')


def key(text, head):
    t = (text or '').strip()
    return t + ('|' + (head or '') if DASH.search(t) else '')


if sys.argv[1] == 'merge':
    units = json.load(open(sys.argv[2], encoding='utf-8'))
    keys = sorted(units)
    out = {}
    for f in sorted(glob.glob(sys.argv[3] + '/batch*.tsv')):
        for line in open(f, encoding='utf-8'):
            p = line.rstrip('\n').split('\t')
            if len(p) == 2 and p[0].isdigit() and int(p[0]) < len(keys):
                en = re.sub(r'\s+', ' ', p[1]).strip()
                if en and not re.search(r'[א-ת]{3,}', en): out[keys[int(p[0])]] = en
    CAPTIONS.write_text(json.dumps(dict(sorted(out.items())), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(out)} of {len(keys)} lines in English; {CAPTIONS.stat().st_size / 1e6:.1f} MB')
elif sys.argv[1] == 'panel':
    en = json.loads(CAPTIONS.read_text(encoding='utf-8'))
    n = total = 0
    for f in sorted(Path('dist/library/mafteach').glob('*.json')):
        if f.name == 'index.json': continue
        d = json.loads(f.read_text(encoding='utf-8'))
        for e in d['passages'].values():
            for p in e.get('p', []):
                for why in p[2]:
                    if why and why[0] == 'line':
                        total += 1
                        x = en.get(key(why[1], why[2]))
                        while len(why) < 4: why.append('')
                        if len(why) > 4: del why[4:]
                        if x: why.append(x); n += 1
        f.write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'panel: {n} of {total} index lines now have English')

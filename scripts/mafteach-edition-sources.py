#!/usr/bin/env python3
"""Feed a published Akiva edition's verified footnotes back into HaMafteach HaShalem.
From the reader overlay of an edition, write:
  sources/mafteach/curated-sources/<name>.json    {passage: [[Sefaria ref, footnote label], ...]}  (every verified Sefaria link)
  sources/mafteach/curated-parallels/<name>.json  {passage: {library passage: why}}  (Rav Tzadok / Ishbitz–Radzin passages its notes name)
Usage: mafteach-edition-sources.py OVERLAY_DIR NAME"""
import json, sys, re, os, urllib.parse
ov, name = sys.argv[1:3]
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sources', 'mafteach')
valid = set(l.strip() for l in open(f'{REPO}/library-refs.txt', encoding='utf-8') if l.strip())
m = json.load(open(os.path.join(ov, 'manifest.json')))
sources, parallels = {}, {}
def section_of(ref):
    ref = re.sub(r':\d+(?:-\d+)?$', '', ref)
    return ref if ref in valid else None
for s in m['sections']:
    srcs, pars = [], {}
    for it in json.load(open(os.path.join(ov, f"{s['id']}.json"))):
        for n in it.get('footnotes', []):
            for p in n['paragraphs']:
                href = next((r['href'] for r in p['rich'] if r.get('href')), None)
                label = next((r['text'] for r in p['rich'] if r.get('href')), '').strip().rstrip(':—– ')
                if not href: continue
                if href.startswith('https://www.sefaria.org/'):
                    ref = urllib.parse.unquote(href.split('sefaria.org/', 1)[1]).replace('_', ' ')
                    ref = re.sub(r'(?<=\d)\.(?=\d)', ':', re.sub(r'(?<=[a-z])\.(?=\d)', ' ', ref))
                    if [ref, label] not in srcs: srcs.append([ref, label])
                    target = section_of(ref) if ref.startswith(('Peri Tzadik', 'Tzidkat', 'Resisei', 'Takanat', 'Divrei', 'Kometz', 'Mei HaShiloach', 'Beit Yaakov', 'Sod Yesharim', 'Tiferet Yosef')) else None
                elif '#/read/' in href:
                    target = section_of(urllib.parse.unquote(href.split('#/read/', 1)[1]).replace('_', ' '))
                else: target = None
                if target and target != s['ref']: pars[target] = 'named in the notes of the Akiva Publishing Sefer Bereishis edition'
    if srcs: sources[s['ref']] = srcs
    if pars: parallels[s['ref']] = pars
os.makedirs(f'{REPO}/curated-sources', exist_ok=True)
json.dump(sources, open(f'{REPO}/curated-sources/{name}.json', 'w'), ensure_ascii=False, indent=1)
json.dump(parallels, open(f'{REPO}/curated-parallels/{name}.json', 'w'), ensure_ascii=False, indent=1)
missing = [s['ref'] for s in m['sections'] if s['ref'] not in valid]
print('passages', len(m['sections']), 'with sources', len(sources), 'source links', sum(len(v) for v in sources.values()),
      'with parallels', len(parallels), 'parallel pairs', sum(len(v) for v in parallels.values()), 'not in library-refs', missing)

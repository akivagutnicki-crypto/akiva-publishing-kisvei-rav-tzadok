#!/usr/bin/env python3
"""Merge the per-batch verification results into one map and an evidence file.

out/verify/result_seg*.json / result_sec*.json  -> Sefaria records keyed by input ref
out/verify/result_lib*.json                      -> library records keyed by input ref
Writes out/verify/merged.json  {"sefaria": {...}, "library": {...}, "stats": {...}, "unresolved": [...]}
"""
import glob
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sefaria_refs import ZoharDafResolver, normalize_ref, sefaria_url  # noqa: E402

VER = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('out/verify')
zohar = ZoharDafResolver(VER.parent / 'zohar_alt_structs.json')

sef, lib = {}, {}
for f in sorted(glob.glob(str(VER / 'result_seg*.json'))) + sorted(glob.glob(str(VER / 'result_sec*.json'))):
    try:
        rows = json.load(open(f, encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        print('bad file', f, e)
        continue
    for r in rows:
        if not isinstance(r, dict) or 'input' not in r:
            continue
        sef[r['input']] = r
for f in sorted(glob.glob(str(VER / 'result_lib*.json'))):
    try:
        rows = json.load(open(f, encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        print('bad file', f, e)
        continue
    for r in rows:
        if isinstance(r, dict) and 'input' in r:
            lib[r['input']] = r

# Second-pass resolution for Zohar daf citations and simple name fixes.
zohar_fixed = 0
for inp, r in sef.items():
    if r.get('ok'):
        continue
    z = zohar.resolve(inp)
    if z and z.get('ok'):
        # prefer the sub-work named in the citation (Ra'aya Mehemna, Tosefta, Midrash HaNe'elam, Sitrei Torah)
        pick = z['all'][0]
        low = inp.lower()
        for cand in z['all']:
            p = (cand.get('parashah') or '').lower()
            if ('mehemna' in low and 'mehemna' in p) or ('tosefta' in low and 'tosefta' in p) or ("ne'elam" in low and "ne'elam" in p) or ('sitrei' in low and 'sitrei' in p):
                pick = cand
        r.update(ok=True, ref=pick['ref'], url=sefaria_url(pick['ref']).replace('https://www.sefaria.org/', ''), resolvedRef=pick['ref'],
                 resolution='zohar-daf-structure', zoharParashah=pick['parashah'], error=None)
        zohar_fixed += 1

unresolved = sorted(k for k, r in sef.items() if not r.get('ok'))
lib_unresolved = sorted(k for k, r in lib.items() if not r.get('ok'))
stats = {'sefariaRecords': len(sef), 'sefariaOk': sum(1 for r in sef.values() if r.get('ok')), 'sefariaUnresolved': len(unresolved),
         'resolvedAfterRetry': sum(1 for r in sef.values() if r.get('resolvedRef')), 'zoharDafResolved': zohar_fixed,
         'libraryRecords': len(lib), 'libraryOk': sum(1 for r in lib.values() if r.get('ok')), 'libraryUnresolved': len(lib_unresolved),
         'libraryQuoteMatchFalse': sum(1 for r in lib.values() if r.get('quoteMatch') is False)}
json.dump({'sefaria': sef, 'library': lib, 'stats': stats, 'unresolved': unresolved, 'libraryUnresolved': lib_unresolved},
          open(VER / 'merged.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(json.dumps(stats, indent=1))
print('unresolved sample:', unresolved[:25])
print('library unresolved sample:', lib_unresolved[:15])

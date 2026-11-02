"""Download the published library index (the same /mcp-data the live reader and the Kisvei MCP serve).

A plain local `build-library.mjs && build-mcp-index.mjs` misses the books and sections that the
publishing workflows add over the Pages artifact (most of Mei HaShiloach, later Peri Tzadik and
Beit Yaakov sections), so the engine should read the published copy.
"""
import json
import os
import sys
import time
import urllib.request

SITE = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok'


def _get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'kisvei-engine'}), timeout=120) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 1))


def fetch(out_dir, site=SITE):
    """Fetch catalog.json, cited.json and text/<slug>.json into out_dir; verify every book is complete."""
    base = site.rstrip('/') + '/mcp-data/'
    os.makedirs(os.path.join(out_dir, 'text'), exist_ok=True)
    catalog_raw = _get(base + 'catalog.json')
    catalog = json.loads(catalog_raw)
    open(os.path.join(out_dir, 'catalog.json'), 'wb').write(catalog_raw)
    open(os.path.join(out_dir, 'cited.json'), 'wb').write(_get(base + 'cited.json'))
    report, problems = [], []
    for b in catalog['books']:
        raw = _get(f"{base}text/{b['slug']}.json")
        paras = json.loads(raw).get('paras', [])
        open(os.path.join(out_dir, 'text', b['slug'] + '.json'), 'wb').write(raw)
        expected = b.get('paragraphs')
        report.append({'book': b['title'], 'slug': b['slug'], 'sections': len(b.get('sections', [])),
                       'paragraphs': len(paras), 'catalogParagraphs': expected})
        if expected is not None and expected != len(paras):
            problems.append(f"{b['title']}: catalog lists {expected} paragraphs, text file has {len(paras)}")
    summary = {'site': site, 'catalogBuilt': catalog.get('built'), 'books': len(report),
               'paragraphs': sum(r['paragraphs'] for r in report), 'perBook': report, 'problems': problems}
    json.dump(summary, open(os.path.join(out_dir, 'coverage.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return summary


if __name__ == '__main__':
    s = fetch(sys.argv[1] if len(sys.argv) > 1 else 'data/live')
    print(json.dumps({k: v for k, v in s.items() if k != 'perBook'}, indent=1))

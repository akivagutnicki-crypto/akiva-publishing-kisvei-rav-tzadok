#!/usr/bin/env python3
"""Build the Chassidus / Kabbalah / Jewish Thought / Musar corpus for the machine-learned parallels.

Downloads Sefaria's public export (Hebrew versions) for the four categories, leaves out R. Tzadok's and the
Izhbitz-Radzin works (already in the library), and splits every book into teaching-sized passages with Sefaria refs.
Output: genre-corpus.jsonl.gz  {ref, title, he_title, genre, sub, license, version, he}  (he = Hebrew letters only)
        genre-corpus-manifest.json
"""
import json, gzip, re, sys, time, collections, concurrent.futures as cf
import requests

BOOKS = 'https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json'
GENRES = {'Chasidut': 'Chassidus', 'Kabbalah': 'Kabbalah', 'Jewish Thought': 'Machshava', 'Musar': 'Mussar'}
SKIP = re.compile(r"(Tzadok|Tzadik|Tzaddik|Izhbitz|Izbica|Ishbitz|Radzin|Mei HaShiloach|Beit Yaakov|Beis Yaakov|Sod Yesharim|Tiferet Yosef|"
                  r"Resisei|Machshavot Charutz|Takanat HaShavin|Divrei Soferim|Kometz HaMinchah|Likkutei Maamarim|Yisrael Kedoshim|"
                  r"Sichat Malakhei|Dover Tzedek|Ohr Zarua LaTzadik|Poked Akarim|Et HaOchel|Divrei Chalomot|Sefer HaZikhronot|Meshiv|"
                  r"Sha'ar HaEmunah|Shaar HaEmunah)", re.I)
TARGET, MAXW = 450, 900

def he_only(s):
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'[֑-ׇ]', '', s)
    s = re.sub(r'[׳״\'"`]', '', s)
    s = re.sub(r'[^א-ת]+', ' ', s)
    return ' '.join(s.split())

def leaves(node, path=()):
    """yield (path of node names, address tuple 1-based, text) for every string in a Sefaria text structure"""
    if isinstance(node, str):
        yield path, (), node
    elif isinstance(node, list):
        for i, x in enumerate(node, 1):
            for p, a, t in leaves(x, path): yield p, (i,) + a, t
    elif isinstance(node, dict):
        for k, v in node.items():
            for p, a, t in leaves(v, path + ((k,) if k else ())): yield p, a, t

def ref_of(title, path, addr):
    base = title + (', ' + ', '.join(path) if path else '')
    return base + (' ' + ':'.join(map(str, addr)) if addr else '')

def units_of(book, data):
    text = data.get('text') or data.get('versions', [{}])[0].get('text')
    groups = collections.OrderedDict()           # parent ref -> [(addr, he)]
    for path, addr, t in leaves(text):
        he = he_only(t)
        if not he: continue
        parent = (path, addr[:-1])
        groups.setdefault(parent, []).append((addr, he))
    for (path, paddr), items in groups.items():
        words = sum(len(h.split()) for _, h in items)
        if words <= MAXW:
            yield ref_of(book['title'], path, paddr) if paddr or path else ref_of(book['title'], path, items[0][0][:1]), ' '.join(h for _, h in items)
            continue
        chunk, cw = [], 0
        for addr, he in items:
            chunk.append((addr, he)); cw += len(he.split())
            if cw >= TARGET:
                a, b = chunk[0][0], chunk[-1][0]
                rng = ':'.join(map(str, a)) + (f'-{b[-1]}' if b != a else '')
                yield ref_of(book['title'], path, ()) + ' ' + rng, ' '.join(h for _, h in chunk)
                chunk, cw = [], 0
        if chunk:
            a, b = chunk[0][0], chunk[-1][0]
            rng = ':'.join(map(str, a)) + (f'-{b[-1]}' if b != a else '')
            yield ref_of(book['title'], path, ()) + ' ' + rng, ' '.join(h for _, h in chunk)

def fetch(url, tries=5):
    for k in range(tries):
        try:
            r = requests.get(url, timeout=120)
            if r.status_code == 200: return r.json()
        except Exception: pass
        time.sleep(2 * (k + 1))
    return None

def main(out):
    books = requests.get(BOOKS, timeout=120).json()['books']
    chosen = {}
    for b in books:
        cats = b.get('categories') or []
        if b.get('language') != 'Hebrew' or not cats or cats[0] not in GENRES: continue
        if SKIP.search(b['title']) or any(SKIP.search(c) for c in cats): continue
        chosen.setdefault(b['title'], b)          # first Hebrew version listed for each title
    print('books', len(chosen), collections.Counter(GENRES[b['categories'][0]] for b in chosen.values()), flush=True)
    manifest, n_units, n_words = [], 0, 0
    with gzip.open(out, 'wt', encoding='utf-8') as f, cf.ThreadPoolExecutor(16) as ex:
        futs = {ex.submit(fetch, b['json_url']): b for b in chosen.values()}
        for fu in cf.as_completed(futs):
            b = futs[fu]; data = fu.result()
            if not data:
                manifest.append(dict(title=b['title'], error='download failed')); continue
            k = w = 0
            for ref, he in units_of(b, data):
                if len(he.split()) < 20: continue
                f.write(json.dumps(dict(ref=ref, title=b['title'], he_title=data.get('heTitle'), genre=GENRES[b['categories'][0]],
                                        sub=' / '.join(b['categories'][1:3]), version=b.get('versionTitle'),
                                        license=data.get('license'), he=he), ensure_ascii=False) + '\n')
                k += 1; w += len(he.split())
            manifest.append(dict(title=b['title'], genre=GENRES[b['categories'][0]], categories=b['categories'], version=b.get('versionTitle'),
                                 license=data.get('license'), units=k, words=w))
            n_units += k; n_words += w
    json.dump(dict(source='Sefaria public export (books.json)', generated=time.strftime('%Y-%m-%d'), books=len(manifest),
                   units=n_units, words=n_words, items=sorted(manifest, key=lambda x: (x.get('genre', ''), x['title']))),
              open(out.replace('.jsonl.gz', '-manifest.json').replace('genre-corpus-manifest', 'genre-corpus-manifest'), 'w'), ensure_ascii=False, indent=1)
    print('units', n_units, 'words', n_words, flush=True)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'genre-corpus.jsonl.gz')

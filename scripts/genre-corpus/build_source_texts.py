#!/usr/bin/env python3
"""Hebrew texts of the sources HaMafteach HaShalem indexes, one record per addressable segment, to check (and correct)
the index's addresses against the texts themselves.

Output: source-texts.jsonl.gz  {book, cat, addr, ref, he}   he = Hebrew letters only, one space between words
  Tanakh: addr "chapter:verse"; Mishnah / Yerushalmi / Midrash: the export's numbering joined by ":";
  Bavli: addr "<daf><a|b>:<segment>", e.g. "35b:2".
"""
import json, gzip, re, sys, time, collections, concurrent.futures as cf
import requests

BOOKS = 'https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json'
WANT_CATS = ('Tanakh', 'Mishnah', 'Talmud', 'Midrash', 'Tosefta')
WANT_TITLES = re.compile(r"^(Tikkunei Zohar|Zohar Chadash)$")
SKIP = re.compile(r"(Commentary|Rishonim|Acharonim|Modern|Targum|Quoting|Rashi|Tosafot|Steinsaltz|Ein Yaakov|Introductions|Halakhah|English)", re.I)

def he_only(s):
    s = re.sub(r'<[^>]+>', ' ', s); s = re.sub(r'[֑-ׇ]', '', s); s = re.sub(r'[׳״\'"`]', '', s)
    return ' '.join(re.sub(r'[^א-ת]+', ' ', s).split())

def leaves(node, path=()):
    if isinstance(node, str): yield path, (), node
    elif isinstance(node, list):
        for i, x in enumerate(node, 1):
            for p, a, t in leaves(x, path): yield p, (i,) + a, t
    elif isinstance(node, dict):
        for k, v in node.items():
            for p, a, t in leaves(v, path + ((k,) if k else ())): yield p, a, t

BAD_VERSION = re.compile(r"(Mevoar|Modern Hebrew|Maoz|Farsi|Judeo|\\[[a-z]{2,3}\\]|trans\\.|translated|Aramaic into Hebrew|Commentar|Lekach|Sechel|temp)", re.I)
GOOD_VERSION = ('Miqra according to the Masorah', 'Tanach with Text Only', 'William Davidson Edition - Hebrew', 'Talmud Bavli, Vilna 1883 ed.',
                'Wikisource Talmud Bavli', 'merged', 'Midrash Rabbah -- TE', 'Midrash Tanchuma -- Torat Emet')
def rank(b):
    """lower is better: the masoretic Tanakh and the standard printings over paraphrases and translations"""
    if b is None: return 99
    v = b.get('versionTitle') or ''
    if BAD_VERSION.search(v): return 50
    return GOOD_VERSION.index(v) if v in GOOD_VERSION else 20

def fetch(url, tries=5):
    for k in range(tries):
        try:
            r = requests.get(url, timeout=180)
            if r.status_code == 200: return r.json()
        except Exception: pass
        time.sleep(2 * (k + 1))
    return None

def main(out):
    books = requests.get(BOOKS, timeout=120).json()['books']
    chosen = {}
    for b in books:
        cats = b.get('categories') or []
        if b.get('language') != 'Hebrew' or not cats: continue
        ok = (cats[0] in WANT_CATS and not any(SKIP.search(c) for c in cats)) or WANT_TITLES.match(b['title'])
        if cats[0] == 'Talmud' and not (len(cats) > 1 and cats[1] in ('Bavli', 'Yerushalmi')): ok = False
        if ok and rank(b) < rank(chosen.get(b['title'])): chosen[b['title']] = b
    print('books', len(chosen), collections.Counter(b['categories'][0] for b in chosen.values()), flush=True)
    n = 0; manifest = []
    with gzip.open(out, 'wt', encoding='utf-8') as f, cf.ThreadPoolExecutor(16) as ex:
        futs = {ex.submit(fetch, b['json_url']): b for b in chosen.values()}
        for fu in cf.as_completed(futs):
            b = futs[fu]; data = fu.result()
            if not data: manifest.append(dict(title=b['title'], error='download failed')); continue
            text = data.get('text') or data.get('versions', [{}])[0].get('text')
            bavli = b['categories'][:2] == ['Talmud', 'Bavli']
            k = 0
            for path, addr, t in leaves(text):
                he = he_only(t)
                if not he: continue
                if bavli and len(addr) == 2:
                    z = addr[0] - 1; a = f"{z // 2 + 1}{'ab'[z % 2]}:{addr[1]}"
                else:
                    a = ':'.join(map(str, addr))
                base = b['title'] + (', ' + ', '.join(path) if path else '')
                f.write(json.dumps(dict(book=b['title'], cat='/'.join(b['categories'][:2]), path=', '.join(path), addr=a, ref=f'{base} {a}', he=he), ensure_ascii=False) + '\n')
                k += 1
            manifest.append(dict(title=b['title'], cat=b['categories'][:3], version=b.get('versionTitle'), license=data.get('license'), segments=k))
            n += k
    json.dump(dict(source='Sefaria public export (books.json)', generated=time.strftime('%Y-%m-%d'), books=len(manifest), segments=n,
                   items=sorted(manifest, key=lambda x: x['title'])), open('source-texts-manifest.json', 'w'), ensure_ascii=False, indent=1)
    print('segments', n, flush=True)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'source-texts.jsonl.gz')

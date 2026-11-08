#!/usr/bin/env python3
"""One-off probe run on GitHub Actions (Sefaria and the Pages artifact are reachable there):
1. resolve every footnote label through Sefaria's name API and check every existing Sefaria link through the texts API;
2. summarize the current published Pri Tzaddik reader structure (toc, catalog, MCP sections, ZIP index)."""
import json, sys, os, re, urllib.request, urllib.parse, concurrent.futures as cf, time, tarfile, pathlib
OUT = pathlib.Path('probe/out'); OUT.mkdir(parents=True, exist_ok=True)
UA = {'User-Agent': 'AkivaPublishing-link-check/1.0'}
def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return {'error': '404'}
            time.sleep(2 + 3 * k)
        except Exception as e: time.sleep(2 + 3 * k)
    return {'error': 'unreachable'}
def strip_prefix(l):
    return re.sub(r'^(Parallels?( beyond the library)?|Connection|See also|Compare|Cf\.)\s*[:—-]\s*', '', l).strip()
def name(label):
    q = strip_prefix(label)
    q = re.sub(r'\s*\((?:[^()]*)\)\s*$', '', q).rstrip('.;, ')
    j = get('https://www.sefaria.org/api/name/' + urllib.parse.quote(q) + '?limit=0')
    return label, {'q': q, 'is_ref': j.get('is_ref'), 'ref': j.get('ref'), 'url': j.get('url'), 'book': j.get('book'), 'error': j.get('error')}
def texts(url):
    path = urllib.parse.unquote(url.split('sefaria.org/', 1)[1].split('?')[0])
    ref = path.replace('_', ' ')
    j = get('https://www.sefaria.org/api/v3/texts/' + urllib.parse.quote(ref) + '?return_format=text_only')
    vs = j.get('versions') or []
    has = any((v.get('text') not in (None, '', [], [[]])) for v in vs)
    return url, {'ref': ref, 'normalized': j.get('ref'), 'ok': bool(has) and not j.get('error'), 'error': j.get('error'),
                 'warnings': j.get('warnings')}
mode = sys.argv[1]
if mode == 'links':
    d = json.load(open('probe/links-in.json'))
    with cf.ThreadPoolExecutor(12) as ex: names = dict(ex.map(name, d['labels']))
    json.dump(names, open(OUT / 'names.json', 'w'), ensure_ascii=False)
    with cf.ThreadPoolExecutor(12) as ex: checks = dict(ex.map(texts, d['urls']))
    json.dump(checks, open(OUT / 'urls.json', 'w'), ensure_ascii=False)
    # every candidate ref that the name API proposes, checked for real text too
    cands = sorted({'https://www.sefaria.org/' + v['url'] for v in names.values() if v.get('is_ref') and v.get('url')} - set(d['urls']))
    with cf.ThreadPoolExecutor(12) as ex: c2 = dict(ex.map(texts, cands))
    json.dump(c2, open(OUT / 'candidates.json', 'w'), ensure_ascii=False)
    print('labels', len(names), 'resolved', sum(1 for v in names.values() if v.get('is_ref')), 'urls ok', sum(v['ok'] for v in checks.values()), '/', len(checks),
          'candidates ok', sum(v['ok'] for v in c2.values()), '/', len(c2))
elif mode == 'site':
    root = pathlib.Path(sys.argv[2])
    lib = root / 'library'; pt = lib / 'data/peri-tzadik'
    toc = json.load(open(pt / 'toc.json'))
    def walk(n, path, rows):
        kids = n.get('children')
        row = {k: v for k, v in n.items() if k != 'children'}; row['path'] = path; row['kids'] = len(kids or [])
        rows.append(row)
        for c in kids or []: walk(c, path + [str(n.get('en'))], rows)
    rows = []; walk(toc['toc'], [], rows)
    json.dump(rows, open(OUT / 'toc-rows.json', 'w'), ensure_ascii=False)
    json.dump({k: v for k, v in toc.items() if k != 'toc'}, open(OUT / 'toc-meta.json', 'w'), ensure_ascii=False)
    cat = json.load(open(lib / 'data/catalog.json')); json.dump(next(b for b in cat if b['slug'] == 'peri-tzadik'), open(OUT / 'catalog-entry.json', 'w'), ensure_ascii=False)
    mc = json.load(open(root / 'mcp-data/catalog.json')); mb = next(b for b in mc['books'] if b['slug'] == 'peri-tzadik')
    json.dump({k: v for k, v in mb.items() if k != 'sections'} | {'sections': mb['sections']}, open(OUT / 'mcp-book.json', 'w'), ensure_ascii=False)
    json.dump(json.load(open(lib / 'downloads/index.json')), open(OUT / 'downloads-index.json', 'w'), ensure_ascii=False)
    files = sorted(p.relative_to(root).as_posix() for p in lib.rglob('*') if p.is_file() and ('peri-tzadik' in p.as_posix() or 'downloads' in p.as_posix()))
    json.dump(files, open(OUT / 'files.json', 'w'))
    # a sample of the current study-edition chapters for Bereishis–Vayechi
    import shutil
    for r in rows:
        if r.get('id') is not None and re.search(r'Bereshit|Noach|Lech|Vayera|Chayei|Toldot|Vayetzei|Vayishlach|Vayeshev|Miketz|Vayigash|Vayechi', str(r.get('ref', ''))):
            src = pt / f"{r['id']}.json"
            if src.exists() and len(list((OUT / 'chapters').glob('*'))) < 400 if (OUT / 'chapters').exists() else True:
                (OUT / 'chapters').mkdir(exist_ok=True); shutil.copy(src, OUT / 'chapters' / src.name)
    idx = (lib / 'index.html').read_text()
    hits = [m.start() for m in re.finditer(r'shemosDocxEdition|reviewedEdition|downloadDocx|editionDataUrl|safeFootnoteUrl', idx)]
    (OUT / 'index-snippets.txt').write_text('\n----\n'.join(idx[max(0, h - 300):h + 500] for h in hits[:30]))
    print('toc rows', len(rows), 'files', len(files))

if mode == 'links2':
    d = json.load(open('probe/links2-in.json'))
    def check_ref(ref):
        j = None
        for k in range(6):
            try:
                with urllib.request.urlopen(urllib.request.Request('https://www.sefaria.org/api/v3/texts/' + urllib.parse.quote(ref) + '?return_format=text_only', headers=UA), timeout=40) as r:
                    j = json.load(r); break
            except urllib.error.HTTPError as e:
                if e.code in (400, 404): j = {'error': str(e.code)}; break
                time.sleep(3 * (k + 1))
            except Exception: time.sleep(3 * (k + 1))
        if j is None: return {'ok': False, 'error': 'unreachable'}
        vs = j.get('versions') or []
        has = any(v.get('text') not in (None, '', [], [[]]) for v in vs)
        return {'ok': bool(has) and not j.get('error'), 'normalized': j.get('ref'), 'error': j.get('error')}
    def label(item):
        lab, vs = item; tried = []
        for v in vs:
            r = check_ref(v); tried.append([v, r.get('normalized'), r['ok'], r.get('error')])
            if r['ok']: return lab, {'ref': r['normalized'], 'query': v, 'tried': tried}
        return lab, {'ref': None, 'tried': tried}
    def url(u):
        path = urllib.parse.unquote(u.split('sefaria.org/', 1)[1].split('?')[0]); ref = path.replace('_', ' ')
        return u, check_ref(ref) | {'ref': ref}
    with cf.ThreadPoolExecutor(5) as ex: labs = dict(ex.map(label, d['variants'].items()))
    with cf.ThreadPoolExecutor(5) as ex: us = dict(ex.map(url, d['urls']))
    json.dump(labs, open(OUT / 'labels2.json', 'w'), ensure_ascii=False); json.dump(us, open(OUT / 'urls2.json', 'w'), ensure_ascii=False)
    print('labels resolved', sum(1 for v in labs.values() if v['ref']), '/', len(labs), 'urls ok', sum(v['ok'] for v in us.values()), '/', len(us),
          'unreachable', sum(1 for v in list(labs.values()) for t in v['tried'] if t[3] == 'unreachable') + sum(v.get('error') == 'unreachable' for v in us.values()))

if mode == 'content':
    d = json.load(open('probe/content-in.json'))
    STOP = set('that this with from have they their there which what when your will shall unto said were been into upon them then than also only even more most such like each other some just about after before because where whom whose those these being does doth hath thou thee thy ye our ours out not but and the for are was his her him she you all one who how why may can its it is in of to a an on as at by or be he we i my me us so no do if'.split())
    words = lambda s: {w for w in re.findall(r"[a-z]{4,}", (s or '').lower()) if w not in STOP}
    def flat(t):
        if isinstance(t, list): return ' '.join(flat(x) for x in t)
        return re.sub('<[^>]+>', ' ', t or '')
    cache = {}
    def eng(ref):
        for k in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request('https://www.sefaria.org/api/v3/texts/' + urllib.parse.quote(ref) + '?version=english&return_format=text_only', headers=UA), timeout=40) as r:
                    j = json.load(r); return ref, ' '.join(flat(v.get('text')) for v in j.get('versions') or [])
            except urllib.error.HTTPError as e:
                if e.code in (400, 404): return ref, ''
                time.sleep(3 * (k + 1))
            except Exception: time.sleep(3 * (k + 1))
        return ref, None
    refs = sorted({i['ref'] for i in d})
    with cf.ThreadPoolExecutor(5) as ex: texts = dict(ex.map(eng, refs))
    out = {}
    for i in d:
        q = words(i['quote']); t = texts.get(i['ref'])
        out[i['k']] = {'ref': i['ref'], 'score': (round(len(q & words(t)) / len(q), 3) if q and t else None), 'hasEnglish': bool(t), 'qwords': len(q)}
    json.dump(out, open(OUT / 'content.json', 'w'))
    sc = [v['score'] for v in out.values() if v['score'] is not None]
    print('items', len(out), 'scored', len(sc), 'low (<0.3)', sum(s < 0.3 for s in sc), 'no English', sum(1 for v in out.values() if not v['hasEnglish']))

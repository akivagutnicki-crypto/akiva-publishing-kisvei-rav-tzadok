#!/usr/bin/env python3
"""Edition notes release (November 2026): the verified source notes of the Word editions, added to fifteen books
already in the reader, and the Resisei Layla note cleanup. Works over the exact current Pages artifact
(restored by scripts/new-books-release.py metadata/capture, as the Meshiv anchor release does); only these books'
chapter files, their connections, the cited-source index, the parallels, the MCP text/search of these books, the
offline manifest/ZIPs and the cache markers change. Every other published file is preserved byte for byte.

  release.py apply SITE    add the notes, clean Resisei Layla, record connections, rebuild MCP/parallels/ZIPs
  release.py seal SITE     preservation check against new-books-baseline.json; writes the release report
  release.py live          the changed reader files are publicly live with the released bytes
"""
import hashlib, json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import apply_notes, clean_resisei  # noqa: E402

RELEASE = '20261126-edition-notes-' + (os.environ.get('GITHUB_SHA') or 'local')[:8]   # each run its own cache marker
PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
PACKS = ROOT / 'sources/akiva/edition-supplements'
PARALLELS = ROOT / 'sources/akiva/rt-parallels'      # Rav Tzadok and the Izhbitz teachings (ושמעתי / ואין מקום להאריך)
REPORT = Path('edition-notes-release-report.json')
LINKS = Path('edition-notes-links.json')
EDITION_SLUGS = sorted(p.stem for p in PACKS.glob('*.json'))
SLUGS = sorted(set(EDITION_SLUGS) | {p.stem for p in PARALLELS.glob('*.json')})
rd = lambda p: json.loads(Path(p).read_text())
wr = lambda p, v: Path(p).write_text(json.dumps(v, ensure_ascii=False, separators=(',', ':')))
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
run = lambda *a, **k: subprocess.run(list(a), check=True, cwd=ROOT, **k)


def repair_wording(data):
    """Tanach/Mishnah/Rambam quotations in every note of these books, restored to their source wording (text_repair)."""
    import text_repair
    counts = {}
    for slug in EDITION_SLUGS:
        d = data / slug; n = 0
        for f in apply_notes.files_in_order(str(d)):
            items = rd(d / f); changed = False
            for it in items:
                if not isinstance(it, dict): continue
                for x in it.get('footnotes') or []:
                    for p in x.get('paragraphs') or []:
                        t, k = text_repair.fix(p.get('text', ''))
                        if k: p['text'] = t; n += 1; changed = True
                        for r in p.get('rich') or []:
                            if r.get('text'):
                                t2, k2 = text_repair.fix(r['text'])
                                if k2: r['text'] = t2; changed = True
                for ph in it.get('p') or []:
                    if isinstance(ph, list) and 'footnote-marker' in ph[0]:
                        bodies = apply_notes.note_bodies(ph[0]); new = ph[0]
                        for b in bodies:
                            fixed, k = text_repair.fix_html(b)
                            if k: new = new.replace(b, fixed, 1); n += 1
                        if new != ph[0]: ph[0] = new; changed = True
            if changed: wr(d / f, items)
        counts[slug] = n
    return counts


WORD = ROOT / 'sources/akiva/word-editions'


def word_downloads(site):
    m = rd(WORD / 'manifest.json'); lib = site / 'library'; catalog = rd(lib / 'data/catalog.json')
    gone = {'downloads/' + f for f in m['remove']}
    for f in m['remove']:
        if (lib / 'downloads' / f).exists(): (lib / 'downloads' / f).unlink()
    by = {b['slug']: b for b in catalog}
    for b in catalog:
        if b.get('downloads'): b['downloads'] = [d for d in b['downloads'] if d['file'] not in gone]
    for x in m['files']:
        src = WORD / x['file']; assert src.stat().st_size < 10_000_000, x['file']
        shutil.copyfile(src, lib / 'downloads' / x['file'])
        book = by[x['slug']]; file = 'downloads/' + x['file']
        book['downloads'] = [d for d in book.get('downloads') or [] if d['file'] != file] + [{'file': file, 'label': x['label']}]
    wr(lib / 'data/catalog.json', catalog)
    return {'added': len(m['files']), 'removed': sorted(gone)}


def apply(site):
    site = Path(site).resolve(); data = site / 'library/data'
    missing = [s for s in SLUGS if not (data / s / 'toc.json').is_file()]
    assert not missing, 'Books missing from the live site: ' + str(missing)
    # 0. the Word editions replace the text and notes of the sections they cover (the editor's instruction, 2026-11-27)
    import word_replace
    replaced = word_replace.main(str(data))
    skip = frozenset(r for v in replaced.values() if isinstance(v, dict) for r in v.get('replacedRefs', []))
    # 1. notes (deduplicated against every note the reader already has), then the Resisei Layla cleanup and numbering
    report = apply_notes.main(str(data), packdir=str(PACKS), skip_refs=skip)
    second = apply_notes.main(str(data), packdir=str(PARALLELS), skip_refs=skip)
    # every note must sit on a phrase with Hebrew: the reader anchors its marker to a Hebrew letter and refuses a section otherwise
    empty = []
    for slug in SLUGS:
        for f in apply_notes.files_in_order(str(data / slug)) if (data / slug).is_dir() else []:
            for it in rd(data / slug / f):
                if not isinstance(it, dict) or not it.get('p'): continue
                for x in it.get('footnotes') or []:
                    i = x.get('phraseIndex', 0); ph = it['p'][i] if 0 <= i < len(it['p']) else ''
                    if not apply_notes.plain(apply_notes.strip_notes(ph[0] if isinstance(ph, list) else ph)).strip(): empty.append((slug, f, x.get('sourceId')))
    assert not empty, f'{len(empty)} notes on phrases without Hebrew, e.g. {empty[:5]}'
    links = {k: v['links'] for k, v in report.items() if isinstance(v, dict)}
    for k, v in replaced.items():
        if isinstance(v, dict): links.setdefault(k, []).extend(v['links'])
    for k, v in second.items():
        if isinstance(v, dict): links.setdefault(k, []).extend(v['links'])
    wr(LINKS, links)
    stats = {k: {x: y for x, y in v.items() if x != 'links'} for k, v in report.items()}
    stats['izhbitz-parallels'] = {k: {x: y for x, y in v.items() if x != 'links'} for k, v in second.items()}
    stats['word-editions-replaced'] = {k: ({x: y for x, y in v.items() if x not in ('links', 'replacedRefs')} if isinstance(v, dict) else v)
                                        for k, v in replaced.items()}
    stats['wording-repaired'] = repair_wording(data)
    if not replaced.get('resisei-layla', {}).get('replaced'):    # the inline-note cleanup of the older Resisei Layla text
        out = subprocess.run([sys.executable, str(HERE / 'clean_resisei.py'), str(data / 'resisei-layla')], check=True,
                             capture_output=True, text=True).stdout
        stats['resisei-layla-cleanup'] = json.loads(out)
    # 2. connections and the cited-source index
    stats['connections'] = json.loads(run('node', 'scripts/edition-notes/connect.mjs', str(data), str(LINKS.resolve()),
                                          capture_output=True, text=True).stdout)
    # 2b. the Word editions as downloads: tonight's files replace the old ones (removed, so no older version stays downloadable)
    stats['word-downloads'] = word_downloads(site)
    # 3. MCP text of these books (strict for them), parallels and offline ZIPs, from the site's own data
    titles = [b['title'] for b in rd(data / 'catalog.json') if b['slug'] in EDITION_SLUGS]
    text = site / 'mcp-data/text'; keep = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'edition-notes-mcp-text'
    shutil.rmtree(keep, ignore_errors=True); shutil.copytree(text, keep)
    # Pri Tzaddik's search index, text chunks and catalog entry are written by its own release: kept exactly as published
    mcp = site / 'mcp-data'; keep_pt = keep.parent / 'edition-notes-mcp-pt'; shutil.rmtree(keep_pt, ignore_errors=True); keep_pt.mkdir()
    pt_search = {f.name: f.read_bytes() for f in (mcp / 'search').glob('peri-tzadik.*')}
    if (mcp / 'text-chunks/peri-tzadik').exists(): shutil.copytree(mcp / 'text-chunks/peri-tzadik', keep_pt / 'chunks')
    pt_cat = next((b for b in rd(mcp / 'catalog.json').get('books', []) if b.get('slug') == 'peri-tzadik'), None)
    dist = ROOT / 'dist'; moved = None
    if dist.exists() or dist.is_symlink(): moved = ROOT / '.dist-repo'; dist.rename(moved)
    dist.symlink_to(site)
    try:
        env = dict(os.environ, MCP_TOLERATE_FOREIGN_ANCHORS='1', MCP_STRICT_REF_PREFIX='|'.join(titles))
        run('node', 'scripts/build-mcp-index.mjs', env=env)
        # other books keep their published MCP text exactly
        for f in text.iterdir():
            slug = re.sub(r'(\.part\d+)?\.json$', '', f.name)
            # Pri Tzaddik's MCP text is written by its own release scripts (edition fields the general builder lacks): kept
            if (slug not in SLUGS or slug == 'peri-tzadik') and (keep / f.name).exists(): shutil.copyfile(keep / f.name, f)
        for f in keep.iterdir():
            if not (text / f.name).exists(): shutil.copyfile(f, text / f.name)
        # Pri Tzaddik is kept exactly as published: no part the builder wrote beyond the published ones may remain
        for f in list(text.glob('peri-tzadik.json')) + list(text.glob('peri-tzadik.part*.json')):
            if not (keep / f.name).exists(): f.unlink()
        for f in (mcp / 'search').glob('peri-tzadik.*'):
            if f.name not in pt_search: f.unlink()
        for n, by in pt_search.items(): (mcp / 'search' / n).write_bytes(by)
        if (keep_pt / 'chunks').exists():
            shutil.rmtree(mcp / 'text-chunks/peri-tzadik', ignore_errors=True); shutil.copytree(keep_pt / 'chunks', mcp / 'text-chunks/peri-tzadik')
        if pt_cat is not None:
            c2 = rd(mcp / 'catalog.json'); c2['books'] = [pt_cat if x.get('slug') == 'peri-tzadik' else x for x in c2.get('books', [])]; wr(mcp / 'catalog.json', c2)
        for slug in SLUGS:
            if slug != 'peri-tzadik': run('node', 'scripts/build-mcp-search-index.mjs', str(site / 'mcp-data'), slug)
        run('node', 'scripts/build-parallels.mjs')
        run('node', 'scripts/build-library-zips.mjs')
        cat = rd(site / 'mcp-data/catalog.json'); cat['version'] = rd(data / 'files.json')['version']; wr(site / 'mcp-data/catalog.json', cat)
        run('node', 'scripts/test-mcp-budget.mjs', str(site / 'mcp-data'))
    finally:
        dist.unlink()
        if moved: moved.rename(dist)
    # 4. the reader fetches these books' data afresh once
    page = site / 'library/index.html'; html = page.read_text()
    marker = 'const editionDataUrl = url => '
    html = re.sub(r'/\* 20261126-edition-notes-[^*]* \*/[^\n]*\n', '', html)      # an earlier run's marker
    assert html.count(marker) == 1, 'Reader cache helper unexpectedly changed'
    folders = ' || '.join(f"url.startsWith('data/{s}/')" for s in SLUGS)
    page.write_text(html.replace(marker, marker + f"/* {RELEASE} */ ({folders} || url.startsWith('data/cited/') || "
                    f"url.startsWith('data/parallels/') || url === 'data/files.json' || url === 'data/catalog.json') ? url + (url.includes('?') ? '&' : '?') + 'notes={RELEASE}' :\n"))
    sw = site / 'library/sw.js'; text_sw = sw.read_text()
    text_sw, n = re.subn(r'const SHELL = `([^`]+)`;', lambda m: 'const SHELL = `' + m[1] + '-' + RELEASE + '`;', text_sw, count=1)
    assert n == 1; sw.write_text(text_sw)
    wr(site / 'library/edition-notes-20261126.json', {'release': RELEASE, 'books': stats})
    print(json.dumps(stats, indent=1, ensure_ascii=False))


ALLOWED = re.compile(r'^(library/index\.html|library/sw\.js|library/edition-notes-20261126\.json|'
                     r'library/data/(' + '|'.join(map(re.escape, SLUGS)) + r')/.+|library/data/(cited|parallels)/.+|'
                     r'library/data/files\.json|library/data/catalog\.json|library/downloads/.+\.(zip|json)|'
                     r'library/downloads/(' + '|'.join(re.escape(x['file']) for x in rd(WORD / 'manifest.json')['files']) + r')|mcp-data/.+)$')


def seal(site):
    site = Path(site); before = rd('new-books-baseline.json')['files']
    after = {p.relative_to(site).as_posix(): sha(p) for p in sorted(site.rglob('*')) if p.is_file()}
    changed = sorted(k for k in after if before.get(k) != after[k])
    removed = sorted(set(before) - set(after))
    old_word = {'library/downloads/' + f for f in rd(WORD / 'manifest.json')['remove']}
    assert all(k.startswith(('mcp-data/search/', 'mcp-data/text-chunks/', 'mcp-data/mafteach/')) or k in old_word for k in removed), 'Files removed: ' + str(removed[:8])
    bad = [k for k in changed if not ALLOWED.match(k)]
    assert not bad, 'Unrelated changes: ' + str(bad[:10])
    # MCP text of other books is unchanged
    other = [k for k in changed if k.startswith('mcp-data/text/') and (re.sub(r'(\.part\d+)?\.json$', '', k[14:]) not in SLUGS or 'peri-tzadik' in k)]
    assert not other, 'MCP text of other books changed: ' + str(other[:5])
    big = [k for k in changed if k.startswith('mcp-data/') and (site / k).stat().st_size > 10_000_000]
    assert not big, 'MCP files over 10 MB: ' + str(big)
    wr(REPORT, {'release': RELEASE, 'changed': len(changed), 'removed': removed,
                'unchanged': sum(before.get(k) == after.get(k) for k in before),
                'files': {k: after[k] for k in changed}})
    print('Preserved', sum(before.get(k) == after.get(k) for k in before), 'files; changed', len(changed))


def live():
    files = rd(REPORT)['files']
    # the reader's files of these books and the shell; paced (the host rate-limits bursts)
    names = [k for k in files if k.startswith('library/') and not k.startswith('library/downloads/')]
    pending = dict((k, files[k]) for k in names)
    for attempt in range(10):
        for name, expected in list(pending.items()):
            try:
                req = urllib.request.Request(PUBLIC + name + '?notes_check=' + str(time.time_ns()), headers={'Cache-Control': 'no-cache'})
                with urllib.request.urlopen(req, timeout=60) as r:
                    if hashlib.sha256(r.read()).hexdigest() == expected: pending.pop(name)
            except Exception:
                pass
            time.sleep(0.15)
        if not pending: break
        print('Waiting for', len(pending), 'files', flush=True); time.sleep(20)
    assert not pending, 'Not live: ' + str(list(pending)[:8])
    print('Live:', len(names), 'reader files match the release')
    # the Word editions: each new file is served with the released bytes, and the old ones are gone
    m = rd(WORD / 'manifest.json'); bad = []
    for x in m['files']:
        name = 'library/downloads/' + x['file']; ok = False
        for attempt in range(6):
            try:
                with urllib.request.urlopen(PUBLIC + name + '?w=' + str(time.time_ns()), timeout=120) as r: ok = hashlib.sha256(r.read()).hexdigest() == sha(WORD / x['file'])
            except Exception: pass
            if ok: break
            time.sleep(20)
        if not ok: bad.append(name)
        time.sleep(0.3)
    for f in m['remove']:
        try:
            urllib.request.urlopen(PUBLIC + 'library/downloads/' + f + '?w=' + str(time.time_ns()), timeout=60); bad.append('still served: ' + f)
        except urllib.error.HTTPError as e:
            if e.code != 404: bad.append(f'{f}: {e.code}')
    assert not bad, 'Word downloads not live: ' + str(bad)
    print('Live:', len(m['files']), 'Word editions; old files removed:', m['remove'])


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'apply': apply(sys.argv[2])
    elif mode == 'seal': seal(sys.argv[2])
    elif mode == 'live': live()
    else: raise SystemExit(__doc__)

#!/usr/bin/env python3
"""Publish the Pri Tzaddik Moadim editions (Iyar–Menachem Av, Elul–Sukkos) over the complete current Pages artifact.

A clone of scripts/pri-shemos/release.py. The full-rebuild gate is left in place; unrelated publication files are
protected by a before/after SHA-256 inventory. After the edition is applied, the MCP search index and text chunks are
rebuilt from the site's own mcp-data and the MCP budget guard must pass (as scripts/mafteach-release.py apply does).
The offline text archive and the Pri Tzaddik archive are rebuilt from the final publication only.
"""
import hashlib
import html
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

spec = importlib.util.spec_from_file_location('moadim_build', Path(__file__).with_name('build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
STATE = Path('pri-moadim-release-state.json')
REPORT = Path('pri-moadim-release-report.json')
BEFORE = Path('pri-moadim-before.json')
rd = B.read_json; wr = B.write_json; sha = B.digest
STUDY = 'Akiva Publishing — Interlinear Study Edition'
KEY = 'moadimEdition'
MAX_BYTES = 10_000_000


def api(route):
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if os.environ.get('GITHUB_TOKEN'): headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    req = urllib.request.Request('https://api.github.com/repos/' + REPO + route, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)


def latest():
    """The run whose deploy-pages step most recently succeeded on main, and its github-pages artifact.

    Each publishing workflow's own runs are read (as scripts/mafteach-release.py latest_publication does): the
    repository-wide run list fills with skipped runs (every push starts ~40 workflows), so the newest 100 can miss
    the last real publication."""
    publishers = {}
    for p in Path('.github/workflows').glob('*.yml'):
        name = ''
        for line in p.read_text().splitlines():
            if line.lstrip().startswith('- name:'): name = line.split('- name:', 1)[1].strip()
            if 'uses: actions/deploy-pages@' in line: publishers[p.as_posix()] = name
    candidates = []
    for wf in publishers:
        try: runs = api('/actions/workflows/' + wf.rsplit('/', 1)[1] + '/runs?branch=main&status=completed&per_page=15')['workflow_runs']
        except urllib.error.HTTPError as e:
            if e.code == 404: continue          # a workflow GitHub does not know yet (not on main)
            raise
        for run in runs:
            if str(run['id']) == os.environ.get('GITHUB_RUN_ID') or run['status'] != 'completed' or run.get('conclusion') == 'skipped' or run['path'] not in publishers: continue
            jobs = api(f"/actions/runs/{run['id']}/jobs?per_page=100")['jobs']
            dates = [s['completed_at'] for j in jobs for s in j.get('steps', []) if s['name'] == publishers[run['path']] and s['conclusion'] == 'success']
            if dates: candidates.append((max(dates), run['id']))
    assert candidates, 'No proven current Pages publication'
    date, run = max(candidates)
    artifact = next((a for a in api(f'/actions/runs/{run}/artifacts')['artifacts'] if a['name'] == 'github-pages' and not a['expired']), None)
    assert artifact, 'Current complete publication artifact unavailable'
    return {'run': run, 'artifact': artifact['id'], 'deployedAt': date}


def head(): return api('/git/ref/heads/main')['object']['sha']
def inventory(site): return {p.relative_to(site).as_posix(): sha(p) for p in sorted(site.rglob('*')) if p.is_file()}
def leaves(node): return sum((leaves(c) for c in node['children']), []) if 'children' in node else [node]
def plain(s): return html.unescape(re.sub('<[^>]*>', '', s))


def apply(site):
    site = Path(site); lib = site / 'library'; data = lib / 'data'; pt = data / 'peri-tzadik'
    m = rd(B.OUTPUT / 'manifest.json'); secs = m['sections']
    original = rd(pt / 'toc.json')
    existing = next((x for x in original['toc']['children'] if x.get('en') == STUDY), None)
    assert existing, 'No existing Pri Tzaddik study edition'
    prior = [x for x in existing['children'] if x.get(KEY)]
    before = sum(l.get('shape', 0) for x in prior for l in leaves(x))
    existing['children'][:] = [x for x in existing['children'] if not x.get(KEY)]
    all_ids = {l.get('id') for l in leaves(original['toc'])}
    assert not ({s['id'] for s in secs} & all_ids), 'Reader chapter id collision'
    # no earlier study chapter of these refs may remain beside the new one
    refs = {s['ref'] for s in secs}
    assert not [l for l in leaves(existing) if l.get('ref') in refs], 'An earlier study chapter of these refs exists'
    for v in m['volumes']:
        assert sha(B.SOURCE / v['file']) == v['sha256'], 'Source Word file changed'
        target = lib / 'downloads' / v['download']; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(B.SOURCE / v['file'], target)
        group = {'en': v['label'], 'he': v['he'], KEY: B.EDITION, 'children': []}
        vs = [s for s in secs if s['volume'] == v['volume']]
        for name in dict.fromkeys(s['parashah'] for s in vs):
            ps = [s for s in vs if s['parashah'] == name]
            pg = {'en': name, 'he': ps[0]['heGroup'], 'children': []}
            for s in ps:
                shutil.copyfile(B.OUTPUT / f"{s['id']}.json", pt / f"{s['id']}.json")
                pg['children'].append({k: s[k] for k in ('en', 'he', 'id', 'ref', 'heRef', 'parashah', 'ois')} | {
                    'depth': 1, 'shape': s['paragraphs'], 'il1': True, 'interlinear': True, 'sep': ':',
                    'reviewedEdition': B.EDITION, 'downloadDocx': 'downloads/' + v['download'],
                    'downloadDocxLabel': v['label'] + ' · Complete Word edition'})
            group['children'].append(pg)
        existing['children'].append(group)
    wr(pt / 'toc.json', original)
    catalog = rd(data / 'catalog.json'); book = next(b for b in catalog if b['slug'] == 'peri-tzadik')
    book['segments'] = book.get('segments', 0) + m['paragraphs'] - before
    for v in m['volumes']:
        file = 'downloads/' + v['download']
        if not any(d['file'] == file for d in book.setdefault('downloads', [])):
            book['downloads'].append({'file': file, 'label': v['label'] + ' · Complete interlinear Word edition'})
    wr(data / 'catalog.json', catalog)
    page = lib / 'index.html'; text = page.read_text()
    text = re.sub(r'/\* Moadim edition data revision \*/[^\n]*\n', '', text)
    anchor = 'const editionDataUrl = url => '
    assert text.count(anchor) == 1
    text = text.replace(anchor, anchor + f"/* Moadim edition data revision */ (url.startsWith('data/peri-tzadik/') || url === 'data/catalog.json' || url === 'data/files.json') ? url + '?edition={B.EDITION}' :\n")
    # the supplied heading weight, for these chapters only (exact refs: "Sukkot 1" must not match "Sukkot 10")
    text = re.sub(r'/\* Moadim heading typography \*/\n[^\n]*\n', '', text)
    selectors = ','.join('.sec[data-ref="' + s['ref'].replace('"', '') + '"] .subhead' for s in secs)
    text = text.replace('</style>', '/* Moadim heading typography */\n' + selectors + '{font-weight:400}\n</style>', 1)
    page.write_text(text)
    sw = lib / 'sw.js'; text = sw.read_text()
    if '-' + B.EDITION not in text:
        text, n = re.subn(r'const SHELL = `([^`]+)`;', lambda x: 'const SHELL = `' + x[1] + '-' + B.EDITION + '`;', text, count=1)
        assert n == 1
    sw.write_text(text)
    # MCP: keep every existing paragraph; replace an earlier copy of this edition, append the new one
    catpath = site / 'mcp-data/catalog.json'; textpath = site / 'mcp-data/text/peri-tzadik.json'
    cat = rd(catpath); text = rd(textpath); mb = next(b for b in cat['books'] if b['slug'] == 'peri-tzadik')
    oldsec = mb['sections']; gone = {i for i, s in enumerate(oldsec) if s.get(KEY)}
    if gone:
        keep = [i for i in range(len(oldsec)) if i not in gone]; remap = {old: i for i, old in enumerate(keep)}
        text['paras'] = [dict(p, s=remap[p['s']]) for p in text['paras'] if p['s'] not in gone]
        oldsec[:] = [oldsec[i] for i in keep]
        firsts = {}
        for j, p in enumerate(text['paras']): firsts.setdefault(p['s'], [j, 0]); firsts[p['s']][1] += 1
        for i, sec in enumerate(oldsec):
            if i in firsts: sec['first'], sec['count'] = firsts[i]
    for s in secs:
        si = len(oldsec); first = len(text['paras']); pending = []
        for item in rd(B.OUTPUT / f"{s['id']}.json"):
            if 'h' in item: pending.append(item['h']); continue
            para = {'r': s['ref'] + ':' + str(item['n']), 's': si, 'n': item['n'], 'p': [[plain(h), plain(e)] for h, e in item['p']]}
            if pending: para['h'] = pending; pending = []
            text['paras'].append(para)
        oldsec.append({'ref': s['ref'], 'he': s['heRef'], 'title': s['en'], 'heTitle': s['he'],
                       'path': STUDY + ' › ' + s['parashah'], 'il': True, 'first': first, 'count': s['paragraphs'],
                       'edition': 'interlinear', 'parashah': s['parashah'], 'ois': s['ois'], KEY: B.EDITION})
    mb['paragraphs'] = len(text['paras']); mb['interlinear'] = True
    wr(textpath, text); wr(catpath, cat)
    wr(lib / 'pri-moadim-publication.json', m)
    # kisvei_search's prebuilt index and the text chunks, from the site's own book texts; then the Worker budget guard
    subprocess.run(['node', 'scripts/build-mcp-search-index.mjs', str(site / 'mcp-data')], check=True)
    subprocess.run(['node', 'scripts/test-mcp-budget.mjs', str(site / 'mcp-data')], check=True)
    print('Applied', len(secs), 'sections,', m['paragraphs'], 'paragraphs,', m['pairs'], 'phrase pairs;',
          'mcp-data/text/peri-tzadik.json is', round(textpath.stat().st_size / 1e6, 2), 'MB')


def exports(site):
    site = Path(site); lib = site / 'library'; data = lib / 'data'; downloads = lib / 'downloads'
    files = sorted(p.relative_to(data).as_posix() for p in data.rglob('*') if p.is_file() and p != data / 'files.json')
    h = hashlib.sha256(); size = 0
    for name in files:
        body = (data / name).read_bytes(); h.update(name.encode()); h.update(b'\0'); h.update(body); size += len(body)
    manifest = {'version': h.hexdigest()[:16], 'bytes': size, 'files': files}; wr(data / 'files.json', manifest)
    index = rd(downloads / 'index.json'); catalog = rd(data / 'catalog.json')
    def create(file, names, docnames, book=None):
        dest = lib / file; old_readme = None
        if dest.is_file():
            with ZipFile(dest) as old:
                old_readme = old.read('README.txt') if 'README.txt' in old.namelist() else None
        with ZipFile(dest, 'w', compression=ZIP_DEFLATED, compresslevel=6) as z:
            def put(name, body):
                info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
                z.writestr(info, body, compresslevel=6)
            put('README.txt', old_readme or b'Akiva Publishing. Published reader data and documents; source licenses are retained in data/*/toc.json.\n')
            for name in names:
                if book and name == 'catalog.json': put('data/' + name, json.dumps([book], ensure_ascii=False, separators=(',', ':')).encode())
                else: put('data/' + name, (data / name).read_bytes())
            for name in docnames: put(name, (lib / name).read_bytes())
        return {'bytes': dest.stat().st_size, 'dataFiles': len(names), 'documents': len(docnames)}
    docs = sorted('downloads/' + p.name for p in downloads.iterdir() if p.is_file() and p.suffix.lower() in ('.docx', '.pdf'))
    index['library'].update(create(index['library']['file'], files + ['files.json'], docs))
    entry = next(b for b in index['books'] if b['slug'] == 'peri-tzadik')
    book = next(b for b in catalog if b['slug'] == 'peri-tzadik')
    with ZipFile(lib / entry['file']) as old: old_docs = [x for x in old.namelist() if x.startswith('downloads/')]
    docs = sorted(set(old_docs + [d['file'] for d in book['downloads']]))
    names = ['catalog.json'] + [f for f in files if f.startswith('peri-tzadik/') or f in ('cited/peri-tzadik.json', 'parallels/peri-tzadik.json')]
    entry.update(create(entry['file'], names, docs, book))
    index['version'] = manifest['version']; wr(downloads / 'index.json', index)
    print('Offline manifest and complete library/Pri Tzaddik ZIPs synchronized:', manifest['version'])


def permitted(name):
    m = rd(B.OUTPUT / 'manifest.json')
    ids = '|'.join(str(s['id']) for s in m['sections'])
    downloads = '|'.join(re.escape(v['download']) for v in m['volumes'])
    allowed = re.compile(r'^(library/index\.html|library/sw\.js|library/data/(catalog|files)\.json|library/data/peri-tzadik/(toc|'
                         + ids + r')\.json|library/downloads/(index\.json|rav-tzadok-library\.zip|books/peri-tzadik\.zip|'
                         + downloads + r')|library/pri-moadim-publication\.json|mcp-data/(catalog|text/peri-tzadik)\.json|'
                         r'mcp-data/search/.+|mcp-data/text-chunks/.+)$')
    return bool(allowed.match(name))


def seal(site):
    site = Path(site); before = rd(BEFORE); after = inventory(site)
    changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
    removed = set(before) - set(after)
    # the search index may rename its parts (e.g. a file split in two); nothing else may disappear
    assert all(k.startswith(('mcp-data/search/', 'mcp-data/text-chunks/')) for k in removed), 'Published files were removed: ' + str(sorted(removed)[:8])
    assert all(permitted(k) for k in changed), 'Unrelated changes: ' + str(sorted(k for k in changed if not permitted(k))[:10])
    # MCP data: <= 10 MB except the grandfathered whole-book file (held by scripts/test-mcp-budget.mjs)
    big = [k for k in changed if k in after and k.startswith('mcp-data/') and k != 'mcp-data/text/peri-tzadik.json' and (site / k).stat().st_size > MAX_BYTES]
    assert not big, 'MCP files over 10 MB: ' + str(big)
    report = {'edition': B.EDITION, 'changed': len(changed), 'removed': sorted(removed),
              'unchanged': len(before) - sum(k in before for k in changed),
              'files': {k: after[k] for k in sorted(changed) if k in after},
              'sizes': {k: (site / k).stat().st_size for k in sorted(changed) if k in after and (site / k).stat().st_size > MAX_BYTES},
              'sources': rd(B.OUTPUT / 'manifest.json')['volumes']}
    wr(REPORT, report); print('Preservation:', report['unchanged'], 'files unchanged;', report['changed'], 'authorized changes; over 10 MB:', report['sizes'])


def live():
    report = rd(REPORT); pending = dict(report['files'])
    import concurrent.futures
    def check(item):
        name, expected = item
        try:
            with urllib.request.urlopen(PUBLIC + name + '?moadim=' + str(time.time_ns()), timeout=90) as r:
                h = hashlib.sha256()
                while True:
                    b = r.read(1024 * 1024)
                    if not b: break
                    h.update(b)
            return name, h.hexdigest() == expected
        except Exception: return name, False
    for attempt in range(12):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            for name, ok in ex.map(check, list(pending.items())):
                if ok: pending.pop(name, None)
        if not pending: break
        print('Waiting for current Pages files:', len(pending), flush=True); time.sleep(15)
    assert not pending, 'Published bytes differ: ' + str(list(pending)[:8])
    wr('pri-moadim-live-verification.json', {'edition': B.EDITION, 'verifiedFiles': len(report['files']), 'ok': True})
    print('Every changed file is publicly live and matches its release SHA-256')


def main():
    mode = sys.argv[1]
    if mode == 'metadata':
        expected = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
        assert head() == expected, 'Main advanced; publish the current head'
        publication = latest(); wr(STATE, {'head': expected, 'publication': publication})
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as out: out.write(f"artifact={publication['artifact']}\nrun={publication['run']}\n")
        print(json.dumps(publication))
    elif mode == 'guard':
        s = rd(STATE); assert head() == s['head'], 'Main advanced'
        assert latest()['artifact'] == s['publication']['artifact'], 'Newer site published; rerun on that baseline'
        print('Current main and current publication are still pinned')
    elif mode == 'capture': wr(BEFORE, inventory(Path(sys.argv[2])))
    elif mode == 'apply': apply(sys.argv[2])
    elif mode == 'exports': exports(sys.argv[2])
    elif mode == 'seal': seal(sys.argv[2])
    elif mode == 'live': live()
    else: raise SystemExit('metadata | guard | capture | apply | exports | seal | live')


if __name__ == '__main__': main()

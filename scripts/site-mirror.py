#!/usr/bin/env python3
"""Mirror the current GitHub Pages publication to the "site-latest" GitHub release, for the Cloudflare Worker.

  find     -> prints run=<id> artifact=<id> changed=<0|1> for $GITHUB_OUTPUT (the newest github-pages artifact
              whose deploy step succeeded, compared with the run recorded in the release notes)
  package <artifact.tar> <outdir>
           -> <outdir>/site.tar.gz (every file up to 25 MB, the Workers static-asset limit) plus each larger file
              as its own release asset (path with "/" -> "__"); site/_big-files.json maps path -> asset name,
              and the Worker redirects those paths to the release download.
The Cloudflare build (scripts/cf-build.sh, run by `wrangler deploy`) downloads site.tar.gz from the release.
No Cloudflare credential is used here: Cloudflare Workers Builds deploys on the push this workflow makes."""
import json, os, re, subprocess, sys, tarfile, urllib.request
from pathlib import Path

REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
TAG = 'site-latest'
LIMIT = 25_000_000


def api(route):
    h = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if os.environ.get('GITHUB_TOKEN'): h['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    with urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/' + REPO + route, headers=h), timeout=60) as r:
        return json.load(r)


def latest():
    publishers = {}
    for p in Path('.github/workflows').glob('*.yml'):
        name = ''
        for line in p.read_text().splitlines():
            if line.lstrip().startswith('- name:'): name = line.split('- name:', 1)[1].strip()
            if 'uses: actions/deploy-pages@' in line: publishers[p.as_posix()] = name
    best = None
    for wf, step in publishers.items():
        try: runs = api('/actions/workflows/' + wf.rsplit('/', 1)[1] + '/runs?branch=main&status=completed&per_page=10')['workflow_runs']
        except urllib.error.HTTPError as e:
            if e.code == 404: continue
            raise
        for run in runs:
            if run.get('conclusion') == 'skipped' or run['path'] not in publishers: continue
            jobs = api(f"/actions/runs/{run['id']}/jobs?per_page=100")['jobs']
            done = [s['completed_at'] for j in jobs for s in j.get('steps', []) if s['name'] == step and s['conclusion'] == 'success']
            if done and (best is None or max(done) > best[0]): best = (max(done), run['id'])
    assert best, 'no successful Pages deployment found'
    run = best[1]
    art = next(a for a in api(f'/actions/runs/{run}/artifacts')['artifacts'] if a['name'] == 'github-pages' and not a['expired'])
    return run, art['id']


def find():
    run, art = latest()
    notes = subprocess.run(['gh', 'release', 'view', TAG, '-R', REPO, '--json', 'body', '-q', '.body'], capture_output=True, text=True).stdout
    m = re.search(r'run=(\d+)', notes or '')
    changed = int(os.environ.get('FORCE') == 'true' or not m or int(m.group(1)) != run)
    out = f'run={run}\nartifact={art}\nchanged={changed}\n'
    print(out)
    if os.environ.get('GITHUB_OUTPUT'): open(os.environ['GITHUB_OUTPUT'], 'a').write(out)


def package(tar_path, outdir):
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    big = {}
    with tarfile.open(tar_path) as src, tarfile.open(out / 'site.tar.gz', 'w:gz', compresslevel=6) as dst:
        for m in src:
            name = m.name.lstrip('./')
            if not name or not (m.isfile() or m.isdir()): continue
            if m.isfile() and m.size > LIMIT:
                asset = name.replace('/', '__')
                with src.extractfile(m) as f, open(out / asset, 'wb') as w:
                    while chunk := f.read(1 << 20): w.write(chunk)
                big[name] = asset
                continue
            m.name = name
            dst.addfile(m, src.extractfile(m) if m.isfile() else None)
        data = json.dumps(big, indent=1).encode()
        ti = tarfile.TarInfo('_big-files.json'); ti.size = len(data)
        import io; dst.addfile(ti, io.BytesIO(data))
    (out / 'big-files.json').write_text(json.dumps(big, indent=1))
    print('site.tar.gz', (out / 'site.tar.gz').stat().st_size, 'big files', len(big))
    for k, v in big.items(): print('  big', k)


if __name__ == '__main__':
    {'find': lambda: find(), 'package': lambda: package(*sys.argv[2:4])}[sys.argv[1]]()

"""Publish the Vayeira study over the current complete Pages artifact.

Verify every original Torah file and every unrelated site file remains identical.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
ROOT = Path(os.environ.get('WEEKLY_STUDY_SITE', '.vayeira-study-site'))
STATE = Path('vayeira-study-baseline.json')
META = Path('vayeira-study-publication.json')
REPORT = Path('vayeira-study-verification.json')
SHELL = {'library/index.html', 'library/sw.js', 'library/blog/index.html'}
LIVE_GUARDS = ['index.html', 'library/index.html', 'library/sw.js', 'library/data/catalog.json', 'library/data/cited/index.json']


def digest(file):
    result = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def api(route):
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + route, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def publishers():
    result = {}
    for workflow in Path('.github/workflows').glob('*.yml'):
        last_name = ''
        for line in workflow.read_text().splitlines():
            if line.lstrip().startswith('- name:'):
                last_name = line.split('- name:', 1)[1].strip()
            if 'uses: actions/deploy-pages@' in line:
                assert last_name, 'Unnamed Pages deployment step'
                result[workflow.as_posix()] = last_name
    return result


def latest_publication():
    known = publishers()
    runs = api('/actions/runs?branch=main&per_page=100')['workflow_runs']
    current_run = str(os.environ.get('GITHUB_RUN_ID', ''))
    candidates = []
    for run in runs:
        if str(run['id']) == current_run or run['path'] not in known:
            continue
        if run['status'] != 'completed' or run['conclusion'] == 'skipped':
            continue
        # A post-deployment check can fail after a site was published. Inspect
        # the actual deploy-pages step, rather than treating run success as live.
        jobs = api('/actions/runs/' + str(run['id']) + '/jobs?per_page=100')['jobs']
        deployed = [step for job in jobs for step in job.get('steps', [])
                    if step['name'] == known[run['path']] and step['conclusion'] == 'success']
        if deployed:
            candidates.append((max(step['completed_at'] for step in deployed), run))
    assert candidates, 'No verified completed Pages deployment found; refusing a rebuild'
    completed_at, run = max(candidates, key=lambda item: item[0])
    artifacts = api('/actions/runs/' + str(run['id']) + '/artifacts')['artifacts']
    artifact = next((item for item in artifacts if item['name'] == 'github-pages' and not item['expired']), None)
    assert artifact, 'The current publication artifact is unavailable; refusing an older baseline'
    return {'runId': run['id'], 'headSha': run['head_sha'], 'artifactId': artifact['id'],
            'digest': artifact.get('digest'), 'bytes': artifact['size_in_bytes'], 'deployedAt': completed_at}


def branch_guard(expected):
    current = api('/git/ref/heads/main')['object']['sha']
    assert current == expected, 'Main advanced; review the new head before publishing this release'


def inventory(root):
    result = {}
    for file in sorted(root.rglob('*')):
        assert not file.is_symlink(), 'Unexpected link in publication: ' + str(file)
        if file.is_file():
            result[file.relative_to(root).as_posix()] = digest(file)
    return result


def live_digest(name):
    url = PUBLIC + name + ('&' if '?' in name else '?') + 'vayeira_study_check=' + str(time.time_ns())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=60) as response:
        assert response.status == 200
        return hashlib.sha256(response.read()).hexdigest()


def guard(state):
    branch_guard(state['expectedHead'])
    current = latest_publication()
    assert current['artifactId'] == state['publication']['artifactId'], 'A newer site was published; rebase on that complete publication'
    for name in LIVE_GUARDS:
        assert live_digest(name) == state['files'][name], 'Live baseline changed: ' + name
    print('Current main and live homepage, reader, service worker, and catalog match the preserved baseline.')


def verify_inputs():
    files = ['library/vayeira-study.js', 'library/studies/vayeira-mesiras-nefesh.json',
             'library/downloads/vayeira-akeidah-mesiras-nefesh.pdf',
             'library/downloads/vayeira-akeidah-mesiras-nefesh-cover.webp']
    inputs = {}
    for name in files:
        file = Path('dist') / name
        assert file.is_file() and not file.is_symlink() and file.stat().st_size > 100
        inputs[name] = digest(file)
    return inputs


mode = sys.argv[1]
if mode == 'metadata':
    head = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    branch_guard(head)
    state = {'publication': latest_publication(), 'expectedHead': head, 'inputs': verify_inputs()}
    META.write_text(json.dumps(state, indent=2) + '\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('artifact=' + str(state['publication']['artifactId']) + '\n')
            output.write('run=' + str(state['publication']['runId']) + '\n')
    print(json.dumps(state['publication'], indent=2))
elif mode == 'capture':
    state = json.loads(META.read_text())
    state['files'] = inventory(ROOT)
    assert all(name in state['files'] for name in LIVE_GUARDS)
    STATE.write_text(json.dumps(state, indent=2) + '\n')
    guard(state)
    print('Captured', len(state['files']), 'original published files.')
elif mode == 'verify':
    state = json.loads(STATE.read_text())
    after = inventory(ROOT)
    before = state['files']
    removed = sorted(set(before) - set(after))
    changed = {name for name in after if before.get(name) != after[name]}
    allowed = SHELL | set(state['inputs'])
    assert not removed, 'Original publication files removed: ' + repr(removed)
    assert changed <= allowed, 'Unexpected publication change: ' + repr(sorted(changed - allowed))
    for name, expected in state['inputs'].items():
        assert after.get(name) == expected, 'Input asset was changed or omitted: ' + name
    for name, marker in [('library/index.html', 'akiva-vayeira-study'), ('library/sw.js', '20261026-vayeira-mesiras-nefesh-v1'), ('library/blog/index.html', 'vayeira-feature-title')]:
        assert marker in (ROOT / name).read_text(), 'Missing study hook: ' + name
    report = {'publication': state['publication'], 'expectedHead': state['expectedHead'],
              'changed': sorted(changed), 'removed': [],
              'preservedFiles': len(before) - len(changed & set(before)),
              'unchangedTorahFiles': sum(name.startswith(('library/data/', 'mcp-data/')) and before[name] == after.get(name) for name in before),
              'expectedLive': {name: after[name] for name in sorted(changed)}}
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'expectedLive'}, indent=2))
elif mode == 'guard':
    guard(json.loads(STATE.read_text()))
elif mode == 'published':
    report = json.loads(REPORT.read_text())
    pending = dict(report['expectedLive'])
    for attempt in range(18):
        for name, expected in list(pending.items()):
            try:
                if live_digest(name) == expected:
                    pending.pop(name)
            except Exception:
                pass
        if not pending:
            break
        if attempt < 17:
            time.sleep(10)
    assert not pending, 'Published bytes did not match: ' + repr(sorted(pending))
    state = json.loads(STATE.read_text())
    for name in ['library/data/catalog.json', 'library/data/cited/index.json']:
        assert live_digest(name) == state['files'][name], 'An unchanged live catalog differs: ' + name
    Path('vayeira-study-live-verification.json').write_text(json.dumps({'verifiedFiles': len(report['expectedLive']), 'preservedCatalogs': True, 'publication': report['expectedHead']}, indent=2) + '\n')
    print('Verified exact public bytes for', len(report['expectedLive']), 'changed/new files and the unchanged live catalogs.')
else:
    raise SystemExit('Unknown mode: ' + mode)


#!/usr/bin/env python3
"""Publish SeferStudio without rebuilding or changing the existing Torah site."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import time
import urllib.parse
import urllib.request


REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
SOURCE = Path('dist/sefer-studio')
ROOT = Path('.sefer-studio-site')
META = Path('sefer-studio-publication.json')
STATE = Path('sefer-studio-baseline.json')
REPORT = Path('sefer-studio-verification.json')
LIVE_REPORT = Path('sefer-studio-live-verification.json')
PREFIX = 'sefer-studio/'
PRO_PREFIX = 'sefer-pro/'
SOFER_PREFIX = 'sofer-studio/'
APP_PREFIXES = (PREFIX, PRO_PREFIX, SOFER_PREFIX)
# The Library's manifest gets the same app identity and link handling as the Sefer apps (November 2026: each installed
# app opens its own links in its own window). It is replaced only when the live file is the known previous one.
LIBRARY_MANIFEST = 'library/manifest.webmanifest'
LIBRARY_MANIFEST_BEFORE = '66ad511e373d33176d00547a09505bb9073b7f3a34e4541934e7f5e55b105eb0'
LIVE_GUARDS = ['index.html', 'library/index.html', 'library/sw.js',
               'library/data/catalog.json', 'library/data/cited/index.json']


def digest(file):
    result = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def api(route):
    headers = {'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28',
               'User-Agent': 'SeferStudio-scoped-publication'}
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + route,
                                     headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def publishers():
    """Use the repository's existing named deploy-pages steps as the publisher list."""
    result = {}
    for workflow in Path('.github/workflows').glob('*.yml'):
        last_name = ''
        for line in workflow.read_text().splitlines():
            if line.lstrip().startswith('- name:'):
                last_name = line.split('- name:', 1)[1].strip()
            if 'uses: actions/deploy-pages@' in line:
                assert last_name, 'Unnamed Pages deployment step: ' + str(workflow)
                result[workflow.as_posix()] = last_name
    assert result, 'No known Pages publishers; refusing an unverified baseline'
    return result


def latest_publication():
    known = publishers()
    runs = []
    for page in range(1, 8):
        batch = api('/actions/runs?branch=main&status=completed&per_page=100&page=' +
                    str(page))['workflow_runs']
        runs.extend(batch)
        if len(batch) < 100:
            break
    candidates = []
    current_run = str(os.environ.get('GITHUB_RUN_ID', ''))
    for run in runs:
        if (str(run['id']) == current_run or run['path'] not in known or
                run['status'] != 'completed' or run.get('conclusion') == 'skipped'):
            continue
        jobs = api('/actions/runs/' + str(run['id']) + '/jobs?per_page=100')['jobs']
        deployed = [step for job in jobs for step in job.get('steps', [])
                    if step['name'] == known[run['path']] and
                    step['conclusion'] == 'success']
        # Later verification can fail after Pages has already gone live.
        if deployed:
            candidates.append((max(step['completed_at'] for step in deployed), run))
    assert candidates, 'No verified completed Pages deployment; refusing a rebuild'
    deployed_at, run = max(candidates, key=lambda item: item[0])
    artifacts = api('/actions/runs/' + str(run['id']) +
                    '/artifacts?per_page=100')['artifacts']
    artifact = next((item for item in artifacts
                     if item['name'] == 'github-pages' and not item['expired']), None)
    assert artifact, 'Current Pages artifact unavailable; refusing an older baseline'
    assert artifact['workflow_run']['id'] == run['id'], 'Artifact run mismatch'
    assert artifact['workflow_run']['head_sha'] == run['head_sha'], 'Artifact commit mismatch'
    return {'runId': run['id'], 'headSha': run['head_sha'],
            'artifactId': artifact['id'], 'digest': artifact.get('digest'),
            'bytes': artifact['size_in_bytes'], 'deployedAt': deployed_at}


def branch_guard(expected):
    assert expected, 'Missing expected source revision'
    current = api('/git/ref/heads/main')['object']['sha']
    assert current == expected, 'Main advanced; review the new head before publishing'


def inventory(root):
    root = Path(root)
    assert root.is_dir() and not root.is_symlink(), 'Missing or unsafe directory: ' + str(root)
    result = {}
    for file in sorted(root.rglob('*')):
        assert not file.is_symlink(), 'Unexpected symlink: ' + str(file)
        assert file.is_file() or file.is_dir(), 'Unexpected special file: ' + str(file)
        if file.is_file():
            result[file.relative_to(root).as_posix()] = digest(file)
    return result


def app_overrides(standalone=False):
    """Build the Sefer Pro entry point from the current Studio release."""
    manifest = json.loads((SOURCE / 'manifest.webmanifest').read_text(encoding='utf-8'))
    prefix = SOFER_PREFIX if standalone else PRO_PREFIX
    title = 'SoferStudio AI' if standalone else 'Sefer Pro'
    route = '#/studio/audio' if standalone else '#/studio'
    manifest.update(id=urllib.parse.urlparse(PUBLIC).path + prefix,
                    name=title, short_name=title,
                    start_url='./' + route, scope='./', display='standalone')
    manifest.pop('display_override', None)
    html = (SOURCE / 'index.html').read_text(encoding='utf-8')
    html = html.replace('SeferStudio Pro', 'Sefer Pro')
    html = html.replace('SeferStudio <span', 'Sefer <span')
    html = html.replace('Return to SeferStudio Website Home', 'Return to Sefer Pro Home')
    html = html.replace("location.hash || '#/home'", f"location.hash || '{route}'")
    if standalone:
        html = html.replace('<title>Sefer Pro', '<title>SoferStudio AI', 1)
        html = html.replace('content="Sefer Pro"', 'content="SoferStudio AI"', 1)
    html = html.replace(
        '<link rel="manifest" href="manifest.webmanifest" />',
        '<link rel="manifest" href="manifest.webmanifest" />\n'
        '  <link rel="apple-touch-icon" href="icons/icon-192.png" />')
    assert ('<title>' + title) in html and 'rel="apple-touch-icon"' in html, \
        'Missing Sefer Pro application metadata'
    return {'index.html': html.encode('utf-8'),
            'manifest.webmanifest': (json.dumps(manifest, indent=2) + '\n').encode('utf-8')}


def replace_app(destination):
    assert not destination.is_symlink(), 'Unsafe app destination'
    if destination.exists():
        assert destination.is_dir(), 'App destination is not a directory'
        shutil.rmtree(destination)
    shutil.copytree(SOURCE, destination)


def build_app(destination, standalone=False):
    overrides = app_overrides(standalone)
    replace_app(destination)
    for name, contents in overrides.items():
        (destination / name).write_bytes(contents)


def source_inventory():
    files = inventory(SOURCE)
    for required in ['index.html', 'manifest.webmanifest', 'sw.js']:
        assert required in files and (SOURCE / required).stat().st_size > 0, \
            'Missing app asset: ' + required
    result = {PREFIX + name: value for name, value in files.items()}
    for prefix in (PRO_PREFIX, SOFER_PREFIX):
        overrides = app_overrides(prefix == SOFER_PREFIX)
        scoped = files | {name: hashlib.sha256(contents).hexdigest() for name, contents in overrides.items()}
        result.update({prefix + name: value for name, value in scoped.items()})
    return result


def live_digest(name):
    url = PUBLIC + urllib.parse.quote(name, safe='/') + '?sefer_studio_check=' + str(time.time_ns())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                                  'User-Agent': 'SeferStudio-live-verification'})
    with urllib.request.urlopen(request, timeout=20) as response:
        assert response.status == 200, 'Unexpected HTTP status: ' + name
        return hashlib.sha256(response.read()).hexdigest()


def guard(state):
    branch_guard(state['expectedHead'])
    assert source_inventory() == state['inputs'], 'App source changed after capture'
    current = latest_publication()
    assert current['artifactId'] == state['publication']['artifactId'], \
        'A newer site was published; restore that complete publication first'
    for name in LIVE_GUARDS:
        assert live_digest(name) == state['files'][name], 'Live baseline changed: ' + name
    print('Main, app source, and the current live publication match the captured baseline.')


def metadata():
    expected = os.environ.get('GITHUB_SHA')
    branch_guard(expected)
    state = {'expectedHead': expected, 'publication': latest_publication(),
             'inputs': source_inventory()}
    META.write_text(json.dumps(state, indent=2) + '\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('run=' + str(state['publication']['runId']) + '\n')
            output.write('artifact=' + str(state['publication']['artifactId']) + '\n')
    print(json.dumps(state['publication'], indent=2))


def restore(archive):
    destination = ROOT.resolve()
    source = SOURCE.resolve()
    assert destination != source and destination not in source.parents and source not in destination.parents
    assert not ROOT.exists(), 'Staging directory already exists; refusing to overwrite it'
    with tarfile.open(archive, 'r:') as bundle:
        members = bundle.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            assert not path.is_absolute() and '..' not in path.parts, 'Unsafe archive path'
            assert '\\' not in member.name, 'Ambiguous archive path'
            target = (destination / member.name).resolve()
            assert target == destination or destination in target.parents, 'Archive path escaped staging'
            assert member.isdir() or member.isfile(), 'Archive links or special files are forbidden'
        ROOT.mkdir(parents=True, exist_ok=False)
        bundle.extractall(destination, members=members, filter='data')
    state = json.loads(META.read_text())
    state['files'] = inventory(ROOT)
    assert all(name in state['files'] for name in LIVE_GUARDS), 'Incomplete site baseline'
    write_json(STATE, state)
    guard(state)
    print('Restored and fingerprinted', len(state['files']), 'published files.')


def apply():
    state = json.loads(STATE.read_text())
    assert source_inventory() == state['inputs'], 'App source changed after capture'
    replace_app(ROOT / PREFIX)
    build_app(ROOT / PRO_PREFIX)
    build_app(ROOT / SOFER_PREFIX, standalone=True)
    live = ROOT / LIBRARY_MANIFEST
    wanted = digest(Path('dist') / LIBRARY_MANIFEST)
    if digest(live) != wanted:
        assert digest(live) == LIBRARY_MANIFEST_BEFORE, 'Live Library manifest is not the known previous version'
        shutil.copyfile(Path('dist') / LIBRARY_MANIFEST, live)
    verify()


def verify():
    state = json.loads(STATE.read_text())
    before = state['files']
    after = inventory(ROOT)
    removed = sorted(set(before) - set(after))
    changed = {name for name in after if before.get(name) != after[name]}
    assert all(name.startswith(APP_PREFIXES) for name in removed), 'An unrelated file was removed'
    assert all(name.startswith(APP_PREFIXES) or name == LIBRARY_MANIFEST for name in changed), 'An unrelated file was changed'
    assert after.get(LIBRARY_MANIFEST) == digest(Path('dist') / LIBRARY_MANIFEST), 'Library manifest not the tracked one'
    for name, expected in before.items():
        if not name.startswith(APP_PREFIXES) and name != LIBRARY_MANIFEST:
            assert after.get(name) == expected, 'Unrelated published bytes changed: ' + name
    app_files = {name: value for name, value in after.items() if name.startswith(APP_PREFIXES)}
    assert app_files == state['inputs'] == source_inventory(), 'Staged app differs from tracked source'
    report = {'publication': state['publication'], 'expectedHead': state['expectedHead'],
              'changed': sorted(changed), 'removed': removed,
              'preservedFiles': sum(not name.startswith(APP_PREFIXES) for name in before),
              'expectedLive': app_files}
    write_json(REPORT, report)
    print('Verified', report['preservedFiles'], 'unchanged existing files and',
          len(app_files), 'exact app files across sefer-studio/, sefer-pro/, and sofer-studio/.')


def published():
    report = json.loads(REPORT.read_text())
    state = json.loads(STATE.read_text())
    expected = {name: value for name, value in report['expectedLive'].items()
                if not any(part.startswith('.') for part in PurePosixPath(name).parts)}
    expected.update({name: state['files'][name] for name in LIVE_GUARDS})
    expected[LIBRARY_MANIFEST] = digest(Path('dist') / LIBRARY_MANIFEST)
    pending = dict(expected)

    def matches(item):
        name, wanted = item
        try:
            return name, live_digest(name) == wanted
        except Exception:
            return name, False

    for attempt in range(12):
        with ThreadPoolExecutor(max_workers=8) as executor:
            for name, matched in executor.map(matches, list(pending.items())):
                if matched:
                    pending.pop(name)
        if not pending:
            break
        if attempt < 11:
            print('Waiting for public assets:', ', '.join(sorted(pending)))
            time.sleep(10)
    assert not pending, 'Public bytes did not match after 12 attempts: ' + repr(sorted(pending))
    evidence = {'status': 'published-and-verified', 'sourceCommit': report['expectedHead'],
                'verifiedPublicFiles': len(expected), 'unchangedLiveGuards': LIVE_GUARDS,
                'url': PUBLIC + PRO_PREFIX + '#/studio', 'hashes': expected}
    write_json(LIVE_REPORT, evidence)
    print('Verified the live apps and unchanged existing site:', PUBLIC + PRO_PREFIX, PUBLIC + SOFER_PREFIX)


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'metadata':
        metadata()
    elif mode == 'restore':
        restore(sys.argv[2])
    elif mode == 'apply':
        apply()
    elif mode == 'verify':
        verify()
    elif mode == 'guard':
        guard(json.loads(STATE.read_text()))
    elif mode == 'published':
        published()
    elif mode == 'build-sefer-pro':
        build_app(SOURCE.parent / PRO_PREFIX)
        build_app(SOURCE.parent / SOFER_PREFIX, standalone=True)
    else:
        raise SystemExit('Unknown mode: ' + mode)

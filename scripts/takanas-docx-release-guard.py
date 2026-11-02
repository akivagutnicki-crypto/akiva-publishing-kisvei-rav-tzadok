"""Adapt the existing preserved-artifact guards to one exact source branch.

Install as scripts/takanas-docx-release-guard.py. This does not change the
historical helper or its publication checks. Candidate metadata pins current
main separately from the nondefault source commit; both must remain unchanged.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.request

REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
RELEASE_REF = 'refs/heads/release/takanas-docx-20261102'
STATE = Path('artifacts/takanas-docx-master/source-context.json')
HELPER = Path('scripts/new-books-release.py')


def api(route):
    headers = {'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28'}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + route,
                                     headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def ref_head(ref):
    assert ref.startswith('refs/heads/'), 'Only a branch ref is allowed'
    suffix = urllib.parse.quote(ref.removeprefix('refs/'), safe='/')
    return api('/git/ref/' + suffix)['object']['sha']


def source_guard(state):
    assert os.environ['GITHUB_REPOSITORY'] == REPO
    assert state['sourceRef'] in (RELEASE_REF, 'refs/heads/main')
    assert os.environ['GITHUB_REF'] == state['sourceRef']
    assert os.environ['GITHUB_SHA'] == state['sourceHead']
    assert ref_head(state['sourceRef']) == state['sourceHead'], 'Source branch advanced'
    assert ref_head('refs/heads/main') == state['expectedMain'], 'Main advanced'


mode = sys.argv[1]
if mode == 'metadata':
    source_ref = os.environ['GITHUB_REF']
    assert source_ref in (RELEASE_REF, 'refs/heads/main')
    state = {'sourceRef': source_ref, 'sourceHead': os.environ['GITHUB_SHA'],
             'expectedMain': ref_head('refs/heads/main'),
             'mode': 'publish' if source_ref == 'refs/heads/main' else 'candidate-only'}
    if state['mode'] == 'publish':
        assert state['sourceHead'] == state['expectedMain']
    source_guard(state)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2) + '\n')
    # The unmodified historical helper intentionally authenticates MAIN. For a
    # candidate, provide that identity only in this child process. The release
    # branch identity remains independently authenticated above and at guard.
    child_env = dict(os.environ)
    child_env['GITHUB_SHA'] = state['expectedMain']
    subprocess.run([sys.executable, str(HELPER), 'metadata'], env=child_env, check=True)
    source_guard(state)
elif mode == 'guard':
    state = json.loads(STATE.read_text())
    source_guard(state)
    subprocess.run([sys.executable, str(HELPER), 'guard'], check=True)
    source_guard(state)
else:
    raise SystemExit('Use metadata or guard')

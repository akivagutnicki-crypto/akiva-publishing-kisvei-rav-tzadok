"""Refresh only the Divrei Soferim ZIP over the actual current Pages artifact."""
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile

REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
ROOT = Path(os.environ.get('DIVREI_ZIP_SITE', '.divrei-zip-site'))
META = Path('divrei-zip-publication.json')
STATE = Path('divrei-zip-baseline.json')
REPORT = Path('divrei-zip-verification.json')
TARGET = 'library/downloads/books/divrei-soferim.zip'
INDEX = 'library/downloads/index.json'
SLUG = 'divrei-soferim'
ALLOWED = {TARGET, INDEX}
LIVE_GUARDS = ['index.html', 'library/index.html', 'library/sw.js',
               'library/data/catalog.json', 'library/data/divrei-soferim/16.json',
               'library/data/cited/divrei-soferim.json', TARGET, INDEX]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def api(route):
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + route, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def latest_publication():
    publishers = {}
    for workflow in Path('.github/workflows').glob('*.y*ml'):
        last_name = ''
        for line in workflow.read_text().splitlines():
            if line.lstrip().startswith('- name:'):
                last_name = line.split('- name:', 1)[1].strip().strip('\"\'')
            if 'uses: actions/deploy-pages@' in line:
                assert last_name, 'Unnamed Pages deployment step'
                publishers.setdefault(workflow.as_posix(), set()).add(last_name)
    candidates = []
    for page in range(1, 4):
        runs = api(f'/actions/runs?branch=main&per_page=100&page={page}')['workflow_runs']
        for run in runs:
            if (str(run['id']) == os.environ.get('GITHUB_RUN_ID') or run['path'] not in publishers
                    or run['status'] != 'completed' or run['conclusion'] == 'skipped'):
                continue
            jobs = api(f"/actions/runs/{run['id']}/jobs?per_page=100")['jobs']
            # A later verification failure does not undo a successful deployment.
            deployed = [step for job in jobs for step in job.get('steps', [])
                        if step['name'] in publishers[run['path']] and step['conclusion'] == 'success']
            if deployed:
                candidates.append((max(step['completed_at'] for step in deployed), run))
        if candidates or len(runs) < 100:
            break
    assert candidates, 'No successful Pages deployment found; refusing a rebuild'
    completed_at, run = max(candidates, key=lambda item: item[0])
    artifacts = api(f"/actions/runs/{run['id']}/artifacts?per_page=100")['artifacts']
    available = [item for item in artifacts if item['name'] == 'github-pages' and not item['expired']]
    assert available, 'Current publication artifact unavailable; refusing an older baseline'
    artifact = max(available, key=lambda item: item['id'])
    return {'runId': run['id'], 'headSha': run['head_sha'], 'artifactId': artifact['id'],
            'digest': artifact.get('digest'), 'bytes': artifact['size_in_bytes'], 'deployedAt': completed_at}


def branch_guard(expected):
    assert api('/git/ref/heads/main')['object']['sha'] == expected, 'Main advanced; review the new head'


def inventory():
    result = {}
    for file in sorted(ROOT.rglob('*')):
        assert not file.is_symlink(), 'Unexpected publication link: ' + str(file)
        if file.is_file():
            result[file.relative_to(ROOT).as_posix()] = digest(file)
    return result


def live_digest(name):
    request = urllib.request.Request(PUBLIC + name + '?divrei_zip_check=' + str(time.time_ns()),
                                     headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=60) as response:
        assert response.status == 200
        return sha(response.read())


def guard(state):
    branch_guard(state['expectedHead'])
    assert latest_publication()['artifactId'] == state['publication']['artifactId'], 'A newer site was published'
    for name in LIVE_GUARDS:
        assert live_digest(name) == state['files'][name], 'Live baseline differs: ' + name
    print('Current main, deployed artifact, and public baseline match.')


def zip_contents():
    with zipfile.ZipFile(ROOT / TARGET) as archive:
        assert archive.testzip() is None, 'ZIP integrity failure'
        names = archive.namelist()
        assert len(names) == len(set(names)), 'Duplicate ZIP members'
        for name in names:
            path = PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in name, 'Unsafe ZIP member'
        return {name: archive.read(name) for name in names}


def expected_member(name, original):
    if name == 'data/catalog.json':
        catalog = json.loads((ROOT / 'library/data/catalog.json').read_text())
        value = [book for book in catalog if book['slug'] == SLUG]
        assert len(value) == 1, 'Divrei catalog entry missing or duplicated'
    elif name in ('data/cited/index.json', 'data/parallels/index.json'):
        assert SLUG in json.loads((ROOT / 'library' / name).read_text())
        value = [SLUG]
    elif name.startswith('data/'):
        return (ROOT / 'library' / name).read_bytes()
    else:
        return original
    # Retain existing formatting when scoped metadata already matches.
    return original if json.loads(original) == value else json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def index_record(value):
    matches = [book for book in value['books'] if book['slug'] == SLUG]
    assert len(matches) == 1 and matches[0]['file'] == 'downloads/books/divrei-soferim.zip'
    return matches[0]


def capture(state):
    state['files'] = inventory()
    assert all(name in state['files'] for name in LIVE_GUARDS)
    contents = zip_contents()
    required = {'README.txt', 'data/catalog.json', 'data/cited/index.json', 'data/parallels/index.json',
                'data/cited/divrei-soferim.json', 'data/parallels/divrei-soferim.json', 'data/parallels/words.json',
                'data/divrei-soferim/links.json', 'data/divrei-soferim/toc.json'}
    required.update(f'data/divrei-soferim/{section}.json' for section in range(39))
    assert set(contents) == required, 'Unexpected per-book ZIP contract; review before changing it'
    state['members'] = {name: sha(data) for name, data in contents.items()}
    state['index'] = json.loads((ROOT / INDEX).read_text())
    assert index_record(state['index'])['bytes'] == (ROOT / TARGET).stat().st_size
    save(STATE, state)
    return state


def apply():
    contents = zip_contents()
    replacements = {name: expected_member(name, data) for name, data in contents.items()}
    if replacements != contents:
        path = ROOT / TARGET
        temporary = path.with_suffix('.tmp')
        with zipfile.ZipFile(path) as original, zipfile.ZipFile(temporary, 'w') as refreshed:
            refreshed.comment = original.comment
            for member in original.infolist():
                refreshed.writestr(copy.copy(member), replacements[member.filename], compresslevel=6)
        temporary.replace(path)
    index = json.loads((ROOT / INDEX).read_text())
    if index_record(index)['bytes'] != (ROOT / TARGET).stat().st_size:
        index_record(index)['bytes'] = (ROOT / TARGET).stat().st_size
        (ROOT / INDEX).write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n')


def verify():
    state = json.loads(STATE.read_text())
    after, before = inventory(), state['files']
    assert set(after) == set(before), 'Published files added or removed'
    changed = sorted(name for name in before if before[name] != after[name])
    assert set(changed) <= ALLOWED, 'Unrelated publication changes: ' + repr(changed)
    contents = zip_contents()
    assert list(contents) == list(state['members']), 'ZIP entry set or order changed'
    for name, data in contents.items():
        assert data == expected_member(name, data), 'ZIP does not match current publication: ' + name
        if not name.startswith('data/'):
            assert sha(data) == state['members'][name], 'README/document changed: ' + name
    notes = [note for section in range(39)
             for row in json.loads(contents[f'data/divrei-soferim/{section}.json'])
             for note in row.get('footnotes', [])
             if note.get('provenance', {}).get('sourceAudit', {}).get('release') == '20261022-divrei-source-audit-v1']
    excerpts = sum(len(note['reviewedSourceExcerpts']) for note in notes)
    assert len(notes) == 718 and excerpts == 750, 'Reviewed footnote/excerpt totals changed'
    assert sorted(note['number'] for note in notes) == list(range(1, 719)), 'Regular note numbering changed'
    assert sum(len(note['paragraphs']) for note in notes) == excerpts
    expected_index = copy.deepcopy(state['index'])
    index_record(expected_index)['bytes'] = (ROOT / TARGET).stat().st_size
    assert json.loads((ROOT / INDEX).read_text()) == expected_index, 'Index changed beyond target byte size'
    unchanged = {name: after[name] for name in before if before[name] == after[name]}
    report = {'publication': state['publication'], 'expectedHead': state['expectedHead'],
              'changed': changed, 'removed': [], 'preservedFiles': len(unchanged),
              'unchangedFiles': unchanged, 'regularNotes': len(notes), 'sourceExcerpts': excerpts,
              'zipBytes': (ROOT / TARGET).stat().st_size,
              'zipMembers': {name: sha(data) for name, data in contents.items()},
              'changedMembers': [name for name, data in contents.items() if sha(data) != state['members'][name]],
              'beforeHashes': {name: before[name] for name in sorted(ALLOWED)},
              'expectedLive': {name: after[name] for name in sorted(ALLOWED)}}
    save(REPORT, report)
    print(json.dumps({key: value for key, value in report.items() if key not in ('unchangedFiles', 'zipMembers')}, indent=2))


def main():
    mode = sys.argv[1]
    if mode == 'metadata':
        head = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
        branch_guard(head)
        state = {'publication': latest_publication(), 'expectedHead': head}
        save(META, state)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f"artifact={state['publication']['artifactId']}\nrun={state['publication']['runId']}\n")
        print(json.dumps(state, indent=2))
    elif mode == 'restore':
        state = json.loads(META.read_text())
        archive = Path(sys.argv[2])
        state['artifactTarSha256'] = digest(archive)
        ROOT.mkdir()
        root = ROOT.resolve()
        with tarfile.open(archive, 'r:') as source:
            members = source.getmembers()
            for member in members:
                target = (root / member.name).resolve()
                assert target == root or root in target.parents, 'Unsafe artifact path'
                assert member.isdir() or member.isfile(), 'Unexpected artifact link or special file'
            source.extractall(root, members=members, filter='data')
        guard(capture(state))
    elif mode == 'apply':
        apply()
    elif mode == 'verify':
        verify()
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
        assert not pending, 'Public bytes do not match: ' + repr(sorted(pending))
        state = json.loads(STATE.read_text())
        for name in LIVE_GUARDS:
            if name not in ALLOWED:
                assert live_digest(name) == state['files'][name], 'Unchanged public baseline differs: ' + name
        save(Path('divrei-zip-live-verification.json'), {'publiclyVerified': True,
             'publication': report['expectedHead'], 'verifiedHashes': report['expectedLive'],
             'regularNotes': report['regularNotes'], 'sourceExcerpts': report['sourceExcerpts']})
        print('Public Divrei ZIP and index match exactly; preserved live guards are unchanged.')
    else:
        raise SystemExit('Unknown mode: ' + mode)


if __name__ == '__main__':
    main()

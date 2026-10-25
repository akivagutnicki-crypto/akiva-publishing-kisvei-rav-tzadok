#!/usr/bin/env python3
"""Refresh only the Tzidkat DOCX and its existing download containers.

Planning can use a small, independently downloaded input tree. Publication must
restore the actual latest Pages artifact and match its entire sealed inventory.
No chapter, footnote, reader asset, or historical publication report is written.
"""
import argparse
import concurrent.futures
import copy
import hashlib
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile

REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
PUBLIC = f'https://akivagutnicki-crypto.github.io/{REPO.split("/")[1]}/'
SLUG = 'tzidkat-hatzadik'
RELEASE = '20261025-tzidkat-download-refresh-v1'
DESCRIPTOR = 'sources/akiva/downloads/tzidkat-download-refresh-20261025.json'
DOCX_INPUT = 'sources/akiva/downloads/tzidkas-hatzaddik-complete-20261025.docx'
APPROVAL_INPUT = 'sources/akiva/downloads/tzidkat-docx-reader-sync-20261025.json'
SOURCE_PACK = 'sources/akiva/addenda/tzidkat-source-addition-006-20261025.json.gz'
SOURCE_DESCRIPTOR = 'sources/akiva/addenda/tzidkat-source-addition-006-transition-20261025.json'
SOURCE_RELEASE = '20261025-tzidkat-source-addition-006-v1'
SOURCE_CHAPTER = 'library/data/tzidkat-hatzadik/5.json'
DOCX = 'library/downloads/tzidkas-hatzaddik-complete.docx'
DOCX_MEMBER = DOCX.removeprefix('library/')
BOOK = 'library/downloads/books/tzidkat-hatzadik.zip'
LIBRARY = 'library/downloads/rav-tzadok-library.zip'
INDEX = 'library/downloads/index.json'
FINAL_REPORT = 'library/tzidkat-batch-review-256-264-20261025.json'
FINAL_PACK_SHA = '3bc345df5b4c9c9060fab8265de26f9692b0b618580521d3cabdec9103691c61'
FINAL_REPORT_SHA = '742cf6899188bb20080fadfda85bee0ca9f732049e38bb49c318d1cdb507db40'
ALLOWED = frozenset((DOCX, BOOK, LIBRARY, INDEX))
CHECKS = ('currentReaderAuthorTextExact', 'nativeNotesComplete', 'connectedNotesComplete',
          'publicNoteNumbersPreserved', 'hyperlinksPreserved',
          'originalRunningStylePreserved', 'sevenByTenLayoutPreserved')
COUNTS = {'reviewedSections': 264, 'nativeNotes': 3684, 'connectedNotes': 347,
          'totalPublicNotes': 4031, 'reviewAdditions': 1371, 'sourceAdditions': 1}
SOURCE_ALLOWED = frozenset((SOURCE_CHAPTER, 'library/data/tzidkat-hatzadik/links.json',
    'mcp-data/text/tzidkat-hatzadik.json', 'mcp-data/cited.json', 'mcp-data/catalog.json',
    'library/data/cited/tosafot-on-berakhot.json', 'library/data/cited/index.json',
    'library/data/packs/sources.json', 'library/data/files.json', 'library/index.html', 'library/sw.js',
    'library/downloads/index.json', 'library/downloads/books/tzidkat-hatzadik.zip',
    'library/downloads/rav-tzadok-library.zip'))
REQUIRED_BOOK = frozenset({
    'README.txt', 'data/catalog.json', f'data/{SLUG}/links.json', f'data/{SLUG}/toc.json',
    f'data/cited/{SLUG}.json', f'data/parallels/{SLUG}.json',
    'data/cited/index.json', 'data/parallels/index.json', 'data/parallels/words.json',
    DOCX_MEMBER, 'connected-ideas/catalog.json',
    f'data/{SLUG}/source-evidence/tzidkat154-takanat-hashavin10-printed-excerpt.pdf',
    f'data/{SLUG}/source-evidence/tzidkat40-arba-meot-shekel-kesef-neimot2-502-503.pdf',
} | {f'data/{SLUG}/{section}.json' for section in range(264)})


def require(condition, message):
    if not condition:
        raise ValueError(message)


def info(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def file_info(file):
    h, size = hashlib.sha256(), 0
    with Path(file).open('rb') as source:
        for part in iter(lambda: source.read(1024 * 1024), b''):
            size += len(part)
            h.update(part)
    return {'bytes': size, 'sha256': h.hexdigest()}


def valid_info(value):
    return (isinstance(value, dict) and set(value) == {'bytes', 'sha256'}
            and isinstance(value['bytes'], int) and value['bytes'] >= 0
            and len(value['sha256']) == 64 and all(c in '0123456789abcdef' for c in value['sha256']))


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def read_json(file):
    return json.loads(Path(file).read_bytes())


def write_json(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(json_bytes(value))


def local(root, name):
    p = PurePosixPath(name)
    require(isinstance(name, str) and name and not p.is_absolute()
            and '\\' not in name and all(x not in ('', '.', '..') for x in name.split('/')),
            'Unsafe publication path: ' + str(name))
    result = Path(root).resolve().joinpath(*p.parts)
    require(Path(root).resolve() in result.resolve().parents, 'Path escaped publication root')
    return result


def inventory(root):
    result = {}
    for file in sorted(Path(root).rglob('*')):
        require(not file.is_symlink(), 'Publication contains a symbolic link')
        if file.is_file():
            result[file.relative_to(root).as_posix()] = file_info(file)
    return result


def load_source_descriptor(repo=None, optional=False):
    repo = Path(repo or Path(__file__).resolve().parent.parent)
    file = repo / SOURCE_DESCRIPTOR
    if optional and not file.exists():
        return None
    raw = file.read_bytes()
    require(file.with_suffix(file.suffix + '.sha256').read_text().strip() == info(raw)['sha256'], 'Immutable source transition changed')
    descriptor = json.loads(raw)
    require(descriptor['schemaVersion'] == 1 and descriptor['release'] == SOURCE_RELEASE, 'Wrong one-note source transition')
    require(descriptor['predecessor'] == {'path': FINAL_REPORT, 'sha256': FINAL_REPORT_SHA,
        'packSha256': FINAL_PACK_SHA, 'batches': 18}, 'Source transition changed its reviewed predecessor')
    require(len({item['path'] for item in descriptor['files']}) == len(descriptor['files'])
            and all(item['path'] in SOURCE_ALLOWED for item in descriptor['files']), 'Source transition scope broadened')
    pack_raw = (repo / SOURCE_PACK).read_bytes()
    require((repo / (SOURCE_PACK + '.sha256')).read_text().strip() == info(pack_raw)['sha256'] == descriptor['packSha256'], 'Reviewed source pack differs')
    pack = json.loads(gzip.decompress(pack_raw))
    require(pack['release'] == SOURCE_RELEASE and len(pack['additions']) == 1
            and pack['additions'][0]['note']['number'] == 4031, 'One-note source contract differs')
    return descriptor


def sealed_inventory(root, include_source=True):
    raw = local(root, FINAL_REPORT).read_bytes()
    require(info(raw)['sha256'] == FINAL_REPORT_SHA, 'Not the independently verified final publication report')
    report = json.loads(raw)
    require(report['packSha256'] == FINAL_PACK_SHA and report['newNotes'] == 92
            and report['release'] == '20261025-tzidkat-batch-256-264-v1'
            and report['existingNotesUnchanged'] and report['authorTextUnchanged'],
            'Final content release is not the approved 256–264 release')
    result = copy.deepcopy(report['baselineFiles'])
    for item in report['changedFiles']:
        result[item['path']] = {key: item[key] for key in ('bytes', 'sha256')}
    result[FINAL_REPORT] = info(raw)
    require(all(valid_info(v) for v in result.values()), 'Invalid content-seal inventory')
    if include_source:
        source = load_source_descriptor(optional=True)
        if source:
            chapter = next(item for item in source['files'] if item['path'] == SOURCE_CHAPTER)
            actual = file_info(local(root, SOURCE_CHAPTER))
            if actual == chapter['after']:
                for item in source['files']:
                    require(result.get(item['path']) == item['before'], 'Unknown source-addition preimage')
                    result[item['path']] = item['after']
            else:
                require(actual == chapter['before'], 'Ois 6 is not an approved source-transition state')
    return result


def check_available_inputs(root, baseline):
    for name, actual in inventory(root).items():
        require(name in baseline and actual == baseline[name], 'Input differs from final publication: ' + name)


def zip_members(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as source:
        require(source.testzip() is None, 'ZIP integrity check failed')
        names = source.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP members')
        for name in names:
            local('/tmp/tzidkat-zip-path-check', name)
        members = {name: source.read(name) for name in names}
        return members, source.infolist(), source.comment


def encode_zip(original, replacements, vendor):
    members, metadata, comment = zip_members(original)
    require(set(replacements) == set(members), 'ZIP member names may not be added or removed')
    if all(replacements[name] == value for name, value in members.items()):
        return original
    # The exact current archives were built by the site's sealed fflate module.
    # Reuse that portable compressor, with each original DOS timestamp, instead
    # of depending on a runner's native zlib version. Refuse another ZIP format.
    require(not comment, 'Unexpected archive comment')
    for item in metadata:
        require(item.compress_type == 8 and item.flag_bits == 0 and item.create_system == 0
                and item.create_version == 20 and item.extract_version == 20
                and item.internal_attr == 0 and item.external_attr == 0
                and not item.comment and not item.extra, 'Unreviewed ZIP metadata format')
    with tempfile.TemporaryDirectory(prefix='tzidkat-download-zip-') as scratch:
        scratch = Path(scratch)
        source = scratch / 'original.zip'
        target = scratch / 'refreshed.zip'
        source.write_bytes(original)
        updates = []
        for position, (name, raw) in enumerate(replacements.items()):
            if raw != members[name]:
                payload = scratch / (str(position) + '.bin')
                payload.write_bytes(raw)
                updates.append({'name': name, 'file': str(payload), **info(raw)})
        manifest = scratch / 'inputs.json'
        write_json(manifest, {'updates': updates, 'members': [
            {'name': item.filename, 'date': list(item.date_time)} for item in metadata]})
        subprocess.run(['node', str(Path(__file__).with_name('tzidkat-download-zip.mjs')),
                        str(source), str(manifest), str(target), str(Path(vendor).resolve())],
                       check=True, timeout=180, capture_output=True, text=True)
        result = target.read_bytes()
    actual, _, result_comment = zip_members(result)
    require(list(actual) == list(members) and result_comment == comment, 'ZIP contract changed')
    require(actual == replacements, 'ZIP round-trip changed a member')
    return result


def scoped_bytes(original, expected):
    return original if json.loads(original) == expected else json_bytes(expected)


def expected_book_member(root, name, original, document):
    if name == DOCX_MEMBER:
        return document
    if name == 'README.txt':
        return original
    live = local(root, 'library/' + name).read_bytes()
    if name == 'data/catalog.json':
        selected = [book for book in json.loads(live) if book['slug'] == SLUG]
        require(len(selected) == 1, 'Missing or duplicated book in live catalog')
        return scoped_bytes(original, selected)
    if name in ('data/cited/index.json', 'data/parallels/index.json'):
        require(SLUG in json.loads(live), 'Scoped index not present in live index')
        return scoped_bytes(original, [SLUG])
    require(name.startswith('data/') or name == 'connected-ideas/catalog.json', 'Unexpected book ZIP member')
    return live


def book_record(index):
    selected = [book for book in index['books'] if book['slug'] == SLUG]
    require(len(selected) == 1 and selected[0]['file'] == BOOK.removeprefix('library/'), 'Wrong book ZIP download record')
    return selected[0]


def counts(members):
    return {'dataFiles': sum(name.startswith('data/') for name in members),
            'documents': sum(name.startswith('downloads/') and name.lower().endswith(('.docx', '.pdf')) for name in members)}


def validate_approval(root, docx_path, approval_path, baseline):
    document = Path(docx_path).read_bytes()
    approval_raw = Path(approval_path).read_bytes()
    approval = json.loads(approval_raw)
    require(approval.get('schemaVersion') == 1 and approval.get('kind') == 'tzidkat-docx-reader-sync'
            and approval.get('status') == 'verified' and approval.get('bookSlug') == SLUG,
            'DOCX needs its completed reader-sync review')
    require(approval.get('document') == info(document), 'Approved DOCX hash differs')
    require(approval.get('sourceDocument') == baseline[DOCX], 'DOCX starts from a different published document')
    for key, expected in COUNTS.items():
        require(approval.get(key) == expected, 'Unverified DOCX count: ' + key)
    for key in CHECKS:
        require(approval.get('checks', {}).get(key) is True, 'DOCX review incomplete: ' + key)
    snapshots = approval.get('readerSnapshot', [])
    require(len({item['path'] for item in snapshots}) == len(snapshots), 'Repeated reader snapshot path')
    required = {f'library/data/{SLUG}/{section}.json' for section in range(264)}
    required.add('library/connected-ideas/catalog.json')
    require(required <= {item['path'] for item in snapshots}, 'DOCX review omits source chapters or connected notes')
    for item in snapshots:
        require(item['path'] in baseline and {k: item[k] for k in ('bytes', 'sha256')} == baseline[item['path']],
                'DOCX review used stale reader data: ' + item['path'])
    native = 0
    for section in range(264):
        native += sum(len(row.get('footnotes', [])) for row in read_json(local(root, f'library/data/{SLUG}/{section}.json')))
    require(native == COUNTS['nativeNotes'], 'Native reader-note count changed')
    members, _, _ = zip_members(document)
    require('word/document.xml' in members and '[Content_Types].xml' in members, 'Invalid Word document')
    require(len(approval.get('evidence', [])) > 0, 'DOCX review must identify detailed evidence')
    for item in approval['evidence']:
        require(isinstance(item.get('path'), str) and valid_info({k: item[k] for k in ('bytes', 'sha256')}), 'Invalid DOCX evidence pin')
    return document, {'path': APPROVAL_INPUT, **info(approval_raw)}, approval


def archive_proof(before, after):
    old, _, _ = zip_members(before)
    new, _, _ = zip_members(after)
    require(list(old) == list(new), 'Archive names or order changed')
    changes = [name for name in old if old[name] != new[name]]
    return {'before': info(before), 'after': info(after), 'entryCount': len(old),
            'changedMembers': changes, 'preservedEntries': len(old) - len(changes),
            'members': [{'path': name, 'before': info(old[name]), 'after': info(new[name])} for name in old],
            **counts(new)}


def make_plan(root, docx_path, approval_path):
    baseline = sealed_inventory(root)
    source = load_source_descriptor()
    require(file_info(local(root, SOURCE_CHAPTER)) == next(item['after'] for item in source['files'] if item['path'] == SOURCE_CHAPTER),
            'The requested Tosafot note must precede the final Word/ZIP refresh')
    check_available_inputs(root, baseline)
    document, approval_pin, approval = validate_approval(root, docx_path, approval_path, baseline)
    require(info(document) != baseline[DOCX], 'The proposed Word document is still the old download')
    originals = {name: local(root, name).read_bytes() for name in ALLOWED}
    book, _, _ = zip_members(originals[BOOK])
    require(set(book) == REQUIRED_BOOK, 'Unexpected existing book ZIP contract; inspect before broadening scope')
    replacements = {name: expected_book_member(root, name, raw, document) for name, raw in book.items()}
    for name in book:
        if name.startswith(f'data/{SLUG}/'):
            require(book[name] == replacements[name], 'Current book chapters/notes/source PDFs must already match the reader')
    vendor = local(root, 'library/vendor/fflate.min.js')
    require(file_info(vendor) == baseline['library/vendor/fflate.min.js'], 'ZIP compressor differs from sealed publication')
    output = {DOCX: document, BOOK: encode_zip(originals[BOOK], replacements, vendor)}
    library, _, _ = zip_members(originals[LIBRARY])
    library_next = dict(library)
    if DOCX_MEMBER in library:
        require(library[DOCX_MEMBER] == originals[DOCX], 'All-library DOCX has an unreviewed predecessor')
        library_next[DOCX_MEMBER] = document
    output[LIBRARY] = encode_zip(originals[LIBRARY], library_next, vendor)
    require(book[DOCX_MEMBER] == originals[DOCX], 'Book ZIP DOCX has an unreviewed predecessor')
    old_index = json.loads(originals[INDEX])
    require(book_record(old_index)['bytes'] == len(originals[BOOK]), 'Book index size is already inconsistent')
    require(old_index['library']['file'] == LIBRARY.removeprefix('library/')
            and old_index['library']['bytes'] == len(originals[LIBRARY]), 'Library index size is already inconsistent')
    new_index = copy.deepcopy(old_index)
    for record, raw, members in ((book_record(new_index), output[BOOK], replacements),
                                 (new_index['library'], output[LIBRARY], library_next)):
        expected_counts = counts(members)
        require(all(record[key] == count for key, count in expected_counts.items()), 'Archive counts changed unexpectedly')
        record['bytes'] = len(raw)
    output[INDEX] = scoped_bytes(originals[INDEX], new_index)
    sources = sorted({'library/' + name for name in book if name not in ('README.txt', DOCX_MEMBER)}
                     | {'library/vendor/fflate.min.js'})
    descriptor = {
        'schemaVersion': 1, 'release': RELEASE, 'scope': 'existing-downloads-only',
        'predecessor': {'path': FINAL_REPORT, **baseline[FINAL_REPORT], 'packSha256': FINAL_PACK_SHA,
                        'batches': 18, 'reviewedSections': 264, 'reviewAdditions': 1371},
        'sourceAddition': {'path': SOURCE_DESCRIPTOR, **file_info(Path(__file__).resolve().parent.parent / SOURCE_DESCRIPTOR),
                           'packSha256': source['packSha256'], 'number': 4031},
        'documentInput': {'path': DOCX_INPUT, **info(document)}, 'documentApproval': approval_pin,
        'documentCounts': {key: approval[key] for key in COUNTS},
        'files': [{'path': name, 'before': info(originals[name]), 'after': info(output[name])} for name in sorted(ALLOWED)],
        'sourceFiles': [{'path': name, **baseline[name]} for name in sources],
        'archives': [{'path': name, **archive_proof(originals[name], output[name])} for name in (BOOK, LIBRARY)],
        'downloadIndexBefore': old_index, 'downloadIndexAfter': new_index,
        'verification': {'allAuthorAndReaderFilesPreserved': True, 'allExistingFootnotesPreserved': True,
                         'oldPublicationReportsUnchanged': True, 'archiveMemberNamesAndOrderUnchanged': True,
                         'bookAuxiliaryDataMatchesCurrentPublication': True, 'documentMatchesApprovedBytes': True,
                         'otherLibraryZipEntriesUnchanged': True, 'downloadIndexOnlyArchiveSizesChanged': True},
    }
    require(set(descriptor['archives'][1]['changedMembers']) <= {DOCX_MEMBER}, 'All-library scope broadened')
    require(set(descriptor['archives'][0]['changedMembers']) <= {
        DOCX_MEMBER, 'data/catalog.json', f'data/cited/{SLUG}.json', f'data/parallels/{SLUG}.json',
        'data/cited/index.json', 'data/parallels/index.json', 'data/parallels/words.json', 'connected-ideas/catalog.json'},
        'Book archive changed its author data')
    return descriptor, output, baseline


def load_descriptor(args):
    file = Path(args.descriptor)
    raw = file.read_bytes()
    require(file.with_suffix(file.suffix + '.sha256').read_text().strip() == info(raw)['sha256'], 'Immutable download transition changed')
    descriptor = json.loads(raw)
    require(descriptor['schemaVersion'] == 1 and descriptor['release'] == RELEASE, 'Wrong download transition')
    require({entry['path'] for entry in descriptor['files']} == ALLOWED and len(descriptor['files']) == len(ALLOWED), 'Transition scope broadened')
    return descriptor


def verify_actual(root, descriptor, full_baseline=True):
    baseline = sealed_inventory(root)
    after = dict(baseline)
    for item in descriptor['files']:
        require(item['before'] == baseline[item['path']], 'Transition does not follow the final sealed release')
        require(file_info(local(root, item['path'])) == item['after'], 'Refreshed download differs: ' + item['path'])
        after[item['path']] = item['after']
    if full_baseline:
        require(inventory(root) == after, 'A file outside the four downloads changed, disappeared, or was added')
    for item in descriptor['sourceFiles']:
        require(file_info(local(root, item['path'])) == {k: item[k] for k in ('bytes', 'sha256')}, 'Reader source changed')
    docx = local(root, DOCX).read_bytes()
    for archive in descriptor['archives']:
        members, _, _ = zip_members(local(root, archive['path']).read_bytes())
        require(list(members) == [item['path'] for item in archive['members']], 'Archive member names/order changed')
        for item in archive['members']:
            require(info(members[item['path']]) == item['after'], 'Archive member differs: ' + item['path'])
            if item['path'] not in archive['changedMembers']:
                require(item['before'] == item['after'], 'Undeclared archive member change')
        if archive['path'] == BOOK:
            require(set(members) == REQUIRED_BOOK, 'Book archive contract changed')
            for name, raw in members.items():
                require(raw == expected_book_member(root, name, raw, docx), 'Book member is not current: ' + name)
        if DOCX_MEMBER in members:
            require(members[DOCX_MEMBER] == docx, 'Bundled Word document differs')
    require(read_json(local(root, INDEX)) == descriptor['downloadIndexAfter'], 'Download index differs')
    return {'ok': True, 'release': RELEASE, 'changedFiles': [item for item in descriptor['files'] if item['before'] != item['after']],
            'preservedPublicFiles': len(baseline) - sum(item['before'] != item['after'] for item in descriptor['files']),
            'authorAndReaderFilesByteIdentical': True, 'existingNotesByteIdentical': True,
            'historicalReportsByteIdentical': True, 'archives': [{k: v for k, v in archive.items() if k != 'members'} for archive in descriptor['archives']]}


def verify_source_actual(root, descriptor):
    before = sealed_inventory(root, include_source=False)
    expected = dict(before)
    for item in descriptor['files']:
        require(before.get(item['path']) == item['before'], 'Unrecognized one-note preimage')
        expected[item['path']] = item['after']
    require(inventory(root) == expected, 'Source addition changed or removed an unrelated published file')
    return {'ok': True, 'release': SOURCE_RELEASE, 'newNote': 4031,
        'packSha256': descriptor['packSha256'], 'changedFiles': descriptor['files'],
        'preservedPublicFiles': len(expected) - len(descriptor['files']),
        'authorAndReaderTextPreserved': True, 'existingNotesPreserved': True, 'historicalReportsByteIdentical': True}


def api(route):
    token = os.environ.get('GITHUB_TOKEN')
    require(token, 'GITHUB_TOKEN is required for publication discovery')
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + route,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Akiva-Tzidkat-Download-Refresh'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def latest_publication(repo):
    publishers = {}
    for workflow in Path(repo, '.github/workflows').glob('*.yml'):
        label = ''
        for line in workflow.read_text().splitlines():
            if line.lstrip().startswith('- name:'):
                label = line.split('- name:', 1)[1].strip()
            if 'uses: actions/deploy-pages@' in line:
                require(label, 'Unnamed Pages deployment step')
                publishers.setdefault('.github/workflows/' + workflow.name, set()).add(label)
    current_run = os.environ.get('GITHUB_RUN_ID')
    attempt = int(os.environ.get('GITHUB_RUN_ATTEMPT', '1'))
    candidates = []
    def deployed(run):
        jobs = api(f"/actions/runs/{run['id']}/jobs?filter=all&per_page=100")['jobs']
        steps = [step for job in jobs if str(run['id']) != current_run or job['run_attempt'] < attempt
                 for step in job.get('steps', [])
                 if step['name'] in publishers[run['path']] and step['conclusion'] == 'success']
        if steps:
            return max(step['completed_at'] for step in steps), run
        return None
    # Creation order is not deployment order: an old run can be rerun today.
    # Enumerate each publisher's complete available history, not merely the
    # first page containing a successful deployment. Separate workflow queries
    # also avoid the cross-workflow 1,000-result search window in busy repos.
    all_runs = {}
    for workflow in publishers:
        seen = 0
        for page in range(1, 101):
            response = api(f'/actions/workflows/{Path(workflow).name}/runs?branch=main&per_page=100&page={page}')
            runs = response['workflow_runs']
            seen += len(runs)
            for run in runs:
                require(run['path'] == workflow, 'Workflow history has a different publisher path')
                all_runs[run['id']] = run
            if len(runs) < 100:
                require(seen >= response['total_count'], 'Publisher history is truncated; cannot identify the actual latest deployment')
                break
        else:
            raise ValueError('Publisher history exceeds the complete discovery window; refusing an assumed baseline')
    eligible = [run for run in all_runs.values() if run['conclusion'] != 'skipped'
                and ((str(run['id']) != current_run and run['status'] == 'completed')
                     or (str(run['id']) == current_run and attempt > 1))]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        candidates.extend(result for result in pool.map(deployed, eligible) if result)
    require(candidates, 'No actual successful Pages deployment found; refusing a historical rebuild')
    deployed_at, run = max(candidates, key=lambda item: item[0])
    artifacts = api(f"/actions/runs/{run['id']}/artifacts?per_page=100")['artifacts']
    eligible = [item for item in artifacts if item['name'] == 'github-pages' and not item['expired']
                and item['created_at'] <= deployed_at]
    require(eligible, 'The latest deployed artifact is unavailable; refusing an older publication')
    artifact = max(eligible, key=lambda item: item['created_at'])
    return {'runId': run['id'], 'headSha': run['head_sha'], 'artifactId': artifact['id'],
            'digest': artifact.get('digest'), 'bytes': artifact['size_in_bytes'], 'deployedAt': deployed_at}


def public_info(name):
    request = urllib.request.Request(PUBLIC + name + '?tzidkat_download_check=' + str(time.time_ns()),
        headers={'Cache-Control': 'no-cache', 'User-Agent': 'Akiva-Tzidkat-Download-Refresh'})
    with urllib.request.urlopen(request, timeout=60) as response:
        require(response.status == 200, 'Public file unavailable: ' + name)
        h, size = hashlib.sha256(), 0
        for part in iter(lambda: response.read(1024 * 1024), b''):
            h.update(part)
            size += len(part)
        return {'bytes': size, 'sha256': h.hexdigest()}


def guard(args, state):
    require(api('/git/ref/heads/main')['object']['sha'] == state['expectedHead'], 'Main advanced; preserve intervening work')
    require(latest_publication(args.repo)['artifactId'] == state['publication']['artifactId'], 'A newer site is live; restore that artifact')
    names = sorted(ALLOWED | {FINAL_REPORT, 'library/index.html', 'library/sw.js', SOURCE_CHAPTER,
                              'library/data/files.json', 'library/connected-ideas/catalog.json'})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for name, actual in zip(names, pool.map(public_info, names)):
            require(actual == state['files'][name], 'Public baseline changed: ' + name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('plan', 'metadata', 'restore', 'apply', 'verify', 'guard', 'published', 'require-refreshed'))
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--root', type=Path, default=Path('.tzidkat-download-refresh-site'))
    parser.add_argument('--descriptor', type=Path, default=Path(DESCRIPTOR))
    parser.add_argument('--docx', type=Path, default=Path(DOCX_INPUT))
    parser.add_argument('--approval', type=Path, default=Path(APPROVAL_INPUT))
    parser.add_argument('--evidence', type=Path, default=Path('tzidkat-download-refresh-evidence'))
    parser.add_argument('--candidate', type=Path, default=Path('.tzidkat-download-refresh-candidate'))
    parser.add_argument('--artifact-tar', type=Path)
    parser.add_argument('--source-only', action='store_true', help='Publish the independent note4031 predecessor before Word QA finishes')
    args = parser.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=True)
    meta, state_file = args.evidence / 'publication.json', args.evidence / 'baseline.json'
    if args.mode == 'plan':
        descriptor, output, baseline = make_plan(args.root, args.docx, args.approval)
        require(not args.candidate.exists() or not any(args.candidate.iterdir()), 'Candidate output must be empty')
        for name, raw in output.items():
            file = local(args.candidate, name)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(raw)
        write_json(args.descriptor, descriptor)
        args.descriptor.with_suffix(args.descriptor.suffix + '.sha256').write_text(file_info(args.descriptor)['sha256'] + '\n')
        write_json(args.evidence / 'plan.json', {'descriptor': file_info(args.descriptor),
            'fullSealedPublicFiles': len(baseline), 'changedFiles': descriptor['files'],
            'archives': [{k: v for k, v in archive.items() if k != 'members'} for archive in descriptor['archives']],
            'status': 'prepared-for-independent-review'})
        print(json.dumps({'status': 'prepared-for-independent-review', 'files': descriptor['files'],
                          'descriptorSha256': file_info(args.descriptor)['sha256']}, indent=2))
        return
    descriptor = load_source_descriptor(args.repo) if args.source_only else load_descriptor(args)
    descriptor_file = args.repo / SOURCE_DESCRIPTOR if args.source_only else args.descriptor
    if args.mode == 'metadata':
        expected = os.environ.get('GITHUB_SHA')
        require(expected and api('/git/ref/heads/main')['object']['sha'] == expected, 'Main changed before capture')
        state = {'expectedHead': expected, 'publication': latest_publication(args.repo),
                 'descriptorSha256': file_info(descriptor_file)['sha256'], 'sourceOnly': args.source_only}
        write_json(meta, state)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f"artifact={state['publication']['artifactId']}\nrun={state['publication']['runId']}\n")
        print(json.dumps(state, indent=2))
    elif args.mode == 'restore':
        require(args.artifact_tar and args.artifact_tar.is_file(), 'Missing complete Pages artifact')
        require(not args.root.exists(), 'Restoration target must be new')
        state = read_json(meta)
        args.root.mkdir(parents=True)
        with tarfile.open(args.artifact_tar, 'r:') as source:
            members = source.getmembers()
            root = args.root.resolve()
            for member in members:
                target = (root / member.name).resolve()
                require(target == root or root in target.parents, 'Unsafe artifact path')
                require(member.isdir() or member.isfile(), 'Artifact contains a link or special file')
            source.extractall(root, members=members, filter='data')
        state['artifactTar'] = file_info(args.artifact_tar)
        state['files'] = inventory(args.root)
        baseline = sealed_inventory(args.root, include_source=not args.source_only)
        before = all(state['files'].get(item['path']) == item['before'] for item in descriptor['files'])
        if before:
            require(state['files'] == baseline, 'Restored artifact differs from the complete reviewed content seal')
        else:
            (verify_source_actual if args.source_only else verify_actual)(args.root, descriptor)
        state['alreadyRefreshed'] = not before
        write_json(state_file, state)
        guard(args, state)
        print(json.dumps({'restoredFiles': len(state['files']), 'alreadyRefreshed': not before}))
    elif args.mode == 'apply':
        state = read_json(state_file)
        require(file_info(descriptor_file)['sha256'] == state['descriptorSha256'], 'Descriptor changed after capture')
        require(state['sourceOnly'] == args.source_only, 'Publication mode changed after capture')
        require(inventory(args.root) == state['files'], 'Site changed after capture')
        if not state['alreadyRefreshed']:
            if args.source_only:
                subprocess.run(['node', str(args.repo / 'scripts/publish-tzidkat-source-addition.mjs'),
                    '--apply', '--root', str(args.root.resolve()), '--evidence', str(args.evidence.resolve())], check=True, timeout=300)
            else:
                candidate, output, _ = make_plan(args.root, args.docx, args.approval)
                require(candidate == descriptor, 'Recomputed transition differs from the independently reviewed plan')
                for name, raw in output.items():
                    local(args.root, name).write_bytes(raw)
        report = (verify_source_actual if args.source_only else verify_actual)(args.root, descriptor)
        report.update({'publication': state['publication'], 'descriptorSha256': state['descriptorSha256'],
                       'alreadyRefreshed': state['alreadyRefreshed']})
        write_json(args.evidence / 'verification.json', report)
        print(json.dumps({k: v for k, v in report.items() if k != 'archives'}, indent=2))
    elif args.mode in ('verify', 'require-refreshed'):
        try:
            report = (verify_source_actual if args.source_only else verify_actual)(args.root, descriptor)
        except Exception as error:
            if args.mode == 'require-refreshed':
                raise ValueError('Historical rebuild would roll back the approved downloads. Use the download-preserving artifact workflow; do not bypass this gate. ' + str(error)) from error
            raise
        write_json(args.evidence / 'verification.json', report)
        print(json.dumps({'ok': True, 'release': descriptor['release'], 'preservedPublicFiles': report['preservedPublicFiles']}))
    elif args.mode == 'guard':
        guard(args, read_json(state_file))
        print('Current main and complete public baseline remain unchanged.')
    elif args.mode == 'published':
        expected = {item['path']: item['after'] for item in descriptor['files']}
        # The final report and all 264 chapters are also read back. Their hashes
        # prove the download-only deployment kept the live reader content.
        baseline = sealed_inventory(args.root)
        for name in [FINAL_REPORT, 'library/index.html', 'library/sw.js',
                     'library/data/files.json', 'library/connected-ideas/catalog.json']:
            expected[name] = baseline[name]
        for section in range(264):
            name = f'library/data/{SLUG}/{section}.json'
            expected[name] = baseline[name]
        pending, verified = dict(expected), {}
        for attempt in range(12):
            def check(name):
                try:
                    return name, public_info(name)
                except Exception:
                    return name, None
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                for name, actual in pool.map(check, list(pending)):
                    if actual == pending[name]:
                        verified[name] = actual
                        del pending[name]
            if not pending:
                break
            if attempt < 11:
                time.sleep(10)
        report = {'ok': not pending, 'release': descriptor['release'], 'verifiedPublicFiles': verified,
                  'pending': pending, 'descriptorSha256': file_info(descriptor_file)['sha256']}
        write_json(args.evidence / 'live-verification.json', report)
        require(not pending, 'Some public files do not match the approved refresh: ' + ', '.join(pending))
        print(json.dumps({'ok': True, 'verifiedPublicFiles': len(verified), 'readerChapters': 264}))


if __name__ == '__main__':
    main()

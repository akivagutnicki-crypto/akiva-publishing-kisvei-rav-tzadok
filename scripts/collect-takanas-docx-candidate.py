"""Collect a bounded, downloadable release review packet; never deploy it.

Install as scripts/collect-takanas-docx-candidate.py. Publisher report contract:
library/takanas-docx-master-20261102.json, affected=[{name,sha256,...}].
Both ZIPs must be affected and present in the preserved successor site. Large
ZIPs can be omitted from this review packet only; their exact hashes remain in
candidate.json. The complete successor is still uploaded for main publication.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil

SITE = Path(os.environ.get('NEW_BOOKS_SITE', '.takanas-docx-site'))
OUT = Path('artifacts/takanas-docx-candidate')
REPORT = 'library/takanas-docx-master-20261102.json'
ARCHIVES = {'library/downloads/books/takanat-hashavin.zip',
            'library/downloads/rav-tzadok-library.zip'}
MAX_PACKET_BYTES = 400 * 1024 * 1024
MAX_OPTIONAL_ARCHIVE = 180 * 1024 * 1024
MAX_SEPARATE_PROOF_BYTES = 40 * 1024 * 1024


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def checked_path(root, relative):
    assert relative and not Path(relative).is_absolute()
    assert all(p not in ('', '.', '..') for p in relative.split('/'))
    file = root / relative
    assert file.is_file() and not file.is_symlink(), 'Missing regular file: ' + str(file)
    assert file.resolve().is_relative_to(root.resolve())
    return file


report = json.loads(checked_path(SITE, REPORT).read_text())
affected = report['affected']
assert isinstance(affected, list) and affected
names = [row['name'] for row in affected]
assert len(names) == len(set(names)), 'Repeated affected path'
assert ARCHIVES <= set(names), 'Both refreshed archive paths must be in the publisher report'
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)
rows = []
total = 0
for row in affected + [{'name': REPORT, 'sha256': digest(SITE / REPORT)}]:
    file = checked_path(SITE, row['name'])
    actual = digest(file)
    assert actual == row['sha256'], 'Publisher report hash differs: ' + row['name']
    size = file.stat().st_size
    is_archive = row['name'] in ARCHIVES
    include = not is_archive or (size <= MAX_OPTIONAL_ARCHIVE and total + size < MAX_PACKET_BYTES)
    if include:
        assert total + size < MAX_PACKET_BYTES, 'Required review files exceed bounded packet size'
        target = OUT / 'successor' / row['name']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
        total += size
    rows.append({'name': row['name'], 'bytes': size, 'sha256': actual,
                 'included': include,
                 'omission': None if include else 'Optional archive exceeds bounded review-packet allocation; complete successor retains verified bytes'})
for name in ['new-books-publication.json', 'new-books-baseline.json',
             'artifacts/takanas-docx-master/source-context.json']:
    file = checked_path(Path('.'), name)
    target = OUT / 'evidence' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(file, target)
    total += file.stat().st_size
source = checked_path(Path('.'), 'sources/akiva/Takanat_HaShavin.json')
target = OUT / 'source' / source.name
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, target)
total += source.stat().st_size
assert total < MAX_PACKET_BYTES, 'Review packet including evidence is too large'
proof_root = Path('artifacts/takanas-docx-master')
proof_files = list(proof_root.rglob('*'))
assert all(not p.is_symlink() for p in proof_files), 'Unexpected proof symlink'
proof_bytes = sum(p.stat().st_size for p in proof_files if p.is_file())
assert proof_bytes < MAX_SEPARATE_PROOF_BYTES, 'Separate proof files exceed bounded artifact allocation'
packet = {'schemaVersion': 1, 'candidateOnly': True,
          'sourceHead': os.environ['GITHUB_SHA'], 'sourceRef': os.environ['GITHUB_REF'],
          'publisherReport': REPORT, 'includedBytes': total,
          'separateProofBytes': proof_bytes,
          'canonicalSourceSha256': digest(source),
          'publication': json.loads(Path('new-books-publication.json').read_text()),
          'files': rows}
(OUT / 'candidate.json').write_text(json.dumps(packet, indent=2) + '\n')
print(json.dumps({'candidate': str(OUT), 'includedBytes': total,
                  'includedFiles': sum(r['included'] for r in rows),
                  'omittedOptionalArchives': [r['name'] for r in rows if not r['included']]}))

#!/usr/bin/env python3
"""Reassemble the reviewed source-quotation package from immutable Git blobs.

The part manifest checks transport integrity. The independent publication
verifier additionally pins the SHA-256 of the complete reviewed gzip package.
No decompression or re-encoding occurs while the original bytes are assembled.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


RELEASE = '20261019-source-quotations'
FILENAME = 'source-quotations-20261019.json.gz'
PART_SIZE = 512 * 1024
REPO = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO / 'sources/akiva/overlays' / FILENAME


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(contents):
    return hashlib.sha256(contents).hexdigest()


def materialize(parts_directory, output):
    check(not parts_directory.is_symlink() and parts_directory.is_dir(), 'Missing regular payload-parts directory')
    manifest_path = parts_directory / 'manifest.json'
    check(manifest_path.is_file() and not manifest_path.is_symlink(), 'Missing regular part manifest')
    manifest = json.loads(manifest_path.read_bytes())
    check(manifest.get('schemaVersion') == 1 and manifest.get('release') == RELEASE,
          'The part manifest identifies an unknown release')
    check(manifest.get('filename') == FILENAME and manifest.get('partSize') == PART_SIZE,
          'The part manifest identifies an unexpected payload format')
    check(type(manifest.get('bytes')) is int and manifest['bytes'] > 0, 'Invalid payload length')
    check(isinstance(manifest.get('sha256'), str) and re.fullmatch(r'[0-9a-f]{64}', manifest['sha256']),
          'Invalid complete-payload SHA-256')
    parts = manifest.get('parts')
    check(isinstance(parts, list) and parts, 'Payload has no ordered transport parts')
    check(len(parts) == (manifest['bytes'] + PART_SIZE - 1) // PART_SIZE, 'Incorrect payload part count')
    expected_names = {'manifest.json'}
    for index, part in enumerate(parts):
        name = f'part-{index:04d}.bin'
        check(part.get('path') == name, 'Payload part order or name differs: ' + name)
        check(isinstance(part.get('sha256'), str) and re.fullmatch(r'[0-9a-f]{64}', part['sha256']),
              'Invalid part SHA-256: ' + name)
        size = PART_SIZE if index + 1 < len(parts) else manifest['bytes'] - PART_SIZE * index
        check(type(part.get('bytes')) is int and part['bytes'] == size, 'Incorrect part length: ' + name)
        expected_names.add(name)
    check({item.name for item in parts_directory.iterdir()} == expected_names,
          'The transport directory contains missing or unlisted files')
    check(not output.is_symlink() and (not output.exists() or output.is_file()), 'Payload output is not a regular file')
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix='.source-quotations-assembled-', dir=output.parent)
    temporary = Path(temporary_name)
    digest = hashlib.sha256()
    total = 0
    try:
        with os.fdopen(descriptor, 'wb') as destination:
            for part in parts:
                path = parts_directory / part['path']
                check(path.is_file() and not path.is_symlink(), 'Missing regular transport part: ' + part['path'])
                contents = path.read_bytes()
                check(len(contents) == part['bytes'] and sha(contents) == part['sha256'],
                      'Transport part fails its size or SHA-256 check: ' + part['path'])
                digest.update(contents)
                total += len(contents)
                destination.write(contents)
            destination.flush()
            os.fsync(destination.fileno())
        check(total == manifest['bytes'] and digest.hexdigest() == manifest['sha256'],
              'The assembled gzip differs from the complete reviewed transport package')
        mode = 'already-materialized' if output.is_file() and sha(output.read_bytes()) == manifest['sha256'] else 'write'
        if mode == 'write':
            os.replace(temporary, output)
        return {'ok': True, 'mode': mode, 'release': RELEASE, 'output': str(output),
                'parts': len(parts), 'bytes': total, 'sha256': digest.hexdigest()}
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parts', default=str(DEFAULT_OUTPUT) + '.parts')
    parser.add_argument('--output', default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    try:
        result = materialize(Path(args.parts), Path(args.output))
    except Exception as error:
        raise SystemExit('Source-quotation assembly failed: ' + str(error)) from error
    print(json.dumps(result))


if __name__ == '__main__':
    main()

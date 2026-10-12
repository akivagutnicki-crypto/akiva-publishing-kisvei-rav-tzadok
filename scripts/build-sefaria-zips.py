#!/usr/bin/env python3
"""Build four complete, licensed-source ZIPs from Sefaria's public bulk exports.

The checked-in index records every available edition and schema. Source bytes
are cached locally, validated, and copied unchanged; missing files fail the
build rather than publishing a truncated collection.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
from pathlib import Path
import re
import threading
import time
import urllib.parse
import zipfile
import requests

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'sources/akiva/packs'
DEFINITIONS = {
    'tanakh': ('Tanach + meforshim', ['Tanakh']),
    'shas': ('Talmud Bavli + meforshim', ['Talmud', 'Bavli']),
    'yerushalmi': ('Talmud Yerushalmi + meforshim', ['Talmud', 'Yerushalmi']),
    'midrash': ('Midrashim + meforshim', ['Midrash']),
}
SESSIONS = threading.local()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(title):
    stem = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:90] or 'text'
    return stem + '-' + digest(title.encode())[:10]


def select_books(books, prefix):
    selected = {b['title']: b for b in books if b['categories'][:len(prefix)] == prefix}
    while True:
        additions = [b for b in books if b.get('dependence') and b['title'] not in selected
                     and any(t in selected for t in b.get('base_text_titles', []))]
        if not additions:
            return list(selected.values())
        selected.update({b['title']: b for b in additions})


def check_source(data, job):
    value = json.loads(data)
    if value.get('title') != job['title'] or value.get('error'):
        raise ValueError('Wrong source title: ' + job['title'])
    if job['kind'] == 'schema':
        if not value.get('schema'):
            raise ValueError('Missing schema: ' + job['title'])
    else:
        # Export filenames omit characters that are invalid on common file
        # systems. The JSON retains the actual, unsanitized edition title.
        exported_title = re.sub(r'[/:()<>"|?*\r\n\t\\]', '', value.get('versionTitle', ''))
        if 'text' not in value or exported_title != job['versionTitle']:
            raise ValueError('Missing or wrong edition: ' + job['title'])
        if value.get('language') != {'Hebrew': 'he', 'English': 'en'}[job['language']]:
            raise ValueError('Wrong edition language: ' + job['title'])
    return value


def source_file(job, cache):
    url = job['url']
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.netloc != 'storage.googleapis.com' or not parsed.path.startswith('/sefaria-export/'):
        raise ValueError('Unexpected source URL')
    path = cache / (digest(url.encode()) + '.json')
    if path.exists():
        try:
            data = path.read_bytes()
            check_source(data, job)
            return job, path, digest(data)
        except (ValueError, KeyError):
            pass
    failure = None
    for attempt in range(4):
        try:
            if not hasattr(SESSIONS, 'http'):
                SESSIONS.http = requests.Session()
            with SESSIONS.http.get(url, timeout=90) as response:
                response.raise_for_status()
                data = response.content
            check_source(data, job)
            temporary = path.with_suffix('.tmp')
            temporary.write_bytes(data)
            temporary.replace(path)
            return job, path, digest(data)
        except Exception as error:
            failure = error
            if attempt < 3:
                time.sleep(attempt + 1)
    raise RuntimeError(job['title'] + ': ' + str(failure)) from failure


def build(selected_ids, cache, output):
    snapshot = json.loads(gzip.decompress((SOURCE / 'exports.json.gz').read_bytes()))
    collections = {key: select_books(snapshot['books'], DEFINITIONS[key][1]) for key in selected_ids}
    jobs = {}
    for books in collections.values():
        for book in books:
            jobs[book['schema_url']] = {'kind': 'schema', 'title': book['title'], 'url': book['schema_url']}
            for version in book['versions']:
                jobs[version['json_url']] = {'kind': 'version', 'title': book['title'], 'url': version['json_url'], **version}
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    sources = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        pending = [pool.submit(source_file, job, cache) for job in jobs.values()]
        for count, result in enumerate(concurrent.futures.as_completed(pending), 1):
            job, path, sha = result.result()
            sources[job['url']] = (path, sha)
            if count % 100 == 0 or count == len(jobs):
                print(f'Sefaria exports: {count:,}/{len(jobs):,} files verified', flush=True)
    manifest = {'revision': snapshot['revision'], 'source': snapshot['source'],
                'sourceDate': snapshot['generated_at'], 'collections': {}}
    for key, books in collections.items():
        title, prefix = DEFINITIONS[key]
        all_books = select_books(snapshot['books'] + snapshot['unavailable'], prefix)
        available_titles = {b['title'] for b in books}
        unavailable = [b for b in all_books if b['title'] not in available_titles]
        description = {'id': key, 'title': title, 'source': snapshot['source'],
                       'sourceDate': snapshot['generated_at'], 'revision': snapshot['revision'],
                       'complete': True, 'missing': [], 'books': [],
                       'notInPublicExport': [b['title'] for b in unavailable]}
        filename = key + '-with-meforshim.zip'
        temporary = output / (filename + '.tmp')
        records = []
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for book in books:
                slug = safe_name(book['title'])
                item = {k: v for k, v in book.items() if k not in {'versions', 'schema_url'}}
                item['files'] = []
                entries = [(book['schema_url'], 'schemas/' + slug + '.json', None)]
                entries.extend((v['json_url'], 'texts/' + slug + '/' + v['language'] + '/'
                                + safe_name(v['versionTitle']) + '.json', v) for v in book['versions'])
                for url, archive_path, version in entries:
                    path, sha = sources[url]
                    archive.write(path, archive_path)
                    record = {'file': archive_path, 'sourceURL': url, 'bytes': path.stat().st_size, 'sha256': sha}
                    if version:
                        value = json.loads(path.read_bytes())
                        record.update({'language': version['language'], 'versionTitle': value['versionTitle'],
                                       'license': value.get('license'), 'versionSource': value.get('versionSource')})
                    records.append(record)
                    item['files'].append(record)
                description['books'].append(item)
            commentaries = sum(bool(b.get('dependence')) for b in books)
            versions = sum(len(b['versions']) for b in books)
            readme = (f'{title}\n\n{len(books):,} works, including {commentaries:,} meforshim/Targum; '
                      f'{versions:,} Hebrew and English edition files.\n\n'
                      'These are complete source export files, copied byte for byte from Sefaria\'s\n'
                      'official public dataset. Every publicly exported edition is included, with\n'
                      'its original text, introductions, schema, version attribution and license\n'
                      'metadata. Some source editions are partial; no additional text is invented.\n\n'
                      'Open texts/<book>/<language>/<edition>.json to read the structured text.\n'
                      'Complex works keep all named nodes in their text object. schemas/ contains\n'
                      'the full book structures. manifest.json maps every title and edition to its\n'
                      'file, source URL and SHA-256 checksum.\n\n'
                      f'Official export index: {snapshot["generated_at"]}\n'
                      f'Source: {snapshot["source"]}\n\n'
                      'Each edition has its own license; retain its attribution and observe its\n'
                      'license terms. See SEFARIA-LICENSE.md and each edition\'s license field.\n'
                      'Titles not provided in the public export are listed explicitly in the\n'
                      'manifest. This ZIP contains every available public export for this pack.\n')
            archive.writestr('README.txt', readme)
            archive.writestr('SEFARIA-LICENSE.md', (SOURCE / 'SEFARIA-LICENSE.md').read_bytes())
            archive.writestr('manifest.json', json.dumps(description, ensure_ascii=False, indent=2))
        # Verify every byte after compression; never publish a corrupt/incomplete ZIP.
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('ZIP CRC failed: ' + key)
            for record in records:
                if digest(archive.read(record['file'])) != record['sha256']:
                    raise RuntimeError('ZIP source mismatch: ' + record['file'])
            if len(archive.namelist()) != len(records) + 3:
                raise RuntimeError('ZIP inventory mismatch: ' + key)
        temporary.replace(output / filename)
        archive_path = output / filename
        manifest['collections'][key] = {'id': key, 'title': title, 'file': 'downloads/collections/' + filename,
                                        'books': len(books), 'commentaries': commentaries, 'versions': versions,
                                        'bytes': archive_path.stat().st_size, 'sha256': digest(archive_path.read_bytes()),
                                        'unavailable': len(unavailable)}
        print(f'{title}: {len(books):,} works, {commentaries:,} meforshim, '
              f'{archive_path.stat().st_size / 1048576:.1f} MB ZIP; all source bytes verified', flush=True)
    (output / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collection', choices=DEFINITIONS, action='append')
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache/sefaria-export')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/library/downloads/collections')
    arguments = parser.parse_args()
    build(arguments.collection or list(DEFINITIONS), arguments.cache, arguments.output)

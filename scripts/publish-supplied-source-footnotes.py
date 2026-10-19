#!/usr/bin/env python3
"""Apply the independently reviewed source-quotation successor edition.

The historical build and its publication checks run first. This pass changes
only the explicitly recorded footnote arrays, refreshes the reader cache, and
enables exact independently reviewed source URLs as clickable source links.
Every preimage is checked before a file is written; excluded books are pinned.
"""
import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.parse

PAYLOAD = Path('sources/akiva/overlays/source-quotations-20261019.json.gz')
REPORT = 'supplied-source-footnotes-report.json'
RELEASE = '20261019-source-quotations'
EXCLUDED = {'resisei-layla', 'takanat-hashavin', 'dover-tzedek'}
STANDARD_SOURCE_URL = re.compile(
    r'^https://(?:(?:www\.)?sefaria\.org|voices\.sefaria\.org|'
    r'(?:www\.)?chabad\.org|(?:www\.)?nli\.org\.il|'
    r'(?:www\.)?hebrewbooks\.org|he\.wikisource\.org)/[^<>\s\"\']+$', re.I)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def serialized(value, newline=True):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + ('\n' if newline else '')).encode()


def without_notes(value):
    if isinstance(value, list):
        return [without_notes(item) for item in value]
    if isinstance(value, dict):
        return {key: without_notes(item) for key, item in value.items() if key != 'footnotes'}
    return value


def count_notes(value):
    if isinstance(value, list):
        return sum(count_notes(item) for item in value)
    if isinstance(value, dict):
        return len(value.get('footnotes', [])) + sum(count_notes(item) for key, item in value.items() if key != 'footnotes')
    return 0


def block_at(value, indices):
    for index in indices:
        value = value[index]
    assert isinstance(value, dict) and isinstance(value.get('footnotes'), list), 'Missing footnote owner'
    return value


def safe_path(root, name):
    parts = Path(name).parts
    assert name and not Path(name).is_absolute() and '..' not in parts and '\\' not in name, name
    target = root.joinpath(*parts)
    current = root
    for part in parts:
        current = current / part
        assert not current.is_symlink(), f'Symlink in publication path: {name}'
    return target


def data_inventory(root):
    result = {}
    for file in sorted((root / 'data').rglob('*')):
        assert not file.is_symlink(), f'Symlink in data: {file}'
        if file.is_file():
            name = file.relative_to(root).as_posix()
            if name != 'data/files.json':
                result[name] = sha(file.read_bytes())
    return result


def reviewed_external_source_urls(payload):
    """Enable only exact final links backed by a verified source restoration."""
    reviewed = {(record['path'], record.get('sourceSha256'))
                for record in payload.get('quotationRestorations', [])
                if record.get('verified') is True and record.get('sourceSha256')}
    result = set()
    for entry in payload['files']:
        for block in entry['blocks']:
            for note in block['after']:
                for source in note.get('sources', []):
                    url = source.get('url')
                    assert isinstance(url, str), 'Missing source URL'
                    if re.fullmatch(r'#/read/[^<>\s\"\']+', url) or STANDARD_SOURCE_URL.fullmatch(url):
                        continue
                    parsed = urllib.parse.urlsplit(url)
                    assert (parsed.scheme == 'https' and parsed.hostname and not parsed.username
                            and not parsed.password and not re.search(r'[<>\s\"\'\\\x00-\x1f\x7f]', url)), \
                        'Invalid reviewed source URL: ' + url
                    evidence = note.get('provenance', {}).get('sourceQuotationRelease', {})
                    assert evidence.get('release') == RELEASE and \
                        (entry['path'], evidence.get('sourceSha256')) in reviewed, \
                        'Additional source URL lacks verified quotation evidence: ' + url
                    result.add(url)
    return sorted(result)


def source_url_rule(urls):
    return ('/* Verified primary source URLs */ ' +
            json.dumps(urls, ensure_ascii=True, separators=(',', ':')) +
            ".includes(String(url || '')) || ")


def patch_shell(html, sw, revision, books, reviewed_urls):
    source_marker = 'const safeFootnoteUrl = url => '
    assert html.count(source_marker) == 1, 'Unrecognized reader source-link validation'
    assert 'Verified primary source URLs' not in html and 'Verified Pardes source scan' not in html, \
        'Use the verified historical reader before enabling the reviewed source links'
    html = html.replace(source_marker, source_marker + source_url_rule(reviewed_urls), 1)
    marker = 'const editionDataUrl = url => '
    assert html.count(marker) == 1, 'Unrecognized reader data loader'
    html = re.sub(r'/\* Supplied source quotation revision \*/[^\n]*\n', '', html)
    selectors = [f"url.startsWith('data/{book}/')" for book in books]
    selectors += ["url === 'data/files.json'"]
    html = html.replace(marker, marker + '/* Supplied source quotation revision */ (' + ' || '.join(selectors) +
        f") ? url + (url.includes('?') ? '&' : '?') + 'edition={revision}' :\n", 1)
    assert len(re.findall(r'const SHELL = `[^`]+`;', sw)) == 1, 'Unrecognized service-worker shell'
    sw = re.sub(r'const SHELL = `([^`]+)`;', lambda match: 'const SHELL = `' +
        re.sub(r'-source-quotations-[a-f0-9]+', '', match[1]) + '-source-quotations-' + revision.rsplit('-', 1)[1] + '`;', sw)
    route = "    } else if (rel.startsWith('data/')) {"
    assert sw.count(route) == 1, 'Unrecognized service-worker data route'
    assert 'ignoreSearch: true' in sw, 'Offline downloaded-pack fallback is required'
    assert 'Supplied source quotation network refresh.' not in sw, 'Use a fresh historical build before applying a successor edition'
    book_routes = ' || '.join(f"rel.startsWith('data/{book}/')" for book in sorted(books))
    sw = sw.replace(route,
        f"    }} else if (rel.startsWith('data/') && (url.searchParams.get('edition') === '{revision}' || {book_routes})) {{\n"
        "      // Supplied source quotation network refresh.\n"
        "      event.respondWith(networkFirst(request, DATA));\n" + route, 1)
    original_fallback = ("    const hit = (await cache.match(request, { ignoreVary: true }))\n"
                         "      || (!hasExplicitEdition(request) && await cache.match(request, { ignoreVary: true, ignoreSearch: true }));")
    assert sw.count(original_fallback) == 1, 'Unrecognized downloaded-pack cache fallback'
    sw = sw.replace(original_fallback,
        "    // Prefer current ZIP-installed data before older edition-query entries.\n"
        "    const canonicalDataUrl = new URL(request.url);\n"
        "    canonicalDataUrl.search = '';\n"
        "    const hit = (await cache.match(request, { ignoreVary: true })) ||\n"
        "      (!hasExplicitEdition(request) && cacheName === DATA ? await cache.match(canonicalDataUrl.href, { ignoreVary: true }) : null) ||\n"
        "      (!hasExplicitEdition(request) && await cache.match(request, { ignoreVary: true, ignoreSearch: true }));  // also texts saved by a download pack", 1)
    return html, sw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='dist/library')
    parser.add_argument('--payload', default=str(PAYLOAD))
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    payload_path = Path(args.payload)
    compressed = payload_path.read_bytes()
    payload = json.loads(gzip.decompress(compressed))
    assert payload['schemaVersion'] == 1 and payload['release'] == RELEASE
    assert set(payload['excludedBooks']) == EXCLUDED
    assert not set(payload['books']) & EXCLUDED
    reviewed_urls = reviewed_external_source_urls(payload)
    inventory_before = data_inventory(root)
    for entry in payload['protectedFiles']:
        assert inventory_before[entry['path']] == entry['sha256'], 'Protected edition changed: ' + entry['path']
    previous_report = root / REPORT
    if previous_report.exists():
        previous = json.loads(previous_report.read_text())
        if previous.get('payloadSha256') == sha(compressed):
            expected = {entry['path']: entry['afterSha256'] for entry in previous['files']}
            if previous.get('reviewedExternalSourceUrls') == reviewed_urls and expected == inventory_before and all(sha((root / entry['path']).read_bytes()) == entry['afterSha256'] for entry in previous['shellFiles']):
                print(json.dumps({'mode': 'already-applied', 'release': RELEASE, 'updatedNotes': previous['updatedNotes']}))
                return
        raise AssertionError('A different or stale successor report exists; start from the verified historical build')
    baseline = root / 'parallel-cleanup-report.json'
    assert baseline.is_file(), 'Historical cleanup publication proof is missing'
    baseline_report = json.loads(baseline.read_text())
    assert baseline_report.get('mode') == 'write' and baseline_report.get('assertions', {}).get('bodyUnchanged') is True
    plans = []
    changed = []
    books = {book: {'notesBefore': 0, 'notesAfter': 0, 'updatedNotes': 0, 'chapters': 0} for book in payload['books']}
    file_names = set()
    for entry in payload['files']:
        name = entry['path']
        assert name not in file_names, 'Duplicate patch path'
        file_names.add(name)
        parts = Path(name).parts
        assert len(parts) == 3 and parts[0] == 'data' and parts[1] in books and re.fullmatch(r'\d+(?:-\d+)*\.json', parts[2]), name
        path = safe_path(root, name)
        raw = path.read_bytes()
        assert sha(raw) == entry['beforeSha256'], 'Publication preimage differs: ' + name
        value = json.loads(raw)
        assert serialized(value, entry['beforeTrailingNewline']) == raw, 'Unknown source serialization: ' + name
        assert sha(canonical(without_notes(value))) == entry['bodySha256'], 'Body fingerprint differs: ' + name
        assert count_notes(value) == entry['notesBefore']
        updated = copy.deepcopy(value)
        seen_blocks = set()
        for block in entry['blocks']:
            key = tuple(block['path'])
            assert key not in seen_blocks, 'Duplicate block patch'
            seen_blocks.add(key)
            target = block_at(updated, block['path'])
            assert target['footnotes'] == block['before'], 'Footnote preimage differs: ' + name
            target['footnotes'] = copy.deepcopy(block['after'])
        after = serialized(updated)
        assert sha(after) == entry['afterSha256'], 'Footnote patch does not reproduce the reviewed payload: ' + name
        assert sha(canonical(without_notes(updated))) == entry['bodySha256'], 'Non-footnote text changed: ' + name
        assert count_notes(updated) == entry['notesAfter']
        plans.append((path, raw, after))
        changed.append({key: entry[key] for key in ['path', 'beforeSha256', 'afterSha256', 'bodySha256', 'notesBefore', 'notesAfter']})
    for name in inventory_before:
        parts = Path(name).parts
        if len(parts) == 3 and parts[1] in books and re.fullmatch(r'\d+(?:-\d+)*\.json', parts[2]):
            total = count_notes(json.loads((root / name).read_bytes()))
            books[parts[1]]['notesBefore'] += total
            books[parts[1]]['notesAfter'] += total
    for entry in payload['files']:
        stats = books[Path(entry['path']).parts[1]]
        stats['notesAfter'] += entry['notesAfter'] - entry['notesBefore']
        stats['chapters'] += 1
        stats['updatedNotes'] += entry.get('updatedNotes', 0)
    revision = RELEASE + '-' + sha(compressed)[:16]
    html_path, sw_path = root / 'index.html', root / 'sw.js'
    html_raw, sw_raw = html_path.read_bytes(), sw_path.read_bytes()
    html, sw = patch_shell(html_raw.decode(), sw_raw.decode(), revision, payload['books'], reviewed_urls)
    shell_files = []
    for path, before, after in [(html_path, html_raw, html.encode()), (sw_path, sw_raw, sw.encode())]:
        shell_files.append({'path': path.relative_to(root).as_posix(), 'beforeSha256': sha(before), 'afterSha256': sha(after)})
        plans.append((path, before, after))
    inventory_after = dict(inventory_before)
    inventory_after.update({entry['path']: entry['afterSha256'] for entry in changed})
    report = {
        'schemaVersion': 1, 'release': RELEASE, 'payloadFile': payload_path.as_posix(),
        'payloadSha256': sha(compressed), 'sourceArchive': payload['sourceArchive'],
        'baselineCleanupReportSha256': sha(baseline.read_bytes()), 'cacheRevision': revision,
        'beforeDataDigest': sha(canonical(inventory_before)), 'afterDataDigest': sha(canonical(inventory_after)),
        'matchedNotes': payload['matchedNotes'], 'updatedNotes': sum(entry['updatedNotes'] for entry in books.values()),
        'removedNotes': payload['removedNotes'], 'quotationRestorations': payload.get('quotationRestorations', []),
        'linkCorrections': payload.get('linkCorrections', []),
        'reviewedExternalSourceUrls': reviewed_urls,
        'exceptions': payload.get('exceptions', []), 'books': books, 'changedFiles': changed,
        'files': [{'path': name, 'beforeSha256': before, 'afterSha256': inventory_after[name]} for name, before in inventory_before.items()],
        'protectedFiles': payload['protectedFiles'], 'shellFiles': shell_files,
        'assertions': {'bodyUnchanged': True, 'excludedBooksUnchanged': True, 'onlyReviewedFootnoteArraysChanged': True,
            'noUnmatchedNotesImported': True, 'allInputsCheckedBeforeWriting': True, 'offlineFallbackPreserved': True,
            'verifiedPrimarySourceUrlsEnabled': True},
    }
    summary = {key: report[key] for key in ['release', 'matchedNotes', 'updatedNotes', 'books', 'cacheRevision']}
    summary['removedNotes'] = len(report['removedNotes'])
    summary['mode'] = 'write' if args.write else 'dry-run'
    if not args.write:
        print(json.dumps(summary, ensure_ascii=False))
        return
    staged = []
    written = []
    try:
        assert data_inventory(root) == inventory_before, 'Library changed during planning'
        for path, before, after in plans:
            assert path.read_bytes() == before, 'Input changed during planning'
            descriptor, temporary = tempfile.mkstemp(prefix='.source-quotations-', dir=path.parent)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(after)
            staged.append((path, before, Path(temporary)))
        for path, before, temporary in staged:
            os.replace(temporary, path)
            written.append((path, before))
        assert data_inventory(root) == inventory_after, 'Final library inventory differs'
        for entry in payload['protectedFiles']:
            assert sha((root / entry['path']).read_bytes()) == entry['sha256'], 'Excluded book changed'
        descriptor, temporary = tempfile.mkstemp(prefix='.source-quotation-report-', dir=root)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(json.dumps(report, ensure_ascii=False, indent=2).encode() + b'\n')
        os.replace(temporary, previous_report)
    except BaseException:
        for path, before in reversed(written):
            path.write_bytes(before)
        raise
    finally:
        for _, _, temporary in staged:
            temporary.unlink(missing_ok=True)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()

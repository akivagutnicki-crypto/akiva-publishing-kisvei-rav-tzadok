#!/usr/bin/env python3
"""Verify the supplied source-quotation edition and its complete predecessor.

The immutable payload contains full before/after annotation blocks. This check
replays that evidence independently of the publisher, reconstructs the exact
previous chapter bytes, and connects them to the already verified cleanup
publication. It never changes reader data or the historical publication proof.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import copy
import gzip
import hashlib
import html
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import urllib.parse
import urllib.request
import zipfile


REPO = Path(__file__).resolve().parent.parent
RELEASE = '20261019-source-quotations'
PAYLOAD = REPO / 'sources/akiva/overlays/source-quotations-20261019.json.gz'
# Set to the independently checked final compressed package before publication.
PAYLOAD_SHA256 = '55503757abcd26c07ddc42a1454b0e50269f85766e0eb712b931cdd2cd60bc99'
SOURCE_ARCHIVE_SHA256 = 'b5e8dbb8ab612980f523b65d3d38534672f7110dfb0504cdf8826c8e076c1689'
REPORT = 'supplied-source-footnotes-report.json'
BASELINE_REPORT = 'parallel-cleanup-report.json'
EXCLUDED = {'resisei-layla', 'takanat-hashavin', 'dover-tzedek'}
BOOKS = {
    'sefer-hazikhronot', 'tzidkat-hatzadik', 'peri-tzadik',
    'machshavot-charutz', 'divrei-soferim', 'yisrael-kedoshim',
    'likkutei-maamarim', 'sichat-malakhei-hasharet', 'sichat-shedim',
    'divrei-chalomot', 'et-haochel', 'ohr-zarua-latzadik',
    'kometz-haminchah', 'meshiv-hata-anah', 'meshiv-tzedek', 'poked-akarim',
}
CONTENT_FIELDS = {
    'paragraphs', 'sources', 'nativeConnections',
    'kisvei_rav_tzadok_parallel', 'kisvei_ishbitz_parallel',
    'ishbitz_parallel', 'rav_tzadok_parallel', 'parallels', 'reviewedParallelIds',
}
CHAPTER = re.compile(r'^\d+(?:-\d+)*\.json$')
SHA_PATTERN = re.compile(r'^[0-9a-f]{64}$')
SAFE_EXTERNAL = re.compile(
    r'^https://(?:(?:www\.)?sefaria\.org|voices\.sefaria\.org|'
    r'(?:www\.)?chabad\.org|(?:www\.)?nli\.org\.il|'
    r'(?:www\.)?hebrewbooks\.org|he\.wikisource\.org)/[^<>\s\"\']+$', re.I)


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')


def object_sha(value):
    return sha(canonical(value))


def compact(value, trailing_newline=True):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            + ('\n' if trailing_newline else '')).encode('utf-8')


def safe_relative(value):
    check(isinstance(value, str) and value and not any(c in value for c in '\\\0?#'),
          'Invalid artifact path: ' + repr(value))
    path = PurePosixPath(value)
    check(not path.is_absolute() and all(p not in ('', '.', '..') for p in value.split('/')),
          'Artifact path escapes the reader: ' + value)
    return value


def record_map(records, hash_field='sha256'):
    check(isinstance(records, list), 'Expected a publication record list')
    result = {}
    for record in records:
        path = safe_relative(record['path'])
        check(path not in result, 'Duplicate publication record: ' + path)
        digest = record[hash_field]
        check(isinstance(digest, str) and SHA_PATTERN.fullmatch(digest), 'Invalid hash: ' + path)
        result[path] = digest
    return result


def body_of(value):
    if isinstance(value, list):
        return [body_of(item) for item in value]
    if isinstance(value, dict):
        return {key: body_of(item) for key, item in value.items() if key != 'footnotes'}
    return value


def note_rows(value, prefix=()):
    """Yield exact item owners without treating source metadata as body items."""
    if isinstance(value, list):
        for index, item in enumerate(value):
            yield from note_rows(item, prefix + (index,))
    elif isinstance(value, dict) and 'footnotes' in value:
        check(isinstance(value['footnotes'], list), 'Footnotes must be an array')
        yield prefix, value


def note_count(value):
    return sum(len(row['footnotes']) for _, row in note_rows(value))


def locate(value, path):
    check(isinstance(path, list) and path, 'Missing annotation block path')
    for index in path:
        check(type(index) is int and index >= 0 and isinstance(value, list) and index < len(value),
              'Invalid annotation block index: ' + repr(path))
        value = value[index]
    check(isinstance(value, dict), 'Annotation block does not identify a reader item')
    return value


def note_key(note):
    for field in ('placementId', 'sourceId'):
        if isinstance(note.get(field), str) and note[field]:
            return field + ':' + note[field]
    check(type(note.get('number')) is int, 'A note has no stable identity')
    return 'number:' + str(note['number'])


def note_metadata(note, book):
    result = {key: value for key, value in note.items() if key not in CONTENT_FIELDS}
    if book == 'divrei-soferim':
        result.pop('number', None)
    return result


def verify_metadata(before, after, book, label):
    old = copy.deepcopy(note_metadata(before, book))
    new = copy.deepcopy(note_metadata(after, book))
    old_provenance = old.get('provenance')
    new_provenance = new.get('provenance')
    if isinstance(new_provenance, dict) and 'sourceQuotationRelease' in new_provenance:
        new_provenance.pop('sourceQuotationRelease')
        if old_provenance is None and not new_provenance:
            new.pop('provenance')
    if 'verificationNote' in old and 'verificationNote' not in new:
        check(isinstance(old['verificationNote'], str) and re.search(r'parallel', old['verificationNote'], re.I),
              'A nonparallel verification note was removed: ' + label)
        old.pop('verificationNote')
    check(old == new, 'An annotation identity, anchor or existing provenance changed: ' + label)
    correction = before.get('provenance', {}).get('sourceExcerptCorrection')
    if correction:
        check(isinstance(before.get('sources'), list) and before['sources'] and after.get('sources'),
              'A source-corrected note lost its source: ' + label)
        for field in ('ref', 'url'):
            check(before['sources'][0].get(field) == after['sources'][0].get(field),
                  'The previously corrected Resisei source target changed: ' + label)


def plain(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value)))


def utf16_prefix(value, offset):
    encoded = value.encode('utf-16-le')
    check(type(offset) is int and offset >= 0 and 2 * offset <= len(encoded), 'Invalid text offset')
    return encoded[:2 * offset].decode('utf-16-le')


def reviewed_external_source_urls(payload):
    """Independently derive the exact nonstandard URLs in verified final notes."""
    evidence_keys = {(record['path'], record.get('sourceSha256'))
                     for record in payload.get('quotationRestorations', [])
                     if record.get('verified') is True and record.get('sourceSha256')}
    urls = set()
    for file in payload['files']:
        for block in file['blocks']:
            for note in block['after']:
                for source in note.get('sources', []):
                    url = source.get('url')
                    check(isinstance(url, str), 'A final source URL is missing')
                    if safe_source(url):
                        continue
                    parsed = urllib.parse.urlsplit(url)
                    check(parsed.scheme == 'https' and parsed.hostname and not parsed.username
                          and not parsed.password and not re.search(r'[<>\s\"\'\\\x00-\x1f\x7f]', url),
                          'Invalid additional source URL: ' + url)
                    provenance = note.get('provenance', {}).get('sourceQuotationRelease', {})
                    check(provenance.get('release') == RELEASE
                          and (file['path'], provenance.get('sourceSha256')) in evidence_keys,
                          'Additional source URL is not supported by a verified restoration: ' + url)
                    urls.add(url)
    return sorted(urls)


def safe_source(url, reviewed_urls=()):
    return isinstance(url, str) and bool(
        re.fullmatch(r'#/read/[^<>\s\"\']+', url) or SAFE_EXTERNAL.fullmatch(url)
        or url in reviewed_urls)


def verify_note(note, item, label, reviewed_urls=()):
    check(isinstance(note, dict), 'Invalid note object: ' + label)
    check(type(note.get('number')) is int and note['number'] > 0, 'Invalid displayed note number: ' + label)
    check(note.get('verificationStatus') in ('verified', 'source text checked', 'supplied source text checked'),
          'A source note is not in its established active verification state: ' + label)
    for field in (CONTENT_FIELDS - {'paragraphs', 'sources'}) | {'crossReference', 'crossReferences', 'warnings'}:
        check(not note.get(field), 'An appended parallel or editorial connection remains: ' + label + ' ' + field)
    pairs = item.get('p')
    index = note.get('phraseIndex')
    check(isinstance(pairs, list) and type(index) is int and 0 <= index < len(pairs),
          'Missing Hebrew phrase: ' + label)
    pair = pairs[index]
    check(isinstance(pair, list) and len(pair) == 2, 'Incomplete Hebrew/English phrase: ' + label)
    for side, lang in enumerate(('he', 'en')):
        text = plain(pair[side])
        offset = note.get(lang + 'CharOffset')
        if lang == 'en' and offset is None:
            # The older Et HaOchel edition places Hebrew markers exclusively.
            # Exact preimage reconstruction still forbids dropping an anchor.
            check(label.startswith('data/et-haochel/') and note.get('enAnchorPrefix') is None,
                  'Missing established English anchor: ' + label)
            continue
        try:
            prefix = utf16_prefix(text, offset)
        except (AssertionError, UnicodeError) as error:
            raise AssertionError('Invalid ' + lang + ' text offset: ' + label) from error
        check(prefix == note.get(lang + 'AnchorPrefix'), 'The ' + lang + ' text anchor moved: ' + label)
    paragraphs = note.get('paragraphs')
    check(isinstance(paragraphs, list) and paragraphs, 'Empty source quotation: ' + label)
    clickable = []
    for paragraph in paragraphs:
        check(isinstance(paragraph, dict) and isinstance(paragraph.get('text'), str)
              and paragraph['text'].strip(), 'Blank source paragraph: ' + label)
        check(not re.search(r'\bContext and connection to\b|\bExplanation of the parallel\b|'
                            r'\bConnection to this footnote\b', paragraph['text'], re.I),
              'An appended editorial scaffold remains in the source quotation: ' + label)
        rich = paragraph.get('rich', [])
        if rich:
            check(isinstance(rich, list) and all(isinstance(run, dict) and isinstance(run.get('text'), str) for run in rich),
                  'Invalid rich source text: ' + label)
            check(''.join(run['text'] for run in rich) == paragraph['text'], 'Rich/plain source quotation differs: ' + label)
            for run in rich:
                if run.get('href'):
                    check(safe_source(run['href'], reviewed_urls), 'Source link cannot be opened by the reader: ' + label)
                    clickable.append(run['href'])
        for link in paragraph.get('links', []):
            check(safe_source(link.get('url'), reviewed_urls), 'Source link cannot be opened by the reader: ' + label)
            clickable.append(link['url'])
    sources = note.get('sources', [])
    check(isinstance(sources, list) and sources, 'Missing cited source: ' + label)
    for source in sources:
        check(isinstance(source, dict) and isinstance(source.get('ref'), str) and source['ref'].strip(),
              'Missing source reference: ' + label)
        check(safe_source(source.get('url'), reviewed_urls), 'Unusable cited source URL: ' + label)
    check(clickable, 'The footnote has no active source hyperlink: ' + label)
    check(any(re.search(r'[A-Za-z]{3}', paragraph['text']) for paragraph in paragraphs),
          'The source quotation lacks English text: ' + label)


class Reader:
    def __init__(self, root, url=None):
        self.root = Path(root).resolve()
        self.url = None
        if url:
            parsed = urllib.parse.urlsplit(url)
            check(parsed.scheme in ('http', 'https') and parsed.netloc and not parsed.username
                  and not parsed.password and not parsed.query and not parsed.fragment,
                  '--url must be a plain HTTP(S) reader base URL')
            self.url = url.rstrip('/') + '/'
        self.cache = {}
        self.archive = None
        self.archive_bytes = None
        self.download_index = None
        self.requests = 0

    def direct(self, path):
        safe_relative(path)
        if not self.url:
            filename = self.root / path
            check(filename.is_file() and not filename.is_symlink(), 'Missing regular file: ' + path)
            return filename.read_bytes()
        if path not in self.cache:
            url = urllib.parse.urljoin(self.url, urllib.parse.quote(path, safe='/')) + '?verify=' + RELEASE
            request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'AkivaReaderPublicationVerifier/1'})
            with urllib.request.urlopen(request, timeout=45) as response:
                check(response.status == 200, 'Public artifact failed: ' + path)
                self.cache[path] = response.read()
            self.requests += 1
        return self.cache[path]

    def data(self, path):
        safe_relative(path)
        if self.url and path.startswith('data/'):
            check(self.archive is not None and path in self.archive.namelist(), 'Complete download omits ' + path)
            return self.archive.read(path)
        return self.direct(path)

    def read_json(self, path, direct=False):
        return json.loads(self.direct(path) if direct else self.data(path))

    def load_archive(self):
        self.download_index = self.read_json('downloads/index.json', direct=True)
        library = self.download_index.get('library')
        check(isinstance(library, dict), 'The complete-library download is missing')
        self.archive_bytes = self.direct(safe_relative(library['file']))
        check(len(self.archive_bytes) == library['bytes'], 'Complete-library ZIP size differs from its index')
        self.archive = open_zip(self.archive_bytes)


def open_zip(data):
    archive = zipfile.ZipFile(io.BytesIO(data))
    names = archive.namelist()
    check(len(set(names)) == len(names), 'ZIP has duplicate member names')
    for info in archive.infolist():
        safe_relative(info.filename.rstrip('/'))
        check(not stat.S_ISLNK(info.external_attr >> 16), 'ZIP contains a symbolic link')
    check(archive.testzip() is None, 'Corrupt ZIP member')
    return archive


def chapter_owners(toc):
    result = {}

    def walk(node):
        if not isinstance(node, dict):
            return
        ref = node.get('ref')
        if ref:
            filename = node.get('file') or (str(node['id']) + '.json' if 'id' in node else None)
            if filename and CHAPTER.fullmatch(filename):
                result[filename] = {'ref': ref, 'separator': node.get('sep') or (':' if int(node.get('depth', 1)) > 1 else ' '),
                                    'interlinear': bool(node.get('interlinear'))}
            if int(node.get('depth', 1)) >= 2 and isinstance(node.get('shape'), list) and 'id' in node:
                for index in range(len(node['shape'])):
                    result[str(node['id']) + '-' + str(index + 1) + '.json'] = {
                        'ref': ref + ' ' + str(index + 1), 'separator': ':',
                        'interlinear': bool(node.get('interlinear')) or index + 1 in (node.get('ilch') or []),
                    }
        for child in node.get('children', []):
            walk(child)

    walk(toc['toc'])
    return result


def verify_internal_source_links(reader, targets):
    """Resolve every distinct local source link against its actual reader text.

    A well-formed hash alone does not prove that its book, section, or numbered
    paragraph exists. Follow the reader's longest-title and longest-leaf rules,
    including its separate interlinear paragraph numbering.
    """
    catalog = reader.read_json('data/catalog.json')
    cached_tocs = {}
    cached_chapters = {}
    resolved = []

    def leaves(node):
        if 'children' in node:
            return [leaf for child in node['children'] for leaf in leaves(child)]
        return [node]

    def sections(leaf):
        if leaf['depth'] == 1:
            return [[]] if leaf['shape'] > 0 else []

        def descend(shape, prefix):
            result = []
            for index, value in enumerate(shape):
                if isinstance(value, list):
                    result.extend(descend(value, prefix + [index + 1]))
                elif value:
                    result.append(prefix + [index + 1])
            return result

        return descend(leaf['shape'], [])

    for url, origin in sorted(targets.items()):
        check(url.startswith('#/read/'), 'Invalid local-source verifier input')
        try:
            ref = urllib.parse.unquote(url[len('#/read/'):].replace('_', ' '), errors='strict').strip()
        except UnicodeError as error:
            raise AssertionError('Malformed local source reference: ' + origin) from error
        books = sorted((book for book in catalog if ref == book['title']
                        or ref.startswith(book['title'] + ' ')
                        or ref.startswith(book['title'] + ',')),
                       key=lambda book: -len(book['title']))
        check(books, 'Internal source book is not in the reader: ' + url + ' from ' + origin)
        book = books[0]
        if book['title'] == 'Tiferet Yosef' and ref in ('Tiferet Yosef, Bereshit', 'Tiferet Yosef, Noach'):
            ref += ' 1'
        if book['slug'] not in cached_tocs:
            cached_tocs[book['slug']] = leaves(reader.read_json('data/' + book['slug'] + '/toc.json')['toc'])
        available = cached_tocs[book['slug']]
        chosen, address = None, []
        for leaf in available:
            if ref == leaf['ref']:
                chosen, address = leaf, []
                break
            prefix = leaf['ref'] + (leaf.get('sep') or ' ')
            suffix = ref[len(prefix):] if ref.startswith(prefix) else ''
            if re.fullmatch(r'\d+(?::\d+)*', suffix) and (chosen is None or len(leaf['ref']) > len(chosen['ref'])):
                chosen, address = leaf, list(map(int, suffix.split(':')))
        if chosen is None:
            chosen = next((leaf for leaf in available if leaf['ref'].startswith(ref + ',') and sections(leaf)), None)
        check(chosen is not None, 'Internal source section is missing: ' + url + ' from ' + origin)
        possibilities = sections(chosen)
        check(possibilities, 'Internal source section has no text: ' + url)
        depth = chosen['depth'] - 1
        check(len(address) <= depth + 1, 'Internal source address has extra components: ' + url)
        segment = address[depth] if len(address) > depth else None
        address = address[:depth]
        if len(address) < depth:
            address = next((candidate for candidate in possibilities if candidate[:len(address)] == address), None)
        check(address in possibilities, 'Internal source chapter is missing: ' + url + ' from ' + origin)
        filename = str(chosen['id']) + ('-' + str(address[0]) if address else '') + '.json'
        chapter_path = 'data/' + book['slug'] + '/' + filename
        if chapter_path not in cached_chapters:
            cached_chapters[chapter_path] = reader.read_json(chapter_path)
        chapter = cached_chapters[chapter_path]
        for index in address[1:]:
            check(isinstance(chapter, list) and 1 <= index <= len(chapter), 'Internal source text depth is missing: ' + url)
            chapter = chapter[index - 1]
        check(isinstance(chapter, list) and chapter, 'Internal source text is empty: ' + url)
        numbered = [item.get('n') or index + 1 for index, item in enumerate(
            item for item in chapter if isinstance(item, dict) and isinstance(item.get('p'), list))]
        if segment is not None:
            check(segment in numbered if numbered else 1 <= segment <= len(chapter),
                  'Internal source paragraph is missing: ' + url + ' from ' + origin)
        resolved.append({'url': url, 'path': chapter_path, 'segment': segment})
    return {'distinctLinks': len(resolved), 'targetChapters': len(cached_chapters), 'ok': True}


def mcp_plain(value):
    value = re.sub(r'&(?:lrm|rlm);', '', str(value), flags=re.I)
    value = html.unescape(re.sub(r'<[^>]*>', '', re.sub(r'<br\s*/?>', '\n', value, flags=re.I)))
    value = re.sub(r'[ \t\u00a0]+', ' ', value)
    value = re.sub(r' *\n *', '\n', value)
    return re.sub(r'\n{3,}', '\n\n', value).strip()


def verify_mcp_sources(reader, expectations):
    """Check the final searchable quotations and both citation directions."""
    mcp = Reader(reader.root.parent / 'mcp-data',
                 urllib.parse.urljoin(reader.url, '../mcp-data/') if reader.url else None)
    audit = mcp.read_json('source-quotations.json')
    check(audit.get('schemaVersion') == 1 and audit.get('release') == RELEASE
          and audit.get('payloadSha256') == PAYLOAD_SHA256, 'MCP source citations identify a different final edition')
    catalog_raw = mcp.direct('catalog.json')
    cited_raw = mcp.direct('cited.json')
    check(sha(catalog_raw) == audit['catalogSha256'] and sha(cited_raw) == audit['citedSha256'],
          'MCP catalog or reverse-citation index changed after final source verification')
    catalog, cited = json.loads(catalog_raw), json.loads(cited_raw)
    check(catalog['version'] == audit['dataVersion'] == reader.read_json('data/files.json')['version'],
          'MCP search and download data use different content versions')
    check(set(audit['books']) == BOOKS, 'MCP source verification omits a supplied book or includes an excluded book')
    check(set(audit.get('excludedBookTextSha256', {})) == EXCLUDED, 'MCP excluded-book protection is incomplete')
    for slug, digest in audit['excludedBookTextSha256'].items():
        check(sha(mcp.direct('text/' + slug + '.json')) == digest, 'An excluded MCP book changed during source refresh: ' + slug)
    for assertion in ('completeFinalSourceNotes', 'forwardAndReverseSourcesAgree', 'inlineBodyCitationsRetained',
                      'unrelatedConnectionsRetained', 'excludedBookTextsUnchanged'):
        check(audit.get('assertions', {}).get(assertion) is True, 'MCP source preservation check is missing: ' + assertion)
    notes, sources = 0, 0
    for slug in sorted(BOOKS):
        raw = mcp.direct('text/' + slug + '.json')
        check(sha(raw) == audit['books'][slug]['textSha256'], 'MCP source text changed after verification: ' + slug)
        document = json.loads(raw)
        book = next((book for book in catalog['books'] if book['slug'] == slug), None)
        check(book and document['slug'] == slug, 'MCP text belongs to the wrong book: ' + slug)
        by_ref = {}
        for paragraph in document['paras']:
            if book['sections'][paragraph['s']].get('il'):
                by_ref.setdefault(paragraph['r'], []).append(paragraph)
        book_notes, book_sources = 0, 0
        for expected in expectations[slug]:
            matches = [paragraph for paragraph in by_ref.get(expected['ref'], [])
                       if paragraph.get('p') == expected['pairs']]
            check(len(matches) == 1, 'MCP source paragraph is missing or ambiguous: ' + expected['ref'])
            paragraph = matches[0]
            forward = {entry[0] for entry in paragraph.get('c', [])}
            for note in expected['notes']:
                text = '\n'.join(mcp_plain(value['text']) for value in note['paragraphs'] if mcp_plain(value['text']))
                check(any(entry[0] == str(note['number']) and entry[1] == text for entry in paragraph.get('f', [])),
                      'MCP source quotation differs from its reader note: ' + expected['ref'] + ' ' + note_key(note))
                for source in note['sources']:
                    check(source['ref'] in forward and expected['ref'] in cited.get(source['ref'], []),
                          'MCP forward/reverse citation omits a final source: ' + expected['ref'] + ' -> ' + source['ref'])
                    book_sources += 1
                book_notes += 1
        check(book_notes == audit['books'][slug]['sourceNotes']
              and book_sources == audit['books'][slug]['sourceCitations'], 'MCP source coverage count differs: ' + slug)
        notes += book_notes
        sources += book_sources
    check(notes == audit['sourceNotesVerified'] and sources == audit['sourceCitationsVerified'], 'MCP total source coverage differs')
    return {'ok': True, 'books': len(BOOKS), 'sourceNotes': notes, 'sourceCitations': sources,
            'removedUnsupportedReverseCitations': audit['removedUnsupportedReverseCitations']}


def select_browser_samples(candidates, selected, changed):
    """Cover every book and Pri section/template without repeating every chapter."""
    chosen = {}

    def order(sample):
        numbers = tuple(int(part) for part in Path(sample['path']).stem.split('-'))
        return (not sample['interlinear'], numbers, sample['path'])

    def add(sample):
        chosen[sample['path']] = sample

    for book in sorted(selected):
        available = sorted((sample for sample in candidates if sample['book'] == book), key=order)
        check(available, 'No annotated reader chapter can be sampled: ' + book)
        add(available[0])
        if book == 'peri-tzadik':
            groups = {}
            for sample in available:
                if sample['path'] in changed:
                    group = re.sub(r'\s+\d+$', '', sample['ref'])
                    groups.setdefault(group, sample)
                # All 47 established Resisei corrections occur in two chapters.
                # Check every corrected box there, with representative popups.
                if any(item['note'].get('provenance', {}).get('sourceExcerptCorrection')
                       for item in sample['items']):
                    add(sample)
            for sample in groups.values():
                add(sample)
    result = sorted(chosen.values(), key=lambda sample: (sample['book'], order(sample)))
    check({sample['book'] for sample in result} == selected, 'Browser coverage omits a selected book')
    return result


def verify_zips(reader, data_records, selected):
    check(reader.archive is not None, 'ZIP validation requires the complete archive')
    manifest_bytes = reader.direct('data/files.json')
    manifest = json.loads(manifest_bytes)
    paths = [path[5:] for path in data_records]
    check(manifest['files'] == sorted(paths) and len(set(manifest['files'])) == len(paths),
          'Final offline manifest has the wrong file inventory')
    check(reader.archive.read('data/files.json') == manifest_bytes, 'ZIP contains a stale offline manifest')
    actual_zip_paths = sorted(name for name in reader.archive.namelist() if name.startswith('data/') and not name.endswith('/'))
    check(actual_zip_paths == sorted(list(data_records) + ['data/files.json']), 'Complete ZIP contains different reader data files')
    digest = hashlib.sha256()
    total = 0
    for relative in sorted(paths):
        path = 'data/' + relative
        contents = reader.data(path)
        check(sha(contents) == data_records[path], 'Final data changed after publication proof: ' + path)
        check(reader.archive.read(path) == contents, 'Complete ZIP data differs from reader: ' + path)
        digest.update(relative.encode('utf-8'))
        digest.update(b'\0')
        digest.update(contents)
        total += len(contents)
    version = digest.hexdigest()[:16]
    check(manifest['version'] == version and manifest['bytes'] == total, 'Offline manifest content version or byte count is stale')
    check(reader.download_index['version'] == version, 'Download index identifies an earlier data version')
    check(reader.download_index['library']['dataFiles'] == len(paths) + 1, 'Complete ZIP data count is wrong')
    books = {book['slug']: book for book in reader.download_index['books']}
    verified = []
    for book in sorted(selected):
        check(book in books, 'Missing individual book download: ' + book)
        index = books[book]
        raw = reader.direct(safe_relative(index['file']))
        check(len(raw) == index['bytes'], 'Book ZIP size differs from download index: ' + book)
        with open_zip(raw) as archive:
            prefix = 'data/' + book + '/'
            expected = sorted(path for path in data_records if path.startswith(prefix))
            found = sorted(name for name in archive.namelist() if name.startswith(prefix) and not name.endswith('/'))
            check(found == expected, 'Individual book ZIP has a different chapter inventory: ' + book)
            for path in expected:
                check(sha(archive.read(path)) == data_records[path], 'Book ZIP has stale note content: ' + path)
            check(index['dataFiles'] == len([name for name in archive.namelist() if name.startswith('data/') and not name.endswith('/')]),
                  'Book ZIP data count differs: ' + book)
        verified.append(book)
    return {'version': version, 'dataFiles': len(paths), 'dataBytes': total, 'bookZips': verified,
            'completeZipBytes': len(reader.archive_bytes)}


def verify_shell(reader, report, baseline, reviewed_urls):
    records = report['shellFiles']
    shell = record_map(records, 'afterSha256')
    before_shell = record_map(records, 'beforeSha256')
    baseline_shell = record_map(baseline['shellFiles'], 'afterSha256')
    check(set(shell) == {'index.html', 'sw.js'}, 'The release must identify both reader-shell files')
    check(before_shell == baseline_shell, 'The reader shell does not start from the verified predecessor')
    current = {}
    for path, digest in shell.items():
        raw = reader.direct(path)
        check(sha(raw) == digest, 'The active reader shell is from another edition: ' + path)
        current[path] = raw.decode('utf-8')
    revision = report['cacheRevision']
    check(revision == RELEASE + '-' + PAYLOAD_SHA256[:16], 'Cache revision does not identify the immutable source-quotation payload')
    reader_html, worker = current['index.html'], current['sw.js']
    check(revision in reader_html and revision in worker, 'Reader HTML and service worker must share the new edition revision')
    html_pattern = re.compile(r'/\* Supplied source quotation revision \*/[^\n]*\n')
    routes = html_pattern.findall(reader_html)
    check(len(routes) == 1 and 'const editionDataUrl = url => ' + routes[0] in reader_html,
          'The source-quotation data route must take precedence over historical cache routes')
    check(all("url.startsWith('data/" + book + "/')" in routes[0] for book in BOOKS)
          and "url === 'data/files.json'" in routes[0], 'Cache refresh does not cover every supplied book and the final manifest')
    previous_html = html_pattern.sub('', reader_html)
    source_rule = ('/* Verified primary source URLs */ ' +
                   json.dumps(reviewed_urls, ensure_ascii=True, separators=(',', ':')) +
                   ".includes(String(url || '')) || ")
    check(previous_html.count('const safeFootnoteUrl = url => ' + source_rule) == 1,
          'The exact independently reviewed source URLs are not active reader source links')
    check(report.get('reviewedExternalSourceUrls') == reviewed_urls,
          'The published source-link exceptions differ from the verified final quotations')
    previous_html = previous_html.replace(source_rule, '', 1)
    book_routes = ' || '.join("rel.startsWith('data/" + book + "/')" for book in sorted(BOOKS))
    branch = ("    } else if (rel.startsWith('data/') && (url.searchParams.get('edition') === '" + revision + "' || " + book_routes + ")) {\n"
              "      // Supplied source quotation network refresh.\n"
              "      event.respondWith(networkFirst(request, DATA));\n")
    check(worker.count(branch) == 1, 'Missing or ambiguous source-quotation network-first worker route')
    previous_worker = worker.replace(branch, '')
    fallback = ("    // Prefer current ZIP-installed data before older edition-query entries.\n"
                "    const canonicalDataUrl = new URL(request.url);\n"
                "    canonicalDataUrl.search = '';\n"
                "    const hit = (await cache.match(request, { ignoreVary: true })) ||\n"
                "      (cacheName === DATA ? await cache.match(canonicalDataUrl.href, { ignoreVary: true }) : null) ||\n"
                "      (await cache.match(request, { ignoreVary: true, ignoreSearch: true }));  // also texts saved by a download pack")
    original_fallback = "    const hit = (await cache.match(request, { ignoreVary: true })) || (await cache.match(request, { ignoreVary: true, ignoreSearch: true }));  // also texts saved by a download pack"
    check(previous_worker.count(fallback) == 1, 'Current ZIP-installed data is not preferred over older edition-query cache entries')
    previous_worker = previous_worker.replace(fallback, original_fallback, 1)
    suffix = '-source-quotations-' + PAYLOAD_SHA256[:16]
    shell_keys = re.findall(r'const SHELL = `([^`]+)`;', previous_worker)
    check(len(shell_keys) == 1 and shell_keys[0].endswith(suffix), 'Service-worker shell cache was not advanced')
    previous_worker = previous_worker.replace('const SHELL = `' + shell_keys[0] + '`;',
                                              'const SHELL = `' + shell_keys[0][:-len(suffix)] + '`;', 1)
    check(sha(previous_html.encode('utf-8')) == before_shell['index.html'],
          'Reader UI changed outside the approved cache route and exact reviewed source links')
    check(sha(previous_worker.encode('utf-8')) == before_shell['sw.js'], 'Service worker changed outside the approved cache refresh')
    check('ignoreSearch: true' in worker and 'networkFirst' in worker, 'Offline downloaded-pack fallback was removed')
    return revision


def verify_cache_behavior(reader, revision):
    """Exercise the published worker with real Request/Response cache semantics."""
    fixture = {'worker': reader.direct('sw.js').decode('utf-8'),
               'books': sorted(BOOKS), 'revision': revision}
    result = subprocess.run(['node', '--input-type=module', '-e', CACHE_PROBE],
                            input=json.dumps(fixture), text=True, capture_output=True, timeout=30)
    check(result.returncode == 0, 'Source-quotation offline cache verification failed:\n'
          + result.stdout[-3000:] + result.stderr[-5000:])
    return json.loads(result.stdout)


def verify(args):
    compressed = PAYLOAD.read_bytes()
    check(SHA_PATTERN.fullmatch(PAYLOAD_SHA256) is not None, 'Final source-quotation payload has not been pinned')
    check(sha(compressed) == PAYLOAD_SHA256, 'Immutable supplied source-quotation package changed')
    payload = json.loads(gzip.decompress(compressed))
    check(payload.get('schemaVersion') == 1 and payload.get('release') == RELEASE, 'Unknown supplied source edition')
    check(set(payload['books']) == BOOKS and set(payload['excludedBooks']) == EXCLUDED, 'Source release book scope changed')
    check(payload['matchedNotes'] == 25904, 'Expected all 25,904 supplied source-note matches')
    check(payload['sourceArchive']['sha256'] == SOURCE_ARCHIVE_SHA256, 'Payload refers to a different uploaded source archive')
    reviewed_urls = reviewed_external_source_urls(payload)
    selected = set(args.book or BOOKS)
    check(selected <= BOOKS and selected, '--book must name one of the 16 supplied books')
    reader = Reader(args.root, args.url)
    report_raw = reader.direct(REPORT)
    report = json.loads(report_raw)
    check(report.get('schemaVersion') == 1 and report.get('release') == RELEASE, 'Wrong published source edition')
    check(report['payloadSha256'] == PAYLOAD_SHA256, 'Published report uses different supplied footnotes')
    check(report['sourceArchive'] == payload['sourceArchive'], 'Published source archive evidence differs')
    check(report['matchedNotes'] == payload['matchedNotes'], 'Published supplied-note match count differs')
    for assertion in ('bodyUnchanged', 'excludedBooksUnchanged', 'onlyReviewedFootnoteArraysChanged',
                      'noUnmatchedNotesImported', 'allInputsCheckedBeforeWriting', 'offlineFallbackPreserved',
                      'verifiedPrimarySourceUrlsEnabled'):
        check(report.get('assertions', {}).get(assertion) is True, 'Missing publication invariant: ' + assertion)
    for field in ('removedNotes', 'exceptions', 'quotationRestorations', 'linkCorrections'):
        check(report.get(field, []) == payload.get(field, []), 'Published editorial evidence differs: ' + field)
    baseline_raw = reader.direct(BASELINE_REPORT)
    check(sha(baseline_raw) == report['baselineCleanupReportSha256'], 'Historical cleanup publication evidence changed')
    baseline = json.loads(baseline_raw)
    check(baseline.get('schemaVersion') == 1 and baseline.get('mode') == 'write'
          and baseline.get('publication', {}).get('sealed') is True, 'Predecessor cleanup was not sealed and verified')
    original = {}
    for entry in baseline['files']:
        if entry['path'].startswith('data/') and entry['path'] != 'data/files.json':
            original[entry['path']] = entry['afterSha256']
    for entry in baseline['preservedFiles']:
        if entry['path'].startswith('data/') and entry['path'] != 'data/files.json':
            check(entry['path'] not in original, 'Duplicate predecessor publication record')
            original[entry['path']] = entry['sha256']
    before = record_map(report['files'], 'beforeSha256')
    after = record_map(report['files'], 'afterSha256')
    check(before == original, 'The successor does not start from the complete verified predecessor')
    check(all(path.startswith('data/') and path != 'data/files.json' for path in after), 'Invalid data inventory scope')
    check(report['beforeDataDigest'] == object_sha(before), 'Predecessor inventory digest is incorrect')
    check(report['afterDataDigest'] == object_sha(after), 'Successor inventory digest is incorrect')
    changed = {path for path in after if before[path] != after[path]}
    payload_files = {entry['path']: entry for entry in payload['files']}
    check(len(payload_files) == len(payload['files']) and set(payload_files) == changed,
          'Changed data does not exactly match the approved footnote-only files')
    report_changes = {entry['path']: entry for entry in report['changedFiles']}
    check(len(report_changes) == len(report['changedFiles']) and set(report_changes) == changed,
          'Changed-file report is incomplete')
    if args.zips or reader.url:
        reader.load_archive()
    else:
        actual_paths = sorted(path.relative_to(reader.root).as_posix() for path in (reader.root / 'data').rglob('*')
                              if path.is_file() and path.name != 'files.json')
        check(actual_paths == sorted(after), 'Actual reader inventory differs from publication proof')
    protected = record_map(payload['protectedFiles'])
    check(record_map(report['protectedFiles']) == protected, 'Excluded-book preservation evidence changed')
    expected_protected = {path: digest for path, digest in before.items() if path.split('/')[1] in EXCLUDED}
    check(protected == expected_protected, 'The release must protect every file in all three excluded books')
    check(all(after[path] == digest for path, digest in protected.items()), 'An excluded book was changed')
    removed = 0
    changed_notes = 0
    actual_removals = []
    updated_by_book = {book: 0 for book in BOOKS}
    patched_files = {}
    for path, entry in payload_files.items():
        safe_relative(path)
        parts = path.split('/')
        check(len(parts) == 3 and parts[0] == 'data' and parts[1] in BOOKS and CHAPTER.fullmatch(parts[2]),
              'Only approved book chapter annotations may change: ' + path)
        check(entry['beforeSha256'] == before[path] and entry['afterSha256'] == after[path], 'Payload/report hashes differ: ' + path)
        for field in ('beforeSha256', 'afterSha256', 'bodySha256', 'notesBefore', 'notesAfter'):
            check(report_changes[path][field] == entry[field], 'Publication summary differs from immutable payload: ' + path + ' ' + field)
        raw = reader.data(path)
        check(sha(raw) == entry['afterSha256'], 'Published footnote file differs from the approved payload: ' + path)
        current = json.loads(raw)
        check(isinstance(current, list), 'Chapter is not a reader array: ' + path)
        check(compact(current) == raw, 'Unexpected final chapter encoding: ' + path)
        check(object_sha(body_of(current)) == entry['bodySha256'], 'Hebrew, English, headings or other body metadata changed: ' + path)
        restored = copy.deepcopy(current)
        paths = set()
        updates_in_file = 0
        for block in entry['blocks']:
            owner_path = tuple(block['path'])
            check(owner_path not in paths, 'Duplicate annotation block patch: ' + path)
            paths.add(owner_path)
            current_owner = locate(current, block['path'])
            check(current_owner.get('footnotes', []) == block['after'], 'Published source note block differs from supplied content: ' + path)
            old_notes, new_notes = block['before'], block['after']
            check(isinstance(old_notes, list) and isinstance(new_notes, list), 'Invalid before/after annotation block')
            old_map = {note_key(note): note for note in old_notes}
            new_map = {note_key(note): note for note in new_notes}
            check(len(old_map) == len(old_notes) and len(new_map) == len(new_notes), 'Duplicate annotation identity: ' + path)
            check(new_map.keys() <= old_map.keys(), 'Successor inserted or renamed an annotation identity: ' + path)
            check(list(new_map) == [key for key in old_map if key in new_map], 'The established annotation order changed: ' + path)
            for key, note in new_map.items():
                verify_metadata(old_map[key], note, parts[1], path + ' ' + key)
                verify_note(note, current_owner, path + ' ' + key, reviewed_urls)
                updates_in_file += old_map[key] != note
            for key in old_map.keys() - new_map.keys():
                actual_removals.append((path, tuple(block['path']), old_map[key].get('placementId', key)))
            removed += len(old_notes) - len(new_notes)
            locate(restored, block['path'])['footnotes'] = copy.deepcopy(old_notes)
        check(note_count(current) == entry['notesAfter'] and note_count(restored) == entry['notesBefore'], 'Chapter note counts differ: ' + path)
        check(object_sha(body_of(restored)) == entry['bodySha256'], 'The predecessor body cannot be restored exactly: ' + path)
        check(type(entry['beforeTrailingNewline']) is bool, 'Missing exact preimage encoding: ' + path)
        check(sha(compact(restored, entry['beforeTrailingNewline'])) == entry['beforeSha256'],
              'Replacing only approved footnotes fails to reconstruct the exact predecessor: ' + path)
        check(updates_in_file == entry['updatedNotes'], 'Incorrect changed-note count: ' + path)
        updated_by_book[parts[1]] += updates_in_file
        changed_notes += updates_in_file
        patched_files[path] = current
    check(removed == len(payload.get('removedNotes', [])), 'Removed-note audit does not cover every removed annotation')
    check(all(isinstance(entry.get('reason'), str) and entry['reason'].strip() for entry in payload.get('removedNotes', [])),
          'A removed annotation lacks an explicit explanation')
    audited_removals = [(entry['path'], tuple(entry['blockPath']), entry['noteKey']) for entry in payload['removedNotes']]
    check(len(set(audited_removals)) == len(audited_removals)
          and sorted(actual_removals) == sorted(audited_removals), 'Removed-note identities differ from the explicit audit')
    check(sum(path.startswith('data/divrei-soferim/') for path, _, _ in actual_removals) == 128
          and [(path, key) for path, _, key in actual_removals if not path.startswith('data/divrei-soferim/')]
          == [('data/meshiv-tzedek/1.json', 'MTZ-0768-1')], 'Unapproved usable annotations were removed')
    check(report['updatedNotes'] == changed_notes, 'Published total changed-note count is incorrect')
    book_counts = {}
    browser_candidates = []
    internal_source_targets = {}
    mcp_expectations = {book: [] for book in BOOKS}
    preserved_source_corrections = 0
    omer_corrections = 0
    for book in sorted(BOOKS):
        prefix = 'data/' + book + '/'
        owners = chapter_owners(reader.read_json(prefix + 'toc.json'))
        count = 0
        chapters = 0
        ds_numbers = []
        for path in sorted(after):
            if not path.startswith(prefix) or not CHAPTER.fullmatch(path[len(prefix):]):
                continue
            contents = reader.data(path)
            check(sha(contents) == after[path], 'Chapter changed after the publication report: ' + path)
            rows = patched_files.get(path) or json.loads(contents)
            notes = [(item_path, item, note) for item_path, item in note_rows(rows) for note in item['footnotes']]
            count += len(notes)
            chapters += 1
            if book == 'divrei-soferim':
                ds_numbers.extend(note['number'] for _, _, note in notes)
            for _, item, note in notes:
                label = path + ' ' + note_key(note)
                verify_note(note, item, label, reviewed_urls)
                links = [source['url'] for source in note['sources']]
                links.extend(run['href'] for paragraph in note['paragraphs']
                             for run in paragraph.get('rich', []) if run.get('href'))
                links.extend(link['url'] for paragraph in note['paragraphs']
                             for link in paragraph.get('links', []))
                for url in links:
                    if url.startswith('#/read/'):
                        internal_source_targets.setdefault(url, label)
                preserved_source_corrections += bool(note.get('provenance', {}).get('sourceExcerptCorrection'))
                if book == 'machshavot-charutz' and note.get('sourceId') == 'MC-1402':
                    check(note['sources'][0]['ref'] == 'Exodus 16:36'
                          and len(note['paragraphs']) == 1
                          and 'The omer is a tenth of an ephah.' in note['paragraphs'][0]['text'],
                          'The reviewed Exodus 16:36 correction reverted to the unrelated uploaded verses')
                    omer_corrections += 1
            owner = owners.get(path[len(prefix):])
            if args.mcp and notes:
                check(owner is not None, 'MCP source chapter is missing its reader section: ' + path)
                for index, item in enumerate(item for item in rows if isinstance(item, dict) and isinstance(item.get('p'), list)):
                    if item.get('footnotes'):
                        mcp_expectations[book].append({'ref': owner['ref'] + owner['separator'] + str(item.get('n') or index + 1),
                            'pairs': [[mcp_plain(text) for text in pair] for pair in item['p']],
                            'notes': item['footnotes']})
            if notes and owner and book in selected:
                sample = {'book': book, 'path': path, **owner,
                          'items': [{'n': item.get('n'), 'note': note} for _, item, note in notes]}
                browser_candidates.append(sample)
        original_count = baseline['books'][book]['footnotesAfter']
        difference = sum(entry['notesBefore'] - entry['notesAfter'] for path, entry in payload_files.items() if path.startswith(prefix))
        check(count == original_count - difference, 'The book lost annotations outside the approved removals: ' + book)
        if book == 'divrei-soferim':
            check(sorted(ds_numbers) == list(range(1, 718)), 'Divrei Soferim must contain 717 consecutively numbered usable notes')
        check(report['books'][book]['notesBefore'] == original_count and report['books'][book]['notesAfter'] == count,
              'Published book annotation totals differ: ' + book)
        check(report['books'][book]['chapters'] == sum(path.startswith(prefix) for path in payload_files),
              'Published changed-chapter count differs: ' + book)
        check(report['books'][book]['updatedNotes'] == updated_by_book[book], 'Published book changed-note count differs: ' + book)
        book_counts[book] = {'notesBefore': original_count, 'notesAfter': count, 'chapters': chapters}
    check(preserved_source_corrections == 47, 'The 47 established Resisei source corrections were not retained')
    check(omer_corrections == 1, 'The reviewed Exodus 16:36 annotation was not retained exactly once')
    internal_link_result = verify_internal_source_links(reader, internal_source_targets)
    mcp_result = verify_mcp_sources(reader, mcp_expectations) if args.mcp else None
    # Every unrelated file, source index and book remains tied to the baseline.
    for path, digest in after.items():
        check(sha(reader.data(path)) == digest, 'Final reader inventory hash differs: ' + path)
    revision = verify_shell(reader, report, baseline, reviewed_urls)
    cache_result = verify_cache_behavior(reader, revision)
    direct_verified = []
    if reader.url:
        representatives = {}
        for path in sorted(changed):
            book = path.split('/')[1]
            if book in selected:
                representatives.setdefault(book, path)
        direct_paths = sorted(set(protected) | set(representatives.values()))

        def direct_verify(path):
            check(sha(reader.direct(path)) == after[path], 'Direct live reader data differs from the complete download: ' + path)
            return path

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            direct_verified = list(pool.map(direct_verify, direct_paths))
    zip_result = verify_zips(reader, after, selected) if reader.archive else None
    browser_samples = select_browser_samples(browser_candidates, selected, changed)
    browser_result = run_browser(reader, browser_samples, args.artifacts) if args.browser else None
    return {'ok': True, 'release': RELEASE, 'mode': 'public' if reader.url else 'local',
            'root': reader.url or str(reader.root), 'payloadSha256': PAYLOAD_SHA256,
            'protectedBooks': sorted(EXCLUDED), 'protectedFilesVerified': len(protected),
            'predecessorFilesReconstructed': len(changed), 'changedNotesVerified': changed_notes,
            'removedUnusableNotes': removed, 'suppliedMatches': payload['matchedNotes'],
            'allDataFilesVerified': len(after), 'books': book_counts,
            'preservedResiseiSourceCorrections': preserved_source_corrections,
            'reviewedExodus1636Correction': True,
            'cacheRevision': revision, 'directPublicFilesVerified': len(direct_verified),
            'offlineCacheVerification': cache_result,
            'internalSourceLinkVerification': internal_link_result,
            'mcpSourceVerification': mcp_result,
            'browserSampleChapters': len(browser_samples),
            'zipVerification': zip_result, 'browserVerification': browser_result}


CACHE_PROBE = r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const fixture=JSON.parse(fs.readFileSync(0,'utf8'));
const base='https://akiva.example/library/';
const handlers=new Map(), stores=new Map(), requests=[];
let online=true;
const key=value=>typeof value==='string'?new URL(value,base).href:value.url;
const canonical=value=>{const url=new URL(key(value));url.search='';return url.href;};
function store(name){
 if(!stores.has(name)){
  const entries=new Map();
  stores.set(name,{entries,
   async put(request,response){entries.set(key(request),response.clone());},
   async match(request,options={}){
    if(options.ignoreSearch){
     for(const [url,response] of entries)if(canonical(url)===canonical(request))return response.clone();
    }else if(entries.has(key(request)))return entries.get(key(request)).clone();
   }
  });
 }
 return stores.get(name);
}
const context=vm.createContext({URL,Request,Response,Promise,Error,
 setTimeout:()=>0,
 self:{registration:{scope:base},addEventListener:(name,handler)=>handlers.set(name,handler)},
 caches:{open:async name=>store(name),match:async(request,options)=>{
  for(const item of stores.values()){const hit=await item.match(request,options);if(hit)return hit;}
 }},
 fetch:async(request,options)=>{
  requests.push({url:key(request),cache:options?.cache});
  if(!online)throw new Error('offline');
  return new Response('fresh:'+new URL(key(request)).pathname,{status:200});
 }
});
vm.runInContext(fixture.worker,context,{filename:'published-sw.js',timeout:1000});
assert.ok(handlers.has('fetch'),'The active worker registers a fetch handler');
async function request(url){
 let response;const background=[];
 handlers.get('fetch')({request:new Request(url),
  respondWith:value=>{assert.equal(response,undefined);response=Promise.resolve(value);},
  waitUntil:value=>background.push(value)});
 assert.ok(response,'The active worker intercepts updated reader data');
 const result=await response;await Promise.all(background);return result.text();
}
const data=store('rtl-data');
for(const book of fixture.books){
 data.entries.clear();requests.length=0;online=true;
 const url=base+'data/'+book+'/0.json';
 await data.put(url,new Response('stale installed note'));
 assert.equal(await request(url),'fresh:'+new URL(url).pathname,book+' offline-pack refresh receives current network data');
 assert.equal(requests.length,1);assert.equal(requests[0].cache,'no-cache');
 assert.equal(await(await data.match(url)).text(),'fresh:'+new URL(url).pathname,book+' refresh updates the installed cache');
}
const plain=base+'data/divrei-chalomot/0.json';
const current=plain+'?edition='+fixture.revision;
data.entries.clear();online=false;
await data.put(plain+'?edition=historical-release',new Response('older query'));
await data.put(plain,new Response('current downloaded ZIP'));
assert.equal(await request(current),'current downloaded ZIP','A current downloaded ZIP takes precedence over older query entries');
await data.put(current,new Response('exact current edition'));
assert.equal(await request(current),'exact current edition','An exact edition entry has first priority');
data.entries.clear();
await data.put(plain+'?edition=historical-release',new Response('last offline copy'));
assert.equal(await request(current),'last offline copy','Older installed packs remain a final offline fallback');
console.log(JSON.stringify({ok:true,unversionedBookRefreshes:fixture.books.length,
 exactEditionPriority:true,downloadedZipPriority:true,olderPackFallback:true}));
'''


def run_browser(reader, samples, artifacts):
    """CI regression probe; normal local UI review uses the Browser skill."""
    check(samples, 'No browser sample was derived from verified chapter data')
    destination = Path(artifacts).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='akiva-source-quotation-probe-') as directory:
        data = Path(directory) / 'samples.json'
        data.write_text(json.dumps({'base': reader.url, 'root': str(reader.root), 'samples': samples,
                                    'artifacts': str(destination)}, ensure_ascii=False), encoding='utf-8')
        result = subprocess.run(['node', '--input-type=module', '-e', BROWSER_PROBE, str(data)],
                                cwd=REPO, text=True, capture_output=True, timeout=1200)
        check(result.returncode == 0, 'Source-quotation browser verification failed:\n' + result.stdout[-5000:] + result.stderr[-5000:])
        return json.loads((destination / ('live-report.json' if reader.url else 'local-report.json')).read_text())


BROWSER_PROBE = r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const fixture=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const {chromium}=createRequire(path.join(process.cwd(),'scripts/verify-supplied-source-footnotes.py'))('playwright');
let server,base=fixture.base;
if(!base){
 server=http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  if(!pathname.startsWith('/library/')){response.writeHead(404).end();return;}
  let file=path.resolve(fixture.root,'.'+pathname.slice('/library'.length));
  if(file!==fixture.root&&!file.startsWith(fixture.root+path.sep)){response.writeHead(403).end();return;}
  try{
   if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
   response.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.json':'application/json;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'})[path.extname(file)]||'application/octet-stream');
   fs.createReadStream(file).pipe(response);
  }catch{response.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base='http://127.0.0.1:'+server.address().port+'/library/';
}
const report={ok:false,base,sections:[],screenshots:[],errors:[]};
const browser=await chromium.launch({headless:true,...(process.env.AKIVA_CHROME_EXECUTABLE?{executablePath:process.env.AKIVA_CHROME_EXECUTABLE}:{})});
const toHash=ref=>encodeURIComponent(ref).replace(/%20/g,'_').replace(/%2C/g,',').replace(/%3A/g,':');
const links=note=>note.paragraphs.flatMap(p=>[...(p.rich||[]).filter(r=>r.href).map(r=>r.href),...(p.links||[]).map(l=>l.url)]);
try{
 for(const mobile of [false,true]){
  const width=mobile?390:1440;
  const context=await browser.newContext({viewport:{width,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  let multipleScreenshot=false,correctedScreenshot=false;
  await context.addInitScript(()=>{
   localStorage.setItem('rtl.lang',JSON.stringify('bi'));localStorage.setItem('rtl.layout',JSON.stringify('inter'));
   window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  });
  const origin=new URL(base).origin;
  await context.route(url=>url.origin!==origin,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  for(const sample of fixture.samples){
   await page.goto(base+'#/read/'+toHash(sample.ref),{waitUntil:'domcontentloaded'});
   const section=page.locator('#text > .sec').filter({has:page.locator('.seg')});
   await section.first().waitFor({state:'visible',timeout:60000});
   const current=page.locator('#text > .sec[data-ref="'+sample.ref.replaceAll('"','\\"')+'"]');
   await current.locator('.seg-il .ph-he button.footnote-marker').first().waitFor({state:'visible',timeout:60000});
   assert.equal(await current.count(),1,'Current chapter '+sample.ref);
   const expected=sample.items;
   const markers=await current.locator('.seg-il .ph-he button.footnote-marker').evaluateAll(nodes=>nodes.map(marker=>{
    const range=document.createRange();range.selectNodeContents(marker.closest('.ph-he'));range.setEndBefore(marker);
    const before=range.cloneContents();before.querySelectorAll('button.footnote-marker').forEach(n=>n.remove());
    return {key:marker.dataset.noteKey||null,number:Number(marker.dataset.fn),prefix:before.textContent,nested:!!marker.closest('a'),
     phraseIndex:[...marker.closest('.seg').querySelectorAll('.seg-il .ph')].indexOf(marker.closest('.ph'))};
   }));
   assert.equal(markers.length,expected.length,'Every Hebrew marker '+sample.ref);
   assert.equal(await current.locator('.seg-il .ph-en button.footnote-marker').count(),0,'No English duplicate markers '+sample.ref);
   const boxes=await current.locator('.seg-il .reader-footnote').evaluateAll(nodes=>nodes.map(box=>({key:box.dataset.noteKey||null,number:Number(box.dataset.fn),paragraphs:[...box.querySelectorAll('.annotation-text')].map(p=>p.textContent),links:[...box.querySelectorAll('.annotation-text a,.annotation-links a')].map(a=>a.getAttribute('href'))})));
   assert.equal(boxes.length,expected.length,'Every source box '+sample.ref);
   for(const {note} of expected){
    const marker=markers.find(m=>note.placementId?m.key===note.placementId:m.number===note.number);
    assert.ok(marker,'Missing note marker '+sample.ref+' '+note.number);
    assert.equal(marker.prefix,note.heAnchorPrefix,'Correct Hebrew word '+sample.ref+' '+note.number);
    assert.equal(marker.number,note.number,'Correct Hebrew number '+sample.ref+' '+note.number);
    assert.equal(marker.nested,false,'Footnote button nested in source link');
    assert.equal(marker.phraseIndex,note.phraseIndex,'Correct Hebrew phrase '+sample.ref+' '+note.number);
    const box=boxes.find(b=>note.placementId?b.key===note.placementId:b.number===note.number);
    assert.deepEqual(box.paragraphs,note.paragraphs.map(p=>p.text),'Complete supplied source quotation '+sample.ref+' '+note.number);
    assert.deepEqual(box.links,links(note),'Clickable source links '+sample.ref+' '+note.number);
   }
   const corrected=expected.filter(({note})=>note.provenance?.sourceExcerptCorrection);
   const multiple=expected.find(entry=>expected.some(other=>other!==entry&&other.n===entry.n&&other.note.phraseIndex===entry.note.phraseIndex));
   const chosen=[...new Set([expected[0],expected.at(-1),corrected[0],corrected.at(-1),multiple].filter(Boolean))];
   for(const {note} of chosen){
    const selector=note.placementId?'[data-note-key="'+note.placementId+'"]':'[data-fn="'+note.number+'"]';
    const trigger=current.locator('.seg-il .ph-he button.footnote-marker'+selector);
    const box=current.locator('.seg-il .reader-footnote'+selector);
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'),'true','Footnote opened');
    assert.ok(await box.isVisible(),'Corresponding source quotation is visible');
    assert.deepEqual(await box.locator('.annotation-text').allTextContents(),note.paragraphs.map(p=>p.text),'Open source is complete');
    assert.ok(await box.locator('.annotation-text a,.annotation-links a').count(),'Open source is linked');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Horizontal overflow');
    const kind=sample.book==='tzidkat-hatzadik'&&sample.path.endsWith('/0.json')&&note===expected[0].note?'tzidkat-1':
     note.provenance?.sourceExcerptCorrection&&!correctedScreenshot?'corrected-resisei-source':
     multiple?.note===note&&!multipleScreenshot?'multiple-notes':null;
    if(kind){
     const file=(fixture.base?'live':'local')+'-'+width+'-'+kind+'.png';
     await box.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(fixture.artifacts,file)});
     report.screenshots.push(file);
     if(kind==='corrected-resisei-source')correctedScreenshot=true;
     if(kind==='multiple-notes')multipleScreenshot=true;
    }
    await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'false','Footnote closed');
   }
   report.sections.push({book:sample.book,ref:sample.ref,path:sample.path,viewport:width,hebrewMarkers:expected.length,renderedNotes:boxes.length,openedNotes:chosen.length,correctedResiseiNotes:corrected.length});
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[],'Reader JavaScript errors');report.ok=true;
}finally{
 fs.writeFileSync(path.join(fixture.artifacts,fixture.base?'live-report.json':'local-report.json'),JSON.stringify(report,null,2)+'\n');
 await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(REPO / 'dist/library'))
    parser.add_argument('--url')
    parser.add_argument('--book', action='append', choices=sorted(BOOKS))
    parser.add_argument('--zips', action='store_true')
    parser.add_argument('--mcp', action='store_true', help='Verify final searchable quotations and source citation indexes')
    parser.add_argument('--browser', action='store_true', help='Run the CI desktop/mobile reader regression probe')
    parser.add_argument('--artifacts', default='supplied-source-footnotes-verification')
    args = parser.parse_args()
    try:
        result = verify(args)
    except Exception as error:
        raise SystemExit('Source-quotation publication verification failed: ' + str(error)) from error
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()

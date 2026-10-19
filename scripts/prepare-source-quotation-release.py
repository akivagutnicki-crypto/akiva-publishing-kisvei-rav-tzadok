#!/usr/bin/env python3
"""Prepare an immutable, footnote-only package from a supplied reader archive.

This authoring utility is not a deployment step. Publication consumes its
reviewed gzip output, including exact note preimages and documented source
restorations. The source archive and the live baseline are never modified.
"""
import argparse
import copy
import gzip
import hashlib
import json
from pathlib import Path
import re
import urllib.parse
import zipfile

EXCLUDED = {'resisei-layla', 'takanat-hashavin', 'dover-tzedek'}
RELEASE = '20261019-source-quotations'
STALE = {'kisvei_rav_tzadok_parallel', 'kisvei_ishbitz_parallel', 'ishbitz_parallel',
         'rav_tzadok_parallel', 'parallels', 'reviewedParallelIds'}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def serial(value, newline=True):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + ('\n' if newline else '')).encode()


def body(value):
    if isinstance(value, list):
        return [body(item) for item in value]
    if isinstance(value, dict):
        return {key: body(item) for key, item in value.items() if key != 'footnotes'}
    return value


def notes(value):
    if isinstance(value, list):
        return sum((notes(item) for item in value), [])
    if isinstance(value, dict):
        return value.get('footnotes', []) + sum((notes(item) for key, item in value.items() if key != 'footnotes'), [])
    return []


def locate(value, pointer):
    for index in pointer:
        value = value[index]
    return value


def source_only_current(note):
    """One reviewed exception: retain Exodus 16:36, not the mislabeled upload."""
    ref = 'Exodus 16:36'
    url = 'https://www.sefaria.org/Exodus.16.36'
    quote = 'The omer is a tenth of an ephah.'
    return {'paragraphs': [{'text': ref + ': “' + quote + '”', 'rich': [
        {'text': ref, 'bold': True, 'href': url}, {'text': ': “' + quote + '”'}]}],
        'sources': [{'ref': ref, 'url': url, 'role': 'primary-source'}],
        'nativeConnections': []}


def apply_source_link_correction(note, correction):
    """Repair a remaining unsupported link without changing quotation words."""
    before_ref, after_ref = correction['beforeRef'], correction['afterRef']
    before_url, after_url = correction['beforeURL'], correction['afterURL']
    found = False
    for source in note['sources']:
        if source.get('url') == before_url:
            assert source['ref'] == before_ref, 'Source-link correction has a different citation'
            source['ref'], source['url'] = after_ref, after_url
            if before_ref != after_ref and source.get('connectionsUrl'):
                source['connectionsUrl'] = 'https://www.sefaria.org/api/links/' + urllib.parse.quote(after_ref, safe='') + '?with=all'
            found = True
    for paragraph in note['paragraphs']:
        previous_text = paragraph['text']
        renamed_label = False
        for run in paragraph.get('rich', []):
            if run.get('href') == before_url:
                run['href'] = after_url
                if before_ref != after_ref:
                    assert run['text'] == before_ref, 'Non-label source text must not be rewritten'
                    run['text'] = after_ref
                    renamed_label = True
                found = True
        for link in paragraph.get('links', []):
            if link.get('url') == before_url:
                link['url'] = after_url
                if link.get('label') == before_ref:
                    link['label'] = after_ref
                found = True
        if renamed_label:
            assert previous_text.startswith(before_ref), 'Canonical source label must begin the quotation'
            paragraph['text'] = ''.join(run['text'] for run in paragraph['rich'])
            assert paragraph['text'] == after_ref + previous_text[len(before_ref):], 'Source-link repair changed quotation words'
        else:
            assert paragraph['text'] == previous_text, 'Source-link repair changed quotation words'
    evidence = note.get('provenance', {}).get('sourceQuotationRelease')
    if isinstance(evidence, dict) and evidence.get('sourceURL') == before_url:
        evidence['sourceURL'] = after_url
        if evidence.get('sourceRef') == before_ref:
            evidence['sourceRef'] = after_ref
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--mapping', required=True)
    parser.add_argument('--restorations')
    parser.add_argument('--link-corrections')
    parser.add_argument('--output', default='sources/akiva/overlays/source-quotations-20261019.json.gz')
    args = parser.parse_args()
    archive_path = Path(args.archive)
    baseline = Path(args.baseline)
    mapping = json.loads(Path(args.mapping).read_text())
    matches = mapping['matches']
    restoration_map = {}
    restoration_records = []
    link_map = {}
    link_records = []
    if args.link_corrections:
        transport = json.loads(Path(args.link_corrections).read_text())
        assert transport['schemaVersion'] == 1
        assert transport['catalogSha256'] == sha((baseline / 'data/catalog.json').read_bytes())
        for entry in transport['corrections']:
            key = (entry['path'], entry['incomingPlacementId'])
            assert key not in link_map and entry.get('verified') is True, 'Duplicate or unverified source-link correction'
            target = entry['target']
            assert sha((baseline / target['tocPath']).read_bytes()) == target['tocSha256'], 'Source target contents changed'
            assert sha(canonical(body(json.loads((baseline / target['chapterPath']).read_bytes())))) == target['bodySha256'], 'Source target body changed'
            expected_url = '#/read/' + urllib.parse.quote(target['readerRef'], safe="~!*'()-_:,").replace('%20', '_')
            assert entry['afterURL'] == expected_url, 'Source link does not identify its verified reader target'
            link_map[key] = entry
    if args.restorations:
        corrections = json.loads(Path(args.restorations).read_text())
        if isinstance(corrections, dict):
            corrections = corrections.get('restorations', corrections.get('corrections', []))
        for entry in corrections:
            key = (entry['path'], entry['placementId'])
            assert key not in restoration_map, 'Duplicate source restoration'
            restoration_map[key] = entry
    source_cache, before_cache, after_cache = {}, {}, {}
    touched_blocks = {}
    exception_records = []
    matched_new = {}
    with zipfile.ZipFile(archive_path) as archive:
        for match in matches:
            path = match['path']
            book = path.split('/')[1]
            assert book not in EXCLUDED
            if path not in source_cache:
                source_cache[path] = json.loads(archive.read(path))
                before_cache[path] = json.loads((baseline / path).read_bytes())
                after_cache[path] = copy.deepcopy(before_cache[path])
                assert body(source_cache[path]) == body(before_cache[path]), 'Current body differs from supplied edition: ' + path
            indices = [int(part) for part in match['block'].strip('/').split('/')]
            incoming_block = locate(source_cache[path], indices)
            old_block = locate(before_cache[path], indices)
            new_block = locate(after_cache[path], indices)
            incoming = incoming_block['footnotes'][match['incoming_index']]
            current = old_block['footnotes'][match['live_index']]
            assert current['placementId'] == match['live_placement_id']
            assert incoming['placementId'] == match['incoming_placement_id']
            for key in ['phraseIndex', 'heCharOffset', 'enCharOffset', 'heAnchorPrefix', 'enAnchorPrefix']:
                assert current.get(key) == incoming.get(key), f'Changed anchor {path} {current["placementId"]} {key}'
            revised = copy.deepcopy(current)
            for key in ['paragraphs', 'sources']:
                revised[key] = copy.deepcopy(incoming[key])
            revised['nativeConnections'] = []
            for key in STALE:
                revised.pop(key, None)
            if re.search(r'parallel', revised.get('verificationNote', ''), re.I):
                revised.pop('verificationNote', None)
            if book == 'divrei-soferim':
                revised['number'] = incoming['number']
            if path == 'data/machshavot-charutz/8.json' and current['sourceId'] == 'MC-1402':
                revised.update(source_only_current(current))
                exception_records.append({'path': path, 'placementId': current['placementId'],
                    'reason': 'The uploaded Exodus 16:36 quote was Exodus 16:4–5; retained the correct complete verse matching the Hebrew anchor.'})
            if path == 'data/sefer-hazikhronot/20.json' and current['sourceId'] == 'SZ-0150':
                exception_records.append({'path': path, 'placementId': current['placementId'],
                    'reason': 'Adopted the supplied Deuteronomy 8:2–3 quotation at the Hebrew verse/manna anchor; the old editorial-only note used a nonexistent Sefaria source title.'})
            correction = restoration_map.get((path, incoming['placementId']))
            if correction:
                assert not (path == 'data/machshavot-charutz/8.json' and current['sourceId'] == 'MC-1402'), \
                    'A source restoration must not overwrite the reviewed Exodus 16:36 correction'
                assert correction.get('verified') is True, 'Unreviewed source restoration'
                revised['paragraphs'] = copy.deepcopy(correction['paragraphs'])
                revised['sources'] = copy.deepcopy(correction['sources'])
                evidence = {key: value for key, value in correction.items() if key not in ['paragraphs', 'sources']}
                restoration_records.append(evidence)
                revised.setdefault('provenance', {})['sourceQuotationRelease'] = {
                    'release': RELEASE, 'sourceRef': revised['sources'][0]['ref'],
                    'sourceURL': revised['sources'][0]['url'],
                    'versionTitle': correction.get('versionTitle'), 'license': correction.get('license'),
                    'sourceSha256': correction.get('sourceSha256'),
                    'method': correction.get('method', 'Complete matching cited source segment'),
                }
                for field in ['versionSource', 'sourceSegmentRefs', 'sourceLanguage', 'sourceTranslationSha256']:
                    if correction.get(field) is not None:
                        revised['provenance']['sourceQuotationRelease'][field] = copy.deepcopy(correction[field])
            link_correction = link_map.get((path, incoming['placementId']))
            if link_correction:
                assert current['placementId'] == link_correction['currentPlacementId'], 'Source-link placement changed'
                applied = apply_source_link_correction(revised, link_correction)
                link_records.append({**copy.deepcopy(link_correction),
                    'status': 'applied' if applied else 'superseded-by-source-restoration'})
            new_block['footnotes'][match['live_index']] = revised
            touched_blocks.setdefault(path, set()).add(tuple(indices))
            matched_new[(path, tuple(indices), match['live_index'])] = revised
    assert {(entry['path'], entry['placementId']) for entry in restoration_records} == set(restoration_map), \
        'Source restorations contain an unknown or unmatched footnote placement'
    assert {(entry['path'], entry['incomingPlacementId']) for entry in link_records} == set(link_map), \
        'Source-link corrections contain an unknown or unmatched footnote placement'
    removed = []
    for extra in sorted(mapping['extras'], key=lambda item: (item['path'], item['block'], -item['i'])):
        path = extra['path']
        indices = [int(part) for part in extra['block'].strip('/').split('/')]
        assert (path, tuple(indices), extra['i']) not in matched_new
        if path not in before_cache:
            before_cache[path] = json.loads((baseline / path).read_bytes())
            after_cache[path] = copy.deepcopy(before_cache[path])
        current = locate(before_cache[path], indices)['footnotes'][extra['i']]
        assert current == extra['note']
        original = ' '.join(item.get('text', '') for item in current.get('paragraphs', []))
        if path.startswith('data/divrei-soferim/'):
            first = original.split('Context and connection to')[0]
            remainder = first.replace('Editorial note from the Har Bracha edition citing', '')
            assert not re.search(r'[A-Za-z\u05d0-\u05ea]', remainder), 'Cannot remove a substantive editorial source'
            reason = 'Empty corrupted editorial note: only punctuation and scaffold remained, with no source quotation.'
        else:
            assert current['placementId'] == 'MTZ-0768-1' and current['sources'][0]['ref'] == 'Shulchan Arukh, Yoreh De'
            reason = 'Broken source title and generic placeholder without a source quotation.'
        # Removal by identity remains correct when several empty notes share one block.
        array = locate(after_cache[path], indices)['footnotes']
        array[:] = [item for item in array if item['placementId'] != current['placementId']]
        touched_blocks.setdefault(path, set()).add(tuple(indices))
        removed.append({'path': path, 'blockPath': indices, 'noteKey': current['placementId'], 'reason': reason})
    assert len(removed) == 129
    files = []
    for path in sorted(after_cache):
        before, after = before_cache[path], after_cache[path]
        assert body(before) == body(after)
        if before == after:
            continue
        raw = (baseline / path).read_bytes()
        newline = raw.endswith(b'\n')
        assert serial(before, newline) == raw
        blocks = []
        updates = 0
        for pointer in sorted(touched_blocks[path]):
            old = locate(before, pointer)['footnotes']
            new = locate(after, pointer)['footnotes']
            if old != new:
                blocks.append({'path': list(pointer), 'before': old, 'after': new})
                old_by_key = {item['placementId']: item for item in old}
                updates += sum(item != old_by_key.get(item['placementId']) for item in new)
        files.append({'path': path, 'beforeSha256': sha(raw), 'afterSha256': sha(serial(after)),
                      'beforeTrailingNewline': newline, 'bodySha256': sha(canonical(body(before))),
                      'notesBefore': len(notes(before)), 'notesAfter': len(notes(after)),
                      'updatedNotes': updates, 'blocks': blocks})
    protected = []
    for book in sorted(EXCLUDED):
        for file in sorted((baseline / 'data' / book).rglob('*')):
            if file.is_file():
                protected.append({'path': file.relative_to(baseline).as_posix(), 'sha256': sha(file.read_bytes())})
    result = {'schemaVersion': 1, 'release': RELEASE,
              'sourceArchive': {'name': archive_path.name, 'sha256': sha(archive_path.read_bytes())},
              'excludedBooks': sorted(EXCLUDED), 'books': sorted(mapping['books']),
              'matchedNotes': len(matches), 'files': files, 'protectedFiles': protected,
              'removedNotes': removed, 'exceptions': exception_records,
              'quotationRestorations': restoration_records, 'linkCorrections': link_records}
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    compressed = gzip.compress(serial(result), compresslevel=9, mtime=0)
    target.write_bytes(compressed)
    print(json.dumps({'output': target.as_posix(), 'sha256': sha(compressed), 'bytes': len(compressed),
                      'changedFiles': len(files), 'matchedNotes': len(matches),
                      'updatedNotes': sum(item['updatedNotes'] for item in files),
                      'removedNotes': len(removed), 'restoredQuotations': len(restoration_records),
                      'repairedSourceLinks': sum(record['status'] == 'applied' for record in link_records)}))


if __name__ == '__main__':
    main()

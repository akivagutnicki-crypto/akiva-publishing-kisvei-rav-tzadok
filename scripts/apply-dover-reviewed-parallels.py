#!/usr/bin/env python3
"""Publish only the reviewed Dover base and explicitly approved source parallels."""
import copy
import gzip
import hashlib
import html
import json
import re
import runpy
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

RELEASE = '20261018-dover-reviewed-parallels-v3'
BASE = Path('sources/akiva/overlays/dover-clean-base-20261018.json.gz')
APPROVED = Path('sources/akiva/footnotes/Dover_Tzedek_Approved_Parallels.json')
BODY_LINKS = Path('sources/akiva/overlays/dover-reviewed-body-links-20261018.json')
ROOT = Path('dist/library')
BOOK = ROOT / 'data/dover-tzedek'
REPORT = ROOT / 'dover-revisions-report.json'
ANCHORS = ('number', 'sourceId', 'placementId', 'phraseIndex', 'heWord', 'heWordText',
           'heCharOffset', 'enCharOffset', 'heAnchorPrefix', 'enAnchorPrefix')
REJECTED_LABEL = re.compile(r'^\s*(?:Kisvei Rav Tzadok Parallel|Kisvei Beis Ishbitz|Parallel\s*:)', re.I)


def serial(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def reviewed_cache_key(value, approved_sha256):
    suffix = '-dover-reviewed-parallels-v3-' + approved_sha256[:12]
    previous = r'-dover-reviewed-parallels-v3(?:-[0-9a-f]{12})?(?=-|$)'
    return re.sub(previous, suffix, value) if re.search(previous, value) else value + suffix


def visible(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value or '')))


def norm(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', visible(value))).strip()


def bare_hebrew(value):
    return re.sub(r'[^א-ת]', '', visible(value))


def body_info(rows):
    return {key: sha(serial([[row['n'], [norm(pair[language]) for pair in row['p']]]
                            for row in rows if isinstance(row, dict) and row.get('p')]))
            for language, key in ((0, 'heSha256'), (1, 'enSha256'))}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(serial(value) + '\n')
    temporary.replace(path)


def source_interval(ref):
    """Ranges overlap even when one citation uses an abbreviated endpoint."""
    match = re.fullmatch(r'(.*?)\s+(\d+(?::\d+)*)(?:[-–](\d+(?::\d+)*))?', norm(ref))
    if not match:
        raise ValueError('Approved canonicalRef needs a precise numeric paragraph: ' + ref)
    book, first, last = match.groups()
    start = tuple(map(int, first.split(':')))
    end = tuple(map(int, (last or first).split(':')))
    if len(end) < len(start):
        end = start[:-len(end)] + end
    if end < start:
        raise ValueError('Reversed approved source range: ' + ref)
    book = re.sub(r'[^a-z0-9א-ת]', '', book.lower())
    return book, start + (0,) * (8-len(start)), end + (10**9,) * (8-len(end))


def exact_href(url):
    parsed = urlparse(url)
    if parsed.fragment.startswith('/read/') and parsed.hostname == 'akivagutnicki-crypto.github.io':
        return '#' + parsed.fragment
    if url.startswith('#/read/') or (parsed.scheme == 'https' and parsed.hostname in ('www.sefaria.org', 'sefaria.org')):
        return url
    raise ValueError('Unvalidated approved source URL: ' + url)


def validate_approved(pack):
    records = pack.get('replacements', [])
    if pack.get('book') != 'Dover Tzedek' or not records:
        raise ValueError('No explicitly approved Dover replacements')
    if pack.get('presentation') != 'english-only':
        raise ValueError('Reviewed additions must be presented in English only')
    if pack.get('quoteLayout') != 'one-paragraph-per-source':
        raise ValueError('A reviewed source needs one citation and one quotation paragraph')
    ids, intervals, hebrew, english, whole_sources = set(), [], set(), set(), set()
    for record in records:
        required = ('id', 'targetSourceId', 'targetPlacementId', 'corpus', 'sourceRef', 'sourceUrl', 'contextAssessment', 'explanatoryValue', 'evidence')
        if any(not record.get(key) for key in required):
            raise ValueError('Incomplete approved replacement: ' + str(record.get('id')))
        if record['id'] in ids:
            raise ValueError('Duplicate approved record ID')
        ids.add(record['id'])
        if not re.fullmatch(r'DT-\d{4}', record['targetSourceId']) or record['targetPlacementId'] != record['targetSourceId'] + '-1':
            raise ValueError('Invalid stable approved placement')
        exact_href(record['sourceUrl'])
        interval = source_interval(record.get('canonicalRef') or record['sourceRef'])
        if any(interval[0] == old[0] and interval[1] <= old[2] and old[1] <= interval[2] for old in intervals):
            raise ValueError('Approved source paragraph/range reused: ' + record['sourceRef'])
        intervals.append(interval)
        evidence = record['evidence']
        evidence_keys = ['archive', 'archiveSha256', 'sourceHebrew', 'sourceHebrewSha256', 'verification']
        if evidence.get('archiveContainsPassage') is False:
            evidence_keys.extend(('sourcePath', 'sourceSha256', 'jsonPointer', 'archiveCoverageNote'))
        else:
            evidence_keys.extend(('member', 'memberSha256'))
        for key in evidence_keys:
            if not evidence.get(key):
                raise ValueError('Missing uploaded-library evidence ' + key + ': ' + record['id'])
        for key in ('archiveSha256', 'memberSha256', 'sourceSha256', 'sourceHebrewSha256'):
            if key in evidence and not re.fullmatch('[0-9a-f]{64}', evidence[key]):
                raise ValueError('Invalid provenance digest: ' + key)
        if evidence.get('sourcePath'):
            source_bytes = Path(evidence['sourcePath']).read_bytes()
            if sha(source_bytes) != evidence['sourceSha256']:
                raise ValueError('Canonical source file changed: ' + record['id'])
            source_value = json.loads(source_bytes)
            for token in evidence['jsonPointer'].strip('/').split('/'):
                token = token.replace('~1', '/').replace('~0', '~')
                source_value = source_value[int(token)] if isinstance(source_value, list) else source_value[token]
            if not source_value:
                raise ValueError('Canonical source pointer is empty: ' + record['id'])
        if sha(evidence['sourceHebrew']) != evidence['sourceHebrewSha256']:
            raise ValueError('Source Hebrew evidence checksum changed: ' + record['id'])
        source_key = bare_hebrew(evidence['sourceHebrew'])
        if source_key in whole_sources:
            raise ValueError('The same source paragraph is reused under another reference')
        whole_sources.add(source_key)
        excerpts = record.get('excerpts') or [record]
        for excerpt in excerpts:
            he, en = excerpt.get('hebrewQuote', ''), excerpt.get('englishQuote', '')
            if not he.strip() or not en.strip() or not re.search('[A-Za-z]', en):
                raise ValueError('Approved excerpt lacks exact Hebrew/full English')
            if norm(he) not in norm(evidence['sourceHebrew']):
                raise ValueError('Approved Hebrew is not a contiguous exact source excerpt: ' + record['id'])
            hk, ek = bare_hebrew(he), norm(en).lower()
            if hk in hebrew or ek in english:
                raise ValueError('Approved quotation is repeated across Dover')
            hebrew.add(hk); english.add(ek)
    return records


def approved_paragraphs(record):
    label = record['corpus'] + ' — ' + (record.get('displayCitation') or record['sourceRef'])
    href = exact_href(record['sourceUrl'])
    quote = ' […] '.join(excerpt['englishQuote'] for excerpt in record.get('excerpts') or [record])
    rich = [{'text': label, 'bold': True, 'href': href}, {'text': ': “' + quote + '”'}]
    text = ''.join(run['text'] for run in rich)
    if re.search(r'[\u0590-\u05ff\ufb1d-\ufb4f]', text):
        raise ValueError('Hebrew is not allowed in a new English-only addition: ' + record['id'])
    return [{'text': text, 'rich': rich, 'language': 'en', 'approvedParallelId': record['id']}]


def remove_unsupported_body_links(rows, file, manifest):
    """Unwrap only the finite audited guesses; leave the source words intact."""
    for record in manifest['removeWrappers']:
        if record['file'] != file:
            continue
        row = rows[record['rowIndex']]
        if row['n'] != record['rowN']:
            raise ValueError('Reviewed body-link paragraph changed: ' + file)
        pair = row['p'][record['phraseIndex']]
        language = record['languageIndex']
        current = pair[language]
        if sha(current) == record['outputCellSha256']:
            continue
        if sha(current) != record['inputCellSha256'] or current.count(record['outerHTML']) != 1:
            raise ValueError('Reviewed body-link source changed: ' + file + ':' + str(row['n']))
        cleaned = current.replace(record['outerHTML'], record['innerHTML'], 1)
        if sha(cleaned) != record['outputCellSha256'] or visible(cleaned) != visible(current):
            raise ValueError('Body-link cleanup changed the source words')
        pair[language] = cleaned


def main():
    raw_base = gzip.decompress(BASE.read_bytes())
    base = json.loads(raw_base)
    approved_raw = APPROVED.read_bytes()
    approved_pack = json.loads(approved_raw)
    body_link_raw = BODY_LINKS.read_bytes()
    body_links = json.loads(body_link_raw)
    if approved_pack.get('bodyLinkReviewSha256') != sha(body_link_raw):
        raise ValueError('Reviewed body-link manifest changed without a reader cache revision')
    approved = validate_approved(approved_pack)
    legacy = json.loads(REPORT.read_text())
    helpers = runpy.run_path('scripts/publish-dover-revisions.py')
    ref_from_url, ref_key = helpers['reference_from_url'], helpers['ref_key']
    bases = {entry['note']['number']: entry for entry in base['notes']}
    quarantine = {entry['note']['number']: entry for entry in base['quarantinedNotes']}
    if set(bases) & set(quarantine) or set(bases) | set(quarantine) != set(range(1, 2699)):
        raise ValueError('Clean/quarantine registry must account for every original stable note ID')
    additions = {}
    for record in approved:
        number = int(record['targetSourceId'][3:])
        seed = bases.get(number) or quarantine.get(number)
        if not seed or seed['note']['placementId'] != record['targetPlacementId']:
            raise ValueError('Approved note has no exact original placement')
        additions.setdefault(number, []).append(record)
    sections, staged, expected, restored = [], {}, [], []
    rejected = set(base['rejectedTextHashes'])
    kept_by_anchor = {}
    old_expected = {note['number']: note for note in legacy['expectedNotes']}
    for section in base['sections']:
        file = section['file']
        rows = json.loads((BOOK / file).read_text())
        if body_info(rows) != {key: section[key] for key in ('heSha256', 'enSha256')}:
            raise ValueError('Main Dover text changed before clean publication: ' + file)
        remove_unsupported_body_links(rows, file, body_links)
        before_nonnotes = [{key: value for key, value in row.items() if key != 'footnotes'} if isinstance(row, dict) else row for row in rows]
        for row in rows:
            if not isinstance(row, dict) or 'p' not in row:
                continue
            selected = [entry for number, entry in {**quarantine, **bases}.items()
                        if entry['file'] == file and entry['paragraph'] == row['n'] and (number in bases or number in additions)]
            notes = []
            anchor = section['ref'] + ':' + str(row['n'])
            evidence_refs = {ref_key(html.unescape(ref)) for pair in row['p'] for cell in pair
                             for ref in re.findall(r'data-ref=["\']([^"\']+)', cell)}
            for entry in sorted(selected, key=lambda item: item['note']['number']):
                seed = entry['note']; number = seed['number']
                note = (copy.deepcopy(seed) if number in bases else
                        {key: copy.deepcopy(seed[key]) for key in ANCHORS if key in seed})
                retained = copy.deepcopy(seed['paragraphs']) if number in bases else []
                if any(REJECTED_LABEL.match(norm(p['text'])) or sha(norm(p['text'])) in rejected for p in retained):
                    raise ValueError('Rejected paragraph remains in the clean base: ' + str(number))
                note['paragraphs'] = copy.deepcopy(retained)
                note['sources'] = copy.deepcopy(seed.get('sources', [])) if number in bases else []
                note['nativeConnections'] = copy.deepcopy(seed.get('nativeConnections', [])) if number in bases else []
                for source in note['sources'] + note['nativeConnections']:
                    if source.get('ref'):
                        evidence_refs.add(ref_key(source['ref']))
                for p in retained:
                    for run in p.get('rich', []):
                        if run.get('href') and ref_from_url(run['href']):
                            evidence_refs.add(ref_key(ref_from_url(run['href'])))
                if number in quarantine:
                    restored.append(number)
                records = additions.get(number, [])
                note['reviewedParallelIds'] = [record['id'] for record in records]
                for record in records:
                    note['paragraphs'].extend(approved_paragraphs(record))
                    source = {'ref': record.get('canonicalRef') or record['sourceRef'], 'url': record['sourceUrl'],
                              'role': 'reviewed-conceptual-parallel', 'approvedParallelId': record['id'],
                              'displayCitation': record.get('displayCitation') or record['sourceRef']}
                    if record.get('readerRef'):
                        source['readerRef'] = record['readerRef']
                    note['sources'].append(source)
                    note['nativeConnections'].append(copy.deepcopy(source))
                if not note['paragraphs']:
                    raise ValueError('An empty footnote reached publication')
                phrase = visible(row['p'][note['phraseIndex']][0])
                if phrase[:note['heCharOffset']] != note['heAnchorPrefix']:
                    raise ValueError('Stable Hebrew word placement changed: ' + str(number))
                note['provenance'] = {**note.get('provenance', {}), 'sourceId': note['sourceId'],
                                      'printedNumber': number, 'release': RELEASE}
                notes.append(note)
                previous = old_expected.get(number, {})
                expected.append({**previous, **{key: note[key] for key in ANCHORS if key in note},
                                 'file': file, 'paragraph': row['n'], 'paragraphs': note['paragraphs'],
                                 'baselineParagraphs': retained, 'originalParagraphCount': len(retained),
                                 'originalParagraphsSha256': sha(serial(retained)),
                                 'addedParagraphCount': len(note['paragraphs'])-len(retained),
                                 'reviewedParallelIds': note['reviewedParallelIds']})
            row['footnotes'] = notes
            kept_by_anchor[anchor] = evidence_refs
        after_nonnotes = [{key: value for key, value in row.items() if key != 'footnotes'} if isinstance(row, dict) else row for row in rows]
        if before_nonnotes != after_nonnotes:
            raise ValueError('Clean publication altered body/headings/non-note fields')
        updated_section = copy.deepcopy(section)
        removed_he = sum(record['file'] == file and record['languageIndex'] == 0 for record in body_links['removeWrappers'])
        removed_en = sum(record['file'] == file and record['languageIndex'] == 1 for record in body_links['removeWrappers'])
        updated_section.update(heLinks=section['heLinks']-removed_he, enLinks=section['enLinks']-removed_en,
            addedHebrewLinks=section['addedHebrewLinks']-removed_he,
            removedUnsupportedHebrewLinks=removed_he, removedUnsupportedEnglishLinks=removed_en)
        staged[file] = rows; sections.append(updated_section)
    links = json.loads((BOOK / 'links.json').read_text())
    removed_links = 0
    for section, records in links.items():
        kept = []
        for edge in records:
            if edge.get('source') == '20261018-dover-revisions-v2' and ref_key(edge.get('r', '')) not in kept_by_anchor.get(edge.get('a'), set()):
                removed_links += 1
            else:
                kept.append(edge)
        links[section] = kept
    report = {**legacy, 'release': RELEASE, 'notes': len(expected), 'sections': sections,
              'expectedNotes': sorted(expected, key=lambda note: note['number']),
              'cleanedSourceSha256': sha(raw_base), 'approvedSourcesSha256': sha(approved_raw),
              'reviewedParallels': approved, 'parallelPresentation': 'english-only',
              'bodyLinkReviewSha256': sha(body_link_raw),
              'quarantinedNumbers': sorted(set(quarantine)-set(restored)),
              'sourceManifestSha256': base['sourceManifestSha256'],
              'counts': {**{key: value for key, value in legacy.get('counts', {}).items()
                           if key in ('sections', 'contentSections', 'removedHebrewLinks')},
                         'notes': len(expected), 'retainedBaseNotes': len(bases),
                         'quarantinedNotes': len(quarantine)-len(restored), 'restoredNotes': len(restored),
                         'retainedBaseParagraphs': sum(len(entry['note']['paragraphs']) for entry in bases.values()),
                         'cleanBaseParagraphsPreserved': True,
                         'addedSourceParagraphs': sum(note['addedParagraphCount'] for note in expected),
                         'approvedReplacements': len(approved), 'rejectedParagraphsRemoved': base['removedParagraphCount'],
                         'addedHebrewLinks': sum(section['addedHebrewLinks'] for section in sections),
                         'removedUnsupportedBodyLinks': len(body_links['removeWrappers']),
                         'removedUnsupportedConnections': removed_links + (legacy.get('counts', {}).get('removedUnsupportedConnections', 0) if legacy.get('release') == RELEASE else 0),
                         'bodyChanges': 0}}
    toc = json.loads((BOOK / 'toc.json').read_text())
    toc['revisedFootnotes'] = {'release': RELEASE, 'notes': len(expected), 'report': REPORT.name}
    toc['reviewedParallels'] = {'release': RELEASE, 'sources': len(approved), 'quarantinedNotes': report['counts']['quarantinedNotes']}
    for file, rows in staged.items():
        write(BOOK / file, rows)
    write(BOOK / 'links.json', links); write(BOOK / 'toc.json', toc); write(REPORT, report)
    index = ROOT / 'index.html'
    text = index.read_text()
    cache = '20261018-dover-elaboration-sources-revisions-v2-title-paragraphs-v1-headings-v1'
    # Other book publishers prepend their own branches during a fresh build.
    # Match Dover's branch wherever it occurs in the URL resolver.
    declaration = re.search(r'^const editionDataUrl = [\s\S]*?;\s*(?=const catalogReady)', text, re.M)
    edition = re.search(r"url\.startsWith\('data/dover-tzedek/'\) \? url \+ '\?edition=([^']+)'", declaration.group(0) if declaration else '')
    if not edition or not edition.group(1).startswith(cache):
        raise ValueError('Dover edition cache key is missing')
    edition_key = reviewed_cache_key(edition.group(1), report['approvedSourcesSha256'])
    if edition_key != edition.group(1):
        start, end = declaration.start() + edition.start(1), declaration.start() + edition.end(1)
        index.write_text(text[:start] + edition_key + text[end:])
    worker = ROOT / 'sw.js'
    text = worker.read_text()
    shell = re.search(r'^const SHELL = `([^`]+)`;', text, re.M)
    if not shell:
        raise ValueError('Reader shell cache key is missing')
    shell_key = reviewed_cache_key(shell.group(1), report['approvedSourcesSha256'])
    if shell_key != shell.group(1):
        worker.write_text(text[:shell.start(1)] + shell_key + text[shell.end(1):])
    helpers['refresh_manifest']()
    print(f'Published clean Dover: {len(expected)} notes, {len(approved)} explicitly reviewed sources; {report["counts"]["quarantinedNotes"]} notes quarantined; no rejected parallel blocks.')


if __name__ == '__main__':
    main()

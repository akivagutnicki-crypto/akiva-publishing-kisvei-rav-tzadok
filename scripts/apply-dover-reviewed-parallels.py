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
TEXT_CORRECTIONS = Path('sources/akiva/overlays/dover-verified-text-corrections-20261018.json')
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


def nonnotes(rows):
    return [{key: value for key, value in row.items() if key != 'footnotes'}
            if isinstance(row, dict) else row for row in rows]


def body_fingerprint(rows):
    return sha(json.dumps(nonnotes(rows), ensure_ascii=False, sort_keys=True, separators=(',', ':')))


def pointer_value(value, pointer):
    if not isinstance(pointer, str) or not pointer.startswith('/'):
        raise ValueError('A primary proof needs an exact JSON pointer')
    for token in pointer[1:].split('/'):
        token = token.replace('~1', '/').replace('~0', '~')
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value


def primary_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ' '.join(primary_text(item) for item in value)
    raise ValueError('A primary proof pointer must resolve to text or a text array')


def validate_text_corrections(pack, sections, notes):
    """A closed list of separately verified body edits, never a global cleanup."""
    if pack.get('book') != 'Dover Tzedek' or pack.get('release') != '20261018-dover-verified-text-corrections-v1':
        raise ValueError('Unexpected verified Dover text-correction manifest')
    corrections = pack.get('corrections', [])
    if not corrections:
        raise ValueError('Verified body corrections cannot be empty')
    section_files = {section['file'] for section in sections}
    fingerprints = pack.get('sections', [])
    if len(fingerprints) != len(section_files) or {entry['file'] for entry in fingerprints} != section_files:
        raise ValueError('Verified corrections must fingerprint every original section')
    for entry in fingerprints:
        for key in ('beforeNonNotesSha256', 'afterNonNotesSha256'):
            if not re.fullmatch('[0-9a-f]{64}', str(entry.get(key, ''))):
                raise ValueError('Incomplete exact body preservation fingerprint')
    seen = set()
    for record in corrections:
        key = (record.get('file'), record.get('rowN'), record.get('phraseIndex'))
        if key in seen or key[0] not in section_files or key[0] == '0.json':
            raise ValueError('Duplicate or non-body correction location')
        seen.add(key)
        if not isinstance(key[2], int) or key[2] < 0 or not record.get('reason', '').strip():
            raise ValueError('Incomplete verified text-correction location/reason')
        for field in ('beforePair', 'afterPair'):
            pair = record.get(field)
            if not isinstance(pair, list) or len(pair) != 2 or any(not isinstance(cell, str) for cell in pair):
                raise ValueError('A text correction needs one exact Hebrew/English pair')
        before, after = record['beforePair'], record['afterPair']
        if before == after:
            raise ValueError('An unchanged phrase cannot be a text correction')
        he, en = map(visible, after)
        if not he.strip() or not en.strip():
            raise ValueError('A corrected phrase cannot have an empty language field')
        if before[0] != after[0] and any(unicodedata.category(char).startswith('L') and not ('\u0590' <= char <= '\u05ff' or '\ufb1d' <= char <= '\ufb4f') for char in he):
            raise ValueError('A repaired Hebrew field still contains foreign letters')
        if re.fullmatch(r'[\s\u0590-\u05ff]*[ETl][\s\u0590-\u05ff]*', en) or re.search(r'\(\s*\)', en):
            raise ValueError('A corrected English field retains an orphan letter/empty calculation')
        if before[1] != after[1] and re.search(r'[\u0590-\u05ff\ufb1d-\ufb4f]', en):
            raise ValueError('A repaired English field still contains Hebrew fragments')
        if re.search(r'out of\s+being the majority|yielding\s*;', en):
            raise ValueError('A corrected English field retains an incomplete calculation')
        evidence = record.get('primaryEvidence', {})
        source_path = Path(evidence.get('sourcePath', ''))
        if not str(source_path).startswith('sources/verified/dover/') or '..' in source_path.parts:
            raise ValueError('A verified correction needs a repository primary proof')
        source_bytes = source_path.read_bytes()
        if not re.fullmatch('[0-9a-f]{64}', str(evidence.get('sourceSha256', ''))) or sha(source_bytes) != evidence['sourceSha256']:
            raise ValueError('Verified body primary source changed')
        pointed = primary_text(pointer_value(json.loads(source_bytes), evidence.get('jsonPointer')))
        excerpt = evidence.get('exactHebrewExcerpt', '')
        if not bare_hebrew(excerpt) or bare_hebrew(excerpt) not in bare_hebrew(pointed):
            raise ValueError('Body correction lacks an exact excerpt in its full primary proof')
    anchor_updates = pack.get('anchorUpdates', [])
    seen_anchors = set()
    all_notes = {entry['note']['sourceId']: entry for entry in notes}
    for update in anchor_updates:
        source_id = update.get('sourceId')
        if source_id in seen_anchors or source_id not in all_notes:
            raise ValueError('Duplicate or unknown corrected English anchor')
        seen_anchors.add(source_id)
        entry = all_notes[source_id]
        note = entry['note']
        if not any(record['file'] == entry['file'] and record['rowN'] == entry['paragraph'] and record['phraseIndex'] == note['phraseIndex'] for record in corrections):
            raise ValueError('An English anchor correction has no declared phrase repair')
        if set(update.get('before', {})) != {'enCharOffset', 'enAnchorPrefix'} or set(update.get('after', {})) != {'enCharOffset', 'enAnchorPrefix'}:
            raise ValueError('Only exact English prefix/offset fields may be corrected')
        if any(update['before'][key] != note.get(key) for key in update['before']):
            raise ValueError('Original English anchor differs from the clean source')
        if not isinstance(update['after']['enCharOffset'], int) or update['after']['enCharOffset'] < 0 or len(update['after']['enAnchorPrefix']) != update['after']['enCharOffset']:
            raise ValueError('Corrected English anchor prefix/offset disagree')
    return corrections


def repair_pair(rows, record):
    matches = [row for row in rows if isinstance(row, dict) and row.get('p') and row['n'] == record['rowN']]
    if len(matches) != 1 or record['phraseIndex'] >= len(matches[0]['p']):
        raise ValueError('A verified phrase location changed')
    return matches[0]['p'], record['phraseIndex']


def original_body(rows, file, pack):
    restored = copy.deepcopy(rows)
    for record in pack['corrections']:
        if record['file'] != file:
            continue
        pairs, index = repair_pair(restored, record)
        if pairs[index] == record['afterPair']:
            pairs[index] = copy.deepcopy(record['beforePair'])
        elif pairs[index] != record['beforePair']:
            raise ValueError('Verified text correction encountered an unreviewed phrase: ' + file)
    fingerprint = next(entry for entry in pack['sections'] if entry['file'] == file)
    if body_fingerprint(restored) != fingerprint['beforeNonNotesSha256']:
        raise ValueError('An undeclared body/header field changed: ' + file)
    return restored


def apply_text_corrections(rows, file, pack):
    for record in pack['corrections']:
        if record['file'] != file:
            continue
        pairs, index = repair_pair(rows, record)
        if pairs[index] not in (record['beforePair'], record['afterPair']):
            raise ValueError('Verified text correction does not match either reviewed state')
        pairs[index] = copy.deepcopy(record['afterPair'])
    fingerprint = next(entry for entry in pack['sections'] if entry['file'] == file)
    if body_fingerprint(rows) != fingerprint['afterNonNotesSha256']:
        raise ValueError('A body change escaped the finite approved repairs: ' + file)


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


def new_placements(pack, bases, quarantine):
    """Explicit new Hebrew anchors for reviewed sources where the original edition has no note.

    Original stable numbers 1-2698 are never reused or moved; each new anchor takes the next
    number above them, names its exact Hebrew word, and must carry at least one approved source.
    """
    created = {}
    taken = {(e['file'], e['paragraph'], e['note']['phraseIndex'], e['note']['heWord'])
             for e in list(bases.values()) + list(quarantine.values())}
    for record in pack.get('newPlacements', []):
        number = record.get('number')
        if not isinstance(number, int) or number <= 2698 or number in created or number in bases or number in quarantine:
            raise ValueError('A new placement needs a fresh number above the original 2,698 notes')
        if record.get('sourceId') != f'DT-{number:04}' or record.get('placementId') != record['sourceId'] + '-1':
            raise ValueError('Invalid new placement ID: ' + str(number))
        if not str(record.get('reason', '')).strip():
            raise ValueError('A new placement must state why the anchor is needed: ' + str(number))
        for key in ('file', 'paragraph', 'phraseIndex', 'heWord', 'heCharOffset', 'heAnchorPrefix', 'enCharOffset', 'enAnchorPrefix'):
            if record.get(key) in (None, ''):
                raise ValueError('Incomplete new placement anchor: ' + str(number))
        position = (record['file'], record['paragraph'], record['phraseIndex'], record['heWord'])
        if position in taken:
            raise ValueError('A new placement duplicates an existing Hebrew anchor: ' + str(number))
        taken.add(position)
        note = {key: copy.deepcopy(record[key]) for key in ANCHORS if key in record}
        note['paragraphs'] = []
        created[number] = {'file': record['file'], 'paragraph': record['paragraph'], 'note': note}
    return created


def main():
    raw_base = gzip.decompress(BASE.read_bytes())
    base = json.loads(raw_base)
    approved_raw = APPROVED.read_bytes()
    approved_pack = json.loads(approved_raw)
    body_link_raw = BODY_LINKS.read_bytes()
    body_links = json.loads(body_link_raw)
    if approved_pack.get('bodyLinkReviewSha256') != sha(body_link_raw):
        raise ValueError('Reviewed body-link manifest changed without a reader cache revision')
    corrections_raw = TEXT_CORRECTIONS.read_bytes()
    text_corrections = json.loads(corrections_raw)
    if approved_pack.get('verifiedTextCorrectionsSha256') != sha(corrections_raw):
        raise ValueError('Verified text corrections changed without a reader cache revision')
    corrections = validate_text_corrections(text_corrections, base['sections'], base['notes'] + base['quarantinedNotes'])
    anchor_updates = {update['sourceId']: update for update in text_corrections.get('anchorUpdates', [])}
    approved = validate_approved(approved_pack)
    legacy = json.loads(REPORT.read_text())
    helpers = runpy.run_path('scripts/publish-dover-revisions.py')
    ref_from_url, ref_key = helpers['reference_from_url'], helpers['ref_key']
    bases = {entry['note']['number']: entry for entry in base['notes']}
    quarantine = {entry['note']['number']: entry for entry in base['quarantinedNotes']}
    if set(bases) & set(quarantine) or set(bases) | set(quarantine) != set(range(1, 2699)):
        raise ValueError('Clean/quarantine registry must account for every original stable note ID')
    created = new_placements(approved_pack, bases, quarantine)
    additions = {}
    for record in approved:
        number = int(record['targetSourceId'][3:])
        seed = bases.get(number) or quarantine.get(number) or created.get(number)
        if not seed or seed['note']['placementId'] != record['targetPlacementId']:
            raise ValueError('Approved note has no exact original placement')
        additions.setdefault(number, []).append(record)
    if any(number not in additions for number in created):
        raise ValueError('A new placement has no approved source')
    sections, staged, expected, restored = [], {}, [], []
    rejected = set(base['rejectedTextHashes'])
    kept_by_anchor = {}
    old_expected = {note['number']: note for note in legacy['expectedNotes']}
    for section in base['sections']:
        file = section['file']
        rows = json.loads((BOOK / file).read_text())
        remove_unsupported_body_links(rows, file, body_links)
        original_rows = original_body(rows, file, text_corrections)
        if body_info(original_rows) != {key: section[key] for key in ('heSha256', 'enSha256')}:
            raise ValueError('Original Dover text differs beyond verified repairs: ' + file)
        apply_text_corrections(rows, file, text_corrections)
        before_nonnotes = copy.deepcopy(nonnotes(rows))
        for row in rows:
            if not isinstance(row, dict) or 'p' not in row:
                continue
            selected = [entry for number, entry in {**created, **quarantine, **bases}.items()
                        if entry['file'] == file and entry['paragraph'] == row['n'] and (number in bases or number in additions)]
            notes = []
            anchor = section['ref'] + ':' + str(row['n'])
            evidence_refs = {ref_key(html.unescape(ref)) for pair in row['p'] for cell in pair
                             for ref in re.findall(r'data-ref=["\']([^"\']+)', cell)}
            for entry in sorted(selected, key=lambda item: item['note']['number']):
                seed = entry['note']; number = seed['number']
                note = (copy.deepcopy(seed) if number in bases else
                        {key: copy.deepcopy(seed[key]) for key in ANCHORS if key in seed})
                if note['sourceId'] in anchor_updates:
                    note.update(copy.deepcopy(anchor_updates[note['sourceId']]['after']))
                    en_phrase = visible(row['p'][note['phraseIndex']][1])
                    if en_phrase[:note['enCharOffset']] != note['enAnchorPrefix']:
                        raise ValueError('Corrected English anchor misses its exact phrase: ' + note['sourceId'])
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
        after_nonnotes = nonnotes(rows)
        if before_nonnotes != after_nonnotes:
            raise ValueError('Clean publication altered body/headings/non-note fields')
        updated_section = copy.deepcopy(section)
        removed_he = sum(record['file'] == file and record['languageIndex'] == 0 for record in body_links['removeWrappers'])
        removed_en = sum(record['file'] == file and record['languageIndex'] == 1 for record in body_links['removeWrappers'])
        updated_section.update(heLinks=section['heLinks']-removed_he, enLinks=section['enLinks']-removed_en,
            addedHebrewLinks=section['addedHebrewLinks']-removed_he,
            removedUnsupportedHebrewLinks=removed_he, removedUnsupportedEnglishLinks=removed_en)
        updated_section.update(body_info(rows), baselineHeSha256=section['heSha256'], baselineEnSha256=section['enSha256'],
                               bodyChanges=sum(record['file'] == file for record in corrections))
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
              'verifiedTextCorrectionsSha256': sha(corrections_raw),
              'quarantinedNumbers': sorted(set(quarantine)-set(restored)),
              'sourceManifestSha256': base['sourceManifestSha256'],
              'counts': {**{key: value for key, value in legacy.get('counts', {}).items()
                           if key in ('sections', 'contentSections', 'removedHebrewLinks')},
                         'notes': len(expected), 'retainedBaseNotes': len(bases),
                         'quarantinedNotes': len(quarantine)-len(restored), 'restoredNotes': len(restored),
                         'retainedBaseParagraphs': sum(len(entry['note']['paragraphs']) for entry in bases.values()),
                         'cleanBaseParagraphsPreserved': True,
                         'addedSourceParagraphs': sum(note['addedParagraphCount'] for note in expected),
                         'approvedReplacements': len(approved), 'newPlacements': len(created), 'rejectedParagraphsRemoved': base['removedParagraphCount'],
                         'addedHebrewLinks': sum(section['addedHebrewLinks'] for section in sections),
                         'removedUnsupportedBodyLinks': len(body_links['removeWrappers']),
                         'removedUnsupportedConnections': removed_links + (legacy.get('counts', {}).get('removedUnsupportedConnections', 0) if legacy.get('release') == RELEASE else 0),
                         'bodyChanges': len(corrections)}}
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

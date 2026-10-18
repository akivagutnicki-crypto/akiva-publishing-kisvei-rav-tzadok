#!/usr/bin/env python3
"""Overlay the supplied Dover revision after the ordinary reader imports.

The checked source quotations, interlinear text, paragraph numbers and existing
note numbers are immutable. Only additional source excerpts and Hebrew citation
links are imported. No archive-wide indexes or other sefarim are copied.
"""
import copy
import gzip
import hashlib
import html
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path('dist/library')
DATA = ROOT / 'data'
BOOK = DATA / 'dover-tzedek'
INPUT = Path('sources/akiva/overlays/dover-revisions-20261018.json.gz')
REPORT = ROOT / 'dover-revisions-report.json'
RELEASE = '20261018-dover-revisions-v2'
SOURCE_SHA = '1d2d2efbf4cf1a420c369fcaac1553087825fefa300ad60f2c09bd0887f79cb6'
FILES = ['0.json'] + [f'{a}-{b}.json' for a, length in [(1, 4), (2, 3), (3, 2), (4, 2), (5, 4)] for b in range(1, length + 1)]
# These are the three incoming edits to an original first source paragraph.
# They are mapped explicitly; the checked original text is retained below.
PRIMARY_VARIANTS = {1287: 1349, 2143: 2243, 2560: 2686}
CONTEXT = re.compile(r'\s+Context and connection to Dover Tzedek\s*:', re.I)
CONNECTION = re.compile(r'\s+Connection to this note\s*:', re.I)
PLACEHOLDER = re.compile(r'(?:\b(?:undefined|null)\b|\[\s*(?:insert|quote|source|translation|placeholder)|(?:source|translation|quotation)\s+(?:not available|unavailable|pending|needed)|Extended English quotation from Akiva interlinear\s*:)', re.I)


def serial(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def sha(value):
    return hashlib.sha256((value if isinstance(value, bytes) else value.encode('utf-8'))).hexdigest()


def visible(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value or '')))


def norm(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', visible(value))).strip()


def primary(value):
    return CONTEXT.split(norm(value), maxsplit=1)[0].strip()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(serial(value) + '\n', encoding='utf-8')
    temporary.replace(path)


def slice_paragraph(paragraph, end):
    """Trim a boilerplate suffix without discarding source-label formatting."""
    out = copy.deepcopy(paragraph)
    text = str(out.get('text', ''))
    out['text'] = text[:end].rstrip()
    runs = out.get('rich')
    if runs:
        if ''.join(str(run.get('text', '')) for run in runs) != text:
            raise ValueError('Source rich-text runs do not reproduce the paragraph')
        remaining = len(out['text'])
        selected = []
        for run in runs:
            if remaining <= 0:
                break
            text_run = str(run.get('text', ''))
            take = min(len(text_run), remaining)
            if take:
                selected.append({**run, 'text': text_run[:take]})
                remaining -= take
        out['rich'] = selected
    return out


def clean_excerpt(paragraph):
    text = str(paragraph.get('text', ''))
    if re.match(r'^\s*Sources\s*:', text, re.I):
        return None
    match = CONNECTION.search(text) or CONTEXT.search(text)
    cleaned = slice_paragraph(paragraph, match.start() if match else len(text))
    if not cleaned['text'].strip() or PLACEHOLDER.search(cleaned['text']):
        return None
    # Source excerpts are plain English text. Metadata claiming verification is
    # deliberately not imported from the supplied generated package.
    for key in ('verificationStatus', 'verified', 'verification'):
        cleaned.pop(key, None)
    return cleaned


def hrefs(paragraph):
    return {str(run.get('href', '')).rstrip('/') for run in paragraph.get('rich', []) if run.get('href')}


def reference_from_url(url):
    """Accept concrete source links only; never invent a cited-slug file."""
    parsed = urlparse(url)
    if parsed.fragment.startswith('/read/') and parsed.hostname in {
            None, 'akivagutnicki-crypto.github.io',
            'akiva-publishing-kisvei-rav-tzadok.netlify.app'}:
        value = unquote(parsed.fragment[len('/read/'):]).replace('_', ' ').strip()
        return value if value.startswith(('Dover Tzedek', 'Peri Tzadik', 'Tzidkat HaTzadik',
                                          'Kometz HaMinchah', 'Resisei Layla', 'Takanat HaShavin',
                                          'Machshavot Charutz', 'Divrei Soferim', 'Poked Akarim',
                                          'Ohr Zarua', 'Yisrael Kedoshim', 'Likkutei Maamarim',
                                          'Sichat Malakhei', 'Sichat Shedim', 'Divrei Chalomot',
                                          'Mei HaShiloach', 'Beit Yaakov')) else None
    if parsed.hostname not in {'www.sefaria.org', 'sefaria.org'} or parsed.query:
        return None
    value = unquote(parsed.path).strip('/').replace('_', ' ')
    if not value or value.startswith(('api/', 'texts/', 'search', 'topics/')):
        return None
    # Official Sefaria URLs accept dotted addresses or a literal colon.
    match = re.match(r'^(.*?)[. ](\d+[ab]?(?:[.:]\d+[ab]?)*(?:[-–]\d+[ab]?(?:[.:]\d+[ab]?)*)?)$', value)
    if match:
        value = match.group(1) + ' ' + match.group(2).replace('.', ':')
    return value


def ref_key(value):
    value = re.sub(r'\s*\(§\d+\)\s*$', '', str(value))
    return re.sub(r'[^a-z0-9]', '', value.lower())


def quoted(value):
    # Compare the actual excerpt as well as its linked source location.
    text = norm(value)
    match = re.search(r'[“‘](.*)[”’]', text)
    return re.sub(r'\s+', ' ', match.group(1) if match else text).strip()


def body_info(rows, file):
    pairs = [row for row in rows if isinstance(row, dict) and 'p' in row]
    texts = [[norm(x) for x in rows], [norm(x) for x in rows]] if file == '0.json' else [
        [[row['n'], [norm(pair[language]) for pair in row['p']]] for row in pairs]
        for language in (0, 1)
    ]
    links = [sum(len(re.findall(r'data-ref=["\']([^"\']*)', pair[language])) for row in pairs for pair in row['p']) for language in (0, 1)]
    return {'heSha256': sha(serial(texts[0])), 'enSha256': sha(serial(texts[1])),
            'heLinks': links[0], 'enLinks': links[1], 'paragraphs': len(pairs),
            'phrases': sum(len(row['p']) for row in pairs)}


def anchors(note, row):
    index = note.get('phraseIndex')
    if not isinstance(index, int) or not 0 <= index < len(row['p']):
        raise ValueError('Footnote has no original phrase: ' + str(note.get('number')))
    for language, column in [('he', 0), ('en', 1)]:
        offset = note.get(language + 'CharOffset')
        prefix = note.get(language + 'AnchorPrefix')
        if not isinstance(offset, int) or visible(row['p'][index][column])[:offset] != prefix:
            raise ValueError('Incorrect supplied character anchor: ' + str(note.get('number')))
    words = visible(row['p'][index][0]).split()
    word = note.get('heWord')
    if not isinstance(word, int) or not 1 <= word <= len(words):
        raise ValueError('Footnote does not follow a Hebrew word')


def refresh_manifest():
    files = sorted(p for p in DATA.rglob('*') if p.is_file() and p != DATA / 'files.json')
    digest = hashlib.sha256()
    size = 0
    for path in files:
        relative = path.relative_to(DATA).as_posix()
        contents = path.read_bytes()
        digest.update(relative.encode()); digest.update(b'\0'); digest.update(contents)
        size += len(contents)
    write(DATA / 'files.json', {'version': digest.hexdigest()[:16], 'bytes': size,
                              'files': [p.relative_to(DATA).as_posix() for p in files]})


def other_data_snapshot():
    """Assert this narrow publisher cannot alter another work or shared index."""
    return {p.relative_to(DATA).as_posix(): sha(p.read_bytes()) for p in DATA.rglob('*')
            if p.is_file() and p != DATA / 'files.json' and BOOK not in p.parents}


def main():
    raw = gzip.decompress(INPUT.read_bytes())
    if sha(raw) != SOURCE_SHA:
        raise ValueError('The supplied Dover revision checksum changed')
    source = json.loads(raw)
    if source.get('title') != 'Dover Tzedek' or [s['file'] for s in source['sections']] != FILES:
        raise ValueError('Unexpected Dover revision source or section set')
    toc = json.loads((BOOK / 'toc.json').read_text())
    # Re-running late in the same build is safe: verify the current overlay and
    # leave its checked original preservation evidence intact.
    if toc.get('revisedFootnotes', {}).get('release') == RELEASE:
        report = json.loads(REPORT.read_text())
        if report.get('sourceSha256') != sha(raw):
            raise ValueError('Dover source changed after this release was applied')
        expected = {note['number']: note for note in report['expectedNotes']}
        for file in FILES:
            for row in json.loads((BOOK / file).read_text()):
                if not isinstance(row, dict):
                    continue
                for note in row.get('footnotes', []):
                    if note['paragraphs'] != expected[note['number']]['paragraphs']:
                        raise ValueError('Published Dover quotation changed on repeat run')
        print('Dover revisions already applied and verified:', len(expected), 'notes')
        return

    baseline_pack = json.loads(Path('sources/akiva/footnotes/Dover_Tzedek_Source_Expansion.json').read_text())
    baseline_notes = {note['number']: note for note in baseline_pack['notes']}
    if set(baseline_notes) != set(range(1, 2699)):
        raise ValueError('The checked Dover baseline must contain all 2,698 notes')
    # The upload is numbered in reading order. A second copy of a translated
    # parallel in the immediately following note adds no context for the reader.
    adjacent_repetitions = set()
    previous_quotes = set()
    incoming_notes = sorted((note for section in source['sections']
                             for row in section['items'] if isinstance(row, dict)
                             for note in row.get('footnotes', [])), key=lambda note: note['number'])
    for incoming_note in incoming_notes:
        current_quotes = set()
        for paragraph in incoming_note['paragraphs'][1:]:
            if not paragraph.get('text', '').startswith(('Kisvei Rav Tzadok Parallel', 'Kisvei Beis Ishbitz')):
                continue
            clean = clean_excerpt(paragraph)
            if clean is None:
                continue
            text = quoted(clean['text'])
            current_quotes.add(text)
            if text in previous_quotes:
                adjacent_repetitions.add((incoming_note['number'], text))
        previous_quotes = current_quotes
    protected_before = other_data_snapshot()
    sections = []
    expected = []
    mapping = {}
    omitted = []
    additions = 0
    original_extra = 0
    staged = {}
    connections = json.loads((BOOK / 'links.json').read_text())
    added_connections = 0
    source_count = 0
    for section in source['sections']:
        file = section['file']
        before = json.loads((BOOK / file).read_text())
        after = copy.deepcopy(before)
        old_info = body_info(before, file)
        new_info = body_info(section['items'], file)
        if (old_info['heSha256'], old_info['enSha256']) != (new_info['heSha256'], new_info['enSha256']):
            raise ValueError('Supplied revision changes Dover body text: ' + file)
        incoming_rows = {row['n']: row for row in section['items'] if isinstance(row, dict) and 'p' in row}
        old_rows = {row['n']: row for row in before if isinstance(row, dict) and 'p' in row}
        if incoming_rows.keys() != old_rows.keys():
            raise ValueError('Supplied Dover paragraph numbers changed: ' + file)
        added_links = removed_links = 0
        section_ref = section['ref']
        records = connections.setdefault(section_ref, [])
        seen_connections = {(record.get('a'), record.get('r')) for record in records}
        for row in after:
            if not isinstance(row, dict) or 'p' not in row:
                continue
            incoming = incoming_rows[row['n']]
            if len(row['p']) != len(incoming['p']):
                raise ValueError('Dover phrase boundaries changed')
            original = old_rows[row['n']]
            old_notes = original.get('footnotes', [])
            new_notes = incoming.get('footnotes', [])
            source_count += len(new_notes)
            position = lambda note: (note['phraseIndex'], note.get('heWord'))
            if Counter(map(position, old_notes)) != Counter(map(position, new_notes)):
                raise ValueError('Supplied Dover footnote placement set changed')
            consumed = set()
            merged = []
            anchor = section_ref + ':' + str(row['n'])
            for note in old_notes:
                number = note['number']
                if note['paragraphs'] != baseline_notes[number]['paragraphs']:
                    raise ValueError('Current Dover source quotation differs from checked baseline: ' + str(number))
                candidates = [candidate for candidate in new_notes
                              if candidate['number'] not in consumed and position(candidate) == position(note)
                              and primary(candidate['paragraphs'][0]['text']) == primary(note['paragraphs'][0]['text'])]
                if len(candidates) != 1 and number in PRIMARY_VARIANTS:
                    candidates = [candidate for candidate in new_notes
                                  if candidate['number'] == PRIMARY_VARIANTS[number]
                                  and position(candidate) == position(note)]
                if len(candidates) != 1:
                    raise ValueError('Cannot uniquely match supplied Dover note: ' + str(number))
                candidate = candidates[0]
                consumed.add(candidate['number'])
                anchors(candidate, incoming)
                out = copy.deepcopy(note)
                out.update({key: copy.deepcopy(candidate[key]) for key in
                            ('heCharOffset', 'enCharOffset', 'heAnchorPrefix', 'enAnchorPrefix')})
                out['sourceId'] = f'DT-{number:04}'
                out['placementId'] = f'DT-{number:04}-1'
                out['provenance'] = {**copy.deepcopy(candidate.get('provenance', {})),
                                     'sourceId': out['sourceId'], 'printedNumber': number,
                                     'uploadedNumber': candidate['number'],
                                     'uploadedSourceId': candidate.get('sourceId'), 'release': RELEASE}
                for key in ('verificationStatus', 'verified', 'verification'):
                    out.pop(key, None)
                original_paragraphs = copy.deepcopy(note['paragraphs'])
                paragraphs = copy.deepcopy(original_paragraphs)
                source_metadata = candidate.get('sources', [])
                primary_sources = {ref_key(s.get('ref')) for s in source_metadata if s.get('role') == 'primary-source'}
                primary_urls = hrefs(original_paragraphs[0])
                retained_urls = set().union(*(hrefs(p) for p in original_paragraphs))
                retained_quotes = {quoted(p['text']) for p in original_paragraphs}
                for paragraph in candidate['paragraphs'][1:]:
                    clean = clean_excerpt(paragraph)
                    reason = None
                    if clean is None:
                        reason = 'boilerplate or placeholder'
                    elif number == 2143:
                        reason = 'manuscript note has no conceptual source parallel'
                    elif number == 1 and 'Dover Tzedek, Mishlei Commentary 1:4' in clean['text']:
                        reason = 'unrelated poverty parallel excluded'
                    else:
                        urls = hrefs(clean)
                        refs = {ref_key(reference_from_url(url)) for url in urls if reference_from_url(url)}
                        if ref_key(anchor) in refs:
                            reason = 'parallel quotes the same Dover paragraph being annotated'
                        elif (candidate['number'], quoted(clean['text'])) in adjacent_repetitions:
                            reason = 'identical parallel quotation in the preceding footnote'
                        elif urls & primary_urls or refs & primary_sources:
                            reason = 'same source as primary quotation'
                        elif urls and urls.issubset(retained_urls):
                            reason = 'source excerpt already present'
                        elif quoted(clean['text']) in retained_quotes:
                            reason = 'duplicate translated excerpt'
                    if reason:
                        omitted.append({'number': number, 'uploadNumber': candidate['number'],
                                        'reason': reason, 'text': paragraph.get('text', '')[:180]})
                        continue
                    paragraphs.append(clean)
                    additions += 1
                    retained_urls.update(hrefs(clean))
                    retained_quotes.add(quoted(clean['text']))
                    for url in hrefs(clean):
                        ref = reference_from_url(url)
                        if ref and (anchor, ref) not in seen_connections:
                            records.append({'a': anchor, 'r': ref, 'c': 'Parallel Sources',
                                            'kind': 'Supplied translated source parallel', 'source': RELEASE})
                            seen_connections.add((anchor, ref))
                            added_connections += 1
                out['paragraphs'] = paragraphs
                # Retain only source metadata represented by an actual visible
                # quotation, rather than copying generated relationships.
                out['sources'] = [copy.deepcopy(s) for s in source_metadata
                                  if s.get('role') == 'primary-source' or str(s.get('url', '')).rstrip('/') in retained_urls]
                out['nativeConnections'] = []
                if paragraphs[:len(original_paragraphs)] != original_paragraphs:
                    raise ValueError('Original Dover quotation was altered')
                original_extra += max(0, len(original_paragraphs) - 1)
                mapping[str(number)] = candidate['number']
                expected.append({'number': number, 'uploadNumber': candidate['number'], 'file': file,
                                 'paragraph': row['n'], 'phraseIndex': out['phraseIndex'], 'heWord': out['heWord'],
                                 'heCharOffset': out['heCharOffset'], 'enCharOffset': out['enCharOffset'],
                                 'heAnchorPrefix': out['heAnchorPrefix'], 'enAnchorPrefix': out['enAnchorPrefix'],
                                 'sourceId': out['sourceId'], 'placementId': out['placementId'],
                                 'paragraphs': paragraphs, 'originalParagraphCount': len(original_paragraphs),
                                 'originalParagraphsSha256': sha(serial(original_paragraphs)),
                                 'addedParagraphCount': len(paragraphs) - len(original_paragraphs)})
                merged.append(out)
            if len(consumed) != len(new_notes):
                raise ValueError('An incoming Dover note was not matched')
            row['footnotes'] = merged
            for index, pair in enumerate(row['p']):
                incoming_he = incoming['p'][index][0]
                old_links = Counter(html.unescape(x) for x in re.findall(r'data-ref=["\']([^"\']*)', pair[0]))
                new_links = Counter(html.unescape(x) for x in re.findall(r'data-ref=["\']([^"\']*)', incoming_he))
                added_links += sum((new_links - old_links).values())
                removed_links += sum((old_links - new_links).values())
                if old_links - new_links:
                    raise ValueError('A supplied Dover phrase removes an existing source link')
                pair[0] = incoming_he
                # The original English cell is retained byte for byte.
        info = body_info(after, file)
        if (info['heSha256'], info['enSha256']) != (old_info['heSha256'], old_info['enSha256']):
            raise ValueError('Dover body changed while applying the revision')
        sections.append({'file': file, 'ref': section_ref, **info,
                         'baselineHeLinks': old_info['heLinks'], 'baselineEnLinks': old_info['enLinks'],
                         'addedHebrewLinks': added_links, 'removedHebrewLinks': removed_links})
        staged[file] = after
    if len(expected) != 2698 or source_count != 2698 or len(mapping) != 2698:
        raise ValueError('Incomplete Dover footnote revision')
    total_links = sum(section['addedHebrewLinks'] for section in sections)
    if total_links != 944:
        raise ValueError('Expected precisely 944 additional Hebrew citation links, got ' + str(total_links))
    toc['revisedFootnotes'] = {'release': RELEASE, 'notes': 2698, 'report': REPORT.name}
    report = {'release': RELEASE, 'sourceSha256': sha(raw), 'notes': 2698,
              'counts': {'notes': 2698, 'sections': 16, 'contentSections': 15,
                         'addedHebrewLinks': total_links, 'removedHebrewLinks': 0, 'bodyChanges': 0,
                         'originalParagraphsPreserved': True, 'originalExtraParagraphsPreserved': original_extra,
                         'addedSourceParagraphs': additions, 'addedConnections': added_connections},
              'sections': sections, 'mapping': mapping, 'expectedNotes': sorted(expected, key=lambda n: n['number']),
              'omittedParagraphs': omitted}
    # All validation happens before the published files are changed.
    for file, rows in staged.items():
        write(BOOK / file, rows)
    write(BOOK / 'links.json', connections)
    write(BOOK / 'toc.json', toc)
    write(REPORT, report)
    index_path = ROOT / 'index.html'
    index = index_path.read_text()
    old_key = '20261018-dover-elaboration-sources'
    new_key = old_key + '-revisions-v2'
    if new_key not in index:
        if old_key not in index:
            raise ValueError('Existing Dover reader cache key is missing')
        index_path.write_text(re.sub(re.escape(old_key) + r'(?:-revisions-v\d+)?', new_key, index))
    worker_path = ROOT / 'sw.js'
    worker = worker_path.read_text()
    if '-dover-revisions-v2`' not in worker:
        worker, count = re.subn(r'(const SHELL = `[^`]+)(`;)', r'\1-dover-revisions-v2\2', worker, count=1)
        if count != 1:
            raise ValueError('Existing reader shell cache version is missing')
        worker_path.write_text(worker)
    refresh_manifest()
    if other_data_snapshot() != protected_before:
        raise ValueError('Dover publisher altered another work or a shared source index')
    print(f'Published Dover revisions: 2,698 original notes retained; {additions} added source excerpts; '
          f'{total_links} additional Hebrew source links; {original_extra} prior extra paragraphs preserved.')


if __name__ == '__main__':
    main()

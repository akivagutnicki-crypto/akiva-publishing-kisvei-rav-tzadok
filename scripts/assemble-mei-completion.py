"""Seal the separately translated, source-verified gaps in Volume I.

This does not generate translations. Three reviewed phrase-pair files must
already exist. Every canonical paragraph and Hebrew letter is accounted for.
"""
import base64
import gzip
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path('editorial/verification/docx-import-20261022')
LEDGER = ROOT / 'mei-missing-volume-i.json'
OUTPUT = Path('sources/akiva/overlays/mei-completion-20261022.json.gz.b64')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unpointed(text):
    return re.sub('[\u0591-\u05bd\u05bf-\u05c7]', '', text).replace('״', '"').replace('׳', "'").replace('’', "'").replace('“', '"').replace('”', '"')


def letters(text):
    return ''.join(re.findall('[א-ת]', text))


def hebrew_number(number):
    value = ''
    for amount, letter in [(400, 'ת'), (300, 'ש'), (200, 'ר'), (100, 'ק'),
                           (90, 'צ'), (80, 'פ'), (70, 'ע'), (60, 'ס'),
                           (50, 'נ'), (40, 'מ'), (30, 'ל'), (20, 'כ')]:
        while number >= amount:
            value += letter
            number -= amount
    if number in (15, 16):
        value += 'טו' if number == 15 else 'טז'
    else:
        if number >= 10:
            value += 'י'
            number -= 10
        if number:
            value += 'אבגדהוזחט'[number - 1]
    return value + '׳' if len(value) == 1 else value[:-1] + '״' + value[-1]


def main():
    ledger = json.loads(LEDGER.read_text())
    expected = {item['ref']: item for item in ledger['missingParagraphs']}
    refs = json.loads((ROOT / 'mei-canonical-references.json').read_text())['references']
    snapshot = json.loads(gzip.decompress(base64.b64decode((ROOT / 'mei-canonical-api-snapshot.json.gz.b64').read_bytes())))
    source_titles = {}
    for response in snapshot['responses']:
        data = json.loads(response['rawUtf8'])
        source_titles[data['ref']] = data['heRef']
    files = [ROOT / f'mei-supplement-{name}.json' for name in ['psalms', 'proverbs', 'talmud']]
    reviewed = []
    provenance = []
    for file in files:
        data = json.loads(file.read_text())
        reviewed.extend(data['paragraphs'])
        provenance.append({'file': file.as_posix(), 'sha256': digest(file.read_bytes()), 'paragraphs': len(data['paragraphs']), 'provenance': data.get('provenance')})
    assert len(reviewed) == len(expected) == 50
    assert set(item['ref'] for item in reviewed) == set(expected), 'Completion refs differ from source gap ledger'
    assert len(set(item['ref'] for item in reviewed)) == 50, 'Duplicate translated paragraph'
    sections = defaultdict(list)
    checks = []
    for item in reviewed:
        source = expected[item['ref']]
        assert item['sourceHebrew'] == source['he'], 'Translation used a different source: ' + item['ref']
        assert item['sectionRef'] == source['sectionRef'] and item['n'] == source['n']
        assert item['p'] and all(len(pair) == 2 for pair in item['p'])
        for he, en in item['p']:
            assert re.search('[א-ת]', he) and re.search('[A-Za-z]', en), item['ref']
            assert '[' not in en and ']' not in en, 'English brackets remain: ' + item['ref']
        joined = ' '.join(pair[0] for pair in item['p'])
        assert letters(joined) == letters(item['normalizedHebrew']), 'Paired Hebrew differs from reviewed normalization'
        expanded = source['he']
        applied = []
        changes = item.get('transformations', item.get('expansions', []) + item.get('vocalizationChanges', []))
        for change in changes:
            before, after = change['from'], change['to']
            if 'at' in change:
                start = change['at']
                assert expanded[start:start + len(before)] == before, ('Documented source offset does not match', item['ref'], change)
                expanded = expanded[:start] + after + expanded[start + len(before):]
                count = 1
            else:
                assert before in expanded, ('Documented expansion not present', item['ref'], before)
                count = change.get('count', expanded.count(before))
                expanded = expanded.replace(before, after, count)
            applied.append({**change, 'countApplied': count})
        assert letters(expanded) == letters(joined), 'Unaccounted Hebrew letter change: ' + item['ref']
        assert refs[source['sectionRef']]['verified']
        sections[source['sectionRef']].append({'n': source['n'], 'p': item['p'],
            'completionSourceRef': item['ref'], 'translationProvenance': 'Original Akiva Publishing interlinear completion from verified Hebrew',
            **({'connections': item['connections']} if item.get('connections') else {})})
        checks.append({'ref': item['ref'], 'sourceSha256': digest(source['he'].encode()),
            'phrasePairs': len(item['p']), 'sourceHebrewLetters': len(letters(source['he'])),
            'normalizedHebrewLetters': len(letters(joined)), 'expansions': applied,
            'allSourceLettersAccountedFor': True, 'missingEnglishPhrases': 0,
            'reviewNotes': item.get('reviewNotes', [])})
    result = []
    for ref, items in sections.items():
        proof = refs[ref]
        items.sort(key=lambda item: item['n'])
        assert [item['n'] for item in items] == list(range(1, proof['canonicalParagraphCount'] + 1)), 'Incomplete canonical section ' + ref
        match = re.fullmatch(r'(.+) (\d+)([ab]?)', ref)
        assert match and match[1] in source_titles
        he_address = hebrew_number(int(match[2]))
        if match[3]:
            he_address += ' ע״' + ('א' if match[3] == 'a' else 'ב')
        he_title = source_titles[match[1]] + ' ' + he_address
        result.append({'ref': ref, 'sep': ':', 'title': ref.split(', ')[-1], 'he': he_title,
            'sourceUrl': proof['url'], 'sortKey': proof['canonicalSortKey'],
            'canonicalParagraphCount': proof['canonicalParagraphCount'], 'completion': True, 'items': items})
    result.sort(key=lambda section: section['sortKey'])
    assert len(result) == 36
    counts = {'sections': len(result), 'paragraphs': len(reviewed),
        'phrasePairs': sum(len(item['p']) for section in result for item in section['items']),
        'sourceHebrewWords': ledger['hebrewWordCount']}
    pack = {'schemaVersion': 1, 'book': 'Mei HaShiloach', 'kind': 'verified-canonical-completion',
        'sourceLedger': LEDGER.as_posix(), 'sourceLedgerSha256': digest(LEDGER.read_bytes()),
        'translationFiles': provenance, 'sections': result, 'counts': counts}
    raw = json.dumps(pack, ensure_ascii=False, separators=(',', ':')).encode()
    OUTPUT.write_bytes(base64.b64encode(gzip.compress(raw, mtime=0)) + b'\n')
    audit = {'schemaVersion': 1, 'status': 'PASS', 'scope': 'The 50 source-file gaps in the main Volume I text from Bereshit through Miscellany.',
        'counts': counts, 'sourceLedger': LEDGER.as_posix(), 'sourceLedgerSha256': digest(LEDGER.read_bytes()),
        'translationFiles': provenance, 'packFile': OUTPUT.as_posix(), 'packSha256': digest(OUTPUT.read_bytes()),
        'all50CanonicalParagraphsPresent': True, 'noHebrewLettersLost': True, 'noMissingEnglishPhrases': True,
        'englishSquareBrackets': 0, 'paragraphChecks': checks}
    (ROOT / 'mei-completion-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'ok': True, **counts, 'packSha256': digest(OUTPUT.read_bytes())}))


if __name__ == '__main__':
    main()

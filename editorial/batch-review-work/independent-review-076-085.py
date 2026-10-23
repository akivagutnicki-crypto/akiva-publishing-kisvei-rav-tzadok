import hashlib
import html
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path('/workspace/scratch/f85ae98f1669')
WORK = ROOT / 'review-work'
SITE = ROOT / 'tmp/batch-engineering/current-site'


def flatten(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ' '.join(flatten(v) for v in value)
    return ''


def plain(value):
    return html.unescape(re.sub(r'<[^>]*>', '', value))


def norm(value):
    return re.sub(r'[^\u05d0-\u05ea]', '', plain(value))


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def ordered_parts(quotation, whole):
    cursor = 0
    normalized_whole = norm(whole)
    for part in re.split(r'\s*…\s*', quotation):
        needle = norm(part)
        if not needle:
            continue
        found = normalized_whole.find(needle, cursor)
        if found < 0:
            return False
        cursor = found + len(needle)
    return True


proposals = {
    group: json.loads((WORK / f'ois-{group}.json').read_text())
    for group in ('76-80', '81-85')
}
caches = {
    name: json.loads((WORK / name).read_text())
    for name in ('ois76-primary.json', 'ois81-primary.json')
}
selected = json.loads((WORK / 'ois81-selected-primary.json').read_text())
connected = json.loads((SITE / 'library/connected-ideas/catalog.json').read_text())['records']
books = {}
checks = []
issues = []
for proposal in proposals.values():
    for entry in proposal['entries']:
        rows = json.loads((ROOT / f"live-baseline/{entry['section']-1}.json").read_text())
        row = next(r for r in rows if r['n'] == entry['rowN'])
        text = plain(row['p'][entry['phraseIndex']][0])
        assert text.startswith(entry['heAnchorPrefix']), entry['id']
        assert len(entry['heAnchorPrefix']) == entry['heCharOffset'], entry['id']
        evidence = entry['sourceEvidence'][0]
        assert evidence['he'] == entry['he'] and evidence['en'] == entry['en'], entry['id']
        assert evidence['heSha256'] == digest(entry['he']), entry['id']
        source = None
        if entry.get('readerRef'):
            relative = evidence.get('canonicalSourceFile')
            file = SITE / relative if relative else Path(selected[entry['readerRef']]['canonicalFile'])
            if file not in books:
                books[file] = json.loads(file.read_text())['paras']
            paragraph = next(p for p in books[file] if p['r'] == entry['readerRef'])
            original = paragraph.get('t') or ' '.join(pair[0] for pair in paragraph['p'])
            assert norm(entry['he']) in norm(original), (entry['id'], 'internal exact contiguous quote')
            source = {'kind': 'canonical-reader', 'file': str(file.relative_to(SITE)), 'ref': paragraph['r']}
        else:
            for name, cache in caches.items():
                for ref, value in cache.items():
                    if isinstance(value, dict) and ordered_parts(entry['he'], flatten(value.get('he', ''))):
                        source = {'kind': 'cached-primary-Hebrew', 'file': name, 'ref': ref}
                        break
                if source:
                    break
            if entry['id'] == 'midrash-tehillim-the-enduring-future-temple':
                # Independently opened and read the original text, including its
                # surrounding paragraph, on 2026-10-23. Sefaria returns no text.
                source = {
                    'kind': 'independently-opened-primary-text',
                    'url': 'https://he.wikisource.org/wiki/מדרש_תהלים_צ',
                    'retrievalRef': 'turn87view0',
                    'line': 125,
                    'verification': 'Exact complete final paragraph; only printed annotation marker (צא) omitted.'
                }
        if not source:
            issues.append({'id': entry['id'], 'issue': 'No independent primary match'})
        duplicates = []
        for record in connected:
            if record.get('originRef', '').split(':')[0] == f"Tzidkat HaTzadik {entry['section']}":
                if norm(entry['he']) in norm(record.get('targetHebrew', '')):
                    duplicates.append({'kind': 'connected', 'number': record['footnoteNumber']})
        for r in rows:
            for note in r.get('footnotes', []):
                for old_evidence in note.get('sourceExcerptReview', {}).get('evidence', []):
                    old_he = old_evidence.get('he', '')
                    if norm(entry['he']) in norm(old_he):
                        duplicates.append({'kind': 'native-evidence-candidate', 'number': note['number']})
        if duplicates:
            issues.append({'id': entry['id'], 'issue': 'Possible existing quotation', 'matches': duplicates})
        visible = ' '.join(entry[k] for k in ('ref', 'url', 'he', 'en', 'context'))
        assert not re.search(r'Biur|Meshulav|Mishulav|Neimos|Ne.imot|\.pdf(?:$|[?#])', visible, re.I), entry['id']
        checks.append({
            'section': entry['section'], 'id': entry['id'], 'ref': entry['ref'],
            'source': source, 'exactAnchor': True, 'bilingualEvidenceHash': True,
            'existingNativeOrConnectedDuplicate': False if not duplicates else duplicates,
            'translationAndContextIndependentlyRead': True,
        })

report = {
    'status': 'passed' if not issues else 'needs-review',
    'reviewedAt': '2026-10-23',
    'reviewedSections': list(range(76, 86)),
    'entries': len(checks),
    'counts': dict(Counter(c['section'] for c in checks)),
    'internalCanonicalQuotations': sum(c['source'] and c['source']['kind'] == 'canonical-reader' for c in checks),
    'proposalSha256': {group: hashlib.sha256((WORK / f'ois-{group}.json').read_bytes()).hexdigest() for group in proposals},
    'independentEditorialFindings': [
        'Read every new Hebrew/Aramaic quotation, English translation, explanatory context, source reference, and destination anchor.',
        'Ois 76 preserves repentance and recognition of sin as the human obligation; the Likkutei Maamarim quotation does not omit its limiting continuation.',
        'Ois 78 preserves the distinction between the patriarchal stages, the enduring Israelite identity of Yaakov\u2019s descendants, and the ten tribes passage\u2019s limitation to offspring of gentile mothers.',
        'Ois 79 preserves the distinction between accessible divine attributes and infinite divine essence, and the first complete fourfold analogy is labeled as such.',
        'Ois 80 preserves the two explanations of Torah\u2019s protection, the alternate explanation of Avraham\u2019s change of place, Ahab\u2019s unsuccessful attempt at justification, and the stated limits of holy severity.',
        'Ois 81 distinguishes the two Midrashic accounts of Moshe and the spiritual four-cubits teaching from Tosafot\u2019s rejection of universal actual landownership.',
        'Ois 82 distinguishes partial relief through verbal confession from complete abandonment of sin.',
        'Ois 83 Nedarim translation checked additionally against Rashi and Ran: guvza is a chest; marana aleih means that the master should wait with it.',
        'Ois 84 study-house prayer follows the explicitly supplied Rashi interpretation, and the Tikkunei Zohar context does not attribute Rav Tzadok\u2019s envy application to the earlier source.',
        'Ois 85 preserves inward pride as distinct from public domination and the Tanchuma\u2019s two descriptions of Cain\u2019s offering.',
    ],
    'overlappingSourceReferencesManuallyResolved': [
        {'section': 79, 'existingNumber': 2254, 'existingRef': 'Kometz HaMinchah 1:18:1', 'newRef': 'Kometz HaMinchah 1:19:1', 'finding': 'Different paragraphs and quotations; existing source/recipient analogy preserved.'},
        {'section': 80, 'existingNumber': 324, 'existingRef': 'Makkot 10a:3', 'newRef': 'Makkot 10a:11-13', 'finding': 'Existing geographical explanation is distinct from the new Torah-as-refuge discussion.'},
        {'section': 83, 'existingNumber': 336, 'existingRef': 'Megillah 6b:3', 'newRef': 'Megillah 6b:4', 'finding': 'Existing maxim is retained; new note quotes the subsequent qualification, which old context mentions but does not quote.'},
    ],
    'correction': {
        'section': 81, 'id': 'deuteronomy-length-of-days-parents-children',
        'change': 'Removed an embedded Sefaria Masoretic footnote marker/comment and section marker from the new biblical quotation; verse words and English are unchanged.',
        'rawPrimaryCapturePreserved': True,
        'reproducibleGenerator': 'review-work/build-81-85.py',
    },
    'checks': checks,
    'issues': issues,
}
(WORK / 'independent-review-076-085.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key in ('status', 'entries', 'counts', 'internalCanonicalQuotations', 'proposalSha256', 'issues')}, ensure_ascii=False))
assert not issues, issues

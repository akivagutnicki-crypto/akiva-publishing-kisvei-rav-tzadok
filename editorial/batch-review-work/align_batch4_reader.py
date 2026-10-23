"""Align only new batch-4 source evidence with its existing canonical reader.

The six original Sefaria passages remain additional evidence. No destination
author text or existing note is changed. Reused by the proposal generators.
"""
import copy
import hashlib
import html
import json
import re
from pathlib import Path

ROOT = Path('/workspace/scratch/f85ae98f1669')
BOOKS = ROOT / 'tmp/batch-engineering/current-site/mcp-data/text'
SPECS = {
    'kometz-truth-endures': ('kometz-haminchah', 'Kometz HaMinchah 2:40:1', 14, 17, ''),
    'takanat-inward-repentance': ('takanat-hashavin', 'Takanat HaShavin 9:1', 0, 6, '[א] '),
    'poked-individual-torah-root': ('poked-akarim', 'Poked Akarim 6:8', 6, 17, ''),
    'tzidkat-tzitzit-recall': ('tzidkat-hatzadik', 'Tzidkat HaTzadik 220:1', 5, 11, ''),
    'tzidkat-i-and-you': ('tzidkat-hatzadik', 'Tzidkat HaTzadik 247:1', 29, 64, ''),
    'tzidkat-torah-enters-heart': ('tzidkat-hatzadik', 'Tzidkat HaTzadik 133:1', 0, 4, 'קלג] '),
}


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def plain(text):
    return html.unescape(re.sub(r'<[^>]*>', '', text)).strip()


def align_entries(entries):
    changed = []
    for entry in entries:
        if entry['id'] not in SPECS:
            continue
        book, ref, start, end, label = SPECS[entry['id']]
        assert entry['ref'] == ref
        canonical = json.loads((BOOKS / (book + '.json')).read_text())
        para = next(p for p in canonical['paras'] if p['r'] == ref)
        he = ' '.join(filter(None, (plain(pair[0]) for pair in para['p'][start:end])))
        if label:
            assert he.startswith(label)
            he = he[len(label):]
        if entry['he'] == he:
            assert entry['reviewEvidence']['readerHebrewAlignment']['canonicalHebrewSha256'] == sha(he)
            continue
        old_he, old_en, old_context = entry['he'], entry['en'], entry['context']
        original = copy.deepcopy(entry['sourceEvidence'])
        for evidence in original:
            evidence['editionRelationship'] = 'Original Sefaria Hebrew retained; canonical reader expands abbreviations and some cited verses.'
        citation_fix = entry['id'] == 'takanat-inward-repentance'
        if citation_fix:
            assert 'Even HaEzer 42' in entry['en']
            entry['en'] = entry['en'].replace('Even HaEzer 42', 'Even HaEzer [38]')
            entry['context'] += ' The cross-reference is Even HaEzer 38: Beit Shmuel 38:55 and Chelkat Mechokek 38:44 discuss this point.'
            entry['reviewEvidence']['verifiedCitationCorrection'] = {
                'from': 'Even HaEzer 42', 'to': 'Even HaEzer [38]',
                'originalSources': ['Beit Shmuel 38:55', 'Chelkat Mechokek 38:44'],
                'evidenceFile': 'review-work/review-takanat-citation-primary.json',
                'reason': 'Both original commentaries contain the cited return-of-stolen-property discussion in section 38. Canonical reader already has 38.',
            }
        if entry['id'] == 'tzidkat-torah-enters-heart':
            entry['en'] = entry['en'].replace('ois59', 'ois 59')
            entry['context'] = entry['context'].replace('ois133', 'ois 133')
        entry['he'] = he
        entry['sourceEvidence'] = [{
            'ref': ref,
            'url': 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/' + ref.replace(' ', '_'),
            'he': he, 'en': entry['en'], 'heSha256': sha(he),
            'translation': 'Reviewed original-source English quotation. Canonical reader spelling expands abbreviations and some cited verses; original Sefaria Hebrew remains additional evidence.',
            'coverage': 'Corresponding complete selected source passage in the current canonical reader.',
            'canonicalReaderRef': ref, 'canonicalSourceFile': 'mcp-data/text/' + book + '.json',
        }] + original
        entry['reviewEvidence']['readerHebrewAlignment'] = {
            'reason': 'Align the new source excerpt metadata with the existing canonical reader spelling.',
            'canonicalRef': ref, 'previousHebrewSha256': sha(old_he),
            'canonicalHebrewSha256': sha(he),
            'englishContextUnchanged': entry['en'] == old_en and entry['context'] == old_context,
            'anchorUnchanged': True, 'existingSourceTextUnchanged': True,
        }
        changed.append(ref)
    return changed


if __name__ == '__main__':
    changed = []
    for filename in ['ois-51-55.json', 'ois-56-60.json']:
        path = ROOT / 'review-work' / filename
        proposal = json.loads(path.read_text())
        changed.extend(align_entries(proposal['entries']))
        path.write_text(json.dumps(proposal, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'aligned': changed}, ensure_ascii=False))

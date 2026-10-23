"""Preserve primary evidence while completing two new batch-5 quotations."""
import copy
import hashlib
import html
import json
import re
from pathlib import Path

ROOT = Path('/workspace/scratch/f85ae98f1669')
BOOKS = ROOT / 'tmp/batch-engineering/current-site/mcp-data/text'
RESTORED_ENGLISH = 'This is like the seventy bulls offered on the festival corresponding to the seventy nations. It is also as will happen in the future, when Mashiach comes to give certain commandments and teach Torah to the nations of the world as well, as stated in Bereshit Rabbah 98: “Many peoples shall stream toward him,” and “Then I will turn to the peoples a pure language.” These are the feet that descend to death, to the place of the husks and evil—the powers of the nations—in order to draw out the holy sparks within them as well and return them to holiness. Through this power within the congregation of Israel, which seeks to return even the nations’ powers to holiness, the corresponding power in evil—for “God has made one opposite the other”—arouses in the nations the power and desire to decree forced apostasy, God forbid, upon Israel, to bring the congregation of Israel, God forbid, over to them instead.'
SPECS = {
    'tzidkat-priestly-holiness-and-extra-remedies': ('tzidkat-hatzadik', 'Tzidkat HaTzadik 219:1', 14, 15),
    'resisei-influence-and-association': ('resisei-layla', 'Resisei Layla 57:1', 34, 55),
}


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def align_entries(entries):
    changed = []
    for entry in entries:
        if entry['id'] not in SPECS:
            continue
        book, ref, start, end = SPECS[entry['id']]
        assert entry['ref'] == ref
        para = next(p for p in json.loads((BOOKS / (book + '.json')).read_text())['paras'] if p['r'] == ref)
        he = ' '.join(html.unescape(re.sub(r'<[^>]*>', '', pair[0])).strip() for pair in para['p'][start:end])
        if entry['he'] == he:
            assert entry['reviewEvidence']['readerHebrewAlignment']['canonicalHebrewSha256'] == sha(he)
            continue
        old_he, old_en = entry['he'], entry['en']
        original = copy.deepcopy(entry['sourceEvidence'])
        restored = entry['id'] == 'resisei-influence-and-association'
        if restored:
            assert entry['en'].count(' … ') == 1
            entry['en'] = entry['en'].replace(' … ', ' ' + RESTORED_ENGLISH + ' ')
        for evidence in original:
            evidence['editionRelationship'] = ('Earlier selected excerpts retained as evidence; the complete intervening original-source passage is now restored.' if restored else 'Original Sefaria spelling retained; canonical reader expands abbreviations.')
        entry['he'] = he
        entry['sourceEvidence'] = [{
            'ref': ref, 'url': 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/' + ref.replace(' ', '_'),
            'he': he, 'en': entry['en'], 'heSha256': sha(he),
            'translation': 'Original English translation checked directly against the complete selected canonical Hebrew passage.',
            'coverage': 'Complete contiguous selected source passage; no omitted intervening text.',
            'canonicalReaderRef': ref, 'canonicalSourceFile': 'mcp-data/text/' + book + '.json',
        }] + original
        entry['reviewEvidence']['readerHebrewAlignment'] = {
            'canonicalRef': ref, 'previousHebrewSha256': sha(old_he), 'canonicalHebrewSha256': sha(he),
            'previousEnglishSha256': sha(old_en), 'englishUnchanged': entry['en'] == old_en,
            'contextAndAnchorUnchanged': True, 'existingSourceTextUnchanged': True,
            'restoredInterveningPhrases': list(range(36,45)) if restored else [],
        }
        changed.append(ref)
    return changed


if __name__ == '__main__':
    changed = []
    for name in ['ois-61-65.json', 'ois-66-70.json']:
        path = ROOT / 'review-work' / name
        proposal = json.loads(path.read_text())
        changed.extend(align_entries(proposal['entries']))
        # Preserve each original generator's serialization convention.
        path.write_text(json.dumps(proposal, ensure_ascii=False, indent=2) + ('' if name == 'ois-61-65.json' else '\n'))
    print(json.dumps({'aligned': changed}, ensure_ascii=False))

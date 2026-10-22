"""Import the supplied Vayetzei DOCX, whose filename incorrectly says Vayishlach.

The source is already interlinear. This importer preserves its 96 paragraphs and
3,467 phrase pairs, removes English square-bracket delimiters, and records the
reviewed corruption repair and three canonical Hebrew citation restorations.
The supplied English is unchanged. It does not resegment the text.
Pass a cached response from the public Sefaria texts API with --canonical.
"""
import argparse
import base64
import difflib
import gzip
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile

from lxml import etree, html

BOOK = 'Beit Yaakov on Torah'
PARASHAH = 'Vayetzei'
SOURCE_SHA256 = '9ed2ed33d9c959138b7852e5fdefe65b898d3e57022802dafd9f9289fccce68f'
TEXT_EQUIVALENT_SOURCE_SHA256 = 'a0e1be90d287338d07af41c0dae7483a07c30a86c7265a8ecc477a35cb0b0d40'
ORIGINAL_DOCUMENT_TEXT_SHA256 = '4d92a45f2c5fb68c7657662fef95ebf36ca5210c6c109339cd835d19454de259'
CANONICAL_API = 'https://www.sefaria.org/api/texts/Beit_Yaakov_on_Torah,_Vayetzei?context=0&commentary=0&pad=0'
SOURCE_URL = 'https://www.sefaria.org/Beit_Yaakov_on_Torah,_Vayetzei'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
VALUES = dict(zip('אבגדהוזחטיכלמנסעפצקרשת',
                  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400]))
HEAD = re.compile(r'ויצא[ ,–-]+אות ([א-ת׳״]+)(?: \(חלק ב׳\))?')
BAD_TOKEN, CORRECT_TOKEN = 'אayה', 'אַיֵּה'
CITATION_RESTORATIONS = {
    (28, 1): {'sourceParagraph': 103, 'phraseIndex': 17,
        'canonicalQuote': '(מי השלוח ח"א ויצא ד"ה ויאמר ובגליון אות ד)',
        'addition': ' (מֵי הַשִּׁלֹחַ חֵלֶק א וַיֵּצֵא דִּבּוּר הַמַּתְחִיל וַיֹּאמֶר וּבַגִּלָּיוֹן אוֹת ד)'},
    (45, 1): {'sourceParagraph': 150, 'phraseIndex': 1,
        'canonicalQuote': '(מי השלוח ח"א מסכת ברכות (לה.) ד"ה על פירות)',
        'addition': ' (מֵי הַשִּׁלֹחַ חֵלֶק א מַסֶּכֶת בְּרָכוֹת (לה.) דִּבּוּר הַמַּתְחִיל עַל פֵּירוֹת)'},
    (72, 1): {'sourceParagraph': 241, 'phraseIndex': 40,
        'canonicalQuote': '(מי השלוח ח"א בראשית ד"ה ויאמר האדם, ח"ב בראשית ד"ה בראשית [ב])',
        'addition': ' (מֵי הַשִּׁלֹחַ חֵלֶק א בְּרֵאשִׁית דִּבּוּר הַמַּתְחִיל וַיֹּאמֶר הָאָדָם, חֵלֶק ב בְּרֵאשִׁית דִּבּוּר הַמַּתְחִיל בְּרֵאשִׁית [ב])'},
}
# All nontrivial canonical-side character differences were read in context.
# Remaining one-character yod/vav/he differences are spelling, vowel-letter,
# inflection, or abbreviation alignment; no missing narrative word was found.
REVIEWED_VARIATIONS = {
    '1:3': 'Supplied Kiddushin 40a versus canonical 41a; Turnus Rufus spelling; תיבות versus תיבין; supplied respectful Divine-Name notation and Aramaic expansion preserved.',
    '2:1': 'The canonical spelling אחיורא and supplied חוורא are the same quoted Aramaic white-fire term.',
    '3:2': 'Canonical [ג/ב] is accounted for by the supplied Ois 3 Part 2 continuation heading.',
    '4:1': 'מכבודתי / מכבדותי is a spelling variant in the quoted garment passage, not a word omission.',
    '8:1': 'Supplied Aramaic קודשא בריך הוא expands canonical קוב״ה.',
    '11:3': 'The supplied Deuteronomy 14:23 locator is more precise than canonical ראה טו; preserve the upload.',
    '12:1': 'Canonical איתה ע״ז is supplied as איתא על זה; no words are missing.',
    '13:1': 'The supplied grammar lacks canonical redundant ש before מכנין; בריה / בריאה spelling preserved.',
    '15:1': 'Canonical להוייתו and pointed supplied לַהֲוָיָתוֹ have different vowel-letter spelling; the complete existence wording is retained.',
    '15:2': 'Supplied מקרב versus canonical מתקרב and בריה / בריאה are grammar/spelling variants; the full sentence is present.',
    '28:1': 'Canonical citation restored in Hebrew with expanded abbreviations and nikkud; all supplied wording retained.',
    '45:1': 'Canonical citation restored in Hebrew with expanded abbreviations and nikkud; all supplied wording retained.',
    '48:1': 'Canonical ולחונן אותי is supplied as ולחנני; equivalent pronominal morphology, not an omission.',
    '51:1': 'Supplied Aramaic קודשא בריך הוא expands canonical קוב״ה.',
    '52:1': 'Canonical ומשם והלאה is supplied as וּמִשָּׁם וָהֵילָךְ, meaning from then onward; supplied wording retained.',
    '57:1': 'Supplied Aramaic קודשא בריך הוא expands canonical קוב״ה.',
    '57:2': 'Canonical שמאז והלאה is supplied as שֶׁמֵּאָז וָהֵילָךְ, meaning from then onward; supplied wording retained.',
    '65:1': 'Supplied Aramaic סטר versus canonical סטרא is a spelling/inflection variant in the same quoted phrase.',
    '67:1': 'Supplied אתקף versus canonical אתתקף represents the same Aramaic verb with assimilation.',
    '68:1': 'Supplied Aramaic קודשא בריך הוא expands canonical קוב״ה.',
    '72:1': 'Canonical citations restored in Hebrew; supplied Aramaic expansion of קוב״ה retained.',
}


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def compact(value):
    return re.sub(r'\s', '', value)


def unpointed(value):
    return re.sub('[\u0591-\u05c7]', '', value)


def letters(value):
    return re.sub('[^א-ת]', '', value)


def balanced_spans(text, index):
    """Top-level bracket spans, including nested English citation markers."""
    depth, start, spans = 0, None, []
    for offset, char in enumerate(text):
        if char == '[':
            if depth == 0:
                start = offset
            depth += 1
        elif char == ']':
            depth -= 1
            assert depth >= 0, ('Unmatched closing bracket', index, offset)
            if depth == 0:
                spans.append((start, offset + 1))
    assert depth == 0, ('Unmatched opening bracket', index)
    return spans


def parse_paragraph(original, index):
    cursor, pairs, chunks, literal_brackets, nested_english = 0, [], [], [], []
    removed = 0
    for start, end in balanced_spans(original, index):
        inside = original[start + 1:end - 1]
        if not re.search('[A-Za-z]', inside):
            assert re.fullmatch('[א-ת]+', inside), ('Unknown literal bracket', index, inside)
            literal_brackets.append({'start': start, 'text': original[start:end]})
            continue
        he, en = original[cursor:start].strip(), inside.replace('[', '').replace(']', '').strip()
        assert re.search('[א-ת]', he) and re.search('[A-Za-z]', en), ('Unpaired language', index)
        assert not re.search('[A-Za-z]', he.replace(BAD_TOKEN, '')), ('Unexpected Latin text in Hebrew', index, he)
        if '[' in inside:
            nested_english.append({'start': start, 'text': inside})
        pairs.append([he, en])
        chunks.extend([original[cursor:start], inside.replace('[', '').replace(']', '')])
        removed += original[start:end].count('[') + original[start:end].count(']')
        cursor = end
    tail = original[cursor:]
    assert not re.search(r'[A-Za-zא-ת0-9\[\]]', tail), ('Untranslated trailing text', index, tail)
    assert pairs, ('Empty body paragraph', index)
    if tail.strip():
        pairs[-1][1] += tail.strip()
    chunks.append(tail)
    cleaned = ''.join(chunks)
    assert compact(''.join(part for pair in pairs for part in pair)) == compact(cleaned)
    assert all('[' not in en and ']' not in en for _, en in pairs)
    return pairs, cleaned, removed, literal_brackets, nested_english


def canonical_base(raw):
    """Separate the sefer's body from Sefaria's marked 2006 editorial notes."""
    root = html.fragment_fromstring(raw, create_parent='div')
    notes = root.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " footnote ")]')
    count = len(notes)
    for element in root.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " footnote ") or '
                              'contains(concat(" ", normalize-space(@class), " "), " footnote-marker ")]'):
        element.drop_tree()
    return root.text_content(), count


def prepare(source, canonical_path, pack_path, audit_path):
    source_bytes, canonical_bytes = source.read_bytes(), canonical_path.read_bytes()
    assert digest(source_bytes) in {SOURCE_SHA256, TEXT_EQUIVALENT_SOURCE_SHA256}, 'Unexpected DOCX; review this importer before using another document'
    canonical = json.loads(canonical_bytes)
    assert canonical['ref'] == f'{BOOK}, {PARASHAH}'
    assert canonical['heRef'] == 'בית יעקב על התורה, ויצא'
    assert canonical['sectionNames'] == ['Siman', 'Paragraph']
    assert len(canonical['he']) == 76
    shape = [len(section) for section in canonical['he']]
    assert sum(shape) == 96

    with ZipFile(source) as archive:
        root = etree.fromstring(archive.read('word/document.xml'))
        assert not any(name in archive.namelist() for name in ['word/footnotes.xml', 'word/endnotes.xml'])
    paragraphs = root.xpath('//w:body/w:p', namespaces=NS)
    document_text = '\n'.join(''.join(p.xpath('.//w:t/text()', namespaces=NS)) for p in paragraphs)
    assert digest(document_text) == ORIGINAL_DOCUMENT_TEXT_SHA256, 'Document text differs from the reviewed original'
    assert len(paragraphs) == len(root.xpath('//w:p', namespaces=NS)) == 253
    assert not root.xpath('//w:tbl | //w:tab | //w:br | //w:cr | //w:sym | //w:drawing | '
                          '//w:instrText | //w:fldChar | //w:del | //w:ins | //w:object', namespaces=NS)

    sections, accounting, blanks, original_body, cleaned_body = [], [], [], [], []
    literal_brackets, nested_english, corrections, comparisons, variation_review = [], [], [], [], []
    current, pending_heading = None, None
    removed, footnotes, heading_count = 0, 0, 0
    all_paragraph_text = []
    for index, paragraph in enumerate(paragraphs):
        original = ''.join(paragraph.xpath('.//w:t/text()', namespaces=NS))
        all_paragraph_text.append(original)
        if not original.strip():
            blanks.append(index)
            continue
        account = {'sourceParagraph': index, 'originalTextSha256': digest(original), 'characters': len(original)}
        match = HEAD.fullmatch(unpointed(original).strip())
        if match:
            number = sum(VALUES.get(char, 0) for char in match[1])
            heading_count += 1
            continuation = '(חלק ב׳)' in unpointed(original)
            if continuation:
                assert number == 3 and current['chapter'] == 3 and len(current['items']) == 1
                pending_heading = {'phraseIndex': 0, 'text': original, 'sourceParagraph': index}
                account.update(kind='continuationHeading', section=number)
            else:
                assert number == len(sections) + 1, ('Missing/duplicate/out-of-order section', number)
                current = {'chapter': number, 'key': f'{PARASHAH} {number}',
                           'ref': f'{BOOK}, {PARASHAH} {number}',
                           'en': f'Vayetzei · Ois {number}', 'he': original,
                           'sourceHeading': original, 'sourceHeadingParagraph': index,
                           'sourceUrl': f'{SOURCE_URL}.{number}', 'items': []}
                sections.append(current)
                account.update(kind='sectionHeading', section=number)
            accounting.append(account)
            continue
        assert current is not None
        pairs, clean_before, bracket_count, hebrew_brackets, nested = parse_paragraph(original, index)
        removed += bracket_count
        number, n = current['chapter'], len(current['items']) + 1
        canonical_text, note_count = canonical_base(canonical['he'][number - 1][n - 1])
        footnotes += note_count
        corrected_text = clean_before
        for phrase_index, pair in enumerate(pairs):
            if BAD_TOKEN in pair[0]:
                assert (number, n, index) == (9, 2, 35) and pair[0].count(BAD_TOKEN) == 1
                canonical_quote = 'מפני שאמרו איה הן נוראותיו ואיה הן גבורותיו'
                assert canonical_quote in canonical_text
                before = pair[0]
                pair[0] = before.replace(BAD_TOKEN, CORRECT_TOKEN)
                corrected_text = corrected_text.replace(BAD_TOKEN, CORRECT_TOKEN)
                corrections.append({'section': number, 'paragraph': n, 'sourceParagraph': index,
                    'phraseIndex': phrase_index, 'language': 'he', 'before': before, 'after': pair[0],
                    'originalToken': BAD_TOKEN, 'correctedToken': CORRECT_TOKEN,
                    'reason': 'Repair the mixed Hebrew/Latin corruption using canonical איה and the adjoining pointed וְאַיֵּה.',
                    'canonicalRef': f'{BOOK}, {PARASHAH} {number}:{n}',
                    'canonicalUrl': f'{SOURCE_URL}.{number}.{n}', 'canonicalQuote': canonical_quote,
                    'originalEnglishPreserved': pair[1]})
        if (number, n) in CITATION_RESTORATIONS:
            restoration = CITATION_RESTORATIONS[(number, n)]
            assert index == restoration['sourceParagraph']
            assert restoration['canonicalQuote'] in canonical_text
            phrase_index = restoration['phraseIndex']
            pair = pairs[phrase_index]
            assert 'Mei HaShiloach' in pair[1] and 'מֵי הַשִּׁלֹחַ' not in pair[0]
            before = pair[0]
            assert corrected_text.count(before) == 1
            pair[0] += restoration['addition']
            corrected_text = corrected_text.replace(before, pair[0], 1)
            corrections.append({'section': number, 'paragraph': n, 'sourceParagraph': index,
                'phraseIndex': phrase_index, 'language': 'he', 'before': before, 'after': pair[0],
                'addedHebrew': restoration['addition'], 'kind': 'restoredCanonicalHebrewCitation',
                'reason': 'Restore the canonical Hebrew source parenthesis already translated in the supplied English; expand its abbreviations and add nikkud.',
                'canonicalRef': f'{BOOK}, {PARASHAH} {number}:{n}',
                'canonicalUrl': f'{SOURCE_URL}.{number}.{n}', 'canonicalQuote': restoration['canonicalQuote'],
                'originalEnglishPreserved': pair[1]})
        flat = ''.join(part for pair in pairs for part in pair)
        assert compact(flat) == compact(corrected_text), ('Source content lost', index)
        restored = [pair[:] for pair in pairs]
        for correction in corrections:
            if correction['sourceParagraph'] == index:
                assert restored[correction['phraseIndex']][0] == correction['after']
                restored[correction['phraseIndex']][0] = correction['before']
        assert compact(''.join(part for pair in restored for part in pair)) == compact(clean_before)
        item = {'n': n, 'p': pairs, 'sourceParagraph': index, 'sourceText': corrected_text,
                'originalTextSha256': digest(original)}
        if pending_heading:
            item['inlineHeadings'] = [pending_heading]
            pending_heading = None
        current['items'].append(item)
        original_body.append(original)
        cleaned_body.append(clean_before)
        literal_brackets.extend({'sourceParagraph': index, 'section': number, **entry} for entry in hebrew_brackets)
        nested_english.extend({'sourceParagraph': index, 'section': number, **entry} for entry in nested)
        account.update(kind='body', section=number, paragraph=n, phrasePairs=len(pairs),
                       englishBracketCharactersRemoved=bracket_count,
                       bracketCleanedTextSha256=digest(clean_before), importedTextSha256=digest(corrected_text),
                       sourceContentPreservedAfterReversingReviewedCorrection=True)
        accounting.append(account)
        canonical_letters, source_letters = letters(canonical_text), letters(' '.join(he for he, _ in pairs))
        matcher = difflib.SequenceMatcher(None, canonical_letters, source_letters, autojunk=False)
        differences = [{'canonical': canonical_letters[a:b], 'supplied': source_letters[c:d]}
                       for tag, a, b, c, d in matcher.get_opcodes()
                       if tag != 'equal' and max(b - a, d - c) >= 15]
        reviewed = [{'canonical': canonical_letters[a:b], 'supplied': source_letters[c:d],
                     'before': canonical_letters[max(0, a - 25):a], 'after': canonical_letters[b:b + 25]}
                    for tag, a, b, c, d in matcher.get_opcodes()
                    if tag != 'equal' and b > a and
                    (b - a >= 2 or (c == d and canonical_letters[a:b] not in 'ויה'))]
        if reviewed:
            key = f'{number}:{n}'
            assert key in REVIEWED_VARIATIONS, ('Unreviewed canonical-side difference', key, reviewed)
            variation_review.append({'ref': f'{BOOK}, {PARASHAH} {key}',
                                     'review': REVIEWED_VARIATIONS[key], 'differences': reviewed})
        ratio = round(matcher.ratio(), 6)
        assert ratio > 0.90, ('Canonical paragraph mapping requires review', number, n, ratio)
        comparisons.append({'ref': f'{BOOK}, {PARASHAH} {number}:{n}', 'sourceParagraph': index,
            'canonicalBaseTextSha256': digest(canonical_text), 'suppliedHebrewTextSha256': digest(' '.join(he for he, _ in pairs)),
            'normalizedCharacterSimilarity': ratio, 'largeCharacterDifferences': differences})

    assert pending_heading is None
    assert [s['chapter'] for s in sections] == list(range(1, 77))
    assert [len(s['items']) for s in sections] == shape
    items = [item for section in sections for item in section['items']]
    assert len(items) == 96 and sum(len(item['p']) for item in items) == 3467
    assert heading_count == 77 and len(accounting) == 173 and len(blanks) == 80
    assert sorted([a['sourceParagraph'] for a in accounting] + blanks) == list(range(253))
    assert len(corrections) == 4 and len(literal_brackets) == 2 and len(nested_english) == 4
    assert not any(re.search('[A-Za-z]', he) for item in items for he, _ in item['p'])
    assert not any('[' in en or ']' in en for item in items for _, en in item['p'])

    verification = {'provider': 'Sefaria', 'apiUrl': CANONICAL_API, 'sourceUrl': SOURCE_URL,
        'responseSha256': digest(canonical_bytes), 'versionTitle': canonical['heVersionTitle'],
        'canonicalRef': canonical['ref'], 'checkedOn': '2026-10-22', 'sectionCount': 76,
        'paragraphCount': 96, 'shape': shape, 'absentSectionNumbers': [],
        'editorialFootnotesExcludedFromBaseComparison': footnotes,
        'baseTextComparison': 'Vocalized, abbreviation-expanded supplied Hebrew compared to canonical body; editorial footnotes excluded.',
        'suppliedCitationVariations': [
            {'section': 28, 'paragraph': 1, 'detail': 'The canonical Mei HaShiloach parenthesis supplied only in English has been restored in Hebrew with an exact reversible audit.'},
            {'section': 45, 'paragraph': 1, 'detail': 'The canonical Mei HaShiloach / Berakhot parenthesis supplied only in English has been restored in Hebrew with an exact reversible audit.'},
            {'section': 67, 'paragraph': 3, 'detail': 'The supplied Hebrew additionally names Shir HaShirim Rabbah 4:16 beside the supplied Bereishit Rabbah locator.'},
            {'section': 72, 'paragraph': 1, 'detail': 'Both canonical Mei HaShiloach locators supplied only in English have been restored in Hebrew with an exact reversible audit.'}],
        'minimumNormalizedCharacterSimilarity': min(entry['normalizedCharacterSimilarity'] for entry in comparisons)}
    source_meta = {'name': 'בית יעקב על התורה, וישלח.docx', 'sha256': digest(source_bytes),
        'materializedFilename': source.name,
        'priorReviewedSourceSha256': SOURCE_SHA256,
        'textEquivalentSourceSha256': TEXT_EQUIVALENT_SOURCE_SHA256,
        'textEquivalenceProof': {'method': 'Exact SHA-256 of the ordered, newline-joined text of all 253 DOCX paragraphs',
            'originalDocumentTextSha256': ORIGINAL_DOCUMENT_TEXT_SHA256,
            'currentDocumentTextSha256': digest(document_text),
            'identical': True,
            'scope': 'Different DOCX container bytes; all paragraph texts and their order are identical. The four previously reviewed Hebrew repairs are unchanged.'},
        'filenameParashah': 'Vayishlach', 'detectedParashah': PARASHAH,
        'filenameMismatchExplanation': 'Every supplied heading says Vayetzei; all 76 osiyos and 96 paragraph positions match canonical Vayetzei.',
        'docxParagraphs': 253, 'nonemptyDocxParagraphs': 173, 'blankDocxParagraphs': 80,
        'headingParagraphs': 77, 'sections': 76, 'paragraphs': 96, 'phrasePairs': 3467,
        'bracketCharactersRemoved': removed, 'englishBracketCharactersRemoved': removed,
        'hebrewLiteralBracketCharactersPreserved': 4, 'restoredHebrewCitationBracketCharacters': 2,
        'absentSectionNumbers': [],
        'excludedChatIntroductions': [], 'unmatchedHebrew': [], 'unmatchedEnglish': [],
        'originalDocumentTextSha256': digest('\n'.join(all_paragraph_text)),
        'originalBodyTextSha256': digest(''.join(original_body)),
        'bracketCleanedBodyTextSha256': digest(''.join(cleaned_body)),
        'bodyTextSha256': digest(''.join(item['sourceText'] for item in items)),
        'reviewedSourceCorrections': len(corrections), 'sourceParagraphIndexBase': 0}
    checks = {'allNonemptySourceParagraphsAccounted': True, 'allSuppliedWordsPreservedExceptReviewedTypo': True,
              'originalParagraphOrderPreserved': True, 'originalPhraseOrderPreserved': True,
              'allEnglishBracketsRemoved': True, 'hebrewLiteralBracketsPreserved': True,
              'allCanonicalSectionsAndParagraphsPresent': True, 'reversibleCorrectionProofPassed': True,
              'canonicalSideDifferencesReviewed': True, 'missingCanonicalNarrativeSentences': 0,
              'missingCanonicalHebrewCitationParenthesesRestored': 3}
    pack = {'schemaVersion': 1, 'book': BOOK, 'slug': 'beit-yaakov-on-torah', 'parashah': PARASHAH,
        'source': source_meta, 'canonicalVerification': verification, 'editorialCorrections': corrections,
        'audit': {'file': audit_path.as_posix(), 'checks': checks}, 'sections': sections}
    payload = json.dumps(pack, ensure_ascii=False, separators=(',', ':')).encode()
    encoded = base64.b64encode(gzip.compress(payload, mtime=0)).decode() + '\n'
    pack_path.parent.mkdir(parents=True, exist_ok=True)
    pack_path.write_text(encoded)
    audit = {'schemaVersion': 1, 'book': BOOK, 'parashah': PARASHAH, 'source': source_meta,
        'packFile': pack_path.as_posix(), 'packSha256': digest(encoded), 'decodedPackSha256': digest(payload),
        'canonicalVerification': verification, 'checks': checks,
        'editorialCorrections': corrections, 'sourceParagraphAccounting': accounting,
        'blankSourceParagraphs': blanks, 'hebrewLiteralBracketsPreserved': literal_brackets,
        'nestedEnglishBracketDelimitersRemoved': nested_english, 'canonicalParagraphComparisons': comparisons,
        'reviewedCanonicalSideDifferences': variation_review}
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'sections': 76, 'paragraphs': 96, 'phrasePairs': 3467,
        'englishBracketCharactersRemoved': removed, 'reviewedSourceCorrections': 4,
        'packSha256': digest(encoded), 'decodedPackSha256': digest(payload),
        'auditSha256': digest(audit_path.read_bytes()), 'packBytes': len(encoded.encode()),
        'pack': str(pack_path), 'audit': str(audit_path)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--canonical', type=Path, required=True)
    parser.add_argument('--pack', type=Path, default=Path('sources/akiva/overlays/beit-vayetzei-document-20261022.json.gz.b64'))
    parser.add_argument('--audit', type=Path, default=Path('editorial/beit-vayetzei-document-audit-20261022.json'))
    args = parser.parse_args()
    prepare(args.source, args.canonical, args.pack, args.audit)

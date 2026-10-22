"""Reviewed phrase pairs for the five-paragraph compiler's introduction.
The checked Sefaria source, not a reconstruction, supplies every Hebrew word.
"""
import base64
import gzip
import hashlib
import html
import json
import re
from pathlib import Path

ROOT = Path('editorial/verification/docx-import-20261022')
SOURCE = ROOT / 'mei-introduction-source.json'
data = json.loads(SOURCE.read_text())
texts = [html.unescape(re.sub('<[^>]+>', '', text)) for text in data['response']['versions'][0]['text']]
assert len(texts) == 5
ref = data['response']['ref']

# Expansions are applied to individual, checked forms. The two nonstandard
# life-wish abbreviations are retained and explicitly explained to readers.
expansions = [
    ('זללה״ה', 'זִכְרוֹנוֹ לִבְרָכָה לְחַיֵּי הָעוֹלָם הַבָּא'),
    ('זיע״א', 'זְכוּתוֹ יָגֵן עָלֵינוּ אָמֵן'),
    ('אזמו״ר', 'אָבִי זְקֵנִי מוֹרִי וְרַבִּי'),
    ('אאמו״ר', 'אֲדוֹנִי אָבִי מוֹרִי וְרַבִּי'),
    ('ה׳', 'הַשֵּׁם'),
    ("ה'", 'הַשֵּׁם'),
    ('וְיִהְיֶ׳', 'וְיִהְיֶה'),
    ('לפ״ק', 'לִפְרָט קָטָן'),
    ('הק׳', 'הַקָּטָן'),
    ('בְּהָרַב', 'בֶּן הָרַב'),
    ('משלי', 'מִשְׁלֵי'),
]
normalized = []
audits = []
for index, text in enumerate(texts):
    changed = text
    applied = []
    for before, after in expansions:
        if before in changed:
            count = changed.count(before)
            changed = changed.replace(before, after)
            applied.append({'from': before, 'to': after, 'count': count})
    normalized.append(changed)
    audits.append({'ref': f'{ref} {index + 1}', 'sourceHebrew': text,
        'normalizedHebrew': changed, 'expansions': applied})

# Each marker is the exact END of one Hebrew phrase. Slicing the real source
# makes omission, duplication and accidental spelling changes impossible.
translations = [
    [
        ('הַדְּפוּס', 'Introduction by the compiler and the one who brought the book to press'),
    ],
    [
        ('דָּעַת', 'An understanding heart acquires knowledge,'),
        ('י״ח:ט״ו)', 'and the ear of the wise seeks knowledge (Proverbs 18:15).'),
    ],
    [
        ('בְרִיתֵנוּ,', 'It is known to all members of our community'),
        ('אָבִי זְקֵנִי', 'who sheltered beneath the wings of my master and grandfather,'),
        ('הָעוֹלָם הַבָּא', 'may his memory be a blessing for life in the World to Come,'),
        ('אָמֵן,', 'and may his merit protect us, Amen,'),
        ('הַנִּכְבָּד הַזֶּה,', 'that the teachings of this esteemed book'),
        ('מוֹרִי וְרַבִּי', 'were not written down during the lifetime of my honored master, grandfather, teacher and rabbi,'),
        ('הָעוֹלָם הַבָּא', 'may his memory be a blessing for life in the World to Come.'),
        ('נִכְתְּבוּ אָז,', 'Had they been written down then,'),
        ('מֵהָכִיל כֻּלָּמוֹ,', 'the hides of the rams of Nevayot would not have sufficed to contain them all,'),
        ('הָיוּ שִׂפְתוֹתָיו,', 'for his lips were a flowing stream, a wellspring of wisdom.'),
        ('הַמַּעְיָן הַזֶּה', 'He is the source of this spring'),
        ('מֵימָיו הַנֶּאֱמָנִים,', 'whose faithful waters do not fail even now'),
        ('דִּבְרֵי אֱלֹקִים חַיִּים,', 'for the remnant of our people who seek to hear the words of the living God'),
        ('מְשִׁיבַת נֶפֶשׁ –', 'and to cleave to the faith that restores the soul.'),
        ('מֵעֵת הִלָּקְחוֹ מֵאִתָּנוּ', 'Now, after five years had passed since he was taken from us'),
        ('בְּצֵל שַׁדַּי,', 'to abide in the shadow of the Almighty,'),
        ('הִרְהַבְתִּי עֹז בְּנַפְשִׁי', 'I gathered courage'),
        ('הַחֲסִידִים הַיְקָרִים,', 'to fulfill the wish of our dear chassidic companions,'),
        ('שילאויט״א,', 'who gather in the courts of my honored father, teacher and rabbi, may he enjoy long and good years, Amen.'),
        ('וְרָאִיתִי', 'Moreover, I reflected and saw'),
        ('עַמּוּדֵי יְסוֹדֵי עוֹלָם', 'that all the righteous, the pillars upon which the world is founded,'),
        ('כָּל אֶחָד בְּיָמָיו,', 'upon whom the world relied, each in his own time,'),
        ('הַבָּאִים כִּי יָבוֹאוּ.', 'left a blessing after them for the generations yet to come,'),
        ('מֵאוֹר קְדֻשָּׁתוֹ,', 'so that they, too, might benefit from the light of his holiness.'),
        ('וְלִקַּטְתִּי', 'I therefore girded myself with strength and collected'),
        ('אַנְשֵׁי שְׁלוֹמֵינוּ יַחַד –', 'what was remembered among our companions together,'),
        ('דּוֹרְשֵׁי מַאֲמָרָיו.', 'so that those who seek his teachings might delight in them.'),
    ],
    [
        ('כִּי יָדַעְתִּי', 'Although I knew'),
        ('יִקְשׁוּ הַדְּבָרִים', 'that in several places these teachings would be difficult'),
        ('בִּדְבָרִים כָּאֵלֶּה,', 'for ears that had not heard, and were not accustomed to, words of this kind,'),
        ('עֵרֶךְ יַקְרוּתָם.', 'I collected them only for our companions, who recognize their precious worth.'),
        ('אֶל תַּכְלִיתָם', 'May Hashem therefore help me reach their intended meaning'),
        ('דְּבָרָיו הַקְּדוֹשִׁים', 'and understand the depth of his holy teachings,'),
        ('שְׁלוֹמֵנוּ יַחַד.', 'and may they become firmly established in my heart and in the hearts of all our companions together.'),
        ('וּלְהַשְׂכִּיל', 'May I merit understanding and insight,'),
        ('וּלְלַמֵּד', 'to listen, learn and teach,'),
        ('וּלְקַיֵּם', 'to observe, practice and fulfill,'),
        ('עִם אֲבוֹתַי,', 'and may Hashem, my God, be with me as He was with my ancestors.'),
        ('וּבַמִּצְווֹת.', 'May I merit seeing children and grandchildren engaged in Torah and mitzvos.'),
        ('יוֹם שְׁלִישִׁי', 'These are the words of the compiler, writing today, Tuesday,'),
        ('בְּיַרְחָא תְּלִיתָאָה', 'the fifteenth of the third month,'),
        ('לִפְרָט קָטָן', 'in the year indicated by the chronogram “Divrei Kodesh,” omitting the thousands,'),
        ('אִיזְבִּיצֶע.', 'here in Izhbitza.'),
    ],
    [
        ('הֶעֱנִיךְ', 'The humble Gershon Chanoch Henich,'),
        ('שילאיט״א', 'son of the holy rabbi, may he enjoy long and good years, Amen,'),
        ('מֵאִיזְבִּיצֶע', 'grandson of the holy rabbi of Izhbitza,'),
        ('הָעוֹלָם הַבָּא:', 'may his memory be a blessing for life in the World to Come.'),
    ],
]
items = []
for index, (source, entries) in enumerate(zip(normalized, translations)):
    cursor = 0
    pairs = []
    for end, english in entries:
        at = source.find(end, cursor)
        assert at >= 0, (index + 1, end)
        stop = at + len(end)
        hebrew = source[cursor:stop].strip()
        assert hebrew and english
        pairs.append([hebrew, english])
        cursor = stop
    assert not source[cursor:].strip(), ('Unpaired source text', index + 1, source[cursor:])
    assert re.sub(r'\s+', '', ''.join(pair[0] for pair in pairs)) == re.sub(r'\s+', '', source)
    item = {'n': index + 1, 'p': pairs}
    if index in (2, 4):
        item['transcriptionNotes'] = ['The source’s nonstandard honorifics שילאויט״א and שילאיט״א are retained in Hebrew. Their English renders the conventional wish for a long and good life; the precise expanded Hebrew wording is uncertain.']
    if index == 3:
        item['transcriptionNotes'] = ['The dated chronogram דברי קדש is retained as printed; the English identifies it as a year chronogram and preserves the instruction to omit the thousands.']
    items.append(item)
    audits[index]['phrasePairs'] = len(pairs)
    audits[index]['allSourceCharactersAccountedFor'] = True
    audits[index]['missingEnglishPhrases'] = 0

pack = {'schemaVersion': 1, 'book': 'Mei HaShiloach', 'kind': 'verified-introduction-completion',
    'sourceEvidence': SOURCE.as_posix(), 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'translationProvenance': 'Original English interlinear translation from the checked Hebrew compiler’s introduction',
    'sections': [{'ref': ref, 'sep': ' ', 'title': 'Compiler’s Introduction', 'he': texts[0],
        'sourceUrl': data['sourceUrl'], 'sortKey': [0, 0], 'canonicalParagraphCount': 5, 'items': items}],
    'counts': {'sections': 1, 'paragraphs': 5, 'phrasePairs': sum(len(item['p']) for item in items)}}
output = Path('sources/akiva/overlays/mei-introduction-20261022.json.gz.b64')
raw = json.dumps(pack, ensure_ascii=False, separators=(',', ':')).encode()
output.write_bytes(base64.b64encode(gzip.compress(raw, mtime=0)) + b'\n')
audit = {'schemaVersion': 1, 'status': 'PASS', 'sourceEvidence': SOURCE.as_posix(),
    'sourceSha256': pack['sourceSha256'], 'packFile': output.as_posix(),
    'packSha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'counts': pack['counts'],
    'reviewNotes': ['Vocalized Sefaria Hebrew is the base; the user’s 2005 export confirms all five source paragraphs. Its orthographic and occasional word-order differences are retained as edition distinctions.',
        'Context determines אאמו״ר/אזמו״ר and the self-description הק׳. Two nonstandard life-wish forms remain in the source with a visible transcription note.',
        'The year chronogram and the author’s abbreviated formulas are not replaced by an inferred historical date.'],
    'paragraphs': audits}
(ROOT / 'mei-introduction-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, **pack['counts']}))

#!/usr/bin/env python3
"""Import the supplied remainder DOCX without dropping or relabeling its text.

The upload contains both Volume I and an explicitly labeled run of Volume II
Writings. Canonical references come from the cached public Sefaria index/texts.
Only English square-bracket delimiters are removed; three malformed delimiter
locations are repaired with exact character-accounting assertions.
"""
import argparse
import base64
import csv
import difflib
import gzip
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote
from zipfile import ZipFile

from lxml import html

BOOK = 'Mei HaShiloach'
SOURCE_SHA256 = '43a2d1ee5db3d2fd49af36212a03041da71a510348e6aed9464a72b79ff89020'
SOURCE_XML_SHA256 = '0661d86865b5971fb799b0ec2ed05b12ba01dd45a39366e245769ddfce86e713'
SOURCE_ROWS_SHA256 = '269cc6328715ec1c17d7b272db96863b0de4ab0db984bf639639134cbbf26bb3'
VERIFICATION = Path('editorial/verification/docx-import-20261022')
PRESERVED_FILES = (
    Path('sources/akiva/overlays/mei-hashiloach-interlinear.json'),
    Path('sources/akiva/overlays/mei-hashiloach-vayera-to-bo.json.gz.b64'),
)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
VALUES = dict(zip('אבגדהוזחטיכלמנסעפצקרשת',
                  [1,2,3,4,5,6,7,8,9,10,20,30,40,50,60,70,80,90,100,200,300,400]))
NUMBER_WORDS = {'אלף':1,'בית':2,'גימל':3,'דלת':4,'הא':5,'הה':5,'ה':5,'וו':6,'ואו':6,
                'זין':7,'חית':8,'טית':9,'יוד':10,'כף':20,'למד':30,'מם':40,'נון':50,
                'סמך':60,'עין':70,'פא':80,'צדי':90,'קוף':100}
HE_BOOKS = {'רות':'Ruth','קהלת':'Ecclesiastes','יהושע':'Joshua','שמואלאלף':'I Samuel',
            'שמואלא':'I Samuel','שמואלבית':'II Samuel','שמואלב':'II Samuel',
            'מלכיםאלף':'I Kings','מלכיםא':'I Kings','מלכיםבית':'II Kings','מלכיםב':'II Kings',
            'ישעיה':'Isaiah','הושע':'Hosea','תהלים':'Psalms','משלי':'Proverbs',
            'ברכות':'Berakhot','שבת':'Shabbat','פסחים':'Pesachim','יומא':'Yoma','סוכה':'Sukkah',
            'ביצה':'Beitzah','ראשהשנה':'Rosh Hashanah','מגילה':'Megillah','תענית':'Taanit',
            'חגיגה':'Chagigah','יבמות':'Yevamot','כתובות':'Ketubot','נדרים':'Nedarim','נזיר':'Nazir',
            'בבאבתרא':'Bava Batra','עבודהזרה':'Avodah Zarah','סנהדרין':'Sanhedrin',
            'עדיות':'Eduyot','אבות':'Avot','מנחות':'Menachot','בכורות':'Bekhorot',
            'חולין':'Chullin','עוקצין':'Oktzin'}
HE_TORAH = 'בשלח|יתרו|משפטים|תרומה|תצוה|כי תשא|ויקהל|פקודי|ויקרא|צו|שמיני|תזריע|מצרע|אחרי מות|קדושים|אמר|בהר|בחקתי|במדבר|נשא|בהעלתך|שלח|קרח|חקת|בלק|פינחס|מטות|מסעי|דברים|ואתחנן|עקב|ראה|שפטים|כי תצא|כי תבוא|נצבים|וילך|האזינו|וזאת הברכה'.split('|')
INLINE_HEADINGS = {
    1232:'Why the Shabbat before Pesach is called Shabbat HaGadol',
    1234:'The reason for Israel’s stringencies on Pesach',
    1236:'The reason for eating eggs on the night of Pesach',
    1238:'The reason for placing paper flowers on the windows on Shavuot',
    1240:'The reason for the custom of eating the Purim meal on the night of the fifteenth',
}
PARATEXT = {653, 655}


def sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def unpointed(value):
    return re.sub('[\u0591-\u05bd\u05bf-\u05c7]', '', value)


def letters(value):
    return re.sub('[^א-ת]', '', value)


def no_brackets_or_space(value):
    return re.sub(r'[\s\[\]]', '', value)


def source_url(ref):
    match = re.match(r'^(.*?) (\d[\dab:.\-–]*)$', ref)
    path = (match[1].replace(' ', '_')+'.'+match[2].replace(':', '.')) if match else ref.replace(' ', '_')
    return 'https://www.sefaria.org/'+quote(path, safe='_,.:-')


def canonical_alias(ref):
    return ref.replace(', Chayei Sarah', ', Chayei Sara')


def paragraph_ref(section, n):
    ref = section if isinstance(section, str) else section['ref']
    return ref+(':' if re.search(r'\d[ab]?$',ref) else ' ')+str(n)


def canonical_base(value):
    tree = html.fragment_fromstring(value, create_parent='div')
    for el in tree.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " footnote ") or '
                         'contains(concat(" ", normalize-space(@class), " "), " footnote-marker ")]'):
        el.drop_tree()
    return tree.text_content()


def number(value):
    value = unpointed(value)
    value = re.sub(r'פרק|מזמור', '', value).strip()
    if any(mark in value for mark in ('״', '׳', '"', "'")):
        return sum(VALUES[c] for c in letters(value))
    tokens = [letters(t) for t in re.split(r'[\s\-־]+', value) if letters(t)]
    if len(tokens) > 1 or (tokens and tokens[0] in NUMBER_WORDS):
        assert all(t in NUMBER_WORDS for t in tokens), ('Unknown spelled numeral', value, tokens)
        return sum(NUMBER_WORDS[t] for t in tokens)
    assert tokens, ('Missing numeral', value)
    return sum(VALUES[c] for c in tokens[0])


def parse_paragraph(original, index):
    text, repairs = original, []
    # The English supplement bracket in Korach spans several Hebrew-English
    # pairs. Remove its redundant outer delimiter, preserving its Hebrew mate.
    if index == 361:
        old = '[because "recognized" [is like'
        new = '[because "recognized" is like'
        assert text.count(old) == 1
        text = text.replace(old, new, 1)
        repairs.append({'before':old, 'after':new, 'reason':'English supplement delimiter crossed interlinear pairs'})
    if index in {361,575,651}:
        old, new = 'End of supplement.]]', 'End of supplement.]'
        assert text.count(old) == 1
        text = text.replace(old, new, 1)
        repairs.append({'before':old, 'after':new, 'reason':'Remove redundant English supplement closing delimiter'})
    spans, cursor = [], 0
    while cursor < len(text):
        if text[cursor] != '[':
            cursor += 1
            continue
        first = re.search('[A-Za-zא-ת]', text[cursor + 1:])
        # A Hebrew square bracket is source punctuation, not an English span.
        if first is None or not first[0].isascii():
            cursor += 1
            continue
        start, depth = cursor, 1
        cursor += 1
        while cursor < len(text) and depth:
            if text[cursor] == '[':
                depth += 1
            elif text[cursor] == ']':
                depth -= 1
            cursor += 1
        assert depth == 0, ('Unclosed English span', index, start)
        spans.append((start, cursor))
    pairs, cursor, english_brackets, nested = [], 0, 0, []
    for start, end in spans:
        he = text[cursor:start].strip()
        inside = text[start + 1:end - 1]
        en = inside.replace('[', '').replace(']', '').strip()
        assert re.search('[א-ת]', he), ('Missing Hebrew phrase', index, len(pairs), he, en)
        assert re.search('[A-Za-z]', en), ('Missing English phrase', index, len(pairs))
        assert not re.search('[A-Za-z]', he), ('Unexpected Latin in Hebrew', index, he)
        assert len(re.findall('[א-ת]', en)) <= 6, ('Hebrew text swallowed by English delimiter', index, en)
        if '[' in inside or ']' in inside:
            nested.append({'phraseIndex':len(pairs),'text':inside})
        english_brackets += text[start:end].count('[') + text[start:end].count(']')
        pairs.append([he, en])
        cursor = end
    tail = text[cursor:]
    assert not tail.strip(), ('Untranslated trailing text', index, tail)
    assert pairs, ('No pairs', index)
    assert no_brackets_or_space(original) == no_brackets_or_space(''.join(s for pair in pairs for s in pair)), ('Text lost', index)
    assert all('[' not in en and ']' not in en for _,en in pairs)
    return pairs, repairs, english_brackets, nested


def load_source(source, cache):
    source_digest = sha(source.read_bytes())
    assert source_digest == SOURCE_SHA256, 'Unexpected source document'
    if cache.exists():
        saved = json.loads(cache.read_text())
        assert saved['sourceSha256'] == source_digest
        assert sha(json.dumps(saved['paragraphs'],ensure_ascii=False,separators=(',',':'))) == SOURCE_ROWS_SHA256
        return saved['paragraphs']
    rows = []
    with ZipFile(source) as z:
        assert sha(z.read('word/document.xml')) == SOURCE_XML_SHA256
        assert 'word/footnotes.xml' not in z.namelist()
        for _, element in ET.iterparse(z.open('word/document.xml'), events=('end',)):
            if element.tag == W+'p':
                style = element.find(W+'pPr/'+W+'pStyle')
                rows.append({'index':len(rows),'text':''.join(e.text or '' for e in element.iter(W+'t')),
                             'style':style.get(W+'val','') if style is not None else ''})
                element.clear()
    assert sha(json.dumps(rows,ensure_ascii=False,separators=(',',':'))) == SOURCE_ROWS_SHA256
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({'sourceSha256':source_digest,'paragraphs':rows},ensure_ascii=False))
    return rows


def load_canonical(directory):
    index = json.loads((directory/'sefaria-index.json').read_text())
    manifest = json.loads((directory/'canonical-manifest.json').read_text())
    sources = {}
    for request in manifest['requests']:
        assert 'error' not in request, request
        file = Path(request['file'])
        raw = file.read_bytes()
        assert sha(raw) == request['sha256']
        response = json.loads(raw)
        assert response['ref'] == request['ref']
        sources[request['ref']] = {'request':request,'response':response}
    leaves, canonical_sections = [], {}
    def walk(node, trail):
        if node.get('nodes'):
            for child in node['nodes']:
                walk(child, trail+[child['key']])
        else:
            leaves.append((BOOK+', '+', '.join(trail), node))
    for volume in index['schema']['nodes']:
        walk(volume, [volume['key']])
    for leaf_order, (ref,node) in enumerate(leaves):
        if ref not in sources:
            continue
        response = sources[ref]['response']
        he = response['he']
        if node['depth'] == 1:
            canonical_sections[ref] = {'he':he,'sortKey':[leaf_order,0],'sourceRef':ref,'source':sources[ref]}
        else:
            for i, items in enumerate(he):
                if not items:
                    continue
                addr = str(i+1) if node['addressTypes'][0] == 'Integer' else f'{(i+2)//2}{"a" if i%2==0 else "b"}'
                canonical_sections[ref+' '+addr] = {'he':items,'sortKey':[leaf_order,i+1],'sourceRef':ref,'source':sources[ref]}
    torah_refs = [r for r,_ in leaves if r.startswith(BOOK+', Volume I,') and r in sources and
                  r.split(', ')[2] in {'Exodus','Leviticus','Numbers','Deuteronomy'} and
                  r.split(', ')[-1] not in {'Shemot','Vaera','Bo'}]
    assert len(torah_refs) == len(HE_TORAH) == 39
    torah = dict(zip(map(letters,HE_TORAH),torah_refs))
    return index, sources, canonical_sections, torah, leaves


def heading_ref(text, source_index, torah):
    he = unpointed(text.split('[')[0]).strip()
    parts = [s.strip() for s in he.split(',')]
    assert parts[0].startswith('חלק '), ('Not a section heading', text)
    volume = 'II' if letters(parts[0]) in {'חלקבית','חלקב'} else 'I'
    category = letters(parts[1])
    if category.startswith('ספר'):
        key = letters(parts[2].replace('פרשת ',''))
        return torah[key], {'declaredVolume':volume}
    if category == 'ליקוטים':
        return BOOK+', Volume '+volume+', Miscellany', {'declaredVolume':volume}
    kind = ('Five Scrolls' if 'מגל' in category else 'Prophets' if 'נביא' in category else
            'Writings' if 'כתובים' in category else 'Talmud' if 'השס' in category else None)
    assert kind is not None, (text, category)
    heb_book = re.sub(r'^(ספר|מסכת|מגלת)\s*', '', parts[2])
    book = HE_BOOKS[letters(heb_book)]
    ref = f'{BOOK}, Volume {volume}, {kind}, {book}'
    if len(parts) == 3:
        return ref, {'declaredVolume':volume}
    if kind == 'Talmud':
        folio, side = parts[3].rsplit(' ',1)
        assert letters(side) in {'א','ב'}
        address = str(number(folio))+('a' if letters(side)=='א' else 'b')
    else:
        address = str(number(parts[3]))
    correction = None
    if source_index == 711:
        assert ref.endswith('Volume I, Writings, Psalms') and address == '15'
        correction = {'sourceHebrewNumber':15,'correctedCanonicalNumber':16,
                      'reason':'The English heading says Sixteen and the Hebrew body matches canonical Psalms16; the pointed Hebrew heading spells15.'}
        address = '16'
    return ref+' '+address, {'declaredVolume':volume, **({'headingCorrection':correction} if correction else {})}


def similarity(a,b):
    a,b = letters(a),letters(b)
    return round(difflib.SequenceMatcher(None,a,b,autojunk=False).ratio(),6)


def preserved_sections(canonical):
    result = []
    for file in PRESERVED_FILES:
        raw = file.read_bytes()
        data = json.loads(gzip.decompress(base64.b64decode(raw)) if file.name.endswith('.gz.b64') else raw)
        for section in data['sections']:
            ref, canonical_ref = section['ref'], canonical_alias(section['ref'])
            count = len(section['paragraphs'])
            assert count == len(canonical[canonical_ref]['he']), ('Preserved count mismatch', ref)
            result.append({'ref':ref,'canonicalRef':canonical_ref,'paragraphs':count,
                           'sortKey':canonical[canonical_ref]['sortKey'],
                           'sourceFile':str(file),'sourceFileSha256':sha(raw),
                           'paragraphsSha256':sha(json.dumps(section['paragraphs'],ensure_ascii=False,separators=(',',':')))})
    assert len(result)==21
    return result


def write_canonical_evidence(args, index, sources, canonical, preserved, sections, paratext):
    """Persist every primary-source check and the exact missing-text ledger."""
    VERIFICATION.mkdir(parents=True,exist_ok=True)
    original_index = (args.cache/'sefaria-index.json').read_text()
    snapshot = {'schemaVersion':1,'indexUrl':'https://www.sefaria.org/api/v2/raw/index/Mei_HaShiloach',
                'indexSha256':sha(original_index),'indexRawUtf8':original_index,'responses':[]}
    for ref, value in sources.items():
        request = {k:v for k,v in value['request'].items() if k!='file'}
        raw = Path(value['request']['file']).read_text()
        assert sha(raw)==request['sha256']
        snapshot['responses'].append({'request':request,'rawUtf8':raw})
    evidence_path = VERIFICATION/'mei-canonical-api-snapshot.json.gz.b64'
    evidence_path.write_text(base64.b64encode(gzip.compress(json.dumps(snapshot,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)).decode()+'\n')
    references = {}
    for ref, value in canonical.items():
        source = value['source']['request']
        proof = {'ref':ref,'url':source_url(ref),'verified':True,'api':source['url'],
                 'canonicalResponseRef':value['sourceRef'],'responseSha256':source['sha256'],
                 'evidenceFile':str(evidence_path),'canonicalSortKey':value['sortKey'],
                 'canonicalParagraphCount':len(value['he'])}
        references[ref]=proof
        for n,text in enumerate(value['he'],1):
            if not canonical_base(text).strip():
                continue
            pref=paragraph_ref(ref,n)
            references[pref]={**proof,'ref':pref,'url':source_url(pref),'canonicalParagraphNumber':n,
                              'canonicalTextSha256':sha(text)}
    for prior in preserved:
        if prior['ref']!=prior['canonicalRef']:
            references[prior['ref']]={**references[prior['canonicalRef']],'requestedAlias':prior['ref']}
    (VERIFICATION/'mei-canonical-references.json').write_text(json.dumps({
        'schemaVersion':1,'method':'Public Sefaria index and text APIs; each leaf and paragraph is nonempty and retained in the raw API snapshot.',
        'references':references},ensure_ascii=False,indent=2)+'\n')
    present={paragraph_ref(s['ref'],i['n']) for s in sections for i in s['items']}
    present.update(p['sourceRef'] for p in paratext)
    for prior in preserved:
        present.update(paragraph_ref(prior['canonicalRef'],n) for n in range(1,prior['paragraphs']+1))
    missing=[]
    expected=[]
    for ref,value in canonical.items():
        if ', Volume I, ' not in ref:
            continue
        for n,text in enumerate(value['he'],1):
            pref=paragraph_ref(ref,n)
            expected.append(pref)
            if pref in present:
                continue
            plain=canonical_base(text)
            missing.append({'ref':pref,'sectionRef':ref,'n':n,'he':plain,'heHtml':text,
                'hebrewWordCount':len(plain.split()),'hebrewLetterCount':len(letters(plain)),
                'sortKey':value['sortKey']+[n],'sourceUrl':source_url(pref),
                'canonicalApiUrl':value['source']['request']['url'],
                'canonicalResponseSha256':value['source']['request']['sha256'],
                'reason':'Absent from the supplied DOCX and all preserved reader sections'})
    assert len(missing)==50 and len({p['sectionRef'] for p in missing})==36
    missing_ledger={'schemaVersion':1,'book':BOOK,'sourceSha256':SOURCE_SHA256,
        'scope':'Volume I from Bereshit through Miscellany, excluding its separately indexed Introduction.',
        'missingSectionCount':len({p['sectionRef'] for p in missing}),'missingParagraphCount':len(missing),
        'hebrewWordCount':sum(p['hebrewWordCount'] for p in missing),'missingParagraphs':missing}
    (VERIFICATION/'mei-missing-volume-i.json').write_text(json.dumps(missing_ledger,ensure_ascii=False,indent=2)+'\n')
    coverage={'scope':missing_ledger['scope'],'expectedVolumeISections':sum(', Volume I, ' in r for r in canonical),
        'expectedVolumeIParagraphs':len(expected),'preservedVolumeIParagraphs':sum(s['paragraphs'] for s in preserved if ', Volume I, ' in s['ref']),
        'suppliedVolumeIBodyParagraphs':sum(len(s['items']) for s in sections if ', Volume I, ' in s['ref']),
        'suppliedVolumeIColophons':len(paratext),'missingVolumeISections':missing_ledger['missingSectionCount'],
        'missingVolumeIParagraphs':len(missing),'missingVolumeIHebrewWords':missing_ledger['hebrewWordCount'],
        'missingLedger':str(VERIFICATION/'mei-missing-volume-i.json'),
        'suppliedVolumeIISections':sum(', Volume II, ' in s['ref'] for s in sections),
        'suppliedVolumeIIParagraphs':sum(len(s['items']) for s in sections if ', Volume II, ' in s['ref']),
        'allSuppliedTextImported':True,'completeVolumeI':False,
        'note':'The file includes genuine Volume II selections in place of part of the Volume I Writings; those supplied words retain their correct Volume II identities. Missing Volume I text is recorded separately.'}
    return coverage, references


def compare_uploaded_2005_edition(args, index, canonical, preserved, sections, paratext):
    """Cross-check the user's four local exports without replacing either edition."""
    files=sorted(args.source.parent.glob('Mei HaShiloach - he - Mei HaShiloach, Publication of Sifrei Izhbitza Radzin, Bnei Brak 2005.*'))
    if not files:
        return None
    assert len(files)==4, ('Expected the four supplied 2005 exports', files)
    json_file=next(p for p in files if p.suffix=='.json')
    csv_file=next(p for p in files if p.suffix=='.csv')
    edition=json.loads(json_file.read_text())
    assert edition['title']==BOOK and edition['language']=='he'
    records={}
    def walk(node,trail,value):
        if node.get('nodes'):
            for child in node['nodes']:
                walk(child,trail+[child['key']],value[child['key']])
        else:
            ref=BOOK+', '+', '.join(trail)
            if node['depth']==1:
                for n,text in enumerate(value,1):
                    if text.strip(): records[paragraph_ref(ref,n)]=text
            else:
                assert node['depth']==2
                for i,paragraphs in enumerate(value):
                    addr=str(i+1) if node['addressTypes'][0]=='Integer' else f'{(i+2)//2}{"a" if i%2==0 else "b"}'
                    for n,text in enumerate(paragraphs,1):
                        if text.strip(): records[paragraph_ref(ref+' '+addr,n)]=text
    walk(index['schema'],[],edition['text'])
    csv_records={row[0]:row[1] for row in csv.reader(csv_file.open()) if row[0].startswith(BOOK+', ')}
    assert records==csv_records, 'Uploaded JSON and CSV exports differ'
    text_checks=[]
    for file in files:
        if file.suffix!='.txt': continue
        text=letters(html.fragment_fromstring(file.read_text(),create_parent='div').text_content())
        pos=0
        for ref,original in records.items():
            phrase=letters(html.fragment_fromstring(original,create_parent='div').text_content())
            found=text.find(phrase,pos)
            assert found>=0, ('Uploaded text export omits/reorders Hebrew',file.name,ref)
            pos=found+len(phrase)
        text_checks.append({'file':file.name,'consonantalSegmentsFoundInOrder':len(records)})
    selected={paragraph_ref(s,n) for s in sections for n in range(1,len(s['items'])+1)}
    selected.update(p['sourceRef'] for p in paratext)
    for prior in preserved:
        selected.update(paragraph_ref(prior['canonicalRef'],n) for n in range(1,prior['paragraphs']+1))
    missing=json.loads((VERIFICATION/'mei-missing-volume-i.json').read_text())['missingParagraphs']
    selected.update(p['ref'] for p in missing)
    canonical_rows={paragraph_ref(ref,n):text for ref,value in canonical.items() for n,text in enumerate(value['he'],1) if text.strip()}
    assert selected<=records.keys() and selected<=canonical_rows.keys()
    comparisons=[]
    for ref in sorted(selected):
        old=letters(canonical_base(records[ref]));vocalized=letters(canonical_base(canonical_rows[ref]))
        matcher=difflib.SequenceMatcher(None,old,vocalized,autojunk=False)
        changes=[{'kind':tag,'from':old[a:b],'to':vocalized[c:d],
                  'contextBefore':old[max(0,a-16):a],'contextAfter':old[b:b+16]}
                 for tag,a,b,c,d in matcher.get_opcodes() if tag!='equal']
        comparisons.append({'ref':ref,'sameConsonants':old==vocalized,'ratio':round(matcher.ratio(),6),
            'edition2005HebrewLetters':len(old),'vocalizedHebrewLetters':len(vocalized),
            'edition2005TextSha256':sha(records[ref]),'vocalizedTextSha256':sha(canonical_rows[ref]),
            'differences':changes})
    # All expected paragraphs exist; differing abbreviation conventions and
    # readings are recorded, never silently applied to the supplied DOCX.
    assert min(c['ratio'] for c in comparisons)>0.8
    all_volume_counts={volume:sum(ref.startswith(BOOK+', '+volume+', ') for ref in records)
                       for volume in edition['text']}
    report={'schemaVersion':1,'status':'PASS','versionTitle':edition['versionTitle'],
        'versionSource':edition['versionSource'],'versionTitleInHebrew':edition.get('versionTitleInHebrew'),
        'uploads':[{'file':str(p),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in files],
        'allEditionNonemptyParagraphs':len(records),'editionParagraphCountsByVolume':all_volume_counts,
        'jsonAndCsvExactTextEquality':True,'textExportConsonantalChecks':text_checks,
        'comparisonScope':'All 21 preserved sections, all supplied sections and colophons, and the 50 missing Volume I paragraphs.',
        'comparedParagraphs':len(comparisons),'missingLedgerParagraphsConfirmed':len(missing),
        'identicalConsonantalParagraphs':sum(c['sameConsonants'] for c in comparisons),
        'differingConsonantalParagraphs':sum(not c['sameConsonants'] for c in comparisons),
        'minimumConsonantalSimilarity':min(c['ratio'] for c in comparisons),
        'editionPolicy':'Retain the supplied interlinear manuscript exactly. Keep the vocalized canonical source and uploaded 2005 edition distinct; abbreviation expansions, orthographic differences and other readings are recorded here without replacing manuscript words.',
        'comparisons':comparisons}
    (VERIFICATION/'mei-2005-edition-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return {k:v for k,v in report.items() if k not in {'comparisons','uploads'}}


def prepare(args):
    rows = load_source(args.source,args.cache/'source-paragraphs.json')
    assert len(rows)==1244 and sum(bool(r['text'].strip()) for r in rows)==709
    index,sources,canonical,torah,leaves = load_canonical(args.cache)
    preserved=preserved_sections(canonical)
    sections, accounting, repairs, nested, comparisons, paratext = [],[],[],[],[],[]
    current, pending_heading, removed, english_headings, splits = None,None,0,0,[]
    for row in rows:
        source_index,text = row['index'],row['text']
        record = {'sourceParagraphIndex':source_index,'originalSha256':sha(text),'characters':len(text)}
        if not text.strip():
            accounting.append({**record,'kind':'blank'});continue
        if unpointed(text).startswith('חלק '):
            ref, extra = heading_ref(text,source_index,torah)
            assert ref in canonical, ('No canonical text for section',source_index,ref)
            assert not any(s['ref']==ref for s in sections), ('Duplicate heading',ref)
            english = text.split('[',1)[1].replace('[','').replace(']','').strip() if '[' in text else None
            if english:
                english_headings += 1
                removed += text.count('[')+text.count(']')
            current = {'ref':ref,'sep':':' if re.search(r'\d[ab]?$',ref) else ' ',
                       'en':english or ref.split(', ',1)[-1],'title':english or ref.split(', ',1)[-1],
                       'he':text.split('[')[0].strip(),'sourceHeading':text,'sourceHeadingParagraphIndex':source_index,
                       'sortKey':canonical[ref]['sortKey'],'sourceUrl':source_url(ref),
                       'items':[],**extra}
            if current.get('headingCorrection'):
                current['he'] = current['he'].replace('טֵית וָו','טֵית זַיִן')
            sections.append(current);accounting.append({**record,'kind':'sectionHeading','ref':ref});continue
        if source_index in INLINE_HEADINGS:
            assert current['ref']==BOOK+', Volume I, Miscellany' and pending_heading is None
            pending_heading = {'sourceParagraphIndex':source_index,'he':text,'en':INLINE_HEADINGS[source_index]}
            accounting.append({**record,'kind':'canonicalInlineHeading','ref':current['ref']});continue
        pairs, fixes, count, inline_brackets = parse_paragraph(text,source_index)
        removed += count
        repairs.extend({'sourceParagraphIndex':source_index,**r} for r in fixes)
        nested.extend({'sourceParagraphIndex':source_index,**r} for r in inline_brackets)
        if source_index in PARATEXT:
            assert current['ref'].endswith("V'Zot HaBerachah")
            pref=paragraph_ref(current,17+len(paratext))
            value={'p':pairs,'sourceParagraphIndex':source_index,'kind':'suppliedColophon',
                   'bodyDiscourse':False,'sourceRef':pref,'sourceUrl':source_url(pref),'canonicalSourceVerified':True}
            paratext.append({'afterRef':current['ref'],**value})
            accounting.append({**record,'kind':'paratext','afterRef':current['ref'],'pairs':len(pairs)});continue
        assert current is not None
        item={'n':len(current['items'])+1,'p':pairs,'sourceParagraphIndex':source_index}
        if pending_heading is not None:
            # These five headings form the beginning of canonical Miscellany4–8.
            # Preserve their Hebrew and provide a separately audited translation.
            item['p'].insert(0,[pending_heading['he'],pending_heading['en']])
            item['heading']=pending_heading['en']
            item['inlineHeadings']=[{'phraseIndex':0,**pending_heading}]
            pending_heading=None
        current['items'].append(item)
        accounting.append({**record,'kind':'body','ref':current['ref'],'n':item['n'],'pairs':len(item['p'])})
    assert pending_heading is None
    # One DOCX paragraph contains two complete canonical paragraphs. The
    # existing phrase boundary keeps every supplied Hebrew-English pair intact.
    split_section=next(s for s in sections if s['ref'].endswith('Talmud, Shabbat 138b'))
    assert len(split_section['items'])==1
    whole=split_section['items'][0]
    assert whole['sourceParagraphIndex']==1014 and len(whole['p'])==47
    assert letters(whole['p'][33][0]).startswith('והנהזההפרקתוליןאתהמשמרת')
    split_section['items']=[{**whole,'n':1,'p':whole['p'][:33],'sourcePhraseRange':[0,33]},
                            {**whole,'n':2,'p':whole['p'][33:],'sourcePhraseRange':[33,47]}]
    assert [pair for i in split_section['items'] for pair in i['p']]==whole['p']
    splits.append({'sourceParagraphIndex':1014,'sectionRef':split_section['ref'],
                   'canonicalParagraphs':[1,2],'phraseBoundary':33,'sourcePhrasePairs':47,
                   'reason':'The supplied paragraph contains both complete canonical Shabbat138b paragraphs; split only at an existing bilingual phrase boundary.'})
    for record in accounting:
        if record['sourceParagraphIndex']==1014:
            record['canonicalParagraphNumbers']=[1,2]
    for section in sections:
        source = canonical[section['ref']]
        section['canonicalParagraphCount']=len(source['he'])
        for item in section['items']:
            n=item['n']; he=' '.join(p[0] for p in item['p'])
            target=canonical_base(source['he'][n-1]) if n<=len(source['he']) else ''
            comparisons.append({'ref':section['ref']+section['sep']+str(n),'sourceParagraphIndex':item['sourceParagraphIndex'],
                                'sourceHebrewLetters':len(letters(he)),'canonicalHebrewLetters':len(letters(target)),
                                'ratio':similarity(he,target),'sourceBeginning':he[:160],'canonicalBeginning':target[:160]})
    issues=[]
    for section in sections:
        colophons=[p for p in paratext if p['afterRef']==section['ref']]
        section['canonicalBodyParagraphCount']=section['canonicalParagraphCount']-len(colophons)
        if len(section['items'])+len(colophons)!=section['canonicalParagraphCount']:
            issues.append({'kind':'paragraphCountMismatch','ref':section['ref'],'source':len(section['items']),
                           'canonical':section['canonicalParagraphCount']})
    issues += [{'kind':'lowCanonicalSimilarity',**r} for r in comparisons if r['ratio']<0.65]
    for p in paratext:
        target=canonical[p['afterRef']]['he'][int(p['sourceRef'].rsplit(' ',1)[-1])-1]
        assert letters(' '.join(h for h,_ in p['p']))==letters(canonical_base(target))
    assert not set(s['ref'] for s in preserved)&set(s['ref'] for s in sections)
    canonical_order=sorted([s['ref'] for s in preserved]+[s['ref'] for s in sections],
                           key=lambda ref:canonical[canonical_alias(ref)]['sortKey'])
    coverage,references=write_canonical_evidence(args,index,sources,canonical,preserved,sections,paratext)
    edition_check=compare_uploaded_2005_edition(args,index,canonical,preserved,sections,paratext)
    counts={'sourceParagraphs':len(rows),'nonemptySourceParagraphs':709,'sections':len(sections),
            'sourceBodyParagraphs':sum(a['kind']=='body' for a in accounting),
            'bodyParagraphs':sum(len(s['items']) for s in sections),
            'phrasePairs':sum(len(i['p']) for s in sections for i in s['items']),
            'suppliedBodyPhrasePairs':sum(len(i['p']) for s in sections for i in s['items'])-len(INLINE_HEADINGS),
            'paratextParagraphs':len(paratext),'inlineHeadingTranslations':len(INLINE_HEADINGS),
            'paratextPhrasePairs':sum(len(p['p']) for p in paratext),'suppliedEnglishSectionHeadings':english_headings,
            'removedEnglishBracketCharacters':removed+sum(len(r['before'])-len(r['after']) for r in repairs)}
    pack={'schemaVersion':1,'book':BOOK,'sourceName':'מי השלוח, חלק א the rest.docx','sourceSha256':SOURCE_SHA256,
          'sourceDocumentXmlSha256':SOURCE_XML_SHA256,'sections':sections,'paratext':paratext,'counts':counts,
          'canonicalOrder':canonical_order,'canonicalSortKeys':{ref:canonical[canonical_alias(ref)]['sortKey'] for ref in canonical_order},
          'coverage':coverage}
    audit={'schemaVersion':1,'status':'NEEDS_REVIEW' if issues else 'PASS','sourceSha256':SOURCE_SHA256,
           'sourceDocumentXmlSha256':SOURCE_XML_SHA256,'counts':counts,'allSourceParagraphsAccountedFor':len(accounting)==len(rows),
           'sourceParagraphIndicesAreZeroBased':True,'sourceParagraphRowsSha256':SOURCE_ROWS_SHA256,
           'bodyCharacterPreservation':'Every supplied body character other than square brackets and whitespace is preserved in original interlinear order.',
           'bracketRepairs':repairs,'nestedEnglishBrackets':nested,'accounting':accounting,
           'canonicalComparisons':comparisons,'issues':issues,'canonicalParagraphSplits':splits,
           'headingCorrections':[{'ref':s['ref'],'sourceParagraphIndex':s['sourceHeadingParagraphIndex'],**s['headingCorrection']} for s in sections if s.get('headingCorrection')],
           'addedInlineHeadingTranslations':[{'sourceParagraphIndex':n,'he':rows[n]['text'],'en':en,'suppliedEnglish':False} for n,en in INLINE_HEADINGS.items()],
           'preservedSections':preserved,'canonicalOrder':canonical_order,'coverage':coverage,
           'canonicalEvidenceFile':str(VERIFICATION/'mei-canonical-api-snapshot.json.gz.b64'),
           'canonicalReferencesFile':str(VERIFICATION/'mei-canonical-references.json'),
           'canonicalVerifiedReferenceCount':len(references),
           'uploaded2005EditionComparison':edition_check,
           'uploaded2005EditionAuditFile':str(VERIFICATION/'mei-2005-edition-audit.json') if edition_check else None}
    args.pack.parent.mkdir(parents=True,exist_ok=True);args.audit.parent.mkdir(parents=True,exist_ok=True)
    args.pack.write_text(base64.b64encode(gzip.compress(json.dumps(pack,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)).decode()+'\n')
    args.audit.write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':audit['status'],'counts':counts,'issues':issues},ensure_ascii=False,indent=2))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--cache',type=Path,required=True)
    parser.add_argument('--pack',type=Path,default=Path('sources/akiva/overlays/mei-rest-document-20261022.json.gz.b64'))
    parser.add_argument('--audit',type=Path,default=Path('editorial/mei-rest-document-audit-20261022.json'))
    prepare(parser.parse_args())


if __name__=='__main__':
    main()

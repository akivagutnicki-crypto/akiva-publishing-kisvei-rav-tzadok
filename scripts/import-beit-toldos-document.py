"""Remove English bracket delimiters and retain every supplied Toldos phrase."""
import argparse
import base64
import gzip
import hashlib
import json
import re
import copy
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
VALUES = dict(zip('אבגדהוזחטיכלמנסעפצקרשת', [1,2,3,4,5,6,7,8,9,10,20,30,40,50,60,70,80,90,100,200,300,400]))
sha = lambda value: hashlib.sha256(value).hexdigest()
text_of = lambda p: ''.join(p.xpath('.//w:t/text()', namespaces=NS))
plain_he = lambda s: re.sub('[\u0591-\u05c7]', '', s)

def parse_paragraph(original, index):
    matches = list(re.finditer(r'\[([^\[\]]*)\]', original))
    assert len(matches) == original.count('[') == original.count(']'), ('Nested or unpaired brackets', index)
    cursor, pairs = 0, []
    for match in matches:
        he, en = original[cursor:match.start()].strip(), match[1].strip()
        assert re.search('[א-ת]', he) and re.search('[A-Za-z]', en), ('Invalid language pair', index, he, en)
        pairs.append([he, en]);cursor = match.end()
    tail = original[cursor:]
    assert not tail.strip() or (pairs and not re.search(r'[A-Za-zא-ת0-9\[\]]', tail)), ('Untranslated trailing text', index, tail)
    if tail.strip():pairs[-1][1] += tail.strip()
    clean = original.replace('[', '').replace(']', '')
    assert re.sub(r'\s', '', ''.join(x for pair in pairs for x in pair)) == re.sub(r'\s', '', clean)
    return pairs, clean

def prepare(source, output, pack_path, supplement=None, recovered=None):
    raw = source.read_bytes()
    sections, excluded, current = [], [], None
    with ZipFile(source) as z:
        root = etree.fromstring(z.read('word/document.xml'))
        paragraphs = root.xpath('//w:body/w:p', namespaces=NS)
        for index, paragraph in enumerate(paragraphs):
            original = text_of(paragraph)
            if not original.strip():
                continue
            heading = re.fullmatch(r'תולדות,\s*אות\s+([א-ת׳״\x27\x22]+)', plain_he(original).strip())
            if heading:
                number = sum(VALUES.get(ch, 0) for ch in heading[1])
                current = {'chapter': number, 'sourceHeading': original, 'items': []}
                sections.append(current)
                continue
            if original.startswith('להלן תרגום בין-טורי'):
                excluded.append({'paragraphIndex': index, 'text': original, 'reason': 'Chat introduction, not the sefer text'})
                paragraph.getparent().remove(paragraph)
                continue
            assert current is not None, ('Unassigned source paragraph', index)
            pairs, clean = parse_paragraph(original, index)
            current['items'].append({'n': len(current['items']) + 1, 'p': pairs, 'sourceText': clean})
        if supplement:
            additions=[];current=None
            for block in re.split(r'\n\s*\n', supplement.read_text().strip()):
                block=block.strip()
                if not block:continue
                if block.startswith('###'):
                    heading=re.sub(r'^#+\s*','',block).replace('**','')
                    match=re.fullmatch(r'תולדות,\s*אות\s+([א-ת׳״\x27\x22]+)',plain_he(heading))
                    assert match,heading
                    current={'chapter':sum(VALUES.get(ch,0) for ch in match[1]),'sourceHeading':heading,'items':[]}
                    additions.append(current)
                else:
                    assert current is not None
                    original=block.replace('**','')
                    pairs,clean=parse_paragraph(original,'supplement')
                    current['items'].append({'n':len(current['items'])+1,'p':pairs,'sourceText':clean})
            assert [s['chapter'] for s in additions]==[16,17,18,19]
            if recovered:
                restored=json.loads(recovered.read_text())
                assert restored['chapter']==15
                for item in restored['items']:
                    item['sourceText']=' '.join(he+' '+en for he,en in item['p'])
                additions.insert(0,restored)
            first20=next(p for p in root.xpath('//w:body/w:p',namespaces=NS) if plain_he(text_of(p)).strip()=='תולדות, אות כ׳')
            head_template=next(p for p in root.xpath('//w:body/w:p',namespaces=NS) if p.xpath('./w:pPr/w:pStyle',namespaces=NS))
            for section in additions:
                for text,is_heading in [(section['sourceHeading'],True)]+[(i['sourceText'],False) for i in section['items']]:
                    new=etree.Element('{'+NS['w']+'}p')
                    if is_heading and head_template.find('w:pPr',NS) is not None:new.append(copy.deepcopy(head_template.find('w:pPr',NS)))
                    run=etree.SubElement(new,'{'+NS['w']+'}r');node=etree.SubElement(run,'{'+NS['w']+'}t');node.text=text
                    first20.addprevious(new)
            sections=sorted(sections+additions,key=lambda s:s['chapter'])
        numbers = list(range(1,53)) if recovered else list(range(1,15)) + list(range(16 if supplement else 20,53))
        assert [s['chapter'] for s in sections] == numbers
        assert all(s['items'] for s in sections)
        before = ''.join(text_of(p) for p in root.xpath('//w:body/w:p', namespaces=NS))
        bracket_count = before.count('[') + before.count(']') + ((supplement.read_text().count('[')+supplement.read_text().count(']')) if supplement else 0)
        for node in root.xpath('//w:t', namespaces=NS):
            if node.text:
                node.text = node.text.replace('[', '').replace(']', '')
        after = ''.join(text_of(p) for p in root.xpath('//w:body/w:p', namespaces=NS))
        assert before.replace('[', '').replace(']', '') == after
        output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output, 'w') as out:
            for entry in z.infolist():
                body = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True) if entry.filename == 'word/document.xml' else z.read(entry.filename)
                out.writestr(entry, body)
    paragraphs = [item for section in sections for item in section['items']]
    pairs = sum(len(item['p']) for item in paragraphs)
    clean_bytes = output.read_bytes()
    pack = {'schemaVersion': 1, 'book': 'Beit Yaakov on Torah', 'parashah': 'Toldot',
        'source': {'name': source.name, 'sha256': sha(raw), 'cleanedSha256': sha(clean_bytes),
            'bodyTextSha256': sha(''.join(item['sourceText'] for item in paragraphs).encode()),
            'sections': len(sections), 'paragraphs': len(paragraphs), 'phrasePairs': pairs,
            'bracketCharactersRemoved': bracket_count, 'absentSectionNumbers': [] if recovered else [15] if supplement else [15,16,17,18,19],
            'excludedChatIntroductions': excluded},
        'supplement': {'name':supplement.name,'sha256':sha(supplement.read_bytes())} if supplement else None,
        'recoveredSection': {'name':recovered.name,'sha256':sha(recovered.read_bytes()),'chapter':15,'source':'Sefaria Hebrew, original English interlinear translation'} if recovered else None,
        'document': {'file': 'downloads/beit-yaakov-toldos-interlinear.docx', 'label': 'Toldos · Interlinear Word edition',
            'sha256': sha(clean_bytes), 'base64': base64.b64encode(clean_bytes).decode()}, 'sections': sections}
    encoded = json.dumps(pack, ensure_ascii=False, separators=(',', ':')).encode()
    pack_path.parent.mkdir(parents=True, exist_ok=True)
    pack_path.write_text(base64.b64encode(gzip.compress(encoded, mtime=0)).decode()+'\n')
    print(json.dumps({**{k:v for k,v in pack['source'].items() if k != 'excludedChatIntroductions'},
        'excludedChatIntroductions': len(excluded), 'packSha256': sha(pack_path.read_bytes()), 'output': str(output)}, ensure_ascii=False))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pack', type=Path, required=True)
    parser.add_argument('--supplement', type=Path)
    parser.add_argument('--recovered', type=Path)
    args = parser.parse_args()
    prepare(args.source, args.output, args.pack, args.supplement, args.recovered)

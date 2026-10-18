#!/usr/bin/env python3
"""Assemble the checked Pri Shabbos reader overlay without publishing it.

Inputs are the verified neutral phrase-pair extraction, the reviewed canonical
paragraph mapping, and the exact final Word file. No translation, source lookup,
HTML rewriting, or repository publication is performed here.

Example, from the repository root:
  python scripts/import-pri-shabbos.py \
    --pairs ../analysis/reader_docx_pairs.json \
    --mapping ../analysis/reader_canonical_mapping.json \
    --docx ../output/Peri_Tzaddik_Kedushat_Shabbat_and_Shevitat_Shabbat_Merged.docx

The output uses compact, sorted JSON and a gzip stream with no filename or
creation timestamp. --check verifies the existing package without writing it.
The caller can validate the result through readShabbos() in the publisher module.
"""
from __future__ import annotations

import argparse
import base64
import collections
import gzip
import hashlib
import io
import json
import re
from html.parser import HTMLParser
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPOSITORY / 'sources/akiva/overlays/pri-shabbos.json.gz.b64'
SOURCE_SHA = '4b6b53ff3490275c0a11a6a3ed78cfc38106234f9db731913ea36708fe18674d'
DOCUMENT_FILE = 'downloads/pri-tzaddik-kedushas-shabbos-kuntres-shevisas-shabbos-interlinear.docx'
DOCUMENT_LABEL = 'Kedushas Shabbos and Kuntres Shevisas Shabbos · Complete Word edition'
EXPECTED_SHAPES = [[9], [3], [8, 8, 9, 12, 9, 9, 33], [14, 7, 1, 2, 11, 9, 6]]
# ECMAScript whitespace, matching the publisher's compact() implementation.
WHITESPACE = re.compile('[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')

NODE_SPECS = [
    {
        'ref': 'Peri Tzadik, Title', 'title': 'Original Title Page',
        'he': 'שער', 'heRef': 'פרי צדיק, שער', 'depth': 1,
        'sourceUrl': 'https://www.sefaria.org/Peri_Tzadik,_Title',
        'book_id': None, 'heading_docx_index': 21,
    },
    {
        'ref': 'Peri Tzadik, Introduction', 'title': 'Publishers Introduction',
        'he': 'הקדמה', 'heRef': 'פרי צדיק, הקדמה', 'depth': 1,
        'sourceUrl': 'https://www.sefaria.org/Peri_Tzadik,_Introduction',
        'book_id': None, 'heading_docx_index': 23,
    },
    {
        'ref': 'Peri Tzadik, Sefer Kedushat Shabbat',
        'title': 'Kedushas Shabbos — The Sanctity of Shabbos',
        'he': 'ספר קדושת שבת', 'heRef': 'פרי צדיק, ספר קדושת שבת', 'depth': 2,
        'book_id': 'kedushas-shabbos', 'heading_docx_index': 25,
    },
    {
        'ref': 'Peri Tzadik, Kuntres Shvitat Shabbat',
        'title': 'Kuntres Shevisas Shabbos — The Laws of Shabbos Rest',
        'he': 'קונטרס שביתת שבת', 'heRef': 'פרי צדיק, קונטרס שביתת שבת', 'depth': 2,
        'book_id': 'kuntres-shevisas-shabbos', 'heading_docx_index': 654,
    },
]


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def compact(value):
    return WHITESPACE.sub('', value)


class PairHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text = []
        self.anchors = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        assert tag in ('a', 'span'), ('Unexpected HTML element', tag)
        if tag == 'a':
            assert set(values) == {'href', 'data-ref'}
            assert values['href'].startswith('https://www.sefaria.org/')
            assert values['data-ref'].strip()
            self.anchors.append(values)
        else:
            assert set(values) == {'lang', 'dir'}
            assert values['lang'] in ('he', 'en')
            assert values['dir'] == ('rtl' if values['lang'] == 'he' else 'ltr')
        self.stack.append(tag)

    def handle_endtag(self, tag):
        assert self.stack and self.stack.pop() == tag

    def handle_data(self, text):
        self.text.append(text)


def inspect_html(value):
    parser = PairHTML()
    parser.feed(value)
    parser.close()
    assert not parser.stack
    return ''.join(parser.text), parser.anchors


def compress_json(pack):
    plain = json.dumps(pack, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()
    stream = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=stream, compresslevel=9, mtime=0) as archive:
        archive.write(plain)
    return plain, stream.getvalue()


def assemble(pairs_path, mapping_path, document_path):
    pair_data = read_json(pairs_path)
    mapping = read_json(mapping_path)
    document_bytes = document_path.read_bytes()
    assert sha256(document_bytes) == SOURCE_SHA, 'The downloadable Word file must be the checked final edition'
    assert pair_data['source']['docx_sha256'] == mapping['source_docx_sha256'] == SOURCE_SHA
    assert mapping['status'] == 'completed' and not mapping['issues']
    assert mapping['canonical_work_passages'] == 138 and mapping['canonical_shared_front_matter_passages'] == 12
    paragraphs = pair_data['paragraphs']
    assert len(paragraphs) == 661
    paragraph_by_id = {paragraph['id']: paragraph for paragraph in paragraphs}
    assert len(paragraph_by_id) == len(paragraphs)
    headings = pair_data['headings']
    heading_by_id = {heading['id']: heading for heading in headings}
    heading_by_index = {heading['docx_paragraph_index']: heading for heading in headings}
    assert len(headings) == 220
    topical_ids = [heading['id'] for heading in headings if heading['level'] == 3]
    assert len(topical_ids) == 202
    assert [heading_id for paragraph in paragraphs for heading_id in paragraph['inline_headings_before']] == topical_ids
    source_links = {(item['book_id'], item['ois']): item for item in pair_data['source_links']}
    assert len(source_links) == 14
    groups = {group['section_ref']: group for group in mapping['groups']}
    assert len(groups) == 16

    expected_pairs = [(paragraph['docx_paragraph_index'], pair['id']) for paragraph in paragraphs for pair in paragraph['pairs']]
    assert len(expected_pairs) == 9468
    used_pairs, heading_placements, normalizations, represented_headings, cuts = [], [], [], [], []
    source_reconstructed = collections.OrderedDict()
    paragraph_link_counts = collections.Counter()
    nodes = []
    body_links = 0
    original_paragraph_breaks = 0

    for spec in NODE_SPECS:
        node = {key: value for key, value in spec.items() if key not in ('book_id', 'heading_docx_index')}
        book_id = spec['book_id']
        node_heading = heading_by_index[spec['heading_docx_index']]
        assert node_heading['level'] in (1, 2) and node_heading['link_count'] == 0
        represented_headings.append({
            'docxParagraphIndex': node_heading['docx_paragraph_index'],
            'sourceText': node_heading['sourceText'], 'representation': 'nodeTitle',
            'nodeRef': node['ref'], 'readerTitle': node['title'],
        })
        if node['depth'] == 2:
            first_source = source_links[book_id, 1]['link_occurrences']
            assert len(first_source) == 1 and first_source[0]['data_ref'] == node['ref'] + ' 1'
            assert first_source[0]['href'].endswith('.1')
            node['sourceUrl'] = first_source[0]['href'][:-2]
        node['chapters'] = []
        for number in range(1, 2 if node['depth'] == 1 else 8):
            section_ref = node['ref'] if node['depth'] == 1 else f'{node["ref"]} {number}'
            group = groups[section_ref]
            assert group['book_id'] == book_id
            if node['depth'] == 1:
                chapter_title, source_url = node['title'], node['sourceUrl']
            else:
                chapter_heading = next(heading for heading in headings if heading['role'] == 'ois_title' and heading['book_id'] == book_id and heading['ois'] == number)
                assert chapter_heading['level'] == 2 and chapter_heading['link_count'] == 0
                chapter_title = chapter_heading['sourceText']
                link = source_links[book_id, number]['link_occurrences']
                assert len(link) == 1 and link[0]['data_ref'] == section_ref
                source_url = link[0]['href']
                assert source_url == node['sourceUrl'] + '.' + str(number)
                represented_headings.append({
                    'docxParagraphIndex': chapter_heading['docx_paragraph_index'],
                    'sourceText': chapter_heading['sourceText'], 'representation': 'chapterTitle',
                    'nodeRef': node['ref'], 'chapterNumber': number, 'readerTitle': chapter_title,
                })
            chapter = {'number': number, 'title': chapter_title, 'sourceUrl': source_url, 'items': []}
            assert [segment['n'] for segment in group['segments']] == list(range(1, group['canonical_segment_count'] + 1))
            for segment in group['segments']:
                expected_ref = section_ref + (' ' if node['depth'] == 1 else ':') + str(segment['n'])
                assert segment['ref'] == expected_ref
                item = {'n': segment['n'], 'p': [], 'sourceParagraphs': [], 'keepPairs': True, 'paragraphBreaks': [], 'inlineHeadings': []}
                piece_pair_counts = []
                for piece in segment['pieces']:
                    paragraph = paragraph_by_id[piece['fragment_id']]
                    docx_index = paragraph['docx_paragraph_index']
                    assert docx_index == piece['docx_paragraph_index']
                    assert paragraph['book_id'] == book_id
                    if node['depth'] == 2:
                        assert paragraph['ois'] == number
                        assert piece['whole_fragment'] and piece['start'] == 0 and piece['end'] == len(paragraph['sourceText'])
                    else:
                        assert docx_index in (22, 24)
                    boundaries = {pair['source_start']: index for index, pair in enumerate(paragraph['pairs'])}
                    boundaries[len(paragraph['sourceText'])] = len(paragraph['pairs'])
                    assert piece['start'] in boundaries and piece['end'] in boundaries, ('Canonical cut is not a phrase-pair boundary', piece)
                    first, last = boundaries[piece['start']], boundaries[piece['end']]
                    selected = paragraph['pairs'][first:last]
                    assert selected
                    assert selected[0]['source_start'] == piece['start'] and selected[-1]['source_end'] == piece['end']
                    piece_text = ''.join(pair['heText'] + pair['enText'] for pair in selected)
                    assert piece_text == paragraph['sourceText'][piece['start']:piece['end']]
                    if first:
                        assert node['depth'] == 1
                        cuts.append({'docxParagraphIndex': docx_index, 'textOffset': piece['start'], 'phraseIndex': first, 'nextCanonicalRef': expected_ref})
                    phrase_index = len(item['p'])
                    if phrase_index and item['sourceParagraphs'][-1] != docx_index:
                        item['paragraphBreaks'].append(phrase_index)
                        original_paragraph_breaks += 1
                    if first == 0:
                        for heading_id in paragraph['inline_headings_before']:
                            heading = heading_by_id[heading_id]
                            assert heading['level'] == 3 and heading['link_count'] == 0
                            original_label = heading['sourceText']
                            label = re.sub(r'^Paragraph\s+\d+\s+', '', original_label, count=1)
                            assert label and not re.search('[א-ת]', label)
                            item['inlineHeadings'].append({'phraseIndex': phrase_index, 'text': label})
                            placement = {'docxParagraphIndex': heading['docx_paragraph_index'], 'canonicalRef': expected_ref, 'phraseIndex': phrase_index, 'text': label}
                            heading_placements.append(placement)
                            if label != original_label:
                                normalizations.append({**placement, 'sourceText': original_label, 'rule': 'Removed only the leading Paragraph N label'})
                    for pair in selected:
                        assert pair['source_start'] < pair['source_end']
                        he_text, he_links = inspect_html(pair['he'])
                        en_text, en_links = inspect_html(pair['en'])
                        assert re.search('[א-ת]', he_text) and re.search('[A-Za-z]', en_text)
                        assert he_text == pair['heText'] and en_text == pair['enText']
                        assert len(he_links) + len(en_links) == pair['link_count']
                        for link in he_links + en_links:
                            assert pair_data['references'][link['href']]['data_ref'] == link['data-ref']
                        item['p'].append([pair['he'], pair['en']])
                        item['sourceParagraphs'].append(docx_index)
                        used_pairs.append((docx_index, pair['id']))
                        source_reconstructed[docx_index] = source_reconstructed.get(docx_index, '') + he_text + en_text
                        body_links += pair['link_count']
                        paragraph_link_counts[docx_index] += pair['link_count']
                    piece_pair_counts.append(len(selected))
                expected_breaks = [sum(piece_pair_counts[:index + 1]) for index in segment['original_docx_paragraph_breaks_after_piece_indices']]
                assert item['paragraphBreaks'] == expected_breaks
                assert all(0 < index < len(item['p']) for index in item['paragraphBreaks'])
                assert item['inlineHeadings'] == sorted(item['inlineHeadings'], key=lambda heading: heading['phraseIndex'])
                assert all(0 <= heading['phraseIndex'] < len(item['p']) for heading in item['inlineHeadings'])
                chapter['items'].append(item)
            node['chapters'].append(chapter)
        nodes.append(node)

    assert used_pairs == expected_pairs, 'All original phrase pairs must occur exactly once in exact document order'
    assert [entry['docxParagraphIndex'] for entry in heading_placements] == [heading['docx_paragraph_index'] for heading in headings if heading['level'] == 3]
    assert sorted(entry['docxParagraphIndex'] for entry in represented_headings) == sorted(heading['docx_paragraph_index'] for heading in headings if heading['level'] != 3)
    assert len(heading_placements) == 202 and len(represented_headings) == 18
    assert len(normalizations) == 21 and len(cuts) == 10
    assert body_links == 2789
    assert [[len(chapter['items']) for chapter in node['chapters']] for node in nodes] == EXPECTED_SHAPES
    assert list(source_reconstructed) == [paragraph['docx_paragraph_index'] for paragraph in paragraphs]
    source_paragraphs = []
    for paragraph in paragraphs:
        docx_index = paragraph['docx_paragraph_index']
        assert source_reconstructed[docx_index] == paragraph['sourceText'], ('Source text changed', docx_index)
        assert paragraph_link_counts[docx_index] == paragraph['link_count'], ('Source links changed', docx_index)
        source_paragraphs.append({'index': docx_index, 'compactSha256': sha256(compact(paragraph['sourceText']).encode())})
    body_sha = sha256(''.join(paragraph['sourceText'] for paragraph in paragraphs).encode())
    assert body_sha == mapping['validation']['body_text_sha256']

    return {
        'book': 'Peri Tzadik', 'schemaVersion': 1,
        'source': {'filename': document_path.name, 'sha256': SOURCE_SHA, 'bodyTextSha256': body_sha, 'paragraphs': source_paragraphs},
        'nodes': nodes,
        'counts': {'phrasePairs': 9468, 'bodyHyperlinks': 2789, 'inTextHeadings': 202},
        'document': {'file': DOCUMENT_FILE, 'label': DOCUMENT_LABEL, 'base64': base64.b64encode(document_bytes).decode()},
        'audit': {
            'assembler': 'scripts/import-pri-shabbos.py',
            'inputSha256': {'phrasePairs': sha256(pairs_path.read_bytes()), 'canonicalMapping': sha256(mapping_path.read_bytes()), 'document': SOURCE_SHA},
            'canonicalWorkParagraphs': 138, 'canonicalFrontMatterParagraphs': 12,
            'originalWordBodyParagraphs': 661, 'originalWordHeadings': 220,
            'inTextHeadings': 202, 'nodeAndChapterHeadings': 18,
            'paragraphBreaks': original_paragraph_breaks,
            'frontMatterPhraseCuts': cuts,
            'headingNormalizations': normalizations,
            'inlineHeadingPlacements': heading_placements,
            'headingsRepresentedByTitles': represented_headings,
            'inlineHebrewTermsInEnglish': 9,
            'allSourceTextPreservedExactly': True,
            'allBodyLinksPreservedExactlyOnce': True,
            'allOriginalParagraphBoundariesPreserved': True,
            'contentsEntriesNotRepeatedInBody': True,
            'compression': {'format': 'gzip', 'level': 9, 'mtime': 0, 'filename': '', 'jsonKeysSorted': True},
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pairs', type=Path, required=True, help='Verified reader_docx_pairs.json')
    parser.add_argument('--mapping', type=Path, required=True, help='Reviewed reader_canonical_mapping.json')
    parser.add_argument('--docx', type=Path, required=True, help='Exact final merged DOCX')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--check', action='store_true', help='Compare to the existing deterministic package without writing')
    args = parser.parse_args()
    pack = assemble(args.pairs, args.mapping, args.docx)
    plain, compressed = compress_json(pack)
    encoded = base64.b64encode(compressed).decode() + '\n'
    assert json.loads(gzip.decompress(compressed)) == pack
    if args.check:
        assert args.output.read_text() == encoded, 'Existing package differs from deterministic reconstruction'
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    print(json.dumps({
        'output': str(args.output), 'checkOnly': args.check,
        'jsonBytes': len(plain), 'compressedBytes': len(compressed), 'base64FileBytes': len(encoded.encode()),
        'packageSha256': sha256(compressed), 'jsonSha256': sha256(plain),
        'sourceDocxSha256': SOURCE_SHA,
        'counts': pack['counts'], 'nodes': len(pack['nodes']),
        'chapters': sum(len(node['chapters']) for node in pack['nodes']),
        'canonicalParagraphs': sum(len(chapter['items']) for node in pack['nodes'] for chapter in node['chapters']),
        'originalWordParagraphBreaks': pack['audit']['paragraphBreaks'],
        'frontMatterPhraseCuts': len(pack['audit']['frontMatterPhraseCuts']),
        'normalizedHeadingLabels': len(pack['audit']['headingNormalizations']),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

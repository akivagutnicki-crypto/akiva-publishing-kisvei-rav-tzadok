#!/usr/bin/env python3
"""Check every Word text character, native note, hyperlink and Hebrew anchor of the Daled Parshiyos and Purim edition.

A clone of scripts/pri-bereishis/verify.py for one volume. The anchor proof uses the original XML text/marker stream,
without the importer's run-language classification. It also holds the notes to the house rules: English notes (a few
quoted Hebrew words inside an English note are allowed), Sefaria links in their canonical form, and no mention of
HaMafteach or of a modern annotated edition. With a site directory it checks the reader chapters, both downloads and
the MCP text; with --archives, the offline ZIPs.
"""
import html
import importlib.util
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('purim_build', Path(__file__).with_name('build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
rd = B.read_json; W = B.W; NS = B.NS
KEY = 'purimDocxEdition'
SECTIONS = 69
FORBIDDEN = re.compile(r'Mafteach|מפתח השלם|Machon|annotated edition|Oz VeHadar|Akiva Publishing|Kisvei', re.I)
def tight(s): return re.sub(r'\s', '', s)
def plain(s): return html.unescape(re.sub('<[^>]*>', '', s))

def verify(site=None, archives=False):
    m = rd(B.OUTPUT/'manifest.json'); total_notes = 0; total_pairs = 0; total_heads = 0; subheads = 0
    assert m['footnotes'] == B.EXPECTED_NOTES and len(m['parashas']) == 9 and len(m['sections']) == SECTIONS
    v = m['volumes'][0]
    assert B.digest(B.SOURCE/v['file']) == v['sha256'] and B.digest(B.SOURCE/v['pdf']) == v['pdfSha256']
    assert v['pdfBytes'] <= 10_000_000 and v['bytes'] <= 10_000_000, 'Download over 10 MB'
    # every maamar is the library's original-Hebrew ref
    valid = {l.strip() for l in open('sources/mafteach/library-refs.txt', encoding='utf-8') if l.strip()}
    assert all(s['ref'] in valid for s in m['sections']), [s['ref'] for s in m['sections'] if s['ref'] not in valid]
    with ZipFile(B.SOURCE/v['file']) as z:
        native = ET.fromstring(z.read('word/document.xml')); note_xml = ET.fromstring(z.read('word/footnotes.xml'))
        ps = list(native.find('w:body', NS))
        original_notes = {n.get(W+'id'): n for n in note_xml if int(n.get(W+'id', '0')) > 0 and not n.get(W+'type')}
        expected_rel = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('word/_rels/footnotes.xml.rels'))}
        covered = set(m['printFrontMatter']) | {g['sourceParagraph'] for g in m['groupHeadings']}
        seen = set(); numbers = []
        for sec in m['sections']:
            local = rd(B.OUTPUT/f"{sec['id']}.json")
            if site: assert rd(Path(site)/f"library/data/peri-tzadik/{sec['id']}.json") == local, 'Published chapter differs: ' + sec['ref']
            ns = [it['n'] for it in local if 'p' in it]
            assert ns == list(range(1, len(ns)+1)) == list(range(1, sec['paragraphs']+1)), sec['ref']
            for item in local:
                i = item['sourceParagraph']; assert i not in covered; covered.add(i)
                raw = ps[i]; source_text = ''.join(n.text or '' for n in raw.iter(W+'t'))
                if 'h' in item: assert item['h'] == source_text; total_heads += 1; continue
                pairs = [[plain(h), plain(e)] for h, e in item['p']]
                assert all(h.strip() and e.strip() for h, e in pairs), (sec['ref'], i, 'Unpaired translation')
                assert tight(B.BIDI.sub('', source_text)) == tight(''.join(h+e for h, e in pairs)) or \
                       tight(source_text) == tight(''.join(h+e for h, e in pairs)), (sec['ref'], i, 'Text changed')
                if item.get('subheading'): subheads += 1; total_pairs += len(pairs); continue
                total_pairs += len(pairs)
                stream = ''; markers = {}
                for el in raw.iter():
                    if el.tag == W+'t': stream += el.text or ''
                    elif el.tag == W+'footnoteReference': markers[el.get(W+'id')] = len(tight(stream))
                assert set(markers) == {n['wordFootnoteId'] for n in item.get('footnotes', [])}
                for note in item.get('footnotes', []):
                    fid = note['wordFootnoteId']; assert fid not in seen; seen.add(fid)
                    numbers.append(note['number']); total_notes += 1
                    pi = note['phraseIndex']; prefix = note['heAnchorPrefix']; he = pairs[pi][0]; at = note['heCharOffset']
                    assert at > 0 and he[:at] == prefix and re.search('[א-ת]', prefix), (sec['ref'], fid, 'Hebrew anchor')
                    position = markers[fid]; walk = 0; found = None
                    for k, (h, e) in enumerate(pairs):
                        end_he = walk + len(tight(h)); end_pair = end_he + len(tight(e))
                        if position <= end_pair: found = (k, min(len(tight(h)), position - walk)); break
                        walk = end_pair
                    assert found == (pi, len(tight(prefix))), (sec['ref'], fid, 'Word marker moved', found, pi)
                    original = original_notes[fid]
                    original_text = '\n'.join(''.join(t.text or '' for t in p.iter(W+'t')) for p in original.findall('w:p', NS))
                    imported = '\n'.join(p['text'] for p in note['paragraphs'])
                    assert tight(original_text) == tight(imported), (sec['ref'], fid, 'Note text changed')
                    original_urls = [expected_rel[a.get(B.R+'id')] for a in original.iter(W+'hyperlink') if a.get(B.R+'id') in expected_rel]
                    actual_urls = [r['href'] for p in note['paragraphs'] for r in p['rich'] if r.get('href')]
                    assert list(dict.fromkeys(original_urls)) == list(dict.fromkeys(actual_urls)), (sec['ref'], fid, 'Source URL changed')
                    assert all(re.fullmatch(r'https://www\.sefaria\.org/\S+', u) for u in actual_urls), (sec['ref'], fid, 'Non-Sefaria link')
                    for p in note['paragraphs']: assert p['text'] == ''.join(r['text'] for r in p['rich'])
                    # English notes: Hebrew letters only as short quoted words inside the English
                    he_letters = len(re.findall('[א-ת]', imported)); en_letters = len(re.findall('[A-Za-z]', imported))
                    assert en_letters > 5 * he_letters, (sec['ref'], fid, 'Footnote is not English')
                    assert not FORBIDDEN.search(imported), (sec['ref'], fid, 'Footnote names HaMafteach or a modern edition')
        assert seen == set(original_notes)
        assert numbers == list(range(1, B.EXPECTED_NOTES+1)), 'Word reading-order numbering changed'
        relevant = {i for i, p in enumerate(ps) if p.tag == W+'p' and ''.join(t.text or '' for t in p.iter(W+'t')).strip()}
        assert covered == relevant, 'Source paragraph or heading was omitted: ' + str(sorted(relevant - covered)[:5])
    assert total_heads + subheads == len(m['sourceHeadings']) and subheads == len(B.ALIGNED_SUBHEADS)
    assert total_notes == B.EXPECTED_NOTES and total_pairs == m['pairs']
    if site:
        site = Path(site)
        for name, digest in ((v['download'], v['sha256']), (v['pdf'], v['pdfSha256'])):
            assert B.digest(site/'library/downloads'/name) == digest, 'Download differs: ' + name
        toc = rd(site/'library/data/peri-tzadik/toc.json')
        def leaves(x): return sum((leaves(c) for c in x['children']), []) if 'children' in x else [x]
        published = leaves(toc['toc'])
        for sec in m['sections']:
            found = [l for l in published if l.get('ref') == sec['ref'] and l.get('interlinear')]
            assert len(found) == 1 and found[0]['id'] == sec['id'] and found[0]['shape'] == sec['paragraphs'], sec['ref']
        cat = rd(site/'mcp-data/catalog.json'); book = next(b for b in cat['books'] if b['slug'] == 'peri-tzadik')
        text = rd(site/'mcp-data/text/peri-tzadik.json')
        for sec in m['sections']:
            sc = [s for s in book['sections'] if s['ref'] == sec['ref'] and s.get(KEY)]
            assert len(sc) == 1, sec['ref']; sc = sc[0]
            assert not [s for s in book['sections'] if s['ref'] == sec['ref'] and s.get('edition') == 'interlinear' and not s.get(KEY)], 'Earlier study chapter still listed: ' + sec['ref']
            paras = text['paras'][sc['first']:sc['first']+sc['count']]
            assert len(paras) == sec['paragraphs'] and all(p['r'].startswith(sec['ref']+':') for p in paras)
            assert sum(len(p.get('f', [])) for p in paras) == sec['notes']
        if archives:
            data = site/'library/data'; files = rd(data/'files.json'); index = rd(site/'library/downloads/index.json')
            assert files['version'] == index['version']
            for entry in [index['library'], next(b for b in index['books'] if b['slug'] == 'peri-tzadik')]:
                file = site/'library'/entry['file']; assert file.stat().st_size == entry['bytes']
                with ZipFile(file) as z:
                    assert z.testzip() is None
                    assert len([n for n in z.namelist() if n.startswith('data/')]) == entry['dataFiles']
                    for sec in m['sections']:
                        assert z.read(f"data/peri-tzadik/{sec['id']}.json") == (data/'peri-tzadik'/f"{sec['id']}.json").read_bytes()
                    assert z.read('downloads/'+v['download']) == (B.SOURCE/v['file']).read_bytes()
                    assert z.read('downloads/'+v['pdf']) == (B.SOURCE/v['pdf']).read_bytes()
                    if entry is index['library']:
                        for n in files['files']+['files.json']: assert z.read('data/'+n) == (data/n).read_bytes(), 'Library ZIP differs: ' + n
    result = {'ok': True, 'edition': m['edition'], 'sections': SECTIONS, 'groups': 9, 'headings': total_heads,
              'alignedSubheadings': subheads, 'paragraphs': m['paragraphs'], 'pairs': total_pairs, 'footnotes': total_notes,
              'allWordTextAndAnchorsVerified': True}
    print(json.dumps(result)); return result

if __name__ == '__main__': verify(next((x for x in sys.argv[1:] if not x.startswith('--')), None), '--archives' in sys.argv)

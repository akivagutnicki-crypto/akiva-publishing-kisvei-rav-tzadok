#!/usr/bin/env python3
"""Import the finished Pri Tzaddik "Daled Parshiyos and Purim" Word volume (KDP 7x10), with nested bidi runs and native notes.

A clone of scripts/pri-bereishis/build.py for one volume. No translation, source wording or footnote placement is
generated here: the Word XML is the publication source. Native note ids and the source paragraph index are kept so
verify.py can check the complete transfer independently.

Structure of the Word file: title and front matter (kept in the downloads, not in the reader), then one cover page
(Heading1) per section, one Heading2 per maamar. Each maamar is mapped to the library's original-Hebrew ref
(SECTIONS below). A Heading3 inside a maamar (מכתי"ק, לראש חודש אדר ראשון, אחר הבדלה) is its own paragraph where the
library's Hebrew has it as one (ALIGNED_SUBHEADS), so the study edition's paragraph numbers line up with the original.
"""
import hashlib
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

SOURCE = Path('sources/akiva/pri-purim-20261112')
OUTPUT = Path('sources/akiva/overlays/pri-purim-20261112')
EDITION = 'pri-purim-docx-20261112-v1'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
W = '{' + NS['w'] + '}'
R = '{' + NS['r'] + '}'
FIRST_ID = 4000            # Shemos 3000–3147, Bereishis 3400–3549, Moadim 3600–3799
FILE = 'pri-tzaddik-daled-parshiyos-and-purim.docx'
PDF = 'pri-tzaddik-daled-parshiyos-and-purim.pdf'
EXPECTED_NOTES = 1465
LABEL = 'Daled Parshiyos and Purim'
HE_LABEL = 'ארבע פרשיות ופורים'
# Word section (English, as on the cover page) -> the library's section name
SECTIONS = {'Parshas Shekalim': 'Parshat Shekalim', 'Rosh Chodesh Adar': 'Rosh Chodesh Adar',
            'For the Fourteenth of Adar Rishon': 'Purim Katan', 'Rosh Chodesh Adar Sheni': 'Rosh Chodesh Adar II',
            'Parshas Zachor': 'Parshat Zachor', 'Purim': 'Purim', 'Shushan Purim': 'Shushan Purim',
            'Parshas Parah': 'Parshat Parah', 'Parshas HaChodesh': 'Parshat HaChodesh'}
# Heading3 lines that are a paragraph of their own in the library's Hebrew (ref: its paragraph number there)
ALIGNED_SUBHEADS = {'Peri Tzadik, Parshat Shekalim 1': 1, 'Peri Tzadik, Rosh Chodesh Adar 10': 1, 'Peri Tzadik, Parshat Parah 7': 2}
BIDI = re.compile('[\u200e\u200f\u202a-\u202e]')
NUMBERS = ['Aleph', 'Bais', 'Gimmel', 'Daled', 'Hei', 'Vav', 'Zayin', 'Ches',
           'Tes', 'Yud', 'Yud Aleph', 'Yud Bais', 'Yud Gimmel', 'Yud Daled',
           'Tes Vav', 'Tes Zayin', 'Yud Zayin']

def read_json(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def write_json(p, value):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
def text_of(e): return ''.join(x.text or '' for x in e.iter(W + 't'))
def truth(e): return e is not None and e.get(W + 'val', '1') not in ('0', 'false', 'off')
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rels(z, part):
    name = 'word/_rels/' + part + '.rels'
    if name not in z.namelist(): return {}
    return {e.get('Id'): e.get('Target') for e in ET.fromstring(z.read(name))}

def runs(e, relationships, href=None):
    if e.tag == W + 'hyperlink': href = relationships.get(e.get(R + 'id'))
    if e.tag == W + 'r':
        yield e, href
    elif e.tag != W + 'del':
        for child in e: yield from runs(child, relationships, href)

def run_language(run, fallback='he'):
    pr = run.find('w:rPr', NS)
    if pr is not None:
        rtl = pr.find('w:rtl', NS)
        if rtl is not None: return 'he' if truth(rtl) else 'en'
        lang = pr.find('w:lang', NS)
        if lang is not None:
            val = lang.get(W + 'val', '')
            if val.startswith('he'): return 'he'
            if val.startswith('en'): return 'en'
    t = text_of(run)
    if re.search('[א-ת]', t) and not re.search('[A-Za-z]', t): return 'he'
    if re.search('[A-Za-z]', t): return 'en'
    return fallback

def note_paragraph(p, relationships):
    rich = []
    for run, href in runs(p, relationships):
        t = ''.join((x.text or '') if x.tag == W + 't' else '\n' if x.tag == W + 'br' else '\t' if x.tag == W + 'tab' else '' for x in run)
        if not t: continue
        v = {'text': t}
        pr = run.find('w:rPr', NS)
        if pr is not None:
            if truth(pr.find('w:b', NS)): v['bold'] = True
            if truth(pr.find('w:i', NS)): v['italic'] = True
        if href:
            assert href.startswith(('https://', 'http://', '#/read/')), 'Unsafe Word hyperlink'
            v['href'] = href
        if rich and {k:v for k,v in rich[-1].items() if k != 'text'} == {k:v for k,v in v.items() if k != 'text'}:
            rich[-1]['text'] += t
        else: rich.append(v)
    return {'text': ''.join(r['text'] for r in rich), 'rich': rich}

def paragraph(p, relationships, notes, numbering, volume, source_index):
    pairs = []; anchors = []; h = ''; e = ''; last_language = 'he'
    def finish():
        nonlocal h, e
        if not h.strip() and not e.strip(): h = e = ''; return
        pairs.append([h, e]); h = e = ''
    for run, _ in runs(p, relationships):
        lang = run_language(run, last_language)
        for child in run:
            if child.tag == W + 't':
                t = child.text or ''
                if lang == 'he':
                    # A short Hebrew spelling inside an English parenthesis is
                    # part of that gloss, not a new untranslated source phrase.
                    if e.rfind('(') > e.rfind(')') and re.fullmatch(r'\s*[א-ת](?:[-־][א-ת])+[).,\s]*',t):
                        e += t
                        continue
                    if e.strip() and t.strip(): finish()
                    h += t
                else: e += t
                if t.strip(): last_language = lang
            elif child.tag == W + 'footnoteReference':
                fid = child.get(W + 'id')
                assert fid in notes and fid in numbering, f'Missing native footnote {fid}'
                anchors.append((fid, len(pairs), len(h.rstrip())))
            elif child.tag in (W + 'br', W + 'tab'):
                if lang == 'he': h += ' '
                else: e += ' '
    finish()
    # A note after the English gloss belongs to its corresponding Hebrew pair.
    for fid, pi, at in anchors: assert pi < len(pairs), (volume, source_index, fid)
    fns = []
    for fid, pi, at in anchors:
        raw = pairs[pi][0]
        at = max(0, min(len(raw.strip()), at - (len(raw) - len(raw.lstrip()))))
        prefix = raw.strip()[:at]
        fns.append({'number': numbering[fid], 'sourceId': f'PURIM-{fid}',
                    'placementId': f'PURIM-N{numbering[fid]}',
                    'wordFootnoteId': fid, 'sourceParagraph': source_index,
                    'phraseIndex': pi, 'heCharOffset': at, 'heAnchorPrefix': prefix,
                    'heWord': len(prefix.split()), 'nativeConnections': [],
                    'paragraphs': notes[fid]})
    pairs = [[h.strip(), e.strip()] for h, e in pairs]
    if pairs and all(not h for h,e in pairs):
        assert not fns, 'An English-only heading contains a footnote'
        return {'h': ' '.join(e for h,e in pairs), 'sourceParagraph': source_index}
    assert all(h for h,e in pairs), f'Unpaired leading English in V{volume}, paragraph {source_index}'
    return {'p': [[html.escape(h, quote=False), html.escape(e, quote=False)] for h,e in pairs],
            'keepPairs': True, 'sourceParagraph': source_index, **({'footnotes':fns} if fns else {})}

def section_identity(title):
    t = BIDI.sub('', title).strip()
    m = re.match(r'^([֐-׿\s,״׳"\']+?)\s*(' + '|'.join(map(re.escape, sorted(SECTIONS, key=len, reverse=True))) + r') — Maamar (.+)$', t)
    assert m, 'Unrecognized source heading: ' + title
    he, group, number = m.groups(); n = NUMBERS.index(number) + 1
    return {'ref': f'Peri Tzadik, {SECTIONS[group]} {n}', 'en': f'{group} {n}', 'he': he.strip(), 'parashah': group,
            'heGroup': he.split(',')[0].strip(), 'ois': n}

def split_heading(t):
    """'מִכְּתַב יַד קָדְשׁוֹ From his holy manuscript' -> [hebrew, english]"""
    t = BIDI.sub('', t).strip(); m = re.match(r'^([^A-Za-z]+?)\s*([A-Za-z].*)$', t)
    assert m and re.search('[א-ת]', m[1]), 'Unpaired subheading: ' + t
    return [m[1].strip(), m[2].strip()]

def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for old in OUTPUT.glob('*.json'): old.unlink()
    sections = []; source_headings = []; group_headings = []; front = []; used = set()
    source = SOURCE / FILE
    with ZipFile(source) as z:
        document = ET.fromstring(z.read('word/document.xml'))
        native = ET.fromstring(z.read('word/footnotes.xml'))
        note_rels = rels(z, 'footnotes.xml'); body_rels = rels(z, 'document.xml')
        notes = {n.get(W+'id'): [note_paragraph(p,note_rels) for p in n.findall('w:p', NS)]
                 for n in native if n.tag == W+'footnote' and int(n.get(W+'id','0')) > 0 and not n.get(W+'type')}
        order = [r.get(W+'id') for r in document.iter(W+'footnoteReference')]
        assert len(order) == len(set(order)) == len(notes) == EXPECTED_NOTES, (len(order), len(notes))
        assert set(order) == set(notes), 'Unreferenced native footnotes'
        numbering = {fid: i+1 for i,fid in enumerate(order)}
        cur = None; n = 0; group = None
        for i,p in enumerate(document.find('w:body',NS)):
            assert p.tag in (W+'p', W+'sectPr'), 'Unexpected table or source block'
            if p.tag != W+'p': continue
            t = text_of(p)
            if not t.strip():
                assert not list(p.iter(W+'footnoteReference')); continue
            style = p.find('w:pPr/w:pStyle',NS)
            style = style.get(W+'val','') if style is not None else ''
            if style == 'Heading1':
                # a section's cover page: the group name in the contents
                assert not list(p.iter(W+'footnoteReference'))
                group = BIDI.sub('', t).strip(); cur = None
                group_headings.append({'sourceParagraph': i, 'text': t})
            elif group is None:
                # title page, copyright, method note and printed contents: in the Word and PDF downloads only
                assert not list(p.iter(W+'footnoteReference')); front.append(i)
            elif style == 'Heading2':
                identity = section_identity(t)
                assert group.endswith(identity['parashah']), (group, t)
                assert identity['ref'] not in used, 'Duplicate source heading ref'
                used.add(identity['ref']); n = 0
                cur = {**identity, 'id': FIRST_ID+len(sections), 'items': [], 'sourceHeading': t}
                sections.append(cur)
                cur['items'].append({'h': t, 'sourceParagraph': i})
                source_headings.append({'sourceParagraph': i, 'text': t, 'ref': cur['ref']})
            elif style.startswith('Heading') or style == 'Subtitle':
                assert cur is not None and not list(p.iter(W+'footnoteReference'))
                if ALIGNED_SUBHEADS.get(cur['ref']) == n + 1:
                    n += 1; he, en = split_heading(t)
                    cur['items'].append({'p': [[html.escape(he, quote=False), html.escape(en, quote=False)]], 'keepPairs': True,
                                         'sourceParagraph': i, 'n': n, 'subheading': True})
                else:
                    cur['items'].append({'h': t, 'sourceParagraph': i})
                source_headings.append({'sourceParagraph': i, 'text': t, 'ref': cur['ref']})
            else:
                assert cur is not None, f'Paragraph {i} outside a maamar'
                item = paragraph(p, body_rels, notes, numbering, 1, i)
                if item.get('p'): n += 1; item['n'] = n
                cur['items'].append(item)
    actual = sum(len(it.get('footnotes',[])) for s in sections for it in s['items'])
    assert actual == EXPECTED_NOTES
    volumes = [{'volume': 1, 'file': FILE, 'sha256': digest(source), 'bytes': source.stat().st_size, 'footnotes': actual,
                'label': 'Pri Tzaddik · ' + LABEL, 'he': HE_LABEL, 'download': FILE,
                'pdf': PDF, 'pdfSha256': digest(SOURCE / PDF), 'pdfBytes': (SOURCE / PDF).stat().st_size}]
    for sec in sections:
        raw = sec.pop('items')
        write_json(OUTPUT/f"{sec['id']}.json", raw)
        sec['volume'] = 1
        sec['paragraphs'] = sum('p' in x for x in raw)
        sec['pairs'] = sum(len(x.get('p',[])) for x in raw)
        sec['notes'] = sum(len(x.get('footnotes',[])) for x in raw)
        sec['subheadings'] = sum(bool(x.get('subheading')) for x in raw)
        sec['heRef'] = 'פרי צדיק, ' + sec['he']
    report = {'edition': EDITION, 'volumes': volumes, 'sections': sections, 'sourceHeadings': source_headings,
              'groupHeadings': group_headings, 'printFrontMatter': front,
              'parashas': list(dict.fromkeys(s['parashah'] for s in sections)),
              'footnotes': sum(s['notes'] for s in sections), 'pairs': sum(s['pairs'] for s in sections),
              'paragraphs': sum(s['paragraphs'] for s in sections)}
    write_json(OUTPUT/'manifest.json', report)
    print(json.dumps({k: report[k] for k in ('edition','parashas','footnotes','pairs','paragraphs')}, ensure_ascii=False))
    print('Sections:', len(sections), 'source headings:', len(source_headings))
    return report

if __name__=='__main__': build()

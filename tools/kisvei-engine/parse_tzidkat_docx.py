#!/usr/bin/env python3
"""Parse the Tzidkat HaTzadik Complete Editorial Master DOCX into structured data.

Reads word/document.xml, word/footnotes.xml and their relationship files directly so
that every footnote marker keeps its exact position inside the Hebrew phrase, every
hyperlink keeps its target, and nothing is lost through an intermediate conversion.

Usage: python3 -I parse_tzidkat_docx.py <unzipped-docx-dir> <out-dir>
"""
import csv
import html
import json
import re
import sys
import unicodedata
from pathlib import Path
from lxml import etree

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
NIKKUD = re.compile('[֑-ֽֿ-ׇ]')
HEB = re.compile('[א-ת]')
LAT = re.compile('[A-Za-z]')
CONTROL = {'⁧', '⁩', '‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁦', '⁨'}


def rels_of(path):
    if not path.exists():
        return {}
    root = etree.parse(str(path)).getroot()
    out = {}
    for r in root:
        out[r.get('Id')] = r.get('Target')
    return out


def on(rpr, tag):
    if rpr is None:
        return False
    el = rpr.find(W + tag)
    if el is None:
        return False
    v = el.get(W + 'val')
    return v is None or v in ('1', 'true', 'on')


def run_tokens(r, rels, href=None):
    rpr = r.find(W + 'rPr')
    style = rpr.find(W + 'rStyle').get(W + 'val') if rpr is not None and rpr.find(W + 'rStyle') is not None else None
    base = {'bold': on(rpr, 'b'), 'u': rpr is not None and rpr.find(W + 'u') is not None and rpr.find(W + 'u').get(W + 'val') not in (None, 'none'),
            'rtl': on(rpr, 'rtl'), 'href': href, 'style': style}
    skip_custom_mark = False
    for child in r:
        tag = child.tag
        if tag == W + 't':
            if skip_custom_mark:
                # Word custom footnote mark (w:customMarkFollows): the literal number is not body text.
                skip_custom_mark = False
                continue
            yield {**base, 'text': child.text or ''}
        elif tag == W + 'tab':
            yield {**base, 'text': '\t'}
        elif tag == W + 'br':
            yield {**base, 'text': '\n'}
        elif tag == W + 'noBreakHyphen':
            yield {**base, 'text': '‑'}
        elif tag == W + 'softHyphen':
            yield {**base, 'text': ''}
        elif tag == W + 'sym':
            yield {**base, 'text': '�'}
        elif tag == W + 'footnoteReference':
            if child.get(W + 'customMarkFollows') in ('1', 'true', 'on'):
                skip_custom_mark = True
            yield {**base, 'text': '', 'fn': int(child.get(W + 'id'))}
        elif tag == W + 'footnoteRef':
            continue
        elif tag in (W + 'rPr', W + 'lastRenderedPageBreak', W + 'separator', W + 'continuationSeparator'):
            continue
        else:
            # Unknown run child: keep its text if any
            txt = ''.join(child.itertext())
            if txt:
                yield {**base, 'text': txt}


def para_tokens(p, rels):
    toks = []
    for child in p:
        tag = child.tag
        if tag == W + 'r':
            toks.extend(run_tokens(child, rels))
        elif tag == W + 'hyperlink':
            rid = child.get(R + 'id')
            href = rels.get(rid) if rid else None
            anchor = child.get(W + 'anchor')
            if href is None and anchor:
                href = '#' + anchor
            for r in child.iter(W + 'r'):
                toks.extend(run_tokens(r, rels, href))
        elif tag in (W + 'pPr', W + 'bookmarkStart', W + 'bookmarkEnd', W + 'proofErr'):
            continue
        elif tag in (W + 'ins', W + 'smartTag', W + 'sdt', W + 'customXml'):
            for r in child.iter(W + 'r'):
                toks.extend(run_tokens(r, rels))
        elif tag == W + 'del':
            continue
        else:
            for r in child.iter(W + 'r'):
                toks.extend(run_tokens(r, rels))
    # Word custom footnote marks: the visible number (and the superscript commas between
    # consecutive markers) are typeset as ordinary text runs after the reference. Drop them.
    cleaned = []
    i = 0
    while i < len(toks):
        tok = toks[i]
        cleaned.append(tok)
        if tok.get('fn') is not None:
            # Look past the custom mark digits and any superscript separators (", ") up to the next token.
            j = i + 1
            while j < len(toks) and toks[j].get('fn') is None and re.fullmatch(r'[0-9,\s]*', toks[j].get('text', '')):
                j += 1
            between = toks[i + 1:j]
            next_is_marker = j < len(toks) and toks[j].get('fn') is not None
            if next_is_marker:
                # "[3],[4],[5]": the digits and the commas between markers are typesetting, not text.
                i = j
                continue
            # Only the custom-mark digits (and superscript-styled separators) are dropped; keep real punctuation.
            kept = []
            for t in between:
                txt = t.get('text', '')
                if re.fullmatch(r'[0-9]+', txt) or (t.get('style') == 'FootnoteReference' and re.fullmatch(r'[0-9,\s]*', txt)):
                    continue
                kept.append(t)
            dropped = ''.join(t.get('text', '') for t in between if t not in kept)
            if ' ' in dropped and not any(' ' in t.get('text', '') for t in kept):
                kept.insert(0, {**toks[i], 'text': ' ', 'fn': None, 'style': None})
            cleaned.extend(kept)
            i = j
            continue
        i += 1
    return cleaned


def pstyle(p):
    ppr = p.find(W + 'pPr')
    if ppr is None:
        return None
    st = ppr.find(W + 'pStyle')
    return st.get(W + 'val') if st is not None else None


def is_control(tok):
    t = tok.get('text', '')
    return t != '' and all(ch in CONTROL for ch in t)


def is_separator(tok):
    if tok.get('fn') is not None:
        return False
    t = tok.get('text', '').strip()
    return t != '' and all(ch in '—–-' for ch in t) and not tok.get('rtl')


def strip_controls(s):
    return ''.join(ch for ch in s if ch not in CONTROL)


def bare(s):
    return NIKKUD.sub('', strip_controls(s))


def heb_num(n):
    # Hebrew numerals for siman labels, matching the reader convention (e.g. סימן א׳, סימן ט״ו)
    ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט']
    tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ']
    hundreds = ['', 'ק', 'ר', 'ש', 'ת']
    s = ''
    h, rem = divmod(n, 100)
    while h > 4:
        s += 'ת'
        h -= 4
    s += hundreds[h]
    if rem == 15:
        s += 'טו'
    elif rem == 16:
        s += 'טז'
    else:
        t, o = divmod(rem, 10)
        s += tens[t] + ones[o]
    if len(s) == 1:
        return s + '׳'
    return s[:-1] + '״' + s[-1]


def split_pairs(tokens):
    """Split an interlinear paragraph's tokens into [{he, en, he_links, en_links, markers}] pairs.

    A pair is Hebrew text (inside RTL isolates, possibly several, with footnote markers
    between them) followed by a dash separator and the English rendering (bold runs) up to
    the next RTL isolate start.
    """
    pairs = []
    cur = None
    side = 'he'
    for tok in tokens:
        text = tok.get('text', '')
        if tok.get('fn') is not None:
            if cur is None:
                cur = {'he': '', 'en': '', 'he_links': [], 'en_links': [], 'markers': []}
            cur['markers'].append({'fn': tok['fn'], 'side': side,
                                   'offset': len(cur['he']) if side == 'he' else len(cur['en'])})
            continue
        if is_control(tok):
            # U+2067 (RLI) starts a Hebrew isolate; if we are on the English side, a new pair begins.
            if '⁧' in text and side == 'en' and cur is not None:
                pairs.append(cur)
                cur = None
                side = 'he'
            continue
        if is_separator(tok) and side == 'he' and cur is not None and cur['he'].strip():
            side = 'en'
            continue
        if cur is None:
            cur = {'he': '', 'en': '', 'he_links': [], 'en_links': [], 'markers': []}
        clean = strip_controls(text)
        if side == 'he':
            if tok.get('href'):
                cur['he_links'].append({'start': len(cur['he']), 'end': len(cur['he']) + len(clean), 'text': clean, 'href': tok['href']})
            cur['he'] += clean
        else:
            if tok.get('href'):
                # merge adjacent runs of the same link
                if cur['en_links'] and cur['en_links'][-1]['href'] == tok['href'] and cur['en_links'][-1]['end'] == len(cur['en']):
                    cur['en_links'][-1]['end'] += len(clean)
                    cur['en_links'][-1]['text'] += clean
                else:
                    cur['en_links'].append({'start': len(cur['en']), 'end': len(cur['en']) + len(clean), 'text': clean, 'href': tok['href']})
            cur['en'] += clean
    if cur is not None and (cur['he'].strip() or cur['en'].strip() or cur['markers']):
        pairs.append(cur)
    # Normalise whitespace at the edges, keeping marker offsets consistent.
    for pr in pairs:
        for key in ('he', 'en'):
            s = pr[key]
            lead = len(s) - len(s.lstrip())
            stripped = s.strip()
            if lead:
                for m in pr['markers']:
                    if m['side'] == key:
                        m['offset'] = max(0, m['offset'] - lead)
                for l in pr[key + '_links']:
                    l['start'] = max(0, l['start'] - lead)
                    l['end'] = max(0, l['end'] - lead)
            pr[key] = stripped
            for m in pr['markers']:
                if m['side'] == key:
                    m['offset'] = min(m['offset'], len(stripped))
    return pairs


SEFARIA_RE = re.compile(r'^https?://(?:www\.)?sefaria\.org/')
READER_RE = re.compile(r'^https?://akivagutnicki-crypto\.github\.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/(.+)$')


def sefaria_ref_from_url(url):
    m = re.match(r'^https?://(?:www\.)?sefaria\.org/([^?#]+)', url or '')
    if not m:
        return None
    path = m.group(1)
    path = html.unescape(path)
    from urllib.parse import unquote
    path = unquote(path)
    # URL form "Book_Name.1.2" or "Book_Name_1:2" -> "Book Name 1:2"
    ref = path.replace('_', ' ')
    # Dotted form: "Proverbs.10.6" / "Pesachim.96a.24" -> "Proverbs 10:6"
    if ':' not in ref and re.search(r'\.\d', ref):
        parts = ref.split('.')
        head = parts[0]
        nums = parts[1:]
        # Deal with "Mishneh Torah, Human Dispositions.3.3"
        ref = head + ' ' + ':'.join(nums) if nums else head
    return ref.strip()


def reader_ref_from_url(url):
    m = READER_RE.match(url or '')
    if not m:
        return None
    from urllib.parse import unquote
    return unquote(m.group(1)).replace('_', ' ').strip()


def footnote_blocks(paragraphs):
    """Classify the paragraphs of one footnote into typed blocks."""
    blocks = []
    for toks in paragraphs:
        text = ''.join(strip_controls(t.get('text', '')) for t in toks)
        if not text.strip():
            continue
        rich = []
        for t in toks:
            tx = strip_controls(t.get('text', ''))
            if tx == '':
                continue
            if rich and rich[-1]['bold'] == bool(t.get('bold')) and rich[-1]['u'] == bool(t.get('u')) and rich[-1]['href'] == t.get('href'):
                rich[-1]['text'] += tx
            else:
                rich.append({'text': tx, 'bold': bool(t.get('bold')), 'u': bool(t.get('u')), 'href': t.get('href')})
        # trim leading space run produced by the footnote reference
        while rich and rich[0]['text'].strip() == '':
            rich.pop(0)
        if rich:
            rich[0]['text'] = rich[0]['text'].lstrip()
        plain = ''.join(r['text'] for r in rich).strip()
        first = rich[0] if rich else {'text': '', 'bold': False, 'u': False, 'href': None}
        links = [r for r in rich if r.get('href')]
        block = {'text': plain, 'rich': rich}
        m = re.match(r'^See note (\d+)\.?$', plain)
        if m:
            block.update(type='see-note', target=int(m.group(1)))
        elif first.get('href') and SEFARIA_RE.match(first['href']):
            block.update(type='source', ref=first['text'].strip(), url=first['href'],
                         quote=plain[len(first['text']):].lstrip(' :').strip())
        elif first['bold'] and re.match(r'^Kisvei (Rav Tzadok|Ishbitz.?Radzin)\s*[·•]', first['text']):
            school = 'Kisvei Rav Tzadok' if 'Rav Tzadok' in first['text'] else 'Ishbitz–Radzin'
            link = links[0] if links else None
            quote = ''
            if link:
                idx = plain.find(link['text'])
                quote = plain[idx + len(link['text']):].lstrip(' :').strip() if idx >= 0 else ''
            block.update(type='parallel', school=school, ref=(link['text'].strip() if link else None),
                         url=(link['href'] if link else None), quote=quote)
        elif first['bold'] and first['text'].strip().rstrip(':').lower() in ('context', 'explanation', 'note', 'editorial note', 'see also', 'cf'):
            key = first['text'].strip().rstrip(':').lower()
            block.update(type=key, body=plain[len(first['text']):].strip())
        elif first['bold'] and not links and plain == first['text'].strip():
            block.update(type='headline')
        elif first['bold'] and first['text'].rstrip().endswith(':') or (first['bold'] and len(rich) > 1 and rich[1]['text'].startswith(':')):
            # An unlinked source citation, e.g. "Arba Meot Shekel Kesef, fol. 79b": "..."
            block.update(type='source-unlinked', ref=first['text'].strip().rstrip(':').strip(),
                         quote=plain[len(first['text']):].lstrip(' :').strip())
        elif first.get('href'):
            block.update(type='link', ref=first['text'].strip(), url=first['href'],
                         quote=plain[len(first['text']):].lstrip(' :').strip())
        else:
            block.update(type='prose')
        # Additional links embedded later in the block
        extra = []
        for r in links:
            if r is first:
                continue
            extra.append({'text': r['text'].strip(), 'href': r['href']})
        if extra:
            block['extra_links'] = extra
        blocks.append(block)
    return blocks


def classify_footnote(blocks):
    types = [b['type'] for b in blocks]
    if types == ['see-note']:
        return 'see-note'
    if 'parallel' in types:
        return 'parallel'
    if 'headline' in types and not any(t in ('source', 'source-unlinked', 'link') for t in types):
        return 'editorial'
    if 'source' in types or 'link' in types:
        return 'source'
    if 'source-unlinked' in types:
        return 'source-unlinked'
    return 'prose'


def main(docdir, outdir):
    docdir = Path(docdir)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    doc_rels = rels_of(docdir / 'word/_rels/document.xml.rels')
    fn_rels = rels_of(docdir / 'word/_rels/footnotes.xml.rels')
    body = etree.parse(str(docdir / 'word/document.xml')).getroot().find(W + 'body')
    fn_root = etree.parse(str(docdir / 'word/footnotes.xml')).getroot()

    # ---- footnotes ----
    footnotes = {}
    order = []
    for fn in fn_root.findall(W + 'footnote'):
        fid = int(fn.get(W + 'id'))
        if fn.get(W + 'type') in ('separator', 'continuationSeparator'):
            continue
        paras = [para_tokens(p, fn_rels) for p in fn.findall(W + 'p')]
        blocks = footnote_blocks(paras)
        footnotes[fid] = {'id': fid, 'type': classify_footnote(blocks), 'blocks': blocks,
                          'text': '\n'.join(b['text'] for b in blocks)}
        order.append(fid)

    # ---- body ----
    simanim = []
    cur = None
    pending_subheadings = []
    preface = []
    stats = {'paragraphs': 0, 'pairs': 0, 'markers': 0, 'unplaced_markers': 0}
    doc_paragraphs = body.findall(W + 'p')
    for idx, p in enumerate(doc_paragraphs):
        style = pstyle(p)
        toks = para_tokens(p, doc_rels)
        text = ''.join(strip_controls(t.get('text', '')) for t in toks).strip()
        markers_here = [t['fn'] for t in toks if t.get('fn') is not None]
        if style == 'Title':
            continue
        if style == 'TzidkatSiman':
            m = re.fullmatch(r'Siman (\d+)', text)
            assert m, (idx, text)
            cur = {'n': int(m.group(1)), 'title': None, 'paragraphs': [], 'subheadings': [], 'doc_index': idx}
            simanim.append(cur)
            continue
        if style == 'TzidkatTopic':
            assert cur is not None and cur['title'] is None, (idx, text)
            cur['title'] = text
            continue
        if style == 'TzidkatEditorialSubheading':
            assert cur is not None, (idx, text)
            pending_subheadings.append({'text': text, 'markers': markers_here, 'doc_index': idx})
            continue
        if not text and not markers_here:
            continue
        has_hebrew = any(t.get('rtl') or HEB.search(t.get('text', '')) for t in toks)
        if cur is None:
            preface.append({'text': text, 'doc_index': idx, 'markers': markers_here,
                            'pairs': split_pairs(toks) if has_hebrew else None})
            continue
        if not has_hebrew:
            # An English-only paragraph inside a siman: keep as a note paragraph
            cur['paragraphs'].append({'n': len(cur['paragraphs']) + 1, 'kind': 'note', 'text': text,
                                      'markers': markers_here, 'doc_index': idx, 'style': style})
            continue
        pairs = split_pairs(toks)
        stats['paragraphs'] += 1
        stats['pairs'] += len(pairs)
        para = {'n': len(cur['paragraphs']) + 1, 'kind': 'interlinear', 'doc_index': idx, 'style': style, 'phrases': []}
        if pending_subheadings:
            for sh in pending_subheadings:
                cur['subheadings'].append({'before_paragraph': para['n'], **sh})
            pending_subheadings = []
        for i, pr in enumerate(pairs):
            stats['markers'] += len(pr['markers'])
            para['phrases'].append({'i': i, 'he': pr['he'], 'en': pr['en'], 'he_links': pr['he_links'],
                                    'en_links': pr['en_links'], 'markers': pr['markers']})
        cur['paragraphs'].append(para)
    if pending_subheadings and cur is not None:
        for sh in pending_subheadings:
            cur['subheadings'].append({'before_paragraph': None, **sh})

    # ---- attach footnote placements ----
    placed = set()
    for s in simanim:
        for para in s['paragraphs']:
            if para['kind'] != 'interlinear':
                for fid in para.get('markers', []):
                    footnotes[fid].setdefault('placements', []).append({'siman': s['n'], 'paragraph': para['n'], 'phrase': None, 'side': 'note', 'offset': 0})
                    placed.add(fid)
                continue
            for ph in para['phrases']:
                for m in ph['markers']:
                    fid = m['fn']
                    footnotes[fid].setdefault('placements', []).append({'siman': s['n'], 'paragraph': para['n'], 'phrase': ph['i'], 'side': m['side'], 'offset': m['offset']})
                    placed.add(fid)
        for sh in s['subheadings']:
            for fid in sh['markers']:
                footnotes[fid].setdefault('placements', []).append({'siman': s['n'], 'paragraph': sh['before_paragraph'], 'phrase': None, 'side': 'subheading', 'offset': 0})
                placed.add(fid)
    for pf in preface:
        for fid in pf['markers']:
            footnotes[fid].setdefault('placements', []).append({'siman': 0, 'paragraph': None, 'phrase': None, 'side': 'preface', 'offset': 0})
            placed.add(fid)
    unplaced = [fid for fid in order if fid not in placed]
    stats['unplaced_markers'] = len(unplaced)

    out = {
        'edition': {
            'title': 'Tzidkat HaTzadik',
            'heTitle': 'צדקת הצדיק',
            'author': 'R. Tzadok HaKohen of Lublin',
            'editionTitle': 'Akiva Publishing Complete Editorial Master, revised edition (November 2026)',
            'sourceDocument': 'Tzidkas_Complete_Editorial_Master_REVISED_2.docx',
            'sefariaIndex': 'Tzidkat HaTzadik',
            'sefariaUrl': 'https://www.sefaria.org/Tzidkat_HaTzadik',
        },
        'stats': {**stats, 'simanim': len(simanim), 'footnotes': len(order),
                  'footnoteTypes': {t: sum(1 for f in footnotes.values() if f['type'] == t) for t in sorted({f['type'] for f in footnotes.values()})},
                  'subheadings': sum(len(s['subheadings']) for s in simanim)},
        'preface': preface,
        'simanim': simanim,
        'footnotes': [footnotes[f] for f in order],
        'unplacedFootnotes': unplaced,
    }
    (outdir / 'tzidkat_parsed_raw.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(out['stats'], ensure_ascii=False, indent=1))
    print('preface paragraphs:', len(preface))
    print('simanim numbers:', [s['n'] for s in simanim][:5], '...', [s['n'] for s in simanim][-3:], 'missing:', sorted(set(range(1, 265)) - {s['n'] for s in simanim}))
    print('unplaced footnotes:', unplaced[:20])
    multi = [f['id'] for f in footnotes.values() if len(f.get('placements', [])) > 1]
    print('footnotes with multiple placements:', len(multi), multi[:10])
    print('simanim without title:', [s['n'] for s in simanim if not s['title']])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

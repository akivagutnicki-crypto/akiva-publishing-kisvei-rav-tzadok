#!/usr/bin/env python3
"""Build the Akiva reader package for the Tzidkat HaTzadik editorial master.

Inputs
  out/edition/tzidkat_hatzadik_editorial_master.json  (build_edition.py)
  out/verify/merged.json                              (merge_verification.py; optional but expected)
  <repo>/sources/akiva/Tzidkat_HaTzadik.json          (current book, for section 74 and metadata continuity)
Outputs (in <outdir>)
  Tzidkat_HaTzadik.json          the new canonical book JSON (reviewed TZ-numbered footnotes inside the items)
  connections.json               every citation as a connection record (anchor, canonical Sefaria ref, match type)
  sefaria_links.json             Sefaria link-schema export (refs pairs with type quotation/reference)
  package_report.json            counts and review lists
"""
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sefaria_refs import normalize_ref, sefaria_url, dotted_data_ref, split_title_address  # noqa: E402

NIKKUD = re.compile('[֑-ֽֿ-ׇ]')
READER_BASE = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/'
EDITION_ID = 'tzidkat-editorial-master-2026-11'
EDITION_TITLE = 'Akiva Publishing Complete Editorial Master edition, revised (November 2026)'


def utf16len(s):
    return len(s.encode('utf-16-le')) // 2


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def english_html(ph):
    """English cell with inline <a data-ref="Book.1.2">...</a> links, as the reader expects."""
    en = ph['en']
    links = sorted(ph.get('enLinks', []), key=lambda l: l['start'])
    out, pos = [], 0
    for l in links:
        if l['start'] < pos:
            continue
        out.append(esc(en[pos:l['start']]))
        ref = normalize_ref(l['ref'])
        out.append(f'<a data-ref="{esc(dotted_data_ref(ref))}">{esc(en[l["start"]:l["end"]])}</a>')
        pos = l['end']
    out.append(esc(en[pos:]))
    return ''.join(out)


def bare(s):
    return NIKKUD.sub('', s)


def words_bare(s):
    return [w for w in re.sub(r'[^א-ת\s]', ' ', bare(s)).split() if w]


def longest_common_run(a, b):
    """Longest run of consecutive shared words between word lists a and b."""
    best, best_i = 0, -1
    prev = {}
    for i, wa in enumerate(a):
        cur = {}
        for j, wb in enumerate(b):
            if wa == wb:
                n = prev.get(j - 1, 0) + 1
                cur[j] = n
                if n > best:
                    best, best_i = n, i - n + 1
        prev = cur
    return best, best_i


def reader_url(ref):
    return READER_BASE + quote(ref.replace(' ', '_'), safe="_,:'()-")


def main(edition_path, merged_path, old_book_path, outdir):
    ed = json.load(open(edition_path, encoding='utf-8'))
    merged = json.load(open(merged_path, encoding='utf-8')) if Path(merged_path).exists() else {'sefaria': {}, 'library': {}}
    old = json.load(open(old_book_path, encoding='utf-8'))
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    sef_map = merged.get('sefaria', {})
    lib_map = merged.get('library', {})

    def canon(ref_text, linked_ref):
        """Return (canonicalRef, url, record, status) for a Sefaria citation."""
        for key in (linked_ref, normalize_ref(linked_ref), ref_text, normalize_ref(ref_text)):
            rec = sef_map.get(key)
            if rec and rec.get('ok') and rec.get('ref'):
                return rec['ref'], sefaria_url(rec['ref']), rec, 'verified'
        # A garbled URL form (e.g. "Ezekiel 358") whose displayed citation is well formed: use the display text.
        disp = normalize_ref(ref_text)
        if re.search(r'\s\d+[ab]?:\d', disp) and not re.search(r'\s\d+[ab]?:\d', normalize_ref(linked_ref)):
            return disp, sefaria_url(disp), None, 'display-derived'
        n = normalize_ref(linked_ref)
        return n, sefaria_url(n), None, 'unverified'

    review = {'unverifiedSefaria': [], 'displayDiffersFromCanonical': [], 'libraryNotFound': [], 'libraryQuoteMismatch': [],
              'externalSources': [], 'quotationMatches': 0, 'referenceOnly': 0}
    fn_by_num = {f['number']: f for f in ed['footnotes']}
    sections = []
    connections = []
    sefaria_links = []
    note_count = 0
    old_sections = {s['n']: s for s in old['sections']}

    for sim in ed['simanim']:
        n = sim['n']
        sec = {'n': n, 'en': sim['title'], 'he': sim['heLabel'], 'items': []}
        heads = {sh['beforeParagraph']: sh['text'] for sh in sim['subheadings'] if sh['beforeParagraph']}
        notes_before = {}
        for note in sim['editorialNotes']:
            notes_before.setdefault(note['beforeParagraph'], []).append(note['text'])
        trailing = notes_before.pop(None, [])
        for para in sim['paragraphs']:
            k = para['n']
            for text in notes_before.get(k, []):
                sec['items'].append({'h': text})
            if k in heads:
                sec['items'].append({'h': heads[k]})
            item = {'n': k, 'p': []}
            footnotes = []
            for ph in para['phrases']:
                he = ph['he']
                en_html = english_html(ph)
                en_plain = ph['en']
                item['p'].append([he, en_html])
                for mk in ph['footnotes']:
                    f = fn_by_num[mk['number']]
                    num = f['number']
                    offset = mk['offset'] if mk['side'] == 'he' else len(he)
                    he_prefix = he[:offset]
                    note = {
                        'number': num, 'sourceId': f'TZ-{num:04d}', 'placementId': f'TZ-{num:04d}-1',
                        'phraseIndex': ph['i'], 'heCharOffset': utf16len(he_prefix), 'enCharOffset': utf16len(en_plain),
                        'heAnchorPrefix': he_prefix, 'enAnchorPrefix': en_plain, 'heWord': mk['heWord'],
                        'kind': f['type'], 'paragraphs': [], 'sources': [], 'nativeConnections': [],
                        'provenance': {'edition': EDITION_TITLE, 'siman': n, 'printedNumber': num, 'editionId': EDITION_ID},
                    }
                    if f.get('headline'):
                        note['headline'] = f['headline']
                    statuses = []
                    # Rebuild the rich paragraphs from the parsed blocks, upgrading links.
                    src_iter = iter(f['sources'])
                    src_for_block = {}
                    for pi, p in enumerate(f['paragraphs']):
                        if p['blockType'] in ('source', 'source-unlinked', 'parallel', 'link') or (p['blockType'] == 'prose' and f['type'] == 'source-external' and pi == 0):
                            try:
                                src_for_block[pi] = next(src_iter)
                            except StopIteration:
                                pass
                    for pi, p in enumerate(f['paragraphs']):
                        rich = []
                        src = src_for_block.get(pi)
                        for r in p['rich']:
                            run = {'text': r['text']}
                            if r.get('bold'):
                                run['bold'] = True
                            href = r.get('href')
                            if src and src['kind'] == 'sefaria' and href and 'sefaria.org' in href:
                                cref, url, rec, status = canon(src['ref'], src['linkedRef'])
                                href = url
                                if status == 'verified':
                                    display = cref
                                    if bare_display(r['text']) != bare_display(cref):
                                        review['displayDiffersFromCanonical'].append({'note': num, 'display': r['text'], 'canonical': cref})
                                    # Show the canonical Sefaria reference so text and link always agree.
                                    run['text'] = cref if r['text'].strip() == src['ref'].strip() else r['text']
                            elif src and src['kind'] == 'library' and r.get('bold') and r['text'].strip().rstrip(':') == (src.get('ref') or '').strip():
                                href = library_href(src, lib_map)
                            if href:
                                run['href'] = href
                            rich.append(run)
                        # an unlinked library/external citation: link the bold ref run
                        if src and src['kind'] == 'library' and not any(x.get('href') for x in rich) and rich:
                            rich[0]['href'] = library_href(src, lib_map)
                        text = ''.join(x['text'] for x in rich)
                        note['paragraphs'].append({'text': text, 'rich': rich})
                    for src in f['sources']:
                        if src['kind'] == 'sefaria':
                            cref, url, rec, status = canon(src['ref'], src['linkedRef'])
                            statuses.append(status)
                            entry = {'ref': cref, 'url': url, 'connectionsUrl': 'https://www.sefaria.org/api/links/' + quote(cref, safe='') + '?with=all', 'role': 'source'}
                            if status != 'verified':
                                review['unverifiedSefaria'].append({'note': num, 'ref': src['ref'], 'linkedRef': src['linkedRef']})
                            note['sources'].append(entry)
                            match_type, run_len = 'reference', 0
                            if rec and rec.get('he'):
                                run_len, _ = longest_common_run(words_bare(he), words_bare(rec['he']))
                                if run_len >= 3:
                                    match_type = 'quotation'
                            if match_type == 'quotation':
                                review['quotationMatches'] += 1
                            else:
                                review['referenceOnly'] += 1
                            connections.append({'note': num, 'siman': n, 'paragraph': k, 'phrase': ph['i'], 'anchorRef': f'Tzidkat HaTzadik {n}:{k}',
                                                'hePhrase': he, 'heWord': mk['heWord'], 'displayRef': src['ref'], 'linkedRef': src['linkedRef'],
                                                'canonicalRef': cref, 'url': url, 'heRef': rec.get('heRef') if rec else None,
                                                'category': rec.get('category') if rec else None, 'status': status, 'matchType': match_type,
                                                'sharedWordRun': run_len, 'quote': src.get('quote', ''), 'context': src.get('context'), 'kind': 'sefaria'})
                            sefaria_links.append({'refs': [f'Tzidkat HaTzadik {n}' + (f':{k}' if len(sim['paragraphs']) > 1 else ''), cref],
                                                  'type': match_type, 'auto': False, 'generated_by': 'Akiva Publishing editorial master 2026',
                                                  'anchor_text': he, 'note': num})
                        elif src['kind'] == 'library':
                            lrec = lib_map.get(src['ref'])
                            cref = (lrec or {}).get('canonicalRef') or src['ref']
                            note['nativeConnections'].append(cref)
                            if lrec and not lrec.get('ok'):
                                review['libraryNotFound'].append({'note': num, 'ref': src['ref']})
                            if lrec and lrec.get('quoteMatch') is False:
                                review['libraryQuoteMismatch'].append({'note': num, 'ref': src['ref']})
                            connections.append({'note': num, 'siman': n, 'paragraph': k, 'phrase': ph['i'], 'anchorRef': f'Tzidkat HaTzadik {n}:{k}',
                                                'hePhrase': he, 'heWord': mk['heWord'], 'displayRef': src['ref'], 'canonicalRef': cref,
                                                'url': library_href(src, lib_map), 'school': src.get('school'), 'kind': 'library',
                                                'status': 'verified' if (lrec and lrec.get('ok')) else 'unverified',
                                                'quoteMatch': (lrec or {}).get('quoteMatch'), 'quote': src.get('quote', ''),
                                                'explanation': src.get('explanation'), 'context': src.get('context'), 'headline': f.get('headline')})
                        else:
                            review['externalSources'].append({'note': num, 'ref': src['ref'], 'url': src.get('url')})
                            connections.append({'note': num, 'siman': n, 'paragraph': k, 'phrase': ph['i'], 'anchorRef': f'Tzidkat HaTzadik {n}:{k}',
                                                'hePhrase': he, 'displayRef': src['ref'], 'url': src.get('url'), 'kind': 'external', 'status': 'external',
                                                'quote': src.get('quote', '')})
                    if f['type'] == 'see-note' and f['seeNotes']:
                        target = f['seeNotes'][0]
                        note['crossReference'] = {'placementId': f'TZ-{target:04d}-1', 'number': target}
                    if f['seeNotes'] and f['type'] != 'see-note':
                        note['seeNotes'] = f['seeNotes']
                    if f['seeSimanim']:
                        note['seeSimanim'] = f['seeSimanim']
                    if statuses and all(s == 'verified' for s in statuses):
                        note['verificationStatus'] = 'verified'
                        note['verificationNote'] = 'Sefaria reference resolved against the live API; canonical ref and URL recorded.'
                    elif statuses:
                        note['verificationStatus'] = 'reference unresolved'
                        note['verificationNote'] = 'At least one Sefaria reference could not be resolved automatically; editorial link retained.'
                    else:
                        note['verificationStatus'] = 'editorial'
                        note['verificationNote'] = {'parallel': 'Kisvei Rav Tzadok / Ishbitz–Radzin parallel with explanation', 'internal': 'Internal Kisvei Rav Tzadok cross-reference',
                                                    'see-note': 'Cross-reference to another note', 'source-external': 'Source not on Sefaria', 'editorial': 'Editorial note', 'see-siman': 'Cross-reference to other simanim'}.get(f['type'], 'Editorial note')
                    footnotes.append(note)
                    note_count += 1
            if footnotes:
                item['footnotes'] = footnotes
            sec['items'].append(item)
        for text in trailing:
            sec['items'].append({'h': text})
        sections.append(sec)
        if n == 73:
            # The printed editions have no Siman 74. Keep the reader's placeholder section with the editorial note.
            old74 = old_sections.get(74)
            s74 = {'n': 74, 'en': old74.get('en', 'Section 74 (not present in the printed editions)') if old74 else 'Section 74 (not present in the printed editions)',
                   'he': 'סימן ע״ד', 'items': []}
            if old74:
                for it in old74['items']:
                    if 'p' in it:
                        s74['items'].append({'n': it.get('n', 1), 'p': [[pr[0], pr[1]] for pr in it['p']]})
                        break
            for text in trailing_note_74(sim):
                s74['items'].append({'h': text})
            sections.append(s74)
    sections.sort(key=lambda s: s['n'])

    book = {
        'title': 'Tzidkat HaTzadik', 'heTitle': 'צדקת הצדיק', 'language': 'he',
        'versionTitle': EDITION_TITLE, 'versionSource': '', 'license': '© Akiva Publishing',
        'categories': ['Chasidut', "R' Tzadok HaKohen"], 'akiva': True, 'interlinear': True,
        'editionId': EDITION_ID,
        'editionNote': 'Complete Editorial Master: phrase-by-phrase vocalized Hebrew with English, 4,407 numbered notes (Sefaria source quotations with context, Kisvei Rav Tzadok and Ishbitz–Radzin parallels with explanations, internal cross-references), editorial subheadings. Legacy footnote layers are superseded.',
        'sections': sections,
        'downloads': [{'source': 'sources/akiva/docx/Tzidkas_Complete_Editorial_Master_REVISED_2.docx', 'file': 'downloads/tzidkas-hatzaddik-complete-editorial-master.docx', 'label': 'Download the complete Word edition (editorial master, 2026)'}],
        'importInfo': {'editionId': EDITION_ID, 'simanim': 264, 'missingSiman': 74, 'documentParagraphs': ed['stats']['paragraphs'], 'phrasePairs': ed['stats']['phrases'],
                       'inlineSefariaLinks': ed['stats']['inlineEnglishLinks'],
                       'sefariaTargets': len({normalize_ref(l['ref']) for s in ed['simanim'] for p in s['paragraphs'] for ph in p['phrases'] for l in ph['enLinks']}), 'subheadings': ed['stats']['subheadings'], 'sourceDocument': ed['edition']['sourceDocument']},
        'footnoteImportInfo': {'edition': EDITION_TITLE, 'notes': note_count, 'placements': note_count, 'sectionsWithNotes': sum(1 for s in sections if any(i.get('footnotes') for i in s['items'])),
                               'sourceLinks': sum(len(i.get('footnotes', [])) and sum(len(x['sources']) for x in i['footnotes']) for s in sections for i in s['items']),
                               'sefariaVerified': sum(1 for c in connections if c['kind'] == 'sefaria' and c['status'] == 'verified'),
                               'sefariaUnverified': sum(1 for c in connections if c['kind'] == 'sefaria' and c['status'] != 'verified'),
                               'quotationMatches': review['quotationMatches'], 'libraryConnections': sum(1 for c in connections if c['kind'] == 'library'),
                               'numbering': 'Continuous 1–4407 across the sefer, identical to the Word master; "See note N" cross-references resolve to placementId TZ-NNNN-1.',
                               'anchorConvention': 'Exact UTF-16 offset in the rendered, HTML-decoded Hebrew phrase; the marker follows the Hebrew word heWord (1-based); the English anchor spans the whole phrase.',
                               'reviewed': '2026-11-02'},
    }
    json.dump(book, open(outdir / 'Tzidkat_HaTzadik.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    json.dump({'edition': EDITION_ID, 'generated': '2026-11-02', 'count': len(connections), 'connections': connections}, open(outdir / 'connections.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(sefaria_links, open(outdir / 'sefaria_links.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    report = {'notes': note_count, 'sections': len(sections), 'connections': len(connections), 'review': {k: (v if isinstance(v, int) else len(v)) for k, v in review.items()}, 'reviewLists': review}
    json.dump(report, open(outdir / 'package_report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != 'reviewLists'}, indent=1))


def bare_display(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def library_href(src, lib_map):
    rec = lib_map.get(src.get('ref') or '')
    if rec and rec.get('readerUrl'):
        return rec['readerUrl']
    if rec and not rec.get('ok') and (src.get('ref') or '').startswith('Mei HaShiloach'):
        return sefaria_url(src['ref'])
    if src.get('url'):
        return src['url']
    return reader_url(src['ref'])


def trailing_note_74(sim73):
    out = []
    for note in sim73['editorialNotes']:
        if 'Section 74' in note['text'] or 'Missing Section' in note['text']:
            out.append(note['text'])
    return out


if __name__ == '__main__':
    main(*sys.argv[1:5])

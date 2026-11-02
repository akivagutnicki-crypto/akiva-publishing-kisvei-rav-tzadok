#!/usr/bin/env python3
"""Build the normalised Tzidkat HaTzadik editorial-master edition from the raw DOCX parse.

Inputs : out/tzidkat_parsed_raw.json  (from parse_tzidkat_docx.py)
Outputs: <outdir>/tzidkat_hatzadik_editorial_master.json   full structured edition
         <outdir>/tzidkat_hatzadik_phrases.csv              one row per interlinear phrase
         <outdir>/tzidkat_hatzadik_footnotes.csv            one row per footnote source/parallel
         <outdir>/tzidkat_hatzadik_editorial_master.txt     readable plain text with notes
"""
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote, quote

NIKKUD = re.compile('[֑-ֽֿ-ׇ]')
READER_BASE = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/'
SEFARIA_BASE = 'https://www.sefaria.org/'

# Works of the Akiva Publishing Kisvei Rav Tzadok / Ishbitz-Radzin library (reader refs).
LIBRARY_BOOKS = [
    'Beit Yaakov on Torah', 'Divrei Chalomot', 'Divrei Soferim', 'Et HaOchel', 'Kometz HaMinchah',
    'Machshavot Charutz', "Meshiv HaTa'anah", 'Meshiv HaTaanah', 'Meshiv Tzedek', 'Ohr Zarua LaTzadik',
    'Poked Akarim', 'Resisei Layla', 'Sefer HaZikhronot', 'Takanat HaShavin', 'Toldos HaKohen',
    'Tzidkat HaTzadik', 'Dover Tzedek', 'Likkutei Maamarim', 'Peri Tzadik', 'Sichat Malakhei HaSharet',
    'Sichat Shedim', 'Sod Yesharim', 'Yisrael Kedoshim', 'Tiferet Yosef', 'Mei HaShiloach',
    "Sha'ar HaEmunah VeYesod HaChasidut",
]
ISHBITZ_BOOKS = {'Beit Yaakov on Torah', 'Sod Yesharim', 'Tiferet Yosef', 'Mei HaShiloach', "Sha'ar HaEmunah VeYesod HaChasidut"}
SEFARIA_ALSO = {'Tzidkat HaTzadik', 'Mei HaShiloach', 'Sichat Shedim', "Sha'ar HaEmunah VeYesod HaChasidut", 'Peri Tzadik',
                'Resisei Layla', 'Machshavot Charutz', 'Takanat HaShavin', 'Dover Tzedek', 'Likkutei Maamarim', 'Yisrael Kedoshim',
                'Divrei Soferim', 'Sefer HaZikhronot', 'Kometz HaMinchah', 'Poked Akarim', 'Ohr Zarua LaTzadik', 'Divrei Chalomot',
                'Sichat Malakhei HaSharet', 'Et HaOchel', 'Meshiv Tzedek'}


def heb_num(n):
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
    return s + '׳' if len(s) == 1 else s[:-1] + '״' + s[-1]


def library_book(ref):
    best = None
    for b in LIBRARY_BOOKS:
        if ref == b or ref.startswith(b + ' ') or ref.startswith(b + ','):
            if best is None or len(b) > len(best):
                best = b
    return best


def reader_url(ref):
    return READER_BASE + quote(ref.replace(' ', '_'), safe="_,:'()-")


def sefaria_path_to_ref(path):
    path = unquote(path.split('?')[0].split('#')[0])
    ref = path.replace('_', ' ').strip()
    if ':' not in ref and re.search(r'\.\d', ref):
        head, *nums = ref.split('.')
        ref = head + ' ' + ':'.join(nums)
    return ref.strip()


def sefaria_url(ref):
    """Canonical Sefaria URL form: spaces -> underscores, colon sections -> dots (Sefaria's own convention)."""
    r = ref.strip()
    # Split the title from the trailing address: last run of "n:n-n" style tokens
    m = re.match(r'^(.*?)(?:\s+([0-9][0-9a-b]*(?::[0-9][0-9a-b]*)*(?:-[0-9][0-9a-b]*(?::[0-9][0-9a-b]*)*)?))?$', r)
    if m and m.group(2):
        title, addr = m.group(1), m.group(2)
        return SEFARIA_BASE + quote(title.replace(' ', '_') + '.' + addr.replace(':', '.'), safe="_.,;'()-")
    return SEFARIA_BASE + quote(r.replace(' ', '_'), safe="_.,;'()-")


def word_anchor(he, offset):
    """Return (heWord 1-based index of the word the marker follows, heWordText) for a marker at char offset."""
    before = he[:offset]
    words_before = before.split()
    if not words_before:
        return 0, ''
    # The marker follows the word containing the offset position (or the last complete word).
    if before and not before[-1].isspace() and offset < len(he) and not he[offset].isspace():
        # marker is inside a word: it follows that whole word
        pass
    idx = len(words_before)
    allwords = he.split()
    if idx > len(allwords):
        idx = len(allwords)
    word = allwords[idx - 1] if idx else ''
    word_text = re.sub('[^א-ת]', '', NIKKUD.sub('', word))
    return idx, word_text


def refine_block(block):
    """Refine a parsed footnote block into a normalised source entry."""
    t = block['type']
    if t == 'source':
        ref = block['ref']
        path = re.sub(r'^https?://(?:www\.)?sefaria\.org/', '', block['url'])
        linked_ref = sefaria_path_to_ref(path)
        return {'kind': 'sefaria', 'ref': ref, 'linkedRef': linked_ref, 'url': block['url'],
                'quote': block.get('quote', ''), 'extraLinks': block.get('extra_links', [])}
    if t == 'source-unlinked':
        ref = block['ref']
        book = library_book(ref)
        if book:
            school = 'Ishbitz–Radzin' if book in ISHBITZ_BOOKS else 'Kisvei Rav Tzadok'
            return {'kind': 'library', 'ref': ref, 'book': book, 'school': school, 'url': reader_url(ref),
                    'quote': block.get('quote', ''), 'extraLinks': block.get('extra_links', [])}
        return {'kind': 'external', 'ref': ref, 'url': None, 'quote': block.get('quote', ''), 'extraLinks': block.get('extra_links', [])}
    if t == 'parallel':
        ref = block.get('ref') or ''
        book = library_book(ref)
        return {'kind': 'library', 'ref': ref, 'book': book, 'school': block['school'], 'url': block.get('url') or (reader_url(ref) if ref else None),
                'quote': block.get('quote', ''), 'extraLinks': block.get('extra_links', [])}
    if t == 'link':
        return {'kind': 'external', 'ref': block['ref'], 'url': block['url'], 'quote': block.get('quote', ''), 'extraLinks': block.get('extra_links', [])}
    return None


SEE_NOTE_RE = re.compile(r'See notes? ([0-9][0-9,\s]*(?:and\s+\d+)?)')
SEE_SIMAN_RE = re.compile(r'See Siman(?:im)? ([0-9][0-9,\s]*(?:and\s+\d+)?)')


def normalise_footnote(f):
    blocks = f['blocks']
    out = {'number': f['id'], 'type': None, 'headline': None, 'summary': [], 'sources': [], 'seeNotes': [],
           'seeSimanim': [], 'text': f['text'], 'paragraphs': [{'text': b['text'], 'rich': b['rich'], 'blockType': b['type']} for b in blocks]}
    last_source = None
    for b in blocks:
        t = b['type']
        if t == 'headline':
            out['headline'] = b['text']
        elif t == 'prose':
            text = b['text']
            m = SEE_NOTE_RE.search(text)
            if m and text.startswith('See note'):
                nums = [int(x) for x in re.findall(r'\d+', m.group(1))]
                out['seeNotes'].extend(nums)
                out['summary'].append(text)
            elif text.startswith('See Siman'):
                nums = [int(x) for x in re.findall(r'\d+', text)]
                out['seeSimanim'].extend(nums)
                out['summary'].append(text)
            elif last_source is None and not out['sources']:
                # A plain citation of a source not on Sefaria (e.g. Zohar III 232a; Likkutei Torah of the Arizal)
                if re.match(r'^(Zohar|Tikkunei|Sefer|Likkutei|Pirkei|Midrash|Yalkut|Rabbeinu|Ramban|Rashi|Maharal|Shelah|Arizal|Pri Etz|Etz Chaim|Sha\'ar|Shaar|Siddur|Machzor|Tur|Shulchan|Rema|Mishnah|Tosefta|Sifra|Sifrei|Mekhilta|Tanchuma|Pesikta|Seder|Targum|Rambam|Kuzari|Chovot|Reishit|Sefat|Noam|Toldot|Kedushat|Ohev|Degel|Tanya|Likutei|Likkutei|Or |Ohr |Maggid|Ba\'al|Baal|Avodat|Bnei|Zera|Mei |Beit|Beis|Tiferet|Chiddushei|Chidushei|Responsa|She\'elot|Teshuvot|Arba|Ma\'amar|Maamar|Shnei|Shney|Derech|Mesilat|Nefesh|Ruach|Mishnat|Sha\'arei|Shaarei|Orchot|Igeret|Iggeret|Hakdamah|Introduction|Commentary|Peirush|Perush|Kol |Eitz|Pardes|Tomer|Reshit|Shir|Zohar Chadash|Ra\'aya|Raaya|Idra|Sifra DiTzniuta|Heichalot|Hekhalot|Bahir|Yetzirah|Sefer Yetzirah)', text):
                    src = {'kind': 'external', 'ref': text.rstrip('.'), 'url': None, 'quote': '', 'extraLinks': b.get('extra_links', [])}
                    m2 = re.match(r'^([^:“"]+?)[:：]\s*(.+)$', text)
                    if m2 and len(m2.group(1)) < 120:
                        src['ref'] = m2.group(1).strip()
                        src['quote'] = m2.group(2).strip()
                    out['sources'].append(src)
                    last_source = src
                else:
                    out['summary'].append(text)
            else:
                out['summary'].append(text)
        elif t == 'see-note':
            out['seeNotes'].append(b['target'])
        elif t == 'context':
            if last_source is not None:
                last_source['context'] = b['body']
            else:
                out['summary'].append('Context: ' + b['body'])
        elif t == 'explanation':
            if last_source is not None:
                last_source['explanation'] = b['body']
            else:
                out['summary'].append('Explanation: ' + b['body'])
        elif t in ('note', 'editorial note', 'see also', 'cf'):
            out['summary'].append(b['text'])
        else:
            src = refine_block(b)
            if src:
                out['sources'].append(src)
                last_source = src
    kinds = [s['kind'] for s in out['sources']]
    if out['headline'] and any(k == 'library' for k in kinds):
        out['type'] = 'parallel'
    elif out['headline'] and not kinds:
        out['type'] = 'editorial'
    elif 'sefaria' in kinds:
        out['type'] = 'source'
    elif 'library' in kinds:
        out['type'] = 'internal'
    elif 'external' in kinds:
        out['type'] = 'source-external'
    elif out['seeNotes'] and not out['seeSimanim']:
        out['type'] = 'see-note'
    elif out['seeSimanim']:
        out['type'] = 'see-siman'
    else:
        out['type'] = 'editorial'
    return out


def main(raw_path, outdir):
    raw = json.load(open(raw_path, encoding='utf-8'))
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    fn_by_id = {f['id']: f for f in raw['footnotes']}

    simanim = []
    preface_paragraphs = []
    # The two preface lines belong to Siman 1 in Sefaria (1:1, 1:2) and in the reader.
    for pf in raw['preface']:
        if pf.get('pairs'):
            preface_paragraphs.append(pf)
    footnote_anchor = {}
    for s in raw['simanim']:
        n = s['n']
        sim = {'n': n, 'heLabel': 'סימן ' + heb_num(n), 'title': s['title'],
               'sefariaRef': f'Tzidkat HaTzadik {n}', 'sefariaUrl': f'{SEFARIA_BASE}Tzidkat_HaTzadik.{n}',
               'readerRef': f'Tzidkat HaTzadik {n}', 'readerUrl': reader_url(f'Tzidkat HaTzadik {n}'),
               'subheadings': [], 'editorialNotes': [], 'paragraphs': []}
        paragraphs = []
        if n == 1:
            for pf in preface_paragraphs:
                paragraphs.append({'kind': 'interlinear', 'phrases': [
                    {'i': i, 'he': pr['he'], 'en': pr['en'], 'he_links': pr['he_links'], 'en_links': pr['en_links'], 'markers': pr['markers']}
                    for i, pr in enumerate(pf['pairs'])]})
        note_buffer = []
        for p in s['paragraphs']:
            if p['kind'] != 'interlinear':
                note_buffer.append(p['text'])
                continue
            if note_buffer:
                sim['editorialNotes'].append({'beforeParagraph': len(paragraphs) + 1, 'text': '\n'.join(note_buffer)})
                note_buffer = []
            paragraphs.append(p)
        if note_buffer:
            sim['editorialNotes'].append({'beforeParagraph': None, 'text': '\n'.join(note_buffer)})
        # subheadings reference the siman-local paragraph numbering of the raw parse; shift for siman 1 preface
        shift = len(preface_paragraphs) if n == 1 else 0
        for sh in s['subheadings']:
            sim['subheadings'].append({'beforeParagraph': (sh['before_paragraph'] + shift) if sh['before_paragraph'] else None, 'text': sh['text']})
        for k, p in enumerate(paragraphs, 1):
            para = {'n': k, 'sefariaRef': f'Tzidkat HaTzadik {n}:{k}' if len(paragraphs) > 1 else f'Tzidkat HaTzadik {n}',
                    'readerRef': f'Tzidkat HaTzadik {n}:{k}', 'phrases': []}
            for ph in p['phrases']:
                he = ph['he']
                phrase = {'i': ph['i'], 'he': he, 'heBare': NIKKUD.sub('', he), 'en': ph['en'],
                          'enLinks': [{'text': l['text'], 'ref': sefaria_path_to_ref(re.sub(r'^https?://(?:www\.)?sefaria\.org/', '', l['href'])), 'url': l['href'], 'start': l['start'], 'end': l['end']} for l in ph['en_links']],
                          'footnotes': []}
                for m in ph['markers']:
                    heWord, heWordText = word_anchor(he, m['offset']) if m['side'] == 'he' else (0, '')
                    anchor = {'siman': n, 'paragraph': k, 'phrase': ph['i'], 'side': m['side'], 'offset': m['offset'],
                              'heWord': heWord, 'heWordText': heWordText}
                    phrase['footnotes'].append({'number': m['fn'], **{kk: anchor[kk] for kk in ('side', 'offset', 'heWord', 'heWordText')}})
                    footnote_anchor[m['fn']] = {**anchor, 'hePhrase': he, 'enPhrase': ph['en']}
                para['phrases'].append(phrase)
            sim['paragraphs'].append(para)
        simanim.append(sim)

    footnotes = []
    for f in raw['footnotes']:
        nf = normalise_footnote(f)
        nf['anchor'] = footnote_anchor.get(f['id'])
        footnotes.append(nf)

    # Statistics
    kinds = {}
    for nf in footnotes:
        kinds[nf['type']] = kinds.get(nf['type'], 0) + 1
    src_kinds = {}
    for nf in footnotes:
        for s in nf['sources']:
            src_kinds[s['kind']] = src_kinds.get(s['kind'], 0) + 1
    edition = {
        'edition': {**raw['edition'], 'generated': 'parse_tzidkat_docx.py + build_edition.py',
                    'numbering': 'Footnote numbers are document-wide (1–4407) exactly as in the Word master, so every "See note N" cross-reference resolves. Markers sit after the Hebrew word they annotate (heWord, 1-based).',
                    'segmentation': 'Siman 1 begins with the two preface lines (Sefaria 1:1, 1:2). Long simanim are divided into the editorial paragraphs of the Word master; sefariaRef of a multi-paragraph siman points to the chapter.'},
        'stats': {'simanim': len(simanim), 'missingSimanim': [74], 'paragraphs': sum(len(s['paragraphs']) for s in simanim),
                  'phrases': sum(len(p['phrases']) for s in simanim for p in s['paragraphs']),
                  'footnotes': len(footnotes), 'footnoteTypes': kinds, 'sourceKinds': src_kinds,
                  'subheadings': sum(len(s['subheadings']) for s in simanim), 'editorialNotes': sum(len(s['editorialNotes']) for s in simanim),
                  'inlineEnglishLinks': sum(len(ph['enLinks']) for s in simanim for p in s['paragraphs'] for ph in p['phrases'])},
        'simanim': simanim,
        'footnotes': footnotes,
    }
    (outdir / 'tzidkat_hatzadik_editorial_master.json').write_text(json.dumps(edition, ensure_ascii=False, indent=1), encoding='utf-8')

    # CSV: phrases
    with open(outdir / 'tzidkat_hatzadik_phrases.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['siman', 'siman_title', 'paragraph', 'phrase_index', 'hebrew', 'english', 'footnote_numbers', 'inline_sefaria_refs', 'sefaria_ref', 'reader_ref'])
        for s in simanim:
            for p in s['paragraphs']:
                for ph in p['phrases']:
                    w.writerow([s['n'], s['title'], p['n'], ph['i'], ph['he'], ph['en'],
                                ' '.join(str(x['number']) for x in ph['footnotes']),
                                ' | '.join(l['ref'] for l in ph['enLinks']), p['sefariaRef'], p['readerRef']])
    # CSV: footnotes (one row per source; notes without sources get one row)
    with open(outdir / 'tzidkat_hatzadik_footnotes.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['number', 'type', 'siman', 'paragraph', 'phrase_index', 'he_word', 'he_word_text', 'hebrew_phrase', 'headline', 'summary',
                    'source_kind', 'source_ref', 'linked_ref', 'school', 'url', 'quote', 'context', 'explanation', 'see_notes', 'see_simanim', 'full_text'])
        for nf in footnotes:
            a = nf['anchor'] or {}
            base = [nf['number'], nf['type'], a.get('siman'), a.get('paragraph'), a.get('phrase'), a.get('heWord'), a.get('heWordText'), a.get('hePhrase'),
                    nf['headline'] or '', ' '.join(nf['summary'])]
            tail = [' '.join(map(str, nf['seeNotes'])), ' '.join(map(str, nf['seeSimanim'])), nf['text']]
            if nf['sources']:
                for s in nf['sources']:
                    w.writerow(base + [s['kind'], s['ref'], s.get('linkedRef', ''), s.get('school', ''), s.get('url') or '', s.get('quote', ''), s.get('context', ''), s.get('explanation', '')] + tail)
            else:
                w.writerow(base + ['', '', '', '', '', '', '', ''] + tail)
    # TXT
    lines = ['TZIDKAT HATZADIK — צדקת הצדיק', 'R. Tzadok HaKohen of Lublin', edition['edition']['editionTitle'], '']
    for s in simanim:
        lines.append(f"\n{'=' * 78}\nSIMAN {s['n']} · {s['heLabel']} · {s['title']}\n{'=' * 78}")
        for note in s['editorialNotes']:
            if note['beforeParagraph'] == 1:
                lines.append('[Editorial note] ' + note['text'])
        for p in s['paragraphs']:
            for sh in s['subheadings']:
                if sh['beforeParagraph'] == p['n']:
                    lines.append(f"\n— {sh['text']} —")
            for note in s['editorialNotes']:
                if note['beforeParagraph'] == p['n'] and p['n'] != 1:
                    lines.append('[Editorial note] ' + note['text'])
            lines.append('')
            for ph in p['phrases']:
                he = ph['he']
                # insert markers
                marks = sorted(ph['footnotes'], key=lambda x: -x['offset'])
                for m in marks:
                    if m['side'] == 'he':
                        he = he[:m['offset']] + f"[{m['number']}]" + he[m['offset']:]
                lines.append(f"{he} — {ph['en']}")
        for note in s['editorialNotes']:
            if note['beforeParagraph'] is None:
                lines.append('[Editorial note] ' + note['text'])
        nums = [x['number'] for p in s['paragraphs'] for ph in p['phrases'] for x in ph['footnotes']]
        if nums:
            lines.append('\nNotes')
            for num in nums:
                nf = footnotes[num - 1]
                body = []
                if nf['headline']:
                    body.append(nf['headline'])
                body.extend(nf['summary'])
                for src in nf['sources']:
                    lab = (src.get('school') + ' · ' if src.get('school') else '') + src['ref']
                    body.append(f"{lab}: {src['quote']}" if src.get('quote') else lab)
                    if src.get('context'):
                        body.append('Context: ' + src['context'])
                    if src.get('explanation'):
                        body.append('Explanation: ' + src['explanation'])
                if nf['seeNotes'] and nf['type'] == 'see-note':
                    body.append('See note ' + ', '.join(map(str, nf['seeNotes'])) + '.')
                lines.append(f"[{num}] " + '\n    '.join(body))
    (outdir / 'tzidkat_hatzadik_editorial_master.txt').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps(edition['stats'], ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

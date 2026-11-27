#!/usr/bin/env python3
"""Pri Tzaddik Vayikra, Bamidbar and Devarim: the Akiva Publishing interlinear Word editions (November 2026) as reader study
chapters, in the shape of the Moadim edition (scripts/pri-moadim/build.py): one chapter per os, [{"h": heading}, {"h": headline},
{"p": [[hebrew phrase, english phrase], ...], "n": k, ...}].
 - Paragraphs follow the library's Hebrew paragraphs (so every existing ref, "Peri Tzadik, Emor 11:2", stays the same): the Word
   paragraphs are merged into them by each library paragraph's opening words (parse_docx.align).
 - Heading 2 (the maamar's topical headline) is the chapter title; Heading 3 lines are inlineHeadings at their phrase.
 - Footnotes are the Word edition's source notes, numbered in reading order per volume; its "Parallels." notes are not footnotes
   in the reader (they belong in the Parallels panel). Every link is a Sefaria link.
Usage: build.py   (reads sources/akiva/pri-vbd-20261126/*.docx, writes sources/akiva/overlays/pri-vbd-20261126/)"""
import hashlib, html, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
SOURCE = Path('sources/akiva/pri-vbd-20261126'); OUTPUT = Path('sources/akiva/overlays/pri-vbd-20261126')
EDITION = 'pri-vbd-20261126-v1'; FIRST_ID = 5000   # Shemos 3000–3147, Bereishis 3400–3549, Moadim 3600–3799, Purim 4000–4068, Pesach 4100–4168
VOLUMES = [{'volume': 1, 'file': 'Pri_Tzaddik_Vayikra.docx', 'label': 'Sefer Vayikra', 'he': 'ספר ויקרא', 'download': 'pri-tzaddik-vayikra-interlinear.docx', 'pdf': 'pri-tzaddik-vayikra-interlinear.pdf'},
           {'volume': 2, 'file': 'Pri_Tzaddik_Bamidbar.docx', 'label': 'Sefer Bamidbar', 'he': 'ספר במדבר', 'download': 'pri-tzaddik-bamidbar-interlinear.docx', 'pdf': 'pri-tzaddik-bamidbar-interlinear.pdf'},
           {'volume': 3, 'file': 'Pri_Tzaddik_Devarim.docx', 'label': 'Sefer Devarim', 'he': 'ספר דברים', 'download': 'pri-tzaddik-devarim-interlinear.docx', 'pdf': 'pri-tzaddik-devarim-interlinear.pdf'}]
esc = lambda s: html.escape(s, quote=False)
digest = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
wr = lambda p, v: Path(p).write_text(json.dumps(v, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'
def he_num(n):
    out = ''
    for v, c in ((100,'ק'),(90,'צ'),(80,'פ'),(70,'ע'),(60,'ס'),(50,'נ'),(40,'מ'),(30,'ל'),(20,'כ'),(10,'י')):
        while n >= v: out += c; n -= v
    if n: out += LETTERS[n-1]
    out = out.replace('יה', 'טו').replace('יו', 'טז')
    return out + '׳' if len(out) == 1 else out[:-1] + '״' + out[-1]
def wr(p, value):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def plain(s): return re.sub(r'\s+', ' ', s).strip()
def build():
    import parse_docx as P   # lxml: needed only to rebuild from the Word files, not to publish
    sections, volumes, used = [], [], set()
    for v in VOLUMES:
        secs, notes = P.parse(str(SOURCE / v['file'])); number = 0; vol_notes = 0
        for s in secs:
            r, err = P.align(s); assert r, (v['file'], s['parsha_he'], s['ois'], err)
            leaf, groups = r; ref = f"{leaf['ref']} {s['ois']}"; assert ref not in used, ref; used.add(ref)
            parashah = s['heading_en'].split(' — ')[0].replace('Parshas ', '').strip() or leaf['en']
            sec = {'ref': ref, 'en': f"{parashah}, {s['ois']}", 'he': s['heading_he'], 'parashah': parashah, 'heGroup': s['heading_he'].rsplit(',', 1)[0],
                   'ois': s['ois'], 'id': FIRST_ID + len(sections), 'volume': v['volume'], 'title': s['title'] or f"{parashah}, {s['ois']}",
                   'heRef': 'פרי צדיק, ' + s['heading_he']}
            items = [{'h': s['heading_he'] + ' ' + sec['en']}, {'h': sec['title']}]
            for n, group in enumerate(groups, 1):
                pairs, inline, foot = [], [], []
                for it in group:
                    base = len(pairs)
                    for t in it.get('headings', []): inline.append({'phraseIndex': base, 'text': t, 'kind': 'subsection'})
                    pairs += [[esc(h), esc(e)] for h, e in it['pairs']]
                    for pi, fid in it['notes']:
                        paras = notes[fid]
                        if paras[0]['text'].startswith('Parallels'): continue
                        number += 1; k = base + pi; he = re.sub(r'[ \t\u00a0]+', ' ', html.unescape(re.sub(r'<[^>]*>', '', pairs[k][0]))).strip()
                        foot.append({'number': number, 'sourceId': f"PTV{v['volume']}-{number:04d}", 'placementId': f"PTV{v['volume']}-{number:04d}-1",
                                     'phraseIndex': k, 'heCharOffset': len(he), 'heAnchorPrefix': he, 'heWord': len(he.split()), 'nativeConnections': [],
                                     'paragraphs': paras, 'sources': [{'ref': x['text'].strip(), 'url': x['href'], 'role': 'source'} for p_ in paras for x in p_['rich'] if x.get('href', '').startswith('https://www.sefaria.org/')][:8],
                                     'verificationStatus': 'verified'})
                assert all(h.strip() or e.strip() for h, e in pairs), ref
                item = {'p': pairs, 'keepPairs': True, 'n': n}
                if inline: item['inlineHeadings'] = inline
                if foot: item['footnotes'] = foot
                items.append(item)
            vol_notes += sum(len(x.get('footnotes', [])) for x in items)
            sec['items'] = items; sec['paragraphs'] = len(groups); sec['pairs'] = sum(len(x['p']) for x in items if 'p' in x)
            sec['notes'] = sum(len(x.get('footnotes', [])) for x in items); sections.append(sec)
        pdf = SOURCE / v['pdf']
        volumes.append({**v, 'download': v['download'], 'pdfDownload': v['pdf'], 'sha256': digest(SOURCE / v['file']), 'footnotes': vol_notes,
                        **({'pdfSha256': digest(pdf)} if pdf.exists() else {})})
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for old in OUTPUT.glob('*.json'): old.unlink()
    for s in sections: wr(OUTPUT / f"{s['id']}.json", s.pop('items'))
    m = {'edition': EDITION, 'sections': sections, 'volumes': volumes, 'footnotes': sum(s['notes'] for s in sections),
         'pairs': sum(s['pairs'] for s in sections), 'paragraphs': sum(s['paragraphs'] for s in sections),
         'groups': list(dict.fromkeys(s['parashah'] for s in sections))}
    wr(OUTPUT / 'manifest.json', m)
    print(json.dumps({k: m[k] for k in ('edition', 'footnotes', 'pairs', 'paragraphs')}), len(sections), 'chapters')
if __name__ == '__main__': build()

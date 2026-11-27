#!/usr/bin/env python3
"""Replace the quoted Gemara of notes that quote the wrong passage of the right daf (Pri Tzaddik Vayikra/Bamidbar/Devarim).

Usage: fix_quotes.py FIXES.json  (rows: {sid, title, daf, seg, new (Hebrew of the right segment), en, ctx_words})
The Hebrew quote becomes the part of the right segment that the maamar draws on, the English that segment's English
(Sefaria), and the note's Sefaria link points to that segment. The Oz Vehadar page stays: it is the same amud.
"""
import json, re, sys, zipfile, shutil, tempfile, html
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import parse_docx as P
import importlib.util
spec = importlib.util.spec_from_file_location('vbd_build', Path(__file__).with_name('build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
from lxml import etree
W = P.W; R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
NIK = re.compile(r'[֑-ׇ]')
def key(w): return re.sub(r'[^א-ת]', '', NIK.sub('', w)).translate(str.maketrans('ךםןףץ', 'כמנפצ'))


def fid_map(path, volume):
    secs, notes = P.parse(str(path)); number = 0; out = {}
    for s in secs:
        (leaf, groups), err = P.align(s)
        for group in groups:
            for it in group:
                for pi, fid in it['notes']:
                    if notes[fid][0]['text'].startswith('Parallels'): continue
                    number += 1; out[f"PTV{volume}-{number:04d}"] = fid
    return out


def excerpt(he, ctx, span=28):
    """The stretch of the segment (about span words) that shares most words with the maamar, with … where cut."""
    w = he.split(); c = set(ctx)
    if len(w) <= span + 6: return he
    best = max(range(0, len(w) - span + 1), key=lambda i: sum(1 for x in w[i:i + span] if key(x) in c))
    return ('… ' if best else '') + ' '.join(w[best:best + span]) + (' …' if best + span < len(w) else '')


def short_en(en, n=220):
    en = re.sub(r'\s+', ' ', en).strip()
    if len(en) <= n: return en
    return en[:n].rsplit(' ', 1)[0] + ' …'


def main(fixes_path):
    fixes = json.load(open(fixes_path)); done = 0
    for v in B.VOLUMES:
        todo = [f for f in fixes if f['sid'].startswith(f"PTV{v['volume']}-")]
        if not todo: continue
        path = B.SOURCE / v['file']; fids = fid_map(path, v['volume'])
        z = zipfile.ZipFile(path)
        fx = etree.fromstring(z.read('word/footnotes.xml')); rels = etree.fromstring(z.read('word/_rels/footnotes.xml.rels'))
        notes = {f.get(W + 'id'): f for f in fx.findall(W + 'footnote')}
        nid = max(int(m.group(1)) for r in rels for m in [re.match(r'rIdAkS(\d+)$', r.get('Id') or '')] if m) + 1
        for f in todo:
            note = notes.get(fids.get(f['sid']))
            if note is None: continue
            ts = list(note.iter(W + 't'))
            heb = next((t for t in ts if t.text and t.text.startswith('“') and re.search('[א-ת]', t.text)), None)
            eng = next((t for t in ts if t.text and t.text.startswith(' — “') and not re.search('[א-ת]', t.text)), None)
            link = note.find('.//' + W + 'hyperlink')
            if heb is None or eng is None or link is None: continue
            heb.text = '“' + excerpt(f['new'], f['ctx_words']) + '”'
            eng.text = ' — “' + short_en(f['en']) + '”'
            url = f"https://www.sefaria.org/{f['title'].replace(' ', '_')}.{f['daf']}.{f['seg']}"
            rid = f'rIdAkS{nid}'; nid += 1
            el = etree.SubElement(rels, '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship')
            el.set('Id', rid); el.set('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'); el.set('Target', url); el.set('TargetMode', 'External')
            link.set(R + 'id', rid); done += 1
        tmp = Path(tempfile.mktemp(suffix='.docx'))
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as out:
            for info in z.infolist():
                if info.filename == 'word/footnotes.xml': data = etree.tostring(fx, xml_declaration=True, encoding='UTF-8', standalone=True)
                elif info.filename == 'word/_rels/footnotes.xml.rels': data = etree.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)
                else: data = z.read(info.filename)
                out.writestr(info, data)
        z.close(); shutil.move(tmp, path)
    print('quotes corrected', done, 'of', len(fixes))


if __name__ == '__main__': main(sys.argv[1])

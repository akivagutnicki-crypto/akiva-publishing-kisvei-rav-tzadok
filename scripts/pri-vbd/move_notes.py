#!/usr/bin/env python3
"""Move notes of the Pri Tzaddik Vayikra/Bamidbar/Devarim Word editions to the phrase where the maamar cites their source.

Usage: move_notes.py MOVES.json   (rows: [section id, paragraph n, phrase, sourceId, target paragraph n, target phrase, label])
The Word files under sources/akiva/pri-vbd-20261126/ are rewritten in place (document.xml only); then rerun build.py.
Phrases and notes are resolved exactly as build.py resolves them (parse_docx.parse + align), so a reader phrase and the
Word run it comes from are the same thing. The footnote reference run moves to just after the target phrase's Hebrew
run (after any notes already there).
"""
import json, re, sys, zipfile, shutil, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import parse_docx as P
import importlib.util
spec = importlib.util.spec_from_file_location('vbd_build', Path(__file__).with_name('build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
from lxml import etree
W = P.W


def main(moves_path):
    moves = json.load(open(moves_path))
    man = json.load(open(B.OUTPUT / 'manifest.json'))
    ref_of = {s['id']: s['ref'] for s in man['sections']}
    by_vol = {}
    for row in moves: by_vol.setdefault(int(row[3][3]), []).append(row)
    for v in B.VOLUMES:
        todo = by_vol.get(v['volume'])
        if not todo: continue
        path = B.SOURCE / v['file']
        z = zipfile.ZipFile(path); doc = etree.fromstring(z.read('word/document.xml'))
        # the same parse as build.py, but over this tree so the run elements are the ones we save
        orig_load = P.load
        P.load = lambda p_, _d=doc: (_d, orig_load(p_)[1])
        try: secs, notes = P.parse(str(path))
        finally: P.load = orig_load
        number = 0; fid_of = {}; run_of = {}
        for s in secs:
            (leaf, groups), err = P.align(s)
            ref = f"{leaf['ref']} {s['ois']}"
            for n, group in enumerate(groups, 1):
                base = 0
                for it in group:
                    for j in range(len(it['pairs'])):
                        run_of[(ref, n, base + j)] = it['hr'][it['off'] + j] if it.get('hr') else None
                    for pi, fid in it['notes']:
                        if notes[fid][0]['text'].startswith('Parallels'): continue
                        number += 1; fid_of[f"PTV{v['volume']}-{number:04d}"] = fid
                    base += len(it['pairs'])
        refs = {r.get(W + 'id'): r for r in doc.iter(W + 'footnoteReference')}
        done = skipped = 0
        for sec_id, n, i, sid, tn, tj, label in todo:
            fid = fid_of.get(sid); target = run_of.get((ref_of[sec_id], tn, tj))
            if fid is None or target is None or fid not in refs: skipped += 1; continue
            run = refs[fid].getparent()
            if run.tag != W + 'r' or run is target: skipped += 1; continue
            # after the target's Hebrew run and the note references already following it
            at = target
            while at.getnext() is not None and at.getnext().tag == W + 'r' and at.getnext().find(W + 'footnoteReference') is not None and at.getnext() is not run:
                at = at.getnext()
            run.getparent().remove(run); at.addnext(run); done += 1
        tmp = Path(tempfile.mktemp(suffix='.docx'))
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as out:
            for info in z.infolist():
                data = etree.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True) if info.filename == 'word/document.xml' else z.read(info.filename)
                out.writestr(info, data)
        z.close(); shutil.move(tmp, path)
        print(v['file'], 'moved', done, 'skipped', skipped)


if __name__ == '__main__': main(sys.argv[1])

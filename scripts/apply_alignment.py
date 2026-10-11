#!/usr/bin/env python3
"""Replace a study-edition JSON's phrase pairs with the pairs from an authoritative interlinear .docx.

Keeps each section's topic headings, re-places topic boundaries by English alignment, and remaps
footnote `phraseIndex` values in annotation files so Word footnotes stay on the same phrase.
Sefaria links are untouched: the build derives them from the English text, which is kept verbatim.

  apply_alignment.py --docx D --edition E --map 0:0,1:1,... [--skip 17,18] [--annotations DIR] [--apply]
Without --apply it only prints a report.
"""
import argparse, difflib, glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docx_pairs import read_sections, read_paragraph_sections, es

def mapper(old, new):
    a = [es(p[1]) for p in old]; b = [es(p[1]) for p in new]
    ops = difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
    def f(i):
        for tag, i1, i2, j1, j2 in ops:
            if i1 <= i < i2:
                if tag == 'equal': return j1 + i - i1
                return j1 + min(i - i1, max(j2 - j1 - 1, 0))
        return len(new) - 1
    return f, [o for o in ops if o[0] != 'equal']

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--docx', required=True); ap.add_argument('--edition', required=True)
    ap.add_argument('--map', required=True, help='docxSectionIdx:editionSectionIdx,...')
    ap.add_argument('--skip', default='', help='edition section indexes to leave untouched')
    ap.add_argument('--format', choices=['inline', 'paragraph'], default='inline',
                    help='inline = Hebrew/English runs alternate inside paragraphs (Pri Tzaddik); paragraph = Hebrew paragraph then English paragraph (Tiferet Yosef)')
    ap.add_argument('--annotations'); ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    secs = (read_paragraph_sections if a.format == 'paragraph' else read_sections)(a.docx)
    ed = json.load(open(a.edition)); skip = {int(x) for x in a.skip.split(',') if x}
    notes = {}
    if a.annotations:
        for f in glob.glob(os.path.join(a.annotations, '*.json')):
            notes[f] = json.load(open(f))
    changed_notes = set()
    for pair in a.map.split(','):
        di, ji = map(int, pair.split(':'))
        s = ed['sections'][ji]; label = f"{s['node']} {s['chapter']}"
        if ji in skip: print(f'[skip ] edition {ji} {label}'); continue
        old = [p for t in s['topics'] for p in t['pairs']]; new = secs[di]['pairs']
        f, diffs = mapper(old, new)
        starts, c = [], 0
        for t in s['topics']: starts.append(c); c += len(t['pairs'])
        nstarts = [f(x) for x in starts]; nstarts.append(len(new))
        for k in range(1, len(nstarts)): nstarts[k] = max(nstarts[k], nstarts[k-1])
        print(f"[{'apply' if a.apply else 'dry  '}] docx {di} -> edition {ji} {label}: {len(old)} -> {len(new)} phrases, {len(diffs)} boundary edits")
        for nf, nd in notes.items():
            for n in nd['notes']:
                if nd.get('parashah') == s['node'] and n.get('ois') == s['chapter'] and n['topicIndex'] < len(starts):
                    g = f(starts[n['topicIndex']] + n['phraseIndex'])
                    ni = g - nstarts[n['topicIndex']]
                    cnt = nstarts[n['topicIndex'] + 1] - nstarts[n['topicIndex']]
                    if not 0 <= ni < cnt: raise SystemExit(f'footnote {n["number"]} falls outside its topic')
                    if ni != n['phraseIndex']: print(f"    footnote {n['number']}: phraseIndex {n['phraseIndex']} -> {ni}")
                    n['phraseIndex'] = ni; changed_notes.add(nf)
        for k, t in enumerate(s['topics']): t['pairs'] = new[nstarts[k]:nstarts[k+1]]
        s['useVerifiedHebrew'] = True; s['sourceDocument'] = os.path.basename(a.docx)
    if a.apply:
        json.dump(ed, open(a.edition, 'w'), ensure_ascii=False, separators=(',', ':'))
        for nf in changed_notes: json.dump(notes[nf], open(nf, 'w'), ensure_ascii=False, indent=2)
        print('written:', a.edition, *changed_notes)
main()

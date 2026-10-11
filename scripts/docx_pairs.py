#!/usr/bin/env python3
"""Extract clean [hebrew, english] phrase pairs from an Akiva Publishing interlinear .docx.

Docx layout: Heading 2 = Hebrew section label, Heading 3 = English title, body paragraphs are a
flowing run of  <Hebrew phrase (RTL runs)> <English phrase (LTR runs)>  pairs.  Word's bidi handling
leaves the Hebrew phrase's trailing punctuation / vowel marks (e.g. '", ' or 'ׁ, ' or '): ') at the
START of the next English run; we hand that first stray token back to the Hebrew side.
"""
import re, sys, json
import docx

def hs(s): return re.sub(r'[^א-ת]', '', s)          # Hebrew consonant skeleton
def es(s): return re.sub(r'[^a-z0-9]', '', s.lower())         # English alnum skeleton

def _chunks(p):
    ch = []
    for r in p.runs:
        rtl = bool(r.font.rtl)
        if ch and ch[-1][0] == rtl: ch[-1][1] += r.text
        else: ch.append([rtl, r.text])
    return ch

def _pairs_in_paragraph(p):
    pairs, h, e = [], None, None
    for rtl, t in _chunks(p):
        if rtl:
            # Hebrew inside an English parenthetical, e.g.  the word "shor" (שׁוֹר) -> stays inline in the English
            if e is not None and re.search(r'[(\[=]\s*$', e) and len(t.split()) <= 2:
                e += t; continue
            if h is not None and e is not None:
                pairs.append([h, e]); h = e = None
            h = (h or '') + t
        else:
            if h is None: continue            # leading English-only line (section summary)
            e = (e or '') + t
    if h is not None: pairs.append([h, e or ''])
    # A Hebrew-only line is the first half of a Hebrew phrase that the docx wraps onto the next line
    merged = []; carry = ''
    for k, (h, e) in enumerate(pairs):
        if carry: h, carry = carry + ' ' + h, ''
        if not e.strip() and k < len(pairs) - 1: carry = h; continue
        merged.append([h, e])
    pairs = merged
    out = []
    for h, e in pairs:
        m = re.match(r'^(\S*)\s+(.*)$', e, re.S)
        if m and m.group(1) and not re.search(r'[A-Za-z0-9]', m.group(1)):
            h, e = h + m.group(1), m.group(2)
        out.append([re.sub(r'\s+', ' ', h).strip(), re.sub(r'\s+', ' ', e).strip()])
    return out

def read_sections(path):
    """-> [{'he': H2, 'en': H3, 'summary': str, 'pairs': [[he,en],...], 'paras': [n_pairs,...]}]"""
    d = docx.Document(path); secs = []; cur = None
    for p in d.paragraphs:
        txt = p.text.strip()
        if not txt: continue
        st = p.style.name
        if st == 'Heading 2': cur = {'he': txt, 'en': None, 'summary': None, 'pairs': [], 'paras': []}; secs.append(cur)
        elif st == 'Heading 3': cur['en'] = txt
        elif cur is not None:
            pr = _pairs_in_paragraph(p)
            if not pr and cur['summary'] is None: cur['summary'] = txt; continue
            cur['pairs'] += pr; cur['paras'].append(len(pr))
    for sec in secs:      # a Hebrew-only paragraph tail wraps onto the next paragraph's first pair
        out, carry = [], ''
        for h, e in sec['pairs']:
            if carry: h, carry = carry + ' ' + h, ''
            out.append([h, e])
            if not e.strip() and len(out) < len(sec['pairs']): carry = out.pop()[0]
        sec['pairs'] = out
    return secs

if __name__ == '__main__':
    for i, s in enumerate(read_sections(sys.argv[1])):
        print(i, s['he'], '|', s['en'], '|', len(s['pairs']), 'pairs')

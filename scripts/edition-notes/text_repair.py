#!/usr/bin/env python3
"""Restore the wording of Tanach, Mishnah and Rambam quotations in edition notes taken from Sefaria's texts.

Three defects came from flattening Sefaria's markup: the maqaf was removed with the nikkud, fusing words
(כלמלאכתך -> כל מלאכתך); parasha markers {ס} {פ} and Aleppo kesiv notes *(...) stayed in the Hebrew; and in the
English the translator's inline footnotes, acrostic letters, and poetry line breaks were flattened
("you<sup>b</sup><i>…</i> shall" -> "youbyou Including … shall"; "Paran,And"). repair-maps.json.gz holds the exact
broken -> source forms, built from the source texts themselves, so only text that came from them changes.
fix(text) -> (text, number of repairs); fix_html(html) repairs the text between tags only."""
import gzip, json, re
from pathlib import Path
_M = json.loads(gzip.decompress((Path(__file__).with_name('repair-maps.json.gz')).read_bytes()))
HE, CUTS = _M['he'], _M['cut']
EN = {}
for a, b in _M['en']:
    EN.setdefault(a[:10], []).append((a, b))
for v in EN.values(): v.sort(key=lambda x: -len(x[0]))
HEWORD = re.compile(r'[א-ת]{4,}')
MARK = re.compile(r'\s*\{[פסש]\}|\s*\*\([^)]{0,80}\)')
ACRO = re.compile(r'(?<=[\s“‘;,.])[\u05d0-\u05ea](?=[A-Z][a-z])')
CUT = re.compile(r'(?<=[a-z;,.:!?”’)\]])([a-z]{1,2})(?=[A-Z“"\[(])')


def fix(t):
    if not t: return t, 0
    n = 0; orig = t
    def he(m):
        nonlocal n
        w = m.group(0)
        if w in HE: n += 1; return HE[w]
        return w
    t = HEWORD.sub(he, t)
    t, k = MARK.subn('', t); n += k
    out, i, L = [], 0, len(t)
    while i < L:
        for a, b in EN.get(t[i:i + 10], ()):
            if t.startswith(a, i): out.append(b); i += len(a); n += 1; break
        else: out.append(t[i]); i += 1
    t = ''.join(out)
    for m in reversed(list(CUT.finditer(t))):          # a translator footnote cut off by the excerpt's end
        body = t[m.end():]; full = CUTS.get(body[:14])
        if not full: continue
        seg = re.match(r'(.*?)( …”?|…”?|”)?$', body, re.S).group(1)
        if full.startswith(seg.rstrip()) or seg.startswith(full):
            t = t[:m.start()] + body[len(full) if seg.startswith(full) else len(seg):]; n += 1
    t, k = ACRO.subn('', t); n += k                      # acrostic letters of Tehillim/Eichah in the English
    return t, (n if t != orig else 0)


def fix_html(h):
    total = 0
    def part(s):
        nonlocal total
        r, k = fix(s); total += k; return r
    return ''.join(x if x.startswith('<') else part(x) for x in re.split(r'(<[^>]*>)', h or '')), total

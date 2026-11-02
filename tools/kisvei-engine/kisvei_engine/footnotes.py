"""Draft footnotes for a paragraph of Kisvei Rav Tzadok in the Akiva editorial format.

A draft note is a structured candidate (not final prose): the editor (or a Claude session with the
Sefaria tools) confirms the source text, writes the Context / Explanation sentence, and approves.

Note shapes (matching the Tzidkat HaTzadik Complete Editorial Master):
  source   : **<Sefaria ref>** (linked): ‘<quoted source text>’  + optional Context: ...
  parallel : **<headline>**  <one-sentence bridge>  **Kisvei Rav Tzadok · <ref>**: “<quote>”  Explanation: ...
  internal : **<library ref>** (reader link): “<quote>”  Context: ...
"""
import re
from .citations import detect, detect_quotes
from .sefaria import sefaria_url, normalize_ref
from .hebrew import strip_nikkud

READER = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/'


def reader_url(ref):
    from urllib.parse import quote
    return READER + quote(ref.replace(' ', '_'), safe="_,:'()-")


def anchor_phrase(pairs, span_start, he_joined):
    """Map a character span in the joined Hebrew back to (phraseIndex, offset inside phrase)."""
    pos = 0
    for i, pr in enumerate(pairs):
        he = pr[0] if isinstance(pr, (list, tuple)) else pr
        if span_start < pos + len(he) + 1:
            return i, max(0, min(span_start - pos, len(he)))
        pos += len(he) + 1
    return max(0, len(pairs) - 1), 0


def _phrases(index, ref):
    """The paragraph's Hebrew phrases (interlinear) or ~8-word windows (Hebrew-only)."""
    P = index.paras[ref]
    if P.get('phrases'):
        return P['phrases']
    w = P['he'].split()
    return [' '.join(w[i:i + 8]) for i in range(0, len(w), 8)]


def draft_for_paragraph(index, ref, limit=6, zohar=None, with_parallels=True, memory=None):
    P = index.paras[ref]
    he = P['he']
    pairs = [[h] for h in he.split(' ')] if not P.get('en') else None
    drafts = []
    # 1. explicit citations in the Hebrew
    for d in detect(he):
        if not d.get('ref'):
            continue
        r = d['ref']
        url = None
        if d['kind'] == 'zohar-daf' and zohar is not None:
            z = zohar.resolve(f"Zohar {d['volume']}:{d['daf']}")
            if z and z.get('ok'):
                r, url = z['ref'], z['url']
        drafts.append({'type': 'source', 'ref': normalize_ref(r), 'url': url or sefaria_url(normalize_ref(r)), 'anchorText': d['text'],
                       'charOffset': d['span'][0], 'confidence': d['confidence'], 'evidence': 'explicit citation in the Hebrew',
                       'todo': 'fetch the source text from Sefaria (bulktext), quote the relevant words, add Context'})
    # 2. verbatim quotations (text set in quotation marks) to be located by exact search
    for q in detect_quotes(he):
        drafts.append({'type': 'quotation-lookup', 'hebrewQuote': q['text'], 'charOffset': q['span'][0], 'confidence': 0.5,
                       'evidence': 'quoted words in the Hebrew', 'todo': 'exact-phrase search on Sefaria (search-wrapper, field exact) to pinpoint the verse or segment'})
    # 2b. sources the editors attached to the same or similar wording in other seforim (footnote memory),
    #     with how they quoted that source and the context they wrote, as worked examples
    if memory is not None:
        book = P['book']
        seen = {d['ref'] for d in drafts if d['type'] == 'source'}
        for k, phrase in enumerate(_phrases(index, ref)):
            for sug in memory.suggest(phrase, limit=3, exclude=lambda r, b=book: r['para'].startswith(b)):
                if sug['score'] < 6 or sug['ref'] in seen:
                    continue
                seen.add(sug['ref'])
                drafts.append({'type': 'source', 'ref': sug['ref'], 'url': sefaria_url(sug['ref']), 'anchorText': strip_nikkud(phrase),
                               'phraseIndex': k, 'confidence': round(min(0.85, sug['score'] / 40), 2),
                               'evidence': 'editors cited this source for the same wording: ' + ' / '.join(sug['sharedWording'][:3]),
                               'previousFootnotes': memory.quotes_for(sug['ref'], phrase=phrase) or sug['examples'],
                               'todo': 'confirm the source applies here; start the quotation from the earlier footnotes and check it against the source text; adapt the context'})
        for d in drafts:
            if d['type'] == 'source' and 'previousFootnotes' not in d:
                prev = memory.quotes_for(d['ref'], phrase=d.get('anchorText'))
                if prev:
                    d['previousFootnotes'] = prev
    # 3. parallels in the library
    if with_parallels:
        for cand in index.find(ref, limit=limit):
            f = cand['features']
            school = 'Ishbitz–Radzin' if cand['book'] in ('Beit Yaakov on Torah', 'Sod Yesharim', 'Tiferet Yosef', 'Mei HaShiloach', "Sha'ar HaEmunah VeYesod HaChasidut") else 'Kisvei Rav Tzadok'
            drafts.append({'type': 'parallel', 'school': school, 'ref': cand['ref'], 'url': reader_url(cand['ref']), 'score': cand['score'],
                           'sharedSources': f['sharedSources'][:5], 'sharedQuotes': f['sharedQuotes'][:3], 'rareTerms': f['rareTerms'][:6],
                           'hebrewPreview': strip_nikkud(index.paras[cand['ref']]['he'])[:240],
                           'todo': 'read both passages; write the headline, bridge sentence and Explanation; quote the parallel in English'})
    return {'ref': ref, 'hebrew': he, 'candidates': drafts}


def annotate_book(index, book_or_slug, limit=6, zohar=None, memory=None):
    key = book_or_slug.lower()
    out = {'book': book_or_slug, 'paragraphs': []}
    for ref, P in index.paras.items():
        if P['book'].lower() == key or P['book'].lower().replace(' ', '-') == key:
            out['paragraphs'].append(draft_for_paragraph(index, ref, limit=limit, zohar=zohar, memory=memory))
    return out


def render_markdown(draft):
    lines = [f"### {draft['ref']}", '', strip_nikkud(draft['hebrew'])[:400], '']
    n = 0
    for c in draft['candidates']:
        n += 1
        if c['type'] == 'source':
            lines.append(f"[{n}] **[{c['ref']}]({c['url']})**: ‘…’ — _{c['evidence']}_ (anchor: {c['anchorText']})")
        elif c['type'] == 'quotation-lookup':
            lines.append(f"[{n}] quotation to locate: „{c['hebrewQuote']}“")
        else:
            lines.append(f"[{n}] **Kisvei {c['school']} · [{c['ref']}]({c['url']})** (score {c['score']}) shared: {', '.join(c['sharedSources'][:3])} {' / '.join(c['sharedQuotes'][:2])}")
    return '\n'.join(lines)

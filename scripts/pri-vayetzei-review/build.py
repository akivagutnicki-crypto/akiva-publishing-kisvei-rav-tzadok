#!/usr/bin/env python3
"""Pri Tzaddik Vayetzei 1-10, Akiva Publishing interlinear study edition with reviewed footnotes (2026-11-03).

Input:  sources/akiva/overlays/pri-vayetzei-review/osNN-interlinear.json  {os, title, paragraphs:[{src, heading?, phrases:[[he,en]]}], editor_notes}
        sources/akiva/overlays/pri-vayetzei-review/osNN-notes.json        reviewers' notes anchored to [paragraph n, phrase i] (+ "links")
Output: sources/akiva/overlays/pri-vayetzei-review/reader/<id>.json        the reader's chapter files
        sources/akiva/overlays/pri-vayetzei-review/reader/meta.json        ids, titles, counts, the source links of each maamar
Footnotes: {number, phraseIndex, heCharOffset, heAnchorPrefix, heWord, nativeConnections, paragraphs:[{rich, text}]}; numbers run in
reading order within each os; a source note comes before the parallel notes on the same word. Links in the notes become linked runs
(Sefaria, or #/read/ for the library).
"""
import json, re, html, glob, os, sys

D = 'sources/akiva/overlays/pri-vayetzei-review'
FIRST_ID = 801                        # chapter files 801-810 (free on the live site: the highest file there is 202)
KIND = {'source': 0, 'parallels': 1, 'beyond': 2}
HEB = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י']

def plain(s): return html.unescape(re.sub(r'<[^>]+>', '', s or ''))
def bare(s): return re.sub(r'[֑-ׇ]', '', s)
LINK = r'\[([^\]]+)\]\(((?:https://www\.sefaria\.org/|#/read/)[^)\s]+)\)'

def rich(md):
    runs, pos = [], 0
    for m in re.finditer(r'\*\*' + LINK + r'\*\*|\*\*(.+?)\*\*|\*([^*]+?)\*|' + LINK, md):
        if m.start() > pos: runs.append({'text': md[pos:m.start()]})
        if m.group(1) is not None: runs.append({'bold': True, 'text': m.group(1), 'href': m.group(2)})
        elif m.group(3) is not None: runs.append({'bold': True, 'text': m.group(3)})
        elif m.group(4) is not None: runs.append({'italic': True, 'text': m.group(4)})
        else: runs.append({'text': m.group(5), 'href': m.group(6)})
        pos = m.end()
    if pos < len(md): runs.append({'text': md[pos:]})
    runs = [r for r in runs if r['text']]
    for r in runs:
        if r.get('href', '').startswith('#/read/'): r['readerRef'] = r['href'][7:].replace('_', ' ')
    return {'rich': runs, 'text': ''.join(r['text'] for r in runs)}

def locate(phrase, anchor):
    a = (anchor or '').strip()
    if a and a in phrase: return phrase.index(a) + len(a)
    idx = [i for i, c in enumerate(phrase) if not ('֑' <= c <= 'ׇ')]
    pb, ab = ''.join(phrase[i] for i in idx), bare(a)
    if ab and ab in pb:
        end = pb.index(ab) + len(ab) - 1
        j = idx[end] + 1
        while j < len(phrase) and '֑' <= phrase[j] <= 'ׇ': j += 1
        return j
    return None

def category(ref):
    if re.match(r'^(Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|I+ Samuel|I+ Kings|Isaiah|Jeremiah|Ezekiel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Psalms|Proverbs|Job|Song of Songs|Ruth|Lamentations|Ecclesiastes|Esther|Daniel|Ezra|Nehemiah|I+ Chronicles) ', ref): return 'Tanakh'
    if ref.startswith(('Zohar', 'Tikkunei')): return 'Kabbalah'
    if 'Rabbah' in ref or ref.startswith(('Midrash', 'Pesikta', 'Pirkei DeRabbi', 'Mekhilta', 'Sifrei', 'Sifra', 'Yalkut', 'Tanchuma')): return 'Midrash'
    if ref.startswith(('Rashi', 'Tosafot', 'Ramban', 'Rabbeinu')): return 'Commentary'
    if ref.startswith(('Mishneh Torah', 'Shulchan Arukh')): return 'Halakhah'
    if ref.startswith(('Pri Etz', 'Etz Chaim', "Sha'ar", 'Shaar')): return 'Kabbalah'
    if re.match(r'^Jerusalem Talmud|^[A-Z][a-z]+( [A-Z][a-z]+)? \d+[ab]', ref): return 'Talmud'
    return 'Commentary'

def main():
    out_dir = os.path.join(D, 'reader'); os.makedirs(out_dir, exist_ok=True)
    meta, problems = {'edition': 'pri-vayetzei-review-20261103', 'maamarim': []}, []
    for f in sorted(glob.glob(os.path.join(D, 'os[0-9][0-9]-interlinear.json'))):
        il = json.load(open(f, encoding='utf-8')); k = int(il['os']); ref = f'Peri Tzadik, Vayetzei {k}'; cid = FIRST_ID + k - 1
        paras = il['paragraphs']
        nf = os.path.join(D, f'os{k:02d}-notes.json')
        nd = json.load(open(nf, encoding='utf-8')) if os.path.exists(nf) else {'notes': [], 'links': []}
        # vocalization / expansion corrections the footnote review found in quoted sources (the printed words stay)
        for x in nd.get('interlinear_fixes', []):
            n, i = int(x['n']), int(x['i'])
            if re.sub(r'[^א-ת]', '', bare(x['he_from'])) != re.sub(r'[^א-ת]', '', bare(x['he_to'])):
                print('LETTERS CHANGE (expansion fix, check it):', k, n, i, x['he_from'], '->', x['he_to'], '|', x.get('why', '')[:80])
            if 1 <= n <= len(paras) and i < len(paras[n - 1]['phrases']):
                ph = paras[n - 1]['phrases'][i]
                if ph[0] == x['he_from'] or bare(ph[0]).replace('־', ' ').split() == bare(x['he_from']).replace('־', ' ').split():
                    ph[0] = x['he_to']
                elif x['he_from'] in ph[0] and ph[0].count(x['he_from']) == 1:      # a single word of the phrase
                    ph[0] = ph[0].replace(x['he_from'], x['he_to'])
                    if x.get('en_to'): ph[1] = x['en_to']
                elif ph[0] != x['he_to']: problems.append((k, n, i, 'interlinear fix does not match: ' + x['he_from'][:30]))
        text = {n: [plain(h) for h, _ in p['phrases']] for n, p in enumerate(paras, 1)}
        placed = []
        for x in nd['notes']:
            n, i = int(x['n']), int(x['i'])
            ph = text.get(n)
            if not ph or i >= len(ph): problems.append((k, n, i, 'no such phrase')); continue
            at = locate(ph[i], x.get('anchor'))
            if at is None: problems.append((k, n, i, 'anchor not found: ' + (x.get('anchor') or '')[:30])); at = len(ph[i].rstrip())
            while at < len(ph[i]) and ph[i][at] not in ' ־,.;:)"\'״׳”—-!?' and ph[i][at - 1:at].strip(): at += 1
            placed.append((n, i, at, KIND.get(x.get('kind'), 0), x))
        placed.sort(key=lambda t: (t[0], t[1], t[2], t[3]))
        notes = {}
        for num, (n, i, at, _, x) in enumerate(placed, 1):
            prefix = text[n][i][:at]
            notes.setdefault(n, []).append({'number': num, 'phraseIndex': i, 'heCharOffset': at, 'heAnchorPrefix': prefix,
                                            'heWord': len(prefix.split()), 'nativeConnections': [],
                                            'paragraphs': [rich(p.strip()) for p in re.split(r'\n+', x['text']) if p.strip()]})
        items = [{'h': f"Vayetzei Ois {k} · {il['title']}"}]
        for n, p in enumerate(paras, 1):
            if p.get('heading'): items.append({'h': p['heading']})
            it = {'n': n, 'p': [[h, e] for h, e in p['phrases']], 'keepPairs': True}
            if notes.get(n): it['footnotes'] = notes[n]
            items.append(it)
        json.dump(items, open(os.path.join(out_dir, f'{cid}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        links, seen = [], set()
        for l in nd.get('links', []):
            n, r = int(l['n']), l['ref'].strip()
            if 1 <= n <= len(paras) and (n, r) not in seen: seen.add((n, r)); links.append({'a': f'{ref}:{n}', 'c': category(r), 'r': r})
        meta['maamarim'].append({'ref': ref, 'id': cid, 'ois': k, 'title': il['title'], 'he': f'וַיֵּצֵא, מַאֲמָר {HEB[k]}׳',
                                 'paragraphs': len(paras), 'notes': len(placed), 'links': links})
        print(ref, 'paragraphs', len(paras), 'phrases', sum(len(p['phrases']) for p in paras), 'notes', len(placed), 'links', len(links))
    json.dump(meta, open(os.path.join(out_dir, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for p in problems: print('CHECK', p)
    return problems

if __name__ == '__main__':
    sys.exit(1 if main() and '--strict' in sys.argv else 0)

#!/usr/bin/env python3
"""Offline verification of internal library cross-references against the locally built MCP text.

For every library ref cited by the edition (out/verify/lib*.json batches), resolve it against
dist/mcp-data/text/*.json paragraph refs (exact, section-level, dash/en-dash range variants),
and check whether the edition's English quotation shares a 6-word window with the library English.
Writes result_libNNN.json in the same shape the agents produced, for the batches not yet done.
"""
import glob
import json
import os
import re
import sys

MCP = sys.argv[1]
VER = sys.argv[2]
READER = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/'

paras = {}
sections = {}
for f in glob.glob(os.path.join(MCP, 'text', '*.json')):
    d = json.load(open(f, encoding='utf-8'))
    for p in d['paras']:
        en = ' '.join(re.sub(r'<[^>]+>', '', pr[1]) for pr in p.get('p', [])) if p.get('p') else ''
        he = ' '.join(re.sub(r'<[^>]+>', '', pr[0]) for pr in p.get('p', [])) if p.get('p') else (p.get('he') or '')
        paras[p['r']] = (he, en)
        sec = p['r'].rsplit(':', 1)[0] if re.search(r':\d+$', p['r']) else p['r']
        sections.setdefault(sec, []).append(p['r'])


def norm(s):
    s = s.lower().replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    s = re.sub(r"[^a-z0-9' ]+", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def quote_match(quote, text):
    q = norm(quote).split()
    t = norm(text)
    if len(q) < 6:
        return (' '.join(q) in t) if q else None
    for i in range(len(q) - 5):
        if ' '.join(q[i:i + 6]) in t:
            return True
    return False


def resolve(ref):
    r = ref.strip().replace('–', '-')
    cands = [r, ref]
    m = re.match(r'^(.*?)(\d+):(\d+)-(\d+)$', r)
    if m:
        cands += [f'{m.group(1)}{m.group(2)}:{m.group(3)}', f'{m.group(1)}{m.group(2)}']
    m = re.match(r'^(.*?)(\d+)-(\d+)$', r)
    if m:
        cands += [f'{m.group(1)}{m.group(2)}']
    for c in cands:
        if c in paras:
            return c, [c]
        if c in sections:
            return c, sections[c]
    # Peri Tzadik parshah naming variants
    alt = r.replace('Parshat ', '').replace('Parashat ', '')
    if alt in paras:
        return alt, [alt]
    if alt in sections:
        return alt, sections[alt]
    return None, []


done = {os.path.basename(f)[7:-5] for f in glob.glob(os.path.join(VER, 'result_lib*.json'))}
total = ok = 0
for bf in sorted(glob.glob(os.path.join(VER, 'lib*.json'))):
    bid = os.path.basename(bf)[:-5]
    if bid in done or not re.fullmatch(r'lib\d+', bid):
        continue
    batch = json.load(open(bf, encoding='utf-8'))
    out = []
    for item in batch['refs']:
        total += 1
        canon, refs = resolve(item['ref'])
        if not canon:
            out.append({'input': item['ref'], 'ok': False, 'canonicalRef': None, 'readerUrl': None, 'language': None, 'quoteMatch': None, 'resolvedRef': None, 'error': 'not-found', 'method': 'offline-mcp-text'})
            continue
        ok += 1
        en = ' '.join(paras[r][1] for r in refs)
        lang = 'english' if en.strip() else 'hebrew-only'
        qm = quote_match(item.get('quote', ''), en) if item.get('quote') and lang == 'english' else None
        from urllib.parse import quote
        out.append({'input': item['ref'], 'ok': True, 'canonicalRef': canon, 'readerUrl': READER + quote(canon.replace(' ', '_'), safe="_,:'()-"),
                    'language': lang, 'quoteMatch': qm, 'resolvedRef': canon if canon != item['ref'] else None, 'error': None, 'method': 'offline-mcp-text'})
    json.dump(out, open(os.path.join(VER, f'result_{bid}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(bid, len(out), 'ok', sum(1 for o in out if o['ok']), 'quoteFalse', sum(1 for o in out if o['quoteMatch'] is False), 'notfound', [o['input'] for o in out if not o['ok']])
print('total', total, 'ok', ok)

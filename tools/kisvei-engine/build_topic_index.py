#!/usr/bin/env python3
"""Consolidate the per-siman topic assignments into the comprehensive search topic index.

Inputs : out/topics/result_*.json (agent output), out/edition/tzidkat_hatzadik_editorial_master.json
Outputs: <outdir>/topic_index.json   topics -> simanim (with weights), Hebrew terms, Sefaria topic slugs, summaries
         <outdir>/topic_index.csv    one row per (topic, siman)
         <outdir>/siman_topics.json  per-siman record for the reader (topics, key terms, summary, Sefaria topics)
         <outdir>/topic_index.md     human-readable index
"""
import csv
import glob
import json
import re
import sys
from collections import defaultdict

NIK = re.compile('[֑-ֽֿ-ׇ]')


def key(label):
    return re.sub(r'[^a-z0-9]+', ' ', label.lower()).strip()


def main(topics_dir, edition_path, outdir):
    import os
    os.makedirs(outdir, exist_ok=True)
    ed = json.load(open(edition_path, encoding='utf-8'))
    titles = {s['n']: s['title'] for s in ed['simanim']}
    he_text = {s['n']: NIK.sub('', ' '.join(ph['he'] for p in s['paragraphs'] for ph in p['phrases'])) for s in ed['simanim']}
    per_siman = {}
    for f in sorted(glob.glob(os.path.join(topics_dir, 'result_*.json'))):
        for rec in json.load(open(f, encoding='utf-8')):
            per_siman[int(rec['siman'])] = rec
    topics = defaultdict(lambda: {'en': None, 'he': set(), 'kind': defaultdict(int), 'simanim': {}, 'sefaria': set()})
    terms = defaultdict(set)
    sef = defaultdict(lambda: {'title': None, 'heTitle': None, 'simanim': set()})
    for n, rec in per_siman.items():
        for t in rec.get('topics', []):
            k = key(t['en'])
            if not k:
                continue
            T = topics[k]
            T['en'] = T['en'] or t['en'].strip()
            if t.get('he'):
                T['he'].add(t['he'].strip())
            T['kind'][t.get('kind', 'concept')] += 1
            T['simanim'][n] = max(T['simanim'].get(n, 0), int(t.get('weight', 1)))
        for term in rec.get('keyTerms', []):
            term = NIK.sub('', term.strip())
            if term:
                terms[term].add(n)
        for st in rec.get('sefariaTopics', []) or []:
            if st.get('slug'):
                sef[st['slug']]['title'] = sef[st['slug']]['title'] or st.get('title')
                sef[st['slug']]['heTitle'] = sef[st['slug']]['heTitle'] or st.get('heTitle')
                sef[st['slug']]['simanim'].add(n)
    # verify key terms against the Hebrew text (exact substring, nikkud-insensitive)
    term_hits = {}
    for term, ns in terms.items():
        found = sorted(n for n in he_text if term in he_text[n])
        term_hits[term] = {'assignedSimanim': sorted(ns), 'occursInSimanim': found}
    index = {
        'edition': 'tzidkat-editorial-master-2026-11', 'simanimIndexed': sorted(per_siman), 'simanimMissing': sorted(set(titles) - set(per_siman)),
        'topics': sorted(({'key': k, 'en': v['en'], 'he': sorted(v['he']), 'kind': max(v['kind'], key=v['kind'].get),
                           'simanim': [{'siman': n, 'title': titles.get(n), 'weight': w} for n, w in sorted(v['simanim'].items())]}
                          for k, v in topics.items()), key=lambda t: (-len(t['simanim']), t['en'])),
        'hebrewTerms': [{'term': t, **h} for t, h in sorted(term_hits.items(), key=lambda x: -len(x[1]['occursInSimanim']))],
        'sefariaTopics': [{'slug': s, 'title': v['title'], 'heTitle': v['heTitle'], 'url': 'https://www.sefaria.org/topics/' + s, 'simanim': sorted(v['simanim'])}
                          for s, v in sorted(sef.items(), key=lambda x: -len(x[1]['simanim']))],
    }
    json.dump(index, open(os.path.join(outdir, 'topic_index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump({n: {'title': titles.get(n), 'summary': r.get('summary'), 'topics': r.get('topics'), 'keyTerms': r.get('keyTerms'), 'sefariaTopics': r.get('sefariaTopics')}
               for n, r in sorted(per_siman.items())}, open(os.path.join(outdir, 'siman_topics.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open(os.path.join(outdir, 'topic_index.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['topic_en', 'topic_he', 'kind', 'siman', 'siman_title', 'weight', 'reader_url'])
        for t in index['topics']:
            for s in t['simanim']:
                w.writerow([t['en'], ' / '.join(t['he']), t['kind'], s['siman'], s['title'], s['weight'],
                            f"https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/Tzidkat_HaTzadik_{s['siman']}"])
    lines = ['# Tzidkat HaTzadik — Search Topic Index', '', f"Simanim indexed: {len(per_siman)} of 263. Topics: {len(index['topics'])}. Hebrew search terms: {len(term_hits)}. Sefaria topics: {len(sef)}.", '']
    for t in index['topics']:
        lines.append(f"## {t['en']}" + (f" · {' / '.join(t['he'])}" if t['he'] else '') + f"  ({t['kind']})")
        lines.append(', '.join(f"{s['siman']}{'*' * (s['weight'] - 1)}" for s in t['simanim']))
        lines.append('')
    open(os.path.join(outdir, 'topic_index.md'), 'w', encoding='utf-8').write('\n'.join(lines))
    print(json.dumps({'simanim': len(per_siman), 'topics': len(index['topics']), 'terms': len(term_hits), 'sefariaTopics': len(sef),
                      'termsVerifiedInText': sum(1 for h in term_hits.values() if h['occursInSimanim'])}, indent=1))


if __name__ == '__main__':
    main(*sys.argv[1:4])

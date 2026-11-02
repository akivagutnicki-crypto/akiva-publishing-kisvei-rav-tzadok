#!/usr/bin/env python3
"""Command-line entry point for the Kisvei Rav Tzadok engine.

  python3 run.py fetch-live [out dir]                     download the published library index (default data/live)
  python3 run.py learn <mcp-data dir> <connections.json> <weights-out.json>
  python3 run.py parallels <mcp-data dir> <weights.json> <ref> [limit]
  python3 run.py footnote-memory <mcp-data dir> [report.json]   learn from the reader footnotes; leave-one-book-out accuracy
  python3 run.py ingest-biur <ocr.docx|txt> <mcp-data dir> <training/out.json> [origin [suggestions prefix]]   derive refs from an elucidated Tzidkat edition
  python3 run.py cite "<hebrew text>"                      detect explicit citations
  python3 run.py footnotes <mcp-data dir> <weights.json> <ref> [limit]   draft footnotes for a paragraph
  python3 run.py annotate-book <mcp-data dir> <weights.json> <slug> <out.json> [limit]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kisvei_engine import learn, citations  # noqa: E402
from kisvei_engine.parallels import ParallelIndex  # noqa: E402


def load_index(mcp_dir, weights_path=None):
    index = ParallelIndex().load_mcp_dir(mcp_dir)
    if weights_path and os.path.exists(weights_path):
        index.weights = json.load(open(weights_path, encoding='utf-8'))['weights']
    return index


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ''
    if cmd == 'fetch-live':
        from kisvei_engine import live
        s = live.fetch(argv[2] if len(argv) > 2 else 'data/live')
        print(json.dumps({k: v for k, v in s.items() if k != 'perBook'}, indent=1))
        if s['problems']:
            sys.exit(1)
    elif cmd == 'learn':
        learn.main(argv[2], argv[3], argv[4], argv[5] if len(argv) > 5 else None)
    elif cmd == 'parallels':
        index = load_index(argv[2], argv[3])
        limit = int(argv[5]) if len(argv) > 5 else 10
        for r in index.find(argv[4], limit=limit):
            f = r['features']
            print(f"{r['score']:.3f}  {r['ref']}  | sources: {', '.join(f['sharedSources'][:4])} | quotes: {' / '.join(f['sharedQuotes'][:2])} | rare: {' '.join(f['rareTerms'][:5])}")
    elif cmd == 'cite':
        for d in citations.detect(argv[2]):
            print(d)
    elif cmd == 'ingest-biur':
        from kisvei_engine import biur
        recs, stats = biur.ingest(argv[2], argv[3])
        recs, matched = biur.anchor_to_master(recs, argv[3])
        stats['anchoredToPhrase'] = matched
        stats['comparedWithMaster'] = biur.compare_with_master(recs, os.path.join(os.path.dirname(__file__), '../../editorial/tzidkat-editorial-master-2026-11/connections.json'))
        keep = [{k: r[k] for k in ('siman', 'kind', 'ref', 'para', 'phrase', 'part') if k in r} for r in recs]  # refs only, no text of the book
        json.dump({'book': 'tzidkat-hatzadik', 'origin': argv[5] if len(argv) > 5 else 'biur-meshulav', 'stats': stats, 'records': keep},
                  open(argv[4], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(json.dumps(stats, ensure_ascii=False, indent=1))
        if len(argv) > 6:  # also write the per-siman suggestions for the editors: <out prefix>.md / .json
            md, recs = biur.suggestions(argv[4], os.path.join(os.path.dirname(__file__), '../../editorial/tzidkat-editorial-master-2026-11/connections.json'))
            open(argv[6] + '.md', 'w', encoding='utf-8').write(md)
            json.dump(recs, open(argv[6] + '.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    elif cmd == 'footnote-memory':
        from kisvei_engine import footnote_memory, citations as cit
        from kisvei_engine.parallels import ParallelIndex
        recs = footnote_memory.extract(argv[2], ParallelIndex.LIBRARY_BOOKS)
        if os.environ.get('KISVEI_NO_EXTRA') != '1':
            recs += footnote_memory.extra_records(argv[2])
        summary, per_book = footnote_memory.evaluate(recs, detect=cit.detect)
        out = argv[3] if len(argv) > 3 else None
        if out:
            json.dump({'summary': summary, 'perBook': per_book, 'records': len(recs)}, open(out, 'w', encoding='utf-8'), indent=1)
        print(json.dumps(summary, indent=1))
    elif cmd in ('footnotes', 'annotate-book'):
        from kisvei_engine import footnotes, footnote_memory
        from kisvei_engine.parallels import ParallelIndex
        index = load_index(argv[2], argv[3])
        memory = footnote_memory.SourceMemory(footnote_memory.extract(argv[2], ParallelIndex.LIBRARY_BOOKS) + footnote_memory.extra_records(argv[2]))
        if cmd == 'footnotes':
            limit = int(argv[5]) if len(argv) > 5 else 6
            print(json.dumps(footnotes.draft_for_paragraph(index, argv[4], limit=limit, memory=memory), ensure_ascii=False, indent=1))
        else:
            limit = int(argv[6]) if len(argv) > 6 else 6
            out = footnotes.annotate_book(index, argv[4], limit=limit, memory=memory)
            json.dump(out, open(argv[5], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print('paragraphs annotated:', len(out['paragraphs']), 'candidate notes:', sum(len(p['candidates']) for p in out['paragraphs']))
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv)

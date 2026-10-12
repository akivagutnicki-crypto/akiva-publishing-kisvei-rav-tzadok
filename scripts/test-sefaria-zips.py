#!/usr/bin/env python3
"""Verify the real published collection archives against the source inventory."""
import gzip
import hashlib
import json
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parent.parent
snapshot = json.loads(gzip.decompress((ROOT / 'sources/akiva/packs/exports.json.gz').read_bytes()))
output = ROOT / 'dist/library/downloads/collections'
index = json.loads((output / 'index.json').read_bytes())
expected = {
    'tanakh': ['Genesis', 'Rashi on Genesis', 'Ramban on Genesis', 'Ibn Ezra on Genesis'],
    'shas': ['Berakhot', 'Rashi on Berakhot', 'Tosafot on Berakhot'],
    'yerushalmi': ['Jerusalem Talmud Berakhot', 'Penei Moshe on Jerusalem Talmud Berakhot',
                  'Korban HaEdah on Jerusalem Talmud Shabbat'],
    'midrash': ['Bereshit Rabbah', 'Mekhilta DeRabbi Yishmael',
                'Matnot Kehunah on Bereshit Rabbah', 'Etz Yosef on Bereishit Rabbah'],
}

prefixes = {'tanakh': ['Tanakh'], 'shas': ['Talmud', 'Bavli'],
            'yerushalmi': ['Talmud', 'Yerushalmi'], 'midrash': ['Midrash']}
for key, prefix in prefixes.items():
    summary = index['collections'][key]
    path = ROOT / 'dist/library' / summary['file']
    assert path.stat().st_size == summary['bytes']
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['complete'] and not manifest['missing']
        books = {b['title']: b for b in manifest['books']}
        for book in snapshot['books']:
            if book['categories'][:len(prefix)] == prefix:
                assert book['title'] in books, 'Dropped exported book: ' + book['title']
            if book.get('dependence') and any(t in books for t in book.get('base_text_titles', [])):
                assert book['title'] in books, 'Dropped dependent commentary: ' + book['title']
        assert all(title in books for title in expected[key]), 'Missing classical meforshim'
        assert summary['books'] == len(books)
        assert summary['commentaries'] == sum(bool(b.get('dependence')) for b in books.values())
        source_books = {b['title']: b for b in snapshot['books']}
        files = []
        for title, book in books.items():
            sources = {f['sourceURL'] for f in book['files']}
            expected_sources = {source_books[title]['schema_url']}
            expected_sources.update(v['json_url'] for v in source_books[title]['versions'])
            assert sources == expected_sources, 'Dropped edition or schema: ' + title
            files.extend(book['files'])
        assert set(archive.namelist()) == {f['file'] for f in files} | {'manifest.json', 'README.txt', 'SEFARIA-LICENSE.md'}
        assert summary['versions'] == sum('versionTitle' in f for f in files)
        # Check full complex works and the last passage of a major commentary.
        if key == 'midrash':
            mekhilta = books['Mekhilta DeRabbi Yishmael']
            hebrew = next(f for f in mekhilta['files'] if f.get('language') == 'Hebrew')
            text = json.loads(archive.read(hebrew['file']))
            assert isinstance(text['text'], dict) and len(text['text']) == 9, 'Mekhilta nodes omitted'
            assert 'license' in text and text.get('versionSource'), 'Source license metadata omitted'
            matnot = books['Matnot Kehunah on Bereshit Rabbah']
            hebrew = next(f for f in matnot['files'] if f.get('language') == 'Hebrew')
            text = json.loads(archive.read(hebrew['file']))
            assert len(text['text']) == 100 and text['text'][-1][-1][-1], 'Last Midrash commentary missing'
        if key == 'yerushalmi':
            for title in ['Jerusalem Talmud Berakhot', 'Penei Moshe on Jerusalem Talmud Berakhot']:
                hebrew = next(f for f in books[title]['files'] if f.get('language') == 'Hebrew')
                assert len(json.loads(archive.read(hebrew['file']))['text']) == 9, 'Yerushalmi chapter omitted'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == summary['sha256']
    print(f'PASS {key}: {summary["books"]:,} works, {summary["commentaries"]:,} meforshim; '
          f'all {summary["versions"]:,} published editions and schemas present')

reader = (ROOT / 'dist/library/index.html').read_text()
assert 'downloads/collections/${id}-with-meforshim.zip' in reader
assert 'corpusZipLink(p)' in reader and 'showCorpusZipDetails(box)' in reader
assert 'The ZIP button fetches complete works and builds the archive on your device' not in reader
print('PASS direct ZIP links on Downloads and home, with actual collection counts and file sizes')

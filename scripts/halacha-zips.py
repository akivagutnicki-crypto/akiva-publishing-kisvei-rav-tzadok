#!/usr/bin/env python3
"""Verify the three Halacha ZIPs and write the reader's download list.

  halacha-zips.py verify <dir>                     check every archive entry
  halacha-zips.py index <dir> --tag T [--out F]    write downloads/halacha/index.json
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
SEFARIA = 'halakhah-with-meforshim.zip'
TORAHLM = 'torahlm-halakhah.zip'
HALACHIPEDIA = 'halachipedia-torahlm.zip'
EXPECTED_SEFARIA = ['Shulchan Arukh, Orach Chayim', 'Shulchan Arukh, Yoreh De\'ah', 'Shulchan Arukh, Even HaEzer',
                    'Shulchan Arukh, Choshen Mishpat', 'Mishnah Berurah', 'Arukh HaShulchan', 'Kitzur Shulchan Arukh',
                    'Mishneh Torah, Sabbath', 'Tur', 'Magen Avraham', 'Turei Zahav on Shulchan Arukh, Orach Chayim']
EXPECTED_TORAHLM = ['Halakhah/Mishnah Berurah.md', 'Halakhah/Arukh HaShulchan.md', 'Halakhah/Kitzur Shulchan Arukh.md',
                    'Halakhah/Shulchan Arukh, Orach Chayim.md']


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def check_archive(path, expected_titles=(), expected_files=()):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, 'CRC failure in ' + path.name
        names = set(archive.namelist())
        manifest = json.loads(archive.read('manifest.json'))
        assert {'README.txt', 'manifest.json'} <= names, 'Missing README or manifest in ' + path.name
        records = [f for book in manifest['books'] for f in book['files']] if 'books' in manifest else manifest['files']
        for record in records:
            assert sha256(archive.read(record['file'])) == record['sha256'], 'Checksum mismatch: ' + record['file']
        titles = {book['title'] for book in manifest.get('books', [])}
        for title in expected_titles:
            assert title in titles, f'{path.name} lacks {title}'
        for name in expected_files:
            assert name in names, f'{path.name} lacks {name}'
        return manifest, records


def verify(folder):
    manifest, records = check_archive(folder / SEFARIA, EXPECTED_SEFARIA)
    assert manifest['complete'] and len(manifest['books']) >= 2000, 'Incomplete Sefaria Halakhah export'
    assert all(b['categories'][0] == 'Halakhah' for b in manifest['books'])
    langs = {r.get('language') for r in records if r.get('language')}
    assert langs == {'Hebrew', 'English'}, langs
    _, torahlm = check_archive(folder / TORAHLM, expected_files=EXPECTED_TORAHLM)
    assert len(torahlm) >= 2000, 'Incomplete TorahLM Halakhah'
    _, pedia = check_archive(folder / HALACHIPEDIA)
    assert len(pedia) >= 1 and all(r['file'].startswith('Halachipedia/') for r in pedia)
    print(f'Verified {len(manifest["books"]):,} Sefaria works ({len(records):,} files), '
          f'{len(torahlm):,} TorahLM books and {len(pedia)} Halachipedia files.')


def index(folder, tag, out):
    sefaria = json.loads((folder / 'index.json').read_text())
    collection = sefaria['collections']['halakhah']
    torahlm = json.loads((folder / 'torahlm-index.json').read_text())
    base = f'https://github.com/{REPO}/releases/download/{tag}/'

    def entry(pack_id, title, filename, **extra):
        data = (folder / filename).read_bytes()
        return {'id': pack_id, 'title': title, 'file': filename, 'url': base + filename,
                'bytes': len(data), 'sha256': sha256(data), **extra}
    packs = [
        entry('halakhah-with-meforshim', 'Halacha + meforshim · Sefaria', SEFARIA, works=collection['books'],
              commentaries=collection['commentaries'], versions=collection['versions'],
              sourceLabel='Sefaria public export', sourceDate=sefaria['sourceDate']),
        entry('torahlm-halakhah', 'Halacha · TorahLM Markdown', TORAHLM,
              files=torahlm['packs']['torahlm-halakhah']['files'], sourceLabel='TorahLM', sourceDate='2026-10-28',
              commit=torahlm['commit']),
        entry('halachipedia-torahlm', 'Halachipedia · TorahLM', HALACHIPEDIA,
              files=torahlm['packs']['halachipedia-torahlm']['files'], sourceLabel='TorahLM', sourceDate='2026-10-28',
              commit=torahlm['commit']),
    ]
    for pack, key in zip(packs[1:], ['torahlm-halakhah', 'halachipedia-torahlm']):
        assert pack['sha256'] == torahlm['packs'][key]['sha256']
    assert packs[0]['sha256'] == collection['sha256']
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'release': tag, 'repository': REPO, 'packs': packs}, ensure_ascii=False, indent=2) + '\n')
    print('Wrote', out, 'with', len(packs), 'packs')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', choices=['verify', 'index'])
    parser.add_argument('folder', type=Path)
    parser.add_argument('--tag')
    parser.add_argument('--out', type=Path, default=Path('dist/library/downloads/halacha/index.json'))
    arguments = parser.parse_args()
    if arguments.mode == 'verify':
        verify(arguments.folder)
    else:
        assert arguments.tag, '--tag is required'
        index(arguments.folder, arguments.tag, arguments.out)

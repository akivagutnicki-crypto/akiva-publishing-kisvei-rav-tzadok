#!/usr/bin/env python3
"""Build the TorahLM Halacha and Halachipedia ZIPs from a pinned TorahLM-download checkout.

Files are copied byte for byte from https://github.com/TorahApp/TorahLM-download
at one commit. The archives are deterministic (sorted entries, fixed timestamps),
every entry is checked against its SHA-256 after compression, and a missing or
empty source folder fails the build instead of publishing a partial ZIP.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

REPO = 'https://github.com/TorahApp/TorahLM-download'
COMMIT = '755002756b242c40d2eb7dfe487b686bc2da5ed2'
STAMP = (2026, 10, 28, 0, 0, 0)  # date of the pinned TorahLM commit
PACKS = {
    'torahlm-halakhah': {
        'title': 'Halacha · TorahLM Markdown',
        'folder': 'books/Halakhah',
        'prefix': 'Halakhah/',
        'minimum': 2000,
        'about': ('Every Halakhah book in TorahLM: Shulchan Arukh and its meforshim (Mishnah Berurah,\n'
                  'Arukh HaShulchan, Taz, Magen Avraham and more), Mishneh Torah with its commentaries,\n'
                  'Tur, Kitzur Shulchan Arukh, Sifrei Mitzvot, Peninei Halakhah and the other works\n'
                  'Sefaria files under Halakhah. One Markdown file per book, Hebrew with the English\n'
                  'translations TorahLM includes, footnotes and per-segment links.'),
    },
    'halachipedia-torahlm': {
        'title': 'Halachipedia · TorahLM Markdown',
        'folder': 'notebooklm/halachipedia',
        'prefix': 'Halachipedia/',
        'minimum': 1,
        'about': ('All Halachipedia articles as compiled by TorahLM, in Markdown, with a contents list\n'
                  'and a link back to each article on halachipedia.com.'),
    },
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def build(source, output, commit, only=None):
    head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if head != commit:
        raise SystemExit(f'TorahLM checkout is at {head}, expected {commit}')
    license_text = (source / 'LICENSE').read_bytes()
    output.mkdir(parents=True, exist_ok=True)
    summary = {'source': REPO, 'commit': commit, 'packs': {}}
    for key, pack in PACKS.items():
        if only and key not in only:
            continue
        files = sorted(p for p in (source / pack['folder']).glob('*.md') if p.is_file())
        if len(files) < pack['minimum'] or any(p.stat().st_size == 0 for p in files):
            raise SystemExit(f'{pack["folder"]}: missing or empty files ({len(files)} found)')
        records = []
        for path in files:
            data = path.read_bytes()
            records.append({'file': pack['prefix'] + path.name, 'bytes': len(data), 'sha256': sha256(data),
                            'source': f'{REPO}/blob/{commit}/{pack["folder"]}/{path.name}'})
        manifest = {'title': pack['title'], 'source': REPO, 'commit': commit, 'folder': pack['folder'],
                    'files': records}
        readme = (f'{pack["title"]}\n\n{pack["about"]}\n\n'
                  f'{len(records):,} files, copied unchanged from TorahLM-download\n'
                  f'({REPO}, commit {commit}).\n'
                  'TorahLM.org is a project of TorahApp. Texts come from Sefaria and Halachipedia;\n'
                  'keep their attribution and observe the upstream licenses (see LICENSE.md and\n'
                  'https://torahlm.org/sefaria_license). manifest.json lists every file with its\n'
                  'SHA-256 checksum and source link.\n\n'
                  'Packaged for the Rav Tzadok Library, Akiva Publishing.\n')
        target = output / (key + '.zip')
        temporary = target.with_suffix('.zip.tmp')
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:
            def add(name, data):
                info = zipfile.ZipInfo(name, STAMP)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, data, compresslevel=9)
            add('README.txt', readme.encode())
            add('LICENSE.md', license_text)
            add('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode())
            for path, record in zip(files, records):
                add(record['file'], path.read_bytes())
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise SystemExit('ZIP CRC failed: ' + key)
            if len(archive.namelist()) != len(records) + 3:
                raise SystemExit('ZIP inventory mismatch: ' + key)
            for record in records:
                if sha256(archive.read(record['file'])) != record['sha256']:
                    raise SystemExit('ZIP source mismatch: ' + record['file'])
        temporary.replace(target)
        data = target.read_bytes()
        summary['packs'][key] = {'title': pack['title'], 'file': target.name, 'files': len(records),
                                 'sourceBytes': sum(r['bytes'] for r in records),
                                 'bytes': len(data), 'sha256': sha256(data)}
        print(f'{pack["title"]}: {len(records):,} files, {len(data) / 1048576:.1f} MB ZIP; all entries verified', flush=True)
    index = output / 'torahlm-index.json'
    if only and index.exists():
        previous = json.loads(index.read_text())
        if previous.get('commit') == commit:
            summary['packs'] = {**previous['packs'], **summary['packs']}
    index.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='TorahLM-download checkout')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--commit', default=COMMIT)
    parser.add_argument('--pack', choices=PACKS, action='append', help='build only these packs (default: all)')
    arguments = parser.parse_args()
    build(arguments.source, arguments.output, arguments.commit, arguments.pack)

#!/usr/bin/env python3
"""Publish only the two user-uploaded Meshiv expanded study editions.
After the established 13-book installer, validate exact package hashes, render
English footnotes in the existing Hebrew popup UI, and preserve other seforim.
"""
import base64, hashlib, html, io, json, re, zipfile
from pathlib import Path

ROOT = Path('dist/library/data')
CHUNK_DIR = Path('incoming/meshiv-2026')
PACKS = {
    'hata': ('meshiv-hata-anah', 65, 563, 7,
             '69665eac0c5e40fec263ee5c8214794ff2b9f703d73dc27840af937209b4e385'),
    'tzedek': ('meshiv-tzedek', 2, 768, 10,
               'b6a3e6fa024a71dbda288a92e9b725ec952e25baf7e260f527032e7581278c70'),
}
PROTECTED = ('takanat-hashavin', 'resisei-layla', 'et-haochel', 'dover-tzedek')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def plain(text):
    return html.unescape(re.sub('<[^>]*>', '', str(text or ''))).replace('\u00a0', ' ')

def inventory(path):
    if not path.exists():
        return None
    h = hashlib.sha256()
    for item in sorted(path.rglob('*')):
        if item.is_file():
            h.update(item.relative_to(path).as_posix().encode())
            h.update(item.read_bytes())
    return h.hexdigest()

def load(name, slug, pieces, expected):
    parts = [CHUNK_DIR / (f'{name}-{k:02d}.b64') for k in range(1, pieces + 1)]
    if not all(x.is_file() for x in parts):
        raise ValueError('Meshiv release missing one or more source chunks: ' + name)
    encoded = ''.join(''.join(f.read_text().split()) for f in parts)
    raw = base64.b64decode(encoded, validate=True)
    if digest(raw) != expected:
        raise ValueError('Source ZIP SHA-256 mismatch: ' + name)
    result = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for info in z.infolist():
            path = info.filename
            if path.startswith('/') or '..' in Path(path).parts or '\\' in path:
                raise ValueError('Unsafe ZIP entry: ' + path)
            if path.startswith('data/' + slug + '/') and path.endswith('.json'):
                result[path.removeprefix('data/' + slug + '/')] = json.loads(z.read(info))
            elif path == 'data/catalog.json':
                result['_catalog'] = json.loads(z.read(info))
    return result

def verify(payload, slug, sections, expected):
    chapter_names = sorted(k for k in payload if re.fullmatch(r'\d+\.json', k))
    if set(chapter_names) != {f'{n}.json' for n in range(sections)}:
        raise ValueError('Unexpected section-file set for ' + slug)
    if not isinstance(payload.get('toc.json'), dict) or not isinstance(payload.get('links.json'), dict):
        raise ValueError('Missing table of contents or connections for ' + slug)
    if not isinstance(payload.get('_catalog'), list) or len(payload['_catalog']) != 1 or payload['_catalog'][0].get('slug') != slug:
        raise ValueError('Incorrect catalog entry ' + slug)
    numbers = []
    source_ids = set()
    count_popups = 0
    for fname in chapter_names:
        items = payload[fname]
        if not isinstance(items, list):
            raise ValueError('Bad interlinear chapter ' + fname)
        for item in items:
            if not isinstance(item, dict):
                raise ValueError('Bad paragraph ' + fname)
            pairs = item.get('p', [])
            for fn in item.get('footnotes', []):
                number, sid = fn.get('number'), fn.get('sourceId')
                if not isinstance(number, int) or not isinstance(sid, str) or sid in source_ids:
                    raise ValueError('Duplicate/bad footnote ' + slug)
                source_ids.add(sid)
                numbers.append(number)
                index = fn.get('phraseIndex')
                if not isinstance(index, int) or not 0 <= index < len(pairs):
                    raise ValueError('Missing bilingual text for ' + sid)
                he, en = pairs[index]
                for lang, phrase in (('he', he), ('en', en)):
                    text = plain(phrase)
                    pos = fn.get(lang + 'CharOffset')
                    if not isinstance(pos, int) or pos < 1 or pos > len(text) or text[:pos] != fn.get(lang + 'AnchorPrefix'):
                        raise ValueError('Misaligned ' + lang + ' marker for ' + sid)
                paragraphs = fn.get('paragraphs')
                if not isinstance(paragraphs, list) or not paragraphs:
                    raise ValueError('Missing English popup ' + sid)
                for p in paragraphs:
                    if p.get('rich') and ''.join(x.get('text', '') for x in p['rich']) != p.get('text'):
                        raise ValueError('Broken rich text segment in ' + sid)
                if not paragraphs[0].get('rich') or not paragraphs[0]['rich'][0].get('href', '').startswith('https://www.sefaria.org/'):
                    raise ValueError('Missing linked primary source in ' + sid)
                if not fn.get('sources') or any(not s.get('url', '').startswith('https://www.sefaria.org/') for s in fn['sources']):
                    raise ValueError('Unlinked source record ' + sid)
                # Retain all supplied English source translations and parallels;
                # remove the duplicate editorial source-review summary line.
                fn['paragraphs'] = [p for p in paragraphs if not p['text'].lstrip().startswith('Sources:')]
                count_popups += 1
    if sorted(numbers) != list(range(1, expected + 1)):
        raise ValueError('Incorrect note numbering/count ' + slug + ': ' + str(len(numbers)))
    return count_popups

def merge_catalog(catalog, entries):
    ordered = list(catalog)
    slugs = [x.get('slug') for x in ordered]
    for slug, entry in entries.items():
        if slug in slugs:
            ordered[slugs.index(slug)] = {**ordered[slugs.index(slug)], **entry}
        else:
            ordered.append(entry)
    return ordered

def main():
    if not ROOT.is_dir():
        raise ValueError('Reader data directory missing')
    unaffected = {b: inventory(ROOT / b) for b in PROTECTED}
    staged = {}
    catalog_entries = {}
    refs = set()
    total = 0
    for kind, (slug, chapters, count, pieces, sha) in PACKS.items():
        payload = load(kind, slug, pieces, sha)
        n = verify(payload, slug, chapters, count)
        staged[slug] = payload
        catalog_entries[slug] = payload['_catalog'][0]
        total += n
        # The ZIP already ships the entire section-level links map.
        for source_ref, links in payload['links.json'].items():
            if not isinstance(links, list):
                raise ValueError('Invalid section connections: ' + source_ref)
            for link in links:
                if not link.get('a') or not link.get('r'):
                    raise ValueError('Unresolved cited source ' + source_ref)
                refs.add(link['r'])
        print(f'PASS {slug}: {chapters} interlinear sections, {n} numbered, Hebrew-anchored English popup footnotes')
    for slug, payload in staged.items():
        target = ROOT / slug
        target.mkdir(exist_ok=True)
        expected_names = {name for name in payload if name.endswith('.json')}
        for old in target.glob('*.json'):
            if old.name not in expected_names:
                # Only remove obsolete files of these two target seforim.
                old.unlink()
        for name in expected_names:
            (target / name).write_text(json.dumps(payload[name], ensure_ascii=False, separators=(',', ':')) + '\n')
    catfile = ROOT / 'catalog.json'
    if catfile.exists():
        catalog = json.loads(catfile.read_text())
        catfile.write_text(json.dumps(merge_catalog(catalog, catalog_entries), ensure_ascii=False, separators=(',', ':')) + '\n')
    # The standard build-parallels job runs afterward, reading the updated
    # section links, keeping the rest of the library's sources intact.
    files_file = ROOT / 'files.json'
    if files_file.exists():
        manifest = json.loads(files_file.read_text())
        manifest['files'] = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*.json') if p != files_file)
        manifest['bytes'] = sum((ROOT / name).stat().st_size for name in manifest['files'])
        files_file.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n')
    if unaffected != {b: inventory(ROOT / b) for b in PROTECTED}:
        raise ValueError('Excluded volume modified')
    sw = ROOT.parent / 'sw.js'
    if sw.exists():
        contents = sw.read_text()
        updated = re.sub(r"const VERSION = '[^']+';", "const VERSION = 'v62-meshiv-hataanah-tzedek-20261015';", contents, count=1)
        if updated == contents:
            raise ValueError('Offline service worker cache did not update')
        sw.write_text(updated)
    print(f'PASS Meshiv editions installed: {total} footnotes across 67 sections, {len(refs)} referenced sources; four exclusions unchanged')

if __name__ == '__main__':
    main()
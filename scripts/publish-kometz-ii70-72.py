"""Publish the reviewed Kometz II:70–72 successor into a complete Pages artifact.

Only the three canonical bodies, subsequent note display numbers, their citation
indexes, offline copies, and cache revisions change. Historical importers remain
unchanged. Usage: python3 scripts/publish-kometz-ii70-72.py apply|verify SITE
"""
import copy
import hashlib
import html
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EDITION_FILE = ROOT / 'sources/akiva/kometz-ii70-72/edition.json'
SLUG = 'kometz-haminchah'
REPORT = 'library/kometz-ii70-72-publication.json'
TARGETS = {184: 'Kometz HaMinchah 2:70', 185: 'Kometz HaMinchah 2:71', 186: 'Kometz HaMinchah 2:72'}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def serial(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def object_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write(path, value):
    path = Path(path)
    if path.exists() and read(path) == value:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_bytes(serial(value))
    temp.replace(path)
    return True


def plain(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value)))


def js_length(value):
    return len(value.encode('utf-16-le')) // 2


def js_prefix(value, length):
    return value.encode('utf-16-le')[:length * 2].decode('utf-16-le')


def units(items):
    return [item for item in items if isinstance(item, dict) and 'p' in item]


def notes(items):
    return [note for item in units(items) for note in item.get('footnotes', [])]


def leaves(node):
    return [leaf for child in node['children'] for leaf in leaves(child)] if 'children' in node else [node]


def inventory(site):
    result = {}
    for path in sorted(site.rglob('*')):
        require(not path.is_symlink(), 'Unexpected symlink in site: ' + str(path))
        if path.is_file():
            name = path.relative_to(site).as_posix()
            if name != REPORT:
                result[name] = digest(path)
    return result


def validate_note(note, item):
    index = note['phraseIndex']
    require(isinstance(index, int) and 0 <= index < len(item['p']), 'Invalid note phrase: ' + note['sourceId'])
    he, en = map(plain, item['p'][index])
    for side, value in [('he', he), ('en', en)]:
        offset = note[side + 'CharOffset']
        require(isinstance(offset, int) and 0 <= offset <= js_length(value), 'Invalid note offset: ' + note['sourceId'])
        require(js_prefix(value, offset) == note[side + 'AnchorPrefix'], 'Note anchor differs: ' + note['sourceId'])
    require(note['heCharOffset'] > 0, 'Missing Hebrew marker: ' + note['sourceId'])
    require(1 <= note['heWord'] <= len(he.split()), 'Invalid Hebrew word: ' + note['sourceId'])
    require(note.get('paragraphs'), 'Empty note: ' + note['sourceId'])
    for paragraph in note['paragraphs']:
        require(paragraph['text'] == ''.join(run['text'] for run in paragraph['rich']), 'Rich text differs: ' + note['sourceId'])
    require(note.get('sources') and all(source.get('ref') and source.get('url') for source in note['sources']), 'Missing note source')


def edition():
    value = read(EDITION_FILE)
    require(re.fullmatch(r'[a-z0-9-]+', value['revision']), 'Invalid edition revision')
    require([(s['id'], s['ref']) for s in value['sections']] == list(TARGETS.items()), 'Unexpected reviewed sections')
    all_notes = []
    pair_count = 0
    for section in value['sections']:
        require(re.fullmatch(r'[0-9a-f]{64}', section['expectedBeforeSha256']), 'Missing reviewed preimage hash')
        require(len(section['items']) == 1 and section['items'][0]['n'] == 1, 'Canonical paragraph identity must remain n=1')
        item = section['items'][0]
        require(item['p'] and all(len(pair) == 2 and all(isinstance(x, str) and x for x in pair) for pair in item['p']), 'Invalid interlinear pairs')
        breaks = item.get('paragraphBreaks', [])
        require(breaks == sorted(set(breaks)) and all(isinstance(i, int) and 0 < i < len(item['p']) for i in breaks), 'Invalid paragraph breaks')
        for note in notes(section['items']):
            validate_note(note, item)
        pair_count += len(item['p'])
        all_notes.extend(notes(section['items']))
    require(pair_count == value['phrasePairs'] == 249, 'Incomplete reviewed phrase coverage')
    require(len(all_notes) == value['footnotes'] == 70, 'Incomplete reviewed note coverage')
    require([n['pdfNumber'] for n in all_notes] == list(range(1, 71)), 'PDF note order differs')
    for key in ('sourceId', 'placementId'):
        require(len({n[key] for n in all_notes}) == 70, 'Duplicate ' + key)
    return value


def expected_items(source, first, revision):
    out = copy.deepcopy(source['items'])
    for item in units(out):
        item['sourceEdition'] = revision
        for note in item['footnotes']:
            note['number'] = first + note['pdfNumber'] - 1
    return out


def without_display_numbers(items):
    result = copy.deepcopy(items)
    for note in notes(result):
        note.pop('number', None)
    return result


def mask_mcp_numbers(paragraph):
    result = copy.deepcopy(paragraph)
    for note in result.get('f', []):
        note[0] = ''
    for location in result.get('a', {}).values():
        if location and location[0] == 'n':
            location[1] = ''
    return result


def category_map(refs):
    code = "import {pathToFileURL} from 'node:url';const {categoryOf}=await import(pathToFileURL(process.argv[1]).href);let s='';for await(const b of process.stdin)s+=b;console.log(JSON.stringify(Object.fromEntries(JSON.parse(s).map(r=>[r,categoryOf(r)]))));"
    result = subprocess.run(['node', '--input-type=module', '-e', code, str(ROOT / 'scripts/citations.mjs')], input=json.dumps(sorted(refs)), text=True, capture_output=True)
    require(result.returncode == 0, 'Cannot load the shared citation categories: ' + result.stderr)
    return json.loads(result.stdout)


def citation_anchors(item):
    anchors = {}
    for index, pair in enumerate(item['p']):
        for side, value in zip(('h', 'e'), pair):
            for match in re.finditer(r'<a\b[^>]*\bdata-ref=[\"\x27]([^\"\x27]+)[\"\x27]', value):
                anchors.setdefault(html.unescape(match[1]), [index, side, js_length(plain(value[:match.start()]))])
    for note in item.get('footnotes', []):
        for ref in [s['ref'] for s in note.get('sources', [])] + note.get('nativeConnections', []):
            anchors.setdefault(ref, ['n', str(note['number'])])
    return anchors


def update_mcp(site, changed_sections, old_sections, toc_leaves, delta):
    filename = site / 'mcp-data/text' / (SLUG + '.json')
    document = read(filename)
    original = copy.deepcopy(document)
    catalog = read(site / 'mcp-data/catalog.json')
    book = next(b for b in catalog['books'] if b['slug'] == SLUG)
    section_indices = {section['ref']: i for i, section in enumerate(book['sections'])}
    target_owners = set()
    downstream_refs = set()
    for leaf in toc_leaves:
        identifier = int(leaf['id'])
        if identifier not in changed_sections:
            continue
        s = section_indices[leaf['ref']]
        items = changed_sections[identifier]
        old_items = {i['n']: i for i in units(old_sections[identifier])}
        headings = []
        for item in items:
            if 'h' in item:
                headings.append(item['h'])
                continue
            if 'p' not in item:
                continue
            matches = [p for p in document['paras'] if p['s'] == s and p['n'] == item['n']]
            require(len(matches) == 1, 'Ambiguous MCP paragraph: ' + leaf['ref'])
            paragraph = matches[0]
            if identifier in TARGETS:
                target_owners.add(paragraph['r'])
                paragraph['p'] = [[plain(a), plain(b)] for a, b in item['p']]
                paragraph['f'] = [[str(n['number']), '\n'.join(plain(x['text']) for x in n['paragraphs']), n['phraseIndex'], 'h', n['heCharOffset']] for n in item['footnotes']]
                paragraph['h'] = headings + [h['text'] for h in item.get('inlineHeadings', [])]
                for key in ('inlineHeadings', 'paragraphBreaks'):
                    paragraph.pop(key, None)
                    if key in item:
                        paragraph[key] = copy.deepcopy(item[key])
                paragraph['a'] = citation_anchors(item)
            else:
                downstream_refs.add(paragraph['r'])
                mapping = {str(n['number']): str(n['number'] + delta) for n in old_items[item['n']].get('footnotes', [])}
                require({f[0] for f in paragraph.get('f', [])} == set(mapping), 'MCP downstream note numbers differ: ' + paragraph['r'])
                for note in paragraph.get('f', []):
                    note[0] = mapping[note[0]]
                for location in paragraph.get('a', {}).values():
                    if location and location[0] == 'n':
                        require(str(location[1]) in mapping, 'Unresolved downstream MCP note anchor')
                        location[1] = mapping[str(location[1])]
            headings = []
    categories = category_map({ref for p in document['paras'] if p['r'] in target_owners for ref in p['a']})
    for paragraph in document['paras']:
        if paragraph['r'] in target_owners:
            paragraph['c'] = [[ref, categories[ref]] for ref in paragraph['a']]
    require(len(document['paras']) == len(original['paras']), 'MCP paragraph count changed')
    for old, new in zip(original['paras'], document['paras']):
        require((old['r'], old['s'], old['n']) == (new['r'], new['s'], new['n']), 'Canonical MCP identity changed')
        if old['r'] in downstream_refs:
            require(mask_mcp_numbers(old) == mask_mcp_numbers(new), 'Downstream MCP content changed')
        elif old['r'] not in target_owners:
            require(old == new, 'Unrelated MCP paragraph changed')
    write(filename, document)
    support = {owner: set() for owner in target_owners}
    # An alternate edition may retain a citation under the same canonical ref.
    for path in sorted((site / 'mcp-data/text').glob('*.json')):
        current = document if path == filename else read(path)
        for paragraph in current.get('paras', []):
            if paragraph.get('r') in support:
                support[paragraph['r']].update(ref for ref, *_ in paragraph.get('c', []))
    cited_path = site / 'mcp-data/cited.json'
    cited = read(cited_path)
    for ref in list(cited):
        if any(owner in support for owner in cited[ref]):
            cited[ref] = [owner for owner in cited[ref] if owner not in support or ref in support[owner]]
            if not cited[ref]:
                del cited[ref]
    for owner, refs in support.items():
        for ref in sorted(refs):
            if owner not in cited.setdefault(ref, []):
                cited[ref].append(owner)
    write(cited_path, cited)
    stable = [mask_mcp_numbers(p) if p['r'] in downstream_refs else p for p in document['paras'] if p['r'] not in target_owners]
    return document, target_owners, downstream_refs, object_hash(stable)


def slugify(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


def update_reader_connections(site, document, owners, sections):
    data = site / 'library/data'
    links_path = data / SLUG / 'links.json'
    links = read(links_path)
    records = {}
    for section in sections:
        records[section['ref']] = [{'a': p['r'], 'r': ref, 'c': category} for p in document['paras'] if p['r'] in owners and p['r'].startswith(section['ref'] + ':') for ref, category in p.get('c', [])]
        links[section['ref']] = records[section['ref']]
    changed = set()
    if write(links_path, links):
        changed.add(links_path.relative_to(site).as_posix())
    wanted = {}
    for records_for_section in records.values():
        for record in records_for_section:
            wanted.setdefault(record['r'], set()).add(record['a'])
    cited_dir = data / 'cited'
    buckets = {}
    for path in sorted(cited_dir.glob('*.json')):
        if path.name == 'index.json':
            continue
        old = read(path)
        current = copy.deepcopy(old)
        for ref, refs in old.items():
            if any(owner in owners for owner in refs):
                kept = [owner for owner in refs if owner not in owners or owner in wanted.get(ref, set())]
                if kept:
                    current[ref] = kept
                else:
                    del current[ref]
        # The historical empty-book bucket is literally '.json', whose stem
        # pathlib treats differently; keep its original empty index key.
        buckets[path.name[:-5]] = (path, current)
    for ref, refs in wanted.items():
        book = re.sub(r'\s+\d[\dab:\-–]*$', '', ref)
        key = slugify(book)
        require(bool(key), 'Cannot name reverse citation index: ' + ref)
        path, current = buckets.setdefault(key, (cited_dir / (key + '.json'), {}))
        for owner in sorted(refs):
            if owner not in current.setdefault(ref, []):
                current[ref].append(owner)
    for path, value in buckets.values():
        if write(path, value):
            changed.add(path.relative_to(site).as_posix())
    index_path = cited_dir / 'index.json'
    index = read(index_path)
    new_index = sorted(set(index) | set(buckets))
    if write(index_path, new_index):
        changed.add(index_path.relative_to(site).as_posix())
    return changed


def restore_declared_dotfiles(site):
    data = site / 'library/data'
    restored = set()
    with zipfile.ZipFile(site / 'library/downloads/rav-tzadok-library.zip') as archive:
        for name in read(data / 'files.json')['files']:
            path = data / name
            require(data.resolve() in path.resolve().parents, 'Unsafe data manifest path')
            if not path.exists():
                require(any(part.startswith('.') for part in Path(name).parts), 'Incomplete baseline data: ' + name)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(archive.read('data/' + name))
                restored.add(path.relative_to(site).as_posix())
    return restored


def refresh_manifest(site):
    data = site / 'library/data'
    files = sorted(p.relative_to(data).as_posix() for p in data.rglob('*') if p.is_file() and p != data / 'files.json')
    h = hashlib.sha256()
    total = 0
    for name in files:
        h.update(name.encode())
        h.update(b'\0')
        with (data / name).open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                h.update(chunk)
                total += len(chunk)
    manifest = {**read(data / 'files.json'), 'version': h.hexdigest()[:16], 'bytes': total, 'files': files}
    write(data / 'files.json', manifest)
    return manifest


def rewrite_zip(path, updates, complete=False):
    temp = path.with_suffix('.updated.zip')
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(temp, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as target:
        names = source.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP member in ' + str(path))
        for info in source.infolist():
            copied_info = copy.copy(info)
            if info.filename in updates:
                target.writestr(copied_info, updates[info.filename].read_bytes())
            else:
                with source.open(info) as src, target.open(copied_info, 'w', force_zip64=info.file_size > 2**31) as dst:
                    for chunk in iter(lambda: src.read(1024 * 1024), b''):
                        dst.write(chunk)
            # ZipFile supplies default permissions when external_attr is zero.
            # fflate's existing entries deliberately have zero attributes;
            # restore them on the copied record before the central directory
            # is written. Never mutate the source archive's ZipInfo objects.
            copied_info.external_attr = info.external_attr
        for name, file in updates.items():
            if name not in names and (complete or name.startswith('data/' + SLUG + '/')):
                target.writestr(name, file.read_bytes())
    with zipfile.ZipFile(path) as old, zipfile.ZipFile(temp) as new:
        require(set(old.namelist()) <= set(new.namelist()), 'ZIP entries were removed')
        for info in old.infolist():
            if info.filename not in updates:
                current = new.getinfo(info.filename)
                require((info.CRC, info.file_size, info.external_attr) == (current.CRC, current.file_size, current.external_attr), 'Unrelated ZIP entry changed')
        for name, file in updates.items():
            if name in new.namelist():
                require(hashlib.sha256(new.read(name)).hexdigest() == digest(file), 'ZIP replacement differs: ' + name)
    temp.replace(path)


def book_zip_member(name):
    return name.startswith('data/' + SLUG + '/') or name == 'data/cited/' + SLUG + '.json'


def patch_cache(site, revision):
    changed = set()
    marker = '/* ' + revision + ' */ '
    for name in ['library/index.html', 'library/open/index.html']:
        path = site / name
        text = path.read_text()
        anchor = 'const editionDataUrl = url => '
        if anchor not in text and name.endswith('/open/index.html'):
            require('Android' in text and 'reader' in text, 'Unrecognized open-app landing page')
            continue
        require(text.count(anchor) == 1 and marker not in text, 'Unexpected reader cache function')
        prefix = marker + "(url.startsWith('data/kometz-haminchah/') || url.startsWith('data/cited/') || url === 'data/files.json') ? url + (url.includes('?') ? '&' : '?') + 'kometz=" + revision + "' : "
        path.write_text(text.replace(anchor, anchor + prefix, 1))
        changed.add(name)
    path = site / 'library/sw.js'
    text = path.read_text()
    match = re.search(r'const SHELL = `([^`]*)`;', text)
    require(match and revision not in match[1], 'Unexpected service-worker cache revision')
    path.write_text(text.replace(match[0], 'const SHELL = `' + match[1] + '-' + revision + '`;', 1))
    changed.add('library/sw.js')
    return changed


def apply(site):
    site = Path(site).resolve()
    reviewed = edition()
    revision = reviewed['revision']
    book_dir = site / 'library/data' / SLUG
    toc = read(book_dir / 'toc.json')
    toc_leaves = leaves(toc['toc'])
    for identifier, ref in TARGETS.items():
        matches = [leaf for leaf in toc_leaves if int(leaf['id']) == identifier]
        require(len(matches) == 1 and matches[0]['ref'] == ref, 'Reader section mapping differs')
    originals = {int(leaf['id']): read(book_dir / (str(leaf['id']) + '.json')) for leaf in toc_leaves}
    states = [all(item.get('sourceEdition') == revision for item in units(originals[i])) for i in TARGETS]
    if any(states):
        require(all(states), 'Partially applied edition; refusing an ambiguous continuation')
        verify(site)
        print(json.dumps({'mode': 'already-applied', 'revision': revision}))
        return
    for section in reviewed['sections']:
        require(digest(book_dir / (str(section['id']) + '.json')) == section['expectedBeforeSha256'], 'Reviewed preimage differs: ' + section['ref'])
    old_notes = [note for i in TARGETS for note in notes(originals[i])]
    first, old_last = old_notes[0]['number'], old_notes[-1]['number']
    require([n['number'] for n in old_notes] == list(range(first, old_last + 1)), 'Original target notes are not continuous')
    require(max(n['number'] for i, items in originals.items() if i < min(TARGETS) for n in notes(items)) == first - 1, 'Preceding note boundary differs')
    delta = reviewed['footnotes'] - len(old_notes)
    before = inventory(site)
    restored = restore_declared_dotfiles(site)
    changed_sections = {}
    heading_hashes = {}
    downstream_hashes = {}
    for section in reviewed['sections']:
        identifier = section['id']
        replacements = {item['n']: item for item in expected_items(section, first, revision)}
        require([item['n'] for item in units(originals[identifier])] == list(replacements), 'Target paragraph layout differs')
        items = [copy.deepcopy(replacements[item['n']]) if 'p' in item else copy.deepcopy(item) for item in originals[identifier]]
        heading_hashes[str(identifier)] = object_hash([item for item in items if 'p' not in item])
        changed_sections[identifier] = items
    for identifier, original in originals.items():
        if identifier <= max(TARGETS):
            continue
        items = copy.deepcopy(original)
        for note in notes(items):
            require(note['number'] > old_last, 'Downstream note boundary differs')
            note['number'] += delta
        require(without_display_numbers(items) == without_display_numbers(original), 'Downstream content changed')
        downstream_hashes[str(identifier)] = object_hash(without_display_numbers(original))
        changed_sections[identifier] = items
    for identifier, items in changed_sections.items():
        write(book_dir / (str(identifier) + '.json'), items)
    for section in reviewed['sections']:
        toc.setdefault('reviewedEditions', {})[section['ref']] = {'revision': revision, 'phrases': len(section['items'][0]['p']), 'notes': len(notes(section['items']))}
    write(book_dir / 'toc.json', toc)
    mcp, owners, downstream_refs, stable_mcp_hash = update_mcp(site, changed_sections, originals, toc_leaves, delta)
    citation_files = update_reader_connections(site, mcp, owners, reviewed['sections'])
    subprocess.run(['node', str(ROOT / 'scripts/build-mcp-search-index.mjs'), str(site / 'mcp-data'), SLUG], check=True)
    shell_files = patch_cache(site, revision)
    manifest = refresh_manifest(site)
    data_updates = {p.relative_to(site / 'library').as_posix(): p for p in (site / 'library/data').rglob('*') if p.is_file() and before.get(p.relative_to(site).as_posix()) != digest(p)}
    downloads = site / 'library/downloads'
    # A book archive has its own catalog and cited/parallels index. Never
    # replace those scoped indexes with their global-site counterparts.
    book_updates = {name: path for name, path in data_updates.items() if book_zip_member(name)}
    rewrite_zip(downloads / 'books' / (SLUG + '.zip'), book_updates)
    rewrite_zip(downloads / 'rav-tzadok-library.zip', data_updates, complete=True)
    download_index = read(downloads / 'index.json')
    download_index['version'] = manifest['version']
    download_index['library']['bytes'] = (downloads / 'rav-tzadok-library.zip').stat().st_size
    download_index['library']['dataFiles'] = len(manifest['files']) + 1
    matches = [book for book in download_index['books'] if book['slug'] == SLUG]
    require(len(matches) == 1, 'Kometz ZIP is absent from download index')
    matches[0]['bytes'] = (downloads / 'books' / (SLUG + '.zip')).stat().st_size
    write(downloads / 'index.json', download_index)
    after = inventory(site)
    changed = sorted(name for name in after if before.get(name) != after[name])
    removed = sorted(set(before) - set(after))
    allowed = shell_files | citation_files | restored | {'library/data/files.json', 'library/data/' + SLUG + '/toc.json', 'library/downloads/index.json', 'library/downloads/books/' + SLUG + '.zip', 'library/downloads/rav-tzadok-library.zip', 'mcp-data/text/' + SLUG + '.json', 'mcp-data/cited.json'}
    allowed.update('library/data/' + SLUG + '/' + str(i) + '.json' for i in changed_sections)
    search_file = lambda name: name.startswith('mcp-data/search/' + SLUG + '.') or name.startswith('mcp-data/text-chunks/' + SLUG + '/')
    require(all(name in allowed or search_file(name) for name in changed), 'Unrelated files changed: ' + str([name for name in changed if name not in allowed and not search_file(name)]))
    require(all(search_file(name) for name in removed), 'Unrelated published files were removed')
    report = {'schemaVersion': 1, 'revision': revision, 'editionSha256': digest(EDITION_FILE), 'phrasePairs': reviewed['phrasePairs'], 'footnotes': reviewed['footnotes'], 'originalFootnotes': len(old_notes), 'firstFootnote': first, 'lastFootnote': first + reviewed['footnotes'] - 1, 'followingNotesRenumberedBy': delta, 'downstreamSections': sorted(downstream_hashes, key=int), 'targetHeadingHashes': heading_hashes, 'downstreamContentHashes': downstream_hashes, 'stableMcpParagraphsSha256': stable_mcp_hash, 'targetOwners': sorted(owners), 'downstreamOwners': sorted(downstream_refs), 'changedFiles': changed, 'removedFiles': removed, 'hashes': {name: after[name] for name in changed}, 'unchangedInventorySha256': object_hash({name: value for name, value in before.items() if name not in changed and name not in removed}), 'unrelatedFilesPreserved': len(before) - len(set(changed) & set(before)) - len(removed), 'dataVersion': manifest['version'], 'restoredDeclaredDotfiles': sorted(restored), 'assertions': {'reviewedPreimagesMatched': True, 'canonicalParagraphsPreserved': True, 'headingsPreserved': True, 'onlyDownstreamDisplayNumbersChanged': True, 'unrelatedFilesPreserved': True, 'offlineCopiesMatch': True}}
    write(site / REPORT, report)
    verify(site)
    print(json.dumps({'mode': 'applied', **report}))


def verify(site):
    site = Path(site).resolve()
    reviewed = edition()
    report = read(site / REPORT)
    require(report['revision'] == reviewed['revision'] and report['editionSha256'] == digest(EDITION_FILE), 'Published edition identity differs')
    book = site / 'library/data' / SLUG
    all_notes = []
    for section in reviewed['sections']:
        items = read(book / (str(section['id']) + '.json'))
        require(units(items) == expected_items(section, report['firstFootnote'], reviewed['revision']), 'Published target differs from reviewed edition: ' + section['ref'])
        require(object_hash([item for item in items if 'p' not in item]) == report['targetHeadingHashes'][str(section['id'])], 'Target headings changed')
        for item in units(items):
            for note in item['footnotes']:
                validate_note(note, item)
        all_notes.extend(notes(items))
    require([n['number'] for n in all_notes] == list(range(report['firstFootnote'], report['lastFootnote'] + 1)), 'New notes are not continuous')
    for identifier, expected in report['downstreamContentHashes'].items():
        require(object_hash(without_display_numbers(read(book / (identifier + '.json')))) == expected, 'Downstream source text or metadata changed')
    mcp = read(site / 'mcp-data/text' / (SLUG + '.json'))
    byref = {p['r']: p for p in mcp['paras'] if p['r'] in report['targetOwners']}
    cited = read(site / 'mcp-data/cited.json')
    for section in reviewed['sections']:
        item = units(read(book / (str(section['id']) + '.json')))[0]
        p = byref[section['ref'] + ':1']
        require(p['p'] == [[plain(a), plain(b)] for a, b in item['p']], 'MCP phrase pairs differ')
        require(p['f'] == [[str(n['number']), '\n'.join(plain(x['text']) for x in n['paragraphs']), n['phraseIndex'], 'h', n['heCharOffset']] for n in item['footnotes']], 'MCP notes differ')
        require(p['a'] == citation_anchors(item), 'MCP citation anchors differ')
        require({r for r, *_ in p['c']} == set(p['a']), 'MCP forward citations differ')
        for ref, *_ in p['c']:
            require(p['r'] in cited.get(ref, []), 'Missing reverse MCP citation: ' + ref)
    stable = [mask_mcp_numbers(p) if p['r'] in report['downstreamOwners'] else p for p in mcp['paras'] if p['r'] not in report['targetOwners']]
    require(object_hash(stable) == report['stableMcpParagraphsSha256'], 'Unrelated MCP paragraphs changed')
    for archive_name in ['books/' + SLUG + '.zip', 'rav-tzadok-library.zip']:
        with zipfile.ZipFile(site / 'library/downloads' / archive_name) as archive:
            for relative in report['changedFiles']:
                if relative.startswith('library/data/'):
                    member = relative.removeprefix('library/')
                    if archive_name == 'rav-tzadok-library.zip' or book_zip_member(member):
                        require(archive.read(member) == (site / relative).read_bytes(), 'Offline copy differs: ' + member)
            for identifier in TARGETS:
                name = 'data/' + SLUG + '/' + str(identifier) + '.json'
                require(archive.read(name) == (book / (str(identifier) + '.json')).read_bytes(), 'Target missing from offline book')
    actual = inventory(site)
    for name, expected in report['hashes'].items():
        require(actual.get(name) == expected, 'Published file hash differs: ' + name)
    require(all(name not in actual for name in report['removedFiles']), 'An obsolete search chunk reappeared')
    require(object_hash({name: value for name, value in actual.items() if name not in report['changedFiles']}) == report['unchangedInventorySha256'], 'Unrelated site inventory changed')
    return report


if __name__ == '__main__':
    require(len(sys.argv) == 3 and sys.argv[1] in ('apply', 'verify'), 'Usage: publish-kometz-ii70-72.py apply|verify SITE')
    if sys.argv[1] == 'apply':
        apply(sys.argv[2])
    else:
        result = verify(sys.argv[2])
        print(json.dumps({'mode': 'verified', 'revision': result['revision'], 'phrasePairs': result['phrasePairs'], 'footnotes': result['footnotes']}))

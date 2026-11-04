"""Publish the Parallels panel (HaMafteach HaShalem, machine-learned parallels, Chassidus/Kabbalah/Machshava/Mussar)
and the HaMafteach MCP data over the ACTUAL current Pages publication. Nothing is rebuilt.

Modes:
  metadata        find the live publication artifact (as scripts/new-books-release.py does); pin it and main's head
  apply SITE      add the panel files and MCP shards, patch library/index.html and library/sw.js, and prove that no
                  other published file changed
  guard           main and the live publication are still the pinned ones
  verify-live     the new files are being served
"""
import hashlib, json, os, re, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
STATE = Path('mafteach-release-state.json')
PANEL_V = '20261104-mafteach-edition-v9'
SEARCH_V = '20261102-mafteach-ask-v11'
NEW_DIRS = ['library/mafteach', 'library/ml-parallels', 'library/genre-parallels', 'library/mafteach-links']
ALLOWED = re.compile(r'^(index\.html|editions/tzidkas-hatzaddik[^/]*|editions/tzidkas-hatzaddik-pages/page-\d\d\.webp|editions/sample\.(js|html)|library/editions/sample\.html|library/index\.html|library/sw\.js|library/mafteach-panel\.js|library/mafteach-search\.js|library/(mafteach|ml-parallels|genre-parallels|mafteach-links)/.+|mcp-data/mafteach/.+|library/data/peri-tzadik/(16[6-9]|17[0-9]|18[0-6]|80[1-9]|810|toc|links)\.json|library/data/(catalog|files)\.json|library/data/cited/[a-z0-9-]+\.json|mcp-data/(catalog|text/peri-tzadik)\.json)$')   # + the reviewed Chayei Sarah edition
MAX_BYTES = 10_000_000


def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as s:
        for b in iter(lambda: s.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def api(route):
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if os.environ.get('GITHUB_TOKEN'): headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    with urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/' + REPO + route, headers=headers), timeout=60) as r:
        return json.load(r)


def publishers():
    result = {}
    for wf in Path('.github/workflows').glob('*.yml'):
        last = ''
        for line in wf.read_text().splitlines():
            if line.lstrip().startswith('- name:'): last = line.split('- name:', 1)[1].strip()
            if 'uses: actions/deploy-pages@' in line: result[wf.as_posix()] = last
    return result


def latest_publication():
    """The run whose deploy-pages step most recently succeeded on main, and its github-pages artifact."""
    known = publishers()
    current_run = str(os.environ.get('GITHUB_RUN_ID', ''))
    cands = []
    for run in api('/actions/runs?branch=main&per_page=100')['workflow_runs']:
        if str(run['id']) == current_run or run['path'] not in known or run['status'] != 'completed': continue
        jobs = api('/actions/runs/' + str(run['id']) + '/jobs?per_page=100')['jobs']
        done = [s for j in jobs for s in j.get('steps', []) if s['name'] == known[run['path']] and s['conclusion'] == 'success']
        if done: cands.append((max(s['completed_at'] for s in done), run))
    assert cands, 'No verified Pages deployment found; refusing to publish'
    at, run = max(cands, key=lambda x: x[0])
    art = next((a for a in api('/actions/runs/' + str(run['id']) + '/artifacts')['artifacts'] if a['name'] == 'github-pages' and not a['expired']), None)
    assert art, 'The current publication artifact is unavailable; refusing an older baseline'
    return {'runId': run['id'], 'artifactId': art['id'], 'deployedAt': at, 'workflow': run['path']}


def main_head(): return api('/git/ref/heads/main')['object']['sha']


def inventory(root):
    return {p.relative_to(root).as_posix(): digest(p) for p in sorted(root.rglob('*')) if p.is_file()}


def patch_index(text):
    if not ('mafteach-panel.js' in text and 'AkivaMafteach?.mount' in text):
        tags = re.findall(r'<script src="connected-ideas\.js\?v=[^"]+"></script>', text)
        assert len(tags) == 1, 'Reader script anchor not found exactly once'
        text = text.replace(tags[0], tags[0] + '\n<script src="mafteach-panel.js?v=' + PANEL_V + '"></script>')
        mount = 'mountConnectedIdeas(d,sec);'
        assert text.count(mount) == 1, 'Reader mount anchor not found exactly once'
        text = text.replace(mount, mount + '\n  window.AkivaMafteach?.mount(d, sec, {toHash, esc});   // HaMafteach HaShalem and suggested parallels')
    text = re.sub(r'mafteach-panel\.js\?v=[^"]+', 'mafteach-panel.js?v=' + PANEL_V, text)
    # Mafteach search page and shiur builder
    if 'mafteach-search.js' not in text:
        tags = re.findall(r'<script src="mafteach-panel\.js\?v=[^"]+"></script>', text)
        assert len(tags) == 1, 'Panel script anchor not found exactly once'
        text = text.replace(tags[0], tags[0] + '\n<script src="mafteach-search.js?v=' + SEARCH_V + '"></script>')
    text = re.sub(r'mafteach-search\.js\?v=[^"]+', 'mafteach-search.js?v=' + SEARCH_V, text)
    if 'href="#/mafteach"' not in text:
        nav = '<a href="#/support">Support</a></nav>'
        assert text.count(nav) == 1, 'Nav anchor not found exactly once'
        text = text.replace(nav, '<a href="#/mafteach">Mafteach</a>' + nav)
    if "AkivaMafteachSearch.render" not in text:
        anchor = "  if (kind === 'book') return renderBook(arg);"
        assert text.count(anchor) == 1, 'Route anchor not found exactly once'
        text = text.replace(anchor, "  { const k0 = kind.split('?')[0]; if ((k0 === 'mafteach' || k0 === 'shiur') && window.AkivaMafteachSearch) return window.AkivaMafteachSearch.render(app, k0, new URLSearchParams(h.split('?').slice(1).join('?')), {fetchText, toHash, esc}); }   // HaMafteach search and shiur builder\n" + anchor)
    # The Mafteach in the side panel: a tab beside Connections / Tools / About, a line atop Connections, a Tools item
    SEC = "(R.sections.filter(s => ref === s.sectionRef || ref.startsWith(s.sectionRef + ':') || ref.startsWith(s.sectionRef + ' ')).sort((a, b) => b.sectionRef.length - a.sectionRef.length)[0] || {}).sectionRef || ref"
    if 'data-tab="mafteach"' not in text:
        a = '<button role="tab" data-tab="connections">Connections</button>'
        assert text.count(a) == 1, 'Panel tab anchor not found exactly once'
        text = text.replace(a, a + '<button role="tab" data-tab="mafteach">Mafteach</button>')
    if "tab === 'mafteach'" not in text:
        a = "  if (tab === 'tools') return renderTools(ref, c);"
        assert text.count(a) == 1, 'Panel showTab anchor not found exactly once'
        text = text.replace(a, "  if (tab === 'mafteach' && window.AkivaMafteach?.panelTab) { const seq = ++panelSeq; c.onclick = null; return window.AkivaMafteach.panelTab(ref, c, {toHash, esc, alive: () => seq === panelSeq, sectionRef: " + SEC + "}); }   // HaMafteach HaShalem\n" + a)
        a = "  renderConnections(ref, c);"
        assert text.count(a) == 1, 'Panel connections anchor not found exactly once'
        text = text.replace(a, "  const done = renderConnections(ref, c), seq = panelSeq;\n  if (window.AkivaMafteach?.connectionsBanner) Promise.resolve(done).then(() => window.AkivaMafteach.connectionsBanner(" + SEC + ", c, () => showTab(ref, 'mafteach'), {alive: () => seq === panelSeq}));")
    if "data-act=\"maf\"" not in text:
        a = 'Search Sefaria for this phrase</a>`;'
        assert text.count(a) == 1, 'Tools anchor not found exactly once'
        text = text.replace(a, 'Search Sefaria for this phrase</a>\n    <button class="tool" data-act="maf">${ICON.link}HaMafteach HaShalem: topics, sources and parallels</button>\n    <a class="tool" href="#/mafteach">${ICON.ext}Search the Mafteach or build a shiur</a>`;')
        a = "    const v = {link: url, he, en,"
        assert text.count(a) == 1, 'Tools click anchor not found exactly once'
        text = text.replace(a, "    if (b.dataset.act === 'maf') return showTab(ref, 'mafteach');\n" + a)
    # Footnotes: one open at a time; tap the open note (or its marker) to close it (scripts/footnote-toggle.json)
    if 'function closeOpenFootnotes(' not in text:
        ft = json.loads(Path('scripts/footnote-toggle.json').read_text(encoding='utf-8'))
        assert text.count(ft['old']) == 1, 'Footnote click handler not found exactly once'
        text = text.replace(ft['old'], ft['new'])
        a = 'function anchoredPhrase(value, notes, language, scope) {'
        assert text.count(a) == 1, 'Footnote function anchor not found exactly once'
        text = text.replace(a, ft['fn'] + a)
        text = text.replace('</style>', '.reader-footnote.open{cursor:pointer}\n</style>', 1)
    return text


def patch_sw(text):
    m = re.search(r'const SHELL = `([^`]*)`;', text)
    assert m, 'Service worker SHELL not found'
    marker = '-maf-' + SEARCH_V                      # a new shell cache whenever the panel or search version changes
    if marker not in m.group(1):
        text = text.replace(m.group(0), 'const SHELL = `' + m.group(1) + marker + '`;')
    for name, ver in (('mafteach-panel.js', PANEL_V), ('mafteach-search.js', SEARCH_V)):
        text = re.sub(r"'\./" + re.escape(name) + r"\?v=[^']*'", "'./" + name + "?v=" + ver + "'", text)
        if name not in text:
            anchor = re.search(r"\n(\s*)'\./connected-ideas\.js\?v=[^\n]*\n", text)
            assert anchor, 'Service worker shell list anchor not found'
            text = text.replace(anchor.group(0), anchor.group(0) + anchor.group(1) + "'./" + name + "?v=" + ver + "',\n")
    return text


def apply(site):
    site = Path(site)
    assert (site / 'library/index.html').is_file() and (site / 'mcp-data/catalog.json').is_file(), 'Not a complete site'
    before = inventory(site)
    sizes = {k: (site / k).stat().st_size for k in before}
    for d in NEW_DIRS:
        if (site / d).exists(): shutil.rmtree(site / d)
        shutil.copytree(Path('dist') / d, site / d)
    for js in ('mafteach-panel.js', 'mafteach-search.js'):
        shutil.copy2('dist/library/' + js, site / 'library' / js)
    for name, fn in (('library/index.html', patch_index), ('library/sw.js', patch_sw)):
        f = site / name
        f.write_text(fn(f.read_text(encoding='utf-8')), encoding='utf-8')
    subprocess.run(['node', 'scripts/build-mafteach-index.mjs', str(site / 'mcp-data')], check=True)
    # the reviewed Pri Tzaddik Chayei Sarah 1-11 (interlinear, footnotes, parallels): scripts/pri-chayei-review/apply.py
    subprocess.run([sys.executable, 'scripts/pri-chayei-review/apply.py', str(site)], check=True)
    # the reviewed footnotes of Pri Tzaddik Toldos 1-10: scripts/pri-toldos-review/apply.py
    subprocess.run([sys.executable, 'scripts/pri-toldos-review/apply.py', str(site)], check=True)
    # the interlinear study edition of Pri Tzaddik Vayetzei 1-10 with reviewed footnotes: scripts/pri-vayetzei-review/apply.py
    subprocess.run([sys.executable, 'scripts/pri-vayetzei-review/apply.py', str(site)], check=True)
    # the Tzidkas HaTzaddik two-volume section on the homepage: scripts/tzidkas-homepage/apply.py
    subprocess.run([sys.executable, 'scripts/tzidkas-homepage/apply.py', str(site)], check=True)
    after = inventory(site)
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    removed = [k for k in before if k not in after]
    bad = [k for k in changed if not ALLOWED.match(k)]
    assert not removed or all(ALLOWED.match(k) for k in removed), 'Removed published files: ' + ', '.join(removed[:5])
    assert not bad, 'Unexpected changes: ' + ', '.join(bad[:10])
    # a file already over the limit on the live site may be rewritten, never grown (mcp-data/text/peri-tzadik.json)
    big = [k for k in changed if k in after and (site / k).stat().st_size > MAX_BYTES and (site / k).stat().st_size > sizes.get(k, 0)]
    assert not big, 'Files over 10 MB: ' + ', '.join(big)
    report = {'changed': len(changed), 'unchanged': sum(1 for k in before if k in after and before[k] == after[k]),
              'shell': [k for k in changed if k in ('library/index.html', 'library/sw.js')]}
    Path('mafteach-release-report.json').write_text(json.dumps(report, indent=1))
    print('Applied:', json.dumps(report))


mode = sys.argv[1]
if mode == 'patch-repo':
    for name, fn in (('dist/library/index.html', patch_index), ('dist/library/sw.js', patch_sw)):
        f = Path(name); f.write_text(fn(f.read_text(encoding='utf-8')), encoding='utf-8')
    print('Patched the repository reader.')
elif mode == 'metadata':
    head = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    assert main_head() == head, 'Main advanced'
    state = {'publication': latest_publication(), 'expectedHead': head}
    STATE.write_text(json.dumps(state, indent=2))
    print(json.dumps(state))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as o:
            o.write(f"artifact={state['publication']['artifactId']}\nrun={state['publication']['runId']}\n")
elif mode == 'apply':
    apply(sys.argv[2])
elif mode == 'guard':
    state = json.loads(STATE.read_text())
    assert main_head() == state['expectedHead'], 'Main advanced; re-run on the new head'
    assert latest_publication()['artifactId'] == state['publication']['artifactId'], 'A newer site was published; re-run on it'
    print('Main and live publication unchanged.')
elif mode == 'verify-live':
    for name in ('library/mafteach-panel.js', 'library/mafteach-search.js', 'library/mafteach/index.json', 'library/ml-parallels/index.json',
                 'library/genre-parallels/index.json', 'library/mafteach-links/topics-01.json', 'mcp-data/mafteach/glossary.json',
                 'library/data/peri-tzadik/168.json'):
        for k in range(20):
            try:
                with urllib.request.urlopen(PUBLIC + name + '?check=' + str(time.time_ns()), timeout=60) as r:
                    body = r.read()
                    assert r.status == 200
                    if name.endswith('/168.json'): assert 'Parallels beyond the library'.encode() in body, 'old Chayei Sarah still live'
                    print('live:', name); break
            except Exception:
                time.sleep(15)
        else:
            raise SystemExit('Not live: ' + name)
else:
    raise SystemExit('Use metadata, apply, guard or verify-live')

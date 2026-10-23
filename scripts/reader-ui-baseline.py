"""Restore the current published artifact and prove this is a four-file UI-only change."""
import hashlib, json, os, pathlib, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request, zipfile
REPO = 'akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
PUBLIC = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
ROOT = pathlib.Path('.ui-site')
STATE = pathlib.Path('reader-ui-baseline.json')
ALLOW = {'library/index.html','library/sw.js','library/responsive-ui.css','library/responsive-ui.js'}
PUBLISHERS = {'.github/workflows/pages.yml','.github/workflows/divrei-source-release.yml','.github/workflows/divrei-media-release.yml','.github/workflows/reader-ui-release.yml'}
def api(route, payload=None):
    headers={'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    data=None if payload is None else json.dumps(payload).encode()
    if data is not None: headers['Content-Type']='application/json'
    with urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/'+REPO+route,data=data,headers=headers),timeout=90) as r: return json.load(r)
def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def inventory():
    return {p.relative_to(ROOT).as_posix():digest(p) for p in sorted(ROOT.rglob('*')) if p.is_file()}
def latest():
    runs=api('/actions/runs?branch=main&status=success&per_page=100')['workflow_runs']
    for run in sorted(runs,key=lambda r:r['updated_at'],reverse=True):
        if run['path'] not in PUBLISHERS or run['conclusion']!='success':continue
        artifacts=api('/actions/runs/'+str(run['id'])+'/artifacts')['artifacts']
        for artifact in artifacts:
            if artifact['name']=='github-pages' and not artifact['expired']:
                return {'run':run['id'],'commit':run['head_sha'],'artifact':artifact['id'],'digest':artifact.get('digest'),'size':artifact['size_in_bytes']}
    raise AssertionError('No successful complete publication artifact found; refusing an unverified rebuild')
def live_hash(name):
    request=urllib.request.Request(PUBLIC+name+'?ui_verification='+str(time.time_ns()),headers={'Cache-Control':'no-cache'})
    with urllib.request.urlopen(request,timeout=60) as r:return hashlib.sha256(r.read()).hexdigest()
def guard(state):
    assert latest()['artifact']==state['publication']['artifact'],'The production baseline changed; restore the latest release rather than overwrite it'
    for name in ['library/index.html','library/sw.js','library/data/catalog.json']:
        assert live_hash(name)==state['files'][name], 'Live publication differs from baseline: '+name
    print('Verified the latest successful artifact still matches the live reader, service worker and catalog.')
mode=sys.argv[1]
if mode=='restore':
    publication=latest()
    with tempfile.TemporaryDirectory(prefix='akiva-ui-') as td:
        archive=pathlib.Path(td)/'site.zip'
        with archive.open('wb') as out:
            subprocess.run(['gh','api',f'/repos/{REPO}/actions/artifacts/{publication["artifact"]}/zip'],stdout=out,check=True)
        if publication['digest']:assert 'sha256:'+digest(archive)==publication['digest'],'Artifact digest mismatch'
        with zipfile.ZipFile(archive) as z:
            assert 'artifact.tar' in z.namelist(),'Missing Pages tar payload'
            with z.open('artifact.tar') as source,open(pathlib.Path(td)/'artifact.tar','wb') as dest:shutil.copyfileobj(source,dest)
        if ROOT.exists():shutil.rmtree(ROOT)
        ROOT.mkdir()
        destination=ROOT.resolve()
        with tarfile.open(pathlib.Path(td)/'artifact.tar','r:') as t:
            members=t.getmembers()
            for m in members:
                target=(destination/m.name).resolve()
                assert target==destination or destination in target.parents,'Unsafe archive path'
                assert m.isdir() or m.isfile(),'Archive links/special files are not allowed'
            t.extractall(destination,members=members,filter='data')
    state={'publication':publication,'files':inventory()}
    STATE.write_text(json.dumps(state,indent=2))
    guard(state)
    print('Restored',len(state['files']),'published files without rebuilding any books.')
elif mode=='verify':
    state=json.loads(STATE.read_text());after=inventory();before=state['files']
    removed=set(before)-set(after);changed={p for p in after if before.get(p)!=after[p]}
    assert not removed, 'Publication files were removed: '+str(removed)
    assert changed<=ALLOW,'Unexpected non-UI file changes: '+str(changed-ALLOW)
    assert {'library/index.html','library/sw.js'}<=changed or all(p in before for p in ALLOW)
    report={'publication':state['publication'],'changed':sorted(changed),'preservedFiles':len(before)-len(changed&set(before)),'removed':[],'expectedLive':{p:after[p] for p in ALLOW}}
    pathlib.Path('reader-ui-preservation.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
elif mode=='guard':guard(json.loads(STATE.read_text()))
elif mode=='published':
    report=json.loads(pathlib.Path('reader-ui-preservation.json').read_text())
    for attempt in range(18):
        try:
            for name,expected in report['expectedLive'].items():assert live_hash(name)==expected,'CDN has not refreshed '+name
            print('Verified exact live bytes of the new header, cache shell, responsive CSS and JavaScript.');break
        except Exception:
            if attempt==17:raise
            time.sleep(10)
elif mode=='blobs':
    # Prepare immutable blobs only. Moving a branch or publishing requires a separate guarded connector action.
    entries=[]
    for name in ['dist/library/index.html','dist/library/sw.js','.github/workflows/pages.yml']:
        result=api('/git/blobs',{'content':pathlib.Path(name).read_text(),'encoding':'utf-8'})
        entries.append({'path':name,'mode':'100644','type':'blob','sha':result['sha']})
    parent=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}'],text=True).strip()
    pathlib.Path('reader-ui-patch-blobs.json').write_text(json.dumps({'parent':parent,'base_tree':tree,'entries':entries},indent=2))
    print(pathlib.Path('reader-ui-patch-blobs.json').read_text())
else:raise SystemExit('Unknown mode')

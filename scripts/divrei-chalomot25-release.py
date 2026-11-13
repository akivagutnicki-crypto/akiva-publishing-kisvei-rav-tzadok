"""Pin, restore, and guard the complete current Pages publication."""
import hashlib,json,os,sys,tarfile,time,urllib.request
from pathlib import Path
REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
PUBLIC='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
RUN=43366095733;ART=14011005456
DIGEST='sha256:d1d231455cba2ea6a805e35d449580dd600c55b8e87a8a62e4a89e64ef43ca72'
WATCH=['index.html','library/index.html','library/open/index.html','library/sw.js','library/data/files.json','library/data/divrei-chalomot/24.json','library/downloads/index.json','mcp-data/catalog.json']
STATE=Path('divrei-chalomot25-release-state.json')
def get(url,api=False):
 headers={'Cache-Control':'no-cache','User-Agent':'Akiva-Publishing-DC25-Review'}
 if api:headers.update({'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'Accept':'application/vnd.github+json'})
 with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=45) as r:return r.read()
def api(route):return json.loads(get('https://api.github.com/repos/'+REPO+route,True))
def live(rel):return hashlib.sha256(get(PUBLIC+rel+'?dc25-guard='+str(time.time_ns()))).hexdigest()
def head():return api('/git/ref/heads/main')['object']['sha']
mode=sys.argv[1]
if mode=='metadata':
 art=api('/actions/artifacts/'+str(ART));run=api('/actions/runs/'+str(RUN))
 assert art['name']=='github-pages' and not art['expired'] and art['digest']==DIGEST
 assert art['workflow_run']['id']==RUN and run['conclusion']=='success'
 assert art['workflow_run']['head_sha']==run['head_sha']=='153666fb01f42f0aaceda16861093ce4bd6c7b30'
 assert head()==os.environ['GITHUB_SHA'],'Main advanced before publication'
 state={'run':RUN,'artifact':ART,'head':os.environ['GITHUB_SHA'],'live':{r:live(r) for r in WATCH}}
 STATE.write_text(json.dumps(state))
 with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write(f'run={RUN}\nartifact={ART}\n')
 print('Pinned the last successful complete Pages artifact and current live fingerprints')
elif mode=='restore':
 site=Path(sys.argv[2]).resolve();archive=Path(sys.argv[3]);site.mkdir(parents=True,exist_ok=False)
 with tarfile.open(archive,'r:') as t:
  members=t.getmembers()
  for m in members:
   target=(site/m.name).resolve()
   assert target==site or site in target.parents
   assert m.isdir() or m.isfile()
  t.extractall(site,members=members,filter='data')
 state=json.loads(STATE.read_text())
 for r,h in state['live'].items():assert hashlib.sha256((site/r).read_bytes()).hexdigest()==h,'The pinned archive is not the current live publication: '+r
 print('Restored and matched the actual current publication')
elif mode=='guard':
 state=json.loads(STATE.read_text());assert head()==state['head'],'Main advanced; refusing to overwrite an intervening revision'
 for r,h in state['live'].items():assert live(r)==h,'Live publication advanced: '+r
 print('Main and live publication remain unchanged')
elif mode=='verify-live':
 site=Path(sys.argv[2]);report=json.loads((site/'library/divrei-chalomot25-publication.json').read_text())
 # The Pages CDN can take a few seconds after a successful deployment.
 for attempt in range(12):
  try:
   actual=json.loads(get(PUBLIC+'library/divrei-chalomot25-publication.json?review='+str(time.time_ns())))
   assert actual['revision']==report['revision']
   for r in ['library/data/divrei-chalomot/24.json','library/index.html','library/open/index.html','library/sw.js','mcp-data/text/divrei-chalomot.json']:
    assert live(r)==hashlib.sha256((site/r).read_bytes()).hexdigest(),'Live content differs: '+r
   print('PASS: corrected PDF translation, notes, both reader entry points, cache revision and MCP text are live');break
  except Exception:
   if attempt==11:raise
   time.sleep(10)
else:raise ValueError(mode)

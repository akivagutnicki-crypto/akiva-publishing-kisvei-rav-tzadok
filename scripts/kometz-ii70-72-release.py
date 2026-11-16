"""Preserve the current complete publication while releasing Kometz II 70–72."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib,json,os,sys,tarfile,time,urllib.parse,urllib.request

REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
PUBLIC='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
RUN=43797049171
ART=14195102852
BASE_SHA='0aff70d0a818b0afe684f7b1eed2b89a957a5913'
DIGEST='sha256:17ab9b52ed60057a85397b9c3b2d6590b34fff17e959d8208ba1c160166218a8'
BASE_DEPLOY_STEP='Publish the Pri Tzaddik Moadim editions'
STATE=Path('kometz-ii70-72-release-state.json')
REPORT='library/kometz-ii70-72-publication.json'
WATCH=['index.html','library/index.html','library/open/index.html','library/sw.js','library/data/files.json','library/data/catalog.json',
       'library/data/kometz-haminchah/toc.json','library/data/kometz-haminchah/links.json','library/downloads/index.json','mcp-data/catalog.json','mcp-data/text/kometz-haminchah.json','mcp-data/cited.json']
WATCH += [f'library/data/kometz-haminchah/{n}.json' for n in range(183,194)]

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def get(url,api=False):
    headers={'Cache-Control':'no-cache','User-Agent':'Akiva-Publishing-Kometz-II70-72'}
    if api:headers.update(Authorization='Bearer '+os.environ['GITHUB_TOKEN'],Accept='application/vnd.github+json')
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=90) as response:return response.read()
def api(route):return json.loads(get('https://api.github.com/repos/'+REPO+route,True))
def public_bytes(rel):return get(PUBLIC+urllib.parse.quote(rel,safe='/')+'?kometz-review='+str(time.time_ns()))
def live_hash(rel):return hashlib.sha256(public_bytes(rel)).hexdigest()
def live_hashes(paths):
    with ThreadPoolExecutor(max_workers=8) as executor:return dict(zip(paths,executor.map(live_hash,paths)))
def head():return api('/git/ref/heads/main')['object']['sha']

def metadata():
    artifact=api('/actions/artifacts/'+str(ART));run=api('/actions/runs/'+str(RUN))
    assert artifact['name']=='github-pages' and not artifact['expired']
    assert artifact['digest']==DIGEST and artifact['workflow_run']['id']==RUN
    assert artifact['workflow_run']['head_sha']==run['head_sha']==BASE_SHA
    # This actual live release deployed successfully, then failed its later
    # readback step. Pin the successful deployment, not an older green run.
    assert run['status']=='completed'
    jobs=api('/actions/runs/'+str(RUN)+'/jobs?per_page=100')['jobs']
    deployments=[s for job in jobs for s in job['steps'] if s['name']==BASE_DEPLOY_STEP]
    assert len(deployments)==1 and deployments[0]['conclusion']=='success'
    assert head()==os.environ['GITHUB_SHA'],'Main advanced before the scoped publication'
    state={'run':RUN,'artifact':ART,'artifactDigest':DIGEST,'baselineCommit':BASE_SHA,'baselineWorkflowConclusion':run['conclusion'],'baselineDeploymentStep':BASE_DEPLOY_STEP,'baselineDeploymentConclusion':'success','head':os.environ['GITHUB_SHA'],'live':live_hashes(WATCH)}
    STATE.write_text(json.dumps(state,indent=2))
    with open(os.environ['GITHUB_OUTPUT'],'a') as out:out.write(f'run={RUN}\nartifact={ART}\n')
    print('Pinned the successful current Pages artifact and the live publication fingerprints.')

def restore(site,archive):
    site=Path(site).resolve();site.mkdir(parents=True,exist_ok=False)
    with tarfile.open(archive,'r:') as source:
        members=source.getmembers()
        for member in members:
            target=(site/member.name).resolve()
            assert target==site or site in target.parents,'Unsafe archive path'
            assert member.isdir() or member.isfile(),'Unexpected archive member type'
        source.extractall(site,members=members,filter='data')
    state=json.loads(STATE.read_text())
    for rel,expected in state['live'].items():assert digest(site/rel)==expected,'Pinned artifact differs from current live publication: '+rel
    print('Restored the complete current site and matched all watched live files.')

def guard():
    state=json.loads(STATE.read_text())
    assert head()==state['head'],'Main advanced; refusing to overwrite an intervening revision'
    for rel,actual in live_hashes(list(state['live'])).items():assert actual==state['live'][rel],'Live publication advanced: '+rel
    print('Main and the current live publication remain unchanged.')

def verify_live(site):
    site=Path(site);report=json.loads((site/REPORT).read_text())
    # Every changed public text/index is compared. ZIP contents are verified
    # before deployment; the complete public ZIP is intentionally not redownloaded.
    paths=[p for p in report['hashes'] if not p.endswith('.zip') and not any(x.startswith('.') for x in Path(p).parts)]
    for attempt in range(12):
        try:
            actual=json.loads(public_bytes(REPORT));assert actual['revision']==report['revision']
            hashes=live_hashes(paths)
            for rel,h in hashes.items():assert h==report['hashes'][rel],'Published content differs: '+rel
            evidence={'revision':report['revision'],'verifiedPublicFiles':len(paths),'hashes':hashes,'sections':['2:70','2:71','2:72'],'status':'published-and-verified'}
            Path('kometz-ii70-72-live-verification.json').write_text(json.dumps(evidence,indent=2))
            print('PASS: all changed public text/index files, Reader cache revision, and MCP content match the reviewed edition.');return
        except Exception:
            if attempt==11:raise
            time.sleep(8)

if __name__=='__main__':
    mode=sys.argv[1]
    if mode=='metadata':metadata()
    elif mode=='restore':restore(sys.argv[2],sys.argv[3])
    elif mode=='guard':guard()
    elif mode=='verify-live':verify_live(sys.argv[2])
    else:raise ValueError(mode)

#!/usr/bin/env python3
"""Publish the supplied Shemos Word edition over the complete current Pages artifact.

The full-rebuild gate is deliberately left in place. Unrelated publication files
are protected by a before/after SHA-256 inventory. The offline text archive and
the Pri Tzaddik archive are rebuilt from the final restored publication only.
"""
import hashlib
import html
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

spec=importlib.util.spec_from_file_location('shemos_build',Path(__file__).with_name('build.py'))
B=importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
PUBLIC='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/'
REPO='akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok'
STATE=Path('pri-shemos-release-state.json')
REPORT=Path('pri-shemos-release-report.json')
rd=B.read_json; wr=B.write_json; sha=B.digest
STUDY='Akiva Publishing — Interlinear Study Edition'

def api(route):
    headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    if os.environ.get('GITHUB_TOKEN'):headers['Authorization']='Bearer '+os.environ['GITHUB_TOKEN']
    req=urllib.request.Request('https://api.github.com/repos/'+REPO+route,headers=headers)
    with urllib.request.urlopen(req,timeout=60) as r:return json.load(r)

def latest():
    publishers={}
    for p in Path('.github/workflows').glob('*.yml'):
        name=''
        for line in p.read_text().splitlines():
            if line.lstrip().startswith('- name:'):name=line.split('- name:',1)[1].strip()
            if 'uses: actions/deploy-pages@' in line:publishers[p.as_posix()]=name
    candidates=[]
    for run in api('/actions/runs?branch=main&per_page=100')['workflow_runs']:
        if str(run['id'])==os.environ.get('GITHUB_RUN_ID') or run['status']!='completed' or run.get('conclusion')=='skipped' or run['path'] not in publishers:continue
        jobs=api(f"/actions/runs/{run['id']}/jobs?per_page=100")['jobs']
        dates=[s['completed_at'] for j in jobs for s in j.get('steps',[]) if s['name']==publishers[run['path']] and s['conclusion']=='success']
        if dates:candidates.append((max(dates),run['id']))
    assert candidates,'No proven current Pages publication'
    date,run=max(candidates)
    artifact=next((a for a in api(f'/actions/runs/{run}/artifacts')['artifacts'] if a['name']=='github-pages' and not a['expired']),None)
    assert artifact,'Current complete publication artifact unavailable'
    return {'run':run,'artifact':artifact['id'],'deployedAt':date}

def head():return api('/git/ref/heads/main')['object']['sha']
def inventory(site):return {p.relative_to(site).as_posix():sha(p) for p in sorted(site.rglob('*')) if p.is_file()}
def leaves(node):return sum((leaves(c) for c in node['children']),[]) if 'children' in node else [node]
def plain(s):return html.unescape(re.sub('<[^>]*>','',s))

def apply(site):
    site=Path(site);lib=site/'library';data=lib/'data';pt=data/'peri-tzadik'
    m=rd(B.OUTPUT/'manifest.json');secs=m['sections']
    original=rd(pt/'toc.json')
    existing=next((x for x in original['toc']['children'] if x.get('en')==STUDY),None)
    assert existing,'No existing Pri Tzaddik study edition'
    prior=[x for x in existing['children'] if x.get('shemosDocxEdition')]
    before=sum(l.get('shape',0) for x in prior for l in leaves(x))
    existing['children'][:]=[x for x in existing['children'] if not x.get('shemosDocxEdition')]
    all_ids={l.get('id') for l in leaves(original['toc'])}
    assert not ({s['id'] for s in secs}&all_ids),'Reader chapter id collision'
    for v in m['volumes']:
        assert sha(B.SOURCE/v['file'])==v['sha256'],'Source Word file changed'
        target=lib/'downloads'/v['download'];target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(B.SOURCE/v['file'],target)
        group={'en':('Shemos–Mishpatim · Volume I' if v['volume']==1 else 'Terumah–Pekudei · Volume II'),
               'he':('שמות–משפטים' if v['volume']==1 else 'תרומה–פקודי'),
               'shemosDocxEdition':B.EDITION,'children':[]}
        for parsha in dict.fromkeys(s['parashah'] for s in secs if s['volume']==v['volume']):
            ps=[s for s in secs if s['volume']==v['volume'] and s['parashah']==parsha]
            pg={'en':parsha,'he':ps[0]['he'].split(',')[0],'children':[]}
            for s in ps:
                shutil.copyfile(B.OUTPUT/f"{s['id']}.json",pt/f"{s['id']}.json")
                pg['children'].append({k:s[k] for k in ('en','he','id','ref','heRef','parashah','ois')} | {
                    'depth':1,'shape':s['paragraphs'],'il1':True,'interlinear':True,'sep':':',
                    'reviewedEdition':B.EDITION,'downloadDocx':'downloads/'+v['download'],
                    'downloadDocxLabel':group['en']+' · Complete Word edition'})
            group['children'].append(pg)
        existing['children'].append(group)
    wr(pt/'toc.json',original)
    catalog=rd(data/'catalog.json');book=next(b for b in catalog if b['slug']=='peri-tzadik')
    book['segments']=book.get('segments',0)+m['paragraphs']-before
    for v in m['volumes']:
        file='downloads/'+v['download']
        if not any(d['file']==file for d in book.setdefault('downloads',[])):
            book['downloads'].append({'file':file,'label':('Shemos–Mishpatim · Volume I' if v['volume']==1 else 'Terumah–Pekudei · Volume II')+' · Complete interlinear Word edition'})
    wr(data/'catalog.json',catalog)
    # The exact supplied source URL that the older generic whitelist omitted.
    allowed=set()
    for s in secs:
        for it in rd(B.OUTPUT/f"{s['id']}.json"):
            for n in it.get('footnotes',[]):
                for p in n['paragraphs']:
                    for r in p['rich']:
                        u=r.get('href','')
                        if u.startswith('https://github.com/'):allowed.add(u)
    page=lib/'index.html';text=page.read_text()
    text=re.sub(r'/\* Shemos Word edition data revision \*/[^\n]*\n','',text)
    anchor='const editionDataUrl = url => '
    assert text.count(anchor)==1
    text=text.replace(anchor,anchor+f"/* Shemos Word edition data revision */ (url.startsWith('data/peri-tzadik/') || url === 'data/catalog.json' || url === 'data/files.json') ? url + '?edition={B.EDITION}' :\n")
    if allowed and '/* Shemos source URL preservation */' not in text:
        anchor='const safeFootnoteUrl = url => '
        assert text.count(anchor)==1
        text=text.replace(anchor,anchor+'/* Shemos source URL preservation */ '+json.dumps(sorted(allowed),ensure_ascii=False)+'.includes(String(url || \'\')) || ')
    # Match the supplied heading weight. The existing English and Hebrew text
    # sizes remain reader preferences; these rules apply only to this edition.
    if '/* Shemos heading typography */' not in text:
        selectors=','.join('.sec[data-ref^="'+s['ref'].replace('"','')+'"] .subhead' for s in secs)
        text=text.replace('</style>','/* Shemos heading typography */\n'+selectors+'{font-weight:400}\n</style>',1)
    page.write_text(text)
    sw=lib/'sw.js';text=sw.read_text()
    if '-'+B.EDITION not in text:
        text,n=re.subn(r'const SHELL = `([^`]+)`;',lambda m:'const SHELL = `'+m[1]+'-'+B.EDITION+'`;',text,count=1)
        assert n==1
    sw.write_text(text)
    # Keep every existing MCP paragraph and complete note; append the new
    # Word edition, without shortening any earlier publication's notes.
    catpath=site/'mcp-data/catalog.json';textpath=site/'mcp-data/text/peri-tzadik.json'
    cat=rd(catpath);text=rd(textpath);mb=next(b for b in cat['books'] if b['slug']=='peri-tzadik')
    oldsec=mb['sections'];gone={i for i,s in enumerate(oldsec) if s.get('shemosDocxEdition')}
    if gone:
        keep=[i for i in range(len(oldsec)) if i not in gone];remap={old:i for i,old in enumerate(keep)}
        text['paras']=[dict(p,s=remap[p['s']]) for p in text['paras'] if p['s'] not in gone]
        oldsec[:]=[oldsec[i] for i in keep]
        for i,sec in enumerate(oldsec):
            indices=[j for j,p in enumerate(text['paras']) if p['s']==i]
            if indices:sec['first']=indices[0];sec['count']=len(indices)
    for s in secs:
        si=len(oldsec);first=len(text['paras']);pending=[]
        for item in rd(B.OUTPUT/f"{s['id']}.json"):
            if 'h' in item:pending.append(item['h']);continue
            para={'r':s['ref']+':'+str(item['n']),'s':si,'n':item['n'],
                  'p':[[plain(h),plain(e)] for h,e in item['p']]}
            if pending:para['h']=pending;pending=[]
            if item.get('footnotes'):
                para['f']=[[str(n['number']),'\n'.join(p['text'] for p in n['paragraphs']),n['phraseIndex'],'h',n['heCharOffset']] for n in item['footnotes']]
            text['paras'].append(para)
        oldsec.append({'ref':s['ref'],'he':s['heRef'],'title':s['en'],'heTitle':s['he'],
                       'path':STUDY+' › '+s['parashah'],'il':True,'first':first,'count':s['paragraphs'],
                       'edition':'interlinear','parashah':s['parashah'],'ois':s['ois'],'shemosDocxEdition':B.EDITION})
    mb['paragraphs']=len(text['paras']);mb['interlinear']=True
    wr(textpath,text);wr(catpath,cat)
    # A release manifest is also a public, independently readable completion record.
    wr(lib/'pri-shemos-publication.json',m)
    print('Applied',len(secs),'sections and',m['footnotes'],'complete Hebrew-anchored notes')

def exports(site):
    site=Path(site);lib=site/'library';data=lib/'data';downloads=lib/'downloads'
    m=rd(B.OUTPUT/'manifest.json')
    files=sorted(p.relative_to(data).as_posix() for p in data.rglob('*') if p.is_file() and p!=data/'files.json')
    h=hashlib.sha256();size=0
    for name in files:
        body=(data/name).read_bytes();h.update(name.encode());h.update(b'\0');h.update(body);size+=len(body)
    manifest={'version':h.hexdigest()[:16],'bytes':size,'files':files};wr(data/'files.json',manifest)
    index=rd(downloads/'index.json');catalog=rd(data/'catalog.json')
    def create(file,names,docnames,book=None):
        dest=lib/file;old_readme=None
        if dest.is_file():
            with ZipFile(dest) as old:
                old_readme=old.read('README.txt') if 'README.txt' in old.namelist() else None
        with ZipFile(dest,'w',compression=ZIP_DEFLATED,compresslevel=6) as z:
            def put(name,body):
                info=ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=ZIP_DEFLATED
                z.writestr(info,body,compresslevel=6)
            put('README.txt',old_readme or b'Akiva Publishing. Published reader data and documents; source licenses are retained in data/*/toc.json.\n')
            for name in names:
                if book and name=='catalog.json':put('data/'+name,json.dumps([book],ensure_ascii=False,separators=(',',':')).encode())
                else:put('data/'+name,(data/name).read_bytes())
            for name in docnames:put(name,(lib/name).read_bytes())
        return {'bytes':dest.stat().st_size,'dataFiles':len(names),'documents':len(docnames)}
    docs=sorted('downloads/'+p.name for p in downloads.iterdir() if p.is_file() and p.suffix.lower() in ('.docx','.pdf'))
    index['library'].update(create(index['library']['file'],files+['files.json'],docs))
    entry=next(b for b in index['books'] if b['slug']=='peri-tzadik')
    book=next(b for b in catalog if b['slug']=='peri-tzadik')
    with ZipFile(lib/entry['file']) as old:old_docs=[x for x in old.namelist() if x.startswith('downloads/')]
    docs=sorted(set(old_docs+[d['file'] for d in book['downloads']]))
    names=['catalog.json']+[f for f in files if f.startswith('peri-tzadik/') or f in ('cited/peri-tzadik.json','parallels/peri-tzadik.json')]
    entry.update(create(entry['file'],names,docs,book))
    index['version']=manifest['version'];wr(downloads/'index.json',index)
    print('Offline manifest and complete library/Pri Tzaddik ZIPs synchronized:',manifest['version'])

def permitted(name):
    fixed={'library/index.html','library/sw.js','library/data/catalog.json','library/data/files.json',
           'library/data/peri-tzadik/toc.json','library/downloads/index.json','library/downloads/rav-tzadok-library.zip',
           'library/downloads/books/peri-tzadik.zip','mcp-data/catalog.json','mcp-data/text/peri-tzadik.json',
           'library/pri-shemos-publication.json'}
    m=rd(B.OUTPUT/'manifest.json')
    return name in fixed or name in {'library/data/peri-tzadik/'+str(s['id'])+'.json' for s in m['sections']} or name in {'library/downloads/'+v['download'] for v in m['volumes']}

def seal(site):
    site=Path(site);before=rd('pri-shemos-before.json');after=inventory(site)
    changed={k for k in set(before)|set(after) if before.get(k)!=after.get(k)}
    assert not (set(before)-set(after)),'Published files were removed'
    assert all(permitted(k) for k in changed),'Unrelated changes: '+str([k for k in changed if not permitted(k)])
    report={'edition':B.EDITION,'changed':len(changed),'unchanged':len(before)-sum(k in before for k in changed),
            'files':{k:after[k] for k in sorted(changed)},'sources':rd(B.OUTPUT/'manifest.json')['volumes']}
    wr(REPORT,report);print('Preservation:',report['unchanged'],'files unchanged;',report['changed'],'authorized changes')

def live():
    report=rd(REPORT)
    pending=dict(report['files'])
    # All changed files, including both Word files and both archives, are read
    # back from Pages and checked byte for byte against the deployed payload.
    import concurrent.futures
    def check(item):
        name,expected=item
        try:
            with urllib.request.urlopen(PUBLIC+name+'?shemos='+str(time.time_ns()),timeout=90) as r:
                h=hashlib.sha256()
                while True:
                    b=r.read(1024*1024)
                    if not b:break
                    h.update(b)
            return name,h.hexdigest()==expected
        except Exception:return name,False
    for attempt in range(12):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            for name,ok in ex.map(check,list(pending.items())):
                if ok:pending.pop(name,None)
        if not pending:break
        print('Waiting for current Pages files:',len(pending),flush=True);time.sleep(15)
    assert not pending,'Published bytes differ: '+str(list(pending)[:8])
    wr('pri-shemos-live-verification.json',{'edition':B.EDITION,'verifiedFiles':len(report['files']),'footnotes':3151,'ok':True})
    print('Every changed file is publicly live and matches its release SHA-256')

def main():
    mode=sys.argv[1]
    if mode=='metadata':
        expected=os.environ.get('GITHUB_SHA') or subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
        assert head()==expected,'Main advanced; publish the current head'
        publication=latest();wr(STATE,{'head':expected,'publication':publication})
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'],'a') as out:out.write(f"artifact={publication['artifact']}\nrun={publication['run']}\n")
        print(json.dumps(publication))
    elif mode=='guard':
        s=rd(STATE);assert head()==s['head'],'Main advanced'
        assert latest()['artifact']==s['publication']['artifact'],'Newer site published; rerun on that baseline'
        print('Current main and current publication are still pinned')
    elif mode=='capture':wr('pri-shemos-before.json',inventory(Path(sys.argv[2])))
    elif mode=='apply':apply(sys.argv[2])
    elif mode=='exports':exports(sys.argv[2])
    elif mode=='seal':seal(sys.argv[2])
    elif mode=='live':live()
    else:raise SystemExit('metadata | guard | capture | apply | exports | seal | live')

if __name__=='__main__':main()

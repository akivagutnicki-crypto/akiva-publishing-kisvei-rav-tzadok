import json, re, html, hashlib
from pathlib import Path
from collections import Counter

ROOT=Path('/workspace/scratch/f85ae98f1669')
SITE=ROOT/'tmp/batch-engineering/current-site'
P=ROOT/'review-work/ois-76-80.json'
data=json.loads(P.read_text())
catalog=json.loads((SITE/'mcp-data/catalog.json').read_text())['books']
connections=json.loads((SITE/'library/connected-ideas/catalog.json').read_text())['records']
def plain(t):return html.unescape(re.sub('<[^>]*>','',t))
def clean(t):return re.sub(r'\s+',' ',plain(t)).strip()
def norm(t):return re.sub(r'[^\u05d0-\u05ea]','',t)
def strings(x):
    if isinstance(x,str):yield x
    elif isinstance(x,list):
        for y in x:yield from strings(y)
    elif isinstance(x,dict):
        for y in x.values():yield from strings(y)
results=[]
for e in data['entries']:
    rows=json.loads((SITE/f"library/data/tzidkat-hatzadik/{e['section']-1}.json").read_text())
    row=next(r for r in rows if r['n']==e['rowN'])
    target=plain(row['p'][e['phraseIndex']][0])
    assert target.startswith(e['heAnchorPrefix']),e['id']
    assert e['heCharOffset']==len(e['heAnchorPrefix']),e['id']
    assert all(e[k] for k in ('ref','url','he','en','context','sourceEvidence')),e['id']
    ev=e['sourceEvidence'][0]
    assert ev['he']==e['he'] and ev['en']==e['en'],e['id']
    assert ev['heSha256']==hashlib.sha256(e['he'].encode()).hexdigest(),e['id']
    if e.get('readerRef'):
        file=SITE/ev['canonicalSourceFile']
        source=next(r for r in json.loads(file.read_text())['paras'] if r['r']==e['readerRef'])
        sourcehe=clean(' '.join(x[0] for x in source['p']) if 'p'in source else source['t'])
        assert e['he'] in sourcehe,e['id']
        book=next(b for b in catalog if b['slug']==file.stem)
        assert e['url']=='#/read/'+book['sections'][source['s']]['ref'].replace(' ','_'),e['id']
    else:
        assert e['url'].startswith('https://'),e['id']
        assert ev.get('retrievalURL') or ev.get('webRef'),e['id']
    existing=[]
    for r in rows:existing.extend(r.get('footnotes',[]))
    existing.extend(r for r in connections if r.get('originRef','').startswith(f"Tzidkat HaTzadik {e['section']}:") or r.get('originRef')==f"Tzidkat HaTzadik {e['section']}")
    nh=norm(e['he'])
    assert not any(nh in norm(s) for old in existing for s in strings(old) if len(norm(s))>=len(nh)),('existing quotation',e['id'])
    visible=' '.join(e[k] for k in ('ref','url','he','en','context'))
    assert not re.search(r'Biur|Meshulav|Mishulav|Neimos|Ne.imot|\.pdf(?:$|[?#])',visible,re.I),e['id']
    results.append({'section':e['section'],'id':e['id'],'anchor':'exact','evidence':'verified','readerHebrew':'exact-contiguous' if e.get('readerRef') else 'external-primary-source','route':'valid','destinationDuplicate':False})
assert len({(e['section'],e['id']) for e in data['entries']})==len(data['entries'])
out={'status':'passed','entries':len(results),'counts':dict(Counter(e['section'] for e in data['entries'])),'internalCanonicalQuotations':sum(bool(e.get('readerRef')) for e in data['entries']),'checks':results,'proposalSha256':hashlib.sha256(P.read_bytes()).hexdigest()}
(ROOT/'review-work/ois-76-80-validation.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k!='checks'}))

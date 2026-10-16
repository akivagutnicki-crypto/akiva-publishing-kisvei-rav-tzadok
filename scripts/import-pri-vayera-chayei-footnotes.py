#!/usr/bin/env python3
"""Apply ONLY the supplied 929 Vayera/Chayei Sara footnotes after archive restore.
Preserves all text, headings, original notes, TOC ordering, and other books.
"""
import argparse, copy, gzip, hashlib, html, json, re, unicodedata
from pathlib import Path
from urllib.parse import urlparse

TARGETS=[f'Peri Tzadik, Vayera {i}' for i in range(1,8)]+[f'Peri Tzadik, Chayei Sara {i}' for i in range(1,12)]
COUNTS=[194,41,43,51,21,43,16,108,57,25,30,62,38,60,24,37,52,27]
CONTENT_SHA='ca72b10d3eb7aaf160c9c1acb26f3360f10a159d432b5797e07ce9f4675b61f5'
RELEASE='20261016-pri-vayera-chayei-footnotes-929'

def canonical(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()
def sha(x):return hashlib.sha256(x if isinstance(x,bytes) else x.encode()).hexdigest()
def plain(s):return html.unescape(re.sub('<[^>]*>','',str(s or ''))).replace('\u00a0',' ')
def key(s):return ''.join(c for c in s if c.isalnum())
def write(p,x):
    p.parent.mkdir(parents=True,exist_ok=True);t=p.with_name(p.name+'.pri-tmp');t.write_bytes(canonical(x)+b'\n');t.replace(p)
def walk(n):
    out=[n] if n.get('ref') else []
    for c in n.get('children',[]):out+=walk(c)
    return out

def content_sha(sections):
    return sha(canonical([[s['ref'],e['item'],e['note']['number'],e['note']['paragraphs'],e['note']['sources']]
                         for s in sections for e in s['entries']]))

def anchor(note,row):
    n=copy.deepcopy(note);rule=n.pop('importAnchor');idx=n['phraseIndex'];pairs=row['p']
    if not isinstance(idx,int) or not 0<=idx<len(pairs):raise ValueError('Invalid phrase index '+n['sourceId'])
    he=plain(pairs[idx][0]);klen=rule['keyLength'];kh=rule['keyHash']
    if sha(key(he)[:klen])[:16]!=kh:raise ValueError('Hebrew citation moved '+n['sourceId'])
    off=rule['suppliedOffset']
    if not 0<off<=len(he) or sha(key(he[:off]))[:16]!=kh:
        positions=[i for i,c in enumerate(he) if c.isalnum()]
        off=positions[klen-1]+1
    # Never insert a marker in the middle of a niqqud sequence or citation punctuation.
    while off<len(he) and (unicodedata.combining(he[off]) or (not he[off].isalnum() and not he[off].isspace())):off+=1
    if sha(key(he[:off]))[:16]!=kh:raise ValueError('Invalid Hebrew marker boundary '+n['sourceId'])
    n['heCharOffset']=off;n['heAnchorPrefix']=he[:off];n['heWord']=max(1,len(he[:off].split()))
    en=plain(pairs[idx][1]);eo=min(n.get('enCharOffset',len(en)),len(en));n['enCharOffset']=eo;n['enAnchorPrefix']=en[:eo]
    n['provenance']['importRelease']=RELEASE
    n['provenance']['sourceVerification']='User-supplied source content; technical anchoring and text-integrity checks only'
    for p in n['paragraphs']:
        if p.get('text')!=''.join(r['text'] for r in p['rich']):raise ValueError('Truncated popup '+n['sourceId'])
        for r in p['rich']:
            if 'href' in r and urlparse(r['href']).scheme not in ('https','http'):raise ValueError('Unsafe source URL')
    return n, off!=rule['suppliedOffset']

def refslug(ref):
    clean=re.sub(r'\s*\(§\d+\)$','',ref).strip()
    base=re.sub(r'\s+\d+[ab]?(?:[:–\-]\d+[ab]?)*(?:[:–\-]\d+[ab]?)*$','',clean).strip()
    slug=re.sub('[^a-z0-9]+','-',base.lower()).strip('-')
    return clean,slug

def install(root,packpath,reportpath):
    base=root/'data';book=base/'peri-tzadik';tocpath=book/'toc.json';toc=json.loads(tocpath.read_bytes())
    pack=json.loads(gzip.decompress(packpath.read_bytes()))
    if pack.get('work')!='Peri Tzadik' or [s['ref'] for s in pack['sections']]!=TARGETS:raise ValueError('Unexpected import scope')
    if content_sha(pack['sections'])!=CONTENT_SHA:raise ValueError('Supplied English content changed')
    leaves=walk(toc['toc']);selected={}
    for ref in TARGETS:
        found=[l for l in leaves if l.get('interlinear') and l.get('ref')==ref]
        if len(found)!=1:raise ValueError('Missing/duplicate target '+ref)
        selected[ref]=found[0]
    paths={book/(str(l['id'])+'.json') for l in selected.values()}
    # The write scope excludes every other book and every other Peri chapter.
    protected={p:sha(p.read_bytes()) for d in base.iterdir() if d.is_dir() and d.name!='cited'
               for p in d.rglob('*.json') if p not in paths and p not in (tocpath,book/'links.json')}
    original_toc=canonical(toc['toc']);staged={};counts=[];reanchored=0;bodypairs=0
    all_ids=set();all_numbers=set()
    for p in book.glob('*.json'):
        if p in paths or p.name in ('links.json','toc.json'):continue
        o=json.loads(p.read_bytes())
        if isinstance(o,list):
            for row in o:
                if isinstance(row,dict):
                    for n in row.get('footnotes',[]):all_ids.add(n.get('sourceId'));all_numbers.add(n.get('number'))
    for ix,s in enumerate(pack['sections']):
        ref=s['ref'];leaf=selected[ref];p=book/(str(leaf['id'])+'.json');rows=json.loads(p.read_bytes())
        body=canonical([{k:v for k,v in r.items() if k!='footnotes'} for r in rows]);by_n={r['n']:r for r in rows if 'p' in r}
        count=0;retained=0
        for ent in s['entries']:
            if ent['item'] not in by_n:raise ValueError('Missing paragraph '+ref)
            row=by_n[ent['item']];n,changed=anchor(ent['note'],row);reanchored+=changed
            notes=row.setdefault('footnotes',[]);sid=n['sourceId'];number=n['number']
            matches=[j for j,x in enumerate(notes) if x.get('sourceId')==sid]
            if matches:
                if len(matches)!=1:raise ValueError('Duplicate existing source ID '+sid)
                prior=notes[matches[0]]
                if prior.get('paragraphs')!=n['paragraphs'] or prior.get('sources')!=n['sources']:raise ValueError('Conflicting previously edited note '+sid)
                notes[matches[0]]=n;retained+=1
            else:
                if sid in all_ids or number in all_numbers or any(x.get('number')==number for x in notes):raise ValueError('Footnote numbering collision '+sid)
                notes.append(n)
            all_ids.add(sid);all_numbers.add(number);count+=1
        if count!=COUNTS[ix]:raise ValueError('Wrong chapter count '+ref)
        if body!=canonical([{k:v for k,v in r.items() if k!='footnotes'} for r in rows]):raise ValueError('Original text/headings changed '+ref)
        pairs=sum(len(r.get('p',[])) for r in rows);bodypairs+=pairs
        staged[p]=rows;counts.append({'ref':ref,'id':leaf['id'],'notes':count,'phrasePairs':pairs,'bodySHA256':sha(body),'retainedFromPreviousImport':retained})
    if bodypairs!=1268:raise ValueError('Original 1268 phrase pairs changed')
    links_path=book/'links.json';links=json.loads(links_path.read_bytes());cited_updates={};index_path=base/'cited/index.json';search_path=base/'cited/search.json'
    index=set(json.loads(index_path.read_bytes()));search=json.loads(search_path.read_bytes());searchset=set(search.get('search',[]))
    for s in pack['sections']:
        ref=s['ref'];linklist=links.setdefault(ref,[]);seen={(x.get('a'),x.get('r')) for x in linklist}
        for e in s['entries']:
            note=e['note'];anchor_ref=ref+':'+str(e['item'])
            for src in note['sources']:
                clean,slug=refslug(src['ref'])
                if not slug:raise ValueError('Invalid reverse-citation key')
                isparallel=src['role'].startswith('parallel-')
                if isparallel and (anchor_ref,clean) not in seen:
                    ri=1 if src['role']=='parallel-rav-tzadok' else 2
                    linklist.append({'a':anchor_ref,'r':clean,'c':'Parallel Sources',
                         'kind':'Supplied parallel · '+('Rav Tzadok' if ri==1 else 'Ishbitz–Radzin'),
                         'note':note['paragraphs'][ri]['rich'][-1]['text']})
                    seen.add((anchor_ref,clean))
                # Merge additions only; do not remove any existing reverse connections.
                cp=base/'cited'/f'{slug}.json'
                if cp not in cited_updates:cited_updates[cp]=json.loads(cp.read_bytes()) if cp.exists() else {}
                obj=cited_updates[cp];vals=obj.setdefault(clean,[])
                if not isinstance(vals,list):raise ValueError('Unexpected cited index format')
                if anchor_ref not in vals:vals.append(anchor_ref)
                index.add(slug)
                if isparallel:searchset.add(clean)
    summary={'release':RELEASE,'suppliedNotes':929,'vayeraNotes':409,'chayeiSaraNotes':520,'chapters':18,'phrasePairs':1268,
             'suppliedContentSHA256':CONTENT_SHA,'hebrewAnchorsAdjustedForCurrentPunctuation':reanchored,
             'existingTextAndHeadingsPreserved':True,'unrelatedBookFilesProtected':len(protected),'countsBySection':counts,
             'sourceVerification':'User-supplied translations and parallels; not a fresh scholarly source verification'}
    toc['vayeraChayeiSaraFootnotes']=summary
    if 'expandedFootnotes' in toc:
        meta=toc['expandedFootnotes'];meta['totalPublishedNotes']=len([x for x in all_numbers if isinstance(x,int)])
        meta['interlinearSections']=sum(1 for l in leaves if l.get('interlinear'));meta['suppliedNotes']=max(meta.get('suppliedNotes',0),2594)
    if canonical(toc['toc'])!=original_toc:raise ValueError('Contents order/title changed')
    for p,rows in staged.items():write(p,rows)
    write(tocpath,toc);write(links_path,links)
    for p,x in cited_updates.items():write(p,x)
    write(index_path,sorted(index));search['search']=sorted(searchset);write(search_path,search)
    manifest_path=base/'files.json';manifest=json.loads(manifest_path.read_bytes())
    manifest['files']=sorted(p.relative_to(base).as_posix() for p in base.rglob('*.json') if p!=manifest_path)
    manifest['bytes']=sum((base/f).stat().st_size for f in manifest['files']);write(manifest_path,manifest)
    # Only invalidate the data and shell caches; preserve all rendering/UI code.
    page=root/'index.html';code=page.read_text();old='20261016-pri-thematic-headings-v3';new=old+'-footnotes929'
    if new not in code:
        if old not in code:raise ValueError('Missing known reader data version')
        page.write_text(code.replace(old,new))
    sw=root/'sw.js'
    if sw.exists():
        code=sw.read_text()
        if RELEASE not in code:
            code,n=re.subn(r"(const VERSION = ')([^']+)(';)",lambda m:m[1]+m[2]+'-'+RELEASE+m[3],code,count=1)
            if n!=1:raise ValueError('Missing service worker version')
            sw.write_text(code)
    for p,h in protected.items():
        if sha(p.read_bytes())!=h:raise ValueError('Unrelated book was modified '+str(p))
    write(reportpath,summary)
    print('PASS: 929 supplied footnotes (409 Vayera / 520 Chayei Sara); all 1268 phrase pairs and descriptive headings unchanged; '+str(len(protected))+' unrelated book files unchanged.')

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--root',default='dist/library');a.add_argument('--pack',default='sources/akiva/pri-vayera-chayei-footnotes-929.json.gz');a.add_argument('--report',default='dist/library/pri-vayera-chayei-footnotes-report.json');args=a.parse_args()
    install(Path(args.root),Path(args.pack),Path(args.report))

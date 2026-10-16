#!/usr/bin/env python3
"""Merge only the four supplied Pri seasonal groups, after earlier publishers.
No translations, headings, other sections, or other books are replaced.
Existing note numbers are retained; new notes get unused book-wide numbers.
"""
import argparse, collections, copy, gzip, hashlib, html, json, re, unicodedata
from pathlib import Path
from urllib.parse import urlparse

RELEASE='20261016-pri-seasonal-1407-v1'
SOURCE_SHA='52e53d19420823db61c6772770e84cd8e1719596b736ee7affd3b0540d020eba'
GROUPS=[('Rosh Chodesh Kislev',7,136),('Chanukah',24,636),('Rosh Chodesh Shvat',6,337),('Tu BiShvat',5,298)]
TARGETS=[f'Peri Tzadik, {g} {i}' for g,n,_ in GROUPS for i in range(1,n+1)]

def canonical(o):return json.dumps(o,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def plain(s):return html.unescape(re.sub('<[^>]*>','',str(s or ''))).replace('\u00a0',' ')
def key(s):return ''.join(c for c in s if c.isalnum())
def read(p):return json.loads(p.read_bytes())
def write(p,o):
    p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(canonical(o)+b'\n')
def leaves(n):
    return ([n] if n.get('ref') else [])+[x for c in n.get('children',[]) for x in leaves(c)]
def body(rows):return [{k:v for k,v in r.items() if k!='footnotes'} for r in rows]
def primary(n):return next((s['ref'] for s in n.get('sources',[]) if s.get('role')=='primary-source'),'')
def signature(n):return (n['phraseIndex'],key(n['heAnchorPrefix']),primary(n))
def source_key(ref):
    clean=re.sub(r'\s*\(§\d+\)$','',ref).strip()
    base=re.sub(r'\s+\d+[ab]?(?:[:–\-]\d+[ab]?)*(?:[:–\-]\d+[ab]?)*$','',clean).strip()
    return clean,re.sub('[^a-z0-9]+','-',base.lower()).strip('-')

def import_notes(root,source):
    raw=gzip.decompress(source.read_bytes())
    assert sha(raw)==SOURCE_SHA,'Supplied source package checksum changed'
    sections=json.loads(raw)['sections'];assert [s['ref'] for s in sections]==TARGETS
    data=root/'data';book=data/'peri-tzadik';toc=read(book/'toc.json')
    all_leaves=leaves(toc['toc']);selected={}
    for ref in TARGETS:
        match=[l for l in all_leaves if l.get('interlinear') and l['ref']==ref]
        assert len(match)==1,'Missing or duplicate existing teaching: '+ref
        selected[ref]=match[0]
    paths={book/(str(l['id'])+'.json') for l in selected.values()}
    # Programmatic integrity snapshot, not content replacement of other books.
    protected={p:sha(p.read_bytes()) for p in data.glob('*/*.json')
        if p.parent.name not in ('cited','packs','parallels') and p not in paths and p!=book/'toc.json' and p!=book/'links.json'}
    original_toc=canonical(toc['toc']);original_catalog=(data/'catalog.json').read_bytes()
    links=read(book/'links.json');protected_links={r:v for r,v in links.items() if r not in selected}
    previous_numbers=[]
    for p in book.glob('*.json'):
        if p.name in ('toc.json','links.json'):continue
        rows=read(p)
        if isinstance(rows,list):previous_numbers += [n['number'] for r in rows if isinstance(r,dict) for n in r.get('footnotes',[])]
    assert len(previous_numbers)==len(set(previous_numbers)),'Existing book has duplicate note numbers'
    next_number=max(previous_numbers,default=0)+1
    staged={};counts=[];new_count=0;retained=0;adjusted=0;whitespace_only=0
    for s in sections:
        ref=s['ref'];leaf=selected[ref];path=book/(str(leaf['id'])+'.json');before=path.read_bytes();rows=json.loads(before)
        original_body=canonical(body(rows));by_n={r['n']:r for r in rows if 'p'in r}
        source_rows=[r for r in s['items'] if 'p'in r]
        assert set(by_n)=={r['n'] for r in source_rows},'Paragraph numbering changed: '+ref
        before_count=sum(len(r.get('footnotes',[])) for r in rows)
        count=0
        for sr in source_rows:
            row=by_n[sr['n']]
            assert [[plain(x) for x in p] for p in row['p']]==[[plain(x) for x in p] for p in sr['p']], 'Source text differs: '+ref
            existing=collections.defaultdict(list)
            for n in row.get('footnotes',[]):existing[signature(n)].append(n)
            fresh=[]
            for supplied in sr.get('footnotes',[]):
                n=copy.deepcopy(supplied);sig=signature(n);matches=existing[sig]
                if matches:
                    prior=matches.pop(0);num=prior['number'];retained+=1
                else:num=next_number;next_number+=1;new_count+=1
                n['number']=num;n['sourceId']=f'PT-{num:04d}';n['placementId']=n['sourceId']+'-1'
                n['provenance']={**n.get('provenance',{}),'sourceId':n['sourceId'],'printedNumber':num,
                    'section':ref,'sourceFile':str(leaf['id'])+'.json','item':row['n'],
                    'importRelease':RELEASE,'uploadedNumber':supplied['number'],
                    'importVerification':'Exact supplied content and Hebrew anchoring; no new scholarly source verification'}
                pi=n['phraseIndex'];assert isinstance(pi,int) and 0<=pi<len(row['p'])
                he=plain(row['p'][pi][0]);prefix=n['heAnchorPrefix']
                if he.startswith(prefix):off=len(prefix)
                else:
                    wanted=key(prefix);assert wanted and key(he).startswith(wanted),'Hebrew anchor mismatch '+str(num)
                    positions=[i for i,c in enumerate(he) if c.isalnum()];off=positions[len(wanted)-1]+1
                    while off<len(he) and (unicodedata.combining(he[off]) or (not he[off].isalnum() and not he[off].isspace())):off+=1
                adjusted+=off!=n.get('heCharOffset')
                n['heCharOffset']=off;n['heAnchorPrefix']=he[:off];n['heWord']=max(1,len(he[:off].split()))
                assert off>0 and off<=len(he)
                # Preserve both supplied paragraph fields, including their two harmless spacing differences.
                for p in n['paragraphs']:
                    rich=''.join(r.get('text','') for r in p.get('rich',[]))
                    if rich!=p['text']:
                        assert re.sub(r'\s+',' ',rich)==re.sub(r'\s+',' ',p['text']),'Inconsistent supplied paragraph '+str(num)
                        whitespace_only+=1
                    for run in p.get('rich',[]):
                        if run.get('href'):assert urlparse(run['href']).scheme=='https','Unsafe source link'
                assert n['paragraphs']==supplied['paragraphs'] and n['sources']==supplied['sources']
                fresh.append(n);count+=1
            assert not any(existing.values()),'An existing source note would be omitted: '+ref
            row['footnotes']=fresh
        assert canonical(body(rows))==original_body,'Text, source links or headings changed: '+ref
        staged[path]=rows
        counts.append({'ref':ref,'id':leaf['id'],'notes':count,'previousNotes':before_count,'addedNotes':count-before_count,
            'phrasePairs':sum(len(r.get('p',[])) for r in rows),'bodySHA256':sha(original_body),
            'beforeSHA256':sha(before),'sha256':sha(canonical(rows)+b'\n')})
    assert sum(c['notes'] for c in counts)==1407
    for g,n,total in GROUPS:
        cs=[c for c in counts if c['ref'].startswith('Peri Tzadik, '+g+' ')]
        assert len(cs)==n and sum(c['notes'] for c in cs)==total
    reverse={};index=set(read(data/'cited/index.json'));search=read(data/'cited/search.json');searchset=set(search.get('search',[]))
    primary_refs=set()
    for ref,leaf in selected.items():
        rows=staged[book/(str(leaf['id'])+'.json')];lst=links.setdefault(ref,[]);seen={(x.get('a'),x.get('r')) for x in lst}
        for row in rows:
            for note in row.get('footnotes',[]):
                anchor=ref+':'+str(row['n'])
                for src in note['sources']:
                    clean,slug=source_key(src['ref']);assert clean and slug
                    parallel=src.get('role','').startswith('parallel-')
                    if (anchor,clean) not in seen:
                        lst.append({'a':anchor,'r':clean,'c':'Parallel Sources' if parallel else 'Source Notes',
                            'kind':'Supplied parallel' if parallel else 'Supplied source translation',
                            'note':'Source supplied for '+ref+'.'})
                        seen.add((anchor,clean))
                    cp=data/'cited'/f'{slug}.json'
                    if cp not in reverse:reverse[cp]=read(cp) if cp.exists() else {}
                    vals=reverse[cp].setdefault(clean,[])
                    if anchor not in vals:vals.append(anchor)
                    index.add(slug)
                    if parallel:searchset.add(clean)
                    else:primary_refs.add(clean)
    assert {r:v for r,v in links.items() if r not in selected}==protected_links
    for p,rows in staged.items():write(p,rows)
    write(book/'links.json',links)
    for p,obj in reverse.items():write(p,obj)
    write(data/'cited/index.json',sorted(index));search['search']=sorted(searchset);write(data/'cited/search.json',search)
    sp=data/'packs/sources.json'
    if sp.exists():
        pack=read(sp);pack['refs']=sorted(set(pack.get('refs',[]))|primary_refs);write(sp,pack)
    report={'release':RELEASE,'sourceSHA256':SOURCE_SHA,'sections':42,'notes':1407,'newNotes':new_count,
        'existingNotesUpdated':retained,'groups':[{'name':g,'sections':n,'notes':total} for g,n,total in GROUPS],
        'chapters':counts,'existingTextHeadingsAndInlineLinksPreserved':True,'otherBookFilesPreserved':len(protected),
        'protectedFiles':{p.relative_to(data).as_posix():h for p,h in protected.items()},
        'anchorOffsetsAdjusted':adjusted,'suppliedWhitespaceDifferencesPreserved':whitespace_only,
        'verification':'Technical publication verification; supplied source translations and parallels retained as provided.'}
    toc['seasonalFootnotes']={k:v for k,v in report.items() if k not in ('protectedFiles','chapters')}
    if 'expandedFootnotes'in toc:
        m=toc['expandedFootnotes'];m['totalPublishedNotes']=len(previous_numbers)+new_count
        m['interlinearSections']=sum(bool(l.get('interlinear')) for l in all_leaves)
        m['suppliedNotes']=max(m.get('suppliedNotes',0),3240)
    assert canonical(toc['toc'])==original_toc;write(book/'toc.json',toc)
    page=root/'index.html';code=page.read_text();start='const editionDataUrl = url => '
    prefix="(url.startsWith('data/peri-tzadik/') || url.startsWith('data/cited/') || url === 'data/catalog.json' || url === 'data/files.json' || url === 'data/packs/sources.json') ? url + '?edition="+RELEASE+"' : "
    assert code.count(start)==1
    if prefix not in code:page.write_text(code.replace(start,start+prefix))
    sw=root/'sw.js';code=sw.read_text();suffix='-pri-seasonal-1407-v1'
    if suffix not in code:
        code,n=re.subn(r'(const SHELL = `)([^`]+)(`;)',lambda m:m[1]+m[2]+suffix+m[3],code,count=1)
        assert n==1;sw.write_text(code)
    manifest=data/'files.json';files=sorted(p.relative_to(data).as_posix() for p in data.rglob('*.json') if p!=manifest)
    h=hashlib.sha256();size=0
    for f in files:
        b=(data/f).read_bytes();h.update(f.encode()+b'\0'+b);size+=len(b)
    write(manifest,{'version':h.hexdigest()[:16],'bytes':size,'files':files})
    for p,digest in protected.items():assert sha(p.read_bytes())==digest,'Unrelated file changed: '+str(p)
    assert (data/'catalog.json').read_bytes()==original_catalog
    nums=[]
    for p in book.glob('*.json'):
        if p.name in ('toc.json','links.json'):continue
        rows=read(p)
        if isinstance(rows,list):nums += [n['number'] for r in rows if isinstance(r,dict) for n in r.get('footnotes',[])]
    assert len(nums)==len(set(nums)),'Duplicate published note numbers'
    report['totalBookNotes']=len(nums)
    write(root/'pri-seasonal-footnotes-report.json',report)
    print(f'PASS: 1407 supplied notes in 42 teachings; {new_count} new; {retained} updated; text, headings, inline links, all other chapters and books preserved.')

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--root',default='dist/library');a.add_argument('--source',default='sources/akiva/pri-seasonal-supplied-20261016.json.gz');args=a.parse_args()
    import_notes(Path(args.root),Path(args.source))

#!/usr/bin/env python3
"""Losslessly decode the supplied, content-addressed footnote transport.
This reconstructs supplied text; it does not write or research new translations.
"""
import argparse, gzip, hashlib, html, json, lzma, re, zipfile
from pathlib import Path

TARGETS = [f'Peri Tzadik, Vayera {i}' for i in range(1,8)] + [f'Peri Tzadik, Chayei Sara {i}' for i in range(1,12)]
COUNTS = [194,41,43,51,21,43,16,108,57,25,30,62,38,60,24,37,52,27]
ROLES = ['primary-source','parallel-rav-tzadok','parallel-ishbitz-radzin']
EDITION = 'Akiva Publishing expanded 2026-10-16 + Kisvei Rav Tzadok & Kisvei Beis Ishbitz-Radzin Parallels'

def sha(s): return hashlib.sha256(s if isinstance(s,bytes) else s.encode()).hexdigest()
def short(s): return sha(s)[:16]
def plain(s): return html.unescape(re.sub('<[^>]*>','',str(s or ''))).replace('\u00a0',' ')
def norm(s): return re.sub(r'\s+',' ',plain(s)).strip()
def canonical(x): return json.dumps(x,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()
def key(s): return ''.join(c for c in s if c.isalnum())

def collect_donors(data_root, incoming, needed):
    found = {}
    def add(s):
        if len(s)<32 or any('\u0590'<=c<='\u05ff' for c in s): return
        for t in (s,norm(s)):
            h=short(t)
            if h in needed:
                if h in found and found[h]!=t: raise ValueError('Hash collision')
                found[h]=t
    def visit(o):
        if isinstance(o,str): add(o)
        elif isinstance(o,dict):
            for v in o.values(): visit(v)
            if isinstance(o.get('p'),list):
                en=[norm(a[1]) for a in o['p'] if isinstance(a,list) and len(a)==2 and isinstance(a[1],str)]
                if en: add(' '.join(en))
        elif isinstance(o,list):
            for a in o: visit(a)
            en=[]
            for a in o:
                if isinstance(a,dict) and isinstance(a.get('p'),list):
                    en += [norm(p[1]) for p in a['p'] if isinstance(p,list) and len(p)==2 and isinstance(p[1],str)]
            if en: add(' '.join(en))
    for p in sorted(Path(data_root).glob('*/*.json')):
        if p.name in ('toc.json','links.json'): continue
        visit(json.loads(p.read_bytes()))
    for p in sorted(Path(incoming).glob('akiva-reader-13-part-*.zip')):
        with zipfile.ZipFile(p) as z:
            for n in z.namelist():
                if re.fullmatch(r'data/[^/]+/(?!toc.json|links.json)[^/]+\.json',n):
                    visit(json.loads(z.read(n)))
    missing=needed-set(found)
    if missing: raise ValueError(f'Missing {len(missing)} transport donors: {sorted(missing)[:12]}')
    return found

def paragraphs(ref,srcs,q0,q1,q2,cat,ctx):
    r0,r1,r2=[s[0] for s in srcs]; u0,u1,u2=[s[1] for s in srcs]
    rich=[
        [dict(text=r0,bold=True,href=u0),dict(text=q0),
         dict(text='Context and connection to Peri Tzadik: ',bold=True),
         dict(text=f'In {ref}, Rav Tzadok cites this {cat} ({r0}) to illuminate his exposition here (“{ctx}”), showing how the translated source sheds light on the holiness of the Patriarchs and Matriarchs, the covenant of circumcision, Shabbat, and the Oral Torah developed in Peri Tzadik.')],
        [dict(text='Kisvei Rav Tzadok Parallel — ',bold=True),dict(text=r1,bold=True,href=u1),dict(text=q1),
         dict(text='Connection to this note: ',bold=True),
         dict(text=f'In {r1}, Rav Tzadok develops this theme alongside {r0}, illuminating how the teaching in {ref} unfolds within Kisvei Rav Tzadok.')],
        [dict(text='Kisvei Beis Ishbitz–Radzin Parallel — ',bold=True),dict(text=r2,bold=True,href=u2),dict(text=q2),
         dict(text='Connection to this note: ',bold=True),
         dict(text=f"This Beis Ishbitz–Radzin teaching in {r2} clarifies the inner dimension of {r0} and directly illuminates Rav Tzadok's point in {ref}.")],
        [dict(text='Sources: ',bold=True),dict(text=r0,bold=True,href=u0),dict(text='.'),
         dict(text=' | Parallels: ',bold=True),dict(text=r1,bold=True,href=u1),dict(text='; '),dict(text=r2,bold=True,href=u2),dict(text='.')]
    ]
    return [dict(text=''.join(r['text'] for r in rr),rich=rr) for rr in rich]

def decode(payload, donors, current):
    if payload['format']!='APFN2' or [s[0] for s in payload['sections']]!=TARGETS: raise ValueError('Bad transport scope')
    def quote(i):
        out=[]
        for op in payload['quotes'][i]:
            if isinstance(op,str): out.append(op)
            else:
                di,start,length=op; s=donors[payload['donors'][di]]
                if not 0<=start<=len(s)-length: raise ValueError('Bad substring')
                out.append(s[start:start+length])
        return ''.join(out)
    quotes=[quote(i) for i in range(len(payload['quotes']))]
    sections=[]
    for ix,(ref,items) in enumerate(payload['sections']):
        rows=current[ref]; by_n={i['n']:i for i in rows if 'p' in i}
        entries=[]
        for item_n,ns in items:
            row=by_n[item_n]
            for rec in ns:
                num,pi,hoff,klen,khash,sp,q0,cat,ctx,q1,q2=rec[:11]
                if isinstance(ctx,list):
                    start,size,chash,ell=ctx if len(ctx)==4 else [0,*ctx]; en=' '.join(norm(p[1]) for p in row['p'][pi:]);core=en[start:start+size]
                    if short(core)!=chash: raise ValueError('English context changed '+str(num))
                    ctx=core+('...' if ell else '')
                sources=[payload['sources'][j] for j in sp]
                pp=paragraphs(ref,sources,quotes[q0],quotes[q1],quotes[q2],payload['categories'][cat],ctx)
                note={'number':num,'sourceId':f'PT-{num:04d}','placementId':f'PT-{num:04d}-1','phraseIndex':pi,
                    'paragraphs':pp,'sources':[dict(ref=s[0],url=s[1],connectionsUrl=s[2],role=role) for s,role in zip(sources,ROLES)],
                    'nativeConnections':[],'verificationStatus':'verified',
                    'provenance':dict(edition=EDITION,sourceId=f'PT-{num:04d}',section=ref,sourceFile=f'{159+ix}.json',item=item_n,printedNumber=num),
                    'importAnchor':dict(suppliedOffset=hoff,keyLength=klen,keyHash=khash)}
                if len(rec)>11:
                    note['heWord'],note['enCharOffset']=rec[11:13]
                entries.append({'item':item_n,'note':note})
        if len(entries)!=COUNTS[ix]: raise ValueError('Bad note count '+ref)
        sections.append({'ref':ref,'suppliedFile':f'{159+ix}.json','entries':entries})
    nums=[e['note']['number'] for s in sections for e in s['entries']]
    if nums!=list(range(1666,2595)): raise ValueError('Bad numbering')
    return {'schemaVersion':1,'work':'Peri Tzadik','release':'20261016-pri-vayera-chayei-footnotes-929',
        'suppliedFile':'Peri_Tzadik (2).json','sections':sections,
        'verification':{'footnotes':929,'vayera':409,'chayeiSara':520,'translationContent':'Supplied by user; imported without new source research','transport':'Lossless checked source text'}}

def content_fingerprint(output):
    rows=[[s['ref'],e['item'],e['note']['number'],e['note']['paragraphs'],e['note']['sources']]
          for s in output['sections'] for e in s['entries']]
    return sha(canonical(rows))

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--transport',required=True);a.add_argument('--expected-content',required=True)
    a.add_argument('--data-root',default='dist/library/data');a.add_argument('--incoming',default='incoming')
    a.add_argument('--donors');a.add_argument('--original');a.add_argument('--output',required=True)
    args=a.parse_args();payload=json.loads(lzma.decompress(Path(args.transport).read_bytes()))
    if args.original:
        original=json.loads(Path(args.original).read_bytes());current={s['ref']:s['items'] for s in original['sections']}
    else:
        toc=json.loads((Path(args.data_root)/'peri-tzadik/toc.json').read_bytes());leaves=[]
        def walk(n):
            if n.get('ref'):leaves.append(n)
            for c in n.get('children',[]):walk(c)
        walk(toc['toc']);current={}
        for ref in TARGETS:
            ls=[n for n in leaves if n.get('interlinear') and n['ref']==ref]
            if len(ls)!=1:raise ValueError('Missing or duplicate chapter '+ref)
            current[ref]=json.loads((Path(args.data_root)/'peri-tzadik'/f"{ls[0]['id']}.json").read_bytes())
    donors=json.loads(Path(args.donors).read_bytes()) if args.donors else collect_donors(args.data_root,args.incoming,set(payload['donors']))
    out=decode(payload,donors,current);fingerprint=content_fingerprint(out)
    if fingerprint!=args.expected_content: raise ValueError('Supplied footnote content checksum mismatch '+fingerprint)
    out['verification']['suppliedContentSHA256']=fingerprint
    p=Path(args.output);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_bytes(gzip.compress(canonical(out),compresslevel=9,mtime=0))
    print('PASS: exactly 929 supplied English notes reconstructed without text substitutions; SHA256 '+fingerprint)

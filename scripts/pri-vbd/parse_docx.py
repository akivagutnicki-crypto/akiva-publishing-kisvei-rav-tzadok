"""Pri Tzaddik Vayikra / Bamidbar / Devarim Word editions -> reader study-edition chapters (vocalized Hebrew phrases with
their notes and headings)."""
import json,re,zipfile,html,sys
from lxml import etree
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'; R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
NIK=re.compile(r'[֑-ׇ]')
def bare(s): return re.sub(r'[^א-ת ]','',NIK.sub('',s)).strip()
HEB={'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,'י':10,'כ':20,'ל':30,'מ':40,'נ':50,'ס':60,'ע':70,'פ':80,'צ':90,'ק':100}
def gem(s): return sum(HEB.get(c,0) for c in re.sub(r'[^א-ת]','',s))
def load(path):
    z=zipfile.ZipFile(path); doc=etree.fromstring(z.read('word/document.xml')); fn=etree.fromstring(z.read('word/footnotes.xml'))
    rels={}
    for n in ('word/_rels/footnotes.xml.rels',):
        if n in z.namelist():
            for r in etree.fromstring(z.read(n)): rels[r.get('Id')]=r.get('Target')
    notes={}
    for f in fn.findall(W+'footnote'):
        fid=f.get(W+'id'); paras=[]
        for p in f.findall(W+'p'):
            rich=[]; txt=''
            for el in p:
                if el.tag==W+'r':
                    if el.find(W+'footnoteRef') is not None: continue
                    t=''.join(x.text or '' for x in el.iter(W+'t'))
                    if t: rich.append({'text':t}); txt+=t
                elif el.tag==W+'hyperlink':
                    t=''.join(x.text or '' for x in el.iter(W+'t')); href=rels.get(el.get(R+'id'))
                    if t: rich.append({'text':t,**({'href':href} if href else {})}); txt+=t
            txt=txt.strip()
            if txt:
                if rich and rich[0]['text'].startswith(' '): rich[0]['text']=rich[0]['text'].lstrip()
                paras.append({'text':txt,'rich':rich})
        if paras: notes[fid]=paras
    return doc,notes
def style(p):
    s=p.find(W+'pPr/'+W+'pStyle'); return s.get(W+'val') if s is not None else ''
def parse(path):
    doc,notes=load(path); body=doc.find(W+'body'); secs=[]; cur=None; pending=[]
    for p in body.iter(W+'p'):
        st=style(p); text=''.join(x.text or '' for x in p.iter(W+'t')).strip()
        if st=='Heading1':
            heb=re.split(r'[A-Za-z]',text,maxsplit=1)[0]
            m=re.match(r'(.*?),\s*([א-ת"׳״\']+)\s*$',NIK.sub('',heb).strip())
            if not m: cur=None; continue
            cur={'parsha_he':bare(m.group(1)).replace('פרשת ','').strip(),'ois':gem(m.group(2)),'heading_he':heb.strip(),'heading_en':text[len(heb):].strip(),'title':None,'items':[]}; secs.append(cur); pending=[]; continue
        if cur is None: continue
        if st=='Heading2': cur['title']=text; continue
        if st=='Heading3': pending.append(text); continue
        if not text and not p.findall('.//'+W+'footnoteReference'): continue
        pairs=[]; fn_at=[]
        for r in p.iter(W+'r'):
            t=re.sub(r'[\u200e\u200f\u202a-\u202e]','',''.join(x.text or '' for x in r.findall(W+'t')))
            ref=r.find(W+'footnoteReference')
            core=t.strip().strip('—–-').strip()
            if core:
                lat=bool(re.search('[A-Za-z]',core)); heb=bool(re.search('[א-ת]',core))
                if heb and not lat:
                    if not pairs or pairs[-1][1]: pairs.append([core,''])
                    else: pairs[-1][0]+=' '+core
                elif pairs: pairs[-1][1]=(pairs[-1][1]+' '+core).strip()
                else: pairs.append(['',core])
            if ref is not None:
                fid=ref.get(W+'id')
                if fid in notes: fn_at.append((max(0,len(pairs)-1),fid))
        if not pairs: continue
        # a running title at a parsha's end (PRI TZADDIK, פרשת צו, Parshas Tzav, Sefer Vayikra): not text
        if len(pairs)==1 and len(pairs[0][0]+pairs[0][1])<40 and not fn_at: continue
        item={'pairs':pairs,'notes':fn_at}
        if pending: item['headings']=pending; pending=[]
        cur['items'].append(item)
    return secs,notes
if __name__=='__main__':
    for f in sys.argv[1:]:
        secs,notes=parse(f)
        print(f.split('/')[-1][:30],'sections',len(secs),'notes',sum(len(i['notes']) for s in secs for i in s['items']))
        import collections; c=collections.Counter(s['parsha_he'] for s in secs); print('  ',dict(c))

import os
LIB=os.environ.get('PRI_LIBRARY','dist/library/data/peri-tzadik')
def norm_name(s): return re.sub('[וי ]','',bare(s))
_LEAVES=None
def leaves():
    global _LEAVES
    if _LEAVES is None:
        t=json.load(open(LIB+'/toc.json')); out={}
        def walk(n):
            if n.get('children'):
                for c in n['children']: walk(c)
            elif n.get('depth')==2: out[norm_name(n.get('he',''))]=n
        walk(t['toc']); _LEAVES=out
    return _LEAVES
def lib_paras(leaf,ois):
    p=f"{LIB}/{leaf['id']}-{ois}.json"
    import os
    if not os.path.exists(p): return None
    return [re.sub(r'<[^>]+>','',x) for x in json.load(open(p)) if isinstance(x,str)]
def words(s): return [w for w in re.sub(r'[^א-ת"\' ]',' ',NIK.sub('',s)).split()]
def align(sec):
    """Merge the Word edition's paragraphs of one os into the library's paragraphs (by each library paragraph's opening)."""
    leaf=leaves().get(norm_name(sec['parsha_he']))
    if not leaf: return None,'no leaf'
    lib=lib_paras(leaf,sec['ois'])
    if lib is None: return None,'no os file'
    items=list(sec['items'])
    MARK={'אחרהבדלה':('אַחַר הַבְדָּלָה','After Havdalah'),'מכתיק':('מִכְּתַב יַד קָדְשׁוֹ','From his holy manuscript')}
    # a library paragraph that is only a marker (אחר הבדלה, מכתי"ק): the Word edition's own line, or the marker itself
    for k in range(1,len(lib)):
        key=re.sub(r'[^א-ת]','',NIK.sub('',lib[k]))
        if key in MARK:
            pos=None
            for j,it in enumerate(items):
                b=re.sub(r'[^א-ת]','',NIK.sub('',' '.join(h for h,_ in it['pairs'])))
                if len(b)<=14 and (b==key or b.startswith('מכתב')): pos=j; break
            if pos is None:
                # before the Word paragraph that starts the library's next paragraph (or at the end)
                nxt=[re.sub(r'[^א-ת]','',w) for w in words(lib[k+1])[:8] if '"' not in w and len(w)>=2][:5] if k+1<len(lib) else []
                pos=next((j for j in range(1,len(items)) if nxt and sum(1 for w in nxt if w in [re.sub(r'[^א-ת]','',x) for x in words(' '.join(h for h,_ in items[j]['pairs']))[:12]])>=3),len(items))
                items.insert(pos,{'pairs':[list(MARK[key])],'notes':[],'marker':True})
    dw=[[re.sub(r'[^א-ת]','',w) for w in words(' '.join(h for h,_ in it['pairs']))[:25]] for it in items]
    starts=[0]; j0=1
    for k in range(1,len(lib)):
        lw=[re.sub(r'[^א-ת]','',w) for w in words(lib[k])[:10] if '"' not in w and "'" not in w]
        lw=[w for w in lw if len(w)>=2][:6]
        key=re.sub(r'[^א-ת]','',NIK.sub('',lib[k]))
        best=(-1,None)
        for j in range(j0,len(items)-(len(lib)-1-k)):
            head=dw[j][:12]
            if key in MARK: sc=10 if items[j].get('marker') or ''.join(dw[j])==key or ''.join(dw[j]).startswith('מכתב') else 0
            else: sc=sum(1 for w in lw if w in head)+ (2 if lw and head and head[0]==lw[0] else 0)
            if sc>best[0]: best=(sc,j)
        if best[1] is None or best[0]<2:
            # the library's paragraph begins inside a Word paragraph: split it at that phrase
            hit=None
            for j in range(max(0,j0-1),len(items)):
                hs=[re.sub(r'[^א-ת]','',NIK.sub('',h)) for h,_ in items[j]['pairs']]
                for pi in range(1,len(hs)):
                    ahead=[re.sub(r'[^א-ת]','',w) for w in words(' '.join(h for h,_ in items[j]['pairs'][pi:pi+8]))[:14]]
                    if sum(1 for w in lw if w in ahead)>=min(4,len(lw)) and ahead and lw and ahead[0]==lw[0]: hit=(j,pi); break
                if hit: break
            if not hit: return None,f'para {k+1} not found'
            j,pi=hit; it=items[j]
            a={'pairs':it['pairs'][:pi],'notes':[(x,f) for x,f in it['notes'] if x<pi]}
            if it.get('headings'): a['headings']=it['headings']
            b={'pairs':it['pairs'][pi:],'notes':[(x-pi,f) for x,f in it['notes'] if x>=pi]}
            if it.get('inline'): pass
            items[j:j+1]=[a,b]; dw[j:j+1]=[[re.sub(r'[^א-ת]','',w) for w in words(' '.join(h for h,_ in x['pairs']))[:25]] for x in (a,b)]
            best=(9,j+1)
        starts.append(best[1]); j0=best[1]+1
    groups=[items[s:e] for s,e in zip(starts,starts[1:]+[len(items)])]
    return (leaf,groups),None

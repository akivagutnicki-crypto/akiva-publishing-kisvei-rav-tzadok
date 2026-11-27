# Move the Word files' note markers the way the reader moves them (word_replace.mover): to the phrase naming/quoting the source
import re,zipfile,os,collections,json
from common import *
from conv4 import strip_dash, HEB, LAT
def tokens(p):
    for r in p.iter(W+'r'):
        fr=r.find(W+'footnoteReference')
        if fr is not None: yield ('fn',fr.get(W+'id'),r); continue
        t=''.join(x.text or '' for x in r.iter(W+'t'))
        if r.find(W+'tab') is not None: t+=' '
        if not t: continue
        h,l=HEB.search(t),LAT.search(t)
        if h and l:
            for piece in re.split(r'(\s+)',t):
                if not piece: continue
                yield ('he' if HEB.search(piece) else 'en' if LAT.search(piece) else 'neutral',piece,r)
        else: yield ('he' if h else 'en' if l else 'neutral',t,r)
def pairs_runs(p):
    pairs=[]; fns=[]; cur=None; side=None
    for kind,t,r in tokens(p):
        if kind=='fn':
            if cur is None: cur=['','',None]; side='he'
            fns.append((t,len(pairs),r)); continue
        if kind=='neutral' and re.search(r'\d',t) and cur is not None and side=='he' and strip_dash(cur[0]): kind='en'
        if kind=='neutral':
            if cur is None: continue
            if side=='en': cur[1]+=t
            else: cur[0]+=t
            continue
        if kind=='he':
            if cur is not None and side=='en' and strip_dash(cur[1]): pairs.append(cur); cur=None
            if cur is None: cur=['','',None]
            cur[0]+=t; cur[2]=r; side='he'
        else:
            if cur is None: cur=['','',None]
            cur[1]+=t; side='en'
    if cur is not None: pairs.append(cur)
    out=[]; remap={}
    for i,(h,e,r) in enumerate(pairs):
        h=strip_dash(h); e=strip_dash(e)
        if not h and not e: continue
        remap[i]=len(out); out.append((h,e,r))
    f2=[(fid,max(remap.get(pi,remap.get(pi-1,len(out)-1)),0),r) for fid,pi,r in fns]
    return out,f2
st=collections.Counter()
for x in MAN['files']:
    path=WE+x['file']; z=zipfile.ZipFile(path); doc=etree.fromstring(z.read('word/document.xml')); FN=footnotes(z)
    Ps=[]
    for p in doc.find(W+'body'):
        if p.tag!=W+'p': continue
        pr,fns=pairs_runs(p)
        if pr and any(re.search('[א-ת]',h) for h,e,r in pr) and fns: Ps.append((p,pr,fns))
    allb=[[(h,e) for h,e,r in pr] for p,pr,fns in Ps]
    dfb=collections.Counter(b for prs in allb for b in set().union(*[WR.bigrams(h) for h,e in prs]))
    common=frozenset(b for b,c in dfb.items() if c>max(3,len(allb)*0.03))
    for p,pr,fns in Ps:
        pairs=[(h,e) for h,e,r in pr]
        notes=[]; meta=[]
        for fid,pi,r in fns:
            if not FN.get(fid): continue
            n={'paragraphs':FN[fid],'phraseIndex':min(pi,len(pairs)-1),'heCharOffset':0}
            notes.append(n); meta.append((fid,r,n['phraseIndex']))
        WR.mover(pairs,notes,common)
        for n,(fid,r,old) in zip(notes,meta):
            new=n['phraseIndex']
            if new==old: continue
            tr=pr[new][2]
            if tr is None: continue
            r.getparent().remove(r); tr.addnext(r); st['moved']+=1
    tmp=path+'.tmp'
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as zo:
        for it in zi.infolist():
            data=zi.read(it.filename)
            if it.filename=='word/document.xml': data=etree.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
            zo.writestr(it,data)
    os.replace(tmp,path); print(x['file'],st['moved'])
print(dict(st))

import json,re,collections,html
from common import *
import lib, apply
from quotes import keyw, amud
def excerpt(he, ctx, span=28):
    w=he.split()
    if len(w)<=span+6: return he
    best=max(range(0,len(w)-span+1),key=lambda i:len(keyw(' '.join(w[i:i+span]))&ctx))
    return ('… ' if best else '')+' '.join(w[best:best+span])+(' …' if best+span<len(w) else '')
def short_en(en,n=420):
    en=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>','',en))).strip()
    return en if len(en)<=n else en[:n].rsplit(' ',1)[0]+' …'
def main():
    fixes=json.load(open('quote_fixes.json')); by=collections.defaultdict(dict)
    for f in fixes:
        segs,ens=amud(f['title'],f['daf'][:-1],f['daf'][-1]); i=f['seg']-1
        ctx=keyw(f['ctx'])
        by[f['file']][f['fid']]={'kind':'quote','he':excerpt(segs[i],ctx),'en':short_en(ens[i]) if i<len(ens) else '','url':f"https://www.sefaria.org/{f['title'].replace(' ','_')}.{f['daf']}.{f['seg']}"}
    tot=0
    for file,e in by.items():
        d=apply.apply(WE+file,e); tot+=len(d); print(file,len(d),'of',len(e))
    print('quotes fixed',tot)
if __name__=='__main__': main()

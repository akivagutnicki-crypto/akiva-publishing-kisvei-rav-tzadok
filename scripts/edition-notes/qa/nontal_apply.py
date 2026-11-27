import json,re,sys,os
from common import *
import apply
from fix_quotes import short_en
from quotes import amud
d=json.load(open(sys.argv[1]))
for f,e in d.items():
    if os.path.exists(WE+f): print(f,len(apply.apply(WE+f,e)))
if len(sys.argv)>2:
    for k,x in json.load(open(sys.argv[2])).items():
        m=re.match(r'Source: (\w+) (\d+)([ab])',x['note'])
        title={'Tamid':'Tamid','Kerisos':'Keritot'}[m.group(1)]; segs,ens=amud(title,m.group(2),m.group(3))
        i=next(i for i,s in enumerate(segs) if x['kw'] in A.bare(s))
        he=' '.join(segs[i].split()[:34])+(' …' if len(segs[i].split())>34 else '')
        apply.apply(WE+x['file'],{x['fid']:{'kind':'quote','he':he,'en':short_en(ens[i]),'url':f'https://www.sefaria.org/{title}.{m.group(2)}{m.group(3)}.{i+1}'}})

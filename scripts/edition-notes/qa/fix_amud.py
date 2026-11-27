import json,re,collections
from common import *
import apply
from quotes import keyw, amud
from fix_quotes import excerpt, short_en
by=collections.defaultdict(dict)
for f in json.load(open('amud_fixes.json')):
    segs,ens=amud(f['title'],f['daf'][:-1],f['daf'][-1]); i=f['seg']-1
    by[f['file']][f['fid']]={'kind':'quote','he':excerpt(segs[i],keyw(f['ctx'])),'en':short_en(ens[i]) if i<len(ens) else '',
        'url':f"https://www.sefaria.org/{f['title'].replace(' ','_')}.{f['daf']}.{f['seg']}"}
for file,e in by.items():
    d=apply.apply(WE+file,e); print(file,len(d))
# the daf in the label, and the print page of the other amud (not known here: left out)
by2=collections.defaultdict(dict)
for f in json.load(open('amud_fixes.json')):
    by2[f['file']][f['fid']]={'kind':'text','pairs':[(f"{f['label']} {f['from']}",f"{f['label']} {f['daf']}")],'dropPage':True}
import zipfile
for file,e in by2.items():
    for fid in e: e[fid]['pairs'].append(('__PAGE__',''))
    d=apply.apply(WE+file,e)

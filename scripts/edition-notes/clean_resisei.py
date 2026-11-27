#!/usr/bin/env python3
"""Resisei Layla notes, per the editor's instructions (2026-11-26):
the cited source stays (shortened when very long); at most two quotations from
Rav Tzadok's other sefarim, only those that bear on the passage; Maharal only where it
bears on the passage; Rashi, Tosafos and Maharsha stay; at most one other commentator,
only where it bears on the passage. Notes are renumbered in reading order.
Usage: clean_resisei.py DIR_WITH_RESISEI_FILES_OR_SOURCE_JSON [--source]"""
import json,re,sys,os,html,collections
STOP=set('the and of to in a is that he his it as for with this be by from was not are they which their on at who an one or but all so have him them its said says say shall will what when there these those has had were been we our you your if then also only into than more upon even because like whose whom about'.split())
def ew(s): return {w for w in re.findall(r"[a-z]{4,}",html.unescape(re.sub(r'<[^>]+>',' ',s)).lower()) if w not in STOP}
LAB=re.compile(r'<i>\s*([^<:]{2,80}):\s*</i>')
ALWAYS=re.compile(r'^(Rashi|Tosafos|Tosafot|Maharsha)\b')
def trimq(t,n):
    w=t.split(); return t if len(w)<=n else ' '.join(w[:n])+' …'
stats=collections.Counter()
def clean_body(body,pe):
    parts=LAB.split(body); main=parts[0]; segs=[(parts[i].strip(),parts[i+1]) for i in range(1,len(parts)-1,2)]
    sc=lambda x: len(ew(x[1])&pe)
    rt=[x for x in segs if x[0].startswith('Rav Tzadok')]; mh=[x for x in segs if x[0].startswith('Maharal')]
    al=[x for x in segs if ALWAYS.match(x[0])]; ot=[x for x in segs if x not in rt and x not in mh and x not in al]
    keep=[x for x in sorted(rt,key=sc,reverse=True)[:2] if sc(x)>=3]+[x for x in sorted(mh,key=sc,reverse=True)[:1] if sc(x)>=4]+al+[x for x in sorted(ot,key=sc,reverse=True)[:1] if sc(x)>=3]
    stats['dropped quotations']+=len(segs)-len(keep)
    out=' '+trimq(main.strip(),110)
    for x in segs:
        if any(x is y for y in keep): out+=f'<i>  {x[0]}: </i>'+trimq(x[1].strip(),70)
    return out
def process_phrase(he,pe):
    out=[];pos=0
    for m in re.finditer(r'<sup class="footnote-marker">(\d+)</sup><i class="footnote">',he):
        if m.start()<pos: continue
        depth=1;j=len(he)
        for t in re.finditer(r'<i[ >]|</i>',he[m.end():]):
            depth+=1 if t.group(0)!='</i>' else -1
            if depth==0: j=m.end()+t.start(); break
        out.append(he[pos:m.start()]); out.append(f'<sup class="footnote-marker">{m.group(1)}</sup><i class="footnote">'+clean_body(he[m.end():j],pe)+'</i>'); pos=j+4
        stats['notes']+=1
    out.append(he[pos:]); return ''.join(out)
def clean_items(items):
    for it in items:
        if not isinstance(it,dict) or not it.get('p'): continue
        pe=ew(' '.join(p[1] for p in it['p'] if isinstance(p,list) and len(p)>1))
        for p in it['p']:
            if isinstance(p,list) and 'footnote-marker' in p[0]: p[0]=process_phrase(p[0],pe)
def renumber(item_lists):
    n=0
    def r(m):
        nonlocal n; n+=1; return f'<sup class="footnote-marker">{n}</sup>'
    for items in item_lists:
        for it in items:
            if isinstance(it,dict):
                for p in it.get('p') or []:
                    if isinstance(p,list): p[0]=re.sub(r'<sup class="footnote-marker">\d+</sup>',r,p[0])
    return n
if __name__=='__main__':
    target=sys.argv[1]
    if '--source' in sys.argv:
        d=json.load(open(target)); L=[s['items'] for s in d['sections']]
        for items in L: clean_items(items)
        n=renumber(L); json.dump(d,open(target,'w'),ensure_ascii=False,indent=1)
    else:
        sys.path.insert(0,os.path.dirname(__file__)); from apply_notes import files_in_order
        F=files_in_order(target); data={f:json.load(open(os.path.join(target,f))) for f in F}
        for f in F: clean_items(data[f])
        n=renumber([data[f] for f in F])
        for f in F: json.dump(data[f],open(os.path.join(target,f),'w'),ensure_ascii=False,separators=(',',':'))
    print(json.dumps({**stats,'notes_after':n}))

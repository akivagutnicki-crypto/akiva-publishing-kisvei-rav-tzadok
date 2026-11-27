# Run locally (needs the converter in /home/claude/rdr4 and /home/claude/fin/reader); writes sources/akiva/word-editions/parsed/.
# The 14 books' Word editions -> ordered paragraph packs (headings, interlinear pairs, notes) for word_replace.py
import sys,zipfile,re,json,gzip,collections,html
sys.path.insert(0,'/home/claude/rdr4'); sys.path.insert(0,'/home/claude/fin/reader')
from conv4 import W, para_info, pairs_of, split_heading
from conv import footnotes
from lxml import etree
REPO='/home/claude/akiva-publishing-kisvei-rav-tzadok'
M=json.load(open(REPO+'/sources/akiva/word-editions/manifest.json'))
META=re.compile(r'^(Editions and readings|Editions and Textual Readings|Text and reference notes)',re.I)
out=collections.defaultdict(list); st=collections.Counter()
for x in M['files']:
    z=zipfile.ZipFile(REPO+'/sources/akiva/word-editions/'+x['file']); d=etree.fromstring(z.read('word/document.xml')); FN=footnotes(z)
    depth=0; intoc=False; stop=False
    for p in d.find(W+'body'):
        if p.tag!=W+'p': continue
        instr=' '.join(t.text or '' for t in p.iter(W+'instrText'))
        begins=sum(1 for c in p.iter(W+'fldChar') if c.get(W+'fldCharType')=='begin'); ends=sum(1 for c in p.iter(W+'fldChar') if c.get(W+'fldCharType')=='end')
        if re.search(r'\bTOC\b',instr) and not intoc: intoc=True; depth=0
        if intoc:
            depth+=begins-ends
            if depth<=0 and ends: intoc=False
            continue
        P=para_info(p)
        if not P['text'] or stop: continue
        if P['style'].startswith('TOC') or P['style']=='Title': continue
        if META.match(P['text']) and P['style'].startswith('Heading'): stop=True; continue
        if P['style'].startswith('Heading'):
            he,en=split_heading(P['text']); out[x['slug']].append({'t':'h','he':he,'en':en,'lvl':P['style'][-1],'src':x['file']}); st['h']+=1; continue
        pr,fns=pairs_of(p)
        if not pr or not any(re.search('[א-ת]',h) for h,e in pr):
            out[x['slug']].append({'t':'e','text':P['text'],'notes':[FN.get(f) for f,_,_ in fns if FN.get(f)],'src':x['file']}); st['e']+=1; continue
        notes=[]
        for f,pi,eo in fns:
            if not FN.get(f): st['emptyNote']+=1; continue
            notes.append({'pi':pi,'eo':eo,'paragraphs':FN[f]})
        out[x['slug']].append({'t':'b','pairs':pr,'notes':notes,'src':x['file']}); st['b']+=1; st['notes']+=len(notes)
import os; os.makedirs(REPO+'/sources/akiva/word-editions/parsed',exist_ok=True)
for slug,L in out.items():
    open(REPO+f'/sources/akiva/word-editions/parsed/{slug}.json.gz','wb').write(gzip.compress(json.dumps(L,ensure_ascii=False,separators=(',',':')).encode(),9))
    print(slug,len(L),collections.Counter(i['t'] for i in L),sum(len(i.get('notes',[])) for i in L))
print(dict(st))

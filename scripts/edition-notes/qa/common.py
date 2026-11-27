import sys,zipfile,re,json,collections
sys.path.insert(0,'/home/claude/rdr4'); sys.path.insert(0,'/home/claude/fin/reader'); sys.path.insert(0,'/home/claude/oh')
sys.path.insert(0,'/home/claude/akiva-publishing-kisvei-rav-tzadok/scripts/edition-notes')
from conv4 import W, para_info, pairs_of
from conv import footnotes
from lxml import etree
import apply_notes as A, word_replace as WR
REPO='/home/claude/akiva-publishing-kisvei-rav-tzadok'; WE=REPO+'/sources/akiva/word-editions/'
import os as _os
if _os.environ.get('QA_DIR'):
    WE=_os.environ['QA_DIR'].rstrip('/')+'/'; MAN={'files':[{'file':f,'slug':f} for f in sorted(_os.listdir(WE)) if f.endswith('.docx')]}
else: MAN=json.load(open(WE+'manifest.json'))
def paras(path):
    """[(pairs, [(fid, pi)])] for body paragraphs, plus footnote texts {fid: paragraphs}"""
    z=zipfile.ZipFile(path); d=etree.fromstring(z.read('word/document.xml')); FN=footnotes(z)
    out=[]; intoc=False; depth=0
    for p in d.find(W+'body'):
        if p.tag!=W+'p': continue
        instr=' '.join(t.text or '' for t in p.iter(W+'instrText'))
        b=sum(1 for c in p.iter(W+'fldChar') if c.get(W+'fldCharType')=='begin'); e=sum(1 for c in p.iter(W+'fldChar') if c.get(W+'fldCharType')=='end')
        if re.search(r'\bTOC\b',instr) and not intoc: intoc=True; depth=0
        if intoc:
            depth+=b-e
            if depth<=0 and e: intoc=False
            continue
        P=para_info(p)
        if not P['text'] or P['style'].startswith(('Heading','TOC','Title')): continue
        pr,fns=pairs_of(p)
        if not pr or not any(re.search('[א-ת]',h) for h,e in pr): continue
        out.append((pr,[(f,min(pi,len(pr)-1)) for f,pi,_ in fns if FN.get(f)]))
    return out,FN
def ntext(paras_): return ' '.join(p.get('text','') for p in paras_)

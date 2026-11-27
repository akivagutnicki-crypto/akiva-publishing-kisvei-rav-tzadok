# Run locally after word_parse.py (needs /home/claude/rdr4 and /home/claude/fin/reader); edits sources/akiva/word-editions/*.docx
# Remove the unrelated Talmud notes (word_replace.unrelated) from the Word editions themselves
import sys,zipfile,re,json,collections,shutil,os
sys.path.insert(0,'/home/claude/rdr4'); sys.path.insert(0,'/home/claude/fin/reader'); sys.path.insert(0,'/home/claude/akiva-publishing-kisvei-rav-tzadok/scripts/edition-notes')
from conv4 import W, para_info, pairs_of
from conv import footnotes
from lxml import etree
import word_replace as R
REPO='/home/claude/akiva-publishing-kisvei-rav-tzadok'; OUT='/home/claude/gen/out_final'
M=json.load(open(REPO+'/sources/akiva/word-editions/manifest.json'))
SRCNAME={x['file']:None for x in M['files']}
tot=collections.Counter()
for x in M['files']:
    path=REPO+'/sources/akiva/word-editions/'+x['file']
    z=zipfile.ZipFile(path); d=etree.fromstring(z.read('word/document.xml')); FN=footnotes(z)
    L=[]; refs=[]   # parallel to L: list of footnote ids per note
    intoc=False; depth=0
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
        ids=[f for f,_,_ in fns if FN.get(f)]
        L.append({'t':'b','pairs':pr,'notes':[{'paragraphs':FN[f]} for f in ids]}); refs.append(ids)
    drop={refs[k][j] for k,j in R.unrelated(L)}
    if not drop: continue
    tmp=path+'.tmp'
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as zo:
        for it in zi.infolist():
            data=zi.read(it.filename)
            if it.filename=='word/document.xml':
                root=etree.fromstring(data); n=0
                for r in list(root.iter(W+'r')):
                    fr=r.find(W+'footnoteReference')
                    if fr is not None and fr.get(W+'id') in drop: r.getparent().remove(r); n+=1
                data=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
            elif it.filename=='word/footnotes.xml':
                root=etree.fromstring(data)
                for f in list(root.findall(W+'footnote')):
                    if f.get(W+'id') in drop: root.remove(f)
                data=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
            zo.writestr(it,data)
    os.replace(tmp,path)
    tot[x['file']]=len(drop); print(x['file'],len(drop),'removed')
print(sum(tot.values()))

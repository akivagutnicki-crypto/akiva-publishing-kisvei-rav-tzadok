# Doubles, Ashkenazi labels, overlong quotes, stray direction marks: in the Word files' notes
import re,json,collections,zipfile,os,sys
from common import *
LAB=[('Berakhot','Berachos'),('Shabbat','Shabbos'),('Ketubot','Kesubos'),('Yevamot','Yevamos'),('Taanit','Taanis'),("Ta'anit",'Taanis'),
     ('Makkot','Makkos'),('Shevuot','Shevuos'),('Menachot','Menachos'),('Bekhorot','Bechoros'),('Bava Batra','Bava Basra'),('Horayot','Horayos'),
     ('Keritot','Kerisus'),('Arakhin','Arachin'),('Tosafot','Tosafos'),('Avot','Avos'),('Sukkot','Sukkos'),
     ('Jerusalem Talmud','Yerushalmi'),('Bereshit Rabbah','Bereishis Rabbah'),('Shemot Rabbah','Shemos Rabbah'),('Kohelet Rabbah','Koheles Rabbah'),
     ('Shir HaShirim Rabbah','Shir HaShirim Rabbah'),('Ruth Rabbah','Rus Rabbah'),('Genesis','Bereishis'),('Exodus','Shemos'),('Leviticus','Vayikra'),
     ('Numbers','Bamidbar'),('Deuteronomy','Devarim'),('Psalms','Tehillim'),('Proverbs','Mishlei'),('Isaiah','Yeshayahu'),('Jeremiah','Yirmiyahu'),
     ('Ezekiel','Yechezkel'),('Ecclesiastes','Koheles'),('Song of Songs','Shir HaShirim'),('Lamentations','Eichah'),('I Samuel','Shmuel I'),
     ('II Samuel','Shmuel II'),('I Kings','Melachim I'),('II Kings','Melachim II'),('Joshua','Yehoshua'),('Judges','Shoftim'),('Job','Iyov'),
     ('Ruth','Rus'),('Hosea','Hoshea'),('Micah','Michah'),('Zechariah','Zechariah'),('Malachi','Malachi'),('Nehemiah','Nechemiah'),
     ('I Chronicles','Divrei HaYamim I'),('II Chronicles','Divrei HaYamim II'),('Mishneh Torah, ','Rambam, Hilchos ')]
LABRX=[(re.compile(r'(?<![A-Za-z])'+re.escape(a)+r'(?![a-z])'),b) for a,b in LAB]
BIDI=re.compile('[‎‏‪-‮⁦-⁩]')
def relabel(s):
    for rx,b in LABRX: s=rx.sub(b,s)
    return s
def trim_he(q,n=30):
    w=q.split(); return q if len(w)<=n+8 else ' '.join(w[:n])+' …'
def trim_en(q,n=55):
    w=q.split(); return q if len(w)<=n+10 else ' '.join(w[:n])+' …'
st=collections.Counter()
for x in MAN['files']:
    path=WE+x['file']; P,FN=paras(path)
    dup=set()
    for pr,fns in P:
        seen=set()
        for fid,pi in fns:
            urls=tuple(sorted({r['href'].split('?')[0] for p in FN[fid] for r in p.get('rich',[]) if r.get('href')}))
            k=urls or ntext(FN[fid]).strip()[:120]
            if k in seen: dup.add(fid)
            seen.add(k)
    z=zipfile.ZipFile(path); fx=etree.fromstring(z.read('word/footnotes.xml')); doc=etree.fromstring(z.read('word/document.xml'))
    for f in list(fx.findall(W+'footnote')):
        fid=f.get(W+'id')
        if fid in dup: fx.remove(f); st['doubleRemoved']+=1; continue
        for t in f.iter(W+'t'):
            s=t.text or ''; o=s
            s=BIDI.sub('',s)
            if '“' in s and re.search('[א-ת]',s):            # a Hebrew quotation run
                s=re.sub(r'“([^”]*)”',lambda m:'“'+trim_he(m.group(1))+'”',s)
            elif '“' in s:
                s=re.sub(r'“([^”]*)”',lambda m:'“'+trim_en(m.group(1))+'”',s)
            if not re.search('[א-ת]',s) and '“' not in s: s=relabel(s)   # labels, not quotations
            if s!=o: t.text=s; st['runsChanged']+=1
    for r in list(doc.iter(W+'r')):
        fr=r.find(W+'footnoteReference')
        if fr is not None and fr.get(W+'id') in dup: r.getparent().remove(r)
    tmp=path+'.tmp'
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as zo:
        for it in zi.infolist():
            data=zi.read(it.filename)
            if it.filename=='word/footnotes.xml': data=etree.tostring(fx,xml_declaration=True,encoding='UTF-8',standalone=True)
            elif it.filename=='word/document.xml' and dup: data=etree.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
            zo.writestr(it,data)
    os.replace(tmp,path); print(x['file'],len(dup))
print(dict(st))

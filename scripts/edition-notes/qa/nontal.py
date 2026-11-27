import re,json,collections
from common import *
from quotes import SEF
NM={'Melachim':'מלכים','Shmuel':'שמואל','Rus':'רות','Ruth':'רות','Midrash Tehillim':'תהלים|שוחר','Yalkut':'ילקוט','Zohar':'זהר|זוהר','Tikkunei':'תקונ|תיקונ','Tanchuma':'תנחומא','Pesikta':'פסיקתא','Sifrei':'ספרי','Sifra':'ספרא','Mekhilta':'מכילתא','Bereshit Rabbah':'בראשית|רבה','Bereishis Rabbah':'בראשית|רבה','Shemot Rabbah':'שמות|רבה','Shemos Rabbah':'שמות|רבה','Vayikra Rabbah':'ויקרא|רבה','Bamidbar Rabbah':'במדבר|רבה','Devarim Rabbah':'דברים|רבה','Eichah':'איכה','Esther':'אסתר','Mishnah':'משנה|משנ','Yerushalmi':'ירושלמי','Jerusalem':'ירושלמי','Rambam':'רמב','Mishneh Torah':'רמב','Divrei HaYamim':'הימים','Bereishis':'בראשית','Shemos':'שמות','Vayikra':'ויקרא','Bamidbar':'במדבר','Devarim':'דברים','Tehillim':'תהלים|תהילים','Mishlei':'משלי','Yeshayahu':'ישעיה','Yirmiyahu':'ירמיה','Yechezkel':'יחזקאל','Iyov':'איוב','Koheles':'קהלת','Kohelet':'קהלת','Shir':'שיר','Daniel':'דניאל','Hoshea':'הושע','Michah':'מיכה','Zechariah':'זכריה','Malachi':'מלאכי','Yehoshua':'יהושע','Shoftim':'שופטים','Ezra':'עזרא','Nechemiah':'נחמיה','Amos':'עמוס','Yonah':'יונה','Chavakuk':'חבקוק','Yoel':'יואל','Pirkei':'פרקי','Avos':'אבות','Avot':'אבות','Rashi':'רש','Ramban':'רמב'}
out=[]
for x in MAN['files']:
    P,FN=paras(WE+x['file']); nb=len(P)
    df=collections.Counter(w for pr,f in P for w in set(A.bare(' '.join(h for h,e in pr)).split()))
    for pr,fns in P:
        ptxt=' '.join(h for h,e in pr); pw=set(A.bare(ptxt).split()); pf=WR.flat(ptxt)
        for fid,pi in fns:
            t=ntext(FN[fid]).strip()
            if not t.startswith('Source'): continue
            lab=re.match(r'Source(?: of the quoted words)?: ([^—]+)',t); lab=lab.group(1).strip() if lab else ''
            if re.match(r'(?:Tosafos, |Rashi, )?(%s) \d+[ab]'%'|'.join(SEF),lab): continue
            if any(k in lab and re.search(v,NIK.sub('',ptxt)) for k,v in NM.items() for NIK in [__import__('re').compile(r'[֑-ׇ]')]): continue
            q=' '.join(re.findall(r'“([^”]*)”',t)[:1]); qw=set(A.bare(q).split())
            if len(qw)<5: continue
            if {w for w in qw&pw if len(w)>=4 and df[w]<=nb*0.10}: continue
            if WR.bigrams(q)&WR.bigrams(ptxt): continue
            out.append({'file':x['file'],'fid':fid,'ph':pr[pi][0][:90],'ctx':' '.join(h for h,e in pr[max(0,pi-1):pi+2])[:200],'note':t[:200]})
json.dump(out,open('nontal.json','w'),ensure_ascii=False,indent=0); print(len(out))

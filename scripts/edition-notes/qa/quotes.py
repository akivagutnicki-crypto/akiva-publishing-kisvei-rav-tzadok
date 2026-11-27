# candidates: Talmud source notes quoting the wrong part of the cited amud
import sys,re,json,collections
from common import *
import lib
SEF={'Berachos':'Berakhot','Shabbos':'Shabbat','Eruvin':'Eruvin','Pesachim':'Pesachim','Yoma':'Yoma','Sukkah':'Sukkah','Beitzah':'Beitzah','Rosh Hashanah':'Rosh Hashanah','Taanis':'Taanit','Megillah':'Megillah','Moed Katan':'Moed Katan','Chagigah':'Chagigah','Yevamos':'Yevamot','Kesubos':'Ketubot','Nedarim':'Nedarim','Nazir':'Nazir','Sotah':'Sotah','Gittin':'Gittin','Kiddushin':'Kiddushin','Bava Kamma':'Bava Kamma','Bava Metzia':'Bava Metzia','Bava Basra':'Bava Batra','Sanhedrin':'Sanhedrin','Makkos':'Makkot','Shevuos':'Shevuot','Avodah Zarah':'Avodah Zarah','Horayos':'Horayot','Zevachim':'Zevachim','Menachos':'Menachot','Chullin':'Chullin','Bechoros':'Bekhorot','Arachin':'Arakhin','Temurah':'Temurah','Niddah':'Niddah'}
STOP=set('אמר רבי רב הוא היא הוה אלא אינו אין לא כל על את של מה מאי הכי דאמר שנאמר דכתיב כתיב ואמר אמרו תנא תניא והא הא הני מר אי אם כי כן זה זו גמ מתני ליה להו להם לו לה בו בה עד אף או כמו דף עמוד שם וכו וכולי וגו וגומר וכוליה'.split())
fin=str.maketrans('ךםןףץ','כמנפצ')
def ws(s): return [w.translate(fin) for w in A.bare(s).split() if len(w)>2]
def keyw(s): return {w for w in ws(s) if w not in STOP}
def amud(t,daf,side):
    h=lib.text(t); e=lib.text(t,'English'); i=(int(daf)-1)*2+(0 if side=='a' else 1)
    if not h or i>=len(h): return None
    return [(lib.clean(x) if isinstance(x,str) else '') for x in h[i]], [(x if isinstance(x,str) else '') for x in (e[i] if e and i<len(e) else [])]
if __name__=='__main__':
    res=[]; st=collections.Counter()
    for x in MAN['files']:
        P,FN=paras(WE+x['file'])
        for pr,fns in P:
            for fid,pi in fns:
                t=ntext(FN[fid]); m=re.match(r'\s*Source: ([A-Z][a-z]+(?: [A-Z][a-z]+)?) (\d+)([ab])\b[^“]*“([^”]*)”',t)
                if not m or m.group(1) not in SEF: continue
                a=amud(SEF[m.group(1)],m.group(2),m.group(3))
                if not a: continue
                segs,ens=a; st['talmud']+=1
                ctx=keyw(' '.join(h for h,e in pr[max(0,pi-1):pi+1]))     # the phrase and the one before it
                if len(ctx)<2: continue
                q=keyw(m.group(4))
                cur=max(range(len(segs)),key=lambda i:len(keyw(segs[i])&q)) if segs else None
                sc=[len(keyw(s)&ctx) for s in segs]
                best=max(range(len(segs)),key=lambda i:sc[i])
                if best!=cur and sc[best]>=3 and sc[best]>=sc[cur]+2:
                    st['fix']+=1
                    res.append({'file':x['file'],'fid':fid,'title':SEF[m.group(1)],'label':f'{m.group(1)} {m.group(2)}{m.group(3)}','daf':m.group(2)+m.group(3),'seg':best+1,'cur':cur+1,'score':[sc[cur],sc[best]],'ctx':' '.join(h for h,e in pr[max(0,pi-1):pi+1])[:160],'old':m.group(4)[:120],'new':segs[best][:200]})
    json.dump(res,open('quote_fixes.json','w'),ensure_ascii=False,indent=0); print(dict(st))

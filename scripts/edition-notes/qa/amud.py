import re,json,collections
from common import *
from quotes import SEF, keyw, amud
res=[];st=collections.Counter()
def side(d,s,k):
    i=(int(d)-1)*2+(0 if s=='a' else 1)+k; return str(i//2+1)+('a' if i%2==0 else 'b')
for x in MAN['files']:
    P,FN=paras(WE+x['file'])
    for pr,fns in P:
        for fid,pi in fns:
            t=ntext(FN[fid]); m=re.match(r'\s*Source: ([A-Z][a-z]+(?: [A-Z][a-z]+)?) (\d+)([ab])\b[^“]*“([^”]*)”',t)
            if not m or m.group(1) not in SEF: continue
            ctx=keyw(' '.join(h for h,e in pr[max(0,pi-1):pi+1]))
            if len(ctx)<3: continue
            a=amud(SEF[m.group(1)],m.group(2),m.group(3))
            if not a: continue
            here=max([len(keyw(s)&ctx) for s in a[0]] or [0])
            for k in (-1,1):
                d=side(m.group(2),m.group(3),k); b=amud(SEF[m.group(1)],d[:-1],d[-1])
                if not b: continue
                sc=[len(keyw(s)&ctx) for s in b[0]]; j=max(range(len(sc)),key=lambda i:sc[i]) if sc else 0
                if sc and sc[j]>=4 and sc[j]>=here+3:
                    res.append({'file':x['file'],'fid':fid,'title':SEF[m.group(1)],'label':m.group(1),'from':m.group(2)+m.group(3),'daf':d,'seg':j+1,'score':[here,sc[j]],'ctx':' '.join(h for h,e in pr[max(0,pi-1):pi+1])[:160],'new':b[0][j][:160]}); st['neighbor']+=1
json.dump(res,open('amud_fixes.json','w'),ensure_ascii=False,indent=0); print(dict(st))
import random; random.seed(1)
for r in random.sample(res,min(6,len(res))): print(r['label'],r['from'],'->',r['daf'],r['score'],'\n CTX',r['ctx'][:120],'\n NEW',r['new'][:120],'\n')

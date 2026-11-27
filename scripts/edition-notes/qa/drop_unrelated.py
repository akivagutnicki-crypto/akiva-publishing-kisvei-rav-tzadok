import collections
from common import *
import apply
tot=0
for x in MAN['files']:
    P,FN=paras(WE+x['file'])
    L=[{'t':'b','pairs':pr,'notes':[{'paragraphs':FN[f]} for f,pi in fns]} for pr,fns in P]
    ids=[[f for f,pi in fns] for pr,fns in P]
    e={ids[k][j]:{'kind':'delete'} for k,j in WR.unrelated(L)}
    if e: tot+=len(apply.apply(WE+x['file'],e)); print(x['file'],len(e))
print('dropped',tot)

from common import *
import apply
for x in MAN['files']:
    P,FN=paras(WE+x['file'])
    e={fid:{'kind':'text','pairs':[('the Shemos','the Exodus'),('The Shemos','The Exodus')]} for pr,fns in P for fid,pi in fns if 'he Shemos' in ntext(FN[fid])}
    if e: apply.apply(WE+x['file'],e)

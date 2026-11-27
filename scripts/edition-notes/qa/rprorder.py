import zipfile,os
from common import *
ORDER='rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath'.split()
idx={k:i for i,k in enumerate(ORDER)}
n=0
for x in MAN['files']:
    path=WE+x['file']; z=zipfile.ZipFile(path); fx=etree.fromstring(z.read('word/footnotes.xml'))
    for rpr in fx.iter(W+'rPr'):
        kids=list(rpr); s=sorted(kids,key=lambda e:idx.get(etree.QName(e).localname,99))
        if s!=kids:
            for k in kids: rpr.remove(k)
            for k in s: rpr.append(k)
            n+=1
    tmp=path+'.tmp'
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as zo:
        for it in zi.infolist():
            data=zi.read(it.filename)
            if it.filename=='word/footnotes.xml': data=etree.tostring(fx,xml_declaration=True,encoding='UTF-8',standalone=True)
            zo.writestr(it,data)
    os.replace(tmp,path)
print('reordered',n)

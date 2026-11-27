# Older notes without a Sefaria link: their opening reference becomes a link (Tanach, Bavli, Midrash Rabbah)
import re,collections,zipfile,os,copy
from common import *
from quotes import SEF
TN={'Bereishis':'Genesis','Shemos':'Exodus','Vayikra':'Leviticus','Bamidbar':'Numbers','Devarim':'Deuteronomy','Yehoshua':'Joshua','Shoftim':'Judges',
 'Shmuel I':'I Samuel','Shmuel II':'II Samuel','Melachim I':'I Kings','Melachim II':'II Kings','Yeshayahu':'Isaiah','Yirmiyahu':'Jeremiah','Yechezkel':'Ezekiel',
 'Hoshea':'Hosea','Yoel':'Joel','Amos':'Amos','Ovadiah':'Obadiah','Yonah':'Jonah','Michah':'Micah','Nachum':'Nahum','Chavakuk':'Habakkuk','Tzefaniah':'Zephaniah',
 'Chaggai':'Haggai','Zechariah':'Zechariah','Malachi':'Malachi','Tehillim':'Psalms','Mishlei':'Proverbs','Iyov':'Job','Shir HaShirim':'Song of Songs','Rus':'Ruth',
 'Eichah':'Lamentations','Koheles':'Ecclesiastes','Esther':'Esther','Daniel':'Daniel','Ezra':'Ezra','Nechemiah':'Nehemiah','Divrei HaYamim I':'I Chronicles','Divrei HaYamim II':'II Chronicles'}
MR={'Bereishis':'Bereshit','Shemos':'Shemot','Vayikra':'Vayikra','Bamidbar':'Bamidbar','Devarim':'Devarim','Koheles':'Kohelet','Shir HaShirim':'Shir HaShirim','Rus':'Ruth','Eichah':'Eichah','Esther':'Esther'}
alt=lambda d:'|'.join(sorted(map(re.escape,d),key=len,reverse=True))
RX=[(re.compile(r'^((%s) Rabbah (\d+):(\d+))'%alt(MR)), lambda m:f"{MR[m.group(2)]}_Rabbah.{m.group(3)}.{m.group(4)}"),
    (re.compile(r'^((%s) (\d+):(\d+)(?:[–-](\d+))?)'%alt(TN)), lambda m:f"{TN[m.group(2)].replace(' ','_')}.{m.group(3)}.{m.group(4)}"+(f"-{m.group(5)}" if m.group(5) else '')),
    (re.compile(r'^((%s)(?: and Tosafos)? (\d+[ab]))'%alt(SEF)), lambda m:f"{SEF[m.group(2)].replace(' ','_')}.{m.group(3)}")]
R_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
st=collections.Counter()
for x in MAN['files']:
    path=WE+x['file']; z=zipfile.ZipFile(path)
    fx=etree.fromstring(z.read('word/footnotes.xml')); rels=etree.fromstring(z.read('word/_rels/footnotes.xml.rels'))
    nid=max([int(m.group(1)) for r in rels for m in [re.match(r'rIdAkS(\d+)$',r.get('Id') or '')] if m] or [0])+1
    for f in fx.findall(W+'footnote'):
        if f.find('.//'+W+'hyperlink') is not None: continue
        runs=[r for r in f.iter(W+'r') if r.find(W+'t') is not None]
        if not runs: continue
        # the first run with letters
        r0=next((r for r in runs if (r.find(W+'t').text or '').strip()),None)
        if r0 is None: continue
        t=r0.find(W+'t'); s=t.text; lead=len(s)-len(s.lstrip(' .'))
        body=s[lead:]
        for rx,url in RX:
            m=rx.match(body)
            if m: break
        else: st['noRef']+=1; continue
        ref=m.group(1); rid=f'rIdAkS{nid}'; nid+=1
        e=etree.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'); e.set('Id',rid)
        e.set('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'); e.set('Target','https://www.sefaria.org/'+url(m)); e.set('TargetMode','External')
        before=s[:lead]; after=body[len(ref):]
        hl=etree.Element(W+'hyperlink'); hl.set('{%s}id'%R_NS,rid); hl.set(W+'history','1')
        rl=copy.deepcopy(r0); rpr=rl.find(W+'rPr')
        if rpr is None: rpr=etree.SubElement(rl,W+'rPr'); rl.remove(rpr); rl.insert(0,rpr)
        c=etree.SubElement(rpr,W+'color'); c.set(W+'val','1155CC'); u=etree.SubElement(rpr,W+'u'); u.set(W+'val','single')
        rl.find(W+'t').text=ref; rl.find(W+'t').set('{http://www.w3.org/XML/1998/namespace}space','preserve'); hl.append(rl)
        par=r0.getparent(); i=par.index(r0)
        t.text=after; t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        par.insert(i,hl)
        if before:
            rb=copy.deepcopy(r0); rb.find(W+'t').text=before; par.insert(i,rb)
        st['linked']+=1
    tmp=path+'.tmp'
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as zo:
        for it in zi.infolist():
            data=zi.read(it.filename)
            if it.filename=='word/footnotes.xml': data=etree.tostring(fx,xml_declaration=True,encoding='UTF-8',standalone=True)
            elif it.filename=='word/_rels/footnotes.xml.rels': data=etree.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True)
            zo.writestr(it,data)
    os.replace(tmp,path)
print(dict(st))

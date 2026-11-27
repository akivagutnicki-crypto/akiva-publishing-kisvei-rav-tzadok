# Apply note edits to the Word files: {file: {fid: edit}} with edit kinds quote / delete / text
import sys,zipfile,re,json,os,html
from common import *
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
def apply(path, edits):
    z=zipfile.ZipFile(path); doc=etree.fromstring(z.read('word/document.xml')); fx=etree.fromstring(z.read('word/footnotes.xml'))
    rels=etree.fromstring(z.read('word/_rels/footnotes.xml.rels')); relmap={r.get('Id'):r for r in rels}
    notes={f.get(W+'id'):f for f in fx.findall(W+'footnote')}; done={}
    dele={k for k,v in edits.items() if v['kind']=='delete'}
    for fid,e in edits.items():
        f=notes.get(fid)
        if f is None: continue
        if e['kind']=='delete':
            fx.remove(f); done[fid]='delete'; continue
        if e['kind']=='quote':
            ts=list(f.iter(W+'t'))
            heb=[t for t in ts if t.text and '“' in t.text and re.search('[א-ת]',t.text)]
            en=[t for t in ts if t.text and t.text.startswith(' — “') and not re.search('[א-ת]',t.text)]
            if not heb: continue
            heb[0].text='“'+e['he']+'”'
            if en: en[-1].text=' — “'+e['en']+'”'
            hl=f.find('.//'+W+'hyperlink')
            if hl is not None and hl.get(R+'id') in relmap: relmap[hl.get(R+'id')].set('Target',e['url'])
            done[fid]='quote'
        if e['kind']=='text':           # literal replacements inside the note's runs
            for t in f.iter(W+'t'):
                if any(a=='__PAGE__' for a,b in e['pairs']) and t.text: t.text=re.sub(r' \(Oz Vehadar print, p\. \d+\)','',t.text)
                for a,b in e['pairs']:
                    if a=='__PAGE__': continue
                    if t.text and a in t.text: t.text=t.text.replace(a,b)
            done[fid]='text'
    if dele:
        for r in list(doc.iter(W+'r')):
            fr=r.find(W+'footnoteReference')
            if fr is not None and fr.get(W+'id') in dele: r.getparent().remove(r)
    tmp=path+'.tmp'
    with zipfile.ZipFile(path) as zi, zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as zo:
        for it in zi.infolist():
            data=zi.read(it.filename)
            if it.filename=='word/document.xml' and dele: data=etree.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
            elif it.filename=='word/footnotes.xml': data=etree.tostring(fx,xml_declaration=True,encoding='UTF-8',standalone=True)
            elif it.filename=='word/_rels/footnotes.xml.rels': data=etree.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True)
            zo.writestr(it,data)
    os.replace(tmp,path)
    return done

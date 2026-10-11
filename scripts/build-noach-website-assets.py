#!/usr/bin/env python3
"""Generate an independent website DOCX and HTML preview. Reader untouched."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.etree import ElementTree as ET
from copy import deepcopy
from html import escape
import re

base=Path("dist")
original=base/"library/downloads/pri-tzaddik-noach-ois-5-6-chassidus-kdp-7x10.docx"
output=base/"library/downloads/pri-tzaddik-noach-ois-5-6-paragraph-interlinear.docx"
preview=base/"pri-tzaddik-noach-5-6-preview.html"
W="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML="http://www.w3.org/XML/1998/namespace"
Q=lambda name:"{%s}%s"%(W,name)
ET.register_namespace("w",W)
replacements={
 "And it said: What did women see to be commanded regarding these three mitzvot, etc.?":"And he said: Why were women commanded concerning these three mitzvos, etc.?",
 "And this is what it meant: she defiled the challah of the world—corresponding to the nefesh,":"This is what he meant by “she defiled the challah of the world”: it corresponds to the nefesh,",
 "Just like this tub, etc.,":"Like this earthenware vessel, etc.,",
 "And that which was written ‘she spilled his blood’ corresponds to the ruach which resides in the heart.":"And the statement “she shed his blood” corresponds to ruach, which resides in the heart.",
 "‘The soul that I gave within you is called a candle;":"“The soul that I placed within you is called a lamp;",
 "concerning matters of the candle I warned you’, see there.":"concerning the lamp I warned you,” see there.",
 "as is stated: ‘his flesh run, etc.’,":"as it is stated: “a discharge flows from his flesh,” etc.,",
 "And in the Gemara the formulation is: ‘A revi'it of blood I placed within you’,":"And the Gemara uses the expression: “A quarter-log of blood I placed within you,”",
 "and the Torah brings healing even to this blemish.":"and the Torah brings healing even to this spiritual blemish.",
 "and came about through the cause of Eve.":"and was brought about through Chavah.",
 "And through the contamination that the Serpent injected and which adhered to Adam the First,":"Through the spiritual impurity that the serpent imparted, which clung to Adam HaRishon,",
 "it caused corruption and blemish during the 130 years of his separation.":"this brought about corruption and spiritual damage during the 130 years of his separation.",
 "And the matter is, that the root of exiles is on account of the blemish of the Covenant,":"The matter is that the root of the exiles lies in the blemish of the covenant,",
 "wherein Hashem bestows from the first three Sefirot—Chokhmah, Binah, Da'at:":"during which Hashem bestows influence from the first three sefiros—Chochmah, Binah, and Daas:",
}
def txt(r):return "".join(t.text or "" for t in r.iter(Q("t")))
def pairs(par,index):
    pending=[];out=[]
    for r in par.findall(Q("r")):
        s=txt(r).strip()
        notes=list(r.iter(Q("footnoteReference")))
        if notes:
            if not out:raise ValueError("Footnote before phrase")
            out[-1][2].extend(deepcopy(n) for n in notes)
        elif not s:continue
        elif re.search("[\u0590-\u05ff]",s):pending.append(s)
        elif not re.search("[A-Za-z]",s) and pending:pending.append(s)
        else:
            if not pending:raise ValueError("Unmatched English at "+str(index))
            out.append(["".join(pending).strip(),replacements.get(s,s),[]])
            pending=[]
    if pending:raise ValueError("Unmatched Hebrew at "+str(index))
    if index==8:
        i=next((j for j,x in enumerate(out) if x[1]=="And ONEG ("),None)
        if i is None:raise ValueError("Missing ONEG phrase")
        six=out[i:i+6]
        if [x[1] for x in six[:5]]!=["And ONEG (","- delight) is the acronym of:","Eden (", "), River (", "), Garden ("] or any(x[2] for x in six):
            raise ValueError("ONEG phrase split changed")
        out[i:i+6]=[[six[0][0],"And oneg (“delight”) is an acronym for:",[]],
                     [six[2][0]+" "+six[5][0].split(")",1)[1].strip(),
                      "Eden, Nahar (River), and Gan (Garden), as stated in the Zohar (I, 26a).",[]]]
    return out
def word_run(parent,value="",he=False,br=False,ref=None):
    r=ET.SubElement(parent,Q("r"))
    if br:
        ET.SubElement(r,Q("br"))
        return
    pr=ET.SubElement(r,Q("rPr"))
    ET.SubElement(pr,Q("rFonts"),{Q("ascii"):"Times New Roman",Q("hAnsi"):"Times New Roman",Q("cs"):"Times New Roman"})
    ET.SubElement(pr,Q("sz"),{Q("val"):"19"})
    if he:ET.SubElement(pr,Q("rtl"),{Q("val"):"1"})
    else:ET.SubElement(pr,Q("b"),{Q("val"):"1"})
    if ref is not None:
        ET.SubElement(pr,Q("rStyle"),{Q("val"):"FootnoteReference"})
        r.append(ref)
    else:ET.SubElement(r,Q("t"),{"{%s}space"%XML:"preserve"}).text=value
def main():
    with ZipFile(original) as z:
        members=[(x,z.read(x.filename)) for x in z.infolist()]
        root=ET.fromstring(z.read("word/document.xml"))
    body=root.find(Q("body"))
    paras=body.findall(Q("p"))
    targets=[(i,p) for i,p in enumerate(paras) if p.find(Q("pPr")+"/"+Q("pStyle")) is None and i!=1]
    if len(targets)!=30:raise ValueError("Expected 30 prose paragraphs")
    sections={5:[],6:[]}
    count=0;ids=[]
    for i,p in targets:
        phrase_pairs=pairs(p,i)
        ois=5 if i<19 else 6
        sections[ois].append(phrase_pairs)
        count+=len(phrase_pairs)
        updated=ET.Element(Q("p"))
        pr=deepcopy(p.find(Q("pPr"))) if p.find(Q("pPr")) is not None else ET.Element(Q("pPr"))
        style=pr.find(Q("pStyle"))
        if style is not None:pr.remove(style)
        space=pr.find(Q("spacing"))
        if space is None:space=ET.SubElement(pr,Q("spacing"))
        space.attrib.update({Q("line"):"245",Q("lineRule"):"auto",Q("after"):"120"})
        updated.append(pr)
        for j,(he,en,refs) in enumerate(phrase_pairs):
            if j:word_run(updated,br=True)
            word_run(updated,he,he=True)
            word_run(updated,br=True)
            word_run(updated,en)
            for ref in refs:
                ids.append(int(ref.get(Q("id"))))
                word_run(updated,ref=ref)
        k=list(body).index(p)
        body.remove(p)
        body.insert(k,updated)
    if count!=352 or sorted(ids)!=list(range(1,32)):raise ValueError("Interlinear phrase or footnote mismatch")
    with ZipFile(output,"w",ZIP_DEFLATED,compresslevel=7) as z:
        for item,data in members:
            z.writestr(item,ET.tostring(root,encoding="utf-8",xml_declaration=True) if item.filename=="word/document.xml" else data)
    css="""*{box-sizing:border-box}body{margin:0;background:#f0eee7;font-family:Georgia,serif;color:#25372e}header{background:#172f29;color:white;padding:26px max(5%,15px)}header small{font:700 12px system-ui;letter-spacing:2px;color:#e3cc9b}h1{margin:9px 0}main{max-width:810px;margin:25px auto;padding:0 18px}.intro{font:14px/1.65 system-ui;color:#4b594f}.page{background:#fffdfa;box-shadow:0 12px 42px #17261c25;margin:23px auto;padding:clamp(22px,5vw,58px);border:1px solid #dbd2be}h2{font-size:25px}.he{font:17px/1.55 "Times New Roman",serif;direction:rtl;text-align:right;display:block;margin:0 0 2px}.en{font:700 14px/1.5 "Times New Roman",serif;display:block;margin-bottom:8px}.para{margin:20px 0}sup{font:10px system-ui;color:#9b774c}.links{display:flex;gap:12px;flex-wrap:wrap;padding-bottom:30px}.links a{background:#17372c;color:white;font:700 13px system-ui;text-decoration:none;padding:13px 18px;border-radius:4px}"""
    html=['<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pri Tzaddik Noach 5–6 · Interlinear Preview</title><style>',css,'</style></head><body><header><small>AKIVA PUBLISHING · PARSHAS NOACH</small><h1>Pri Tzaddik · Ois 5–6</h1></header><main><p class="intro">Preview of the corrected paragraph-style edition. The complete DOCX retains all 352 Hebrew–English phrase pairs, 30 original paragraphs, and 31 detailed Word footnotes with cross-references.</p>']
    names={5:"The Three Mitzvos and the Light of Shabbos",6:"The Gates of Wisdom in the Sixth Millennium"}
    for ois in [5,6]:
        html+=['<section class="page"><h2>Ois '+str(ois)+' · '+names[ois]+'</h2>']
        for section in sections[ois][:2]:
            html.append('<div class="para">')
            for he,en,refs in section:
                html.append('<span class="he" lang="he" dir="rtl">'+escape(he)+'</span><span class="en">'+escape(en)+''.join('<sup>'+str(int(ref.get(Q("id"))))+'</sup>' for ref in refs)+'</span>')
            html.append('</div>')
        html.append('</section>')
    html.append('<div class="links"><a href="/library/downloads/'+output.name+'" download>Download paragraph-style Word DOCX</a><a href="/library/#/read/Peri_Tzadik,_Noach_6">Read Ois 6 online</a><a href="/">Back to Akiva Publishing</a></div></main></body></html>')
    preview.write_text(''.join(html),encoding='utf-8')
    print("Website Noach files:",output,preview,"phrases",count,"footnotes",len(ids))
if __name__=="__main__":main()

import re,docx
from docx.shared import Pt,RGBColor,Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
d=docx.Document('essay.docx')
heb=re.compile(r'[֐-׿]')
def runfont(r,name,cs=None):
    rpr=r._element.get_or_add_rPr();f=rpr.find(qn('w:rFonts'))
    if f is None: f=OxmlElement('w:rFonts');rpr.insert(0,f)
    for a in ('w:ascii','w:hAnsi'):f.set(qn(a),name)
    f.set(qn('w:cs'),cs or 'Times New Roman')
for st in d.styles:
    try:
        if st.type==1 and st.font is not None:
            st.font.name='Georgia'
    except Exception: pass
d.styles['Normal'].font.size=Pt(11.5)
for name,size,color in [('Title',28,(0x17,0x37,0x2d)),('Heading 2',16,(0x17,0x37,0x2d)),('Heading 1',28,(0x17,0x37,0x2d))]:
    try:
        st=d.styles[name];st.font.size=Pt(size);st.font.color.rgb=RGBColor(*color);st.font.name='Georgia'
    except KeyError: pass
for p in d.paragraphs+[p for t in d.tables for c in t._cells for p in c.paragraphs]:
    for r in p.runs:
        runfont(r,'Georgia')
        if heb.search(r.text):
            rpr=r._element.get_or_add_rPr();rtl=OxmlElement('w:rtl');rpr.append(rtl)
            szcs=OxmlElement('w:szCs');szcs.set(qn('w:val'),'26');rpr.append(szcs)
for sec in d.sections:
    sec.page_width=Inches(8.5);sec.page_height=Inches(11)
    for m in ('left_margin','right_margin'):setattr(sec,m,Inches(1))
for s in d.inline_shapes:
    s.width=Inches(6.5);s.height=Inches(6.5*900/1600)
d.save('essay.docx')
d=docx.Document('essay.docx')
for p in d.paragraphs:
    if p.style.name.startswith('Heading') or p.style.name=='Title':
        for r in p.runs: r.font.color.rgb=RGBColor(0x17,0x37,0x2d)
d.save('essay.docx')

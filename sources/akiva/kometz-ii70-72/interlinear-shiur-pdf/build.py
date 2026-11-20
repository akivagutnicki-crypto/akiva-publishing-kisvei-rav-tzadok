import re, html as H
from bs4 import BeautifulSoup
src=open('/tmp/k.html',encoding='utf-8').read()
soup=BeautifulSoup(src,'html.parser')
# collect footnotes
notes={}
sec=soup.find('aside',id='footnotes')
for li in sec.find_all('li'):
    n=li['id'][2:]
    for a in li.find_all('a',class_='footnote-back'): a.decompose()
    inner=''.join(str(c) for c in li.contents).strip()
    inner=re.sub(r'^<p>|</p>$','',inner).strip()
    notes[n]=inner
sec.decompose()
for a in soup.find_all('a',class_='footnote-ref'):
    n=a['id'][5:]
    span=soup.new_tag('span',attrs={'class':'footnote'})
    span.append(BeautifulSoup('<b class="fnum">'+n+'.</b> '+notes[n],'html.parser'))
    a.replace_with(span)
heb=re.compile(r'[֐-׿]')
ps=soup.find_all('p',recursive=False)
out=[]
title_done=False
for i,p in enumerate(ps):
    t=p.get_text()
    s=str(p)
    if i==0: out.append('<header class="title"><p class="he-title" dir="rtl">'+p.strong.decode_contents()+'</p>'); continue
    if i==1: out.append('<h1>'+t+'</h1>'); continue
    if i==2: out.append('<p class="subtitle">'+t+'</p>'); continue
    if i==3: out.append('<p class="byline">'+p.em.decode_contents()+'</p><div class="rule"></div></header>'); continue
    strong=p.find('strong')
    only=strong and p.contents and len([c for c in p.contents if str(c).strip()])==1 and p.contents[0].name=='strong'
    if only and t.startswith('Section '):
        out.append('<h2 class="section'+(' newpage' if not t.startswith('Section 70') else '')+'">'+strong.decode_contents()+'</h2>'); continue
    if only and re.match(r'\d+\.',t):
        out.append('<h3>'+strong.decode_contents()+'</h3>'); continue
    if t.startswith('Shiur Commentary:'):
        p['class']='commentary'; out.append(str(p)); continue
    if t.startswith('Dedication'):
        p['class']='dedication'; out.append(str(p)); continue
    if heb.match(t.strip()[:2] or ' ') or (t.strip() and heb.search(t.strip()[:3])):
        p['class']='interlinear'; out.append(str(p)); continue
    out.append(s)
body='\n'.join(out)
# wrap Hebrew runs (outside tags) for styling
def wrap(m):
    t=m.group(0).strip('\u2067\u2069')
    return '<span class="he'+(' long' if len(t)>70 else '')+'" lang="he" dir="rtl">'+t+'</span>'
parts=re.split(r'(<[^>]+>)',body)
hebrun=re.compile(r'[⁧]?[֐-׿יִ-ﭏ״׳][֐-׿יִ-ﭏ״׳\s,.:;׃\-"\'0-9]*[֐-׿יִ-ﭏ״׳](?:[.,:;׃](?=\s|$|<))?[⁩]?|[֐-׿]')
in_title=False
for k,pt in enumerate(parts):
    if pt.startswith('<'):
        continue
    parts[k]=hebrun.sub(wrap,pt)
body=''.join(parts)
body=body.replace(' — <strong>',' <span class="sep">—</span> <strong>').replace('</strong> — ','</strong> <span class="sep">—</span> ')
css=open('/home/claude/kpdf/style.css').read()
doc=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kometz HaMinchah II 70–72 · Interlinear Shiur with 77 Source Notes</title>
<style>{css}</style><script>window.PagedConfig={{auto:true}};</script><script src="paged.polyfill.js"></script></head><body dir="ltr">{body}</body></html>'''
open('/home/claude/kpdf/kometz.html','w',encoding='utf-8').write(doc)
print(len(notes),'notes', body.count('class="footnote"'),'refs', body.count('<h2'),'sections', body.count('<h3'),'subsections', body.count('class="interlinear"'),'interlinear', body.count('class="commentary"'),'commentary')

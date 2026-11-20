import re,subprocess
html=subprocess.check_output(['pandoc','-f','markdown','-t','html','--wrap=none','essay.md'],text=True)
html=html.replace('<aside id="footnotes" class="footnotes footnotes-end-of-document" role="doc-endnotes">\n<hr />','<section class="notes"><h2 class="notes-h">Source Notes</h2>').replace('</aside>','</section>')
html=re.sub(r'<a href="#fnref\d+" class="footnote-back" role="doc-backlink">↩︎</a>','',html)
heb=r'[֐-׿יִ-ﭏ]'
run=re.compile(r'[״׳]?'+heb+r'[֐-׿יִ-ﭏ״׳\s,.:;"\'0-9]*'+r'[֐-׿יִ-ﭏ״׳](?:[.,:;](?=\s|$|<))?')
parts=re.split(r'(<[^>]+>)',html)
for i,p in enumerate(parts):
    if not p.startswith('<'): parts[i]=run.sub(lambda m:'<span class="he" lang="he" dir="rtl">'+m.group(0)+'</span>',p)
html=''.join(parts)
html=html.replace(' — <strong>',' <span class="sep">—</span> <strong>').replace('</strong> — ','</strong> <span class="sep">—</span> ')
html=html.replace('<figure>','<figure class="hero">').replace('<p><img src="hero.jpg" alt="" /></p>','<figure class="hero"><img src="hero.jpg" alt=""></figure>')
html=re.sub(r'<p><img src="hero.jpg"[^>]*></p>|<img src="hero.jpg"[^>]*>','<figure class="hero"><img src="hero.jpg" alt=""></figure>',html,count=1)
css=open('style.css').read()
open('essay.html','w').write(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Leaving Home and Learning to Dream · Parshas Vayeitzei</title><style>{css}</style><script src="paged.polyfill.js"></script></head><body dir="ltr">{html}</body></html>')

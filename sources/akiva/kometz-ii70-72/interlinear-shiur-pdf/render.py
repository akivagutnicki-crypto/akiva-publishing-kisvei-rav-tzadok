from playwright.sync_api import sync_playwright
import sys
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--allow-file-access-from-files'])
    pg=b.new_page(); errs=[]
    pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/kpdf/kometz.html')
    pg.wait_for_function("document.querySelector('.pagedjs_pages') && window.PagedPolyfill", timeout=60000)
    pg.wait_for_timeout(8000)
    n=pg.evaluate("document.querySelectorAll('.pagedjs_page').length")
    fn=pg.evaluate("document.querySelectorAll('.pagedjs_footnote_area .footnote').length")
    print('pages',n,'footnotes placed',fn,errs[:3])
    pg.pdf(path='/home/claude/kpdf/kometz.pdf',prefer_css_page_size=True,print_background=True)
    b.close()

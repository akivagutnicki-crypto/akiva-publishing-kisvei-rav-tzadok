#!/usr/bin/env python3
"""Add the Tzidkas HaTzaddik two-volume section to the homepage of a complete site (the live publication restored by
the release, or dist/): the section right after the Pri Tzaddik new books, its nav link and stylesheet, the cover,
scene and sample files in editions/, and the sample viewer's support for the combined two-volume sample.
Idempotent: running it twice gives the same site.

Usage: python3 scripts/tzidkas-homepage/apply.py SITE
"""
import re, shutil, sys
from pathlib import Path

SRC = Path('dist')
START, END = '<!-- tzidkas-hatzaddik-start -->', '<!-- tzidkas-hatzaddik-end -->'
ANCHOR = '<!-- akiva-new-books-end -->\n'
NAV = '<a href="#new-books">New books</a>'
NAV_NEW = '<a href="#tzidkas">Tzidkas HaTzaddik</a>'
CSS_AFTER = '<link rel="stylesheet" href="editions/dover-tzedek.css?v=20261025-dover-print-v1">'
CSS = '<link rel="stylesheet" href="editions/tzidkas-hatzaddik.css?v=20261103-tzidkas-v1">'
FILES = ['tzidkas-hatzaddik.json', 'tzidkas-hatzaddik.css', 'tzidkas-hatzaddik-sample.pdf',
         'tzidkas-hatzaddik-two-volumes-shtenders.webp', 'tzidkas-hatzaddik-volume-i-front.webp',
         'tzidkas-hatzaddik-volume-i-back.webp', 'tzidkas-hatzaddik-volume-ii-front.webp',
         'tzidkas-hatzaddik-volume-ii-back.webp']


def once(text, old, new, label):
    assert text.count(old) == 1, f'{label}: expected exactly one match'
    return text.replace(old, new)


def section():
    home = (SRC / 'index.html').read_text(encoding='utf-8')
    a, b = home.index(START), home.index(END) + len(END)
    return home[a:b] + '\n'


def patch_home(text):
    if START in text:
        a, b = text.index(START), text.index(END) + len(END) + 1
        text = text[:a] + text[b:]
    text = once(text, ANCHOR, ANCHOR + section(), 'new-books end marker')
    if NAV_NEW not in text:
        text = once(text, NAV, NAV + NAV_NEW, 'navigation')
    if CSS not in text:
        text = once(text, CSS_AFTER, CSS_AFTER + '\n' + CSS, 'stylesheet')
    return text


def patch_sample_js(s):
    s = re.sub(r"(catalogFile \+ '\?v=)[^']+'", r"\g<1>20261103-tzidkas-v1'", s)
    if 'tzidkas-hatzaddik.json' in s:
        return s
    s = once(s, "Original PDF page ${book.sourcePages[page - 1]}`;",
             "${book.pageLabels ? book.pageLabels[page - 1] : 'Original PDF page ' + book.sourcePages[page - 1]}`;", 'caption')
    s = once(s, "? 'dover-tzedek.json' : 'catalog.json';",
             "? 'dover-tzedek.json' : requested?.startsWith('tzidkas-hatzaddik') ? 'tzidkas-hatzaddik.json' : 'catalog.json';", 'catalog')
    s = once(s, "$('sample-note').textContent = `Twenty unchanged pages", "$('sample-note').textContent = book.sampleNote || `Twenty unchanged pages", 'note')
    s = once(s, "      loadPage();\n    } catch",
             "      const startPage = Number(params.get('page'));\n      if (Number.isInteger(startPage) && startPage >= 1 && startPage <= book.samplePages) page = startPage;\n      loadPage();\n    } catch", 'start page')
    return s


def patch_sample_html(h):
    h = re.sub(r'(sample\.js\?v=)[^"]+"', r'\g<1>20261103-tzidkas-v1"', h)
    if '?book=tzidkas-hatzaddik' in h:
        return h
    link = '<a href="?book=pri-tzaddik-shabbos">Kedushas Shabbos &amp; Shevisas Shabbos →</a>'
    return once(h, link, link + '<a href="?book=tzidkas-hatzaddik">Tzidkas HaTzaddik, Volumes I &amp; II →</a>', 'sample choices')


def apply(site):
    site = Path(site)
    ed = site / 'editions'
    assert (site / 'index.html').is_file() and ed.is_dir(), 'Not a complete site'
    for name in FILES:
        if (SRC / 'editions' / name).resolve() != (ed / name).resolve():
            shutil.copyfile(SRC / 'editions' / name, ed / name)
    pages = ed / 'tzidkas-hatzaddik-pages'
    if (SRC / 'editions/tzidkas-hatzaddik-pages').resolve() != pages.resolve():
        if pages.exists():
            shutil.rmtree(pages)
        shutil.copytree(SRC / 'editions/tzidkas-hatzaddik-pages', pages)
    assert len(list(pages.glob('page-*.webp'))) == 20
    home = site / 'index.html'
    home.write_text(patch_home(home.read_text(encoding='utf-8')), encoding='utf-8')
    js = ed / 'sample.js'
    js.write_text(patch_sample_js(js.read_text(encoding='utf-8')), encoding='utf-8')
    for viewer in (ed / 'sample.html', site / 'library/editions/sample.html'):
        if viewer.is_file():
            viewer.write_text(patch_sample_html(viewer.read_text(encoding='utf-8')), encoding='utf-8')
    print('Tzidkas HaTzaddik homepage section applied.')


if __name__ == '__main__':
    apply(sys.argv[1])

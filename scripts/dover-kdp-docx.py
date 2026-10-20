#!/usr/bin/env python3
"""Read the latest two Word volumes without changing their words or notes."""
import collections
import difflib
import hashlib
import gzip
import html
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
CONTROL = re.compile('[\u200e\u200f\u202a-\u202e\u2066-\u2069]')
SECTION_FILES = {'Eruvin — Section 1':'1-1.json','Eruvin — Section 2':'1-2.json',
 'Eruvin — Section 3':'1-3.json','Eruvin — Section 4':'1-4.json',
 'Berachos — Section 1':'2-1.json','Berachos — Section 2':'2-2.json','Berachos — Section 3':'2-3.json',
 'Ner HaMitzvot — Section 1 — Hakdamah':'3-1.json',
 'Ner HaMitzvot — Section 2 — Parashas Bereishis':'3-2.json',
 'Mishlei — Section 1 — Chapter Ten':'4-1.json','Mishlei — Section 2 — Chapter One':'4-2.json',
 'Ki Savo — Section 1':'5-1.json','Vayeishev — Section 2':'5-2.json',
 'Avodah Zarah — Section 3':'5-3.json','Acharei Mos — Section 4':'5-4.json'}
PARTS = {1:'Kuntres_Dover_Tzedek_Eruvin',2:'Kuntres_Dover_Tzedek_Berakhot',
         3:'Kuntres_Ner_HaMitzvot',4:'Mishlei_Commentary',5:'Miscellany'}
BASELINE = None

def visible(s):
    return html.unescape(re.sub('<[^>]*>', '', s))

def bare(s):
    return re.sub('[^א-ת]', '', visible(s))

def clean(s):
    return CONTROL.sub('', s)

def sha(b):
    return hashlib.sha256(b).hexdigest()

def ref_url(url):
    p = urlparse(url)
    if p.fragment.startswith('/read/'):
        ref = unquote(p.fragment[6:]).replace('_', ' ')
        return '#'+p.fragment, ref
    if p.hostname in ('www.sefaria.org', 'sefaria.org'):
        path = unquote(p.path).strip('/')
        ref = path.replace('_', ' ')
        m = re.match(r'^(.*?)[. ](\d+[ab]?(?:[.:]\d+[ab]?)*(?:[-–]\d+[ab]?(?:[.:]\d+[ab]?)*)?)$',ref)
        if m:ref=m[1]+' '+m[2].replace('.', ':')
        return url, ref
    return url, None

def on(run, name):
    p = run.find(W+'rPr/'+W+name)
    return p is not None and p.get(W+'val','1') not in ('0','false','off')

def events(paragraph, rels):
    for run in paragraph.iter(W+'r'):
        href = None
        # ElementTree has no parent lookup. Hyperlink run identity is unambiguous.
        for link in paragraph.iter(W+'hyperlink'):
            if any(child is run for child in link.iter(W+'r')):
                href=rels.get(link.get(R+'id'));break
        for e in run:
            if e.tag==W+'footnoteReference':yield ('note',e.get(W+'id'),{})
            if e.tag in (W+'t',W+'tab',W+'br'):
                text=e.text or '' if e.tag==W+'t' else '\t' if e.tag==W+'tab' else '\n'
                yield ('text',text,{'bold':on(run,'b'),'italic':on(run,'i'),'href':href})

def markup(text, flags):
    out=html.escape(clean(text),quote=False)
    if flags.get('italic'):out='<i>'+out+'</i>'
    if flags.get('href'):
        href,ref=ref_url(flags['href'])
        attrs=' href="'+html.escape(href,quote=True)+'"'
        if ref:attrs+=' data-ref="'+html.escape(ref,quote=True)+'"'
        out='<a'+attrs+'>'+out+'</a>'
    return out

def load_volume(volume):
    name=f'Dover_Tzedek_Volume_{volume}_7x10.docx'
    path=ROOT/'sources/akiva/docx'/name
    with ZipFile(path) as z:
        root=ET.fromstring(z.read('word/document.xml'))
        rels={x.get('Id'):x.get('Target') for x in ET.fromstring(z.read('word/_rels/document.xml.rels'))}
        fn=ET.fromstring(z.read('word/footnotes.xml'))
        nrels={x.get('Id'):x.get('Target') for x in ET.fromstring(z.read('word/_rels/footnotes.xml.rels'))} if 'word/_rels/footnotes.xml.rels' in z.namelist() else {}
    notes={}
    for n in fn:
        if n.get(W+'type') is not None:continue
        paragraphs=[]
        for p in n.iter(W+'p'):
            rich=[]
            for kind,text,flags in events(p,nrels):
                if kind!='text':continue
                text=clean(text)
                if not text:continue
                run={'text':text}
                for f in ['bold','italic']:
                    if flags[f]:run[f]=True
                if flags['href']:run['href']=ref_url(flags['href'])[0]
                if rich and {k:v for k,v in rich[-1].items() if k!='text'}=={k:v for k,v in run.items() if k!='text'}:rich[-1]['text']+=text
                else:rich.append(run)
            text=''.join(r['text'] for r in rich)
            if text.strip():paragraphs.append({'text':text,'rich':rich,'language':'en'})
        assert paragraphs,('Empty Word note',volume,n.get(W+'id'))
        notes[n.get(W+'id')]=paragraphs
    sections={};section=None;pending=[];sequence=0;used=[];title=[];in_title=False
    ps=root.find(W+'body').findall(W+'p')
    for pi,p in enumerate(ps):
        text=''.join(t.text or '' for t in p.iter(W+'t'))
        style=p.find(W+'pPr/'+W+'pStyle');style=style.get(W+'val','') if style is not None else ''
        if style=='Heading1':in_title=text=='Original Title Page and Publisher’s Notice';section=None
        if in_title and style!='Heading1' and text.strip():
            title.append(text.strip())
            if len(title)==18:in_title=False
        if style=='Heading2':
            assert text in SECTION_FILES,('Unknown section',text)
            section=sections.setdefault(SECTION_FILES[text],{'title':text,'volume':volume,'pairs':[]});pending=[]
        if section is None:continue
        if style in ('Heading3','Heading4'):pending.append({'text':text,'level':int(style[-1])});continue
        if '\u2066' not in text:continue
        current=None;state=None;count=0
        for kind,value,flags in events(p,rels):
            if kind=='note':
                assert current is not None and state=='sep',(volume,pi,'note state',state)
                sequence+=1;used.append(value)
                current['notes'].append({'number':sequence,'wordFootnoteId':value,'sourceId':f'DT-KDP-{volume}-{sequence:04}',
                  'placementId':f'DT-KDP-{volume}-{sequence:04}-1','volume':volume,'paragraphs':notes[value]})
                continue
            for part in re.split('([\u2066-\u2069])',value):
                if not part:continue
                if part=='\u2067':
                    assert current is None,(volume,pi,'unclosed phrase')
                    current={'he':'','en':'','heHtml':'','enHtml':'','notes':[], 'docxParagraph':pi,'paragraphStart':count==0,'heads':pending}
                    pending=[];state='he';continue
                if part=='\u2066':assert state=='sep';state='en';continue
                if part=='\u2069':
                    if state=='he':state='sep'
                    elif state=='en':
                        assert current['he'].strip() and current['en'].strip(),(volume,pi,current)
                        for k in ['he','en','heHtml','enHtml']:current[k]=current[k].strip()
                        section['pairs'].append(current);current=None;state=None;count+=1
                    else:raise ValueError(('Unbalanced isolation',volume,pi,state))
                    continue
                if state in ('he','en'):
                    current[state]+=clean(part);current[state+'Html']+=markup(part,flags)
                elif clean(part).strip(' \n\t—-'):raise ValueError(('Unexpected phrase text',volume,pi,repr(part)))
        assert current is None,(volume,pi,'unclosed paragraph')
    refs=[e.get(W+'id') for e in root.iter(W+'footnoteReference')]
    assert used==refs and len(used)==len(set(used)) and set(used)==set(notes),(volume,'Lost note')
    assert len(title)==18 if volume=='I' else not title
    return {'name':name,'sha256':sha(path.read_bytes()),'sections':sections,'notes':sequence,'title':title}

def align_section(file,section):
    global BASELINE
    if BASELINE is None:
        pack=json.loads(gzip.decompress((ROOT/'sources/akiva/overlays/dover-revisions-20261018.json.gz').read_bytes()))
        BASELINE={s['file']:s['items'] for s in pack['sections']}
    source=BASELINE[file]
    old=[(row['n'],pair) for row in source if 'p' in row for pair in row['p']]
    new=section['pairs'];left=[bare(p[0]) for n,p in old];right=[bare(p['he']) for p in new]
    mapping={};changes=[]
    for tag,i,j,k,l in difflib.SequenceMatcher(None,left,right,autojunk=False).get_opcodes():
        if tag=='equal':
            for oi,ni in zip(range(i,j),range(k,l)):mapping[ni]=old[oi][0]
        else:
            changes.append({'kind':tag,'oldRange':[i,j],'newRange':[k,l],
              'old':[[n,visible(pair[0]),visible(pair[1])] for n,pair in old[i:j]],
              'new':[[p['he'],p['en']] for p in new[k:l]]})
            rows=set(n for n,p in old[i:j])
            if len(rows)==1:
                for ni in range(k,l):mapping[ni]=next(iter(rows))
            elif tag=='insert':
                if file=='3-2.json' and i==0:
                    assert l-k==1 and new[k]['he']=='מִצְוַת עֲשֵׂה א׳'
                    for ni in range(k,l):mapping[ni]=1
                else:
                    assert i>0 and i<len(old) and old[i-1][0]==old[i][0],(file,'Insert between canonical paragraphs',i)
                    for ni in range(k,l):mapping[ni]=old[i][0]
            else:raise ValueError((file,'Canonical boundary requires review',tag,i,j,k,l))
    assert len(mapping)==len(new) and list(mapping[x] for x in range(len(new)))==sorted(mapping.values())
    assert set(mapping.values())==set(n for n,p in old),(file,'Canonical paragraph lost')
    return mapping,changes

def extract():
    volumes={v:load_volume(v) for v in ['I','II']};sections={};changes=[]
    for v,data in volumes.items():
        for file,section in data['sections'].items():
            mapping,changed=align_section(file,section);section['canonicalNumbers']=[mapping[i] for i in range(len(section['pairs']))]
            sections[file]=section;changes.extend({'file':file,**x} for x in changed)
    return {'book':'Dover Tzedek','volumes':{v:{k:d[k] for k in ('name','sha256','notes','title')} for v,d in volumes.items()},'sections':sections,'alignmentChanges':changes}

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--out',required=True);args=p.parse_args()
    data=extract();Path(args.out).write_text(json.dumps(data,ensure_ascii=False))
    print(json.dumps({'pairs':sum(len(s['pairs']) for s in data['sections'].values()),'notes':{v:d['notes'] for v,d in data['volumes'].items()},'changes':len(data['alignmentChanges'])}))

from pathlib import Path
from zipfile import ZipFile
from lxml import etree
from itertools import groupby
from urllib.parse import urlparse, unquote
import base64, gzip, hashlib, html, json, re, sys

if len(sys.argv)<2:
    raise SystemExit('Usage: python scripts/import-pri-toldos.py INPUT.docx [OUTPUT.json.gz.b64]')
SOURCE = Path(sys.argv[1])
DEST = Path(sys.argv[2]) if len(sys.argv)>2 else Path('sources/akiva/overlays/pri-toldos.json.gz.b64')
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{'+NS['w']+'}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def sha(b): return hashlib.sha256(b).hexdigest()

def rich(chars):
    out = []
    for url, group in groupby(chars, lambda x:x[1]):
        text = html.escape(''.join(c[0] for c in group), quote=False)
        if url:
            ref = unquote(urlparse(url).path.strip('/')).replace('_',' ')
            m = re.match(r'^(.*?[^\d\s])\.(\d+[ab]?)((?:\.\d+[ab]?)*)(-.*)?$', ref)
            if m: ref = m[1]+' '+m[2]+m[3].replace('.',':')+(m[4] or '').replace('.',':')
            text = f'<a data-ref="{html.escape(ref,quote=True)}" href="{html.escape(url,quote=True)}">{text}</a>'
        out.append(text)
    return ''.join(out).strip()

def pairs_of(chars):
    # Script changes locate phrase boundaries. Neutral punctuation stays with
    # its preceding language through the last space, retaining every character.
    pairs, he, en, pending = [], [], [], []
    cur, is_he = he, True
    for ch in chars:
        c = ch[0]
        script = True if re.match('[א-ת]',c) else False if re.match('[A-Za-z]',c) else None
        if script is None:
            pending.append(ch)
            continue
        if script != is_he:
            cut = max((i for i,x in enumerate(pending) if x[0].isspace()), default=-1)
            cur.extend(pending[:cut+1]); pending=pending[cut+1:]
            if script:
                pairs.append([he,en]); he,en=[],[]; cur=he
            else: cur=en
            is_he=script
        cur.extend(pending); pending=[]; cur.append(ch)
    cur.extend(pending)
    if he or en: pairs.append([he,en])
    for h,e in pairs:
        assert re.search('[א-ת]',''.join(c[0] for c in h)), ('missing Hebrew',h,e)
        assert re.search('[A-Za-z]',''.join(c[0] for c in e)), ('missing English',h,e)
    raw = [''.join(c[0] for c in x) for p in pairs for x in p]
    assert ''.join(raw)==''.join(c[0] for c in chars)
    return [[rich(h),rich(e)] for h,e in pairs]

with ZipFile(SOURCE) as z:
    doc=etree.fromstring(z.read('word/document.xml'))
    rels={x.get('Id'):x.get('Target') for x in etree.fromstring(z.read('word/_rels/document.xml.rels'))}
sections=[]; excluded=[]
for index,p in enumerate(doc.findall('w:body/w:p',NS)):
    text=''.join(p.xpath('.//w:t/text()',namespaces=NS))
    if not text.strip(): continue
    style=p.find('w:pPr/w:pStyle',NS)
    style=style.get(W+'val') if style is not None else ''
    if style=='Heading3':
        sections.append({'chapter':len(sections)+1,'sourceHeading':text,'items':[]})
        continue
    if style=='Heading4':
        sections[-1]['items'].append({'h':'After Havdalah','sourceHeading':text})
        continue
    if text.startswith('להלן התרגום והביאור השורה-אחר-שורה'):
        excluded.append({'paragraph':index,'text':text,'reason':'Repeated conversion instruction between teachings'})
        continue
    chars=[]
    for run in p.findall('.//w:r',NS):
        t=''.join(run.xpath('.//w:t/text()',namespaces=NS))
        parent=run.getparent()
        url=rels.get(parent.get(R+'id')) if parent.tag==W+'hyperlink' else None
        if url: assert urlparse(url).netloc=='www.sefaria.org'
        chars.extend((c,url) for c in t)
    pairs=pairs_of(chars)
    plain=lambda x:html.unescape(re.sub('<[^>]+>','',x))
    assert re.sub(r'\s','', ''.join(plain(h)+plain(e) for h,e in pairs))==re.sub(r'\s','',text)
    n=1+sum('p' in item for item in sections[-1]['items'])
    sections[-1]['items'].append({'n':n,'p':pairs,'sourceParagraph':index,'sourceText':text})
    english=' '.join(plain(pair[1]) for pair in pairs)
    print(f'{len(sections)}:{n} ({len(pairs)} pairs) {english[:410]}')

assert len(sections)==10
titles = [
    'The Patriarchs Crown One Another',
    'Holy Eating and the Three Shabbos Meals',
    'The Meal of Faith and the King\'s Table',
    'Yaakov\'s Blessing and the Future Feast',
    'True Deeds and the Fragrance of Yaakov',
    'Truth and Yaakov\'s Holy Stratagem',
    'The Ten Blessings and the Holy Shepherds',
    'Torah and the Divine Life Within Food',
    'Teshuvah and the Sanctity of Shabbos',
    'Torah Lishmah and Carrying Shabbos Into the Week',
]
headings = [
    ['The Joy at Yitzchak\'s Birth','Avraham Is Crowned Through Yaakov','The Merit of the Patriarchs','Love and Awe Complete One Another'],
    ['The Three Meals and the Sanctity of Eating','Honoring a Parent and Sharing in a Mitzvah','Yitzchak Seeks a Meal of Holiness','Rivkah\'s Command to Yaakov','Shammai and Hillel Sanctify Their Meals'],
    ['The Meal of Faith','The Bread and Delicacies Prepared by Rivkah'],
    ['The Blessing That Arrived Early','Leviathan and the Future Feast'],
    ['Yaakov\'s Answer to Yitzchak','The True Doer of His Maker\'s Will'],
    ['Overcoming Deception Through Truth'],
    ['The Blessing of Holy Nourishment','Ten Blessings and the Ten Utterances','The Six Shepherds and the Defeat of Evil'],
    ['Scripture Mishnah Talmud and Aggadah','Food Sustains the Body and the Soul','Receiving the Divine Life Within Creation'],
    ['Before I Die','Repent One Day Before Your Death','Rest as Though All Your Work Were Finished','Preparing to Stand Before Hashem','White Garments and Oil','Yitzchak\'s Holy Meal','Tzitzis and Tefillin','The Wells of the Patriarchs','Avraham Rectifies Thought','Yitzchak Rectifies Action','The Shabbos Meals Rectify Thought and Action'],
    ['Torah for the Sake of Hashem','Highways in the Heart','Rivkah Teaches Pure Intention','Yaakov Fulfills the Purpose of Creation','The Field of Holy Apples','The Extra Soul and the Holy Heart','Let the Pleasantness of Hashem Remain With Us'],
]
for sec,title,subs in zip(sections,titles,headings):
    sec['title']=f'Toldos Ois {sec["chapter"]} · {title}'
    assert len(subs)==sum('p' in item for item in sec['items'])
    for item,label in zip((i for i in sec['items'] if 'p' in i),subs): item['heading']=label
body=''.join(item['sourceText'] for sec in sections for item in sec['items'] if 'p' in item)
pack={'book':'Peri Tzadik','schemaVersion':1,
      'source':{'filename':SOURCE.name,'sha256':sha(SOURCE.read_bytes()),
                'bodyTextSha256':sha(body.encode()),'excludedEditorialInstructions':excluded},
      'sections':sections}
encoded=gzip.compress(json.dumps(pack,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)
DEST.write_text(base64.b64encode(encoded).decode()+'\n')
print('COUNTS',len(sections),sum('p' in i for s in sections for i in s['items']),sum(len(i['p']) for s in sections for i in s['items'] if 'p' in i),'COMPRESSED',len(encoded),'SHA',sha(encoded))

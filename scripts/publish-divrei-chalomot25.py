"""Apply the supplied corrected PDF edition to the existing published reader.

Preserves Hebrew glyphs, all other sefarim, and unrelated site files. Updates
the reader, MCP text/search, and existing offline ZIPs from the same edition.
"""
import copy, hashlib, html, json, os, re, subprocess, sys, urllib.parse, urllib.request, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
EDITION=json.loads((ROOT/'sources/akiva/divrei-chalomot25/edition.json').read_text())
REV=EDITION['revision']+'-headings'; SLUG='divrei-chalomot'
def plain(s):return html.unescape(re.sub('<[^>]*>','',str(s)))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,obj):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')))
def inventory(site):return {p.relative_to(site).as_posix():digest(p) for p in site.rglob('*') if p.is_file()}
def units(items):return [i for i in items if 'p' in i]
def hebrew(items):return [plain(p[0]) for it in units(items) for p in it['p']]

def apply(site):
 site=Path(site); data=site/'library/data';book=data/SLUG
 if not (book/'24.json').exists():raise RuntimeError('Missing published Divrei Chalomot 25')
 before=inventory(site); original=read(book/'24.json');items=copy.deepcopy(original);its=units(items)
 assert len(its)==3 and [len(i['p']) for i in its]==[44,11,47]
 assert hebrew(items)==[p['he'] for p in EDITION['translations']],'Hebrew source differs from reviewed PDF alignment'
 if all(it.get('sourceEdition')==REV for it in its):
  verify(site);print(json.dumps({'mode':'already-applied','revision':REV}));return
 other={i:read(book/f'{i}.json') for i in range(28) if i!=24};other_original=copy.deepcopy(other)
 first=1+max([n['number'] for i in range(24) for it in other[i] for n in it.get('footnotes',[])],default=0)
 oldlast=max(n['number'] for it in original for n in it.get('footnotes',[]))
 for it in its:it['footnotes']=[];it['sourceEdition']=REV
 # Use the full corrected English from the PDF, with no summaries or bracket carryover.
 locations=[]
 for ii,it in enumerate(its):
  for pi,pair in enumerate(it['p']):
   k=len(locations);pair[1]=EDITION['translations'][k]['en'];locations.append((ii,pi))
 # Repair citation metadata without changing a Hebrew character.
 corrections={'Zohar, Pinchas 10:58-12:70':'Zohar, Pinchas 10:60','Rashi on Deuteronomy 26:1':'Rashi on Deuteronomy 27:24','Bereshit Rabbah 37':'Bereshit Rabbah 37:7','Bereshit Rabbah 61':'Bereshit Rabbah 61:1','Bereshit Rabbah 9':'Bereshit Rabbah 9:7','Bereshit Rabbah 17':'Bereshit Rabbah 17:5','Deuteronomy 21:10-25:19':'Deuteronomy 27:15-25','Deuteronomy 26:1-29:8':'Deuteronomy 27:15-25'}
 for it in its:
  for pair in it['p']:
   for old,new in corrections.items():pair[0]=pair[0].replace('data-ref="'+old+'"','data-ref="'+new+'"')
 titles=['Chanukah: the thirteen tribes and the twenty-six kindnesses','Yitzchak and Yaakov: holiness within earthly life','Transforming deficiency: the Greek opposition and the Chanukah light']
 h=0
 for it in items:
  if 'h' in it and h<3:it['h']=titles[h];h+=1
 its[0]['inlineHeadings']=[{'phraseIndex':18,'text':'Shem and Ever: the name Yisrael','kind':'subsection'},{'phraseIndex':26,'text':'Avraham and the opposing shell of Og','kind':'subsection'},{'phraseIndex':36,'text':'Torah flowing from Avraham','kind':'subsection'}]
 its[1]['inlineHeadings']=[{'phraseIndex':5,'text':'Yaakov and the holiness of every descendant','kind':'subsection'}]
 its[2]['inlineHeadings']=[{'phraseIndex':12,'text':'The dream ends; Rav Tzadok develops its meaning','kind':'subsection'},{'phraseIndex':20,'text':'The sealed spring and the Hasmonean victory','kind':'subsection'},{'phraseIndex':38,'text':'Levi: devotion beyond personal calculation','kind':'subsection'}]
 for it,headings in zip(its,read(ROOT/'sources/akiva/divrei-chalomot25/headings.json')):
  it['inlineHeadings']=[{**h,'kind':'subsection'} for h in headings]
 for k,note in enumerate(EDITION['notes']):
  ii,pi=locations[note['pair']];he,en=map(plain,its[ii]['p'][pi]);number=first+k
  n={**copy.deepcopy(note),'number':number,'placementId':note['sourceId']+'-1','phraseIndex':pi,'heWord':len(he.split()),'heCharOffset':len(he),'heAnchorPrefix':he,'enCharOffset':len(en),'enAnchorPrefix':en,'nativeConnections':[],
     'verificationStatus':'Corrected supplied PDF note; additional shiur sources checked against retrieved primary texts' if note['kind']=='pdf-note' else 'Shiur discussion checked against retrieved primary sources; interpretation distinguished from source text',
     'provenance':{'edition':REV,'sourcePdf':EDITION['sourcePdf'],'pdfNumber':note.get('pdfNumber'),'kind':note['kind']}}
  del n['pair'];its[ii]['footnotes'].append(n)
 write(book/'24.json',items)
 delta=first+len(EDITION['notes'])-1-oldlast
 for i in range(25,28):
  for it in other[i]:
   for n in it.get('footnotes',[]):n['number']+=delta
  write(book/f'{i}.json',other[i])
 assert hebrew(items)==hebrew(original)
 # Keep section titles, search/navigation metadata and translation aligned.
 toc=read(book/'toc.json');leaf=toc['toc']['children'][24]
 leaf['en']='Chanukah: Zeh Leumas Zeh and the Thirteen Tribes'
 toc['reviewedEditions']={**toc.get('reviewedEditions',{}),'25':{'revision':REV,'phrases':102,'pdfNotes':63,'shiurDiscussionNotes':13,'notes':76,'translationSource':EDITION['sourcePdf']}}
 write(book/'toc.json',toc)
 update_mcp(site,items,other)
 if (site/'mcp-data/catalog.json').exists():
  subprocess.run(['node',str(ROOT/'scripts/build-mcp-search-index.mjs'),str(site/'mcp-data'),SLUG],check=True)
 # Version the exact corrected data on both entry points so installed readers
 # request a fresh copy instead of immediately showing stale cached JSON.
 for p in [site/'library/index.html',site/'library/open/index.html']:
  if not p.exists():continue
  text=p.read_text();anchor='const editionDataUrl = url => '
  if p.parent.name=='open' and anchor not in text:
   assert 'Android' in text and 'reader' in text,'Unexpected open-app landing page'
   continue
  assert text.count(anchor)==1,'Unexpected reader data URL function'
  condition="/* "+REV+" */ (url.startsWith('data/divrei-chalomot/') || url === 'data/files.json') ? url + '?dc25="+REV+"' : "
  text=text.replace(anchor,anchor+condition,1);p.write_text(text)
 sw=site/'library/sw.js';text=sw.read_text();m=re.search(r'const SHELL = `([^`]*)`;',text);assert m
 sw.write_text(text.replace(m.group(0),'const SHELL = `'+m.group(1)+'-'+REV+'`;'))
 # Pages artifact tar excludes dotfiles. Restore only declared missing data
 # entries from its own complete offline ZIP before updating the manifest.
 manifest=read(data/'files.json')
 with zipfile.ZipFile(site/'library/downloads/rav-tzadok-library.zip') as z:
  for rel in manifest['files']:
   p=data/rel
   if not p.exists():
    assert any(part.startswith('.') for part in Path(rel).parts),'Unexpected missing published data: '+rel
    p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read('data/'+rel))
 files=sorted(p.relative_to(data).as_posix() for p in data.rglob('*') if p.is_file() and p!=data/'files.json')
 h=hashlib.sha256();total=0
 for rel in files:
  b=(data/rel).read_bytes();h.update(rel.encode());h.update(b'\0');h.update(b);total+=len(b)
 write(data/'files.json',{'version':h.hexdigest()[:16],'bytes':total,'files':files})
 changes={p:site/p for p in inventory(site) if p.startswith('library/data/') and before.get(p)!=digest(site/p)}
 updates={p.removeprefix('library/'):f for p,f in changes.items()}
 downloads=site/'library/downloads'
 for archive in [downloads/'books/divrei-chalomot.zip',downloads/'rav-tzadok-library.zip']:
  rewrite_zip(archive,updates)
 ix=read(downloads/'index.json');ix['version']=read(data/'files.json')['version']
 ix['library']['bytes']=(downloads/'rav-tzadok-library.zip').stat().st_size
 for b in ix['books']:
  if b['slug']==SLUG:b['bytes']=(downloads/'books/divrei-chalomot.zip').stat().st_size
 write(downloads/'index.json',ix)
 after=inventory(site);changed=[p for p in after if before.get(p)!=after[p]]
 allowed=re.compile(r'^(library/(index\.html|open/index\.html|sw\.js|data/(files\.json|cited/\.json|divrei-chalomot/(24|25|26|27|toc)\.json)|downloads/(index\.json|books/divrei-chalomot\.zip|rav-tzadok-library\.zip))|mcp-data/(text/divrei-chalomot\.json|cited\.json|search/divrei-chalomot\..+|text-chunks/divrei-chalomot/.+))$')
 assert all(p.startswith('mcp-data/text-chunks/divrei-chalomot/') or p.startswith('mcp-data/search/divrei-chalomot.') for p in set(before)-set(after)),'Unrelated published files were removed'
 assert all(allowed.fullmatch(p) for p in changed),'Unexpected changed files: '+str([p for p in changed if not allowed.fullmatch(p)])
 # Only note display numbers may move in the subsequent sections; their text,
 # Hebrew anchors, source identifiers and commentary remain exactly intact.
 for i in range(25,28):
  old=copy.deepcopy(other_original[i]);now=read(book/f'{i}.json')
  for it in old:
   for n in it.get('footnotes',[]):n['number']+=delta
  assert old==now,'More than note display numbers changed in a following section'
 report={'revision':REV,'phrases':102,'pdfNotes':63,'shiurDiscussionNotes':13,'footnotes':76,'firstFootnote':first,'lastFootnote':first+75,'followingNotesRenumberedBy':delta,'hebrewPreserved':True,'changedFiles':changed,'unrelatedFilesPreserved':len(before)-len(changed),'hashes':{p:after[p] for p in changed}}
 write(site/'library/divrei-chalomot25-publication.json',report)
 verify(site);print(json.dumps(report))

def rewrite_zip(archive,updates):
 temp=archive.with_suffix('.updated.zip')
 with zipfile.ZipFile(archive) as src,zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as dst:
  names=set(src.namelist())
  for info in src.infolist():
   if info.filename in updates:dst.writestr(info,updates[info.filename].read_bytes())
   else:
    with src.open(info) as r,dst.open(info,'w',force_zip64=info.file_size>2**31) as w:
     while chunk:=r.read(1<<20):w.write(chunk)
  # Book ZIPs get only that book's revised data. The complete archive gets all.
  for name,p in updates.items():
   if name not in names and (archive.name=='rav-tzadok-library.zip' or name.startswith('data/divrei-chalomot/')):dst.writestr(name,p.read_bytes())
 temp.replace(archive)

def update_mcp(site,items,other):
 file=site/'mcp-data/text/divrei-chalomot.json'
 if not file.exists():return
 m=read(file);byref={p['r']:p for p in m['paras']};heading=[];pi=0
 for it in items:
  if 'h'in it:heading=[it['h']];continue
  if 'p'not in it:continue
  pi+=1;p=byref[f'Divrei Chalomot 25:{pi}'];p['p']=[[plain(a),plain(b)] for a,b in it['p']]
  p['h']=heading;p['inlineHeadings']=it.get('inlineHeadings',[])
  p['f']=[[str(n['number']),'\n'.join(x['text'] for x in n['paragraphs']),n['phraseIndex'],'h',n['heCharOffset']] for n in it['footnotes']]
  p['a']={}
  for k,(he,en) in enumerate(it['p']):
   for side,t in [('h',he),('e',en)]:
    for a in re.finditer(r'<a\b[^>]*data-ref="([^"]+)"',t):p['a'].setdefault(html.unescape(a[1]),[k,side,len(plain(t[:a.start()]))])
  for n in it['footnotes']:
   for source in n['sources']:
    u=source['url'];ref=source['ref']
    if u.startswith('#/read/'):ref=urllib.parse.unquote(u.split('#/read/')[1]).replace('_',' ')
    elif 'sefaria.org/' in u:ref=urllib.parse.unquote(u.split('sefaria.org/')[1]).replace('_',' ')
    p['a'].setdefault(ref,['n',str(n['number'])])
 for sec in range(25,28):
  for idx,it in enumerate(units(other[sec]),1):
   p=byref[f'Divrei Chalomot {sec+1}:{idx}'] if sec<27 else next((p for p in m['paras'] if p['s']==27 and p['n']==idx),None)
   if p:
    mapping={n['sourceId']:n['number'] for n in it.get('footnotes',[])}
    # These sections retain exactly the original structured notes in order.
    for old,n in zip(p.get('f',[]),it.get('footnotes',[])):old[0]=str(n['number'])
 write(file,m)
 citedfile=site/'mcp-data/cited.json'
 if citedfile.exists():
  cited=read(citedfile)
  for r in list(cited):
   cited[r]=[p for p in cited[r] if not p.startswith('Divrei Chalomot 25:')]
   if not cited[r]:del cited[r]
  for p in m['paras']:
   if p['r'].startswith('Divrei Chalomot 25:'):
    for r in p.get('a',{}):
     if p['r'] not in cited.setdefault(r,[]):cited[r].append(p['r'])
  write(citedfile,cited)

def verify(site):
 site=Path(site);items=read(site/'library/data/divrei-chalomot/24.json');its=units(items)
 assert hebrew(items)==[p['he'] for p in EDITION['translations']]
 assert [plain(p[1]) for it in its for p in it['p']]==[p['en'] for p in EDITION['translations']]
 ns=[n for it in its for n in it['footnotes']]
 assert len(ns)==76 and len({n['placementId'] for n in ns})==76
 assert [n['number'] for n in ns]==list(range(ns[0]['number'],ns[0]['number']+76))
 assert sorted(n['pdfNumber'] for n in ns if n['kind']=='pdf-note')==list(range(1,64))
 for it in its:
  for n in it['footnotes']:
   he,en=map(plain,it['p'][n['phraseIndex']]);assert he[:n['heCharOffset']]==n['heAnchorPrefix'];assert en[:n['enCharOffset']]==n['enAnchorPrefix']
   for p in n['paragraphs']:assert p['text']==''.join(r['text'] for r in p['rich'])
 text='\n'.join(p['text'] for n in ns for p in n['paragraphs'])
 assert 'בְּשַׁגַּם' in text and 'מֵאָה וְעֶשְׂרִים' in text and 'Chullin 139b:10' in text
 for z in ['books/divrei-chalomot.zip','rav-tzadok-library.zip']:
  with zipfile.ZipFile(site/'library/downloads'/z) as archive:
   assert archive.read('data/divrei-chalomot/24.json')==(site/'library/data/divrei-chalomot/24.json').read_bytes()
 m=read(site/'mcp-data/text/divrei-chalomot.json');ps=[p for p in m['paras'] if p['r'].startswith('Divrei Chalomot 25:')]
 assert [p['p'] for p in ps]==[[[plain(a),plain(b)] for a,b in it['p']] for it in its]
 assert sum(len(p['f']) for p in ps)==76

if __name__=='__main__':
 mode=sys.argv[1];site=sys.argv[2] if len(sys.argv)>2 else 'dist'
 if mode=='apply':apply(site)
 elif mode=='verify':verify(site);print('PASS: 102 PDF translations, 63 PDF notes, 13 sourced discussions, exact Hebrew anchors, matching offline and MCP editions')
 else:raise ValueError(mode)

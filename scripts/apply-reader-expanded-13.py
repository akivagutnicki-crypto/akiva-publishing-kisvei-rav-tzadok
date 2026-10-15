#!/usr/bin/env python3
"""Install the two verified Akiva Publishing 13-volume ZIPs after reader build.
Never copy the four excluded books or change reader UI files."""
import hashlib, html, json, os, re, tempfile, zipfile
from pathlib import Path

BASE=Path('dist/library/data')
IN=Path('incoming')
PARTS=[IN/'akiva-reader-13-part-1.zip',IN/'akiva-reader-13-part-2.zip']
MANIFEST=IN/'akiva-reader-13-manifest.json'
BOOKS={'peri-tzadik':1665,'machshavot-charutz':3580,'divrei-soferim':845,
 'sefer-hazikhronot':785,'tzidkat-hatzadik':2194,'yisrael-kedoshim':2685,
 'kometz-haminchah':1688,'likkutei-maamarim':3347,'poked-akarim':952,
 'ohr-zarua-latzadik':1710,'sichat-malakhei-hasharet':752,'sichat-shedim':120,
 'divrei-chalomot':247}
EXCLUDED=('takanat-hashavin','resisei-layla','et-haochel','dover-tzedek')
PREFIXES=('Peri Tzadik','Pri Tzadik','Machshavot Charutz','Divrei Soferim',
 'Sefer HaZikhronot','Tzidkat HaTzadik','Yisrael Kedoshim','Kometz HaMinchah',
 'Likkutei Maamarim','Poked Akarim','Ohr Zarua LaTzadik',
 'Sichat Malakhei HaSharet','Sichat Shedim','Divrei Chalomot')
sha=lambda x:hashlib.sha256(x).hexdigest()
plain=lambda x:html.unescape(re.sub('<[^>]*>','',str(x or ''))).replace('\u00a0',' ')
def target_ref(s):
 return isinstance(s,str) and any(s==p or s.startswith(p+' ') or s.startswith(p+',') or s.startswith(p+':') for p in PREFIXES)
def hashdir(d):
 if not d.is_dir():return None
 h=hashlib.sha256()
 for p in sorted(d.rglob('*')):
  if p.is_file():h.update(str(p.relative_to(d)).encode());h.update(p.read_bytes())
 return h.hexdigest()
def load():
 if not MANIFEST.exists() and not any(p.exists() for p in PARTS):
  print('No 13-volume release ZIP staged; published data unchanged.');return None
 if not MANIFEST.exists() or not all(p.exists() for p in PARTS):
  raise ValueError('Incomplete 13-volume release: upload BOTH ZIP parts and manifest under incoming/')
 meta=json.loads(MANIFEST.read_text())
 if meta['expectedFootnotes']!=BOOKS or set(meta['exclusions'])!=set(EXCLUDED):
  raise ValueError('Unrecognized release manifest')
 data={}
 for idx,path in enumerate(PARTS,1):
  if sha(path.read_bytes())!=meta['parts'][str(idx)]['sha256']:
   raise ValueError('ZIP checksum failed '+path.name)
  with zipfile.ZipFile(path) as z:
   for name in z.namelist():
    if name.startswith('/') or '\\' in name or '..' in Path(name).parts:
     raise ValueError('Unsafe ZIP member '+name)
    if name in data or name not in meta['payloadFiles'] or not name.endswith('.json'):
     raise ValueError('Unexpected ZIP member '+name)
    folder=name.split('/')[1] if name.startswith('data/') else ''
    if folder not in BOOKS and folder not in ('cited','files.json','catalog.json'):
     raise ValueError('Excluded or unknown volume in archive '+name)
    body=z.read(name)
    if sha(body)!=meta['payloadFiles'][name]:raise ValueError('File checksum failed '+name)
    data[name]=body
 if set(data)!=set(meta['payloadFiles']):raise ValueError('Incomplete ZIP payload')
 return data
def verify(data):
 for book,expect in BOOKS.items():
  prefix='data/'+book+'/'
  names=[n for n in data if n.startswith(prefix) and not n.endswith(('/toc.json','/links.json'))]
  if prefix+'toc.json' not in data or prefix+'links.json' not in data:
   raise ValueError('Missing TOC or references for '+book)
  numbers=[];ids=set()
  for name in names:
   for item in json.loads(data[name]):
    if not isinstance(item,dict):continue
    for fn in item.get('footnotes',[]):
     numbers.append(fn.get('number'))
     if fn.get('sourceId') in ids:raise ValueError('Duplicate footnote '+book)
     ids.add(fn.get('sourceId'));idx=fn.get('phraseIndex',-1)
     phrase=item.get('p',[])
     if not isinstance(idx,int) or idx<0 or idx>=len(phrase):
      raise ValueError('Missing Hebrew phrase '+name)
     pair=phrase[idx]
     for prefix_lang,col in [('he',0),('en',1)]:
      if plain(pair[col])[:fn.get(prefix_lang+'CharOffset',-1)]!=fn.get(prefix_lang+'AnchorPrefix'):
       raise ValueError('Broken Hebrew/English anchor '+str(fn.get('sourceId')))
     if not fn.get('paragraphs'):raise ValueError('Missing popup '+str(fn.get('sourceId')))
     for p in fn['paragraphs']:
      if p.get('rich') and ''.join(x.get('text','') for x in p['rich'])!=p.get('text',''):
       raise ValueError('Broken source hyperlink formatting '+str(fn.get('sourceId')))
  if sorted(numbers)!=list(range(1,expect+1)):
   raise ValueError('Wrong footnote count/numbering '+book+': '+str(len(numbers)))
 print('Verified 13 books /',sum(BOOKS.values()),'correctly anchored footnotes')
def merge_cited(old,new):
 out={}
 for ref in set(old)|set(new):
  o=old.get(ref,[]);n=new.get(ref,[])
  if not isinstance(o,list) or not isinstance(n,list):
   raise ValueError('Invalid cited index for '+ref)
  selected=[x for x in n if target_ref(x)]
  if not selected:selected=[x for x in o if target_ref(x)]
  out[ref]=list(dict.fromkeys([x for x in o if not target_ref(x)]+selected))
 return out
def install(data):
 before={b:hashdir(BASE/b) for b in EXCLUDED}
 with tempfile.TemporaryDirectory(dir=BASE.parent,prefix='akiva-stage-') as td:
  stage=Path(td)/'data';stage.mkdir()
  for name,body in data.items():
   rel=name.removeprefix('data/')
   if rel.startswith('cited/') or rel in ('catalog.json','files.json'):continue
   p=stage/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
  cited=stage/'cited';cited.mkdir()
  active=BASE/'cited'
  files=set(p.name for p in active.glob('*.json')) if active.exists() else set()
  files.update(Path(x).name for x in data if x.startswith('data/cited/'))
  for fname in files:
   old=json.loads((active/fname).read_text()) if (active/fname).exists() else None
   new=json.loads(data['data/cited/'+fname]) if 'data/cited/'+fname in data else None
   if fname=='index.json':merged=sorted(set(old or [])|set(new or []))
   elif fname=='search.json':merged={'search':sorted(set((old or {}).get('search',[]))|set((new or {}).get('search',[])))}
   else:merged=merge_cited(old or {},new or {})
   (cited/fname).write_text(json.dumps(merged,ensure_ascii=False,separators=(',',':'))+'\n')
  catfile=BASE/'catalog.json'
  byslug={e['slug']:e for e in json.loads(catfile.read_text())} if catfile.exists() else {}
  for e in json.loads(data['data/catalog.json']):
   if e['slug'] in BOOKS:byslug[e['slug']]={**byslug.get(e['slug'],{}),**e}
  (stage/'catalog.json').write_text(json.dumps(list(byslug.values()),ensure_ascii=False,separators=(',',':'))+'\n')
  BASE.mkdir(parents=True,exist_ok=True)
  for book in BOOKS:
   existing=BASE/book;backup=Path(td)/('backup-'+book)
   if existing.exists():os.replace(existing,backup)
   try:os.replace(stage/book,existing)
   except:
    if backup.exists():os.replace(backup,existing)
    raise
  old=BASE/'cited';old_backup=Path(td)/'backup-cited'
  if old.exists():os.replace(old,old_backup)
  os.replace(cited,old)
  os.replace(stage/'catalog.json',BASE/'catalog.json')
  info=BASE/'files.json'
  files_obj=json.loads(info.read_text()) if info.exists() else {'version':1}
  files_obj['files']=sorted(p.relative_to(BASE).as_posix() for p in BASE.rglob('*.json') if p!=info)
  files_obj['bytes']=sum((BASE/p).stat().st_size for p in files_obj['files'])
  info.write_text(json.dumps(files_obj,ensure_ascii=False,separators=(',',':'))+'\n')
  if before!={b:hashdir(BASE/b) for b in EXCLUDED}:
   raise RuntimeError('Excluded volumes were modified')
 # Invalidate existing offline reader shell caches after a data release.
 sw=BASE.parent/'sw.js'
 if sw.exists():
  code=sw.read_text()
  tag='v60-akiva-expanded-13-'+sha(MANIFEST.read_bytes())[:12]
  upgraded=re.sub(r"const VERSION = '[^']+';", "const VERSION = '"+tag+"';",code,count=1)
  if upgraded==code:raise ValueError('Service worker version marker missing')
  sw.write_text(upgraded)
 print('PASS 13-volume reader install: all 20,570 footnotes; four excluded volumes untouched')
def main():
 data=load()
 if data is None:return
 verify(data);install(data)
if __name__=='__main__':main()

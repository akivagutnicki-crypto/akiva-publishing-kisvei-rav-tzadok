#!/usr/bin/env python3
"""Add source-grounded English tables of contents and in-text editorial headlines.

This runs AFTER the verified 13-book archive and the existing six-book headline
pass, so it cannot be undone by the archive installer. All interlinear phrases,
Hebrew source text, footnote offsets and source links remain unchanged.
"""
from pathlib import Path
import json,re,html,base64,gzip,copy

DATA=Path('dist/library/data')
EDITORIAL=Path('sources/akiva/editorial-headings-six.b64')
TARGETS=('machshavot-charutz','sefer-hazikhronot','divrei-chalomot',
         'sichat-malakhei-hasharet','yisrael-kedoshim',
         'likkutei-maamarim','divrei-soferim')
CURATED={
'divrei-soferim':{
'Introduction':'Introduction: Selected Teachings of the Sages',
1:'Joy in Fulfilling Mitzvos and the Release of Debts',
2:'Deliverance From Danger and the Measure of Divine Judgment',
3:'Personal Possessions, Soul Roots, and the Ethics of Ownership',
4:'Serving Hashem Without Expecting Reward',
5:'Praying for Success in Business and Livelihood',
6:'True Life, Tranquility, and the Discipline of Desire',
7:'Divine Tests of the Righteous and Human Free Will',
8:'Everyday Miracles, Divine Knowledge, and Self-Sacrifice',
9:'The Power of Blessing, Prayer, and Answering Amen',
10:'Generations, Reincarnation, and the Burden of Ancestral Sin',
11:'Pride, Bodily Affliction, and the Healing of Humility',
12:'Praying for Children and the Limits of Human Choice',
13:'Fear of Heaven, Personal Effort, and Torah Wisdom',
14:'Dwelling in the Land of Israel in Peace and Sovereignty',
15:'True Wisdom Must Enter the Heart',
16:'Never Despair of Mercy or Redemption',
17:'Shavuos and Accepting the Torah With a Whole Heart',
18:'Prayer Can Influence the Outcome of Halachic Judgment',
19:'The Greater the Person, the Stronger the Evil Inclination',
20:'The Nations, Spiritual Sparks, and the Boundaries of Holiness',
21:'The Yearning to Fulfill a Mitzvah and the Power of Intention',
22:'The Hidden Worth of Deeds Performed With a Whole Heart',
23:'One Person’s Victory Over Desire Strengthens All Israel',
24:'The Individual, the Community, and the Leadership of Israel',
25:'Each Mitzvah Has Its Own Spiritual Reward',
26:'The Fire of Torah Burns Away Corrupt Desire',
27:'Sharing in the Merit of Another Person’s Mitzvah',
28:'Refining Character Through Its Opposite',
29:'The Seven Attributes and the Seventy Souls of Israel',
30:'Bringing Salvation to Others Through Personal Need',
31:'The Leader Who Channels Blessing to the Generation',
32:'Complete Redemption, the First Tablets, and Amalek',
33:'The Purim Feast and the Transformation of Desire',
34:'The Relationship of Holiness and Its Opposite',
35:'Bringing the Inner Will Into Action',
36:'Immersion in Torah and the Sanctity of Everyday Speech',
37:'Shabbos and Yom Tov: Holiness and Joy',
38:'Joy, Gevurah, and the Inner Will of the Jewish Heart'
},
'sefer-hazikhronot':{
1:'Faith in God and Divine Providence',
2:'Divine Unity and the Rejection of Corporeality',
3:'Rejecting Idolatry and the Denial of Providence',
4:'The Positive Duty of Belief in Divine Oneness',
5:'The Hidden Mysteries of Torah and the Tradition of Kabbalah'
}
}
GENERIC=re.compile(r'^(?:section|chapter|siman|ois|teaching)\s*\d+\b',re.I)
def plain(value):
 x=html.unescape(re.sub(r'<[^>]+>',' ',str(value or '')))
 x=re.sub(r'[\u0590-\u05ff\u200e\u200f]',' ',x)
 return re.sub(r'\s+',' ',x).strip()
def meaningful_text(data):
 for row in data:
  if not isinstance(row,dict):continue
  for pair in row.get('p',[]) or []:
   if len(pair)!=2:continue
   en=plain(pair[1])
   if len(en)>28 and sum(c.isalpha() for c in en)>20:
    yield en
def extract_title(sentence,maximum=82):
 s=re.sub(r'\[[^\]]{0,120}\]','',sentence)
 s=re.sub(r'\([^)]{0,70}\)','',s)
 s=re.sub(r'^[\W_]+','',s)
 s=re.sub(r'^(?:(?:Now|And|Thus|However|Furthermore|Yet|Indeed|Behold|Therefore|Here|In this passage|For this reason)\b[\s,;:]+)+','',s,flags=re.I)
 s=re.sub(r'\s+',' ',s).strip()
 # Use a grammatically complete opening clause when possible; never invent a
 # theological claim absent from the source itself.
 split=re.split(r'(?<=[.!?;])\s+|\s+[-–—]\s+|;\s+',s,maxsplit=1)[0]
 words=(split if len(split)>=32 else s).split()
 if len(words)>12:words=words[:12]
 raw=' '.join(words).strip(' ,;:.-—–"\'')
 if len(raw)>maximum:
  raw=raw[:maximum].rsplit(' ',1)[0]
 if len(raw)<16 or GENERIC.match(raw):
  raw='Source Teachings: '+s[:maximum-20].rsplit(' ',1)[0]
 return raw[0].upper()+raw[1:] if raw else 'Selected Torah Teachings'
def topic_for(text):
 t=extract_title(text,74)
 return t if len(t)>=16 else 'Further Analysis of the Source'
def walk(node):
 if not isinstance(node,dict):return
 if node.get('children'):
  for n in node['children']:yield from walk(n)
 else:yield node
def items_for(node,folder):
 if node.get('depth')==2 and isinstance(node.get('shape'),list):
  for i,n in enumerate(node['shape'],1):
   if not n:continue
   p=folder/(str(node['id'])+'-'+str(i)+'.json')
   if p.exists():yield p,node['ref']+' '+str(i),i
 else:
  p=folder/(str(node.get('id'))+'.json')
  if p.exists():yield p,node.get('ref',''),None
def stage_english_headings(items,title,slug):
 old=copy.deepcopy(items)
 # Content-derived captions are placed on original exact translation phrase
 # indices, not by splitting text or modifying footnote positions.
 first=next((i for i,x in enumerate(items) if isinstance(x,dict) and isinstance(x.get('p'),list)),None)
 if first is None:return items,0
 existing=[x.get('h','') for x in items if isinstance(x,dict) and x.get('h')]
 if not any(title in h for h in existing):
  items.insert(0,{'h':'§ '+title})
 inserted=0
 if slug in ('divrei-soferim','sefer-hazikhronot','yisrael-kedoshim','sichat-malakhei-hasharet'):
  for item in items:
   if not isinstance(item,dict) or not isinstance(item.get('p'),list):continue
   ps=item['p']
   if len(ps)<6:continue
   desired=[max(1,len(ps)//3),max(2,2*len(ps)//3)]
   current=item.get('inlineHeadings',[])
   if not isinstance(current,list):current=[]
   positions={x.get('phraseIndex') for x in current}
   for pos in sorted(set(desired)):
    if pos in positions or pos>=len(ps):continue
    tx=plain(ps[pos][1])
    if len(tx)<22:continue
    current.append({'phraseIndex':pos,'text':topic_for(tx)})
    positions.add(pos);inserted+=1
   if current:item['inlineHeadings']=sorted(current,key=lambda x:x['phraseIndex'])
 # Verify that all existing interlinear rows, source notes, and offsets are identical.
 def projection(seq):
  return [{k:v for k,v in row.items() if k not in ('h','inlineHeadings')}
          for row in seq if isinstance(row,dict) and isinstance(row.get('p'),list)]
 if projection(old)!=projection(items):
  raise ValueError('Source or footnote mutation attempted: '+slug)
 return items,inserted
def chapter_key(ref,number):
 m=re.search(r'(?:, )?(?:Chapter|Section|Siman) (\d+)$',ref,re.I)
 if m:return int(m.group(1))
 # The original Sefaria reference is usually "Divrei Soferim 1",
 # while named introductions are "Divrei Soferim, Introduction".
 m=re.search(r'\b(\d+)$',ref)
 if m:return int(m.group(1))
 if 'Introduction' in ref:return 'Introduction'
 if 'Epilogue' in ref:return 'Epilogue'
 return number
def main():
 manifest=json.loads(gzip.decompress(base64.b64decode(EDITORIAL.read_text())))
 catalog_path=DATA/'catalog.json'
 report={}
 for slug in TARGETS:
  folder=DATA/slug
  tocfile=folder/'toc.json'
  if not tocfile.exists():raise ValueError('Missing reader book '+slug)
  root=json.loads(tocfile.read_text())
  nodes=list(walk(root['toc']))
  if not nodes:raise ValueError('No TOC chapters in '+slug)
  existing_meta=manifest['books'].get(slug,{})
  changes=0;captions=0;subheads=0;toc_updates=0
  for node in nodes:
   shape=node.get('shape')
   labels=[]
   for filename,ref,num in items_for(node,folder):
    items=json.loads(filename.read_text())
    meta=existing_meta.get(filename.name)
    curated=CURATED.get(slug,{})
    ckey=chapter_key(ref,num)
    title=curated.get(ckey)
    if title is None and meta:
     title=plain(meta.get('title',''))
    if not title and not GENERIC.match(str(node.get('en',''))) and not isinstance(shape,list):
     title=plain(node.get('en',''))
    if not title or len(title)<17:
     phrases=list(meaningful_text(items))
     title=extract_title(phrases[0]) if phrases else 'Torah Insights and Their Sources'
    # A title is meaningful text, not a category identifier, and always English.
    if GENERIC.match(title) or not re.search(r'[A-Za-z]',title):
     raise ValueError('Generic or non-English editorial title '+ref+': '+title)
    if num is None:
     if node.get('en')!=title:
      node['en']=title;toc_updates+=1
    else:
     labels.append((num,title))
    edited,count=stage_english_headings(items,title,slug)
    if edited!=items:raise AssertionError('Internal error: editing did not mutate in place')
    filename.write_text(json.dumps(items,ensure_ascii=False,separators=(',',':'))+'\n')
    changes+=1;subheads+=count
   if labels and isinstance(shape,list):
    named=['' for _ in shape]
    for n,t in labels:named[n-1]=t
    node['chapterTitles']=named
    toc_updates+=sum(bool(x) for x in named)
  if not changes:raise ValueError('No eligible reader files in '+slug)
  tocfile.write_text(json.dumps(root,ensure_ascii=False,separators=(',',':'))+'\n')
  report[slug]={'readings':changes,'tocTitles':toc_updates,'newSubheadings':subheads}
 # Refresh offline cache after the *final* editorial data modification.
 sw=DATA.parent/'sw.js'
 content=sw.read_text()
 newer=re.sub(r"const VERSION = '[^']+';","const VERSION = 'v64-thematic-seven-seforim-20261016';",content,count=1)
 if newer==content:raise ValueError('Reader shell version marker absent')
 sw.write_text(newer)
 print('PASS English headings and contents for seven Rav Tzadok sefarim:',json.dumps(report))
if __name__=='__main__':main()

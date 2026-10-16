#!/usr/bin/env python3
"""Install carefully source-grounded editorial headings into six interlinear works.
Use AFTER all expansion archives and cross-book footnote import steps. No source,
footnote, Sefaria citation, or original inline translation is changed.
"""
from pathlib import Path
import json,base64,gzip,re,hashlib,html
ROOT=Path('dist/library/data')
MANIFEST=Path('sources/akiva/editorial-headings-six.b64')
WORKS={'poked-akarim':6,'machshavot-charutz':21,'likkutei-maamarim':19,'divrei-chalomot':28,'kometz-haminchah':194,'et-haochel':16}
EXCLUDED={'takanat-hashavin','resisei-layla','dover-tzedek'}
# Additional source-anchored subheadings for every Eis HaOchel ois. These are
# editorial labels only; never alter or resegment the Hebrew/English pairs.
ET_INLINE={"0.json":[{"phraseIndex":2,"text":"Netilas Yadayim and Sanctity Before Eating"},{"phraseIndex":8,"text":"Mayim Acharonim and Purity After the Meal"}],"1.json":[{"phraseIndex":2,"text":"A Full Stomach and the Awakening of Desire"},{"phraseIndex":8,"text":"Nazirus as a Fence Against Joined Appetites"}],"2.json":[{"phraseIndex":2,"text":"Why the Lighter Struggle Comes First"},{"phraseIndex":6,"text":"The Shunammite Woman and Elisha’s Holiness"}],"3.json":[{"phraseIndex":2,"text":"Preparing to Receive Torah by Purifying Desire"},{"phraseIndex":5,"text":"Torah as the Essential Cure for the Heart"}],"4.json":[{"phraseIndex":2,"text":"Preparation and Restraint Before Eating"},{"phraseIndex":7,"text":"Eating Quickly Without Becoming Attached to Pleasure"}],"5.json":[{"phraseIndex":2,"text":"Recognizing Hashem as the Source of Food"},{"phraseIndex":5,"text":"Indulgence as an Offering to the Animal Soul"}],"6.json":[{"phraseIndex":2,"text":"Emunah, Zeraim, and the Blessing Before Food"},{"phraseIndex":7,"text":"The Fire of Torah Elevates the Vitality of Food"}],"7.json":[{"phraseIndex":2,"text":"Eating and Prayer as Forms of Sacrificial Service"},{"phraseIndex":10,"text":"Turning Ordinary Pleasure Into a Mitzvah"}],"8.json":[{"phraseIndex":2,"text":"The Three Names for Food and Their Purpose"},{"phraseIndex":13,"text":"The Righteous Person Eats to Satisfy the Soul"},{"phraseIndex":19,"text":"Arousal From Below and the Heavenly Response"}],"9.json":[{"phraseIndex":2,"text":"Every Mitzvah Adds Holiness to Eating"},{"phraseIndex":20,"text":"Pesach, Matzah, and Maror Rectify Eating"},{"phraseIndex":28,"text":"Yosef and the Root of Egyptian Redemption"}],"10.json":[{"phraseIndex":2,"text":"The Earth Is Hashem’s: Pleasure Without Attachment"},{"phraseIndex":14,"text":"Manna and the Torah of Those Who Eat It"},{"phraseIndex":20,"text":"Heavenly Sustenance Hidden in Earthly Food"}],"11.json":[{"phraseIndex":2,"text":"Divine Vitality, Food, and Bodily Health"},{"phraseIndex":9,"text":"The Residual Venom of the Serpent"},{"phraseIndex":13,"text":"Torah as the Antidote to Desire"}],"12.json":[{"phraseIndex":2,"text":"The Seven Species and Their Inner Attributes"},{"phraseIndex":14,"text":"Yesod and Malchus in the Fruits of the Land"},{"phraseIndex":20,"text":"Oil, Chochmah, and the Sweetening of Yesod"}],"13.json":[{"phraseIndex":2,"text":"The Exodus as the Birth of Israel"},{"phraseIndex":18,"text":"From Poverty to an Expansive Divine Answer"},{"phraseIndex":25,"text":"Lechem Oni and the Power of Prayer"}],"14.json":[{"phraseIndex":2,"text":"Bitterness Awakens the Thirst for Divine Life"},{"phraseIndex":14,"text":"Four Distinct Stages of Redemption"},{"phraseIndex":21,"text":"The Fifth Cup and the Promise of the Land"}],"15.json":[{"phraseIndex":2,"text":"Karpas Awakens the Child’s Questions"},{"phraseIndex":13,"text":"Spiritual Wealth and Inner Awareness"},{"phraseIndex":19,"text":"Holiness Before the Separation of Evil"}]}


def digest_dir(book):
 d=ROOT/book
 if not d.exists():return 'absent'
 h=hashlib.sha256()
 for p in sorted(d.glob('*.json')):
  h.update(p.name.encode());h.update(p.read_bytes())
 return h.hexdigest()

def source_projection(items):
 # Ensure no changes whatsoever to any existing Hebrew, translation,
 # footnote, cross-reference, or study segment metadata.
 return [{k:v for k,v in x.items() if k not in ('h','inlineHeadings')}
         for x in items if isinstance(x,dict) and x.get('p') is not None]

def main():
 data=json.loads(gzip.decompress(base64.b64decode(MANIFEST.read_text())).decode())
 books=data['books']
 if {k:len(v) for k,v in books.items()}!=WORKS:
  raise ValueError('Unexpected editorial heading coverage')
 old={b:digest_dir(b) for b in EXCLUDED}
 report={}
 et_source=json.loads(Path('sources/akiva/Et_HaOchel.json').read_text())
 et_titles={str(sec['n']-1)+'.json':sec['en'] for sec in et_source['sections']}
 if len(et_titles)!=16:raise ValueError('Wrong Et HaOchel title count')
 for slug,sections in books.items():
  loc=ROOT/slug
  if not loc.is_dir():raise ValueError('Missing reader text directory '+str(loc))
  available={p.name for p in loc.glob('*.json')}-{'links.json','toc.json'}
  if set(sections)!=available:
   raise ValueError(f'Unexpected section files for {slug}: missing {set(sections)-available}, extras {available-set(sections)}')
  stats={'sections':0,'headlines':0,'subheadings':0,'footnotes':0}
  for filename,meta in sections.items():
   p=loc/filename
   original=json.loads(p.read_text());expected=len([x for x in original if isinstance(x,dict) and isinstance(x.get('p'),list)])
   nonhead=[x for x in original if isinstance(x,dict) and isinstance(x.get('p'),list)]
   if len(meta['items'])!=expected:raise ValueError('Mismatched section layout '+str(p))
   frozen=json.dumps(source_projection(original),ensure_ascii=False,sort_keys=True)
   before_notes=sum(len(i.get('footnotes',[])) for i in nonhead)
   updated=[];n=0
   for i,item in enumerate(original):
    if not isinstance(item,dict) or not isinstance(item.get('p'),list):
     updated.append(item);continue
    if n==0:
     # Add a top-level editorial section heading once, ahead of any source text.
     # It does not count as a study segment or move a footnote marker.
     major='§ '+meta['title']+'\n'+meta.get('summary','')
     # Place at the very top, not after title-page or prior h markers.
    part=meta['items'].get(str(i))
    if part is None:raise ValueError('Missing item mapping '+str(p)+':'+str(i))
    if part.get('heading') and not any(x.get('h')==part['heading'] for x in updated[-2:] if isinstance(x,dict)):
     updated.append({'h':part['heading']});stats['subheadings']+=1
    inline=part.get('inline',[])
    originline=item.get('inlineHeadings',[])
    if not isinstance(originline,list):raise ValueError('Invalid original inline heading')
    seen={(x['phraseIndex'],x['text']) for x in originline}
    newinline=list(originline)
    for h in inline:
     if not isinstance(h.get('phraseIndex'),int) or not 0<h['phraseIndex']<len(item['p']):
      raise ValueError('Invalid phrase heading position in '+str(p))
     if (h['phraseIndex'],h['text']) not in seen:
      newinline.append(h);seen.add((h['phraseIndex'],h['text']));stats['subheadings']+=1
    if slug=='et-haochel':
     for hd in ET_INLINE[filename]:
      idx=hd['phraseIndex']
      if idx>=len(item['p']):raise ValueError('Subheading outside Et HaOchel '+filename)
      if not any(x['phraseIndex']==idx for x in newinline):
       newinline.append(hd);stats['subheadings']+=1
    if newinline:item={**item,'inlineHeadings':sorted(newinline,key=lambda x:x['phraseIndex'])}
    updated.append(item);n+=1
   # Keep existing title-page headings intact. The new introduction comes
   # before the first source item, rather than replacing any original heading.
   first=next((j for j,x in enumerate(updated) if isinstance(x,dict) and isinstance(x.get('p'),list)),None)
   if first is None:raise ValueError('No interlinear segment '+str(p))
   display_title=et_titles[filename] if slug=='et-haochel' else meta['title']
   updated.insert(0,{'h':'§ '+display_title+'\n'+meta.get('summary','')})
   stats['headlines']+=1;stats['sections']+=1
   if frozen!=json.dumps(source_projection(updated),ensure_ascii=False,sort_keys=True):
    raise ValueError('Existing interlinear text was altered '+str(p))
   if sum(len(i.get('footnotes',[])) for i in updated if isinstance(i,dict) and isinstance(i.get('p'),list))!=before_notes:
    raise ValueError('Existing source footnotes were altered '+str(p))
   stats['footnotes']+=before_notes
   p.write_text(json.dumps(updated,ensure_ascii=False,separators=(',',':'))+'\n')
  if slug=='et-haochel':
   toc_path=loc/'toc.json'
   toc=json.loads(toc_path.read_text())
   leaves=toc['toc'].get('children',[])
   if len(leaves)!=16:raise ValueError('Unexpected Et HaOchel TOC chapter count')
   for leaf in leaves:
    label=et_titles.get(str(leaf.get('id'))+'.json')
    if not label:raise ValueError('No Et HaOchel editorial title for TOC leaf '+str(leaf))
    leaf['en']=label
   toc_path.write_text(json.dumps(toc,ensure_ascii=False,separators=(',',':'))+'\n')
  report[slug]=stats
 if old!={b:digest_dir(b) for b in EXCLUDED}:raise ValueError('Other excluded seforim changed')
 # The original source data is immutable; refresh offline shell after new headings.
 sw=ROOT.parent/'sw.js'
 if sw.is_file():
  code=sw.read_text()
  code2=re.sub(r"const VERSION = '[^']+';","const VERSION = 'v62-six-editorial-headings-20261015';",code,count=1)
  if code2==code:raise ValueError('Reader cache version failed to update')
  sw.write_text(code2)
 print('PASS six interlinear seforim: '+json.dumps(report,ensure_ascii=False))
 print('PASS exclusions and every existing interlinear phrase and source footnote unchanged')
if __name__=='__main__':main()
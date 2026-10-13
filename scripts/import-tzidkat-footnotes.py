"""Publish the reviewed English apparatus at its exact Hebrew phrase boundaries.

Usage: python scripts/import-tzidkat-footnotes.py /absolute/path/reviewed.csv
The source text and both phrase columns are preserved byte for byte as strings.
"""
import csv,hashlib,html,json,re,sys
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path

csv.field_size_limit(20000000)
csv_path=Path(sys.argv[1]);book_path=Path('sources/akiva/Tzidkat_HaTzadik.json')
with csv_path.open(encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
assert len(rows)==269 and len({r['id'] for r in rows})==269
book=json.loads(book_path.read_text());sections={s['n']:s for s in book['sections']}
bare=lambda s:html.unescape(re.sub('<[^>]*>','',s))
utf16=lambda s:len(s.encode('utf-16-le'))//2

class FirstParagraph(HTMLParser):
 def __init__(self):super().__init__();self.active=False;self.finished=False;self.attrs=[];self.runs=[]
 def handle_starttag(self,tag,attrs):
  if tag=='p' and not self.finished:self.active=True
  if self.active and tag in ['a','strong','b','em','i']:self.attrs.append((tag,dict(attrs)))
 def handle_endtag(self,tag):
  if tag=='p' and self.active:self.active=False;self.finished=True
  elif self.active and self.attrs and self.attrs[-1][0]==tag:self.attrs.pop()
 def handle_data(self,s):
  if not self.active:return
  run={'text':s}
  for t,a in self.attrs:
   if t=='a':run.update(href=a['href'],bold=True)
   if t in ['strong','b']:run['bold']=True
   if t in ['em','i']:run['italic']=True
  self.runs.append(run)

placements=[]
for row in rows:
 for p in json.loads(row['all_placements_json']):
  siman=int(p['reader_reference'].rsplit(' ',1)[1])
  item=next(i for i in sections[siman]['items'] if i.get('n')==p['reader_item_number'])
  pair=item['p'][p['reader_pair_index_0_based']]
  for column,lang in [(0,'hebrew'),(1,'english')]:
   text=bare(pair[column]);off=p[f'reader_{lang}_char_offset_0_based'];prefix=p[f'reader_{lang}_insertion_prefix']
   assert text==p[f'reader_{lang}_phrase'],(row['id'],'phrase changed',lang)
   assert text[:off]==prefix,(row['id'],'insertion boundary changed',lang)
  placements.append((siman,item,p,row))
assert len(placements)==279
placements.sort(key=lambda x:(x[0],x[1]['n'],x[2]['reader_pair_index_0_based'],x[2]['reader_hebrew_char_offset_0_based'],int(x[3]['original_source_order'])))
numbering=defaultdict(dict)
for siman,item,p,row in placements:
 if row['id'] not in numbering[siman]:numbering[siman][row['id']]=len(numbering[siman])+1
targets={}
for siman,item,p,row in placements:
 targets.setdefault(row['id'],{'ref':f'Tzidkat HaTzadik {siman}:{item["n"]}','number':numbering[siman][row['id']],'placementId':row['id']+'-'+str(p['occurrence'])})
additional_cross_refs={'TZ-0026':'TZ-0018','TZ-0120':'TZ-0112','TZ-0125':'TZ-0256','TZ-0190':'TZ-0187','TZ-0238':'TZ-0241'}
for sec in book['sections']:
 for item in sec['items']:
  if 'footnotes' in item:
   assert all(n.get('sourceId','').startswith('TZ-') for n in item['footnotes']),'Existing unrelated footnotes must be preserved'
   item.pop('footnotes')
before=json.dumps(book['sections'],ensure_ascii=False,separators=(',',':'))
pending=set()
for siman,item,p,row in placements:
 parser=FirstParagraph();parser.feed(row['english_footnote_html_with_links'])
 assert ''.join(run['text'] for run in parser.runs)==row['english_footnote_full'],row['id']
 sources=json.loads(row['verified_sources_json'])
 body={'text':row['english_footnote_full'],'rich':parser.runs}
 runs=[{'text':'Sources: ','bold':True}]
 for i,source in enumerate(sources):
  if i:runs.append({'text':'; '})
  runs.append({'text':source['reference'],'bold':True,'href':source['url']})
  if source['role']=='verified parallel':runs.append({'text':' (verified parallel)'})
 runs.append({'text':'.'})
 source_paragraph={'text':''.join(r['text'] for r in runs),'rich':runs}
 hp=p['reader_hebrew_insertion_prefix'];ep=p['reader_english_insertion_prefix']
 note={'number':numbering[siman][row['id']],'sourceId':row['id'],'placementId':row['id']+'-'+str(p['occurrence']),
  'phraseIndex':p['reader_pair_index_0_based'],'heCharOffset':utf16(hp),'enCharOffset':utf16(ep),
  'heAnchorPrefix':hp,'enAnchorPrefix':ep,'heWord':len(hp.split()),'paragraphs':[body,source_paragraph],
  'sources':[{'ref':s['reference'],'url':s['url'],'connectionsUrl':s['connections_url'],'role':s['role']} for s in sources],
  'nativeConnections':[{'ref':c['connected_reference'],'url':c['url'],'sourceRef':c['source_reference'],'category':c['category']} for c in json.loads(row['sefaria_connections_json'])],
  'verificationStatus':row['source_verification_status'],'verificationNote':row['source_verification_notes'],
  'provenance':{'edition':row['edition'],'pdfPage':int(p['source_pdf_page']),'printedNumber':int(p['printed_footnote_number']),'reviewed':'2026-10-13'}}
 if row['id']=='TZ-0251':
  # The printed "224" points to no corresponding quotation. The reviewed
  # location of printed note 9, quoting Megillah 12a, is siman 228.
  note['printedCrossReference']=row['english_footnote_full']
  corrected='See the note quoting Megillah 12a in section 228.'
  note['paragraphs'][0]={'text':corrected,'rich':[{'text':corrected}]}
  note['verificationNote']+=' The supplied cross-reference says section 224; printed note 9 quoting Megillah 12a is actually anchored in section 228. The reader reference has been corrected; the printed wording is retained in the source record.'
 if row['reader_text_discrepancy']:note['bodySourceNote']=row['reader_text_discrepancy']
 editions=json.loads(row['external_edition_verification_json'])
 if editions:note['editionLinks']=[{'label':s['reference'],'url':s['url'],'verification':s['verification']} for s in editions]
 if 'requires collation' in row['source_verification_status']:pending.add(row['id'])
 cross_id=row['internal_cross_reference_note_id'] or additional_cross_refs.get(row['id'])
 if cross_id:note['crossReference']=targets[cross_id]
 item.setdefault('footnotes',[]).append(note)
# The insertion must never rewrite either language or any section structure.
comparison=json.loads(json.dumps(book['sections']))
for sec in comparison:
 for item in sec['items']:item.pop('footnotes',None)
assert json.dumps(comparison,ensure_ascii=False,separators=(',',':'))==before
assert len(pending)==6
book['footnoteImportInfo']={'edition':'Har Bracha / supplied 192-page source','notes':269,'placements':279,
 'sectionsWithNotes':len(numbering),'sourceLinks':433,'exactEditionChecksPending':sorted(pending),
 'reviewedCsvSha256':hashlib.sha256(csv_path.read_bytes()).hexdigest(),'reviewed':'2026-10-13',
 'anchorConvention':'Exact UTF-16 offset in rendered, HTML-decoded phrase text; original pointed Hebrew preserved.',
 'numbering':'Restart per siman; repeated markers for the same source note share its section number.'}
book_path.write_text(json.dumps(book,ensure_ascii=False,indent=2)+'\n')
print('Imported 269 complete English notes at 279 verified Hebrew boundaries in',len(numbering),'simanim; 6 edition checks explicitly flagged.')

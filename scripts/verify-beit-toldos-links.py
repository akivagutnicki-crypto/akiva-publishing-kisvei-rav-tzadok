"""Resolve citation anchors against the live Sefaria text API before linking."""
import base64,gzip,json,re,time
from pathlib import Path
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor,as_completed
from urllib.request import Request,urlopen
from urllib.parse import quote

class Anchors(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=True);self.text='';self.anchors=[];self.active=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='a' and a.get('data-ref'):self.active={'ref':a['data-ref'],'start':len(self.text)}
    def handle_endtag(self,tag):
        if tag=='a' and self.active:
            self.active['end']=len(self.text);self.anchors.append(self.active);self.active=None
    def handle_data(self,text):self.text+=text

def sefaria_url(ref):
    match=re.match(r'^(.*?) (\d[\dab:.\-–]*)$',ref)
    path=(match[1].replace(' ','_')+'.'+match[2].replace(':','.')) if match else ref.replace(' ','_')
    return 'https://www.sefaria.org/'+quote(path,safe='_,.:-')

def verify(ref):
    api='https://www.sefaria.org/api/v3/texts/'+quote(ref,safe='')
    for attempt in range(3):
        try:
            with urlopen(Request(api,headers={'User-Agent':'AkivaPublishing source verification'}),timeout=18) as response:data=json.load(response)
            if data.get('ref') and not data.get('error'):
                return ref,{'ref':data['ref'],'url':sefaria_url(data['ref']),'verified':True,'api':api}
            return ref,{'verified':False,'error':data.get('error','Reference not resolved'),'api':api}
        except Exception as error:
            if attempt==2:return ref,{'verified':False,'error':str(error),'api':api}
            time.sleep(.4)

if __name__=='__main__':
    htmls=json.loads(Path('/workspace/scratch/02679ad5c858/tmp/beit-citation-html.json').read_text())
    texts=json.loads(Path('/workspace/scratch/02679ad5c858/tmp/beit-paragraphs.json').read_text())
    paragraphs=[];refs=set()
    for html,original in zip(htmls,texts):
        parser=Anchors();parser.feed(html);assert parser.text==original
        paragraphs.append(parser.anchors);refs.update(a['ref'] for a in parser.anchors)
    pack=json.loads(gzip.decompress(base64.b64decode(Path('sources/akiva/overlays/beit-yaakov-toldos.json.gz.b64').read_text())))
    refs.update('Beit Yaakov on Torah, Toldot '+str(s['chapter']) for s in pack['sections'])
    print('Verifying',len(refs),'unique references',flush=True)
    output=Path('sources/verified/beit-toldos-links.json')
    previous=json.loads(output.read_text())['references'] if output.exists() else {}
    results={ref:previous[ref] for ref in refs if ref in previous}
    pending=refs-results.keys()
    print('Reusing',len(results),'checks; resolving',len(pending),'new references',flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for job in as_completed([pool.submit(verify,ref) for ref in sorted(pending)]):
            ref,value=job.result();results[ref]=value
            if len(results)%40==0:print('Checked',len(results),'of',len(refs),flush=True)
    report={'method':'Sefaria v3 texts API','references':dict(sorted(results.items())),'paragraphAnchors':paragraphs}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    rejected={k:v for k,v in results.items() if not v['verified']}
    print(json.dumps({'verified':len(results)-len(rejected),'unresolved':rejected},ensure_ascii=False),flush=True)

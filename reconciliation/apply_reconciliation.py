"""Apply the reviewed, preimage-guarded Part 2 reader reconciliation.
This script never deploys or edits a Word manuscript.
"""
from pathlib import Path
from collections import defaultdict
import argparse,copy,difflib,hashlib,json,re

def digest(data): return hashlib.sha256(data).hexdigest()
def dump(obj): return json.dumps(obj,ensure_ascii=False,separators=(',',':')).encode()
def main(root,recipe_path,report_path):
    recipe=json.loads(recipe_path.read_text()); before={}
    for name,expected in recipe['inputSha256'].items():
        p=root/name; before[name]=p.read_bytes()
        assert digest(before[name])==expected, 'Preimage changed: '+name
    sections={s:json.loads(before[f'library/data/takanat-hashavin/{s}.json'])for s in(14,15)}
    notes={n['sourceId']:n for rows in sections.values()for row in rows for n in row.get('footnotes',[])}
    assert len(notes)==766
    oldnotes=copy.deepcopy(notes); ledger=[]
    # Delimiters are restored only inside recorded Hebrew quote spans, never English wrappers.
    insertion_sets=defaultdict(list)
    for op in recipe['quoteDelimiterRepairs']:
        note=notes[op['noteId']]; hits=[]
        for pi,p in enumerate(note['paragraphs']):
            pos=p['text'].find(op['before'])
            if pos>=0:
                assert p['text'].count(op['before'])==1
                hits.append((pi,pos))
        assert len(hits)==1,(op['noteId'],'ambiguous quotation delimiter preimage')
        pi,pos=hits[0]
        for tag,i,j,k,l in difflib.SequenceMatcher(None,op['before'],op['after'],autojunk=False).get_opcodes():
            if tag=='equal':continue
            assert tag=='insert' and set(op['after'][k:l])<=set('[]')
            insertion_sets[(op['noteId'],pi)].append((pos+i,op['after'][k:l]))
        ledger.append(op)
    for (nid,pi),insertions in insertion_sets.items():
        p=notes[nid]['paragraphs'][pi];text=p['text'];rich=p['rich']
        assert ''.join(r['text']for r in rich)==text
        unique=sorted(set(insertions)); assert len(unique)==len(insertions)
        for pos,token in sorted(unique,reverse=True):
            cursor=0;found=False
            for ri,r in enumerate(rich):
                stop=cursor+len(r['text'])
                if cursor<=pos<stop or (ri==len(rich)-1 and pos==stop):
                    r['text']=r['text'][:pos-cursor]+token+r['text'][pos-cursor:];found=True;break
                cursor=stop
            assert found,(nid,pos)
            text=text[:pos]+token+text[pos:]
        p['text']=text;assert ''.join(r['text']for r in rich)==text
    for op in recipe['entityRepairs']:
        n=notes[op['noteId']];assert sum(p['text'].count('&#x 27;')for p in n['paragraphs'])==op['count']
        for p in n['paragraphs']:
            p['text']=p['text'].replace('&#x 27;',"'")
            for r in p.get('rich',[]):r['text']=r['text'].replace('&#x 27;',"'")
        ledger.append({**op,'kind':'decode-malformed-apostrophe-entity','before':'&#x 27;','after':"'",'basis':'Decode a malformed hexadecimal character entity; no words are supplied or removed.'})
    for op in recipe['links']:
        n=notes[op['noteId']]
        if op['kind']=='replace-link':
            hits=0
            for p in n['paragraphs']:
                for r in p.get('rich',[]):
                    if r.get('ref')==op['oldRef']:
                        assert r.get('href')==op['oldUrl'];r['href']=op['newUrl'];r['ref']=op['newRef'];hits+=1
            assert hits==1,(op['noteId'],'expected one visible source label')
            sources=[s for s in n['sources']if s.get('ref')==op['oldRef']];assert len(sources)==1
            assert sources[0].get('url')==op['oldUrl'];sources[0].update(ref=op['newRef'],url=op['newUrl'])
        else:
            assert op['kind']=='link-existing-label';hits=0
            for p in n['paragraphs']:
                rich=[]
                for r in p.get('rich',[]):
                    if op['label'] not in r['text']:rich.append(r);continue
                    assert r['text'].count(op['label'])==1 and not r.get('href')
                    a,b=r['text'].split(op['label'])
                    if a:rich.append({**r,'text':a})
                    rich.append({**r,'text':op['label'],'href':op['newUrl'],'ref':op['newRef']})
                    if b:rich.append({**r,'text':b})
                    hits+=1
                p['rich']=rich
            assert hits==1;assert not any(s.get('ref')==op['newRef']for s in n['sources'])
            n['sources'].append({'ref':op['newRef'],'url':op['newUrl']})
        ledger.append(op)
    for op in recipe['newQuotedTranslations']:
        n=notes[op['noteId']]
        assert op['en']not in '\n'.join(p['text']for p in n['paragraphs'])
        n['paragraphs'].append({'language':'en','text':op['en'],'rich':[{'text':op['en']}]})
        ledger.append(op)
    for nid,n in notes.items():
        for k in ['number','legacyNumber','sourceId','placementId','originRef','phraseIndex','heCharOffset','heAnchorPrefix']:
            assert n[k]==oldnotes[nid][k],(nid,'marker or identity changed',k)
        assert all(''.join(r['text']for r in p['rich'])==p['text']for p in n['paragraphs'])
    html=before['library/index.html'].decode()
    allowed=json.dumps([recipe['previousAllowedPdfUrl']],ensure_ascii=False,separators=(',',':'))
    replacement=json.dumps([recipe['previousAllowedPdfUrl'],recipe['exactPdfUrl']],ensure_ascii=False,separators=(',',':'))
    prefix='/* Exact reviewed Part 2 external source URLs */ '
    assert html.count(prefix+allowed)==1
    html=html.replace(prefix+allowed,prefix+replacement)
    outputs={f'library/data/takanat-hashavin/{s}.json':dump(rows)for s,rows in sections.items()}
    outputs['library/index.html']=html.encode()
    for s in (14,15):
        original=json.loads(before[f'library/data/takanat-hashavin/{s}.json'])
        assert [{k:v for k,v in row.items()if k!='footnotes'}for row in original]==[{k:v for k,v in row.items()if k!='footnotes'}for row in sections[s]],'Author text or headings changed'
    for name,data in outputs.items():(root/name).write_bytes(data)
    modified=[nid for nid,n in notes.items()if n!=oldnotes[nid]]
    report={'ok':True,'release':recipe['release'],'scope':recipe['scope'],'changedNativeNotes':len(modified),'changedNoteIds':modified,'hebrewDelimiterRepairs':len(recipe['quoteDelimiterRepairs']),'hebrewDelimiterNotes':len(set(op['noteId']for op in recipe['quoteDelimiterRepairs'])),'malformedEntitiesDecoded':sum(op['count']for op in recipe['entityRepairs']),'entityRepairNotes':len(recipe['entityRepairs']),'sourceLinkCorrections':len(recipe['links']),'newPrimaryQuotedTranslations':len(recipe['newQuotedTranslations']),'nativeNoteCount':len(notes),'identitiesAndAllHebrewEndpointsUnchanged':True,'allAuthorBodyAndHeadingsUnchanged':True,'richTextComplete':True,'precisePdfAllowlistRepair':recipe['exactPdfUrl'],'files':[{'path':name,'beforeSha256':digest(before[name]),'afterSha256':digest(data),'bytes':len(data)}for name,data in outputs.items()],'changes':ledger,'limitations':recipe['limitations'],'livePublicationChanged':False}
    report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items()if k not in['changes','files','changedNoteIds']},ensure_ascii=False,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--recipe',type=Path,required=True);p.add_argument('--report',type=Path,required=True);args=p.parse_args();main(args.root,args.recipe,args.report)

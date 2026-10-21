"""Add reviewed editorial headings and verified source hyperlinks to the Word copy."""
import base64,copy,gzip,hashlib,json,re,sys
from pathlib import Path
from zipfile import ZipFile
from lxml import etree
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR='http://schemas.openxmlformats.org/package/2006/relationships'
NS={'w':W};tag=lambda x:'{'+W+'}'+x
sha=lambda b:hashlib.sha256(b).hexdigest()
text=lambda p:''.join(p.xpath('.//w:t/text()',namespaces=NS))

def heading(value,level):
    p=etree.Element(tag('p'));pr=etree.SubElement(p,tag('pPr'))
    etree.SubElement(pr,tag('pStyle')).set(tag('val'),'Title' if level==0 else 'Heading'+str(level))
    etree.SubElement(pr,tag('keepNext'))
    etree.SubElement(pr,tag('jc')).set(tag('val'),'left')
    run=etree.SubElement(p,tag('r'));rp=etree.SubElement(run,tag('rPr'))
    etree.SubElement(rp,tag('b'));etree.SubElement(rp,tag('color')).set(tag('val'),'000000')
    etree.SubElement(rp,tag('sz')).set(tag('val'),str({0:32,2:26,4:22}[level]))
    etree.SubElement(run,tag('t')).text=value
    return p

def finish(docx):
    packfile=Path('sources/akiva/overlays/beit-yaakov-toldos.json.gz.b64')
    pack=json.loads(gzip.decompress(base64.b64decode(packfile.read_text())))
    plans=json.loads(Path('sources/akiva/overlays/beit-yaakov-toldos-headings.json').read_text())
    proof=json.loads(Path('sources/verified/beit-toldos-links.json').read_text())
    references=proof['references'];sections={s['chapter']:s for s in pack['sections']}
    for s in sections.values():
        plan=plans[str(s['chapter'])];s['title']=plan['title']
        assert len(plan['subheads'])==len(s['items'])
        for item,title in zip(s['items'],plan['subheads']):
            item['heading']=title
            item['inlineHeadings']=[{'phraseIndex':at,'text':h,'editorial':True} for pn,at,h in plan.get('breaks',[]) if pn==item['n']]
    with ZipFile(docx) as z:
        root=etree.fromstring(z.read('word/document.xml'))
        rel=etree.fromstring(z.read('word/_rels/document.xml.rels'))
        relids={e.get('Target'):e.get('Id') for e in rel if e.get('Type','').endswith('/hyperlink')}
        ids={e.get('Id') for e in rel}
        def rid(url):
            if url not in relids:
                n=len(ids)+1
                while 'rIdBeit'+str(n) in ids:n+=1
                value='rIdBeit'+str(n);ids.add(value);relids[url]=value
                e=etree.SubElement(rel,'{'+PR+'}Relationship');e.set('Id',value);e.set('Type',R+'/hyperlink');e.set('Target',url);e.set('TargetMode','External')
            return relids[url]
        def segment(original,lo,hi,anchors):
            p=etree.Element(tag('p'))
            if original.find('w:pPr',NS) is not None:p.append(copy.deepcopy(original.find('w:pPr',NS)))
            pr=p.find('w:pPr',NS)
            if pr is None:pr=etree.SubElement(p,tag('pPr'))
            widow=pr.find('w:widowControl',NS)
            if widow is None:widow=etree.SubElement(pr,tag('widowControl'))
            widow.set(tag('val'),'1')
            spans=[];pos=0
            for run in original.xpath('.//w:r',namespaces=NS):
                value=''.join(run.xpath('.//w:t/text()',namespaces=NS));end=pos+len(value)
                if value:spans.append((pos,end,value,run.find('w:rPr',NS)))
                pos=end
            cuts=sorted({lo,hi,*[n for a,b,_,_ in spans for n in [a,b] if lo<n<hi],*[n for a in anchors for n in [a['start'],a['end']] if lo<n<hi]})
            for start,end in zip(cuts,cuts[1:]):
                a,b,value,formatting=next(s for s in spans if s[0]<=start<s[1])
                link=next((k for k in anchors if k['start']<=start and end<=k['end']),None)
                parent=p
                if link:
                    parent=etree.SubElement(p,tag('hyperlink'));parent.set('{'+R+'}id',rid(references[link['ref']]['url']))
                run=etree.SubElement(parent,tag('r'))
                if formatting is not None:run.append(copy.deepcopy(formatting))
                if link:
                    rp=run.find('w:rPr',NS)
                    if rp is None:rp=etree.SubElement(run,tag('rPr'))
                    for node in list(rp):
                        if node.tag in [tag('color'),tag('u')]:rp.remove(node)
                    etree.SubElement(rp,tag('color')).set(tag('val'),'0563C1')
                    etree.SubElement(rp,tag('u')).set(tag('val'),'single')
                t=etree.SubElement(run,tag('t'));t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');t.text=value[start-a:end-a]
            assert text(p)==text(original)[lo:hi]
            return p
        current=None;item_index=0;paragraph_index=0;link_count=0;body=[]
        nodes=list(root.xpath('//w:body/w:p',namespaces=NS))
        for paragraph in nodes:
            original=text(paragraph)
            if not original.strip():continue
            stripped=re.sub('[\u0591-\u05c7]','',original).strip()
            match=re.fullmatch(r'תולדות,\s*אות\s+([א-ת׳״]+)',stripped)
            if match:
                values=dict(zip('אבגדהוזחטיכלמנסעפצקרשת',[1,2,3,4,5,6,7,8,9,10,20,30,40,50,60,70,80,90,100,200,300,400]))
                number=sum(values.get(c,0) for c in match[1]);current=sections[number];item_index=0
                pr=paragraph.find('w:pPr',NS)
                if pr is None:pr=etree.SubElement(paragraph,tag('pPr'))
                keep=pr.find('w:keepNext',NS)
                if keep is None:keep=etree.SubElement(pr,tag('keepNext'))
                keep.set(tag('val'),'1')
                paragraph.addnext(heading('Toldos Ois '+str(number)+' '+current['title'],2))
                if current.get('editorialNote'):
                    paragraph.getnext().addnext(heading(current['editorialNote'],4))
                continue
            assert current is not None
            item=current['items'][item_index];item_index+=1
            assert original==item['sourceText'],('Body paragraph changed before linking',current['chapter'],item['n'])
            anchors=[a for a in proof['paragraphAnchors'][paragraph_index] if references[a['ref']]['verified']]
            paragraph_index+=1;link_count+=len(anchors)
            offsets=[];cursor=0
            for he,en in item['p']:
                found=original.find(he,cursor);assert found>=0
                offsets.append(found);cursor=found+len(he)
                found=original.find(en,cursor);assert found>=0,(current['chapter'],item['n'],en)
                cursor=found+len(en)
            cuts=[(0,item['heading'])]+[(offsets[h['phraseIndex']],h['text']) for h in item['inlineHeadings']]
            slices=[]
            for ix,(start,title) in enumerate(cuts):
                end=cuts[ix+1][0] if ix+1<len(cuts) else len(original)
                paragraph.addprevious(heading(title,4));part=segment(paragraph,start,end,anchors);paragraph.addprevious(part);slices.append(text(part))
            assert ''.join(slices)==original;body.append(original)
            paragraph.getparent().remove(paragraph)
        assert paragraph_index==82
        assert sha(''.join(body).encode())==pack['source']['bodyTextSha256']
        root.find('w:body',NS).insert(0,heading('Bais Yaakov on Toldos',0))
        out=docx.with_suffix('.tmp.docx')
        with ZipFile(out,'w') as target:
            for entry in z.infolist():
                content=(etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True) if entry.filename=='word/document.xml' else etree.tostring(rel,xml_declaration=True,encoding='UTF-8',standalone=True) if entry.filename=='word/_rels/document.xml.rels' else z.read(entry.filename))
                target.writestr(entry,content)
    out.replace(docx);content=docx.read_bytes()
    pack['document'].update(sha256=sha(content),base64=base64.b64encode(content).decode())
    pack['source'].update(cleanedSha256=sha(content),editorialHeadlines=52,editorialSubheadings=sum(len(h['subheads'])+len(h.get('breaks',[])) for h in plans.values()),wordCitationAnchors=link_count)
    packfile.write_text(base64.b64encode(gzip.compress(json.dumps(pack,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)).decode()+'\n')
    print(json.dumps({'headlines':52,'subheadings':pack['source']['editorialSubheadings'],'wordHyperlinks':link_count,'packSha256':sha(packfile.read_bytes()),'wordSha256':sha(content)}))

if __name__=='__main__':finish(Path(sys.argv[1]))

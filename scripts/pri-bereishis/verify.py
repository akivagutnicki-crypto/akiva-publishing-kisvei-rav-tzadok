#!/usr/bin/env python3
"""Check every Word text character, native note, hyperlink and Hebrew anchor.

The anchor proof uses the original XML text/marker stream, without the importer's
run-language classification. It locates each original marker in the combined
Hebrew/English reading order, then checks the matching Hebrew phrase and prefix.
"""
import html
import importlib.util
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

spec=importlib.util.spec_from_file_location('bereishis_build',Path(__file__).with_name('build.py'))
B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
rd=B.read_json;W=B.W;NS=B.NS
def tight(s):return re.sub(r'\s','',s)
def plain(s):return html.unescape(re.sub('<[^>]*>','',s))

def verify(site=None, archives=False):
    manifest=rd(B.OUTPUT/'manifest.json');total_notes=0;total_pairs=0;total_heads=0
    assert manifest['footnotes']==5561 and len(manifest['parashas'])==12 and len(manifest['sections'])==150
    for v in manifest['volumes']:
        assert B.digest(B.SOURCE/v['file'])==v['sha256']
        with ZipFile(B.SOURCE/v['file']) as z:
            native=ET.fromstring(z.read('word/document.xml'));note_xml=ET.fromstring(z.read('word/footnotes.xml'))
            ps=list(native.find('w:body',NS));original_notes={n.get(W+'id'):n for n in note_xml if int(n.get(W+'id','0'))>0}
            expected_rel={}
            if 'word/_rels/footnotes.xml.rels' in z.namelist():
                expected_rel={r.get('Id'):r.get('Target') for r in ET.fromstring(z.read('word/_rels/footnotes.xml.rels'))}
            covered=set();seen_notes=set();volume_notes=[]
            for sec in [s for s in manifest['sections'] if s['volume']==v['volume']]:
                local=rd(B.OUTPUT/f"{sec['id']}.json")
                if site:assert rd(Path(site)/f"library/data/peri-tzadik/{sec['id']}.json")==local,'Published chapter differs: '+sec['ref']
                for item in local:
                    i=item['sourceParagraph'];assert i not in covered;covered.add(i)
                    raw=ps[i];source_text=''.join(n.text or '' for n in raw.iter(W+'t'))
                    if 'h' in item:
                        assert item['h']==source_text;total_heads+=1;continue
                    pairs=[[plain(h),plain(e)] for h,e in item['p']]
                    assert all(h.strip() and e.strip() for h,e in pairs),(sec['ref'],i,'Unpaired translation')
                    assert tight(source_text)==tight(''.join(h+e for h,e in pairs)),(sec['ref'],i,'Text changed')
                    total_pairs+=len(pairs)
                    stream_prefix='';marker_positions={}
                    for el in raw.iter():
                        if el.tag==W+'t':stream_prefix+=el.text or ''
                        elif el.tag==W+'footnoteReference':marker_positions[el.get(W+'id')]=len(tight(stream_prefix))
                    assert set(marker_positions)=={n['wordFootnoteId'] for n in item.get('footnotes',[])}
                    for note in item.get('footnotes',[]):
                        fid=note['wordFootnoteId'];assert fid not in seen_notes;seen_notes.add(fid)
                        volume_notes.append(note['number']);total_notes+=1
                        pi=note['phraseIndex'];prefix=note['heAnchorPrefix'];he=pairs[pi][0];at=note['heCharOffset']
                        assert at>0 and he[:at]==prefix and re.search('[א-ת]',prefix),(sec['ref'],fid,'Hebrew anchor')
                        position=marker_positions[fid];walk=0;found=None
                        for k,(h,e) in enumerate(pairs):
                            end_he=walk+len(tight(h));end_pair=end_he+len(tight(e))
                            if position<=end_pair:
                                found=(k,min(len(tight(h)),position-walk));break
                            walk=end_pair
                        assert found==(pi,len(tight(prefix))),(sec['ref'],fid,'Word marker moved',found,pi)
                        original=original_notes[fid]
                        original_text='\n'.join(''.join(t.text or '' for t in p.iter(W+'t')) for p in original.findall('w:p',NS))
                        imported='\n'.join(p['text'] for p in note['paragraphs'])
                        assert tight(original_text)==tight(imported),(sec['ref'],fid,'Note text changed')
                        original_urls=[expected_rel[a.get(B.R+'id')] for a in original.iter(W+'hyperlink') if a.get(B.R+'id') in expected_rel]
                        actual_urls=[r['href'] for p in note['paragraphs'] for r in p['rich'] if r.get('href')]
                        assert list(dict.fromkeys(original_urls))==list(dict.fromkeys(actual_urls)),(sec['ref'],fid,'Source URL changed')
                        for p in note['paragraphs']:assert p['text']==''.join(r['text'] for r in p['rich'])
            assert seen_notes==set(original_notes)
            assert volume_notes==list(range(1,v['footnotes']+1)),'Word reading-order numbering changed'
            relevant={i for i,p in enumerate(ps) if p.tag==W+'p' and ''.join(t.text or '' for t in p.iter(W+'t')).strip()}
            relevant-={i for vol,i in manifest['printBackMatter'] if vol==v['volume']}
            assert covered==relevant,'Source paragraph or heading was omitted'
        if site:assert B.digest(Path(site)/'library/downloads'/v['download'])==v['sha256']
    assert total_heads>=len(manifest['sourceHeadings'])  # headings plus the English-only summary lines
    assert total_notes==5561 and total_pairs==manifest['pairs']
    if site:
        site=Path(site);toc=rd(site/'library/data/peri-tzadik/toc.json')
        def leaves(x):return sum((leaves(c) for c in x['children']),[]) if 'children'in x else [x]
        published=leaves(toc['toc'])
        for sec in manifest['sections']:
            found=[l for l in published if l.get('ref')==sec['ref'] and l.get('interlinear')]
            assert len(found)==1 and found[0]['id']==sec['id'] and found[0]['shape']==sec['paragraphs']
        cat=rd(site/'mcp-data/catalog.json');book=next(b for b in cat['books'] if b['slug']=='peri-tzadik')
        text=rd(site/'mcp-data/text/peri-tzadik.json')
        for sec in manifest['sections']:
            sc=next(s for s in book['sections'] if s['ref']==sec['ref'] and s.get('bereishisDocxEdition'))
            assert not [s for s in book['sections'] if s['ref']==sec['ref'] and s.get('edition')=='interlinear' and not s.get('bereishisDocxEdition')],'Earlier study chapter still listed: '+sec['ref']
            paras=text['paras'][sc['first']:sc['first']+sc['count']]
            assert len(paras)==sec['paragraphs'] and all(p['r'].startswith(sec['ref']+':') for p in paras)
            assert sum(len(p.get('f',[])) for p in paras)==sec['notes']
        if archives:
            data=site/'library/data';files=rd(data/'files.json');index=rd(site/'library/downloads/index.json')
            assert files['version']==index['version']
            entries=[index['library'],next(b for b in index['books'] if b['slug']=='peri-tzadik')]
            for entry in entries:
                file=site/'library'/entry['file'];assert file.stat().st_size==entry['bytes']
                with ZipFile(file) as z:
                    assert z.testzip() is None
                    assert len([n for n in z.namelist() if n.startswith('data/')])==entry['dataFiles']
                    for sec in manifest['sections']:
                        name=f"data/peri-tzadik/{sec['id']}.json"
                        assert z.read(name)==(data/'peri-tzadik'/f"{sec['id']}.json").read_bytes()
                    for v in manifest['volumes']:assert z.read('downloads/'+v['download'])==(B.SOURCE/v['file']).read_bytes()
                    if entry is index['library']:
                        assert all('data/'+n in z.namelist() for n in files['files'])
                        for n in files['files']+['files.json']:assert z.read('data/'+n)==(data/n).read_bytes(),'Library ZIP differs: '+n
    result={'ok':True,'edition':manifest['edition'],'sections':150,'parashas':12,'headings':total_heads,
            'paragraphs':manifest['paragraphs'],'pairs':total_pairs,'footnotes':total_notes,'allWordTextAndAnchorsVerified':True}
    print(json.dumps(result));return result

if __name__=='__main__':verify(next((x for x in sys.argv[1:] if not x.startswith('--')),None),'--archives' in sys.argv)

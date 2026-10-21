"""Verify the reviewed print masters and portable native Word footnotes."""
import hashlib,json
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E

pack=json.loads(Path('sources/akiva/overlays/pri-seasonal-quoted-sources-20261021.json').read_text())
proof=json.loads(Path('editorial/pri-seasonal-print-verification-20261021.json').read_text())
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
w='{'+ns['w']+'}'
for artifact in pack['documents']:
    raw=Path(artifact['sourcePath']).read_bytes()
    assert len(raw)==artifact['bytes']
    assert hashlib.sha256(raw).hexdigest()==artifact['sha256']
    assert artifact['sha256']==proof['finalDocxSha256' if artifact['format']=='docx' else 'finalPdfSha256']
word=next(a for a in pack['documents'] if a['format']=='docx')
with ZipFile(word['sourcePath']) as z:
    doc=E.fromstring(z.read('word/document.xml'))
    part=E.fromstring(z.read('word/footnotes.xml'))
    references=[r.get(w+'id') for r in doc.findall('.//w:footnoteReference',ns)]
    notes=[n for n in part.findall('w:footnote',ns) if int(n.get(w+'id'))>0]
    order=[n.get(w+'id') for n in notes]
    assert order==references==[str(i) for i in range(1,len(notes)+1)],'Footnote sequence must match the Hebrew body references for portable PDF conversion'
    assert len(notes)==proof['footnotesAfter']==pack['printParity']['footnotesAfter']
    by_id={n.get(w+'id'):n for n in notes}
    mapping={o['placementId']:o for o in proof['operations'] if o['action']!='remove'}
    for operation in pack['operations']:
        if not operation.get('after'):continue
        note=by_id[mapping[operation['placementId']]['wordFootnoteId']]
        text=''.join(note.itertext()).strip()
        assert text==operation['after']['paragraphs'][0]['text'],operation['placementId']
    assert all(p.get(w+'w')=='10080' and p.get(w+'h')=='14400' for p in doc.findall('.//w:pgSz',ns))
assert proof['allFontsEmbedded'] and proof['allPrintSourceQuotationsComplete']
assert proof['fullPrintedQuotationsVerified']==pack['counts']['quotations']
assert proof['contentsVerification']['updatedPageNumbers']==0
assert proof['visualReview']['approved'] and proof['visualReview']['pagesReviewed']==proof['pages']
print(json.dumps({'ok':True,'nativeFootnotes':len(notes),'portableFootnoteOrder':True,
    'exactQuotations':pack['counts']['quotations'],'printMasterHashesVerified':True,
    'pages':proof['pages'],'trimSize':'7x10 inches','allFontsEmbedded':True,
    'allContentsDestinationsVerified':True,'completeVisualReviewRecorded':True},indent=2))

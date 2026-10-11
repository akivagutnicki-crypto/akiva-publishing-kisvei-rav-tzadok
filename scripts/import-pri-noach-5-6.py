"""Restore exact Hebrew-English interlinear Noach Ois 5–6 from the Word source.
The original Word source is checked into dist/library/downloads. Use only stdlib,
preserve its pointed Hebrew and all existing scholarly notes/Sefaria links.
"""
import json, re, xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
q=lambda s:'{%s}%s'%(W,s)
DOCX=Path('dist/library/downloads/pri-tzaddik-noach-ois-5-6-chassidus-kdp-7x10.docx')
EDITION=Path('sources/akiva/editions/Peri_Tzadik_Bereshit_Cheshvan_Noach_Study_Edition.json')
NOTES=Path('sources/akiva/annotations/Peri_Tzadik_Noach_5_6.json')
COUNTS={5:[38,44,43,33],6:[58,36,18,20,24,17,21]}
CORRECTIONS={
 'And it said: What did women see to be commanded regarding these three mitzvot, etc.?':'And he said: Why were women commanded concerning these three mitzvos, etc.?',
 'And this is what it meant: she defiled the challah of the world—corresponding to the nefesh,':'This is what he meant by “she defiled the challah of the world”: it corresponds to the nefesh,',
 'Just like this tub, etc.,':'Like this earthenware vessel, etc.,',
 'And that which was written ‘she spilled his blood’ corresponds to the ruach which resides in the heart.':'And the statement “she shed his blood” corresponds to ruach, which resides in the heart.',
 '‘The soul that I gave within you is called a candle;':'“The soul that I placed within you is called a lamp;',
 'concerning matters of the candle I warned you’, see there.':'concerning the lamp I warned you,” see there.',
 "as is stated: ‘his flesh run, etc.’,":'as it is stated: “a discharge flows from his flesh,” etc.,',
 "And in the Gemara the formulation is: ‘A revi'it of blood I placed within you’,":'And the Gemara uses the expression: “A quarter-log of blood I placed within you,”',
 'and the Torah brings healing even to this blemish.':'and the Torah brings healing even to this spiritual blemish.',
 'and came about through the cause of Eve.':'and was brought about through Chavah.',
 'And through the contamination that the Serpent injected and which adhered to Adam the First,':'Through the spiritual impurity that the serpent imparted, which clung to Adam HaRishon,',
 'it caused corruption and blemish during the 130 years of his separation.':'this brought about corruption and spiritual damage during the 130 years of his separation.',
 'And the matter is, that the root of exiles is on account of the blemish of the Covenant,':'The matter is that the root of the exiles lies in the blemish of the covenant,',
 "wherein Hashem bestows from the first three Sefirot—Chokhmah, Binah, Da'at:":'during which Hashem bestows influence from the first three sefiros—Chochmah, Binah, and Daas:'
}
def from_word():
    with ZipFile(DOCX) as z: root=ET.fromstring(z.read('word/document.xml'))
    groups={5:[],6:[]}; notes={5:{},6:{}}; ois=None
    for p in root.find(q('body')).findall(q('p')):
        txt=''.join(t.text or '' for t in p.iter(q('t')))
        if 'Noach — Ois 5' in txt:ois=5;continue
        if 'Noach — Ois 6' in txt:ois=6;continue
        if ois not in groups or not re.search(r'[\u05d0-\u05ea]',txt) or not re.search('[A-Za-z]',txt):continue
        pending=[];pairs=[];refs=[]
        for r in p.findall(q('r')):
            t=''.join(x.text or '' for x in r.iter(q('t')))
            for foot in r.findall('.//'+q('footnoteReference')):
                if not pairs or pending:raise ValueError('Misaligned Word footnote')
                refs.append((int(foot.get(q('id'))),len(pairs)-1))
            if not t:continue
            if re.search(r'[\u0590-\u05ff]',t):pending.append(t)
            elif not re.search('[A-Za-z]',t) and pending:pending.append(t)
            else:
                if not pending:raise ValueError('Unpaired English: '+repr(t))
                pairs.append([''.join(pending).strip(),t.strip()]);pending=[]
        if pending:raise ValueError('Unpaired Hebrew')
        for j,pair in enumerate(pairs):
            if pair[1]=='And ONEG (':
                six=pairs[j:j+6]
                assert [x[1] for x in six[:5]]==['And ONEG (','- delight) is the acronym of:','Eden (','), River (','), Garden (']
                assert not any(j<=pos<j+6 for _,pos in refs)
                pairs[j:j+6]=[
                    [six[0][0],'And oneg (“delight”) is an acronym for:'],
                    [six[2][0]+' '+six[5][0].split(')',1)[1].strip(),
                     'Eden, Nahar (River), and Gan (Garden), as stated in the Zohar (I, 26a).']]
                refs=[(num,pos-4 if pos>=j+6 else pos) for num,pos in refs]
                break
        start=len(groups[ois]);groups[ois]+=pairs
        for num,pos in refs:
            if num in notes[ois]:raise ValueError('Repeated footnote')
            notes[ois][num]=start+pos
    return groups,notes

def main():
    grouped,locations=from_word()
    edition=json.loads(EDITION.read_text(encoding='utf8'))
    annotations=json.loads(NOTES.read_text(encoding='utf8'))
    for ois,counts in COUNTS.items():
        assert len(grouped[ois])==sum(counts),(ois,len(grouped[ois]))
        sec=next(s for s in edition['sections'] if s.get('node')=='Noach' and s.get('chapter')==ois)
        assert len(sec['topics'])==len(counts)
        sec['useVerifiedHebrew']=True
        sec['sourceDocument']=DOCX.name
        sec['sourceUrl']='https://www.sefaria.org/Peri_Tzadik,_Noach.'+str(ois)
        offset=0
        for topic,count in zip(sec['topics'],counts):
            topic['pairs']=[[he,CORRECTIONS.get(en,en)] for he,en in grouped[ois][offset:offset+count]]
            offset+=count
        selected=[n for n in annotations['notes'] if n['ois']==ois]
        for note in selected:
            pos=locations[ois][note['number']]
            start=0
            for k,count in enumerate(counts):
                if pos<start+count:
                    note['topicIndex']=k
                    note['phraseIndex']=pos-start
                    note['anchor']=sec['topics'][k]['pairs'][pos-start][1]
                    break
                start+=count
        print(f'Noach Ois {ois}: {len(grouped[ois])} exact phrases; {len(selected)} anchored footnotes')
    assert len(annotations['notes'])==31
    assert set(locations[5])|set(locations[6])=={n['number'] for n in annotations['notes']}
    EDITION.write_text(json.dumps(edition,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    NOTES.write_text(json.dumps(annotations,ensure_ascii=False,separators=(',',':')),encoding='utf8')

if __name__=='__main__':main()

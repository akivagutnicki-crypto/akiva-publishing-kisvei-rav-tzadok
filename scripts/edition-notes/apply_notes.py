#!/usr/bin/env python3
"""Add the verified source notes of the November 2026 Word editions to books already in the reader.

Works on a complete copy of the live site (artifact-preserving release). For each book pack in
sources/akiva/edition-supplements: a note goes to the paragraph holding its six-word Hebrew
signature, beside the Hebrew phrase it follows; it is skipped when the paragraph already has a
note for the same source (no doubled notes). Then the book's notes are renumbered in reading order.
Usage: apply_notes.py SITE_LIBRARY_DATA_DIR [--dry]
"""
import json,re,sys,os,glob,html
NIK=re.compile(r'[֑-ׇ]')
def bare(s): return re.sub(r'\s+',' ',re.sub(r'[^א-ת ]',' ',NIK.sub('',re.sub(r'<[^>]+>','',str(s or ''))))).strip()
def canon(u):
    p=u.split('sefaria.org/')[-1].split('?')[0]; p=re.sub(r'[_:]|%20','.',p).lower(); parts=[x for x in p.split('.') if x]
    for i,x in enumerate(parts):
        if re.fullmatch(r'\d+[ab]?',x): return '.'.join(parts[:i+1] if x[-1] in 'ab' else parts[:i+2])
    return p
def urls_of(note):
    out=set()
    for s in note.get('sources') or []:
        if s.get('url'): out.add(canon(s['url']))
    for p in note.get('paragraphs') or []:
        for r in p.get('rich') or []:
            if r.get('href') and 'sefaria.org' in r['href']: out.add(canon(r['href']))
    return out
def leaves(toc):
    out=[]
    def walk(n):
        for c in n.get('children',[]):
            if c.get('children'): walk(c)
            else: out.append(c)
    walk(toc['toc'])
    if not out and 'id' in toc['toc']: out=[toc['toc']]
    return out
def sections(d):
    """(file, section ref, separator) in reading order, as scripts/build-mcp-index.mjs addresses them."""
    toc=json.load(open(os.path.join(d,'toc.json')))
    out=[]
    for lf in leaves(toc):
        i=lf.get('id')
        if i is None: continue
        deep=(lf.get('depth') or 1)>1; sep=lf.get('sep') or (':' if deep else ' ')
        if os.path.exists(os.path.join(d,f'{i}.json')): out.append((f'{i}.json',lf['ref'],sep))
        k=1
        while os.path.exists(os.path.join(d,f'{i}-{k}.json')): out.append((f'{i}-{k}.json',f"{lf['ref']} {k}",sep)); k+=1
    return out
def files_in_order(d): return [f for f,_,_ in sections(d)]
def plain(s):
    """The phrase text exactly as scripts/build-mcp-index.mjs measures it (its plain(): <br> as a newline, tags
    removed, entities decoded, spaces tidied and trimmed), so a note's character offset is valid there."""
    t=html.unescape(re.sub(r'<[^>]*>','',re.sub(r'<br\s*/?>','\n',str(s or ''),flags=re.I)))
    t=re.sub(r'[ \t\u00a0]+',' ',t); t=re.sub(r' *\n *','\n',t); t=re.sub(r'\n{3,}','\n\n',t)
    return t.strip()
INLINE=re.compile(r'<sup class="footnote-marker">\d+</sup><i class="footnote">\s*([^<—]{2,80}?)\s+—')
def note_bodies(h):
    h=str(h); out=[]
    for m in re.finditer(r'<sup class="footnote-marker">\d+</sup><i class="footnote">',h):
        depth=1; j=len(h)
        for t in re.finditer(r'<i[ >]|</i>',h[m.end():]):
            depth+=1 if t.group(0)!='</i>' else -1
            if depth==0: j=m.end()+t.start(); break
        out.append(h[m.end():j])
    return out
def inline_urls(it):
    """Every source an inline note of the paragraph cites (Resisei Layla: '<sup …>N</sup><i class="footnote"> <a data-ref="Berakhot 6b">…')."""
    out=set()
    for ph in it.get('p') or []:
        for body in note_bodies(ph[0] if isinstance(ph,list) else ph):
            for r in re.findall(r'data-ref="([^"]+)"',body): out.add(canon(html.unescape(r).replace(' ','_')))
            m=re.match(r'\s*([^<—]{2,80}?)\s+—',body)
            if m: out.add(canon(m.group(1).strip().replace(' ','_')))
    return out
def strip_notes(h):
    """The text of a phrase without its inline notes (whose Hebrew quotations must not be matched as the text)."""
    h=str(h); out=[]; pos=0
    for m in re.finditer(r'<sup class="footnote-marker">\d+</sup><i class="footnote">',h):
        if m.start()<pos: continue
        depth=1; j=len(h)
        for t in re.finditer(r'<i[ >]|</i>',h[m.end():]):
            depth+=1 if t.group(0)!='</i>' else -1
            if depth==0: j=m.end()+t.end(); break
        out.append(h[pos:m.start()]); pos=j
    out.append(h[pos:]); return ''.join(out)
def renumber_inline(lists):
    n=0
    def r(m):
        nonlocal n; n+=1; return f'<sup class="footnote-marker">{n}</sup>'
    for items in lists:
        for it in items:
            if isinstance(it,dict):
                for ph in it.get('p') or []:
                    if isinstance(ph,list): ph[0]=re.sub(r'<sup class="footnote-marker">\d+</sup>',r,ph[0])
    return n
# Resisei Layla's notes are already full (the editor's instruction): at most two new notes in a paragraph, the source of
# the words it quotes first, then Gemara and Midrash, then pesukim.
CAP={'resisei-layla':2}
TANACH=re.compile(r'^(?:Source(?: of the quoted words)?: )?(?:Bereishis|Shemos|Vayikra|Bamidbar|Devarim|Yehoshua|Shoftim|Shmuel|Melachim|Yeshayahu|Yirmiyahu|Yechezkel|Hoshea|Yoel|Amos|Ovadiah|Yonah|Michah|Nachum|Chavakuk|Tzefaniah|Chaggai|Zechariah|Malachi|Tehillim|Mishlei|Iyov|Shir HaShirim|Rus|Eichah|Koheles|Esther|Daniel|Ezra|Nechemiah|Divrei HaYamim|Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Psalms|Proverbs|Isaiah|Jeremiah|Ezekiel)\b')
def priority(n):
    t=n['paragraphs'][0]['text'] if n.get('paragraphs') else ''
    return 0 if t.startswith('Source of the quoted words') else (2 if TANACH.match(t) else 1)
def main(root,dry=False,packdir='sources/akiva/edition-supplements'):
    report={}
    for pf in sorted(glob.glob(os.path.join(packdir,'*.json'))):
        pack=json.load(open(pf)); slug=pack['slug']; d=os.path.join(root,slug)
        if not os.path.isdir(d): report[slug]='missing'; continue
        S=sections(d); F=[f for f,_,_ in S]; data={f:json.load(open(os.path.join(d,f))) for f in F}
        lk=os.path.join(d,'links.json'); links=json.load(open(lk)) if os.path.exists(lk) else {}
        grams={}; anchor={}
        for f,ref,sep in S:
            # the separator the reader's own connections use for this section, when it has any
            used=[l['a'][len(ref)] for l in links.get(ref,[]) if l['a'].startswith(ref) and re.fullmatch(r'[: ]\d+',l['a'][len(ref):])]
            if used: sep=max(set(used),key=used.count)
            c=0
            for k,it in enumerate(data[f]):
                if not isinstance(it,dict) or not it.get('p'): continue
                c+=1; anchor[(f,k)]=(ref,ref+sep+str(it.get('n') or c))
                w=bare(' '.join(strip_notes(p[0] if isinstance(p,list) else p) for p in it['p'])).split()
                for i in range(len(w)-5): grams.setdefault(' '.join(w[i:i+6]),(f,k))
        # every paragraph ref already in the book's connections must be one we compute (section-wide refs aside)
        norm=lambda a: re.sub(r'[: ](\d+)$',r'|\1',a)
        known={norm(a) for _,a in anchor.values()}
        byref={norm(a):loc for loc,(_,a) in anchor.items()}
        secs={r for _,r,_ in S}
        # only sections whose paragraphs were read (Pri Tzaddik's original-Hebrew volumes nest their sections in one file)
        read_secs={a[0] for a in anchor.values()}
        stray=sorted({l['a'] for k_,v in links.items() if k_ in read_secs for l in v if norm(l['a']) not in known} - secs)
        assert len(stray)<=max(3,len(known)//200), f'{slug}: paragraph refs disagree with links.json, e.g. {stray[:5]}'
        items=[it for f in F for it in data[f] if isinstance(it,dict)]
        inline=any('footnote-marker' in str(it.get('p')) for it in items) and not any(it.get('footnotes') for it in items)
        noted=any(it.get('footnotes') for it in items) or inline
        # notes this release published earlier: refreshed from the (corrected) pack
        bysid={n['sourceId']:n for n in pack['notes']}; refreshed=0
        for it in items:
            for x in it.get('footnotes') or []:
                src=bysid.get(x.get('sourceId'))
                if src and x.get('supplement') and x['paragraphs']!=src['paragraphs']:
                    x['paragraphs']=src['paragraphs']; x['sources']=src['sources']; refreshed+=1
        placed=dup=lost=0; newlinks=[]
        cap=CAP.get(slug); per={}; capped=0
        order=sorted(pack['notes'],key=priority) if cap else pack['notes']
        for n in order:
            if n.get('kind')=='par': continue
            # a book whose reader notes are its original notes keeps them; the Word edition's copies are not added again
            if n.get('kind')=='orig' and noted: dup+=1; continue
            loc=grams.get(n['sig'])
            if not loc and n.get('ref'):        # placed by its paragraph ref (the study edition spells out abbreviations)
                loc=byref.get(norm(n['ref']))
            if not loc: lost+=1; continue
            f,k=loc; it=data[f][k]
            have=set().union(set(),*[urls_of(x) for x in it.get('footnotes') or []])|inline_urls(it)
            if any(x.get('sourceId')==n.get('sourceId') for x in it.get('footnotes') or []): dup+=1; continue
            mine={canon(s['url']) for s in n['sources'] if s.get('url')}
            if mine and mine<=have: dup+=1; continue
            if cap:
                if per.get(loc,0)>=cap: capped+=1; continue
                per[loc]=per.get(loc,0)+1
            phr=[bare(strip_notes(p[0] if isinstance(p,list) else p)) for p in it['p']]
            a=n['anchor']; two=' '.join(a.split()[:2])
            pi=-1
            if n.get('cut'):        # the phrase that cuts the idea short, the one right after the locator word
                cuts=[i for i,x in enumerate(phr) if re.search(n['cut'],x)]
                pi=next((i for i in cuts if n.get('key') and re.search(n['key'],' '.join(phr[max(0,i-1):i+1]))),cuts[0] if cuts else -1)
            if pi<0: pi=next((i for i,x in enumerate(phr) if n.get('key') and re.search(n['key'],x)),-1)
            if pi<0: pi=next((i for i,x in enumerate(phr) if a and a in x),-1)
            if pi<0: pi=next((i for i,x in enumerate(phr) if two and two in x),len(phr)-1)
            if inline:
                body=html.escape('\n'.join(x['text'] for x in n['paragraphs']),quote=False)
                # already added by an earlier run (the inline note carries no link to compare): same opening words
                if any(plain(b)[:60]==plain(body)[:60] for ph_ in it['p'] if isinstance(ph_,list) for b in note_bodies(ph_[0])):
                    dup+=1; continue
                ph=it['p'][pi]; ph[0]=ph[0]+f'<sup class="footnote-marker">0</sup><i class="footnote"> {body}</i>'
                sec,a=anchor[(f,k)]
                for s_ in n['sources']:
                    if s_.get('ref') and s_.get('url','').startswith('https://www.sefaria.org/'): newlinks.append({'s':sec,'a':a,'r':s_['ref']})
                placed+=1; continue
            ph=it['p'][pi]; he=plain(strip_notes(ph[0]) if isinstance(ph,list) else ph); en=plain(ph[1]) if isinstance(ph,list) and len(ph)>1 else ''
            it.setdefault('footnotes',[]).append({'number':0,'sourceId':n['sourceId'],'placementId':n['placementId'],'phraseIndex':pi,
                'heWord':len(he.split()),'heCharOffset':len(he),'enCharOffset':len(en),'heAnchorPrefix':he,'enAnchorPrefix':en,
                'paragraphs':n['paragraphs'],'sources':n['sources'],'nativeConnections':[],'supplement':True,
                'verificationStatus':'verified','verificationNote':'Quoted from the cited source; Sefaria link verified (Word edition, November 2026)'})
            sec,a=anchor[(f,k)]
            for s_ in n['sources']:
                if s_.get('ref') and s_.get('url','').startswith('https://www.sefaria.org/'): newlinks.append({'s':sec,'a':a,'r':s_['ref']})
            placed+=1
        # a note on a phrase with no Hebrew (an English-only line such as "The theme: ...") has no letter for the reader to
        # anchor its marker to, and the reader then refuses the whole section: move it to the nearest phrase with Hebrew
        moved_empty=0
        for f in F:
            for it in data[f]:
                if not isinstance(it,dict) or not it.get('footnotes') or not it.get('p'): continue
                hes=[plain(strip_notes(ph[0] if isinstance(ph,list) else ph)) for ph in it['p']]
                for x in it['footnotes']:
                    i=x.get('phraseIndex',0)
                    if 0<=i<len(hes) and hes[i].strip(): continue
                    j=next((k for k in range(min(i,len(hes))-1,-1,-1) if hes[k].strip()),None)
                    if j is None: j=next((k for k in range(max(i,0)+1,len(hes)) if hes[k].strip()),None)
                    if j is None: continue
                    he=hes[j]; ph=it['p'][j]; en=plain(ph[1]) if isinstance(ph,list) and len(ph)>1 else ''
                    x.update(phraseIndex=j,heWord=len(he.split()),heCharOffset=len(he),heAnchorPrefix=he)
                    if 'enCharOffset' in x: x.update(enCharOffset=len(en),enAnchorPrefix=en)
                    moved_empty+=1
        # renumber the whole book in reading order (phrase order within a paragraph)
        removed=0
        if inline:
            for f in F:
                for it in data[f]:
                    if not isinstance(it,dict): continue
                    seen=set()
                    for ph in it.get('p') or []:
                        if not isinstance(ph,list) or 'footnote-marker' not in ph[0]: continue
                        h=ph[0]
                        for m in reversed(list(re.finditer(r'<sup class="footnote-marker">\d+</sup><i class="footnote">',h))):
                            pass
                        out=[]; pos=0
                        for m in re.finditer(r'<sup class="footnote-marker">\d+</sup><i class="footnote">',h):
                            if m.start()<pos: continue
                            depth=1; j=len(h)
                            for t in re.finditer(r'<i[ >]|</i>',h[m.end():]):
                                depth+=1 if t.group(0)!='</i>' else -1
                                if depth==0: j=m.end()+t.end(); break
                            key=plain(h[m.end():j-4])[:60]
                            out.append(h[pos:m.start()])
                            if key in seen: removed+=1
                            else: seen.add(key); out.append(h[m.start():j])
                            pos=j
                        out.append(h[pos:]); ph[0]=''.join(out)
        num=renumber_inline([data[f] for f in F]) if inline else 0
        for f in F:
            for it in data[f]:
                if isinstance(it,dict) and it.get('footnotes'):
                    it['footnotes'].sort(key=lambda x:(x.get('phraseIndex',0),x.get('heCharOffset',10**6),0 if not x.get('supplement') else 1))
                    for x in it['footnotes']: num+=1; x['number']=num
        if not dry:
            for f in F: json.dump(data[f],open(os.path.join(d,f),'w'),ensure_ascii=False,separators=(',',':'))
        report[slug]={'moved_off_empty_phrase':moved_empty,'repeats_removed':removed if inline else 0,'refreshed':refreshed,'added':placed,'already_there':dup,'not_found':lost,'capped':capped,'notes_now':num,'links':newlinks}
    return report
if __name__=='__main__':
    r=main(sys.argv[1],'--dry' in sys.argv)
    out=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--links=')),None)
    if out: json.dump({k:v['links'] for k,v in r.items() if isinstance(v,dict)},open(out,'w'),ensure_ascii=False)
    print(json.dumps({k:({x:y for x,y in v.items() if x!='links'} if isinstance(v,dict) else v) for k,v in r.items()},indent=1))

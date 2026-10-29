#!/usr/bin/env python3
"""Source-SHA guarded, reader-only Takanas HaShavin corrections; never alter main."""
import copy,hashlib,json,re
from pathlib import Path
P=Path("sources/akiva/Takanat_HaShavin.json")
SHA="000c9e967b6421e80489cd39ab852e562578ca83"
I=re.compile(r"</?i(?:\s[^>]*)?>")
M=re.compile(r'<sup class="footnote-marker">([^<]+)</sup>')
raw=P.read_bytes()
digest=hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\x00"+raw).hexdigest()
assert digest==SHA,"STOP: Unexpected source SHA; do not overwrite changed Reader."
original=json.loads(raw); d=copy.deepcopy(original)
history=[]
def lookup(s,n):
 token=f'<sup class="footnote-marker">{n}</sup><i class="footnote">'
 hits=[]
 for item in d["sections"][s]["items"]:
  for ix,pair in enumerate(item.get("p",[])):
   for lang in (0,1):
    t=pair[lang] or ""; at=t.find(token)
    if at<0:continue
    a=at+len(token);level=1;end=None
    for m in I.finditer(t,a):
     level+= -1 if m.group().startswith("</") else 1
     if level==0:end=m;break
    assert end is not None,(s,n)
    hits.append((item,ix,pair,lang,t,at,a,end.start(),end.end()))
 assert len(hits)==1,(s,n,len(hits))
 return hits[0]
def change(s,n,f,label):
 _,_,pair,lang,t,at,a,b,end=lookup(s,n)
 before=t[a:b];after=f(before)
 assert before!=after,(s,n,"no op")
 pair[lang]=t[:a]+after+t[b:];history.append(["text",s,n,label])
def repl(s,n,a,b,label):
 def do(t):
  assert t.count(a)==1,(s,n,a)
  return t.replace(a,b,1)
 change(s,n,do,label)
def move(s,n,fp,fi,tp,ti,label):
 item,ix,pair,lang,t,at,a,b,end=lookup(s,n)
 assert item.get("n")==fp and ix==fi and lang==1,(s,n,"bad anchor")
 target=next(i for i in d["sections"][s]["items"] if i.get("n")==tp)
 v=target["p"][ti][1];span=t[at:end]
 pair[lang]=t[:at]+t[end:]
 insert=len(v)
 for marker in M.finditer(v):
  if marker.group(1).isdigit() and int(marker.group(1))>int(n):
   insert=marker.start();break
 target["p"][ti][1]=v[:insert]+span+v[insert:]
 history.append(["move",s,n,f"p{fp} phrase{fi}",f"p{tp} phrase{ti}",label])
def split(s,a,b,needle,label):
 _,_,_,_,t,at,start,end,_=lookup(s,a)
 note=t[start:end];k=note.index(needle)
 assert k>0
 change(s,a,lambda _:note[:k].rstrip(),label+" primary")
 change(s,b,lambda x:x+"\n\n"+note[k:],label+" later parallel")
split(1,7,14,"Chassidic parallels —","Separate developed parallels")
change(2,75,lambda x:x+" This is a thematic parallel about individuality, not a textual explanation of the adjacent Zohar passage.","Contextual qualification")
repl(2,93,"The first, drawn from gazing at the created world, is the “lower wisdom” of §2-6 that “spreads into the lower [worlds] and even into the nations” — for anyone contemplating creation may reach it (hence “one who says there is wisdom among the nations, believe it”); the higher — the knowledge of His governance — belongs to Israel’s Torah.","R’ Tzadok’s §189 distinguishes apprehension through creation from apprehension through Divine governance. Its discussion does not establish the separate claim about wisdom among the nations; that is supported here by Eichah Rabbah 2:13, cited in the Hebrew. The §189 passage is a conceptual parallel, not a direct proof of the national distinction.","Separate inference from source")
repl(3,125,"Yisrael Kedoshim §8","Yisrael Kedoshim §8:9","Precision")
repl(4,220,"Peri Tzadik, Vayakhel §1","Pri Tzaddik, Kuntres Shevisas Shabbos 1:5","Source correction")
repl(4,221,"R’ Yochanan said","R’ Chanina said","Shabbos 123b attribution")
repl(4,221,"were tightened, later relaxed, then re-tightened","were initially restricted and then relaxed in successive stages","Shabbos 123b chronology")
move(4,220,4,1,4,2,"Temporary fences discussed")
move(4,222,4,2,4,3,"Torah renewal discussed")
move(5,232,1,0,1,1,"Thought-root mechanism")
move(5,231,1,0,11,4,"Future transformation of past")
repl(5,246,"and a king, once he has bowed, does not straighten up until he completes his entire prayer","and a king, once he has bowed, does not straighten up","Gemara exact wording")
repl(5,246," עַד שֶׁגּוֹמֵר כָּל תְּפִלָּתוֹ","","Gemara exact Hebrew")
repl(5,246,"the Gemara (34a–b) adds the gradations of rank:","the Gemara (34b), in R. Yitzchak bar Nachmani’s report from R. Yehoshua ben Levi, adds the gradations of rank:","Transmission")
change(5,249,lambda _: "Tehillim 109:22 says, “וְלִבִּי חָלַל בְּקִרְבִּי” — “my heart is wounded within me.” Yerushalmi Berachos 9:5 reads David’s words as his killing of the <i>yetzer hara</i>, unlike Avraham, who made his <i>yetzer hara</i> good (Nechemyah 9:8). Rav Tzadok develops that contrast as the difference between <i>yirah</i> and <i>Gevurah</i>, and the transformation accomplished through <i>ahavah</i>.","Replace Kometz citation with primary")
repl(6,357,"R’ Shmuel bar Nachmani said:","R’ Shmuel bar Nachmani said in the name of R’ Yonatan:","Attribution")
repl(6,984,"Yirmeyah 31:33","Yirmeyah 31:34","Yirmeyah exact verse")
change(6,984,lambda x:x+" Rav Tzadok also recognizes the mesiras nefesh involved in Korach’s willingness to endanger his life, while rejecting his premature application of the future state.","Keep Korach nuance")
repl(6,986,"Yirmiyah 31:33 (in some editions 31:34)","Yirmiyah 31:34","Yirmeyah exact verse")
move(6,984,73,1,73,2,"Place with future verse")
move(6,985,73,1,73,5,"Future level developed")
move(6,987,73,2,73,6,"Shimon reception developed")
move(7,1122,1,1,1,3,"Rav Tzadok disagrees and develops his view")
move(8,1213,6,2,6,3,"Beyond worldly bounds developed")
split(9,1224,1233,"Izhbitz-Radzin — the hidden heart and the public act","Public legal credibility follows later")
move(9,1224,1,0,1,1,"Viduy discussion developed")
def inv(doc,s):
 e=[];h=[]; 
 for item in doc["sections"][s]["items"]:
  for pair in item.get("p",[]):
   h+=M.findall(pair[0] or "")
   e+=M.findall(pair[1] or "")
 return sorted(e),sorted(h)
counts=[]
for s in range(16):
 b=original["sections"][s];a=d["sections"][s]
 assert len(b["items"])==len(a["items"]),(s,"blocks changed")
 for i,item in enumerate(b["items"]):
  now=a["items"][i]
  assert bool(item.get("p"))==bool(now.get("p")),(s,i,"p changed")
  for j,pair in enumerate(item.get("p",[])):
   assert pair[0]==now["p"][j][0],(s,i,j,"Hebrew changed")
 assert inv(original,s)==inv(d,s),(s,"markers changed")
 if s==0 or s>=10:assert b==a,(s,"protected changed")
 ee,hh=inv(d,s)
 assert len(ee)==len(set(ee)) and len(hh)==len(set(hh))
 counts.append({"section":s,"markers":len(ee)+len(hh),"hebrew_markers":len(hh)})
assert len(history)==28 and sum(x[0]=="move" for x in history)==10
out=json.dumps(d,ensure_ascii=False,separators=(",",":")).encode()
P.write_bytes(out)
Path("editorial/takanas-reader-final-applied-audit.json").write_text(json.dumps({"original_blob_sha":SHA,"edited_notes":len(set((i[1],i[2]) for i in history)),"operations":history,"counts":counts,"output_sha256":hashlib.sha256(out).hexdigest(),"warnings":["186 clusters need additional scholarly review","Simanim 10-13 preserved as live, not replaced from archives","Independent source certification remains incomplete"]},ensure_ascii=False,indent=2)+"\n")
print("Written source",len(out),"bytes; 28 edits; 10 moves; all markers/hebrew and protected sections preserved")

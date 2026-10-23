import json,re,html,hashlib
from pathlib import Path
ROOT=Path('/workspace/scratch/f85ae98f1669')
CACHE=json.loads((ROOT/'review-work/recover51-primary.json').read_text())
BOOKS=ROOT/'tmp/batch-engineering/current-site/mcp-data/text'
def flatten(x):return ' '.join(flatten(y) for y in x) if isinstance(x,list) else x
def plain(x):return html.unescape(re.sub('<[^>]*>','',x))
def clean(x):return ' '.join(re.sub('[\u0591-\u05c7\u200e\u200f]','',plain(flatten(x))).split())
def primary(ref,index=None):
 h=CACHE[ref]['he'];return clean(h if index is None else h[index])
def local(book,ref):
 d=json.loads((BOOKS/(book+'.json')).read_text());p=next(p for p in d['paras'] if p['r']==ref)
 return clean(p.get('t') or ' '.join(x[0] for x in p['p']))
def excerpt(s,a,b):
 i=s.index(a);j=s.index(b,i)+len(b);return s[i:j]
pages={51:([145,146],[191]),52:(list(range(147,151)),list(range(192,195))),53:([151,152],[195,196,197]),54:([153,154,155],[198,199,200]),55:([156,157,158],[201,202,203])}
entries=[]
def add(section,id,phrase,ref,he,en,context,row=1,anchor_end=None,url=None,reader=False,primaryfile=None):
 rows=json.loads((ROOT/f'live-baseline/{section-1}.json').read_text());r=next(x for x in rows if x['n']==row)
 text=plain(r['p'][phrase][0]);prefix=text if anchor_end is None else text[:text.index(anchor_end)+len(anchor_end)]
 assert text.startswith(prefix)
 url=url or ('https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/'+ref.rsplit(':',1)[0].replace(' ','_') if reader else 'https://www.sefaria.org/'+ref.replace(' ','_'))
 e={'section':section,'id':id,'rowN':row,'phraseIndex':phrase,'heAnchorPrefix':prefix,'heCharOffset':len(prefix),'ref':ref,'url':url,'he':he,'en':en,'context':context,
 'sourceEvidence':[{'ref':ref,'url':url,'he':he,'en':en,'translation':'Original English translation prepared from the cited Hebrew or Aramaic.','coverage':'excerpt','heSha256':hashlib.sha256(he.encode()).hexdigest()}],
 'reviewEvidence':{'pdfPages':{'neimosA':pages[section][0],'integratedA':pages[section][1]},'preserveExisting':True,'status':'verified','dedup':'Existing native and connected notes in the destination ois checked; this selected passage is absent.','primaryTextFile':primaryfile or 'review-work/recover51-primary.json'}}
 if reader:e['readerRef']=ref
 entries.append(e)

add(51,'kometz-truth-endures',0,'Kometz HaMinchah 2:40:1',
 excerpt(primary('Kometz HaMinchah 2:40:1'),'כי אמת הוא הקיום לעד','חותמו של הקב"ה בו ע"ש'),
 'For truth is that which endures forever, as it is said, “A truthful lip will be established forever.” As stated in the Jerusalem Talmud at the beginning of Sanhedrin, this is why it is the seal of the Holy One, blessed be He; see there.',
 'Rav Tzadok uses endurance as the measure of truth. This explains why a victory whose continuation is uncertain can be called “false” or “vain,” even though the effort at that moment has value.',reader=True)
add(51,'sanhedrin-palti-deliverance',8,'Sanhedrin 19b:19-20',
 clean(CACHE['Sanhedrin 19b']['he'][18:20]),
 'It is written “Palti,” and it is written “Paltiel.” Rabbi Yoḥanan said: Palti was his name. Why was he called Paltiel? Because God delivered him from the transgression. What did he do? He planted a sword between himself and her and said, “Whoever engages in this act shall be pierced by this sword.” But is it not written, “Her husband went with her”? He became like a husband to her. But is it not written, “Walking and weeping”? He wept over the mitzvah that was leaving him. “As far as Baḥurim”: the two of them had remained like youths who had not experienced intercourse.',
 'The passage supplies both details invoked here: Paltiel’s name signifies divine deliverance, and his tears were over the loss of the opportunity to refrain from sin. Rav Tzadok reads these together as evidence of the special assistance Palti received.',anchor_end='שֶׁפְּלָטוֹ וְכוּלֵי,')

add(52,'rambam-promised-repentance',6,'Mishneh Torah, Repentance 7:5',
 primary('Mishneh Torah, Repentance 7:5'),
 'All the prophets commanded repentance, and Israel is redeemed only through repentance. The Torah has already promised that Israel will ultimately repent at the end of their exile and immediately be redeemed, as it is said: “When all these things come upon you,” and “You shall return to the Lord your God,” and “The Lord your God will restore,” and so forth.',
 'Rambam joins the necessity of repentance to the promise that Israel will ultimately return. This is the basis for hope that even a guilty generation can be brought to repentance and redemption.')
add(52,'yerushalmi-beloved-wilderness',3,'Jerusalem Talmud Avodah Zarah 1:1:3',
 excerpt(primary('Jerusalem Talmud Avodah Zarah 1:1',2),'כד הוה חמי בר נש כשר','ואת האחד נתן בדן.'),
 'When he saw an upright person, he would seat two mockers beside him, and they would ask him, “Which generation was more beloved than all the generations?” He would answer them, “The generation of the wilderness.” They would say to him, “Did they not worship idols?” He would tell them, “Because they were beloved, they were not punished.” They would say to him, “Be quiet, for the king wants to do the same.” Moreover, they made one, whereas this king made two: “He placed one in Bethel, and the other he placed in Dan.”',
 'This is a report of Jeroboam’s mockers manipulating an upright person’s answer to promote idolatry. Rav Tzadok cites the identification of the wilderness generation as beloved; the surrounding exchange must not be read as the Talmud endorsing the mockers’ argument or granting permission to sin.')
add(52,'takanat-inward-repentance',14,'Takanat HaShavin 9:1',
 excerpt(primary('Takanat HaShavin 9:1'),'ועיקר התשובה','רק שקיבל בלבו להחזיר מהני,'),
 'The essence of repentance is a resolve in the heart alone, for through this one is called completely righteous even if previously completely wicked, as explained in Kiddushin 49b. Even verbal confession, although it is a positive commandment of the Torah, “They shall confess,” is a separate mitzvah and does not prevent the repentance itself, whose essence is in the heart alone: regretting the past and resolving in one’s heart not to return to folly and not to sin again. Although this is not revealed to anyone—not even to the ministering angels, who do not know what is in the heart—it is revealed before Heaven, and the person is truly called completely righteous. This applies even if his sins have mounted exceedingly high: the statement there applies to every completely wicked person, even one who has transgressed the whole Torah. Beit Shmuel and Ḥelkat Meḥokek, in Even HaEzer 42, write that even if he stole and has not returned the stolen property, sincerely accepting in his heart that he will return it is effective.',
 'The instantaneous change is sincere repentance: regret and a real commitment to cease sin and repair what is owed. The passage preserves confession as an independent mitzvah and requires a genuine intention to restore stolen property; it does not cancel those duties.',reader=True)
add(52,'eikhah-return-us',15,'Eikhah Rabbah 5:21',
 excerpt(primary('Eikhah Rabbah 5:21'),'השיבנו ה\' אליך ונשובה','לכך נאמר: השיבנו ה\' אליך ונשובה.'),
 '“Return us, Lord, to You, and we shall return.” The community of Israel said before the Holy One, blessed be He: “Master of the world, it is for You to return us.” He said to them: “It is for you,” as it is said, “Return to Me and I shall return to you, says the Lord.” She said before Him: “Master of the world, it is for You,” as it is said, “Restore us, God of our salvation.” Therefore it is said, “Return us, Lord, to You, and we shall return.”',
 'This is the dialogue explicitly cited in the Hebrew. Israel asks God to initiate its return, while God calls on Israel to return to Him. Rav Tzadok applies this dialogue to the final generation’s need for divine assistance.')

add(53,'poked-individual-torah-root',3,'Poked Akarim 6:8',
 excerpt(primary('Poked Akarim 6:8'),'ויש ג"כ לכ"י אחיזה בתושבע"פ','המתעלם בזה,'),
 'All Israel also has a share in the Oral Torah, for even every unlearned Israelite possesses some matter of wisdom related to the Oral Torah, though it is completely concealed within him. Of the future it is said, “For they will all know,” meaning that their knowledge will emerge from concealment into revelation. Therefore the Zohar says that even an ordinary person’s words have substance, and sometimes a pearl is found in a poor person’s basket. In many places the Gemara says, “This is what people say,” and those words are Torah. At the beginning of Sanhedrin it records “A certain person used to say,” and these are words of Torah, as in many other places. Concerning this it says, “Who is wise? One who learns from every person,” for every person has some new matter of wisdom belonging specifically to the root of his soul, which can be learned from him. “You are called adam, but the nations of the world are not called adam”: only in each Israelite is there a particular matter of Oral Torah belonging to the root of his soul. An understanding person can learn it from him even if he himself knows nothing. But “those who seek the Lord understand everything”: from his conversations and speech about worldly matters they can grasp a matter of wisdom at the root of his soul that is concealed within it.',
 'This parallel explains the specific Torah content Rav Tzadok seeks within ordinary habitual speech: a matter of wisdom belonging to that person’s soul-root. It is not a claim that every casual utterance, regardless of content, automatically becomes a Torah ruling.',reader=True)
add(53,'onkelos-speaking-spirit',5,'Onkelos Genesis 2:7',
 primary('Onkelos Genesis 2:7'),
 'The Lord God formed the human being from the dust of the ground and breathed into his nostrils the breath of life, and it became in the human being a speaking spirit.',
 'Onkelos renders the verse’s “living soul” as “a speaking spirit.” Rav Tzadok cites this wording to connect a person’s speech with the expression of the soul.',anchor_end='"רוּחַ מְמַלְּלָא",')
add(53,'pesikta-righteous-speech',5,'Pesikta Rabbati 2',
 excerpt(primary('Pesikta Rabbati 2'),'ד"א מה ירננו על משכבותם','(תהלים קי"ח ט"ו):'),
 'Another interpretation: What does “They shall sing upon their beds” mean? That they praise the Holy One, blessed be He, there. Rabbi Ḥama son of Rabbi Yose said: The only difference between the living and the righteous dead is speech alone. They praise the Holy One, blessed be He, there, where their souls are bound in the bond of life, as it is written, “May my master’s soul be bound in the bond of life.” Therefore it says “They shall sing”: singing means praise, as it is written, “The sound of song and salvation is in the tents of the righteous.”',
 'The cited midrash speaks specifically about the righteous dead and their continuing praise. Rav Tzadok draws from its distinction the special role of spoken expression in embodied life.',anchor_end='אֶלָּא הַדִּבּוּר,')

radbaz='ומעתה בנדון דידן אומר אני כל שכן הוא דיהרג ואל יעבור אם מפני מצוה אחת של תורה אמרו יהרג ואל יעבור מי שאנסוהו לעזוב כל הדת כולה ולהיות כאחד מעמי הארץ ולכפור בכל תורת משה עאכו"כ שיהרג ואל יעבור. זאת ועוד אחרת שצריך להודות שהיה שם [אצלם] אדם שמעלתו היא למעלה ממעלת מרע"ה וזו הריסה בכל הדת. ועוד שכיון שינהוג בדתם אפשר שיעבור על החמורות ולאו אדעתיה.'
add(54,'radbaz-forced-renunciation',3,'Responsa Radbaz IV:92 (1163)',radbaz,
 'Consequently, in the case before us I say that it follows all the more that he must suffer death rather than transgress. If concerning one Torah commandment they said that one must suffer death rather than transgress, how much more so one whom they coerce to abandon the entire religion, become one of the peoples of the land, and deny the whole Torah of Moses. There is another consideration: he must acknowledge that among them there was a person whose stature is higher than that of Moses our teacher, and this undermines the entire religion. Moreover, once he follows their religion he may transgress the grave prohibitions without realizing it.',
 'The responsum cited here asks about coercion to convert to Islam, acknowledging Islamic monotheism and asking why one must refuse when no act of idolatry, forbidden sexual relations, or murder is being demanded. Radbaz distinguishes such a demand to abandon the Torah of Moses as a whole from coercion to commit an individual transgression. This explains Rav Tzadok’s distinction between violating a commandment and relinquishing the name of Israel.',row=2,url='https://he.wikisource.org/wiki/שו"ת_רדב"ז/אלף_קסג',primaryfile='Original responsum inspected at https://he.wikisource.org/wiki/שו"ת_רדב"ז/אלף_קסג, paragraphs beginning ומעתה בנדון דידן')
add(54,'tanchuma-united-israel',3,'Midrash Tanchuma, Tzav 7',
 excerpt(primary('Midrash Tanchuma, Tzav 7'),'אמר רבי אלעזר הקפר, גדול השלום','(הושע ד, יז).'),
 'Rabbi Elazar HaKappar said: Great is peace, for even when Israel themselves practice idolatry, if they form one united company, the attribute of judgment does not touch them, as it is said, “Ephraim is joined to idols; leave him.”',
 'This is the midrashic reading of “joined” as the people’s joining together. Rav Tzadok uses it to explain the protective significance of their continuing bond as one people, while the conduct described remains idolatry.',row=3)

add(55,'zikhronot-faith-in-heart',1,'Sefer HaZikhronot 1:7',
 local('sefer-hazikhronot','Sefer HaZikhronot 1:7'),
 'In any event, from what is written a person should reflect on how great the level of complete faith is and how much diligence is needed to root complete faith in his heart. Although every Israelite truly believes in the reality of His providence, blessed be He, and all the details of the principles of faith, it is nevertheless not yet rooted in the heart so as to be revealed through the powers of action that issue from the heart, such that this faith will never be forgotten.',
 'The distinction is between accepting the truth intellectually and having it firmly present in the heart so that it governs action. This supplies Rav Tzadok’s fuller explanation of remembering in the mind while forgetting in the heart.',reader=True,primaryfile='tmp/batch-engineering/current-site/mcp-data/text/sefer-hazikhronot.json')
add(55,'tzidkat-tzitzit-recall',6,'Tzidkat HaTzadik 220:1',
 excerpt(primary('Tzidkat HaTzadik 220:1'),'בציצית מפורש','ואין נזכר מהם'),
 'Concerning tzitzit it is explicitly stated, “You shall see it,” and “You shall not stray,” and so forth. The wording “You shall not stray” does not imply that the thought will be completely uprooted from the heart, but that one will have the strength to reject it. For as long as a person remembers the yoke of Heaven’s kingship, the yoke of Torah and the yoke of mitzvot that rest upon him, he can readily rebuke the inclination and reject every thought outside this. The inclination’s activity is only to make him forget this. As they said in Nedarim 32b, when the evil inclination is active no one remembers the good inclination, as it is said, “No person remembered,” and so forth. At that time the good thoughts of the unity of the Creator, blessed be He, are forgotten from the heart and are not recalled.',
 'Tzitzit restores the awareness needed to reject the temptation. The passage carefully distinguishes gaining the power to dismiss a thought from having the thought’s root completely removed.',reader=True)
add(55,'ramban-oath-to-stir',9,'Ramban on Numbers 30:3:1',
 excerpt(primary('Ramban on Numbers 30:3',0),'אבל השבועות','(תהלים קיט קו).'),
 'Oaths, however, serve only to prohibit what is otherwise permitted. They do not apply at all to a matter already commanded: neither to violating a negative commandment nor to keeping it, nor to neglecting a positive commandment, such as “I swear that I will not make a sukkah” or “I will not put on tefillin.” They do not take effect even for fulfilling a positive commandment. If someone swears to fulfill the mitzvah and does not fulfill it, he incurs no liability on account of the oath—neither lashes nor an offering. It is simply permitted to stir oneself to action, as it is written, “I have sworn and shall uphold it, to keep Your righteous ordinances.”',
 'This is Ramban’s stated view of an oath to fulfill an existing mitzvah. It supplies the premise for Rav Tzadok’s question: if the oath adds no such liability, what does its power to motivate accomplish? The answer here concerns awakening the heart.')
add(55,'yisrael-oath-against-rationalizing',10,'Yisrael Kedoshim 4:2',
 excerpt(primary('Yisrael Kedoshim 4:2'),'ויש להוסיף עוד','על זה מועיל השבועה'),
 'One may add further: concerning someone who is not established as wicked, it is known that the evil inclination does not immediately entice him to a transgression. Rather, it makes him forget the severity of the prohibition and presents reasons why it is no transgression at all. This is why Nedarim 8a says that one may swear to fulfill the mitzvot. Vayikra Rabbah 23 and Midrash Ruth, on the verse “As the Lord lives,” say that Joseph, David and Boaz swore against their inclination. Although a person is already under oath from Mount Sinai, the inclination presents the act as permitted, so that he thinks he is not violating the oath at Sinai. Against this the new oath is effective.',
 'Here Rav Tzadok explains the practical effect of the additional oath: it counters the inclination’s concealment and rationalization of a known prohibition. This develops the closing answer that the oath brings what is known into active awareness in the heart.',reader=True)

from align_batch4_reader import align_entries
align_entries(entries)

out={'schemaVersion':1,'reviewedSections':[51,52,53,54,55],
 'recovery':{'status':'reconstructed-and-reverified','reason':'Original proposal lost in workspace refresh; all 15 original selected references recovered from retained context. Exact Hebrew excerpts and destination anchors were retrieved and checked again. English was freshly reconstructed from those excerpts; this is not a claim of byte-for-byte recovery.'},
 'entries':entries,
 'coverage':[{'section':n,'status':'reviewed-add-only','sourcePageRanges':{'neimosA':[min(pages[n][0]),max(pages[n][0])],'integratedA':[min(pages[n][1]),max(pages[n][1])]},'addedSourceRefs':[e['ref'] for e in entries if e['section']==n],'existingNotesPreserved':True} for n in range(51,56)],
 'observationsNotApplied':[
  {'section':54,'source':'Igrot Moshe, Yoreh Deah III:106','reason':'A citation concerning acceptance of all mitzvot was corroborated in the supplied sources, but the original responsum was not independently retrieved. No new note was added. The existing Peri Tzadik note already explicitly includes accepting the yoke of mitzvot.'},
  {'section':55,'source':'Tanna Devei Eliyahu on the wood-gatherer and tzitzit','reason':'Already quoted in the existing Tiferet Yosef, Korach 2 connected note. Preserved without adding a duplicate.'},
  {'section':54,'source':'Midrash Tanchuma, Tzav','reason':'The supplied commentary cites the Buber numbering, section 10; the same passage is at section 7 in the linked standard Tanchuma edition.'}
 ]}
(ROOT/'review-work/ois-51-55.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print('Wrote',len(entries),'entries.',{n:sum(e['section']==n for e in entries) for n in range(51,56)})

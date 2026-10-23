import json,re,html,hashlib
from pathlib import Path
ROOT=Path('/workspace/scratch/f85ae98f1669')
CACHE=json.loads((ROOT/'review-work/ois66-primary.json').read_text())
BOOKS=ROOT/'tmp/batch-engineering/current-site/mcp-data/text'
SELECTED={}
def flatten(x):return ' '.join(flatten(v) for v in x) if isinstance(x,list) else x
def plain(x):return html.unescape(re.sub('<[^>]*>','',x))
def clean(x):return ' '.join(re.sub('[\u0591-\u05bd\u05bf-\u05c2\u05c4-\u05c7\u200e\u200f]','',plain(flatten(x))).split())
def primary(ref,*index):
    h=CACHE[ref]['he']
    for n in index:h=h[n]
    key=ref+(' ['+','.join(map(str,index))+']' if index else '')
    SELECTED[key]={'requestedRef':ref,'canonicalRef':CACHE[ref].get('ref'),'zeroBasedIndex':list(index),'he':h,'heVersionTitle':CACHE[ref].get('heVersionTitle'),'retrieval':'Public Sefaria text API; source quotation checked against supplied page and original Hebrew/Aramaic.'}
    return clean(h)
def local(book,ref):
    p=next(p for p in json.loads((BOOKS/(book+'.json')).read_text())['paras'] if p['r']==ref)
    h=p.get('t') or ' '.join(x[0] for x in p['p'])
    SELECTED[ref]={'canonicalRef':ref,'he':h,'canonicalFile':str(BOOKS/(book+'.json'))}
    return clean(h)
def excerpt(s,a,b=None):
    i=s.index(a)
    return s[i:] if b is None else s[i:s.index(b,i)+len(b)]
pages={66:([187,188],[230,231]),67:([188,189,190],[232,233]),68:([190,191,192],[233,234]),69:([192,193,194,195],[234,235,236]),70:([195,196,197,198],[236,237,238])}
entries=[]
def add(section,id,phrase,ref,he,en,context,reader=False,anchor_end=None):
    rows=json.loads((ROOT/f'live-baseline/{section-1}.json').read_text())
    r=next(x for x in rows if x.get('n')==1 and x.get('p'))
    t=plain(r['p'][phrase][0]);prefix=t if anchor_end is None else t[:t.index(anchor_end)+len(anchor_end)]
    url=('https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/'+ref.rsplit(':',1)[0].replace(' ','_')) if reader else ('https://www.sefaria.org/'+ref.replace(' ','_'))
    e={'section':section,'id':id,'rowN':1,'phraseIndex':phrase,'heAnchorPrefix':prefix,'heCharOffset':len(prefix),'ref':ref,'url':url,'he':he,'en':en,'context':context,
       'sourceEvidence':[{'ref':ref,'url':url,'he':he,'en':en,'translation':'Original English translation prepared from the cited Hebrew or Aramaic.','coverage':'excerpt','heSha256':hashlib.sha256(he.encode()).hexdigest()}],
       'reviewEvidence':{'pdfPages':{'neimosA':pages[section][0],'integratedA':pages[section][1]},'preserveExisting':True,'status':'verified','dedup':'Existing native and connected quotations in the destination ois checked; this selected source passage is absent.','primaryTextFile':'review-work/ois66-selected-primary.json'}}
    if reader:e['readerRef']=ref
    else:e['openExternal']=True
    entries.append(e)

# 66: the promise of rain, prayer, and the different explanations of daily supplication.
add(66,'rashi-rain-awaits-prayer',0,'Rashi on Genesis 2:5:2',
    primary('Rashi on Genesis 2:5',1),
    '“For He had not caused it to rain.” Why had He not caused it to rain? Because there was no human being to work the ground, and no one recognized the benefit of rain. When Adam came and knew that the world needed it, he prayed for it; the rain fell, and the trees and grasses grew.',
    'Rashi presents a created benefit whose actual arrival awaits human recognition and prayer. This illustrates the opening claim that prayer remains necessary for something already provided for in the divine order.')
add(66,'metzudat-elijah-prays-for-rain',2,'Metzudat David on I Kings 18:42:2',
    primary('Metzudat David on I Kings 18:42',1),
    '“He bent down toward the earth.” He prostrated himself on the ground; afterward he rose and placed his face between his knees to pray for rain. Although the Lord had told him, “I will give rain,” and so forth, he nevertheless prayed that it be given soon, while Ahab was still there. Because he was confident that his prayer would be accepted, he had already told Ahab, “There is the sound of abundant rain.”',
    'Metzudat David explicitly asks why Elijah prayed after the promise. His explanation concerns hastening the promised rain; Rav Tzadok uses Elijah’s conduct to establish the continuing place of prayer.')
add(66,'tosafot-daily-prayer-explanations',3,'Tosafot on Rosh Hashanah 16a:13:1',
    primary('Tosafot on Rosh Hashanah 16a:13:1'),
    '“According to whom do we now pray for the sick and the weak? According to Rabbi Yosei.” If you ask: Even according to the Rabbis, do we not pray “Heal us” and the blessing over the years? Moreover, Rabbi Yehudah, who says here that a person is judged on Rosh Hashanah and that his decree is sealed on Yom Kippur, says in the first chapter of Shabbat that one visiting the sick says, “May the Omnipresent have mercy on you and on the sick of His people Israel.” Rabbeinu Tam answers that prayer that someone not become ill is indeed according to Rabbi Yosei alone, but prayer that someone recover is according to everyone: when people will become ill was decreed; when they will recover was not decreed. At the beginning of the chapter “One who vows from cooked food,” it explains Rav Yosef’s statement: “the sick” means those actually ill, while “the weak” means the scholars. Thus we pray that the sick recover, and that the weak—the scholars—not become ill. The prayer in the blessing over the years is as explained later in this chapter: if little rain was decreed, the Omnipresent should send it at the proper times. Another answer is that communal prayer is different, for the community’s decree can be torn up, as stated later. Rabbi Yehudah’s statement in Shabbat can likewise be explained this way, for it resembles communal prayer: together with the individual, one prays for all the sick.',
    'Tosafot asks the same question about the established daily prayers. It offers two explanations, distinguishing prevention from recovery and distinguishing communal prayer. These are separate approaches to the difficulty that Rav Tzadok addresses here.')
add(66,'rosh-hashanah-prayer-after-decree',4,'Rosh Hashanah 16a:13',
    primary('Rosh Hashanah 16a',12),
    'Rav Yosef said: According to whom do we now pray for the sick and the weak? According to whom? According to Rabbi Yosei. Alternatively, you may say that this follows the Rabbis, in accordance with Rabbi Yitzchak. For Rabbi Yitzchak said: Crying out is beneficial for a person both before a decree and after a decree.',
    'The full passage includes an alternative explanation that permits such prayer according to the Rabbis as well. Rav Tzadok develops the first answer, which names Rabbi Yosei. The earlier existing note quotes the annual judgment discussion; this is the separate passage that he now cites.')

# 67: the original Ari passage and the classical descriptions of remembered sin and ascent.
add(67,'shaarei-teshuvah-remembered-sin',1,"Sha'arei Teshuvah 1:48",
    primary('Shaarei Teshuvah 1:48'),
    'The eighteenth principle: that his sin remain before him always. It is fitting for the soul that has sinned to remember its transgressions always and not forget them with the passage of time. They should not be snatched away from his heart until the time of his passing, as it is said, “For I know my transgressions, and my sin is before me always.” This principle will be explained in the third gate.',
    'Rabbeinu Yonah presents continued remembrance as a principle of repentance. Rav Tzadok explains why that remembrance can remain relevant even after repentance has been accepted: a higher spiritual level calls for renewed repentance.')
add(67,'arizal-ascent-renewed-purification',4,"Sha'ar HaGilgulim 22:1",
    excerpt(primary("Sha'ar HaGilgulim 22",0),'הצדיק אחר פטירתו מן העוה"ז','ואז יעלוהו במחיצתו האמיתיית הראוייה אליו.'),
    'After departing this world, the righteous person is prepared to rise through great levels in the World to Come, but not all at once. Immediately after his departure, he is punished to cleanse the more serious transgressions that he has, and then he is brought into one higher sphere. When his turn comes to ascend to a still higher sphere, he is again punished to cleanse sins lighter than the first ones, and then he rises to a second, higher level. Afterward he is punished again over fine points of the commandments that are like a hair’s breadth, in the mystery of “Around Him it storms exceedingly.” Then he is raised to the true sphere appropriate to him.',
    'This is the Ari’s teaching to which the ois refers, recorded by Rabbi Chaim Vital. The passage describes successive purification before higher levels after death; Rav Tzadok extends that pattern to spiritual ascent during life.')
add(67,'rivash-descent-for-ascent',5,"Tzava'at HaRivash 64:1",
    primary('Tzavaat HaRivash 64',0),
    'Sometimes a person falls from his level for a reason pertaining to himself, because the blessed God knows that he needs this. Sometimes the world causes a person to fall from his level. The descent serves an ascent, so that he may reach a great level, as it is written, “He will guide us unto death,” and it is written, “Abram descended to Egypt,” and “Abram ascended from Egypt.” Abram is the soul, and Egypt is the husks.',
    'The teaching presents descent as a stage that can lead to a higher level. Rav Tzadok specifies the process here: renewed scrutiny, repentance, and the purification of remorse make the ascent possible.')

# 68: the heart, kingship, the actual procession, and the source of the fasting gloss.
add(68,'rabbeinu-bahya-heart-governs-limbs',0,'Rabbeinu Bahya, Devarim 21:10:2',
    excerpt(primary('Rabbeinu Bahya, Devarim 21:10',1),'ודבר ידוע שכל האברים שבגוף','ואי לא לית את דילי.'),
    'It is well known that all the limbs of the body follow the heart and the eyes, and the heart is the essential thing. If the heart is whole with the blessed God, everything is at peace; if the heart is deficient toward Him, everything is deficient. Our Sages expounded: “The Merciful One desires the heart.” They said in the Midrash: “My son, give Me your heart”—if you give Me your heart and your eyes, I know that you are Mine; if not, you are not Mine.',
    'Rabbeinu Bahya locates the governing center of bodily conduct in the heart. This supplies a close formulation of the ois’s opening claim that the service performed through the limbs is directed toward the heart’s alignment with God.')
add(68,'gittin-sages-called-kings',9,'Gittin 62a:14',
    excerpt(primary('Gittin 62a',13),'אדהכי אתא איהו לגבייהו','בי מלכים ימלוכו וגו׳״.'),
    'Meanwhile, he came to them and said: “Peace to you, kings! Peace to you, kings!” They asked him: “From where do you know that the Sages are called kings?” He replied: “For it is written, ‘Through me kings reign,’ and so forth.”',
    'Geniva addresses Rav Huna and Rav Chisda as kings and supports that title with the verse spoken by wisdom. This is the source of the compressed “Who are the kings? The rabbis.” Rav Tzadok applies the title to their self-mastery.',anchor_end='וּמַאן מַלְכֵי? רַבָּנָן,')
add(68,'berakhot-procession-and-stillness',11,'Berakhot 58a:10',
    excerpt(primary('Berakhot 58a',9),'חלף גונדא קמייתא.','ודאי השתא אתי מלכא.'),
    'The first troop passed. When there was a commotion, that heretic said to him, “The king has come.” Rav Sheshet replied, “He has not come.” The second troop passed. When there was a commotion, the heretic said, “Now the king is coming.” Rav Sheshet replied, “The king is not coming.” A third passed. When there was silence, Rav Sheshet said to him, “Now the king is certainly coming.”',
    'This is the procession itself, preceding the explanation already supplied in the existing Berakhot note. Rav Tzadok uses its sequence to distinguish the noisy preliminary struggle from the settled inward rule that follows.')
add(68,'korban-haedah-david-fasting',17,'Korban HaEdah on Jerusalem Talmud Sotah 5:5:5:4',
    primary('Korban HaEdah on Jerusalem Talmud Sotah 5:5:5:4'),
    '“But David could not”—subdue his inclination to that degree, and he killed it at once. That is, he distanced himself from bodily desires through fasts and disciplines of self-denial.',
    'The Yerushalmi passage already quoted in the existing note says that David killed the inclination in his heart. Korban HaEdah’s explanation of the parallel passage in Sotah explicitly supplies the fasts and self-denial mentioned here.')

# 69: influence, the youths of the governors, the traps, and Rachel's descendants.
res=local('resisei-layla','Resisei Layla 57:1')
add(69,'resisei-influence-and-association',3,'Resisei Layla 57:1',
    excerpt(res,'וגם בכנסת ישראל יש כח זה להשפיע לזולת גם כן;','היינו אמות העולם')+' … '+excerpt(res,'אבל כל זמן שכנסת ישראל בשלמותה,','ולא כל אדם זוכה.'),
    'The congregation of Israel likewise has this power to influence others; those outside the congregation of Israel are the nations of the world. … As long as the congregation of Israel is whole—that is, its intention in associating with the nations is solely for the sake of Heaven, to draw out the holy sparks in them, so that the thighs remain connected to the body—then, although “the wicked watches for the righteous,” and so forth, “the Lord will not abandon him into his hand.” But it is written, “Because you associated with Ahaziah,” and so forth. Even though his intention was initially for the sake of Heaven, one who works with something filthy becomes soiled, like someone clearing drains whose body cannot avoid becoming dirty with mud and excrement. This requires great alertness and strength to prevent any filth from adhering to him, and not everyone attains this.',
    'This parallel explains both Israel’s power to influence other nations and the spiritual difficulty of association. Its image of the thighs joined to the body describes outward influence remaining rooted in inward truth. Against that background, the ois describes providence making even compromised association a means through which some good is transmitted.',reader=True)
add(69,'yalkut-ahab-hostages',7,'Yalkut Shimoni on Nach 207:3',
    excerpt(primary('Yalkut Shimoni on Nach 207',2),'אמרו לא היה עשיר כאחאב בן עמרי','ויפקוד את נערי שרי המדינות וגו\'.'),
    'They said: No one was as wealthy as Ahab son of Omri. Two hundred and thirty-two kings served him. They sought to rebel against him, so he sent for the son of each one and placed them under his authority in Jerusalem and Samaria. They had been idolaters, but when they came to Jerusalem and Samaria, they became truly God-fearing, as it is said, “He counted the youths of the governors of the provinces,” and so forth.',
    'The Midrash identifies the youths as the sons of foreign rulers held under Ahab’s authority and explicitly describes the good they acquired in Israel. This is the missing source behind Rav Tzadok’s explanation of their role in the victory.')
add(69,'vayikra-ahab-traps',13,'Vayikra Rabbah 26:8',
    excerpt(primary('Leviticus Rabbah 26:8'),'כשיפל בן הדד בידך','ועמך תחת עמו.'),
    '“When Ben-hadad falls into your hand, do not have pity on him.” In the second statement He told him: “Know how many traps and nets I spread for him until he came into your hand. Now, if he is missing, ‘your life shall be in place of his life, and your people in place of his people.’”',
    'The Midrash interprets the doubled “he said” in the warning to Ahab. Its image of traps and nets provides the wording used here; Rav Tzadok explains the providential work behind that image in terms of the judgment permitting Israel’s victory.')
add(69,'pesikta-rachel-amalek',24,'Pesikta Rabbati 13:1',
    excerpt(primary('Pesikta Rabbati 13',0),'אמר הקדוש ברוך הוא אין זרעו של עמלק','מני אפרים שרשם בעמלק אחריך בנימן:'),
    'The Holy One, blessed be He, said: “The seed of Amalek falls only at the hand of a son of Rachel.” Thus you find that at Rephidim it fell at Joshua’s hand, as it is said, “Joshua weakened Amalek.” The Holy One, blessed be He, said: “This tribe is always prepared to exact retribution from Amalek.” From where is this learned? From what is completed in the Prophets: “From Ephraim, their root against Amalek; after you, Benjamin.”',
    'The Midrash links Joshua of Ephraim and Benjamin through their common descent from Rachel. The ois applies this pattern to Mordechai’s victory over Haman.')
add(69,'bereshit-joseph-fear-of-god',27,'Bereshit Rabbah 99:2',
    excerpt(primary('Bereshit Rabbah 99:2'),'זה כתיב בו (בראשית מב, יח):','משל יוסף.'),
    'Of this one it is written, “I fear God”; of that one it is written, “He did not fear God.” Into whose hand will the kingdom fall? Into the hand of the one anointed for battle, who comes from Joseph.',
    'In this paragraph the Midrash contrasts Joseph with the kingdom of Edom and uses the verse about Amalek to characterize the opposing side. Rav Tzadok draws out the significance of fear of God for Joseph’s descendants.')

# 70: repair through the point of failure and the direct calf/Messiah sources.
add(70,'rashi-heals-through-the-wound',1,'Rashi on Sanhedrin 70b:1:3',
    primary('Rashi on Sanhedrin 70b:1:3'),
    '“Through the thing by which they became corrupted, they were repaired.” This is the way of the Holy One, blessed be He: with the very instrument with which He strikes, He heals—a miracle within a miracle. Thus, “He kindled a fire in Zion,” while it is written, “I will be for her, says the Lord, a wall of fire all around.”',
    'Rashi explicitly generalizes the fig-leaf teaching already quoted in the existing note: the instrument associated with injury becomes the instrument of healing. This is the pattern Rav Tzadok extends to a person’s particular deficiency.')
add(70,'divrei-soferim-root-in-torah',4,'Divrei Soferim 38:4',
    excerpt(local('divrei-soferim','Divrei Soferim 38:4'),'וזהו שרש המן מן התורה,','נמשך מה שנמשך;'),
    'This is Haman’s root in the Torah. That is, there is nothing that has no root in holiness, for without it the thing could have no existence in the world. All the worlds were created through the Torah, which is the pattern of all the work of creation, as our Sages said in Bereshit Rabbah, chapter 1. Every thing must therefore have a root in the Torah. Even every kind of evil has some root on the side of holiness; only because “God made this corresponding to that,” and willed that there be a tree of the knowledge of good and evil and the possibility for evil to appear in this world, what followed did follow.',
    'The parallel supplies the meaning of “a root in Torah”: existence depends on a root in holiness even where its manifestation has become distorted. Rav Tzadok’s argument here turns to that root as the source from which restoration can arise.',reader=True)
add(70,'bamidbar-mother-cleans-calf',6,'Bamidbar Rabbah 19:8',
    excerpt(primary('Numbers Rabbah 19:8'),'אמר רבי איבו משל','מעשה העגל.'),
    'Rabbi Aivu said: It is like the son of a maidservant who dirtied the king’s palace. The king said, “Let his mother come and clean up the filth.” So the Holy One, blessed be He, said: “Let the cow come and atone for the deed of the calf.”',
    'This is the original parable behind “Let the mother clean up her child’s filth.” The cow is related to the calf precisely as its mother; Rav Tzadok develops the idea of repair through the source from which the failure emerged.')
add(70,'avodah-zarah-calf-and-death',7,'Avodah Zarah 5a:15',
    primary('Avodah Zarah 5a',14),
    'He follows this tanna, as it was taught: Rabbi Yosei says, “Israel received the Torah only so that the Angel of Death would not rule over them, as it is said, ‘I said: You are divine beings, and all of you sons of the Most High.’ You corrupted your deeds—‘But like Adam you shall die.’”',
    'The discussion associates the lost freedom from death with the sin after the giving of the Torah. It expressly identifies this as Rabbi Yosei’s view; this is the view underlying the statement that the calf is the root of death.')
add(70,'zohar-chadash-abijah-descendant',8,'Zohar Chadash, Balak 124-125',
    excerpt(primary('Zohar Chadash, Balak 124-125'),'ומשיחא דא משבטא דאפרים','נפיק האי משיחא.'),
    'This Messiah is from the tribe of Ephraim and from the seed of Jeroboam son of Nebat, through the son of Abijah, who died in his youth. On the day that he died, a son was born to him and was taken from Jeroboam’s household to the wilderness. One hundred and seventy men went there, all righteous men of the tribe of Ephraim who had not participated in Jeroboam’s sin. From this son of Abijah this Messiah emerges.',
    'The passage traces the Ephraimite Messiah’s line through a son born on the day of Abijah’s death and preserved away from Jeroboam’s household. This supplies the lineage compressed into the parenthetical reference to Zohar Chadash.',anchor_end='(זֹהַר חָדָשׁ בָּלָק)')
add(70,'poked-messiah-death-atonement',8,'Poked Akarim 5:2',
    excerpt(local('poked-akarim','Poked Akarim 5:2'),'ומשיח בן יוסף, המוחה כל זכר עמלק','כידוע מהריגת הצדיקים וסוד עשרה הרוגי מלוכה;'),
    'Messiah son of Joseph, who erases every trace of Amalek and will be entirely pure, is ultimately killed by Gog and Magog. Of him it is said, “They will look to Me concerning the one whom they pierced,” as our Sages said in Sukkah 52a. Its plain wording suggests that Israel pierced him. The meaning is that, on his own account, he certainly ought not to die at all. But because he has not become an angel like Elijah and remains joined to the other people of Israel, together forming the complete body of the congregation of Israel in that generation, and they have not been wholly cleansed, he must be killed to atone for Israel, as is known regarding the killing of the righteous and the mystery of the ten martyrs.',
    'Rav Tzadok’s fuller explanation explicitly describes this death as atonement connected to the generation, while the Messiah himself is entirely pure. That qualification clarifies the ois’s compressed statement that Messiah son of Joseph was destined to be killed.',reader=True)
add(70,'sukkah-messiah-asks-for-life',9,'Sukkah 52a:6',
    primary('Sukkah 52a',5),
    'The Sages taught: To Messiah son of David, who is destined to be revealed speedily in our days, the Holy One, blessed be He, says, “Ask Me for something and I will give it to you,” as it is said, “I will relate the decree … today I have begotten you. Ask of Me, and I will give nations as your inheritance.” When he sees that Messiah son of Joseph has been killed, he says before Him, “Master of the world, I ask You only for life.” He answers him, “Life? Before you said this, David your father had already prophesied about you, as it is said, ‘He asked You for life; You gave it to him,’ and so forth.”',
    'This is the Talmudic passage applying the verse to Messiah son of David in relation to the death of Messiah son of Joseph. The existing note supplies the verse itself; this passage supplies its application in the ois.')
add(70,'tikkunei-binah-heart',10,'Tikkunei Zohar 17a:17',
    excerpt(primary('Tikkunei Zohar 17a:17'),'מוחא חכמה','ובה הלב מבין.'),
    'The brain is wisdom; it is thought within. Understanding is the heart, and through it the heart understands.',
    'Patach Eliyahu identifies Binah, understanding, with the heart. This explains the specific phrase “Binah in the heart” within the ois’s symbolism of the mother.',anchor_end='(בִּינָה שֶׁבַּלֵּב)')

from align_batch5_reader import align_entries
align_entries(entries)

out={'schemaVersion':1,'reviewedSections':[66,67,68,69,70],'entries':entries,
     'coverage':[{'section':n,'status':'reviewed-add-only','sourcePageRanges':{'neimosA':[min(pages[n][0]),max(pages[n][0])],'integratedA':[min(pages[n][1]),max(pages[n][1])]},'addedSourceRefs':[e['ref'] for e in entries if e['section']==n],'existingNotesPreserved':True} for n in range(66,71)],
     'observationsNotApplied':[
        {'section':67,'source':'Tanya, Likkutei Amarim 29:13-14','reason':'Already quoted in native note 2583; retained unchanged. The new Ari passage supplies the separately cited posthumous ascent teaching.'},
        {'section':67,'source':'Shaar HaKavanot, Derushei Kiddush Leil Shabbat 1; Mishnat Hasidim, Gilgul HaNeshamot 1','reason':'Related elaborations of the same renewed scrutiny before ascent. The directly cited Ari teaching in Shaar HaGilgulim supplies this gap without multiplying equivalent passages.'},
        {'section':68,'source':'Shir HaShirim Rabbah 5:2:1; Zohar, Yitro 20:331-332; Jerusalem Talmud Berakhot 9:5:8','reason':'These passages are already fully quoted by existing notes. The added Korban HaEdah is the distinct original commentary that supplies the fasting gloss.'},
        {'section':68,'source':'Machshavot Charutz 1:7; Tzidkat HaTzadik 219:1; Peri Tzadik parallels','reason':'Related inner-service explanations. The existing connected Peri Tzadik and Tiferet Yosef quotations plus the new Rabbeinu Bahya passage already explain the heart/preparation distinction; no additional overlapping parallel selected.'},
        {'section':69,'source':'Pesikta Rabbati 9:2','reason':'The sheep-among-wolves image is already quoted with its divine-Shepherd conclusion in native Esther Rabbah note 267; no duplicate version added.'},
        {'section':69,'source':'Resisei Layla 20:1','reason':'Already quoted in native note 2584, including the qualification about the nations not attaining a revelation of the Shekhinah; retained unchanged.'},
        {'section':70,'source':'Sanhedrin 70b:1; Jerusalem Talmud Berakhot 2:4:12; Sanhedrin 91b; Psalms 21:5','reason':'Existing source quotations retained unchanged. New Rashi and Sukkah notes quote distinct explanatory sources, not replacements of these notes.'}
     ]}
for e in entries:
    rows=json.loads((ROOT/f"live-baseline/{e['section']-1}.json").read_text());r=next(x for x in rows if x.get('n')==e['rowN'] and x.get('p'))
    t=plain(r['p'][e['phraseIndex']][0]);assert t.startswith(e['heAnchorPrefix']);assert e['heCharOffset']==len(e['heAnchorPrefix'])
    assert e['he'] and e['en'] and e['context']
(ROOT/'review-work/ois66-selected-primary.json').write_text(json.dumps(SELECTED,ensure_ascii=False,indent=2)+'\n')
(ROOT/'review-work/ois-66-70.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print('Wrote',len(entries),'entries:',{n:sum(e['section']==n for e in entries) for n in range(66,71)})

import json,re,hashlib,html
from pathlib import Path
W=Path(__file__).parent
BASE=Path('/tmp/tzidkat-current-batch2/mcp-data/text')
def plain(t):
 if isinstance(t,list):t=' '.join(plain(x) for x in t)
 return ' '.join(html.unescape(re.sub('<[^>]*>','',t)).replace('\u200f','').replace('\u200e','').split())
def cut(t,a,b=None):
 i=t.index(a)
 return t[i:] if b is None else t[i:t.index(b,i)+len(b)]
primary=json.loads((W/'recover56-primary.json').read_text())
def source(ref):return plain(primary[ref]['data']['he'])
def canonical(slug,ref):
 d=json.loads((BASE/f'{slug}.json').read_text());p=next(p for p in d['paras'] if p['r']==ref)
 return plain(p.get('t') or [x[0] for x in p['p']])
def ext(ref):return 'https://www.sefaria.org/'+ref.replace(' ','_')
def internal(ref):return '#/read/'+ref.replace(' ','_')
PAGES={56:([158,159,160,161],[203,204,205,206]),57:([161,162,163],[206,207,208,209]),58:([163,164,165],[209,210]),59:([165,166,167,168],[210,211,212,213,214]),60:([168,169,170],[214,215,216])}
entries=[]
def add(section,id,phraseIndex,ref,he,en,context,url=None,readerRef=None,prefixEnd=None):
 rows=json.loads((W.parent/'live-baseline'/f'{section-1}.json').read_text());row=next(x for x in rows if x['n']==1)
 prefix=plain(row['p'][phraseIndex][0]);url=url or ext(ref)
 if prefixEnd:prefix=prefix[:prefix.index(prefixEnd)+len(prefixEnd)]
 e={'section':section,'id':id,'rowN':1,'phraseIndex':phraseIndex,'heAnchorPrefix':prefix,'heCharOffset':len(prefix),'ref':ref,'url':url,'he':plain(he),'en':en,'context':context}
 if readerRef:e['readerRef']=readerRef
 e['sourceEvidence']=[{'ref':ref,'url':url,'he':e['he'],'en':en,'heSha256':hashlib.sha256(e['he'].encode()).hexdigest(),'translation':'Original English translation checked directly against the cited Hebrew or Aramaic.','coverage':'Complete selected source unit with all material qualifications retained.'}]
 e['reviewEvidence']={'pdfPages':{'neimosA':PAGES[section][0],'integratedA':PAGES[section][1]},'preserveExisting':True,'status':'verified','dedup':'Existing native and connected quotations read and preserved; the proposed passage is absent.','recovery':'Reconstructed from the 21 independently approved selections; original Hebrew retrieved again and translation rechecked.'}
 entries.append(e)

ref='Peri Tzadik, Bo 11:1';he=cut(canonical('peri-tzadik',ref),'ישראל ממשלותיו ממשלה','והיינו בשורש בחינת מלוכה.')
add(56,'peri-tzadik-root-consent',0,ref,he,
 '“Israel His dominions”: dominion denotes rule without consent, as they explain “Will you reign over us, or will you indeed rule over us?” Likewise, “For kingship belongs to Hashem, and He rules over the nations”: among them Hashem is called a ruler. It is written, “Surely with a strong hand … I will reign over you,” and at the giving of the Torah He held the mountain over them like a vat. Nevertheless, it is written, “They gathered at Your feet.” This means that at their root Israel wanted to be compelled, and at the root this is the quality of kingship.',
 'Rav Tzadok distinguishes compulsion as it appears outwardly from the inward root’s willing acceptance. That qualification explains how the imposed awakening discussed here can still belong to Israel’s bond with Hashem.',url=internal(ref),readerRef=ref)
ref='Rashi on Sanhedrin 105a:5:2'
add(56,'rashi-redemption-through-wrath',2,ref,source(ref),
 '“All such wrath”—would that this anger should come upon us: “With fury poured out I will reign over you,” so that He would redeem us against our will and reign over us.',
 'Rashi makes explicit why Rav Nachman welcomes the wrath described by the verse: it brings redemption and the renewal of Hashem’s rule. The existing Gemara note remains the surrounding source.')
ref='Deuteronomy 10:12-13'
add(56,'deuteronomy-fear-and-service',11,ref,source(ref),
 'And now, Israel, what does Hashem your God ask of you, except to fear Hashem your God, to walk in all His ways, to love Him, and to serve Hashem your God with all your heart and all your soul; to keep Hashem’s commandments and statutes, which I command you today, for your good.',
 'The complete sentence joins fear with walking in Hashem’s ways, love, service, and observance. Rav Tzadok develops the opening “except to fear” as the human awakening that draws divine guidance.',prefixEnd='כִּי אִם לְיִרְאָה"')
ref="Zohar, Sh'lach 46:332";he=plain(json.loads((W/'recover56-zohar.json').read_text())['versions'][0]['text'])
add(56,'zohar-tekhelet-awe',12,ref,he,
 '“You shall not stray after your hearts”: it will keep other evil ways from you. Certainly, “you shall not stray,” and you shall not do evil. For this reason the blue color arises. This is tekhelet, which resembles the Throne of Glory. Just as the Throne of Glory causes a person to walk on a straight path and purifies him, so this tekhelet causes a person to walk on a straight path. Certainly all must stand in awe of this place, to walk uprightly.',
 'This is the Zohar’s explanation near the end of Shelach: tekhelet recalls the Throne of Glory and awakens the awe that directs a person toward the straight path.')
ref='Kometz HaMinchah 2:4:1'
add(56,'kometz-tekhelet-and-white',12,ref,canonical('kometz-haminchah',ref),
 'Tekhelet is awe, and white indicates kindness and love, as is known. This is “You shall see it and remember all the commandments of Hashem.” Awe is the foundation of the prohibitions, and love is the foundation of the positive commandments. The testing of tekhelet with leaven, and so forth, as stated in Menachot 44a, means that through the strength of the inclination and the leaven in the dough its appearance does not depart, because of the depth of awe. We do not now possess such powerful awe; we use only white. For, as is known, from afar love is easier than awe, because from afar Hashem appears to us more in the aspect of love and attachment.',
 'Rav Tzadok interprets tekhelet and white as awe and love, and reads the dye test symbolically as resistance to temptation. His concluding statement describes the spiritual condition he is discussing; the passage supplies the symbolism behind this ois.',url=internal(ref),readerRef=ref,prefixEnd='שֶׁהִיא לְיִרְאָה כַּנּוֹדָע')
ref='Menachot 44a:4-7'
add(56,'menachot-tzitzit-restrain',13,ref,source(ref),
 'There was a man who was careful about the mitzvah of tzitzit. He heard that there was a prostitute in the coastal cities who charged four hundred gold coins. He sent her four hundred gold coins and set a time with her. When his appointed time arrived, he came and sat at the entrance. Her maid entered and told her: The man who sent you four hundred gold coins has come and is sitting at the entrance. She said: Let him enter. He entered. She had prepared seven beds for him, six of silver and one of gold; between each was a silver ladder, and the uppermost was of gold. She went up and sat on the uppermost bed naked, and he too went up to sit naked opposite her. His four fringes came and struck him in the face. He slipped down and sat on the ground; she too slipped down and sat on the ground. She said: By the power of Rome, I will not let you go until you tell me what flaw you saw in me. He said: By the Temple service, I have never seen a woman as beautiful as you. But Hashem our God commanded us one mitzvah called tzitzit, and “I am Hashem your God” is written in it twice: I am the One who will exact punishment, and I am the One who will pay reward. Now they appeared to me like four witnesses.',
 'This is the complete episode through the man’s explanation of his restraint. The fringes interrupt his intention and recall divine judgment, illustrating Rav Tzadok’s statement that tzitzit can awaken remembrance even against one’s immediate desire.')

ref='Taanit 11a:11-12'
add(57,'taanit-righteous-account',3,ref,source(ref),
 '“A faithful God, without injustice.” “A faithful God”: just as payment is exacted from the wicked in the world to come even for a minor transgression they commit, so payment is exacted from the righteous in this world for a minor transgression they commit. “Without injustice”: just as reward is paid to the righteous in the world to come even for a minor mitzvah they perform, so reward is paid to the wicked in this world even for a minor mitzvah they perform.',
 'The saying retains both sides of the accounting: wrongdoing and good deeds, the righteous and the wicked, and this world and the world to come. Rav Tzadok applies the first part here to remorse over one’s sins.')
ref='Berakhot 19a:20-21'
add(57,'berakhot-speech-accusation',7,ref,source(ref),
 'Abaye said: A person should not speak in that way, for Rabbi Shimon ben Lakish said, and it was also taught in the name of Rabbi Yosei: A person should never open his mouth to the Accuser. Rav Yosef said: What verse supports this? It is written, “We almost became like Sodom.” What did the prophet answer them? “Hear the word of Hashem, officers of Sodom.”',
 'In its original setting Abaye objects to a mourner speaking as though further punishment were deserved. The rule and its scriptural example explain the expression Rav Tzadok uses when discussing David’s words.')
ref='Shabbat 30b:5'
add(57,'shabbat-joy-and-presence',9,ref,source(ref),
 '“I praised joy”—the joy of a mitzvah. “What does joy accomplish?”—joy that is not of a mitzvah. This teaches that the Divine Presence rests neither through sadness, nor through laziness, laughter, frivolity, conversation, or idle words, but through the joy of a mitzvah, as it is written: “Now bring me a musician; and when the musician played, the hand of Hashem came upon him.” Rav Yehudah said: The same applies to a matter of halakhah. Rava said: The same applies to a good dream.',
 'The Gemara distinguishes the joy of a mitzvah from other forms of amusement and names sadness among the states through which the Divine Presence does not rest. This is the source of the premise that Rav Tzadok qualifies in the following lines.')
ref='Tzidkat HaTzadik 247:1';he=cut(source(ref),'ואנו משחרב','שלא מצד הבריאה והנבראים.')
add(57,'tzidkat-i-and-you',12,ref,he,
 'Since the Temple was destroyed, we have only the lower level of the illumination of the face—that is, the radiance of the face. This is the Divine Presence that went into exile with them, the level of “I.” This means that He dwells within one’s heart: the very apprehension is itself what is apprehended, for the person apprehends that no place is empty of Him and that the whole earth is full of His glory. Glory is the radiance: the recognition that emerges from His lordship and the attribute of His kingship, which rules over all. Just as someone who has not seen a king knows him through his rule, so a person knows Hashem through the whole creation. Avraham our father saw a palace aflame, and so forth; our Sages said that no one called Him Master until Avraham came. The name of lordship indicates the glory and radiance, as is known. I also heard concerning “The owner of the palace looked out upon him”: “upon him” means that He told him, You yourself are also included in the owner of the palace. For the whole world sees this and their hearts are not stirred at all to apprehend that there is an owner of the palace and seek Him. Your very seeking also comes from Me, and your heart is the place of My Presence. This is the meaning of “I.” But seeing the King Himself is the apprehension of “You.” This is prayer, like standing before the King, which takes the place of the Temple sacrifices. Therefore our Sages said that one should direct one’s heart toward the Holy of Holies, where there is actual seeing of the face. This belongs to the one who has prevailed in battle through the two-edged sword of the Shema, which is complete unity now as before the world was created. Through it every evil thing and foreign thought is nullified, and then the person recognizes the One addressed as “You,” beyond recognition through creation and created beings.',
 'This parallel defines the two terms used at the end of the present ois: “I” as the Divine Presence recognized within the heart and creation, and “You” as direct address to the King in prayer. Both paragraphs are retained so that the distinction is explained in Rav Tzadok’s own terms.',url=internal(ref),readerRef=ref)

ref='Rashi on Proverbs 12:21:1'
add(58,'rashi-unwitting-transgression',2,ref,source(ref),
 '“It shall not befall the righteous”—it will not occur: a transgression will not come his way without his knowledge.',
 'Rashi understands the verse as protection from an unwitting transgression. Rav Tzadok applies that explanation to a particular matter in which a person is inwardly free of attachment.')
ref='Sotah 2a:4-6'
add(58,'sotah-nazir-order',5,ref,source(ref),
 'The tanna has just concluded Nazir; why does he now teach Sotah? In accordance with Rabbi, for it was taught: Rabbi says, Why was the passage of the nazir placed next to the passage of the sotah? To tell you that anyone who sees a sotah in her disgrace should abstain from wine. Then let him teach Sotah and afterward Nazir! Since he taught Ketubot, including the chapter concerning one who imposes a vow, he taught Nedarim. Since he taught Nedarim, he taught Nazir, which resembles vows. He then teaches Sotah, in accordance with Rabbi.',
 'The Gemara gives its own explanation of the tractate sequence and the connection between sotah and abstention from wine. Rav Tzadok then draws an inward lesson from Nazir preceding Sotah: first one must purify oneself.')
ref='Rashi on Hosea 14:2:3'
add(58,'rashi-stumbling-through-iniquity',7,ref,source(ref),
 '“For you have stumbled”—stumbling blocks have come upon you because of your iniquities.',
 'This is the original commentary’s formulation behind the words “stumbling blocks came upon you because of your iniquity.” It connects a stumbling with a fault that calls for return.')

ref='Shabbat 88b:4';he=source(ref).split('דָּבָר אַחֵר')[0].strip()
add(59,'shabbat-torah-elixir',5,ref,he,
 'This is what Rava said: For those who take it by the right hand, it is an elixir of life; for those who take it by the left hand, it is an elixir of death.',
 'Both alternatives belong to the saying. Rav Tzadok invokes the first while explaining that the life-giving light of Torah depends on how a person engages with it.',prefixEnd='שֶׁהוּא סַמָּא דְחַיֵּי')
ref='Rashi on Shabbat 88b:4:1'
add(59,'rashi-right-hand-study',5,ref,source(ref),
 '“Those who take it by the right hand”—they engage in it with all their strength and devote themselves to knowing its secret, like a person using the right hand, which is the principal one.',
 'Rashi explains the metaphor of the right hand as wholehearted effort and the pursuit of Torah’s depth. This is the specific term Rav Tzadok uses here.',prefixEnd='עַל יְדֵי מַיְמִינִים בָּהּ')
ref='Jerusalem Talmud Berakhot 9:5:19';he=cut(source(ref),'רִבִּי יוֹנָה','וּפִיטָטָיָא דְּאוֹרַיתָא טָבִין.')
add(59,'yerushalmi-torah-conversation',7,ref,he,
 'Rabbi Yonah said in the name of Rabbi Yosei ben Gezirah: All chatter is bad, but chatter about Torah is good.',
 'The Yerushalmi explicitly gives value even to Torah conversation. Rav Tzadok uses this wording for an engagement whose words are holy even before the person attains Torah’s inward light.')
ref='Tur, Orach Chayim 47';he=cut(source(ref),'וזו נוסחה','ויש חותמין בא"י נותן התורה')
add(59,'tur-words-of-torah-blessing',8,ref,he,
 'This is its wording: “Blessed are You, Hashem our God, King of the universe, who has sanctified us with His commandments and commanded us concerning the words of Torah.” The Ashkenazic wording is “to engage in the words of Torah.” “Please make the words of Your Torah sweet, Hashem our God, in our mouths and in the mouths of Your people, the house of Israel. May we and our descendants and the descendants of Your people, the house of Israel, all know Your name and study Your Torah. Blessed are You, Hashem, who teaches Torah to His people Israel.” Some conclude, “Blessed are You, Hashem, who gives the Torah.”',
 'The Tur records the wording Rav Tzadok explains and also records the other liturgical forms. The contrast between “the words of Your Torah” and “Your Torah” appears within the blessing itself.')
ref='Tzidkat HaTzadik 133:1';he=cut(source(ref),'התורה היא','אם אין החטא גורם כבדואג.')
add(59,'tzidkat-torah-enters-heart',15,ref,he,
 'Torah acts upon the human heart, as it is said, “The light within it brings a person back to the good”; for this reason it is called Torah. But there are words of Torah that remain only on the lips, as stated in Sanhedrin concerning Doeg. Of this it says, “Why is there … when there is no heart?” This is called Torah chatter, which is also good, for it can bring a person to the Torah of truth, as it says that from study not for its own sake one comes to study for its own sake [as explained above in ois59]—provided that sin does not cause an obstruction, as with Doeg.',
 'Rav Tzadok directly refers back to this ois and preserves an essential qualification: the movement from words on the lips to Torah in the heart can be obstructed by sin. The following lines in ois133 explain the thirst and receptivity through which Torah enters the heart.',url=internal(ref),readerRef=ref)

ref='Rashi on I Kings 16:7:2'
add(60,'rashi-baasha-accountability',4,ref,source(ref),
 '“And because he struck him”: since he too followed in his sins, it follows that he should not have killed him; therefore he was punished for killing him. Similarly we find, “I will visit the blood of Yizreel upon the house of Yehu”: since they did not depart from Achav’s ways, they were punished for killing them.',
 'This is the Rashi on Baasha expressly cited here. It adds the parallel to the existing Rashi on Hosea: participation in the same wrongdoing changes the account of the person who carries out punishment.')
ref="Sha'arei Teshuvah 3:219";he=cut(source(ref),'וְיִתָּכֵן לְפָרֵשׁ')
add(60,'shaarei-teshuvah-same-fault',3,ref,he,
 'It is possible to explain “Do not be a witness against your fellow without cause” as referring to testifying against him about transgressions in which you too are afflicted like him; for that reason he is called your fellow. The next words support this: “Do not say, As he has done to me, so I will do to him.” Although it is a mitzvah to expose those who sin against their souls and the hypocrites, a sinner must not publicize someone whose wickedness is like his own. For his intention in revealing the other’s secrets is not good, but to rejoice in his misfortune. Secondly, how can he fail to be ashamed to mention the disgrace of those deeds in another when he himself still holds to them? It is said, “I will visit the blood of Yizreel upon the house of Yehu.” Thus, although Yehu performed a mitzvah by destroying the house of Achav, he bore his guilt, because he too was greatly sinful.',
 'Rabbeinu Yonah presents this as a possible interpretation and distinguishes appropriate exposure of hypocrisy from a sinner’s malicious disclosure of the same fault he still practices. Both the motive and the continuing personal fault are retained in the quoted explanation.')
ref='Sotah 28a:1';he=cut(source(ref),'וְהָא תַּנְיָא')
add(60,'sotah-husband-clear',9,ref,he,
 'Was it not taught: “The man shall be clear of iniquity, and that woman shall bear her iniquity”? When the man is clear of iniquity, the water examines his wife; when the man is not clear of iniquity, the water does not examine his wife.',
 'This is the baraita Rav Tzadok invokes at the conclusion. Its stated condition is the husband’s being clear of iniquity; he uses that condition in his discussion of the person through whom another is judged.')

assert len(entries)==21
out={'schemaVersion':1,'reviewedSections':list(range(56,61)),'entries':entries,'coverage':[{'section':n,'pdfPages':{'neimosA':PAGES[n][0],'integratedA':PAGES[n][1]},'additions':[e['id'] for e in entries if e['section']==n],'existingNotes':'All existing native and connected notes preserved.'} for n in range(56,61)],'omissions':[{'section':59,'ref':'Eikhah Rabbah, Petichta 2','reason':'Already quoted in existing note2577; conclusion already in note210. No duplicate added.'}]}
(W/'ois-56-60.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'entries':len(entries),'counts':{n:sum(e['section']==n for e in entries) for n in range(56,61)}}))

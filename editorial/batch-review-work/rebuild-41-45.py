import json,re,hashlib,html
from pathlib import Path
W=Path(__file__).parent
BASE=Path('/tmp/tzidkat-current-batch2/mcp-data/text')
def plain(t):
    if isinstance(t,list):t=' '.join(plain(x) for x in t)
    return ' '.join(html.unescape(re.sub('<[^>]*>','',t)).replace('\u200f','').replace('\u200e','').split())
def bare(t):return re.sub('[\u0591-\u05c7]','',plain(t))
def cut(t,a,b=None):
    i=t.index(a)
    return t[i:] if b is None else t[i:t.index(b,i)+len(b)]
primary=json.loads((W/'root-primary-recovered.json').read_text())
tzprimary=json.loads((W/'tzidkat-root-primary.json').read_text())
def source(ref):return plain(primary[ref]['data']['he'])
def tz(n):return plain(tzprimary[f'Tzidkat HaTzadik {n}:1']['data']['he'])
def canonical(slug,ref):
    d=json.loads((BASE/f'{slug}.json').read_text());p=next(p for p in d['paras'] if p['r']==ref)
    return plain(p.get('t') or [x[0] for x in p['p']])
def ext(ref):return 'https://www.sefaria.org/'+ref.replace(' ','_')
def internal(ref):return '#/read/'+ref.replace(' ','_')
PAGES={41:([116,117,118],[162,163,164]),42:([118,119,120,121],[164,165,166,167]),43:([121,122,123,124],[167,168,169]),44:([124,125],[169,170]),45:([125,126,127,128,129],[171,172,173,174])}
entries=[]
def add(section,id,phraseIndex,ref,he,en,context,url=None,readerRef=None,evidenceUrl=None):
    rows=json.loads((W.parent/'live-baseline'/f'{section-1}.json').read_text());row=next(x for x in rows if x['n']==1)
    prefix=plain(row['p'][phraseIndex][0]);url=url or ext(ref)
    e={'section':section,'id':id,'rowN':1,'phraseIndex':phraseIndex,'heAnchorPrefix':prefix,'heCharOffset':len(prefix),'ref':ref,'url':url,'he':plain(he),'en':en,'context':context}
    if readerRef:e['readerRef']=readerRef
    e['sourceEvidence']=[{'ref':ref,'url':evidenceUrl or url,'he':e['he'],'en':en,'heSha256':hashlib.sha256(e['he'].encode()).hexdigest(),'translation':'Original English translation prepared directly from the cited Hebrew or Aramaic.','coverage':'Complete selected source unit; context and relevant qualifications retained.'}]
    e['reviewEvidence']={'pdfPages':{'neimosA':PAGES[section][0],'integratedA':PAGES[section][1]},'preserveExisting':True,'status':'verified','dedup':'Existing native and connected notes compared; this selected source passage is absent.','recovery':'Reconstructed from the original source pages and newly retrieved primary Hebrew after the workspace reset.'}
    entries.append(e)

add(41,'rambam-first-existence',1,'Mishneh Torah, Foundations of the Torah 1:1',source('Mishneh Torah, Foundations of the Torah 1:1'),
    'The foundation of foundations and the pillar of wisdoms is to know that there is a first existent. He brings every existent into being. All beings, from heaven and earth and everything between them, exist only through the truth of His existence.',
    'Rambam begins the laws of the foundations of Torah with knowledge of Hashem’s existence. This supplies the original formulation behind the contemplation of “I am” and “He exists” at this point in the ois.')
avot=source('Pirkei Avot 4:11').split('רַבִּי יוֹחָנָן')[0].strip()
add(41,'avot-advocate-and-accuser',7,'Pirkei Avot 4:11',avot,
    'Rabbi Eliezer ben Yaakov says: One who performs one mitzvah acquires one advocate for himself; one who commits one transgression acquires one accuser for himself. Repentance and good deeds are like a shield against calamity.',
    'This is the Mishnah’s formulation of the advocate created through a mitzvah. The existing Tanchuma note describes an angel assigned to guard the person; this related source supplies the advocate-and-accuser formulation.')
ref='Tzidkat HaTzadik 129:1';he=cut(tz(129),'מיד שאדם','(שהש"ר ה ב).')
add(41,'tzidkat-growing-divine-assistance',12,ref,he,
    'As soon as a person wishes to return, he is already “coming to be purified,” and the rule is to assist him, as stated in Yoma 38b. When he is assisted, a spirit of purity is naturally added to him, and he comes further toward purification. Then the assistance from above returns with greater strength, and he in turn comes further toward purification below. This continues in a cycle, until an opening like the point of a needle becomes like the entrance of a great hall, as our Sages said in Shir HaShirim Rabbah 5:2.',
    'Rav Tzadok explains the growing opening as a succession of human beginnings and divine assistance. Later in that ois he asks why repentance sometimes remains incomplete and directs the person to seek heavenly mercy, with confidence joined to remorse.',url=internal(ref),readerRef=ref)
ref='Tzidkat HaTzadik 152:1';he=cut(tz(152),'ואתעדל"ת')
add(41,'tzidkat-needle-through-heart',11,ref,he,
    'The awakening from below must come first. Concerning this they said, “Open for Me like the point of a needle”: any amount of fear of Heaven is sufficient, and a corresponding measure of wisdom will then be imparted to his heart. Through that wisdom he will naturally gain more fear, and then more wisdom will come. The cycle continues until there are openings of the kind described there. The earlier teachers said: provided that the hole passes through from one side to the other. This means that there must be, from the depths of his heart, a complete awakening to abandon sin and leave all worldly concerns; even a single moment is sufficient.',
    'The parallel explains the quality of the small opening: it must reach through the heart. Its final qualification requires a sincere abandonment of sin, even when the initial awakening lasts only a moment.',url=internal(ref),readerRef=ref)

r=json.loads((W/'rashi-recovered-0.json').read_text());he=plain(r['versions'][0]['text'][19])
add(42,'rashi-offering-for-your-benefit',3,'Rashi on Menachot 110a:20:1-3',he,
    '“So that you would say: I will do His will”—by offering Him a sacrifice, and He will do my will, because He needs it and I can bribe Him. “You do not sacrifice for My desire”—that is, not for My benefit, for I do not wish to burden you to act against your will. “For your desire”—for your own need, to fulfill My commandments, so that through this there will be atonement for you.',
    'Rashi explains all three parts of the saying: the mistaken attempt to bargain with God, God’s lack of need, and the benefit to the worshipper. These qualifications clarify the distinction Rav Tzadok applies to prayer.')
add(42,'vayikra-king-table-parable',7,'Vayikra Rabbah 22:8',source('Vayikra Rabbah 22:8'),
    'Rabbi Pinchas said in the name of Rabbi Levi: A parable of a king’s son who became presumptuous and was accustomed to eating the flesh of animals that had died or were torn. The king said: Let him always be at my table, and he will be restrained of himself. So too, because Israel were passionately attached to idolatry in Egypt and brought their sacrifices to the goat-demons—as it is written, “They shall no longer sacrifice their sacrifices to the goat-demons”; these are demons, as it says, “They sacrificed to demons,” and the demons are called goat-demons, as it says, “Goat-demons shall dance there”—they offered their sacrifices on forbidden high places, and calamities came upon them. The Holy One, blessed be He, said: Let them always bring their sacrifices before Me in the Tent of Meeting; they will separate from idolatry and be saved. This is what is written: “Any man of the house of Israel,” and so forth.',
    'This is the original Midrash’s parable of the king’s table. Its application is the redirection of Israel’s offerings away from idolatry and toward the Tent of Meeting.')
ramban=source('Ramban on Leviticus 16:8');he=cut(ramban,'וְזֶה סוֹד הָעִנְיָן','נְאֻם ה\' אֱלֹהִים".')
add(42,'ramban-offerings-intermediate-powers',9,'Ramban on Leviticus 16:8',he,
    'This is the secret of the matter: they used to worship other gods, namely the angels, offering sacrifices to them, and these were a pleasing aroma to them. This is like what is said: “My oil and My incense you placed before them; and My bread that I gave you—fine flour, oil, and honey with which I fed you—you placed before them as a pleasing aroma. And so it was, says the Lord God.”',
    'Ramban is discussing offerings directed to intermediate powers. In the continuation he explicitly forbids accepting them as gods or worshipping them, and explains that Israel’s intention in the commanded service must be to fulfill the Creator’s will.')

n=primary['Nedarim 27a']['data']['he']
add(43,'nedarim-exemption-under-compulsion',2,'Nedarim 27a:6-8',plain(n[5:8]),
    'A certain man deposited his supporting documents in court and said: If I do not come within thirty days, let these documents be void. He was prevented by circumstances beyond his control and did not come. Rav Huna said: His documents are void. Rava said to him: He was under compulsion, and the Merciful One exempts one under compulsion, as it is written, “You shall do nothing to the young woman.” And if you say that a capital case is different, did we not learn: Vows prevented by circumstances beyond one’s control—one’s fellow imposed a vow that he should eat with him, but he or his son became ill, or a river prevented him—these are vows prevented by circumstances beyond one’s control!',
    'This is the Talmudic formulation “the Merciful One exempts one under compulsion.” Its immediate discussion concerns court documents and vows. Rav Tzadok’s application to an overwhelming inner trial is followed by his express warning that a person cannot establish this claim about himself.')
recovered=json.loads((W/'engineer-recovered-2757-2770-2774.json').read_text())['entries']
for number in [2770]:
    e=next(e for e in recovered if e['originalNumber']==number)
    add(e['section'],e['id'],e['phraseIndex'],e['ref'],e['he'],e['en'],e['context'],url=e['url'],readerRef=e.get('readerRef'),evidenceUrl=e['originalEvidenceUrl'])
r=json.loads((W/'rashi-recovered-1.json').read_text());he=plain(r['versions'][0]['text'][11])
add(43,'rashi-inclination-imposed-by-force',7,'Rashi on Ketubot 51b:12:1',he,
    '“The inclination clothed her”—this too is compulsion, because at the beginning of intercourse, which was forced, the assailant clothed her in desire.',
    'Rashi is explaining a case that began with rape: the desire that followed was itself imposed by the initial assault. Rav Tzadok cites this explanation as the specific basis for his analogy; the existing Gemara note supplies the surrounding case.')
ref='Tzidkat HaTzadik 88:1';he=cut(tz(88),'ומי שבעיניו')
add(43,'tzidkat-sincere-heart-self-assessment',11,ref,he,
    'What is someone who sees his way as straight to do? According to his own understanding, he is walking uprightly. Concerning this it says, “Hashem weighs hearts.” When a person’s heart is whole, Hashem does not cause him to err and be misled, and He does not act unfairly. Rather, it is the crookedness within the heart that causes the error.',
    'The parallel places the problem of mistaken self-assessment in the heart’s sincerity. It supports the warning here that one’s own conviction does not by itself establish that a transgression was unavoidable.',url=internal(ref),readerRef=ref)

ref='Tzidkat HaTzadik 248:1';he=cut(tz(248),'עיקר האדם','ולכך יצ"ר ג"כ גדול.')
add(44,'tzidkat-desire-and-opposed-inclinations',1,ref,he,
    'The essence of a person is the desire in the heart, through which he has an advantage over the angels. This is called inclination: the good inclination and the evil inclination. When he strengthens his desire toward good, it is good; otherwise, the reverse. Our Sages said: Whoever is greater than his fellow has a greater inclination. For one person’s greatness over another is only according to the greatness of his desire for good, which is the power of inclination. The good inclination and the evil inclination stand opposite one another in the heart’s two chambers: according to the desire in his heart on the right for good, so it is on the left for evil. Therefore the evil inclination is also greater.',
    'This is Rav Tzadok’s direct explanation of the correspondence between strong desire for good and strong temptation. The opening makes the direction of the desire decisive; its strength alone does not establish virtue.',url=internal(ref),readerRef=ref)
e=next(e for e in recovered if e['originalNumber']==2774)
add(e['section'],e['id'],e['phraseIndex'],e['ref'],e['he'],e['en'],e['context'],url=e['url'],readerRef=e.get('readerRef'),evidenceUrl=e['originalEvidenceUrl'])
he=plain(json.loads((W/'extra-recovered-1.json').read_text())['versions'][0]['text'])
add(44,'sukkah-mountain-and-hair',5,'Sukkah 52a:4',he,
    'As Rabbi Yehudah expounded: In the future, the Holy One, blessed be He, will bring the evil inclination and slaughter it before the righteous and before the wicked. To the righteous it appears like a high mountain; to the wicked it appears like a strand of hair. These weep and those weep. The righteous weep and say: How were we able to overcome such a high mountain? The wicked weep and say: How were we unable to overcome this strand of hair? Even the Holy One, blessed be He, marvels with them, as it is written: “Thus says Hashem of hosts: If it is wondrous in the eyes of the remnant of this people in those days, it will also be wondrous in My eyes.”',
    'The full saying includes the tears of both groups and Hashem’s wonder. Rav Tzadok explains here how the mountain and the hair can both be true descriptions, corresponding to different strengths of desire.')

sifrei=source('Sifrei Bamidbar 42');he=cut(sifrei,'גדול השלום שניתן לעושי תשובה','אין שלום אמר ה\' לרשעים.')
add(45,'sifrei-peace-penitents-righteous',3,'Sifrei Bamidbar 42:2',he,
    'Great is peace, for it was given to those who repent, as it is said: “Creating the fruit of the lips: Peace, peace to the far and to the near.” Great is peace, for it was given as the portion of the righteous, as it is said: “He shall enter peace; they shall rest upon their beds.” Great is peace, for it was not given as the portion of the wicked, as it is said: “There is no peace, says Hashem, for the wicked.”',
    'These three consecutive teachings join the same promises and rebuke from Isaiah 57 that Rav Tzadok reads together: peace for those who return, peace for the righteous, and the denial of peace to the wicked.')
he=plain(json.loads((W/'extra-recovered-0.json').read_text())['versions'][0]['text'])
add(45,'zohar-guarding-covenant-tzaddik',8,'Zohar, Noach 1:3',he,
    'Moreover, for this reason they are called righteous. From here we learn: whoever guards this covenant, upon which the world is sustained, is called righteous. From whom do we learn this? From Yosef. Because he guarded the covenant of the world, he merited being called righteous. Therefore: “Your people are all righteous; they shall inherit the land forever.”',
    'This passage, on Zohar I 59b, supplies the identification used here: the one who guards the covenant is called a tzaddik. Yosef is its example, and the passage connects that title with inheritance of the land.')
he=cut(source('Vayikra Rabbah 24:6'),'אָמַר רַבִּי יְהוּדָה','כִּי אִישׁ אֱלֹהִים קָדוֹשׁ הוּא,').rstrip(',')+'.'
add(45,'vayikra-holiness-sexual-boundaries',14,'Vayikra Rabbah 24:6',he,
    'Rabbi Yehudah ben Pazi said: Why was the passage of forbidden sexual relations placed next to the passage of “You shall be holy”? To teach you that wherever you find a boundary against forbidden sexual relations, you find holiness. This agrees with Rabbi Yehudah ben Pazi’s teaching that whoever guards himself against forbidden sexual relations is called holy. Rabbi Yehoshua ben Levi brings proof from the Shunammite woman, as it is written: “She said to her husband: Behold, I know that he is a holy man of God.”',
    'The Midrash explicitly connects holiness with maintaining the boundaries against forbidden sexual relations. This is the saying invoked as Rav Tzadok reads “holy” in Isaiah’s promise to dwell with the broken and lowly in spirit.')
ref='Peri Tzadik, Sefer Kedushat Shabbat 5:4';t=canonical('peri-tzadik',ref);he=cut(t,'וְיָדוּעַ טַעַם','וְהַכֹּל הוֹלֵךְ אַחַר כַּוָּנַת הַלֵּב כַּיָּדוּעַ.')
add(45,'kedushat-shabbat-divine-shadow',18,ref,he,
    'The meaning of “Hashem is your shadow” is known: He is like a shadow that does what the person does. Through an awakening below, an awakening is aroused above in all the actions a person performs; everything follows the intention of the heart, as is known.',
    'Rav Tzadok states the “shadow” teaching in his own Kedushat Shabbat. The point is the response above to the person’s inner intention and action; here he applies it to profound humility and renewal.',url=internal(ref),readerRef=ref)
ref='Tzidkat HaTzadik 108:1';he=cut(tz(108),'הוז"ל')
add(45,'tzidkat-torah-broken-heart-renewal',30,ref,he,
    'Concerning wasting seed, the Zohar says that repentance does not avail. This is because the drops of seed are drawn from the brain, and the person has damaged the drops of his brain. Repentance is in the heart, as it is written, “His heart will understand and he will return”; therefore it cannot repair wisdom, which is above it. Rather, Torah is needed, for it is the fallen fruit of the wisdom above, as stated in Bereishit Rabbah 17, and it too is in the brain. [It is called “being,” as is known; its numerical value equals that of keri, as I have written elsewhere.] A broken heart, becoming truly as nothing, belongs to keter, which, as is known, is higher still, and this avails. As it is written: “The face of Hashem is against evildoers”—this is that sin, which is called evil—“to cut off from the earth,” and so forth; as it says, “Your people are all righteous,” for inheritance of the land belongs only to the righteous, meaning the one who guards the covenant. It says, “They cried out,” and so forth: prayer is a remedy against being cut off from the earth. [Prayer is rooted in malkhut, the supernal land. His damage reached it, in the manner of “Hashem is your shadow”: exactly like a shadow, it does what he does, whether for good or, Heaven forbid, the reverse.] But to draw near to Hashem, the remedy is a broken heart: “And the crushed in spirit,” and so forth. Likewise, in the psalm “when he had come to Bathsheba,” which was composed concerning a breach of the covenant [which is present from birth, as it says, “For the inclination … from his youth”; therefore he asked, “Create in me a pure heart,” and creation is something new that now springs forth, being from nothing], it says, “For You do not desire a sacrifice,” and so forth [meaning repentance, in the sense of “Whoever sacrifices his inclination and confesses,” Sanhedrin 43b]: “The sacrifices of God are a broken spirit,” and so forth.',
    'This complete parallel explains why the severe Zohar formulation does not mean that return is impossible. Rav Tzadok describes Torah, prayer, and a broken heart, and ends with David’s request for the creation of a pure heart. These are the same themes of humility, creation anew, and healing developed in the present ois.',url=internal(ref),readerRef=ref,evidenceUrl=tzprimary[ref]['url'])

assert len(entries)==19
for e in entries:
    for v in e['sourceEvidence']:
        assert v['he']==e['he'] and v['en']==e['en']
coverage=[{'section':n,'status':'reviewed-additions','pdfPages':{'neimosA':PAGES[n][0],'integratedA':PAGES[n][1]},'additions':[e['id'] for e in entries if e['section']==n],'existingNotes':'All existing native and connected quotations preserved.'} for n in range(41,46)]
out={'schemaVersion':1,'reviewedSections':list(range(41,46)),'entries':entries,'coverage':coverage,'recovery':'Original passages rechecked after reset; the prior accepted Peri Tzadik entries retained exactly. Nedarim 27a added as an explicit original source named by both source editions.'}
(W/'ois-41-45.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'entries':len(entries),'counts':{n:sum(e['section']==n for e in entries) for n in range(41,46)}},indent=2))

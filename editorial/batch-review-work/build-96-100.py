import json, re, html, hashlib
from pathlib import Path

ROOT = Path('/workspace/scratch/f85ae98f1669')
WORK = ROOT / 'review-work'
BOOKS = ROOT / 'tmp/batch-engineering/current-site/mcp-data/text'
CACHE = json.loads((WORK / 'ois96-primary.json').read_text()) if (WORK / 'ois96-primary.json').exists() else {}
SNAPSHOT = json.loads((WORK / 'ois96-selected-primary.json').read_text()) if (WORK / 'ois96-selected-primary.json').exists() else {}
SELECTED = {}

def flatten(x):
    return ' '.join(flatten(v) for v in x) if isinstance(x, list) else x

def plain(x):
    return html.unescape(re.sub('<[^>]*>', '', x))

def clean(x):
    return ' '.join(re.sub('[\u0591-\u05bd\u05bf-\u05c2\u05c4-\u05c7\u200e\u200f]', '', plain(flatten(x))).split())

def primary(ref, *index):
    key = ref + (' [' + ','.join(map(str, index)) + ']' if index else '')
    if ref not in CACHE:
        SELECTED[key] = SNAPSHOT[key]
        return clean(SELECTED[key]['he'])
    d = CACHE[ref]
    h = d['he']
    for i in index:
        h = h[i]
    SELECTED[key] = {'requestedRef': ref, 'canonicalRef': d.get('ref'), 'zeroBasedIndex': list(index), 'he': h,
                     'heVersionTitle': d.get('heVersionTitle'),
                     'retrieval': 'Public Sefaria text API; checked against the original Hebrew/Aramaic and the supplied source pages.'}
    return clean(h)

def local(book, ref):
    p = next(p for p in json.loads((BOOKS / (book + '.json')).read_text())['paras'] if p['r'] == ref)
    h = p.get('t') or ' '.join(x[0] for x in p['p'])
    SELECTED[ref] = {'canonicalRef': ref, 'he': h, 'canonicalFile': str(BOOKS / (book + '.json')),
                     'retrieval': 'Restored canonical Akiva reader data; the quotation preserves this reader wording.'}
    return clean(h)

def excerpt(s, start, end=None):
    i = s.index(start)
    return s[i:] if end is None else s[i:s.index(end, i) + len(end)]

pages = {
    96: (list(range(263, 267)), list(range(298, 302))),
    97: (list(range(267, 272)), list(range(302, 306))),
    98: ([271, 272], [305, 306]),
    99: ([273, 274, 275], [306, 307]),
    100: ([274, 275, 276, 277], [307, 308, 309, 310]),
}
entries = []

def add(section, ident, phrase, ref, he, en, context, reader=False, anchor_end=None, url=None):
    rows = json.loads((ROOT / f'live-baseline/{section-1}.json').read_text())
    row = next(r for r in rows if r.get('n') == 1 and r.get('p'))
    text = plain(row['p'][phrase][0])
    prefix = text if anchor_end is None else text[:text.index(anchor_end) + len(anchor_end)]
    assert prefix and text.startswith(prefix)
    if url is None:
        url = ('https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/' + ref.rsplit(':', 1)[0].replace(' ', '_')) if reader else ('https://www.sefaria.org/' + ref.replace(' ', '_'))
    evidence = {'ref': ref, 'url': url, 'he': he, 'en': en,
                'translation': 'Original English translation prepared from the cited Hebrew or Aramaic.',
                'coverage': 'excerpt', 'heSha256': hashlib.sha256(he.encode()).hexdigest()}
    e = {'section': section, 'id': ident, 'rowN': 1, 'phraseIndex': phrase,
         'heAnchorPrefix': prefix, 'heCharOffset': len(prefix),
         'ref': ref, 'url': url, 'he': he, 'en': en, 'context': context,
         'sourceEvidence': [evidence],
         'reviewEvidence': {'pdfPages': {'neimosA': pages[section][0], 'integratedA': pages[section][1]},
                            'preserveExisting': True, 'status': 'verified',
                            'dedup': 'Every native and connected quotation in the destination ois was read. This selected source passage is absent.',
                            'primaryTextFile': 'review-work/ois96-selected-primary.json'}}
    if reader:
        e['readerRef'] = ref
        whole = clean(SELECTED[ref]['he'])
        for part in he.split(' … '):
            assert part in whole, (ref, 'canonical reader mismatch', part)
    else:
        e['openExternal'] = True
    entries.append(e)

# 96. Beauty, Og's survival, Moses' fear, and the explicitly named episodes.
add(96, 'yisrael-kedoshim-joseph-beauty', 0, 'Yisrael Kedoshim 6:11',
    excerpt(local('yisrael-kedoshim', 'Yisrael Kedoshim 6:11'), 'ויוסף הצדיק הגדור מערוה,', 'מסטרא דנוקבא כנודע.'),
    'Joseph the righteous, who was guarded against sexual transgression and of whom it is written, “I fear God,” is the only man of whom the Torah writes that he was “beautiful in form and beautiful in appearance.” Beauty belongs primarily to women, as they said in the chapter HaPoalim, “Your beauty is for women.” This means “a woman who fears the Lord”; otherwise it is falsehood and vanity. Through being guarded against sexual transgression and fearing the Lord, the beauty associated with women extends also to men, for fear of the Lord belongs primarily to the feminine side, as is known.',
    'Rav Tzadok’s own parallel explains why the Torah’s description of Joseph signifies a spiritual quality. The claim concerns beauty as Scripture describes it, which is the particular wording under discussion here.', reader=True)

add(96, 'zevachim-og-cooled-water', 2, 'Zevachim 113b:12',
    primary('Zevachim 113b', 11),
    'According to your reasoning, how could the ark proceed? Moreover, where did Og king of Bashan stand? Rather, a miracle was performed for them: the waters cooled at the sides of the ark.',
    'The Gemara asks how survival was possible amid the hot Flood waters and answers that the water beside the ark was miraculously cooled. This supplies the original account behind Og’s survival outside the ark.',
    anchor_end='שֶׁפָּלַט מִדּוֹר הַמַּבּוּל,')

add(96, 'pirkei-derabbi-eliezer-og-outside-ark', 2, 'Pirkei DeRabbi Eliezer 23:8',
    excerpt(primary('Pirkei DeRabbi Eliezer 23', 7), 'וחוץ מעוג מלך הבשן', 'שנאמר: ״כי רק עוג מלך הבשן״ וכו\'.'),
    'And except for Og king of Bashan, who sat on a wooden rung of one of the ark’s ladders and swore to Noah and his sons that he would be their servant forever. What did Noah do? He made a hole in the ark and passed him his food each day. He too remained, as it is said, “For only Og king of Bashan remained,” and so forth.',
    'This account gives the physical detail behind “without an ark”: Og is outside the enclosed ark, while Noah still sustains him from it. It adds that detail to the Gemara’s brief account of the cooled water.')

add(96, 'berakhot-miracle-for-falsehood', 3, 'Berakhot 58a:15',
    excerpt(primary('Berakhot 58a', 14), 'כי הוה נפיק,', 'דכתיב: ״אשר בשר חמורים בשרם״.'),
    'When he went out, that man said to him: “Would the Merciful One perform a miracle like this for a falsehood?” He replied: “Wicked man! Are they not called donkeys? For it is written, ‘Whose flesh is the flesh of donkeys.’”',
    'In the preceding narrative, Elijah appears as a witness to defend Rabbi Shila. The man challenges the apparent falsehood in Shila’s description; Shila answers by invoking Ezekiel’s scriptural imagery. Rav Tzadok borrows the question’s premise—that a miracle does not vindicate falsehood—for his argument about Og.',
    anchor_end='וַדַּאי לֹא הָיָה נִיסָא לְשִׁקְרָא,')

res44 = local('resisei-layla', 'Resisei Layla 44:1')
add(96, 'resisei-layla-og-flood-torah', 4, 'Resisei Layla 44:1',
    excerpt(res44, 'רק ידוע מה שכתוב על עוג דפלט מדור המבול,', 'שפע מי התורה למי המבול.') + ' … ' +
    excerpt(res44, 'ואם כן, עוג שנצול ממבול', 'קצת שיכות בהכרח לתורה.'),
    'It is known what is written about Og escaping the generation of the Flood: this certainly was not for nothing, but because he was free of the sins of the generation of the Flood. It is also known what is written in the Zohar, volume III, at the beginning of 216b: the giving of the Torah was fit to occur in the generation of the Flood, and Moses our teacher, peace be upon him, was present then too—beshagam has the numerical value of Moshe—had they merited it. Through their sin, however, the flow of Torah’s waters was changed into the waters of the Flood. … If so, Og, who was saved from the Flood, necessarily had some connection with Torah.',
    'This is Rav Tzadok’s own extended discussion of the passage named here. In its continuation he speaks of Moses as the root of a soul present in different generations. The quotation supplies his connection between Og’s survival, the sins of that generation, and Torah; the Niddah quotation already present supplies Og’s ancestry.', reader=True)

add(96, 'deuteronomy-og-land-manasseh', 5, 'Deuteronomy 3:13',
    primary('Deuteronomy 3:13'),
    'The rest of Gilead and all of Bashan, the kingdom of Og, I gave to half the tribe of Manasseh—all the region of Argob, all that Bashan which is called the land of the Rephaim.',
    'The verse establishes the transfer of Og’s territory to Manasseh. Rav Tzadok then gives his spiritual explanation for the connection between this land and Joseph’s descendants.',
    anchor_end='לַחֲצִי מַטֵּה מְנַשֶּׁה')

add(96, 'niddah-moses-fear-abraham-merit', 6, 'Niddah 61a:19-20',
    primary('Niddah 61a:19-20'),
    'Rabbi Yochanan said in the name of Rabbi Shimon ben Yochai: From the answer to that righteous man you can know what was in his heart. He thought: “Perhaps the merit connected with Abraham our father will stand for him.” For it is said, “The fugitive came and told Abram the Hebrew,” and Rabbi Yochanan said: This is Og, who escaped the generation of the Flood.',
    'The existing note quotes the Gemara’s question about Moses’ different reactions to Og and Sichon. This is its unquoted answer: Og’s service to Abraham. Rav Tzadok’s explanation through covenant purity develops a further spiritual reading of Moses’ fear.',
    anchor_end='וּלְכָךְ נִתְיָירֵא מֹשֶׁה מִמֶּנּוּ,')

add(96, 'shabbat-moses-separated-wife', 7, 'Shabbat 87a:4',
    primary('Shabbat 87a', 3),
    'He separated from his wife—what did he expound? He reasoned by an inference from the lesser case to the greater: Israel, with whom the Divine Presence spoke for only one hour and for whom a time was fixed, were told by the Torah, “Be ready … do not approach a woman.” I, with whom the Divine Presence speaks at every hour, without setting a time—how much more so! How do we know that the Holy One, blessed be He, agreed with him? For it is written, “Go, tell them: Return to your tents,” and afterward, “But you, stand here with Me.” Some say that the proof is “Mouth to mouth I speak with him.”',
    'The Gemara gives the particular basis for Moses’ separation: his continual readiness for prophecy, with divine approval. Rav Tzadok places that exceptional prophetic discipline within his account of Moses’ spiritual task.',
    anchor_end='שֶׁלְּכָךְ הָיָה פָּרוּשׁ מִן הָאִשָּׁה')

add(96, 'sotah-moses-burial-peor', 7, 'Sotah 14a:2',
    excerpt(primary('Sotah 14a', 1), 'ואמר רבי חמא ברבי חנינא:', 'כדי לכפר על מעשה פעור.'),
    'Rabbi Chama bar Rabbi Chanina said: Why was Moses buried beside Beth Peor? To atone for the deed of Peor.',
    'This is the original rabbinic explanation of the location of Moses’ burial. Rav Tzadok connects the atonement for Peor with Moses’ opposition to the spiritual failing discussed here.',
    anchor_end='וְקָבוּר מוּל בֵּית פְּעוֹר')

add(96, 'likkutei-moses-daat-peor', 7, 'Likkutei Maamarim, Compositions on the Festivals 16:7',
    excerpt(local('likkutei-maamarim', 'Likkutei Maamarim, Compositions on the Festivals 16:7'), 'ועל כן הוא הגואל ממצרים ערות הארץ,', 'כי הוא ממש הפכו;'),
    'Therefore he is the redeemer from Egypt, the nakedness of the land, the place of the harlot’s licentiousness. He testifies that among the children of Israel this power belongs to holiness, for holy daat—spiritual knowledge—is the very opposite of licentiousness. That is why he was buried opposite Beth Peor, after the episode at Shittim: he is its very opposite.',
    'In the surrounding passage Rav Tzadok identifies Moses with the daat of Israel. His own explanation directly connects Moses’ work of redemption and his burial at Peor, supplying the fuller parallel indicated by “as I wrote elsewhere.”', reader=True)

# 97. Sources absent from the existing, already substantial quotation apparatus.
add(97, 'avodah-zarah-fish-torah-water', 2, 'Avodah Zarah 3b:16',
    excerpt(primary('Avodah Zarah 3b', 15), 'אמר רב יהודה אמר שמואל,', 'כיון שפורשין מדברי תורה ומן המצות מיד מתים.'),
    'Rav Yehudah said in the name of Shmuel: What is meant by “You have made humankind like the fish of the sea, like creeping things without a ruler”? Why are human beings compared to the fish of the sea? To tell you: Just as fish in the sea die as soon as they come up onto dry land, so human beings die as soon as they separate from words of Torah and from the commandments.',
    'The comparison with fish supplies Torah and mitzvot as the indispensable medium of life. Rav Tzadok applies that image here to Torah scholars, alongside the separate teaching that the fish were spared in the Flood.',
    anchor_end='הַיְינוּ תַּלְמִידֵי חֲכָמִים')

add(97, 'peri-tzadik-rule-fish-through-torah', 2, 'Peri Tzadik, Sefer Kedushat Shabbat 7:29',
    excerpt(local('peri-tzadik', 'Peri Tzadik, Sefer Kedushat Shabbat 7:29'), 'וברכה דאדם', 'הם מושלים בכל הבריאה כלה.'),
    'The blessing of Adam, which belongs to Israel—“you are called Adam”—is also “Be fruitful and multiply.” But it concludes, “Subdue it and rule over the fish,” and so forth. This is the principal purpose of their blessing of increase: to subdue all the earthliness and materiality of this world. Through this they rule over the living creatures whose life is material. For this a person was created, as they said, “If you have learned much Torah … for this you were created.” Torah is the pattern of all the work of Creation, and “Who are the kings? The Sages”: through their attainment in Torah, they rule over the whole creation.',
    'This is Rav Tzadok’s fuller interpretation of the verse “rule over the fish of the sea.” He makes mastery through Torah and the subordination of material desire the point of the blessing.', reader=True)

add(97, 'niddah-evil-divine-presence', 3, 'Niddah 13b:3',
    primary('Niddah 13b', 2),
    'Some report it this way: Rabbi Ami said, “Anyone who brings himself into erotic thought is not admitted into the domain of the Holy One, blessed be He.” Here it is written, “What he did was evil in the eyes of the Lord,” and there it is written, “For You are not a God who desires wickedness; evil shall not dwell with You.”',
    'This is the passage from the opening chapter Kol HaYad that connects the designation “evil” with exclusion from the divine presence. The passage concerns bringing oneself into such thoughts; Rav Tzadok discusses the separate case of an involuntary dream in the next sentence.',
    anchor_end='וּבְרֵישׁ פֶּרֶק כָּל הַיָּד דְּנִקְרָא רַע,')

add(97, 'berakhot-elijah-and-whom-i-harmed', 3, 'Berakhot 31b:27-32a:1',
    primary('Berakhot 31b:27-32a:1'),
    'Rabbi Elazar said: Elijah spoke forcefully toward Heaven, as it is said, “You have turned their heart backward.” Rabbi Shmuel bar Rabbi Yitzchak said: How do we know that the Holy One, blessed be He, subsequently acknowledged Elijah’s words? For it is written, “And those whom I have afflicted.”',
    'The Gemara places the words from Micah 4:6 in the discussion of Elijah’s appeal about Israel’s wayward heart. Rav Tzadok uses that interpretation to discuss the divine creation of the inclination; the surrounding ois makes Torah its remedy.')

add(97, 'likkutei-desire-directed-into-torah', 5, 'Likkutei Maamarim, Compositions on the Festivals 16:7',
    excerpt(local('likkutei-maamarim', 'Likkutei Maamarim, Compositions on the Festivals 16:7'), 'והוא ממשיך כל תאותו וחשקו בדברי תורה', 'היפך "לב בשר" – לב להוציא בשר.'),
    'He draws all his desire and longing into words of Torah, and all his delight is there. Through this, the “heart of stone,” which signifies intense desire, melts away—the opposite of a “heart of flesh,” a heart directed toward bringing forth offspring.',
    'This parallel explains the mechanism of Torah as seasoning: the energy of desire is directed into Torah. The contrast between a heart of stone and a heart of flesh connects that redirection with the proper creative purpose of the faculty.', reader=True)

add(97, 'zohar-vayeshev-severity-of-defilement', 6, 'Zohar, Vayeshev 17:182',
    primary('Zohar, Vayeshev 17:182'),
    'Come and see: Of all the sins through which a person becomes defiled in this world, this is the sin through which a person becomes most defiled in this world and in the world to come: one who pours out his seed to no purpose, brings forth seed in vain by hand or foot, and becomes defiled through it. As it is said, “For You are not a God who desires wickedness; evil shall not dwell with You.”',
    'This explicit comparison occurs in Zohar I 188a, in Vayeshev. It supplies the wording about exceptional defilement used here. The ois immediately turns to purification through Torah and repentance; its existing Noach quotation preserves the exception for great repentance.')

takanat15 = local('takanat-hashavin', 'Takanat HaShavin 15:15')
add(97, 'takanat-hashavin-repentance-textual-qualification', 8, 'Takanat HaShavin 15:15',
    excerpt(takanat15, 'וכבר צווחו על זה קמאי,', '״והני מילי כד לא עבד תיובתא שלימתא, תיובתא דחזיא לחפיא על כל עובדוי״, עד כאן') + ' … ' +
    excerpt(takanat15, 'דאין לך רשע בשום עבירה', 'ואין אחד יוצא מהכלל'),
    'The earlier authorities already protested this, for nothing stands in the way of repentance. In the section Noach it says, “All a person’s sins … depend on repentance; but the sin of pouring out seed … your iniquity is stained … except through great repentance.” These three words, “except,” and so forth, are enclosed in brackets, because they are absent from older books and were added from another manuscript version. Reishit Chochmah, in the Gate of Holiness, chapter 17, writes that some manuscript versions read, “except through the power of mighty repentance.” This appears to contradict the wording in Vayechi, which closes the door to repentance altogether. But in Vayakhel too, after describing at length the damage done by impairing the covenant, it says, “These words apply when one has not performed complete repentance, repentance fit to cover all one’s deeds.” … There is no wicked person, whatever the transgression, who cannot be considered wholly righteous through a thought of repentance in the heart in a single moment. There it says simply “even a wholly wicked person,” implying every transgression in the world, with none excluded.',
    'Rav Tzadok himself examines the Zohar’s differing textual formulations and brings its explicit qualification about complete repentance. This fuller discussion explains why his language here about the apparent barrier to repentance leads into a path of repair through Torah.', reader=True,
    anchor_end='דְּאֵין מוֹעִיל תְּשׁוּבָה,')

add(97, 'rashi-eruvin-gratuitous-affairs', 11, 'Rashi on Eruvin 19a:18:1',
    primary('Rashi on Eruvin 19a:18:1'),
    '“On account of gratuitous affairs”—forbidden sexual relations.',
    'Rashi supplies the particular sense of iskei chinnam that connects the Gemara’s wordplay with Rav Tzadok’s discussion of guarding the covenant. The existing note retains the Gemara’s wording.',
    anchor_end='עַל עִסְקֵי חִנָּם,')

# 98. The specified tefillin passages and two original treatments of speech shaping intention.
add(98, 'rambam-four-tefillin-passages', 2, 'Mishneh Torah, Tefillin, Mezuzah and the Torah Scroll 1:1',
    primary('Mishneh Torah, Tefillin, Mezuzah and the Torah Scroll 1:1'),
    'These four passages—“Sanctify to Me” and “When the Lord brings you,” in the book of Exodus, and “Hear, O Israel” and “If you will indeed heed”—are written separately, covered with leather, and called tefillin. They are placed on the head and bound on the arm. Even the tip of one letter in these four passages prevents all of them from being valid under Torah law, until they are written completely and correctly.',
    'Maimonides identifies the four passages that contain the commands concerning this sign. This supplies the halakhic fact on which Rav Tzadok builds his explanation of the passage’s own spiritual efficacy.')

add(98, 'mei-hashiloach-speech-arranges-will', 6, 'Mei HaShiloach, Volume I, Writings, Proverbs 10:1',
    local('mei-hashiloach', 'Mei HaShiloach, Volume I, Writings, Proverbs 10:1'),
    '“The lips of the righteous know what is pleasing.” This follows what the Sages said: “They compel him until he says, ‘I am willing.’” Through his speech he introduces willingness into his heart as well. This is “the lips of the righteous”: what he says only with his lips, because his heart is not yet clarified, helps him clarify his heart so that he wills it wholeheartedly. For example, when anger toward his fellow arises in his heart and he recognizes this as a failing, his first counsel is to speak kindly to his fellow. Even though this is not yet wholehearted, through it he works upon himself little by little, until he brings love into his heart in place of hatred. This is “know what is pleasing”: “know” means arranging. Through speech he arranges his will until he establishes it wholeheartedly in his heart. Similarly, “The sun knows its setting” means that it has order and regularity in its course, unlike the moon, whose path is sometimes longer, as stated in Rosh Hashanah.',
    'This original teaching supplies the received interpretation mentioned here and gives its concrete example: speaking kindly can gradually replace anger with love. The existing Yisrael Kedoshim quotation gives the same general principle; this passage supplies the fuller formulation and example in Mei HaShiloach.', reader=True)

tzetel_url = 'https://he.wikisource.org/wiki/נועם_אלימלך/הצעטיל_הקטן'
tzetel = 'ו. כשיבא לו חס ושלום מחשבה רעה מניאוף, יאמר כמה פעמים "ונשמרת מכל דבר רע" (דברים כג, י), ויהרהר אז בדרשות חז"ל שדרשו עליו שלא יהרהר אדם ביום ויבא לידי קרי בלילה, ולא יניח חס ושלום לשהות המחשבה רעה במוחו, שלא לטמאות שכל העליון חס ושלום: ז. כשיבא חס ושלום לידו בהזדמנות כנגדו הסתכלות רעה חס ושלום, כגון בהמה וחיה או עוף שנזקקין זה לזה או טפח מגולה באשה במקום ערוה או בצורת אשתו נדה וכיוצא בהן – יאמר תיכף ומיד הפסוק "ולא תתורו אחרי לבבכם" (במדבר טו, לט), ולא יטמא את שכלו חס ושלום:'
SELECTED['Noam Elimelech, Tzetel Katan 6-7'] = {
    'canonicalRef': 'Noam Elimelech, Tzetel Katan 6-7', 'url': tzetel_url,
    'he': tzetel, 'retrieval': 'Opened the original text on Hebrew Wikisource; web retrieval turn83view0, lines 121–122; paragraphs ו–ז. The editorial footnote marker was omitted, with no change to the original prose.',
    'webEvidence': 'turn83view0', 'pageRevision': 'oldid=3021008',
}
add(98, 'tzetel-katan-reciting-prohibition', 7, 'Noam Elimelech, Tzetel Katan 6-7',
    tzetel,
    '6. If, Heaven forbid, an improper thought of sexual transgression comes to him, he should say several times, “Guard yourself from every evil thing,” and reflect on the Sages’ exposition of it: a person should not entertain such thoughts during the day and thereby come to a nocturnal emission. He should not allow the improper thought to remain in his mind, so as not to defile the higher intellect, Heaven forbid. 7. If, Heaven forbid, an improper sight happens to come before him—for example, an animal or bird mating, an exposed handbreadth of a woman in a place regarded as nakedness, the appearance of his wife during her menstrual impurity, or the like—he should immediately say the verse, “Do not stray after your heart,” and not defile his intellect, Heaven forbid.',
    'Tzetel Katan gives two concrete instances of using the verse that addresses the temptation, together with attention to its meaning. It is cited here as an original parallel to the practice Rav Tzadok attributes to the Ari; it does not establish the precise location in the Ari’s writings.',
    url=tzetel_url)

# 99. The hidden heart, erasure through repentance, and the person's continuing responsibility.
mc7 = local('machshavot-charutz', 'Machshavot Charutz 7:1')
add(99, 'machshavot-hidden-heart-world-to-come', 5, 'Machshavot Charutz 7:1',
    excerpt(mc7, 'ו״כל ישראל יש להם חלק לעולם הבא״', 'הנעלמת בעולם הזה ומתגלית לעתיד לבוא') + ' … ' +
    excerpt(mc7, 'ובעולם הזה די מה שיודעין שיש עולם הבא,', 'דמי שכופר בזה, אין לו חלק'),
    '“All Israel have a portion in the world to come”: this means the hidden depths of their hearts, which are not disclosed even to the person himself. This is the root of their soul, a portion of God above, concerning which it was said that the Holy One, blessed be He, is the heart of Israel. This is the mystery of the world to come, corresponding to the heart, as is known. It is the portion in the world to come that all Israel possess, even sinners, for all sins arise from the material aspect and its manifestation in this world, and not from the depth of the pure soul, hidden in this world and revealed in the future. … In this world it is sufficient to know that there is a world to come, and through this they have a portion, as stated at the beginning of the chapter Chelek: one who denies it has no portion.',
    'Rav Tzadok links the Midrash’s “heart of Israel” with the soul’s hidden depth and its future disclosure. That connection explains the progression here from the divine heart to “a foretaste of the world to come.” The quoted passage also retains his stated qualification concerning denial of the world to come.', reader=True)

add(99, 'zohar-sin-erased-by-mighty-repentance', 7, 'Zohar, Noach 39:312',
    primary('Zohar, Noach 39:312'),
    'He opened and said: “For I know my transgressions, and my sin is always before me.” How greatly must people guard themselves against their sins before the Holy One, blessed be He! For after a person sins, that sin is inscribed above and is not erased except through the strength of great repentance, as it is said, “Even if you wash with natron and use much soap, your iniquity is stained before Me.”',
    'This passage, at Zohar I 73b, connects David’s continuing awareness of his sin with the need for powerful repentance to erase its record. Rav Tzadok’s account of forgetting the sin develops the further consequence of complete cleansing.')

shaarei4 = primary('Shaarei Teshuvah 4:21')
add(99, 'shaarei-teshuvah-memory-and-forgiveness', 8, "Sha'arei Teshuvah 4:21",
    excerpt(shaarei4, 'ומה שכתוב וחטאתי נגדי תמיד.', 'אולי לא השלים חק עקרי התשובה.') + ' … ' +
    excerpt(shaarei4, 'אך לא יזכיר הקודמות בפרט.', 'רק מחובת הודוי.'),
    'Concerning “My sin is always before me,” the Midrash explains that the sins should be before his eyes and remembered in his heart, but he should not mention them with his mouth. The Jerusalem Talmud gives a further explanation: they should not be in your eyes as though you had not done them, but as though you had done them and they had been forgiven. We have already mentioned this among the principles of repentance. Nevertheless, he should ask for mercy all his life for the forgiveness of his earlier and later sins, and fear lest he has not fulfilled the requirements of repentance. … But he should not recount the earlier sins individually after repenting of them and confessing them on Yom Kippur, for he has already fulfilled the command of confession concerning them. He should trust that his confession has been accepted to the extent that confession is fit to atone. Still, he should pray all his days for the forgiveness of his sins, as we said. Specifying the sins is an obligation of confession, not of prayer.',
    'Rabbeinu Yonah distinguishes continuing inner remembrance from repeating a spoken confession and combines that remembrance with trust in forgiveness. Rav Tzadok’s final sentence likewise keeps recollection of one’s failings within the person’s own work of repentance.')

lmj23 = local('likkutei-maamarim', 'Likkutei Maamarim, On Book of Joshua 23')
primary('Yoma 86b', 12)  # Context evidence: Rabbi Eliezer ben Yaakov praises renewed confession.
add(99, 'likkutei-human-repentance-divine-forgiveness', 8, 'Likkutei Maamarim, On Book of Joshua 23',
    excerpt(lmj23, 'וזהו שנקרא השם יתברך "המרבה לסלוח",', 'ואז השם יתברך יאמר שלא היה מכשול כנזכר לעיל.'),
    'This is why the blessed God is called “the One who abundantly forgives”: forgiveness is from His side. From the human side there is recognition of the sin and the deficiency, as it is said, “My sin is always before me”; and even though he confessed on this Yom Kippur, he returns and confesses again. For if a person regards himself as having had no stumbling, but rather as possessing everything of his own, like all the surrounding nations, that itself is indeed a stumbling. From the person’s side he must recognize that in truth a person has no power of his own. It follows that the days when he walked in darkness, unaware that the blessed God gives him the power to achieve, were sin and stumbling. Then the blessed God says that there was no stumbling, as explained above.',
    'Rav Tzadok expressly maintains the two perspectives: the person continues to recognize his failings and dependence on God, while forgiveness belongs to God. His reference to renewed confession follows the view praised by Rabbi Eliezer ben Yaakov in Yoma 86b.', reader=True,
    url='https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/#/read/Likkutei_Maamarim,_On_Book_of_Joshua')

# 100. Qualifications about repentance, providence, assistance, and acquired character.
add(100, 'yoma-repentance-love-fear', 3, 'Yoma 86b:3',
    primary('Yoma 86b', 2),
    'Reish Lakish said: Great is repentance, for deliberate sins become like inadvertent sins, as it is said, “Return, Israel, to the Lord your God, for you have stumbled in your iniquity.” Iniquity is deliberate, yet it calls it a stumbling. Is that so? But Reish Lakish said: Great is repentance, for deliberate sins become like merits, as it is said, “When a wicked person turns from his wickedness and practices justice and righteousness, through them he shall live.” There is no difficulty: here it is repentance from love, and there it is repentance from fear.',
    'The Gemara distinguishes two effects: repentance from fear changes deliberate sins into inadvertent sins; repentance from love changes them into merits. This supplies the original qualification for the transformation discussed here after complete repentance.',
    anchor_end='שֶׁזְּדוֹנוֹת נַעֲשִׂין זְכִיּוֹת,')

akeida28 = primary('Akeidat Yitzchak 28:1:4')
add(100, 'akeidat-yitzchak-plan-and-free-choice', 5, 'Akeidat Yitzchak 28:1:4',
    excerpt(akeida28, 'ולזה אמר האל יתברך בנעימות אזהרת:', 'וכלן היא אפשרי\' עליהן כמו שאמרנו.'),
    'Therefore God gives the gentle warning, “Go and see the works of God”: direct your hearts toward the sacred, and do not err in this. His attributing these events to human actions is a matter of a pretext, for those divine purposes will in any case come to pass and will not turn aside, without thereby compelling people in the details of their individual actions. Similarly, the woman was not compelled to mix her husband’s cup with lukewarm or cold water because he intended to divorce her. Her mixing it lukewarm was only a pretext on his part: had that not occurred, another reason—or many others—would not have been lacking, and all those actions remained possible for her, as we explained.',
    'Rabbi Yitzchak Arama is explaining the same Tanchuma parable quoted in the existing note. He distinguishes a divine purpose that will be fulfilled from the individual’s unforced choices. Rav Tzadok’s discussion of the past here likewise expressly follows complete repentance.')

primary('Sanhedrin 107a', 1)  # Context evidence: the warning against placing oneself in a trial.
add(100, 'sanhedrin-david-justified-in-your-words', 6, 'Sanhedrin 107a:8',
    primary('Sanhedrin 107a', 7),
    'Rava expounded: What is meant by “Against You alone have I sinned and done what is evil in Your eyes, so that You may be justified in Your words and prevail in Your judgment”? David said before the Holy One, blessed be He: “It is revealed and known before You that, had I wished to subdue my inclination, I would have subdued it. But I said: Let people not say, ‘The servant defeated his Master.’”',
    'Rava presents this as David’s plea; the surrounding passage first warns a person not to bring himself into a trial and describes David’s failure after asking to be tested. Rav Tzadok interprets the plea here in terms of the withdrawal of divine assistance.',
    anchor_end='"לְמַעַן תִּצְדַּק בְּדָבְרֶךָ",')

add(100, 'kiddushin-divine-assistance-against-inclination', 6, 'Kiddushin 30b:7',
    primary('Kiddushin 30b', 6),
    'Rabbi Shimon ben Levi said: A person’s inclination grows stronger against him every day and seeks to kill him, as it is said, “The wicked watches the righteous and seeks to kill him.” If the Holy One, blessed be He, did not help him, he could not overcome it, as it is said, “God will not abandon him to its hand.”',
    'This teaching supplies the significance of the assistance mentioned here: overcoming the inclination requires God’s help. Rav Tzadok uses that dependence in his retrospective explanation of David’s failure.')

add(100, 'shaarei-kedusha-tzaddik-chasid', 14, "Sha'arei Kedusha, Part 1 3:5",
    primary("Sha'arei Kedusha, Part 1 3:5"),
    'The conclusion is that one who fulfills the 613 commandments while the evil inclination remains within him and he overcomes it is called a tzaddik. When he fulfills them through the annulment of the evil inclination, indicating that he has acquired good character traits as an established nature, he is called a complete chasid.',
    'Rabbi Chaim Vital distinguishes overcoming the inclination from the settled acquisition of good character. His account concerns acquired character becoming natural; Rav Tzadok develops his own distinction here in terms of the roots of different dispositions, while retaining the teaching that righteousness and wickedness are not decreed at birth.',
    anchor_end='שְׁתֵּי מַדְרֵגוֹת בָּאָדָם בְּתוֹלָדָה,')

assert len(entries) == 30
assert len({(e['section'], e['id']) for e in entries}) == len(entries)

catalog = json.loads((ROOT / 'tmp/batch-engineering/current-site/library/connected-ideas/catalog.json').read_text())
decisions = {
    96: 'Preserved native notes 407–414 and the connected Sod Yesharim quotation. Added the distinct original accounts of Og outside the ark, the miracle-language, the unquoted answer in Niddah about Abraham, the biblical grant to Manasseh, Moses’ separation and burial, and Rav Tzadok’s own fuller parallels. The existing covenant-root quotation already supplies the concluding Nedarim distinction; no repetition of that passage was added.',
    97: 'Preserved native notes 415–427 and the connected Tiferet Yosef and Peri Tzadik Chanukah quotations, including the existing Zohar exception for great repentance. Added the missing fish/Torah image and its explicit verse interpretation, the unquoted Niddah and Elijah passages, the direct Zohar Vayeshev comparison, Rav Tzadok’s textual discussion of complete repentance, Rashi’s specific explanation of iskei chinnam, and the distinct account of redirecting desire into Torah. The existing Torah-remedy, Eli-house, Gehinnom-fire, Job-and-companions, and psalm quotations are not repeated.',
    98: 'Preserved native notes 428–429 and both connected quotations. Added the four tefillin passages, the original Mei HaShiloach teaching with its concrete anger-to-love example absent from the existing Yisrael Kedoshim extract, and Tzetel Katan’s two concrete recitations. The existing Poked Akarim quotation already supplies the discussion of names derived from verses; no duplicate was added. A precise Ari locator was not established; the Tzetel Katan note is explicitly a separately attributed original parallel.',
    99: 'Preserved native notes 430–435 and the connected Beit Yaakov quotation. Added Machshavot Charutz on the hidden heart and world to come with its explicit qualification, the unquoted Zohar about erasure of the sin’s record, Rabbeinu Yonah’s distinction between inner remembrance and spoken confession, and Rav Tzadok’s own fuller statement of human recognition versus divine forgiveness. The passages about repeated confession reflect different treatments and are not silently harmonized.',
    100: 'Preserved native notes 436–446 and both connected quotations. Added the love/fear distinction in Yoma, Akeidat Yitzchak’s explicit freedom-of-choice qualification to the same Tanchuma parable, David’s actual Talmudic plea, the teaching about divine assistance, and Shaarei Kedusha’s definition of acquired character. The existing Yalkut note already correctly identifies remez 429 and quotes the restoration scene; no replacement or duplicate was made. The Tanya opening repeats the already-quoted Job/Niddah problem and was not added as an isolated fragment.',
}
coverage = []
for section in range(96, 101):
    file = ROOT / f'live-baseline/{section-1}.json'
    rows = json.loads(file.read_text())
    notes = [n for row in rows for n in row.get('footnotes', [])]
    connected = [r['targetRef'] for r in catalog['records'] if r.get('originRef', '').startswith(f'Tzidkat HaTzadik {section}:')]
    coverage.append({'section': section, 'status': 'complete-add-only-review', 'bothSuppliedEditionsRead': True,
                     'pdfPages': {'neimosA': pages[section][0], 'integratedA': pages[section][1]},
                     'existingNativeNumbersPreserved': [n['number'] for n in notes],
                     'existingConnectedSourcesPreserved': connected,
                     'baselineSha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                     'additions': sum(e['section'] == section for e in entries), 'decisions': decisions[section]})

result = {
    'schemaVersion': 1, 'reviewedSections': list(range(96, 101)),
    'reviewMode': 'Add only missing original-source quotations; preserve every existing note and all body text.',
    'entries': entries, 'coverage': coverage,
    'observationsNotApplied': [
        {'section': 98, 'type': 'unresolved-primary-locator', 'detail': 'The exact Ari location for the recitation practice was not established. The verified original parallel is Tzetel Katan 6–7; its public note explicitly does not identify it as the Ari’s text.'},
        {'section': 100, 'type': 'body-preserved', 'detail': 'The body’s Yalkut remez 296 remains untouched. The pre-existing native footnote already identifies and quotes the correct remez 429.'},
        {'section': 100, 'type': 'body-preserved', 'detail': 'The phrase containing וכדברי שמאי דוד is preserved exactly. No author-text correction is included in this add-only proposal.'},
    ],
    'sourceVerification': 'All selected external quotations were checked in original Hebrew/Aramaic. Internal quotations preserve the canonical reader wording and expanded abbreviations. Public footnotes credit only the original sources and never link either supplied commentary PDF.',
    'reproducibleBuilder': 'review-work/build-96-100.py',
}
(WORK / 'ois-96-100.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
(WORK / 'ois96-selected-primary.json').write_text(json.dumps(SELECTED, ensure_ascii=False, indent=2) + '\n')

verification = {'sections': list(range(96, 101)), 'entries': len(entries), 'checks': []}
for e in entries:
    rows = json.loads((ROOT / f"live-baseline/{e['section']-1}.json").read_text())
    row = next(r for r in rows if r['n'] == e['rowN'])
    anchor = plain(row['p'][e['phraseIndex']][0])
    assert anchor.startswith(e['heAnchorPrefix']) and e['heCharOffset'] == len(e['heAnchorPrefix'])
    matched = []
    for part in e['he'].split(' … '):
        hits = [k for k, v in SELECTED.items() if part in clean(v['he'])]
        assert hits, (e['id'], 'unmatched Hebrew evidence', part)
        matched.append(hits)
    assert e['sourceEvidence'][0]['heSha256'] == hashlib.sha256(e['he'].encode()).hexdigest()
    public = ' '.join(e[k] for k in ['ref', 'url', 'en', 'he', 'context'])
    assert not re.search('biur|mishulav|meshulav|neimos|neimot|נעימות הצדק|ביאור משולב', public, re.I)
    assert '.pdf' not in e['url'].lower()
    verification['checks'].append({'section': e['section'], 'id': e['id'], 'exactAnchor': True,
                                   'originalHebrewMatched': True, 'primarySnapshotKeys': matched,
                                   'canonicalReader': bool(e.get('readerRef')), 'heSha256': e['sourceEvidence'][0]['heSha256']})
(WORK / 'ois-96-100-verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'entries': len(entries), 'counts': {s: sum(e['section'] == s for e in entries) for s in range(96, 101)},
                  'proposal': str(WORK / 'ois-96-100.json'), 'primaryEvidence': str(WORK / 'ois96-selected-primary.json')}, ensure_ascii=False))

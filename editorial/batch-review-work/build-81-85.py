import json, re, html, hashlib
from pathlib import Path

ROOT = Path('/workspace/scratch/f85ae98f1669')
WORK = ROOT / 'review-work'
BOOKS = ROOT / 'tmp/batch-engineering/current-site/mcp-data/text'
CACHE = json.loads((WORK / 'ois81-primary.json').read_text()) if (WORK / 'ois81-primary.json').exists() else {}
SNAPSHOT = json.loads((WORK / 'ois81-selected-primary.json').read_text()) if (WORK / 'ois81-selected-primary.json').exists() else {}
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
                     'retrieval': 'Public Sefaria text API; quotation checked against the original Hebrew/Aramaic and the supplied source pages.'}
    return clean(h)

def local(book, ref):
    p = next(p for p in json.loads((BOOKS / (book + '.json')).read_text())['paras'] if p['r'] == ref)
    h = p.get('t') or ' '.join(x[0] for x in p['p'])
    SELECTED[ref] = {'canonicalRef': ref, 'he': h, 'canonicalFile': str(BOOKS / (book + '.json')),
                     'retrieval': 'Restored canonical Akiva reader data; quotation preserves this reader wording.'}
    return clean(h)

def excerpt(s, start, end=None):
    i = s.index(start)
    return s[i:] if end is None else s[i:s.index(end, i) + len(end)]

pages = {
    81: ([224,225,226,227,228], [263,264,265,266]),
    82: ([228,229], [266,267]),
    83: ([229,230,231,232,233], [267,268,269,270]),
    84: ([233,234,235], [270,271,272]),
    85: ([236,237], [272,273]),
}
entries = []

def add(section, ident, phrase, ref, he, en, context, reader=False, anchor_end=None):
    rows = json.loads((ROOT / f'live-baseline/{section-1}.json').read_text())
    row = next(r for r in rows if r.get('n') == 1 and r.get('p'))
    text = plain(row['p'][phrase][0])
    prefix = text if anchor_end is None else text[:text.index(anchor_end) + len(anchor_end)]
    assert prefix and text.startswith(prefix)
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
                            'dedup': 'All existing native and connected quotations in the destination ois were read; the selected source passage is absent.',
                            'primaryTextFile': 'review-work/ois81-selected-primary.json'}}
    if reader:
        e['readerRef'] = ref
        whole = clean(SELECTED[ref]['he'])
        for part in he.split(' … '):
            assert part in whole, (ref, 'canonical reader mismatch', part)
    else:
        e['openExternal'] = True
    entries.append(e)

# 81. Succession, Moses' two Midrashic accounts, and the spiritual attachment to the Land.
add(81, 'shabbat-david-solomon-succession', 0, 'Shabbat 30a:9',
    excerpt(primary('Shabbat 30a', 8), 'אמר לו: בשבת תמות.', 'אפילו כמלא נימא.'),
    'He said to him: “You will die on Shabbat.” David asked: “May I die on the first day of the week?” He replied: “The time for the kingship of your son Solomon has already arrived, and one reign does not encroach upon another even by a hair’s breadth.”',
    'God’s answer to David supplies the rule abbreviated at the opening of the ois. Rav Tzadok then considers whether a predecessor can remain alive while willingly relinquishing the prominence that belongs to his successor.',
    anchor_end='דָוִד הַמֶּלֶךְ עָלָיו הַשָּׁלוֹם')

tanchuma = primary('Midrash Tanchuma, Vaetchanan 6', 0)
add(81, 'tanchuma-moses-becomes-student', 2, 'Midrash Tanchuma, Vaetchanan 6:1',
    excerpt(tanchuma, 'עד עכשו היה חלקך לשרת לפני', 'לך עשה.') + ' … ' +
    excerpt(tanchuma, 'ישב יהושע בראש,', 'ועכשו הרי נפשי נתונה לך.'),
    '“Until now it was your portion to serve before Me. Now your portion has passed, and the time has come for Joshua your disciple to serve.” Moses said before Him: “My Master, if I am to die because of Joshua, I will go and become his disciple.” He said to him: “If you wish to do this, go and do it.” … Joshua sat at the head, with Moses at his right and Aaron’s sons at his left, and Joshua expounded before Moses. Rabbi Shmuel bar Nachmani said in the name of Rabbi Yonatan: When Joshua said, “Blessed is He who chooses the righteous,” the traditions of wisdom were taken from Moses and given to Joshua, and Moses did not know what Joshua was expounding. After Israel rose from the session, they said to Moses, “Explain the Torah to us.” He told them, “I do not know what to answer you.” Moses faltered and fell. At that moment he said: “Master of the worlds, until now I asked for life; now my soul is given to You.”',
    'The Tanchuma presents Moses’ proposal to live as Joshua’s student and the ensuing transfer of wisdom. This gives the narrative behind the reference here; Devarim Rabbah supplies the separate formulation about envy quoted next.')

add(81, 'rashi-moses-wisdom-withdrawn', 3, 'Rashi on Deuteronomy 31:2:2',
    primary('Rashi on Deuteronomy 31:2', 1),
    '“I can no longer go out and come in.” Could it mean that his strength had failed? Scripture says, “His eye had not dimmed and his freshness had not departed.” What, then, does “I cannot” mean? I am not permitted: authority has been taken from me and given to Joshua. Another explanation: “To go out and come in” in words of Torah. This teaches that the traditions and wellsprings of wisdom were closed off from him.',
    'Rashi supplies the exact image of the closed wellsprings of wisdom. He distinguishes loss of authority or access to Torah wisdom from physical weakness.',
    anchor_end='מַעְיְנוֹת הַחָכְמָה')

add(81, 'devarim-rabbah-moses-envy', 4, 'Devarim Rabbah 9:9',
    excerpt(primary('Devarim Rabbah 9:9'), '(דברים לא, יד): קרא את יהושע,', 'ומה שקנא משה ביהושע.'),
    '“Call Joshua.” Moses said before Him: “Master of the world, let Joshua take my office, and let me remain alive.” The Holy One, blessed be He, said: “Do for him as he does for you.” Moses immediately rose early and went to Joshua’s house. Joshua was afraid and said, “Moses, my teacher, come to me.” They went out to walk, and Moses walked at Joshua’s left. They entered the Tent of Meeting; the pillar of cloud descended and separated them. When the pillar of cloud withdrew, Moses went to Joshua and asked, “What did the divine utterance say to you?” Joshua replied: “When the divine utterance was revealed to you, did I know what it said to you?” At that moment Moses cried out: “A hundred deaths, but not one experience of envy!” Solomon explains it: “For love is strong as death; jealousy is hard as the grave”—the love Moses had for Joshua, and the envy Moses felt toward Joshua.',
    'This is the Midrash’s full setting for “a hundred deaths, but not one envy.” Rav Tzadok takes its contrast between the transfer of leadership and the predecessor’s inner response as the starting point of his teaching.')

add(81, 'sichat-shedim-land-and-anger', 8, 'Sichat Shedim 1:9',
    excerpt(local('sichat-shedim', 'Sichat Shedim 1:9'), 'ולבטל יצר רע הצרך זכותא דארץ ישראל', 'שהוא ממש ההיפך'),
    'To annul the evil inclination, the merit of the Land of Israel was needed, as stated in Arakhin; that is why Moses did not annul it. In the Land of Israel, which is Israel’s root, the inclination of the angry heart does not have such great sway, for the angry heart is the very opposite of that root.',
    'This parallel links the Land’s spiritual character with diminished dominion of anger. It helps explain why the ois makes attachment to the holiness of the Land relevant to overcoming envy.',
    reader=True, anchor_end='הָאִידְנָא,')

add(81, 'dover-tzedek-four-cubits-holiness', 8, 'Dover Tzedek, Miscellany 1:5',
    excerpt(local('dover-tzedek', 'Dover Tzedek, Miscellany 1:5'), 'שאין לך אחד מישראל שאין לו ארבע אמות בארץ ישראל.', 'וישנו לכל אחד מישראל חלק בה,'),
    'There is no member of Israel who does not have four cubits in the Land of Israel. Four cubits are the measure of the space belonging to a person wherever he is. This means that he recognizes that what belongs to him in this world is sanctified with the holiness of the Land. Its holiness comes from knowing that it is a land the blessed God gave to us and our ancestors, and that it did not come to us through our own power, the strength of our hand, or our efforts. This is the whole purpose of the Land’s holiness, as explained above. Every member of Israel has a portion in it.',
    'Rav Tzadok explicitly explains the four cubits as a spiritual relation to one’s place and possessions: recognizing them as God’s gift. That explanation clarifies how the ois speaks of attachment to the Land even in the present.', reader=True)

add(81, 'tosafot-four-cubits-property-distinction', 8, 'Tosafot on Bava Batra 44b:7:1',
    excerpt(primary('Tosafot on Bava Batra 44b', 6, 0), 'דלא הוה ליה ארעא מעולם.', 'דהכא משמע דאפשר שאין לו קרקע'),
    '“He never had land.” From here there is an answer to those who say that the practice of writing in authorizations, “I have given him four cubits in my courtyard,” even when the person has no land, rests on the claim that everyone has four cubits in the Land of Israel, since land cannot be acquired through robbery—or alternatively, that everyone has four cubits for his grave. For here it is evident that it is possible for a person to have no land.',
    'Tosafot rejects the claim as a universal rule of actual landownership. The spiritual explanation in Dover Tzedek is therefore the relevant parallel for Rav Tzadok’s use of “four cubits” here; this passage should not be read as asserting a property right for every individual.')

add(81, 'berakhot-praying-toward-the-land', 9, 'Berakhot 30a:9',
    primary('Berakhot 30a', 8),
    'If one is standing outside the Land, one should direct one’s heart toward the Land of Israel, as it is said, “They shall pray to You toward their land.” If one is standing in the Land of Israel, one should direct one’s heart toward Jerusalem, as it is said, “They shall pray to the Lord toward the city You have chosen.” If one is standing in Jerusalem, one should direct one’s heart toward the Temple, as it is said, “They shall pray toward this house.” If one is standing in the Temple, one should direct one’s heart toward the Holy of Holies, as it is said, “They shall pray toward this place.” If one is standing in the Holy of Holies, one should direct one’s heart toward the place of the Ark-cover. If one is standing behind the place of the Ark-cover, one should view oneself as though standing before the Ark-cover. Thus, one standing in the east turns west; in the west, east; in the south, north; and in the north, south. All Israel therefore direct their hearts toward one place.',
    'The baraita supplies both the verse about prayer toward the Land and the progression toward the Temple. Rav Tzadok relates that shared orientation to each person’s spiritual place in the Land and the Temple.',
    anchor_end='דֶּרֶךְ אַרְצָם",')

add(81, 'deuteronomy-length-of-days-parents-children', 11, 'Deuteronomy 11:21',
    primary('Deuteronomy 11:21'),
    'So that your days and the days of your children may be many on the land that the Lord swore to your ancestors to give them, like the days of the heavens above the earth.',
    'The full verse joins the longevity of parents and children, life on the Land, and the enduring heavens. These are the three features Rav Tzadok brings together in the interpretation that follows.')

# 82. The prayer-specific parallel and the distinction between partial relief and complete repentance.
add(82, 'devarim-rabbah-prayer-cain-half-decree', 6, 'Devarim Rabbah 8:1',
    excerpt(primary('Devarim Rabbah 8:1'), 'גדולה היא התפלה לפני הקדוש ברוך הוא,', 'מכאן אתה למד שגדולה התפלה לפני הקדוש ברוך הוא.'),
    'Great is prayer before the Holy One, blessed be He. Rabbi Elazar said: Do you wish to know the power of prayer? If it does not accomplish the whole, it accomplishes half. Cain rose against his brother Abel and killed him, and the decree was issued: “You shall be restless and wandering in the land.” He immediately stood and confessed before the Holy One, blessed be He, as it is said, “My iniquity is too great to bear.” He said before Him: “Master of the world, You bear the whole world, but You cannot bear my iniquity? You have written, ‘Bearing iniquity and passing over transgression’; forgive my iniquity, which is great.” He immediately found favor before the Holy One, blessed be He, and “restless,” half the decree, was withheld from him, as it is written, “He settled in the land of Nod.” From here you learn how great prayer is before the Holy One, blessed be He.',
    'Unlike the formulation in Vayikra Rabbah quoted in the existing note, this parallel expressly introduces Cain’s confession as an illustration of the power of prayer to accomplish half. It directly illuminates the wording used here without changing the citation in Rav Tzadok’s text.',
    anchor_end='תְּפִלָּה מְכַפֶּרֶת מֶחֱצָה,')

add(82, 'peri-tzadik-cain-verbal-confession', 6, 'Peri Tzadik, Vayeilech and Shabbat Shuvah 8:1',
    excerpt(local('peri-tzadik', 'Peri Tzadik, Vayeilech and Shabbat Shuvah 8:1'), 'אך אחר ששמע מקין שאמר לו עשיתי תשובה ונתפשרתי', 'רק שזה הוא כח השבת שיועיל הדברים לבד ג"כ.'),
    'But after Adam heard Cain tell him, “I repented and reached a compromise,” even though the Midrash says that Cain went out as one deceiving the divine mind, Adam said: “Such is the power of repentance”—that even verbal confession alone is effective, although the person has not yet abandoned the sin with the proper abandonment, to the point that the One who knows hidden things can testify about him, as explained above. This accords with the teaching in Taanit: “They enticed Him with their mouths and lied to Him with their tongues,” and so forth, and nevertheless, “He, being merciful, forgives iniquity.” “And I did not know!” Adam immediately stood and said, “A psalm, a song for the day of Shabbat”: there it says, “It is good to give thanks to the Lord,” without adding “and abandons,” as in “One who confesses and abandons will find mercy.” This is the power of Shabbat—that words alone can also be effective.',
    'Rav Tzadok distinguishes the benefit of an incomplete confession from the full abandonment of sin required for complete repentance. In this Shabbat teaching he reads Cain’s partial relief as evidence that the process can begin before its inner completion.', reader=True,
    anchor_end='"וַיֵּשֶׁב בְּאֶרֶץ נוֹד"')

# 83. Actual missing clauses and episodes, alongside already preserved quotations about effort.
add(83, 'megillah-retaining-learning-heavenly-help', 3, 'Megillah 6b:4',
    primary('Megillah 6b', 3),
    'These words apply to Torah, but in business success is help from Heaven. Even concerning Torah, we said this only about sharpening one’s understanding; preserving one’s learning, however, depends on help from Heaven.',
    'This is the qualification following the maxim quoted in the earlier note. Rav Tzadok focuses on its distinction between sharpening understanding through effort and maintaining one’s learning through divine assistance.')

add(83, 'shelah-noah-awakening-from-above', 8, 'Shenei Luchot HaBerit, Torah Shebikhtav, Noach, Torah Ohr 20',
    excerpt(primary('Shenei Luchot HaBerit, Torah Shebikhtav, Noach, Torah Ohr', 19), 'ונח מצא חן, הוא מצא, והקב"ה לא מצא', 'ומצאת את לבבו נאמן לפניך:'),
    '“Noah found favor”: he found, but the Holy One, blessed be He, did not find. This means that Noah found from the Holy One, blessed be He, who was awakening him. But the Holy One, blessed be He, did not find this from Noah, for Noah had no awakening from below to above. This differs from Abraham, who said, “Before whom I walked”—meaning, my awakening preceded His. Likewise it is written, “You found his heart faithful before You.”',
    'Shelah explains the Midrash’s distinction in terms of who initiates the awakening. This illuminates Rav Tzadok’s description of Noah being protected through an unearned awakening from above.')

add(83, 'pesachim-cow-calf-teaching', 11, 'Pesachim 112a:12',
    primary('Pesachim 112a', 11),
    'Rabbi Akiva instructed Rabbi Shimon ben Yochai in five matters when he was confined in prison. Rabbi Shimon said to him, “My teacher, teach me Torah.” He replied, “I will not teach you.” Rabbi Shimon said, “If you do not teach me, I will tell my father Yochai and have you handed over to the authorities.” Rabbi Akiva said: “My son, more than the calf wants to suckle, the cow wants to nurse.” Rabbi Shimon replied: “And who is in danger? Surely the calf is in danger.”',
    'The comparison originally expresses the teacher’s desire to teach, even while danger obstructs the lesson. Rav Tzadok applies that relation to God’s desire to impart His light and Israel’s desire to receive it.',
    anchor_end='כִּי יוֹתֵר מִמַּה שֶּׁעֵגֶל וְכוּלֵי')

net = primary('Netzach Yisrael 40', 0)
add(83, 'netzeich-finding-outside-ordinary-order', 13, 'Netzach Yisrael 40:1',
    excerpt(net, 'וביאור זה, כי הדברים אשר הם מסדר הנהגת העולם,', 'ולכך אינם באים רק בהיסח הדעת.') + ' … ' +
    excerpt(net, 'האחד - הוא המציאה,', 'רק במקרה קרה, והוא לטוב.'),
    'The explanation is that things belonging to the order by which the world is governed arrive in an orderly way and with thought directed toward them, because they are close to the world. But things far from the world involve a diversion of attention: they are far from the world’s order, and therefore arrive only when attention is diverted. … The first is a find, which comes into one’s hand only by chance. This differs from a person’s other livelihood and sustenance, which follow the world’s order. A find does not follow that order; it happens by chance, and it is for good.',
    'Maharal distinguishes an unexpected find from the ordinary course of earning a livelihood. This explains why “finding,” as used in the ois, cannot be produced simply by sitting and anticipating it.')

# The classical glosses verify guvza = a chest and marna = our master should wait.
primary('Rashi on Nedarim 50a', 6, 0)
primary('Rashi on Nedarim 50a', 6, 3)
primary('Ran on Nedarim 50a', 6, 0)
add(83, 'nedarim-akiva-chest', 16, 'Nedarim 50a:7',
    primary('Nedarim 50a', 6),
    'And from a chest: once Rabbi Akiva gave four zuz to sailors and said to them, “Bring me something.” They found only a chest on the seashore and brought it to him. They said, “Let our master wait with this.” It turned out to be full of dinars. A ship had once sunk, and all its business funds had been placed in that chest; it was found on this occasion.',
    'This is Rabbi Akiva’s episode, distinct from Rav Gamda’s monkey-and-pearls episode already quoted. The small payment prepared the way for the discovery, while the valuable contents remained unexpected. Rashi and Ran explain the Aramaic guvza here as a chest.',
    anchor_end='בְּרַבִּי עֲקִיבָא')

# 84. Original explanations of the two opening verses, concealed thought, and the study-house prayer.
add(84, 'metzudat-david-death-without-sentence', 0, 'Metzudat David on Proverbs 13:23:1',
    primary('Metzudat David on Proverbs 13:23', 0),
    '“Much food.” Much food comes into the world through the plowing of the poor, who plow a field of grain, yet the wealthy, who did not labor at it, eat it. Likewise, there is someone who is gathered away from the world without a sentence of death, for he did nothing for which he should be put to death, but is caught up in another’s sin.',
    'Metzudat David reads the verse’s two parts as cases in which a person’s outcome does not correspond to his own visible labor or deed. Rav Tzadok’s discussion asks how such an appearance relates to the divine judgment concealed beneath it.',
    anchor_end='(מִשְׁלֵי יג, כג),')

add(84, 'ibn-ezra-perishes-through-righteousness', 0, 'Ibn Ezra on Ecclesiastes 7:15:1',
    primary('Ibn Ezra on Ecclesiastes 7:15', 0),
    '“All of this.” The word “there is” refers to something found on rare occasions. The meaning of “perishes through his righteousness” is that his righteousness brings about his loss, as with someone who fasts constantly. “Prolongs” means that he prolongs his days through his wickedness, eating, drinking, rejoicing, and providing pleasures for the body.',
    'Ibn Ezra explicitly reads the phrase as “through his righteousness” and illustrates it with excessive fasting. Rav Tzadok applies that grammatical reading to another case: righteousness that becomes the occasion for another person’s envy.')

add(84, 'machshavot-thought-concealed-from-self', 11, 'Machshavot Charutz 1:6',
    excerpt(local('machshavot-charutz', 'Machshavot Charutz 1:6'), 'וגם במחשבת האדם יש כמה מדרגות', 'וזהו המחשבה סתימאה,'),
    'Human thought also has several levels. There is a depth at the beginning of thought, from which all thoughts are drawn, that is closed off and hidden from the person. This is the concealed thought.',
    'This parallel distinguishes the thought a person can observe from a deeper source that remains hidden even from that person. It directly explains the ois’s statement that some concealed matters escape one’s own awareness.', reader=True,
    anchor_end='לָאָדָם עַצְמוֹ,')

add(84, 'berakhot-study-house-prayer', 14, 'Berakhot 28b:3-4',
    primary('Berakhot 28b', 2) + ' ' + primary('Berakhot 28b', 3),
    'Rabbi Nechunya ben HaKanah would offer a short prayer on entering the study house and on leaving it. They asked him: “What occasion is there for this prayer?” He told them: “On entering I pray that no mishap occur through me; on leaving I give thanks for my portion.” The Sages taught: What does he say on entering? “May it be Your will, Lord my God, that no mishap occur through me; that I not stumble in a matter of law and have my colleagues rejoice over me; that I not call the impure pure or the pure impure; and that my colleagues not stumble in a matter of law and have me rejoice over them.”',
    'This is the prayer cited in the closing bracket. Following Rashi’s explanation, the request includes protection from the mutual harm of error and rejoicing at another scholar’s failure.',
    anchor_end='כְּשֶׁנִּכְנַס לַתּוֹרָה,')

add(84, 'rashi-study-house-mutual-harm', 14, 'Rashi on Berakhot 28b:4:1',
    primary('Rashi on Berakhot 28b', 3, 0),
    '“And that I not stumble”—and have my colleagues rejoice over my failure. There would then be two evils occurring through me, because I would cause them to be punished.',
    'Rashi explains why the prayer concerns more than the learner’s own mistake: another person’s pleasure in that mistake creates a second harm. This is the specific connection between the study-house prayer and the subject of this ois.',
    anchor_end='דְּשָׁם הוּא בְּיוֹתֵר כַּנּוֹדָע,')

tik = primary('Tikkunei Zohar 99b', 6)
add(84, 'tikkunei-zohar-abel-moses', 14, 'Tikkunei Zohar 99b:7',
    excerpt(tik, 'ותוסף ללדת את אחיו את הבל,', 'את הבל,') + ' … ' +
    excerpt(tik, 'הכא רמיז גלגולא דצדיקיא,', 'בשגם דא משה,'),
    '“She again bore his brother Abel.” … Here the reincarnation of the righteous is hinted at. The Holy One, blessed be He, showed him the course of his reincarnation in every generation: how it passed from one righteous person to another, up to six hundred thousand, until it reached the one of whom it is said, “In that he too is flesh.” “In that he too” refers to Abel; and the early sages explained that “in that he too” refers to Moses.',
    'In its exposition of Abel’s birth, Tikkunei Zohar connects Abel with Moses through the verse containing beshagam. This supplies the kabbalistic identification presupposed by the phrase “Moses is the rectification of Abel”; its application to the repair of envy is developed here by Rav Tzadok.',
    anchor_end='תִּיקּוּן הֶבֶל')

# 85. The original proverb, private pride, Cain's offering, and the inclination disguised as good.
add(85, 'bava-metzia-coin-in-jug', 2, 'Bava Metzia 85b:2',
    primary('Bava Metzia 85b', 1),
    'Rav Chama said: What is meant by the verse, “Wisdom rests in the heart of one who understands, but among fools it makes itself known”? “Wisdom rests in the heart of one who understands” refers to a Torah scholar who is the son of a Torah scholar. “Among fools it makes itself known” refers to a Torah scholar who is the son of an unlearned man. Ulla said: This is what people say, “A coin in a jug cries, ‘Clink, clink.’”',
    'The Gemara applies the proverb to the conspicuous display of learning. Rav Tzadok extends the image to self-satisfaction about one’s spiritual achievements.',
    anchor_end='קָרְיָא",')

add(85, 'rashi-empty-full-vessel', 2, 'Rashi on Bava Metzia 85b:2:3-4',
    primary('Rashi on Bava Metzia 85b', 1, 2) + ' ' + primary('Rashi on Bava Metzia 85b', 1, 3),
    '“A coin in a jug”—a single sela in a jug. “It cries, ‘Clink, clink’”—it rattles and makes a sound. If it were full of sela-coins, it would not make a sound.',
    'Rashi gives the precise contrast assumed here: the lone coin rattles, while the full container is quiet. Rav Tzadok uses that contrast to test whether perceived spiritual abundance is real.')

add(85, 'shaarei-teshuvah-private-pride', 4, "Sha'arei Teshuvah 3:163",
    excerpt(primary('Shaarei Teshuvah 3:163'), 'וגם במחשבת הגאוה מבלי השתרר נפסד האדם.', 'תועבת ה\' כל גבה לב.'),
    'A person is also corrupted by the thought of pride even without exercising domination, as it is said: “Every haughty heart is an abomination to the Lord.”',
    'Rabbeinu Yonah distinguishes inward pride from the outward act of lording over other people. The harm therefore does not depend on public boasting, exactly as Rav Tzadok states here.')

add(85, 'tanchuma-cain-inferior-offering', 6, 'Midrash Tanchuma, Bereshit 9:1',
    excerpt(primary('Midrash Tanchuma, Bereshit 9', 0), 'ויבא קין מפרי האדמה, מהו?', 'והבל הביא גם הוא מבכורות צאנו ומחלבהן'),
    '“Cain brought from the fruit of the ground”—what does this mean? From the leftovers of his food. The Rabbis say that it was flaxseed. “Abel also brought from the firstborn of his flock and their fat portions.”',
    'The Midrash contrasts Cain’s offering with Abel’s choice offering and records the alternative identification as flaxseed. Rav Tzadok asks how Cain could nevertheless regard his own offering as a great act of service.',
    anchor_end='דָּבָר גָּרוּעַ')

add(85, 'peri-tzadik-inclination-disguised-as-guide', 7, 'Peri Tzadik, Beshalach 14:1',
    excerpt(local('peri-tzadik', 'Peri Tzadik, Beshalach 14:1'), 'וכענין מה שאמרנו במ"ש (ברכות סא.)', 'ונדמה לו שעושה מצוה.'),
    'This is like what we explained concerning the teaching in Berakhot that the evil inclination resembles a fly and sits between the two openings of the heart. Sometimes the evil inclination turns toward “the heart of the wise at his right” and conceals itself as a teacher guiding the person for his benefit. The person then commits a transgression while imagining that he is performing a mitzvah.',
    'This parallel explains the specific deception described here: a person can mistake an impulse of the inclination for a wholly good intention. It supplies the reason for examining the inner motives of an apparently good deed.', reader=True)

assert len(entries) == 27
assert len({(e['section'], e['id']) for e in entries}) == len(entries)

catalog = json.loads((ROOT / 'tmp/batch-engineering/current-site/library/connected-ideas/catalog.json').read_text())
coverage = []
decisions = {
    81: 'Preserved the existing Sanhedrin 105b, Nedarim 22a–b, Megillah 28a, Avodah Zarah 5a, and Tiferet Yosef quotations. Selected distinct sources for succession, the two Moses narratives, the exact wellspring wording, spiritual attachment to the Land, the legal qualification about actual landownership, prayer orientation, and the complete scriptural verse. The broader parallel passages in Likkutei Maamarim repeat the four-cubit explanation supplied by Dover Tzedek.',
    82: 'Preserved all four existing native notes. Devarim Rabbah supplies the prayer-specific formulation absent from the existing Vayikra Rabbah quotation; Peri Tzadik explains the incompleteness of the confession. The decree from Genesis is already included within the selected Devarim Rabbah quotation, so no separate repetition of that verse is added.',
    83: 'Preserved all existing notes, including the full actual Machshavot Charutz 10:3 quotation and the connected Peri Tzadik quotation about effort. Added only the unquoted Megillah qualification, Shelah’s distinction in who initiates awakening, the cow/calf passage, Maharal’s account of an unexpected find, and Rabbi Akiva’s separate episode. The existing Nedarim note supplies Rav Gamda only.',
    84: 'Preserved the existing biblical, Taanit, Sotah, Shabbat, Yerushalmi, and Yisrael Kedoshim quotations. Selected the two original commentaries underlying the opening wording, the canonical Machshavot Charutz passage on thought hidden from oneself, the unquoted study-house prayer with Rashi’s explanation, and the original Tikkunei Zohar identification. Bereshit Rabbah 9:3 and Sefat Emet are related parallels; the precise hidden-from-self formulation is supplied here by Machshavot Charutz.',
    85: 'Preserved the existing Kiddushin, Zohar, Proverbs, Genesis, and connected Peri Tzadik Chanukah quotation. Added the unquoted Bava Metzia proverb and its exact Rashi explanation, Rabbeinu Yonah on private pride, the original Tanchuma on Cain’s offering, and the distinct canonical Peri Tzadik passage about the inclination masquerading as a teacher. The Chanukah quotation concerns humility and Torah, not that latter deception.',
}
for section in range(81, 86):
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

result = {'schemaVersion': 1, 'reviewedSections': list(range(81, 86)),
          'reviewMode': 'Add only missing original-source quotations; preserve every existing note and all body text.',
          'entries': entries, 'coverage': coverage, 'observationsNotApplied': [],
          'sourceVerification': 'External quotations checked against retrieved original Hebrew/Aramaic. Internal quotations checked against the canonical reader wording, including its expansions and paragraph references. No commentary compilation is credited or linked in public note content.',
          'reproducibleBuilder': 'review-work/build-81-85.py'}
(WORK / 'ois-81-85.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
(WORK / 'ois81-selected-primary.json').write_text(json.dumps(SELECTED, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'entries': len(entries), 'counts': {s: sum(e['section'] == s for e in entries) for s in range(81, 86)},
                  'proposal': str(WORK / 'ois-81-85.json'), 'primaryEvidence': str(WORK / 'ois81-selected-primary.json')}, ensure_ascii=False))

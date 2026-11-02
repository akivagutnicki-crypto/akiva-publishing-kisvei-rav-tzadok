"""Detect explicit source citations in Rav Tzadok's Hebrew and resolve them to Sefaria references.

Handles the citation styles of the Lublin/Har Bracha printings and of Rav Tzadok's own prose:
  (ברכות מח.)  (ברכות מח:)  (ברכות דף מ"ח ע"א)  (שבת פ"ח ב)     -> Bavli daf
  (שמות יב יא) (שמות י"ב, י"א) (תהלים קי"א י') (משלי ג ו)        -> Tanakh verse
  (שמו"ר ל ג) (ב"ר פ"א, א) (ויק"ר כ"ט ח) (תנחומא בראשית א)       -> Midrash
  (זוהר ח"ג רלב.) (זוה"ק ח"א קלח ע"א) (תיקו"ז תיקון כ"א)          -> Zohar (via daf structure) / Tikkunei Zohar
  (אבות פ"ב מי"ב) (משנה ברכות פ"א מ"א)                             -> Mishnah
  (רמב"ם הל' דעות פ"ג ה"ג)                                          -> Mishneh Torah
  (או"ח סי' א) (שו"ע יו"ד סי' רמ"ו)                                -> Shulchan Arukh
  (ירושלמי ברכות פ"א ה"א)                                          -> Jerusalem Talmud
Also finds the work names Rav Tzadok invokes without a locator (e.g. "כמו שכתב הרמב"ם", "בזוה"ק") as weak leads.
"""
import re
from .sefaria import plausible
from .hebrew import gematria_number, strip_nikkud, GERESH, GERSHAYIM

BAVLI = {
    'ברכות': 'Berakhot', 'שבת': 'Shabbat', 'עירובין': 'Eruvin', 'פסחים': 'Pesachim', 'יומא': 'Yoma', 'סוכה': 'Sukkah', 'ביצה': 'Beitzah',
    'ראש השנה': 'Rosh Hashanah', 'ר"ה': 'Rosh Hashanah', 'תענית': 'Taanit', 'מגילה': 'Megillah',
    'מועד קטן': 'Moed Katan', 'מו"ק': 'Moed Katan', 'חגיגה': 'Chagigah', 'יבמות': 'Yevamot', 'כתובות': 'Ketubot',
    'נדרים': 'Nedarim', 'נזיר': 'Nazir', 'סוטה': 'Sotah', 'גיטין': 'Gittin', 'קידושין': 'Kiddushin', 'קדושין': 'Kiddushin',
    'בבא קמא': 'Bava Kamma', 'ב"ק': 'Bava Kamma', 'בבא מציעא': 'Bava Metzia', 'ב"מ': 'Bava Metzia',
    'בבא בתרא': 'Bava Batra', 'ב"ב': 'Bava Batra', 'סנהדרין': 'Sanhedrin', 'מכות': 'Makkot', 'שבועות': 'Shevuot',
    'עבודה זרה': 'Avodah Zarah', 'ע"ז': 'Avodah Zarah', 'הוריות': 'Horayot', 'זבחים': 'Zevachim', 'מנחות': 'Menachot',
    'חולין': 'Chullin', 'בכורות': 'Bekhorot', 'ערכין': 'Arakhin', 'תמורה': 'Temurah', 'כריתות': 'Keritot', 'מעילה': 'Meilah', 'תמיד': 'Tamid',
    'נדה': 'Niddah', 'נידה': 'Niddah',
}
TANAKH = {
    'בראשית': 'Genesis', 'שמות': 'Exodus', 'ויקרא': 'Leviticus', 'במדבר': 'Numbers', 'דברים': 'Deuteronomy', 'יהושע': 'Joshua',
    'שופטים': 'Judges', 'שמואל א': 'I Samuel', 'שמואל ב': 'II Samuel', 'ש"א': 'I Samuel', 'ש"ב': 'II Samuel', 'מלכים א': 'I Kings',
    'מלכים ב': 'II Kings', 'מ"א': 'I Kings', 'מ"ב': 'II Kings', 'ישעיה': 'Isaiah', 'ישעיהו': 'Isaiah', 'ירמיה': 'Jeremiah', 'ירמיהו': 'Jeremiah',
    'יחזקאל': 'Ezekiel', 'הושע': 'Hosea', 'יואל': 'Joel', 'עמוס': 'Amos', 'עובדיה': 'Obadiah', 'יונה': 'Jonah', 'מיכה': 'Micah', 'נחום': 'Nahum',
    'חבקוק': 'Habakkuk', 'צפניה': 'Zephaniah', 'חגי': 'Haggai', 'זכריה': 'Zechariah', 'מלאכי': 'Malachi', 'תהלים': 'Psalms', 'תהילים': 'Psalms',
    'משלי': 'Proverbs', 'איוב': 'Job', 'שיר השירים': 'Song of Songs', 'שה"ש': 'Song of Songs', 'שהש': 'Song of Songs', 'רות': 'Ruth',
    'איכה': 'Lamentations', 'קהלת': 'Ecclesiastes', 'אסתר': 'Esther', 'דניאל': 'Daniel', 'עזרא': 'Ezra', 'נחמיה': 'Nehemiah',
    'דברי הימים א': 'I Chronicles', 'דברי הימים ב': 'II Chronicles', 'דה"י א': 'I Chronicles', 'דה"י ב': 'II Chronicles',
}
MIDRASH = {
    'בראשית רבה': 'Bereshit Rabbah', 'ב"ר': 'Bereshit Rabbah', 'שמות רבה': 'Shemot Rabbah', 'שמו"ר': 'Shemot Rabbah',
    'ויקרא רבה': 'Vayikra Rabbah', 'ויק"ר': 'Vayikra Rabbah', 'במדבר רבה': 'Bamidbar Rabbah',
    'במ"ר': 'Bamidbar Rabbah', 'דברים רבה': 'Devarim Rabbah', 'דב"ר': 'Devarim Rabbah',
    'שיר השירים רבה': 'Shir HaShirim Rabbah', 'שהש"ר': 'Shir HaShirim Rabbah', 'קהלת רבה': 'Kohelet Rabbah',
    'קה"ר': 'Kohelet Rabbah', 'אסתר רבה': 'Esther Rabbah', 'אסת"ר': 'Esther Rabbah', 'איכה רבה': 'Eichah Rabbah',
    'איכ"ר': 'Eichah Rabbah', 'רות רבה': 'Ruth Rabbah', 'מדרש תהלים': 'Midrash Tehillim', 'שוחר טוב': 'Midrash Tehillim',
    'תנא דבי אליהו': 'Tanna Debei Eliyahu Rabbah', 'תדב"א': 'Tanna Debei Eliyahu Rabbah', 'פרקי דר"א': 'Pirkei DeRabbi Eliezer',
    'פרקי דרבי אליעזר': 'Pirkei DeRabbi Eliezer', 'פדר"א': 'Pirkei DeRabbi Eliezer', 'ילקוט שמעוני': 'Yalkut Shimoni', 'ילקוט': 'Yalkut Shimoni',
    'מכילתא': 'Mekhilta d\'Rabbi Yishmael', 'ספרי': 'Sifrei', 'ספרא': 'Sifra', 'תורת כהנים': 'Sifra', 'פסיקתא רבתי': 'Pesikta Rabbati',
    'פסיקתא דר"כ': 'Pesikta DeRav Kahanna', 'תנחומא': 'Midrash Tanchuma', 'מדרש רבה': 'Midrash Rabbah',
}
RAMBAM_HILCHOT = {
    'דעות': 'Human Dispositions', 'יסודי התורה': 'Foundations of the Torah', 'יסוה"ת': 'Foundations of the Torah', 'תשובה': 'Repentance',
    'תלמוד תורה': 'Torah Study', 'ת"ת': 'Torah Study', 'ע"ז': 'Foreign Worship and Customs of the Nations', 'עבודה זרה': 'Foreign Worship and Customs of the Nations',
    'ק"ש': 'Reading the Shema', 'קריאת שמע': 'Reading the Shema', 'תפלה': 'Prayer and the Priestly Blessing', 'תפילה': 'Prayer and the Priestly Blessing',
    'תפילין': 'Tefillin, Mezuzah and the Torah Scroll', 'ברכות': 'Blessings', 'מילה': 'Circumcision', 'שבת': 'Sabbath', 'מלכים': 'Kings and Wars',
    'מלכים ומלחמותיהם': 'Kings and Wars', 'איסורי ביאה': 'Forbidden Intercourse', 'אישות': 'Marriage', 'גירושין': 'Divorce', 'יבום': 'Levirate Marriage and Release',
    'מאכלות אסורות': 'Forbidden Foods', 'שחיטה': 'Ritual Slaughter', 'סנהדרין': 'The Sanhedrin and the Penalties within their Jurisdiction',
    'עדות': 'Testimony', 'ממרים': 'Rebels', 'אבל': 'Mourning', 'בית הבחירה': 'The Chosen Temple', 'כלי המקדש': 'Vessels of the Sanctuary and Those who Serve Therein',
    'מעשה הקרבנות': 'Sacrificial Procedure', 'תמידין ומוספין': 'Daily Offerings and Additional Offerings', 'חמץ ומצה': 'Leavened and Unleavened Bread',
    'שופר': 'Shofar, Sukkah and Lulav', 'מגילה': 'Scroll of Esther and Hanukkah', 'מגילה וחנוכה': 'Scroll of Esther and Hanukkah', 'לולב': 'Shofar, Sukkah and Lulav',
    'תעניות': 'Fasts', 'קידוש החודש': 'Sanctification of the New Month', 'מתנות עניים': 'Gifts to the Poor', 'שמיטה ויובל': 'Sabbatical Year and the Jubilee',
    'מקוואות': 'Immersion Pools', 'טומאת מת': 'Defilement by a Corpse', 'פרה אדומה': 'Red Heifer', 'נזירות': 'Nazariteship', 'שבועות': 'Oaths',
    'נדרים': 'Vows', 'ערכין': 'Appraisals and Devoted Property', 'ערכין וחרמין': 'Appraisals and Devoted Property', 'מעילה': 'Trespass',
    'שגגות': 'Unintentional Transgressions', 'מחוסרי כפרה': 'Those Who Lack Atonement', 'תמורה': 'Substitution', 'חובל ומזיק': 'One Who Injures a Person or Property',
    'רוצח': 'Murderer and the Preservation of Life', 'גניבה': 'Theft', 'גזילה': 'Robbery and Lost Property', 'מכירה': 'Sales', 'זכיה ומתנה': 'Ownerless Property and Gifts',
    'שכנים': 'Neighbors', 'שלוחין ושותפין': 'Agents and Partners', 'עבדים': 'Slaves', 'שכירות': 'Hiring', 'שאלה ופקדון': 'Borrowing and Deposit',
    'מלוה ולוה': 'Creditor and Debtor', 'טוען ונטען': 'Plaintiff and Defendant', 'נחלות': 'Inheritances', 'ציצית': 'Fringes', 'מזוזה': 'Tefillin, Mezuzah and the Torah Scroll',
    'ספר תורה': 'Tefillin, Mezuzah and the Torah Scroll', 'בכורים': 'First Fruits and other Gifts to Priests Outside the Sanctuary', 'תרומות': 'Heave Offerings',
    'מעשר': 'Tithes', 'מעשר שני': 'Second Tithes and Fourth Year\'s Fruit', 'כלאים': 'Diverse Species', 'חגיגה': 'Festival Offering', 'בכורות': 'Firstlings',
    'שגגות': 'Unintentional Transgressions', 'כלים': 'Vessels', 'טומאת אוכלין': 'Defilement of Foods', 'טומאת צרעת': 'Defilement by Leprosy',
    'מטמאי משכב ומושב': 'Those Who Defile Bed or Seat', 'שאר אבות הטומאה': 'Other Sources of Defilement', 'איסורי מזבח': 'Things Forbidden on the Altar',
    'פסולי המוקדשין': 'Sacrifices Rendered Unfit', 'עבודת יום הכפורים': 'Service on the Day of Atonement', 'ביאת המקדש': 'Entering the Sanctuary',
    'קרבן פסח': 'Paschal Offering', 'תמידין': 'Daily Offerings and Additional Offerings', 'יום טוב': 'Rest on a Holiday', 'שביתת יו"ט': 'Rest on a Holiday',
    'שביתת עשור': 'Rest on the Tenth of Tishrei', 'עירובין': 'Eruvin', 'ברכות': 'Blessings',
}
SHULCHAN = {'או"ח': 'Shulchan Arukh, Orach Chayim', 'אורח חיים': 'Shulchan Arukh, Orach Chayim', 'יו"ד': 'Shulchan Arukh, Yoreh De\'ah',
            'יורה דעה': 'Shulchan Arukh, Yoreh De\'ah', 'אה"ע': 'Shulchan Arukh, Even HaEzer', 'אבן העזר': 'Shulchan Arukh, Even HaEzer',
            'חו"מ': 'Shulchan Arukh, Choshen Mishpat', 'חושן משפט': 'Shulchan Arukh, Choshen Mishpat'}
MISHNAH_TRACTATE_EXTRA = {'אבות': 'Pirkei Avot', 'פאה': 'Mishnah Peah', 'דמאי': 'Mishnah Demai', 'כלאים': 'Mishnah Kilayim', 'שביעית': 'Mishnah Sheviit',
                          'תרומות': 'Mishnah Terumot', 'מעשרות': 'Mishnah Maasrot', 'מעשר שני': 'Mishnah Maaser Sheni', 'חלה': 'Mishnah Challah',
                          'ערלה': 'Mishnah Orlah', 'בכורים': 'Mishnah Bikkurim', 'שקלים': 'Mishnah Shekalim', 'עדיות': 'Mishnah Eduyot',
                          'מדות': 'Mishnah Middot', 'קינים': 'Mishnah Kinnim', 'כלים': 'Mishnah Kelim', 'אהלות': 'Mishnah Oholot', 'נגעים': 'Mishnah Negaim',
                          'פרה': 'Mishnah Parah', 'טהרות': 'Mishnah Tahorot', 'מקואות': 'Mishnah Mikvaot', 'מכשירין': 'Mishnah Makhshirin', 'זבים': 'Mishnah Zavim',
                          'טבול יום': 'Mishnah Tevul Yom', 'ידים': 'Mishnah Yadayim', 'עוקצין': 'Mishnah Oktzin', 'תמיד': 'Mishnah Tamid', 'מדות': 'Mishnah Middot'}

Q = '["\'׳״]'  # quote-like marks inside numerals
NUM = f'[א-ת]{{1,3}}(?:{Q}[א-ת]{{1,2}})?{Q}?'  # Hebrew numeral with optional gershayim
NUM_RE = re.compile(NUM)


NOT_NUMERALS = {'שם', 'שמ'}  # "שם" (ibid.) would otherwise read as 340


def num(s):
    s = s.replace(GERSHAYIM, '"').replace(GERESH, "'")
    if s.strip('"\'') in NOT_NUMERALS:
        return None
    return gematria_number(s)


def _clean(s):
    return strip_nikkud(s).replace(GERSHAYIM, '"').replace(GERESH, "'").replace('״', '"').replace('׳', "'")


def _alt(d):
    return '|'.join(sorted((re.escape(k) for k in d), key=len, reverse=True))


DAF_RE = re.compile(r'(?:מס(?:כת|\')\s+)?(' + _alt(BAVLI) + r')\s+(?:דף\s+)?(' + NUM + r')\s*(?:(?P<marker>\.|:|,)|(?P<side>ע"?[אב]|ע\'[אב]|\s+[אב]\b))?')
DAF_SIDE_RE = re.compile(r'(?:ע"?([אב])|ע\'([אב]))')
VERSE_RE = re.compile(r'(' + _alt(TANAKH) + r')\s+(' + NUM + r')\s*[,:\.]?\s+(' + NUM + r')\b')
VERSE_CHAPTER_RE = re.compile(r'(' + _alt(TANAKH) + r')\s+(' + NUM + r')\b')
MIDRASH_RE = re.compile(r'(' + _alt(MIDRASH) + r')\s+(?:פ(?:רשה|\')?\s*)?(' + NUM + r')\s*[,:\.]?\s*(?:סי\'?\s*|אות\s*)?(' + NUM + r')?\b')
ZOHAR_RE = re.compile(r'(?:זוהר|זהר|זוה"ק|זוה"ק|זוהר הקדוש|בזוהר|בזוה"ק|בזהר)\s*(?:הק\'\s*)?(?:ח"([אבג])|חלק\s+([אבג]))\s*[,:\.]?\s*(?:דף\s+)?(' + NUM + r')\s*(?:(\.|:)|ע"?([אב]))?')
ZOHAR_PARSHA_RE = re.compile(r'(?:זוהר|זהר|זוה"ק)\s+(?:פ(?:רשת|\')\s+)?([א-ת]+(?:\s[א-ת]+)?)\s+(?:דף\s+)?(' + NUM + r')\s*(?:(\.|:)|ע"?([אב]))?')
TIKKUNEI_RE = re.compile(r'(?:תיקוני(?:ם)? זוהר|תיקו"ז|תקו"ז|תקוני זוהר|תיקונים)\s*(?:תיקון\s+|ת\'\s+)?(' + NUM + r')')
MISHNAH_RE = re.compile(r'(?:משנה\s+)?(' + _alt({**MISHNAH_TRACTATE_EXTRA, **{k: v for k, v in BAVLI.items() if len(k) > 2}}) + r')\s+פ"?(' + NUM + r')\s*[,:\.]?\s*מ"?(' + NUM + r')')
RAMBAM_RE = re.compile(r'(?:רמב"ם|הרמב"ם)?\s*(?:ב?הל(?:כות|\')\s+)(' + _alt(RAMBAM_HILCHOT) + r')\s+פ"?(' + NUM + r')\s*[,:\.]?\s*ה"?(' + NUM + r')')
SHULCHAN_RE = re.compile(r'(?:שו"ע\s+|שולחן ערוך\s+)?(' + _alt(SHULCHAN) + r')\s+(?:סי(?:מן|\')\s*)(' + NUM + r')(?:\s*(?:ס"?ק|סעיף)\s*(' + NUM + r'))?')
YERUSHALMI_RE = re.compile(r'(?:ירושלמי|ירוש\')\s+(' + _alt(BAVLI) + r')\s+פ"?(' + NUM + r')\s*[,:\.]?\s*ה"?(' + NUM + r')')

WORK_MENTIONS = {
    'רמב"ם': 'Mishneh Torah', 'הרמב"ם': 'Mishneh Torah', 'רש"י': 'Rashi', 'תוס\'': 'Tosafot', 'תוספות': 'Tosafot', 'רמב"ן': 'Ramban', 'הרמב"ן': 'Ramban',
    'מהר"ל': 'Maharal', 'האריז"ל': 'Arizal', 'אריז"ל': 'Arizal', 'של"ה': 'Shenei Luchot HaBerit', 'השל"ה': 'Shenei Luchot HaBerit', 'ספר יצירה': 'Sefer Yetzirah',
    'כוזרי': 'Kuzari', 'חובת הלבבות': 'Duties of the Heart', 'עץ חיים': 'Etz Chaim', 'פרדס': 'Pardes Rimonim', 'תניא': 'Tanya', 'מהרש"א': 'Maharsha',
    'ריטב"א': 'Ritva', 'רשב"א': 'Rashba', 'ר"ן': 'Ran', 'רא"ש': 'Rosh', 'הרא"ש': 'Rosh', 'טור': 'Tur', 'ב"ח': 'Bach', 'ט"ז': 'Taz', 'מג"א': 'Magen Avraham',
    'רבינו יונה': 'Rabbeinu Yonah', 'ראב"ד': 'Raavad', 'הראב"ד': 'Raavad', 'ספר חסידים': 'Sefer Chasidim', 'רוקח': 'Sefer HaRokeach', 'הרוקח': 'Sefer HaRokeach',
    'אבן עזרא': 'Ibn Ezra', 'ספורנו': 'Sforno', 'אלשיך': 'Alshich', 'בעל הטורים': 'Baal HaTurim', 'רד"ק': 'Radak', 'מצודות': 'Metzudat David',
    'מגיד מישרים': 'Maggid Meisharim', 'ראשית חכמה': 'Reshit Chochmah', 'שערי אורה': "Sha'arei Orah", 'שער הכוונות': "Sha'ar HaKavanot", 'פרי עץ חיים': 'Pri Etz Chaim',
    'ספר הבהיר': 'Sefer HaBahir', 'בהיר': 'Sefer HaBahir', 'היכלות': 'Heichalot', 'נפש החיים': 'Nefesh HaChaim', 'בעש"ט': 'Baal Shem Tov', 'הבעש"ט': 'Baal Shem Tov',
    'מגיד': 'Maggid of Mezritch', 'ליקוטי תורה': 'Likkutei Torah', 'נועם אלימלך': 'Noam Elimelech', 'קדושת לוי': 'Kedushat Levi', 'אוהב ישראל': 'Ohev Yisrael',
    'מי השילוח': 'Mei HaShiloach', 'בית יעקב': 'Beit Yaakov', 'ספר הזכרונות': 'Sefer HaZikhronot', 'רסיסי לילה': 'Resisei Layla', 'צדקת הצדיק': 'Tzidkat HaTzadik',
    'פרי צדיק': 'Peri Tzadik', 'תקנת השבין': 'Takanat HaShavin', 'דובר צדק': 'Dover Tzedek', 'מחשבות חרוץ': 'Machshavot Charutz', 'ישראל קדושים': 'Yisrael Kedoshim',
    'קומץ המנחה': 'Kometz HaMinchah', 'פוקד עקרים': 'Poked Akarim', 'דברי סופרים': 'Divrei Soferim', 'ליקוטי מאמרים': 'Likkutei Maamarim',
}
WORK_RE = re.compile('(' + _alt(WORK_MENTIONS) + r')(?![א-ת])')


def _daf(numeral, marker, side_group):
    n = num(numeral)
    if not n:
        return None
    side = 'a'
    if marker == ':':
        side = 'b'
    elif side_group:
        side = 'b' if 'ב' in side_group else 'a'
    return f'{n}{side}'


def detect(text):
    """Return a list of detected citations: {kind, text, ref, span, confidence}."""
    t = _clean(text)
    found = []
    taken = []

    def free(a, b):
        return all(b <= s or a >= e for s, e in taken)

    def add(kind, m, ref, conf, extra=None):
        if ref and free(*m.span()):
            taken.append(m.span())
            rec = {'kind': kind, 'text': m.group(0).strip(), 'ref': ref, 'span': m.span(), 'confidence': conf}
            if extra:
                rec.update(extra)
            found.append(rec)

    for m in ZOHAR_RE.finditer(t):
        vol = {'א': 1, 'ב': 2, 'ג': 3}[m.group(1) or m.group(2)]
        d = _daf(m.group(3), m.group(4), m.group(5))
        if d:
            add('zohar-daf', m, f'Zohar {vol}:{d}', 0.9, {'volume': vol, 'daf': d})
    for m in TIKKUNEI_RE.finditer(t):
        n = num(m.group(1))
        if n:
            add('tikkunei-zohar', m, f'Tikkunei Zohar {n}', 0.8)
    for m in YERUSHALMI_RE.finditer(t):
        tr = BAVLI.get(m.group(1))
        ch, hal = num(m.group(2)), num(m.group(3))
        if tr and ch and hal:
            add('yerushalmi', m, f'Jerusalem Talmud {tr} {ch}:{hal}', 0.85)
    for m in RAMBAM_RE.finditer(t):
        h = RAMBAM_HILCHOT.get(m.group(1))
        ch, hal = num(m.group(2)), num(m.group(3))
        if h and ch and hal:
            add('rambam', m, f'Mishneh Torah, {h} {ch}:{hal}', 0.85)
    for m in SHULCHAN_RE.finditer(t):
        part = SHULCHAN.get(m.group(1))
        si = num(m.group(2))
        se = num(m.group(3)) if m.group(3) else None
        if part and si:
            add('shulchan-arukh', m, f'{part} {si}' + (f':{se}' if se else ''), 0.8)
    for m in MISHNAH_RE.finditer(t):
        name = m.group(1)
        tr = MISHNAH_TRACTATE_EXTRA.get(name) or ('Mishnah ' + BAVLI[name] if name in BAVLI else None)
        ch, mi = num(m.group(2)), num(m.group(3))
        if tr and ch and mi:
            add('mishnah', m, f'{tr} {ch}:{mi}', 0.85)
    for m in MIDRASH_RE.finditer(t):
        work = MIDRASH.get(m.group(1))
        a = num(m.group(2))
        b = num(m.group(3)) if m.group(3) else None
        if work and a:
            add('midrash', m, f'{work} {a}' + (f':{b}' if b else ''), 0.75 if b else 0.6)
    for m in DAF_RE.finditer(t):
        tr = BAVLI.get(m.group(1))
        d = _daf(m.group(2), m.group('marker'), m.group('side'))
        if tr and d:
            add('bavli', m, f'{tr} {d}', 0.9)
    for m in VERSE_RE.finditer(t):
        bk = TANAKH.get(m.group(1))
        ch, v = num(m.group(2)), num(m.group(3))
        if bk and ch and v:
            add('verse', m, f'{bk} {ch}:{v}', 0.9)
    for m in VERSE_CHAPTER_RE.finditer(t):
        bk = TANAKH.get(m.group(1))
        ch = num(m.group(2))
        if bk and ch and free(*m.span()):
            add('verse-chapter', m, f'{bk} {ch}', 0.5)
    for m in WORK_RE.finditer(t):
        if free(*m.span()):
            found.append({'kind': 'work-mention', 'text': m.group(0), 'ref': None, 'work': WORK_MENTIONS[m.group(1)], 'span': m.span(), 'confidence': 0.3})
    found = [f for f in found if not f.get('ref') or plausible(f['ref'])]
    found.sort(key=lambda x: x['span'][0])
    return found


def detect_quotes(text):
    """Return the substrings Rav Tzadok sets in quotation marks (verbatim quotes of verses/sayings)."""
    t = strip_nikkud(text)
    out = []
    for m in re.finditer(r'["“„]([^"”“]{6,160})["”“]', t):
        q = m.group(1).strip()
        if len(q.split()) >= 2:
            out.append({'text': q, 'span': m.span()})
    return out

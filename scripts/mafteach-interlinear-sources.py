"""Verified source references of a finished interlinear edition (revNN.jsonl) -> HaMafteach curated-sources JSON.
Usage: edition_sources.py EDITION_DIR UNITS_JSON LIBRARY_REFS OUT_JSON"""
import json, glob, re, sys, collections
D, UNITS, REFS, OUT = sys.argv[1:5]
valid = set(l.strip() for l in open(REFS, encoding='utf-8') if l.strip())
SEC = {'Sukkos': 'Sukkot', 'Vayeilech and Shabbos Shuvah': 'Vayeilech and Shabbat Shuvah'}
TANACH = {'Bereishis':'Genesis','Shemos':'Exodus','Vayikra':'Leviticus','Bamidbar':'Numbers','Devarim':'Deuteronomy','Yehoshua':'Joshua',
 'Shoftim':'Judges','Shmuel I':'I Samuel','Shmuel II':'II Samuel','Melachim I':'I Kings','Melachim II':'II Kings','Yeshayahu':'Isaiah','Yeshayah':'Isaiah',
 'Yirmiyahu':'Jeremiah','Yirmeyahu':'Jeremiah','Yechezkel':'Ezekiel','Hoshea':'Hosea','Yoel':'Joel','Amos':'Amos','Ovadiah':'Obadiah','Yonah':'Jonah',
 'Michah':'Micah','Nachum':'Nahum','Chavakuk':'Habakkuk','Tzefaniah':'Zephaniah','Chaggai':'Haggai','Zechariah':'Zechariah','Malachi':'Malachi',
 'Tehillim':'Psalms','Mishlei':'Proverbs','Iyov':'Job','Shir HaShirim':'Song of Songs','Rus':'Ruth','Eichah':'Lamentations','Koheles':'Ecclesiastes',
 'Esther':'Esther','Daniel':'Daniel','Ezra':'Ezra','Nechemiah':'Nehemiah','Divrei HaYamim I':'I Chronicles','Divrei HaYamim II':'II Chronicles'}
SHAS = {'Berachos':'Berakhot','Shabbos':'Shabbat','Eruvin':'Eruvin','Pesachim':'Pesachim','Shekalim':'Shekalim','Yoma':'Yoma','Sukkah':'Sukkah',
 'Beitzah':'Beitzah','Rosh Hashanah':'Rosh Hashanah','Taanis':'Taanit','Megillah':'Megillah','Moed Katan':'Moed Katan','Chagigah':'Chagigah',
 'Yevamos':'Yevamot','Kesubos':'Ketubot','Nedarim':'Nedarim','Nazir':'Nazir','Sotah':'Sotah','Gittin':'Gittin','Kiddushin':'Kiddushin',
 'Bava Kamma':'Bava Kamma','Bava Metzia':'Bava Metzia','Bava Basra':'Bava Batra','Sanhedrin':'Sanhedrin','Makkos':'Makkot','Shevuos':'Shevuot',
 'Avodah Zarah':'Avodah Zarah','Horayos':'Horayot','Zevachim':'Zevachim','Menachos':'Menachot','Chullin':'Chullin','Bechoros':'Bekhorot',
 'Arachin':'Arakhin','Temurah':'Temurah','Kerisos':'Keritot','Meilah':'Meilah','Tamid':'Tamid','Niddah':'Niddah'}
MID = {'Bereishis Rabbah':'Bereshit Rabbah','Shemos Rabbah':'Shemot Rabbah','Vayikra Rabbah':'Vayikra Rabbah','Bamidbar Rabbah':'Bamidbar Rabbah',
 'Devarim Rabbah':'Devarim Rabbah','Shir HaShirim Rabbah':'Shir HaShirim Rabbah','Koheles Rabbah':'Kohelet Rabbah','Eichah Rabbah':'Eichah Rabbah',
 'Rus Rabbah':'Ruth Rabbah','Esther Rabbah':'Esther Rabbah','Midrash Tehillim':'Midrash Tehillim','Pesikta Rabbasi':'Pesikta Rabbati',
 'Pesikta d\'Rav Kahana':'Pesikta D\'Rav Kahanna','Avos':'Pirkei Avot','Tanchuma':'Midrash Tanchuma'}
U = json.load(open(UNITS))
units = {u['id']: u for u in U}
mhead = {u['m']: u for u in U if u['type'] == 'heading'}
names = sorted(list(TANACH) + list(SHAS) + list(MID), key=len, reverse=True)
NAME = '|'.join(re.escape(n) for n in names)
cite = re.compile(rf'(?:(?:see|cf\.)\s+)?(?P<book>{NAME}|ibid\.)\s*,?\s*(?P<loc>\d+[ab]?(?::\d+)?(?:[–-]\d+[ab]?)?)?')
def ref(book, loc):
    if book in TANACH: return f'{TANACH[book]} {loc}' if loc and ':' in loc else None
    if book in SHAS: return f'{SHAS[book]} {loc}' if loc and re.match(r'^\d+[ab]', loc) else None
    if book in MID:
        if not loc: return None
        b = MID[book]
        if b == 'Pirkei Avot' and ':' not in loc: return None
        return f'{b} {loc}'
out = collections.OrderedDict(); n = 0; skipped = collections.Counter()
for f in sorted(glob.glob(f'{D}/rev[0-9][0-9].jsonl')):
    for line in open(f, encoding='utf-8'):
        d = json.loads(line)
        if 'segs' not in d: continue
        u = mhead[units[d['id']]['m']]
        passage = f"Peri Tzadik, {SEC.get(u['sec'], u['sec'])} {u.get('n') or ''}".strip()
        if passage not in valid:
            passage2 = f"Peri Tzadik, {SEC.get(u['sec'], u['sec'])}"
            if passage2 not in valid: skipped[passage] += 1; continue
            passage = passage2
        last = None
        for he, en in d['segs']:
            for paren in re.findall(r'\(([^()]*)\)', en):
                for part in re.split(r';\s*', paren):
                    m = cite.match(part.strip())
                    if not m:
                        if re.search(r'\d', part): last = None   # another source (Zohar, Rashi, Tikkunim…): "ibid." no longer points back
                        continue
                    book, loc = m['book'], m['loc']
                    if book == 'ibid.':
                        if not last: continue
                        book = last[0]
                        if not loc: loc = last[1]
                        elif book in TANACH and ':' not in loc and last[1] and ':' in last[1]: loc = last[1].split(':')[0] + ':' + loc
                    r = ref(book, loc)
                    last = (book, loc)
                    if not r: continue
                    r = r.replace('–', '-')
                    lst = out.setdefault(passage, [])
                    if not any(x[0] == r for x in lst): lst.append([r, f'{book} {loc}'.replace('–', '-')]); n += 1
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('passages', len(out), 'source links', n, 'unmatched passages', dict(skipped))

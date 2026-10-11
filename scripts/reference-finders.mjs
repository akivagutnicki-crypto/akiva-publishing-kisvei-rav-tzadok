// Source-form matchers used by the Akiva Publishing editions that the generic
// alias table in citations.mjs cannot express: Zohar folios, Tikkunei Zohar,
// Midrash Tanchuma, Mishnah-only tractates, Mishneh Torah by its printed
// transliterations, Pesikta, Sefer Chasidim, Sefer HaChinukh, Tanya, Rav
// Tzadok's own works (Peri Tzadik, Kometz HaMinchah ...) and Mei HaShiloach.
// Each finder returns {index, length, ref} over a plain-text string. Every
// target was checked against Sefaria's schema; folio references use the
// checked-in Zohar map (Sefaria cannot address a Zohar folio directly).
import fs from 'node:fs';
const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const map = read('../sources/akiva/references/Likkutei_Maamarim.json');
let libraryRefs = {};
try { libraryRefs = read('../sources/akiva/references/Library_refs.json'); } catch { /* generated file; library links are skipped without it */ }

const clean = s => s.toLowerCase().replace(/[^a-z]/g, '');
const A = "['’]?";                     // optional apostrophe
const alt = list => list.map(s => s.replace(/ /g, '\\s*').replace(/'/g, A)).join('|');

// ---- parashot: [canonical Sefaria name, Zohar node, Torah book, aliases...] ----
const PARASHOT = [
  ['Bereshit', 'Bereshit', 'Genesis', 'Bereishis', 'Bereishit', 'Bereshit', 'Bereishis'],
  ['Noach', 'Noach', 'Genesis', 'Noach', 'Noah'],
  ['Lech Lecha', 'Lech Lecha', 'Genesis', 'Lech Lecha', 'Lekh Lekha', 'Lech-Lecha'],
  ['Vayera', 'Vayera', 'Genesis', 'Vayeira', 'Vayera'],
  ['Chayei Sara', 'Chayei Sara', 'Genesis', 'Chayei Sarah', 'Chayei Sara', 'Chayey Sarah', 'Chaye Sarah'],
  ['Toldot', 'Toldot', 'Genesis', 'Toldos', 'Toldot'],
  ['Vayetzei', 'Vayetzei', 'Genesis', 'Vayeitzei', 'Vayetzei', 'Vayeitze'],
  ['Vayishlach', 'Vayishlach', 'Genesis', 'Vayishlach'],
  ['Vayeshev', 'Vayeshev', 'Genesis', 'Vayeishev', 'Vayeshev', 'Vayeisheiv'],
  ['Miketz', 'Miketz', 'Genesis', 'Mikeitz', 'Miketz', 'Mikeitz'],
  ['Vayigash', 'Vayigash', 'Genesis', 'Vayigash'],
  ['Vayechi', 'Vayechi', 'Genesis', 'Vayechi', 'Vayechi'],
  ['Shemot', 'Shemot', 'Exodus', 'Shemos', 'Shemot'],
  ['Vaera', 'Vaera', 'Exodus', "Va'eira", "Va'era", 'Vaera', 'Vaeira'],
  ['Bo', 'Bo', 'Exodus', 'Bo'],
  ['Beshalach', 'Beshalach', 'Exodus', 'Beshalach'],
  ['Yitro', 'Yitro', 'Exodus', 'Yisro', 'Yitro'],
  ['Mishpatim', 'Mishpatim', 'Exodus', 'Mishpatim'],
  ['Terumah', 'Terumah', 'Exodus', 'Terumah', 'Teruma'],
  ['Tetzaveh', 'Tetzaveh', 'Exodus', 'Tetzaveh', 'Tetzave'],
  ['Ki Tisa', 'Ki Tisa', 'Exodus', 'Ki Tisa', 'Ki Tissa', 'Ki Sisa'],
  ['Vayakhel', 'Vayakhel', 'Exodus', 'Vayakhel', 'Vayakhel'],
  ['Pekudei', 'Pekudei', 'Exodus', 'Pekudei', 'Pekudei'],
  ['Vayikra', 'Vayikra', 'Leviticus', 'Vayikra'],
  ['Tzav', 'Tzav', 'Leviticus', 'Tzav'],
  ['Shmini', 'Shmini', 'Leviticus', 'Shemini', 'Shmini'],
  ['Tazria', 'Tazria', 'Leviticus', 'Tazria'],
  ['Metzora', 'Metzora', 'Leviticus', 'Metzora', 'Metzorah'],
  ['Achrei Mot', 'Achrei Mot', 'Leviticus', 'Acharei Mos', 'Acharei Mot', 'Achrei Mot', 'Acharei'],
  ['Kedoshim', 'Kedoshim', 'Leviticus', 'Kedoshim'],
  ['Emor', 'Emor', 'Leviticus', 'Emor'],
  ['Behar', 'Behar', 'Leviticus', 'Behar'],
  ['Bechukotai', 'Bechukotai', 'Leviticus', 'Bechukosai', 'Bechukotai', 'Bechukosai'],
  ['Bamidbar', 'Bamidbar', 'Numbers', 'Bamidbar', 'Bemidbar'],
  ['Nasso', 'Nasso', 'Numbers', 'Naso', 'Nasso'],
  ["Beha'alotcha", "Beha'alotcha", 'Numbers', "Beha'aloscha", "Beha'alotcha", 'Behaalotecha', "Beha'alotecha"],
  ["Sh'lach", "Sh'lach", 'Numbers', 'Shelach', "Sh'lach", 'Shlach', 'Shelach Lecha'],
  ['Korach', 'Korach', 'Numbers', 'Korach'],
  ['Chukat', 'Chukat', 'Numbers', 'Chukas', 'Chukat'],
  ['Balak', 'Balak', 'Numbers', 'Balak'],
  ['Pinchas', 'Pinchas', 'Numbers', 'Pinchas', 'Pinchas'],
  ['Matot', 'Matot', 'Numbers', 'Matos', 'Matot'],
  ['Masei', 'Masei', 'Numbers', 'Masei', "Mas'ei"],
  ['Devarim', 'Devarim', 'Deuteronomy', 'Devarim'],
  ['Vaetchanan', 'Vaetchanan', 'Deuteronomy', "Va'eschanan", "Va'etchanan", 'Vaetchanan'],
  ['Eikev', 'Eikev', 'Deuteronomy', 'Eikev', 'Ekev'],
  ["Re'eh", "Re'eh", 'Deuteronomy', "Re'eh", 'Reeh'],
  ['Shoftim', 'Shoftim', 'Deuteronomy', 'Shoftim'],
  ['Ki Teitzei', 'Ki Teitzei', 'Deuteronomy', 'Ki Seitzei', 'Ki Teitzei', 'Ki Tetzei', 'Ki Teitze', 'Ki Setzei'],
  ['Ki Tavo', 'Ki Tavo', 'Deuteronomy', 'Ki Savo', 'Ki Tavo'],
  ['Nitzavim', 'Nitzavim', 'Deuteronomy', 'Nitzavim', 'Nitzavim'],
  ['Vayeilech', 'Vayeilech', 'Deuteronomy', 'Vayeilech', 'Vayelech', 'Vayeilech'],
  ["Ha'Azinu", "Ha'Azinu", 'Deuteronomy', "Ha'azinu", 'Haazinu'],
];
const PARASHA_BY_KEY = new Map();
for (const p of PARASHOT) for (const a of p.slice(3)) PARASHA_BY_KEY.set(clean(a), p);
const PARASHA_ALT = alt([...new Set(PARASHOT.flatMap(p => p.slice(3)))].sort((a, b) => b.length - a.length));
const parashaOf = s => PARASHA_BY_KEY.get(clean(s));
const out = (m, from, to, ref) => ({ index: from, length: to - from, ref });

// ---- Zohar ----
const ZOHAR_KW = String.raw`(?<!Tikkunei\s)(?:(?:Holy\s+)?Zohar(?!\s+(?:Chadash|HaRaki))|Raya\s+Mehe?i?mna|Midrash\s+Ha-?Ne['’]elam)`;
const DAF = String.raw`(\d{1,3}[ab])(?![\w])`;
function zoharMatches(text) {
  const found = [];
  // volume first: Zohar III, 73a / Part II, 41b / 3:80b
  const vol = new RegExp(String.raw`${ZOHAR_KW}\s*,?\s*(\(\s*)?(?:Part|Vol\.?|Volume)?\s*(III|II|I|[123])\s*[,:]\s*(?:p\.\s*)?${DAF}((?:\s*(?:,|;|and)\s*\d{1,3}[ab](?![\w]))*)`, 'g');
  for (const m of text.matchAll(vol)) {
    const v = { I: 1, II: 2, III: 3 }[m[2]] || +m[2];
    const items = [[m[3], m.index + m[0].length - m[3].length - m[4].length]];
    for (const r of m[4].matchAll(/\d{1,3}[ab]/g)) items.push([r[0], m.index + m[0].length - m[4].length + r.index]);
    let start = m.index;
    items.forEach(([daf, at], i) => {
      const ref = map.zohar[v]?.[daf];
      if (ref) found.push(out(m, i === 0 ? start : at, at + daf.length, ref));
    });
  }
  // parasha + folio: Zohar (Lech Lecha 76b) / Raya Mehemna (Tzav 29b) / Zohar Terumah 138a
  const par = new RegExp(String.raw`${ZOHAR_KW}\s*,?\s*(\(\s*)?(?:Parashat\s+|Parshas\s+)?(${PARASHA_ALT})\s*,?\s*${DAF}`, 'g');
  for (const m of text.matchAll(par)) {
    const p = parashaOf(m[2]);
    if (!p) continue;
    const v = map.parashot[p[1]] || map.parashot[m[2]];
    if (!v) continue;
    const refFor = (daf, node, vv) => {
      const r = map.zohar[vv]?.[daf];
      return r && r.startsWith('Zohar, ' + node + ' ') ? r : 'Zohar, ' + node;
    };
    const end0 = m.index + m[0].length;
    let from = m[1] ? text.indexOf(m[2], m.index) : m.index;
    found.push(out(m, from, end0, refFor(m[3], p[1], v)));
    // further items: ", 140b" / "and Pinchas 227b" / "; Mishpatim 107b"
    const tail = new RegExp(String.raw`\s*(?:,|;|and)\s*(?:(${PARASHA_ALT})\s*,?\s*)?${DAF}`, 'y');
    let pos = end0, curNode = p[1], curVol = v;
    for (;;) {
      tail.lastIndex = pos;
      const t = tail.exec(text);
      if (!t) break;
      if (t[1]) {
        const q = parashaOf(t[1]);
        if (!q || !map.parashot[q[1]]) break;
        curNode = q[1]; curVol = map.parashot[q[1]];
      }
      const startAt = t[1] ? t.index + t[0].indexOf(t[1]) : t.index + t[0].length - t[2].length;
      found.push(out(t, startAt, t.index + t[0].length, refFor(t[2], curNode, curVol)));
      pos = t.index + t[0].length;
    }
  }
  return found;
}

// ---- Tikkunei Zohar ----
function tikkunMatches(text) {
  const found = [];
  for (const m of text.matchAll(/Tikkunei\s+Zohar\s*,?\s*(?:p\.\s*)?(\d{1,3}[ab])(?![\w])/g))
    found.push(out(m, m.index, m.index + m[0].length, 'Tikkunei Zohar ' + m[1]));
  for (const m of text.matchAll(/(?:Tikkunei\s+Zohar\s*,?\s*)?\bTikkun(?:im)?\s+(\d{1,2})\b(?![ab:])/g)) {
    const ref = map.tikkunim[m[1]];
    if (ref) found.push(out(m, m.index, m.index + m[0].length, ref));
  }
  return found;
}

// ---- Midrash Tanchuma ----
function tanchumaMatches(text) {
  const found = [];
  const re = new RegExp(String.raw`(?:Midrash\s+)?Tanchuma(\s+Buber)?(?:\s+Yelamdenu)?\s*[,(]?\s*(?:Parashat\s+|Parshas\s+)?(${PARASHA_ALT})\s*,?\s*(?:§|sec\.?\s*|siman\s*|ch\.\s*)?(\d{1,2})\b(?![ab:])`, 'g');
  for (const m of text.matchAll(re)) {
    const p = parashaOf(m[2]);
    if (!p || +m[3] > 40) continue;
    found.push(out(m, m.index, m.index + m[0].length, `Midrash Tanchuma${m[1] ? ' Buber' : ''}, ${p[0]} ${m[3]}`));
  }
  return found;
}

// ---- Mishnah-only tractates and the Yerushalmi on Zeraim ----
// [Sefaria tractate, aliases, has a Yerushalmi]
const MISHNAH = [
  ['Peah', ['Peah', "Pe'ah"], true], ['Demai', ['Demai'], true], ['Kilayim', ['Kilayim', "Kil'ayim"], true],
  ['Sheviit', ["Shevi'it", 'Sheviis', 'Sheviit', "Sh'viis"], true], ['Terumot', ['Terumos', 'Terumot'], true],
  ['Maasrot', ['Maasros', 'Maasrot', "Ma'asros", "Ma'asrot"], true], ['Maaser Sheni', ['Maaser Sheni', "Ma'aser Sheni"], true],
  ['Challah', ['Challah', 'Chalah'], true], ['Orlah', ['Orlah'], true], ['Bikkurim', ['Bikkurim', 'Bikurim'], true],
  ['Parah', ['Parah'], false], ['Tahorot', ['Tahoros', 'Tohoros', 'Taharot', 'Tahorot'], false],
  ['Mikvaot', ['Mikvaos', 'Mikvaot', 'Mikva’ot'], false], ['Eduyot', ['Eduyos', 'Eduyot', 'Edios'], false],
  ['Middot', ['Middos', 'Middot'], false], ['Kinnim', ['Kinnim'], false], ['Kelim', ['Kelim'], false],
  ['Oholot', ['Ohalos', 'Oholot', 'Ohalot'], false], ['Negaim', ['Negaim', "Nega'im"], false],
  ['Tevul Yom', ['Tevul Yom'], false], ['Yadayim', ['Yadayim'], false],
  ['Oktzin', ['Uktzin', 'Oktzin', 'Okatzin', 'Uktsin'], false], ['Zavim', ['Zavim'], false],
  ['Makhshirin', ['Machshirin', 'Makhshirin'], false],
];
const MISHNAH_BY_KEY = new Map();
for (const row of MISHNAH) for (const a of row[1]) MISHNAH_BY_KEY.set(clean(a), row);
const MISHNAH_ALT = alt([...MISHNAH_BY_KEY.keys()].length ? MISHNAH.flatMap(r => r[1]).sort((a, b) => b.length - a.length) : []);
function mishnahMatches(text) {
  const found = [];
  const re = new RegExp(String.raw`(?<![\w'’])(${MISHNAH_ALT})\s*,?\s*\(?\s*(?:(?:chapter|ch\.|perek)\s*)?(\d{1,2})\s*[:.]\s*(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?`, 'gi');
  for (const m of text.matchAll(re)) {
    const row = MISHNAH_BY_KEY.get(clean(m[1]));
    if (!row) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const yer = /(?:Yerushalmi|Jerusalem Talmud|Talmud Yerushalmi)[\s\u0001,()]*(?:and\s*)?(?:in\s*)?(?:Tractate\s*)?$/i.test(before);
    if (yer && !row[2]) continue;
    const ref = `${yer ? 'Jerusalem Talmud' : 'Mishnah'} ${row[0]} ${m[2]}:${m[3]}${m[4] && +m[4] > +m[3] ? '-' + m[4] : ''}`;
    // a parenthesised Mishnah citation links only the tractate and numbers
    found.push(out(m, m.index, m.index + m[0].length, ref));
  }
  return found;
}

// ---- Mishneh Torah by the printed transliteration ----
const RAMBAM = {
  teshuvah: 'Repentance', teshuva: 'Repentance', repentance: 'Repentance',
  yesodeihatorah: 'Foundations of the Torah', yesodeyhatorah: 'Foundations of the Torah', foundationsofthetorah: 'Foundations of the Torah',
  deos: 'Human Dispositions', deot: 'Human Dispositions', deah: 'Human Dispositions',
  talmudtorah: 'Torah Study', tefillah: 'Prayer and the Priestly Blessing',
  avodaszarah: 'Foreign Worship and Customs of the Nations', avodatkochavim: 'Foreign Worship and Customs of the Nations',
  avodaskochavim: 'Foreign Worship and Customs of the Nations', avodahzarah: 'Foreign Worship and Customs of the Nations', foreignworship: 'Foreign Worship and Customs of the Nations',
  issureibiah: 'Forbidden Intercourse', issureybiah: 'Forbidden Intercourse', forbiddenintercourse: 'Forbidden Intercourse',
  ishus: 'Marriage', ishut: 'Marriage', geirushin: 'Divorce', gerushin: 'Divorce', divorce: 'Divorce',
  melachim: 'Kings and Wars', kings: 'Kings and Wars', mamrim: 'Rebels', rebels: 'Rebels',
  sanhedrin: 'The Sanhedrin and the Penalties within Their Jurisdiction', thesanhedrin: 'The Sanhedrin and the Penalties within Their Jurisdiction',
  shabbos: 'Sabbath', shabbat: 'Sabbath', shekalim: 'Sheqel Dues',
  rotzeach: 'Murderer and the Preservation of Life', rotzeiach: 'Murderer and the Preservation of Life',
  nachalos: 'Inheritances', nachalot: 'Inheritances',
  chovelumazik: 'One Who Injures a Person or Property', chovelumazzik: 'One Who Injures a Person or Property',
  malveh: 'Creditor and Debtor', malvehveloveh: 'Creditor and Debtor', lenderandborrower: 'Creditor and Debtor',
  megillahvachanukah: 'Scroll of Esther and Hanukkah', megillahvechanukah: 'Scroll of Esther and Hanukkah',
  maachalosassuros: 'Forbidden Foods', maachalotassurot: 'Forbidden Foods',
  chametzumatzah: 'Leavened and Unleavened Bread', chametzumatza: 'Leavened and Unleavened Bread',
  shemitahveyovel: 'Sabbatical Year and the Jubilee', shemitahvyovel: 'Sabbatical Year and the Jubilee',
  tumastzaraas: 'Defilement by Leprosy', tumattzaraat: 'Defilement by Leprosy', tumasztzaraas: 'Defilement by Leprosy',
  bikkurim: 'First Fruits and other Gifts to Priests Outside the Sanctuary',
  biasmikdash: 'Admission into the Sanctuary', biatmikdash: 'Admission into the Sanctuary',
};
function rambamMatches(text) {
  const found = [];
  const re = /\b(?:Hilchos|Hilchot|Hilkhot|Hilkhos|Laws of(?: the)?)\s+([A-Za-z'’]+(?:\s+[A-Za-z'’]+){0,3}?)\s*,?\s*(?:(?:ch\.|chapter)\s*)?\(?(\d{1,2})\s*[:,]\s*(\d{1,2})(?:\s*[–-]\s*\d{1,2})?/g;
  for (const m of text.matchAll(re)) {
    const key = clean(m[1].replace(/\bthe\b/gi, '').replace(/\b(?:U|Ve|Va|Vi)['’]/g, ''));
    const title = RAMBAM[key] || RAMBAM[key.replace(/(?:u|ve|va)(?=[a-z]{4,})/, '')];
    if (!title) continue;
    found.push(out(m, m.index, m.index + m[0].length, `Mishneh Torah, ${title} ${m[2]}:${m[3]}`));
  }
  return found;
}

// ---- other works cited by number ----
function numberedWorks(text) {
  const found = [];
  const add = (re, ref) => { for (const m of text.matchAll(re)) found.push(out(m, m.index, m.index + m[0].length, ref(m))); };
  add(/\bPesikta\s+Rabbati\s*[,(]?\s*(?:Piska\s*|ch\.\s*|§\s*)?(\d{1,2})\b(?![ab:])/g, m => `Pesikta Rabbati ${m[1]}`);
  add(/\bPesikta\s+d['’]?\s?Rav\s+Kahana\s*[,(]?\s*(?:Piska\s*|§\s*)?(\d{1,2})\b(?![ab:])/gi, m => `Pesikta DeRav Kahana ${m[1]}`);
  add(/\bSefer\s+Chas+idim\s*[,(]?\s*(?:§\s*|siman\s*)?(\d{1,3})\b(?![ab:])/gi, m => `Sefer Chasidim ${m[1]}`);
  add(/\bSefer\s+Ha-?Chinu[ck]h?\s*[,(]?\s*(?:Commandment|Mitzvah|mitzvah|§)?\s*(\d{1,3})\b(?![ab:])/gi, m => `Sefer HaChinukh ${m[1]}`);
  add(/\bTanya\s*,?\s*Likkutei\s+Amarim\s*,?\s*(?:ch\.|chapter)\s*(\d{1,2})\b/gi, m => `Tanya, Part I; Likkutei Amarim ${m[1]}`);
  add(/\b(?:the\s+)?Tanya\s*,?\s*(?:chapter|ch\.)\s*(\d{1,2})\b/g, m => `Tanya, Part I; Likkutei Amarim ${m[1]}`);
  add(/\b(?:Midrash\s+)?Shocher\s+Tov\s*[,(]?\s*(?:Psalms?|Tehillim)\s+(\d{1,3})\b(?![ab:])/gi, m => `Midrash Tehillim ${m[1]}`);
  return found;
}

// ---- Rav Tzadok's library and the Izhbitz-Radzin school ----
const LIB = new Set(Object.values(libraryRefs).flat());
const PT_ALIAS = {
  bereshit: 'Bereshit', noach: 'Noach', lechlecha: 'Lech Lecha', vayera: 'Vayera', chayeisarah: 'Chayei Sara', chayeisara: 'Chayei Sara',
  toldot: 'Toldot', vayetzei: 'Vayetzei', vayishlach: 'Vayishlach', vayeshev: 'Vayeshev', miketz: 'Miketz', vayigash: 'Vayigash', vayechi: 'Vayechi',
  shemot: 'Shemot', vaera: 'Vaera', bo: 'Bo', beshalach: 'Beshalach', yitro: 'Yitro', mishpatim: 'Mishpatim', terumah: 'Terumah', tetzaveh: 'Tetzaveh',
  kitisa: 'Ki Tisa', vayakhel: 'Vayakhel', pekudei: 'Pekudei', vayikra: 'Vayikra', tzav: 'Tzav', shmini: 'Shmini', tazria: 'Tazria', metzora: 'Metzora',
  acharemot: 'Achrei Mot', achreimot: 'Achrei Mot', kedoshim: 'Kedoshim', emor: 'Emor', behar: 'Behar', bechukotai: 'Bechukotai', bamidbar: 'Bamidbar',
  nasso: 'Nasso', behaalotcha: "Beha'alotcha", shlach: "Sh'lach", korach: 'Korach', chukat: 'Chukat', balak: 'Balak', pinchas: 'Pinchas', matot: 'Matot',
  masei: 'Masei', devarim: 'Devarim', vaetchanan: 'Vaetchanan', eikev: 'Eikev', reeh: "Re'eh", shoftim: 'Shoftim', kiteitzei: 'Ki Teitzei', kitavo: 'Ki Tavo',
  nitzavim: 'Nitzavim', haazinu: "Ha'Azinu", rosh: '', roshhashanah: 'Rosh Hashanah', roshhashana: 'Rosh Hashanah', erevyomkippur: 'Erev Yom Kippur',
  motzeiyomkippur: 'Motzei Yom Kippur', sukkos: 'Sukkot', sukkot: 'Sukkot', chanukah: 'Chanukah', chanuka: 'Chanukah', purim: 'Purim', purimkatan: 'Purim Katan',
  shushanpurim: 'Shushan Purim', pesach: 'Pesach', pesachsheni: 'Pesach Sheni', shavuos: 'Shavuot', shavuot: 'Shavuot', lagbaomer: 'Lag BaOmer',
  tubishvat: 'Tu BiShvat', pidyonhaben: 'Pidyon Haben', shabbathagadol: 'Shabbat HaGadol', shabboshagadol: 'Shabbat HaGadol', shabbosgadol: 'Shabbat HaGadol',
  parshatshekalim: 'Parshat Shekalim', parshatzachor: 'Parshat Zachor', parshatparah: 'Parshat Parah', parshathachodesh: 'Parshat HaChodesh',
  shekalim: 'Parshat Shekalim', zachor: 'Parshat Zachor', parah: 'Parshat Parah', hachodesh: 'Parshat HaChodesh',
  fifteenthofav: 'The Fifteenth of Av', tuvav: 'The Fifteenth of Av',
  roshchodeshcheshvan: 'Rosh Chodesh Cheshvan', roshchodeshkislev: 'Rosh Chodesh Kislev', roshchodeshshvat: 'Rosh Chodesh Shvat', roshchodeshadar: 'Rosh Chodesh Adar',
  roshchodeshnisan: 'Rosh Chodesh Nisan', roshchodeshiyar: 'Rosh Chodesh Iyar', roshchodeshsivan: 'Rosh Chodesh Sivan', roshchodeshtammuz: 'Rosh Chodesh Tammuz',
  roshchodeshav: 'Rosh Chodesh Av', roshchodeshelul: 'Rosh Chodesh Elul',
  vayeilechandshabbosshuvah: 'Vayeilech and Shabbat Shuvah', vayeilechshabbosshuvah: 'Vayeilech and Shabbat Shuvah', vayeilech: 'Vayeilech and Shabbat Shuvah',
  vayelech: 'Vayeilech and Shabbat Shuvah', vayeilechandshabbatshuvah: 'Vayeilech and Shabbat Shuvah', shabbosshuvah: 'Vayeilech and Shabbat Shuvah', shabbatshuvah: 'Vayeilech and Shabbat Shuvah',
  kedushasshabbos: 'Sefer Kedushat Shabbat', seferkedushasshabbos: 'Sefer Kedushat Shabbat', kedushatshabbat: 'Sefer Kedushat Shabbat', seferkedushatshabbat: 'Sefer Kedushat Shabbat',
  shvitasshabbos: 'Kuntres Shvitat Shabbat', kuntresshvitasshabbos: 'Kuntres Shvitat Shabbat', amalahshelTorah: '', amalahsheltorah: 'Kuntres Amalah shel Torah',
};
for (const p of PARASHOT) PT_ALIAS[clean(p[0])] ??= p[0];
for (const [k, v] of PARASHA_BY_KEY) PT_ALIAS[k] ??= v[0];
const PT_NAMES = Object.keys(PT_ALIAS).filter(k => PT_ALIAS[k]);
function libraryMatches(text) {
  const found = [];
  // Peri / Pri Tzadik, <Section> [§]n[:p]
  const re = /\b(?:Peri|Pri|Peri|Pri)\s+Tz[a]?dd?ik\s*[,(]?\s*(?:Vol\.?\s*(?:I{1,3}|[123])\s*,\s*)?((?:Parashat|Parshas|Parshat|Sefer|Kuntres)?\s*[A-Za-z'’\/ ]{2,45}?)\s*,?\s*(?:discourse\s+|letter\s+|ois\s+|§\s*|sec\.\s*|siman\s*)?(\d{1,2})(?::(\d{1,2}))?\b/g;
  for (const m of text.matchAll(re)) {
    const key = clean(m[1].replace(/\b(?:Parashat|Parshas|Parshat)\b/i, ''));
    const sec = PT_ALIAS[key] || PT_ALIAS[clean(m[1])];
    if (!sec) continue;
    const secRef = `Peri Tzadik, ${sec} ${m[2]}`;
    if (!LIB.has(secRef)) continue;
    found.push(out(m, m.index, m.index + m[0].length, m[3] ? `${secRef}:${m[3]}` : secRef));
  }
  // Kometz HaMinchah I/II §n  ->  Kometz HaMinchah v:n
  for (const m of text.matchAll(/\bKometz\s+HaMinchah\s+(III|II|I|[12])\s*[,(]?\s*(?:§|sec\.?\s*|siman\s*|ch\.\s*)?(\d{1,3})\b/g)) {
    const v = { I: 1, II: 2 }[m[1]] || +m[1];
    const ref = `Kometz HaMinchah ${v}:${m[2]}`;
    if (LIB.has(ref)) found.push(out(m, m.index, m.index + m[0].length, ref));
  }
  // Dover Tzedek, Miscellany 4:44 and similar explicit section forms
  for (const m of text.matchAll(/\bDover\s+Tzedek\s*,\s*(Miscellany)\s+(\d{1,2})(?::(\d{1,3}))?/g)) {
    const secRef = `Dover Tzedek, Miscellany ${m[2]}`;
    if (LIB.has(secRef)) found.push(out(m, m.index, m.index + m[0].length, m[3] ? `${secRef}:${m[3]}` : secRef));
  }
  // Mei HaShiloach (Vol. 1 | Part I, Parashat X ...) -> Sefaria's parashah node
  const mei = new RegExp(String.raw`\bMei\s+Ha-?Shiloach\s*[,(]?\s*(?:\(\s*)?(?:(?:Vol\.?|Volume|Part)\s*(II|I|[12])\s*,?\s*)(?:Parashat\s+|Parshas\s+|Parshat\s+)?(${PARASHA_ALT})\b`, 'gi');
  for (const m of text.matchAll(mei)) {
    const p = parashaOf(m[2]);
    if (!p) continue;
    const v = { I: 'I', II: 'II', 1: 'I', 2: 'II' }[m[1].toUpperCase()];
    found.push(out(m, m.index, m.index + m[0].length, `Mei HaShiloach, Volume ${v}, ${p[2]}, ${p[0]}`));
  }
  for (const m of text.matchAll(new RegExp(String.raw`\bMei\s+Ha-?Shiloach\s*,?\s*(?:\(\s*)?(?:Parashat\s+|Parshas\s+|Parshat\s+)?(${PARASHA_ALT})\s+(?:Part\s+)?(II|I)\b`, 'gi'))) {
    const p = parashaOf(m[1]);
    if (p) found.push(out(m, m.index, m.index + m[0].length, `Mei HaShiloach, Volume ${m[2].toUpperCase()}, ${p[2]}, ${p[0]}`));
  }
  return found;
}

export function referenceMatches(text) {
  const all = [
    ...zoharMatches(text), ...tikkunMatches(text), ...tanchumaMatches(text), ...mishnahMatches(text),
    ...rambamMatches(text), ...numberedWorks(text), ...libraryMatches(text),
  ];
  // a citation opened with "(" takes its closing ")" so the link stays balanced
  for (const f of all) {
    const span = text.slice(f.index, f.index + f.length);
    if ((span.match(/\(/g) || []).length > (span.match(/\)/g) || []).length && text[f.index + f.length] === ')') f.length++;
  }
  return all;
}

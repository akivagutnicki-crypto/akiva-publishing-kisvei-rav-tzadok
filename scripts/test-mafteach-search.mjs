// Tests the reader's HaMafteach search and shiur builder (dist/library/mafteach-search.js).
// Usage: node scripts/test-mafteach-search.mjs [mcp-data dir with mafteach/]   (default dist/mcp-data)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../dist/library/mafteach-search.js');
const DATA = path.join(process.argv[2] || 'dist/mcp-data', 'mafteach') + '/';
A.configure({ base: DATA, panelBase: 'dist/library/mafteach/', loader: async u => (u.endsWith('.txt') ? fs.readFileSync(u, 'utf8') : JSON.parse(fs.readFileSync(u, 'utf8'))) });
let passed = 0;
const check = (ok, what) => { if (!ok) throw new Error('Mafteach search test failed: ' + what); passed++; };

const top = async q => (await A.analyze(q)).topics[0]?.t.en;
// topics in English, Hebrew, Ashkenazi and Sefardi transliteration; no sound-alike headings
for (const q of ['emunah', 'emuna', 'Faith', 'אמונה']) check(await top(q) === 'Faith', `${q} -> Faith`);
check((await A.analyze('emunah')).topics.length === 1, 'emunah does not also match Moon or Money');
check(/Abraham/.test(await top('Avrohom Avinu')), 'Avrohom Avinu -> Abraham');
check(await top('bitachon') === 'Trust in God', 'bitachon');
check(await top('חנוכה') === 'Hanukkah', 'חנוכה');
check(/evil inclination/.test(await top('yetzer hara')), 'yetzer hara');
// names: exact, other transliterations and misspellings; never mistaken for a sefer of Tanach by sound
for (const q of ['Ishmael', 'Yishmael', 'Yishmoel', 'Ishamel', 'dYishamel', 'Yishamel', 'ישמעאל']) check(await top(q) === 'Ishmael', `${q} -> Ishmael`);
check(!(await A.analyze('Ishmael')).source && !(await A.analyze('Moshe')).source, 'Ishmael is not Shmuel, Moshe is not Amos');
check(/Moses/.test(await top('Moshe')) && /Abraham/.test(await top('Avraham')) && /Solomon/.test(await top('Shlomo')), 'Moshe, Avraham, Shlomo');
check((await A.analyze('Tehillim 23')).source?.title === 'Psalms' && (await A.analyze('Zohar')).topics.length === 0, 'sources by name');
// questions: the topics they name, best first
const qa = await A.analyze('what does Rav Tzadok say about teshuvah and simcha?');
check(qa.topics[0].t.en === 'Repentance' && qa.topics.some(x => x.t.en === 'Joy'), 'question finds Repentance and Joy');
check((await A.analyze('the relationship between emunah and bitachon')).topics.slice(0, 2).map(x => x.t.en).sort().join() === 'Faith,Trust in God', 'emunah and bitachon');
check((await A.analyze('Why is Shabbos called a gift?')).topics.some(x => x.t.en === 'Gift') && !(await A.analyze('Why is Shabbos called a gift?')).topics.some(x => x.t.en === 'Cloud'), 'Shabbos gift, not cloud');
// sources: pasuk, daf, Hebrew numerals, inside a question
const src = async q => { const s = (await A.analyze(q)).source; return s ? `${s.title} ${s.addr}`.trim() : null; };
check(await src('Bereishis 2:7') === 'Genesis 2:7', 'Bereishis 2:7');
check(await src('Berachos 6b') === 'Berakhot 6b', 'Berachos 6b');
check(await src('Shabbos 88b') === 'Shabbat 88b', 'Shabbos 88b');
check(await src('בראשית ב ז') === 'Genesis 2:7', 'בראשית ב ז');
check(await src('what does he say on Bereishis 1:1?') === 'Genesis 1:1', 'pasuk inside a question');
const M = await A.index();
const g27 = await A.sourceEntries(A.parseSource(M, 'Genesis 2:7'));
check(g27.length > 0 && g27.every(e => e.k === 'Genesis 2:7'), 'Genesis 2:7 entries');
// parshiyos
for (const [q, k] of [['Parshas Vayeishev', 'Vayeshev'], ['Vayeishev', 'Vayeshev'], ['פרשת וישב', 'Vayeshev'], ['Noach', 'Noach'], ['parashat Ki Tisa', 'Ki Tisa'], ['Bechukosai', 'Bechukotai']]) check(A.findParsha(q)?.key === k, `${q} -> parsha ${k}`);
check(!A.findParsha('Bereishis 2:7'), 'a pasuk is not a parsha');
check(A.PARSHIYOS.length === 54, '54 parshiyos');
// full-text search inside entries
const ft = await A.searchEntries(M, 'אור הגנוז', 'all');
check(ft.total > 10 && ft.hits.every(e => /אור הגנו/.test(A.norm(e.t))), 'full-text search');
// English of the index lines (sources/mafteach/captions-en.json)
const faithEntries = await A.topicEntries(107);
const withEn = faithEntries.filter(e => e.e);
check(withEn.length / faithEntries.length > 0.9 && withEn.every(e => !/[א-ת]{3}/.test(e.e)), `topic lines have English (${withEn.length}/${faithEntries.length})`);
const ftEn = await A.searchEntries(M, 'olive tree', 'all');
check(ftEn.total > 0 && ftEn.hits.every(e => /olive/i.test(e.e || '')), 'full-text search finds English words');
// shiur builder: topic
const rep = (await A.analyze('teshuvah')).topics[0].t;
const plan = A.planTopicShiur(M, rep, await A.topicEntries(rep.id));
const refs = plan.sections.flatMap(s => s.items.map(i => i.ref));
check(plan.sections.length >= 4 && refs.length >= 12 && new Set(refs).size === refs.length, 'topic shiur: sections, distinct sources');
check(refs.every(r => /\d$/.test(r)), 'topic shiur sources are library refs');
const faith = A.planTopicShiur(M, M.byId.get(107), await A.topicEntries(107));
check(faith.sections.reduce((a, s) => a + s.items.length, 0) >= 6, 'heading without sub-headings still gives a full shiur');
check(/Repentance — תשובה/.test(A.shiurText(plan)), 'shiur text');
check(plan.sections.flatMap(x => x.items).filter(i => i.en).length >= refs.length * 0.9, 'shiur sources carry English');
// shiur builder: parsha
const p = A.PARSHIYOS.find(x => x.key === 'Vayeshev');
const pp = A.planParshaShiur(p, await A.ptSectionPassages(p), await A.parshaSources(p));
check(pp.maamarim.length >= 10 && pp.maamarim.every(m => m.ref.startsWith('Peri Tzadik, Vayeshev ')), 'parsha shiur: Pri Tzaddik maamarim');
check(pp.pesukim.length >= 10 && pp.pesukim.every(v => { const [c, vs] = v.key.split(' ')[1].split(':').map(Number); return v.key.startsWith('Genesis ') && (c > 37 || c === 37) && (c < 40 || (c === 40 && vs <= 23)); }), 'parsha shiur: pesukim within the parsha');
check(pp.themes.some(t => t.en === 'Joseph' || t.en === 'Jacob our Father'), 'parsha themes');
for (const pr of A.PARSHIYOS) {
  const plan2 = A.planParshaShiur(pr, await A.ptSectionPassages(pr), await A.parshaSources(pr));
  check(plan2.maamarim.length + plan2.pesukim.length > 0, `parsha ${pr.key} has material`);
}
// header suggestions
const rows = A.suggestRows(M, 'bitachon');
check(rows.some(r => /topic=/.test(r.href)) && rows.at(-1).href.includes('q=bitachon'), 'header suggestions');
// excerpt of a fetched passage
const x = A.excerpt({ he: ['<b>א</b> ' + 'מלה '.repeat(200)], en: ['word '.repeat(10)], sectionRef: 'X 1' }, 'X 1', 20);
check(x.he.split(' ').length === 21 && x.he.endsWith('…') && !x.he.includes('<'), 'excerpt');
console.log(`PASS Mafteach search: ${passed} checks`);

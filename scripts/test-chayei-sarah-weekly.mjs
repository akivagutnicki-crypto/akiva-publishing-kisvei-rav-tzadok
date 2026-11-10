// Static checks for the Parshas Chayei Sarah blog and shiur in the reader.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist/library';
const magic = (file, bytes) => assert.equal(fs.readFileSync(`${root}/${file}`).subarray(0, bytes.length).toString(), bytes, file);
const downloads = {
  'blog/pdfs/from-the-east-chayei-sarah.pdf': '%PDF-', 'blog/docs/from-the-east-chayei-sarah.docx': 'PK',
  'downloads/chayei-sarah-wisdom-outside-the-house-shiur.pdf': '%PDF-', 'downloads/chayei-sarah-wisdom-outside-the-house-shiur.docx': 'PK'};
for (const [file, bytes] of Object.entries(downloads)) magic(file, bytes);
assert(fs.statSync(`${root}/blog/from-the-east/ben-ish-chai.jpg`).size > 10000, 'Teaser photograph');

for (const [dir, count, title] of [['blog/from-the-east', 8, 'From the East I Will Bring Your Seed'], ['blog/from-the-east/shiur', 32, 'Wisdom Outside the House']]) {
  const page = fs.readFileSync(`${root}/${dir}/index.html`, 'utf8');
  assert(page.includes(`<h1>${title}</h1>`), dir + ' title');
  const images = [...page.matchAll(/<img src="(pages\/page-\d\d\.webp)"/g)].map(m => m[1]);
  assert.equal(images.length, count, dir + ' page count');
  assert.deepEqual(fs.readdirSync(`${root}/${dir}/pages`).sort(), images.map(i => i.slice(6)), dir + ' page files');
  for (const image of images) {
    const bytes = fs.readFileSync(`${root}/${dir}/${image}`);
    assert.equal(bytes.subarray(0, 4).toString() + bytes.subarray(8, 12).toString(), 'RIFFWEBP', image);
  }
  const links = [...page.matchAll(/href="([^"#]+\.(?:pdf|docx))"/g)].map(m => m[1]);
  assert.equal(links.length, 3, dir + ' downloads');
  for (const link of links) assert(fs.existsSync(path.resolve(`${root}/${dir}`, link)), dir + ' broken link ' + link);
  for (const m of page.matchAll(/href="#page-(\d+)"/g)) assert(Number(m[1]) >= 1 && Number(m[1]) <= count, dir + ' contents link');
  assert(page.includes('#/read/Peri_Tzadik,_Chayei_Sara_6'), dir + ' reader link');
}

const blogIndex = fs.readFileSync(`${root}/blog/index.html`, 'utf8');
const card = blogIndex.match(/<article class="card" aria-labelledby="chayei-sarah-feature-title">[\s\S]*?<\/article>/g);
assert.equal(card?.length, 1, 'One Chayei Sarah listing');
assert(blogIndex.indexOf('chayei-sarah-feature-title') < blogIndex.indexOf('vayeira-feature-title'), 'Chayei Sarah listed first');
for (const m of card[0].matchAll(/href="([^"#]+)"/g)) {
  const target = path.resolve(`${root}/blog`, m[1]);
  assert(fs.existsSync(target.endsWith('/') || !path.extname(target) ? path.join(target, 'index.html') : target), 'Broken listing link ' + m[1]);
}

const html = fs.readFileSync(`${root}/index.html`, 'utf8');
assert.equal((html.match(/<a class="weekly-teaser weekly-chayei-teaser" href="blog\/from-the-east\/"/g) || []).length, 1, 'Home teaser');
assert(html.indexOf('weekly-chayei-teaser') < html.indexOf('weekly-study-teaser"'), 'Chayei Sarah teaser first');
assert.equal((html.match(/id="chayei-sarah-weekly"/g) || []).length, 1, 'Sidebar entry');
assert(html.includes('<h3>Earlier · Parshas Vayeira</h3>'), 'Vayeira moved to earlier');
assert(html.includes('<h3 id="chayei-sarah-weekly">Last week · Parshas Chayei Sarah</h3>'), 'Chayei Sarah moved to last week');
assert(!html.includes('This week · Parshas Vayeira'), 'Two weeks marked as this week');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script[1].trim()) new vm.Script(script[1]);

const sw = fs.readFileSync(`${root}/sw.js`, 'utf8');
assert(sw.includes('-20261101-chayei-sarah-v1'), 'Service worker version');
assert(sw.includes("'./blog/from-the-east/', './blog/from-the-east/shiur/'"), 'Offline pages');
new vm.Script(sw);
// The shiur as native reader text, beside the PDF, Word and page-by-page editions.
const nativeVersion = '20261101-chayei-sarah-native-v1';
const native = 'Akiva_Publishing_Weekly_Torah%2C_Chayei_Sarah_Wisdom_Outside_the_House';
const data = JSON.parse(fs.readFileSync(`${root}/studies/chayei-sarah-wisdom-outside-the-house.json`, 'utf8'));
const sections = Object.values(data.sections);
assert.equal(sections.length, 13, 'Opening, ten parts, summing up and sources');
assert.equal(data.footnoteCount, 65);
const decode = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const numbers = [];
sections.forEach((s, k) => {
  assert.equal(s.book, 'Akiva Publishing Weekly Torah');
  assert(s.weeklyStudy && s.chayeiSarahStudy && s.local, s.sectionRef);
  assert.equal(s.prev, sections[k - 1]?.sectionRef || null, 'Previous link ' + s.sectionRef);
  assert.equal(s.next, sections[k + 1]?.sectionRef || null, 'Next link ' + s.sectionRef);
  assert(s.phrases.length && s.title.en && s.title.he, s.sectionRef);
  s.phrases.forEach((row, i) => {
    assert.equal(s.he[i], row.map(p => p[0]).filter(Boolean).join(' '), 'Hebrew column ' + s.sectionRef + ':' + (i + 1));
    assert.equal(s.en[i], row.map(p => p[1]).join(' '), 'English column ' + s.sectionRef + ':' + (i + 1));
    if (s.editorialRows.includes(i)) assert(row.length === 1 && row[0][0] === '', 'Editorial row ' + i);
    for (const [he, en] of row) {
      assert(en.trim(), 'Empty English in ' + s.sectionRef);
      if (!he || he === '…') continue;
      const words = decode(he).replace(/\([^)]*\)/g, '').split(/\s+/).filter(w => /[א-ת]/.test(w));
      assert(words.length <= 6, 'Hebrew phrase over six words: ' + he);
    }
    for (const m of s.en[i].matchAll(/<sup class="footnote-marker">(\d+)<\/sup><i class="footnote">/g)) numbers.push(Number(m[1]));
  });
  for (const [row, notes] of Object.entries(s.annotations)) for (const note of notes) {
    const phrase = s.phrases[row]?.[note.phraseIndex];
    assert(phrase && phrase[0], 'Note outside its phrase ' + note.number);
    assert.equal(note.heCharOffset, decode(phrase[0]).length, 'Note marker at the end of its Hebrew phrase ' + note.number);
    for (const p of note.paragraphs) for (const run of p.rich) {
      assert(run.text, 'Empty run in note ' + note.number);
      if (run.href) assert(/^#\/read\/[^<>\s]+$|^https:\/\/www\.sefaria\.org\//.test(run.href), 'Unlinkable note source ' + run.href);
    }
    numbers.push(note.number);
  }
});
assert.deepEqual([...new Set(numbers)].sort((a, b) => a - b), Array.from({length: 65}, (_, i) => i + 1), 'Footnotes 1–65, as in the Word edition');
const index = data.sections['Akiva Publishing Weekly Torah, Chayei Sarah Wisdom Outside the House Sources'].sourceIndex;
assert(index.library.length >= 20 && index.supporting.length >= 30 && index.outside.length >= 20, 'Source index');

const sandbox = {window: {}, fetch: async url => ({ok: true, json: async () => JSON.parse(fs.readFileSync(`${root}/${url.split('?')[0]}`, 'utf8'))})};
vm.runInNewContext(fs.readFileSync(`${root}/chayei-sarah-study.js`, 'utf8'), sandbox);
const api = sandbox.window.AkivaChayeiSarahStudy;
assert.deepEqual([...api.REFS], sections.map(s => s.sectionRef), 'Module and data list the same sections');
for (const s of sections) {
  assert(api.recognizes(s.sectionRef) && api.recognizes(s.sectionRef + ':1') && !api.recognizes(s.sectionRef + ':0'));
  assert.equal((await api.fetchText(s.sectionRef)).phrases.length, s.phrases.length);
}
assert.equal((await api.fetchText(sections[2].sectionRef + ':2')).highlight, sections[2].sectionRef + ':2');
await assert.rejects(api.fetchText(sections[2].sectionRef + ':1000'), /out of range/);
assert(!api.recognizes('Akiva Publishing Weekly Torah, Vayeira Mesiras Nefesh'));
const opening = api.attachment(sections[0]), contentsPage = api.contents('<div class="page weekly-study-contents"><div class="crumbs">x</div><div class="eyebrow">This week · Parshas Vayeira 5787</div></div>');
for (const link of ['downloads/chayei-sarah-wisdom-outside-the-house-shiur.pdf', 'downloads/chayei-sarah-wisdom-outside-the-house-shiur.docx', 'blog/from-the-east/shiur/', 'blog/from-the-east/']) {
  assert(opening.includes(`href="${link}"`), 'Opening section lacks ' + link);
  assert(contentsPage.includes(`href="${link}"`), 'Weekly Torah contents lacks ' + link);
}
assert.equal((contentsPage.match(/<div class="crumbs">/g) || []).length, 1, 'One breadcrumb on the contents page');
assert(contentsPage.includes('Last week · Parshas Vayeira 5787') && contentsPage.includes(`href="#/read/${native}"`));
assert(api.attachment(sections[1]).includes('href="#/read/Peri_Tzadik,_Chayei_Sara_6:1"'), 'Part I source link');
assert(api.attachment(sections[12]).includes('class="chayei-source-index"'));

assert(html.includes(`chayei-sarah-study.js?v=${nativeVersion}`), 'Reader module');
assert(html.includes('window.AkivaChayeiSarahStudy?.recognizes(ref)') && html.includes('window.AkivaChayeiSarahStudy.attachment(d)')
  && html.includes('window.AkivaChayeiSarahStudy.contents(window.AkivaVayeiraStudy.contents())'), 'Reader hooks');
assert(html.indexOf('window.AkivaChayeiSarahStudy?.recognizes(ref)') < html.indexOf('window.AkivaVayeiraStudy?.recognizes(ref)'));
assert(html.includes(`href="#/read/${native}"`), 'Sidebar link to the text edition');
assert(blogIndex.includes(`href="../#/read/${native}"`), 'Listing link to the text edition');
assert(sw.includes(`'./chayei-sarah-study.js?v=${nativeVersion}', './studies/chayei-sarah-wisdom-outside-the-house.json?v=${nativeVersion}'`), 'Offline text edition');
for (const [file, prefix] of [['blog/from-the-east/index.html', '../../'], ['blog/from-the-east/shiur/index.html', '../../../']])
  assert(fs.readFileSync(`${root}/${file}`, 'utf8').includes(`href="${prefix}#/read/${native}"`), file + ' links the text edition');
console.log('PASS: Parshas Chayei Sarah blog (8 pages) and shiur (32 pages), PDF and Word downloads, Weekly Torah listing, home teaser, sidebar and offline pages; the shiur as native reader text (13 sections, 65 footnotes as in the Word edition).');

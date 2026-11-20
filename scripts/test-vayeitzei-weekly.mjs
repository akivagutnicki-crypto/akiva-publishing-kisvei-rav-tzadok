// Static checks for the Parshas Vayeitzei blog "Leaving Home and Learning to Dream" (Kometz HaMinchah II:70–72),
// its shiur recording and shiur PDF, and the shiur card in the reader at Kometz HaMinchah 2:70.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist/library';
const dir = 'blog/leaving-home-and-learning-to-dream';
const audio = 'audio/vayeitzei-leaving-home-shiur.m4a';
const shiurPdf = 'downloads/vayeitzei-leaving-home-shiur.pdf';
for (const [file, bytes] of [['blog/pdfs/leaving-home-and-learning-to-dream-vayeitzei.pdf', '%PDF-'], ['blog/docs/leaving-home-and-learning-to-dream-vayeitzei.docx', 'PK'], [shiurPdf, '%PDF-']])
  assert.equal(fs.readFileSync(`${root}/${file}`).subarray(0, bytes.length).toString(), bytes, file);
const recording = fs.readFileSync(`${root}/${audio}`);
assert.equal(recording.length, 15893615, 'Recording size');
assert.equal(crypto.createHash('sha256').update(recording).digest('hex'), '7659bba9cecccf369fbfe8c73ecee600d5eb71d586f6ac6b5b12d4ac1bc46097', 'Recording checksum');
assert.equal(recording.subarray(4, 8).toString(), 'ftyp', 'M4A recording');
const jpg = fs.readFileSync(`${root}/${dir}/leaving-home-and-learning-to-dream.jpg`);
assert(jpg.length > 10000 && jpg[0] === 0xff && jpg[1] === 0xd8, 'Teaser picture');

const page = fs.readFileSync(`${root}/${dir}/index.html`, 'utf8');
assert(page.includes('<h1>Leaving Home and Learning to Dream</h1>'), 'Title');
assert(page.includes('id="listen"') && page.includes(`src="../../${audio}"`), 'Listen box with the recording');
const images = [...page.matchAll(/<img src="(pages\/page-\d\d\.webp)"/g)].map(m => m[1]);
assert.equal(images.length, 6, 'Six pages');
assert.deepEqual(fs.readdirSync(`${root}/${dir}/pages`).sort(), images.map(i => i.slice(6)), 'Page files');
for (const image of images) {
  const bytes = fs.readFileSync(`${root}/${dir}/${image}`);
  assert.equal(bytes.subarray(0, 4).toString() + bytes.subarray(8, 12).toString(), 'RIFFWEBP', image);
}
for (const m of page.matchAll(/(?:href|src)="(\.\.?\/[^"#]+\.(?:pdf|docx|m4a|jpg|webp))"/g))
  assert(fs.existsSync(path.resolve(`${root}/${dir}`, m[1])), 'Broken link ' + m[1]);
assert(page.includes('#/read/Kometz_HaMinchah_2:70') && !page.includes('#/book/kometz-haminchah'), 'Reader links');
for (const script of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);

const blogIndex = fs.readFileSync(`${root}/blog/index.html`, 'utf8');
const card = blogIndex.match(/<article class="card" aria-labelledby="vayeitzei-feature-title">[\s\S]*?<\/article>/g);
assert.equal(card?.length, 1, 'One Vayeitzei listing');
assert(blogIndex.indexOf('vayeitzei-feature-title') < blogIndex.indexOf('chanukah-feature-title'), 'Vayeitzei listed first');
assert(card[0].includes('#listen') && card[0].includes(`../${shiurPdf}`), 'Shiur recording and PDF on the listing');
for (const m of card[0].matchAll(/(?:href|src)="([^"#]+)"/g)) {
  const target = path.resolve(`${root}/blog`, m[1]);
  assert(fs.existsSync(target.endsWith('/') || !path.extname(target) ? path.join(target, 'index.html') : target), 'Broken listing link ' + m[1]);
}

const html = fs.readFileSync(`${root}/index.html`, 'utf8');
assert.equal((html.match(/<a class="weekly-teaser weekly-vayeitzei-teaser" href="blog\/leaving-home-and-learning-to-dream\/"/g) || []).length, 1, 'Home teaser');
assert(html.indexOf('weekly-vayeitzei-teaser') < html.indexOf('weekly-chanukah-teaser'), 'Vayeitzei teaser first');
assert.equal((html.match(/id="vayeitzei-weekly"/g) || []).length, 1, 'Sidebar entry');
assert(html.indexOf('id="vayeitzei-weekly"') < html.indexOf('id="chanukah-weekly"'), 'Vayeitzei first in the sidebar');
assert.equal((html.match(/This week · Parshas/g) || []).length, 2, 'Only Vayeitzei marked as this week (teaser and sidebar)');
assert(html.includes('<h3 id="toldos-weekly">Last week · Parshas Toldos</h3>'), 'Toldos moved to last week');
assert.equal((html.match(/class="noach6-media kometz70-media"/g) || []).length, 1, 'Reader shiur card at Kometz HaMinchah 2:70');
const branch = html.split("d.sectionRef === 'Kometz HaMinchah 2:70'")[1].split("d.sectionRef === 'Divrei Soferim 16'")[0];
assert(branch.includes('${shiurMarkup}') && branch.includes(shiurPdf) && !branch.includes('<details open'), 'Recording and collapsed PDF in the reader');
assert(html.includes('shiur-player.js?v=20261119-kometz-interlinear-pdf-v2'), 'Fresh shiur player');
const kometzPdf = 'downloads/kometz-haminchah-ii-70-72-interlinear-shiur.pdf';
const kpdf = fs.readFileSync(`${root}/${kometzPdf}`);
assert.equal(kpdf.subarray(0, 5).toString(), '%PDF-', 'Kometz interlinear PDF');
assert(branch.includes(kometzPdf) && branch.includes('kometz70-interlinear-pdf'), 'Interlinear PDF in the reader at Kometz HaMinchah 2:70');
assert(page.includes('../../' + kometzPdf) && card[0].includes('../' + kometzPdf) && html.includes(`href="${kometzPdf}"`), 'Interlinear PDF on the blog, the listing and the sidebar');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script[1].trim()) new vm.Script(script[1]);

const player = fs.readFileSync(`${root}/shiur-player.js`, 'utf8');
new vm.Script(player);
const sandbox = {window: {}, localStorage: {getItem: () => null}};
vm.runInNewContext(player, sandbox);
const markup = sandbox.window.AkivaShiurPlayer.render('Kometz HaMinchah 2:70');
assert(markup.includes(`src="${audio}"`) && markup.includes('42:11'), 'Player track for Kometz HaMinchah 2:70');
for (const ref of ['Peri Tzadik, Noach 6', 'Divrei Soferim 16']) assert(sandbox.window.AkivaShiurPlayer.render(ref), 'Earlier track kept: ' + ref);

const sw = fs.readFileSync(`${root}/sw.js`, 'utf8');
assert(sw.includes('-20261119-vayeitzei-leaving-home-v1') && sw.includes('-20261119-kometz-interlinear-pdf-v2'), 'Service worker version');
assert(sw.includes("'./blog/leaving-home-and-learning-to-dream/'"), 'Offline page');
new vm.Script(sw);
console.log('PASS: Vayeitzei blog Leaving Home and Learning to Dream (6 pages, picture), shiur recording and shiur PDF, Weekly Torah listing, home teaser, sidebar, offline page, and the shiur in the reader at Kometz HaMinchah 2:70.');

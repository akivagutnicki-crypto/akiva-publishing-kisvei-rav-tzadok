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
assert(html.includes('<h3>Last week · Parshas Vayeira</h3>'), 'Vayeira moved to last week');
assert(!html.includes('This week · Parshas Vayeira'), 'Two weeks marked as this week');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script[1].trim()) new vm.Script(script[1]);

const sw = fs.readFileSync(`${root}/sw.js`, 'utf8');
assert(sw.includes('-20261101-chayei-sarah-v1'), 'Service worker version');
assert(sw.includes("'./blog/from-the-east/', './blog/from-the-east/shiur/'"), 'Offline pages');
new vm.Script(sw);
console.log('PASS: Parshas Chayei Sarah blog (8 pages) and shiur (32 pages), PDF and Word downloads, Weekly Torah listing, home teaser, sidebar and offline pages.');

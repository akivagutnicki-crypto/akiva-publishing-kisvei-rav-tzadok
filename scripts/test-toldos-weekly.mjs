// Static checks for the Parshas Toldos blog "The King's Table" in the reader.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist/library';
const dir = 'blog/the-kings-table';
for (const [file, bytes] of [['blog/pdfs/the-kings-table-toldos.pdf', '%PDF-'], ['blog/docs/the-kings-table-toldos.docx', 'PK']])
  assert.equal(fs.readFileSync(`${root}/${file}`).subarray(0, bytes.length).toString(), bytes, file);
const jpg = fs.readFileSync(`${root}/${dir}/kings-table.jpg`);
assert(jpg.length > 10000 && jpg[0] === 0xff && jpg[1] === 0xd8, 'Teaser picture');

const page = fs.readFileSync(`${root}/${dir}/index.html`, 'utf8');
assert(page.includes('<h1>The King’s Table</h1>'), 'Title');
assert(page.includes('src="kings-table.jpg"'), 'Picture on the blog page');
const images = [...page.matchAll(/<img src="(pages\/page-\d\d\.webp)"/g)].map(m => m[1]);
assert.equal(images.length, 5, 'Five pages');
assert.deepEqual(fs.readdirSync(`${root}/${dir}/pages`).sort(), images.map(i => i.slice(6)), 'Page files');
for (const image of images) {
  const bytes = fs.readFileSync(`${root}/${dir}/${image}`);
  assert.equal(bytes.subarray(0, 4).toString() + bytes.subarray(8, 12).toString(), 'RIFFWEBP', image);
}
const links = [...page.matchAll(/href="([^"#]+\.(?:pdf|docx))"/g)].map(m => m[1]);
assert.equal(links.length, 3, 'Downloads');
for (const link of links) assert(fs.existsSync(path.resolve(`${root}/${dir}`, link)), 'Broken link ' + link);
for (const m of page.matchAll(/href="#page-(\d+)"/g)) assert(Number(m[1]) >= 1 && Number(m[1]) <= 5, 'Contents link');
assert(page.includes('#/read/Peri_Tzadik,_Toldot_3') && page.includes('#/read/Et_HaOchel_8'), 'Reader links');

const blogIndex = fs.readFileSync(`${root}/blog/index.html`, 'utf8');
const card = blogIndex.match(/<article class="card" aria-labelledby="toldos-feature-title">[\s\S]*?<\/article>/g);
assert.equal(card?.length, 1, 'One Toldos listing');
assert(blogIndex.indexOf('toldos-feature-title') < blogIndex.indexOf('chayei-sarah-feature-title'), 'Toldos listed first');
for (const m of card[0].matchAll(/(?:href|src)="([^"#]+)"/g)) {
  const target = path.resolve(`${root}/blog`, m[1]);
  assert(fs.existsSync(target.endsWith('/') || !path.extname(target) ? path.join(target, 'index.html') : target), 'Broken listing link ' + m[1]);
}

const html = fs.readFileSync(`${root}/index.html`, 'utf8');
assert.equal((html.match(/<a class="weekly-teaser weekly-toldos-teaser" href="blog\/the-kings-table\/"/g) || []).length, 1, 'Home teaser');
assert(html.includes('<img src="blog/the-kings-table/kings-table.jpg"'), 'Teaser picture');
assert(html.indexOf('weekly-toldos-teaser') < html.indexOf('weekly-chayei-teaser'), 'Toldos teaser first');
assert.equal((html.match(/id="toldos-weekly"/g) || []).length, 1, 'Sidebar entry');
assert(html.indexOf('id="toldos-weekly"') < html.indexOf('id="chayei-sarah-weekly"'), 'Toldos first in the sidebar');
assert.equal((html.match(/This week · Parshas/g) || []).length, 2, 'Only Toldos marked as this week (teaser and sidebar)');
assert(!html.includes('This week · Parshas Chayei Sarah</') && !html.includes('This week · Parshas Vayeira</'), 'Earlier weeks relabelled');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script[1].trim()) new vm.Script(script[1]);

const sw = fs.readFileSync(`${root}/sw.js`, 'utf8');
assert(sw.includes('-20261109-toldos-kings-table-v1'), 'Service worker version');
assert(sw.includes("'./blog/the-kings-table/'"), 'Offline page');
new vm.Script(sw);
console.log('PASS: Parshas Toldos blog The King’s Table (5 pages, picture), PDF and Word downloads, Weekly Torah listing, home teaser, sidebar and offline page.');

// Static checks for the Chanukah blog "The Sealed Cruse" (Divrei Chalomos 25) in the reader.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist/library';
const dir = 'blog/the-sealed-cruse';
for (const [file, bytes] of [['blog/pdfs/the-sealed-cruse-chanukah.pdf', '%PDF-'], ['blog/docs/the-sealed-cruse-chanukah.docx', 'PK']])
  assert.equal(fs.readFileSync(`${root}/${file}`).subarray(0, bytes.length).toString(), bytes, file);
const jpg = fs.readFileSync(`${root}/${dir}/sealed-cruse.jpg`);
assert(jpg.length > 10000 && jpg[0] === 0xff && jpg[1] === 0xd8, 'Teaser picture');

const page = fs.readFileSync(`${root}/${dir}/index.html`, 'utf8');
assert(page.includes('<h1>The Sealed Cruse</h1>'), 'Title');
assert(page.includes('src="sealed-cruse.jpg"'), 'Picture on the blog page');
const images = [...page.matchAll(/<img src="(pages\/page-\d\d\.webp)"/g)].map(m => m[1]);
assert.equal(images.length, 6, 'Six pages');
assert.deepEqual(fs.readdirSync(`${root}/${dir}/pages`).sort(), images.map(i => i.slice(6)), 'Page files');
for (const image of images) {
  const bytes = fs.readFileSync(`${root}/${dir}/${image}`);
  assert.equal(bytes.subarray(0, 4).toString() + bytes.subarray(8, 12).toString(), 'RIFFWEBP', image);
}
const links = [...page.matchAll(/href="([^"#]+\.(?:pdf|docx))"/g)].map(m => m[1]);
assert.equal(links.length, 3, 'Downloads');
for (const link of links) assert(fs.existsSync(path.resolve(`${root}/${dir}`, link)), 'Broken link ' + link);
for (const m of page.matchAll(/href="#page-(\d+)"/g)) assert(Number(m[1]) >= 1 && Number(m[1]) <= 6, 'Contents link');
assert(page.includes('#/read/Divrei_Chalomot_25'), 'Reader links');

const blogIndex = fs.readFileSync(`${root}/blog/index.html`, 'utf8');
const card = blogIndex.match(/<article class="card" aria-labelledby="chanukah-feature-title">[\s\S]*?<\/article>/g);
assert.equal(card?.length, 1, 'One Chanukah listing');
assert(blogIndex.indexOf('chanukah-feature-title') < blogIndex.indexOf('toldos-feature-title'), 'Chanukah listed first');
for (const m of card[0].matchAll(/(?:href|src)="([^"#]+)"/g)) {
  const target = path.resolve(`${root}/blog`, m[1]);
  assert(fs.existsSync(target.endsWith('/') || !path.extname(target) ? path.join(target, 'index.html') : target), 'Broken listing link ' + m[1]);
}

const html = fs.readFileSync(`${root}/index.html`, 'utf8');
assert.equal((html.match(/<a class="weekly-teaser weekly-chanukah-teaser" href="blog\/the-sealed-cruse\/"/g) || []).length, 1, 'Home teaser');
assert(html.includes('<img src="blog/the-sealed-cruse/sealed-cruse.jpg"'), 'Teaser picture');
assert(html.indexOf('weekly-chanukah-teaser') < html.indexOf('weekly-toldos-teaser'), 'Chanukah teaser first');
assert.equal((html.match(/id="chanukah-weekly"/g) || []).length, 1, 'Sidebar entry');
assert(html.indexOf('id="chanukah-weekly"') < html.indexOf('id="toldos-weekly"'), 'Chanukah first in the sidebar');
assert.equal((html.match(/This week · Parshas/g) || []).length, 2, 'Only Toldos marked as this week (teaser and sidebar)');
assert(!html.includes('This week · Parshas Chayei Sarah</') && !html.includes('This week · Parshas Vayeira</'), 'Earlier weeks relabelled');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (script[1].trim()) new vm.Script(script[1]);

const sw = fs.readFileSync(`${root}/sw.js`, 'utf8');
assert(sw.includes('-20261113-chanukah-sealed-cruse-v1'), 'Service worker version');
assert(sw.includes("'./blog/the-sealed-cruse/'"), 'Offline page');
new vm.Script(sw);
console.log('PASS: Chanukah blog The Sealed Cruse (6 pages, picture), PDF and Word downloads, Weekly Torah listing, home teaser, sidebar and offline page.');

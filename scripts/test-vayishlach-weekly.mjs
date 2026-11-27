// Static checks for the Parshas Vayishlach blog "Going Back for the Small Jars" (Kometz HaMinchah II:79), this week's
// Weekly Torah newsletter, the interlinear source PDF, their listings and the source card in the reader at Kometz HaMinchah 2:79.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist/library';
const dir = 'blog/going-back-for-the-small-jars';
for (const [file, bytes] of [['blog/pdfs/going-back-for-the-small-jars-vayishlach.pdf', '%PDF-'], ['blog/pdfs/going-back-for-the-small-jars-vayishlach-newsletter.pdf', '%PDF-'],
  ['blog/docs/going-back-for-the-small-jars-vayishlach.docx', 'PK'], ['downloads/kometz-haminchah-ii-79-small-jars-source.pdf', '%PDF-']])
  assert.equal(fs.readFileSync(`${root}/${file}`).subarray(0, bytes.length).toString(), bytes, file);
const jpg = fs.readFileSync(`${root}/${dir}/going-back-for-the-small-jars.jpg`);
assert(jpg.length > 10000 && jpg[0] === 0xff && jpg[1] === 0xd8, 'Teaser picture');
for (const [folder, n] of [[dir, 5], [dir + '/newsletter', 6]]) {
  const page = fs.readFileSync(`${root}/${folder}/index.html`, 'utf8');
  assert(page.includes('<h1>Going Back for the Small Jars</h1>'), 'Title ' + folder);
  const images = [...page.matchAll(/<img src="(pages\/page-\d\d\.webp)"/g)].map(m => m[1]);
  assert.equal(images.length, n, folder + ' pages');
  assert.deepEqual(fs.readdirSync(`${root}/${folder}/pages`).sort(), images.map(i => i.slice(6)), 'Page files ' + folder);
  for (const image of images) {
    const bytes = fs.readFileSync(`${root}/${folder}/${image}`);
    assert.equal(bytes.subarray(0, 4).toString() + bytes.subarray(8, 12).toString(), 'RIFFWEBP', image);
  }
  for (const m of page.matchAll(/(?:href|src)="(\.\.?\/[^"#]+\.(?:pdf|docx|jpg|webp))"/g))
    assert(fs.existsSync(path.resolve(`${root}/${folder}`, m[1])), 'Broken link ' + m[1]);
  assert(page.includes('#/read/Kometz_HaMinchah_2:79'), 'Reader link ' + folder);
  for (const script of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
}
const blogIndex = fs.readFileSync(`${root}/blog/index.html`, 'utf8');
assert.equal(blogIndex.match(/<article class="card" aria-labelledby="vayishlach-feature-title">/g)?.length, 1, 'One Vayishlach listing');
assert(blogIndex.indexOf('vayishlach-feature-title') < blogIndex.indexOf('vayeitzei-feature-title'), 'Vayishlach listed first');
const reader = fs.readFileSync(`${root}/index.html`, 'utf8');
assert(reader.includes('<h3 id="vayishlach-weekly">This week · Parshas Vayishlach</h3>'), 'This week');
assert(reader.includes('<h3 id="vayeitzei-weekly">Last week · Parshas Vayeitzei</h3>'), 'Last week');
assert.equal(reader.split('class="noach6-media kometz79-media"').length, 2, 'One Kometz 79 card');
assert(reader.indexOf('weekly-vayishlach-teaser') < reader.indexOf('weekly-vayeitzei-teaser'), 'Teaser order');
console.log('Vayishlach weekly Torah: blog, newsletter, source PDF, listing, teaser and reader card check out.');

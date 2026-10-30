// Add the weekly study to the native reader without changing canonical sefer data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist';
const library = path.join(root, 'library');
const version = '20261026-vayeira-mesiras-nefesh-v1';
const ref = 'Akiva_Publishing_Weekly_Torah%2C_Vayeira_Mesiras_Nefesh';
const once = (text, before, after, label) => {
  assert.equal(text.split(before).length - 1, 1, `Unexpected ${label} anchor count`);
  return text.replace(before, after);
};

const indexPath = path.join(library, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('id="akiva-vayeira-study"')) {
  const styles = [
    '.weekly-study-teaser{grid-template-columns:1fr}',
    '.weekly-study-teaser .weekly-teaser-copy{padding:20px}',
    '.weekly-study .study-commentary .ph-he,.weekly-study .study-commentary .seg-he{display:none!important}',
    '.weekly-study .study-commentary .ph{display:block!important}',
    '.weekly-study .study-commentary .ph-en{font-weight:400;font-style:normal}',
    '.text[data-lang="he"] .weekly-study .study-commentary{display:none}',
    '.weekly-study-pdf{margin:16px 0 22px}',
    '.weekly-pdf-actions,.weekly-study-contents .actions{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}',
    '.weekly-pdf-actions .btn,.weekly-study-contents .btn{height:auto;min-height:38px;padding-top:10px;padding-bottom:10px}',
    '.weekly-pdf-cover{display:block;width:min(100%,220px);height:auto;margin:12px auto;border:1px solid var(--line)}',
    '@media(max-width:700px){.weekly-study-pdf iframe{display:none}.weekly-study-contents .btn{width:100%}}'
  ].join('\n');
  html = once(html, '</head>', `<style id="akiva-vayeira-study">\n${styles}\n</style>\n<script src="vayeira-study.js?v=${version}"></script>\n</head>`, 'head');
  html = once(html, 'async function fetchText(ref, {remoteOnly = false} = {}) {',
    'async function fetchText(ref, {remoteOnly = false} = {}) {\n  if (window.AkivaVayeiraStudy?.recognizes(ref)) return window.AkivaVayeiraStudy.fetchText(ref);', 'text loader');
  html = once(html, 'async function renderBook(title) {',
    'async function renderBook(title) {\n  if (title === window.AkivaVayeiraStudy?.BOOK) {\n    document.title = "Parshas Vayeira · Akiva Publishing";\n    app.innerHTML = window.AkivaVayeiraStudy.contents() + credit();\n    return;\n  }', 'contents');
  html = once(html, "['Peri Tzadik', 'Tiferet Yosef', 'Mei HaShiloach'].includes(first.book)",
    "['Peri Tzadik', 'Tiferet Yosef', 'Mei HaShiloach', 'Akiva Publishing Weekly Torah'].includes(first.book)", 'first study view');
  html = once(html, '  sec.dataset.ref = d.sectionRef;',
    "  if (d.weeklyStudy) sec.classList.add('weekly-study');\n  sec.dataset.ref = d.sectionRef;", 'section class');
  html = once(html, '  if (d.downloadPdf) html +=',
    '  if (d.weeklyStudy) html += window.AkivaVayeiraStudy.attachment(d);\n  if (d.downloadPdf && !d.weeklyStudy) html +=', 'attachment');
  html = once(html, '<div class="seg" data-ref="${esc(r)}" data-i="${num}" data-k="${i}" tabindex="0">',
    '<div class="seg${d.weeklyStudy && d.editorialRows?.includes(i) ? \' study-commentary\' : \'\'}" data-ref="${esc(r)}" data-i="${num}" data-k="${i}" tabindex="0">', 'editorial paragraphs');
  const teaser = `<a class="weekly-teaser weekly-study-teaser" href="#/read/${ref}" aria-label="Read the Parshas Vayeira Akeidah study">\n        <span class="weekly-teaser-copy"><span class="eyebrow">This week · Parshas Vayeira · Special section</span><strong>The Deeper Meaning of the Akeidah</strong><span>Mesiras Nefesh and Giving Up Everything · Dvar Torah, fifteen interlinear sources, 34 source footnotes and an attached PDF →</span></span>\n      </a>\n      `;
  html = once(html, '<a class="weekly-teaser" href="blog/the-dew-of-your-youth/"',
    teaser + '<a class="weekly-teaser" href="blog/the-dew-of-your-youth/"', 'home teaser');
  html = once(html, '<section class="library-weekly"><h3>Latest article</h3>',
    `<section class="library-weekly"><h3>This week · Parshas Vayeira</h3><p><strong>The Deeper Meaning of the Akeidah</strong><br>Mesiras Nefesh and Giving Up Everything</p><a class="link" href="#/read/${ref}">Read the Dvar Torah and interlinear sources →</a><a class="link" href="downloads/vayeira-akeidah-mesiras-nefesh.pdf" target="_blank" rel="noopener">Open the complete PDF ↗</a><h3>Latest article</h3>`, 'sidebar');
  fs.writeFileSync(indexPath, html);
}

if (!html.includes('id="akiva-vayeira-interlinear-fonts"')) {
  html = once(html, '</head>', '<style id="akiva-vayeira-interlinear-fonts">\n.weekly-study .ph-he,.weekly-study .seg-he{font-weight:400}\n.weekly-study .ph-en,.weekly-study .seg-en{font-weight:700}\n.weekly-study .study-commentary .ph-en,.weekly-study .study-commentary .seg-en{font-weight:400}\n</style>\n</head>', 'interlinear fonts');
  fs.writeFileSync(indexPath, html);
}

const swPath = path.join(library, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes(version)) {
  sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${version}$2`);
  sw = once(sw, 'const SHELL_FILES = [', `const SHELL_FILES = [\n  './vayeira-study.js?v=${version}', './studies/vayeira-mesiras-nefesh.json?v=${version}',\n  './downloads/vayeira-akeidah-mesiras-nefesh-cover.webp',`, 'offline study');
  fs.writeFileSync(swPath, sw);
}
if (!sw.includes('vayeira-interlinear-fonts-v1')) {
  sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, '$1-vayeira-interlinear-fonts-v1$2');
  fs.writeFileSync(swPath, sw);
}

const blogPath = path.join(library, 'blog/index.html');
let blog = fs.readFileSync(blogPath, 'utf8');
if (!blog.includes('id="vayeira-feature-title"')) {
  const card = `<article class="card" aria-labelledby="vayeira-feature-title"><div class="eyebrow">October 26, 2026 · Parshas Vayeira 5787</div><h2 id="vayeira-feature-title"><a style="text-decoration:none" href="../#/read/${ref}">The Deeper Meaning of the Akeidah</a></h2><p class="subtitle" style="margin:0 0 15px;text-align:left">Mesiras Nefesh and Giving Up Everything</p><p>A special Dvar Torah on Avraham Avinu, followed by fifteen Hebrew–English interlinear source passages from Pri Tzaddik, Beis Yaakov, Mei HaShiloach and other Chassidic works, with 34 source footnotes.</p><div class="actions" style="justify-content:flex-start"><a class="btn" href="../#/read/${ref}">Read in the reader →</a><a class="btn secondary" href="../downloads/vayeira-akeidah-mesiras-nefesh.pdf" target="_blank" rel="noopener">Open complete PDF ↗</a><a class="btn secondary" href="../downloads/vayeira-akeidah-mesiras-nefesh.pdf" download>Download PDF ↓</a></div></article>\n`;
  blog = once(blog, '<main class="index-layout"><div>', '<main class="index-layout"><div>' + card, 'weekly Torah listing');
  fs.writeFileSync(blogPath, blog);
}

// October 30 · the blog "Even the World to Come" and the transcribed shiur replace the Vayeira listing.
// Each step replaces the earlier markup in place, so it is safe to run again on an already-updated site.
const blogVersion = '20261030-vayeira-blog-shiur-v2';
const audioVersion = '20261030-vayeira-shiur-audio-v3';
const everywhereVersion = '20261030-vayeira-audio-all-sections-v4';
const sourcesRef = ref + '_Sources';
const replaceOne = (text, pattern, replacement, label) => {
  const found = text.match(new RegExp(pattern.source, 'g')) || [];
  assert.equal(found.length, 1, `Unexpected ${label} count`);
  return text.replace(pattern, () => replacement);
};

html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/vayeira-study\.js\?v=[\w-]+/g, `vayeira-study.js?v=${everywhereVersion}`);
if (!html.includes('id="akiva-vayeira-blog-shiur"')) {
  const styles = [
    '.weekly-study-new{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin:16px 0 6px;padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--ox)}',
    '.weekly-study-new .eyebrow{flex-basis:100%}',
    '.weekly-study-new strong{font:500 1.2rem/1.3 var(--en);color:var(--forest)}',
    '.weekly-study-new span:not(.eyebrow){color:var(--muted)}',
    '.weekly-study-new a{font-weight:700}',
    '.weekly-study-contents .weekly-study-item{border-top:1px solid var(--line);margin-top:20px;padding-top:16px}',
    '.weekly-study-contents .weekly-study-item h2{font:500 1.35rem/1.25 var(--en);color:var(--forest);margin:0 0 6px}',
    '.weekly-study-contents .weekly-study-item p{margin:0}'
  ].join('\n');
  html = once(html, '</head>', `<style id="akiva-vayeira-blog-shiur">\n${styles}\n</style>\n</head>`, 'blog and shiur styles');
}
if (!html.includes('id="akiva-vayeira-shiur-audio"')) {
  const styles = [
    '.vayeira-media .shiur-audio{margin:0}',
    '.vayeira-transcript .vayeira-part{min-height:40px;max-width:100%;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);font:500 .85rem var(--ui)}',
    '.vayeira-transcript .divrei16-page-image{aspect-ratio:1224/1584}'
  ].join('\n');
  html = once(html, '</head>', `<style id="akiva-vayeira-shiur-audio">\n${styles}\n</style>\n</head>`, 'shiur audio styles');
}
html = replaceOne(html, /<a class="weekly-teaser weekly-study-teaser"[\s\S]*?<\/a>/,
  `<a class="weekly-teaser weekly-study-teaser" href="blog/even-the-world-to-come/" aria-label="Read Even the World to Come, the Parshas Vayeira blog and transcribed shiur">\n        <span class="weekly-teaser-copy"><span class="eyebrow">This week · Parshas Vayeira</span><strong>Even the World to Come</strong><span>Avraham, the Akeidah, and the radical mesiras nefesh of Izhbitz · The blog, the transcribed shiur and the shiur recording →</span></span>\n      </a>`, 'home teaser');
html = replaceOne(html, /<section class="library-weekly"><h3>This week · Parshas Vayeira<\/h3>[\s\S]*?<h3>Latest article<\/h3>/,
  `<section class="library-weekly"><h3>This week · Parshas Vayeira</h3><p><strong>Even the World to Come</strong><br>Avraham, the Akeidah, and the radical mesiras nefesh of Izhbitz</p><a class="link" href="blog/even-the-world-to-come/">Read the blog →</a><a class="link" href="#/read/${ref}">🎧 Listen to the shiur →</a><a class="link" href="blog/even-the-world-to-come/shiur/">Read the transcribed shiur →</a><a class="link" href="#/read/${sourcesRef}">Interlinear sources in the reader →</a><h3>Latest article</h3>`, 'sidebar');
fs.writeFileSync(indexPath, html);

sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/\.\/vayeira-study\.js\?v=[\w-]+/g, `./vayeira-study.js?v=${everywhereVersion}`);
if (!sw.includes('-' + blogVersion)) sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${blogVersion}$2`);
if (!sw.includes('-' + audioVersion)) sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${audioVersion}$2`);
if (!sw.includes('-' + everywhereVersion)) sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${everywhereVersion}$2`);
if (!sw.includes("'./blog/even-the-world-to-come/'")) {
  sw = once(sw, "  './blog/', ", "  './blog/', './blog/even-the-world-to-come/', './blog/even-the-world-to-come/shiur/', ", 'offline blog pages');
}
fs.writeFileSync(swPath, sw);

blog = fs.readFileSync(blogPath, 'utf8');
const shiurLinks = `<a class="btn" href="../#/read/${ref}">🎧 Listen to the shiur →</a><a class="btn secondary" href="even-the-world-to-come/shiur/">Read the shiur →</a><a class="btn secondary" href="../downloads/vayeira-mesiras-nefesh-shiur.pdf" target="_blank" rel="noopener">Read PDF ↗</a><a class="btn secondary" href="../downloads/vayeira-mesiras-nefesh-shiur.pdf" download>Download PDF ↓</a><a class="btn secondary" href="../downloads/vayeira-mesiras-nefesh-shiur.docx" download>Download Word ↓</a>`;
const card = `<article class="card" aria-labelledby="vayeira-feature-title"><div class="eyebrow">October 30, 2026 · Parshas Vayeira 5787 · Beis Yaakov, Mei HaShiloach &amp; Pri Tzaddik</div><h2 id="vayeira-feature-title"><a style="text-decoration:none" href="even-the-world-to-come/">Even the World to Come</a></h2><p class="subtitle" style="margin:0 0 15px;text-align:left">Avraham, the Akeidah, and the radical mesiras nefesh of Izhbitz</p><p>Rabbi Akiva gave his life with the Shema on his lips. Avraham, at the Akeidah, was ready to give up even his World to Come. A 12-page essay on what mesiras nefesh means in the Izhbitz–Radzin tradition, with the Hebrew sources and footnotes. By Akiva Gutnicki.</p><div class="actions" style="justify-content:flex-start"><a class="btn" href="even-the-world-to-come/">Read the blog →</a><a class="btn secondary" href="even-the-world-to-come/#listen">🎧 Listen to the shiur</a><a class="btn secondary" href="pdfs/even-the-world-to-come-vayeira.pdf" target="_blank" rel="noopener">Read PDF ↗</a><a class="btn secondary" href="pdfs/even-the-world-to-come-vayeira.pdf" download>Download PDF ↓</a><a class="btn secondary" href="docs/even-the-world-to-come-vayeira.docx" download>Download Word ↓</a></div><div style="border-top:1px solid var(--border);margin-top:6px;padding-top:24px"><div class="eyebrow">The shiur · recording 1:16:20 · transcript 38 pages</div><h3 style="font-weight:400;font-size:clamp(25px,3.2vw,33px);letter-spacing:-.02em;line-height:1.2;margin:12px 0 10px"><a style="text-decoration:none" href="even-the-world-to-come/shiur/">Mesiras Nefesh: The Deeper Meaning of the Akeidah</a></h3><p>The full shiur the essay grew from: listen to the recording in the reader, or read the transcript in ten parts with its sources in Hebrew and English.</p><div class="actions" style="justify-content:flex-start;margin-bottom:14px">${shiurLinks}</div><p style="margin:0;font:700 13px/1.6 Arial,sans-serif"><a href="../#/read/${sourcesRef}">The fifteen Hebrew–English interlinear sources are in the reader →</a></p></div></article>\n`;
blog = replaceOne(blog, /<article class="card" aria-labelledby="vayeira-feature-title">[\s\S]*?<\/article>\n?/, card, 'Vayeira listing');
fs.writeFileSync(blogPath, blog);

if (path.resolve(root) !== path.resolve('dist')) {
  const blogPages = ['blog/even-the-world-to-come', 'blog/even-the-world-to-come/shiur'].flatMap(dir =>
    ['index.html', ...fs.readdirSync(path.join('dist/library', dir, 'pages')).sort().map(name => 'pages/' + name)].map(name => dir + '/' + name));
  for (const file of ['vayeira-study.js', 'studies/vayeira-mesiras-nefesh.json', 'downloads/vayeira-akeidah-mesiras-nefesh.pdf', 'downloads/vayeira-akeidah-mesiras-nefesh-cover.webp',
    'blog/pdfs/even-the-world-to-come-vayeira.pdf', 'blog/docs/even-the-world-to-come-vayeira.docx',
    'downloads/vayeira-mesiras-nefesh-shiur.pdf', 'downloads/vayeira-mesiras-nefesh-shiur.docx', 'audio/vayeira-mesiras-nefesh-shiur.m4a', ...blogPages]) {
    const dest = path.join(library, file);
    fs.mkdirSync(path.dirname(dest), {recursive:true});
    fs.copyFileSync(path.join('dist/library', file), dest);
  }
}
console.log('Parshas Vayeira reader entry, shiur recording, blog, transcribed shiur, PDF and Word downloads and discovery links are ready.');

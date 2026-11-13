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
  `<a class="weekly-teaser weekly-study-teaser" href="blog/even-the-world-to-come/" aria-label="Read Even the World to Come, the Parshas Vayeira blog and transcribed shiur">\n        <span class="weekly-teaser-copy"><span class="eyebrow">Parshas Vayeira</span><strong>Even the World to Come</strong><span>Avraham, the Akeidah, and the radical mesiras nefesh of Izhbitz · The blog, the transcribed shiur and the shiur recording →</span></span>\n      </a>`, 'home teaser');
const vayeiraLabel = html.includes('id="chayei-sarah-weekly"') ? 'Last week · Parshas Vayeira' : 'This week · Parshas Vayeira';
html = replaceOne(html, /<h3>(?:This week|Last week|Earlier) · Parshas Vayeira<\/h3>[\s\S]*?<h3>Latest article<\/h3>/,
  `<h3>${vayeiraLabel}</h3><p><strong>Even the World to Come</strong><br>Avraham, the Akeidah, and the radical mesiras nefesh of Izhbitz</p><a class="link" href="blog/even-the-world-to-come/">Read the blog →</a><a class="link" href="#/read/${ref}">🎧 Listen to the shiur →</a><a class="link" href="blog/even-the-world-to-come/shiur/">Read the transcribed shiur →</a><a class="link" href="#/read/${sourcesRef}">Interlinear sources in the reader →</a><h3>Latest article</h3>`, 'sidebar');
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

// November 1 · Parshas Chayei Sarah: the blog "From the East I Will Bring Your Seed" and the shiur "Wisdom Outside the House".
// Each step inserts its markup once and replaces it in place afterwards, so it is safe to run again on an updated site.
const chayeiVersion = '20261101-chayei-sarah-v1';
const chayeiBlog = 'blog/from-the-east/';
const chayeiPri = 'Peri_Tzadik,_Chayei_Sara_6';
const chayeiNative = 'Akiva_Publishing_Weekly_Torah%2C_Chayei_Sarah_Wisdom_Outside_the_House';
const upsert = (text, pattern, markup, before, label) => {
  const found = text.match(new RegExp(pattern.source, 'g')) || [];
  if (found.length === 1) return text.replace(pattern, () => markup);
  assert.equal(found.length, 0, `Unexpected ${label} count`);
  return once(text, before, markup + before, label + ' anchor');
};

html = fs.readFileSync(indexPath, 'utf8');
const chayeiTeaser = `<a class="weekly-teaser weekly-chayei-teaser" href="${chayeiBlog}" aria-label="Read From the East I Will Bring Your Seed, the Parshas Chayei Sarah blog and shiur">\n        <img src="${chayeiBlog}ben-ish-chai.jpg" alt="Rabbi Yosef Chaim of Baghdad, the Ben Ish Chai" loading="lazy">\n        <span class="weekly-teaser-copy"><span class="eyebrow">This week · Parshas Chayei Sarah</span><strong>From the East I Will Bring Your Seed</strong><span>The sons of Keturah, the sparks of the Oral Torah that went east, and the gedolim and hidden souls coming home · The blog and the 32-page shiur →</span></span>\n      </a>\n      `;
html = upsert(html, /<a class="weekly-teaser weekly-chayei-teaser"[\s\S]*?<\/a>\n      /, chayeiTeaser, '<a class="weekly-teaser weekly-study-teaser"', 'Chayei Sarah teaser');
const chayeiSidebar = `<h3 id="chayei-sarah-weekly">This week · Parshas Chayei Sarah</h3><p><strong>From the East I Will Bring Your Seed</strong><br>The sons of Keturah and the sparks coming home · By Akiva Gutnicki</p><a class="link" href="${chayeiBlog}">Read the blog →</a><a class="link" href="#/read/${chayeiNative}">Read the shiur in the app, Wisdom Outside the House →</a><a class="link" href="${chayeiBlog}shiur/">The shiur page by page, PDF and Word →</a><a class="link" href="#/read/${chayeiPri}">Pri Tzaddik, Chayei Sarah 6 in the reader →</a>`;
html = upsert(html, /<h3 id="chayei-sarah-weekly">[\s\S]*?(?=<h3>(?:This week|Last week|Earlier) · Parshas Vayeira<\/h3>)/, chayeiSidebar, '<h3>This week · Parshas Vayeira</h3>', 'Chayei Sarah sidebar');
html = html.replace('<h3>This week · Parshas Vayeira</h3>', '<h3>Last week · Parshas Vayeira</h3>');
fs.writeFileSync(indexPath, html);

sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('-' + chayeiVersion)) sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${chayeiVersion}$2`);
if (!sw.includes(`'./${chayeiBlog}'`)) sw = once(sw, "  './blog/', ", `  './blog/', './${chayeiBlog}', './${chayeiBlog}shiur/', `, 'offline Chayei Sarah pages');
fs.writeFileSync(swPath, sw);

blog = fs.readFileSync(blogPath, 'utf8');
const chayeiCard = `<article class="card" aria-labelledby="chayei-sarah-feature-title"><div class="eyebrow">November 1, 2026 · Parshas Chayei Sarah 5787 · Pri Tzaddik, Mei HaShiloach &amp; Beis Yaakov</div><h2 id="chayei-sarah-feature-title"><a style="text-decoration:none" href="from-the-east/">From the East I Will Bring Your Seed</a></h2><p class="subtitle" style="margin:0 0 15px;text-align:left">Parshas Chayei Sarah, the sons of Keturah, and the sparks coming home</p><p>Why does the Midrash call the sons of Keturah Avraham’s “great increase”? Rav Tzadok’s answer runs from the gifts Avraham sent east, through the Talmud Bavli and the gedolim of Baghdad, Aleppo, Turkey, Persia, Yemen and Morocco, to the hidden Jewish souls coming home in our own day. An 8-page essay with photographs and sources. By Akiva Gutnicki.</p><div class="actions" style="justify-content:flex-start"><a class="btn" href="from-the-east/">Read the blog →</a><a class="btn secondary" href="pdfs/from-the-east-chayei-sarah.pdf" target="_blank" rel="noopener">Read PDF ↗</a><a class="btn secondary" href="pdfs/from-the-east-chayei-sarah.pdf" download>Download PDF ↓</a><a class="btn secondary" href="docs/from-the-east-chayei-sarah.docx" download>Download Word ↓</a></div><div style="border-top:1px solid var(--border);margin-top:6px;padding-top:24px"><div class="eyebrow">The shiur · 32 pages · ten parts · 65 footnotes</div><h3 style="font-weight:400;font-size:clamp(25px,3.2vw,33px);letter-spacing:-.02em;line-height:1.2;margin:12px 0 10px"><a style="text-decoration:none" href="from-the-east/shiur/">Wisdom Outside the House</a></h3><p>Keturah, the Bnei Kedem and Yishmael: the full shiur, with Pri Tzaddik, Mei HaShiloach, Beis Yaakov, Kometz HaMinchah and Divrei Soferim in Hebrew–English interlinear, and supporting sources from kabbalah, machshavah, chassidus and mussar.</p><div class="actions" style="justify-content:flex-start;margin-bottom:14px"><a class="btn" href="../#/read/${chayeiNative}">Read the shiur in the app →</a><a class="btn secondary" href="from-the-east/shiur/">Page by page →</a><a class="btn secondary" href="../downloads/chayei-sarah-wisdom-outside-the-house-shiur.pdf" target="_blank" rel="noopener">Read PDF ↗</a><a class="btn secondary" href="../downloads/chayei-sarah-wisdom-outside-the-house-shiur.pdf" download>Download PDF ↓</a><a class="btn secondary" href="../downloads/chayei-sarah-wisdom-outside-the-house-shiur.docx" download>Download Word ↓</a></div><p style="margin:0;font:700 13px/1.6 Arial,sans-serif"><a href="../#/read/${chayeiPri}">Read Pri Tzaddik, Chayei Sarah 6 in the reader →</a></p></div></article>\n`;
blog = upsert(blog, /<article class="card" aria-labelledby="chayei-sarah-feature-title">[\s\S]*?<\/article>\n?/, chayeiCard, '<article class="card" aria-labelledby="vayeira-feature-title">', 'Chayei Sarah listing');
fs.writeFileSync(blogPath, blog);

// November 1 · the shiur "Wisdom Outside the House" as native reader text, beside its PDF, Word and page-by-page editions.
const nativeVersion = '20261101-chayei-sarah-native-v1';
html = fs.readFileSync(indexPath, 'utf8');
const nativeStyles = [
  '.chayei-native-new .chayei-native-actions{flex-basis:100%}',
  '.chayei-native-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px}',
  '.chayei-native-actions .btn{height:auto;min-height:36px;padding-top:8px;padding-bottom:8px}',
  '.chayei-native-end{justify-content:center;margin:0 0 6px}',
  '.chayei-parts{margin:14px 0 22px;padding:14px 16px;border:1px solid var(--line);border-radius:6px;background:var(--panel)}',
  '.chayei-parts h3{font:700 .76rem/1.4 var(--ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}',
  '.chayei-parts-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}',
  '.chayei-parts-list a{font:600 1.02rem/1.35 var(--en);color:var(--link)}',
  '.chayei-parts-list span{display:block;color:var(--muted);font-size:.93rem;line-height:1.45}',
  '.chayei-parts-list li[aria-current] a{color:var(--forest)}',
  '.weekly-chayei-contents .chayei-parts-list{margin:16px 0 4px}',
  '.chayei-part-sources{font:500 .86rem/1.6 var(--ui);color:var(--muted);text-align:center;margin:2px 0 16px}',
  '.chayei-part-sources a{color:var(--link)}',
  '.chayei-source-index{margin:8px 0 22px}',
  '.chayei-source-index h3{font:500 1.2rem/1.3 var(--en);color:var(--forest);margin:20px 0 8px}',
  '.chayei-source-index p{margin:0 0 8px;color:var(--muted)}',
  '.chayei-source-index ul{margin:0;padding:0 0 0 1.1em;display:grid;gap:6px}',
  '.chayei-source-index li{line-height:1.5}',
  '.chayei-source-index li span{color:var(--muted);font-size:.9rem}',
  '.chayei-source-index a{color:var(--link);overflow-wrap:anywhere}',
  '.weekly-chayei-contents .weekly-study-item{border-top:1px solid var(--line);margin-top:20px;padding-top:16px}',
  '.weekly-chayei-contents .weekly-study-item h2{font:500 1.35rem/1.25 var(--en);color:var(--forest);margin:0 0 6px}',
  '.weekly-chayei-contents .weekly-study-item p{margin:0}',
  '.weekly-chayei-contents .actions{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}',
  '.weekly-chayei-contents .btn{height:auto;min-height:38px;padding-top:10px;padding-bottom:10px}',
  '.weekly-chayei-contents + .weekly-study-contents{padding-top:8px}',
  '.text[data-lang="en"] section.weekly-study[data-ref^="Akiva Publishing Weekly Torah, Chayei Sarah"] .seg-en{font-weight:400}',
  'section.weekly-study[data-ref^="Akiva Publishing Weekly Torah, Chayei Sarah"] .reader-footnote .annotation-text,section.weekly-study[data-ref^="Akiva Publishing Weekly Torah, Chayei Sarah"] i.footnote{font-family:"Crimson Pro","Frank Ruhl Libre","Taamey Frank CLM","Times New Roman",serif}',
  '@media(max-width:700px){.weekly-chayei-contents .btn{width:100%}.chayei-native-actions{display:grid;grid-template-columns:1fr 1fr}.chayei-native-actions .btn{width:100%;justify-content:center;text-align:center}}'
].join('\n');
html = upsert(html, /<style id="akiva-chayei-sarah-study">[\s\S]*?<\/style>\n<script src="chayei-sarah-study\.js\?v=[\w-]+"><\/script>\n/,
  `<style id="akiva-chayei-sarah-study">\n${nativeStyles}\n</style>\n<script src="chayei-sarah-study.js?v=${nativeVersion}"></script>\n`, '</head>', 'Chayei Sarah reader module');
const vayeiraLoader = '  if (window.AkivaVayeiraStudy?.recognizes(ref)) return window.AkivaVayeiraStudy.fetchText(ref);';
if (!html.includes('window.AkivaChayeiSarahStudy?.recognizes(ref)')) html = once(html, vayeiraLoader,
  '  if (window.AkivaChayeiSarahStudy?.recognizes(ref)) return window.AkivaChayeiSarahStudy.fetchText(ref);\n' + vayeiraLoader, 'Chayei Sarah text loader');
if (!html.includes('window.AkivaChayeiSarahStudy.contents(')) html = once(html,
  '    document.title = "Parshas Vayeira · Akiva Publishing";\n    app.innerHTML = window.AkivaVayeiraStudy.contents() + credit();',
  '    document.title = "Weekly Torah · Akiva Publishing";\n    app.innerHTML = (window.AkivaChayeiSarahStudy ? window.AkivaChayeiSarahStudy.contents(window.AkivaVayeiraStudy.contents()) : window.AkivaVayeiraStudy.contents()) + credit();',
  'Weekly Torah contents');
if (!html.includes('window.AkivaChayeiSarahStudy.attachment(d)')) html = once(html,
  '  if (d.weeklyStudy) html += window.AkivaVayeiraStudy.attachment(d);',
  '  if (d.weeklyStudy) html += d.chayeiSarahStudy && window.AkivaChayeiSarahStudy ? window.AkivaChayeiSarahStudy.attachment(d) : window.AkivaVayeiraStudy.attachment(d);',
  'Chayei Sarah attachment');
fs.writeFileSync(indexPath, html);
sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('-' + nativeVersion)) sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${nativeVersion}$2`);
if (!sw.includes('./chayei-sarah-study.js?v=')) sw = once(sw, 'const SHELL_FILES = [',
  `const SHELL_FILES = [\n  './chayei-sarah-study.js?v=${nativeVersion}', './studies/chayei-sarah-wisdom-outside-the-house.json?v=${nativeVersion}',`, 'offline Chayei Sarah text');
sw = sw.replace(/\.\/chayei-sarah-study\.js\?v=[\w-]+/g, `./chayei-sarah-study.js?v=${nativeVersion}`)
  .replace(/\.\/studies\/chayei-sarah-wisdom-outside-the-house\.json\?v=[\w-]+/g, `./studies/chayei-sarah-wisdom-outside-the-house.json?v=${nativeVersion}`);
fs.writeFileSync(swPath, sw);

// November 9 · Parshas Toldos: the blog "The King's Table" (Pri Tzaddik, Toldos 3 and Kuntres Eis HaOchel 8).
// Toldos becomes this week, Chayei Sarah last week and Vayeira earlier. Safe to run again on an updated site.
const toldosVersion = '20261109-toldos-kings-table-v1';
const toldosBlog = 'blog/the-kings-table/';
const toldosPri = 'Peri_Tzadik,_Toldot_3';
const toldosEis = 'Et_HaOchel_8';
html = fs.readFileSync(indexPath, 'utf8');
const toldosTeaser = `<a class="weekly-teaser weekly-toldos-teaser" href="${toldosBlog}" aria-label="Read The King’s Table, the Parshas Toldos blog">\n        <img src="${toldosBlog}kings-table.jpg" alt="A Shabbos table set with candles, a kiddush cup, a covered challah and a dish of savory food" loading="lazy">\n        <span class="weekly-teaser-copy"><span class="eyebrow">This week · Parshas Toldos</span><strong>The King’s Table</strong><span>Why Yitzchak ate before he blessed: the Ibn Ezra, the Ramban, and Rav Tzadok on the meal of faith, the King’s table, and the one meal that lifts every meal →</span></span>\n      </a>\n      `;
html = upsert(html, /<a class="weekly-teaser weekly-toldos-teaser"[\s\S]*?<\/a>\n      /, toldosTeaser, '<a class="weekly-teaser weekly-chayei-teaser"', 'Toldos teaser');
const toldosSidebar = `<h3 id="toldos-weekly">This week · Parshas Toldos</h3><p><strong>The King’s Table</strong><br>Why Yitzchak ate before he blessed, and what that means for every meal we eat · By Akiva Gutnicki</p><a class="link" href="${toldosBlog}">Read the blog →</a><a class="link" href="#/read/${toldosPri}">Pri Tzaddik, Toldos 3 in the reader →</a><a class="link" href="#/read/${toldosEis}">Kuntres Eis HaOchel 8 in the reader →</a>`;
html = upsert(html, /<h3 id="toldos-weekly">[\s\S]*?(?=<h3 id="chayei-sarah-weekly">)/, toldosSidebar, '<h3 id="chayei-sarah-weekly">', 'Toldos sidebar');
html = html.replace('<h3 id="chayei-sarah-weekly">This week · Parshas Chayei Sarah</h3>', '<h3 id="chayei-sarah-weekly">Last week · Parshas Chayei Sarah</h3>')
  .replace('<span class="eyebrow">This week · Parshas Chayei Sarah</span>', '<span class="eyebrow">Last week · Parshas Chayei Sarah</span>')
  .replace(/<h3>(?:This week|Last week) · Parshas Vayeira<\/h3>/, '<h3>Earlier · Parshas Vayeira</h3>');
fs.writeFileSync(indexPath, html);

sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('-' + toldosVersion)) sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${toldosVersion}$2`);
if (!sw.includes(`'./${toldosBlog}'`)) sw = once(sw, "  './blog/', ", `  './blog/', './${toldosBlog}', `, 'offline Toldos page');
fs.writeFileSync(swPath, sw);

blog = fs.readFileSync(blogPath, 'utf8');
const toldosCard = `<article class="card" aria-labelledby="toldos-feature-title"><div class="eyebrow">November 9, 2026 · Parshas Toldos 5787 · Pri Tzaddik &amp; Kuntres Eis HaOchel</div><h2 id="toldos-feature-title"><a style="text-decoration:none" href="the-kings-table/">The King’s Table</a></h2><p class="subtitle" style="margin:0 0 15px;text-align:left">Why Yitzchak ate before he blessed, and what that means for every meal we eat</p><p><a href="the-kings-table/"><img src="the-kings-table/kings-table.jpg" width="1600" height="900" alt="A Shabbos table set with candles, a kiddush cup, a covered challah and a dish of savory food" loading="lazy" style="display:block;width:100%;height:auto;border:1px solid var(--border);margin:0 0 14px"></a>Esav ate and walked away from the birthright; Yitzchak ate and gave the berachos. The Ibn Ezra’s surprising chiddush, the Ramban’s objection and his peshat, and Rav Tzadok’s two meals: the meal of faith and the King’s table. Then his own table, and Kuntres Eis HaOchel on how one meal eaten awake can lift every other meal. A 5-page essay. By Akiva Gutnicki.</p><div class="actions" style="justify-content:flex-start"><a class="btn" href="the-kings-table/">Read the blog →</a><a class="btn secondary" href="pdfs/the-kings-table-toldos.pdf" target="_blank" rel="noopener">Read PDF ↗</a><a class="btn secondary" href="pdfs/the-kings-table-toldos.pdf" download>Download PDF ↓</a><a class="btn secondary" href="docs/the-kings-table-toldos.docx" download>Download Word ↓</a></div><p style="margin:0;font:700 13px/1.6 Arial,sans-serif"><a href="../#/read/${toldosPri}">Pri Tzaddik, Toldos 3 in the reader →</a> · <a href="../#/read/${toldosEis}">Eis HaOchel 8 →</a></p></article>\n`;
blog = upsert(blog, /<article class="card" aria-labelledby="toldos-feature-title">[\s\S]*?<\/article>\n?/, toldosCard, '<article class="card" aria-labelledby="chayei-sarah-feature-title">', 'Toldos listing');
fs.writeFileSync(blogPath, blog);

// Chanukah · Divrei Chalomos 25: the blog "The Sealed Cruse", added above Parshas Toldos. Safe to run again.
const cruseVersion = '20261113-chanukah-sealed-cruse-v1';
const cruseBlog = 'blog/the-sealed-cruse/';
const cruseRef = 'Divrei_Chalomot_25';
const cruseAlt = 'A Greek soldier, a temple behind him, reaches for the Torah scroll held by a Kohen standing before a lit menorah';
html = fs.readFileSync(indexPath, 'utf8');
const cruseTeaser = `<a class="weekly-teaser weekly-chanukah-teaser" href="${cruseBlog}" aria-label="Read The Sealed Cruse, the Chanukah blog">\n        <img src="${cruseBlog}sealed-cruse.jpg" alt="${cruseAlt}" loading="lazy">\n        <span class="weekly-teaser-copy"><span class="eyebrow">Chanukah · Divrei Chalomos 25</span><strong>The Sealed Cruse</strong><span>The shell comes before the fruit and makes it grow: Og and Avraham, the yetzer hara that is “very good,” and the jar Greece could not touch →</span></span>\n      </a>\n      `;
html = upsert(html, /<a class="weekly-teaser weekly-chanukah-teaser"[\s\S]*?<\/a>\n      /, cruseTeaser, '<a class="weekly-teaser weekly-toldos-teaser"', 'Chanukah teaser');
const cruseSidebar = `<h3 id="chanukah-weekly">Chanukah · Divrei Chalomos 25</h3><p><strong>The Sealed Cruse</strong><br>How the shell grows the fruit, and the light Greece could not touch · By Akiva Gutnicki</p><a class="link" href="${cruseBlog}">Read the blog →</a><a class="link" href="#/read/${cruseRef}">Divrei Chalomos 25 in the reader →</a>`;
html = upsert(html, /<h3 id="chanukah-weekly">[\s\S]*?(?=<h3 id="toldos-weekly">)/, cruseSidebar, '<h3 id="toldos-weekly">', 'Chanukah sidebar');
fs.writeFileSync(indexPath, html);

sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('-' + cruseVersion)) sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${cruseVersion}$2`);
if (!sw.includes(`'./${cruseBlog}'`)) sw = once(sw, "  './blog/', ", `  './blog/', './${cruseBlog}', `, 'offline Chanukah page');
fs.writeFileSync(swPath, sw);

blog = fs.readFileSync(blogPath, 'utf8');
const cruseCard = `<article class="card" aria-labelledby="chanukah-feature-title"><div class="eyebrow">November 13, 2026 · Chanukah 5787 · Divrei Chalomos 25</div><h2 id="chanukah-feature-title"><a style="text-decoration:none" href="the-sealed-cruse/">The Sealed Cruse</a></h2><p class="subtitle" style="margin:0 0 15px;text-align:left">One against the other: how the shell grows the fruit, and the light Greece could not touch</p><p><a href="the-sealed-cruse/"><img src="the-sealed-cruse/sealed-cruse.jpg" width="1600" height="900" alt="${cruseAlt}" loading="lazy" style="display:block;width:100%;height:auto;border:1px solid var(--border);margin:0 0 14px"></a>On the fifth night of Chanukah Rav Tzadok dreamed a Torah and wrote it down. The shell always comes before the fruit, and it is the shell that makes the fruit grow: Og before Avraham, the yetzer hara that is “very good,” darkness before light, each tribe’s chisaron driving its ma’alah, and Greek wisdom around the Oral Torah, which brought out the one jar sealed by the Kohen Gadol. A 6-page essay. By Akiva Gutnicki.</p><div class="actions" style="justify-content:flex-start"><a class="btn" href="the-sealed-cruse/">Read the blog →</a><a class="btn secondary" href="pdfs/the-sealed-cruse-chanukah.pdf" target="_blank" rel="noopener">Read PDF ↗</a><a class="btn secondary" href="pdfs/the-sealed-cruse-chanukah.pdf" download>Download PDF ↓</a><a class="btn secondary" href="docs/the-sealed-cruse-chanukah.docx" download>Download Word ↓</a></div><p style="margin:0;font:700 13px/1.6 Arial,sans-serif"><a href="../#/read/${cruseRef}">Divrei Chalomos 25 in the reader →</a></p></article>\n`;
blog = upsert(blog, /<article class="card" aria-labelledby="chanukah-feature-title">[\s\S]*?<\/article>\n?/, cruseCard, '<article class="card" aria-labelledby="toldos-feature-title">', 'Chanukah listing');
fs.writeFileSync(blogPath, blog);

if (path.resolve(root) !== path.resolve('dist')) {
  const chayeiFiles = ['blog/from-the-east', 'blog/from-the-east/shiur'].flatMap(dir =>
    ['index.html', ...fs.readdirSync(path.join('dist/library', dir, 'pages')).sort().map(name => 'pages/' + name)].map(name => dir + '/' + name))
    .concat(['blog/from-the-east/ben-ish-chai.jpg', 'blog/pdfs/from-the-east-chayei-sarah.pdf', 'blog/docs/from-the-east-chayei-sarah.docx',
      'downloads/chayei-sarah-wisdom-outside-the-house-shiur.pdf', 'downloads/chayei-sarah-wisdom-outside-the-house-shiur.docx',
      'chayei-sarah-study.js', 'studies/chayei-sarah-wisdom-outside-the-house.json',
      'blog/the-kings-table/index.html', 'blog/the-kings-table/kings-table.jpg', 'blog/pdfs/the-kings-table-toldos.pdf', 'blog/docs/the-kings-table-toldos.docx',
      ...fs.readdirSync('dist/library/blog/the-kings-table/pages').sort().map(name => 'blog/the-kings-table/pages/' + name),
      'blog/the-sealed-cruse/index.html', 'blog/the-sealed-cruse/sealed-cruse.jpg', 'blog/pdfs/the-sealed-cruse-chanukah.pdf', 'blog/docs/the-sealed-cruse-chanukah.docx',
      ...fs.readdirSync('dist/library/blog/the-sealed-cruse/pages').sort().map(name => 'blog/the-sealed-cruse/pages/' + name)]);
  const blogPages = ['blog/even-the-world-to-come', 'blog/even-the-world-to-come/shiur'].flatMap(dir =>
    ['index.html', ...fs.readdirSync(path.join('dist/library', dir, 'pages')).sort().map(name => 'pages/' + name)].map(name => dir + '/' + name));
  for (const file of ['vayeira-study.js', 'studies/vayeira-mesiras-nefesh.json', 'downloads/vayeira-akeidah-mesiras-nefesh.pdf', 'downloads/vayeira-akeidah-mesiras-nefesh-cover.webp',
    'blog/pdfs/even-the-world-to-come-vayeira.pdf', 'blog/docs/even-the-world-to-come-vayeira.docx',
    'downloads/vayeira-mesiras-nefesh-shiur.pdf', 'downloads/vayeira-mesiras-nefesh-shiur.docx', 'audio/vayeira-mesiras-nefesh-shiur.m4a', ...blogPages, ...chayeiFiles]) {
    const dest = path.join(library, file);
    fs.mkdirSync(path.dirname(dest), {recursive:true});
    fs.copyFileSync(path.join('dist/library', file), dest);
  }
}
console.log('Chanukah (The Sealed Cruse), Parshas Toldos (The King’s Table), Parshas Vayeira and Parshas Chayei Sarah reader entries, blogs, shiurim (Chayei Sarah also as native text), PDF and Word downloads and discovery links are ready.');

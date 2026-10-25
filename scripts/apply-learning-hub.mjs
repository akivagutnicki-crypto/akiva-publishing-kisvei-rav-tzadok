import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.argv[2]||path.join(repo,'dist'));
const version='20261025-learning-hub-v1';
const homeFile=path.join(root,'index.html');
let html=fs.readFileSync(homeFile,'utf8');
const feature=`<section class="learning-hub" id="learn-online" aria-labelledby="library-feature-title"><div class="wrap learning-hub-grid">
<article class="library-feature"><div class="eyebrow">Learn online · Akiva Publishing</div><h2 id="library-feature-title">Rav Tzadok Library</h2><p class="library-feature-description">Explore the writings of Rav Tzadok HaKohen of Lublin and the Ishbitz–Radzin school. Browse the sefarim, learn from the original Hebrew with English translations where available, and follow linked source notes as you read.</p>
<a class="reader-window" href="library/" aria-label="Preview and open the Rav Tzadok Library"><div class="reader-window-bar"><img src="library/icons/icon.svg" width="30" height="30" alt=""><span>Akiva Publishing<small>The digital Torah library</small></span><span class="reader-window-open" aria-hidden="true">↗</span></div><div class="reader-window-content"><div class="reader-window-label">Inside the library</div><div class="reader-window-row"><span>Tzidkas HaTzaddik</span><span lang="he" dir="rtl">צדקת הצדיק</span></div><div class="reader-window-row"><span>Pri Tzaddik</span><span lang="he" dir="rtl">פרי צדיק</span></div><div class="reader-window-row"><span>Resisei Layla</span><span lang="he" dir="rtl">רסיסי לילה</span></div><div class="reader-window-footer">Kisvei Rav Tzadok · Ishbitz–Radzin · Torah sources</div></div></a>
<div class="library-feature-bottom"><a class="btn dark" href="library/">Open the Rav Tzadok Library →</a><span>Browse sefarim · Search teachings · Follow sources</span></div></article>
<aside class="weekly-side" id="blog" aria-labelledby="blog-title"><div class="eyebrow">Latest Weekly Torah</div><div class="weekly-side-date">Parshas Lech Lecha 5787 · October 19, 2026</div><a class="weekly-side-title-link" href="library/blog/the-dew-of-your-youth/"><div class="weekly-side-he" lang="he" dir="rtl">לְךָ טַל יַלְדֻתֶךָ</div><h3 id="blog-title">The Dew of Your Youth</h3></a><p>Rav Tzadok on teshuvah, Avraham’s rescue of Lot, and the spark that draws a Jew home—from the Kotel to the darkness of captivity.</p><div class="weekly-side-actions"><a class="btn dark" href="library/blog/the-dew-of-your-youth/">Read the article →</a><div class="weekly-side-downloads"><a href="library/blog/pdfs/the-dew-of-your-youth-lech-lecha.pdf" target="_blank" rel="noopener">Read PDF ↗</a><a href="library/blog/pdfs/the-dew-of-your-youth-lech-lecha.pdf" download>Download PDF ↓</a><a href="library/blog/docs/the-dew-of-your-youth-lech-lecha.docx" download>Download Word ↓</a></div><a class="weekly-side-more" href="library/blog/">More from Weekly Torah →</a></div></aside>
</div></section>`;
if(html.includes('<section class="learning-hub"')){
  html=html.replace(/<section class="learning-hub"[\s\S]*?<\/section>/,feature);
}else{
  assert.equal((html.match(/<section class="blog-feature"/g)||[]).length,1,'Expected the current Weekly Torah feature');
  html=html.replace(/<section class="blog-feature"[\s\S]*?<\/section>/,feature);
}
const stylesheet=`<link rel="stylesheet" href="editions/learning-hub.css?v=${version}">`;
if(!html.includes(stylesheet))html=html.replace('</head>',stylesheet+'\n</head>');
html=html.replace('>Read the texts online →</a>','>Rav Tzadok Library →</a>');
fs.writeFileSync(homeFile,html);
if(path.resolve(root,'editions')!==path.resolve(repo,'dist/editions')){
  fs.copyFileSync(path.join(repo,'dist/editions/learning-hub.css'),path.join(root,'editions/learning-hub.css'));
}
console.log('Applied '+version+': descriptive library window and compact article at the side.');

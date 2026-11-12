import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.argv[2]||path.join(repo,'dist'));
const source=path.join(repo,'dist/editions');
const catalog=JSON.parse(fs.readFileSync(path.join(source,'print-refresh.json'),'utf8'));
const proof=JSON.parse(fs.readFileSync(path.join(source,'print-refresh-provenance.json'),'utf8'));
const version=catalog.version;
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
assert.equal(catalog.books.length,4);
for(const b of catalog.books){
 const p=proof.samples.find(p=>p.slug===b.slug);
 assert(p?.all_pages_pixel_identical&&p.sample_pages===20&&b.samplePages===20);
 assert.equal(p.source_pages,b.pageCount);
}
const section=(html,id,content)=>{
 const re=new RegExp('<section\\b[^>]*\\bid="'+id+'"[^>]*>[\\s\\S]*?<\\/section>');
 assert(re.test(html),'Missing section: '+id);
 return html.replace(re,content);
};
const style=(html,prefix)=>html.replace(/\s*<link rel="stylesheet" href="[^" ]*editions\/print-refresh\.css[^\"]*">/g,'').replace('</head>',`<link rel="stylesheet" href="${prefix}editions/print-refresh.css?v=${version}">\n</head>`);
const formats=b=>b.status==='available'?`<div class="dover-format-links"><a href="${esc(b.hardcover)}" target="_blank" rel="noopener noreferrer">${b.amazonLinkType==='series'?'Browse hardcovers on Amazon':'Hardcover'} ↗</a><a href="${esc(b.paperback)}" target="_blank" rel="noopener noreferrer">${b.amazonLinkType==='series'?'Browse paperbacks on Amazon':'Paperback'} ↗</a></div>`:'<p class="release-status">Coming soon · Preview now</p>';
const card=b=>`<article class="dover-volume" id="${b.slug}"><button class="dover-cover zoom" type="button" data-img="editions/${b.front}" data-label="${esc(b.title)} · final cover" aria-label="Enlarge ${esc(b.title)} cover"><img src="editions/${b.front}" alt="${esc(b.title)} · ${esc(b.subtitle)} · final cover" width="1008" height="1440" loading="lazy" decoding="async"></button><div class="dover-volume-copy"><div class="eyebrow">${b.pageCount} pages · Hebrew–English</div><h3>${esc(b.title)}</h3><p class="dover-scope">${esc(b.scope)}</p><p>${esc(b.description)}</p>${formats(b)}<a class="dover-sample-link" href="editions/sample.html?book=${b.slug}">Read 20-page sample →</a><div class="dover-volume-extras"><a href="editions/${b.pdf}" download>Download sample PDF ↓</a><button class="zoom" type="button" data-img="editions/${b.back}" data-label="${esc(b.title)} · final back cover">View back cover</button></div></div></article>`;
const takanas=catalog.books.filter(b=>b.slug.startsWith('takanas-'));
const shemos=catalog.books.filter(b=>b.slug.startsWith('pri-tzaddik-shemos-'));
const takanasFeature=`<section class="print-refresh" id="takanas" aria-labelledby="takanas-title"><div class="wrap"><div class="section-intro"><div><div class="eyebrow">Available now · Updated two-volume edition</div><h2 id="takanas-title">Takanas HaShavin</h2></div><p>Rav Tzadok on the power of teshuvah to transform. The complete fifteen-siman work, with vocalized Hebrew, phrase-by-phrase English, and annotated sources. Volume I contains the Introduction and Simanim 1–10; Volume II contains Simanim 11–15.</p></div><div class="dover-volume-grid">${takanas.map(card).join('\n')}</div><p class="sample-note">Explore twenty actual pages from each updated interior. Read in the page viewer or download the PDF.</p></div></section>`;
const shemosFeature=`<section class="print-refresh" id="pri-tzaddik-shemos" aria-labelledby="shemos-title"><div class="wrap"><div class="section-intro"><div><div class="eyebrow">Available now on Amazon · The burgundy parsha series</div><h2 id="shemos-title">Pri Tzaddik<br>Sefer Shemos</h2></div><p>From the darkness of Egypt to the revelation at Sinai, and from the laws of Mishpatim to the completed Mishkan. Explore both published volumes, with the original Hebrew, interlinear English, and annotated footnotes together on the page.</p></div><p class="edition-history">Pri Tzaddik is drawn chiefly from Rav Tzadok’s teachings at his Shabbos and Yom Tov tishen, recorded afterward by his talmidim and published after his passing.</p><div class="dover-volume-grid">${shemos.map(card).join('\n')}</div><p class="sample-note">These previews come from the final 392-page and 351-page interiors. Each PDF preserves twenty original pages, including their source notes and printed page numbers.</p></div></section>`;
const preview=`<section class="previews" id="preview" aria-labelledby="print-refresh-samples"><div class="wrap"><div class="preview-head"><div><div class="eyebrow">Inside Takanas HaShavin</div><h2 id="print-refresh-samples">Open the sefer.</h2></div><p>Actual pages from the updated interiors. Tap either page to enlarge it, or choose a complete 20-page sample.</p></div><div class="pages"><button class="page zoom" type="button" data-img="editions/${takanas[0].pageDirectory}/page-03.webp" data-label="Takanas HaShavin, Volume I · Introduction · original page 4"><img src="editions/${takanas[0].pageDirectory}/page-03.webp" alt="Actual Introduction page from updated Takanas HaShavin Volume I" loading="lazy"><span>Volume I · Introduction · Page 4</span></button><button class="page zoom" type="button" data-img="editions/${takanas[1].pageDirectory}/page-03.webp" data-label="Takanas HaShavin, Volume II · Siman 11 · original page 4"><img src="editions/${takanas[1].pageDirectory}/page-03.webp" alt="Actual Siman 11 page from updated Takanas HaShavin Volume II" loading="lazy"><span>Volume II · Siman 11 · Page 4</span></button><button class="page zoom" type="button" data-img="editions/${takanas[0].front}" data-label="Takanas HaShavin, Volume I · updated cover"><img src="editions/${takanas[0].front}" alt="Updated Takanas HaShavin Volume I cover, Introduction and Simanim 1-10" loading="lazy"><span>Volume I · Updated edition</span></button></div><div class="preview-bottom"><a class="textlink" href="editions/sample.html?book=${takanas[0].slug}">Read Volume I sample →</a><a class="textlink" href="editions/sample.html?book=${takanas[1].slug}">Read Volume II sample →</a></div></div></section>`;
const shelf=[
 ...takanas.map(b=>[b.title,b.subtitle,'editions/'+b.front,'#'+b.slug,false]),
 ['Tzidkas HaTzaddik','Volume I','editions/tzidkas-hatzaddik-volume-i-front.webp','#tzidkas-hatzaddik-volume-i',false],
 ['Tzidkas HaTzaddik','Volume II','editions/tzidkas-hatzaddik-volume-ii-front.webp','#tzidkas-hatzaddik-volume-ii',false],
 ['Pri Tzaddik','Rosh Chodesh to Tu BiShvat','editions/pri-tzaddik-rosh-chodesh-front.webp','#pri-tzaddik-rosh-chodesh',false],
 ['Pri Tzaddik','Kedushas Shabbos & Shevisas Shabbos','editions/pri-tzaddik-shabbos-front.webp','#pri-tzaddik-shabbos',false],
 ['The Livyasan and Shavuos','Bilingual edition','livyasan-cover.jpg','#livyasan',false],
 ['Resisei Layla','Volume I','resisei-volume-i-front-original.webp','#resisei',false],
 ['Resisei Layla','Volume II','resisei-volume-ii-front-original.webp','#resisei',false],
 ['Dover Tzedek','Volume I','editions/dover-tzedek-volume-i-front.webp','#dover-tzedek-volume-i',false],
 ['Dover Tzedek','Volume II','editions/dover-tzedek-volume-ii-front.webp','#dover-tzedek-volume-ii',false],
 ...shemos.map(b=>['Pri Tzaddik: Shemos',b.subtitle+' · '+(b.slug.endsWith('-ii')?'Volume II':'Volume I'),'editions/'+b.front,'#'+b.slug,false])
];
const collection=`<section class="collection collection-current" id="collection" aria-labelledby="collection-title"><div class="wrap collection-copy"><div class="eyebrow">Akiva Publishing · The collection</div><h2 id="collection-title">A growing shelf of Torah.</h2><p>Thirteen published sefarim, including both <em>Pri Tzaddik: Sefer Shemos</em> volumes. Explore the updated <em>Takanas HaShavin</em>, <em>Tzidkas HaTzaddik</em>, <em>Pri Tzaddik</em>, <em>Resisei Layla</em>, <em>Dover Tzedek</em>, and <em>The Livyasan and Shavuos</em>. Select any cover to learn more.</p></div><div class="wrap"><div class="catalog-shelf" aria-label="The complete thirteen-book collection, including both published Shemos volumes">${shelf.map(([title,sub,img,href,soon])=>`<article class="shelf-book"><a class="shelf-cover" href="${href}" aria-label="Explore ${esc(title+': '+sub)}${soon?' (coming soon)':''}"><img src="${img}" alt="${esc(title+': '+sub)}" width="700" height="1000" loading="lazy" decoding="async"></a><a class="shelf-name" href="${href}">${esc(title)}<br>${esc(sub)}${soon?'<span class="shelf-badge">Coming soon</span>':''}</a></article>`).join('')}</div></div></section>`;
const homeFile=path.join(root,'index.html');
let home=fs.readFileSync(homeFile,'utf8');
home=home.replaceAll('New and upcoming · Explore Pri Tzaddik','Now available · Explore Pri Tzaddik').replace(/<a class="hero-release-link" href="#pri-tzaddik-shemos">(?:Coming soon: Sefer Shemos · Preview both volumes|Now on Amazon: Sefer Shemos · Explore both volumes) →<\/a>/g,'');
home=section(home,'takanas',takanasFeature);
home=section(home,'preview',preview);
home=section(home,'collection',collection);
home=home.replace(/<section\b[^>]*\bid="pri-tzaddik-shemos"[^>]*>[\s\S]*?<\/section>\s*/,'');
home=home.replace('<!-- tzidkas-hatzaddik-start -->',shemosFeature+'\n<!-- tzidkas-hatzaddik-start -->');
assert(home.includes('id="pri-tzaddik-shemos"'),'Shemos feature missing');
home=style(home,'');
home=home.replace(/<a href="#pri-tzaddik-shemos">Shemos previews<\/a>/g,'').replace('<a href="#tzidkas">','<a href="#pri-tzaddik-shemos">Shemos previews</a><a href="#tzidkas">');
home=home.replace('Just published · Two new Pri Tzaddik editions ↓','Now available · Explore Pri Tzaddik ↓');
home=home.replaceAll('<a class="hero-release-link" href="#pri-tzaddik-shemos">Now on Amazon: Sefer Shemos · Explore both volumes →</a>','');
home=home.replace('<div class="hero-note">Phrase-by-phrase English · Original Hebrew · Annotated sources</div>','<div class="hero-note">Phrase-by-phrase English · Original Hebrew · Annotated sources</div><a class="hero-release-link" href="#pri-tzaddik-shemos">Now on Amazon: Sefer Shemos · Explore both volumes →</a>');
fs.writeFileSync(homeFile,home);

const readerFile=path.join(root,'library/index.html');
let reader=fs.readFileSync(readerFile,'utf8');
const shopCard=b=>`<section class="shop-group shop-new${b.status==='upcoming'?' shop-upcoming':''}" data-edition="${b.slug}"><h3><span class="shop-new-badge">${b.status==='upcoming'?'Coming soon':'Updated edition'}</span><br>${esc(b.title)}</h3><div class="shop-book"><img loading="lazy" decoding="async" src="../editions/${b.front}" alt="${esc(b.title+': '+b.subtitle)}"><div><div class="book-name">${esc(b.scope)}</div>${b.status==='available'?`<div class="formats"><a href="${esc(b.hardcover)}" target="_blank" rel="noopener noreferrer">${b.amazonLinkType==='series'?'Browse hardcovers on Amazon':'Hardcover'} ↗</a><a href="${esc(b.paperback)}" target="_blank" rel="noopener noreferrer">${b.amazonLinkType==='series'?'Browse paperbacks on Amazon':'Paperback'} ↗</a></div>`:''}<div class="formats"><a class="sample-link" href="editions/sample.html?book=${b.slug}">Read 20-page sample →</a><a href="../editions/${b.pdf}" download>Download sample PDF ↓</a></div><p class="book-format-note">${b.pageCount} pages${b.status==='upcoming'?' · Coming soon':''}</p></div></div><p class="shop-description">${esc(b.description)}</p></section>`;
const oldTakanas=/<section class="shop-group"><h3>Takanas HaShavin · Two Volumes<\/h3>[\s\S]*?<\/section>/;
if(oldTakanas.test(reader))reader=reader.replace(oldTakanas,takanas.map(shopCard).join('\n'));
for(const b of catalog.books){
 const re=new RegExp('<section class="shop-group[^\"]*" data-edition="'+b.slug+'">[\\s\\S]*?<\\/section>');
 if(re.test(reader))reader=reader.replace(re,shopCard(b));
 else if(b.status==='upcoming')reader=reader.replace('<section class="shop-group"><h3>Resisei Layla · Two Volumes</h3>',shopCard(b)+'\n<section class="shop-group"><h3>Resisei Layla · Two Volumes</h3>');
 else assert.fail('Missing Takanas bookshop card');
}
reader=style(reader,'../');
reader=reader.replace(/<p class="shop-intro">[\s\S]*?<\/p>/,'<p class="shop-intro">Explore the latest printed sefarim and preview both published Pri Tzaddik: Sefer Shemos volumes.</p>');
fs.writeFileSync(readerFile,reader);

let sw=fs.readFileSync(path.join(root,'library/sw.js'),'utf8');
if(!sw.includes(version))sw=sw.replace(/const SHELL = `([^`]+)`;/,(_,v)=>'const SHELL = `'+v+'-'+version+'`;');
fs.writeFileSync(path.join(root,'library/sw.js'),sw);
if(path.resolve(source)!==path.resolve(root,'editions'))fs.cpSync(source,path.join(root,'editions'),{recursive:true});
const viewer=fs.readFileSync(path.join(source,'sample.html'),'utf8')
 .replace('<body>','<body data-asset-base="../../editions/">')
 .replaceAll('href="sample.css?','href="../../editions/sample.css?')
 .replaceAll('src="sample.js?','src="../../editions/sample.js?')
 .replaceAll('href="../#new-books"','href="../../#new-books"')
 .replaceAll('src="../library/icons/icon.svg"','src="../icons/icon.svg"')
 .replaceAll('href="../library/"','href="../"')
 .replace(/href="((?:pri-tzaddik|takanas-hashavin|tzidkas-hatzaddik|dover-tzedek)[^\"]*\.pdf)"/g,'href="../../editions/$1"');
fs.mkdirSync(path.join(root,'library/editions'),{recursive:true});
fs.writeFileSync(path.join(root,'library/editions/sample.html'),viewer);
console.log('Applied '+version+': current Takanas covers and divisions, thirteen-book shelf, and four original 20-page samples.');


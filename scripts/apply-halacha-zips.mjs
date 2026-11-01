// Add the Halacha ZIP downloads (Sefaria, TorahLM, Halachipedia) to the reader's ZIP page.
// The archives themselves live on the repository's GitHub Release; the reader links to them.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist';
const library = path.join(root, 'library');
const version = '20261101-halacha-zips-v1';
const once = (text, before, after, label) => {
  assert.equal(text.split(before).length - 1, 1, `Unexpected ${label} anchor count`);
  return text.replace(before, after);
};

const indexPath = path.join(library, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/halacha-zips\.js\?v=[\w-]+/g, `halacha-zips.js?v=${version}`);
if (!html.includes('id="halachaZips"')) {
  html = once(html, '</head>', `<script src="halacha-zips.js?v=${version}"></script>\n</head>`, 'head');
  html = once(html, '      <div class="packs" id="corpusPacks"></div>\n    </section>\n',
    '      <div class="packs" id="corpusPacks"></div>\n    </section>\n' +
    '    <section class="app-card corpus-downloads halacha-downloads" aria-label="Halacha ZIP downloads">\n' +
    '      <h2>Halacha · the whole package</h2>\n' +
    '      <p>Shulchan Arukh, Mishneh Torah, Tur and the poskim with their meforshim, in three ZIPs: Sefaria’s complete public source files, the same library as Markdown from TorahLM, and Halachipedia. The files are large, so check your device’s free space first.</p>\n' +
    '      <div class="packs" id="halachaZips"></div>\n' +
    '    </section>\n', 'Halacha section');
  html = once(html, '  setupCorpusCards();\n',
    '  setupCorpusCards();\n  window.AkivaHalachaZips?.render(document.getElementById(\'halachaZips\'));\n', 'Halacha render');
}
fs.writeFileSync(indexPath, html);

const swPath = path.join(library, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('-' + version)) sw = sw.replace(/(const SHELL = `[^`]+)(`;)/, `$1-${version}$2`);
assert(sw.includes('-' + version), 'Service worker shell version not updated');
fs.writeFileSync(swPath, sw);

if (path.resolve(root) !== path.resolve('dist')) {
  for (const file of ['halacha-zips.js', 'downloads/halacha/index.json']) {
    const dest = path.join(library, file);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.copyFileSync(path.join('dist/library', file), dest);
  }
}
console.log('Halacha ZIP downloads added to the reader.');

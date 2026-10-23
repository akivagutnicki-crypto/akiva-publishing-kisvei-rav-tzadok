// Add the Ois 16 media card without replacing generated text or footnote editions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const library = process.argv[2] || 'dist/library';
const version = '20261022-divrei16-media';
const oldQuery = 'shiur-player.js?v=20261016-compact-noach-audio';
const newQuery = `shiur-player.js?v=${version}`;
const previewQuery = 'divrei16-preview.js?v=20261022-divrei16-page-preview-v1';
const count = (text, anchor) => text.split(anchor).length - 1;
const replaceOnce = (text, before, after, label) => {
  assert.equal(count(text, before), 1, `Unexpected ${label} anchor count`);
  return text.replace(before, after);
};
const updateQuery = (text, label) => {
  if (text.includes(oldQuery)) return replaceOnce(text, oldQuery, newQuery, label);
  assert.equal(count(text, newQuery), 1, `Missing ${label} player query`);
  return text;
};

const indexFile = path.join(library, 'index.html');
let index = fs.readFileSync(indexFile, 'utf8');
const sectionAnchor = "} else if (d.sectionRef === 'Divrei Soferim 16') {";
const oldMediaBlock = `} else if (d.sectionRef === 'Divrei Soferim 16') {
    html += \`<div class="noach6-media divrei16-media">\${shiurMarkup}
      <details class="noach6-pdf divrei16-pdf">
        <summary>📄 Preview the shiur transcript · PDF</summary>
        <iframe title="Preview Divrei Soferim Ois 16 Lech Lecha shiur transcript" loading="lazy"
          src="downloads/divrei-soferim-ois-16-lech-lecha-shiur.pdf#toolbar=0&navpanes=0"></iframe>
        <a class="btn" target="_blank" rel="noopener noreferrer"
          href="downloads/divrei-soferim-ois-16-lech-lecha-shiur.pdf">Open or download PDF ↗</a>
        <a class="btn" href="downloads/divrei-soferim-ois-16-lech-lecha-shiur.docx" download>Download Word transcript ↓</a>
      </details>
    </div>\`;
  } else html += shiurMarkup;`;
const mediaBlock = `} else if (d.sectionRef === 'Divrei Soferim 16') {
    html += \`<div class="noach6-media divrei16-media">\${shiurMarkup}
      <details class="noach6-pdf divrei16-pdf">
        <summary>📄 Preview the shiur transcript · 9 pages</summary>
        <div class="divrei16-preview" aria-label="Divrei Soferim Ois 16 transcript preview">
          <div class="divrei16-preview-toolbar" role="group" aria-label="Transcript page controls">
            <button class="btn" type="button" data-preview-action="previous" aria-label="Previous transcript page" disabled>← Previous</button>
            <span class="divrei16-page-count" role="status" aria-live="polite">Page 1 of 9</span>
            <button class="btn" type="button" data-preview-action="next" aria-label="Next transcript page">Next →</button>
            <button class="btn" type="button" data-preview-action="zoom-out" aria-label="Zoom out transcript" disabled>−</button>
            <span class="divrei16-zoom-label" aria-label="Zoom relative to fit width">100%</span>
            <button class="btn" type="button" data-preview-action="zoom-in" aria-label="Zoom in transcript">+</button>
            <button class="btn" type="button" data-preview-action="fit">Fit width</button>
          </div>
          <p class="divrei16-preview-hint">Enlarge the page with zoom, then scroll within the preview to read.</p>
          <p class="divrei16-preview-status" role="status" aria-live="polite">The preview loads when opened.</p>
          <button class="btn" type="button" data-preview-action="retry" hidden>Retry preview</button>
          <div class="divrei16-page-viewport" role="region" tabindex="0" aria-label="Transcript page; scroll to read the enlarged page">
            <img class="divrei16-page-image" alt="Divrei Soferim Ois 16 shiur transcript, page 1 of 9" decoding="async" hidden>
          </div>
        </div>
        <a class="btn" target="_blank" rel="noopener noreferrer"
          href="downloads/divrei-soferim-ois-16-lech-lecha-shiur.pdf">Open or download PDF ↗</a>
        <a class="btn" href="downloads/divrei-soferim-ois-16-lech-lecha-shiur.docx" download>Download Word transcript ↓</a>
      </details>
    </div>\`;
  } else html += shiurMarkup;`;
const previewStyles = `/* Divrei Soferim Ois 16 transcript page preview */
.divrei16-preview{margin-top:10px;min-width:0;color:var(--ink);font:400 .85rem/1.4 var(--ui)}
.divrei16-preview-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.divrei16-preview-toolbar .btn{margin:0;min-height:40px;min-width:40px}
.divrei16-preview-toolbar .btn:disabled{opacity:.45;cursor:default}
.divrei16-page-count,.divrei16-zoom-label{font-variant-numeric:tabular-nums;white-space:nowrap}
.divrei16-preview-hint,.divrei16-preview-status{margin:8px 0;font-size:.78rem;color:var(--muted)}
.divrei16-page-viewport{overflow:auto;max-height:min(70vh,680px);min-height:180px;margin-top:8px;border:1px solid var(--line);border-radius:5px;background:#fff;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;direction:ltr}
.divrei16-page-image{display:block;width:100%;max-width:none!important;height:auto;margin:0}
.divrei16-page-image[hidden],.divrei16-preview [hidden]{display:none!important}
.divrei16-preview :focus-visible{outline:2px solid var(--brass);outline-offset:2px}
`;
assert.equal(count(index, "if (d.sectionRef === 'Peri Tzadik, Noach 6') {"), 1,
  'The existing Noach Ois 6 media card is missing or ambiguous');
if (!index.includes(sectionAnchor)) {
  index = replaceOnce(index, '} else html += shiurMarkup;', mediaBlock, 'shiur fallback');
} else if (index.includes(oldMediaBlock)) {
  index = replaceOnce(index, oldMediaBlock, mediaBlock, 'previous Ois 16 PDF preview');
} else {
  assert.equal(count(index, mediaBlock), 1, 'An unexpected Ois 16 media card is already present');
}
index = updateQuery(index, 'reader');
if (!index.includes(previewStyles)) {
  assert(!index.includes('/* Divrei Soferim Ois 16 transcript page preview */'), 'Unexpected existing preview styles');
  index = replaceOnce(index, '.shiur-host-note{', previewStyles + '.shiur-host-note{', 'preview style');
}
const previewScript = `<script src="${previewQuery}"></script>`;
if (!index.includes(previewScript)) {
  assert(!index.includes('divrei16-preview.js'), 'Unexpected existing preview module');
  const playerScript = `<script src="${newQuery}"></script>`;
  index = replaceOnce(index, playerScript, playerScript + '\n' + previewScript, 'preview script');
}
const mountAnchor = '  if (audioCleanup) cleanupFns.push(audioCleanup);';
const previewMount = '  const transcriptCleanup = window.AkivaDivrei16Preview?.mount(sec);\n  if (transcriptCleanup) cleanupFns.push(transcriptCleanup);';
if (!index.includes(previewMount)) {
  assert(!index.includes('AkivaDivrei16Preview'), 'Unexpected existing preview mount');
  index = replaceOnce(index, mountAnchor, mountAnchor + '\n' + previewMount, 'preview mount');
}

const swFile = path.join(library, 'sw.js');
let sw = fs.readFileSync(swFile, 'utf8');
sw = updateQuery(sw, 'service worker');
if (!sw.includes(previewQuery)) {
  assert(!sw.includes('divrei16-preview.js'), 'Unexpected existing preview cache entry');
  sw = replaceOnce(sw, `'./${newQuery}',`, `'./${newQuery}', './${previewQuery}',`, 'preview cache');
} else assert.equal(count(sw, previewQuery), 1, 'Repeated preview cache entry');
const shells = [...sw.matchAll(/const SHELL = `([^`]+)`;/g)];
assert.equal(shells.length, 1, 'Unexpected service-worker shell definition');
const shell = shells[0];
const suffix = '-divrei16-media-20261022';
const previewSuffix = '-divrei16-page-preview-20261022';
if (!shell[1].includes(suffix)) {
  sw = replaceOnce(sw, shell[0], `const SHELL = \`${shell[1]}${suffix}\`;`, 'service-worker shell');
} else {
  assert.equal(count(shell[1], suffix), 1, 'Repeated Ois 16 shell suffix');
}
const updatedShell = [...sw.matchAll(/const SHELL = `([^`]+)`;/g)][0];
if (!updatedShell[1].includes(previewSuffix)) {
  sw = replaceOnce(sw, updatedShell[0], `const SHELL = \`${updatedShell[1]}${previewSuffix}\`;`, 'preview shell');
} else assert.equal(count(updatedShell[1], previewSuffix), 1, 'Repeated preview shell suffix');
fs.writeFileSync(indexFile, index);
fs.writeFileSync(swFile, sw);
console.log('Applied Divrei Soferim Ois 16 media card and player refresh; all other reader content retained.');

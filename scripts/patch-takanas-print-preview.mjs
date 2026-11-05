// Bounded homepage overlay for the exact corrected Takanas print preview.
// Public URLs remain stable; each cache key identifies the replacement bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const SOURCE = fileURLToPath(new URL('../sources/akiva/overlays/takanas-docx-master-20261102-preview/', import.meta.url));
const PROVENANCE = JSON.parse(fs.readFileSync(path.join(SOURCE, 'provenance.json'), 'utf8'));

export const TAKANAS_PRINT_PREVIEW_ASSETS = Object.freeze(PROVENANCE.assets.map(asset => Object.freeze({
  sourceFile: asset.source_file,
  publicPaths: Object.freeze([...asset.public_paths]),
  sha256: asset.sha256,
  bytes: asset.bytes,
  cacheKey: asset.sha256.slice(0, 12)
})));

export function verifyTakanasPrintPreviewSources() {
  for (const asset of TAKANAS_PRINT_PREVIEW_ASSETS) {
    const bytes = fs.readFileSync(path.join(SOURCE, asset.sourceFile));
    assert.equal(bytes.length, asset.bytes, 'Takanas preview source size drift: ' + asset.sourceFile);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256,
      'Takanas preview source hash drift: ' + asset.sourceFile);
  }
  return TAKANAS_PRINT_PREVIEW_ASSETS;
}

function changeLiteralOnce(html, before, after) {
  const oldCount = html.split(before).length - 1;
  const newCount = html.split(after).length - 1;
  assert((oldCount === 1 && newCount === 0) || (oldCount === 0 && newCount === 1),
    'Unexpected Takanas range literal: ' + before);
  return oldCount ? html.replace(before, after) : html;
}

function patchSection(html, id, patch) {
  const startPattern = new RegExp('<section\\b[^>]*\\bid=["\\\']' + id + '["\\\'][^>]*>', 'g');
  const matches = [...html.matchAll(startPattern)];
  assert.equal(matches.length, 1, 'Expected one homepage section: ' + id);
  const start = matches[0].index;
  const end = html.indexOf('</section>', start);
  assert(end >= 0, 'Missing homepage section close: ' + id);
  const last = end + '</section>'.length;
  return html.slice(0, start) + patch(html.slice(start, last)) + html.slice(last);
}

function cachePreviewAttributes(block) {
  const assets = new Map(TAKANAS_PRINT_PREVIEW_ASSETS.flatMap(asset =>
    asset.publicPaths.map(publicPath => [publicPath, asset])));
  return block.replace(/\b(href|src|data-img)=(['"])([^'"]+)\2/g, (whole, attribute, quote, value) => {
    const publicPath = value.split(/[?#]/, 1)[0];
    const asset = assets.get(publicPath);
    return asset ? `${attribute}=${quote}${publicPath}?v=${asset.cacheKey}${quote}` : whole;
  });
}

const SHOP_RANGE_PATHS = new Set([
  'library/index.html',
  'library/blog/index.html',
  'library/blog/the-alchemy-of-the-soul/index.html'
]);

const SHOP_RANGE_LITERALS = [
  ['alt="Volume I · Hakdamah and Simanim 1–9 cover"',
    'alt="Volume I · Hakdamah and Simanim 1–10 cover"'],
  ['class="book-name">Volume I · Hakdamah and Simanim 1–9<',
    'class="book-name">Volume I · Hakdamah and Simanim 1–10<'],
  ['alt="Volume II · Simanim 10–15 cover"',
    'alt="Volume II · Simanim 11–15 cover"'],
  ['class="book-name">Volume II · Simanim 10–15<',
    'class="book-name">Volume II · Simanim 11–15<']
];

// The root homepage ranges are handled only by patchTakanasPrintPreview.
// Every other path is deliberately returned unchanged.
export function patchTakanasEditionRanges(html, publicPath) {
  assert.equal(typeof html, 'string');
  assert.equal(typeof publicPath, 'string');
  if (!SHOP_RANGE_PATHS.has(publicPath)) return html;
  if (html.includes('data-edition="takanas-hashavin-volume-i"')) {
    assert(html.includes('data-edition="takanas-hashavin-volume-ii"'));
    assert(html.includes('Introduction (Hakdamah) and Simanim 1-10'));
    assert(html.includes('Simanim 11-15, completing the work'));
    return html;
  }
  assert(html.includes('Takanas%20HaShavin'), 'Expected Takanas shop panel: ' + publicPath);
  for (const [before, after] of SHOP_RANGE_LITERALS) html = changeLiteralOnce(html, before, after);
  return html;
}

export function patchTakanasPrintPreview(html) {
  assert.equal(typeof html, 'string');
  verifyTakanasPrintPreviewSources();
  if (html.includes('id="print-refresh-samples"')) {
    for (const volume of ['i', 'ii']) {
      assert(html.includes('editions/sample.html?book=takanas-hashavin-volume-' + volume));
      assert(html.includes('editions/takanas-hashavin-volume-' + volume + '-sample.pdf'));
    }
    assert(html.includes('Volume I contains the Introduction and Simanim 1–10; Volume II contains Simanim 11–15.'));
    return html;
  }
  html = patchSection(html, 'takanas', block => {
    block = changeLiteralOnce(block,
      'Introduction (Hakdamah) and Simanim 1–9',
      'Introduction (Hakdamah) and Simanim 1–10');
    block = changeLiteralOnce(block,
      'Simanim 10–15, completing the work',
      'Simanim 11–15, completing the work');
    assert.equal((block.match(/href=["']Takanas_HaShavin_Volume_I_Siman_Aleph\.pdf(?:\?[^"']*)?["']/g) || []).length, 1);
    return cachePreviewAttributes(block);
  });
  html = patchSection(html, 'preview', block => {
    assert(block.includes('Inside Takanas HaShavin'), 'Unexpected homepage preview section');
    assert.equal((block.match(/href=["']Takanas_HaShavin_Volume_I_Siman_Aleph\.pdf(?:\?[^"']*)?["']/g) || []).length, 1);
    for (const image of ['sample-page.png', 'sample-text-page.png']) {
      assert.equal((block.match(new RegExp('(?:src|data-img)=["\\\']' + image.replaceAll('.', '\\.') + '(?:\\?[^"\\\']*)?["\\\']', 'g')) || []).length, 2,
        'Expected display and zoom attributes for ' + image);
    }
    return cachePreviewAttributes(block);
  });
  return html;
}

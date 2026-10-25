// Keep legacy inline annotations out of local source previews. The stored
// manuscript and its footnotes remain untouched and available in the reader.
import assert from 'node:assert/strict';

export const sourcePreviewHelper = String.raw`function sourceAuthorHTML(html) {
  const value = String(html || '');
  if (!/\bclass\s*=\s*["'][^"']*\bfootnote(?:-marker)?\b/i.test(value)) return value;
  const template = document.createElement('template');
  template.innerHTML = value;
  template.content.querySelectorAll('.footnote,.footnote-marker').forEach(node => node.remove());
  return template.innerHTML;
}
`;

const functionStart = 'async function sourceTextData(link) {';
const previousPair = "        pairs.push([hs[i] || '', es[i] || '']);";
const correctedPair = '        pairs.push([sourceAuthorHTML(hs[i]), sourceAuthorHTML(es[i])]);';

export function patchLocalSourcePreview(html) {
  assert.equal(typeof html, 'string');
  if (html.includes(sourcePreviewHelper)) {
    assert.equal(html.split(sourcePreviewHelper).length, 2, 'Duplicate source-preview helper');
    assert.equal(html.split(correctedPair).length, 2, 'Source-preview call differs');
    assert(!html.includes(previousPair), 'Old source-preview extraction remains');
    return html;
  }
  assert(!html.includes('function sourceAuthorHTML('), 'Unknown source-preview implementation');
  assert.equal(html.split(functionStart).length, 2, 'Source-preview function changed');
  assert.equal(html.split(previousPair).length, 2, 'Local source-preview insertion changed');
  return html.replace(functionStart, sourcePreviewHelper + functionStart)
    .replace(previousPair, correctedPair);
}

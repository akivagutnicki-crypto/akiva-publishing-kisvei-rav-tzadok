import assert from 'node:assert/strict';

// The printed KDP sections are navigation targets within the existing Reader
// paragraphs. Keep all saved references and text files stable.
export function patchTakanasSeifNavigation(html) {
  const marker = 'function renderLocalNode(node, isRoot) {';
  assert.equal(html.split(marker).length, 2, 'Reader TOC insertion point changed');
  assert(!html.includes('function renderKdpSeifContents('), 'KDP navigation already installed');
  const helper = `function renderKdpSeifContents(node) {
  const entries = node.children.map(siman => {
    const title = '<a class="kdp-siman-title" href="#/read/' + toHash(siman.ref) + '"><span class="en">' + (siman.id ? 'Siman ' + siman.id + ' · ' : '') + esc(siman.en) + '</span><span class="he" lang="he" dir="rtl">' + esc(siman.he) + '</span></a>';
    if (!siman.seifNavigation?.length) return '<div class="toc-kdp-siman">' + title + '</div>';
    const links = siman.seifNavigation.map(entry => '<a data-kdp-seif="' + entry.n + '" data-kdp-siman="' + siman.id + '" href="' + esc(outlineHref({ref:entry.ref,title:entry.headingTitle,phraseIndex:entry.phraseIndex})) + '"><span class="en">' + esc(entry.en) + '</span><span class="he" lang="he" dir="rtl">' + esc(entry.he) + '</span></a>').join('');
    return '<section class="toc-kdp-siman" aria-label="Siman ' + siman.id + '">' + title + '<div class="kdp-seif-links" aria-label="Se’ifim in Siman ' + siman.id + '">' + links + '</div></section>';
  }).join('');
  return '<div class="kdp-seif-contents">' + entries + '</div>';
}
`;
  html = html.replace(marker, helper + marker + `
  if (node.children?.some(siman => siman.seifNavigation?.length)) return renderKdpSeifContents(node);`);
  const style = `<style id="takanas-kdp-seif-navigation">
.toc-kdp-siman{margin:0 0 24px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.kdp-siman-title{display:flex;gap:16px;justify-content:space-between;align-items:center;padding:14px 16px;background:var(--paper);font-weight:600;border-bottom:1px solid var(--line)}
.kdp-siman-title .he{flex-shrink:0}
.kdp-seif-links{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:8px;padding:12px}
.kdp-seif-links a{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:44px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font:500 .88rem/1.4 var(--ui)}
.kdp-seif-links a:hover,.kdp-seif-links a:focus-visible{background:var(--wash);outline:2px solid var(--forest);outline-offset:1px}
.kdp-seif-links .he{font-family:var(--he)}
@media(max-width:500px){.kdp-siman-title{align-items:flex-start;padding:12px}.kdp-seif-links{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px}.kdp-seif-links a{font-size:.82rem;padding:8px}}
</style>`;
  assert(html.includes('</head>'));
  return html.replace('</head>', style + '\n</head>');
}

(function () {
  'use strict';
  const BOOK = 'Akiva Publishing Weekly Torah';
  const REF = BOOK + ', Vayeira Mesiras Nefesh';
  const SOURCES_REF = REF + ' Sources';
  const VERSION = '20261026-vayeira-mesiras-nefesh-v1';
  const PDF = 'downloads/vayeira-akeidah-mesiras-nefesh.pdf';
  const BLOG = 'blog/even-the-world-to-come/';
  const SHIUR = BLOG + 'shiur/';
  const BLOG_PDF = 'blog/pdfs/even-the-world-to-come-vayeira.pdf';
  const BLOG_DOCX = 'blog/docs/even-the-world-to-come-vayeira.docx';
  const SHIUR_PDF = 'downloads/vayeira-mesiras-nefesh-shiur.pdf';
  const SHIUR_DOCX = 'downloads/vayeira-mesiras-nefesh-shiur.docx';
  const AUDIO = {key: 'vayeira-mesiras-nefesh-shiur', src: 'audio/vayeira-mesiras-nefesh-shiur.m4a',
    duration: '1:16:20', bytes: '28.8 MB'};
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
  const SHIUR_PAGES = 38;
  let pending;
  const hash = ref => encodeURIComponent(ref.replace(/ /g, '_'));
  const recognizes = ref => [SOURCES_REF, REF].some(base => ref === base ||
    (ref.startsWith(base + ':') && /^[1-9]\d*$/.test(ref.slice(base.length + 1))));
  async function fetchText(ref) {
    if (!recognizes(ref)) throw new Error('Unknown Vayeira study reference');
    pending ||= fetch('studies/vayeira-mesiras-nefesh.json?v=' + VERSION, {cache: 'no-cache'})
      .then(response => { if (!response.ok) throw new Error('The Vayeira study could not be loaded'); return response.json(); })
      .catch(error => { pending = null; throw error; });
    const data = await pending;
    const base = [SOURCES_REF, REF].find(key => ref === key || ref.startsWith(key + ':'));
    const section = data.sections[base];
    if (!section) throw new Error('The requested Vayeira study section is missing');
    const paragraph = ref === base ? null : Number(ref.slice(base.length + 1));
    if (paragraph !== null && paragraph > section.phrases.length) throw new Error('Study paragraph is out of range');
    return {...section, ref, ...(paragraph ? {highlight: ref} : {})};
  }
  function contents() {
    return '<div class="page weekly-study-contents">' +
      '<div class="crumbs"><a href="#/">Texts</a><span>›</span><a href="blog/">Weekly Torah</a></div>' +
      '<div class="eyebrow">This week · Parshas Vayeira 5787</div>' +
      '<h1>Even the World to Come</h1>' +
      '<p class="lead">Avraham, the Akeidah, and the radical mesiras nefesh of Izhbitz</p>' +
      '<section class="weekly-study-item"><h2>The blog · 12 pages</h2>' +
      '<p>By Akiva Gutnicki, with the Hebrew sources and footnotes.</p>' +
      '<div class="actions"><a class="btn primary" href="' + BLOG + '">Read the blog →</a>' +
      '<a class="btn" href="' + BLOG_PDF + '" download>Download PDF ↓</a>' +
      '<a class="btn" href="' + BLOG_DOCX + '" download>Download Word ↓</a></div></section>' +
      '<section class="weekly-study-item"><h2>The transcribed shiur · 38 pages</h2>' +
      '<p>Mesiras Nefesh: The Deeper Meaning of the Akeidah, in ten parts with its sources in Hebrew and English.</p>' +
      '<div class="actions"><a class="btn primary" href="' + SHIUR + '">Read the shiur →</a>' +
      '<a class="btn" href="' + SHIUR_PDF + '" download>Download PDF ↓</a>' +
      '<a class="btn" href="' + SHIUR_DOCX + '" download>Download Word ↓</a></div></section>' +
      '<section class="weekly-study-item"><h2>The shiur recording · ' + AUDIO.duration + '</h2>' +
      '<p>Listen in the reader, with adjustable speed and your place saved, or download the recording.</p>' +
      '<div class="actions"><a class="btn primary" href="#/read/' + hash(REF) + '">🎧 Listen to the shiur →</a>' +
      '<a class="btn" href="' + AUDIO.src + '" download="vayeira-mesiras-nefesh-shiur.m4a">Download M4A ↓</a></div></section>' +
      '<section class="weekly-study-item"><h2>Dvar Torah and interlinear sources</h2>' +
      '<p>An editorial Dvar Torah drawing on Pri Tzaddik, Beis Yaakov, Mei HaShiloach and other Chassidic sources, followed by fifteen Hebrew–English interlinear source passages.</p>' +
      '<div class="actions"><a class="btn primary" href="#/read/' + hash(REF) + '">Read the Vayeira Dvar Torah →</a>' +
      '<a class="btn" href="#/read/' + hash(SOURCES_REF) + '">Read the fifteen interlinear sources →</a>' +
      '<a class="btn" href="' + PDF + '" target="_blank" rel="noopener">Open the source collection PDF ↗</a>' +
      '<a class="btn" href="' + PDF + '" download>Download PDF ↓</a></div></section></div>';
  }
  function player() {
    return '<aside class="shiur-audio" data-shiur-key="' + AUDIO.key + '" aria-label="Listen to the shiur · Parshas Vayeira · Mesiras Nefesh">' +
      '<h3>🎧 Listen to the Shiur · Parshas Vayeira · Mesiras Nefesh</h3>' +
      '<p class="shiur-audio-meta">The Deeper Meaning of the Akeidah · ' + AUDIO.duration + ' · M4A (' + AUDIO.bytes + ')</p>' +
      '<audio controls preload="none" src="' + AUDIO.src + '" aria-label="Parshas Vayeira shiur, Mesiras Nefesh"></audio>' +
      '<div class="shiur-audio-controls"><label>Speed <select class="shiur-speed" aria-label="Playback speed">' +
      SPEEDS.map(speed => '<option value="' + speed + '"' + (speed === 1 ? ' selected' : '') + '>' + speed + '×' + (speed === 1 ? ' (normal)' : '') + '</option>').join('') +
      '</select></label><label>Volume boost <select class="shiur-boost" aria-label="Volume boost"><option value="1">Normal</option>' +
      '<option value="1.5">1.5×</option><option value="2">2×</option><option value="3">3×</option></select></label>' +
      '<button class="btn shiur-resume" type="button" hidden>Resume</button><button class="btn shiur-restart" type="button">Start over</button></div>' +
      '<p class="shiur-audio-status" role="status" aria-live="polite">Your place is saved automatically in this browser.</p>' +
      '<div class="shiur-audio-actions"><button class="btn shiur-retry" type="button" hidden>Retry audio</button>' +
      '<a class="btn primary" href="' + AUDIO.src + '" download="vayeira-mesiras-nefesh-shiur.m4a">↓ Download M4A</a>' +
      '<a class="btn" href="' + AUDIO.src + '" target="_blank" rel="noopener noreferrer">Open audio ↗</a></div></aside>';
  }
  const PARTS = [['Cover and contents', 1], ['I · What We Usually Mean', 2], ['II · Two Trials, Two Levels', 4],
    ['III · Yitzchak Was His World to Come', 7], ['IV · Giving Up the World to Come', 10], ['V · “Even on That Condition”', 14],
    ['VI · Without a Prize', 19], ['VII · Awe, Love and the Gevurah of Yitzchak', 22], ['VIII · Faith Beyond Understanding', 29],
    ['IX · Nefesh Is Ratzon', 33], ['X · What Is Our Obligation?', 36], ['Index of Sources', 37]];
  const pageSrc = page => SHIUR + 'pages/page-' + String(page).padStart(2, '0') + '.webp';
  function media() {
    return '<div class="noach6-media vayeira-media">' + player() +
      '<details class="noach6-pdf vayeira-transcript"><summary>📄 Preview the shiur transcript · ' + SHIUR_PAGES + ' pages</summary>' +
      '<div class="divrei16-preview" aria-label="Parshas Vayeira shiur transcript preview">' +
      '<div class="divrei16-preview-toolbar" role="group" aria-label="Transcript page controls">' +
      '<button class="btn" type="button" data-preview-action="previous" aria-label="Previous transcript page" disabled>← Previous</button>' +
      '<span class="divrei16-page-count" role="status" aria-live="polite">Page 1 of ' + SHIUR_PAGES + '</span>' +
      '<button class="btn" type="button" data-preview-action="next" aria-label="Next transcript page">Next →</button>' +
      '<button class="btn" type="button" data-preview-action="zoom-out" aria-label="Zoom out transcript" disabled>−</button>' +
      '<span class="divrei16-zoom-label" aria-label="Zoom relative to fit width">100%</span>' +
      '<button class="btn" type="button" data-preview-action="zoom-in" aria-label="Zoom in transcript">+</button>' +
      '<button class="btn" type="button" data-preview-action="fit">Fit width</button>' +
      '<select class="vayeira-part" aria-label="Jump to a part of the shiur">' +
      PARTS.map(([name, page]) => '<option value="' + page + '">' + name + ' · p. ' + page + '</option>').join('') + '</select></div>' +
      '<p class="divrei16-preview-hint">Enlarge the page with zoom, then scroll within the preview to read.</p>' +
      '<p class="divrei16-preview-status" role="status" aria-live="polite">The preview loads when opened.</p>' +
      '<div class="divrei16-page-viewport" role="region" tabindex="0" aria-label="Transcript page; scroll to read the enlarged page">' +
      '<img class="divrei16-page-image" width="1224" height="1584" alt="Mesiras Nefesh, the transcribed shiur, page 1 of ' + SHIUR_PAGES + '" decoding="async"></div></div>' +
      '<a class="btn" href="' + SHIUR + '">Read every page →</a>' +
      '<a class="btn" target="_blank" rel="noopener noreferrer" href="' + SHIUR_PDF + '">Open or download PDF ↗</a>' +
      '<a class="btn" href="' + SHIUR_DOCX + '" download>Download Word transcript ↓</a></details></div>';
  }
  // The reader re-renders sections freely, so the transcript preview is driven by
  // delegated events instead of per-section mounting.
  function showPage(details, page) {
    page = Math.min(Math.max(1, Number(page) || 1), SHIUR_PAGES);
    details.dataset.page = String(page);
    const image = details.querySelector('.divrei16-page-image');
    const status = details.querySelector('.divrei16-preview-status');
    status.textContent = 'Loading page ' + page + '…';
    image.onload = () => { status.textContent = ''; };
    image.onerror = () => { status.textContent = 'This page could not load. Try again, or open the PDF.'; };
    image.src = pageSrc(page);
    image.alt = 'Mesiras Nefesh, the transcribed shiur, page ' + page + ' of ' + SHIUR_PAGES;
    details.querySelector('.divrei16-page-count').textContent = 'Page ' + page + ' of ' + SHIUR_PAGES;
    details.querySelector('[data-preview-action="previous"]').disabled = page === 1;
    details.querySelector('[data-preview-action="next"]').disabled = page === SHIUR_PAGES;
    const part = details.querySelector('.vayeira-part');
    part.value = String(PARTS.filter(([, start]) => start <= page).pop()[1]);
    details.querySelector('.divrei16-page-viewport').scrollTop = 0;
    if (page < SHIUR_PAGES) new Image().src = pageSrc(page + 1);
  }
  function setZoom(details, zoom) {
    zoom = Math.min(3, Math.max(1, Math.round(zoom * 4) / 4));
    details.dataset.zoom = String(zoom);
    details.querySelector('.divrei16-page-image').style.width = (zoom * 100) + '%';
    details.querySelector('.divrei16-zoom-label').textContent = Math.round(zoom * 100) + '%';
    details.querySelector('[data-preview-action="zoom-out"]').disabled = zoom === 1;
    details.querySelector('[data-preview-action="zoom-in"]').disabled = zoom === 3;
  }
  if (typeof document !== 'undefined') {
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (details.matches?.('.vayeira-transcript') && details.open && !details.dataset.page) showPage(details, 1);
  }, true);
  document.addEventListener('click', event => {
    const button = event.target.closest?.('.vayeira-transcript [data-preview-action]');
    if (!button) return;
    const details = button.closest('.vayeira-transcript');
    const page = Number(details.dataset.page || 1), zoom = Number(details.dataset.zoom || 1);
    const action = button.dataset.previewAction;
    if (action === 'previous') showPage(details, page - 1);
    else if (action === 'next') showPage(details, page + 1);
    else if (action === 'zoom-in') setZoom(details, zoom + 0.25);
    else if (action === 'zoom-out') setZoom(details, zoom - 0.25);
    else if (action === 'fit') setZoom(details, 1);
  });
  document.addEventListener('change', event => {
    if (event.target.matches?.('.vayeira-transcript .vayeira-part')) showPage(event.target.closest('.vayeira-transcript'), event.target.value);
  });
  }
  function attachment(d) {
    return media() + extras(d);
  }
  function extras(d) {
    return '<div class="weekly-study-new"><span class="eyebrow">New this week · the blog and the transcribed shiur</span>' +
      '<strong>Even the World to Come</strong><span>The blog and the transcribed shiur, in PDF and Word.</span>' +
      '<a href="' + BLOG + '">Read the blog →</a><a href="' + SHIUR + '">Read the shiur →</a></div>' +
      '<details class="noach6-pdf weekly-study-pdf"><summary>PDF attachment · ' +
      Number(d.pdfPages || 12) + ' pages · Dvar Torah and complete source collection</summary>' +
      '<div class="weekly-pdf-actions"><a class="btn primary" href="' + PDF + '" target="_blank" rel="noopener">Open full PDF ↗</a>' +
      '<a class="btn" href="' + PDF + '" download>Download PDF ↓</a></div>' +
      '<img class="weekly-pdf-cover" src="downloads/vayeira-akeidah-mesiras-nefesh-cover.webp" alt="Cover preview of the Parshas Vayeira Akeidah and Mesiras Nefesh PDF" loading="lazy">' +
      '<iframe title="Parshas Vayeira PDF attachment" loading="lazy" src="' + PDF + '#toolbar=1"></iframe></details>';
  }
  window.AkivaVayeiraStudy = {BOOK, REF, SOURCES_REF, VERSION, BLOG, SHIUR, AUDIO, recognizes, fetchText, contents, attachment};
})();

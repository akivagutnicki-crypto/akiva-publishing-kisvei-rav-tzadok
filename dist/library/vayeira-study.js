(function () {
  'use strict';
  const BOOK = 'Akiva Publishing Weekly Torah';
  const REF = BOOK + ', Vayeira Mesiras Nefesh';
  const SOURCES_REF = REF + ' Sources';
  const VERSION = '20261026-vayeira-mesiras-nefesh-v1';
  const PDF = 'downloads/vayeira-akeidah-mesiras-nefesh.pdf';
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
      '<div class="eyebrow">Special section · Parshas Vayeira</div>' +
      '<h1>The Deeper Meaning of the Akeidah</h1>' +
      '<p class="lead">Mesiras Nefesh and Giving Up Everything</p>' +
      '<p>An editorial Dvar Torah drawing on Pri Tzaddik, Beis Yaakov, Mei HaShiloach and other Chassidic sources, followed by fifteen Hebrew–English interlinear source passages.</p>' +
      '<div class="actions"><a class="btn primary" href="#/read/' + hash(REF) + '">Read the Vayeira Dvar Torah →</a>' +
      '<a class="btn" href="#/read/' + hash(SOURCES_REF) + '">Read the fifteen interlinear sources →</a>' +
      '<a class="btn" href="' + PDF + '" target="_blank" rel="noopener">Open the complete PDF ↗</a>' +
      '<a class="btn" href="' + PDF + '" download>Download PDF ↓</a></div></div>';
  }
  function attachment(d) {
    return '<details class="noach6-pdf weekly-study-pdf"><summary>PDF attachment · ' +
      Number(d.pdfPages || 12) + ' pages · Dvar Torah and complete source collection</summary>' +
      '<div class="weekly-pdf-actions"><a class="btn primary" href="' + PDF + '" target="_blank" rel="noopener">Open full PDF ↗</a>' +
      '<a class="btn" href="' + PDF + '" download>Download PDF ↓</a></div>' +
      '<img class="weekly-pdf-cover" src="downloads/vayeira-akeidah-mesiras-nefesh-cover.webp" alt="Cover preview of the Parshas Vayeira Akeidah and Mesiras Nefesh PDF" loading="lazy">' +
      '<iframe title="Parshas Vayeira PDF attachment" loading="lazy" src="' + PDF + '#toolbar=1"></iframe></details>';
  }
  window.AkivaVayeiraStudy = {BOOK, REF, SOURCES_REF, VERSION, recognizes, fetchText, contents, attachment};
})();

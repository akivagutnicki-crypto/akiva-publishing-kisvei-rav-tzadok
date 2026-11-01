(function () {
  'use strict';
  // Parshas Chayei Sarah · the shiur "Wisdom Outside the House" as native reader text.
  // The PDF, the Word file and the page-by-page edition stay available beside it.
  const BOOK = 'Akiva Publishing Weekly Torah';
  const BASE = BOOK + ', Chayei Sarah Wisdom Outside the House';
  const VERSION = '20261101-chayei-sarah-native-v1';
  const DATA = 'studies/chayei-sarah-wisdom-outside-the-house.json?v=' + VERSION;
  const BLOG = 'blog/from-the-east/';
  const SHIUR = BLOG + 'shiur/';
  const PDF = 'downloads/chayei-sarah-wisdom-outside-the-house-shiur.pdf';
  const DOCX = 'downloads/chayei-sarah-wisdom-outside-the-house-shiur.docx';
  const BLOG_PDF = 'blog/pdfs/from-the-east-chayei-sarah.pdf';
  const BLOG_DOCX = 'blog/docs/from-the-east-chayei-sarah.docx';
  const PARTS = [
    ['Part I', 'I · “Your Latter End Will Greatly Increase”', 'Why does the Midrash call Yitzchak the small beginning and Keturah’s sons the great increase?'],
    ['Part II', 'II · The Gifts: A Name for Use in Impurity', 'Avraham gave his sons a holy Name that works even in impurity; the receiver decides what it becomes.'],
    ['Part III', 'III · Eastward: Where the Oral Torah Went into Exile', 'The sparks of the Oral Torah were exiled among the Bnei Kedem; Shlomo’s wisdom grew by drawing them out.'],
    ['Part IV', 'IV · “Sons of Keturah”: Holding Torah Without Grasping It', 'Holding Torah without grasping its depth.'],
    ['Part V', 'V · Yishmael: The Wisdom of Nature', 'The names of his sons, and what “shifchas Sarah” left in him.'],
    ['Part VI', 'VI · Wisdom Needs Attachment', '“Before all his brothers he fell.”'],
    ['Part VII', 'VII · The Husk Before the Fruit', 'Twelve princes before twelve tribes; the chaff carries the grain; the gate is Yaakov.'],
    ['Part VIII', 'VIII · Yishmael’s Teshuvah', 'In Avraham’s merit, from Avraham’s root, because desire can be refined.'],
    ['Part IX', 'IX · The Answer: Light That Comes Out of Darkness', 'Light that comes out of darkness: the “great increase” of the end.'],
    ['Part X', 'X · Out of the East, in Later Generations', 'Bavel, Aram, Charan, Persia and the lands of Yishmael, and hidden Jewish souls in Yishmael’s house today.'],
    ['Summing Up', 'Summing Up', 'The two families sent from Avraham’s house were not lost to it.'],
    ['Sources', 'Sources in This Shiur', 'Every source, with links, and the outside links cited in the notes.']];
  const REFS = [BASE, ...PARTS.map(([suffix]) => BASE + ' ' + suffix)];
  let pending;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hash = ref => encodeURIComponent(ref.replace(/ /g, '_'));
  const read = ref => '#/read/' + hash(ref);
  const recognizes = ref => REFS.some(base => ref === base ||
    (ref.startsWith(base + ':') && /^[1-9]\d*$/.test(ref.slice(base.length + 1))));
  async function fetchText(ref) {
    if (!recognizes(ref)) throw new Error('Unknown Chayei Sarah study reference');
    pending ||= fetch(DATA, {cache: 'no-cache'})
      .then(response => { if (!response.ok) throw new Error('The Chayei Sarah shiur could not be loaded'); return response.json(); })
      .catch(error => { pending = null; throw error; });
    const data = await pending;
    const base = REFS.find(key => ref === key || ref.startsWith(key + ':'));
    const section = data.sections[base];
    if (!section) throw new Error('The requested part of the shiur is missing');
    const paragraph = ref === base ? null : Number(ref.slice(base.length + 1));
    if (paragraph !== null && paragraph > section.phrases.length) throw new Error('Study paragraph is out of range');
    return {...section, ref, ...(paragraph ? {highlight: ref} : {})};
  }
  const partsList = current => '<ol class="chayei-parts-list">' + PARTS.map(([suffix, title, line]) => {
    const ref = BASE + ' ' + suffix;
    return '<li' + (ref === current ? ' aria-current="true"' : '') + '><a href="' + read(ref) + '">' + esc(title) + '</a><span>' + esc(line) + '</span></li>';
  }).join('') + '</ol>';
  const editions = '<a class="btn" href="' + SHIUR + '">Read page by page →</a>' +
    '<a class="btn" href="' + PDF + '" target="_blank" rel="noopener">Open the PDF ↗</a>' +
    '<a class="btn" href="' + PDF + '" download>Download PDF ↓</a>' +
    '<a class="btn" href="' + DOCX + '" download>Download Word ↓</a>';
  const where = text => /^[IVX]/.test(text) ? 'Part ' + text : text.charAt(0).toUpperCase() + text.slice(1);
  const link = (label, href) => !href ? esc(label) : href.startsWith('#/read/')
    ? '<a href="' + esc(href) + '">' + esc(label) + '</a>'
    : '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>';
  function sourceIndex(index) {
    return '<div class="chayei-source-index">' +
      '<h3>From the Kisvei Rav Tzadok library</h3><ul>' + index.library.map(([name, place, href]) =>
        '<li>' + link(name, href) + '<span> · ' + esc(where(place)) + '</span></li>').join('') + '</ul>' +
      '<h3>Supporting sources from other seforim</h3><ul>' + index.supporting.map(([name, kind, place, href]) =>
        '<li>' + link(name, href) + '<span> · ' + esc(kind) + ' · ' + esc(where(place)) + '</span></li>').join('') + '</ul>' +
      '<h3>Outside links cited in the footnotes</h3><p>The notes name these sources; here are the links.</p><ul>' + index.outside.map(([number, label, href, site]) =>
        '<li><span>Footnote ' + number + ' · </span>' + link(label, href) + '<span> · ' + esc(site) + '</span></li>').join('') + '</ul></div>';
  }
  function attachment(d) {
    if (d.part === 'intro') {
      return '<div class="weekly-study-new chayei-native-new"><span class="eyebrow">This week · Parshas Chayei Sarah 5787</span>' +
        '<strong>The shiur as text</strong><span>Hebrew and English phrase by phrase, with all 65 footnotes. The same shiur is also here as printed:</span>' +
        '<div class="chayei-native-actions">' + editions + '<a class="btn" href="' + BLOG + '">Read the blog →</a></div></div>' +
        '<nav class="chayei-parts" aria-label="Parts of the shiur"><h3>The shiur at a glance</h3>' + partsList(d.sectionRef) + '</nav>';
    }
    if (d.part === 'sources' && d.sourceIndex) {
      return '<div class="chayei-native-actions chayei-native-end">' + editions + '</div>' + sourceIndex(d.sourceIndex);
    }
    if (!d.sources?.length) return '';
    return '<p class="chayei-part-sources"><span>Sources in this part:</span> ' +
      d.sources.map(([label, href]) => link(label, href)).join('<span aria-hidden="true"> · </span>') + '</p>';
  }
  // The Weekly Torah contents page: this week first, then last week's study as before.
  function contents(lastWeek = '') {
    const earlier = lastWeek.replace(/<div class="crumbs">[\s\S]*?<\/div>/, '')
      .replace('This week · Parshas Vayeira', 'Last week · Parshas Vayeira');
    return '<div class="page weekly-chayei-contents">' +
      '<div class="crumbs"><a href="#/">Texts</a><span>›</span><a href="blog/">Weekly Torah</a></div>' +
      '<div class="eyebrow">This week · Parshas Chayei Sarah 5787</div>' +
      '<h1>Wisdom Outside the House</h1>' +
      '<p class="lead">Keturah, the Bnei Kedem and Yishmael, from the writings of Rav Tzadok HaKohen and the Izhbitz–Radzin school</p>' +
      '<section class="weekly-study-item"><h2>Read the shiur here, as text</h2>' +
      '<p>Ten parts, phrase by phrase in Hebrew and English, with all 65 footnotes. Tap a number beside the Hebrew to open its note.</p>' +
      '<div class="actions"><a class="btn primary" href="' + read(BASE) + '">Start reading →</a></div>' + partsList() + '</section>' +
      '<section class="weekly-study-item"><h2>The shiur as printed · 32 pages</h2>' +
      '<p>The same shiur page by page, as a PDF and as a Word file.</p><div class="actions">' + editions + '</div></section>' +
      '<section class="weekly-study-item"><h2>The blog · From the East I Will Bring Your Seed</h2>' +
      '<p>The sons of Keturah, the gedolim who came out of Bavel, Aram and the lands of Yishmael, and the souls coming home.</p>' +
      '<div class="actions"><a class="btn primary" href="' + BLOG + '">Read the blog →</a>' +
      '<a class="btn" href="' + BLOG_PDF + '" download>Download PDF ↓</a><a class="btn" href="' + BLOG_DOCX + '" download>Download Word ↓</a></div></section>' +
      '</div>' + earlier;
  }
  window.AkivaChayeiSarahStudy = {BOOK, BASE, VERSION, REFS, PDF, DOCX, SHIUR, BLOG, recognizes, fetchText, attachment, contents};
})();

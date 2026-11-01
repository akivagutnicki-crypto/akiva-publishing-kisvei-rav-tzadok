/* Halacha ZIP downloads for the reader's ZIP page: Sefaria, TorahLM and Halachipedia. */
(function () {
  'use strict';
  const NOTES = {
    'halakhah-with-meforshim': 'Shulchan Arukh with its meforshim, Mishneh Torah with its commentaries, Tur, Mishnah Berurah, Arukh HaShulchan, Kitzur Shulchan Arukh and every other work Sefaria files under Halakhah. Original JSON source files from Sefaria’s public export, Hebrew and English editions, each with its license.',
    'torahlm-halakhah': 'The same halacha library as clean Markdown from TorahLM.org: one file per sefer, Hebrew with English where available, footnotes and links back to each passage.',
    'halachipedia-torahlm': 'Every Halachipedia article on practical halacha, compiled by TorahLM.org as Markdown, with a link back to each article.'
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const size = bytes => bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + ' GB' : (bytes / 1048576).toFixed(1) + ' MB';
  const count = n => Number(n).toLocaleString();
  function details(pack) {
    const parts = [];
    if (pack.works) parts.push(count(pack.works) + ' works');
    if (pack.commentaries) parts.push(count(pack.commentaries) + ' meforshim');
    if (pack.versions) parts.push(count(pack.versions) + ' Hebrew and English editions');
    if (pack.files && !pack.works) parts.push(count(pack.files) + (pack.id === 'halachipedia-torahlm' ? ' Markdown files' : ' sefarim'));
    parts.push(size(pack.bytes));
    if (pack.sourceDate) parts.push(pack.sourceLabel + ' ' + pack.sourceDate.slice(0, 10));
    return parts.join(' · ');
  }
  async function render(box) {
    if (!box) return;
    box.innerHTML = '<div class="pack"><small>Loading the Halacha ZIP downloads…</small></div>';
    try {
      const response = await fetch('downloads/halacha/index.json', {cache: 'no-cache'});
      if (!response.ok) throw Error('HTTP ' + response.status);
      const index = await response.json();
      if (!Array.isArray(index.packs) || !index.packs.length) throw Error('Empty list');
      if (!box.isConnected) return;
      box.innerHTML = index.packs.map(pack => '<div class="pack" data-id="' + esc(pack.id) + '"><b>' + esc(pack.title) + '</b>' +
        '<small>' + esc(NOTES[pack.id] || '') + '</small>' +
        '<a class="btn zipb" href="' + esc(pack.url) + '" rel="noopener" aria-label="Download ' + esc(pack.title) + ' ZIP">Download ZIP ↓</a>' +
        '<small class="zip-details">' + esc(details(pack)) + '</small></div>').join('');
    } catch {
      if (box.isConnected) box.innerHTML = '<div class="pack"><small>The Halacha ZIP list could not be loaded. Check your connection and open this page again.</small></div>';
    }
  }
  window.AkivaHalachaZips = {render, details};
})();

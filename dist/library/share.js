/* One public link, with native sharing where available and an accessible fallback. */
(() => {
  'use strict';
  const SITE = 'https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/';
  const READER = SITE + 'library/';
  const OPEN = READER + 'open/';
  const APP_PACKAGE = 'org.akivapublishing.reader';
  const APP_TITLE = 'Toras Rav Tzadok HaKohen · Akiva Publishing';
  const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>';
  const wrapper = /AkivaPublishingAndroid\//i.test(navigator.userAgent);

  function readingRoute(hash) {
    // Only public reader references are shared. Queries, searches, and arbitrary URLs are not forwarded.
    const match = /^#\/(read|book)\/([^?#]{1,700})(?:\?[^#]*)?$/.exec(hash || '');
    if (!match) return '';
    try {
      const reference = decodeURIComponent(match[2]);
      if (/[\u0000-\u001f\u007f<>\\/?#]/.test(reference) || !reference.trim()) return '';
      return '#/' + match[1] + '/' + match[2];
    } catch { return ''; }
  }

  function referenceTitle(route) {
    if (!route) return '';
    try { return decodeURIComponent(route.split('/').slice(2).join('/')).replace(/_/g, ' '); }
    catch { return ''; }
  }

  function payload() {
    const isReader = !!document.querySelector('header.top');
    const route = isReader ? readingRoute(location.hash) : '';
    const title = referenceTitle(route);
    return {
      title: title ? title + ' · Akiva Publishing' : APP_TITLE,
      text: title ? 'Read ' + title + ' in the Rav Tzadok Library.' : 'Explore the Rav Tzadok Library in the app or on the web.',
      url: OPEN + route
    };
  }

  if (document.body.hasAttribute('data-akiva-share-landing')) {
    const updateLanding = () => {
      const route = readingRoute(location.hash);
      const readerUrl = READER + route;
      const label = referenceTitle(route);
      const web = document.getElementById('akivaOpenWeb');
      const android = document.getElementById('akivaOpenAndroid');
      const reference = document.getElementById('akivaSharedReference');
      web.href = readerUrl;
      reference.textContent = label;
      reference.hidden = !label;
      document.title = label ? label + ' · Open in Akiva Publishing' : 'Open the Rav Tzadok Library · Akiva Publishing';
      if (/Android/i.test(navigator.userAgent) && !wrapper) {
        android.href = readerUrl.replace(/^https:/, 'intent:') + '#Intent;scheme=https;package=' + APP_PACKAGE
          + ';S.browser_fallback_url=' + encodeURIComponent(readerUrl) + ';end';
        android.hidden = false;
      }
      document.getElementById('akivaOpenWebsite').href = SITE;
    };
    updateLanding();
    window.addEventListener('hashchange', updateLanding);
    return;
  }

  const readerNav = document.querySelector('header.top .topnav');
  const websiteHeader = document.querySelector('header#top .nav');
  const host = readerNav || websiteHeader;
  if (!host || document.getElementById('akivaShareButton')) return;
  const button = document.createElement('button');
  button.id = 'akivaShareButton';
  button.type = 'button';
  button.className = 'akiva-share-button';
  button.setAttribute('aria-label', 'Share this page');
  button.innerHTML = SHARE_ICON + '<span>Share</span>';
  host.append(button);
  if (websiteHeader) {
    websiteHeader.classList.add('akiva-share-header');
    document.body.classList.add('akiva-share-website');
    const header = websiteHeader.closest('header');
    const clearHeader = () => document.body.style.setProperty('--akiva-share-header-space', Math.ceil(header.getBoundingClientRect().height + 24) + 'px');
    clearHeader();
    if ('ResizeObserver' in window) new ResizeObserver(clearHeader).observe(header);
    window.addEventListener('resize', clearHeader, {passive: true});
  }

  let dialog;
  function showFallback(data) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'akivaShareDialog';
      dialog.className = 'akiva-share-dialog';
      dialog.setAttribute('aria-labelledby', 'akivaShareTitle');
      dialog.setAttribute('aria-describedby', 'akivaShareDescription');
      dialog.innerHTML = '<div class="akiva-share-dialog-head"><h2 id="akivaShareTitle">Share the library</h2><button type="button" class="akiva-share-close" aria-label="Close share options">×</button></div>'
        + '<p id="akivaShareDescription">One link lets recipients choose the Android app, web reader, or website.</p>'
        + '<label for="akivaShareLink">Link to share</label><div class="akiva-share-copy-row"><input id="akivaShareLink" type="url" readonly spellcheck="false" dir="ltr"><button type="button" id="akivaCopyShareLink">Copy link</button></div>'
        + '<div class="akiva-share-options"><a id="akivaShareWhatsApp" target="_blank" rel="noopener noreferrer">WhatsApp</a><a id="akivaShareEmail">Email</a></div>'
        + '<p id="akivaShareStatus" class="akiva-share-status" role="status" aria-live="polite"></p>';
      document.body.append(dialog);
      const close = () => typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open');
      dialog.querySelector('.akiva-share-close').addEventListener('click', close);
      dialog.addEventListener('close', () => button.focus({preventScroll: true}));
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape' && typeof dialog.showModal !== 'function') { close(); button.focus({preventScroll: true}); }
      });
      dialog.addEventListener('click', event => {
        const box = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close();
      });
      dialog.querySelector('#akivaCopyShareLink').addEventListener('click', async () => {
        const input = dialog.querySelector('#akivaShareLink');
        const status = dialog.querySelector('#akivaShareStatus');
        let copied = false;
        try {
          if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(input.value); copied = true; }
        } catch { /* Some Android WebViews and embedded browsers deny clipboard access. */ }
        if (!copied) {
          input.focus(); input.select(); input.setSelectionRange(0, input.value.length);
          try { copied = document.execCommand('copy'); } catch { /* Keep the selected link available for manual copying. */ }
        }
        status.textContent = copied ? 'Link copied.' : 'The link is selected. Touch and hold it, or use Copy on your keyboard.';
      });
    }
    dialog.querySelector('#akivaShareTitle').textContent = data.url === OPEN ? 'Share the library' : 'Share this page';
    dialog.querySelector('#akivaShareLink').value = data.url;
    dialog.querySelector('#akivaShareStatus').textContent = '';
    const message = data.text + '\n' + data.url;
    dialog.querySelector('#akivaShareWhatsApp').href = 'https://wa.me/?text=' + encodeURIComponent(message);
    dialog.querySelector('#akivaShareEmail').href = 'mailto:?subject=' + encodeURIComponent(data.title) + '&body=' + encodeURIComponent(message);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.querySelector('#akivaCopyShareLink').focus();
  }

  button.addEventListener('click', async () => {
    const data = payload();
    if (!wrapper && typeof navigator.share === 'function') {
      try {
        // Keep this call inside the original click gesture, before any asynchronous work.
        const sharing = navigator.share(data);
        button.disabled = true;
        await sharing;
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      } finally { button.disabled = false; }
    }
    showFallback(data);
  });
})();

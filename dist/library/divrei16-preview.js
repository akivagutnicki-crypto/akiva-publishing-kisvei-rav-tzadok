/* Page-image preview of the supplied Divrei Soferim Ois 16 transcript. */
(() => {
  'use strict';
  const BASE = 'downloads/divrei-soferim-ois-16-lech-lecha-preview/';

  function mount(section) {
    const details = section.querySelector('.divrei16-pdf');
    if (!details) return null;
    const pages = Number(details.dataset.previewPages);
    const revision = details.dataset.previewVersion;
    if (!Number.isInteger(pages) || pages < 1 || !revision) return null;
    const image = details.querySelector('.divrei16-page-image');
    const viewport = details.querySelector('.divrei16-page-viewport');
    const count = details.querySelector('.divrei16-page-count');
    const status = details.querySelector('.divrei16-preview-status');
    const previous = details.querySelector('[data-preview-action="previous"]');
    const next = details.querySelector('[data-preview-action="next"]');
    const zoomOut = details.querySelector('[data-preview-action="zoom-out"]');
    const zoomIn = details.querySelector('[data-preview-action="zoom-in"]');
    const fit = details.querySelector('[data-preview-action="fit"]');
    const retry = details.querySelector('[data-preview-action="retry"]');
    const zoomLabel = details.querySelector('.divrei16-zoom-label');
    if (!image || !viewport || !count || !status || !previous || !next || !zoomOut || !zoomIn || !fit || !retry || !zoomLabel) return null;

    let page = 1, zoom = 1, loadedPage = 0;
    const listeners = [];
    const on = (target, event, handler) => {
      target.addEventListener(event, handler);
      listeners.push(() => target.removeEventListener(event, handler));
    };
    const controls = () => {
      count.textContent = `Page ${page} of ${pages}`;
      previous.disabled = page === 1;
      next.disabled = page === pages;
      zoomOut.disabled = zoom <= 1;
      zoomIn.disabled = zoom >= 3;
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      image.style.width = `${zoom * 100}%`;
    };
    const loadPage = (force = false) => {
      if (!details.open || (!force && loadedPage === page)) return;
      loadedPage = page;
      image.hidden = true;
      image.alt = `Divrei Soferim Ois 16 Lech Lecha shiur transcript, page ${page} of ${pages}`;
      status.textContent = `Loading page ${page}…`;
      status.hidden = false;
      retry.hidden = true;
      image.src = `${BASE}page-${String(page).padStart(2, '0')}.webp?v=${encodeURIComponent(revision)}`;
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
    };
    const setPage = value => {
      page = Math.min(pages, Math.max(1, value));
      controls();
      loadPage();
    };
    const setZoom = value => {
      zoom = Math.min(3, Math.max(1, value));
      controls();
      if (zoom === 1) viewport.scrollLeft = 0;
    };
    on(details, 'toggle', () => loadPage());
    on(previous, 'click', () => setPage(page - 1));
    on(next, 'click', () => setPage(page + 1));
    on(zoomOut, 'click', () => setZoom(zoom - 0.25));
    on(zoomIn, 'click', () => setZoom(zoom + 0.25));
    on(fit, 'click', () => setZoom(1));
    on(retry, 'click', () => loadPage(true));
    on(image, 'load', () => {
      image.hidden = false;
      status.hidden = true;
      retry.hidden = true;
    });
    on(image, 'error', () => {
      image.hidden = true;
      status.textContent = 'This page could not load. Retry the preview or open the PDF below.';
      status.hidden = false;
      retry.hidden = false;
      loadedPage = 0;
    });
    controls();
    loadPage();
    return () => listeners.forEach(remove => remove());
  }

  window.AkivaDivrei16Preview = {mount};
})();

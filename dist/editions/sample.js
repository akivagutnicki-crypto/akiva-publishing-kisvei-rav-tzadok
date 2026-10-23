(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const assetBase = document.body.dataset.assetBase || './';
  let book, page = 1, zoom = 1, generation = 0;
  const params = new URLSearchParams(location.search);
  const requested = params.get('book');
  const controls = () => {
    $('page-select').value = String(page);
    $('previous-page').disabled = page === 1;
    $('next-page').disabled = page === book.samplePages;
    $('zoom-out').disabled = zoom === 1;
    $('zoom-in').disabled = zoom === 3;
    $('zoom-level').textContent = `${Math.round(zoom * 100)}%`;
    $('sample-page').style.width = `${zoom * 100}%`;
    $('page-caption').textContent = `Sample page ${page} of ${book.samplePages} · Original PDF page ${book.sourcePages[page - 1]}`;
  };
  function loadPage() {
    if (!book) return;
    const token = ++generation;
    const image = $('sample-page');
    const status = $('sample-status');
    image.hidden = true;
    $('retry-page').hidden = true;
    status.textContent = `Loading page ${page}…`;
    image.alt = `${book.title}: ${book.subtitle}, sample page ${page} of ${book.samplePages}`;
    const source = `${assetBase}${book.pageDirectory}/page-${String(page).padStart(2, '0')}.webp`;
    const preload = new Image();
    preload.onload = async () => {
      if (generation !== token) return;
      image.src = source;
      try { await image.decode(); } catch (_) {
        if (generation === token) {
          status.textContent = 'This page could not display. Retry it or open the PDF below.';
          $('retry-page').hidden = false;
        }
        return;
      }
      if (generation !== token) return;
      image.hidden = false;
      status.textContent = `Page ${page} of ${book.samplePages}`;
      $('sample-viewport').scrollTop = 0;
      $('sample-viewport').scrollLeft = 0;
    };
    preload.onerror = () => {
      if (generation !== token) return;
      status.textContent = 'This page could not load. Retry it or open the PDF below.';
      $('retry-page').hidden = false;
    };
    preload.src = source;
    controls();
  }
  const changePage = value => {
    page = Math.min(book.samplePages, Math.max(1, value));
    loadPage();
  };
  const changeZoom = value => {
    zoom = Math.min(3, Math.max(1, value));
    controls();
    if (zoom === 1) $('sample-viewport').scrollLeft = 0;
  };
  async function initialize() {
    $('sample-error').hidden = true;
    try {
      const response = await fetch(assetBase + 'catalog.json?v=20261023-new-books-v1');
      if (!response.ok) throw Error('Catalog unavailable');
      const catalog = await response.json();
      book = catalog.books.find(item => item.slug === requested) || (!requested ? catalog.books[0] : null);
      if (!book || book.samplePages !== 20) throw Error('Unknown sample');
      document.title = `${book.title}: ${book.subtitle} · 20-page sample`;
      $('sample-title').textContent = book.title;
      $('sample-subtitle').textContent = book.subtitle;
      $('sample-note').textContent = 'Twenty unchanged pages from the actual print PDF: the title and copyright pages, followed by eighteen consecutive opening pages. Original printed page numbers are retained.';
      $('sample-download').href = assetBase + book.pdf;
      $('open-pdf').href = assetBase + book.pdf;
      $('sample-amazon').href = book.amazon;
      $('sample-links').hidden = false;
      $('sample-viewer').hidden = false;
      $('page-total').textContent = `of ${book.samplePages}`;
      $('page-select').replaceChildren(...Array.from({length: book.samplePages}, (_, index) => {
        const option = document.createElement('option');
        option.value = String(index + 1); option.textContent = String(index + 1); return option;
      }));
      document.querySelectorAll('#sample-choices a').forEach(link => {
        if (new URL(link.href).searchParams.get('book') === book.slug) link.setAttribute('aria-current', 'page');
      });
      loadPage();
    } catch (error) {
      $('sample-error').hidden = false;
      $('sample-viewer').hidden = true;
    }
  }
  $('previous-page').addEventListener('click', () => changePage(page - 1));
  $('next-page').addEventListener('click', () => changePage(page + 1));
  $('page-select').addEventListener('change', event => changePage(Number(event.target.value)));
  $('zoom-out').addEventListener('click', () => changeZoom(zoom - .25));
  $('zoom-in').addEventListener('click', () => changeZoom(zoom + .25));
  $('fit-width').addEventListener('click', () => changeZoom(1));
  $('retry-page').addEventListener('click', loadPage);
  $('retry-catalog').addEventListener('click', initialize);
  $('sample-viewport').addEventListener('keydown', event => {
    if (!book || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); changePage(page + (event.key === 'ArrowRight' ? 1 : -1));
  });
  initialize();
})();

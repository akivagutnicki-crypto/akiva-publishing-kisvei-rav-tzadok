// Sefaria collections: complete works and dependent commentaries, not previews.
// Whole-node exports use the documented v1 pad=0 behavior and retain version licenses.
(function (root) {
  'use strict';
  const API = 'https://www.sefaria.org';
  const REVISION = '20261012-meforshim-v1';
  const COLLECTIONS = [
    { id: 'tanakh', title: 'Tanach + meforshim', path: ['Tanakh'] },
    { id: 'shas', title: 'Talmud Bavli + meforshim', path: ['Talmud', 'Bavli'] },
    { id: 'yerushalmi', title: 'Talmud Yerushalmi + meforshim', path: ['Talmud', 'Yerushalmi'] },
    { id: 'midrash', title: 'Midrashim + meforshim', path: ['Midrash'] },
  ];
  const indexUrl = title => `${API}/api/v2/raw/index/${encodeURIComponent(title)}`;
  const shapeUrl = title => `${API}/api/shape/${encodeURIComponent(title)}`;
  const wholeTextUrl = ref => `${API}/api/texts/${encodeURIComponent(ref)}?context=0&commentary=0&pad=0`;
  const hasText = value => Array.isArray(value) ? value.some(hasText) : typeof value === 'string' && !!value.trim();
  function flattenCatalog(toc, out = [], parents = []) {
    if (Array.isArray(toc)) toc.forEach(n => flattenCatalog(n, out, parents));
    else if (toc && toc.contents) flattenCatalog(toc.contents, out, [...parents, toc.category]);
    else if (toc && toc.title) out.push({ title: toc.title, he: toc.heTitle || toc.he || '',
      categories: toc.categories || parents, dependence: toc.dependence || '',
      collectiveTitle: toc.collectiveTitle || '', base_text_titles: toc.base_text_titles || [] });
    return out;
  }
  function collectionBooks(catalog, id) {
    const def = COLLECTIONS.find(c => c.id === id);
    if (!def) throw Error('Unknown collection: ' + id);
    const books = Array.isArray(catalog) && catalog.every(b => b.title) ? catalog : flattenCatalog(catalog);
    const selected = new Map(books.filter(b => def.path.every((part, i) => b.categories?.[i] === part)).map(b => [b.title, b]));
    // Include supercommentaries even when their catalog category is elsewhere.
    let added;
    do {
      added = false;
      for (const book of books) if (book.dependence && !selected.has(book.title)
        && book.base_text_titles?.some(t => selected.has(t))) {
        selected.set(book.title, book); added = true;
      }
    } while (added);
    if (!selected.size) throw Error('No books found for ' + def.title);
    return [...selected.values()];
  }
  function leafRefs(index, title) {
    if (!index || index.error || !index.schema) throw Error('Missing index for ' + title);
    const refs = [];
    const walk = (node, ref) => {
      if (node.nodes?.length) {
        for (const child of node.nodes) {
          const name = child.titles?.find(t => t.lang === 'en' && t.primary)?.text
            || child.enTitle || child.titles?.find(t => t.lang === 'en')?.text || child.key;
          if (!name && !child.default) throw Error('Unnamed text node in ' + title);
          walk(child, child.default ? ref : `${ref}, ${name}`);
        }
      } else if (node.depth || node.nodeType === 'JaggedArrayNode') refs.push(ref);
    };
    walk(index.schema, title);
    if (!refs.length) throw Error('No text nodes in ' + title);
    return [...new Set(refs)];
  }
  function validWholeText(data, ref) {
    // A padded first chapter is NOT a complete-book response.
    return data && !data.error && data.ref === ref && (!data.sections || !data.sections.length)
      && ('he' in data || 'text' in data);
  }
  function archivePath(url) {
    const u = new URL(url, API);
    const match = u.pathname.match(/^\/api\/(v3\/texts|texts|shape|v2\/raw\/index)\/(.+)$/);
    if (!match) return null;
    const folder = { 'v3/texts': 'texts', texts: 'books', shape: 'contents', 'v2/raw/index': 'indexes' }[match[1]];
    // URL encoding is reversible and avoids collisions such as A:B and A_B.
    return `sefaria/${folder}/${encodeURIComponent(decodeURIComponent(match[2]))}.json`;
  }
  async function getSavedJSON(cache, url, fetcher, signal, validate, refresh = false) {
    const saved = refresh ? null : await cache.match(url, { ignoreVary: true });
    if (saved) {
      try { const value = await saved.json(); if (!validate || validate(value)) return value; } catch {}
    }
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw Error('Stopped');
      const controller = new AbortController();
      const stop = () => controller.abort();
      signal?.addEventListener('abort', stop, { once: true });
      const timeout = setTimeout(stop, 45000);
      try {
        const response = await fetcher(url, { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw Error('HTTP ' + response.status);
        const value = await response.json();
        if (value?.error || (validate && !validate(value))) throw Error(value?.error || 'Incomplete text response');
        await cache.put(url, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
        return value;
      } catch (error) {
        failure = error;
        if (signal?.aborted) throw Error('Stopped');
      } finally {
        clearTimeout(timeout); signal?.removeEventListener('abort', stop);
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw failure;
  }
  // At most two books in flight; cached complete nodes are reused after Stop/retry.
  async function prepare({ id, books, cache, fetcher = root.fetch.bind(root), signal, progress = () => {}, checkpoint = async () => {}, catalogDate = '', refresh = false }) {
    const manifest = { revision: REVISION, id, title: COLLECTIONS.find(c => c.id === id)?.title,
      catalogDate, createdAt: new Date().toISOString(), cache: 'rtl-external', complete: false,
      books: books.map(book => ({ ...book, nodes: [], urls: [], complete: false, error: '' })), urls: [], missing: [] };
    let next = 0, done = 0, writes = Promise.resolve(), lastCheckpoint = Date.now();
    const persist = () => {
      const snapshot = JSON.parse(JSON.stringify(manifest));
      writes = writes.then(() => checkpoint(snapshot));
      return writes;
    };
    await persist();
    const work = async () => {
      while (next < manifest.books.length && !signal?.aborted) {
        const book = manifest.books[next++];
        progress(done / books.length, `Downloading ${book.title} · ${manifest.books.filter(b => b.complete).length.toLocaleString()} of ${books.length.toLocaleString()} works saved`);
        try {
          const index = await getSavedJSON(cache, indexUrl(book.title), fetcher, signal, d => d?.schema && !d.error, refresh);
          book.nodes = leafRefs(index, book.title);
          book.urls = [indexUrl(book.title), ...book.nodes.map(wholeTextUrl)];
          // Fetch EVERY node, including introductions, appendices and default nodes.
          for (const ref of book.nodes) await getSavedJSON(cache, wholeTextUrl(ref), fetcher, signal, d => validWholeText(d, ref), refresh);
          // The shape endpoint excludes dependent books from category queries;
          // an individual commentary index can be queried explicitly.
          try {
            const shape = await getSavedJSON(cache, shapeUrl(book.title), fetcher, signal, d => Array.isArray(d) && !!d.length, refresh);
            if (shape) book.urls.push(shapeUrl(book.title));
          } catch (error) { if (signal?.aborted) throw error; } // The full index still records the complete structure.
          book.complete = true;
        } catch (error) { book.error = String(error.message || error); console.warn('Collection download:', book.title, book.error); }
        done++;
        manifest.urls = [...new Set(manifest.books.flatMap(b => b.urls))];
        if (done % 8 === 0 || Date.now() - lastCheckpoint > 5000) { await persist(); lastCheckpoint = Date.now(); }
        progress(done / books.length, `${manifest.books.filter(b => b.complete).length.toLocaleString()} of ${books.length.toLocaleString()} works saved, with meforshim`);
      }
    };
    await Promise.all([work(), work()]);
    manifest.missing = manifest.books.filter(b => !b.complete).map(b => ({ title: b.title, error: b.error || 'Not downloaded yet' }));
    manifest.complete = !manifest.missing.length && !signal?.aborted;
    manifest.urls = [...new Set(manifest.books.flatMap(b => b.urls))];
    manifest.commentaries = manifest.books.filter(b => b.dependence).length;
    await persist();
    return manifest;
  }
  function sliceText(data, ref) {
    const base = data.ref;
    if (ref !== base && !ref.startsWith(base + ' ')) return null;
    const tail = ref.slice(base.length).trim().replace(/\./g, ':');
    if (tail && !/^\d+[ab]?(?::\d+[ab]?)*(?:-\d+[ab]?)?$/.test(tail)) return null;
    const [start, end] = tail.split('-');
    const tokens = start ? start.split(':') : [];
    const types = data.addressTypes || [];
    // Do not guess nonstandard edition offsets.
    if (Object.values(data.index_offsets_by_depth || {}).some(v => typeof v === 'number' ? v !== 0 : true)) return null;
    const numeric = (token, i) => types[i] === 'Talmud'
      ? (/^\d+[ab]$/.test(token) ? parseInt(token, 10) * 2 - (token.endsWith('a') ? 1 : 0) : NaN)
      : (/^\d+$/.test(token) ? +token : NaN);
    const positions = tokens.map(numeric);
    if (positions.some(n => !Number.isInteger(n) || n < 1)) return null;
    const pick = value => {
      for (let i = 0; i < positions.length; i++) {
        if (!Array.isArray(value)) return [];
        if (end && i === positions.length - 1) {
          const last = numeric(end, i); if (!Number.isInteger(last) || last < positions[i]) return [];
          return value.slice(positions[i] - 1, last);
        }
        value = value[positions[i] - 1] ?? [];
      }
      return value;
    };
    const depth = data.textDepth || types.length;
    const sectionTokens = tokens.length >= depth ? tokens.slice(0, depth - 1) : tokens;
    const sectionRef = base + (sectionTokens.length ? ' ' + sectionTokens.join(':') : '');
    const format = (value, i) => types[i] === 'Talmud'
      ? `${Math.ceil(value / 2)}${value % 2 ? 'a' : 'b'}` : String(value);
    const sectionPositions = positions.slice(0, sectionTokens.length);
    let siblingsHe = data.he, siblingsEn = data.text;
    for (const pos of sectionPositions.slice(0, -1)) {
      siblingsHe = Array.isArray(siblingsHe) ? siblingsHe[pos - 1] : [];
      siblingsEn = Array.isArray(siblingsEn) ? siblingsEn[pos - 1] : [];
    }
    const siblingRef = direction => {
      if (!sectionPositions.length) return null;
      const current = sectionPositions[sectionPositions.length - 1];
      const length = Math.max(siblingsHe?.length || 0, siblingsEn?.length || 0);
      for (let n = current + direction; n >= 1 && n <= length; n += direction) {
        if (hasText(siblingsHe?.[n - 1]) || hasText(siblingsEn?.[n - 1])) {
          const address = [...sectionPositions.slice(0, -1), n].map(format).join(':');
          return base + ' ' + address;
        }
      }
      return null;
    };
    return { ...data, ref, sectionRef, sections: positions, toSections: positions,
      he: pick(data.he), text: pick(data.text), next: siblingRef(1), prev: siblingRef(-1) };
  }
  async function offlineJSON(path) {
    if (!root.caches) return null;
    const match = path.match(/^\/api\/(v3\/texts|texts)\/(.+?)(?:\?|$)/);
    if (!match) return null;
    const ref = decodeURIComponent(match[2]).replace(/_/g, ' ');
    const meta = await root.caches.open('rtl-meta'), cache = await root.caches.open('rtl-external');
    const candidates = [];
    for (const collection of COLLECTIONS) {
      const stored = await meta.match(`packs/${collection.id}.json`);
      if (!stored) continue;
      const pack = await stored.json();
      if (pack.revision !== REVISION) continue;
      for (const book of pack.books || []) for (const node of book.nodes || [])
        if (ref === node || ref.startsWith(node + ' ')) candidates.push({ node, book });
    }
    candidates.sort((a, b) => b.node.length - a.node.length);
    for (const { node, book } of candidates) {
      const response = await cache.match(wholeTextUrl(node), { ignoreVary: true });
      if (!response) continue;
      const sliced = sliceText(await response.json(), ref);
      if (!sliced) continue;
      if (match[1] === 'texts') return sliced;
      const versions = [];
      if (hasText(sliced.he)) versions.push({ language: 'he', languageFamilyName: 'hebrew', direction: 'rtl',
        text: sliced.he, versionTitle: sliced.heVersionTitle, versionSource: sliced.heVersionSource, license: sliced.heLicense });
      if (hasText(sliced.text)) versions.push({ language: 'en', languageFamilyName: 'english', direction: 'ltr',
        text: sliced.text, versionTitle: sliced.versionTitle, versionSource: sliced.versionSource, license: sliced.license });
      return { ...sliced, book: book.title, indexTitle: book.title, versions };
    }
    return null;
  }
  async function createZipSink() {
    // OPFS stores the compressed archive on disk rather than retaining an
    // entire Bavli/commentary ZIP in the browser's JavaScript heap.
    if (root.navigator?.storage?.getDirectory) {
      try {
        const directory = await (await root.navigator.storage.getDirectory()).getDirectoryHandle('akiva-zip-output', { create: true });
        const filename = `archive-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`;
        const handle = await directory.getFileHandle(filename, { create: true });
        const writer = await handle.createWritable();
        return { write: bytes => writer.write(bytes),
          finish: async () => {
            await writer.close();
            const file = await handle.getFile();
            // OPFS files normally have an empty MIME type. Supply the ZIP type
            // without reading the whole archive back into memory.
            return file.slice(0, file.size, 'application/zip');
          },
          abort: async () => { try { await writer.abort(); } catch {} try { await directory.removeEntry(filename); } catch {} },
          cleanup: () => directory.removeEntry(filename).catch(() => {}) };
      } catch {} // A restricted browser can still build smaller ZIPs in memory.
    }
    const parts = []; let bytes = 0;
    return { write: async chunk => {
      bytes += chunk.length;
      if (bytes > 256 * 1048576) throw Error('This ZIP needs a browser with disk storage support. Try Chrome on your device or a computer.');
      parts.push(chunk);
    }, finish: async () => new Blob(parts, { type: 'application/zip' }), abort: async () => { parts.length = 0; }, cleanup: async () => {} };
  }
  const exported = { API, REVISION, COLLECTIONS, flattenCatalog, collectionBooks, leafRefs,
    validWholeText, archivePath, indexUrl, shapeUrl, wholeTextUrl, hasText, prepare, sliceText, offlineJSON, createZipSink };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.SefariaPacks = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);

# Keeping the MCP server healthy as the library grows

The Kisvei Rav Tzadok MCP server is a Cloudflare Worker (`cloudflare/worker.mjs` → `cloudflare/mcp.mjs`) that reads the
library data GitHub Pages publishes under `mcp-data/`. A Worker has **128 MB of memory** and a **CPU-time limit per
request**; past either, Cloudflare ends the request and Claude sees "Service Unavailable". Every new book, translation,
footnote and Sefaria link makes the data larger, so three guards keep it inside those limits.

## How the server reads the data
- `mcp-data/search/<slug>.json` — each paragraph's Hebrew, English and headings already in search form; `<slug>.notes.json`
  the footnotes. `kisvei_search` scans these, one book at a time, never the full texts. Large books are split into parts.
- `mcp-data/text-chunks/<slug>/` — the book's paragraphs in ~400 KB pieces plus `refs.json`; tools read only the
  paragraphs they show (a maamar, a page of results), not the whole book.
- Both are built by `scripts/build-mcp-search-index.mjs` (run by `build-mcp-index.mjs` and by every Mafteach release).
  If they are missing, the server falls back to the whole-book files (slower, but correct).

## The guards
1. **Before publishing — `scripts/test-mcp-budget.mjs`** (Pages build and every Mafteach release). Calls every tool in a
   128 MB heap, one fresh process per call, and fails the publication if a call errors or uses more than 1.5 s of CPU,
   if a book's index is missing or out of step with its text, if a new data file passes 10 MB, or if one library-wide
   search would read more than 60 MB of index.
2. **After publishing and every 6 hours — `.github/workflows/mcp-health.yml`** runs `scripts/check-live-mcp.mjs`
   against the live server (all 11 tools). On failure it opens an issue labelled `mcp-health` (GitHub emails the owner);
   it closes the issue when the server recovers. Run it by hand from the Actions tab ("MCP health check").
3. **Early warning.** When a library-wide search reads more than 45 MB of index the budget test prints a warning
   (`time to add a word index`). That is the moment to add an inverted word index, so a search reads only the entries
   for its words — before anything fails.

## When adding a book or an edition
Nothing extra: the build and release run the index, the chunks and the budget test. If the budget test fails, the
publication stops and the live site keeps the previous, working data; its message says which limit was passed.

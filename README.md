# Akiva Publishing — Kisvei Rav Tzadok

Production site and Torah-library MCP integration, hosted **without Netlify**.

## Live hosting

- **Website**: https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/
- **Library and interlinear reader**: https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/library/
- **MCP server**: https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/mcp
- **MCP health check**: https://akiva-publishing-kisvei-rav-tzadok.akivagutnicki.workers.dev/health

## Deployments

- Changes pushed to `main` deploy the static website with **GitHub Actions → Deploy Akiva Publishing to GitHub Pages** (`.github/workflows/pages.yml`). Its build generates `dist/library/data` and `dist/mcp-data` from the source texts and checks the interlinear publications and MCP server.
- The GitHub-connected **Cloudflare Worker** deploys the MCP API defined by `cloudflare/worker.mjs` and `cloudflare/mcp.mjs` using `wrangler.jsonc`.
- Cloudflare reads the published GitHub Pages MCP catalog and text JSON. Publish the GitHub Pages build before relying on a newly added sefer through MCP.
- The six MCP tools are currently read-only: listing books, browsing the contents, retrieving text, searching, finding citing passages, and retrieving cited sources. Publishing/updating sefarim is handled by the GitHub source and deployment process, not a public write-enabled MCP tool.

## Mobile reader

Open the `/library/` address from Chrome or another mobile browser. It is an installable web app with a service worker.

## ZIP downloads

The reader's **ZIP ↓** button opens `#/downloads`, with the complete library and individual sefer archives. Sefer ZIP links also appear on book contents pages and in the reading toolbar. Archives include the published Hebrew, available translations, footnotes, citations, parallels and available Word/PDF editions. They contain reader text data, rather than a standalone offline website; use the reader's offline controls for offline reading in the app.

After building the library and parallels, run `node scripts/build-library-zips.mjs` and `node scripts/test-library-zips.mjs`. The Pages workflow runs these steps automatically. This refreshes the offline file manifest and produces `dist/library/downloads/index.json`, `rav-tzadok-library.zip` and `books/<slug>.zip` from the final published data.

The Downloads page and home-page offline panel also offer **Tanach, Bavli, Yerushalmi and Midrashim with meforshim**. These collections include all available Sefaria works under the respective catalog branches, plus dependent supercommentaries, rather than only base-text chapters. The ZIP button downloads complete text nodes using the v1 API with `pad=0`, retaining introductions, appendices, original Hebrew, available English and version/license metadata. Successful nodes remain in the offline cache so Stop and retry resume the collection. A dated catalog snapshot is refreshed from Sefaria on a new download. The ZIP includes a coverage manifest and refuses to present an incomplete collection as complete. Browsers supporting OPFS write the compressed archive to disk to avoid holding a large commentary corpus in memory. Run `node scripts/test-sefaria-packs.mjs` to verify the collection coverage and exporter.

## Legacy hosting retirement

The old Netlify site's deployment connection needs to be stopped or removed separately in the Netlify dashboard. Removing the Netlify configuration from this repository does **not** automatically unlink or delete the old Netlify project. Once the replacement site and endpoint are checked, unlink the Git provider and pause builds or delete the old project there. Links ending in `.netlify.app` won't redirect after the project is deleted; replace bookmarks or links that still reference them.

For a Cloudflare-only MCP deployment guide, see [cloudflare/README.md](cloudflare/README.md).

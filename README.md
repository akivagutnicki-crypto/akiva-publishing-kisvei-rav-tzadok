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

Native Android APK and Play AAB builds are produced by the [GitHub Actions Android workflow](https://github.com/akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok/actions/workflows/android-apk.yml). Android version 1.0.5 (`versionCode` 6) opens this GitHub Pages library—not Netlify—and uses the same `org.akivapublishing.reader` application ID. Download the builds from the latest successful Android workflow's `akiva-android-github-pages-build` artifact. Release-signed packages are published to [GitHub Releases](https://github.com/akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok/releases) if the existing release key is configured in GitHub Actions secrets. Otherwise the workflow provides unsigned APK/AAB builds and an emulator-only test APK. See [android/README.md](android/README.md) for signing and installation details.

## ZIP downloads

The reader's **ZIP ↓** button opens `#/downloads`, with the complete library and individual sefer archives. Sefer ZIP links also appear on book contents pages and in the reading toolbar. Archives include the published Hebrew, available translations, footnotes, citations, parallels and available Word/PDF editions. They contain reader text data, rather than a standalone offline website; use the reader's offline controls for offline reading in the app.

After building the library and parallels, run `node scripts/build-library-zips.mjs` and `node scripts/test-library-zips.mjs`. The Pages workflow runs these steps automatically. This refreshes the offline file manifest and produces `dist/library/downloads/index.json`, `rav-tzadok-library.zip` and `books/<slug>.zip` from the final published data.

The Downloads page and home-page offline panel offer ready-made **Tanach, Bavli, Yerushalmi and Midrashim ZIPs with meforshim**. `python scripts/build-sefaria-zips.py` builds them from [Sefaria's official public exports](https://github.com/Sefaria/Sefaria-Export), using the checked-in `sources/akiva/packs/exports.json.gz` inventory. Every available Hebrew and English edition and book schema is copied byte for byte, including complex works' introductions, appendices, attribution and license metadata. Related supercommentaries are included. Missing source files fail the build. Each archive contains a coverage manifest, source URLs and SHA-256 checksums; titles unavailable in the public export are listed explicitly. Downloads start directly from the existing site, without requiring Sefaria API access or building a large ZIP in the browser. The Pages workflow caches verified export files and runs `python scripts/test-sefaria-zips.py` to check all editions, classical meforshim and final passages. The separate Save-in-app controls continue to use the live Sefaria API with resumable offline caching; `node scripts/test-sefaria-packs.mjs` verifies that exporter.

## Legacy hosting retirement

The old Netlify site's deployment connection needs to be stopped or removed separately in the Netlify dashboard. Removing the Netlify configuration from this repository does **not** automatically unlink or delete the old Netlify project. Once the replacement site and endpoint are checked, unlink the Git provider and pause builds or delete the old project there. Links ending in `.netlify.app` won't redirect after the project is deleted; replace bookmarks or links that still reference them.

For a Cloudflare-only MCP deployment guide, see [cloudflare/README.md](cloudflare/README.md).

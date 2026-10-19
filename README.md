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

The **Sources cited in the library** ZIP exports the successfully saved citation texts even when a few sources could not be downloaded. An incomplete export is named `rav-tzadok-sources-partial-<date>.zip` and contains `manifest.json` and `missing-sources.txt` listing every missing or invalid response. Saved text and license metadata are copied unchanged. Tap Download to retry missing sources, then create another ZIP. Complete meforshim exports retain their strict coverage checks. Device ZIPs have an explicit `application/zip` MIME type, including the OPFS path used on phones and computers. Run `node scripts/test-source-zip-export.mjs` to reproduce the 8,915-saved/111-missing case.

## Reviewed source connections

The reader uses one shared matcher for source lookups, underlined source citations, and linked footnote sources. Connections to **Kisvei Rav Tzadok** and **Ishbitz–Radzin** come from individually reviewed records in `sources/akiva/connections/*.json`. Each record provides the cited source in Hebrew and English, an exact passage from the connected sefer with its English translation, an explanation of the specific relationship, and translation provenance. A shared word or a citation to the same daf does not approve a connection.

Each editorial file has `schemaVersion: 1` and a `records` array. Required record fields are `id`, `sourceRefs`, `sourceHebrew`, `sourceEnglish`, `sourceUrl`, `targetRef`, `targetHebrew`, `targetEnglish`, `school`, `explanation`, `focusTerms`, `translationProvenance`, `reviewedTargetHebrewSha256`, `reviewedSourceHebrewSha256`, and `reviewed: true`. The school is exactly `Kisvei Rav Tzadok` or `Ishbitz–Radzin`. `originRefs` may additionally identify exact reviewed originating paragraphs. References retain their full segment or range: for example, a Bavli source must identify a segment rather than an entire daf. Context terms narrow a connection to the relevant originating discussion; they do not create or approve it.

The [editorial review workflow](sources/akiva/connections/README.md) governs new records and later corrections. Candidate searches stay separate from approved inputs; source co-occurrence, keyword scores, or a successful machine check never promote a candidate into the published catalog. Changed attributions, translations, or surrounding text require renewed contextual review.

`scripts/build-reviewed-connections.mjs` runs after the final source-quotation publication, refreshed MCP indexes, and preservation checks. It requires every `targetRef` to exist as an exact canonical paragraph, and every `sourceRefs` entry to resolve to a saved primary proof in `sources/akiva/connections/evidence/`. A proof records `ref`, `apiUrl`, `versionTitle`, `verifiedAt`, and the full relevant `hebrew` text as a string or ordered array. Both selected Hebrew quotations must occur contiguously at whole-word boundaries in their respective evidence, allowing only HTML, nikkud, punctuation, and whitespace normalization; consonantal spelling, final letters, and word order remain exact. Hashes of the full reviewed primary-source Hebrew and canonical target paragraph prevent unchanged excerpts from silently reapproving changed surrounding arguments. The builder rejects missing or mismatched primary proofs, false context pins, missing translations, placeholders, mismatched schools or source URLs, duplicate source-to-target records, and records without explicit editorial approval. Complete short quotations are accepted without an arbitrary minimum word count. Relevance and translation judgments are recorded as editorial review; their presence is not presented as an automatic scholarly assessment.

The generated `dist/library/source-connections/catalog.json` records SHA-256 evidence for the editorial file, each saved primary-source proof file, the full primary Hebrew, final canonical paragraph, selected Hebrew quotations, and both English translations. Its version changes when the reviewed contents or evidence changes. Re-read changed source or target context before updating either review pin; never refresh a failed pin automatically. This catalog sits outside `library/data`, preserving the existing chapter, footnote, offline-download, and source-quotation proof inventories. The reader's service worker stores the separate matcher and catalog for source lookups in the installed reader.

After the normal final source-quotation build, run:

```sh
node scripts/build-reviewed-connections.mjs
node scripts/test-reviewed-connections.mjs
node scripts/test-reviewed-connections-reader.mjs
node scripts/test-reviewed-source-rendering.mjs
```

`node scripts/test-reviewed-connections.mjs --fixtures-only` exercises incorrect references, missing or mismatched primary proofs, noncontiguous or respelled source and target quotations, false source and target pins, unchanged excerpts within changed surrounding text, missing translations, unreviewed records, duplicates, unrelated context, and exact segment/range matching without rebuilding the library. `test-reviewed-source-rendering.mjs` extracts the shipped source loader into an isolated Node VM and checks exact local paragraph selection, ranges across chapters, missing translations, and the separate treatment of footnote excerpts. The Pages workflow also compares the live catalog and matcher with the verified local release using `--url`. Reviewed connection output does not require a Cloudflare Worker change; the sidebar reads the static GitHub Pages resources directly.

## Legacy hosting retirement

The old Netlify site's deployment connection needs to be stopped or removed separately in the Netlify dashboard. Removing the Netlify configuration from this repository does **not** automatically unlink or delete the old Netlify project. Once the replacement site and endpoint are checked, unlink the Git provider and pause builds or delete the old project there. Links ending in `.netlify.app` won't redirect after the project is deleted; replace bookmarks or links that still reference them.

For a Cloudflare-only MCP deployment guide, see [cloudflare/README.md](cloudflare/README.md).

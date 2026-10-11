# Akiva Publishing MCP on Cloudflare Workers (no Netlify required)

This adapter hosts the **existing, read-only** Kisvei Rav Tzadok MCP tools on Cloudflare Workers.
It reads the same catalog, interlinear text, source citations, and links served by the GitHub Pages reader.

- Website/data: https://akivagutnicki-crypto.github.io/akiva-publishing-kisvei-rav-tzadok/
- MCP handler: `cloudflare/mcp.mjs` (independent of the old Netlify deployment)
- Cloudflare entry: `cloudflare/worker.mjs`
- Cloudflare configuration: `wrangler.jsonc`
- Worker name: `akiva-publishing-mcp`
- MCP path: `/mcp`

## One-time setup — works in Chrome on Android/tablet

1. Log in or create a **free** account at https://dash.cloudflare.com/.
2. Open **Workers & Pages**, choose **Create application → Import a repository**.
3. Connect **GitHub** and select `akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok`.
4. Choose **Workers**, branch `main`, repository root (where `wrangler.jsonc` resides).
5. The Worker name must be **akiva-publishing-mcp**, matching `wrangler.jsonc`.
6. If Cloudflare asks for build/deploy commands: no separate build command is required for this Worker; use `npx wrangler deploy` as its deploy command. Keep `wrangler.jsonc` as the source of configuration.
7. Save and deploy. Cloudflare gives you a URL ending in `.workers.dev`.
8. Your MCP endpoint is **that URL plus `/mcp`**. Paste this URL into Claude's Custom Connector. For ChatGPT, create or connect a hosted ChatGPT App using that MCP URL; updating a desktop-only imported plugin does not make it mobile-compatible.

## Data source and release process

The GitHub Pages action (`.github/workflows/pages.yml`) generates `dist/library/data` and `dist/mcp-data`.
The Worker fetches data from `MCP_SITE_ORIGIN` defined in `wrangler.jsonc`. Its base path is part of the URL, so it works on GitHub Pages project sites.
GitHub Pages must be deployed and responding with `/mcp-data/catalog.json` **before** the Cloudflare server can answer book queries.

A `GET /mcp` response of HTTP 405 is normal; MCP clients use **POST**. Example read-only tools:
`kisvei_list_books`, `kisvei_get_contents`, `kisvei_get_text`, `kisvei_search`,
`kisvei_find_citing_passages`, `kisvei_get_cited_sources`.

To test from an MCP client, first call `tools/list`, then `kisvei_list_books`. No publishing/write tool is currently exposed.

## Troubleshooting

- If tools/list works but get_text fails, verify the GitHub Pages static URL `mcp-data/catalog.json` is live.
- If Cloudflare's build fails, check the Worker name, repository root, and `wrangler.jsonc` selection.
- If Cloudflare's Worker deploy succeeds but Android still says "Open in desktop app", that is the old ChatGPT imported plugin. ChatGPT requires a hosted App/plugin connection rather than that desktop-only package.
- The free plan has request and CPU usage limits; large corpus searches should be monitored after first deployment.

No Netlify billing or secret API token is required for these read-only tools.

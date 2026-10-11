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

## Legacy hosting retirement

The old Netlify site's deployment connection needs to be stopped or removed separately in the Netlify dashboard. Removing the Netlify configuration from this repository does **not** automatically unlink or delete the old Netlify project. Once the replacement site and endpoint are checked, unlink the Git provider and pause builds or delete the old project there. Links ending in `.netlify.app` won't redirect after the project is deleted; replace bookmarks or links that still reference them.

For a Cloudflare-only MCP deployment guide, see [cloudflare/README.md](cloudflare/README.md).

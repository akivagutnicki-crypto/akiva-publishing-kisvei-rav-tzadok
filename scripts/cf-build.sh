#!/usr/bin/env bash
# Run by `wrangler deploy` (wrangler.jsonc "build") in Cloudflare Workers Builds: fetch the current publication from
# the site-latest release (made by .github/workflows/site-mirror.yml) into ./site, the Worker's static assets.
set -euo pipefail
URL=https://github.com/akivagutnicki-crypto/akiva-publishing-kisvei-rav-tzadok/releases/download/site-latest
rm -rf site && mkdir site
curl -fsSL --retry 4 --retry-delay 5 "$URL/site.tar.gz" | tar xz -C site
test -f site/index.html && test -f site/library/index.html
cp site/_big-files.json cloudflare/big-files.json
echo "site: $(find site -type f | wc -l) files, $(du -sh site | cut -f1)"

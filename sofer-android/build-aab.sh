#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
# For an existing package, keep the original upload keystore and bump appVersionCode.
npx --yes @bubblewrap/cli@1.24.1 update --manifest=twa-manifest.json
npx --yes @bubblewrap/cli@1.24.1 build

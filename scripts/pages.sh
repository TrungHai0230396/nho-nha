#!/usr/bin/env bash
# The front door at https://nho-nha.pages.dev (pages/): only when
# pages/public/_worker.js itself changes. An app update is scripts/deploy.sh
# alone, since the door hands everything to the Worker.
#
#   scripts/pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/chung.sh

login
# From pages/, so wrangler reads pages/wrangler.jsonc (the service binding).
# Never `wrangler deploy` there: the Worker is called nho-nha too.
cd pages
../node_modules/.bin/wrangler pages deploy --branch main

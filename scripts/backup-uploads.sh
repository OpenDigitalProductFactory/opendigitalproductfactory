#!/bin/sh
# Managed-engine entry point for the upload-store backup (BI-1C6BF6B6).
# The engine runs scripts through /bin/sh; the writer itself is backup-uploads.mjs.
set -eu
exec node "$(dirname "$0")/backup-uploads.mjs"

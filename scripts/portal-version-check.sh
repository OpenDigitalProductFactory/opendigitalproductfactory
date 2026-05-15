#!/usr/bin/env bash
# Compare the running portal's stamped image version to local origin/main
# and report drift. The fast way to catch the multi-worktree :latest-clobber
# bug (concurrent worktree builds overwriting each other's image tag).
#
# Usage:
#   scripts/portal-version-check.sh                          # localhost:3000
#   scripts/portal-version-check.sh http://192.168.0.200:3000
#
# Exit codes:
#   0  match
#   1  drift (image != origin/main)
#   2  incomparable (image stamped with content-hash, not a SHA)
#   3  unreachable (portal not serving / no version file)

set -uo pipefail

portal_url="${1:-http://localhost:3000}"
endpoint="${portal_url%/}/api/platform/image-version"

response=$(curl -sf --max-time 5 "$endpoint" 2>/dev/null || true)
if [ -z "$response" ]; then
  echo "[version-check] Portal unreachable at $endpoint"
  exit 3
fi

present=$(printf '%s' "$response" | sed -nE 's/.*"present":(true|false).*/\1/p')
if [ "$present" != "true" ]; then
  echo "[version-check] Portal reports no .dpf-image-version file (not a built image)."
  exit 3
fi

image_version=$(printf '%s' "$response" | sed -nE 's/.*"version":"([^"]+)".*/\1/p')
image_source=$(printf '%s' "$response" | sed -nE 's/.*"source":"([^"]+)".*/\1/p')

expected=$(git rev-parse origin/main 2>/dev/null || true)
if [ -z "$expected" ]; then
  echo "[version-check] Unable to resolve origin/main locally; cannot compare."
  echo "[version-check] Portal reports: $image_version (source=$image_source)"
  exit 2
fi

echo "[version-check] Portal image source : $image_source"
echo "[version-check] Portal image version: $image_version"
echo "[version-check] Local origin/main   : $expected"

if [ "$image_source" != "git-sha" ]; then
  echo "[version-check] Image was built without DPF_VERSION (content-hash fallback) - cannot compare to a SHA. Rebuild with scripts/build-images.sh to stamp a git SHA."
  exit 2
fi

if [ "$(printf '%s' "$image_version" | tr 'A-F' 'a-f')" = "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" ]; then
  echo "[version-check] MATCH - portal is serving origin/main."
  exit 0
fi

echo "[version-check] DRIFT - portal is NOT serving origin/main."
echo "[version-check] Rebuild with: scripts/build-images.sh (then docker compose up -d portal portal-init)"
exit 1

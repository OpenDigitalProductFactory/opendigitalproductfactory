#!/bin/sh
# scripts/link-web-src-workspace.sh — BI-3F16A430
#
# Make the /app/apps/web-src source snapshot inside the portal image able to
# resolve its @dpf/* workspace dependencies.
#
# The runner stage re-installs node_modules to the `@dpf/db...` runtime set
# (Dockerfile "Runtime dependency set"), so /app/node_modules carries NO
# @dpf/* links, and web-src is a bare COPY with no node_modules of its own.
# Any script run from web-src that imports a workspace package — the MCP token
# issuer (apps/web/scripts/issue-mcp-token.ts -> @dpf/db,
# @dpf/integration-shared) being the one the bootstrap depends on — fails with
# "Cannot find module '@dpf/...'". The packages themselves ARE in the image at
# /app/packages; only the resolution hop is missing.
#
# Runs (a) at image build (Dockerfile runner stage) and (b) from the host
# bootstrap via `docker exec -i <portal> sh -s < this-file` so an image built
# before this script shipped is repaired in place. Idempotent; symlinks only;
# excluded from the source-content hash (not `-type f`).
#
# Env: DPF_WEB_SRC (default /app/apps/web-src), DPF_PACKAGES (default /app/packages).
set -eu

WEB_SRC="${DPF_WEB_SRC:-/app/apps/web-src}"
PACKAGES="${DPF_PACKAGES:-/app/packages}"

[ -d "$WEB_SRC" ] || { echo "link-web-src-workspace: $WEB_SRC not present" >&2; exit 2; }
[ -d "$PACKAGES" ] || { echo "link-web-src-workspace: $PACKAGES not present" >&2; exit 2; }

mkdir -p "$WEB_SRC/node_modules/@dpf"
linked=0
for dir in "$PACKAGES"/*/; do
  [ -f "$dir/package.json" ] || continue
  name="$(node -p 'require(process.argv[1]).name' "$dir/package.json" 2>/dev/null || true)"
  case "$name" in
    @dpf/*) ;;
    *) continue ;;
  esac
  target="$WEB_SRC/node_modules/$name"
  src="${dir%/}"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$src" ]; then
    continue
  fi
  rm -rf "$target"
  ln -s "$src" "$target"
  linked=$((linked + 1))
done
echo "link-web-src-workspace: $linked workspace link(s) created under $WEB_SRC/node_modules/@dpf"

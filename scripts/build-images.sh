#!/usr/bin/env bash
# Build dpf-portal / dpf-portal-init / dpf-sandbox images with the current
# git HEAD stamped into /app/.dpf-image-version.
#
# Wraps `docker compose build` so DPF_VERSION is always set to the full git
# SHA of the working tree's HEAD. Without this wrapper, concurrent worktrees
# building from divergent checkouts can each tag :latest and silently
# overwrite each other; the resulting image's source identity is then
# unrecoverable. With this wrapper, /api/platform/image-version always
# reports a comparable SHA.
#
# Usage:
#   scripts/build-images.sh                       # portal + portal-init
#   scripts/build-images.sh --no-cache            # bypass BuildKit cache
#   scripts/build-images.sh portal sandbox        # custom service list

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

sha="$(git rev-parse HEAD)"
export DPF_VERSION="$sha"
echo "[build-images] Stamping images with DPF_VERSION=$sha"

# Real platform version from the repo's git release tags (e.g. "5.6.0" or
# "5.6.0-35-gbcaa30a8"). This is the authoritative version shown in the portal.
platform_version="$(git describe --tags --always 2>/dev/null | sed 's/^v//' || true)"
if [ -n "$platform_version" ]; then
  export DPF_PLATFORM_VERSION="$platform_version"
  echo "[build-images] Stamping images with DPF_PLATFORM_VERSION=$platform_version"
fi

# Pass-through CLI args: anything before the first non-flag is treated as a
# docker-compose flag (e.g. --no-cache, --pull); the rest are service names.
# When no service names are given, default to portal + portal-init.
declare -a flags=()
declare -a services=()
for arg in "$@"; do
  case "$arg" in
    --*|-*) flags+=("$arg") ;;
    *)      services+=("$arg") ;;
  esac
done
if [ "${#services[@]}" -eq 0 ]; then
  services=(portal portal-init)
fi

exec docker compose build "${flags[@]}" "${services[@]}"

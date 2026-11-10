#!/usr/bin/env bash
# Customer prerequisite: the repository owns the pnpm version, not npm latest.
dpf_ensure_pnpm() {
  local package_manager version installed
  package_manager="$(node -p 'require(process.argv[1]).packageManager' "$1/package.json")" || return 1
  case "$package_manager" in pnpm@*) ;; *) echo "Missing pnpm packageManager pin." >&2; return 1 ;; esac
  version="${package_manager#pnpm@}"
  version="${version%%+*}"
  if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "Invalid pnpm packageManager pin." >&2; return 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "Installing pnpm $version from the repository pin."
    npm install -g "pnpm@$version" || return 1
  fi
  installed="$(pnpm --version)" || return 1
  if [ "$installed" != "$version" ]; then
    echo "pnpm $version is required; found $installed. Select the pinned version and retry." >&2
    return 1
  fi
}

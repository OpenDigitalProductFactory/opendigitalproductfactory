#!/bin/sh
# post-checkout-chained.sh: Git LFS + DPF uncommitted-work guard (BI-38578194).
#
# The hook file named post-checkout is gitignored (git-lfs generates it).
# postinstall converges the shim to delegate here so enforcement ships via git.

command -v git-lfs >/dev/null 2>&1 || {
  printf >&2 "\n%s\n\n" "This repository is configured for Git LFS but 'git-lfs' was not found on your path. If you no longer wish to use Git LFS, remove this hook by deleting the 'post-checkout' file in the hooks directory (set by 'core.hookspath'; usually '.git/hooks')."
  exit 2
}
git lfs post-checkout "$@" || exit $?

if command -v node >/dev/null 2>&1; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || REPO_ROOT=""
  GUARD="$REPO_ROOT/packages/dpf-skill-pack/hooks/uncommitted-work-guard.mjs"
  if [ -n "$REPO_ROOT" ] && [ -f "$GUARD" ]; then
    node "$GUARD" --git-hook post-checkout --repo-root "$REPO_ROOT" || true
  fi
fi

exit 0
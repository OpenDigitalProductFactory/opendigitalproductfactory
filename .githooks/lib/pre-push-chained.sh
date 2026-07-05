#!/bin/sh
# pre-push-chained.sh: Git LFS transfer + DPF local-CI sandbox gate
# (BI-C74F4DE9) — the TRACKED body of the pre-push hook.
#
# git invokes only the hook named `pre-push` on push, and that file is
# gitignored because git-lfs generates it locally (.gitignore "Git LFS writes
# generated hook shims"). The postinstall step (scripts/set-hooks-path.mjs)
# converges the ignored shim to delegate here, so the enforced logic ships via
# git while the local file stays LFS-compatible. Order matters: LFS first (it
# uploads objects during pre-push and must keep its exact stdin contract),
# then the gate (.githooks/pre-push-gate).
#
# stdin carries the "<local ref> <local sha> <remote ref> <remote sha>" lines
# once; both halves need them, so capture and replay.

refs_input="$(cat)"

command -v git-lfs >/dev/null 2>&1 || { printf >&2 "\n%s\n\n" "This repository is configured for Git LFS but 'git-lfs' was not found on your path. If you no longer wish to use Git LFS, remove this hook by deleting the 'pre-push' file in the hooks directory (set by 'core.hookspath'; usually '.git/hooks')."; exit 2; }
if [ -n "$refs_input" ]; then
  printf '%s\n' "$refs_input" | git lfs pre-push "$@" || exit $?
else
  printf '' | git lfs pre-push "$@" || exit $?
fi

# This file lives at .githooks/lib/; the gate is its sibling one level up.
script_dir="$(dirname "$0")"
gate="$script_dir/../pre-push-gate"
[ -f "$gate" ] || gate="$script_dir/pre-push-gate"
if [ -f "$gate" ]; then
  if [ -n "$refs_input" ]; then
    printf '%s\n' "$refs_input" | sh "$gate" "$@" || exit $?
  else
    printf '' | sh "$gate" "$@" || exit $?
  fi
fi

exit 0

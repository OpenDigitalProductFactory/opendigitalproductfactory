#!/usr/bin/env bash
# Open Digital Product Factory — collision-free dev worktree starter (POSIX shell)
#
# Creates an ISOLATED git worktree off origin/main and seeds its MCP config, so
# feature/fix/doc work never happens in the shared root clone.
#
# WHY THIS EXISTS
#   The root clone (~/dpf) is NOT a safe place to do active work. It is owned by:
#     1. the self-upgrade loop — prepare-source.ts does `git checkout dpf/install`
#        + `git merge` on the root to build each upgrade (it defers on *tracked*
#        uncommitted changes, but the root still moves branches under you); and
#     2. other concurrent agent sessions, which `git checkout <their-branch>` and
#        `git reset` the root.
#   Either will roll back / discard work that lives in the root. A linked worktree
#   has its own working tree + HEAD, so neither touches it. This is the
#   "keep-root-clone-as-merge-worktree" + "worktree-per-session" principles, made
#   into one command.
#
# USAGE
#   ./scripts/new-dev-worktree.sh <slug> [branch-prefix]
#       <slug>          short kebab name, e.g. report-kit-charts
#       [branch-prefix] branch namespace, default "feat" → feat/<slug>
#
# EXAMPLE
#   ./scripts/new-dev-worktree.sh invoice-pdf-export fix
#   # → ~/dpf-worktrees/invoice-pdf-export on branch fix/invoice-pdf-export

set -euo pipefail

slug="${1:-}"
prefix="${2:-feat}"

if [ -z "$slug" ]; then
    printf 'usage: %s <slug> [branch-prefix]\n' "$0" >&2
    exit 1
fi

# Resolve the TRUE root clone (the main worktree), regardless of whether this
# script is invoked from the root or from an existing linked worktree. The first
# `worktree` entry in porcelain output is always the main worktree.
script_dir="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$script_dir" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
if [ -z "${root:-}" ] || [ ! -e "$root/.git" ]; then
    printf '  [FAIL] could not resolve the root clone from %s\n' "$script_dir" >&2
    exit 1
fi

# Worktrees live in a sibling "<root>-worktrees" dir (matches ~/dpf-worktrees).
wt_base="$(dirname "$root")/$(basename "$root")-worktrees"
target="$wt_base/$slug"
branch="$prefix/$slug"

mkdir -p "$wt_base"

# Always base new work on the freshest pushed main.
git -C "$root" fetch origin --quiet

if [ -d "$target" ]; then
    printf '  [skip] worktree already exists: %s\n' "$target"
else
    # Reuse the branch if it already exists (e.g. resuming); otherwise create it
    # off origin/main. -b fails on an existing branch, so branch on existence.
    if git -C "$root" rev-parse --verify --quiet "refs/heads/$branch" >/dev/null; then
        git -C "$root" worktree add "$target" "$branch"
    else
        git -C "$root" worktree add "$target" -b "$branch" origin/main
    fi
fi

# Seed MCP config (.mcp.json / .vscode + worktree-scoped COMPOSE_PROJECT_NAME) so
# the dpf connector and isolated compose stack work in the new worktree.
if [ -x "$root/scripts/seed-worktree-mcp.sh" ]; then
    "$root/scripts/seed-worktree-mcp.sh" "$target" || \
        printf '  [warn] MCP seed skipped (root .mcp.json not present yet)\n' >&2
fi

cat <<EOF

  ✓ Collision-free worktree ready
    path:   $target
    branch: $branch  (off origin/main)

  Next:
    cd "$target"

  Discipline (the root clone $root is reset by the self-upgrade loop and other
  sessions — uncommitted work there is lost):
    • do ALL edits in the worktree, never in the root
    • commit + push FREQUENTLY (after every logical step), so nothing lives only
      in a working tree
    • open the PR from the worktree

  When the PR is merged:
    git -C "$root" worktree remove "$target"
EOF

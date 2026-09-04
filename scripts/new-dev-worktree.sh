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

# BI-0856A4CE Phase 1 — when DPF_DEV_WORKSPACE_PATH is set + distinct from the
# install ($root), branch worktrees off the DEV WORKSPACE clone instead. This is
# the contributor's writable tree; $root in that posture is the production
# install (read-only by convention, owned by the platform / self-upgrade loop).
#
# Discovery order:
#   1. DPF_DEV_WORKSPACE_PATH env var (set by .env loaders, or exported manually)
#   2. .env in $root if it carries the line
#   3. fallback: $root itself (single-tree mode — current behavior)
dev_workspace="${DPF_DEV_WORKSPACE_PATH:-}"
if [ -z "$dev_workspace" ] && [ -f "$root/.env" ]; then
    # `|| true` so a missing line under `set -e -o pipefail` does not abort the
    # whole script — the absent env value just leaves $dev_workspace empty and
    # we fall through to single-tree mode below.
    dev_workspace="$( { grep -E '^DPF_DEV_WORKSPACE_PATH=' "$root/.env" 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
if [ -n "$dev_workspace" ] && [ "$dev_workspace" != "$root" ]; then
    if [ ! -d "$dev_workspace/.git" ] && [ ! -f "$dev_workspace/.git" ]; then
        printf '  [FAIL] DPF_DEV_WORKSPACE_PATH=%s is not a git working tree.\n' "$dev_workspace" >&2
        printf '         Either clone the dev workspace there or unset DPF_DEV_WORKSPACE_PATH.\n' >&2
        exit 1
    fi
    printf '  [info] using dev workspace %s (install is %s)\n' "$dev_workspace" "$root"
    root="$dev_workspace"
fi

# Worktrees live in a sibling "<root>-worktrees" dir (matches ~/dpf-worktrees
# in single-tree mode; the dev-workspace's sibling dir when the split is in
# effect — so each contributor's worktrees stay near their dev clone).
wt_base="$(dirname "$root")/$(basename "$root")-worktrees"
target="$wt_base/$slug"
branch="$prefix/$slug"

# Refuse to create a worktree inside the production install path. This is the
# Phase-1 form of the BI-0856A4CE / BI-6B02FEE5 contract: even if the operator
# nudges --dev-workspace-path back to $REPO_ROOT, the worktree-base-is-sibling
# rule keeps the worktree out of the install tree. Full enforcement (refusing
# from ANY caller, including direct `git worktree add`) lands in later phases.
case "$target" in
    "$wt_base"/*) : ;;
    *)
        printf '  [FAIL] computed worktree target %s is not under the worktree base %s\n' "$target" "$wt_base" >&2
        exit 1
        ;;
esac

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

# Claim a Workroom for the new branch (BI-0B292D84 layer 1).
#
# AGENTS.md 12 requires a claim before work on every surface, and the claim
# guard now REFUSES edits on a branch no live claim covers. Bind-at-birth
# landed first in the Claude Code WorktreeCreate hook, which left THIS path --
# the one this runbook documents and the CLI surfaces use -- creating unbound
# worktrees. Coverage reached 95% by reconciliation and fell back to 82% within
# a day as new branches came through here. Automating one of two entry points
# does not automate the obligation.
#
# Never fatal: an unbound worktree is still usable, and creation must not fail
# because the coordination plane is unreachable. The guard is what makes an
# unbound tree consequential.
if [ -f "$root/scripts/bind-worktree-cli.mjs" ] && command -v node >/dev/null 2>&1; then
    node "$root/scripts/bind-worktree-cli.mjs" "$target" "$branch" || true
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

  Source-vs-runtime (read this before you try to 'pnpm dev' here):
    • this worktree is SOURCE-CONTROL isolation, not RUNTIME isolation
    • readiness is recorded in .dpf-worktree-readiness.json:
      - compile-ready: cheap local gates may run here
      - source-only: local gates are unproven; use canonical/local-CI evidence
    • cheap source-local checks are fine in the worktree (targeted unit
      tests, 'pnpm typecheck' on changed packages) only when readiness is
      compile-ready
    • for anything that exercises the running platform (portal routes, MCP
      tools, DB-bound behavior, Build Studio flows), verify against the
      canonical install at $root (or a leased shared nonprod environment),
      NOT a freshly-stood-up runtime inside this worktree
    • if a build/test fails in the worktree because pnpm/corepack isn\'t on
      PATH, workspace symlinks point outside the worktree, the Prisma client
      is missing, or Turbopack rejects a node_modules symlink — that is a
      HARNESS limitation, NOT a product defect; capture canonical-runtime
      evidence in the PR instead, and file a separate platform BI if you
      want the worktree itself to become runnable
    • see AGENTS.md §5 + docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md

  When the PR is merged:
    git -C "$root" worktree remove "$target"
EOF

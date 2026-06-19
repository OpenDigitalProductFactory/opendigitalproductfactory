#!/bin/sh
#
# check-root-clone.sh — refuse feature-branch commits in the primary clone.
#
# The primary (non-linked) working tree is the merge/release clone (AGENTS.md
# §4: "keep the root clone as the merge/release worktree — read-only for active
# feature work"). Active feature work must happen in a topic worktree so two
# concurrent sessions never share one working tree. Sharing the root tree is the
# collision vector behind the EP-F7E35344 incident (multiple sessions committing
# in the same clone, one stomping another's uncommitted changes).
#
# This script is the testable core of pre-commit Guard 0. It takes the current
# git-dir and branch as arguments so it can be exercised in isolation:
#
#   sh check-root-clone.sh "<git-dir>" "<branch>"
#
# Exit 0 = allowed (linked worktree, OR a non-feature branch like main, OR the
# bypass is set). Exit 1 = refused (feature-branch commit in the primary clone).
#
# Bypass for verified maintenance only: DPF_ALLOW_ROOT_CLONE_COMMIT=1.

GIT_DIR_PATH="$1"
CURRENT_BRANCH="$2"

# A linked worktree's git-dir always lives under <common>/worktrees/<name>.
# The primary clone's git-dir does not contain that segment.
case "$GIT_DIR_PATH" in
  */worktrees/*) exit 0 ;;
esac

# Explicit, audited override.
if [ "$DPF_ALLOW_ROOT_CLONE_COMMIT" = "1" ]; then
  exit 0
fi

# Only feature-class branches are refused; the primary clone legitimately sits
# on main for merges/releases, and detached HEAD (rebase/merge) is left alone.
case "$CURRENT_BRANCH" in
  feat/*|fix/*|chore/*|doc/*|clean/*)
    echo ""
    echo "ERROR: refusing a feature-branch commit in the root clone."
    echo ""
    echo "  Branch:  $CURRENT_BRANCH"
    echo "  Tree:    primary working tree (merge/release clone)"
    echo ""
    echo "The root clone is read-only for active feature work (AGENTS.md §4) so"
    echo "concurrent sessions never share one working tree. Do this work in a"
    echo "topic worktree instead:"
    echo ""
    echo "  git worktree add ~/dpf-worktrees/<topic> -b $CURRENT_BRANCH"
    echo "  # Windows: git worktree add D:/DPF-worktrees/<topic> -b $CURRENT_BRANCH"
    echo "  # then run scripts/dpf-bootstrap-agent-toolchain.sh in the worktree"
    echo ""
    echo "Verified-maintenance override (use sparingly): DPF_ALLOW_ROOT_CLONE_COMMIT=1"
    echo ""
    exit 1
    ;;
esac

exit 0

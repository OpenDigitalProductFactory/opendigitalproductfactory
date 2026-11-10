#!/bin/sh
# scripts/hooks/worktree-freshness.sh
#
# SessionStart freshness advisory (POSIX). Counterpart of worktree-freshness.ps1.
#
# Why: a topic worktree whose base is a stale `main` is the root cause of the
# worst git accidents in this repo. When `main` has moved far past the worktree's
# base AND the checkout is a shallow clone, a bare `git rebase origin/main`
# cannot find the merge-base and replays thousands of phantom commits, unwinding
# the working tree; a stale base also carries obsolete files (e.g. a since-
# migrated baseline) that surface as modify/delete conflicts at PR time. This
# hook warns the agent at session start, BEFORE any implementation, so the base
# is refreshed first, and prints the shallow-safe `git rebase --onto` incantation.
#
# Why it also reports the INSTRUCTION PLANE (BI-9A46E89C): `CLAUDE.md` imports
# `AGENTS.md` from the WORKTREE, so a stale base does not merely risk a git
# accident -- it silently governs the session by a superseded rulebook, and the
# agent cannot detect that from the inside because the stale copy does not know
# it is stale. Measured 2026-09-16 on a worktree 807 commits behind: AGENTS.md
# had gained "A gate that could not run is not a verdict" (2026-09-05) and 24
# kernel-principle files had moved, none of them visible. The session's section 1
# "does this already exist?" checks therefore returned false negatives, and it
# rebuilt a helper that existed and proposed a principle that existed. The
# commit-count warning alone did not convey that: it reads as "your code may
# conflict", so it was acknowledged and worked past. This names the actual
# consequence instead.
#
# The instruction-plane signal is reported INDEPENDENTLY of the commit-count
# threshold, because the risk does not scale with distance -- one commit can add
# a commandment. Measured churn (90 days to 2026-09-16): AGENTS.md moved in 90
# of 3219 commits, about once every 36, so this is near the existing
# BEHIND_THRESHOLD of 40 and adds little noise.
#
# Invoked by the .claude/settings.json SessionStart hook via run-hook.mjs.
# Advisory only. Exit 0 ALWAYS -- a freshness check must never block a session
# from starting. Advisory text is printed to stdout, which Claude Code adds to
# session context. Set DPF_SKIP_WORKTREE_FRESHNESS=1 to silence. Plain ASCII.
#
# Uses only refs already present locally (no network / no fetch), so it is fast
# and can never hang session startup. It therefore judges against the LAST-known
# origin/main; the advisory tells the reader to `git fetch` to refresh.

set -u

[ "${DPF_SKIP_WORKTREE_FRESHNESS:-0}" = "1" ] && exit 0

# Must be inside a work tree.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# The root/merge clone stays on main and is the primary checkout -- nothing to warn.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo)"
[ "$branch" = "main" ] && exit 0
[ "$branch" = "HEAD" ] && exit 0

# Only advise inside a *linked* worktree: there --git-dir differs from the shared
# --git-common-dir. (Guards the primary checkout even if it is off main.)
gitdir="$(git rev-parse --git-dir 2>/dev/null || echo)"
commondir="$(git rev-parse --git-common-dir 2>/dev/null || echo)"
[ -n "$gitdir" ] && [ "$gitdir" = "$commondir" ] && exit 0

# Need a local origin/main ref to judge against; absent one, stay silent.
git rev-parse --verify --quiet origin/main >/dev/null 2>&1 || exit 0

shallow="$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)"
mergebase="$(git merge-base HEAD origin/main 2>/dev/null || echo)"
behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo)"

# Instruction-plane drift: has the rulebook this session is GOVERNED BY moved on?
# Local refs only, same as every signal above -- never fetches, never hangs.
PRINCIPLES_DIR="docs/founder-kernel/wiki/principles"
agents_moved=0
principles_moved=0
if [ -n "$mergebase" ]; then
  if [ -n "$(git diff --name-only "$mergebase" origin/main -- AGENTS.md 2>/dev/null)" ]; then
    agents_moved=1
  fi
  principles_moved="$(git diff --name-only "$mergebase" origin/main -- "$PRINCIPLES_DIR" 2>/dev/null | wc -l | tr -d ' ')"
  case "$principles_moved" in '' | *[!0-9]*) principles_moved=0 ;; esac
fi
plane_moved=0
[ "$agents_moved" = "1" ] && plane_moved=1
[ "$principles_moved" -gt 0 ] 2>/dev/null && plane_moved=1

# Staleness triggers:
#   - no common ancestor with origin/main (base older than the shallow horizon,
#     or genuinely divergent) -- this is the exact state that detonates a bare
#     rebase; or
#   - the base trails origin/main by more than a threshold (main moves fast here).
BEHIND_THRESHOLD=40
stale=0
reason=""
if [ -z "$mergebase" ]; then
  stale=1
  reason="no common ancestor with origin/main (base is stale or beyond this shallow clone's history horizon)"
else
  case "$behind" in
    '' | *[!0-9]*) : ;;                       # non-numeric -> skip this signal
    *) [ "$behind" -gt "$BEHIND_THRESHOLD" ] && { stale=1; reason="the base trails origin/main by ~$behind commits"; } ;;
  esac
fi

# Either signal is worth a word; neither means silence.
[ "$stale" = "1" ] || [ "$plane_moved" = "1" ] || exit 0

if [ "$stale" = "1" ]; then
printf '%s\n' "WARNING: DPF worktree freshness -- this worktree ($branch) looks stale:"
printf '%s\n' "    $reason."
printf '%s\n' "Refresh the base BEFORE implementing or opening a PR:"
printf '%s\n' "    git fetch origin main"
if [ "$shallow" = "true" ]; then
  printf '%s\n' "This is a SHALLOW clone -- do NOT run a bare 'git rebase origin/main'."
  printf '%s\n' "With no visible merge-base it replays thousands of phantom commits and"
  printf '%s\n' "unwinds your tree. Rebase only your own commits onto current main:"
  printf '%s\n' "    git rebase --onto origin/main <the-commit-you-branched-from>"
  printf '%s\n' "(abort with 'git rebase --abort' if a rebase ever balloons past your commit count.)"
else
  printf '%s\n' "Rebase your commits onto current main:  git rebase origin/main"
fi
printf '%s\n' "See AGENTS.md section 4 (Branching) -> worktree freshness. Silence: DPF_SKIP_WORKTREE_FRESHNESS=1."
fi

# BI-9A46E89C: the rules themselves are stale, which is a different and quieter
# failure than a merge conflict -- say so in its own terms.
if [ "$plane_moved" = "1" ]; then
  printf '%s\n' "WARNING: DPF instruction plane -- the rules governing this session are NOT current."
  if [ "$agents_moved" = "1" ]; then
    printf '%s\n' "    AGENTS.md has changed on origin/main since this worktree's base."
    printf '%s\n' "    CLAUDE.md imports AGENTS.md FROM THIS WORKTREE, so you are reading the old copy."
  fi
  if [ "$principles_moved" -gt 0 ] 2>/dev/null; then
    printf '%s\n' "    $principles_moved kernel principle file(s) have changed since this base."
  fi
  printf '%s\n' "Consequence: every 'does this already exist?' check you run against this tree"
  printf '%s\n' "can return a FALSE NEGATIVE -- a rule, principle, helper or guard that exists on"
  printf '%s\n' "main may read as absent here, so you may rebuild or re-propose what is already"
  printf '%s\n' "canonical. A stale rulebook cannot report that it is stale."
  printf '%s\n' "Refresh BEFORE any substrate check or new-work proposal:"
  printf '%s\n' "    git fetch origin main   (then rebase as above, or re-branch from origin/main)"
  printf '%s\n' "Review what moved:"
  printf '%s\n' "    git diff \$(git merge-base HEAD origin/main) origin/main -- AGENTS.md $PRINCIPLES_DIR"
fi

exit 0

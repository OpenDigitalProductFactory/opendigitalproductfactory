#!/usr/bin/env bash
# BI-AD949172 — Worktree janitor (macOS / Linux bash parity for the PowerShell phases 2-6).
#
# Identifies worktrees that are safe to prune and reports (or removes) them.
#
# USAGE
#   bash scripts/worktree-janitor.sh [--dry-run] [--grace-days N] [--force]
#
# FLAGS
#   --dry-run        (default) Print candidates only; do nothing destructive.
#   --live           Run live: git worktree remove + branch -D for PRUNE candidates.
#   --grace-days N   Days without a commit after which a worktree is a candidate
#                    (default: 14). Merged worktrees are candidates immediately.
#   --force          Also remove worktrees with untracked files (last resort;
#                    normally refused if the worktree has any local-only state).
#
# PRUNING RULES (all conditions must hold for a worktree to be PRUNE candidate):
#   1. Fully merged to origin/main (branch is an ancestor of origin/main).
#      OR last commit was > grace-days ago (stale / abandoned).
#   2. No open PR for the branch (requires `gh` CLI; skipped if unavailable).
#   3. No active NonProductionEnvironmentLease for the worktree path
#      (checked via MCP if DPF_MCP_BEARER_TOKEN is set; otherwise skipped).
#   4. Working tree is clean (no staged/unstaged tracked changes).
#      --force bypasses this for merged branches only.
#
# PINNING
#   A worktree is exempt from any pruning if it contains a file named
#   .worktree-pinned in its root. This is the escape hatch for long-lived
#   worktrees that intentionally stay behind main.
#
# OUTPUT
#   One line per worktree (PRUNE / KEEP / SKIP / PINNED) with reason.
#   Summary at the end: N PRUNE, M KEEP, P SKIP, Q PINNED.
#
# EXAMPLES
#   bash scripts/worktree-janitor.sh                   # dry-run (safe)
#   bash scripts/worktree-janitor.sh --live            # actually prune
#   bash scripts/worktree-janitor.sh --grace-days 30   # conservative
#   bash scripts/worktree-janitor.sh --dry-run --grace-days 7  # audit

set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
DRY_RUN=1
GRACE_DAYS=14
FORCE=0
GIT_BIN="git"
GH_BIN="gh"
MCP_URL="${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}"

# ── Arg parse ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)      DRY_RUN=1 ;;
    --live)         DRY_RUN=0 ;;
    --force)        FORCE=1 ;;
    --grace-days)   shift; GRACE_DAYS="${1:?--grace-days requires a number}" ;;
    --grace-days=*) GRACE_DAYS="${1#*=}" ;;
    -h|--help)
      sed -n '2,50p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
  shift
done

# ── Helpers ──────────────────────────────────────────────────────────────────
info()   { printf '  [info]  %s\n' "$*"; }
ok()     { printf '  [ok]    %s\n' "$*"; }
warn()   { printf '  [warn]  %s\n' "$*" >&2; }

count_prune=0; count_keep=0; count_skip=0; count_pinned=0

record() { # verdict path reason
  local verdict="$1" path="$2" reason="$3"
  printf '  %-8s %s  (%s)\n' "$verdict" "$path" "$reason"
  case "$verdict" in
    PRUNE)  count_prune=$((count_prune + 1)) ;;
    KEEP)   count_keep=$((count_keep + 1)) ;;
    SKIP)   count_skip=$((count_skip + 1)) ;;
    PINNED) count_pinned=$((count_pinned + 1)) ;;
  esac
}

# ── Main clone detection ──────────────────────────────────────────────────────
script_dir="$(cd "$(dirname "$0")" && pwd)"
root="$("$GIT_BIN" -C "$script_dir" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
if [ -z "${root:-}" ]; then
  echo "  [fail]  could not determine root clone" >&2; exit 1
fi

# Fetch so merge-base checks see current remote state.
"$GIT_BIN" -C "$root" fetch origin --quiet 2>/dev/null || warn "fetch failed; using cached remote refs"

now_ts="$(date +%s)"
grace_secs=$((GRACE_DAYS * 86400))

# ── Lease check via MCP ────────────────────────────────────────────────────
has_active_lease() {
  local wt_path="$1"
  [ -n "${DPF_MCP_BEARER_TOKEN:-}" ] || return 1  # token absent → skip check
  local resp
  resp="$(curl -sS -X POST "$MCP_URL" \
    -H "Authorization: Bearer $DPF_MCP_BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_nonprod_environment_leases","arguments":{}}}' \
    2>/dev/null)" || return 1
  # Check if any active lease worktreePath matches wt_path
  printf '%s' "$resp" | grep -q "\"$wt_path\""
}

# ── Open PR check via gh CLI ──────────────────────────────────────────────
has_open_pr() {
  local branch="$1"
  command -v "$GH_BIN" >/dev/null 2>&1 || return 1  # gh absent → skip check
  local count
  count="$("$GH_BIN" pr list --head "$branch" --state open --json number --jq 'length' 2>/dev/null)" || return 1
  [ "${count:-0}" -gt 0 ]
}

printf '\nWorktree janitor — %s (grace=%d days, %s)\n\n' \
  "$([ "$DRY_RUN" = "1" ] && echo "DRY RUN" || echo "LIVE")" \
  "$GRACE_DAYS" "$(date)"

# ── Worktree loop ────────────────────────────────────────────────────────────
while IFS= read -r wt_path; do
  # Skip the root and detached worktrees
  [ "$wt_path" != "$root" ] || continue

  branch="$("$GIT_BIN" -C "$wt_path" branch --show-current 2>/dev/null || true)"
  [ -n "$branch" ] || { record SKIP "$wt_path" "detached HEAD"; continue; }
  [ "$branch" != "main" ] || { record SKIP "$wt_path" "on main branch"; continue; }

  # Pinned?
  if [ -f "$wt_path/.worktree-pinned" ]; then
    record PINNED "$wt_path" "branch=$branch .worktree-pinned present"
    continue
  fi

  # Active lease?
  if has_active_lease "$wt_path"; then
    record KEEP "$wt_path" "branch=$branch active NonProductionEnvironmentLease"
    continue
  fi

  # Open PR?
  if has_open_pr "$branch"; then
    record KEEP "$wt_path" "branch=$branch open PR"
    continue
  fi

  # Merged to origin/main?
  merged=0
  "$GIT_BIN" merge-base --is-ancestor "refs/heads/$branch" origin/main 2>/dev/null && merged=1 || true

  # Dirty check
  dirty_count="$("$GIT_BIN" -C "$wt_path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  dirty=0; [ "$dirty_count" -gt 0 ] && dirty=1

  if [ "$merged" = "1" ]; then
    if [ "$dirty" = "1" ] && [ "$FORCE" = "0" ]; then
      record KEEP "$wt_path" "branch=$branch merged but dirty ($dirty_count changes); use --force to prune"
    else
      reason="merged to origin/main"
      [ "$dirty" = "1" ] && reason="$reason (forced: $dirty_count dirty files)"
      record PRUNE "$wt_path" "branch=$branch $reason"
      if [ "$DRY_RUN" = "0" ]; then
        "$GIT_BIN" -C "$root" worktree remove "$wt_path" ${FORCE:+--force} 2>&1 && ok "removed worktree $wt_path" || warn "worktree remove failed"
        "$GIT_BIN" -C "$root" branch -D "$branch" 2>&1 && ok "deleted branch $branch" || warn "branch delete failed (may be checked out elsewhere)"
      fi
    fi
    continue
  fi

  # Stale by age?
  last_commit_ts="$("$GIT_BIN" -C "$wt_path" log -1 --format="%ct" 2>/dev/null || echo 0)"
  age_secs=$(( now_ts - last_commit_ts ))
  if [ "$age_secs" -gt "$grace_secs" ]; then
    age_days=$(( age_secs / 86400 ))
    if [ "$dirty" = "1" ]; then
      record KEEP "$wt_path" "branch=$branch stale ${age_days}d but dirty; manual review required"
    else
      record PRUNE "$wt_path" "branch=$branch stale ${age_days}d (>${GRACE_DAYS}d), unmerged, clean"
      if [ "$DRY_RUN" = "0" ]; then
        "$GIT_BIN" -C "$root" worktree remove "$wt_path" 2>&1 && ok "removed worktree $wt_path" || warn "worktree remove failed"
        "$GIT_BIN" -C "$root" branch -D "$branch" 2>&1 && ok "deleted branch $branch" || warn "branch delete failed"
      fi
    fi
    continue
  fi

  age_days=$(( age_secs / 86400 ))
  record KEEP "$wt_path" "branch=$branch unmerged, ${age_days}d old (<${GRACE_DAYS}d grace)"

done < <("$GIT_BIN" -C "$root" worktree list --porcelain | awk '/^worktree /{print $2}')

printf '\nSummary: %d PRUNE  %d KEEP  %d SKIP  %d PINNED\n' \
  "$count_prune" "$count_keep" "$count_skip" "$count_pinned"

[ "$DRY_RUN" = "1" ] && printf '\n(Dry run — nothing removed. Pass --live to prune.)\n'

exit 0

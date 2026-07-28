#!/bin/sh
# scripts/hooks/janitor-throttle.sh
#
# SessionStart janitor-throttle advisory (POSIX). Counterpart of janitor-throttle.ps1.
#
# Why: scripts/worktree-janitor.sh (merged/stale worktree + branch cleanup) and
# the Windows temp/wsl-crash cleanup are both correct and safe, but nothing ran
# them automatically -- so worktrees, branches, and orphaned WSL crash dumps
# accumulated for days between manual sweeps (378 worktrees / 1928 branches /
# 60GB of crash dumps in one observed case). A blind host-level cron was
# explicitly rejected in favor of throttled-by-interaction: run at most once
# per DPF_JANITOR_THROTTLE_HOURS (default 24), and only as a side effect of an
# agent session actually starting -- never on a machine nobody is using, and
# never on every single thread.
#
# This hook is ADVISORY ONLY, matching worktree-freshness's contract: it never
# runs the cleanup itself (SessionStart hooks are not the place for a multi-
# minute destructive sweep across hundreds of worktrees) -- it tells the AGENT
# to run it, at the top of the session, before user work begins. The debounce
# marker is written optimistically when the advisory fires, not when the agent
# actually complies -- if a session ignores the advisory, the worst case is one
# more day of normal sprawl before the next session is asked again.
#
# Marker lives under the shared --git-common-dir so every worktree of this
# clone (regardless of which one happens to start a session next) agrees on
# the same "last advised" timestamp -- exactly one advisory per throttle
# window across however many concurrent worktrees exist.
#
# Invoked by the .claude/settings.json SessionStart hook via run-hook.mjs.
# Exit 0 ALWAYS -- must never block a session from starting.
# Set DPF_SKIP_JANITOR_THROTTLE=1 to silence permanently on this machine.

set -u

[ "${DPF_SKIP_JANITOR_THROTTLE:-0}" = "1" ] && exit 0

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

commondir="$(git rev-parse --git-common-dir 2>/dev/null || echo)"
[ -n "$commondir" ] || exit 0

marker="$commondir/dpf-janitor-last-advised"
throttle_hours="${DPF_JANITOR_THROTTLE_HOURS:-24}"
throttle_secs=$((throttle_hours * 3600))
now="$(date +%s 2>/dev/null || echo 0)"

if [ -f "$marker" ]; then
  last="$(cat "$marker" 2>/dev/null || echo 0)"
  case "$last" in
    '' | *[!0-9]*) last=0 ;;
  esac
  elapsed=$((now - last))
  [ "$elapsed" -lt "$throttle_secs" ] && exit 0
fi

# Fire the advisory, then mark it optimistically (see header) so this window
# does not ask again regardless of whether the agent complies.
printf '%s\n' "$now" > "$marker" 2>/dev/null

printf '%s\n' "DPF HOUSEKEEPING DUE: it has been ${throttle_hours}h+ since the last janitor sweep (or none is recorded)."
printf '%s\n' "Before starting the user's request, run these two safe, idempotent cleanups from the repo root:"
printf '%s\n' "  1. bash scripts/worktree-janitor.sh --live"
printf '%s\n' "     (prunes merged/stale worktrees + branches; protects dirty trees, open PRs, and active leases automatically)"
if [ "$(uname -s 2>/dev/null | cut -c1-6)" = "MINGW6" ] || command -v wsl.exe >/dev/null 2>&1; then
  printf '%s\n' "  2. powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-temp-cleanup.ps1"
  printf '%s\n' "     (clears WSL crash dumps + orphaned/unlocked swap.vhdx files; never touches a locked/in-use file)"
fi
printf '%s\n' "Both are safe to run unattended -- report a one-line summary of what was reclaimed, then continue with the user's actual request."
printf '%s\n' "See AGENTS.md -> Housekeeping. Silence permanently: DPF_SKIP_JANITOR_THROTTLE=1. Adjust cadence: DPF_JANITOR_THROTTLE_HOURS=<n>."

exit 0

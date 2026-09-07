#!/usr/bin/env bash
# scripts/setup-worktree-hygiene.sh
#
# BI-5F4F0146 — Worktree hygiene, applied by EVERY DPF install surface (customer
# and full-source; macOS and Linux). Single source of truth so the four install
# surfaces (install-dpf.sh, setup.sh, plus the Windows .ps1 twin) do not each carry
# their own copy. Idempotent and best-effort: a hygiene step must never fail an
# install.
#
# It does two things:
#   1. Registers the worktree janitor on a daily schedule so merged+clean worktrees
#      are reaped automatically. Unreaped, they accumulate into the hundreds; each
#      carries a real node_modules tree, and the OS file indexer then thrashes the
#      host (macOS Spotlight load 20-40), starving the portal/inference VM.
#   2. Keeps the worktree base out of Spotlight (macOS). NOTE: `mdutil -i off` does
#      not work on a subfolder, and a plain `.metadata_never_index` proved
#      INSUFFICIENT on recent macOS (observed: mds kept indexing after it was
#      placed; adding the folder to the Spotlight Privacy / Exclusions list is what
#      actually stopped it). So the authoritative mechanism is the Exclusions list,
#      which needs elevation — applied here when we can elevate (interactive install
#      → one sudo prompt; or already root), and otherwise surfaced as a one-line
#      manual step. Linux servers/containers have no aggressive desktop indexer, so
#      the janitor alone suffices there.
#
# Usage: bash scripts/setup-worktree-hygiene.sh [REPO_ROOT]
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
WT_BASE="$(cd "$REPO_ROOT/.." 2>/dev/null && pwd)/dpf-worktrees"
mkdir -p "$WT_BASE" 2>/dev/null || true

log() { printf '  %s\n' "$*"; }

# ── 1) Janitor schedule (idempotent; safe to re-run) ──────────────────────────
if bash "$SCRIPT_DIR/install-worktree-janitor-schedule.sh" --live --tier-a-only >/dev/null 2>&1; then
  log "worktree janitor scheduled (daily, merged+clean only)"
else
  log "worktree janitor schedule not registered (non-fatal): bash scripts/install-worktree-janitor-schedule.sh --live --tier-a-only"
fi

# ── 2) OS indexer exclusion ───────────────────────────────────────────────────
if [ "$(uname -s)" = "Darwin" ]; then
  touch "$WT_BASE/.metadata_never_index" 2>/dev/null || true
  PLIST="/System/Volumes/Data/.Spotlight-V100/VolumeConfiguration.plist"
  # Run privileged only when we truly can: already root, or interactive (a tty) with
  # sudo available so the operator authenticates the installer once. Never in a
  # headless/CI install (no tty) — there we fall back to the printed step.
  run_priv() {
    if [ "$(id -u)" = "0" ]; then "$@";
    elif [ -t 0 ] && command -v sudo >/dev/null 2>&1; then sudo "$@";
    else return 1; fi
  }
  if /usr/libexec/PlistBuddy -c "Print :Exclusions" "$PLIST" 2>/dev/null | grep -qF "$WT_BASE"; then
    log "worktree base already excluded from Spotlight"
  elif run_priv /usr/libexec/PlistBuddy -c "Add :Exclusions: string $WT_BASE" "$PLIST" 2>/dev/null; then
    run_priv mdutil -E / >/dev/null 2>&1 || true
    log "excluded the worktree base from Spotlight indexing"
  else
    log "could not exclude the worktree base from Spotlight automatically (needs admin, or macOS SIP blocked it)."
    log "one-time step: System Settings > Spotlight > Spotlight Privacy > + > add '$WT_BASE'"
  fi
fi

exit 0

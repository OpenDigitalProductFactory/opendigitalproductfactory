#!/usr/bin/env bash
# Open Digital Product Factory — clean reinstall (macOS / Linux).
#
# Orchestrator: nuke local runtime state, then redo install. Equivalent to:
#
#   bash uninstall-dpf.sh --purge && bash install-dpf.sh
#
# but with shared flag forwarding (--headless, --dry-run, --release, ...)
# so operators don't have to retype the same options twice.
#
# Important difference from the Windows-side dpf-reinstall.ps1: this script
# does NOT delete the cloned repo directory, and there is no Windows-only
# bind-mount data dir to wipe (Phase 2 dropped that pattern). The "wipe
# everything local" surface is handled cleanly by uninstall-dpf.sh --purge,
# which uses compose-project label selection.
#
# Per the deployment doctrine (Contract 3 — lifecycle).
#
# Bash 3.2 baseline.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
LIB_DIR="$REPO_ROOT/scripts/installer/lib"

# shellcheck source=scripts/installer/lib/logging.sh
. "$LIB_DIR/logging.sh"
# shellcheck source=scripts/installer/lib/prompts.sh
. "$LIB_DIR/prompts.sh"

usage() {
  cat <<EOF
Open Digital Product Factory — Reinstall

Usage:
  bash dpf-reinstall.sh [flags]

This is a destructive operation. It runs:

  1. bash uninstall-dpf.sh --purge --keep-state (wipes runtime data and .env)
  2. bash install-dpf.sh                    (full re-install)

Flags forwarded to uninstall-dpf.sh:
  --keep-env      Preserve .env across the wipe.
  --reset-state   Also delete lifecycle state (explicit destructive reset).

Flags forwarded to install-dpf.sh:
  --release       Use pre-built GHCR images.
  --dev           Build images locally.
  --no-autostart  Skip LaunchAgent / systemd-user unit install.

Flags applied to both:
  --headless      Non-interactive. Required for CI.
  --yes           Skip the destructive-confirmation prompt under --headless.
                  Without --yes, --headless purge is refused.
  --dry-run       Print planned actions without executing.
  -h, --help      Show this help.
EOF
}

DPF_KEEP_ENV=0
DPF_KEEP_STATE=1
DPF_MODE=""           # forwarded to install-dpf.sh
DPF_NO_AUTOSTART=0
DPF_HEADLESS_FLAG=""
DPF_YES=0
DPF_DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-env)       DPF_KEEP_ENV=1 ;;
    --keep-state)     DPF_KEEP_STATE=1 ;;
    --reset-state)    DPF_KEEP_STATE=0 ;;
    --release)        DPF_MODE="release" ;;
    --dev)            DPF_MODE="dev" ;;
    --no-autostart)   DPF_NO_AUTOSTART=1 ;;
    --headless)       DPF_HEADLESS_FLAG="--headless"; DPF_HEADLESS=1; export DPF_HEADLESS ;;
    --yes)            DPF_YES=1 ;;
    --dry-run)        DPF_DRY_RUN=1 ;;
    -h|--help)        usage; exit 0 ;;
    *)
      echo "dpf-reinstall.sh: unknown argument: $1" >&2
      echo "Run 'bash dpf-reinstall.sh --help' for usage." >&2
      exit 64
      ;;
  esac
  shift
done

cd "$REPO_ROOT"

echo ""
echo "  Open Digital Product Factory — Reinstall (destructive)"
echo "  ======================================================="
echo ""
warn "This will:"
warn "  1. Stop the stack and delete all DPF docker volumes"
[ "$DPF_KEEP_ENV"   = "1" ] || warn "  2. Delete .env (operator secrets)"
[ "$DPF_KEEP_STATE" = "1" ] || warn "  3. Delete ~/.dpf state directory"
warn "  4. Re-run install-dpf.sh from scratch"
echo ""

# Top-level confirmation in interactive mode. We let uninstall-dpf.sh
# also prompt under --purge so operators get a second chance to abort
# right before the actual delete. Under --headless we require --yes here
# so the orchestrator and the underlying scripts agree on intent.
if [ "${DPF_HEADLESS:-0}" = "1" ]; then
  if [ "$DPF_YES" != "1" ]; then
    fail "--headless reinstall requires --yes (destructive)."
  fi
else
  dpf_yes_no "Proceed?" "no"
  if [ "$DPF_REPLY" != "yes" ]; then
    info "Aborted."
    exit 0
  fi
fi

# Build forwarded flag arrays.
UNINSTALL_FLAGS=( --purge )
[ "$DPF_KEEP_ENV"   = "1" ] && UNINSTALL_FLAGS+=( --keep-env )
[ "$DPF_KEEP_STATE" = "1" ] && UNINSTALL_FLAGS+=( --keep-state )
[ -n "$DPF_HEADLESS_FLAG" ] && UNINSTALL_FLAGS+=( "$DPF_HEADLESS_FLAG" )
[ "$DPF_YES"        = "1" ] && UNINSTALL_FLAGS+=( --yes )
[ "$DPF_DRY_RUN"    = "1" ] && UNINSTALL_FLAGS+=( --dry-run )

INSTALL_FLAGS=()
[ -n "$DPF_MODE" ]              && INSTALL_FLAGS+=( "--$DPF_MODE" )
[ "$DPF_NO_AUTOSTART" = "1" ]   && INSTALL_FLAGS+=( --no-autostart )
[ -n "$DPF_HEADLESS_FLAG" ]     && INSTALL_FLAGS+=( "$DPF_HEADLESS_FLAG" )
[ "$DPF_DRY_RUN"      = "1" ]   && INSTALL_FLAGS+=( --dry-run )

step "Phase 1: uninstall --purge"
bash "$REPO_ROOT/uninstall-dpf.sh" "${UNINSTALL_FLAGS[@]}"

step "Phase 2: install"
# Use exec so install-dpf.sh's exit code becomes ours and we don't double
# up shell stack frames during the long second half.
if [ "${#INSTALL_FLAGS[@]}" -gt 0 ]; then
  exec bash "$REPO_ROOT/install-dpf.sh" "${INSTALL_FLAGS[@]}"
else
  exec bash "$REPO_ROOT/install-dpf.sh"
fi

#!/usr/bin/env bash
# Open Digital Product Factory — stop the stack.
#
# Day-to-day "bring it down" sibling. Mirrors the PowerShell dpf-stop.ps1
# (Windows GA): docker compose down on the canonical chain. Containers
# are removed; named volumes are preserved (see uninstall-dpf.sh --purge
# for the destructive variant).
#
# Bash 3.2 baseline (macOS default).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
LIB_DIR="$REPO_ROOT/scripts/installer/lib"

# shellcheck source=scripts/installer/lib/logging.sh
. "$LIB_DIR/logging.sh"
# shellcheck source=scripts/installer/lib/platform.sh
. "$LIB_DIR/platform.sh"
# shellcheck source=scripts/installer/lib/compose.sh
. "$LIB_DIR/compose.sh"
# shellcheck source=scripts/installer/lib/state.sh
. "$LIB_DIR/state.sh"

usage() {
  cat <<EOF
Open Digital Product Factory — Stop

Usage:
  bash dpf-stop.sh [flags]

Flags:
  --release    Use release-mode compose chain (default if install-state.json
               records release; else dev).
  --dev        Force dev-mode chain.
  --dry-run    Print the planned command without running it.
  -h, --help   Show this help.

Volumes are preserved. To wipe data too: bash uninstall-dpf.sh --purge
EOF
}

DPF_MODE=""
DPF_DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --release)   DPF_MODE="release" ;;
    --dev)       DPF_MODE="dev" ;;
    --dry-run)   DPF_DRY_RUN=1 ;;
    -h|--help)   usage; exit 0 ;;
    *)
      echo "dpf-stop.sh: unknown argument: $1" >&2
      echo "Run 'bash dpf-stop.sh --help' for usage." >&2
      exit 64
      ;;
  esac
  shift
done

cd "$REPO_ROOT"
dpf_platform

if [ -z "$DPF_MODE" ]; then
  if [ -f "$(dpf_state_path)" ]; then
    case "$(dpf_state_read installerVersion 2>/dev/null || true)" in
      *release*) DPF_MODE="release" ;;
      *)         DPF_MODE="dev" ;;
    esac
  else
    DPF_MODE="dev"
  fi
fi

dpf_compose_files "$DPF_MODE"

step "Stopping Digital Product Factory ($DPF_MODE)"
if [ "$DPF_DRY_RUN" = "1" ]; then
  echo "  would run: docker compose ${DPF_COMPOSE_FILES[*]} down --remove-orphans"
  ok "Dry-run complete; no changes made."
  exit 0
fi

docker compose "${DPF_COMPOSE_FILES[@]}" down --remove-orphans
ok "Digital Product Factory stopped."

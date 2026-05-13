#!/usr/bin/env bash
# Open Digital Product Factory — start the stack.
#
# Day-to-day "bring it up" sibling. Mirrors the PowerShell dpf-start.ps1
# (Windows GA) with the same defaults: docker compose up -d on the
# canonical chain (per-platform overlay included via compose.sh), then
# optionally opens the portal in a browser.
#
# Use this when the stack is already installed (install-dpf.sh has run
# at least once) and you just want it running again — for example after
# a host reboot if you opted out of autostart, or after a manual stop.
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
Open Digital Product Factory — Start

Usage:
  bash dpf-start.sh [flags]

Flags:
  --release       Use pre-built GHCR images (docker-compose.release.yml
                  overlay). Default if install-state.json records release
                  mode; otherwise dev.
  --dev           Force dev mode (build images locally).
  --no-edge       Skip bringing up the Edge Node container. Default is
                  to include it (matches install-dpf.sh's default
                  bundling). Honors DPF_INCLUDE_EDGE=0 from the env.
  --no-browser    Don't try to open the portal in a browser after start.
  --dry-run       Print the planned compose command without running it.
  -h, --help      Show this help.

Reads ~/.dpf/install-state.json to pick the right mode if neither
--release nor --dev is given. Falls back to dev.
EOF
}

DPF_MODE=""
DPF_NO_BROWSER=0
DPF_DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --release)     DPF_MODE="release" ;;
    --dev)         DPF_MODE="dev" ;;
    --no-edge)     DPF_INCLUDE_EDGE=0 ;;
    --no-browser)  DPF_NO_BROWSER=1 ;;
    --dry-run)     DPF_DRY_RUN=1 ;;
    -h|--help)     usage; exit 0 ;;
    *)
      echo "dpf-start.sh: unknown argument: $1" >&2
      echo "Run 'bash dpf-start.sh --help' for usage." >&2
      exit 64
      ;;
  esac
  shift
done

# Export so dpf_compose_files picks it up. The compose helper defaults
# to including the edge overlay; --no-edge or a pre-set
# DPF_INCLUDE_EDGE=0 in the environment turns it off.
export DPF_INCLUDE_EDGE="${DPF_INCLUDE_EDGE:-1}"

cd "$REPO_ROOT"
dpf_platform

# Resolve mode from state if not explicitly chosen.
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

step "Starting Digital Product Factory ($DPF_MODE)"
if [ "$DPF_DRY_RUN" = "1" ]; then
  echo "  would run: docker compose ${DPF_COMPOSE_FILES[*]} up -d"
  ok "Dry-run complete; no changes made."
  exit 0
fi

docker compose "${DPF_COMPOSE_FILES[@]}" up -d
ok "Stack is starting at http://localhost:3000"

# Best-effort browser open. Honors NO_BROWSER for headless / SSH.
if [ "$DPF_NO_BROWSER" != "1" ] && [ -z "${NO_BROWSER:-}" ] && [ -t 1 ]; then
  sleep 5
  if [ "$DPF_PLATFORM" = "darwin" ] && command -v open >/dev/null 2>&1; then
    open "http://localhost:3000" 2>/dev/null || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:3000" 2>/dev/null || true
  fi
fi

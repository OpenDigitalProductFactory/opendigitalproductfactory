#!/usr/bin/env bash
# Open Digital Product Factory — end-user uninstaller (macOS / Linux).
#
# Companion to install-dpf.sh. Two destruction tiers:
#
#   (default)   Soft uninstall. Stops the stack and removes the autostart
#               unit. Preserves PostgreSQL volumes,
#               the .env file, and ~/.dpf/install-state.json so a later
#               re-install with `bash install-dpf.sh` resumes cleanly.
#
#   --purge     Full removal. Volumes, networks, images, the .env file,
#               and ~/.dpf state directory are all deleted. Destructive
#               and irreversible — requires an interactive confirmation
#               unless --headless --yes is also passed.
#
# Per the deployment doctrine: implements Contract 3 (lifecycle) — every
# install path must have a symmetric uninstall path, with data-preservation
# as the default to avoid foot-guns. The --purge tier matches the prior
# Windows-side `dpf-reinstall.ps1` data-wipe behavior, but here it is
# opt-in rather than implicit.
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
# shellcheck source=scripts/installer/lib/prompts.sh
. "$LIB_DIR/prompts.sh"
# shellcheck source=scripts/installer/lib/compose.sh
. "$LIB_DIR/compose.sh"
# shellcheck source=scripts/installer/lib/state.sh
. "$LIB_DIR/state.sh"
# shellcheck source=scripts/installer/lib/autostart.sh
. "$LIB_DIR/autostart.sh"

DPF_UNINSTALLER_VERSION="2026.05.10-phase7d"

# Compose project name. Pinned to "dpf" by docker-compose.yml top-level
# `name: dpf`; we use it as the resource selector for purge.
DPF_COMPOSE_PROJECT="dpf"

usage() {
  cat <<EOF
Open Digital Product Factory — Uninstaller

Usage:
  bash uninstall-dpf.sh [flags]

Flags:
  --purge       Also delete docker volumes, networks, images, the .env
                file, and ~/.dpf state directory. Destructive — preserves
                nothing.
  --keep-env    With --purge: keep .env (still wipes volumes + state).
                Useful when re-installing into a freshly nuked stack but
                wanting to retain operator-edited secrets.
  --keep-state  With --purge: keep ~/.dpf/install-state.json.
  --headless    Non-interactive (no prompts). Required for CI.
  --yes         Skip the interactive confirmation under --purge.
                Required alongside --headless --purge so --headless
                runs cannot silently destroy data.
  --dry-run     Print what would happen without executing.
  -h, --help    Show this help.

Per the deployment doctrine (Contract 3 — lifecycle): default tier
preserves data; --purge is opt-in. Re-install with: bash install-dpf.sh
EOF
}

DPF_PURGE=0
DPF_KEEP_ENV=0
DPF_KEEP_STATE=0
DPF_YES=0
DPF_DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --purge)        DPF_PURGE=1 ;;
    --keep-env)     DPF_KEEP_ENV=1 ;;
    --keep-state)   DPF_KEEP_STATE=1 ;;
    --headless)     DPF_HEADLESS=1; export DPF_HEADLESS ;;
    --yes)          DPF_YES=1 ;;
    --dry-run)      DPF_DRY_RUN=1 ;;
    -h|--help)      usage; exit 0 ;;
    *)
      echo "uninstall-dpf.sh: unknown argument: $1" >&2
      echo "Run 'bash uninstall-dpf.sh --help' for usage." >&2
      exit 64
      ;;
  esac
  shift
done

cd "$REPO_ROOT"

dpf_platform
dpf_arch

# ── Resolve compose chain ──────────────────────────────────────────────────
# Prefer the chain recorded in install-state.json (mode the user chose at
# install time); fall back to platform defaults. This lets uninstall stop
# the exact stack that was started, even if defaults later shift.
DPF_MODE_HINT="dev"
if [ -f "$(dpf_state_path)" ]; then
  STATE_MODE="$(dpf_state_read installerVersion || true)"
  case "$STATE_MODE" in
    *release*) DPF_MODE_HINT="release" ;;
    *)         : ;;
  esac
fi
dpf_compose_files "$DPF_MODE_HINT"

echo ""
echo "  Open Digital Product Factory — Uninstaller"
echo "  ==========================================="
echo "  Platform:        $DPF_PLATFORM ($DPF_ARCH)"
echo "  Compose project: $DPF_COMPOSE_PROJECT"
echo "  Tier:            $(if [ "$DPF_PURGE" = "1" ]; then echo "PURGE (destructive)"; else echo "soft (data preserved)"; fi)$(if [ "$DPF_DRY_RUN" = "1" ]; then echo "  [dry-run]"; fi)"
echo ""

# ── Confirmation under --purge ────────────────────────────────────────────
if [ "$DPF_PURGE" = "1" ] && [ "$DPF_YES" != "1" ]; then
  if [ "${DPF_HEADLESS:-0}" = "1" ]; then
    fail "--purge under --headless requires --yes to confirm destructive intent."
  fi
  warn "This will permanently delete:"
  warn "  - All Docker volumes for project '$DPF_COMPOSE_PROJECT' (including PostgreSQL)"
  warn "  - Networks and stopped containers labeled with the project"
  [ "$DPF_KEEP_ENV"   = "1" ] || warn "  - .env (operator secrets)"
  [ "$DPF_KEEP_STATE" = "1" ] || warn "  - ~/.dpf state directory (install history, logs, autostart launch script)"
  echo ""
  dpf_yes_no "Proceed with --purge?" "no"
  if [ "$DPF_REPLY" != "yes" ]; then
    info "Aborted by operator."
    exit 0
  fi
fi

# Helper: run a command, or echo it under --dry-run.
_run() {
  if [ "$DPF_DRY_RUN" = "1" ]; then
    echo "  would run: $*"
  else
    "$@"
  fi
}

# ── 1. Autostart unit ─────────────────────────────────────────────────────
step "Autostart unit"
if [ "$DPF_DRY_RUN" = "1" ]; then
  echo "  would run: dpf_autostart_uninstall (removes LaunchAgent / systemd-user unit)"
else
  dpf_autostart_uninstall || warn "Autostart uninstall returned non-zero (continuing)."
fi

# ── 2. Stop the compose stack ─────────────────────────────────────────────
step "Compose stack"
if ! command -v docker >/dev/null 2>&1; then
  warn "docker not installed; skipping compose down."
else
  if [ "$DPF_PURGE" = "1" ]; then
    # -v wipes named volumes; --rmi local drops images built by this
    # stack (release images pulled from GHCR are left alone since the
    # operator may share them with other projects).
    _run docker compose "${DPF_COMPOSE_FILES[@]}" down --volumes --remove-orphans --rmi local || \
      warn "docker compose down --volumes failed (continuing)."
  else
    _run docker compose "${DPF_COMPOSE_FILES[@]}" down --remove-orphans || \
      warn "docker compose down failed (continuing)."
  fi
fi

# ── 3. Purge-only: belt-and-braces resource sweep ─────────────────────────
if [ "$DPF_PURGE" = "1" ] && command -v docker >/dev/null 2>&1; then
  step "Purge: residual docker resources"

  # Volumes that escaped `docker compose down -v` (e.g. orphaned by a
  # prior compose version that used a different volume naming scheme).
  # We filter strictly by the compose project label so we never touch
  # volumes belonging to another stack on the same host.
  vol_ids="$(docker volume ls -q --filter "label=com.docker.compose.project=$DPF_COMPOSE_PROJECT" 2>/dev/null || true)"
  if [ -n "$vol_ids" ]; then
    info "Removing $(echo "$vol_ids" | wc -l | tr -d ' ') residual volume(s)..."
    # shellcheck disable=SC2086
    _run docker volume rm $vol_ids || warn "Some volumes could not be removed (they may be in use)."
  else
    info "No residual volumes for project '$DPF_COMPOSE_PROJECT'."
  fi

  # Networks similarly scoped to the compose project.
  net_ids="$(docker network ls -q --filter "label=com.docker.compose.project=$DPF_COMPOSE_PROJECT" 2>/dev/null || true)"
  if [ -n "$net_ids" ]; then
    info "Removing residual network(s)..."
    # shellcheck disable=SC2086
    _run docker network rm $net_ids || warn "Some networks could not be removed."
  fi
fi

# ── 4. Purge-only: state dir + .env ───────────────────────────────────────
if [ "$DPF_PURGE" = "1" ]; then
  step "Purge: filesystem state"

  if [ "$DPF_KEEP_ENV" != "1" ] && [ -f "$REPO_ROOT/.env" ]; then
    _run rm -f "$REPO_ROOT/.env"
    [ "$DPF_DRY_RUN" = "1" ] || info "Removed $REPO_ROOT/.env"
  fi

  state_dir="$(dpf_state_dir)"
  if [ "$DPF_KEEP_STATE" != "1" ] && [ -d "$state_dir" ]; then
    _run rm -rf "$state_dir"
    [ "$DPF_DRY_RUN" = "1" ] || info "Removed $state_dir"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
if [ "$DPF_DRY_RUN" = "1" ]; then
  ok "Dry-run complete; no changes made."
else
  ok "Uninstall complete."
fi
echo ""
if [ "$DPF_PURGE" = "1" ]; then
  echo "  All DPF resources removed. Re-install with: bash install-dpf.sh"
else
  echo "  Soft uninstall — data preserved. To wipe data too: bash uninstall-dpf.sh --purge"
  echo "  Re-install: bash install-dpf.sh"
fi
echo ""
exit 0
